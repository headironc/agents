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
import type { InstallReceipt } from "../../scripts/install-records.ts";
import {
  machineIdentity,
  readTargetState,
} from "../../scripts/install-state.ts";
import { canonicalDigest, readSourceEntries } from "../../scripts/source.ts";
import {
  expectedTargets,
  installFixture,
  legacyPlan,
  link,
} from "./fixtures.ts";

function outcome(result: {
  status: number | null;
  stdout: string;
  stderr: string;
}) {
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout) as {
    status: string;
    run?: string;
    verified?: boolean;
    unreadable?: string[];
    candidate?: { sha256: string };
    products?: string[];
  };
}

function readReceipt(file: string): InstallReceipt {
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

for (const product of ["codex", "claude", "antigravity"] as const) {
  test(`${product}-only installation and standalone recovery preserve every unselected product`, (t) => {
    const f = installFixture(t, { realRuntime: true, products: [product] });
    const roots = {
      codex: path.join(f.home, ".codex"),
      claude: path.join(f.home, ".claude"),
      antigravity: path.join(f.home, ".gemini/antigravity-cli"),
    };
    const selected = roots[product];
    const unselected = (["codex", "claude", "antigravity"] as const).filter(
      (name) => name !== product,
    );
    const before = new Map<string, ReturnType<typeof readTargetState>>();
    try {
      for (const name of unselected) {
        const root = roots[name];
        mkdirSync(path.join(root, "skills/gh"), {
          recursive: true,
          mode: 0o700,
        });
        writeFileSync(path.join(root, "skills/gh/personal.txt"), name);
        chmodSync(root, 0o500);
        before.set(name, readTargetState(root));
      }
      mkdirSync(path.join(selected, "skills/gh"), { recursive: true });
      writeFileSync(
        path.join(selected, "skills/gh/original.txt"),
        "restore this tree\n",
      );
      const original = readTargetState(path.join(selected, "skills/gh"));
      const environment =
        product === "codex"
          ? { CLAUDE_CONFIG_DIR: "invalid-unselected-claude" }
          : { CODEX_HOME: "invalid-unselected-codex" };
      const unchanged = () => {
        for (const name of unselected)
          assert.deepEqual(readTargetState(roots[name]), before.get(name));
      };
      const { review, plan } = f.planned(
        ["--adopt", `${product}:gh`],
        environment,
      );
      const expected = expectedTargets(
        f.home,
        plan.run.source,
        undefined,
        undefined,
        [product],
      );
      assert.deepEqual(
        plan.targets.map((target) => [target.path, target.source]),
        expected,
      );
      unchanged();
      rmSync(f.checkout, { recursive: true, force: true });
      const applied = outcome(f.cli(["apply", "--plan", review], environment));
      assert.equal(applied.status, "installed");
      assert.deepEqual(applied.products, [product]);
      for (const [target, source] of expected)
        assert.deepEqual(readTargetState(target), readTargetState(source));
      unchanged();
      rmSync(plan.run.source, { recursive: true, force: true });
      unlinkSync(review);
      const verified = outcome(
        f.cli(["verify", "--receipt", plan.run.receipt], environment),
      );
      assert.equal(verified.verified, true);
      assert.deepEqual(verified.products, [product]);
      const status = outcome(f.cli(["status"], environment));
      assert.equal(status.status, "installed");
      assert.deepEqual(status.products, [product]);
      const rolledBack = spawnSync(
        path.join(plan.run.runtime, "node"),
        [
          path.join(plan.run.runtime, "install.mjs"),
          "rollback",
          "--receipt",
          plan.run.receipt,
        ],
        {
          env: { PATH: process.env.PATH, HOME: f.home, ...environment },
          encoding: "utf8",
          timeout: 60_000,
        },
      );
      assert.equal(outcome(rolledBack).status, "rolled-back");
      assert.deepEqual(
        readTargetState(path.join(selected, "skills/gh")),
        original,
      );
      assert.equal(
        outcome(f.cli(["verify", "--receipt", plan.run.receipt], environment))
          .verified,
        true,
      );
      assert.equal(outcome(f.cli(["status"], environment)).status, "none");
      unchanged();
    } finally {
      for (const name of unselected)
        if (existsSync(roots[name])) chmodSync(roots[name], 0o700);
    }
  });

  test(`${product}-only late failure restores selected targets without creating other product roots`, (t) => {
    const f = installFixture(t, { products: [product] });
    const root = path.join(
      f.home,
      product === "antigravity" ? ".gemini/antigravity-cli" : `.${product}`,
    );
    const skills = path.join(root, "skills");
    mkdirSync(skills, { recursive: true });
    writeFileSync(path.join(skills, "personal"), "retained\n");
    const { plan, review } = f.planned();
    chmodSync(skills, 0o500);
    try {
      const result = applyInstallPlan(review, { HOME: f.home });
      assert.equal(result.status, "failed-rolled-back", JSON.stringify(result));
      assert.ok(result.steps.restored > 0);
      assert.deepEqual(result.products, [product]);
    } finally {
      chmodSync(skills, 0o700);
    }
    for (const target of plan.targets)
      assert.equal(existsSync(target.path), false, target.path);
    for (const name of ["codex", "claude", "antigravity"] as const)
      if (name !== product)
        assert.equal(
          existsSync(
            path.join(f.home, name === "antigravity" ? ".gemini" : `.${name}`),
          ),
          false,
        );
    assert.equal(
      readFileSync(path.join(skills, "personal"), "utf8"),
      "retained\n",
    );
    assert.equal(
      verifyInstallation(plan.run.receipt, { HOME: f.home }).verified,
      true,
    );
  });
}

for (const version of [5, 6] as const)
  test(`V${version} plans retain their original roots, records and recovery layout`, (t) => {
    const f = installFixture(t, {
      realRuntime: true,
      products:
        version === 5
          ? ["codex", "claude"]
          : ["codex", "claude", "antigravity"],
    });
    const { plan, review } = legacyPlan(f.planned(), version);
    const original = readFileSync(plan.run.plan);
    const third = path.join(f.home, ".gemini/antigravity-cli");
    if (version === 5) {
      mkdirSync(third, { recursive: true });
      writeFileSync(path.join(third, "personal.txt"), "not in V5\n");
    }
    const thirdBefore = version === 5 ? readTargetState(third) : undefined;
    const selected =
      version === 5 ? ["codex", "claude"] : ["codex", "claude", "antigravity"];
    assert.equal(
      outcome(f.cli(["apply", "--plan", review])).status,
      "installed",
    );
    assert.equal(readReceipt(plan.run.receipt).version, version);
    assert.deepEqual(outcome(f.cli(["status"])).products, selected);
    assert.ok(
      plan.run.runtime.startsWith(path.join(f.home, ".codex/.agents-install")),
    );
    rmSync(f.checkout, { recursive: true, force: true });
    rmSync(plan.run.source, { recursive: true, force: true });
    assert.equal(
      outcome(f.cli(["verify", "--receipt", plan.run.receipt])).verified,
      true,
    );
    assert.equal(
      outcome(f.cli(["rollback", "--receipt", plan.run.receipt])).status,
      "rolled-back",
    );
    assert.equal(
      outcome(f.cli(["verify", "--receipt", plan.run.receipt])).verified,
      true,
    );
    assert.deepEqual(readFileSync(plan.run.plan), original);
    if (version === 5) assert.deepEqual(readTargetState(third), thirdBefore);
  });

test("retired Codex targets remain recoverable from a V7 record", (t) => {
  const f = installFixture(t, { realRuntime: true, products: ["codex"] });
  const members = [
    ["policy", "policy/codex-sessions.md"],
    ["tool", "tools/codex-sessions.mjs"],
    ["capability", "capability/codex-sessions.toml"],
  ] as const;
  const codex = path.join(f.home, ".codex");
  for (const [, relative] of members)
    mkdirSync(path.dirname(path.join(codex, relative)), { recursive: true });

  // Recreate the retired members in a synthetic frozen plan without using the active manifest.
  const { plan, review } = f.planned([
    "--target",
    "codex:capability/codex.toml",
  ]);
  assert.equal(plan.version, 7);
  plan.targets = members.map(([category, relative], order) => {
    const source = path.join(plan.run.source, "delivery", relative);
    mkdirSync(path.dirname(source), { recursive: true });
    writeFileSync(source, `Historical ${relative}\n`, { mode: 0o600 });
    return {
      order,
      kind: "file",
      category,
      product: "codex",
      key: `codex:${relative}`,
      path: path.join(codex, relative),
      source,
      installed: readTargetState(source),
      before: { type: "absent" },
      action: "create",
      adopted: false,
      backup: null,
    };
  });
  plan.selectedTargets = plan.targets.map((target) => target.key).sort();
  plan.candidate.entries = readSourceEntries(plan.run.source, [
    ...plan.candidate.entries.map((entry) => entry.path),
    ...members.map(([, relative]) => `delivery/${relative}`),
  ]);
  plan.candidate.sha256 = canonicalDigest(plan.candidate.entries);
  const { sha256: _digest, ...body } = plan;
  const bytes = JSON.stringify({ ...body, sha256: canonicalDigest(body) });
  chmodSync(plan.run.plan, 0o600);
  writeFileSync(plan.run.plan, bytes);
  chmodSync(plan.run.plan, 0o400);
  writeFileSync(review, bytes);

  assert.equal(outcome(f.cli(["apply", "--plan", review])).status, "installed");
  for (const target of plan.targets)
    assert.deepEqual(readTargetState(target.path), target.installed);
  const before = outcome(f.cli(["status"]));
  assert.equal(before.status, "installed");
  assert.equal(before.run, plan.run.id);
  assert.deepEqual(before.unreadable, []);

  const next = f.planned(["--target", "codex:capability/codex.toml"]);
  assert.equal(
    outcome(f.cli(["apply", "--plan", next.review])).status,
    "installed",
  );
  const after = outcome(f.cli(["status"]));
  assert.equal(after.status, "installed");
  assert.equal(after.run, next.plan.run.id);
  assert.deepEqual(after.unreadable, []);

  rmSync(plan.run.source, { recursive: true, force: true });
  assert.equal(
    outcome(f.cli(["verify", "--receipt", plan.run.receipt])).verified,
    true,
  );
  assert.equal(
    outcome(f.cli(["rollback", "--receipt", plan.run.receipt])).status,
    "rolled-back",
  );
  for (const target of plan.targets)
    assert.equal(existsSync(target.path), false, target.key);
  assert.equal(
    outcome(f.cli(["verify", "--receipt", next.plan.run.receipt])).verified,
    true,
  );
  assert.equal(readFileSync(plan.run.plan, "utf8"), bytes);
});

test("five selected files install and roll back from a Codex worktree without changing unselected targets", (t) => {
  const f = installFixture(t, {
    realRuntime: true,
    worktree: ".codex/worktrees/fixture/agents",
  });
  const names = [
    "README.md",
    "policy/models.md",
    "policy/claude-code.md",
    "policy/antigravity.md",
    "AGENTS.md",
  ];
  const codex = path.join(f.home, ".codex");
  const originals = new Map<string, ReturnType<typeof readTargetState>>();
  for (const name of names) {
    const target = path.join(codex, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `previous ${name}\n`, { mode: 0o600 });
    originals.set(target, readTargetState(target));
  }
  const unselected = [
    path.join(codex, "skills/wechatide"),
    path.join(f.home, ".claude/skills/wechatide"),
  ];
  for (const directory of unselected) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(directory, "SKILL.md"), "personal skill\n", {
      mode: 0o600,
    });
  }
  const args = names.flatMap((name) => [
    "--target",
    `codex:${name}`,
    "--adopt",
    `codex:${name}`,
  ]);
  const { plan, review } = f.planned(args);
  writeFileSync(
    path.join(unselected[0]!, "SKILL.md"),
    "changed after planning\n",
  );
  const states = unselected.map(readTargetState);
  assert.equal(plan.targets.length, 5);
  assert.equal(outcome(f.cli(["apply", "--plan", review])).status, "installed");
  for (const target of plan.targets)
    assert.deepEqual(
      readTargetState(target.path),
      readTargetState(target.source),
    );
  assert.equal(
    outcome(f.cli(["verify", "--receipt", plan.run.receipt])).verified,
    true,
  );
  const status = f.cli(["status"]);
  assert.deepEqual(
    JSON.parse(status.stdout).selectedTargets,
    names.map((name) => `codex:${name}`).sort(),
  );
  assert.deepEqual(unselected.map(readTargetState), states);
  assert.equal(f.git("rev-parse", "--show-toplevel").trim(), f.checkout);
  assert.equal(
    outcome(f.cli(["rollback", "--receipt", plan.run.receipt])).status,
    "rolled-back",
  );
  for (const [target, state] of originals)
    assert.deepEqual(readTargetState(target), state);
  assert.deepEqual(unselected.map(readTargetState), states);
  assert.equal(
    outcome(f.cli(["verify", "--receipt", plan.run.receipt])).verified,
    true,
  );
});

