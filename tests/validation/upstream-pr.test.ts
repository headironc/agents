import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { load } from "js-yaml";
import { changes, publish, repositoryId } from "../../scripts/upstream-pr.ts";
import type { Api, UpdatePlan } from "../../scripts/upstream-pr.ts";
import {
  modernWebLock,
  modernWebSourceSchema,
  sha256,
} from "../../scripts/modern-web-source.ts";
import { repositoryRoot } from "./fixtures.ts";
import { applyModernWebImport } from "../../scripts/update-modern-web-guidance.ts";

const base = "a".repeat(40),
  head = "b".repeat(40);
const source = modernWebSourceSchema.parse(
  JSON.parse(readFileSync(path.join(repositoryRoot, modernWebLock), "utf8")),
);
const original: UpdatePlan = {
  base,
  source,
  files: source.files.map((f) => ({
    path: f.target,
    content: readFileSync(path.join(repositoryRoot, f.target)).toString(
      "base64",
    ),
  })),
};
function next(previous = original): UpdatePlan {
  const plan = structuredClone(previous);
  const parts = previous.source.version.split(".");
  parts[2] = String(BigInt(parts[2]!) + 1n);
  plan.source.version = parts.join(".");
  plan.source.tarball = `https://registry.npmjs.org/modern-web-guidance/-/modern-web-guidance-${plan.source.version}.tgz`;
  const file = plan.source.files[0]!;
  const bytes = Buffer.from(
    `Synthetic source ${plan.source.version} for API simulation only.\n`,
  );
  file.bytes = bytes.length;
  file.sha256 = sha256(bytes);
  plan.files.find((f) => f.path === file.target)!.content =
    bytes.toString("base64");
  return plan;
}
function server(plan: UpdatePlan, fault = "", root = repositoryRoot) {
  const writes: string[] = [];
  const calls: string[] = [];
  const expected = changes(root, plan);
  const branch = `codex/update-modern-web-guidance-${plan.source.version}`;
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
        assert.equal(body.draft, false);
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
            draft: false,
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
              ref: "codex/update-modern-web-guidance-0.0.0",
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
        message: `chore(upstream): update modern-web-guidance to ${plan.source.version}`,
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

test("no update performs no API calls; drift and malformed plans fail before writing", async () => {
  assert.deepEqual(
    await publish(repositoryRoot, original, async () => {
      throw new Error("unexpected API");
    }),
    { status: "unchanged", version: source.version },
  );
  const drift = structuredClone(original);
  drift.source.gitHead = base;
  assert.throws(() => changes(repositoryRoot, drift), /Same-version/);
  const extra = next();
  extra.files.push({ path: "../escape", content: "eA==" });
  assert.throws(() => changes(repositoryRoot, extra), /membership/);
  const missing = next();
  missing.files[0]!.content = "eA==";
  assert.throws(() => changes(repositoryRoot, missing), /bytes/);
});

test("a new release creates exactly one branch, signed commit and ready PR with byte readback", async () => {
  const plan = next(),
    fake = server(plan);
  assert.equal(
    (await publish(repositoryRoot, plan, fake.api)).status,
    "created",
  );
  assert.deepEqual(fake.writes, [
    "/repos/headironc/agents/git/refs",
    "/graphql",
    "/repos/headironc/agents/pulls",
  ]);
});

test("historical proposals and pending review never receive updates or duplicate PRs", async () => {
  for (const [fault, status] of [
    ["closed", "already-proposed"],
    ["pending", "pending-review"],
  ]) {
    const plan = next(),
      fake = server(plan, fault);
    assert.equal(
      (await publish(repositoryRoot, plan, fake.api)).status,
      status,
    );
    assert.deepEqual(fake.writes, []);
  }
});

test("uncertain writes and incomplete or changed targets stop without retries", async () => {
  for (const fault of [
    "orphan",
    "base-drift",
    "list-failed",
    "lost-write",
    "unsigned",
    "bad-blob",
    "truncated",
    "unrelated",
  ]) {
    const plan = next(),
      fake = server(plan, fault);
    await assert.rejects(publish(repositoryRoot, plan, fake.api));
    assert.equal(new Set(fake.writes).size, fake.writes.length);
    assert.ok(!fake.writes.some((p) => p.endsWith("/pulls")));
    if (fault === "lost-write")
      assert.match(fake.calls.at(-1)!, /^GET .*git\/ref/);
  }
});

test("later pages remain authoritative and later write failures are read back once", async () => {
  const plan = next();
  const fake = server(plan);
  const pages: string[] = [];
  const api: Api = async (method, endpoint, body) => {
    if (endpoint.includes("/pulls?state=open")) {
      pages.push(endpoint);
      return endpoint.endsWith("page=1")
        ? Array.from({ length: 100 }, () => ({ head: { repo: { id: 1 } } }))
        : [
            {
              head: {
                repo: { id: repositoryId },
                ref: "codex/update-modern-web-guidance-0.0.0",
              },
            },
          ];
    }
    return fake.api(method, endpoint, body);
  };
  assert.equal(
    (await publish(repositoryRoot, plan, api)).status,
    "pending-review",
  );
  assert.equal(pages.length, 2);
  assert.deepEqual(fake.writes, []);
  for (const fault of ["lost-commit", "lost-pr"]) {
    const failed = server(plan, fault);
    await assert.rejects(
      publish(repositoryRoot, plan, failed.api),
      /target read back/,
    );
    assert.equal(new Set(failed.writes).size, failed.writes.length);
    assert.match(
      failed.calls.at(-1)!,
      fault === "lost-pr" ? /^GET .*pulls\?/ : /^GET .*git\/ref/,
    );
  }
});

test("publisher coverage survives successive updates of the baseline source lock", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "upstream-pr-baseline-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of original.files) {
    const destination = path.join(root, file.path);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, Buffer.from(file.content, "base64"));
  }
  mkdirSync(path.join(root, "config"));
  writeFileSync(path.join(root, modernWebLock), JSON.stringify(source));
  let current = original;
  for (let generation = 0; generation < 2; generation++) {
    const candidate = next(current);
    const fake = server(candidate, "", root);
    assert.equal((await publish(root, candidate, fake.api)).status, "created");
    applyModernWebImport(root, {
      source: candidate.source,
      files: new Map(
        candidate.files.map((f) => [f.path, Buffer.from(f.content, "base64")]),
      ),
    });
    assert.deepEqual(
      await publish(root, candidate, async () => {
        throw new Error("unexpected API");
      }),
      {
        status: "unchanged",
        version: candidate.source.version,
      },
    );
    current = candidate;
  }
});

test("the scheduled workflow runs only on main with bounded publishing permissions", () => {
  const wf = load(
    readFileSync(
      path.join(repositoryRoot, ".github/workflows/upstream.yml"),
      "utf8",
    ),
  ) as any;
  assert.deepEqual(wf.on, {
    schedule: [{ cron: "17 2 * * 1" }],
    workflow_dispatch: null,
  });
  assert.equal(wf.concurrency["cancel-in-progress"], false);
  const job = wf.jobs["modern-web"];
  assert.equal(
    job.if,
    "github.repository_id == '1437099348' && github.ref == 'refs/heads/main'",
  );
  assert.deepEqual(job.permissions, {
    contents: "write",
    "pull-requests": "write",
  });
  assert.equal(job.steps[0].with["persist-credentials"], false);
  assert.equal(job.steps[2].env, undefined);
  assert.deepEqual(job.steps[3].env, { GH_TOKEN: "${{ github.token }}" });
  assert.equal(job.steps[4].if, "always()");
});
