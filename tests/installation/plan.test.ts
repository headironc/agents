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
import {
  InstallPlanSchema,
  installPathCollisions,
} from "../../scripts/install-records.ts";
import {
  foreignOwnedMember,
  readCopiedTargetState,
  readTargetState,
} from "../../scripts/install-state.ts";
import { canonicalDigest } from "../../scripts/source.ts";
import { classifyTargets } from "../../scripts/install.ts";
import type { Gap } from "../../scripts/install-state.ts";
import {
  expectedTargets,
  installFixture,
  legacyPlan,
  runtimeInputs,
  sha256,
  skills,
  v8Plan,
} from "./fixtures.ts";

test("the CLI requires an explicit nonempty unique product selection before creating a plan", (t) => {
  const f = installFixture(t);
  const base = [
    "plan",
    "--source",
    f.checkout,
    "--report",
    f.reportPath,
    "--output",
    path.join(f.outputs, "plan.json"),
  ];
  for (const extra of [
    [],
    ["--product"],
    ["--product", ""],
    ["--product", "unknown"],
    ["--product", "claude"],
    ["--product", "codex,dsh"],
    ["--product", "Codex"],
    ["--product", "codex", "--product", "codex"],
    ["--product", "dsh", "--product", "dsh"],
    ["--product", "antigravity", "--product", "antigravity"],
    ["--include-product", "antigravity"],
    ["--product", "codex", "--include-product", "antigravity"],
  ]) {
    const result = f.cli([...base, ...extra]);
    assert.equal(result.status, 2, result.stderr + JSON.stringify(extra));
    assert.match(result.stderr, /product/);
    assert.deepEqual(readdirSync(f.home), []);
    assert.deepEqual(readdirSync(f.outputs), []);
  }
  const help = f.cli([]);
  assert.equal(help.status, 2);
  assert.match(help.stderr, /--product PRODUCT/);
  assert.match(help.stderr, /explicit selection required/);
});

test("retired skills without an active receipt remain unclaimed and reported", (t) => {
  const f = installFixture(t);
  const products = ["codex", "dsh", "antigravity"] as const;
  const roots = {
    codex: path.join(f.home, ".codex"),
    dsh: path.join(f.home, ".dsh"),
    antigravity: path.join(f.home, ".gemini/config"),
  };
  const previous = products.flatMap((product) => [
    path.join(roots[product], "skills/gh"),
    path.join(roots[product], "skills/gh-identity"),
  ]);
  for (const directory of previous) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      path.join(directory, "SKILL.md"),
      "previous retired package\n",
    );
  }
  const { plan } = f.planned(
    products.flatMap((product) => ["--product", product]),
  );
  for (const product of products) {
    const projectGuide = plan.targets.find(
      (target) => target.key === `${product}:project-guide`,
    );
    assert.ok(projectGuide);
    assert.ok(
      !plan.targets.some(
        (target) =>
          target.key === `${product}:gh` ||
          target.key === `${product}:gh-identity`,
      ),
    );
  }
  for (const directory of previous) {
    assert.ok(plan.reported.some((entry) => entry === directory));
    assert.equal(
      readFileSync(path.join(directory, "SKILL.md"), "utf8"),
      "previous retired package\n",
    );
  }
  for (const key of ["codex:gh", "codex:gh-identity"])
    assert.deepEqual(f.gaps(f.plan(["--product", "codex", "--target", key])), [
      { code: "invalid-target", key },
    ]);
});

test("new Codex plans report retired session files without claiming them", (t) => {
  const f = installFixture(t);
  const keys = [
    "codex:tools/codex-sessions.mjs",
    "codex:policy/codex-sessions.md",
    "codex:capability/codex-sessions.toml",
  ];
  const retired = keys.map((key) => path.join(f.home, ".codex", key.slice(6)));
  for (const file of retired) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "previous installation\n");
  }
  const { plan } = f.planned(["--product", "codex"]);
  for (const file of retired) {
    assert.ok(plan.reported.some((entry) => entry === file));
    assert.ok(plan.targets.every((target) => target.path !== file));
    assert.equal(readFileSync(file, "utf8"), "previous installation\n");
  }
  assert.deepEqual(
    f.gaps(
      f.plan([
        "--product",
        "codex",
        ...keys.flatMap((key) => ["--target", key]),
      ]),
    ),
    keys.toSorted().map((key) => ({ code: "invalid-target", key })),
  );
});

