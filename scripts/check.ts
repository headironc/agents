// Contract subject: `node`.
// Contract subject: `bun`.
// Contract subject: `bash`.
// Contract subject: `shellcheck`.
// Contract subject: `actionlint`.
// Contract subject: `zizmor`.
// Contract subject: `gitleaks`.
// Contract subject: `typescript`.
// This executor binds fixed argv, required tools, source identity and complete results.
// - Read [contract](../delivery/policy/tool-contracts.md). Use tool `git`.
// - Read [contract](../delivery/policy/tool-contracts.md). Use tool `jq`.
// - Read [invocation contract](../delivery/skills/gh/SKILL.md). Use tool `gh`.
// - Read [validator](skill-validator.py). Use tool `python`.
// - Read [adapter](check-skills.ts). Use tool `skill-validation`.
// - Read [executor](check-docs.ts). Use tool `lychee`.
// - Read [executor](check-codex-loader.ts). Use tool `codex-cli-loader`.
// - Read [executor](check-prose.mjs). Use tool `prose-check`.
// - Read [executor](check-ids.mjs). Use tool `id-check`.
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  canonicalDigest,
  listSourcePaths,
  readSourceIdentity,
  sourceGitEnvironment,
} from "./source.ts";
import type { SourceIdentity } from "./source.ts";
import { CheckReportSchema } from "./check-report.ts";
import type { CheckReportV1, CheckResult } from "./check-report.ts";
export { CheckReportSchema } from "./check-report.ts";
import {
  workflowPaths,
  testPaths,
  requiredRepositoryPaths,
} from "./check-catalog.ts";

const root = path.resolve(import.meta.dirname, "..");
const toolDirectory = path.join(root, ".cache/agents-tools/bin");

export type CheckSpec = {
  name: string;
  argv: [string, ...string[]];
  cwd: string;
  tools: string[];
};

// `report?: string | undefined` rather than `report?: string`: under exactOptionalPropertyTypes
// those differ, and this one is built by assigning a variable that may be undefined.
function parseArguments(args: string[]): {
  groups: CheckReportV1["groups"];
  docs: string;
  report?: string | undefined;
} {
  const positional: string[] = [];
  let report: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--report") {
      if (
        report !== undefined ||
        !args[index + 1] ||
        args[index + 1]!.startsWith("--")
      )
        throw new Error("Expected one report path");
      report = path.resolve(args[++index]!);
    } else if (arg.startsWith("-")) throw new Error("Unknown option");
    else positional.push(arg);
  }
  const group = positional[0] ?? "all";
  const docs = positional[1] ?? "all";
  if (
    !["all", "repository", "ci", "docs"].includes(group) ||
    positional.length > 2 ||
    (positional.length === 2 &&
      (group !== "docs" || !["all", "markdown", "links"].includes(docs)))
  )
    throw new Error("Invalid check selector");
  return {
    groups:
      group === "all"
        ? ["repository", "ci", "docs"]
        : [group as "repository" | "ci" | "docs"],
    docs,
    report,
  };
}

// Both the document checkers and the bundled products read Markdown through these, so every spec
// that runs one declares them and the report records their versions.
const parsers = [
  "mdast-util-from-markdown",
  "mdast-util-gfm",
  "mdast-util-frontmatter",
  "micromark",
  "micromark-extension-gfm",
  "micromark-extension-frontmatter",
];