test("selected review files and complete skills preserve other targets through refusal, apply and rollback", (t) => {
  const f = installFixture(t, { realRuntime: true });
  const keys = [
    "codex:gh",
    "codex:policy/review.md",
    "claude:gh",
    "claude:policy/review.md",
  ];
  const originals = new Map<string, ReturnType<typeof readTargetState>>();
  const untouched: string[] = [];
  for (const product of ["codex", "claude"]) {
    const root = path.join(f.home, `.${product}`);
    const gh = path.join(root, "skills/gh");
    cpSync(path.join(f.checkout, "delivery/skills/gh"), gh, {
      recursive: true,
    });
    writeFileSync(
      path.join(gh, "references/operations.md"),
      "previous operations\n",
    );
    originals.set(gh, readTargetState(gh));
    const review = path.join(root, "policy/review.md");
    mkdirSync(path.dirname(review), { recursive: true });
    writeFileSync(review, "previous review\n", { mode: 0o600 });
    originals.set(review, readTargetState(review));
    const other = path.join(root, "skills/wechatide");
    mkdirSync(other, { recursive: true, mode: 0o700 });
    writeFileSync(
      path.join(other, "SKILL.md"),
      "retain personal permissions\n",
      { mode: 0o400 },
    );
    untouched.push(other);
  }
  const states = untouched.map(readTargetState);
  const { plan, review } = f.planned(
    keys.flatMap((key) => ["--target", key, "--adopt", key]),
  );
  assert.deepEqual(plan.selectedTargets, [...keys].sort());
  assert.equal(plan.targets.length, 4);
  assert.equal(
    plan.targets.filter((target) => target.kind === "directory").length,
    2,
  );
  const drift = path.join(f.home, ".claude/skills/gh/new-owner.txt");
  writeFileSync(drift, "third party\n");
  assert.equal(f.cli(["apply", "--plan", review]).status, 1);
  assert.equal(existsSync(plan.run.receipt), false);
  for (const target of plan.targets.filter((target) => target.kind === "file"))
    assert.deepEqual(readTargetState(target.path), originals.get(target.path));
  unlinkSync(drift);
  assert.equal(outcome(f.cli(["apply", "--plan", review])).status, "installed");
  for (const target of plan.targets)
    assert.deepEqual(
      readTargetState(target.path),
      readTargetState(target.source),
    );
  assert.equal(
    outcome(f.cli(["verify", "--receipt", plan.run.receipt])).verified,
    true,
  );
  assert.deepEqual(untouched.map(readTargetState), states);
  assert.equal(
    outcome(f.cli(["rollback", "--receipt", plan.run.receipt])).status,
    "rolled-back",
  );
  for (const [target, state] of originals)
    assert.deepEqual(readTargetState(target), state);
  assert.deepEqual(untouched.map(readTargetState), states);
  assert.equal(
    outcome(f.cli(["verify", "--receipt", plan.run.receipt])).verified,
    true,
  );
});

