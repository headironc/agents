import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import type { Stats } from "node:fs";
import path from "node:path";
import { isNormalizedAbsolute } from "./install-records.ts";
import type {
  InstallRoots,
  RootRecord,
  TargetState,
} from "./install-records.ts";
import { canonicalDigest } from "./source.ts";

export const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export const bytewise = (left: string, right: string) =>
  Buffer.compare(Buffer.from(left), Buffer.from(right));
export const inside = (parent: string, child: string) =>
  child === parent || child.startsWith(`${parent}/`);
export const sameState = (left: TargetState, right: TargetState) =>
  canonicalDigest(left) === canonicalDigest(right);

/** Resolve existing aliases while preserving the suffix that planning has not created yet. */
export function physicalInstallPath(file: string): string {
  let anchor = file;
  let stat = lstatIfExists(anchor);
  while (!stat) {
    anchor = path.dirname(anchor);
    stat = lstatIfExists(anchor);
  }
  // Adoption replaces a target link itself, not the file it points to.
  if (stat.isSymbolicLink()) anchor = path.dirname(anchor);
  return path.join(realpathSync.native(anchor), path.relative(anchor, file));
}

/** Bind a complete directory without following any member links. */
export function directoryDigest(root: string, copiedOwner?: number): string {
  const entries: unknown[] = [];
  const visit = (directory: string, relative: string) => {
    for (const name of readdirSync(directory).sort(bytewise)) {
      const file = path.join(directory, name);
      const member = relative ? `${relative}/${name}` : name;
      const stat = lstatSync(file);
      const mode = stat.mode & 0o7777;
      const owner = copiedOwner ?? stat.uid;
      if (stat.isDirectory()) {
        entries.push([member, "directory", mode, owner]);
        visit(file, member);
      } else if (stat.isSymbolicLink()) {
        entries.push([member, "link", readlinkSync(file), owner]);
      } else if (stat.isFile()) {
        if (stat.size > 16 * 1024 * 1024)
          throw new Error(`Directory member is too large: ${file}`);
        const descriptor = openSync(
          file,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          entries.push([
            member,
            "file",
            mode,
            owner,
            sha256(readFileSync(descriptor)),
          ]);
        } finally {
          closeSync(descriptor);
        }
      } else throw new Error(`Unsupported directory member: ${file}`);
    }
  };
  visit(root, "");
  return canonicalDigest(entries);
}

export type RootName = keyof InstallRoots;
/**
 * Gaps about working out where a root is and whether it is still the same directory, as opposed to
 * what is installed under it. A caller that rests on some roots and not others weighs these by the
 * root they name; everything else describes the deployment and always counts.
 *
 * The set is the classification, not one module's output, and the first three lines of it are this
 * module's while `root-anchor-changed` is `checkHost`'s. Writing it as "the codes raised here" is
 * how that fourth one fell out when this moved: nothing produced it nearby, so nothing missed it,
 * and it went back to deciding for every root — the side the scenarios call wrong.
 */
const rootResolutionCodes = new Set([
  "invalid-root",
  "linked-or-invalid-root",
  "unreadable-root",
  "root-anchor-changed",
]);
export const isRootResolution = (gap: Gap) => rootResolutionCodes.has(gap.code);
// `root` names which installation root the gap was found under, so a caller can weigh it by
// ownership instead of by matching the code.
export type Gap = {
  code: string;
  path?: string;
  key?: string;
  root?: RootName;
};

const machineFile = "/etc/machine-id";
const machineCommand = "/usr/sbin/sysctl";

/** A root-owned source no other account can rewrite; an unreadable or unexpected one yields no identity. */
function ownedByRoot(file: string): boolean {
  const stat = lstatIfExists(file);
  return (
    stat !== undefined &&
    stat.isFile() &&
    stat.uid === 0 &&
    (stat.mode & 0o022) === 0
  );
}

/**
 * Identify the machine itself. The hostname changes with a rename or a network's suffix, so a run binds this
 * stable identity instead and keeps the hostname as a recorded fact.
 */
