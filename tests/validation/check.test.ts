import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { loaderFailure } from "../../scripts/check-codex-loader.ts";
import {
  baseNotice,
  CheckReportSchema,
  checkSpecs,
} from "../../scripts/check.ts";
import {
  requiredRepositoryPaths,
  testPaths,
} from "../../scripts/check-catalog.ts";
import { fixtureEnvironment, fixtureRepository } from "./fixtures.ts";

const root = path.resolve(import.meta.dirname, "../..");
// Required paths are derived from the reviewed delivery slices, not discovery output.
const expectedTestPaths = {
  repository: [
    "tests/validation/check.test.ts",
    "tests/validation/source.test.ts",
    "tests/validation/check-secrets.test.ts",
    "tests/validation/tool-bootstrap.test.ts",
    "tests/validation/tool-contracts.test.ts",
    "tests/validation/skills.test.ts",
    "tests/validation/pre-commit.test.ts",
    "delivery/skills/alibabacloud-sms-send-short-message/tests/send-sms.test.mjs",
    "delivery/skills/wechatide/tests/call.test.mjs",
    "delivery/skills/wechatide/tests/check-install.test.mjs",
    "tests/check-prose.test.mjs",
    "tests/check-ids.test.mjs",
    "tests/bundle-tools.test.ts",
    "tests/validation/capability.test.ts",
    "tests/validation/refs.test.ts",
    "tests/installation/build.test.ts",
    "tests/installation/plan.test.ts",
    "tests/installation/apply.test.ts",
  ],
  validators: ["tests/validation/skill-validators.test.ts"],
  ci: ["tests/validation/workflow.test.ts"],
  docs: ["tests/validation/docs.test.ts"],
};
const required = [
  "AGENTS.md",
  "README.md",
  "delivery/README.md",
  ".gitignore",
  "package.json",
  "bun.lock",
  "tsconfig.json",
  ".markdownlint-cli2.jsonc",
  ".gitleaks.toml",
  "lychee.toml",
  "docs/tooling.md",
  "docs/review-gate.md",
  ...[
    "check.sh",
    "check.ts",
    "check-tests.ts",
    "check-catalog.ts",
    "delivery.ts",
    "source.ts",
    "check-docs.ts",
    "check-secrets.ts",
    "install-tools.sh",
    "tool-bootstrap.sh",
    "tool-versions.json",
    "skills.ts",
    "check-skills.ts",
    "check-tool-contracts.ts",
    "pre-commit.ts",
    "skill-validator.py",
    "skill-validator-versions.json",
    "check-prose.mjs",
    "check-ids.mjs",
    "bundle-tools.ts",
    "check-refs.ts",
    "check-codex-loader.ts",
  ].map((name) => `scripts/${name}`),
  "delivery/policy/tool-contracts.md",
  "delivery/AGENTS.md",
  "delivery/tools/check-prose.mjs",
  "delivery/tools/check-ids.mjs",
  ...["README.md", "codex.toml", "rust-lints.toml"].map(
    (name) => `delivery/capability/${name}`,
  ),
  ...[
    "personal-skills",
    "tool-inventory",
    "tool-contracts",
    "tool-bindings",
  ].map((name) => `config/${name}.txt`),
  "docs/skill-sources.md",
  "delivery/policy/writing.md",
  "delivery/policy/models.md",
  "delivery/policy/review.md",
  "delivery/policy/claude-code.md",
  "delivery/skills/figma-design-workflow/SKILL.md",
  "delivery/skills/gh/SKILL.md",
  "delivery/skills/gh/references/extended-commands.md",
  "delivery/skills/gh/references/operations.md",
  "delivery/skills/gh/LICENSE.txt",
  "scripts/check-report.ts",
  "delivery/skills/gh-identity/SKILL.md",
  "delivery/skills/gh-identity/references/auth-readiness.md",
  "delivery/skills/gh/references/workflow-authorization.md",
  "scripts/install.sh",
  "scripts/install.ts",
  "scripts/install-records.ts",
  "scripts/install-state.ts",
  "scripts/install-apply.ts",
  "scripts/install-current.ts",
  "scripts/build-install.ts",
  "scripts/check-install-build.ts",
  "tests/installation/fixtures.ts",
  "delivery/skills/alibabacloud-find-skills/SKILL.md",
  "delivery/skills/alibabacloud-find-skills/references/agentexplorer-api.md",
  "delivery/skills/alibabacloud-find-skills/references/verification-method.md",
  "delivery/skills/alibabacloud-find-skills/references/installation.md",
  "delivery/skills/alibabacloud-find-skills/references/search-examples.md",
  "delivery/skills/alibabacloud-sms-send-short-message/SKILL.md",
  "delivery/skills/alibabacloud-sms-send-short-message/references/ram-policies.md",
  "delivery/skills/alibabacloud-sms-send-short-message/references/sms-error-codes.md",
  "delivery/skills/alibabacloud-sms-send-short-message/references/sms-qualification.md",
  "delivery/skills/alibabacloud-sms-send-short-message/scripts/send_sms.sh",
  "delivery/skills/wechatide/SKILL.md",
  "delivery/skills/wechatide/references/capabilities.md",
  "delivery/skills/wechatide/references/cli.md",
  "delivery/skills/wechatide/references/tasks.md",
  "delivery/skills/wechatide/scripts/call.sh",
  "delivery/skills/wechatide/skills/automator/SKILL.md",
  "delivery/skills/wechatide/skills/cloudbase-operator/SKILL.md",
  "delivery/skills/wechatide/skills/cloudbase-operator/references/message-push.md",
  "delivery/skills/wechatide/skills/compiler/SKILL.md",
  "delivery/skills/wechatide/skills/debugger/SKILL.md",
  "delivery/skills/wechatide/skills/initializer/SKILL.md",
  "delivery/skills/wechatide/skills/installer/SKILL.md",
  "delivery/skills/wechatide/skills/installer/scripts/check-install.mjs",
  "delivery/skills/wechatide/skills/previewer/SKILL.md",
  "delivery/skills/wechatide/skills/project-config/SKILL.md",
  "delivery/skills/wechatide/skills/project-config/references/fields.md",
  "delivery/skills/wechatide/skills/project-manager/SKILL.md",
  ".githooks/pre-commit",
  ...Object.values(expectedTestPaths).flat(),
  ".github/CODEOWNERS",
  ".github/workflows/check.yml",
];
function verifyStructure(directory: string): void {
  for (const file of required) {
    const stat = lstatSync(path.join(directory, file));
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), file);
    assert.ok(stat.size > 0, file);
  }
}

