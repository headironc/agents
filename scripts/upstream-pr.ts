// Contract subject: `upstream-pr`.
// This repository's scheduled publisher creates update PRs only; it never approves or merges.
import { readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  fetchModernWebBytes,
  modernWebLock,
  modernWebSourceSchema,
  planModernWebImport,
  sha256,
  verifyModernWebSource,
} from "./modern-web-source.ts";

export const repository = "headironc/agents";
export const repositoryId = 1437099348;
const branchPrefix = "codex/update-modern-web-guidance-";
const oid = z.string().regex(/^[a-f0-9]{40}$/);
const version = z
  .string()
  .regex(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/);
const planSchema = z.strictObject({
  base: oid,
  source: modernWebSourceSchema,
  files: z
    .array(z.strictObject({ path: z.string(), content: z.string() }))
    .max(400),
});
export type UpdatePlan = z.infer<typeof planSchema>;
export type Api = (
  method: string,
  endpoint: string,
  body?: unknown,
) => Promise<any>;

export function changes(root: string, input: unknown) {
  const plan = planSchema.parse(input);
  version.parse(plan.source.version);
  verifyModernWebSource(root);
  const previous = modernWebSourceSchema.parse(
    JSON.parse(readFileSync(path.join(root, modernWebLock), "utf8")),
  );
  const newer = plan.source.version.split(".").map(BigInt);
  const older = previous.version.split(".").map(BigInt);
  const first = newer.findIndex((n, i) => n !== older[i]);
  if (first < 0) {
    if (JSON.stringify(plan.source) !== JSON.stringify(previous))
      throw new Error("Same-version source drift");
  } else if (newer[first]! < older[first]!)
    throw new Error("Upstream downgrade refused");
  const files = new Map(plan.files.map((file) => [file.path, file.content]));
  if (
    files.size !== plan.files.length ||
    files.size !== plan.source.files.length
  )
    throw new Error("Invalid update membership");
  const additions: { path: string; contents: string }[] = [];
  for (const file of plan.source.files) {
    const content = files.get(file.target);
    if (content === undefined) throw new Error("Missing update file");
    const bytes = Buffer.from(content, "base64");
    if (
      bytes.toString("base64") !== content ||
      bytes.length !== file.bytes ||
      sha256(bytes) !== file.sha256
    )
      throw new Error("Invalid update bytes");
    const before = previous.files.find((old) => old.target === file.target);
    if (!before || before.sha256 !== file.sha256)
      additions.push({ path: file.target, contents: content });
  }
  if (first < 0) return { plan, additions: [], deletions: [] };
  additions.push({
    path: modernWebLock,
    contents: Buffer.from(JSON.stringify(plan.source, null, 2) + "\n").toString(
      "base64",
    ),
  });
  const deletions = previous.files
    .filter((file) => !files.has(file.target))
    .map((file) => ({ path: file.target }));
  if (
    Buffer.byteLength(JSON.stringify({ additions, deletions })) >
    35 * 1024 * 1024
  )
    throw new Error("Update exceeds publisher's 35 MiB request limit");
  return { plan, additions, deletions };
}