test("product roots record each explicit subset in canonical order and exclude every other product", (t) => {
  const f = installFixture(t);
  for (const selected of [
    ["codex"],
    ["dsh"],
    ["antigravity"],
    ["dsh", "codex"],
    ["codex", "antigravity"],
    ["antigravity", "dsh"],
    ["antigravity", "dsh", "codex"],
  ] as const) {
    const { plan } = f.planned(
      selected.flatMap((product) => ["--product", product]),
    );
    const canonical = (["codex", "dsh", "antigravity"] as const).filter(
      (product) => (selected as readonly string[]).includes(product),
    );
    assert.equal(plan.version, 10);
    assert.deepEqual(
      Object.keys(plan.roots).filter((key) =>
        ["codex", "dsh", "antigravity"].includes(key),
      ),
      canonical,
    );
    assert.deepEqual(
      plan.targets.map((target) => [target.path, target.source]),
      expectedTargets(f.home, plan.run.source, undefined, undefined, [
        ...canonical,
      ]),
    );
    assert.equal(
      plan.run.runtime,
      path.join(f.home, ".local/state/agents/install", plan.run.id, "runtime"),
    );
    assert.equal(
      plan.run.source,
      path.join(f.home, ".local/state/agents/install", plan.run.id, "source"),
    );
  }
});

test("unselected product variables do not block planning or permit target or adoption claims", (t) => {
  const f = installFixture(t, { products: ["dsh"] });
  const environment = { CODEX_HOME: "invalid-unused-root" };
  const { plan } = f.planned([], environment);
  assert.equal(plan.roots.codex, undefined);
  assert.ok(
    f
      .gaps(f.plan(["--target", "codex:AGENTS.md"], environment))
      .some((gap) => gap.code === "invalid-target"),
  );
  assert.ok(
    f
      .gaps(f.plan(["--adopt", "codex:project-guide"], environment))
      .some((gap) => gap.code === "adopt-unused"),
  );
});

test("V9 records reject empty product roots, unselected targets and legacy recovery paths", (t) => {
  const f = installFixture(t, { products: ["dsh"] });
  const { plan } = f.planned();
  for (const mutate of [
    (value: typeof plan) => {
      delete value.roots.dsh;
    },
    (value: typeof plan) => {
      value.version = 5;
    },
    (value: typeof plan) => {
      value.run.runtime = path.join(
        f.home,
        ".codex/.agents-install",
        value.run.id,
        "runtime",
      );
    },
  ]) {
    const changed = structuredClone(plan);
    mutate(changed);
    const { sha256: _digest, ...body } = changed;
    assert.equal(
      InstallPlanSchema.safeParse({ ...body, sha256: canonicalDigest(body) })
        .success,
      false,
    );
  }
});

test("V7 records retain their original Antigravity root and DSH instruction source", (t) => {
  const f = installFixture(t);
  const { plan } = v8Plan(
    f.planned([
      "--product",
      "dsh",
      "--product",
      "antigravity",
      "--target",
      "dsh:AGENTS.md",
      "--target",
      "antigravity:policy/writing.md",
    ]),
  );
  const legacy = structuredClone(plan);
  legacy.version = 7;
  legacy.roots.antigravity!.path = path.join(f.home, ".gemini/antigravity-cli");
  const instructions = legacy.targets.find(
    (target) => target.product === "dsh",
  )!;
  instructions.source = path.join(legacy.run.source, "delivery/AGENTS.md");
  const bind = (value: typeof plan) => {
    const { sha256: _digest, ...body } = value;
    return { ...body, sha256: canonicalDigest(body) };
  };
  assert.equal(InstallPlanSchema.safeParse(bind(legacy)).success, true);
  instructions.source = path.join(
    legacy.run.source,
    "delivery/products/dsh/AGENTS.md",
  );
  assert.equal(InstallPlanSchema.safeParse(bind(legacy)).success, false);
  const escaped = structuredClone(plan);
  escaped.targets.find((target) => target.product === "antigravity")!.path =
    path.join(f.home, ".gemini/policy/writing.md");
  assert.equal(InstallPlanSchema.safeParse(bind(escaped)).success, false);
});

