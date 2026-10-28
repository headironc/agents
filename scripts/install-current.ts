// Reading which installation a machine is carrying, for the commands that ask rather than write.
//
// A module of the installer rather than an entrypoint, like `install-apply.ts` and
// `install-state.ts` beside it: the tool declarations belong to `install.ts`, which runs.
//
// The installer's other readers were written for writers: `verifyInstallation` answers whether one
// named run is still what its receipt says, and `resolveInstallRoots` refuses whenever any root is
// unusable, because `plan` and `apply` write to target roots. A command that only asks has to find the
// run first and rests on one root, so it grew private versions of both — and ten review rounds were
// spent pushing those back onto the ones that already existed. This module is where that answer
// lives now, composed from the owners rather than re-derived.
import { readdirSync } from "node:fs";
import path from "node:path";
import { loadReceipt, verifyInstallation } from "./install-apply.ts";
import type { InstallPlanV5, InstallReceiptV5 } from "./install-records.ts";
import { runIdPattern } from "./install-records.ts";
import type { Gap } from "./install-state.ts";
import {
  bytewise,
  inspectRoots,
  isRootResolution,
  lstatIfExists,
} from "./install-state.ts";

export type CurrentInstallation = {
  status: "installed" | "indeterminate" | "none";
  run?: { receipt: InstallReceiptV5; plan: InstallPlanV5 } | undefined;
  interrupted: string[];
  unreadable: string[];
  // Structured, and left that way: the string form a reader sees belongs to the command.
  problems: Gap[];
};

/**
 * Receipt states that leave the targets where the record says they are.
 *
 * `installed` and the two rolled-back states finished what they started. The others did not:
 * `applying` and `rolling-back` were interrupted, and the two incomplete states record targets the
 * installer could not restore. A machine carrying one of those is in a state no receipt describes.
 */
const settledStates = new Set([
  "installed",
  "failed-rolled-back",
  "rolled-back",
]);

type Deployments = {
  candidate?: { receipt: InstallReceiptV5; plan: InstallPlanV5 } | undefined;
  interrupted: { id: string; at: string }[];
  unreadable: string[];
};

/**
 * Reads the runs under the deployment root. `undefined` means there is no such root.
 *
 * Only run directories count. The root also holds `.install.lock`, which a concurrent or killed
 * apply leaves behind, and a run someone copied aside to keep carries a receipt whose binding no
 * longer matches; neither is a record of a run this answer is about.
 *
 * An absent receipt is skipped, because a run planned and not yet applied wrote nothing — the
 * review window between `plan` and `apply` is one the guide tells the operator to take. A receipt
 * that exists and cannot be read is listed instead, and telling those apart has to happen here:
 * `lstatIfExists` rethrows anything but ENOENT, so a run directory this user cannot traverse would
 * otherwise leave the whole answer behind with it.
 */
function readDeployments(deploy: string): Deployments | undefined {
  let names: string[];
  try {
    names = readdirSync(deploy).sort(bytewise);
  } catch (error) {
    // Only absence is `none`. A root that exists and cannot be read is a question this cannot
    // answer, and answering `none` would spell it the same way as a machine never installed.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error(`Cannot read the deployment root: ${deploy}`);
    return undefined;
  }
  const found: Deployments = { interrupted: [], unreadable: [] };
  for (const name of names) {
    if (!runIdPattern.test(name)) continue;
    const file = path.join(deploy, name, "deployment-receipt.json");
    let written;
    try {
      written = lstatIfExists(file);
    } catch {
      found.unreadable.push(file);
      continue;
    }
    if (!written) continue;
    let loaded;
    try {
      loaded = loadReceipt(file);
    } catch {
      found.unreadable.push(file);
      continue;
    }
    // `startedAt`, not `updatedAt`: every write to a receipt rewrites the latter, so one attempt to
    // roll a superseded run back would move it ahead of the run that superseded it while changing
    // nothing on disk. Apply order is what the install lock serialises, and no retry moves it.
    if (!settledStates.has(loaded.receipt.status))
      found.interrupted.push({
        id: loaded.receipt.run.id,
        at: loaded.receipt.startedAt,
      });
    if (loaded.receipt.status !== "installed") continue;
    if (
      !found.candidate ||
      loaded.receipt.startedAt > found.candidate.receipt.startedAt
    )
      found.candidate = loaded;
  }
  return found;
}

