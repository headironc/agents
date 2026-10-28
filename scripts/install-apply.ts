import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  cpSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { InstallPlanSchema, InstallReceiptSchema } from "./install-records.ts";
import type {
  InstallPlanV5,
  InstallReceiptV5,
  InstallTarget,
  TargetState,
} from "./install-records.ts";
import {
  attempt,
  bytewise,
  inspectParents,
  inspectRoots,
  lstatIfExists,
  machineIdentity,
  readTargetState,
  sameState,
  sha256,
} from "./install-state.ts";
import type { Gap, RootName } from "./install-state.ts";
import { canonicalDigest, readSourceEntries } from "./source.ts";

/** An unsupported record version is an interface error, reported like an argument error. */
export class RecordVersionError extends Error {}

/** Preconditions failed before this command changed any target; problems use the plan gap shape. */
export class InstallRefused extends Error {
  problems: Gap[];
  constructor(problems: Gap[]) {
    super("Installation command refused");
    this.problems = [
      ...new Map(
        problems.map((problem) => [JSON.stringify(problem), problem]),
      ).values(),
    ];
  }
}

type Runtime = InstallReceiptV5["runtime"];
type Step = InstallReceiptV5["steps"][number];
const refuse = (code: string, file?: string): never => {
  throw new InstallRefused([{ code, ...(file ? { path: file } : {}) }]);
};

