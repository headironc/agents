import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  digest,
  gitBlob,
  readGitSource,
  readGitBytes,
} from "./upstream-git.ts";
import type { ReadSource } from "./upstream-git.ts";

export const pbtRepository = "trailofbits/skills";
export const pbtRepositoryId = 1134447175;
export const pbtLock = "config/property-testing-source.json";
export const pbtRoot = "config/upstream/property-based-testing";
export const pbtSkill = "delivery/skills/property-based-testing";
export const pbtUpstream =
  "plugins/property-based-testing/skills/property-based-testing";
export const pbtReferences = [
  "generating",
  "interpreting-failures",
  "libraries",
  "refactoring",
  "reviewing",
] as const;
export const pbtInputs = [
  "LICENSE",
  `${pbtUpstream}/SKILL.md`,
  ...pbtReferences.map((x) => `${pbtUpstream}/references/${x}.md`),
];
export const pbtLocal = [
  "LICENSE.txt",
  "SKILL.md",
  ...pbtReferences.map((x) => `references/${x}.md`),
];
export const pbtTarget = (source: string) =>
  `${pbtRoot}/${source === "LICENSE" ? "LICENSE" : source.slice(pbtUpstream.length + 1).replaceAll("/", "-")}.txt`;
const oid = z.string().regex(/^[a-f0-9]{40}$/),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
export const pbtSourceSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    repository: z.literal(pbtRepository),
    repositoryId: z.literal(pbtRepositoryId),
    branch: z.literal("main"),
    revision: oid,
    files: z
      .array(
        z.strictObject({
          source: z.string(),
          target: z.string(),
          bytes: z
            .number()
            .int()
            .positive()
            .max(512 * 1024),
          sha256: hash,
          blob: oid,
        }),
      )
      .length(pbtInputs.length),
    adaptation: z
      .strictObject({
        revision: oid,
        files: z
          .array(z.strictObject({ path: z.string(), sha256: hash }))
          .length(pbtLocal.length),
        decisions: z
          .array(
            z.strictObject({
              source: z.string(),
              decision: z.enum(["adopted", "adapted", "retained"]),
              reason: z.string().trim().min(20).max(2000),
            }),
          )
          .length(pbtInputs.length),
      })
      .nullable(),
  })
  .superRefine((value, context) => {
    if (
      JSON.stringify(value.files.map((x) => x.source)) !==
        JSON.stringify(pbtInputs) ||
      value.files.some((x) => x.target !== pbtTarget(x.source)) ||
      (value.adaptation &&
        (JSON.stringify(value.adaptation.files.map((x) => x.path)) !==
          JSON.stringify(pbtLocal) ||
          JSON.stringify(value.adaptation.decisions.map((x) => x.source)) !==
            JSON.stringify(pbtInputs)))
    )
      context.addIssue({
        code: "custom",
        message: "Property testing membership differs",
      });
  });
export type PbtSource = z.infer<typeof pbtSourceSchema>;

function regular(root: string, relative: string): Buffer {
  let current = root;
  const parts = relative.split("/");
  for (const [i, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = lstatSync(current);
    if (
      stat.isSymbolicLink() ||
      (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())
    )
      throw new Error(`Unsafe property testing path: ${relative}`);
  }
  return readFileSync(current);
}

export function verifyPbtSource(root: string, adapted = true): PbtSource {
  const source = pbtSourceSchema.parse(
    JSON.parse(regular(root, pbtLock).toString("utf8")),
  );
  if (
    JSON.stringify(readdirSync(path.join(root, pbtRoot)).sort()) !==
    JSON.stringify(source.files.map((x) => path.basename(x.target)).sort())
  )
    throw new Error("Property testing originals differ");
  for (const file of source.files) {
    const bytes = regular(root, file.target);
    if (
      bytes.length !== file.bytes ||
      digest(bytes) !== file.sha256 ||
      gitBlob(bytes) !== file.blob
    )
      throw new Error(`Property testing bytes differ: ${file.source}`);
  }
  const localFiles: string[] = [];
  const visit = (relative: string) => {
    for (const name of readdirSync(path.join(root, pbtSkill, relative))) {
      const file = path.posix.join(relative, name),
        stat = lstatSync(path.join(root, pbtSkill, file));
      if (stat.isSymbolicLink())
        throw new Error("Linked property testing asset");
      if (stat.isDirectory()) visit(file);
      else {
        regular(root, `${pbtSkill}/${file}`);
        localFiles.push(file);
      }
    }
  };
  visit("");
  if (
    JSON.stringify(localFiles.sort()) !== JSON.stringify([...pbtLocal].sort())
  )
    throw new Error("Property testing skill membership differs");
  if (
    adapted &&
    (source.adaptation?.revision !== source.revision ||
      source.adaptation.files.some(
        (x) => digest(regular(root, `${pbtSkill}/${x.path}`)) !== x.sha256,
      ) ||
      !regular(root, `${pbtSkill}/SKILL.md`)
        .toString("utf8")
        .includes(
          `https://github.com/${pbtRepository}/tree/${source.revision}`,
        ) ||
      !regular(root, `${pbtSkill}/LICENSE.txt`).equals(
        regular(root, pbtTarget("LICENSE")),
      ))
  )
    throw new Error(
      "Property testing adaptation pending or local skill changed; assess this revision and exact delivered files",
    );
  return source;
}

export async function planPbtImport(
  previous: PbtSource | null,
  read: ReadSource = readGitBytes,
  revision?: string,
) {
  const imported = await readGitSource(
    {
      name: "Property testing",
      repository: pbtRepository,
      repositoryId: pbtRepositoryId,
      branch: "main",
      files: pbtInputs.map((source) => ({ source, target: pbtTarget(source) })),
      completeDirectories: [`${pbtUpstream}/references/`],
    },
    previous?.revision ?? null,
    read,
    revision,
  );
  const source = pbtSourceSchema.parse({
    schemaVersion: 1,
    repository: pbtRepository,
    repositoryId: pbtRepositoryId,
    branch: "main",
    revision: imported.revision,
    files: imported.entries,
    adaptation: previous?.adaptation ?? null,
  });
  if (
    previous?.revision === source.revision &&
    JSON.stringify(previous.files) !== JSON.stringify(source.files)
  )
    throw new Error("Same-revision property testing drift");
  return { source, files: imported.files };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (process.argv.length !== 3 || process.argv[2] !== "--check")
    throw new Error("Usage: property-testing-source.ts --check");
  console.log(
    `Property testing adaptation verified: ${verifyPbtSource(path.resolve(import.meta.dirname, "..")).revision}`,
  );
}