test("V8 and V9 records reject each other's Antigravity asset paths", (t) => {
  const f = installFixture(t, { products: ["antigravity"] });
  const prepared = f.planned();
  const current = structuredClone(prepared.plan);
  const historical = v8Plan(prepared).plan;
  for (const plan of [historical, current]) {
    assert.equal(InstallPlanSchema.safeParse(plan).success, true);
    assert.equal(plan.roots.antigravity!.path, path.join(f.home, ".gemini"));
    const prefix = plan.version === 8 ? "antigravity-cli" : "config";
    for (const target of plan.targets) {
      const relative =
        target.category === "instructions"
          ? "AGENTS.md"
          : `${prefix}/${target.category === "skill" ? `skills/${target.key.slice(12)}` : target.key.slice(12)}`;
      assert.equal(target.path, path.join(f.home, ".gemini", relative));
      if (target.category === "instructions") continue;
      const changed = structuredClone(plan);
      changed.targets[target.order]!.path = target.path.replace(
        `/.gemini/${prefix}/`,
        `/.gemini/${plan.version === 8 ? "config" : "antigravity-cli"}/`,
      );
      const { sha256: _digest, ...body } = changed;
      assert.equal(
        InstallPlanSchema.safeParse({ ...body, sha256: canonicalDigest(body) })
          .success,
        false,
        `${plan.version}: ${target.key}`,
      );
    }
  }
});