function readRegularFile(file: string): Buffer {
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function readRecord(
  file: string,
  code: string,
): { bytes: Buffer; value: unknown; physical: string } {
  let physical = file;
  let bytes: Buffer;
  try {
    physical = realpathSync(file);
    if (!lstatSync(physical).isFile())
      throw new Error("Record must be a regular file");
    bytes = readRegularFile(physical);
  } catch {
    return refuse(`${code}-unreadable`, physical);
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return refuse(`${code}-invalid`, physical);
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version !== 5
  ) {
    throw new RecordVersionError(`Unsupported ${code} version: ${physical}`);
  }
  return { bytes, value, physical };
}

/** The run's persistent plan is the only source of an installation's targets; review copies are never trusted alone. */
function readPersistentPlan(file: string): Buffer {
  try {
    const stat = lstatIfExists(file);
    if (stat && !stat.isSymbolicLink() && stat.isFile())
      return readRegularFile(file);
  } catch {
    /* Unreadable is reported like missing. */
  }
  return refuse("persistent-plan-missing", file);
}

export function loadPlanForApply(file: string): InstallPlanV5 {
  const given = readRecord(file, "plan");
  const parsed = InstallPlanSchema.safeParse(given.value);
  if (!parsed.success) return refuse("plan-invalid", given.physical);
  if (!readPersistentPlan(parsed.data.run.plan).equals(given.bytes))
    refuse("plan-copy-mismatch", given.physical);
  return parsed.data;
}

export function loadReceipt(file: string): {
  receipt: InstallReceiptV5;
  plan: InstallPlanV5;
} {
  const record = readRecord(file, "receipt");
  const parsed = InstallReceiptSchema.safeParse(record.value);
  if (!parsed.success) return refuse("receipt-invalid", record.physical);
  const receipt = parsed.data;
  if (
    record.physical !==
    path.join(receipt.run.directory, "deployment-receipt.json")
  )
    refuse("receipt-location-mismatch", record.physical);
  let plan: InstallPlanV5;
  try {
    plan = InstallPlanSchema.parse(
      JSON.parse(readPersistentPlan(receipt.plan.path).toString("utf8")),
    );
  } catch (error) {
    if (error instanceof InstallRefused) throw error;
    return refuse("persistent-plan-invalid", receipt.plan.path);
  }
  if (
    plan.sha256 !== receipt.plan.sha256 ||
    plan.run.id !== receipt.run.id ||
    plan.run.receipt !== record.physical
  ) {
    refuse("persistent-plan-mismatch", receipt.plan.path);
  }
  // Recovery acts on the receipt's runtime, steps, backups and directories, so each must be the plan's own.
  if (canonicalDigest(receipt.runtime) !== canonicalDigest(runtimeOf(plan)))
    refuse("receipt-binding-mismatch", record.physical);
  for (const step of receipt.steps) {
    const target = plan.targets[step.order];
    const before = target?.before;
    const backup =
      (before?.type === "file" || before?.type === "directory") &&
      target?.backup
        ? { path: target.backup, sha256: before.sha256, mode: before.mode }
        : null;
    if (
      !target ||
      target.action === "unchanged" ||
      canonicalDigest(step.backup) !== canonicalDigest(backup)
    )
      refuse("receipt-step-mismatch", record.physical);
  }
  if (receipt.status === "installed") {
    const expected = plan.targets
      .filter((target) => target.action !== "unchanged")
      .map((target) => target.order);
    if (
      receipt.steps.length !== expected.length ||
      receipt.steps.some((step, index) => step.order !== expected[index])
    )
      refuse("receipt-step-mismatch", record.physical);
  }
  if (
    receipt.directories.some(
      (directory) => !plan.newDirectories.includes(directory.path),
    )
  )
    refuse("receipt-directory-mismatch", record.physical);
  if (
    receipt.status === "installed" &&
    (receipt.directories.length !== plan.newDirectories.length ||
      receipt.directories.some(
        (directory, index) =>
          directory.path !== plan.newDirectories[index] ||
          directory.phase !== "created",
      ))
  )
    refuse("receipt-directory-mismatch", record.physical);
  return { receipt, plan };
}

export function runtimeOf(plan: InstallPlanV5): Runtime {
  const file = (role: string) =>
    plan.runtime.files.find((item) => item.role === role)!;
  return {
    node: file("node").path,
    nodeSha256: file("node").sha256,
    installer: file("installer").path,
    installerSha256: file("installer").sha256,
  };
}

/**
 * Re-check the host, roots and run directory the plan bound. Roots must resolve to the same paths from the
 * same variables, and each recorded anchor must still be the same directory; anchors themselves move
 * deeper once plan and apply create directories, so they are not recomputed.
 */
export type HostFacts = {
  hostname: string;
  machine: string | undefined;
  uid: number;
  platform: NodeJS.Platform;
  arch: string;
};

export const hostFacts = (): HostFacts => ({
  hostname: os.hostname(),
  machine: machineIdentity(),
  uid: process.getuid!(),
  platform: process.platform,
  arch: process.arch,
});

/**
 * A run belongs to the machine that planned it. The recorded machine identity decides that;
 * the hostname is informational because a rename must not strand the run.
 */
export function sameHost(
  host: InstallPlanV5["host"],
  current: HostFacts,
): boolean {
  return (
    host.machine === current.machine &&
    host.uid === current.uid &&
    host.platform === current.platform &&
    host.arch === current.arch
  );
}

function checkHost(
  plan: InstallPlanV5,
  environment: NodeJS.ProcessEnv,
  problems: Gap[],
): void {
  const uid = process.getuid!();
  if (!sameHost(plan.host, hostFacts()))
    problems.push({ code: "host-mismatch" });
  // Per root. One unusable variable used to abandon the whole resolution, and with it the comparison
  // for every other root — a root that had genuinely moved went unreported whenever an unrelated
  // one could not be parsed. Each root that resolved is compared, and says which it was.
  const inspected = inspectRoots(environment, problems);
  for (const [name, root] of Object.entries(inspected?.roots ?? {})) {
    const recorded = plan.roots[name as RootName];
    if (root.path !== recorded.path || root.variable !== recorded.variable)
      problems.push({ code: "roots-changed", root: name as RootName });
  }
  // Named, like every other root problem: a reader that rests on some roots and not others weighs
  // this one by which root it belongs to.
  for (const [name, root] of Object.entries(plan.roots)) {
    const gap = {
      code: "root-anchor-changed",
      path: root.anchor.path,
      root: name as RootName,
    };
    const anchor = attempt(problems, gap, () =>
      lstatSync(root.anchor.path, { bigint: true }),
    );
    if (
      anchor &&
      (anchor.isSymbolicLink() ||
        !anchor.isDirectory() ||
        String(anchor.dev) !== root.anchor.dev ||
        String(anchor.ino) !== root.anchor.ino)
    ) {
      problems.push(gap);
    }
  }
  const directory = attempt(
    problems,
    { code: "run-directory-invalid", path: plan.run.directory },
    () => lstatSync(plan.run.directory),
  );
  if (
    directory &&
    (directory.isSymbolicLink() ||
      !directory.isDirectory() ||
      directory.uid !== uid)
  )
    problems.push({ code: "run-directory-invalid", path: plan.run.directory });
}

/** Installed content must stay exact; rollback does not depend on it. */
function checkRunContents(
  plan: InstallPlanV5,
  problems: Gap[],
  source = false,
): void {
  if (source) {
    const entries = attempt(
      problems,
      { code: "candidate-changed", path: plan.run.source },
      () =>
        readSourceEntries(
          plan.run.source,
          plan.candidate.entries.map((entry) => entry.path),
        ),
    );
    if (entries && canonicalDigest(entries) !== plan.candidate.sha256)
      problems.push({ code: "candidate-changed", path: plan.run.source });
    for (const target of plan.targets) {
      if (target.kind !== "directory") continue;
      const current = attempt(
        problems,
        { code: "candidate-changed", path: target.source },
        () => readTargetState(target.source),
      );
      if (current && !sameState(current, target.installed))
        problems.push({ code: "candidate-changed", path: target.source });
    }
  }
  for (const file of plan.runtime.files) {
    const bytes = attempt(
      problems,
      { code: "runtime-changed", path: file.path },
      () => readRegularFile(file.path),
    );
    if (bytes && sha256(bytes) !== file.sha256)
      problems.push({ code: "runtime-changed", path: file.path });
  }
}

/** Apply refuses unless every target and missing parent still matches the frozen plan. */
function checkTargets(plan: InstallPlanV5, problems: Gap[]): void {
  const uid = process.getuid!();
  const missing = new Set<string>();
  for (const target of plan.targets) {
    inspectParents(target.path, uid, problems, missing);
    const current = attempt(
      problems,
      { code: "unreadable-target", path: target.path },
      () => readTargetState(target.path),
    );
    if (current && !sameState(current, target.before))
      problems.push({ code: "target-changed", path: target.path });
    if (target.backup) inspectParents(target.backup, uid, problems, new Set());
  }
  if (
    canonicalDigest([...missing].sort(bytewise)) !==
    canonicalDigest(plan.newDirectories)
  )
    problems.push({ code: "directories-changed" });
}

/** An installed target holds the exact file or complete directory. */
function holdsInstalled(state: TargetState, target: InstallTarget): boolean {
  return sameState(state, target.installed);
}

function checkInstalled(plan: InstallPlanV5): Gap[] {
  const problems: Gap[] = [];
  for (const target of plan.targets) {
    const current = attempt(
      problems,
      { code: "unreadable-target", path: target.path },
      () => readTargetState(target.path),
    );
    if (!current) continue;
    if (!holdsInstalled(current, target))
      problems.push({ code: "target-not-installed", path: target.path });
  }
  return problems;
}

/** Coordinates installer commands only; it cannot stop other programs from writing personal configuration. */
function acquireLock(plan: InstallPlanV5, command: string): () => void {
  const lock = path.join(plan.roots.deploy.path, ".install.lock");
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    return refuse(
      (error as NodeJS.ErrnoException).code === "EEXIST"
        ? "install-locked"
        : "lock-create-failed",
      lock,
    );
  }
  const identity = lstatSync(lock);
  const ownerFile = path.join(lock, "owner.json");
  const owner = JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    command,
    run: plan.run.id,
    token: randomUUID(),
  });
  try {
    writeFileSync(ownerFile, owner, { flag: "wx", mode: 0o600 });
  } catch (error) {
    rmdirSync(lock);
    throw error;
  }
  return () => {
    try {
      const current = lstatSync(lock);
      if (
        current.ino === identity.ino &&
        current.dev === identity.dev &&
        readFileSync(ownerFile, "utf8") === owner
      ) {
        unlinkSync(ownerFile);
        rmdirSync(lock);
      }
    } catch {
      /* A lock whose ownership cannot be proven stays for manual inspection. */
    }
  };
}