test("delivered slices include every required real capability and reject a missing entry", (t) => {
  assert.deepEqual(requiredRepositoryPaths, required);
  verifyStructure(root);
  const directory = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "agents-structure-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const file of required) {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    writeFileSync(path.join(directory, file), "fixture\n");
  }
  verifyStructure(directory);
  rmSync(path.join(directory, "scripts/check.ts"));
  assert.throws(() => verifyStructure(directory));
});

function verifyTestInventory(
  directory: string,
  groups: Record<string, readonly string[]>,
): void {
  assert.deepEqual(
    groups,
    expectedTestPaths,
    "Test groups must match the independent slice inventory",
  );
  const actual = ["tests", "delivery/skills"].flatMap((owner) =>
    readdirSync(path.join(directory, owner), {
      recursive: true,
      encoding: "utf8",
    })
      .filter((file) => /\.test\.(?:ts|mjs)$/.test(file))
      .map((file) => `${owner}/${file.split(path.sep).join("/")}`),
  );
  assert.deepEqual(
    actual.sort(),
    Object.values(groups).flat().sort(),
    "Every validation test must be registered exactly once",
  );
}

test("test groups register every current validation test in its expected group", () => {
  verifyTestInventory(root, testPaths);
});

test("Codex loader accepts a temporary root reached through a symlink", (t) => {
  const directory = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "agents-loader-test-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const physical = path.join(directory, "physical");
  const alias = path.join(directory, "alias");
  mkdirSync(physical);
  symlinkSync(physical, alias, "dir");
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts/check-codex-loader.ts")],
    {
      cwd: root,
      env: { ...process.env, TMPDIR: alias, TMP: alias, TEMP: alias },
      encoding: "utf8",
      timeout: 20_000,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(
    result.stdout,
    /Codex loaded AGENTS\.md and 16 delivered skills; model policy is available on demand/,
  );
});

test("Codex loader rejects a model policy with no instruction entrypoint", (t) => {
  const f = fixtureRepository(t);
  const instructions = readFileSync(
    path.join(f.directory, "delivery/AGENTS.md"),
    "utf8",
  );
  f.put(
    "delivery/AGENTS.md",
    instructions.replace(/^.*\(policy\/models\.md\).*\n/m, ""),
  );
  const result = spawnSync(
    process.execPath,
    [path.join(f.directory, "scripts/check-codex-loader.ts")],
    { cwd: f.directory, env: f.environment, encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /instructions do not reference the model policy/);
});

test("Codex loader failures retain exit details and a bounded diagnostic", () => {
  const timeout = new Error("spawnSync timeout");
  const failed = loaderFailure({
    error: timeout,
    status: null,
    signal: "SIGTERM",
    stderr: `${"x".repeat(4096)}missing platform package`,
  });
  assert.equal(failed.cause, timeout);
  assert.match(failed.message, /status=none, signal=SIGTERM/);
  assert.match(failed.message, /missing platform package/);
  assert.ok(failed.message.length < 2200);

  const exited = loaderFailure({
    status: 7,
    signal: null,
    stderr: "bad input",
  });
  assert.match(exited.message, /status=7, signal=none, stderr="bad input"/);
});

for (const scenario of [
  "added",
  "missing",
  "unregistered",
  "duplicate",
  "misassigned",
] as const) {
  test(`test inventory rejects ${scenario} members`, (t) => {
    const directory = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "agents-test-inventory-")),
    );
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    mkdirSync(path.join(directory, "tests/validation"), { recursive: true });
    for (const file of Object.values(expectedTestPaths).flat()) {
      mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
      writeFileSync(path.join(directory, file), "fixture\n");
    }
    const groups = structuredClone(expectedTestPaths);
    verifyTestInventory(directory, groups);
    if (scenario === "added")
      writeFileSync(
        path.join(directory, "tests/validation/extra.test.ts"),
        "fixture\n",
      );
    if (scenario === "missing")
      rmSync(path.join(directory, "tests/validation/docs.test.ts"));
    if (scenario === "unregistered") groups.docs = [];
    if (scenario === "duplicate")
      groups.repository.push("tests/validation/docs.test.ts");
    if (scenario === "misassigned") {
      groups.docs = [];
      groups.repository.push("tests/validation/docs.test.ts");
    }
    assert.throws(() => verifyTestInventory(directory, groups), {
      code: "ERR_ASSERTION",
    });
  });
}