test("explicit products apply, read back and restore Antigravity without touching App settings or unlisted skills", (t) => {
  const f = installFixture(t, { realRuntime: true });
  const root = path.join(f.home, ".gemini/antigravity-cli");
  const existing = path.join(root, "skills/gh");
  mkdirSync(existing, { recursive: true });
  writeFileSync(path.join(existing, "SKILL.md"), "original\n");
  writeFileSync(path.join(root, "skills/unmanaged"), "retained\n");
  const app = path.join(f.home, ".gemini/config");
  mkdirSync(app, { recursive: true });
  writeFileSync(path.join(app, "settings.json"), "personal\n");
  const { plan, review } = f.planned([
    "--product",
    "codex",
    "--product",
    "claude",
    "--product",
    "antigravity",
    "--adopt",
    "antigravity:gh",
  ]);
  assert.equal(outcome(f.cli(["apply", "--plan", review])).status, "installed");
  assert.equal(readReceipt(plan.run.receipt).version, 7);
  for (const target of plan.targets)
    assert.deepEqual(
      readTargetState(target.path),
      readTargetState(target.source),
    );
  assert.equal(
    outcome(f.cli(["verify", "--receipt", plan.run.receipt])).verified,
    true,
  );
  assert.equal(outcome(f.cli(["status"])).status, "installed");
  assert.equal(existsSync(path.join(root, "AGENTS.md")), false);
  assert.equal(
    outcome(f.cli(["rollback", "--receipt", plan.run.receipt])).status,
    "rolled-back",
  );
  assert.equal(
    readFileSync(path.join(existing, "SKILL.md"), "utf8"),
    "original\n",
  );
  assert.equal(
    readFileSync(path.join(root, "skills/unmanaged"), "utf8"),
    "retained\n",
  );
  assert.equal(
    readFileSync(path.join(app, "settings.json"), "utf8"),
    "personal\n",
  );
});

