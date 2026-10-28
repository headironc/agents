// Contract subject: `markdownlint-cli2`.
// Contract subject: `lychee`.
// The executor supplies literal source paths, pinned tools and offline link validation.
// - Read [executor](check.ts). Use tool `node`.
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { lint, readConfig } from "markdownlint/sync";
import type { Configuration } from "markdownlint";
import jsoncParse from "markdownlint-cli2/parsers/jsonc";
import { listSourcePaths, readSourceIdentity } from "./source.ts";

const root = path.resolve(import.meta.dirname, "..");

export function listMarkdown(directory: string): string[] {
  const files = listSourcePaths(directory).filter((file) =>
    file.endsWith(".md"),
  );
  if (files.length === 0) throw new Error("No Markdown files found");
  readSourceIdentity(directory, files);
  return files;
}

export function markdownlintArguments(files: string[]): string[] {
  return ["--no-globs", ...files.map((file) => `:./${file}`)];
}

export function checkMachinePaths(directory: string, files: string[]): void {
  const pattern = new RegExp("/(" + "home|Users" + ")/");
  for (const file of files.filter((item) =>
    /\.(md|ts|sh|ya?ml|jsonc?)$/.test(item),
  )) {
    if (!lstatSync(path.join(directory, file)).isFile())
      throw new Error(`Invalid text source: ${file}`);
    const lines = readFileSync(path.join(directory, file), "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      if (pattern.test(line))
        throw new Error(`Machine-specific path at ${file}:${index + 1}`);
    }
  }
}

function main(): void {
  const mode = process.argv[2] ?? "all";
  if (process.argv.length > 3 || !["all", "markdown", "links"].includes(mode)) {
    process.exitCode = 2;
    throw new Error("Usage: node scripts/check-docs.ts [all|markdown|links]");
  }
  checkDocuments(root, mode);
}

export function checkDocuments(
  root: string,
  mode = "all",
  toolsRoot = root,
): void {
  const manifest = JSON.parse(
    readFileSync(path.join(toolsRoot, "package.json"), "utf8"),
  );
  if (process.versions.node !== manifest.engines.node)
    throw new Error("Pinned Node is required");
  const files = listMarkdown(root);
  checkMachinePaths(root, listSourcePaths(root));
  function run(command: string, args: string[]): void {
    const result = spawnSync(command, args, {
      cwd: toolsRoot,
      stdio: "inherit",
      timeout: 120_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        `Document check failed (${result.signal ?? result.status})`,
      );
  }
  console.log(`Checking ${files.length} Markdown files with explicit paths.`);
  if (mode !== "links") {
    const location = path.join(
      toolsRoot,
      "node_modules/markdownlint-cli2/package.json",
    );
    const dependency = JSON.parse(readFileSync(location, "utf8"));
    if (dependency.version !== manifest.devDependencies["markdownlint-cli2"])
      throw new Error("Stale Markdown dependency");
    const executable =
      typeof dependency.bin === "string"
        ? dependency.bin
        : dependency.bin["markdownlint-cli2"];
    if (toolsRoot !== root) {
      // CLI directory discovery can import candidate .mjs configuration before linting.
      // The minimum reads only the fixed configuration and explicit source operands.
      const options = readConfig(
        path.join(toolsRoot, ".markdownlint-cli2.jsonc"),
        [jsoncParse],
      );
      const results = lint({
        files: files.map((file) => path.join(root, file)),
        config: options.config as Configuration,
        noInlineConfig: true,
      });
      if (Object.values(results).some((findings) => findings.length))
        throw new Error(`Document check failed: ${results.toString()}`);
    } else
      run(process.execPath, [
        path.resolve(path.dirname(location), executable),
        "--config",
        path.join(toolsRoot, ".markdownlint-cli2.jsonc"),
        ...markdownlintArguments(files),
      ]);
  }
  if (mode !== "markdown") {
    console.log(
      "Links and anchors are checked offline; external URLs are excluded.",
    );
    // The settings live in `lychee.toml` so the published-form run answers the same way.
    run(path.join(toolsRoot, ".cache/agents-tools/bin/lychee"), [
      "-c",
      path.join(toolsRoot, "lychee.toml"),
      "--root-dir",
      root,
      ...files.map((file) => path.join(root, file)),
    ]);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Document check failed",
    );
    process.exitCode ||= 1;
  }
}
