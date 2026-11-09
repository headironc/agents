import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  constants,
  copyFileSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

export const repositoryRoot = path.resolve(import.meta.dirname, "../..");

/** Isolate every temporary Git operation from the caller's index, hooks and signing configuration. */
export function fixtureEnvironment(): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );
  return {
    ...environment,
    NODE_TEST_CONTEXT: undefined,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

const argumentsForGit = [
  "--no-optional-locks",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "user.name=Fixture",
  "-c",
  "user.email=fixture@example.invalid",
];

let repositoryTemplate: string | undefined;
const reusableRepositories: string[] = [];
const nodeSize = lstatSync(process.execPath).size;

function ensureRepositoryTemplate(): string {
  if (repositoryTemplate) return repositoryTemplate;
  const base = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "agents-r4b-template-")),
  );
  process.once("exit", () => rmSync(base, { recursive: true, force: true }));
  const environment = fixtureEnvironment();
  for (const args of [
    ["init", "--quiet"],
    // Keep automatic maintenance out of the fixture: a background repack races this directory's removal.
    ["config", "gc.auto", "0"],
    ["config", "maintenance.auto", "false"],
  ]) {
    execFileSync("git", [...argumentsForGit, ...args], {
      cwd: base,
      env: environment,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  for (const file of [
    "scripts",
    "delivery",
    "config",
    ".github",
    ".githooks",
    "package.json",
  ])
    cpSync(path.join(repositoryRoot, file), path.join(base, file), {
      recursive: true,
      mode: constants.COPYFILE_FICLONE,
    });
  writeFileSync(path.join(base, ".gitignore"), ".cache/\nnode_modules/\n");
  repositoryTemplate = base;
  return base;
}

function resetRepositoryDirectory(directory: string): void {
  const template = ensureRepositoryTemplate();
  chmodSync(directory, 0o700);
  for (const entry of readdirSync(directory)) {
    if (entry === ".cache") continue;
    rmSync(path.join(directory, entry), { recursive: true, force: true });
  }
  const cacheDir = path.join(directory, ".cache");
  if (lstatSync(cacheDir, { throwIfNoEntry: false })) {
    for (const entry of readdirSync(cacheDir)) {
      if (entry !== "agents-tools")
        rmSync(path.join(cacheDir, entry), { recursive: true, force: true });
    }
  }
  const binDir = path.join(directory, ".cache/agents-tools/bin");
  mkdirSync(binDir, { recursive: true });
  for (const entry of readdirSync(binDir)) {
    if (entry !== "node")
      rmSync(path.join(binDir, entry), { recursive: true, force: true });
  }
  const nodeBin = path.join(binDir, "node");
  const stat = lstatSync(nodeBin, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size !== nodeSize) {
    rmSync(nodeBin, { force: true });
    copyFileSync(process.execPath, nodeBin, constants.COPYFILE_FICLONE);
  }
  for (const entry of readdirSync(template)) {
    cpSync(path.join(template, entry), path.join(directory, entry), {
      recursive: true,
      mode: constants.COPYFILE_FICLONE,
    });
  }
  symlinkSync(
    path.join(repositoryRoot, "node_modules"),
    path.join(directory, "node_modules"),
    "dir",
  );
}

/** Copy only local candidate context into a disposable repository for contract and hook tests. */
export function fixtureRepository(t: TestContext) {
  const directory =
    reusableRepositories.pop() ??
    (() => {
      const created = realpathSync(
        mkdtempSync(path.join(os.tmpdir(), "agents-r4b-test-")),
      );
      process.once("exit", () =>
        rmSync(created, { recursive: true, force: true }),
      );
      return created;
    })();
  resetRepositoryDirectory(directory);
  t.after(() => {
    try {
      if (lstatSync(directory, { throwIfNoEntry: false })?.isDirectory())
        reusableRepositories.push(directory);
    } catch {
      /* Abandoned directories are cleaned up at process exit. */
    }
  });
  const environment = fixtureEnvironment();
  function git(args: string[]) {
    return execFileSync("git", [...argumentsForGit, ...args], {
      cwd: directory,
      env: environment,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  function runGit(args: string[], extra: NodeJS.ProcessEnv = {}) {
    return spawnSync("git", [...argumentsForGit, ...args], {
      cwd: directory,
      env: { ...environment, ...extra },
      encoding: "utf8",
      timeout: 30_000,
    });
  }
  const put = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    writeFileSync(path.join(directory, file), text);
  };
  const putSkillManifest = (additional: string) =>
    put(
      "config/personal-skills.txt",
      "figma-design-workflow\tcodex\n" +
        "sketch-native\tcodex,dsh,antigravity\n" +
        "gh\tcodex,dsh,antigravity\ngh-identity\tcodex,dsh,antigravity\nalibabacloud-find-skills\tcodex,dsh,antigravity\nalibabacloud-sms-send-short-message\tcodex,dsh,antigravity\nwechatide\tshared\nwechatide/skills/automator\tshared\nwechatide/skills/cloudbase-operator\tshared\nwechatide/skills/compiler\tshared\nwechatide/skills/debugger\tshared\nwechatide/skills/initializer\tshared\nwechatide/skills/installer\tshared\nwechatide/skills/previewer\tshared\nwechatide/skills/project-config\tshared\nwechatide/skills/project-manager\tshared\n" +
        "project-guide\tcodex,dsh,antigravity\n" +
        additional,
    );
  function commitBaseline() {
    const files = git(["ls-files", "--others", "--exclude-standard", "-z"])
      .split("\0")
      .filter(Boolean);
    git(["add", "--", ...files]);
    git(["commit", "--quiet", "-m", "test: create fixture"]);
  }
  return {
    directory,
    environment,
    git,
    runGit,
    put,
    putSkillManifest,
    commitBaseline,
  };
}