function writeNewFile(file: string, bytes: Buffer, mode: number): void {
  const descriptor = openSync(
    file,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    try {
      writeFileSync(descriptor, bytes);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    chmodSync(file, mode);
  } catch (error) {
    // O_EXCL proves this call created the entry; a partial file would otherwise block later recovery.
    try {
      unlinkSync(file);
    } catch {
      /* Report the write failure. */
    }
    throw error;
  }
}

function writeReceipt(file: string, receipt: InstallReceiptV5): void {
  receipt.updatedAt = new Date().toISOString();
  const bytes = Buffer.from(
    JSON.stringify(InstallReceiptSchema.parse(receipt), null, 2) + "\n",
  );
  // A unique name keeps a temporary left by a killed process from blocking later receipt writes.
  const temporary = path.join(
    path.dirname(file),
    `.deployment-receipt-${randomUUID()}.tmp`,
  );
  writeNewFile(temporary, bytes, 0o600);
  try {
    renameSync(temporary, file);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      /* Report the rename failure. */
    }
    throw error;
  }
  if (!readFileSync(file).equals(bytes))
    throw new Error("Receipt readback failed");
}

/** The same-parent temporary is named by run and order, so recovery can find one left by an interrupted replacement. */
function temporaryFor(target: InstallTarget, runId: string): string {
  return path.join(
    path.dirname(target.path),
    `.agents-install-${runId}-${target.order}`,
  );
}

