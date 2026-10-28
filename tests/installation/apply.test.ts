import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  applyInstallPlan,
  InstallRefused,
  rollbackInstallation,
  verifyInstallation,
} from "../../scripts/install-apply.ts";
import { readCurrentInstallation } from "../../scripts/install-current.ts";
import { InstallReceiptSchema } from "../../scripts/install-records.ts";
import type { InstallReceiptV5 } from "../../scripts/install-records.ts";
import {
  machineIdentity,
  readTargetState,
} from "../../scripts/install-state.ts";
import { canonicalDigest } from "../../scripts/source.ts";
import { expectedTargets, installFixture, link } from "./fixtures.ts";

function outcome(result: {
  status: number | null;
  stdout: string;
  stderr: string;
}) {
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout) as {
    status: string;
    verified?: boolean;
    unreadable?: string[];
    candidate?: { sha256: string };
  };
}

function readReceipt(file: string): InstallReceiptV5 {
  return InstallReceiptSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

function refusal(action: () => unknown) {
  try {
    action();
  } catch (error) {
    if (error instanceof InstallRefused) return error.problems;
    throw error;
  }
  return assert.fail("Expected installation to be refused");
}

test("a real runtime installs files and directories directly, then rolls back", (t) => {
  const f = installFixture(t, { realRuntime: true });
  for (const name of [".resources", ".agents", ".claude"]) {
    mkdirSync(path.join(f.home, name), { recursive: true });
    writeFileSync(path.join(f.home, name, "legacy.txt"), "retained\n");
  }
  const { review, plan } = f.planned();
  assert.equal(outcome(f.cli(["apply", "--plan", review])).status, "installed");
  for (const [target, source] of expectedTargets(f.home, plan.run.source)) {
    assert.equal(lstatSync(target).isSymbolicLink(), false);
    assert.equal(
      lstatSync(target).isDirectory(),
      lstatSync(source).isDirectory(),
    );
    if (lstatSync(target).isFile())
      assert.deepEqual(readFileSync(target), readFileSync(source));
    else assert.deepEqual(readTargetState(target), readTargetState(source));
  }
  const verified = outcome(f.cli(["verify", "--receipt", plan.run.receipt]));
  assert.equal(verified.status, "installed");
  assert.equal(verified.verified, true);
  assert.equal(
    outcome(f.cli(["rollback", "--receipt", plan.run.receipt])).status,
    "rolled-back",
  );
  for (const [target] of expectedTargets(f.home, plan.run.source))
    assert.equal(existsSync(target), false);
  for (const name of [".resources", ".agents", ".claude"])
    assert.equal(
      readFileSync(path.join(f.home, name, "legacy.txt"), "utf8"),
      "retained\n",
    );
});

test("skill directories retain source modes under a restrictive umask", (t) => {
  const f = installFixture(t, { realRuntime: true });
  const relative = "delivery/skills/alibabacloud-find-skills";
  chmodSync(path.join(f.checkout, relative), 0o755);
  chmodSync(path.join(f.checkout, relative, "references"), 0o755);
  const { review, plan } = f.planned();
  assert.equal(outcome(f.cli(["apply", "--plan", review])).status, "installed");
  const installed = path.join(f.home, ".codex/skills/alibabacloud-find-skills");
  assert.equal(lstatSync(installed).mode & 0o7777, 0o755);
  assert.equal(
    lstatSync(path.join(installed, "references")).mode & 0o7777,
    0o755,
  );
  assert.equal(
    outcome(f.cli(["verify", "--receipt", plan.run.receipt])).verified,
    true,
  );
});

test("adopted personal instructions are backed up and restored", (t) => {
  const f = installFixture(t, { realRuntime: true });
  const target = path.join(f.home, ".codex/AGENTS.md");
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, "personal rules\n");
  const { review, plan } = f.planned(["--adopt", "codex:AGENTS.md"]);
  assert.equal(outcome(f.cli(["apply", "--plan", review])).status, "installed");
  assert.equal(lstatSync(target).isFile(), true);
  assert.equal(
    outcome(f.cli(["rollback", "--receipt", plan.run.receipt])).status,
    "rolled-back",
  );
  assert.equal(readFileSync(target, "utf8"), "personal rules\n");
});

