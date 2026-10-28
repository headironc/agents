// - Read [build tool contract](check.ts). Use tool `bun`.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { installerBuildFiles } from "./install-records.ts";

/** Bundle the installer and its Zod/js-yaml closure; persistent runs copy these outputs. */
export function buildInstall(
  root: string,
  output: string,
  toolsRoot = root,
): void {
  const manifest = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  );
  if (process.versions.node !== manifest.engines.node)
    throw new Error("Pinned Node required");
  const bun = path.join(toolsRoot, ".cache/agents-tools/bin/bun");
  const version = spawnSync(bun, ["--version"], {
    cwd: toolsRoot,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (
    version.status !== 0 ||
    version.stdout.trim() !== manifest.packageManager.slice(4)
  )
    throw new Error("Pinned Bun required");
  mkdirSync(output, { recursive: true, mode: 0o700 });
  // Without this the bundler keeps the `development` export condition, which Node has no notion of,
  // so the product could be built from entries the reviewed source never loads.
  // Strip whitespace and location comments so a trusted startup cwd does not change bundle bytes.
  // Keep syntax and identifiers intact; dependency export conditions remain explicit.
  const result = spawnSync(
    bun,
    [
      "build",
      path.join(root, "scripts/install.ts"),
      "--target=node",
      "--format=esm",
      "--minify-whitespace",
      "--outfile",
      path.join(output, installerBuildFiles[0]),
    ],
    {
      cwd: toolsRoot,
      stdio: "pipe",
      timeout: 30_000,
      env: { ...process.env, NODE_ENV: "production" },
    },
  );
  if (result.status !== 0) throw new Error("Installer build failed");
  const notices = ["zod", "js-yaml"].map(
    (name) =>
      `== ${name} ==\n\n${readFileSync(path.join(root, "node_modules", name, "LICENSE"), "utf8")}`,
  );
  writeFileSync(path.join(output, installerBuildFiles[1]), notices.join("\n"));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (process.argv.length !== 2)
    throw new Error("No build arguments supported");
  const root = path.resolve(import.meta.dirname, "..");
  buildInstall(root, path.join(root, ".cache/agents-build"));
}
