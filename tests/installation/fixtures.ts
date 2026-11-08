import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  constants,
  copyFileSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import type { Product } from "../../scripts/delivery.ts";
import { CheckReportSchema } from "../../scripts/check-report.ts";
import { runInstallCli } from "../../scripts/install.ts";
import { InstallPlanSchema } from "../../scripts/install-records.ts";
import type { InstallPlan } from "../../scripts/install-records.ts";
import {
  canonicalDigest,
  listSourcePaths,
  readSourceIdentity,
} from "../../scripts/source.ts";
import { fixtureEnvironment, repositoryRoot } from "../validation/fixtures.ts";

// Expected targets follow the installation target table in docs/usage.md, not planner output.
export const skills = {
  codex: [
    "alibabacloud-find-skills",
    "alibabacloud-sms-send-short-message",
    "figma-design-workflow",
    "gh",
    "gh-identity",
    "project-guide",
    ...(process.platform === "darwin" ? ["sketch-native"] : []),
    "wechatide",
  ],
  dsh: [
    "alibabacloud-find-skills",
    "alibabacloud-sms-send-short-message",
    "gh",
    "gh-identity",
    "project-guide",
    ...(process.platform === "darwin" ? ["sketch-native"] : []),
    "wechatide",
  ],
  antigravity: [
    "alibabacloud-find-skills",
    "alibabacloud-sms-send-short-message",
    "gh",
    "gh-identity",
    "project-guide",
    ...(process.platform === "darwin" ? ["sketch-native"] : []),
  ],
};
export const policies = [
  "writing",
  "tool-contracts",
  "review",
  "rust",
  "sql",
  "models",
  "deepseek-harness",
  "antigravity",
];
export const dshPolicies = [
  "writing",
  "tool-contracts",
  "review",
  "rust",
  "sql",
  "models",
  "deepseek-harness",
];
export const antigravityPolicies = ["writing", "tool-contracts", "review"];
export const tools = ["check-ids.mjs", "check-prose.mjs", "task-temp.mjs"];
// The capability category, written out here the way the installation target table names it.
export const capability: [string, string][] = [
  ["README.md", "delivery/capability/README.md"],
  ["codex.toml", "delivery/capability/codex.toml"],
  ["dsh-headless.patch.yml", "delivery/capability/dsh-headless.patch.yml"],
  ["rust-lints.toml", "delivery/capability/rust-lints.toml"],
];
export const dshCapability: [string, string][] = [
  ["README.md", "delivery/capability/README.md"],
  ["dsh-headless.patch.yml", "delivery/capability/dsh-headless.patch.yml"],
  ["rust-lints.toml", "delivery/capability/rust-lints.toml"],
];
export const runtimeInputs = [
  ".cache/agents-tools/bin/node",
  ".cache/agents-tools/licenses/node-LICENSE",
  ".cache/agents-build/install.mjs",
  ".cache/agents-build/install-licenses.txt",
];
export const sha256 = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