test("a target changed after planning stops apply without overwriting it", (t) => {
  const f = installFixture(t, { realRuntime: true });
  const { review } = f.planned();
  const target = path.join(f.home, ".codex/AGENTS.md");
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, "later change\n");
  const result = f.cli(["apply", "--plan", review]);
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(target, "utf8"), "later change\n");
});

test("an added member in a frozen skill blocks apply before any target changes", (t) => {
  const f = installFixture(t);
  const { review, plan } = f.planned();
  const extra = path.join(plan.run.source, "delivery/skills/gh/extra.txt");
  writeFileSync(extra, "added after planning\n");
  assert.ok(
    refusal(() => applyInstallPlan(review, { HOME: f.home })).some(
      (problem) =>
        problem.code === "candidate-changed" &&
        problem.path === path.join(plan.run.source, "delivery/skills/gh"),
    ),
  );
  assert.equal(existsSync(plan.run.receipt), false);
  assert.equal(existsSync(path.join(f.home, ".codex/AGENTS.md")), false);
});

test("a late Claude failure restores both products and only its own empty directories", (t) => {
  const f = installFixture(t);
  const skills = path.join(f.home, ".claude/skills");
  mkdirSync(skills, { recursive: true });
  writeFileSync(path.join(skills, "unrelated"), "keep\n");
  const { review, plan } = f.planned();
  chmodSync(skills, 0o500);
  let result: ReturnType<typeof applyInstallPlan>;
  try {
    result = applyInstallPlan(review, { HOME: f.home });
  } finally {
    chmodSync(skills, 0o700);
  }
  assert.equal(result.status, "failed-rolled-back", JSON.stringify(result));
  assert.ok(result.steps.restored > 0);
  assert.equal(result.steps.conflicts, 0);
  for (const [target] of expectedTargets(f.home, plan.run.source))
    assert.equal(existsSync(target), false, target);
  assert.equal(readFileSync(path.join(skills, "unrelated"), "utf8"), "keep\n");
  assert.equal(existsSync(path.join(f.home, ".codex/policy")), false);
  assert.equal(
    verifyInstallation(plan.run.receipt, { HOME: f.home }).verified,
    true,
  );
});

test("V4 plans are rejected by the V5 installer", (t) => {
  const f = installFixture(t);
  const { review } = f.planned();
  const bytes = JSON.parse(readFileSync(review, "utf8"));
  bytes.version = 4;
  writeFileSync(review, JSON.stringify(bytes));
  const result = f.cli(["apply", "--plan", review]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unsupported plan version/);
});

test("verification reports a changed installed target", (t) => {
  const f = installFixture(t, { realRuntime: true });
  const { review, plan } = f.planned();
  assert.equal(outcome(f.cli(["apply", "--plan", review])).status, "installed");
  const target = path.join(f.home, ".codex/AGENTS.md");
  unlinkSync(target);
  symlinkSync(path.join(f.home, "wrong"), target);
  const result = f.cli(["verify", "--receipt", plan.run.receipt]);
  assert.notEqual(result.status, 0);
  assert.equal(lstatSync(target).isSymbolicLink(), true);
});

