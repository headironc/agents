#!/usr/bin/env node
// Contract subject: `ref-check`.
//
// Lays out the published tree in a temporary directory and runs the pinned lychee over it, so
// references are resolved against the installer's exact target set.
//
// Usage: node scripts/check-refs.ts
//
// The repository form is already lychee's, in the documents group. This second pass checks the
// selected delivery members after publication, including references that could escape a product root.
//
// The checking is lychee's, not this file's. What is left here is the three things lychee cannot
// know: which tree to look at, which broken references are accounted for, and where the published
// root ends.
//
// That last one needs a second pass. lychee resolves a relative link against the file's own
// directory and stops there, so `../x.md` from the root of the laid-out tree resolves above it and
// is reported as fine whenever something happens to sit there. `--root-dir` does not help; it
// constrains absolute links only. Measured: a planted `../escape-probe/outside.md` with a real file
// above the temporary directory passed as a success. For a consumer a reference above its product root
// is outside what we ship, so the dump decides it instead of the filesystem.
//
// The tree is laid out from `publicMembers` in `delivery.ts` and the same current Git source
// members the installer admits, including nonignored untracked files. A second list would drift
// from the installation candidate and answer about a tree nobody installs.
//
// - Read [contract](../delivery/policy/tool-contracts.md). Use tool `git`.
// - Read [executor](check-docs.ts). Use tool `lychee`.
// - Read [runtime contract](check.ts). Use tool `node`.

import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { publicMembers, products } from "./delivery.ts";
import type { PublicMember } from "./delivery.ts";
import { readSkillEntries } from "./skills.ts";
import { listSourcePaths } from "./source.ts";

const root = path.resolve(import.meta.dirname, "..");

export type Finding = {
  file: string;
  line: number;
  target: string;
  reason: string;
};
export type Gap = { file: string; target: string; owner: string };

/**
 * References that do not resolve in the published layout and are not fixed here, each with the
 * slice that owns it.
 *
 * An entry names the file and the resolved target, and allows exactly one occurrence. Three
 * earlier versions of this ledger were each wider than what they allowed, and each let a new break
 * through silently: matching the link text alone exempted it in every file, matching the pair
 * without counting still exempted every occurrence inside that file, and the gitleaks allowance
 * two slices back exempted a whole file by naming one path in it.
 *
 * A stale entry blocks too. An allowance that outlives the thing it allows reads as coverage while
 * carrying nothing.
 */
export const knownGaps: Gap[] = [];

/**
 * Copies every published member into `destination` from the installer's current source set.
 * Both branches consult the same set: a directory member walks the source list, and a file member
 * is checked against it because a published document can itself be untracked.
 */
export function layOutPublished(
  directory: string,
  members: PublicMember[],
  destination: string,
): string[] {
  if (new Set(members.map((member) => member.product)).size > 1)
    throw new Error("Published references must be checked in one product root");
  const sources = new Set(listSourcePaths(directory));
  const laid: string[] = [];
  const copy = (relative: string, source: string) => {
    if (!sources.has(source)) return;
    const target = path.join(destination, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(directory, source), target);
    laid.push(relative);
  };
  for (const member of members) {
    let stat;
    // A member whose source is gone would lay out a smaller tree, and a smaller tree answers with
    // fewer findings rather than with an error.
    try {
      stat = statSync(path.join(directory, member.source));
    } catch {
      throw new Error(`published member has no source: ${member.source}`);
    }
    if (!stat.isDirectory()) {
      copy(member.relative, member.source);
      continue;
    }
    for (const file of sources) {
      if (file.startsWith(`${member.source}/`))
        copy(
          path.posix.join(
            member.relative,
            file.slice(member.source.length + 1),
          ),
          file,
        );
    }
  }
  return laid.sort();
}

/**
 * Runs the pinned lychee from inside the laid-out tree.
 *
 * `-c` by absolute path, because this runs from a temporary directory where lychee would find no
 * config of its own, and the settings have to match the repository-form run rather than be
 * restated here.
 */