export async function checkSpecs(
  groups: CheckReportV1["groups"],
  docs: string,
  root: string = path.resolve(import.meta.dirname, ".."),
  toolDirectory: string = path.join(root, ".cache/agents-tools/bin"),
): Promise<CheckSpec[]> {
  const specs: CheckSpec[] = [];
  const add = (name: string, argv: CheckSpec["argv"], tools: string[]) =>
    specs.push({ name, argv, cwd: root, tools });
  if (groups.includes("repository")) {
    for (const file of requiredRepositoryPaths) {
      const stat = lstatSync(path.join(root, file), { throwIfNoEntry: false });
      if (!stat?.isFile() || stat.isSymbolicLink() || stat.size === 0)
        throw new Error(`Missing or invalid required capability: ${file}`);
    }
    const { readSkillEntries, selectSkillEntries } =
      await import("./skills.ts");
    const { skillCheckNames, skillValidationName } =
      await import("./check-skills.ts");
    const entries = readSkillEntries(root);
    const names = skillCheckNames(entries);
    add(
      "TypeScript",
      [process.execPath, "node_modules/typescript/bin/tsc", "--noEmit"],
      ["node", "typescript"],
    );
    add(
      "Installer build closure",
      [process.execPath, "scripts/check-install-build.ts"],
      ["node", "bun"],
    );
    // The document checkers read Markdown through pinned packages, so their versions belong in the
    // report beside the binaries, the way markdownlint is named for the contract check below. The
    // bundled products carry the same packages, so their freshness check depends on them too.
    const parsing = new Set([
      "tests/check-prose.test.mjs",
      "tests/check-ids.test.mjs",
      "tests/bundle-tools.test.ts",
    ]);
    // The published-reference regression lays out a tree and runs the pinned lychee over it, the
    // same way the check it covers does, so it declares the same binary.
    const linking = new Set([
      "tests/validation/refs.test.ts",
      "tests/installation/apply.test.ts",
    ]);
    for (const file of testPaths.repository) {
      add(
        `Repository regression: ${file}`,
        [process.execPath, "scripts/check-tests.ts", file],
        [
          "node",
          "bun",
          "jq",
          "bash",
          ...(parsing.has(file) ? parsers : []),
          ...(linking.has(file) ? ["lychee"] : []),
          ...(file === "tests/validation/check-secrets.test.ts"
            ? ["gitleaks"]
            : []),
        ],
      );
    }
    add(
      "Core tool contracts and rule bindings",
      [process.execPath, "scripts/check-tool-contracts.ts"],
      ["node", "markdownlint"],
    );
    // Published-layout references: the repository form is lychee's, in the documents group.
    add(
      "Published references",
      [process.execPath, "scripts/check-refs.ts"],
      ["node", "lychee"],
    );
    add(
      "Codex loader",
      [process.execPath, "scripts/check-codex-loader.ts"],
      ["node", "@openai/codex"],
    );
    // Screen current source candidates, including force-tracked files under ignored build paths.
    add(
      "Secret screening",
      [
        process.execPath,
        "scripts/check-secrets.ts",
        ".",
        path.join(toolDirectory, "gitleaks"),
      ],
      ["node", "gitleaks"],
    );
    add(
      names[0]!,
      [
        process.execPath,
        "scripts/check-skills.ts",
        "membership",
        canonicalDigest(entries),
      ],
      ["node", "js-yaml"],
    );
    for (const product of ["codex", "claude"] as const)
      if (selectSkillEntries(entries, product).length)
        add(
          skillValidationName(entries, product),
          [process.execPath, "scripts/check-skills.ts", product],
          ["node", "python3"],
        );
    add(
      "Pinned skill validator CLI regression",
      [process.execPath, "scripts/check-tests.ts", ...testPaths.validators],
      ["node", "python3"],
    );
  }
  if (groups.includes("ci")) {
    for (const file of testPaths.ci)
      add(
        `CI regression: ${file}`,
        [process.execPath, "scripts/check-tests.ts", file],
        ["node", "js-yaml"],
      );
    const shellFiles = listSourcePaths(root).filter(
      (file) => file.endsWith(".sh") || file === ".githooks/pre-commit",
    );
    if (shellFiles.length === 0) throw new Error("Empty shell inventory");
    for (const file of shellFiles)
      add(`Bash syntax: ${file}`, ["bash", "-n", file], ["bash"]);
    // The optional checks that cost nothing on this repository's shell today, measured one at a
    // time. The five left out are not style: `check-set-e-suppressed` (43), `require-double-brackets`
    // (73), `require-variable-braces` (408), `check-extra-masked-returns` (11) and `add-default-case`
    // (8). The two brace rules are taste and would rewrite 481 lines to decide nothing; the other
    // three are real failure-handling questions and are recorded rather than switched on in passing.
    const optional = [
      "avoid-negated-conditions",
      "avoid-nullary-conditions",
      "check-unassigned-uppercase",
      "deprecate-which",
      "quote-safe-variables",
      "useless-use-of-cat",
    ];
    add(
      "ShellCheck",
      [
        path.join(toolDirectory, "shellcheck"),
        "-x",
        `--enable=${optional.join(",")}`,
        ...shellFiles,
      ],
      ["shellcheck"],
    );
    // `-shellcheck` hands each `run:` block to the pinned shellcheck. Without it the shell inside a
    // workflow is checked by nothing: the ShellCheck spec above reads `.sh` files and the commit
    // hook, and a workflow is neither.
    if (workflowPaths.length > 0) {
      add(
        "actionlint",
        [
          path.join(toolDirectory, "actionlint"),
          "-shellcheck",
          path.join(toolDirectory, "shellcheck"),
          ...workflowPaths,
        ],
        ["actionlint", "shellcheck"],
      );
      add(
        "zizmor",
        [
          path.join(toolDirectory, "zizmor"),
          "--offline",
          "--no-progress",
          "--color=never",
          "--render-links=never",
          "--show-audit-urls=always",
          ".github",
        ],
        ["zizmor"],
      );
    }
  }
  if (groups.includes("docs")) {
    // This spec runs the identifier checker, so it carries the parsers even when the repository
    // group that also declares them is not selected.
    add(
      "Document runner regression",
      [process.execPath, "scripts/check-tests.ts", ...testPaths.docs],
      ["node", "markdownlint-cli2", "lychee", ...parsers],
    );
    add(
      "Documents",
      [process.execPath, "scripts/check-docs.ts", docs],
      [
        "node",
        ...(docs !== "links" ? ["markdownlint-cli2"] : []),
        ...(docs !== "markdown" ? ["lychee"] : []),
      ],
    );
    if (docs !== "links") {
      const markdown = listSourcePaths(root).filter((file) =>
        file.endsWith(".md"),
      );
      if (markdown.length === 0) throw new Error("Empty Markdown inventory");
      add(
        "Prose conventions",
        [
          process.execPath,
          "scripts/check-prose.mjs",
          "--errors-only",
          ...markdown,
        ],
        ["node", ...parsers],
      );
      add(
        "Identifier order",
        [process.execPath, "scripts/check-ids.mjs", ...markdown],
        ["node", ...parsers],
      );
    }
  }
  if (
    specs.length === 0 ||
    new Set(specs.map((spec) => spec.name)).size !== specs.length
  )
    throw new Error("Empty or duplicate checks");
  return specs;
}