function fixture(t: TestContext) {
  const directory = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "agents-check-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const subdirectory of [
    "scripts",
    "tests/validation",
    "node_modules",
    ".cache/agents-tools/bin",
    ".cache/reports",
  ])
    mkdirSync(path.join(directory, subdirectory), { recursive: true });
  execFileSync("git", ["init", "--quiet", directory], {
    env: fixtureEnvironment(),
  });
  writeFileSync(path.join(directory, ".gitignore"), ".cache/\nnode_modules/\n");
  for (const file of [
    "check.ts",
    "check-tests.ts",
    "check-catalog.ts",
    "check.sh",
    "source.ts",
    "check-report.ts",
  ])
    cpSync(
      path.join(root, "scripts", file),
      path.join(directory, "scripts", file),
    );
  cpSync(
    path.join(root, "node_modules/zod"),
    path.join(directory, "node_modules/zod"),
    { recursive: true },
  );
  // Copy across read-only container mounts without sharing mutable runtime bytes.
  copyFileSync(
    process.execPath,
    path.join(directory, ".cache/agents-tools/bin/node"),
    constants.COPYFILE_FICLONE,
  );
  const zod = JSON.parse(
    readFileSync(path.join(root, "node_modules/zod/package.json"), "utf8"),
  ).version as string;
  // The document group declares the parsers its identifier check runs through, so the minimal
  // manifest carries them the same way it carries the linter: a pinned version and a stub package.
  const declared = [
    "markdownlint-cli2",
    "mdast-util-from-markdown",
    "mdast-util-gfm",
    "mdast-util-frontmatter",
    "micromark",
    "micromark-extension-gfm",
    "micromark-extension-frontmatter",
  ];
  writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({
      type: "module",
      engines: { node: process.versions.node },
      dependencies: { zod },
      devDependencies: Object.fromEntries(
        declared.map((name) => [name, "0.0.1"]),
      ),
    }),
  );
  for (const name of declared) {
    mkdirSync(path.join(directory, "node_modules", name));
    writeFileSync(
      path.join(directory, "node_modules", name, "package.json"),
      JSON.stringify({ version: "0.0.1" }),
    );
  }
  writeFileSync(
    path.join(directory, "scripts/tool-versions.json"),
    JSON.stringify({
      tools: {
        node: { versionFlag: "--version" },
        lychee: { version: "0.0.1", versionFlag: "--version" },
      },
    }),
  );
  writeFileSync(
    path.join(directory, ".cache/agents-tools/bin/lychee"),
    "#!/bin/sh\necho 0.0.1\n",
    { mode: 0o755 },
  );
  writeFileSync(
    path.join(directory, "scripts/check-docs.ts"),
    'console.log("document fixture completed");\n',
  );
  // The sentence and identifier checks read the same Markdown inventory the linter does, so the
  // minimal repository carries one document and a stub for each checker. Without the document the
  // group refuses to plan at all, which is the empty-inventory guard rather than a fixture detail.
  writeFileSync(path.join(directory, "fixture.md"), "# fixture\n");
  for (const [file, message] of [
    ["scripts/check-prose.mjs", "prose fixture completed"],
    ["scripts/check-ids.mjs", "identifier fixture completed"],
  ])
    writeFileSync(
      path.join(directory, file!),
      `console.log(${JSON.stringify(message)});\n`,
    );
  writeFileSync(
    path.join(directory, "tests/validation/docs.test.ts"),
    'import test from "node:test"; import assert from "node:assert/strict"; test("fixture", () => assert.equal(2 + 2, 4));\n',
  );
  const reportPath = path.join(directory, ".cache/reports/result.json");
  function run(
    args: string[] = ["docs", "markdown", "--report", reportPath],
    preload?: string,
    environment: NodeJS.ProcessEnv = {},
  ) {
    const result = spawnSync(
      path.join(directory, ".cache/agents-tools/bin/node"),
      [...(preload ? ["--import", preload] : []), "scripts/check.ts", ...args],
      {
        cwd: directory,
        env: { ...process.env, ...environment },
        encoding: "utf8",
        timeout: 20_000,
        killSignal: "SIGKILL",
        maxBuffer: 40 * 1024 * 1024,
      },
    );
    assert.equal(
      result.error,
      undefined,
      `${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`,
    );
    const report = existsSync(reportPath)
      ? CheckReportSchema.parse(JSON.parse(readFileSync(reportPath, "utf8")))
      : undefined;
    return { ...result, report, output: result.stdout + result.stderr };
  }
  return { directory, reportPath, run };
}

