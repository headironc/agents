import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { z } from "zod";
import { readSourceEntries } from "./source.ts";

// Require delivered tool capabilities and their intended products.
const requiredSkills = [
  { path: "figma-design-workflow", target: "codex" },
  { path: "gh", target: "shared" },
  { path: "project-guide", target: "shared" },
  { path: "gh-identity", target: "shared" },
  { path: "alibabacloud-find-skills", target: "shared" },
  { path: "alibabacloud-sms-send-short-message", target: "shared" },
  { path: "wechatide", target: "shared" },
  { path: "wechatide/skills/automator", target: "shared" },
  { path: "wechatide/skills/cloudbase-operator", target: "shared" },
  { path: "wechatide/skills/compiler", target: "shared" },
  { path: "wechatide/skills/debugger", target: "shared" },
  { path: "wechatide/skills/initializer", target: "shared" },
  { path: "wechatide/skills/installer", target: "shared" },
  { path: "wechatide/skills/previewer", target: "shared" },
  { path: "wechatide/skills/project-config", target: "shared" },
  { path: "wechatide/skills/project-manager", target: "shared" },
] as const;
const EntrySchema = z
  .tuple([
    z
      .string()
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/skills\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/,
      ),
    z.enum(["shared", "codex", "claude"]),
  ])
  .transform(([skillPath, target]) => ({
    path: skillPath,
    target,
    topLevel: skillPath.split("/")[0]!,
  }));
export type SkillEntry = z.infer<typeof EntrySchema>;
const FrontmatterSchema = z.looseObject({
  name: z.string().min(1).max(64),
  description: z.string().trim().min(1),
});

/** Select a product's delivered entries after common membership validation. */
export function selectSkillEntries(
  entries: SkillEntry[],
  product: "codex" | "claude",
): SkillEntry[] {
  return entries.filter(
    (entry) => entry.target === "shared" || entry.target === product,
  );
}

/** Enumerate all candidate skill assets, including ignored files; reject links and special files. */
export function listSkillFiles(root: string): string[] {
  const files: string[] = [];
  const directory = path.join(root, "delivery/skills");
  try {
    lstatSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return files;
    throw error;
  }
  function visit(relative: string): void {
    const absolute = path.join(root, relative);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink())
      throw new Error(`Skill symlink rejected: ${relative}`);
    if (stat.isDirectory()) {
      for (const child of readdirSync(absolute)) visit(`${relative}/${child}`);
    } else if (stat.isFile()) files.push(relative);
    else throw new Error(`Special skill input rejected: ${relative}`);
  }
  visit("delivery/skills");
  return files.sort((left, right) =>
    Buffer.compare(Buffer.from(left), Buffer.from(right)),
  );
}

/** Parse the candidate manifest once for validation and installation; never read installed skills. */
export function readSkillEntries(root: string): SkillEntry[] {
  const manifest = "config/personal-skills.txt";
  // Installation reads frozen source outside Git, so membership checks need no baseline.
  readSourceEntries(root, [manifest]);
  const entries = readFileSync(path.join(root, manifest), "utf8")
    .split("\n")
    .flatMap((line, index) => {
      if (line === "" || line.startsWith("#")) return [];
      try {
        return [EntrySchema.parse(line.split("\t"))];
      } catch (error) {
        throw new Error(`Invalid skill manifest line ${index + 1}`, {
          cause: error,
        });
      }
    });
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  if (byPath.size !== entries.length)
    throw new Error("Duplicate skill manifest member");
  for (const required of requiredSkills) {
    const entry = byPath.get(required.path);
    if (!entry) throw new Error(`Required skill is missing: ${required.path}`);
    if (entry.target !== required.target)
      throw new Error(`Required skill product differs: ${required.path}`);
  }
  const files = listSkillFiles(root);
  if (files.length > 0) readSourceEntries(root, files);
  const discovered = files
    .filter((file) => path.posix.basename(file) === "SKILL.md")
    .map((file) => file.slice("delivery/skills/".length, -"/SKILL.md".length));
  if (
    discovered.length !== entries.length ||
    discovered.some((name) => !byPath.has(name))
  ) {
    throw new Error("Skill manifest and source entrypoints differ");
  }
  if (entries.length === 0 && files.length !== 0)
    throw new Error("Skill assets have no delivered entrypoint");
  for (const entry of entries) {
    const top = byPath.get(entry.topLevel);
    if (!top || entry.target !== top.target)
      throw new Error(
        `Nested skill product disagrees with its top-level owner: ${entry.path}`,
      );
    const text = readFileSync(
      path.join(root, "delivery/skills", entry.path, "SKILL.md"),
      "utf8",
    );
    const frontmatter = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
    if (!frontmatter)
      throw new Error(`Missing skill frontmatter: ${entry.path}`);
    const metadata = FrontmatterSchema.parse(load(frontmatter[1]!));
    if (metadata.name !== path.posix.basename(entry.path))
      throw new Error(`Skill name differs from directory: ${entry.path}`);
  }
  return entries.sort((left, right) =>
    Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
  );
}