export function expectedTargets(
  home: string,
  snapshot: string,
  codex = `${home}/.codex`,
  dsh = `${home}/.dsh`,
  selected: Product[] = ["codex", "dsh"],
): [string, string][] {
  const pair = (target: string, link: string): [string, string] => [
    target,
    link,
  ];
  const antigravity = `${home}/.gemini/antigravity-cli`;
  const all = [
    pair(`${codex}/README.md`, `${snapshot}/delivery/README.md`),
    ...policies.map((name) =>
      pair(
        `${codex}/policy/${name}.md`,
        `${snapshot}/delivery/policy/${name}.md`,
      ),
    ),
    ...tools.map((name) =>
      pair(`${codex}/tools/${name}`, `${snapshot}/delivery/tools/${name}`),
    ),
    ...capability.map(([name, source]) =>
      pair(`${codex}/capability/${name}`, `${snapshot}/${source}`),
    ),
    pair(`${codex}/AGENTS.md`, `${snapshot}/delivery/AGENTS.md`),
    ...skills.codex.map((name) =>
      pair(`${codex}/skills/${name}`, `${snapshot}/delivery/skills/${name}`),
    ),
    ...dshPolicies.map((name) =>
      pair(
        `${dsh}/policy/${name}.md`,
        `${snapshot}/delivery/policy/${name}.md`,
      ),
    ),
    ...tools.map((name) =>
      pair(`${dsh}/tools/${name}`, `${snapshot}/delivery/tools/${name}`),
    ),
    ...dshCapability.map(([name, source]) =>
      pair(`${dsh}/capability/${name}`, `${snapshot}/${source}`),
    ),
    pair(`${dsh}/AGENTS.md`, `${snapshot}/delivery/AGENTS.md`),
    ...skills.dsh.map((name) =>
      pair(`${dsh}/skills/${name}`, `${snapshot}/delivery/skills/${name}`),
    ),
    ...antigravityPolicies.map((name) =>
      pair(
        `${antigravity}/policy/${name}.md`,
        `${snapshot}/delivery/policy/${name}.md`,
      ),
    ),
    ...tools.map((name) =>
      pair(
        `${antigravity}/tools/${name}`,
        `${snapshot}/delivery/tools/${name}`,
      ),
    ),
    ...skills.antigravity.map((name) =>
      pair(
        `${antigravity}/skills/${name}`,
        `${snapshot}/delivery/skills/${name}`,
      ),
    ),
  ];
  const roots = { codex, dsh, antigravity };
  return all.filter(([target]) =>
    selected.some((product) => target.startsWith(`${roots[product]}/`)),
  );
}

export const exists = (file: string) =>
  lstatSync(file, { throwIfNoEntry: false }) !== undefined;
export const directory = (file: string) =>
  mkdirSync(file, { recursive: true, mode: 0o700 });
export function link(target: string, file: string): void {
  directory(path.dirname(file));
  symlinkSync(target, file);
}

const gitArguments = [
  "-c",
  "user.name=Fixture",
  "-c",
  "user.email=fixture@example.invalid",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=/dev/null",
];

function createReport(
  checkout: string,
  overrides: Record<string, unknown> = {},
  inputs = runtimeInputs,
): string {
  const closure = {
    name: "Installer build closure",
    exitCode: 0,
    signal: null,
    durationMs: 1,
    diagnostic: "",
    passed: true,
  };
  const report = {
    version: 1,
    source: readSourceIdentity(checkout, [
      ...listSourcePaths(checkout),
      ...inputs,
    ]),
    checker: "0".repeat(64),
    groups: ["repository", "ci", "docs"],
    planned: [closure.name],
    results: [closure],
    tools: {},
    platform: {
      os: process.platform,
      arch: process.arch,
      node: process.versions.node,
    },
    errors: [],
    passed: true,
    ...overrides,
  };
  return JSON.stringify(CheckReportSchema.parse(report));
}

const fixtureTemplates = new Map<
  boolean,
  { checkout: string; report: string }
>();

