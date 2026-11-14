import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { Parser } from "tar";
import { z } from "zod";

export const modernWebRoot = "delivery/skills/modern-web-guidance/upstream";
export const modernWebLock = "config/modern-web-guidance-source.json";
const maxArchive = 16 * 1024 * 1024;
const maxExpanded = 40 * 1024 * 1024;
const maxMembers = 400;
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const prefix = "package/skills/modern-web-guidance/";
const names = new Map([
  ["package/LICENSE", "LICENSE"],
  ["package/THIRD_PARTY_NOTICES", "THIRD_PARTY_NOTICES"],
  ["package/README.md", "README.upstream.txt"],
]);

function normalized(value: string): boolean {
  return (
    !value.includes("\\") &&
    !value.includes("\0") &&
    value
      .split("/")
      .every(
        (part) =>
          part !== "" && part !== "." && part !== ".." && part !== ".git",
      )
  );
}

export function modernWebTarget(source: string): string | undefined {
  const rootName = names.get(source);
  const relative = source.startsWith(prefix)
    ? source.slice(prefix.length)
    : rootName;
  if (!relative) return undefined;
  if (!normalized(relative)) throw new Error(`Unsafe upstream path: ${source}`);
  if (relative !== "SKILL.md" && path.posix.basename(relative) === "SKILL.md")
    throw new Error(`Unexpected nested skill: ${source}`);
  return `${modernWebRoot}/${relative === "SKILL.md" ? "SKILL.upstream.md" : relative}`;
}

const fileSchema = z.strictObject({
  source: z.string().refine(normalized),
  target: z.string(),
  bytes: z.number().int().nonnegative().max(maxExpanded),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const modernWebSourceSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    package: z.literal("modern-web-guidance"),
    version: z.string().regex(versionPattern),
    gitHead: z.string().regex(/^[a-f0-9]{40}$/),
    tarball: z.string(),
    integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/),
    files: z.array(fileSchema).min(1).max(maxMembers),
  })
  .superRefine((value, context) => {
    if (
      value.tarball !==
      `https://registry.npmjs.org/modern-web-guidance/-/modern-web-guidance-${value.version}.tgz`
    )
      context.addIssue({ code: "custom", message: "Unexpected tarball URL" });
    const targets = new Set<string>();
    const sources = new Set<string>();
    let total = 0;
    for (const file of value.files) {
      if (
        modernWebTarget(file.source) !== file.target ||
        targets.has(file.target) ||
        sources.has(file.source)
      )
        context.addIssue({
          code: "custom",
          message: "Invalid or duplicate source mapping",
        });
      targets.add(file.target);
      sources.add(file.source);
      total += file.bytes;
    }
    if (total > maxExpanded)
      context.addIssue({
        code: "custom",
        message: "Upstream content too large",
      });
    for (const required of [
      "package/LICENSE",
      "package/THIRD_PARTY_NOTICES",
      "package/README.md",
      `${prefix}SKILL.md`,
      `${prefix}modern-web.mjs`,
      `${prefix}search.mjs`,
      `${prefix}legacy-scan.mjs`,
      `${prefix}package.json`,
      `${prefix}skill-version.txt`,
      `${prefix}gen/guides.json`,
    ]) {
      if (!sources.has(required))
        context.addIssue({
          code: "custom",
          message: `Missing upstream file: ${required}`,
        });
    }
  });