test("a missing required capability names the path before planning or executing checks", (t) => {
  const state = fixture(t);
  const result = state.run(["repository", "--report", state.reportPath]);
  assert.equal(result.status, 1, result.output);
  assert.deepEqual(result.report!.errors, [
    "Missing or invalid required capability: AGENTS.md",
  ]);
  assert.deepEqual(result.report!.planned, []);
  assert.deepEqual(result.report!.results, []);
  assert.equal(result.report!.source, null);
});

test("repository and all gates register both official product validators", async () => {
  for (const groups of [
    ["repository"],
    ["repository", "ci", "docs"],
  ] as const) {
    const specs = await checkSpecs([...groups], "all");
    for (const [product, name] of [
      ["codex", "Codex skill validation: 16 entries"],
      ["claude", "Claude skill validation: 15 entries"],
    ]) {
      const selected = specs.filter((spec) => spec.name === name);
      assert.equal(selected.length, 1);
      assert.deepEqual(selected[0]!.argv, [
        process.execPath,
        "scripts/check-skills.ts",
        product,
      ]);
      assert.ok(selected[0]!.tools.includes("python3"));
    }
  }
});

test("every check that reaches the pinned lychee declares it", async () => {
  // Declarations are what `verifyTools` reads, so an undeclared tool is neither version-checked
  // nor recorded while the check runs it anyway. None of these four names lychee in its argv; each
  // reaches it through the file it runs, so direct command names alone are insufficient.
  const specs = await checkSpecs(["repository", "ci", "docs"], "all");
  for (const name of [
    "Published references",
    "Documents",
    "Document runner regression",
    "Repository regression: tests/validation/refs.test.ts",
  ]) {
    const spec = specs.find((candidate) => candidate.name === name);
    assert.ok(spec, `${name} is not a registered check`);
    assert.ok(
      spec.tools.includes("lychee"),
      `${name} reaches lychee without declaring it`,
    );
  }
});