test("rollback refuses receipt bindings changed after installation", (t) => {
  const f = installFixture(t);
  const adopted = path.join(f.home, ".codex/policy/writing.md");
  mkdirSync(path.dirname(adopted), { recursive: true });
  writeFileSync(adopted, "personal policy\n");
  const { review, plan } = f.planned(["--adopt", "codex:policy/writing.md"]);
  assert.equal(applyInstallPlan(review, { HOME: f.home }).status, "installed");
  const original = readFileSync(plan.run.receipt);
  const adoptedOrder = plan.targets.find(
    (target) => target.path === adopted,
  )!.order;
  const cases: [string, (receipt: InstallReceiptV5) => void, string][] = [
    [
      "runtime",
      (receipt) => {
        receipt.runtime.node = path.join(f.base, "other-node");
      },
      "receipt-binding-mismatch",
    ],
    [
      "step",
      (receipt) => {
        receipt.steps.at(-1)!.order = plan.targets.length;
      },
      "receipt-step-mismatch",
    ],
    [
      "missing step",
      (receipt) => {
        receipt.steps.pop();
      },
      "receipt-step-mismatch",
    ],
    [
      "backup",
      (receipt) => {
        receipt.steps.find(
          (step) => step.order === adoptedOrder,
        )!.backup!.path = path.join(f.base, "other-backup");
      },
      "receipt-step-mismatch",
    ],
    [
      "directory",
      (receipt) => {
        receipt.directories[0]!.path = f.base;
      },
      "receipt-directory-mismatch",
    ],
    [
      "missing directory",
      (receipt) => {
        receipt.directories.pop();
      },
      "receipt-directory-mismatch",
    ],
  ];
  for (const [name, tamper, code] of cases) {
    const receipt = readReceipt(plan.run.receipt);
    tamper(receipt);
    writeFileSync(plan.run.receipt, JSON.stringify(receipt));
    assert.deepEqual(
      refusal(() => rollbackInstallation(plan.run.receipt, { HOME: f.home })),
      [{ code, path: plan.run.receipt }],
      name,
    );
    assert.equal(readReceipt(plan.run.receipt).status, "installed", name);
    assert.equal(lstatSync(adopted).isFile(), true, name);
    writeFileSync(plan.run.receipt, original);
  }
  assert.equal(
    rollbackInstallation(plan.run.receipt, { HOME: f.home }).status,
    "rolled-back",
  );
  assert.equal(readFileSync(adopted, "utf8"), "personal policy\n");
});

test("rollback preserves Claude drift while restoring Codex and can later finish", (t) => {
  const f = installFixture(t, { realRuntime: true });
  const { review, plan } = f.planned();
  assert.equal(outcome(f.cli(["apply", "--plan", review])).status, "installed");
  const target = path.join(f.home, ".claude/policy/review.md");
  const installed = readFileSync(target);
  const installedMode = lstatSync(target).mode & 0o7777;
  unlinkSync(target);
  writeFileSync(target, "later owner\n");
  const first = f.cli(["rollback", "--receipt", plan.run.receipt]);
  assert.equal(first.status, 1, first.stderr);
  assert.equal(
    (JSON.parse(first.stdout) as { status: string }).status,
    "rollback-incomplete",
  );
  assert.equal(readFileSync(target, "utf8"), "later owner\n");
  assert.equal(existsSync(path.join(f.home, ".codex/AGENTS.md")), false);
  unlinkSync(target);
  writeFileSync(target, installed);
  chmodSync(target, installedMode);
  assert.equal(
    outcome(f.cli(["rollback", "--receipt", plan.run.receipt])).status,
    "rolled-back",
  );
  assert.equal(existsSync(target), false);
});

test("interrupted recovery reads target state despite a restored phase", (t) => {
  const f = installFixture(t);
  const { review, plan } = f.planned();
  assert.equal(applyInstallPlan(review, { HOME: f.home }).status, "installed");
  const receipt = readReceipt(plan.run.receipt);
  const [landed, missed] = receipt.steps.slice(0, 2);
  assert.ok(landed && missed);
  landed.phase = "restored";
  missed.phase = "pending";
  receipt.status = "applying";
  writeFileSync(plan.run.receipt, JSON.stringify(receipt));
  const missedTarget = plan.targets[missed.order]!;
  unlinkSync(missedTarget.path);
  const recovered = rollbackInstallation(plan.run.receipt, { HOME: f.home });
  assert.equal(recovered.status, "rolled-back", JSON.stringify(recovered));
  assert.deepEqual(
    readReceipt(plan.run.receipt)
      .steps.slice(0, 2)
      .map((step) => step.phase),
    ["restored", "not-applied"],
  );
  for (const [target] of expectedTargets(f.home, plan.run.source))
    assert.equal(existsSync(target), false, target);
});

