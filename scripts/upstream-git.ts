import { createHash } from "node:crypto";
import { z } from "zod";

const oid = z.string().regex(/^[a-f0-9]{40}$/);
export const digest = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
export const gitBlob = (bytes: Buffer) =>
  createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
export type ReadSource = (url: string, limit: number) => Promise<Buffer>;
export type GitFile = {
  source: string;
  target: string;
  bytes: number;
  sha256: string;
  blob: string;
};
export type GitSource = {
  name: string;
  repository: string;
  repositoryId: number;
  branch: string;
  files: { source: string; target: string }[];
  completeDirectories?: string[];
};

export const readGitBytes: ReadSource = async (url, limit) => {
  const parsed = new URL(url);
  if (
    !["https://api.github.com", "https://raw.githubusercontent.com"].includes(
      parsed.origin,
    ) ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  )
    throw new Error("Unexpected Git source host");
  const response = await fetch(parsed, {
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok || !response.body)
    throw new Error(`Git source HTTP ${response.status}`);
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("Git source exceeds size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
};

/** Fixed Git files shared by the Rust reference and property-testing consumers. */
export async function readGitSource(
  binding: GitSource,
  previous: string | null,
  read: ReadSource = readGitBytes,
  revision?: string,
) {
  const { name, repository, repositoryId, branch } = binding;
  const api = `https://api.github.com/repos/${repository}`;
  const json = async (url: string) =>
    JSON.parse((await read(url, 4 * 1024 * 1024)).toString("utf8"));
  const repo = await json(api);
  if (
    repo.id !== repositoryId ||
    repo.full_name !== repository ||
    repo.default_branch !== branch ||
    repo.archived ||
    repo.disabled
  )
    throw new Error(`${name} repository identity changed`);
  const commit = await json(
    `${api}/commits/${revision ? oid.parse(revision) : branch}`,
  );
  const next = oid.parse(commit.sha);
  if (revision && next !== revision)
    throw new Error(`${name} revision differs`);
  if (previous && next !== previous) {
    const comparison = await json(
      `${api}/compare/${oid.parse(previous)}...${next}`,
    );
    if (
      comparison.status !== "ahead" ||
      comparison.merge_base_commit?.sha !== previous
    )
      throw new Error(`${name} upstream history diverged or regressed`);
  }
  const tree = await json(`${api}/git/trees/${next}?recursive=1`);
  if (tree.truncated || !Array.isArray(tree.tree))
    throw new Error(`Incomplete ${name} source tree`);
  const selected = new Set(binding.files.map((x) => x.source));
  if (
    tree.tree.some(
      (x: any) =>
        typeof x.path !== "string" ||
        (x.type !== "tree" &&
          binding.completeDirectories?.some((p) => x.path.startsWith(p)) &&
          !selected.has(x.path)),
    )
  )
    throw new Error(`${name} reference membership changed`);
  const files = new Map<string, Buffer>(),
    entries: GitFile[] = [];
  for (const input of binding.files) {
    const matches = tree.tree.filter((x: any) => x.path === input.source);
    if (
      matches.length !== 1 ||
      matches[0].type !== "blob" ||
      matches[0].mode !== "100644"
    )
      throw new Error(`Missing or unsafe ${name} reference: ${input.source}`);
    const bytes = await read(
      `https://raw.githubusercontent.com/${repository}/${next}/${input.source}`,
      512 * 1024,
    );
    if (gitBlob(bytes) !== oid.parse(matches[0].sha))
      throw new Error(`${name} blob identity differs`);
    files.set(input.target, bytes);
    entries.push({
      ...input,
      bytes: bytes.length,
      sha256: digest(bytes),
      blob: gitBlob(bytes),
    });
  }
  return { revision: next, entries, files };
}
