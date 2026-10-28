import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import { InstallPlanSchema } from "../../scripts/install-records.ts";
import {
  foreignOwnedMember,
  readCopiedTargetState,
  readTargetState,
} from "../../scripts/install-state.ts";
import { canonicalDigest } from "../../scripts/source.ts";
import {
  expectedTargets,
  installFixture,
  runtimeInputs,
  sha256,
  skills,
} from "./fixtures.ts";

function installDistinctProducts(
  f: ReturnType<typeof installFixture>,
  environment: NodeJS.ProcessEnv,
): void {
  const codex = environment.CODEX_HOME ?? path.join(f.home, ".codex");
  const claude = environment.CLAUDE_CONFIG_DIR ?? path.join(f.home, ".claude");
  const { plan, review } = f.planned([], environment);
  const expected = expectedTargets(f.home, plan.run.source, codex, claude);
  assert.equal(plan.roots.codex.path, codex);
  assert.equal(plan.roots.claude.path, claude);
  assert.deepEqual(
    plan.targets.map((target) => [target.path, target.source]),
    expected,
  );
  const apply = f.cli(["apply", "--plan", review], environment);
  assert.equal(apply.status, 0, apply.stderr + apply.stdout);
  assert.equal(JSON.parse(apply.stdout).status, "installed");
  assert.notEqual(lstatSync(codex).ino, lstatSync(claude).ino);
  for (const [target, source] of expected)
    assert.deepEqual(readTargetState(target), readTargetState(source));
  assert.deepEqual(readdirSync(claude).sort(), ["policy", "skills", "tools"]);
  assert.deepEqual(readdirSync(path.join(claude, "policy")).sort(), [
    "review.md",
    "tool-contracts.md",
    "writing.md",
  ]);
  assert.deepEqual(
    readdirSync(path.join(claude, "skills")).sort(),
    skills.claude,
  );
  const verified = f.cli(
    ["verify", "--receipt", plan.run.receipt],
    environment,
  );
  assert.equal(verified.status, 0, verified.stderr + verified.stdout);
  assert.equal(JSON.parse(verified.stdout).verified, true);
  assert.deepEqual(JSON.parse(verified.stdout).problems, []);
  const rollback = f.cli(
    ["rollback", "--receipt", plan.run.receipt],
    environment,
  );
  assert.equal(rollback.status, 0, rollback.stderr + rollback.stdout);
  assert.equal(JSON.parse(rollback.stdout).status, "rolled-back");
  for (const [target] of expected)
    assert.equal(lstatSync(target, { throwIfNoEntry: false }), undefined);
}

test("a plan binds both products to independent roots and shared source", (t) => {
  const f = installFixture(t);
  const { plan } = f.planned();
  const expected = expectedTargets(f.home, plan.run.source);
  assert.equal(plan.version, 5);
  assert.deepEqual(Object.keys(plan.roots).sort(), [
    "backup",
    "claude",
    "codex",
    "deploy",
    "home",
    "state",
  ]);
  assert.deepEqual(
    plan.targets.map((target) => [target.path, target.source]),
    expected,
  );
  assert.ok(
    plan.targets.every((target) =>
      target.path.startsWith(`${f.home}/.${target.product}/`),
    ),
  );
  assert.ok(
    plan.targets.every(
      (target) =>
        !target.path.includes("/.resources/") &&
        !target.path.includes("/.agents/"),
    ),
  );
});

test("custom product roots preserve the independent target contract", (t) => {
  const f = installFixture(t);
  const codex = path.join(f.home, "custom codex");
  const claude = path.join(f.home, "custom claude");
  const { plan } = f.planned(undefined, {
    CODEX_HOME: codex,
    CLAUDE_CONFIG_DIR: claude,
  });
  assert.equal(plan.roots.codex.path, codex);
  assert.deepEqual(
    plan.targets.map((target) => [target.path, target.source]),
    expectedTargets(f.home, plan.run.source, codex, claude),
  );
});

test("legacy deployment trees do not change the new plan or become targets", (t) => {
  const f = installFixture(t);
  for (const name of [".resources", ".agents", ".claude"]) {
    mkdirSync(path.join(f.home, name), { recursive: true });
    writeFileSync(path.join(f.home, name, "legacy.txt"), "retained\n");
  }
  const { plan } = f.planned();
  assert.ok(
    plan.targets.every((target) =>
      target.path.startsWith(`${f.home}/.${target.product}/`),
    ),
  );
  for (const name of [".resources", ".agents", ".claude"])
    assert.equal(
      readFileSync(path.join(f.home, name, "legacy.txt"), "utf8"),
      "retained\n",
    );
});

