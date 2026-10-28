import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { load } from "js-yaml";
import { checkSpecs } from "../../scripts/check.ts";
import { workflowPaths } from "../../scripts/check-catalog.ts";
import { repositoryRoot } from "./fixtures.ts";

// YAML syntax belongs to js-yaml/actionlint; these assertions own the project's CI contract.
const workflow = load(
  readFileSync(
    path.join(repositoryRoot, ".github/workflows/check.yml"),
    "utf8",
  ),
) as Record<string, any>;

const lockWorkflow = load(
  readFileSync(
    path.join(repositoryRoot, ".github/workflows/lock-pr.yml"),
    "utf8",
  ),
) as Record<string, any>;

test("closed PR locking has no candidate execution or unrelated permissions", () => {
  assert.deepEqual(lockWorkflow.on, {
    pull_request_target: { types: ["closed"] },
  });
  assert.deepEqual(lockWorkflow.permissions, { "pull-requests": "write" });
  assert.equal(lockWorkflow.concurrency["cancel-in-progress"], false);
  assert.deepEqual(Object.keys(lockWorkflow.jobs), ["lock"]);
  const job = lockWorkflow.jobs.lock;
  assert.equal(job["runs-on"], "ubuntu-latest");
  assert.equal(job["timeout-minutes"], 3);
  assert.equal(job.steps.length, 1);
  assert.equal(job.steps[0].uses, undefined);
  assert.deepEqual(job.steps[0].env, {
    GH_TOKEN: "${{ github.token }}",
    REPOSITORY: "${{ github.repository }}",
    PR_NUMBER: "${{ github.event.pull_request.number }}",
  });
});

