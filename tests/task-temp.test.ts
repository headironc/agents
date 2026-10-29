import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const source = path.resolve(import.meta.dirname, "../scripts/task-temp.ts");
const product = path.resolve(
  import.meta.dirname,
  "../delivery/tools/task-temp.mjs",
);
function fixture(t: { after: (fn: () => void) => void }): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "task-temp-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function run(root: string, code: string, entry = source) {
  return spawnSync(
    process.execPath,
    [
      entry,
      "run",
      "--root",
      root,
      "--owner",
      "test-task",
      "--purpose",
      "fixture",
      "--",
      process.execPath,
      "-e",
      code,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
}

for (const entry of [source, product]) {
  test(`${path.basename(entry)} cleans fresh scratch on success and failure, preserving unrelated files and cwd`, (t) => {
    const root = fixture(t);
    writeFileSync(path.join(root, "historical.txt"), "keep");
    for (const status of [0, 7]) {
      const result = run(
        root,
        `const fs=require('node:fs'); fs.writeFileSync(process.env.TASK_TEMP_DIR+'/data','payload'); console.log(JSON.stringify({cwd:process.cwd(),tmp:process.env.TMPDIR,mode:fs.statSync(process.env.TASK_TEMP_DIR).mode & 511})); process.exit(${status});`,
        entry,
      );
      assert.equal(result.status, status, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.cwd, process.cwd());
      assert.equal(output.mode, 0o700);
      assert.match(output.tmp, /agents-task-.*[/\\]scratch$/);
      assert.match(result.stderr, /"cleanup":"removed"/);
      assert.deepEqual(readdirSync(root), ["historical.txt"]);
    }
  });
}

test("Git metadata and changed ownership retain the allocation with a nonzero result", (t) => {
  const root = fixture(t);
  for (const code of [
    "require('node:fs').writeFileSync(process.env.TASK_TEMP_DIR+'/.git','gitdir: elsewhere')",
    "require('node:fs').writeFileSync(process.env.TASK_TEMP_DIR+'/../.agents-task-temp.json','{}')",
  ]) {
    const result = run(root, code);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /"cleanup":"retained"/);
  }
  assert.equal(readdirSync(root).length, 2);
});

test("scratch symlinks are unlinked without touching their targets", (t) => {
  const root = fixture(t);
  const outside = fixture(t);
  writeFileSync(path.join(outside, "keep"), "original");
  const result = run(
    root,
    `require('node:fs').symlinkSync(${JSON.stringify(outside)},process.env.TASK_TEMP_DIR+'/link')`,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(path.join(outside, "keep"), "utf8"), "original");
  assert.deepEqual(readdirSync(root), []);
});

test("scan reports unknown history and malformed markers without mutating or following links", (t) => {
  const root = fixture(t);
  const unknown = path.join(root, "old-worktree");
  mkdirSync(unknown);
  writeFileSync(path.join(unknown, "keep"), "original");
  mkdirSync(path.join(root, "invalid"));
  writeFileSync(path.join(root, "invalid/.agents-task-temp.json"), "{}");
  mkdirSync(path.join(root, "linked-marker"));
  symlinkSync(
    path.join(unknown, "keep"),
    path.join(root, "linked-marker/.agents-task-temp.json"),
  );
  symlinkSync(unknown, path.join(root, "link"));
  const retained = run(
    root,
    "require('node:fs').mkdirSync(process.env.TASK_TEMP_DIR+'/.git')",
  );
  assert.equal(retained.status, 1);
  const before = readdirSync(root).map((name) => [
    name,
    lstatSync(path.join(root, name)).mtimeMs,
  ]);
  const result = spawnSync(process.execPath, [source, "scan", "--root", root], {
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.readOnly, true);
  assert.equal(report.errors, 2);
  assert.equal(
    report.entries.find((row: { kind: string }) => row.kind === "task-temp")
      .ownership.owner,
    "test-task",
  );
  assert.equal(
    report.entries.find((row: { path: string }) => row.path === unknown).status,
    "needs-owner-check",
  );
  assert.equal(
    report.entries.find(
      (row: { path: string }) => row.path === path.join(root, "link"),
    ).kind,
    "symlink",
  );
  assert.deepEqual(
    readdirSync(root).map((name) => [
      name,
      lstatSync(path.join(root, name)).mtimeMs,
    ]),
    before,
  );
  assert.equal(readFileSync(path.join(unknown, "keep"), "utf8"), "original");
});

test(
  "interruption waits for the foreground child and retains scratch",
  { timeout: 10_000 },
  async (t) => {
    const root = fixture(t);
    const child = spawn(
      process.execPath,
      [
        source,
        "run",
        "--root",
        root,
        "--owner",
        "test-task",
        "--purpose",
        "interruption",
        "--",
        process.execPath,
        "-e",
        "process.on('SIGTERM',()=>process.exit(0)); console.log('ready'); setInterval(()=>{},1000)",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    t.after(() => child.kill("SIGKILL"));
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    await once(child.stdout, "data");
    child.kill("SIGTERM");
    const [code] = await once(child, "close");
    assert.equal(code, 1);
    assert.match(stderr, /"cleanup":"retained"/);
    assert.equal(readdirSync(root).length, 1);
  },
);

test("invalid requests create nothing and scan never creates missing roots", (t) => {
  const root = fixture(t);
  for (const args of [
    ["run", "--root", root, "--", process.execPath],
    ["scan", "--root", path.join(root, "absent")],
    ["scan", "--root", root, "--delete"],
  ]) {
    const result = spawnSync(process.execPath, [source, ...args], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.notEqual(result.status, 0);
    assert.deepEqual(readdirSync(root), []);
  }
});
