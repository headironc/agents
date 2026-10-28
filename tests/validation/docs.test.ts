import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { checkMachinePaths, listMarkdown, markdownlintArguments } from "../../scripts/check-docs.ts";

const root = path.resolve(import.meta.dirname, "../..");
function fixture(t: TestContext): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "agents-docs-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet", directory]);
  return directory;
}

test("literal Markdown arguments preserve brackets, spaces and option-like filenames", t => {
  const directory = fixture(t);
  const names = ["--config.md", "[draft].md", "a space.md"];
  for (const name of names) writeFileSync(path.join(directory, name), "# Valid document\n");
  assert.deepEqual(listMarkdown(directory), names);
  assert.deepEqual(markdownlintArguments(names), ["--no-globs", ":./--config.md", ":./[draft].md", ":./a space.md"]);
  const result = spawnSync(process.execPath, [path.join(root, "node_modules/markdownlint-cli2/markdownlint-cli2-bin.mjs"), "--config", path.join(root, ".markdownlint-cli2.jsonc"), ...markdownlintArguments(names)], { cwd: directory, encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Linting: 3 files/);
});

test("empty and linked Markdown selections fail instead of reducing coverage", t => {
  const directory = fixture(t);
  assert.throws(() => listMarkdown(directory), /No Markdown/);
  writeFileSync(path.join(directory, "source"), "# Heading\n");
  symlinkSync("source", path.join(directory, "linked.md"));
  assert.throws(() => listMarkdown(directory), /symlink/);
});

test("machine-specific paths fail with a location and without disclosing the line", t => {
  const directory = fixture(t);
  writeFileSync(path.join(directory, "document.md"), "# Heading\n/" + "Users/example/private-value\n");
  assert.throws(() => checkMachinePaths(directory, ["document.md"]), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "Machine-specific path at document.md:2");
    assert.doesNotMatch(error.message, /private-value/);
    return true;
  });
  writeFileSync(path.join(directory, "document.md"), "# Heading\nUse the selected state directory.\n");
  checkMachinePaths(directory, ["document.md"]);
  assert.throws(() => checkMachinePaths(directory, ["missing.md"]));
});

test("document CLI rejects unknown selectors and extra arguments", () => {
  for (const args of [["unknown"], ["all", "extra"]]) {
    const result = spawnSync(process.execPath, ["scripts/check-docs.ts", ...args], { cwd: root, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 2, result.stdout + result.stderr);
  }
});

test("offline link validation rejects a missing local target and heading", t => {
  const directory = fixture(t);
  writeFileSync(path.join(directory, "document.md"), "# Heading\n\n[Missing](missing.md)\n\n[Bad anchor](#absent)\n");
  // Through the shared settings, not a restatement of them. Spelling the flags out here made this
  // the only coverage of a file nothing else read: turning `include_fragments` off in `lychee.toml`
  // left this test and `check-docs.ts links` both green, and only the published-form run noticed.
  const result = spawnSync(path.join(root, ".cache/agents-tools/bin/lychee"), ["-c", path.join(root, "lychee.toml"), "--root-dir", directory, "./document.md"], { cwd: directory, encoding: "utf8", timeout: 20_000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  const output = result.stdout + result.stderr;
  assert.match(output, /missing\.md[^\n]*File not found/);
  assert.match(output, /document\.md#absent[^\n]*Cannot find fragment/);
});

// A scenario is cited by identifier, so a row inserted in the wrong place makes two documents
// disagree about which case a number names. Twice in two slices a row landed out of sequence and
// only a reader caught it. The published checker decides it from the syntax tree; scanning the
// files again here would be a second implementation of the same invariant, and a line-by-line one
// at that, which is the approach this tool exists to replace.
test("scenario identifiers stay unique and ascend within their prefix", () => {
  const result = spawnSync(process.execPath, [path.join(root, "scripts/check-ids.mjs"), "tests/scenarios"],
    { cwd: root, encoding: "utf8", timeout: 60_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^id-check: 2 files, 0 errors$/m, "both scenario files must be read");
});