function priorFor(target: InstallTarget, runId: string): string {
  return path.join(
    path.dirname(target.path),
    `.agents-prior-${runId}-${target.order}`,
  );
}

function removeEntry(file: string): void {
  const stat = lstatIfExists(file);
  if (!stat) return;
  if (stat.isDirectory()) rmSync(file, { recursive: true });
  else unlinkSync(file);
}

function copyDirectory(source: string, destination: string): void {
  cpSync(source, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
    dereference: false,
    verbatimSymlinks: true,
  });
  const restoreModes = (from: string, to: string) => {
    for (const name of readdirSync(from)) {
      const childFrom = path.join(from, name);
      const childTo = path.join(to, name);
      const stat = lstatSync(childFrom);
      if (stat.isDirectory()) restoreModes(childFrom, childTo);
      else if (stat.isFile()) chmodSync(childTo, stat.mode & 0o7777);
    }
    chmodSync(to, lstatSync(from).mode & 0o7777);
  };
  restoreModes(source, destination);
}

/** Both renames are journalled by the pending step; recovery handles the gap between them. */
function placeTarget(target: InstallTarget, runId: string): void {
  const temporary = temporaryFor(target, runId);
  const prior = priorFor(target, runId);
  if (lstatIfExists(temporary) || lstatIfExists(prior))
    throw new Error(`Installation temporary already exists: ${target.path}`);
  if (target.kind === "directory") copyDirectory(target.source, temporary);
  else {
    const bytes = readRegularFile(target.source);
    writeNewFile(
      temporary,
      bytes,
      target.installed.type === "file" ? target.installed.mode : 0o600,
    );
  }
  if (!sameState(readTargetState(temporary), target.installed))
    throw new Error(`Staged target differs: ${target.path}`);
  if (target.before.type !== "absent") renameSync(target.path, prior);
  renameSync(temporary, target.path);
}

function backupFile(target: InstallTarget): NonNullable<Step["backup"]> {
  const before = target.before;
  if ((before.type !== "file" && before.type !== "directory") || !target.backup)
    throw new Error(`Only files and directories are backed up: ${target.path}`);
  mkdirSync(path.dirname(target.backup), { recursive: true, mode: 0o700 });
  if (!sameState(readTargetState(target.path), before))
    throw new Error(`Target changed before backup: ${target.path}`);
  if (before.type === "directory") copyDirectory(target.path, target.backup);
  else writeNewFile(target.backup, readRegularFile(target.path), before.mode);
  if (!sameState(readTargetState(target.backup), before))
    throw new Error(`Backup readback failed: ${target.backup}`);
  return { path: target.backup, sha256: before.sha256, mode: before.mode };
}