test("interrupted recovery retains a matching temporary until ownership is resolved", (t) => {
  const f = installFixture(t);
  const { review, plan } = f.planned();
  assert.equal(applyInstallPlan(review, { HOME: f.home }).status, "installed");
  const receipt = readReceipt(plan.run.receipt);
  const step = receipt.steps[0]!;
  step.phase = "pending";
  receipt.status = "applying";
  writeFileSync(plan.run.receipt, JSON.stringify(receipt));
  const target = plan.targets[step.order]!;
  unlinkSync(target.path);
  const temporary = path.join(
    path.dirname(target.path),
    `.agents-install-${plan.run.id}-${step.order}`,
  );
  writeFileSync(temporary, readFileSync(target.source));
  chmodSync(temporary, lstatSync(target.source).mode & 0o7777);
  assert.equal(
    rollbackInstallation(plan.run.receipt, { HOME: f.home }).status,
    "rollback-incomplete",
  );
  assert.deepEqual(readFileSync(temporary), readFileSync(target.source));
  unlinkSync(temporary);
  assert.equal(
    rollbackInstallation(plan.run.receipt, { HOME: f.home }).status,
    "rolled-back",
  );
});

test("interrupted replacement restores the prior file or skill while retaining the temporary", (t) => {
  for (const kind of ["file", "directory"] as const) {
    const f = installFixture(t);
    const target = path.join(
      f.home,
      kind === "file" ? ".codex/AGENTS.md" : ".codex/skills/gh",
    );
    mkdirSync(kind === "file" ? path.dirname(target) : target, {
      recursive: true,
    });
    if (kind === "file") writeFileSync(target, "personal rules\n");
    else {
      writeFileSync(path.join(target, "SKILL.md"), "personal skill\n");
      symlinkSync("SKILL.md", path.join(target, "shortcut"));
    }
    const { review, plan } = f.planned([
      "--adopt",
      kind === "file" ? "codex:AGENTS.md" : "codex:gh",
    ]);
    assert.equal(
      applyInstallPlan(review, { HOME: f.home }).status,
      "installed",
    );
    const receipt = readReceipt(plan.run.receipt);
    const step = receipt.steps.find(
      (entry) => plan.targets[entry.order]?.path === target,
    );
    assert.ok(step?.backup);
    step.phase = "pending";
    receipt.status = "applying";
    writeFileSync(plan.run.receipt, JSON.stringify(receipt));
    const temporary = path.join(
      path.dirname(target),
      `.agents-install-${plan.run.id}-${step.order}`,
    );
    const prior = path.join(
      path.dirname(target),
      `.agents-prior-${plan.run.id}-${step.order}`,
    );
    cpSync(step.backup.path, prior, {
      recursive: true,
      verbatimSymlinks: true,
    });
    assert.deepEqual(readTargetState(prior), plan.targets[step.order]?.before);
    renameSync(target, temporary);
    const recovered = rollbackInstallation(plan.run.receipt, { HOME: f.home });
    assert.equal(recovered.status, "rollback-incomplete", kind);
    assert.deepEqual(readTargetState(target), plan.targets[step.order]?.before);
    assert.equal(existsSync(prior), false);
    assert.equal(existsSync(temporary), true);
    assert.equal(
      readReceipt(plan.run.receipt).steps.find(
        (entry) => entry.order === step.order,
      )?.phase,
      "conflict-retained",
    );
    rmSync(temporary, { recursive: true, force: true });
    assert.equal(
      rollbackInstallation(plan.run.receipt, { HOME: f.home }).status,
      "rolled-back",
      kind,
    );
  }
});

test("an interrupted receipt missing a step cannot claim complete recovery", (t) => {
  const f = installFixture(t);
  mkdirSync(path.join(f.home, ".codex/skills"), { recursive: true });
  const { review, plan } = f.planned();
  assert.equal(applyInstallPlan(review, { HOME: f.home }).status, "installed");
  const receipt = readReceipt(plan.run.receipt);
  const missing = receipt.steps.pop()!;
  const link = plan.targets[missing.order]!.path;
  receipt.status = "applying";
  writeFileSync(plan.run.receipt, JSON.stringify(receipt));
  const recovered = rollbackInstallation(plan.run.receipt, { HOME: f.home });
  assert.equal(recovered.status, "rollback-incomplete");
  assert.equal(lstatSync(link).isDirectory(), true);
});