function installDistinctProducts(
  f: ReturnType<typeof installFixture>,
  environment: NodeJS.ProcessEnv,
): void {
  const codex = environment.CODEX_HOME ?? path.join(f.home, ".codex");
  const dsh = environment.DSH_HOME ?? path.join(f.home, ".dsh");
  const { plan, review } = f.planned([], environment);
  const expected = expectedTargets(f.home, plan.run.source, codex, dsh);
  assert.equal(plan.roots.codex?.path, codex);
  assert.equal(plan.roots.dsh?.path, dsh);
  assert.deepEqual(
    plan.targets.map((target) => [target.path, target.source]),
    expected,
  );
  const apply = f.cli(["apply", "--plan", review], environment);
  assert.equal(apply.status, 0, apply.stderr + apply.stdout);
  assert.equal(JSON.parse(apply.stdout).status, "installed");
  assert.notEqual(lstatSync(codex).ino, lstatSync(dsh).ino);
  for (const [target, source] of expected)
    assert.deepEqual(readTargetState(target), readTargetState(source));
  assert.deepEqual(readdirSync(dsh).sort(), [
    "AGENTS.md",
    "capability",
    "policy",
    "skills",
    "tools",
  ]);
  assert.deepEqual(readdirSync(path.join(dsh, "policy")).sort(), [
    "common.md",
    "deepseek-harness.md",
    "execution.md",
    "review.md",
    "rust.md",
    "sql.md",
    "tool-contracts.md",
    "writing.md",
  ]);
  assert.deepEqual(readdirSync(path.join(dsh, "capability")).sort(), [
    "README.md",
    "chrome-devtools.mcp.json",
    "dsh-headless.patch.yml",
    "gcloud-mcp-denylist.json",
    "gcloud.mcp.json",
    "google-developer-knowledge.mcp.json",
    "google-observability.mcp.json",
    "google-storage.mcp.json",
    "rust-lints.toml",
    ...(process.platform === "darwin" ? ["sketch.mcp.json"] : []),
    "wx-docs.mcp.json",
  ]);
  assert.deepEqual(readdirSync(path.join(dsh, "skills")).sort(), skills.dsh);
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

test("explicit Antigravity selection contains its platform-compatible skills and dependencies", (t) => {
  const f = installFixture(t);
  const initial = f.planned().plan;
  assert.equal(initial.version, 10);
  assert.equal(initial.roots.antigravity, undefined);
  const unsupportedUpgrade = { ...initial, version: 6 };
  const { sha256: initialDigest, ...upgradedBody } = unsupportedUpgrade;
  assert.equal(initialDigest.length, 64);
  assert.equal(
    InstallPlanSchema.safeParse({
      ...upgradedBody,
      sha256: canonicalDigest(upgradedBody),
    }).success,
    false,
  );
  assert.ok(
    initial.targets.every((target) => target.product !== "antigravity"),
  );
  const { plan } = f.planned(["--product", "antigravity"]);
  const root = path.join(f.home, ".gemini");
  assert.equal(plan.version, 10);
  assert.equal(plan.roots.antigravity?.path, root);
  const { sha256: planDigest, ...v6Body } = plan;
  assert.equal(planDigest.length, 64);
  const downgraded = { ...v6Body, version: 5 };
  assert.equal(
    InstallPlanSchema.safeParse({
      ...downgraded,
      sha256: canonicalDigest(downgraded),
    }).success,
    false,
  );
  const selected = plan.targets.filter(
    (target) => target.product === "antigravity",
  );
  assert.deepEqual(
    selected.map((target) => target.key).sort(),
    [
      "antigravity:AGENTS.md",
      "antigravity:capability/chrome-devtools.mcp.json",
      "antigravity:capability/gcloud-mcp-denylist.json",
      "antigravity:capability/gcloud.mcp.json",
      "antigravity:capability/google-developer-knowledge.mcp.json",
      "antigravity:capability/google-observability.mcp.json",
      "antigravity:capability/google-storage.mcp.json",
      "antigravity:capability/rust-lints.toml",
      ...(process.platform === "darwin"
        ? ["antigravity:capability/sketch.mcp.json"]
        : []),
      "antigravity:capability/wx-docs.mcp.json",
      "antigravity:policy/antigravity.md",
      "antigravity:policy/review.md",
      "antigravity:policy/common.md",
      "antigravity:policy/execution.md",
      "antigravity:policy/rust.md",
      "antigravity:policy/sql.md",
      "antigravity:policy/tool-contracts.md",
      "antigravity:policy/writing.md",
      "antigravity:project-guide",
      ...(process.platform === "darwin" ? ["antigravity:sketch-native"] : []),
      "antigravity:tools/check-ids.mjs",
      "antigravity:tools/check-prose.mjs",
      "antigravity:tools/task-temp.mjs",
    ].sort(),
  );
  assert.ok(selected.every((target) => target.path.startsWith(`${root}/`)));
  assert.equal(f.plan(["--product", "unknown"]).status, 2);
  assert.equal(
    f.plan(["--product", "antigravity", "--product", "antigravity"]).status,
    2,
  );
});

test("Antigravity collisions and adoption gaps refuse the complete plan before target writes", (t) => {
  const f = installFixture(t);
  const root = path.join(f.home, ".gemini/config");
  mkdirSync(path.join(root, "skills/project-guide"), { recursive: true });
  writeFileSync(
    path.join(root, "skills/project-guide/SKILL.md"),
    "existing skill\n",
  );
  const extra = ["--product", "codex", "--product", "antigravity"];
  assert.ok(
    f
      .gaps(f.plan(extra))
      .some((gap) => gap.key === "antigravity:project-guide"),
  );
  const { plan } = f.planned([
    ...extra,
    "--adopt",
    "antigravity:project-guide",
  ]);
  assert.equal(
    plan.targets.find((target) => target.key === "antigravity:project-guide")
      ?.adopted,
    true,
  );
  assert.ok(
    f
      .gaps(
        f.plan([...extra, "--adopt", "antigravity:project-guide"], {
          CODEX_HOME: root,
        }),
      )
      .some((gap) => gap.code === "path-collision"),
  );
  assert.equal(
    lstatSync(path.join(f.home, ".codex/AGENTS.md"), { throwIfNoEntry: false }),
    undefined,
  );
});

test("a plan binds both products to independent roots and shared source", (t) => {
  const f = installFixture(t);
  const { plan } = f.planned();
  const expected = expectedTargets(f.home, plan.run.source);
  assert.equal(plan.version, 10);
  assert.deepEqual(Object.keys(plan.roots).sort(), [
    "backup",
    "codex",
    "deploy",
    "dsh",
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
  const dsh = path.join(f.home, "custom dsh");
  const { plan } = f.planned(undefined, {
    CODEX_HOME: codex,
    DSH_HOME: dsh,
  });
  assert.equal(plan.roots.codex?.path, codex);
  assert.deepEqual(
    plan.targets.map((target) => [target.path, target.source]),
    expectedTargets(f.home, plan.run.source, codex, dsh),
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
  f.put("delivery/skills/project-guide/.DS_Store", "ignored member\n", 0o600);
  assert.ok(
    f
      .gaps(f.plan())
      .some(
        (gap) =>
          gap.code === "source-coverage-missing" &&
          gap.path?.endsWith("/skills/project-guide/.DS_Store"),
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
  const { plan } = legacyPlan(f.planned(), 5);
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
  for (const product of ["codex", "dsh"]) {
    const target = path.join(f.home, `.${product}/skills/project-guide`);
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "personal.txt"), product);
  }
  assert.equal(f.plan(["--adopt", "project-guide"]).status, 2);
  assert.equal(f.plan(["--adopt", "claude:project-guide"]).status, 2);
  const gaps = f.gaps(f.plan(["--adopt", "codex:project-guide"]));
  assert.ok(
    gaps.some(
      (gap) => gap.code === "adopt-required" && gap.key === "dsh:project-guide",
    ),
  );
  assert.deepEqual(f.runs(), []);
  const { plan } = f.planned([
    "--adopt",
    "codex:project-guide",
    "--adopt",
    "dsh:project-guide",
  ]);
  assert.deepEqual(
    plan.targets
      .filter((target) => target.adopted)
      .map((target) => target.key)
      .sort(),
    ["codex:project-guide", "dsh:project-guide"],
  );
});

test("overlapping deployment, backup, source and private roots block before plan writes", (t) => {
  const f = installFixture(t);
  for (const environment of [
    { DSH_HOME: path.join(f.home, ".codex") },
    { DSH_HOME: path.join(f.home, ".codex/child") },
    { CODEX_HOME: path.join(f.home, ".dsh/child") },
    { DSH_HOME: path.join(f.home, ".codex/.agents-install") },
    { AGENTS_BACKUP_ROOT: path.join(f.home, ".dsh/skills") },
    { AGENTS_BACKUP_ROOT: f.home },
    { DSH_HOME: path.join(f.checkout, "installed") },
    { DSH_HOME: path.join(f.deploy, "public") },
    { DSH_HOME: f.outputs },
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

test("target selection rejects unknown, repeated, unselected-product and nested member keys", (t) => {
  const f = installFixture(t);
  assert.equal(
    f.plan(["--target", "codex:AGENTS.md", "--target", "codex:AGENTS.md"])
      .status,
    2,
  );
  assert.equal(f.plan(["--target", "AGENTS.md"]).status, 2);
  assert.equal(f.plan(["--target", "codex:project-guide/SKILL.md"]).status, 2);
  for (const key of ["codex:missing", "antigravity:policy/review.md"]) {
    assert.ok(
      f
        .gaps(f.plan(["--target", key]))
        .some((gap) => gap.code === "invalid-target" && gap.key === key),
    );
  }
  assert.deepEqual(f.runs(), []);
});

test("selected plans bind their exact file set and retain source collision protections", (t) => {
  const f = installFixture(t, { worktree: ".codex/worktrees/fixture/agents" });
  const { plan } = f.planned(["--target", "codex:AGENTS.md"]);
  assert.deepEqual(plan.selectedTargets, ["codex:AGENTS.md"]);
  assert.deepEqual(
    plan.targets.map((target) => target.key),
    ["codex:AGENTS.md"],
  );
  assert.ok(
    installPathCollisions(plan, (file) =>
      file === f.checkout ? path.join(f.home, ".codex/policy") : file,
    ).includes(path.join(f.home, ".codex")),
  );
  for (const mutate of [
    (value: typeof plan) => {
      value.selectedTargets = [];
    },
    (value: typeof plan) => {
      value.selectedTargets = ["codex:README.md"];
    },
    (value: typeof plan) => {
      value.selectedTargets!.push("codex:AGENTS.md");
    },
    (value: typeof plan) => {
      value.checkout.directory = path.join(f.home, ".codex");
    },
    (value: typeof plan) => {
      value.checkout.directory = path.join(f.home, ".codex/policy");
    },
    (value: typeof plan) => {
      value.checkout.directory = plan.run.source;
    },
    (value: typeof plan) => {
      value.checkout.directory = plan.roots.backup.path;
    },
  ]) {
    const changed = structuredClone(plan);
    mutate(changed);
    const { sha256: _digest, ...body } = changed;
    assert.equal(
      InstallPlanSchema.safeParse({ ...body, sha256: canonicalDigest(body) })
        .success,
      false,
      JSON.stringify({
        selectedTargets: changed.selectedTargets,
        checkout: changed.checkout.directory,
      }),
    );
  }
});

test("a source under an actual delivery directory is refused before plan writes", (t) => {
  const f = installFixture(t, { worktree: ".codex/skills/source" });
  assert.ok(
    f
      .gaps(f.plan(["--target", "codex:AGENTS.md"]))
      .some((gap) => gap.code === "path-collision"),
  );
  assert.deepEqual(f.runs(), []);
});

test("existing case variants use physical identity for root collisions", async (t) => {
  for (const scenario of [
    "product roots",
    "DSH child",
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
        "product roots": { CODEX_HOME: root, DSH_HOME: alias },
        "DSH child": {
          CODEX_HOME: root,
          DSH_HOME: path.join(alias, "child"),
        },
        "Codex child": {
          CODEX_HOME: path.join(root, "child"),
          DSH_HOME: alias,
        },
        "new children": {
          CODEX_HOME: path.join(root, "new"),
          DSH_HOME: path.join(alias, "new"),
        },
        "backup root": {
          DSH_HOME: root,
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
    DSH_HOME: path.join(f.home, "newproduct"),
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

test("distinct product roots can share newly created ancestor aliases", (t) => {
  const f = installFixture(t, { realRuntime: true });
  installDistinctProducts(f, {
    CODEX_HOME: path.join(f.home, "NewParent/codex"),
    DSH_HOME: path.join(f.home, "newparent/dsh"),
  });
});

test("a failed runtime preparation removes only this plan's newly created product and storage directories", (t) => {
  const f = installFixture(t, { products: ["dsh"] });
  f.put(
    ".cache/agents-build/install.mjs",
    "throw new Error('fixture runtime failure');\n",
    0o600,
  );
  f.writeReport();
  const result = f.plan();
  assert.equal(result.status, 1);
  assert.deepEqual(readdirSync(f.home), []);
  assert.deepEqual(readdirSync(f.outputs), []);
});

test("DeepSeek Harness roots reject relative values and linked ancestors", (t) => {
  const f = installFixture(t);
  assert.ok(
    f
      .gaps(f.plan([], { DSH_HOME: "relative" }))
      .some((gap) => gap.code === "invalid-root"),
  );
  const linked = path.join(f.base, "linked-dsh");
  symlinkSync(f.home, linked);
  assert.ok(
    f
      .gaps(f.plan([], { DSH_HOME: path.join(linked, "dsh") }))
      .some((gap) => gap.code === "linked-or-invalid-root"),
  );
  assert.deepEqual(f.runs(), []);
});

test("record validation binds product, path, source and backup even with a recomputed digest", (t) => {
  const f = installFixture(t);
  const { plan } = f.planned();
  for (const mutate of [
    (value: typeof plan) => {
      value.targets.find(
        (target) => target.key === "codex:project-guide",
      )!.product = "dsh";
    },
    (value: typeof plan) => {
      value.targets.find((target) => target.key === "dsh:project-guide")!.path =
        path.join(f.home, ".codex/skills/project-guide");
    },
    (value: typeof plan) => {
      value.targets.find(
        (target) => target.key === "dsh:project-guide",
      )!.source = path.join(value.run.source, "delivery/AGENTS.md");
    },
    (value: typeof plan) => {
      value.targets.find(
        (target) => target.key === "dsh:policy/review.md",
      )!.key = "dsh:AGENTS.md";
    },
    (value: typeof plan) => {
      value.roots.dsh!.path = value.roots.codex!.path;
    },
  ]) {
    const changed = structuredClone(plan);
    mutate(changed);
    const { sha256: _digest, ...body } = changed;
    changed.sha256 = canonicalDigest(body);
    assert.equal(InstallPlanSchema.safeParse(changed).success, false);
  }
});

test("V10 removal target schema rejects missing backup, non-null source, non-absent installed, or legacy versions", (t) => {
  const f = installFixture(t, { products: ["codex"] });
  const { plan } = f.planned();
  const skillIndex = plan.targets.findIndex(
    (target) => target.key === "codex:project-guide",
  );
  const original = plan.targets[skillIndex]!;
  const removal = {
    ...original,
    key: "codex:gh",
    path: path.join(f.home, ".codex/skills/gh"),
    source: null,
    installed: { type: "absent" as const },
    before: {
      type: "directory" as const,
      mode: 0o700,
      uid: process.getuid!(),
      sha256: "0".repeat(64),
    },
    action: "remove" as const,
    adopted: false,
    backup: path.join(plan.roots.backup.path, plan.run.id, String(skillIndex)),
  };
  const validPlan = structuredClone(plan);
  validPlan.targets[skillIndex] = removal;
  const { sha256: _validDigest, ...validBody } = validPlan;
  validPlan.sha256 = canonicalDigest(validBody);
  assert.equal(InstallPlanSchema.safeParse(validPlan).success, true);

  for (const mutate of [
    (value: typeof validPlan) => {
      value.version = 9;
    },
    (value: typeof validPlan) => {
      value.targets[skillIndex]!.backup = null;
    },
    (value: typeof validPlan) => {
      value.targets[skillIndex]!.source = original.source;
    },
    (value: typeof validPlan) => {
      value.targets[skillIndex]!.installed = original.installed;
    },
    (value: typeof validPlan) => {
      value.targets[skillIndex]!.before = { type: "absent" };
    },
    (value: typeof validPlan) => {
      value.targets[skillIndex]!.adopted = true;
    },
    (value: typeof validPlan) => {
      value.targets[skillIndex]!.path = path.join(f.home, ".dsh/skills/gh");
    },
  ]) {
    const changed = structuredClone(validPlan);
    mutate(changed);
    const { sha256: _digest, ...body } = changed;
    changed.sha256 = canonicalDigest(body);
    assert.equal(InstallPlanSchema.safeParse(changed).success, false);
  }
});

test("classifyTargets drops stale skill removal and keeps dense ordering if replaced before freeze", (t) => {
  const f = installFixture(t, { products: ["codex"] });
  const stalePath = path.join(f.home, ".codex/skills/gh");
  mkdirSync(stalePath, { recursive: true });
  writeFileSync(
    path.join(stalePath, "SKILL.md"),
    "---\nname: gh\ndescription: Historical repo-managed skill.\n---\n",
  );
  const expectedInstalled = readTargetState(stalePath);
  assert.equal(expectedInstalled.type, "directory");

  // Simulate a concurrent replacement after the initial receipt ownership check.
  writeFileSync(
    path.join(stalePath, "SKILL.md"),
    "---\nname: gh\ndescription: Replaced by user during planning.\n---\n",
  );
  const untouchedPath = path.join(f.home, ".codex/skills/stale-unmodified");
  mkdirSync(untouchedPath, { recursive: true });
  writeFileSync(
    path.join(untouchedPath, "SKILL.md"),
    "---\nname: stale-unmodified\ndescription: Unmodified stale skill.\n---\n",
  );
  const untouchedInstalled = readTargetState(untouchedPath);
  assert.equal(untouchedInstalled.type, "directory");

  const gaps: Gap[] = [];
  const missing = new Set<string>();
  const targets = classifyTargets(
    [
      {
        kind: "directory",
        category: "skill",
        product: "codex",
        key: "codex:gh",
        path: stalePath,
        source: null,
        relativeSource: null,
        expectedInstalled,
      },
      {
        kind: "directory",
        category: "skill",
        product: "codex",
        key: "codex:stale-unmodified",
        path: untouchedPath,
        source: null,
        relativeSource: null,
        expectedInstalled: untouchedInstalled,
      },
    ],
    [],
    path.join(f.home, ".local/state/agents/backup/20260101T000000Z-aaaa1111"),
    f.checkout,
    process.getuid!(),
    gaps,
    missing,
  );
  assert.deepEqual(gaps, []);
  assert.equal(targets.length, 1);
  assert.equal(targets[0]!.key, "codex:stale-unmodified");
  assert.equal(targets[0]!.order, 0);
  assert.ok(targets[0]!.backup?.endsWith("/0"));
});
