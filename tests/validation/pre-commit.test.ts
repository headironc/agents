import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import { selectHookChecks } from "../../scripts/pre-commit.ts";
import { fixtureRepository } from "./fixtures.ts";

const digest = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

test("only fully staged ordinary documents receive documentation coverage", (t) => {
  const f = fixtureRepository(t);
  f.put("docs/notes.md", "# Notes\n\nInitial.\n");
  f.commitBaseline();
  assert.equal(selectHookChecks(f.directory), "all");
  f.put("docs/notes.md", "# Notes\n\nChanged.\n");
  assert.equal(selectHookChecks(f.directory), "all");
  f.git(["add", "--", "docs/notes.md"]);
  assert.equal(selectHookChecks(f.directory), "docs");
  f.put("docs/notes.md", "# Notes\n\nPartial staging.\n");
  assert.equal(selectHookChecks(f.directory), "all");
});

test("bound documents, inventories, executables and instruction entries require all", (t) => {
  const f = fixtureRepository(t);
  f.commitBaseline();
  for (const file of [
    "docs/tooling.md",
    "docs/usage.md",
    "docs/AGENTS.md",
    "delivery/AGENTS.md",
    "config/personal-skills.txt",
    "scripts/check.ts",
    "README.md",
  ]) {
    f.put(file, "# Changed fixture\n");
    f.git(["add", "--", file]);
    assert.equal(selectHookChecks(f.directory), "all", file);
    f.git(["commit", "--quiet", "-m", "test: advance fixture"]);
  }
});

test("renames, deletions, executable modes, links and invalid exclusions cannot select docs", (t) => {
  const f = fixtureRepository(t);
  f.put("docs/notes.md", "# Notes\n");
  f.commitBaseline();
  f.git(["mv", "--", "docs/notes.md", "docs/renamed.md"]);
  assert.equal(selectHookChecks(f.directory), "all");
  f.git(["commit", "--quiet", "-m", "test: rename fixture"]);
  f.git(["rm", "--", "docs/renamed.md"]);
  assert.equal(selectHookChecks(f.directory), "all");
  f.git(["commit", "--quiet", "-m", "test: remove fixture"]);
  f.put("docs/executable.md", "# Executable\n");
  chmodSync(path.join(f.directory, "docs/executable.md"), 0o755);
  f.git(["add", "--", "docs/executable.md"]);
  assert.equal(selectHookChecks(f.directory), "all");
  f.git(["commit", "--quiet", "-m", "test: add executable fixture"]);
  symlinkSync("executable.md", path.join(f.directory, "docs/link.md"));
  f.git(["add", "--", "docs/link.md"]);
  assert.equal(selectHookChecks(f.directory), "all");
  f.git(["commit", "--quiet", "-m", "test: add link fixture"]);
  f.put("config/tool-bindings.txt", "broken\n");
  f.git(["add", "--", "config/tool-bindings.txt"]);
  f.git(["commit", "--quiet", "-m", "test: invalid exclusions"]);
  f.put("docs/ordinary.md", "# Ordinary\n");
  f.git(["add", "--", "docs/ordinary.md"]);
  assert.equal(selectHookChecks(f.directory), "all");
});