/** Content and a predictable path cannot prove who created a leftover temporary. */
function temporaryIsAbsent(temporary: string): boolean {
  try {
    return readTargetState(temporary).type === "absent";
  } catch {
    return false;
  }
}

/** Restore only a target that still holds what this installation wrote; any other content is retained. */
function restoreTarget(
  target: InstallTarget,
  step: Step,
  runId: string,
): Step["phase"] {
  const temporary = temporaryFor(target, runId);
  const prior = priorFor(target, runId);
  const temporaryAbsent = temporaryIsAbsent(temporary);
  let current: TargetState;
  try {
    current = readTargetState(target.path);
  } catch {
    return "conflict-retained";
  }
  let priorState: TargetState;
  try {
    priorState = readTargetState(prior);
  } catch {
    return "conflict-retained";
  }
  if (!temporaryAbsent) {
    if (
      current.type === "absent" &&
      target.before.type !== "absent" &&
      sameState(priorState, target.before)
    ) {
      try {
        renameSync(prior, target.path);
      } catch {
        return "conflict-retained";
      }
    }
    return "conflict-retained";
  }
  if (sameState(current, target.before)) {
    if (priorState.type !== "absent") return "conflict-retained";
    return "not-applied";
  }
  if (current.type !== "absent" && !holdsInstalled(current, target))
    return "conflict-retained";
  if (priorState.type !== "absent" && !sameState(priorState, target.before))
    return "conflict-retained";
  try {
    const before = target.before;
    if (before.type === "absent") {
      if (current.type !== "absent") removeEntry(target.path);
    } else {
      if (priorState.type === "absent") {
        if (before.type === "link") symlinkSync(before.value, temporary);
        else if (step.backup) {
          if (!sameState(readTargetState(step.backup.path), before))
            return "conflict-retained";
          if (before.type === "directory")
            copyDirectory(step.backup.path, temporary);
          else
            writeNewFile(
              temporary,
              readRegularFile(step.backup.path),
              before.mode,
            );
        } else return "conflict-retained";
        if (!sameState(readTargetState(temporary), before))
          return "conflict-retained";
      }
      if (current.type !== "absent") {
        if (priorState.type === "absent") renameSync(target.path, prior);
        else renameSync(target.path, temporary);
      }
      renameSync(priorState.type === "absent" ? temporary : prior, target.path);
      const displaced = priorState.type === "absent" ? prior : temporary;
      if (lstatIfExists(displaced)) {
        if (!sameState(readTargetState(displaced), target.installed))
          return "conflict-retained";
        removeEntry(displaced);
      }
    }
    return sameState(readTargetState(target.path), target.before)
      ? "restored"
      : "conflict-retained";
  } catch {
    return "conflict-retained";
  }
}

/** Reverse-order conditional recovery shared by failed applies, interrupted runs and rollback. */
function restoreChanges(
  plan: InstallPlanV5,
  receipt: InstallReceiptV5,
  record: () => void,
): void {
  for (const step of [...receipt.steps].reverse()) {
    step.phase = restoreTarget(plan.targets[step.order]!, step, plan.run.id);
    try {
      record();
    } catch {
      /* Continue recovering; the final write reports a lost record. */
    }
  }
  for (const directory of [...receipt.directories].reverse()) {
    if (directory.phase === "removed" || directory.phase === "not-created")
      continue;
    let stat;
    try {
      stat = lstatIfExists(directory.path);
    } catch {
      if (directory.phase === "created") directory.phase = "retained";
      continue;
    }
    if (directory.phase === "pending") {
      // This run never recorded creating it, so an existing one may belong to another writer and stays pending on every run.
      if (!stat) directory.phase = "not-created";
    } else if (!stat) directory.phase = "removed";
    else if (stat.isSymbolicLink() || !stat.isDirectory())
      directory.phase = "retained";
    else {
      try {
        rmdirSync(directory.path);
        directory.phase = "removed";
      } catch {
        directory.phase = "retained";
      }
    }
  }
}

/**
 * Recovery is incomplete while a step is unrestored or a created directory is kept by other content, so a
 * later rollback stays allowed. A directory kept only by pending directories is not a retry case: those are
 * never removed and are reported for manual review instead.
 */