/**
 * The one place the answer's certainty is decided.
 *
 * The question is whether the tree still holds what the candidate run installed, and the way to
 * answer it is to look. Ordering runs by time cannot answer it, because an operation on an older
 * run may alter a target after a newer installation. Verification must read every current target.
 *
 * Two doubts survive the verification, because it covers one run. A record that could not be read
 * could say anything, including that a newer run added targets this plan does not name. And an
 * unfinished run that started later could have done the same.
 *
 * One that started earlier is not held against the answer, and the reason is narrower than it
 * looks. What that run installed and both plans name has been replaced and read back. What it
 * installed and the newer plan does not name — a member dropped from the manifest between the two
 * — is out of reach of this verification and stays on disk; nothing removes an entry no plan
 * claims. Holding the older run against the answer instead would make the state unrecoverable.
 */
function verdict(
  found: Deployments | undefined,
  problems: Gap[],
): CurrentInstallation["status"] {
  if (!found) return "none";
  const candidate = found.candidate;
  if (found.unreadable.length || problems.length) return "indeterminate";
  if (
    found.interrupted.some(
      (run) => !candidate || run.at > candidate.receipt.startedAt,
    )
  )
    return "indeterminate";
  return candidate ? "installed" : "none";
}

/**
 * Which installation this machine is carrying, and whether that can be said with certainty.
 *
 * The newest run recorded as installed is only a candidate; it is the current installation once
 * the verification and the rule above have run. Nothing here exports the candidate on its own,
 * because a caller holding one would be holding the claim this module exists to qualify.
 */
export function readCurrentInstallation(
  environment: NodeJS.ProcessEnv,
): CurrentInstallation {
  const gaps: Gap[] = [];
  // Only the roots this answer rests on decide where the records are: the deployment root derives
  // from the state root, and that from `XDG_STATE_HOME` or `HOME`. A gap on any other root is
  // reported by the verification below, weighed there, and never keeps this from answering.
  const inspected = inspectRoots(environment, gaps);
  if (!inspected)
    throw new Error(
      `Cannot resolve the installation roots: ${JSON.stringify(gaps)}`,
    );
  const deploy = inspected.roots.deploy.path;
  // By the root each gap belongs to, not by its path or its code: the same rule the verification's
  // problems are weighed by below. A gap under CODEX_HOME does not change where records reside.
  const locating = gaps.filter(
    (gap) =>
      isRootResolution(gap) && (gap.root === "deploy" || gap.root === "state"),
  );
  if (locating.length)
    throw new Error(
      `Cannot resolve the deployment root: ${JSON.stringify(locating)}`,
    );

  const found = readDeployments(deploy);
  let problems: Gap[] = [];
  if (found?.candidate) {
    const candidate = found.candidate;
    try {
      // The whole environment, and the whole verification: the host, the candidate digest, the
      // runtime files and the targets. Which of its findings decide is settled below, by the root
      // each belongs to rather than by a table of codes kept here.
      const verification = verifyInstallation(
        candidate.plan.run.receipt,
        environment,
      );
      // The receipt is read twice, here and in `readDeployments`. A rollback finishing between the
      // two leaves `verify` checking a restoration and returning no problems, which would be read
      // as an intact installation of a commit that has just been undone.
      //
      // No test pins this. Reaching it needs another process to write the receipt between two reads
      // in this one, and a test that races for it would be the kind this repository's rules refuse.
      // It is kept as stated defence, not as a case anything here decides.
      if (verification.status !== candidate.receipt.status)
        throw new Error("the record changed while it was being read");
      // A problem about resolving a root decides only for the roots this answer rests on. One about
      // what is installed — a root that moved, the host, the candidate digest, the runtime files,
      // the targets — always decides, because every one of those is where the deployment lives.
      problems = verification.problems.filter(
        (problem) =>
          !isRootResolution(problem) ||
          problem.root === "deploy" ||
          problem.root === "state",
      );
    } catch {
      found.unreadable.push(candidate.plan.run.receipt);
      found.candidate = undefined;
    }
  }
  return {
    status: verdict(found, problems),
    run: found?.candidate,
    interrupted: found?.interrupted.map((run) => run.id) ?? [],
    unreadable: found?.unreadable ?? [],
    problems,
  };
}
