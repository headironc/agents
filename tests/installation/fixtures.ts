import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
  claude: [
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
  "claude-code",
  "antigravity",
];
export const claudePolicies = ["writing", "tool-contracts", "review"];
export const tools = ["check-ids.mjs", "check-prose.mjs", "task-temp.mjs"];
// The capability category, written out here the way the installation target table names it.
export const capability: [string, string][] = [
  ["README.md", "delivery/capability/README.md"],
  ["codex.toml", "delivery/capability/codex.toml"],
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
  claude = `${home}/.claude`,
  selected: Product[] = ["codex", "claude"],
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
    ...claudePolicies.map((name) =>
      pair(
        `${claude}/policy/${name}.md`,
        `${snapshot}/delivery/policy/${name}.md`,
      ),
    ),
    ...tools.map((name) =>
      pair(`${claude}/tools/${name}`, `${snapshot}/delivery/tools/${name}`),
    ),
    ...skills.claude.map((name) =>
      pair(`${claude}/skills/${name}`, `${snapshot}/delivery/skills/${name}`),
    ),
    ...claudePolicies.map((name) =>
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
  const roots = { codex, claude, antigravity };
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
  for (const item of [checkout, home, outputs]) directory(item);
  const environment = fixtureEnvironment();
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        ...args,
      ],
      {
        cwd: checkout,
        env: environment,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  git("init", "--quiet");
  // Keep background maintenance from recreating pack directories during fixture cleanup.
  git("config", "gc.auto", "0");
  git("config", "maintenance.auto", "false");
  for (const file of [".gitignore", "config/personal-skills.txt", "delivery"]) {
    cpSync(path.join(repositoryRoot, file), path.join(checkout, file), {
      recursive: true,
    });
  }
  git("add", "--all");
  git("commit", "--quiet", "-m", "fixture");
  const put = (file: string, bytes: string | Buffer, mode: number) => {
    directory(path.dirname(path.join(checkout, file)));
    writeFileSync(path.join(checkout, file), bytes);
    chmodSync(path.join(checkout, file), mode);
  };
  if (options.realRuntime) {
    directory(path.join(checkout, ".cache/agents-tools/bin"));
    // Copy across read-only container mounts without a symlinked source input.
    copyFileSync(
      process.execPath,
      path.join(checkout, ".cache/agents-tools/bin/node"),
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
    writeFileSync(reportPath, JSON.stringify(CheckReportSchema.parse(report)));
  };
  writeReport();
  let count = 0;
  const cli = (args: string[], env: NodeJS.ProcessEnv = {}) =>
    spawnSync(
      process.execPath,
      [path.join(repositoryRoot, "scripts/install.ts"), ...args],
      {
        env: { PATH: process.env.PATH, HOME: home, ...env },
        encoding: "utf8",
        timeout: 60_000,
      },
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
          : (options.products ?? ["codex", "claude"]).flatMap((product) => [
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
  assert.ok(plan.roots.codex && plan.roots.claude);
  assert.equal(plan.roots.antigravity !== undefined, version === 6);
  const previous = path.dirname(plan.run.source);
  const privateRun = path.join(
    plan.roots.codex.path,
    ".agents-install",
    plan.run.id,
  );
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
  plan.newDirectories = plan.newDirectories.filter((file) => !exists(file));
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