function recoveryIncomplete(
  plan: InstallPlanV5,
  receipt: InstallReceiptV5,
): boolean {
  for (const target of plan.targets) {
    try {
      if (!sameState(readTargetState(target.path), target.before)) return true;
      if (!temporaryIsAbsent(temporaryFor(target, plan.run.id))) return true;
    } catch {
      return true;
    }
  }
  for (const directory of plan.newDirectories) {
    if (receipt.directories.some((entry) => entry.path === directory)) continue;
    try {
      if (lstatIfExists(directory)) return true;
    } catch {
      return true;
    }
  }
  if (
    receipt.steps.some(
      (step) => step.phase !== "restored" && step.phase !== "not-applied",
    )
  )
    return true;
  const phases = new Map(
    receipt.directories.map((directory) => [directory.path, directory.phase]),
  );
  const heldByPending = (directory: string): boolean => {
    try {
      if (!lstatSync(directory).isDirectory()) return false;
      // An empty directory that could not be removed is not held by anything and must stay retryable.
      const children = readdirSync(directory);
      return (
        children.length > 0 &&
        children.every((name) => {
          const child = path.join(directory, name);
          return (
            phases.get(child) === "pending" ||
            (phases.get(child) === "retained" && heldByPending(child))
          );
        })
      );
    } catch {
      return false;
    }
  };
  return receipt.directories.some(
    (directory) =>
      directory.phase === "retained" && !heldByPending(directory.path),
  );
}

