// Contract subject: `skill-validation`.
// Validate each product's skills with its pinned upstream validator in a private directory.
// - Read [validator](skill-validator.py). Use tool `python`.
// - Read [executor](check.ts). Use tool `node`.
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { canonicalDigest, readSourceEntries } from "./source.ts";
import { readSkillEntries, selectSkillEntries } from "./skills.ts";
import type { SkillEntry } from "./skills.ts";
import { products } from "./delivery.ts";
import type { Product } from "./delivery.ts";

const root = path.resolve(import.meta.dirname, "..");

/** Supply only noncredential environment values to offline validator processes. */
export function validatorEnvironment(home: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: home, TMPDIR: home, LANG: "C.UTF-8" };
}

function run(
  command: string,
  args: string[],
  cwd: string,
  home: string,
): string {
  const result = spawnSync(command, args, {
    cwd,
    env: validatorEnvironment(home),
    encoding: "utf8",
    timeout: 30_000,
    killSignal: "SIGKILL",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0 || result.signal) {
    throw new Error(
      `Skill validator failed (${(result.error as NodeJS.ErrnoException | undefined)?.code ?? result.signal ?? result.status}): ${result.stderr?.slice(-1500) ?? ""}`,
    );
  }
  return result.stdout;
}

/** Verify pinned validator code and return its source-bound cache inputs. */
export function validatorInputs(directory: string): string[] {
  const inputs = JSON.parse(
    run(
      "python3",
      [
        "-I",
        "-B",
        path.join(directory, "scripts/skill-validator.py"),
        "verify",
      ],
      directory,
      os.tmpdir(),
    ),
  );
  const paths = z.array(z.string().min(1)).min(1).parse(inputs);
  // Cache inputs need file validation; the enclosing check report binds the Git source.
  readSourceEntries(directory, paths);
  return paths;
}

/** Execute the selected upstream validator on explicitly selected candidate entries. */
export function validateSkills(
  product: Product,
  directories: string[],
  toolsRoot = root,
): void {
  if (directories.length === 0)
    throw new Error(`Empty ${product} validation selection`);
  const temporary = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "agents-skill-validation-")),
  );
  try {
    const result = z
      .strictObject({
        product: z.literal(product),
        validated: z.number().int().positive(),
      })
      .parse(
        JSON.parse(
          run(
            "python3",
            [
              "-I",
              "-B",
              path.join(toolsRoot, "scripts/skill-validator.py"),
              "validate",
              product,
              ...directories,
            ],
            temporary,
            temporary,
          ),
        ),
      );
    if (result.validated !== directories.length)
      throw new Error(`Incomplete ${product} validation coverage`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function validateSkillProduct(
  directory: string,
  product: Product,
  toolsRoot = root,
): void {
  const entries = selectSkillEntries(readSkillEntries(directory), product);
  if (entries.length === 0)
    throw new Error(`Empty ${product} validation selection`);
  validatorInputs(toolsRoot);
  validateSkills(
    product,
    entries.map((entry) => path.join(directory, "delivery/skills", entry.path)),
    toolsRoot,
  );
}

/** Format exact report names; installation recomputes them from the same parsed entries. */
export function skillCheckNames(entries: SkillEntry[]): string[] {
  const counts = products.map(
    (product) => selectSkillEntries(entries, product).length,
  );
  return [
    `Skill membership: ${entries.length === 0 ? "NOT_DELIVERED" : "DELIVERED"}; Codex ${counts[0]}, Claude ${counts[1]}`,
    ...products.flatMap((product, index) =>
      counts[index] ? [skillValidationName(entries, product)] : [],
    ),
  ];
}

export function skillValidationName(
  entries: SkillEntry[],
  product: Product,
): string {
  return `${product === "codex" ? "Codex" : "Claude"} skill validation: ${selectSkillEntries(entries, product).length} entries`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const [mode, expected] = process.argv.slice(2);
    if (
      !["membership", ...products].includes(mode ?? "") ||
      (mode === "membership"
        ? !/^[a-f0-9]{64}$/.test(expected ?? "")
        : expected !== undefined) ||
      process.argv.length > 4
    ) {
      process.exitCode = 2;
      throw new Error(
        "Usage: node scripts/check-skills.ts membership DIGEST | codex | claude",
      );
    }
    if (mode === "membership") {
      const entries = readSkillEntries(root);
      if (canonicalDigest(entries) !== expected)
        throw new Error("Skill membership changed after check planning");
      console.log(skillCheckNames(entries)[0]);
    } else {
      validateSkillProduct(root, mode as Product);
      console.log(`${mode} candidate skill validation passed`);
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Skill validation failed",
    );
    process.exitCode ||= 1;
  }
}