test("a late Antigravity failure restores all three products", (t) => {
  const f = installFixture(t);
  const directory = path.join(f.home, ".gemini/antigravity-cli/skills");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "unmanaged"), "keep\n");
  const { plan, review } = f.planned([
    "--product",
    "codex",
    "--product",
    "claude",
    "--product",
    "antigravity",
  ]);
  chmodSync(directory, 0o500);
  try {
    const result = applyInstallPlan(review, { HOME: f.home });
    assert.equal(result.status, "failed-rolled-back", JSON.stringify(result));
    assert.ok(result.steps.restored > 0);
  } finally {
    chmodSync(directory, 0o700);
  }
  for (const target of plan.targets)
    assert.equal(existsSync(target.path), false, target.path);
  assert.equal(
    readFileSync(path.join(directory, "unmanaged"), "utf8"),
    "keep\n",
  );
  assert.equal(
    verifyInstallation(plan.run.receipt, { HOME: f.home }).verified,
    true,
  );
});

test("rollback retains third-party Antigravity changes and restores other selected products", (t) => {
  const f = installFixture(t, { realRuntime: true });
  const { plan, review } = f.planned([
    "--product",
    "codex",
    "--product",
    "claude",
    "--product",
    "antigravity",
  ]);
  outcome(f.cli(["apply", "--plan", review]));
  const target = path.join(
    f.home,
    ".gemini/antigravity-cli/skills/gh/SKILL.md",
  );
  writeFileSync(target, "third-party change\n");
  const result = rollbackInstallation(plan.run.receipt, { HOME: f.home });
  assert.equal(result.status, "rollback-incomplete");
  assert.equal(readFileSync(target, "utf8"), "third-party change\n");
  for (const member of plan.targets.filter(
    (member) => member.product !== "antigravity",
  ))
    assert.equal(existsSync(member.path), false);
});