function fileInputs(directory: string, dependency = false): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    // Executables use their package's real path; generated .bin links are not inputs.
    if (dependency && entry.name === ".bin") continue;
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("Linked execution input is not supported");
    if (entry.isDirectory()) files.push(...fileInputs(filename, dependency));
    else if (entry.isFile())
      files.push(path.relative(root, filename).split(path.sep).join("/"));
    else throw new Error("Special execution input rejected");
  }
  return files;
}

export async function verifyTools(
  specs: CheckSpec[],
  versions: Record<string, string>,
): Promise<string[]> {
  const manifest = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const pinned = JSON.parse(
    readFileSync(path.join(root, "scripts/tool-versions.json"), "utf8"),
  );
  const inputs: string[] = [];
  if (
    process.versions.node !== manifest.engines.node ||
    realpathSync(process.execPath) !== path.join(toolDirectory, "node")
  )
    throw new Error("Run checks using the repository's pinned Node");
  if (
    specs.some((spec) => spec.name === "Pinned skill validator CLI regression")
  ) {
    const { validatorInputs } = await import("./check-skills.ts");
    inputs.push(...validatorInputs(root));
  }
  if (specs.some((spec) => spec.name === "Installer build closure")) {
    // Install plans copy these checked runtime inputs into each persistent run.
    const { runtimeFiles } = await import("./install-records.ts");
    inputs.push(...runtimeFiles.map((file) => file.source));
  }
  for (const name of new Set([
    "node",
    "zod",
    "git",
    ...specs.flatMap((spec) => spec.tools),
  ])) {
    const dependency =
      manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
    if (dependency) {
      const installed = JSON.parse(
        readFileSync(
          path.join(root, "node_modules", name, "package.json"),
          "utf8",
        ),
      );
      if (installed.version !== dependency)
        throw new Error(`Stale dependency: ${name}`);
      versions[name] = installed.version;
    } else {
      const managed = Object.hasOwn(pinned.tools, name);
      const executable = managed ? path.join(toolDirectory, name) : name;
      const flag = managed ? pinned.tools[name].versionFlag : "--version";
      if (
        managed &&
        (!lstatSync(executable).isFile() ||
          lstatSync(executable).isSymbolicLink())
      )
        throw new Error(`Invalid tool: ${name}`);
      const output = execFileSync(executable, [flag], {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      });
      const expected =
        name === "node"
          ? manifest.engines.node
          : name === "bun"
            ? manifest.packageManager.slice(4)
            : pinned.tools[name]?.version;
      if (
        expected &&
        !output
          .split(/\s+/)
          .map((token) => token.replace(/^v/, ""))
          .includes(expected)
      )
        throw new Error(`Incorrect tool version: ${name}`);
      versions[name] = expected ?? output.split("\n")[0]!.trim();
      if (managed) inputs.push(path.relative(root, executable));
    }
  }
  return [...new Set(inputs)];
}

