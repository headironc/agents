import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { adaptedSource } from "./adapted-source.ts";
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

export const pbtSource = adaptedSource({
  name: "Property testing",
  key: "property-based-testing",
  repository: pbtRepository,
  repositoryId: pbtRepositoryId,
  lock: pbtLock,
  root: pbtRoot,
  skill: pbtSkill,
  inputs: pbtInputs,
  local: pbtLocal,
  license: "LICENSE",
  target: pbtTarget,
  completeDirectories: [`${pbtUpstream}/references/`],
});
export const pbtSourceSchema = pbtSource.schema;
export type PbtSource = z.infer<typeof pbtSourceSchema>;
export const verifyPbtSource = pbtSource.verify;
export const planPbtImport = pbtSource.planImport;

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