export type ModernWebSource = z.infer<typeof modernWebSourceSchema>;
export const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export function modernWebPathExists(target: string): boolean {
  try {
    lstatSync(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Minimal fixtures omit the entire capability, never just its integrity lock. */
export function verifiedModernWebFiles(root: string): Set<string> {
  if (
    !modernWebPathExists(path.join(root, modernWebLock)) &&
    !modernWebPathExists(path.join(root, modernWebRoot))
  )
    return new Set();
  return verifyModernWebSource(root);
}

/** Verify every immutable vendor byte before exempting it from editorial checks. */
export function verifyModernWebSource(root: string): Set<string> {
  for (const relative of [modernWebLock, modernWebRoot]) {
    let current = root;
    for (const part of relative.split("/")) {
      current = path.join(current, part);
      if (lstatSync(current).isSymbolicLink())
        throw new Error(`Upstream symlink: ${current}`);
    }
  }
  const manifest = modernWebSourceSchema.parse(
    JSON.parse(readFileSync(path.join(root, modernWebLock), "utf8")),
  );
  const actual = new Set<string>();
  const visit = (relative: string): void => {
    const absolute = path.join(root, relative);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Upstream symlink: ${relative}`);
    if (stat.isDirectory())
      for (const name of readdirSync(absolute)) visit(`${relative}/${name}`);
    else if (stat.isFile()) actual.add(relative);
    else throw new Error(`Special upstream file: ${relative}`);
  };
  visit(modernWebRoot);
  if (actual.size !== manifest.files.length)
    throw new Error("Upstream membership differs from source lock");
  for (const file of manifest.files) {
    if (!actual.has(file.target))
      throw new Error(`Missing upstream file: ${file.target}`);
    const bytes = readFileSync(path.join(root, file.target));
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
      throw new Error(`Upstream bytes differ: ${file.target}`);
  }
  return actual;
}

/** Parse as data only; tar never receives a filesystem destination. */
export async function readModernWebArchive(
  archive: Buffer,
  integrity: string,
): Promise<Map<string, Buffer>> {
  if (archive.length > maxArchive)
    throw new Error("Archive exceeds size limit");
  if (
    !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity) ||
    `sha512-${createHash("sha512").update(archive).digest("base64")}` !==
      integrity
  )
    throw new Error("Archive integrity mismatch");
  const unpacked = gunzipSync(archive, { maxOutputLength: maxExpanded });
  const files = new Map<string, Buffer>();
  const seen = new Set<string>();
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    const parser = new Parser({ strict: true, maxMetaEntrySize: 64 * 1024 });
    parser.on("error", reject);
    parser.on("end", resolve);
    parser.on("entry", (entry) => {
      try {
        const name = entry.path.replace(/\/$/, "");
        if (!normalized(name) || !name.startsWith("package/") || seen.has(name))
          throw new Error(`Unsafe or duplicate tar member: ${name}`);
        seen.add(name);
        if (seen.size > maxMembers) throw new Error("Too many tar members");
        if (entry.type !== "File" && entry.type !== "Directory")
          throw new Error(`Unsupported tar member: ${name}`);
        if (entry.type === "Directory" && entry.size !== 0)
          throw new Error("Directory with content");
        total += entry.size;
        if (
          !Number.isSafeInteger(entry.size) ||
          entry.size < 0 ||
          total > maxExpanded
        )
          throw new Error("Expanded archive exceeds size limit");
        const chunks: Buffer[] = [];
        entry.on("data", (chunk: Buffer) => chunks.push(chunk));
        entry.on("end", () => {
          if (entry.type === "File") files.set(name, Buffer.concat(chunks));
        });
        entry.resume();
      } catch (error) {
        parser.abort(error instanceof Error ? error : new Error(String(error)));
      }
    });
    parser.end(unpacked);
  });
  return files;
}

/** Bounded same-origin downloads; no redirects, credentials, or package execution. */
export async function fetchModernWebBytes(
  url: string,
  limit = maxArchive,
): Promise<Buffer> {
  const parsed = new URL(url);
  if (
    parsed.origin !== "https://registry.npmjs.org" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.search
  )
    throw new Error("Unexpected source host");
  const response = await fetch(parsed, {
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok || !response.body)
    throw new Error(`Source HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) throw new Error("Download exceeds size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

export async function planModernWebImport(
  version: string,
): Promise<{ source: ModernWebSource; files: Map<string, Buffer> }> {
  if (!versionPattern.test(version))
    throw new Error("An exact stable version is required");
  const metadata = z
    .object({
      name: z.literal("modern-web-guidance"),
      version: z.literal(version),
      gitHead: z.string().regex(/^[a-f0-9]{40}$/),
      dist: z.object({
        tarball: z.literal(
          `https://registry.npmjs.org/modern-web-guidance/-/modern-web-guidance-${version}.tgz`,
        ),
        integrity: z.string(),
      }),
    })
    .parse(
      JSON.parse(
        (
          await fetchModernWebBytes(
            `https://registry.npmjs.org/modern-web-guidance/${version}`,
            1024 * 1024,
          )
        ).toString("utf8"),
      ),
    );
  const contents = await readModernWebArchive(
    await fetchModernWebBytes(metadata.dist.tarball),
    metadata.dist.integrity,
  );
  const pkg = JSON.parse(
    contents.get("package/package.json")?.toString("utf8") ?? "null",
  );
  if (
    pkg?.name !== "modern-web-guidance" ||
    pkg?.version !== version ||
    pkg?.bin?.["modern-web-guidance"] !==
      "skills/modern-web-guidance/modern-web.mjs"
  )
    throw new Error("Package identity differs from registry");
  const files = new Map<string, Buffer>();
  const entries = [...contents]
    .flatMap(([original, bytes]) => {
      const target = modernWebTarget(original);
      if (!target) return [];
      files.set(target, bytes);
      return [
        {
          source: original,
          target,
          bytes: bytes.length,
          sha256: sha256(bytes),
        },
      ];
    })
    .sort((left, right) => left.source.localeCompare(right.source, "en"));
  const source = modernWebSourceSchema.parse({
    schemaVersion: 1,
    package: "modern-web-guidance",
    version,
    gitHead: metadata.gitHead,
    tarball: metadata.dist.tarball,
    integrity: metadata.dist.integrity,
    files: entries,
  });
  return { source, files };
}
