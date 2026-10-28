// Contract subject: `agents-installer`.
// - Read [contract](../delivery/policy/tool-contracts.md). Use tool `git`.
// - Read [runtime contract](check.ts). Use tool `node`.
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CheckReportSchema } from "./check-report.ts";
import type { CheckReportV1 } from "./check-report.ts";
import {
  applyInstallPlan,
  InstallRefused,
  loadPlanForApply,
  loadReceipt,
  RecordVersionError,
  rollbackInstallation,
  runtimeOf,
  verifyInstallation,
} from "./install-apply.ts";
import { readCurrentInstallation } from "./install-current.ts";
import {
  adoptKeyPattern,
  InstallPlanSchema,
  installPathCollisions,
  runtimeFiles,
} from "./install-records.ts";
import type {
  InstallPlanV5,
  InstallReceiptV5,
  InstallRoots,
  InstallTarget,
  RuntimeRecord,
} from "./install-records.ts";
import {
  attempt,
  bytewise,
  foreignOwnedMember,
  inside,
  inspectParents,
  inspectTarget,
  lstatIfExists,
  machineIdentity,
  physicalInstallPath,
  readCopiedTargetState,
  readTargetState,
  resolveInstallRoots,
  sameState,
  sha256,
} from "./install-state.ts";
import type { Gap } from "./install-state.ts";
import { readSkillEntries } from "./skills.ts";
import type { SkillEntry } from "./skills.ts";
import { publicMembers } from "./delivery.ts";
import {
  canonicalDigest,
  listSourcePaths,
  readSourceEntries,
} from "./source.ts";
import type { SourceEntry } from "./source.ts";

const closureCheck = "Installer build closure";
const usage = [
  "Usage: install.sh plan --source DIR --report FILE --output PLAN [--adopt KEY]...",
  "       install.sh apply --plan PLAN",
  "       install.sh verify --receipt RECEIPT",
  "       install.sh rollback --receipt RECEIPT",
  "       install.sh status",
].join("\n");

class UsageError extends Error {}
class PlanBlocked extends Error {
  gaps: Gap[];
  constructor(gaps: Gap[]) {
    super("Installation plan is blocked");
    this.gaps = [
      ...new Map(gaps.map((gap) => [JSON.stringify(gap), gap])).values(),
    ];
  }
}

type PlanArguments = {
  source: string;
  report: string;
  output: string;
  adopt: string[];
};

export function parsePlanArguments(args: string[]): PlanArguments {
  const options: Record<string, string> = {
    "--source": "source",
    "--report": "report",
    "--output": "output",
  };
  const values = new Map<string, string>();
  const adopt: string[] = [];
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]!;
    const value = args[index + 1];
    if (name !== "--adopt" && !Object.hasOwn(options, name))
      throw new UsageError(`Unknown argument: ${name}`);
    if (value === undefined || value === "" || value.startsWith("--"))
      throw new UsageError(`Missing value: ${name}`);
    if (name === "--adopt") {
      if (!adoptKeyPattern.test(value) || adopt.includes(value))
        throw new UsageError(`Invalid or repeated adopted name: ${value}`);
      adopt.push(value);
    } else {
      if (values.has(options[name]!))
        throw new UsageError(`Repeated argument: ${name}`);
      values.set(options[name]!, value);
    }
  }
  for (const name of ["source", "report", "output"])
    if (!values.has(name)) throw new UsageError(`Missing --${name}`);
  const resolved = (name: string) => path.resolve(values.get(name)!);
  return {
    source: resolved("source"),
    report: resolved("report"),
    output: resolved("output"),
    adopt: adopt.sort(bytewise),
  };
}