function summarize(plan: InstallPlanV5, receipt: InstallReceiptV5) {
  const steps = (phase: Step["phase"]) =>
    receipt.steps.filter((step) => step.phase === phase).length;
  const directories = (
    phase: InstallReceiptV5["directories"][number]["phase"],
  ) =>
    receipt.directories.filter((directory) => directory.phase === phase).length;
  return {
    status: receipt.status,
    run: plan.run.id,
    receipt: plan.run.receipt,
    steps: {
      applied: steps("applied"),
      pending: steps("pending"),
      restored: steps("restored"),
      notApplied: steps("not-applied"),
      conflicts: steps("conflict-retained"),
    },
    directories: {
      created: directories("created"),
      pending: directories("pending"),
      removed: directories("removed"),
      retained: directories("retained"),
    },
    errors: receipt.errors,
    recovery: [
      receipt.runtime.node,
      receipt.runtime.installer,
      "rollback",
      "--receipt",
      plan.run.receipt,
    ],
  };
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown failure";

export function applyInstallPlan(
  planFile: string,
  environment: NodeJS.ProcessEnv,
) {
  const plan = loadPlanForApply(planFile);
  const release = acquireLock(plan, "apply");
  try {
    const problems: Gap[] = [];
    if (
      attempt(
        problems,
        { code: "unreadable-receipt", path: plan.run.receipt },
        () => lstatIfExists(plan.run.receipt),
      )
    ) {
      problems.push({ code: "receipt-exists", path: plan.run.receipt });
    }
    checkHost(plan, environment, problems);
    checkRunContents(plan, problems, true);
    checkTargets(plan, problems);
    if (problems.length) throw new InstallRefused(problems);
    const now = new Date().toISOString();
    const receipt: InstallReceiptV5 = {
      version: 5,
      plan: { path: plan.run.plan, sha256: plan.sha256 },
      run: { id: plan.run.id, directory: plan.run.directory },
      runtime: runtimeOf(plan),
      status: "applying",
      startedAt: now,
      updatedAt: now,
      directories: [],
      steps: [],
      errors: [],
    };
    const record = () => writeReceipt(plan.run.receipt, receipt);
    // Without a written receipt nothing may change.
    record();
    try {
      for (const directory of plan.newDirectories) {
        const entry: InstallReceiptV5["directories"][number] = {
          path: directory,
          phase: "pending",
        };
        receipt.directories.push(entry);
        record();
        mkdirSync(directory, { mode: 0o700 });
        entry.phase = "created";
        record();
      }
      for (const target of plan.targets) {
        if (!sameState(readTargetState(target.path), target.before))
          throw new Error(`Target changed during apply: ${target.path}`);
        if (target.action === "unchanged") continue;
        // Planned parents exist by now; a missing, linked or shared-writable one means another writer intervened.
        const ancestors: Gap[] = [];
        const missing = new Set<string>();
        inspectParents(target.path, process.getuid!(), ancestors, missing);
        if (ancestors.length || missing.size)
          throw new Error(
            `Target ancestors changed during apply: ${target.path}`,
          );
        const step: Step = {
          order: target.order,
          phase: "pending",
          backup: target.backup ? backupFile(target) : null,
        };
        receipt.steps.push(step);
        record();
        placeTarget(target, plan.run.id);
        if (!holdsInstalled(readTargetState(target.path), target))
          throw new Error(`Target readback failed: ${target.path}`);
        step.phase = "applied";
        record();
        const prior = priorFor(target, plan.run.id);
        if (lstatIfExists(prior)) {
          if (!sameState(readTargetState(prior), target.before))
            throw new Error(`Displaced target changed: ${target.path}`);
          removeEntry(prior);
        }
      }
      const installed = checkInstalled(plan);
      if (installed.length)
        throw new Error(
          `Installed readback failed: ${installed.map((problem) => problem.path ?? problem.code).join(", ")}`,
        );
      receipt.status = "installed";
      record();
    } catch (error) {
      receipt.errors.push(message(error));
      restoreChanges(plan, receipt, record);
      receipt.status = recoveryIncomplete(plan, receipt)
        ? "failed-incomplete"
        : "failed-rolled-back";
      try {
        record();
      } catch (recordError) {
        receipt.errors.push(
          `Final receipt write failed: ${message(recordError)}`,
        );
      }
    }
    return summarize(plan, receipt);
  } finally {
    release();
  }
}

export function verifyInstallation(
  receiptFile: string,
  environment: NodeJS.ProcessEnv,
) {
  const { receipt, plan } = loadReceipt(receiptFile);
  const problems: Gap[] = [];
  checkHost(plan, environment, problems);
  checkRunContents(plan, problems);
  if (receipt.status === "installed") {
    problems.push(...checkInstalled(plan));
  } else if (
    receipt.status === "rolled-back" ||
    receipt.status === "failed-rolled-back"
  ) {
    for (const target of plan.targets) {
      const current = attempt(
        problems,
        { code: "unreadable-target", path: target.path },
        () => readTargetState(target.path),
      );
      if (current && !sameState(current, target.before))
        problems.push({ code: "target-not-restored", path: target.path });
    }
  } else problems.push({ code: "status-not-verifiable", key: receipt.status });
  const unique = [
    ...new Map(
      problems.map((problem) => [JSON.stringify(problem), problem]),
    ).values(),
  ];
  // A rename no longer invalidates the run, so report it where a reader would otherwise see no trace of it.
  const renamed =
    plan.host.hostname !== os.hostname()
      ? { recorded: plan.host.hostname, current: os.hostname() }
      : undefined;
  return {
    status: receipt.status,
    verified: unique.length === 0,
    run: plan.run.id,
    receipt: plan.run.receipt,
    ...(renamed ? { hostname: renamed } : {}),
    problems: unique,
  };
}

export function rollbackInstallation(
  receiptFile: string,
  environment: NodeJS.ProcessEnv,
) {
  const { receipt, plan } = loadReceipt(receiptFile);
  if (
    receipt.status === "rolled-back" ||
    receipt.status === "failed-rolled-back"
  )
    refuse("rollback-not-applicable", plan.run.receipt);
  const release = acquireLock(plan, "rollback");
  try {
    const problems: Gap[] = [];
    checkHost(plan, environment, problems);
    if (problems.length) throw new InstallRefused(problems);
    const record = () => writeReceipt(plan.run.receipt, receipt);
    receipt.status = "rolling-back";
    record();
    restoreChanges(plan, receipt, record);
    receipt.status = recoveryIncomplete(plan, receipt)
      ? "rollback-incomplete"
      : "rolled-back";
    try {
      record();
    } catch (recordError) {
      receipt.errors.push(
        `Final receipt write failed: ${message(recordError)}`,
      );
    }
    return summarize(plan, receipt);
  } finally {
    release();
  }
}