test("an existing Codex file requires explicit adoption and remains unchanged during planning", (t) => {
  const f = installFixture(t);
  const target = path.join(f.home, ".codex/AGENTS.md");
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, "personal rules\n");
  const blocked = f.plan();
  assert.ok(
    f
      .gaps(blocked)
      .some(
        (gap) => gap.code === "adopt-required" && gap.key === "codex:AGENTS.md",
      ),
  );
  assert.equal(readFileSync(target, "utf8"), "personal rules\n");
  const { plan } = f.planned(["--adopt", "codex:AGENTS.md"]);
  const entry = plan.targets.find((item) => item.path === target);
  assert.equal(entry?.adopted, true);
  assert.equal(entry?.before.type, "file");
  assert.ok(entry?.backup);
});

test("a backup owner mismatch is identified before copying an adopted target", (t) => {
  const f = installFixture(t);
  const root = path.join(f.base, "existing-skill");
  mkdirSync(root);
  writeFileSync(path.join(root, "member.txt"), "personal content\n");
  const owner = lstatSync(root).uid;
  assert.equal(foreignOwnedMember(root, owner), undefined);
  assert.equal(foreignOwnedMember(root, owner + 1), root);
});

test("an unreadable candidate target is a gap alongside independent conflicts", (t) => {
  const f = installFixture(t);
  f.put("delivery/AGENTS.md", Buffer.alloc(16 * 1024 * 1024 + 1), 0o600);
  f.writeReport();
  const existing = path.join(f.home, ".codex/README.md");
  mkdirSync(path.dirname(existing), { recursive: true });
  writeFileSync(existing, "personal guide\n");
  const gaps = f.gaps(f.plan());
  assert.ok(
    gaps.some(
      (gap) =>
        gap.code === "source-unreadable" &&
        gap.path === path.join(f.checkout, "delivery/AGENTS.md"),
    ),
  );
  assert.ok(
    gaps.some((gap) => gap.code === "adopt-required" && gap.path === existing),
  );
  assert.deepEqual(f.runs(), []);
});

test("an unused adoption key and an unsafe Codex root both fail closed", (t) => {
  const f = installFixture(t);
  assert.ok(
    f
      .gaps(f.plan(["--adopt", "codex:AGENTS.md"]))
      .some((gap) => gap.code === "adopt-unused"),
  );
  const linked = path.join(f.base, "linked-codex");
  symlinkSync(path.join(f.home, ".codex"), linked);
  assert.ok(
    f
      .gaps(f.plan([], { CODEX_HOME: linked }))
      .some((gap) => gap.code === "linked-or-invalid-root"),
  );
});

test("a stale source report cannot authorize a new plan", (t) => {
  const f = installFixture(t);
  f.put("delivery/AGENTS.md", "changed after report\n", 0o600);
  assert.ok(
    f.gaps(f.plan()).some((gap) => gap.code === "source-identity-mismatch"),
  );
});

test("an ignored member inside a delivered skill blocks planning", (t) => {
  const f = installFixture(t);
  f.put("delivery/skills/gh/.DS_Store", "ignored member\n", 0o600);
  assert.ok(
    f
      .gaps(f.plan())
      .some(
        (gap) =>
          gap.code === "source-coverage-missing" &&
          gap.path?.endsWith("/skills/gh/.DS_Store"),
      ),
  );
  assert.deepEqual(f.runs(), []);
});

test("a report cannot authorize an ignored candidate source", (t) => {
  const f = installFixture(t);
  const ignored = "scripts/.DS_Store";
  f.put(ignored, "ignored member\n", 0o600);
  assert.equal(f.git("check-ignore", ignored).trim(), ignored);
  f.writeReport({}, [...runtimeInputs, ignored]);
  assert.ok(
    f
      .gaps(f.plan())
      .some(
        (gap) =>
          gap.code === "source-coverage-missing" &&
          gap.path === path.join(f.checkout, ignored),
      ),
  );
  assert.deepEqual(f.runs(), []);
});

test("copied target state uses the installer's owner throughout a skill tree", (t) => {
  const f = installFixture(t);
  const root = path.join(f.base, "other-owner-source");
  mkdirSync(root);
  chmodSync(root, 0o750);
  const member = path.join(root, "member.txt");
  writeFileSync(member, "content\n");
  chmodSync(member, 0o640);
  symlinkSync("member.txt", path.join(root, "shortcut"));
  const copiedOwner = lstatSync(root).uid + 1;
  const copied = readCopiedTargetState(root, copiedOwner);
  assert.deepEqual(copied, {
    type: "directory",
    mode: 0o750,
    uid: copiedOwner,
    sha256: canonicalDigest([
      ["member.txt", "file", 0o640, copiedOwner, sha256("content\n")],
      ["shortcut", "link", "member.txt", copiedOwner],
    ]),
  });
  const actual = readTargetState(root);
  assert.equal(actual.type, "directory");
  assert.notDeepEqual(actual, copied);
});