function fixtureTemplate(realRuntime: boolean): {
  checkout: string;
  report: string;
} {
  const cached = fixtureTemplates.get(realRuntime);
  if (cached) return cached;
  const base = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "agents-install-template-")),
  );
  process.once("exit", () => rmSync(base, { recursive: true, force: true }));
  const stage = path.join(base, "stage");
  const checkout = path.join(base, "checkout");
  directory(stage);
  const environment = fixtureEnvironment();
  const git = (...args: string[]) =>
    execFileSync("git", [...gitArguments, ...args], {
      cwd: stage,
      env: environment,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  git("init", "--quiet");
  // Keep background maintenance from recreating pack directories during fixture cleanup.
  git("config", "gc.auto", "0");
  git("config", "maintenance.auto", "false");
  for (const file of [".gitignore", "config/personal-skills.txt", "delivery"]) {
    cpSync(path.join(repositoryRoot, file), path.join(stage, file), {
      recursive: true,
      mode: constants.COPYFILE_FICLONE,
    });
  }
  git("add", "--all");
  git("commit", "--quiet", "-m", "fixture");
  const put = (file: string, bytes: string | Buffer, mode: number) => {
    directory(path.dirname(path.join(stage, file)));
    writeFileSync(path.join(stage, file), bytes);
    chmodSync(path.join(stage, file), mode);
  };
  if (realRuntime) {
    directory(path.join(stage, ".cache/agents-tools/bin"));
    // Copy across read-only container mounts without a symlinked source input.
    copyFileSync(
      process.execPath,
      path.join(stage, ".cache/agents-tools/bin/node"),
      constants.COPYFILE_FICLONE,
    );
    for (const file of runtimeInputs.slice(1))
      put(file, readFileSync(path.join(repositoryRoot, file)), 0o600);
  } else {
    put(
      ".cache/agents-tools/bin/node",
      `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' "$@"\n`,
      0o755,
    );
    put(
      ".cache/agents-tools/licenses/node-LICENSE",
      "fixture Node license\n",
      0o600,
    );
    put(
      ".cache/agents-build/install-licenses.txt",
      "fixture bundled licenses\n",
      0o600,
    );
    put(
      ".cache/agents-build/install.mjs",
      'console.error("usage"); process.exitCode = 2;\n',
      0o600,
    );
  }
  cpSync(stage, checkout, {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
  });
  rmSync(stage, { recursive: true, force: true });
  const created = { checkout, report: createReport(checkout) };
  fixtureTemplates.set(realRuntime, created);
  return created;
}

/** A committed checkout, passing report and temporary HOME; the fake runtime only answers the plan probes. */
export function installFixture(
  t: TestContext,
  options: {
    realRuntime?: boolean;
    home?: string;
    worktree?: string;
    products?: Product[];
  } = {},
) {
  const base = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "agents-install-")),
  );
  t.after(() => rmSync(base, { recursive: true, force: true }));
  let checkout = path.join(base, "checkout");
  const home = path.join(base, options.home ?? "home");
  const outputs = path.join(base, "outputs");
  for (const item of [home, outputs]) directory(item);
  const template = fixtureTemplate(Boolean(options.realRuntime));
  cpSync(template.checkout, checkout, {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
  });
  const environment = fixtureEnvironment();
  const git = (...args: string[]) =>
    execFileSync("git", [...gitArguments, ...args], {
      cwd: checkout,
      env: environment,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  const put = (file: string, bytes: string | Buffer, mode: number) => {
    directory(path.dirname(path.join(checkout, file)));
    writeFileSync(path.join(checkout, file), bytes);
    chmodSync(path.join(checkout, file), mode);
  };
  if (options.worktree) {
    const linked = path.join(home, options.worktree);
    directory(path.dirname(linked));
    git("worktree", "add", "--detach", linked, "HEAD");
    for (const file of runtimeInputs) {
      directory(path.dirname(path.join(linked, file)));
      cpSync(path.join(checkout, file), path.join(linked, file));
    }
    checkout = linked;
  }
  const reportPath = path.join(base, "report.json");
  const writeReport = (
    overrides: Record<string, unknown> = {},
    inputs = runtimeInputs,
  ) => {
    writeFileSync(reportPath, createReport(checkout, overrides, inputs));
  };
  if (options.worktree) writeReport();
  else writeFileSync(reportPath, template.report);
  let count = 0;
  const cli = (args: string[], env: NodeJS.ProcessEnv = {}) =>
    runInstallCli(
      args,
      { PATH: process.env.PATH, HOME: home, ...env },
      true,
      Boolean(options.realRuntime),
    );
  const plan = (
    extra: string[] = [],
    env: NodeJS.ProcessEnv = {},
    output = path.join(outputs, `plan-${count++}.json`),
    source = checkout,
  ) => ({
    review: output,
    ...cli(
      [
        "plan",
        // Existing two-product cases explicitly request both; CLI tests bypass this helper.
        ...(extra.includes("--product")
          ? []
          : (options.products ?? ["codex", "dsh"]).flatMap((product) => [
              "--product",
              product,
            ])),
        "--source",
        source,
        "--report",
        reportPath,
        "--output",
        output,
        ...extra,
      ],
      env,
    ),
  });
  const deploy = path.join(home, ".local/state/agents/deploy");
  const runs = () =>
    exists(deploy)
      ? readdirSync(deploy).filter((name) => /^[0-9]{8}T/.test(name))
      : [];
  const readPlan = (file: string): InstallPlan =>
    InstallPlanSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  const gaps = (result: {
    status: number | null;
    stdout: string;
    stderr: string;
  }) => {
    assert.equal(result.status, 1, result.stderr);
    return (
      JSON.parse(result.stdout) as {
        gaps: { code: string; path?: string; key?: string }[];
      }
    ).gaps;
  };
  /** Plan successfully and return the review path with its parsed plan. */
  const planned = (extra?: string[], env: NodeJS.ProcessEnv = {}) => {
    const result = plan(extra, env);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    return { review: result.review, plan: readPlan(result.review) };
  };
  return {
    base,
    checkout,
    home,
    outputs,
    deploy,
    reportPath,
    git,
    put,
    writeReport,
    cli,
    plan,
    planned,
    runs,
    readPlan,
    gaps,
  };
}

export function treeState(root: string): unknown[] {
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .sort()
    .map((name) => {
      const stat = lstatSync(path.join(root, name));
      return [
        name,
        stat.mode,
        stat.isFile() ? readFileSync(path.join(root, name), "utf8") : null,
      ];
    });
}

/** Materialize a legacy fixture's recorded layout; never migrate a user's deployment records. */
export function legacyPlan(
  prepared: { plan: InstallPlan; review: string },
  version: 5 | 6,
): { plan: InstallPlan; review: string } {
  const plan = structuredClone(prepared.plan);
  assert.ok(plan.roots.codex && plan.roots.dsh);
  assert.equal(plan.roots.antigravity !== undefined, version === 6);
  const codexRoot = plan.roots.codex;
  const dshPath = plan.roots.dsh.path;
  const claudePath = dshPath.replace(/\/\.dsh$/, "/.claude");
  if (exists(dshPath) && !exists(claudePath)) renameSync(dshPath, claudePath);
  plan.roots = {
    home: plan.roots.home,
    codex: codexRoot,
    claude: {
      ...plan.roots.dsh,
      path: claudePath,
      variable:
        plan.roots.dsh.variable === "DSH_HOME" ? "CLAUDE_CONFIG_DIR" : null,
    },
    ...(plan.roots.antigravity ? { antigravity: plan.roots.antigravity } : {}),
    state: plan.roots.state,
    deploy: plan.roots.deploy,
    backup: plan.roots.backup,
  };
  const legacyClaudePolicies = new Set([
    "policy/writing.md",
    "policy/tool-contracts.md",
    "policy/review.md",
  ]);
  plan.targets = plan.targets
    .flatMap((target) => {
      if (target.product !== "dsh") return [target];
      const relative = target.path.slice(dshPath.length + 1);
      if (
        target.category !== "skill" &&
        target.category !== "tool" &&
        !legacyClaudePolicies.has(relative)
      )
        return [];
      return [
        {
          ...target,
          product: "claude" as const,
          key: target.key.replace(/^dsh:/, "claude:"),
          path: path.join(claudePath, relative),
        },
      ];
    })
    .map((target, order) => ({
      ...target,
      order,
      backup:
        target.backup === null
          ? null
          : path.join(plan.roots.backup.path, plan.run.id, String(order)),
    }));
  const previous = path.dirname(plan.run.source);
  const privateRun = path.join(codexRoot.path, ".agents-install", plan.run.id);
  directory(path.dirname(privateRun));
  renameSync(previous, privateRun);
  plan.version = version;
  plan.run.source = path.join(privateRun, "source");
  plan.run.runtime = path.join(privateRun, "runtime");
  for (const file of plan.runtime.files)
    file.path = path.join(plan.run.runtime, path.basename(file.path));
  for (const target of plan.targets)
    target.source = path.join(
      privateRun,
      path.relative(previous, target.source),
    );
  plan.newDirectories = [
    ...new Set(
      plan.newDirectories
        .filter((file) => file !== path.join(dshPath, "capability"))
        .map((file) =>
          file === dshPath || file.startsWith(`${dshPath}/`)
            ? path.join(claudePath, file.slice(dshPath.length))
            : file,
        ),
    ),
  ]
    .filter((file) => !exists(file))
    .sort();
  const { sha256: _digest, ...body } = plan;
  plan.sha256 = canonicalDigest(body);
  InstallPlanSchema.parse(plan);
  const bytes = JSON.stringify(plan);
  chmodSync(plan.run.plan, 0o600);
  writeFileSync(plan.run.plan, bytes);
  chmodSync(plan.run.plan, 0o400);
  writeFileSync(prepared.review, bytes);
  return { plan, review: prepared.review };
}