test("status reports the exact verified installation of both products", (t) => {
  const f = installFixture(t, { realRuntime: true });
  const { review, plan } = f.planned();
  assert.equal(outcome(f.cli(["apply", "--plan", review])).status, "installed");
  const status = outcome(f.cli(["status"]));
  assert.equal(status.status, "installed");
  assert.equal((status as { run?: string }).run, plan.run.id);
  assert.equal(status.candidate?.sha256, plan.candidate.sha256);
  unlinkSync(path.join(f.home, ".codex/AGENTS.md"));
  assert.equal(outcome(f.cli(["status"])).status, "indeterminate");
});

test("status identifies an installed uncommitted candidate by its digest", (t) => {
  const f = installFixture(t, { realRuntime: true });
  f.put("delivery/AGENTS.md", "uncommitted rules\n", 0o600);
  f.writeReport();
  const { review, plan } = f.planned();
  assert.equal(outcome(f.cli(["apply", "--plan", review])).status, "installed");
  const status = outcome(f.cli(["status"]));
  assert.equal(status.status, "installed");
  assert.equal(status.candidate?.sha256, plan.candidate.sha256);
  assert.equal(
    readFileSync(path.join(f.home, ".codex/AGENTS.md"), "utf8"),
    "uncommitted rules\n",
  );
});

test("a later unfinished run makes status indeterminate even when older targets verify", (t) => {
  const f = installFixture(t);
  const first = f.planned();
  assert.equal(
    applyInstallPlan(first.review, { HOME: f.home }).status,
    "installed",
  );
  f.git("commit", "--quiet", "--allow-empty", "-m", "next candidate");
  f.writeReport();
  const second = f.planned();
  assert.equal(
    applyInstallPlan(second.review, { HOME: f.home }).status,
    "installed",
  );
  assert.equal(
    rollbackInstallation(second.plan.run.receipt, { HOME: f.home }).status,
    "rolled-back",
  );
  assert.equal(
    verifyInstallation(first.plan.run.receipt, { HOME: f.home }).verified,
    true,
  );
  assert.equal(readCurrentInstallation({ HOME: f.home }).status, "installed");
  const receipt = readReceipt(second.plan.run.receipt);
  const firstStarted = readReceipt(first.plan.run.receipt).startedAt;
  receipt.startedAt = new Date(Date.parse(firstStarted) + 1000).toISOString();
  receipt.status = "failed-incomplete";
  writeFileSync(second.plan.run.receipt, JSON.stringify(receipt));
  const current = readCurrentInstallation({ HOME: f.home });
  assert.equal(current.status, "indeterminate");
  assert.deepEqual(current.interrupted, [second.plan.run.id]);
  assert.deepEqual(current.problems, []);
});

test("the frozen runtime applies and recovers after its source checkout is removed", (t) => {
  const f = installFixture(t, { realRuntime: true });
  const { review, plan } = f.planned();
  rmSync(f.checkout, { recursive: true, force: true });
  assert.equal(outcome(f.cli(["apply", "--plan", review])).status, "installed");
  rmSync(plan.run.source, { recursive: true, force: true });
  for (const product of ["codex", "claude"]) {
    for (const relative of [
      "skills/gh/SKILL.md",
      "skills/wechatide/skills/project-config/SKILL.md",
      "policy/review.md",
    ])
      assert.ok(
        readFileSync(path.join(f.home, `.${product}`, relative)).length > 0,
      );
    const tool = spawnSync(
      process.execPath,
      [path.join(f.home, `.${product}/tools/check-prose.mjs`), "--version"],
      { encoding: "utf8", env: { HOME: f.home }, timeout: 10_000 },
    );
    assert.equal(tool.status, 0, tool.stderr);
    assert.match(tool.stdout.trim(), /^\d+\.\d+\.\d+$/);
  }
  assert.equal(
    outcome(f.cli(["verify", "--receipt", plan.run.receipt])).verified,
    true,
  );
  assert.equal(
    outcome(f.cli(["rollback", "--receipt", plan.run.receipt])).status,
    "rolled-back",
  );
});