test("unlisted skill content is reported by path without being traversed", (t) => {
  const f = installFixture(t);
  const personal = path.join(f.home, ".codex/skills/personal");
  mkdirSync(personal, { recursive: true });
  const large = path.join(personal, "large.bin");
  writeFileSync(large, "");
  truncateSync(large, 16 * 1024 * 1024 + 1);
  const { plan } = f.planned();
  assert.ok(
    plan.reported.some(
      (entry) => typeof entry === "string" && entry === personal,
    ),
  );
  assert.equal(lstatSync(large).size, 16 * 1024 * 1024 + 1);
});

test("current V5 records with detailed unlisted entries remain readable", (t) => {
  const f = installFixture(t);
  const personal = path.join(f.home, ".codex/skills/personal");
  mkdirSync(personal, { recursive: true });
  const { plan } = f.planned();
  const previous = structuredClone(plan);
  previous.reported = [{ path: personal, state: readTargetState(personal) }];
  const { sha256: _digest, ...body } = previous;
  previous.sha256 = canonicalDigest(body);
  assert.equal(InstallPlanSchema.safeParse(previous).success, true);
});

test("a passing report binds modified and untracked source without a commit", (t) => {
  const f = installFixture(t);
  f.put("delivery/AGENTS.md", "updated rules\n", 0o600);
  f.put("local-note.txt", "included input\n", 0o600);
  f.writeReport();
  const { plan } = f.planned();
  assert.equal(
    readFileSync(path.join(plan.run.source, "delivery/AGENTS.md"), "utf8"),
    "updated rules\n",
  );
  assert.equal(
    readFileSync(path.join(plan.run.source, "local-note.txt"), "utf8"),
    "included input\n",
  );
  f.put("later.txt", "not checked\n", 0o600);
  assert.ok(
    f.gaps(f.plan()).some((gap) => gap.code === "source-coverage-missing"),
  );
});

test("the plan schema rejects a target outside CODEX_HOME", (t) => {
  const f = installFixture(t);
  const { plan } = f.planned();
  const tampered = structuredClone(plan);
  tampered.targets[0]!.path = path.join(f.home, "outside.md");
  assert.equal(InstallPlanSchema.safeParse(tampered).success, false);
});

test("the plan requires machine identity", (t) => {
  const f = installFixture(t);
  const { plan } = f.planned();
  const withoutMachine = structuredClone(plan) as unknown as {
    host: { machine?: string };
  };
  delete withoutMachine.host.machine;
  assert.equal(InstallPlanSchema.safeParse(withoutMachine).success, false);
});

test("product-qualified adoption never claims the other product's same-named skill", (t) => {
  const f = installFixture(t);
  for (const product of ["codex", "claude"]) {
    const target = path.join(f.home, `.${product}/skills/gh`);
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "personal.txt"), product);
  }
  assert.equal(f.plan(["--adopt", "gh"]).status, 2);
  const gaps = f.gaps(f.plan(["--adopt", "codex:gh"]));
  assert.ok(
    gaps.some(
      (gap) => gap.code === "adopt-required" && gap.key === "claude:gh",
    ),
  );
  assert.deepEqual(f.runs(), []);
  const { plan } = f.planned(["--adopt", "codex:gh", "--adopt", "claude:gh"]);
  assert.deepEqual(
    plan.targets
      .filter((target) => target.adopted)
      .map((target) => target.key)
      .sort(),
    ["claude:gh", "codex:gh"],
  );
});

test("overlapping deployment, backup, source and private roots block before plan writes", (t) => {
  const f = installFixture(t);
  for (const environment of [
    { CLAUDE_CONFIG_DIR: path.join(f.home, ".codex") },
    { CLAUDE_CONFIG_DIR: path.join(f.home, ".codex/child") },
    { CODEX_HOME: path.join(f.home, ".claude/child") },
    { CLAUDE_CONFIG_DIR: path.join(f.home, ".codex/.agents-install") },
    { AGENTS_BACKUP_ROOT: path.join(f.home, ".claude/skills") },
    { AGENTS_BACKUP_ROOT: f.home },
    { CLAUDE_CONFIG_DIR: path.join(f.checkout, "installed") },
    { CLAUDE_CONFIG_DIR: path.join(f.deploy, "public") },
    { CLAUDE_CONFIG_DIR: f.outputs },
  ]) {
    assert.ok(
      f
        .gaps(f.plan([], environment))
        .some((gap) => gap.code === "path-collision"),
      JSON.stringify(environment),
    );
    assert.deepEqual(f.runs(), []);
  }
});

