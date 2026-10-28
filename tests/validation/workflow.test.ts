import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.deepEqual(workflowPaths, [".github/workflows/check.yml"]);
  const specs = await checkSpecs(["ci"], "all");
  assert.ok(
    specs.some(
      (spec) =>
        spec.name === "CI regression: tests/validation/workflow.test.ts",
    ),
  );
  const syntax = specs.find((spec) => spec.name === "actionlint")!;
  assert.ok(syntax.argv.includes(".github/workflows/check.yml"));
  assert.ok(syntax.argv.includes("-shellcheck"));
  assert.ok(specs.some((spec) => spec.name === "zizmor"));
});