test("an old snapshot link requires adoption and becomes independent of its source", (t) => {
  const f = installFixture(t, { realRuntime: true });
  const previous = path.join(f.deploy, "20260927T000000000Z-aaaaaaaaaaaa");
  const previousSource = path.join(previous, "source");
  mkdirSync(previous, { recursive: true });
  cpSync(f.checkout, previousSource, { recursive: true });
  const target = path.join(f.home, ".codex/AGENTS.md");
  const source = path.join(previousSource, "delivery/AGENTS.md");
  link(source, target);
  const currentMachine = machineIdentity();
  assert.ok(currentMachine);
  const previousPlanPath = path.join(previous, "deployment-plan.json");
  const previousReceiptPath = path.join(previous, "deployment-receipt.json");
  const previousBody = {
    version: 3,
    run: {
      id: path.basename(previous),
      directory: previous,
      source: previousSource,
      plan: previousPlanPath,
      receipt: previousReceiptPath,
    },
    host: { machine: currentMachine },
    roots: { codex: { path: path.join(f.home, ".codex") } },
    targets: [{ order: 0, path: target, link: source }],
  };
  const previousDigest = canonicalDigest(previousBody);
  writeFileSync(
    previousPlanPath,
    JSON.stringify({ ...previousBody, sha256: previousDigest }),
  );
  writeFileSync(
    previousReceiptPath,
    JSON.stringify({
      version: 3,
      status: "installed",
      plan: { path: previousPlanPath, sha256: previousDigest },
      run: { id: path.basename(previous), directory: previous },
      steps: [{ order: 0, phase: "applied" }],
    }),
  );
  assert.ok(
    f
      .gaps(f.plan())
      .some(
        (gap) => gap.code === "adopt-required" && gap.key === "codex:AGENTS.md",
      ),
  );
  const { review, plan } = f.planned(["--adopt", "codex:AGENTS.md"]);
  assert.equal(
    plan.targets.find((item) => item.path === target)?.adopted,
    true,
  );
  const expected = readFileSync(
    plan.targets.find((item) => item.path === target)!.source,
  );
  assert.equal(outcome(f.cli(["apply", "--plan", review])).status, "installed");
  const parkedPrevious = path.join(f.base, "parked-previous");
  const parkedCandidate = path.join(f.base, "parked-candidate");
  renameSync(previousSource, parkedPrevious);
  renameSync(plan.run.source, parkedCandidate);
  try {
    assert.equal(
      outcome(f.cli(["verify", "--receipt", plan.run.receipt])).verified,
      true,
    );
    const status = outcome(f.cli(["status"]));
    assert.equal(status.status, "indeterminate");
    assert.deepEqual(status.unreadable, [previousReceiptPath]);
    assert.equal(lstatSync(target).isFile(), true);
    assert.deepEqual(readFileSync(target), expected);
  } finally {
    renameSync(parkedCandidate, plan.run.source);
    renameSync(parkedPrevious, previousSource);
  }
  assert.equal(
    outcome(f.cli(["rollback", "--receipt", plan.run.receipt])).status,
    "rolled-back",
  );
  assert.equal(readlinkSync(target), source);
});

test("an adopted skill directory restores its full tree and keeps unlisted siblings", (t) => {
  const f = installFixture(t, { realRuntime: true });
  const skillsRoot = path.join(f.home, ".codex/skills");
  const target = path.join(skillsRoot, "gh");
  mkdirSync(path.join(target, "references"), { recursive: true });
  writeFileSync(path.join(target, "SKILL.md"), "personal skill\n");
  writeFileSync(path.join(target, "references/note.txt"), "private note\n");
  symlinkSync("references/note.txt", path.join(target, "note-link"));
  writeFileSync(path.join(skillsRoot, "unlisted.txt"), "keep\n");
  const { review, plan } = f.planned(["--adopt", "codex:gh"]);
  assert.equal(outcome(f.cli(["apply", "--plan", review])).status, "installed");
  assert.equal(lstatSync(target).isDirectory(), true);
  assert.equal(
    readFileSync(path.join(skillsRoot, "unlisted.txt"), "utf8"),
    "keep\n",
  );
  assert.equal(
    outcome(f.cli(["rollback", "--receipt", plan.run.receipt])).status,
    "rolled-back",
  );
  assert.equal(
    readFileSync(path.join(target, "SKILL.md"), "utf8"),
    "personal skill\n",
  );
  assert.equal(
    readFileSync(path.join(target, "references/note.txt"), "utf8"),
    "private note\n",
  );
  assert.equal(
    readlinkSync(path.join(target, "note-link")),
    "references/note.txt",
  );
  assert.equal(
    readFileSync(path.join(skillsRoot, "unlisted.txt"), "utf8"),
    "keep\n",
  );
});

