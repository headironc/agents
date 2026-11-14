import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyModernWebSource } from "../../scripts/modern-web-source.ts";
import { repositoryRoot } from "./fixtures.ts";

test("the pinned CLI searches and retrieves locally in distinct read-only projects", (t) => {
  verifyModernWebSource(repositoryRoot);
  const vendor = path.join(
    repositoryRoot,
    "delivery/skills/modern-web-guidance/upstream",
  );
  const version = readFileSync(
    path.join(vendor, "skill-version.txt"),
    "utf8",
  ).trim();
  for (const label of ["storefront", "employee-portal"]) {
    const directory = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), `modern-web-${label}-`)),
    );
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const config = '{"baseline":"widely"}\n';
    writeFileSync(path.join(directory, ".mwgrc"), config);
    const args = [
      "--permission",
      `--allow-fs-read=${vendor}`,
      `--allow-fs-read=${directory}`,
      path.join(vendor, "modern-web.mjs"),
    ];
    const options = {
      cwd: directory,
      env: {
        HOME: directory,
        TMPDIR: directory,
        DISABLE_TELEMETRY: "1",
        ENABLE_FILE_LOGGING: "false",
      },
      timeout: 30_000,
      encoding: "utf8" as const,
    };
    // Network, writes and child processes are denied by the Node permission model.
    const search = spawnSync(
      process.execPath,
      [...args, "search", "modal dialog", "--skill-version", version],
      options,
    );
    assert.ifError(search.error);
    assert.equal(search.status, 0, search.stderr);
    const matches = JSON.parse(search.stdout) as { id: string }[];
    assert.ok(matches.some((entry) => entry.id === "dialog"));
    const output = path.join(directory, "guide.md");
    const fd = openSync(output, "w");
    try {
      const retrieve = spawnSync(
        process.execPath,
        [...args, "retrieve", "dialog", "--skill-version", version],
        { ...options, stdio: ["ignore", fd, "pipe"] },
      );
      assert.ifError(retrieve.error);
      assert.equal(retrieve.status, 0, retrieve.stderr);
    } finally {
      closeSync(fd);
    }
    const guide = readFileSync(output, "utf8");
    assert.match(guide, /<dialog/);
    assert.match(guide, /showModal/);
    assert.ok(
      guide.length > 9500,
      "The large guide must be retrieved in full through regular-file stdout",
    );
    const missing = spawnSync(
      process.execPath,
      [
        ...args,
        "retrieve",
        "nonexistent-agents-guide",
        "--skill-version",
        version,
      ],
      options,
    );
    assert.ifError(missing.error);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /No guide found/);
    assert.equal(readFileSync(path.join(directory, ".mwgrc"), "utf8"), config);
    assert.deepEqual(readdirSync(directory).sort(), [".mwgrc", "guide.md"]);
  }
});
