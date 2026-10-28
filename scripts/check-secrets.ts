// - Read [contract](../delivery/policy/tool-contracts.md). Use tool `git`.
// - Read [executor](check.ts). Use tool `gitleaks`.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  canonicalDigest,
  listSourcePaths,
  readSourceEntries,
  readSourceIdentity,
} from "./source.ts";

export function screenSource(
  root: string,
  gitleaks: string,
  copySource: typeof copyFileSync = copyFileSync,
  configuration = path.join(root, ".gitleaks.toml"),
): number {
  const paths = listSourcePaths(root);
  const before = readSourceIdentity(root, paths);
  const snapshot = mkdtempSync(path.join(os.tmpdir(), "agents-secret-screen-"));
  try {
    for (const file of paths) {
      const destination = path.join(snapshot, file);
      mkdirSync(path.dirname(destination), { recursive: true });
      copySource(path.join(root, file), destination);
    }
    if (
      canonicalDigest(readSourceEntries(snapshot, paths)) !==
      canonicalDigest(before.entries)
    ) {
      throw new Error("Secret screening snapshot differs from source");
    }
    if (readSourceIdentity(root, paths).sha256 !== before.sha256) {
      throw new Error("Source changed while preparing secret screening");
    }
    const result = spawnSync(
      gitleaks,
      [
        "dir",
        snapshot,
        "--no-banner",
        "--redact",
        "--ignore-gitleaks-allow",
        "--config",
        configuration,
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.signal)
      throw new Error(`Secret screening terminated by ${result.signal}`);
    return result.status ?? 1;
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [root, gitleaks] = process.argv.slice(2);
  if (!root || !gitleaks || process.argv.length !== 4) {
    console.error(
      "Usage: node scripts/check-secrets.ts <repository> <gitleaks>",
    );
    process.exitCode = 2;
  } else {
    try {
      process.exitCode = screenSource(
        path.resolve(root),
        path.resolve(gitleaks),
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