for (const mode of ["staged", "all", "pathspec", "alternate-index"] as const) {
  test(`actual failed hook rejects ${mode} commit without changing HEAD, index or hook configuration`, (t) => {
    const f = fixtureRepository(t);
    f.put("docs/notes.md", "# Notes\n\nInitial.\n");
    // This child is a controlled failing gate, not evidence that the real all gate passed.
    f.put(
      "scripts/check.sh",
      '#!/bin/bash\nset -eu\n[[ -z ${GIT_INDEX_FILE+x} && -z ${GIT_DIR+x} && -z ${GIT_WORK_TREE+x} ]] || exit 92\necho "fixture gate rejected: $1" >&2\nexit 7\n',
    );
    f.commitBaseline();
    f.put("docs/notes.md", "# Notes\n\nChanged.\n");
    if (mode === "staged" || mode === "alternate-index")
      f.git(["add", "--", "docs/notes.md"]);
    const index = path.join(f.directory, ".git/index");
    const alternate = path.join(f.directory, ".git/alternate-index");
    if (mode === "alternate-index") copyFileSync(index, alternate);
    const before = {
      head: f.git(["rev-parse", "HEAD"]),
      entries: f.git(["ls-files", "--stage", "-z"]),
      config: digest(path.join(f.directory, ".git/config")),
    };
    const result = f.runGit(
      [
        "-c",
        "core.hooksPath=.githooks",
        "commit",
        "--quiet",
        "-m",
        "test: rejected commit",
        ...(mode === "all"
          ? ["-a"]
          : mode === "pathspec"
            ? ["--", "docs/notes.md"]
            : []),
      ],
      mode === "alternate-index" ? { GIT_INDEX_FILE: alternate } : {},
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /fixture gate rejected:/);
    assert.equal(f.git(["rev-parse", "HEAD"]), before.head);
    // Git commit may refresh stat-cache bytes before the hook; staged blobs and modes must not change.
    assert.equal(f.git(["ls-files", "--stage", "-z"]), before.entries);
    assert.equal(digest(path.join(f.directory, ".git/config")), before.config);
    if (mode === "alternate-index")
      assert.equal(
        f.runGit(["ls-files", "--stage", "-z"], { GIT_INDEX_FILE: alternate })
          .stdout,
        before.entries,
      );
    const stable = digest(index);
    spawnSync("bash", [".githooks/pre-commit"], {
      cwd: f.directory,
      env: f.environment,
      timeout: 30_000,
    });
    assert.equal(
      digest(index),
      stable,
      "The hook itself cannot rewrite index bytes",
    );
  });
}

test("the real hook reaches docs successfully and preserves a failed or signalled gate status", (t) => {
  const f = fixtureRepository(t);
  f.put("docs/notes.md", "# Notes\n");
  f.commitBaseline();
  f.put("docs/notes.md", "# Notes\n\nChanged.\n");
  f.git(["add", "--", "docs/notes.md"]);
  for (const body of [
    'echo "selected $1"; exit 0',
    "exit 7",
    "kill -TERM $$",
  ]) {
    f.put("scripts/check.sh", `#!/bin/bash\n${body}\n`);
    // Keep the selected source fixture stable before checking the pending document.
    f.git(["add", "--", "scripts/check.sh"]);
    f.git([
      "commit",
      "--quiet",
      "-m",
      "test: gate fixture",
      "--",
      "scripts/check.sh",
    ]);
    const result = spawnSync("bash", [".githooks/pre-commit"], {
      cwd: f.directory,
      env: f.environment,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.match(result.stdout, /pre-commit: docs/);
    if (body === "kill -TERM $$")
      assert.equal(result.signal, "SIGTERM", result.stderr);
    else
      assert.equal(
        result.status,
        body.includes("exit 0") ? 0 : 7,
        result.stderr,
      );
  }
});

test("missing runtime or dependencies and Git failures reject the actual hook", (t) => {
  const f = fixtureRepository(t);
  const run = () =>
    spawnSync("bash", [".githooks/pre-commit"], {
      cwd: f.directory,
      env: f.environment,
      encoding: "utf8",
      timeout: 30_000,
    });
  rmSync(path.join(f.directory, "node_modules"));
  assert.match(run().stderr, /Missing hook dependencies/);
  rmSync(path.join(f.directory, ".cache/agents-tools/bin/node"));
  assert.match(run().stderr, /Missing hook prerequisites/);
  rmSync(path.join(f.directory, ".git"), { recursive: true });
  assert.notEqual(run().status, 0);
  assert.throws(() => selectHookChecks(f.directory));
});

test("the actual hook replaces its selector so the gate retains the hook process identity", async (t) => {
  const f = fixtureRepository(t);
  f.put("scripts/check.sh", '#!/bin/bash\nprintf "GATE_PID=%s\\n" "$$"\n');
  f.commitBaseline();
  const child = spawn("bash", [".githooks/pre-commit"], {
    cwd: f.directory,
    env: f.environment,
    timeout: 30_000,
  });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    output += chunk;
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(code, 0);
  assert.match(output, new RegExp(`GATE_PID=${child.pid}\\n`));
});