// Not "never fails the run": that property belongs to the caller, which this cannot reach. The
// caller keeps it by catching the write, and no test here pins it.
test("a stale base is reported, and silent wherever the answer would be noise", (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "agents base "));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const environment = fixtureEnvironment();
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-C",
        directory,
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.invalid",
        ...args,
      ],
      {
        env: environment,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  execFileSync("git", ["-C", directory, "init", "-q", "-b", "main"], {
    env: environment,
    stdio: ["ignore", "ignore", "ignore"],
  });
  git("commit", "-q", "--allow-empty", "--no-gpg-sign", "-m", "one");
  git("branch", "-q", "stale");
  for (const message of ["two", "three"])
    git("commit", "-q", "--allow-empty", "--no-gpg-sign", "-m", message);
  git("update-ref", "refs/remotes/origin/main", "HEAD");

  git("switch", "-q", "stale");
  const notice = baseNotice(directory);
  assert.match(notice ?? "", /2 commits behind/);
  const redirected = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import { baseNotice } from './scripts/check.ts'; console.log(JSON.stringify(baseNotice(process.argv[1])))",
      directory,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...fixtureEnvironment(),
        GIT_DIR: path.join(directory, "missing.git"),
        GIT_WORK_TREE: directory,
      },
    },
  );
  assert.equal(redirected.status, 0, redirected.stderr);
  assert.equal(JSON.parse(redirected.stdout), notice);
  // It has to say what it cannot know. The comparison is against the last fetch, not the forge.
  assert.match(notice ?? "", /this machine fetched/);
  // One commit is the common case and reads as a defect when the count is pasted into a plural.
  git("switch", "-q", "-c", "one-behind", "refs/remotes/origin/main~1");
  assert.match(baseNotice(directory) ?? "", /1 commit behind/);

  // Silence everywhere it would be noise, because none of these is a defect: an offline machine, a
  // fresh clone and a fixture repository all look like one of them.
  git("switch", "-q", "main");
  assert.equal(baseNotice(directory), null, "equal to the base");
  git("commit", "-q", "--allow-empty", "--no-gpg-sign", "-m", "ahead");
  assert.equal(baseNotice(directory), null, "ahead of the base");
  git("update-ref", "-d", "refs/remotes/origin/main");
  assert.equal(baseNotice(directory), null, "no base ref at all");
  assert.equal(baseNotice(path.dirname(directory)), null, "not a repository");
});