for (const product of ["codex", "claude", "antigravity"] as const)
  test(`status preserves a recorded ${product} root identity failure even when installed bytes match`, (t) => {
    const f = installFixture(t);
    const root = path.join(
      f.home,
      product === "antigravity" ? ".gemini/antigravity-cli" : `.${product}`,
    );
    mkdirSync(root, { recursive: true });
    const { plan, review } = f.planned([
      "--product",
      "codex",
      "--product",
      "claude",
      "--product",
      "antigravity",
    ]);
    assert.equal(
      applyInstallPlan(review, { HOME: f.home }).status,
      "installed",
    );
    const moved = path.join(f.home, `original-${product}-root`);
    renameSync(root, moved);
    cpSync(moved, root, { recursive: true });
    const verified = verifyInstallation(plan.run.receipt, { HOME: f.home });
    assert.equal(verified.verified, false);
    assert.ok(
      verified.problems.some(
        (problem) =>
          problem.code === "root-anchor-changed" && problem.root === product,
      ),
    );
    const current = readCurrentInstallation({ HOME: f.home });
    assert.equal(current.status, "indeterminate");
    assert.ok(
      current.problems.some(
        (problem) =>
          problem.code === "root-anchor-changed" && problem.root === product,
      ),
    );
  });

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

test("V4 plans are rejected by the current installer", (t) => {
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
  const cases: [string, (receipt: InstallReceipt) => void, string][] = [
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