async function runChecks(specs: CheckSpec[]): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  let interrupted = false;
  for (const spec of specs) {
    console.log(`\n[${spec.name}]`);
    const started = performance.now();
    const result = await new Promise<CheckResult>((resolve) => {
      const child = spawn(spec.argv[0], spec.argv.slice(1), {
        cwd: spec.cwd,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        // Every registered test command starts its own runner, including in fixtures.
        env: {
          ...process.env,
          NODE_TEST_CONTEXT: undefined,
          PATH: `${toolDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      });
      let diagnostic = "";
      let failure = "";
      let bytes = 0;
      const stop = (reason: string) => {
        failure ||= reason;
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH")
              failure += "; termination failed";
          }
        }
      };
      const interrupt = () => {
        interrupted = true;
        stop("Checker interrupted");
      };
      process.once("SIGINT", interrupt);
      process.once("SIGTERM", interrupt);
      const timer = setTimeout(
        () => stop("Check timed out after 180 seconds"),
        180_000,
      );
      const capture = (chunk: Buffer, stream: NodeJS.WriteStream) => {
        bytes += chunk.length;
        if (bytes > 32 * 1024 * 1024) {
          stop("Check output exceeded 32 MiB");
          return;
        }
        diagnostic = (diagnostic + chunk.toString("utf8")).slice(-2000);
        stream.write(chunk);
      };
      child.stdout.on("data", (chunk) => capture(chunk, process.stdout));
      child.stderr.on("data", (chunk) => capture(chunk, process.stderr));
      child.on("error", (error) => {
        failure = error.message;
      });
      child.on("close", (exitCode, signal) => {
        clearTimeout(timer);
        process.removeListener("SIGINT", interrupt);
        process.removeListener("SIGTERM", interrupt);
        resolve({
          name: spec.name,
          exitCode,
          signal,
          durationMs: performance.now() - started,
          diagnostic: failure || diagnostic,
          passed: exitCode === 0 && signal === null && !failure,
        });
      });
    });
    results.push(result);
    console.log(`[${spec.name}] ${result.passed ? "passed" : "failed"}`);
    if (interrupted) break;
  }
  return results;
}

function validateReportPath(filename: string): void {
  const parent = realpathSync(path.dirname(filename));
  if (parent !== path.dirname(filename))
    throw new Error("Report parent must be a physical path");
  const relative = path.relative(root, filename);
  if (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  ) {
    const executionRoots = [
      "scripts",
      "tests",
      ".github",
      ".githooks",
      "delivery",
      "config",
      "node_modules",
      ".cache/agents-tools",
    ];
    if (
      relative.split(path.sep).includes(".git") ||
      listSourcePaths(root).includes(relative) ||
      executionRoots.some(
        (directory) =>
          relative === directory ||
          relative.startsWith(`${directory}${path.sep}`),
      )
    )
      throw new Error("Report cannot replace source or execution inputs");
    execFileSync(
      "git",
      ["check-ignore", "--quiet", "--no-index", "--", relative],
      { cwd: root, env: sourceGitEnvironment, stdio: "pipe" },
    );
  }
  if (
    existsSync(filename) ||
    (() => {
      try {
        return lstatSync(filename).isSymbolicLink();
      } catch {
        return false;
      }
    })()
  ) {
    const stat = lstatSync(filename);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid?.()
    )
      throw new Error("Report target must be an owned regular file");
  }
}

function writeCheckReport(report: CheckReportV1, filename: string): void {
  validateReportPath(filename);
  if (
    report.source?.entries.some(
      (entry) => path.join(root, entry.path) === filename,
    )
  )
    throw new Error("Report is a bound source input");
  const temporary = path.join(
    path.dirname(filename),
    `.agents-report-${process.pid}-${Date.now()}`,
  );
  try {
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(
        descriptor,
        JSON.stringify(CheckReportSchema.parse(report), null, 2) + "\n",
      );
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    validateReportPath(filename);
    renameSync(temporary, filename);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/**
 * Says when this branch does not contain the last `origin/main` this machine fetched.
 *
 * It never fails the run, and it is deliberately not a registered check. The forge already refuses
 * to merge a branch that is behind, through the ruleset's strict status policy, so blocking here
 * would be a second owner for a rule that already applies to everyone.
 *
 * What it covers is the time before a push, which the forge cannot see. Every check in this file
 * reads one snapshot, and a branch that reverts an already-merged decision is internally consistent
 * inside its own snapshot — two branches in this repository sat that way for a month, each of them
 * re-adding a retired directory on merge, with a green run the whole time.
 *
 * It does not fetch. The comparison is against the last `origin/main` this machine saw, so a
 * checkout that has not fetched recently gets a notice that is itself stale. The line says that
 * rather than implying the branch is current, and an absent ref or an unusable `git` says nothing
 * at all: an offline machine, a fresh clone and a fixture repository are none of them defects.
 */
export function baseNotice(directory: string): string | null {
  const git = (args: string[]) =>
    execFileSync("git", ["--no-optional-locks", "-C", directory, ...args], {
      env: sourceGitEnvironment,
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  try {
    // `--verify` exits nonzero when the ref is absent, so a missing base throws into the catch
    // rather than returning empty. And an equal head counts zero, so one guard decides both.
    const base = git([
      "rev-parse",
      "--verify",
      "--quiet",
      "refs/remotes/origin/main",
    ]);
    const behind = Number(git(["rev-list", "--count", `HEAD..${base}`]));
    if (!behind) return null;
    return (
      `check: this branch is ${behind} commit${behind === 1 ? "" : "s"} behind the last origin/main this machine fetched; ` +
      "every check below reads one snapshot, so a reverted decision passes them. Fetch to see the current gap."
    );
  } catch {
    // No repository, no remote, no `git`, or a detached or unborn HEAD. None of these is a defect.
    return null;
  }
}

async function main(): Promise<void> {
  let selection: ReturnType<typeof parseArguments>;
  try {
    selection = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid arguments");
    process.exitCode = 2;
    return;
  }
  const report: CheckReportV1 = {
    version: 1,
    source: null,
    checker: canonicalDigest({
      check: createHash("sha256")
        .update(readFileSync(import.meta.filename))
        .digest("hex"),
      source: createHash("sha256")
        .update(readFileSync(path.join(import.meta.dirname, "source.ts")))
        .digest("hex"),
    }),
    groups: selection.groups,
    planned: [],
    results: [],
    tools: {},
    platform: {
      os: process.platform,
      arch: process.arch,
      node: process.versions.node,
    },
    errors: [],
    passed: false,
  };
  try {
    // `writeSync` so the notice is out before the checks start printing, where `console.error`
    // queues it. But a write that fails must not end the run: stderr can be a pipe whose reader
    // has gone, and `writeSync` raises EPIPE there, which the catch below would turn into
    // `FAIL: 0/0` before a single check had been planned. A notice never blocks.
    const notice = baseNotice(root);
    if (notice) {
      try {
        writeSync(2, `${notice}\n`);
      } catch {
        /* a notice nobody can receive is not a defect */
      }
    }
    if (selection.report) validateReportPath(selection.report);
    const specs = await checkSpecs(selection.groups, selection.docs);
    report.planned = specs.map((spec) => spec.name);
    const requiredInputs = await verifyTools(specs, report.tools);
    const skillFiles = selection.groups.includes("repository")
      ? (await import("./skills.ts")).listSkillFiles
      : () => [];
    const sourcePaths = () => [
      ...new Set([
        ...listSourcePaths(root),
        ...requiredInputs,
        ...skillFiles(root),
        ...fileInputs(path.join(root, "node_modules"), true),
        ...[
          "scripts",
          "tests",
          ...(selection.groups.includes("repository")
            ? ["delivery/policy", "config", ".githooks"]
            : []),
          ...(selection.groups.includes("ci") ? [".github"] : []),
        ].flatMap((directory) => fileInputs(path.join(root, directory))),
      ]),
    ];
    report.source = readSourceIdentity(root, sourcePaths());
    if (
      selection.report &&
      report.source.entries.some(
        (entry) => path.join(root, entry.path) === selection.report,
      )
    )
      throw new Error("Report is a bound source input");
    report.results = await runChecks(specs);
    const after: SourceIdentity = readSourceIdentity(root, sourcePaths());
    if (after.sha256 !== report.source.sha256)
      throw new Error("Source changed during checks");
    report.passed =
      report.results.length === specs.length &&
      report.results.every((result) => result.passed);
  } catch (error) {
    report.errors.push(
      error instanceof z.ZodError
        ? JSON.stringify(
            error.issues.map((issue) => ({
              code: issue.code,
              path: issue.path,
              message: issue.message,
            })),
          )
        : error instanceof Error
          ? error.message
          : "Check failed",
    );
  }
  CheckReportSchema.parse(report);
  if (selection.report) {
    try {
      writeCheckReport(report, selection.report);
    } catch (error) {
      report.passed = false;
      report.errors.push(
        error instanceof Error ? error.message : "Report write failed",
      );
    }
  }
  for (const error of report.errors) console.error(error);
  console.log(
    `\n${report.passed ? "PASS" : "FAIL"}: ${report.results.filter((result) => result.passed).length}/${report.planned.length} selected checks`,
  );
  process.exitCode = report.passed ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await main();