function git(directory: string, args: string[]): string {
  // Repository-selection variables could redirect identity reads to another checkout.
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );
  return execFileSync("git", ["-C", directory, ...args], {
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Unusable reports are gaps, so they are reported together with root problems found earlier. */
function readReport(
  file: string,
  gaps: Gap[],
):
  | {
      report: CheckReportV1 & { source: NonNullable<CheckReportV1["source"]> };
      path: string;
      sha256: string;
    }
  | undefined {
  let physical = file;
  let bytes: Buffer;
  try {
    physical = realpathSync(file);
    if (!lstatSync(physical).isFile())
      throw new Error("The check report must be a regular file");
    bytes = readFileSync(physical);
  } catch {
    gaps.push({ code: "report-unreadable", path: physical });
    return undefined;
  }
  let report: CheckReportV1;
  try {
    report = CheckReportSchema.parse(JSON.parse(bytes.toString("utf8")));
  } catch {
    gaps.push({ code: "report-invalid", path: physical });
    return undefined;
  }
  if (!report.passed || !report.source) {
    gaps.push({ code: "report-not-passing", path: physical });
    return undefined;
  }
  if (
    !["repository", "ci", "docs"].every((group) =>
      report.groups.includes(group as "repository"),
    )
  )
    gaps.push({ code: "report-incomplete-groups" });
  if (
    report.platform.os !== process.platform ||
    report.platform.arch !== process.arch ||
    report.platform.node !== process.versions.node
  ) {
    gaps.push({ code: "report-platform-mismatch" });
  }
  if (
    !report.results.some(
      (result) => result.name === closureCheck && result.passed,
    )
  )
    gaps.push({ code: "report-installer-closure-missing" });
  return {
    report: report as CheckReportV1 & {
      source: NonNullable<CheckReportV1["source"]>;
    },
    path: physical,
    sha256: sha256(bytes),
  };
}

/** Exclude tool and dependency inputs from the frozen installation candidate. */
function isCandidateSource(file: string): boolean {
  return (
    !file.startsWith("node_modules/") &&
    !file.startsWith(".cache/") &&
    !/(^|\/)target\//.test(file)
  );
}

/** Recompute the checked identity; the report also covers uncommitted source. */
function verifyCheckout(
  directory: string,
  source: NonNullable<CheckReportV1["source"]>,
  gaps: Gap[],
): { directory: string; commit: string } | undefined {
  const repository = attempt(
    gaps,
    { code: "source-not-repository", path: directory },
    () => ({
      commit: git(directory, ["rev-parse", "--verify", "HEAD"]).trim(),
      top: realpathSync(
        git(directory, ["rev-parse", "--show-toplevel"]).trim(),
      ),
      present: listSourcePaths(directory),
    }),
  );
  if (!repository) return undefined;
  const { commit } = repository;
  if (repository.top !== directory)
    gaps.push({ code: "source-not-repository-root", path: directory });
  if (commit !== source.baseline)
    gaps.push({ code: "source-baseline-mismatch" });
  const covered = new Set(source.entries.map((entry) => entry.path));
  if (repository.present.some((file) => !covered.has(file)))
    gaps.push({ code: "source-coverage-missing" });
  const present = new Set(repository.present);
  for (const entry of source.entries)
    if (isCandidateSource(entry.path) && !present.has(entry.path))
      gaps.push({
        code: "source-coverage-missing",
        path: path.join(directory, entry.path),
      });
  try {
    const entries = readSourceEntries(directory, [...covered]);
    if (
      canonicalDigest({ version: 1, baseline: source.baseline, entries }) !==
      source.sha256
    )
      gaps.push({ code: "source-identity-mismatch" });
  } catch {
    gaps.push({ code: "source-identity-mismatch" });
  }
  return { directory, commit };
}

type TargetDraft = Omit<
  InstallTarget,
  "order" | "before" | "action" | "adopted" | "backup" | "installed"
> & { relativeSource: string };

/** Derive every target from fixed categories and the checked manifest; nested entries are not installed. */
function deriveTargets(
  roots: InstallRoots,
  snapshot: string,
  entries: SkillEntry[],
): TargetDraft[] {
  const drafts: TargetDraft[] = [];
  for (const member of publicMembers(entries)) {
    // A skill's key is its top-level name; a fixed document's key is its published relative path.
    const key =
      member.category === "skill"
        ? path.basename(member.relative)
        : member.relative;
    drafts.push({
      kind: member.category === "skill" ? "directory" : "file",
      category: member.category,
      product: member.product,
      key: `${member.product}:${key}`,
      path: path.join(roots[member.product].path, member.relative),
      source: path.join(snapshot, member.source),
      relativeSource: member.source,
    });
  }
  return drafts;
}

/** A published directory must contain only members frozen into the candidate. */
function inspectDirectorySources(
  drafts: TargetDraft[],
  checkout: string,
  candidate: SourceEntry[],
  gaps: Gap[],
): void {
  const files = new Set(candidate.map((entry) => entry.path));
  const directories = new Set<string>();
  for (const file of files) {
    const parts = file.split("/");
    for (let index = 1; index < parts.length; index++)
      directories.add(parts.slice(0, index).join("/"));
  }
  const visit = (relative: string) => {
    const directory = path.join(checkout, relative);
    const names = attempt(
      gaps,
      { code: "source-unreadable", path: directory },
      () => readdirSync(directory),
    );
    if (!names) return;
    for (const name of names) {
      const member = `${relative}/${name}`;
      const file = path.join(checkout, member);
      const stat = attempt(
        gaps,
        { code: "source-unreadable", path: file },
        () => lstatSync(file),
      );
      if (!stat) continue;
      if (stat.isDirectory() && directories.has(member)) visit(member);
      else if (!stat.isDirectory() && files.has(member)) continue;
      else gaps.push({ code: "source-coverage-missing", path: file });
    }
  };
  for (const draft of drafts)
    if (draft.kind === "directory") visit(draft.relativeSource);
}

function classifyTargets(
  drafts: TargetDraft[],
  adopt: string[],
  backupRun: string,
  checkout: string,
  uid: number,
  gaps: Gap[],
  missing: Set<string>,
): InstallTarget[] {
  const adoptable = new Set<string>();
  const unclassified = new Set<string>();
  const targets = drafts.flatMap((draft, order): InstallTarget[] => {
    inspectParents(draft.path, uid, gaps, missing);
    const before = inspectTarget(draft.path, gaps);
    if (!before) {
      unclassified.add(draft.key);
      return [];
    }
    if (before.type === "file" || before.type === "directory") {
      const foreign = attempt(
        gaps,
        { code: "unreadable-target", path: draft.path },
        () => foreignOwnedMember(draft.path, uid),
      );
      if (foreign)
        gaps.push({ code: "backup-owner-unrestorable", path: foreign });
    }
    const source = path.join(checkout, draft.relativeSource);
    const installed = attempt(
      gaps,
      { code: "source-unreadable", path: source },
      () => readCopiedTargetState(source, uid),
    );
    if (!installed) {
      unclassified.add(draft.key);
      return [];
    }
    if (installed.type !== draft.kind) {
      gaps.push({ code: "source-invalid-target", path: source });
      unclassified.add(draft.key);
      return [];
    }
    const backup =
      before.type === "file" || before.type === "directory"
        ? path.join(backupRun, String(order))
        : null;
    let action: InstallTarget["action"] = "replace";
    let needsAdoption = false;
    if (before.type === "absent") action = "create";
    else if (sameState(before, installed)) action = "unchanged";
    else needsAdoption = true;
    if (needsAdoption) {
      adoptable.add(draft.key);
      if (!adopt.includes(draft.key))
        gaps.push({ code: "adopt-required", path: draft.path, key: draft.key });
    }
    return [
      {
        order,
        kind: draft.kind,
        category: draft.category,
        product: draft.product,
        key: draft.key,
        path: draft.path,
        source: draft.source,
        installed,
        before,
        action,
        adopted: needsAdoption && adopt.includes(draft.key),
        backup,
      },
    ];
  });
  for (const key of adopt)
    if (!adoptable.has(key) && !unclassified.has(key))
      gaps.push({ code: "adopt-unused", key });
  return targets;
}

/** Report unlisted names without claiming them. */
function inspectUnlisted(
  roots: InstallRoots,
  entries: SkillEntry[],
  gaps: Gap[],
): string[] {
  const reported: string[] = [];
  const report = (file: string) => reported.push(file);
  const list = (directory: string) =>
    attempt(gaps, { code: "unreadable-target", path: directory }, () =>
      lstatIfExists(directory)?.isDirectory()
        ? readdirSync(directory).sort(bytewise)
        : [],
    ) ?? [];
  for (const product of ["codex", "claude"] as const) {
    const layout = publicMembers(entries, product);
    const members = new Set(
      layout
        .filter((member) => member.category === "skill")
        .map((member) => path.basename(member.relative)),
    );
    const skillDirectory = path.join(roots[product].path, "skills");
    for (const name of list(skillDirectory))
      if (!members.has(name)) report(path.join(skillDirectory, name));
    // A published name may carry a directory, and a directory on the way to one is walked rather
    // than reported. Every fixed list is flat today, so this path is unexercised; it stays because
    // the alternative is a category that silently reports its own subdirectory as an unlisted name.
    const fixed = (relative: string, names: string[]) => {
      const directories = new Set([""]);
      for (const name of names)
        if (name.includes("/"))
          directories.add(name.slice(0, name.lastIndexOf("/")));
      for (const directory of [...directories].sort(bytewise)) {
        const where = path.join(roots[product].path, relative, directory);
        for (const name of list(where)) {
          const member = directory ? `${directory}/${name}` : name;
          if (!names.includes(member) && !directories.has(member))
            report(path.join(where, name));
        }
      }
    };
    for (const directory of [
      "policy",
      "tools",
      ...(product === "codex" ? ["capability"] : []),
    ])
      fixed(
        directory,
        layout
          .filter((member) => member.relative.startsWith(`${directory}/`))
          .map((member) => member.relative.slice(directory.length + 1)),
      );
  }
  return reported;
}

function writeNewFile(
  file: string,
  bytes: Buffer,
  mode: number,
  created: () => void,
): void {
  const descriptor = openSync(
    file,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  created();
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(file, mode);
}

function copyEntry(
  root: string,
  entry: SourceEntry,
  destination: string,
  mode: number,
): void {
  const descriptor = openSync(
    path.join(root, entry.path),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  let bytes: Buffer;
  try {
    bytes = readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256)
    throw new Error(`Checked input changed: ${entry.path}`);
  mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  writeNewFile(destination, bytes, mode, () => {});
}

const probeEnvironment = { PATH: "/usr/bin:/bin", LANG: "C" };

/** A bundle copy must reject a missing argument by itself, without reaching the checkout or its dependencies. */
function probeStandalone(node: string, bundle: string): void {
  const result = spawnSync(node, [bundle], {
    cwd: path.dirname(bundle),
    env: probeEnvironment,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (
    result.status !== 2 ||
    /ERR_MODULE_NOT_FOUND|Cannot find/.test(result.stderr)
  )
    throw new Error(
      `Runtime bundle copy is not standalone: ${path.basename(bundle)}`,
    );
}

/** Copy the checked Node and installer bundle, then prove they run without the checkout or its dependencies. */
function prepareRuntime(
  checkout: string,
  inputs: {
    role: string;
    source: string;
    name: string;
    mode: number;
    entry: SourceEntry;
  }[],
  directory: string,
  platform: CheckReportV1["platform"],
): RuntimeRecord {
  mkdirSync(directory, { mode: 0o700 });
  const files = inputs.map((input) => {
    const destination = path.join(directory, input.name);
    copyEntry(checkout, input.entry, destination, input.mode);
    return {
      role: input.role,
      path: destination,
      source: input.source,
      mode: input.mode,
      sha256: input.entry.sha256,
    };
  });
  const node = path.join(directory, "node");
  const version = spawnSync(node, ["--version"], {
    cwd: directory,
    env: probeEnvironment,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (version.status !== 0 || version.stdout.trim() !== `v${platform.node}`)
    throw new Error("Runtime Node copy failed its version probe");
  probeStandalone(node, path.join(directory, "install.mjs"));
  return {
    platform: platform.os as RuntimeRecord["platform"],
    arch: platform.arch,
    node: platform.node,
    files,
  };
}

/** Build the private candidate and runtime; public delivery targets are only read. */
export function planInstallation(
  args: PlanArguments,
  environment: NodeJS.ProcessEnv,
  identity = machineIdentity,
) {
  if (process.platform !== "darwin" && process.platform !== "linux")
    throw new Error("Unsupported platform");
  const uid = process.getuid!();
  const gaps: Gap[] = [];
  const block = () => {
    if (gaps.length) throw new PlanBlocked(gaps);
  };
  // Without this identity a later apply, verify or rollback could not prove it runs on the machine that planned.
  const machine = identity();
  if (machine === undefined)
    gaps.push({ code: "machine-identity-unavailable" });
  const source = attempt(
    gaps,
    { code: "source-unreadable", path: args.source },
    () => realpathSync(args.source),
  );
  const entries =
    source === undefined
      ? undefined
      : attempt(gaps, { code: "source-manifest-invalid", path: source }, () =>
          readSkillEntries(source),
        );
  const roots = resolveInstallRoots(environment, gaps);
  const report = readReport(args.report, gaps);
  if (!source || !entries || !roots || !report) throw new PlanBlocked(gaps);
  block();
  const checkout = verifyCheckout(source, report.report.source, gaps);
  if (!checkout) throw new PlanBlocked(gaps);
  block();
  const byPath = new Map(
    report.report.source.entries.map((entry) => [entry.path, entry]),
  );
  const candidate = report.report.source.entries.filter((entry) =>
    isCandidateSource(entry.path),
  );
  const inputs = runtimeFiles.map((file) => ({
    ...file,
    entry: byPath.get(file.source)!,
  }));
  for (const input of inputs)
    if (!input.entry)
      gaps.push({ code: "report-runtime-input-missing", path: input.source });

  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[-:.]/g, "")}-${checkout.commit.slice(0, 12)}`;
  const directory = path.join(roots.deploy.path, id);
  const privateRun = path.join(roots.codex.path, ".agents-install", id);
  const run = {
    id,
    directory,
    plan: path.join(directory, "deployment-plan.json"),
    receipt: path.join(directory, "deployment-receipt.json"),
    source: path.join(privateRun, "source"),
    runtime: path.join(privateRun, "runtime"),
  };
  const drafts = deriveTargets(roots, run.source, entries);
  for (const draft of drafts) {
    if (!candidate.some((entry) => inside(draft.relativeSource, entry.path)))
      gaps.push({
        code: "candidate-source-missing",
        path: draft.relativeSource,
      });
  }
  inspectDirectorySources(drafts, checkout.directory, candidate, gaps);
  const newDirectories = new Set<string>();
  const targets = classifyTargets(
    drafts,
    args.adopt,
    path.join(roots.backup.path, id),
    checkout.directory,
    uid,
    gaps,
    newDirectories,
  );
  const reported = inspectUnlisted(roots, entries, gaps);

  const outputDirectories = new Set<string>();
  inspectParents(run.directory, uid, gaps, outputDirectories);
  inspectParents(privateRun, uid, gaps, outputDirectories);
  if (lstatIfExists(privateRun))
    gaps.push({ code: "private-run-exists", path: privateRun });
  inspectParents(path.join(roots.backup.path, id), uid, gaps, new Set());
  const outputParents = new Set<string>();
  inspectParents(args.output, uid, gaps, outputParents);
  if (outputParents.size)
    gaps.push({
      code: "output-parent-missing",
      path: path.dirname(args.output),
    });
  if (
    attempt(
      gaps,
      { code: "unreadable-ancestor", path: path.dirname(args.output) },
      () => lstatIfExists(args.output),
    )
  ) {
    gaps.push({ code: "output-exists", path: args.output });
  }
  const protectedRoots = [
    roots.deploy.path,
    roots.backup.path,
    checkout.directory,
    args.output,
  ];
  const checkCollisions = () => {
    const collisions = attempt(gaps, { code: "unreadable-ancestor" }, () =>
      installPathCollisions(
        {
          roots,
          checkout,
          review: args.output,
          run,
          targets,
        },
        physicalInstallPath,
      ),
    );
    for (const collision of collisions ?? [])
      gaps.push({ code: "path-collision", path: collision });
  };
  checkCollisions();
  if (
    protectedRoots.some(
      (other) => inside(privateRun, other) || inside(other, privateRun),
    )
  )
    gaps.push({ code: "path-collision", path: privateRun });
  if (new Set(targets.map((target) => target.path)).size !== targets.length)
    gaps.push({ code: "path-collision" });
  for (const target of targets) {
    if (
      protectedRoots.some(
        (other) => inside(target.path, other) || inside(other, target.path),
      )
    )
      gaps.push({ code: "path-collision", path: target.path });
  }
  for (const other of [roots.deploy.path, roots.backup.path, args.output]) {
    if (inside(checkout.directory, other))
      gaps.push({ code: "path-collision", path: other });
  }
  // Runs, backups and the review copy must not share or nest inside each other's areas.
  for (const [first, second] of [
    [roots.deploy.path, roots.backup.path],
    [roots.deploy.path, args.output],
    [roots.backup.path, args.output],
  ] as const) {
    if (inside(first, second) || inside(second, first))
      gaps.push({ code: "path-collision", path: second });
  }
  block();

  // Initial checks precede writes; preparation stays inside plan-owned outputs.
  let runCreated = false;
  let privateCreated = false;
  let reviewCreated = false;
  const createdParents: string[] = [];
  try {
    for (const parent of [...outputDirectories].sort(bytewise)) {
      mkdirSync(parent, { mode: 0o700 });
      createdParents.push(parent);
    }
    mkdirSync(run.directory, { mode: 0o700 });
    runCreated = true;
    mkdirSync(privateRun, { mode: 0o700 });
    privateCreated = true;
    // New roots now have physical identities; case aliases may not have existed at preflight.
    checkCollisions();
    block();
    for (const entry of candidate)
      copyEntry(
        checkout.directory,
        entry,
        path.join(run.source, entry.path),
        entry.mode,
      );
    const sourceDirectories = new Set(
      candidate.flatMap((entry) => {
        const parts = entry.path.split("/");
        return parts
          .slice(0, -1)
          .map((_, index) => parts.slice(0, index + 1).join("/"));
      }),
    );
    for (const relative of [...sourceDirectories].sort(bytewise)) {
      const mode =
        lstatSync(path.join(checkout.directory, relative)).mode & 0o7777;
      chmodSync(path.join(run.source, relative), mode);
    }
    if (
      canonicalDigest(
        readSourceEntries(
          run.source,
          candidate.map((entry) => entry.path),
        ),
      ) !== canonicalDigest(candidate) ||
      canonicalDigest(readSkillEntries(run.source)) !== canonicalDigest(entries)
    )
      throw new Error("Candidate snapshot differs from the checked source");
    for (const target of targets)
      if (!sameState(target.installed, readTargetState(target.source)))
        throw new Error(`Candidate target differs: ${target.key}`);
    const runtime = prepareRuntime(
      checkout.directory,
      inputs,
      run.runtime,
      report.report.platform,
    );
    const body = {
      version: 5,
      createdAt,
      run,
      review: args.output,
      host: {
        hostname: os.hostname(),
        machine,
        uid,
        platform: process.platform,
        arch: process.arch,
      },
      roots,
      checkout: { directory: checkout.directory, commit: checkout.commit },
      report: {
        path: report.path,
        sha256: report.sha256,
        source: report.report.source.sha256,
      },
      candidate: { entries: candidate, sha256: canonicalDigest(candidate) },
      runtime,
      adopt: args.adopt,
      newDirectories: [...newDirectories]
        .filter((directory) => !lstatIfExists(directory))
        .sort(bytewise),
      targets,
      reported,
    };
    const plan = InstallPlanSchema.parse({
      ...body,
      sha256: canonicalDigest(body),
    });
    const bytes = Buffer.from(JSON.stringify(plan, null, 2) + "\n");
    writeNewFile(run.plan, bytes, 0o400, () => {});
    if (!readFileSync(run.plan).equals(bytes))
      throw new Error("Persistent plan readback failed");
    writeNewFile(args.output, bytes, 0o600, () => {
      reviewCreated = true;
    });
    if (!readFileSync(args.output).equals(bytes))
      throw new Error("Review plan readback failed");
    const count = (action: InstallTarget["action"]) =>
      targets.filter((target) => target.action === action).length;
    return {
      status: "planned",
      run: id,
      plan: run.plan,
      review: args.output,
      sha256: plan.sha256,
      targets: {
        create: count("create"),
        replace: count("replace"),
        unchanged: count("unchanged"),
      },
      adopted: args.adopt,
      reported: reported.length,
    };
  } catch (error) {
    // Only outputs created by this invocation are removed; public targets were never written.
    if (reviewCreated) rmSync(args.output, { force: true });
    if (runCreated) rmSync(run.directory, { recursive: true, force: true });
    if (privateCreated) rmSync(privateRun, { recursive: true, force: true });
    // Empty-only removal keeps a parent that another invocation has started to use.
    for (const parent of createdParents.reverse()) {
      try {
        rmdirSync(parent);
      } catch {
        break;
      }
    }
    throw error;
  }
}

/**
 * Repository entries delegate to the persistent copy bound by the plan or receipt; that copy runs only
 * when both its executing Node and its own bundle are the exact bound files.
 */
function runFromRuntime(
  runtime: InstallReceiptV5["runtime"],
  argv: string[],
): number | undefined {
  const problems: { code: string; path: string }[] = [];
  for (const [file, digest] of [
    [runtime.node, runtime.nodeSha256],
    [runtime.installer, runtime.installerSha256],
  ] as const) {
    try {
      const stat = lstatSync(file);
      if (
        stat.isSymbolicLink() ||
        !stat.isFile() ||
        sha256(readFileSync(file)) !== digest
      )
        problems.push({ code: "runtime-changed", path: file });
    } catch {
      problems.push({ code: "runtime-changed", path: file });
    }
  }
  if (problems.length) throw new InstallRefused(problems);
  if (realpathSync(fileURLToPath(import.meta.url)) === runtime.installer) {
    if (realpathSync(process.execPath) !== runtime.node)
      throw new InstallRefused([
        { code: "runtime-node-mismatch", path: process.execPath },
      ]);
    return undefined;
  }
  const result = spawnSync(runtime.node, [runtime.installer, ...argv], {
    stdio: "inherit",
    env: process.env,
  });
  return result.status ?? 1;
}

type InstallationStatus = {
  status: "installed" | "indeterminate" | "none";
  run?: string | undefined;
  receipt?: string | undefined;
  installedAt?: string | undefined;
  checkout?: { directory: string; commit: string } | undefined;
  candidate?: { sha256: string } | undefined;
  // `ahead` is what the baseline commit has and the checkout's HEAD does not. Zero means the
  // baseline is on this line of history and `behind` is a distance; anything else means the two
  // diverged and `behind` is one side of that, not a number to close.
  repository?:
    | { head: string; behind: number; ahead: number }
    | { unavailable: string }
    | undefined;
  interrupted: string[];
  unreadable: string[];
  // What `verify` finds wrong with the reported run, under the same name it uses. Read, not
  // inferred: the host, the runtime files and the direct targets.
  problems: string[];
};

/** How the checkout a deployment was taken from has moved since. */
function comparedWith(
  plan: InstallPlanV5,
): NonNullable<InstallationStatus["repository"]> {
  try {
    const head = git(plan.checkout.directory, ["rev-parse", "HEAD"]).trim();
    // Both sides in one call. `A..HEAD` alone counts what HEAD has and A does not, which is a
    // distance behind only while A is an ancestor. This repository squash-merges, so a deployment
    // taken from a feature branch stops being one the moment its pull request lands: the commit is
    // still there, nothing throws, and the count silently becomes the size of a divergence.
    const [ahead, behind] = git(plan.checkout.directory, [
      "rev-list",
      "--left-right",
      "--count",
      `${plan.checkout.commit}...HEAD`,
    ])
      .trim()
      .split(/\s+/)
      .map(Number);
    return { head, behind: behind!, ahead: ahead! };
  } catch {
    // The checkout can be gone, be another repository, or no longer contain that commit. None of
    // these makes the baseline commit unknown, so the rest of the answer still stands.
    return { unavailable: plan.checkout.directory };
  }
}

/**
 * Answers which source candidate is deployed and how far its baseline checkout has moved.
 *
 * The three steps this replaces were manual: find the newest run directory, read its receipt, then
 * compare its plan's baseline commit by hand. The deployed snapshot on this machine sat six commits behind
 * for a day without anything saying so.
 *
 * It reports rather than judges. Being behind is not a defect — a deployment is a decision — so
 * this never fails for it. What it must not do is claim a certainty it does not have, and `verdict`
 * owns that question.
 */
function installationStatus(
  environment: NodeJS.ProcessEnv,
): InstallationStatus {
  const current = readCurrentInstallation(environment);
  // The string form belongs here: the reader sees a code beside what it is about, while the module
  // that decides keeps the structured problem. A path without its code does not say what is wrong,
  // and a code with neither does not say which root it means — `roots-changed` for a
  // moved `CODEX_HOME` rendered as the bare word, and two roots moving collapsed into one entry.
  const problems = [
    ...new Set(
      current.problems.map((problem) =>
        [problem.code, problem.path ?? problem.key ?? problem.root]
          .filter(Boolean)
          .join(": "),
      ),
    ),
  ];
  const shared = {
    status: current.status,
    interrupted: current.interrupted,
    unreadable: current.unreadable,
    problems,
  };
  if (!current.run) return shared;
  const { receipt, plan } = current.run;
  return {
    ...shared,
    // The receipt file, not its directory: apply, verify and rollback all report this field as the
    // path, and the value is only useful if it can be handed straight back to `verify --receipt`.
    run: receipt.run.id,
    receipt: plan.run.receipt,
    installedAt: receipt.updatedAt,
    checkout: {
      directory: plan.checkout.directory,
      commit: plan.checkout.commit,
    },
    candidate: { sha256: plan.candidate.sha256 },
    repository: comparedWith(plan),
  };
}

function main(argv: string[]): void {
  try {
    const [command, ...rest] = argv;
    if (command === "status") {
      if (rest.length) throw new UsageError(usage);
      console.log(JSON.stringify(installationStatus(process.env)));
      return;
    }
    if (command === "plan") {
      console.log(
        JSON.stringify(planInstallation(parsePlanArguments(rest), process.env)),
      );
      return;
    }
    const option =
      command === "apply"
        ? "--plan"
        : command === "verify" || command === "rollback"
          ? "--receipt"
          : undefined;
    if (!option || rest.length !== 2 || rest[0] !== option || !rest[1])
      throw new UsageError(usage);
    const file = path.resolve(rest[1]);
    const runtime =
      command === "apply"
        ? runtimeOf(loadPlanForApply(file))
        : loadReceipt(file).receipt.runtime;
    const delegated = runFromRuntime(runtime, [command!, option, file]);
    if (delegated !== undefined) {
      process.exitCode = delegated;
      return;
    }
    const result =
      command === "apply"
        ? applyInstallPlan(file, process.env)
        : command === "verify"
          ? verifyInstallation(file, process.env)
          : rollbackInstallation(file, process.env);
    console.log(JSON.stringify(result));
    const succeeded =
      "verified" in result
        ? result.verified
        : result.status === (command === "apply" ? "installed" : "rolled-back");
    process.exitCode = succeeded ? 0 : 1;
  } catch (error) {
    if (error instanceof UsageError || error instanceof RecordVersionError) {
      console.error(error.message);
      process.exitCode = 2;
    } else if (error instanceof PlanBlocked) {
      console.log(JSON.stringify({ status: "blocked", gaps: error.gaps }));
      process.exitCode = 1;
    } else if (error instanceof InstallRefused) {
      console.log(
        JSON.stringify({ status: "refused", problems: error.problems }),
      );
      process.exitCode = 1;
    } else {
      console.error(
        error instanceof Error ? error.message : "Installation command failed",
      );
      process.exitCode = 1;
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main(process.argv.slice(2));
