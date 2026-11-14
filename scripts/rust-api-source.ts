import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

export const rustRepository = "rust-lang/api-guidelines";
export const rustRepositoryId = 81125442;
export const rustLock = "config/rust-api-guidelines-source.json";
export const rustRoot = "config/upstream/rust-api-guidelines";
export const rustPolicy = "delivery/policy/rust.md";
export const rustInputs = [
  { source: "LICENSE-APACHE", sections: ["References"] },
  { source: "LICENSE-MIT", sections: ["References"] },
  { source: "src/flexibility.md", sections: ["Ownership and abstraction"] },
  {
    source: "src/interoperability.md",
    sections: [
      "Derive order",
      "Naming",
      "Imports and conversions",
      "Errors and validation",
      "Ownership and abstraction",
    ],
  },
  { source: "src/naming.md", sections: ["Naming"] },
  {
    source: "src/type-safety.md",
    sections: ["Value types", "Input and result models"],
  },
] as const;
export const rustTarget = (source: string) =>
  `${rustRoot}/${source.replaceAll("/", "-")}.txt`;
export const digest = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const oid = z.string().regex(/^[a-f0-9]{40}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const fileSchema = z.strictObject({
  source: z.string(),
  target: z.string(),
  bytes: z
    .number()
    .int()
    .positive()
    .max(512 * 1024),
  sha256: hash,
  blob: oid,
});
export const rustSourceSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    repository: z.literal(rustRepository),
    repositoryId: z.literal(rustRepositoryId),
    branch: z.literal("master"),
    revision: oid,
    files: z.array(fileSchema).length(rustInputs.length),
    assessment: z
      .strictObject({
        revision: oid,
        policySha256: hash,
        decisions: z
          .array(
            z.strictObject({
              source: z.string(),
              decision: z.enum(["adopted", "retained", "not-applicable"]),
              reason: z.string().trim().min(20).max(2000),
            }),
          )
          .length(rustInputs.length),
      })
      .nullable(),
  })
  .superRefine((value, context) => {
    const expected = rustInputs.map((x) => x.source);
    if (
      JSON.stringify(value.files.map((x) => x.source)) !==
        JSON.stringify(expected) ||
      value.files.some((x) => x.target !== rustTarget(x.source)) ||
      (value.assessment &&
        JSON.stringify(value.assessment.decisions.map((x) => x.source)) !==
          JSON.stringify(expected))
    )
      context.addIssue({
        code: "custom",
        message: "Rust source membership differs",
      });
  });
export type RustSource = z.infer<typeof rustSourceSchema>;
export type RustImport = { source: RustSource; files: Map<string, Buffer> };
export type ReadSource = (url: string, limit: number) => Promise<Buffer>;

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
      throw new Error(`Unsafe Rust source path: ${relative}`);
  }
  return readFileSync(current);
}

export function verifyRustSource(root: string, reviewed = true): RustSource {
  const source = rustSourceSchema.parse(
    JSON.parse(regular(root, rustLock).toString("utf8")),
  );
  const expected = source.files.map((x) => path.basename(x.target)).sort();
  if (
    JSON.stringify(readdirSync(path.join(root, rustRoot)).sort()) !==
    JSON.stringify(expected)
  )
    throw new Error("Rust reference membership differs");
  for (const file of source.files) {
    const bytes = regular(root, file.target);
    if (
      bytes.length !== file.bytes ||
      digest(bytes) !== file.sha256 ||
      gitBlob(bytes) !== file.blob
    )
      throw new Error(`Rust reference bytes differ: ${file.source}`);
  }
  const policy = regular(root, rustPolicy);
  for (const input of rustInputs)
    for (const section of input.sections)
      if (!policy.toString("utf8").includes(`\n## ${section}\n`))
        throw new Error(`Missing Rust policy section: ${section}`);
  if (
    reviewed &&
    (source.assessment?.revision !== source.revision ||
      source.assessment.policySha256 !== digest(policy) ||
      !policy
        .toString("utf8")
        .includes(
          `https://github.com/${rustRepository}/tree/${source.revision}`,
        ))
  )
    throw new Error(
      "Rust reference assessment pending or policy changed; assess this revision and exact rust.md before delivery",
    );
  return source;
}

export const gitBlob = (bytes: Buffer) =>
  createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");

export const readRustBytes: ReadSource = async (url, limit) => {
  const parsed = new URL(url);
  if (
    !["https://api.github.com", "https://raw.githubusercontent.com"].includes(
      parsed.origin,
    ) ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  )
    throw new Error("Unexpected Rust source host");
  const response = await fetch(parsed, {
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok || !response.body)
    throw new Error(`Rust source HTTP ${response.status}`);
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("Rust source exceeds size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
};

export async function planRustImport(
  previous: RustSource | null,
  read: ReadSource = readRustBytes,
  revision?: string,
): Promise<RustImport> {
  const api = `https://api.github.com/repos/${rustRepository}`;
  const json = async (url: string) =>
    JSON.parse((await read(url, 2 * 1024 * 1024)).toString("utf8"));
  const repo = await json(api);
  if (
    repo.id !== rustRepositoryId ||
    repo.full_name !== rustRepository ||
    repo.default_branch !== "master" ||
    repo.archived ||
    repo.disabled
  )
    throw new Error("Rust repository identity changed");
  const commit = await json(
    `${api}/commits/${revision ? oid.parse(revision) : "master"}`,
  );
  const next = oid.parse(commit.sha);
  if (revision && next !== revision) throw new Error("Rust revision differs");
  if (previous && next !== previous.revision) {
    const comparison = await json(
      `${api}/compare/${previous.revision}...${next}`,
    );
    if (
      comparison.status !== "ahead" ||
      comparison.merge_base_commit?.sha !== previous.revision
    )
      throw new Error("Rust upstream history diverged or regressed");
  }
  const tree = await json(`${api}/git/trees/${next}?recursive=1`);
  if (tree.truncated || !Array.isArray(tree.tree))
    throw new Error("Incomplete Rust source tree");
  const files = new Map<string, Buffer>();
  const entries: RustSource["files"] = [];
  for (const input of rustInputs) {
    const matches = tree.tree.filter((x: any) => x.path === input.source);
    if (
      matches.length !== 1 ||
      matches[0].type !== "blob" ||
      matches[0].mode !== "100644"
    )
      throw new Error(`Missing or unsafe Rust reference: ${input.source}`);
    const bytes = await read(
      `https://raw.githubusercontent.com/${rustRepository}/${next}/${input.source}`,
      512 * 1024,
    );
    if (gitBlob(bytes) !== oid.parse(matches[0].sha))
      throw new Error("Rust blob identity differs");
    const target = rustTarget(input.source);
    files.set(target, bytes);
    entries.push({
      source: input.source,
      target,
      bytes: bytes.length,
      sha256: digest(bytes),
      blob: gitBlob(bytes),
    });
  }
  const source = rustSourceSchema.parse({
    schemaVersion: 1,
    repository: rustRepository,
    repositoryId: rustRepositoryId,
    branch: "master",
    revision: next,
    files: entries,
    assessment: previous?.assessment ?? null,
  });
  if (
    previous?.revision === next &&
    JSON.stringify(previous.files) !== JSON.stringify(entries)
  )
    throw new Error("Same-revision Rust source drift");
  return { source, files };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (process.argv.length !== 3 || process.argv[2] !== "--check")
    throw new Error("Usage: rust-api-source.ts --check");
  const source = verifyRustSource(path.resolve(import.meta.dirname, ".."));
  console.log(`Rust API Guidelines assessment verified: ${source.revision}`);
}
