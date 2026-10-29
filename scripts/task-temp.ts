#!/usr/bin/env node
// Run only authorized foreground commands that await all their descendants. The command keeps
// its original cwd and receives TASK_TEMP_DIR and TMPDIR pointing at fresh private scratch space.
// Remove only this invocation's allocation after a known exit. Retain on interruption, changed
// ownership markers, Git metadata, or inspection failure. Never remove pre-existing directories.
// Scan is read-only, shallow, does not follow symlinks, and never declares a directory safe to delete.

import { spawn } from "node:child_process";
import {
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";

const marker = ".agents-task-temp.json";
const metadata = z
  .object({
    version: z.literal(1),
    owner: z.string().trim().min(1),
    purpose: z.string().trim().min(1),
    createdAt: z.iso.datetime(),
  })
  .strict();

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Opening with O_NOFOLLOW also rejects a replaced marker; size bounds keep scans bounded.
function readMetadata(directory: string): z.infer<typeof metadata> {
  const file = path.join(directory, marker);
  const descriptor = openSync(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 16_384)
      throw new Error("Invalid ownership marker");
    return metadata.parse(JSON.parse(readFileSync(descriptor, "utf8")));
  } finally {
    closeSync(descriptor);
  }
}

export function scan(root: string): {
  readOnly: true;
  root: string;
  entries: object[];
  errors: number;
} {
  const entries: object[] = [];
  let errors = 0;
  if (!lstatSync(root).isDirectory())
    throw new Error("Scan root must be a physical directory");
  for (const name of readdirSync(root).sort()) {
    const directory = path.join(root, name);
    try {
      const stat = lstatSync(directory);
      if (stat.isSymbolicLink()) {
        entries.push({ path: directory, kind: "symlink", status: "unknown" });
        continue;
      }
      if (!stat.isDirectory()) continue;
      let ownership;
      try {
        ownership = readMetadata(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      entries.push({
        path: directory,
        kind: ownership ? "task-temp" : "unmanaged",
        status: "needs-owner-check",
        modifiedAt: stat.mtime.toISOString(),
        ...(ownership ? { ownership } : {}),
      });
    } catch (error) {
      errors++;
      entries.push({
        path: directory,
        status: "unreadable",
        error: errorText(error),
      });
    }
  }
  return { readOnly: true, root, entries, errors };
}

function inspectForCleanup(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git")
      throw new Error("Git metadata requires worktree/repository closeout");
    // rm unlinks symlinks, never traverses their targets.
    if (entry.isDirectory())
      inspectForCleanup(path.join(directory, entry.name));
    else if (!entry.isFile() && !entry.isSymbolicLink())
      throw new Error("Special file requires owner check");
  }
}

async function run(
  root: string,
  owner: string,
  purpose: string,
  command: string[],
): Promise<number> {
  if (!command.length) throw new Error("run requires -- COMMAND [ARG...]");
  const record = metadata.parse({
    version: 1,
    owner,
    purpose,
    createdAt: new Date().toISOString(),
  });
  if (Buffer.byteLength(JSON.stringify(record)) > 16_384)
    throw new Error("Ownership marker too large");
  if (!lstatSync(root).isDirectory())
    throw new Error("Run root must be a physical directory");
  const directory = mkdtempSync(path.join(realpathSync(root), "agents-task-"));
  const identity = lstatSync(directory);
  const scratch = path.join(directory, "scratch");
  let interrupted = false;
  let status = 1;
  let reason: string | undefined;
  try {
    writeFileSync(path.join(directory, marker), JSON.stringify(record) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    mkdirSync(scratch, { mode: 0o700 });
    process.stderr.write(
      JSON.stringify({ taskTemp: directory, scratch, owner, purpose }) + "\n",
    );
    const child = spawn(command[0]!, command.slice(1), {
      stdio: "inherit",
      env: {
        ...process.env,
        TASK_TEMP_DIR: scratch,
        TMPDIR: scratch,
        TMP: scratch,
        TEMP: scratch,
      },
    });
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
    const handlers = signals.map((signal) => {
      const handler = () => {
        interrupted = true;
        child.kill(signal);
      };
      process.on(signal, handler);
      return { signal, handler };
    });
    try {
      status = await new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => {
          if (signal) interrupted = true;
          resolve(code ?? 1);
        });
      });
    } finally {
      for (const { signal, handler } of handlers) process.off(signal, handler);
    }
    if (interrupted)
      reason =
        "Interrupted command; process and operation lifetimes need owner verification";
  } catch (error) {
    reason = errorText(error);
  }
  if (!reason) {
    try {
      const current = lstatSync(directory);
      if (
        !current.isDirectory() ||
        current.dev !== identity.dev ||
        current.ino !== identity.ino ||
        JSON.stringify(readMetadata(directory)) !== JSON.stringify(record)
      ) {
        throw new Error("Allocation identity or ownership marker changed");
      }
      inspectForCleanup(directory);
      rmSync(directory, { recursive: true });
    } catch (error) {
      reason = errorText(error);
    }
  }
  process.stderr.write(
    JSON.stringify({
      taskTemp: directory,
      cleanup: reason ? "retained" : "removed",
      ...(reason ? { reason } : {}),
    }) + "\n",
  );
  return reason ? status || 1 : status;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--version") {
    console.log("1.0.0");
    return;
  }
  if (args[0] === "--help") {
    console.log(
      "task-temp [scan] [--root DIR]\ntask-temp run --owner TASK --purpose TEXT [--root DIR] -- COMMAND [ARG...]\nscan is read-only; run cleans only its fresh allocation after a known foreground exit.",
    );
    return;
  }
  const implicit = !args.length || args[0]!.startsWith("-");
  const action = implicit ? "scan" : args[0]!;
  if (!["run", "scan"].includes(action))
    throw new Error("Expected run or scan");
  const parsed = parseArgs({
    args: implicit ? args : args.slice(1),
    allowPositionals: action === "run",
    strict: true,
    options: {
      root: { type: "string" },
      ...(action === "run"
        ? {
            owner: { type: "string" as const },
            purpose: { type: "string" as const },
          }
        : {}),
    },
  });
  const root = path.resolve(parsed.values.root ?? os.tmpdir());
  if (action === "scan") {
    const report = scan(root);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.errors ? 1 : 0;
  } else {
    if (!args.includes("--")) throw new Error("Separate command with --");
    process.exitCode = await run(
      root,
      z.string().parse(parsed.values.owner),
      z.string().parse(parsed.values.purpose),
      parsed.positionals,
    );
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`task-temp: ${errorText(error)}`);
    process.exitCode = 1;
  });
}