test("existing case variants use physical identity for root collisions", async (t) => {
  for (const scenario of [
    "product roots",
    "Claude child",
    "Codex child",
    "new children",
    "backup root",
  ] as const) {
    await t.test(scenario, (t) => {
      const f = installFixture(t, { realRuntime: true });
      const root = path.join(f.home, "Product");
      const alias = path.join(f.home, "product");
      mkdirSync(root);
      const aliasStat = lstatSync(alias, { throwIfNoEntry: false });
      const environment = {
        "product roots": { CODEX_HOME: root, CLAUDE_CONFIG_DIR: alias },
        "Claude child": {
          CODEX_HOME: root,
          CLAUDE_CONFIG_DIR: path.join(alias, "child"),
        },
        "Codex child": {
          CODEX_HOME: path.join(root, "child"),
          CLAUDE_CONFIG_DIR: alias,
        },
        "new children": {
          CODEX_HOME: path.join(root, "new"),
          CLAUDE_CONFIG_DIR: path.join(alias, "new"),
        },
        "backup root": {
          CLAUDE_CONFIG_DIR: root,
          AGENTS_BACKUP_ROOT: path.join(alias, "backups"),
        },
      }[scenario];
      if (aliasStat && aliasStat.ino === lstatSync(root).ino) {
        assert.ok(
          f
            .gaps(f.plan([], environment))
            .some((gap) => gap.code === "path-collision"),
          JSON.stringify(environment),
        );
        assert.deepEqual(f.runs(), []);
        assert.deepEqual(readdirSync(root), []);
        assert.deepEqual(readdirSync(f.outputs), []);
      } else {
        installDistinctProducts(f, environment);
      }
    });
  }
});

test("new case variants collide only on a case-insensitive filesystem", (t) => {
  const f = installFixture(t, { realRuntime: true });
  const aliasHome = path.join(path.dirname(f.home), "HOME");
  const aliasStat = lstatSync(aliasHome, { throwIfNoEntry: false });
  const environment = {
    CODEX_HOME: path.join(f.home, "NewProduct"),
    CLAUDE_CONFIG_DIR: path.join(f.home, "newproduct"),
  };
  if (aliasStat && aliasStat.ino === lstatSync(f.home).ino) {
    assert.ok(
      f
        .gaps(f.plan([], environment))
        .some((gap) => gap.code === "path-collision"),
    );
    assert.deepEqual(readdirSync(f.home), []);
    assert.deepEqual(readdirSync(f.outputs), []);
  } else {
    installDistinctProducts(f, environment);
  }
});

test("Claude roots reject relative values and linked ancestors", (t) => {
  const f = installFixture(t);
  assert.ok(
    f
      .gaps(f.plan([], { CLAUDE_CONFIG_DIR: "relative" }))
      .some((gap) => gap.code === "invalid-root"),
  );
  const linked = path.join(f.base, "linked-claude");
  symlinkSync(f.home, linked);
  assert.ok(
    f
      .gaps(f.plan([], { CLAUDE_CONFIG_DIR: path.join(linked, "claude") }))
      .some((gap) => gap.code === "linked-or-invalid-root"),
  );
  assert.deepEqual(f.runs(), []);
});

test("record validation binds product, path, source and backup even with a recomputed digest", (t) => {
  const f = installFixture(t);
  const { plan } = f.planned();
  for (const mutate of [
    (value: typeof plan) => {
      value.targets.find((target) => target.key === "codex:gh")!.product =
        "claude";
    },
    (value: typeof plan) => {
      value.targets.find((target) => target.key === "claude:gh")!.path =
        path.join(f.home, ".codex/skills/gh");
    },
    (value: typeof plan) => {
      value.targets.find((target) => target.key === "claude:gh")!.source =
        path.join(value.run.source, "delivery/AGENTS.md");
    },
    (value: typeof plan) => {
      value.targets.find(
        (target) => target.key === "claude:policy/review.md",
      )!.key = "claude:AGENTS.md";
    },
    (value: typeof plan) => {
      value.roots.claude.path = value.roots.codex.path;
    },
  ]) {
    const changed = structuredClone(plan);
    mutate(changed);
    const { sha256: _digest, ...body } = changed;
    changed.sha256 = canonicalDigest(body);
    assert.equal(InstallPlanSchema.safeParse(changed).success, false);
  }
});
