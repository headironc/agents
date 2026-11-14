import { z } from "zod";

export const repository = "headironc/agents";
export const repositoryId = 1437099348;
const oid = z.string().regex(/^[a-f0-9]{40}$/);
export type Api = (
  method: string,
  endpoint: string,
  body?: unknown,
) => Promise<any>;
export type PreparedUpdate = {
  base: string;
  version: string;
  branchPrefix: string;
  title: string;
  body: string;
  draft: boolean;
  additions: { path: string; contents: string }[];
  deletions: { path: string }[];
};

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

export async function publishPrepared(
  update: PreparedUpdate,
  api: Api,
): Promise<Record<string, unknown>> {
  const {
    base,
    version,
    branchPrefix,
    title,
    body,
    draft,
    additions,
    deletions,
  } = update;
  if (
    Buffer.byteLength(JSON.stringify({ additions, deletions })) >
    35 * 1024 * 1024
  )
    throw new Error("Update exceeds publisher's 35 MiB request limit");
  if (!additions.length && !deletions.length)
    return { status: "unchanged", version: version };
  const repo = await api("GET", `/repos/${repository}`);
  if (
    repo.id !== repositoryId ||
    repo.full_name !== repository ||
    repo.default_branch !== "main" ||
    repo.archived ||
    repo.disabled
  )
    throw new Error("Repository binding changed");
  const branch = branchPrefix + version;
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
        typeof pr.head.ref === "string" &&
        pr.head.ref.startsWith(branchPrefix),
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
  if (main.object?.sha !== base)
    throw new Error("Main changed; regenerate from its current version");
  const refPath = `${prefix}/git/ref/heads/${branch}`;
  const created = await writeOnce(
    api,
    "POST",
    `${prefix}/git/refs`,
    { ref: `refs/heads/${branch}`, sha: base },
    () => api("GET", refPath),
  );
  if (created.ref !== `refs/heads/${branch}` || created.object?.sha !== base)
    throw new Error("Created branch differs");
  const message = title;
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
          expectedHeadOid: base,
          message: { headline: message },
          fileChanges: { additions, deletions },
        },
      },
    },
    () => api("GET", refPath),
  );
  const head = oid.parse(committed.object?.sha);
  if (head === base) throw new Error("Update commit missing");
  const commit = await api("GET", `${prefix}/git/commits/${head}`);
  if (
    commit.parents?.length !== 1 ||
    commit.parents[0].sha !== base ||
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
    `${prefix}/git/trees/${base}?recursive=1`,
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
  const prs = await writeOnce(
    api,
    "POST",
    `${prefix}/pulls`,
    { title: message, head: branch, base: "main", body, draft },
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
    prs[0].draft !== draft ||
    !/^https:\/\/github\.com\/headironc\/agents\/pull\/\d+$/.test(
      prs[0].html_url,
    )
  )
    throw new Error("PR readback differs");
  return { status: "created", head, url: prs[0].html_url };
}
