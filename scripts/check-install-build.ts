// - Read [build tool contract](check.ts). Use tool `bun`.
// - Read [runtime contract](check.ts). Use tool `node`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildInstall } from "./build-install.ts";
import { installerBuildFiles } from "./install-records.ts";

/** Rebuild independently, compare bytes and run the bundle without the checkout or dependencies. */
export function checkInstallBuild(root: string, toolsRoot = root): void {
  const temporary = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "agents-install-build-")),
  );
  try {
    buildInstall(root, temporary, toolsRoot);
    for (const name of installerBuildFiles) {
      assert.deepEqual(
        readFileSync(path.join(root, ".cache/agents-build", name)),
        readFileSync(path.join(temporary, name)),
        `Stale installer closure: ${name}`,
      );
    }
    const bundle = path.join(temporary, installerBuildFiles[0]);
    assert.ok(
      !readFileSync(bundle).includes(Buffer.from(root)),
      "Installer bundle contains a checkout path",
    );
    const result = spawnSync(process.execPath, [bundle], {
      cwd: temporary,
      env: { HOME: temporary },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(
      result.status,
      2,
      "Installer bundle must reject missing arguments without loading external dependencies",
    );
    assert.doesNotMatch(
      result.stderr,
      /ERR_MODULE_NOT_FOUND|Cannot find|ReferenceError/,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  checkInstallBuild(path.resolve(import.meta.dirname, ".."));
