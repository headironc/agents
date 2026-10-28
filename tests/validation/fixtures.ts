import { execFileSync, spawnSync } from "node:child_process";
import {
  constants,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
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

/** Copy only local candidate context into a disposable repository for contract and hook tests. */
export function fixtureRepository(t: TestContext) {
  const directory = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "agents-r4b-test-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const environment = fixtureEnvironment();
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
  git(["init", "--quiet"]);
  // Keep automatic maintenance out of the fixture: a background repack races this directory's removal.
  git(["config", "gc.auto", "0"]);
  git(["config", "maintenance.auto", "false"]);
  for (const file of [
    "scripts",
    "delivery",
    "config",
    ".github",
    ".githooks",
    "package.json",
  ])
    cpSync(path.join(repositoryRoot, file), path.join(directory, file), {
      recursive: true,
    });
  symlinkSync(
    path.join(repositoryRoot, "node_modules"),
    path.join(directory, "node_modules"),
    "dir",
  );
  mkdirSync(path.join(directory, ".cache/agents-tools/bin"), {
    recursive: true,
  });
  copyFileSync(
    process.execPath,
    path.join(directory, ".cache/agents-tools/bin/node"),
    constants.COPYFILE_FICLONE,
  );
  writeFileSync(path.join(directory, ".gitignore"), ".cache/\nnode_modules/\n");
  const put = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    writeFileSync(path.join(directory, file), text);
  };
  const putSkillManifest = (additional: string) =>
    put(
      "config/personal-skills.txt",
      "figma-design-workflow\tcodex\n" +
        "gh\tshared\ngh-identity\tshared\nalibabacloud-find-skills\tshared\nalibabacloud-sms-send-short-message\tshared\nwechatide\tshared\nwechatide/skills/automator\tshared\nwechatide/skills/cloudbase-operator\tshared\nwechatide/skills/compiler\tshared\nwechatide/skills/debugger\tshared\nwechatide/skills/initializer\tshared\nwechatide/skills/installer\tshared\nwechatide/skills/previewer\tshared\nwechatide/skills/project-config\tshared\nwechatide/skills/project-manager\tshared\n" +
        "project-guide\tshared\n" +
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
