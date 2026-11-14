import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  modernWebLock,
  modernWebPathExists,
  modernWebRoot,
  modernWebSourceSchema,
  planModernWebImport,
  sha256,
  verifyModernWebSource,
} from "./modern-web-source.ts";
import type { ModernWebSource } from "./modern-web-source.ts";

/** Explicit import only. Updates never execute downloaded package code. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--version")
    throw new Error("Usage: update-modern-web-guidance.ts --version VERSION");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const plan = await planModernWebImport(args[1]!);
  applyModernWebImport(root, plan);
  console.log(
    `Verified modern-web-guidance ${plan.source.version}: ${plan.files.size} upstream files`,
  );
}

export function applyModernWebImport(
  root: string,
  plan: { source: ModernWebSource; files: Map<string, Buffer> },
): void {
  const source = modernWebSourceSchema.parse(plan.source);
  if (plan.files.size !== source.files.length)
    throw new Error("Import plan membership differs from source lock");
  for (const file of source.files) {
    const bytes = plan.files.get(file.target);
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length !== file.bytes ||
      sha256(bytes) !== file.sha256
    )
      throw new Error(`Import plan bytes differ: ${file.target}`);
  }
  const lock = path.join(root, modernWebLock);
  const vendor = path.join(root, modernWebRoot);
  const previous = modernWebPathExists(lock)
    ? verifyModernWebSource(root)
    : new Set<string>();
  if (previous.size === 0 && modernWebPathExists(vendor))
    throw new Error("Unmanaged upstream directory already exists");
  // Preserve all previous bytes until the replacement passes complete readback.
  const previousLock = existsSync(lock) ? readFileSync(lock) : undefined;
  const recovery = new Map(
    [...previous].map((relative) => [
      relative,
      readFileSync(path.join(root, relative)),
    ]),
  );
  for (const relative of [modernWebLock, ...plan.files.keys()]) {
    let current = root;
    for (const part of relative.split("/").slice(0, -1)) {
      current = path.join(current, part);
      if (
        modernWebPathExists(current) &&
        (!lstatSync(current).isDirectory() ||
          lstatSync(current).isSymbolicLink())
      )
        throw new Error(`Unsafe destination: ${current}`);
    }
  }
  try {
    for (const [relative, bytes] of plan.files) {
      const target = path.join(root, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      if (modernWebPathExists(target) && lstatSync(target).isSymbolicLink())
        throw new Error(`Unsafe destination: ${target}`);
      if (!existsSync(target) || !readFileSync(target).equals(bytes))
        writeFileSync(target, bytes);
    }
    for (const relative of previous)
      if (!plan.files.has(relative)) rmSync(path.join(root, relative));
    writeFileSync(lock, `${JSON.stringify(plan.source, null, 2)}\n`);
    verifyModernWebSource(root);
  } catch (error) {
    // All package bytes and the old lock stay in memory until readback succeeds.
    try {
      for (const relative of plan.files.keys())
        if (!previous.has(relative))
          rmSync(path.join(root, relative), { force: true });
      for (const [relative, bytes] of recovery)
        writeFileSync(path.join(root, relative), bytes);
      if (previousLock) {
        writeFileSync(lock, previousLock);
        verifyModernWebSource(root);
      } else {
        rmSync(lock, { force: true });
        rmSync(vendor, { recursive: true, force: true });
      }
    } catch (recoveryError) {
      throw new AggregateError(
        [error, recoveryError],
        "Import and rollback failed; preserve the checkout for recovery",
      );
    }
    throw error;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
