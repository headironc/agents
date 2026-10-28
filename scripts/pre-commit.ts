// - Read [contract](../delivery/policy/tool-contracts.md). Use tool `git`.
// - Read [executor](check.ts). Use tool `bash`.
// - Read [executor](check.ts). Use tool `node`.
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync, writeSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { requiredRepositoryPaths } from "./check-catalog.ts";
import { readToolContracts } from "./check-tool-contracts.ts";

function git(root: string, args: string[]): string {
  return execFileSync("git", ["--no-optional-locks", ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

/** Keep instruction and bound contract files outside the ordinary-document allowance. */
export function ordinaryDocumentPaths(root: string): Set<string> {
  return new Set([
    ...requiredRepositoryPaths,
    // The installation fixtures derive their expectations from this contract.
    "docs/usage.md",
    ...readToolContracts(root).paths,
  ]);
}

export function ordinaryDocument(file: string, bound: Set<string>): boolean {
  return (
    file.startsWith("docs/") &&
    file.endsWith(".md") &&
    !/(?:^|\/)(?:AGENTS|CLAUDE|SKILL)\.md$/i.test(file) &&
    !bound.has(file)
  );
}

/** Select docs only when every current change is an ordinary fully staged document. */
export function selectHookChecks(root: string): "docs" | "all" {
  const records = git(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ])
    .split("\0")
    .filter(Boolean);
  if (records.length === 0) return "all";
  let bound: Set<string>;
  try {
    bound = ordinaryDocumentPaths(root);
  } catch {
    return "all";
  }
  for (const record of records) {
    if (!/^[AM]  /.test(record)) return "all";
    const file = record.slice(3);
    if (!ordinaryDocument(file, bound)) return "all";
    const stat = lstatSync(path.join(root, file));
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size === 0 ||
      (stat.mode & 0o111) !== 0 ||
      realpathSync(path.join(root, file)) !==
        path.join(realpathSync(root), file)
    )
      return "all";
    const index = git(root, ["ls-files", "--stage", "-z", "--", file])
      .split("\0")
      .filter(Boolean);
    if (
      index.length !== 1 ||
      !index[0]!.startsWith("100644 ") ||
      !index[0]!.endsWith(` 0\t${file}`)
    )
      return "all";
    if (
      git(root, ["diff", "--cached", "--summary", "--", file]).includes(
        "mode change",
      )
    )
      return "all";
  }
  return "docs";
}

function main(): void {
  if (process.argv.length !== 2) {
    process.exitCode = 2;
    throw new Error("Usage: node scripts/pre-commit.ts");
  }
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const manifest = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  );
  if (
    process.versions.node !== manifest.engines.node ||
    realpathSync(process.execPath) !==
      path.join(root, ".cache/agents-tools/bin/node")
  )
    throw new Error("Hook requires the repository's pinned Node");
  const group = selectHookChecks(root);
  const environment = { ...process.env };
  for (const name of git(root, ["rev-parse", "--local-env-vars"])
    .trim()
    .split("\n"))
    delete environment[name];
  if (group === "all")
    writeSync(
      2,
      "pre-commit: all checks validate the working tree; partial staging or an alternate commit index is not bound by this result.\n",
    );
  writeSync(1, `pre-commit: ${group}\n`);
  process.chdir(root);
  // Replace this selector so the existing checker owns signals and bounded child cleanup.
  process.execve!(
    "/bin/bash",
    ["bash", "scripts/check.sh", group],
    environment,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Pre-commit failed");
    process.exitCode ||= 1;
  }
}