export function machineIdentity(
  platform: NodeJS.Platform = process.platform,
  run = spawnSync,
): string | undefined {
  // An unreadable source, an unexpected mode or a failed command yields no identity, never an escaping error:
  // the callers report `machine-identity-unavailable` or `host-mismatch` instead of losing their JSON result.
  try {
    if (platform === "linux") {
      if (!ownedByRoot(machineFile)) return undefined;
      const value = readFileSync(machineFile, "utf8").trim();
      return /^[0-9a-f]{32}$/.test(value) ? value : undefined;
    }
    if (platform !== "darwin" || !ownedByRoot(machineCommand)) return undefined;
    const result = run(machineCommand, ["-n", "kern.uuid"], {
      encoding: "utf8",
      env: {},
      timeout: 10_000,
    });
    const value =
      result.status === 0 && typeof result.stdout === "string"
        ? result.stdout.trim()
        : "";
    return /^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(value)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

export function lstatIfExists(file: string): Stats | undefined {
  try {
    return lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Pre-write reads record failures as the caller's gap, so one result lists every independent problem. */
export function attempt<T>(
  gaps: Gap[],
  gap: Gap,
  read: () => T,
): T | undefined {
  try {
    return read();
  } catch {
    gaps.push(gap);
    return undefined;
  }
}

/**
 * Resolves every root, and says which ones the environment named unusably.
 *
 * Each gap carries the root it was found under, so a caller that rests on some roots and not others
 * can tell them apart by ownership rather than by reading a code string. And every root is resolved
 * whatever the others did: one unusable variable used to abandon the whole result, which left a
 * caller unable to see that a different root had moved.
 *
 * `undefined` only for `HOME`, which every other root is derived from.
 */
export function inspectRoots(
  environment: NodeJS.ProcessEnv,
  gaps: Gap[],
): { roots: InstallRoots; unusable: RootName[] } | undefined {
  const home = environment.HOME ?? "";
  if (!isNormalizedAbsolute(home)) {
    gaps.push({ code: "invalid-root", key: "HOME" });
    return undefined;
  }
  const unusable: RootName[] = [];
  const root = (
    name: RootName,
    value: string,
    variable: RootRecord["variable"],
  ): RootRecord => {
    let anchor = "/";
    for (const part of value.split("/").filter(Boolean)) {
      const current = path.join(anchor, part);
      const stat = attempt(
        gaps,
        { code: "unreadable-root", path: current, root: name },
        () => lstatIfExists(current) ?? null,
      );
      if (!stat) break;
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        gaps.push({
          code: "linked-or-invalid-root",
          path: current,
          root: name,
        });
        break;
      }
      anchor = current;
    }
    // The anchor is "/" or a component that was just read successfully.
    const stat = lstatSync(anchor, { bigint: true });
    return {
      path: value,
      variable,
      anchor: { path: anchor, dev: String(stat.dev), ino: String(stat.ino) },
    };
  };
  const select = (
    name: RootName,
    variable:
      | "CODEX_HOME"
      | "CLAUDE_CONFIG_DIR"
      | "XDG_STATE_HOME"
      | "AGENTS_BACKUP_ROOT",
    fallback: string,
  ) => {
    const value = environment[variable];
    if (value === undefined || value === "") return root(name, fallback, null);
    if (isNormalizedAbsolute(value)) return root(name, value, variable);
    gaps.push({ code: "invalid-root", key: variable, root: name });
    unusable.push(name);
    return root(name, fallback, null);
  };
  const state = select(
    "state",
    "XDG_STATE_HOME",
    path.join(home, ".local/state"),
  );
  return {
    unusable,
    roots: {
      home: root("home", home, "HOME"),
      codex: select("codex", "CODEX_HOME", path.join(home, ".codex")),
      claude: select("claude", "CLAUDE_CONFIG_DIR", path.join(home, ".claude")),
      state,
      deploy: root("deploy", path.join(state.path, "agents/deploy"), null),
      backup: select(
        "backup",
        "AGENTS_BACKUP_ROOT",
        path.join(state.path, "agents/backups"),
      ),
    },
  };
}

/**
 * The strict composition the writing commands need: any unusable root refuses the whole result.
 *
 * `plan` and `apply` require every root to resolve before writing. A
 * reader that rests on one of them wants `inspectRoots` instead.
 */
export function resolveInstallRoots(
  environment: NodeJS.ProcessEnv,
  gaps: Gap[],
): InstallRoots | undefined {
  const inspected = inspectRoots(environment, gaps);
  return inspected && !inspected.unusable.length ? inspected.roots : undefined;
}

/** Record missing parents and reject linked, foreign-owned or shared-writable existing ancestors. */
export function inspectParents(
  file: string,
  uid: number,
  gaps: Gap[],
  missing: Set<string>,
): void {
  let current = "/";
  for (const part of path.dirname(file).split("/").filter(Boolean)) {
    current = path.join(current, part);
    const stat = attempt(
      gaps,
      { code: "unreadable-ancestor", path: current },
      () => lstatIfExists(current) ?? null,
    );
    if (stat === undefined) return;
    if (stat === null) {
      missing.add(current);
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      gaps.push({ code: "linked-or-invalid-ancestor", path: current });
      return;
    }
    const sticky = stat.uid === 0 && (stat.mode & 0o1000) !== 0;
    if (
      ![0, uid].includes(stat.uid) ||
      ((stat.mode & 0o022) !== 0 && !sticky)
    ) {
      gaps.push({ code: "unsafe-ancestor", path: current });
      return;
    }
  }
}

class UnsupportedTargetError extends Error {}

/** Read a target without following its leaf; access errors are failures, never absence. */
function targetState(file: string, copiedOwner?: number): TargetState {
  const stat = lstatIfExists(file);
  if (!stat) return { type: "absent" };
  if (stat.isSymbolicLink()) return { type: "link", value: readlinkSync(file) };
  if (stat.isDirectory())
    return {
      type: "directory",
      mode: stat.mode & 0o7777,
      uid: copiedOwner ?? stat.uid,
      sha256: directoryDigest(file, copiedOwner),
    };
  if (!stat.isFile())
    throw new UnsupportedTargetError(`Unsupported target type: ${file}`);
  if (stat.size > 16 * 1024 * 1024)
    throw new UnsupportedTargetError(
      `Target file is too large to record: ${file}`,
    );
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const bytes = readFileSync(descriptor);
    return {
      type: "file",
      mode: stat.mode & 0o7777,
      uid: copiedOwner ?? stat.uid,
      bytes: bytes.length,
      sha256: sha256(bytes),
    };
  } finally {
    closeSync(descriptor);
  }
}

export const readTargetState = (file: string): TargetState => targetState(file);

/** Predict ownership after copying a readable source into this user's private run. */
export const readCopiedTargetState = (
  file: string,
  owner: number,
): TargetState => targetState(file, owner);

/** A copied backup cannot restore ownership that differs from the installer user. */
export function foreignOwnedMember(
  file: string,
  owner: number,
): string | undefined {
  const stat = lstatSync(file);
  if (stat.uid !== owner) return file;
  if (!stat.isDirectory()) return undefined;
  for (const name of readdirSync(file).sort(bytewise)) {
    const foreign = foreignOwnedMember(path.join(file, name), owner);
    if (foreign) return foreign;
  }
  return undefined;
}

/** Report targets that cannot be recorded as gaps the operator can act on. */
export function inspectTarget(
  file: string,
  gaps: Gap[],
): TargetState | undefined {
  try {
    return readTargetState(file);
  } catch (error) {
    gaps.push({
      code:
        error instanceof UnsupportedTargetError
          ? "unsupported-target"
          : "unreadable-target",
      path: file,
    });
    return undefined;
  }
}
