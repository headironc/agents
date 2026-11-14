import assert from "node:assert/strict";
import { repositoryId } from "../../scripts/upstream-publish.ts";
import type { Api, PreparedUpdate } from "../../scripts/upstream-publish.ts";
const head = "b".repeat(40);

export function updateServer(update: PreparedUpdate, fault = "") {
  const writes: string[] = [];
  const calls: string[] = [];
  const expected = update;
  const branch = update.branchPrefix + update.version;
  const base = update.base;
  let committed = false,
    opened = false;
  const api: Api = async (method, endpoint, body?: any) => {
    calls.push(method + " " + endpoint);
    if (method !== "GET") {
      writes.push(endpoint);
      if (endpoint === "/graphql") {
        assert.equal(body.variables.input.expectedHeadOid, base);
        assert.equal(body.variables.input.branch.branchName, branch);
        assert.deepEqual(body.variables.input.fileChanges, {
          additions: expected.additions,
          deletions: expected.deletions,
        });
        committed = true;
      }
      if (endpoint.endsWith("/pulls")) {
        assert.equal(body.base, "main");
        assert.equal(body.draft, update.draft);
        opened = true;
      }
      if (fault === "lost-write") throw new Error("response lost");
      if (
        (fault === "lost-commit" && endpoint === "/graphql") ||
        (fault === "lost-pr" && endpoint.endsWith("/pulls"))
      )
        throw new Error("response lost after mutation");
      return {};
    }
    if (endpoint.endsWith("/agents"))
      return {
        id: repositoryId,
        full_name: "headironc/agents",
        default_branch: "main",
        archived: false,
        disabled: false,
      };
    if (endpoint.includes("/pulls?")) {
      if (fault === "list-failed") throw new Error("incomplete page");
      if (opened)
        return [
          {
            state: "open",
            draft: update.draft,
            head: { sha: head, repo: { id: repositoryId } },
            base: { ref: "main" },
            html_url: "https://github.com/headironc/agents/pull/999",
          },
        ];
      if (fault === "closed")
        return [
          {
            state: "closed",
            head: {
              repo: { id: repositoryId },
              ref: branch,
            },
          },
        ];
      if (fault === "pending" && endpoint.includes("state=open"))
        return [
          {
            head: {
              repo: { id: repositoryId },
              ref: update.branchPrefix + "0".repeat(40),
            },
          },
        ];
      return [];
    }
    if (endpoint.includes("matching-refs"))
      return fault === "orphan" ? [{ ref: `refs/heads/${branch}` }] : [];
    if (endpoint.endsWith("/heads/main"))
      return { object: { sha: fault === "base-drift" ? head : base } };
    if (endpoint.includes("/git/ref/"))
      return {
        ref: `refs/heads/${branch}`,
        object: { sha: committed ? head : base },
      };
    if (endpoint.includes("/git/commits/"))
      return {
        parents: [{ sha: base }],
        message: update.title,
        verification: { verified: fault !== "unsigned" },
      };
    if (endpoint.includes("/git/trees/")) {
      const tree: any[] = [
        { path: "README.md", type: "blob", mode: "100644", sha: "unchanged" },
      ];
      if (endpoint.includes(head))
        tree.push(
          ...expected.additions.map((file, i) => ({
            path: file.path,
            type: "blob",
            mode: "100644",
            sha: String(i),
          })),
        );
      if (fault === "unrelated" && endpoint.includes(head))
        tree.push({
          path: "extra",
          type: "blob",
          mode: "100644",
          sha: "extra",
        });
      return { truncated: fault === "truncated", tree };
    }
    if (endpoint.includes("/git/blobs/"))
      return {
        encoding: "base64",
        content:
          fault === "bad-blob"
            ? "eA=="
            : expected.additions[Number(endpoint.split("/").at(-1))]!.contents,
      };
    throw new Error("Unexpected API call " + endpoint);
  };
  return { api, writes, calls };
}