test("locking skips open or locked PRs and resolves failed writes without retrying", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pr-lock-test-"));
  try {
    writeFileSync(
      path.join(dir, "gh"),
      `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const put = args.includes('PUT');
fs.appendFileSync(process.env.LOCK_TEST_CALLS, (put ? 'PUT' : 'GET') + '\\n');
if (put) process.exit(Number(process.env.LOCK_TEST_WRITE_EXIT));
if (process.env.LOCK_TEST_READ_EXIT) process.exit(1);
console.log(args.includes('.locked') ? process.env.LOCK_TEST_AFTER : process.env.LOCK_TEST_BEFORE);
`,
      { mode: 0o700 },
    );
    const cases = [
      {
        before: "open\tfalse",
        after: "false",
        write: "0",
        status: 0,
        calls: ["GET"],
      },
      {
        before: "closed\ttrue",
        after: "true",
        write: "0",
        status: 0,
        calls: ["GET"],
      },
      {
        before: "closed\tfalse",
        after: "true",
        write: "0",
        status: 0,
        calls: ["GET", "PUT", "GET"],
      },
      {
        before: "closed\tfalse",
        after: "true",
        write: "1",
        status: 0,
        calls: ["GET", "PUT", "GET"],
      },
      {
        before: "closed\tfalse",
        after: "false",
        write: "1",
        status: 1,
        calls: ["GET", "PUT", "GET"],
      },
      {
        before: "closed\tfalse",
        after: "true",
        write: "0",
        read: "1",
        status: 1,
        calls: ["GET"],
      },
    ];
    for (const c of cases) {
      const callsFile = path.join(dir, "calls");
      writeFileSync(callsFile, "");
      const result = spawnSync(
        "bash",
        [
          "--noprofile",
          "--norc",
          "-euo",
          "pipefail",
          "-c",
          lockWorkflow.jobs.lock.steps[0].run,
        ],
        {
          encoding: "utf8",
          timeout: 5000,
          env: {
            ...process.env,
            PATH: dir + path.delimiter + process.env.PATH,
            REPOSITORY: "fixture/repo",
            PR_NUMBER: "7",
            LOCK_TEST_CALLS: callsFile,
            LOCK_TEST_BEFORE: c.before,
            LOCK_TEST_AFTER: c.after,
            LOCK_TEST_WRITE_EXIT: c.write,
            LOCK_TEST_READ_EXIT: c.read ?? "",
          },
        },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.status, c.status, result.stderr);
      assert.deepEqual(
        readFileSync(callsFile, "utf8").trim().split("\n"),
        c.calls,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("native checks run for every selected PR event and main push", () => {
  assert.equal(workflow.name, "checks");
  assert.deepEqual(workflow.on, {
    pull_request: {
      branches: ["main"],
      types: [
        "opened",
        "synchronize",
        "reopened",
        "ready_for_review",
        "edited",
      ],
    },
    push: { branches: ["main"] },
  });
  assert.deepEqual(workflow.concurrency, {
    group:
      "${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.ref }}",
    "cancel-in-progress": true,
  });
});

test("both hosted platforms retain stable results and complete failure-sensitive checks", () => {
  assert.deepEqual(Object.keys(workflow.jobs), ["repository"]);
  const job = workflow.jobs.repository;
  assert.equal(job.name, "repository (${{ matrix.os }})");
  assert.equal(job["runs-on"], "${{ matrix.os }}");
  assert.deepEqual(job.strategy, {
    "fail-fast": false,
    matrix: { os: ["ubuntu-latest", "macos-latest"] },
  });
  assert.equal(job["timeout-minutes"], 30);
  assert.deepEqual(workflow.defaults, {
    run: { shell: "bash --noprofile --norc -euo pipefail {0}" },
  });
  assert.equal(job.if, undefined);
  assert.equal(job["continue-on-error"], undefined);
  assert.equal(job.defaults, undefined);
  const commands = job.steps.flatMap((step: Record<string, any>) => {
    assert.equal(step.if, undefined);
    assert.equal(step["continue-on-error"], undefined);
    assert.equal(step.shell, undefined);
    if (!step.run) return [];
    assert.match(step.run, /^umask 077\n/);
    return step.run.trim().split("\n");
  });
  const required = [
    "bash scripts/install-tools.sh",
    ".cache/agents-tools/bin/bun install --frozen-lockfile --ignore-scripts",
    ".cache/agents-tools/bin/bun run build:install",
    "mkdir -p .cache/reports",
    "bash scripts/check.sh all --report .cache/reports/check.json",
  ];
  assert.deepEqual(
    commands.filter((line: string) => required.includes(line)),
    required,
  );
  assert.equal(job.steps.length, 6);
});

test("candidate execution uses only read permissions and a pinned credential-free checkout", () => {
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.env, undefined);
  const job = workflow.jobs.repository;
  for (const key of [
    "permissions",
    "secrets",
    "environment",
    "container",
    "services",
    "env",
  ])
    assert.equal(job[key], undefined, key);
  const actions = job.steps.filter((step: Record<string, any>) => step.uses);
  assert.equal(actions.length, 1);
  assert.match(actions[0].uses, /^actions\/checkout@[a-f0-9]{40}$/);
  assert.deepEqual(actions[0].with, {
    ref: "${{ github.sha }}",
    "persist-credentials": false,
  });
  assert.equal(job.steps[0], actions[0]);
  assert.match(
    job.steps[1].run,
    /test "\$\(git rev-parse HEAD\)" = "\$CANDIDATE_SHA"/,
  );
  assert.equal(job.steps[1].env.CANDIDATE_SHA, "${{ github.sha }}");
  assert.doesNotMatch(JSON.stringify(workflow), /secrets\./);
});

test("the unified CI gate checks the real workflow, shell blocks and project regression", async () => {
  assert.deepEqual(workflowPaths, [
    ".github/workflows/check.yml",
    ".github/workflows/lock-pr.yml",
  ]);
  const specs = await checkSpecs(["ci"], "all");
  assert.ok(
    specs.some(
      (spec) =>
        spec.name === "CI regression: tests/validation/workflow.test.ts",
    ),
  );
  const syntax = specs.find((spec) => spec.name === "actionlint")!;
  assert.ok(syntax.argv.includes(".github/workflows/check.yml"));
  assert.ok(syntax.argv.includes(".github/workflows/lock-pr.yml"));
  assert.ok(syntax.argv.includes("-shellcheck"));
  assert.ok(specs.some((spec) => spec.name === "zizmor"));
});