function lychee(
  directory: string,
  files: string[],
  mode: string[],
): { stdout: string; status: number | null; stderr: string } {
  const result = spawnSync(
    path.join(root, ".cache/agents-tools/bin/lychee"),
    [
      "-c",
      path.join(root, "lychee.toml"),
      ...mode,
      ...files.map((file) => `./${file}`),
    ],
    {
      cwd: directory,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  return {
    stdout: result.stdout ?? "",
    status: result.status,
    stderr: (result.stderr ?? "").trim(),
  };
}

/** The published path a laid-out absolute path is at, keeping the fragment. */
function published(directory: string, url: string): string {
  if (!url.startsWith("file://")) return url;
  const parsed = new URL(url);
  return (
    path.relative(directory, decodeURIComponent(parsed.pathname)) +
    decodeURIComponent(parsed.hash)
  );
}

/**
 * References that resolve outside the laid-out tree.
 *
 * The check run cannot see these, because lychee resolves them against the real filesystem and
 * calls them successes whenever something exists there. The dump lists every extracted link as a
 * resolved path, so the comparison is against the root rather than against what happens to be
 * above it. Attribution costs a run per file, so it is only paid when there is something to
 * attribute; the whole-tree dump is one run and 10 ms.
 */
function escapingReferences(directory: string, files: string[]): Finding[] {
  // A dump that did not run also lists no escapes, and the two are the same output. So the status
  // is checked here, where a dump has nothing to report but its own success.
  const dump = (of: string[]) => {
    // `--root-dir` for the same reason the check run passes it: without it a root-relative link
    // resolves against nothing, and lychee drops it from the listing with a warning nobody reads.
    // A dropped link cannot be judged. It does not change how a relative link resolves.
    //
    // No test pins this, and none can: with `--root-dir` a root-relative link always resolves
    // inside the root, so it can never be an escape and the verdict is the same either way. What
    // it buys is a complete listing rather than a silent drop.
    const result = lychee(directory, of, ["--dump", "--root-dir", directory]);
    if (result.status !== 0)
      throw new Error(
        `lychee could not list links (exit ${result.status}): ${result.stderr}`,
      );
    return (
      result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("file://"))
        // The root itself is inside the root. `startsWith(directory + sep)` alone says otherwise, and
        // a link to the published root is legal — the check run resolves it without complaint.
        .filter((target) => {
          const at = decodeURIComponent(new URL(target).pathname);
          return at !== directory && !at.startsWith(directory + path.sep);
        })
    );
  };
  if (!dump(files).length) return [];
  const findings: Finding[] = [];
  // Per occurrence, like the check run: the dump lists a link once for each time it is written,
  // and an allowance covers one of them.
  for (const file of files) {
    for (const url of dump([file]))
      findings.push({
        file,
        line: 0,
        target: published(directory, url),
        reason: "Leaves the published root",
      });
  }
  return findings;
}

/** Runs the pinned lychee over a laid-out tree and returns what it could not resolve. */
export function checkLaidOut(given: string, files: string[]): Finding[] {
  const markdown = files.filter((file) => file.endsWith(".md"));
  if (!markdown.length) return [];
  // Every path here is compared against the one lychee reports, and lychee reports the real one.
  // On macOS `os.tmpdir()` is `/var/folders/…`, a symbolic link to `/private/var/folders/…`, so
  // comparing against the path as given made every reference in the tree look like it had left
  // the root. Measured on that platform, and reproduced here by laying the tree out through a
  // symbolic link to it; nothing about it is particular to macOS.
  const directory = realpathSync(given);
  const result = lychee(directory, markdown, [
    "--format",
    "json",
    "--root-dir",
    directory,
  ]);
  // lychee exits nonzero when it finds broken references, which is the ordinary case here, so the
  // report itself is the evidence the run happened rather than the status.
  if (!result.stdout.trim())
    throw new Error(
      `lychee produced no report (exit ${result.status}): ${result.stderr}`,
    );
  const report = JSON.parse(result.stdout) as {
    error_map?: Record<
      string,
      { url: string; status: { text: string }; span?: { line: number } }[]
    >;
  };
  const checked: Finding[] = [];
  for (const [file, errors] of Object.entries(report.error_map ?? {})) {
    for (const error of errors) {
      // The ledger keys on the published path, which survives the temporary directory being
      // different on every run. The fragment is kept: a broken anchor and a broken path into the
      // same file are two different references, and dropping it would collide them into one entry.
      checked.push({
        file: file.replace(/^\.\//, ""),
        line: error.span?.line ?? 0,
        target: published(directory, error.url),
        reason: error.status.text,
      });
    }
  }
  // An escape that also has nothing at the other end arrives from both passes. It is one broken
  // reference spending one allowance, so the escape supersedes rather than adds; the check run
  // keeps the line, which the dump does not carry. One occurrence supersedes one finding: matching
  // by file and target alone let a second occurrence supersede the first one's own escape, and
  // two written references folded into one.
  const findings = [...checked];
  const superseded = new Set<Finding>();
  for (const escape of escapingReferences(directory, markdown)) {
    const known = checked.find(
      (finding) =>
        !superseded.has(finding) &&
        finding.file === escape.file &&
        finding.target === escape.target,
    );
    if (known) {
      known.reason = escape.reason;
      superseded.add(known);
    } else findings.push(escape);
  }
  return findings.sort((left, right) =>
    `${left.file}\u0000${left.target}`.localeCompare(
      `${right.file}\u0000${right.target}`,
    ),
  );
}

/** Splits findings into the ones already accounted for and the ones that block; each entry is spent once. */
export function againstKnownGaps(
  findings: Finding[],
  gaps: Gap[],
): { blocking: Finding[]; unused: Gap[] } {
  const key = (item: { file: string; target: string }) =>
    `${item.file}\u0000${item.target}`;
  const remaining = new Map<string, number>();
  for (const gap of gaps)
    remaining.set(key(gap), (remaining.get(key(gap)) ?? 0) + 1);
  const blocking = findings.filter((finding) => {
    const left = remaining.get(key(finding)) ?? 0;
    if (!left) return true;
    remaining.set(key(finding), left - 1);
    return false;
  });
  const unused = gaps.filter((gap) => {
    const left = remaining.get(key(gap)) ?? 0;
    if (!left) return false;
    remaining.set(key(gap), left - 1);
    return true;
  });
  return { blocking, unused };
}

export function checkPublished(directory: string): Finding[] {
  const destination = mkdtempSync(path.join(os.tmpdir(), "agents-published-"));
  try {
    const entries = readSkillEntries(directory);
    return products.flatMap((product) => {
      const productRoot = path.join(destination, product);
      mkdirSync(productRoot);
      return checkLaidOut(
        productRoot,
        layOutPublished(
          directory,
          publicMembers(entries, product),
          productRoot,
        ),
      ).map((finding) => ({ ...finding, file: `${product}/${finding.file}` }));
    });
  } finally {
    rmSync(destination, { recursive: true, force: true });
  }
}

function main(argv: string[]): void {
  // No options. The gate is the only caller, and a structured format would be a second output
  // shape with nobody reading it.
  if (argv.length) {
    process.stderr.write("Usage: node scripts/check-refs.ts\n");
    process.exitCode = 2;
    return;
  }
  const findings = checkPublished(root);
  const { blocking, unused } = againstKnownGaps(findings, knownGaps);
  for (const finding of blocking)
    console.log(
      `${finding.file}:${finding.line}: error: ${finding.target}: ${finding.reason}`,
    );
  for (const gap of unused)
    console.log(
      `${gap.file}: error: known gap no longer occurs, remove it: ${gap.target}`,
    );
  console.log(
    `ref-check: ${blocking.length} errors, ${findings.length - blocking.length} known gaps, ${unused.length} stale allowances`,
  );
  process.exitCode = blocking.length + unused.length ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main(process.argv.slice(2));