test("the real checker refuses every missing R5 delivery member before execution", (t) => {
  const f = fixtureRepository(t);
  for (const file of required) {
    if (existsSync(path.join(f.directory, file))) continue;
    mkdirSync(path.dirname(path.join(f.directory, file)), { recursive: true });
    cpSync(path.join(root, file), path.join(f.directory, file));
  }
  const reportPath = path.join(f.directory, ".cache/missing-member.json");
  for (const file of [
    "delivery/skills/gh-identity/SKILL.md",
    "delivery/skills/figma-design-workflow/SKILL.md",
    "delivery/skills/gh-identity/references/auth-readiness.md",
    "delivery/skills/gh/references/workflow-authorization.md",
    "docs/skill-sources.md",
    "delivery/policy/writing.md",
    "delivery/policy/models.md",
    "scripts/check-prose.mjs",
    "scripts/check-ids.mjs",
    "scripts/bundle-tools.ts",
    "delivery/tools/check-prose.mjs",
    "delivery/tools/check-ids.mjs",
    "tests/check-prose.test.mjs",
    "tests/check-ids.test.mjs",
    "tests/bundle-tools.test.ts",
    "delivery/capability/README.md",
    "delivery/capability/codex.toml",
    "delivery/capability/rust-lints.toml",
    "tests/validation/capability.test.ts",
    "delivery/skills/gh/SKILL.md",
    "delivery/skills/gh/references/extended-commands.md",
    "delivery/skills/gh/references/operations.md",
    "delivery/skills/gh/LICENSE.txt",
    "delivery/skills/alibabacloud-find-skills/SKILL.md",
    "delivery/skills/alibabacloud-find-skills/references/agentexplorer-api.md",
    "delivery/skills/alibabacloud-find-skills/references/verification-method.md",
    "delivery/skills/alibabacloud-find-skills/references/installation.md",
    "delivery/skills/alibabacloud-find-skills/references/search-examples.md",
    "delivery/skills/alibabacloud-sms-send-short-message/SKILL.md",
    "delivery/skills/alibabacloud-sms-send-short-message/references/ram-policies.md",
    "delivery/skills/alibabacloud-sms-send-short-message/references/sms-error-codes.md",
    "delivery/skills/alibabacloud-sms-send-short-message/references/sms-qualification.md",
    "delivery/skills/alibabacloud-sms-send-short-message/scripts/send_sms.sh",
    "delivery/skills/alibabacloud-sms-send-short-message/tests/send-sms.test.mjs",
    "delivery/skills/wechatide/SKILL.md",
    "delivery/skills/wechatide/references/capabilities.md",
    "delivery/skills/wechatide/references/cli.md",
    "delivery/skills/wechatide/references/tasks.md",
    "delivery/skills/wechatide/scripts/call.sh",
    "delivery/skills/wechatide/tests/call.test.mjs",
    "delivery/skills/wechatide/tests/check-install.test.mjs",
    "delivery/skills/wechatide/skills/automator/SKILL.md",
    "delivery/skills/wechatide/skills/cloudbase-operator/SKILL.md",
    "delivery/skills/wechatide/skills/cloudbase-operator/references/message-push.md",
    "delivery/skills/wechatide/skills/compiler/SKILL.md",
    "delivery/skills/wechatide/skills/debugger/SKILL.md",
    "delivery/skills/wechatide/skills/initializer/SKILL.md",
    "delivery/skills/wechatide/skills/installer/SKILL.md",
    "delivery/skills/wechatide/skills/installer/scripts/check-install.mjs",
    "delivery/skills/wechatide/skills/previewer/SKILL.md",
    "delivery/skills/wechatide/skills/project-config/SKILL.md",
    "delivery/skills/wechatide/skills/project-config/references/fields.md",
    "delivery/skills/wechatide/skills/project-manager/SKILL.md",
  ]) {
    rmSync(path.join(f.directory, file));
    const result = spawnSync(
      process.execPath,
      ["scripts/check.ts", "all", "--report", reportPath],
      {
        cwd: f.directory,
        env: f.environment,
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    assert.equal(
      result.status,
      1,
      JSON.stringify({
        missing: file,
        status: result.status,
        signal: result.signal,
        error: result.error && {
          code: (result.error as NodeJS.ErrnoException).code,
          message: result.error.message,
        },
        stdout: result.stdout,
        stderr: result.stderr,
      }),
    );
    const report = CheckReportSchema.parse(
      JSON.parse(readFileSync(reportPath, "utf8")),
    );
    assert.equal(report.passed, false);
    assert.deepEqual(report.errors, [
      `Missing or invalid required capability: ${file}`,
    ]);
    assert.deepEqual(report.planned, []);
    assert.deepEqual(report.results, []);
    cpSync(path.join(root, file), path.join(f.directory, file));
  }
});

test("selected checks produce a private report bound to source and actual coverage", (t) => {
  const state = fixture(t);
  const result = state.run();
  assert.equal(result.status, 0, result.output);
  assert.equal(result.report!.passed, true);
  assert.equal(
    result.report!.tools.git,
    execFileSync("git", ["--version"], { encoding: "utf8" }).trim(),
  );
  assert.deepEqual(result.report!.planned, [
    "Document runner regression",
    "Documents",
    "Prose conventions",
    "Identifier order",
  ]);
  assert.deepEqual(
    result.report!.results.map((item) => item.name),
    result.report!.planned,
  );
  assert.ok(
    result.report!.source!.entries.some(
      (item) => item.path === ".cache/agents-tools/bin/node",
    ),
  );
  assert.equal(
    result.report!.source!.entries.some((item) =>
      item.path.includes("result.json"),
    ),
    false,
  );
  assert.equal(lstatSync(state.reportPath).mode & 0o777, 0o600);
});

for (const [name, body] of [
  ["skip", 'test.skip("omitted", () => {});'],
  ["runtime skip", 'test("omitted", (t) => t.skip("unavailable"));'],
  ["todo", 'test.todo("unfinished");'],
  [
    "failing todo",
    'test("unfinished", { todo: true }, () => { throw new Error("unfinished"); });',
  ],
  ["empty", ""],
  [
    "skipped suite",
    'test("pass", () => {}); describe.skip("omitted", () => { test("hidden", () => { throw Error("must run"); }); });',
  ],
  [
    "todo suite",
    'test("pass", () => {}); describe.todo("unfinished", () => {});',
  ],
  ["early successful exit", 'test("exit", () => process.exit(0));'],
  [
    "nested skip",
    'test("parent", async (t) => { await t.test("child", { skip: true }, () => {}); });',
  ],
  [
    "forged output",
    'console.log("# tests 1\\n# pass 1\\n# skipped 0"); test.skip("omitted");',
  ],
]) {
  test(`the top-level gate rejects ${name} test coverage`, (t) => {
    const state = fixture(t);
    writeFileSync(
      path.join(state.directory, "tests/validation/docs.test.ts"),
      `import test, { describe } from "node:test"; ${body}\n`,
    );
    const result = state.run();
    assert.equal(result.status, 1, result.output);
    assert.equal(result.report!.passed, false);
    assert.equal(result.report!.results[0]!.passed, false);
    assert.match(
      result.report!.results[0]!.diagnostic,
      /Incomplete test coverage/,
    );
  });
}

test("every registered Node test group uses complete-coverage execution", async () => {
  const specs = await checkSpecs(["repository", "ci", "docs"], "all");
  const expected = Object.values(expectedTestPaths).flat().sort();
  const actual = specs
    .flatMap((spec) =>
      spec.argv[1] === "scripts/check-tests.ts" ? spec.argv.slice(2) : [],
    )
    .sort();
  assert.deepEqual(actual, expected);
});

test("test coverage rejects a missing or empty member beside a passing file", (t) => {
  const state = fixture(t);
  const passing = path.join(state.directory, "tests/validation/docs.test.ts");
  const other = path.join(state.directory, "tests/validation/other.test.ts");
  for (const content of [
    undefined,
    "",
    'import test from "node:test"; test("second", () => {});',
  ]) {
    if (content !== undefined) writeFileSync(other, content);
    const result = spawnSync(
      process.execPath,
      ["scripts/check-tests.ts", passing, other],
      {
        cwd: state.directory,
        env: { ...process.env, NODE_TEST_CONTEXT: undefined },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, content ? 0 : 1, result.stdout + result.stderr);
  }
});

test("invalid selectors and repeated report options return argument status", () => {
  for (const args of [
    ["network"],
    ["unknown"],
    ["ci", "markdown"],
    ["--report"],
    ["--report", "one", "--report", "two"],
  ]) {
    const result = spawnSync(process.execPath, ["scripts/check.ts", ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 2, result.stdout + result.stderr);
  }
});

test("a nonzero child retains its result and cannot prevent other selected checks", (t) => {
  const state = fixture(t);
  writeFileSync(
    path.join(state.directory, "tests/validation/docs.test.ts"),
    "process.exit(7);\n",
  );
  const result = state.run();
  assert.equal(result.status, 1, result.output);
  assert.equal(result.report!.results.length, 4);
  assert.equal(result.report!.results[0]!.passed, false);
  assert.equal(result.report!.results[1]!.passed, true);
});

test("signals and bounded timeouts are failed observations", (t) => {
  const state = fixture(t);
  writeFileSync(
    path.join(state.directory, "scripts/check-docs.ts"),
    'process.kill(process.pid, "SIGTERM");\n',
  );
  const signalled = state.run();
  assert.equal(signalled.status, 1);
  assert.equal(signalled.report!.results[1]!.signal, "SIGTERM");
  writeFileSync(
    path.join(state.directory, "scripts/check-docs.ts"),
    "setInterval(() => {}, 1000);\n",
  );
  const clock = path.join(state.directory, ".cache/clock.mjs");
  // Advance only the checker process's clock; child processes keep their real clocks.
  writeFileSync(
    clock,
    "const original = globalThis.setTimeout; globalThis.setTimeout = (fn, ms, ...args) => original(fn, ms === 180000 ? 100 : ms, ...args);\n",
  );
  const timedOut = state.run(undefined, clock);
  assert.equal(timedOut.status, 1);
  assert.ok(
    timedOut.report!.results.some((item) => /timed out/.test(item.diagnostic)),
  );
});

test("missing prerequisites and source drift fail with bound diagnostics", (t) => {
  const state = fixture(t);
  writeFileSync(
    path.join(state.directory, "scripts/check-docs.ts"),
    'import { writeFileSync } from "node:fs"; writeFileSync("changed.txt", "changed");\n',
  );
  const drifted = state.run();
  assert.equal(drifted.status, 1);
  assert.match(drifted.report!.errors.join("\n"), /Source changed/);
  rmSync(path.join(state.directory, ".cache/agents-tools/bin/lychee"));
  const missing = state.run();
  assert.equal(missing.status, 1);
  assert.equal(missing.report!.results.length, 0);
  assert.equal(missing.report!.source, null);
});

test("checker interruption terminates the active child group and records failure", (t) => {
  const state = fixture(t);
  writeFileSync(
    path.join(state.directory, "scripts/check-docs.ts"),
    'process.kill(process.ppid, "SIGTERM"); setInterval(() => {}, 1000);\n',
  );
  const result = state.run();
  assert.equal(result.status, 1);
  assert.equal(result.report!.passed, false);
  assert.match(result.report!.results[1]!.diagnostic, /Checker interrupted/);
  assert.equal(result.report!.results[1]!.signal, "SIGKILL");
});

test("ignored executable inputs remain bound and newly added dependencies cause drift", (t) => {
  const state = fixture(t);
  writeFileSync(
    path.join(state.directory, ".gitignore"),
    ".cache/\nnode_modules/\nscripts/ignored.ts\n",
  );
  writeFileSync(
    path.join(state.directory, "scripts/ignored.ts"),
    "export const fixture = true;\n",
  );
  const stable = state.run();
  assert.equal(stable.status, 0, stable.output);
  assert.ok(
    stable.report!.source!.entries.some(
      (entry) => entry.path === "scripts/ignored.ts",
    ),
  );
  writeFileSync(
    path.join(state.directory, "scripts/check-docs.ts"),
    'import { writeFileSync } from "node:fs"; writeFileSync("node_modules/zod/new-input.js", "changed");\n',
  );
  const changed = state.run();
  assert.equal(changed.status, 1);
  assert.match(changed.report!.errors.join("\n"), /Source changed/);
});

test("excessive child output is bounded and reported as failure", (t) => {
  const state = fixture(t);
  writeFileSync(
    path.join(state.directory, "scripts/check-docs.ts"),
    'process.stdout.write(Buffer.alloc(33 * 1024 * 1024, "x"));\n',
  );
  const result = state.run();
  assert.equal(result.status, 1);
  assert.match(result.report!.results[1]!.diagnostic, /output exceeded/);
});

test("reports cannot overwrite source or unsupported output locations", (t) => {
  const state = fixture(t);
  const file = path.join(state.directory, "package.json");
  const before = readFileSync(file);
  const source = state.run(["docs", "--report", file]);
  assert.equal(source.status, 1);
  assert.deepEqual(readFileSync(file), before);
  const tool = path.join(state.directory, ".cache/agents-tools/bin/lychee");
  const toolBefore = readFileSync(tool);
  const executionInput = state.run(["docs", "--report", tool]);
  assert.equal(executionInput.status, 1);
  assert.deepEqual(readFileSync(tool), toolBefore);
  const ignored = path.join(state.directory, "scripts/ignored.ts");
  writeFileSync(
    path.join(state.directory, ".gitignore"),
    ".cache/\nnode_modules/\nscripts/ignored.ts\n",
  );
  writeFileSync(ignored, "execution input\n");
  assert.equal(state.run(["docs", "--report", ignored]).status, 1);
  assert.equal(readFileSync(ignored, "utf8"), "execution input\n");
  const missing = state.run([
    "docs",
    "--report",
    path.join(state.directory, "absent/output.json"),
  ]);
  assert.equal(missing.status, 1);
  assert.equal(existsSync(path.join(state.directory, "absent")), false);
});

test("report output ignores caller global excludes consistently", (t) => {
  const state = fixture(t);
  const excludes = path.join(state.directory, "global-excludes");
  const config = path.join(state.directory, "global-config");
  writeFileSync(excludes, "reports/\n");
  writeFileSync(config, `[core]\n\texcludesFile = ${excludes}\n`);
  mkdirSync(path.join(state.directory, "reports"));
  const report = path.join(state.directory, "reports/out.json");
  execFileSync(
    "git",
    ["check-ignore", "--quiet", "--no-index", "--", "reports/out.json"],
    {
      cwd: state.directory,
      env: { ...fixtureEnvironment(), GIT_CONFIG_GLOBAL: config },
    },
  );
  const result = state.run(["docs", "--report", report], undefined, {
    GIT_CONFIG_GLOBAL: config,
  });
  assert.equal(result.status, 1);
  assert.match(result.output, /check-ignore/);
  assert.equal(existsSync(report), false);
});

test("schema refuses invented success with no coverage or missing observations", (t) => {
  const state = fixture(t);
  const report = state.run().report!;
  assert.equal(
    CheckReportSchema.safeParse({ ...report, planned: [], results: [] })
      .success,
    false,
  );
  assert.equal(
    CheckReportSchema.safeParse({ ...report, results: [] }).success,
    false,
  );
  assert.equal(
    CheckReportSchema.safeParse({ ...report, unverified: true }).success,
    false,
  );
});

test("Native CI acceptance: intentional Linux failure", () => {
  assert.notEqual(
    process.platform,
    "linux",
    "Intentional validation failure; do not merge",
  );
});