async function list(api: Api, endpoint: string): Promise<any[]> {
  const rows = [];
  for (let page = 1; page <= 100; page++) {
    const batch = await api("GET", `${endpoint}&per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error("Incomplete PR listing");
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
  throw new Error("PR listing exceeded bounded pagination");
}

/** No mutation retry: every attempted write has one readback, including transport failures. */
async function writeOnce(
  api: Api,
  method: string,
  endpoint: string,
  body: unknown,
  readback: () => Promise<any>,
): Promise<any> {
  let failed = false;
  try {
    await api(method, endpoint, body);
  } catch {
    failed = true;
  }
  const observed = await readback();
  if (failed)
    throw new Error(
      `Write response failed (${method} ${endpoint}); target read back. Stop and inspect before recovery.`,
    );
  return observed;
}

export async function publish(
  root: string,
  input: unknown,
  api: Api,
): Promise<Record<string, unknown>> {
  const { plan, additions, deletions } = changes(root, input);
  if (!additions.length && !deletions.length)
    return { status: "unchanged", version: plan.source.version };
  const repo = await api("GET", `/repos/${repository}`);
  if (
    repo.id !== repositoryId ||
    repo.full_name !== repository ||
    repo.default_branch !== "main" ||
    repo.archived ||
    repo.disabled
  )
    throw new Error("Repository binding changed");
  const branch = branchPrefix + plan.source.version;
  const prefix = `/repos/${repository}`;
  const existing = await list(
    api,
    `${prefix}/pulls?state=all&head=${encodeURIComponent("headironc:" + branch)}`,
  );
  if (
    existing.some(
      (pr) => pr.head?.repo?.id === repositoryId && pr.head.ref === branch,
    )
  )
    return { status: "already-proposed", branch };
  const pending = await list(api, `${prefix}/pulls?state=open`);
  if (
    pending.some(
      (pr) =>
        pr.head?.repo?.id === repositoryId &&
        /^codex\/update-modern-web-guidance-\d+\.\d+\.\d+$/.test(pr.head.ref),
    )
  )
    return { status: "pending-review" };
  const refs = await api("GET", `${prefix}/git/matching-refs/heads/${branch}`);
  if (
    !Array.isArray(refs) ||
    refs.some((ref) => ref.ref === `refs/heads/${branch}`)
  )
    throw new Error("Existing update branch requires owner recovery");
  const main = await api("GET", `${prefix}/git/ref/heads/main`);
  if (main.object?.sha !== plan.base)
    throw new Error("Main changed; regenerate from its current version");
  const refPath = `${prefix}/git/ref/heads/${branch}`;
  const created = await writeOnce(
    api,
    "POST",
    `${prefix}/git/refs`,
    { ref: `refs/heads/${branch}`, sha: plan.base },
    () => api("GET", refPath),
  );
  if (
    created.ref !== `refs/heads/${branch}` ||
    created.object?.sha !== plan.base
  )
    throw new Error("Created branch differs");
  const message = `chore(upstream): update modern-web-guidance to ${plan.source.version}`;
  const query =
    "mutation($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid}}}";
  const committed = await writeOnce(
    api,
    "POST",
    "/graphql",
    {
      query,
      variables: {
        input: {
          branch: { repositoryNameWithOwner: repository, branchName: branch },
          expectedHeadOid: plan.base,
          message: { headline: message },
          fileChanges: { additions, deletions },
        },
      },
    },
    () => api("GET", refPath),
  );
  const head = oid.parse(committed.object?.sha);
  if (head === plan.base) throw new Error("Update commit missing");
  const commit = await api("GET", `${prefix}/git/commits/${head}`);
  if (
    commit.parents?.length !== 1 ||
    commit.parents[0].sha !== plan.base ||
    commit.message !== message ||
    commit.verification?.verified !== true
  )
    throw new Error("Commit parent, message or signature differs");
  // Read every changed blob, not a truncated diff, before creating the PR.
  const tree = await api("GET", `${prefix}/git/trees/${head}?recursive=1`);
  if (tree.truncated || !Array.isArray(tree.tree))
    throw new Error("Incomplete committed tree");
  const baselineTree = await api(
    "GET",
    `${prefix}/git/trees/${plan.base}?recursive=1`,
  );
  if (baselineTree.truncated || !Array.isArray(baselineTree.tree))
    throw new Error("Incomplete baseline tree");
  const touched = new Set(
    [...additions, ...deletions].map((file) => file.path),
  );
  const untouched = (rows: any[]) =>
    rows
      .filter((item) => item.type !== "tree" && !touched.has(item.path))
      .map((item) => `${item.path}:${item.mode}:${item.type}:${item.sha}`)
      .sort();
  if (
    JSON.stringify(untouched(tree.tree)) !==
    JSON.stringify(untouched(baselineTree.tree))
  )
    throw new Error("Unrelated committed changes");
  for (const file of additions) {
    const entry = tree.tree.find((item: any) => item.path === file.path);
    if (entry?.type !== "blob" || entry.mode !== "100644")
      throw new Error("Committed file missing or not regular");
    const blob = await api("GET", `${prefix}/git/blobs/${entry.sha}`);
    if (
      blob.encoding !== "base64" ||
      Buffer.from(blob.content, "base64").toString("base64") !== file.contents
    )
      throw new Error("Committed bytes differ");
  }
  if (
    deletions.some((file) =>
      tree.tree.some((item: any) => item.path === file.path),
    )
  )
    throw new Error("Deleted file remains");
  if ((await api("GET", refPath)).object?.sha !== head)
    throw new Error("Update branch changed before PR creation");
  const body = `Updates the complete official npm runtime, index, guides and licenses to ${plan.source.version}.\n\nSource revision: ${plan.source.gitHead}\nIntegrity: ${plan.source.integrity}\n\nLocal skill adaptations are unchanged. Review upstream interface/license changes before merging. Approve any waiting Actions runs, then complete the repository's normal CI, independent review and merge requirements. This workflow does not approve, merge or install.\n`;
  const prs = await writeOnce(
    api,
    "POST",
    `${prefix}/pulls`,
    { title: message, head: branch, base: "main", body, draft: false },
    () =>
      list(
        api,
        `${prefix}/pulls?state=all&head=${encodeURIComponent("headironc:" + branch)}`,
      ),
  );
  if (
    prs.length !== 1 ||
    prs[0].head?.sha !== head ||
    prs[0].head?.repo?.id !== repositoryId ||
    prs[0].base?.ref !== "main" ||
    prs[0].state !== "open" ||
    prs[0].draft
  )
    throw new Error("PR readback differs");
  return { status: "created", head, url: prs[0].html_url };
}

async function main(): Promise<void> {
  const [mode, file] = process.argv.slice(2);
  if (
    !file ||
    process.argv.length !== 4 ||
    !["prepare", "publish"].includes(mode!)
  )
    throw new Error("Usage: upstream-pr.ts prepare|publish PLAN.json");
  const root = path.resolve(import.meta.dirname, "..");
  const base = oid.parse(process.env.GITHUB_SHA);
  if (
    process.env.GITHUB_REPOSITORY !== repository ||
    process.env.GITHUB_REPOSITORY_ID !== String(repositoryId) ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    !["schedule", "workflow_dispatch"].includes(
      process.env.GITHUB_EVENT_NAME ?? "",
    )
  )
    throw new Error("Only the bound main workflow may run");
  if (mode === "prepare") {
    verifyModernWebSource(root);
    const metadata = JSON.parse(
      (
        await fetchModernWebBytes(
          "https://registry.npmjs.org/modern-web-guidance/latest",
          1024 * 1024,
        )
      ).toString("utf8"),
    );
    const imported = await planModernWebImport(version.parse(metadata.version));
    const plan: UpdatePlan = {
      base,
      source: imported.source,
      files: [...imported.files].map(([path, bytes]) => ({
        path,
        content: bytes.toString("base64"),
      })),
    };
    changes(root, plan);
    writeFileSync(file, JSON.stringify(plan), { mode: 0o600, flag: "wx" });
    console.log(`Prepared verified official release ${plan.source.version}`);
  } else {
    if (statSync(file).size > 60 * 1024 * 1024)
      throw new Error("Plan too large");
    const plan = planSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    if (plan.base !== base)
      throw new Error("Plan belongs to another workflow candidate");
    const token = process.env.GH_TOKEN;
    if (!token) throw new Error("Missing workflow token");
    const api: Api = async (method, endpoint, body) => {
      const response = await fetch(`https://api.github.com${endpoint}`, {
        method,
        redirect: "error",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok)
        throw new Error(`GitHub ${method} failed: HTTP ${response.status}`);
      const result = (await response.json()) as any;
      if (result.errors) throw new Error("GitHub returned GraphQL errors");
      return result;
    };
    console.log(JSON.stringify(await publish(root, plan, api)));
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Upstream update failed",
    );
    process.exitCode = 1;
  });