test("status reports unsupported receipt versions as indeterminate", (t) => {
  const f = installFixture(t, { realRuntime: true });
  const { review, plan } = f.planned();
  assert.equal(outcome(f.cli(["apply", "--plan", review])).status, "installed");
  const bytes = JSON.parse(readFileSync(plan.run.receipt, "utf8"));
  bytes.version = 4;
  writeFileSync(plan.run.receipt, JSON.stringify(bytes));
  const previous = readFileSync(plan.run.receipt);
  for (const command of ["verify", "rollback"]) {
    const result = f.cli([command, "--receipt", plan.run.receipt]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unsupported receipt version/);
    assert.deepEqual(readFileSync(plan.run.receipt), previous);
  }
  assert.equal(outcome(f.cli(["status"])).status, "indeterminate");
  bytes.version = 99;
  writeFileSync(plan.run.receipt, JSON.stringify(bytes));
  const status = outcome(f.cli(["status"]));
  assert.equal(status.status, "indeterminate");
  assert.deepEqual(status.unreadable, [plan.run.receipt]);
});

test("Claude receives only skills and their dependencies and preserves product configuration", (t) => {
  const f = installFixture(t);
  const personal = [
    "CLAUDE.md",
    "AGENTS.md",
    "settings.json",
    "policy/models.md",
    "policy/rust.md",
    "policy/sql.md",
    "policy/claude-code.md",
    "capability/codex.toml",
    "skills/unlisted/SKILL.md",
  ];
  for (const relative of personal) {
    const target = path.join(f.home, ".claude", relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `personal: ${relative}\n`);
  }
  const { review, plan } = f.planned();
  assert.equal(applyInstallPlan(review, { HOME: f.home }).status, "installed");
  assert.ok(
    !plan.targets.some(
      (target) =>
        target.product === "claude" &&
        ["instructions", "capability", "guide"].includes(target.category),
    ),
  );
  for (const relative of personal)
    assert.equal(
      readFileSync(path.join(f.home, ".claude", relative), "utf8"),
      `personal: ${relative}\n`,
    );
  assert.equal(
    rollbackInstallation(plan.run.receipt, { HOME: f.home }).status,
    "rolled-back",
  );
  for (const relative of personal)
    assert.equal(
      readFileSync(path.join(f.home, ".claude", relative), "utf8"),
      `personal: ${relative}\n`,
    );
});

test("Claude root or target drift refuses apply before changing either product", (t) => {
  const f = installFixture(t);
  const { review, plan } = f.planned();
  assert.ok(
    refusal(() =>
      applyInstallPlan(review, {
        HOME: f.home,
        CLAUDE_CONFIG_DIR: path.join(f.home, "elsewhere"),
      }),
    ).some(
      (problem) =>
        problem.code === "roots-changed" && problem.root === "claude",
    ),
  );
  const target = path.join(f.home, ".claude/skills/gh");
  mkdirSync(target, { recursive: true });
  writeFileSync(path.join(target, "new-owner.txt"), "retain\n");
  assert.ok(
    refusal(() => applyInstallPlan(review, { HOME: f.home })).some(
      (problem) => problem.code === "target-changed" && problem.path === target,
    ),
  );
  assert.equal(existsSync(plan.run.receipt), false);
  assert.equal(existsSync(path.join(f.home, ".codex/AGENTS.md")), false);
  assert.equal(
    readFileSync(path.join(target, "new-owner.txt"), "utf8"),
    "retain\n",
  );
});
