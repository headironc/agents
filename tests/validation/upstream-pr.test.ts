import assert from "node:assert/strict";
import {
  cpSync,
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
import { updateServer } from "./upstream-fixtures.ts";
import {
  preparedUpdate,
  publishPrepared,
  repositoryId,
  sources,
} from "../../scripts/upstream-pr.ts";
import type { Api } from "../../scripts/upstream-pr.ts";
import {
  digest,
  gitBlob,
  rustLock,
  rustPolicy,
  rustRoot,
  rustSourceSchema,
} from "../../scripts/rust-api-source.ts";
import type { RustPlan } from "../../scripts/upstream-rust-api.ts";
import { rustUpdate } from "../../scripts/upstream-rust-api.ts";
import { repositoryRoot } from "./fixtures.ts";

const base = "a".repeat(40);
const source = rustSourceSchema.parse(
  JSON.parse(readFileSync(path.join(repositoryRoot, rustLock), "utf8")),
);
const original: RustPlan = {
  base,
  source,
  files: source.files.map((f) => ({
    path: f.target,
    content: readFileSync(path.join(repositoryRoot, f.target)).toString(
      "base64",
    ),
  })),
};

function next(previous = original, revision = "c".repeat(40)): RustPlan {
  const plan = structuredClone(previous);
  plan.source.revision = revision;
  const file = plan.source.files[0]!;
  const bytes = Buffer.from(
    `Synthetic Rust guideline ${plan.source.revision} for API simulation only.\n`,
  );
  file.bytes = bytes.length;
  file.sha256 = digest(bytes);
  file.blob = gitBlob(bytes);
  plan.files.find((f) => f.path === file.target)!.content =
    bytes.toString("base64");
  return plan;
}

function server(plan: RustPlan, fault = "", root = repositoryRoot) {
  return updateServer(rustUpdate(root, plan), fault);
}

test("no update performs no API calls; drift and malformed plans fail before writing", async () => {
  assert.deepEqual(
    await publishPrepared(
      preparedUpdate(repositoryRoot, "rust-api-guidelines", original),
      async () => {
        throw new Error("unexpected API");
      },
    ),
    { status: "unchanged", version: source.revision },
  );
  const drift = structuredClone(original);
  drift.source.files[0]!.sha256 = "0".repeat(64);
  assert.throws(() => rustUpdate(repositoryRoot, drift), /bytes/);
  const extra = next();
  extra.files[1]!.path = extra.files[0]!.path;
  assert.throws(() => rustUpdate(repositoryRoot, extra), /membership/);
  const missing = next();
  missing.files[0]!.content = "eA==";
  assert.throws(() => rustUpdate(repositoryRoot, missing), /bytes/);
});

test("a new release creates exactly one branch, signed commit and draft PR with byte readback", async () => {
  const plan = next(),
    fake = server(plan);
  assert.equal(
    (await publishPrepared(rustUpdate(repositoryRoot, plan), fake.api)).status,
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
      (await publishPrepared(rustUpdate(repositoryRoot, plan), fake.api))
        .status,
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
    await assert.rejects(
      publishPrepared(rustUpdate(repositoryRoot, plan), fake.api),
    );
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
                ref: "codex/update-rust-api-guidelines-0000",
              },
            },
          ];
    }
    return fake.api(method, endpoint, body);
  };
  assert.equal(
    (await publishPrepared(rustUpdate(repositoryRoot, plan), api)).status,
    "pending-review",
  );
  assert.equal(pages.length, 2);
  assert.deepEqual(fake.writes, []);
  for (const fault of ["lost-commit", "lost-pr"]) {
    const failed = server(plan, fault);
    await assert.rejects(
      publishPrepared(rustUpdate(repositoryRoot, plan), failed.api),
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
  for (const relative of [rustLock, rustPolicy, rustRoot]) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    cpSync(path.join(repositoryRoot, relative), path.join(root, relative), {
      recursive: true,
    });
  }
  let current = original;
  for (let generation = 0; generation < 2; generation++) {
    const candidate = next(current, (generation === 0 ? "c" : "d").repeat(40));
    const fake = server(candidate, "", root);
    assert.equal(
      (await publishPrepared(rustUpdate(root, candidate), fake.api)).status,
      "created",
    );
    const landed = structuredClone(candidate);
    for (const file of landed.files) {
      mkdirSync(path.dirname(path.join(root, file.path)), { recursive: true });
      writeFileSync(
        path.join(root, file.path),
        Buffer.from(file.content, "base64"),
      );
    }
    const updatedPolicy = readFileSync(
      path.join(root, rustPolicy),
      "utf8",
    ).replace(current.source.revision, landed.source.revision);
    writeFileSync(path.join(root, rustPolicy), updatedPolicy);
    landed.source.assessment!.revision = landed.source.revision;
    landed.source.assessment!.policySha256 = digest(updatedPolicy);
    writeFileSync(
      path.join(root, rustLock),
      JSON.stringify(landed.source, null, 2) + "\n",
    );
    assert.deepEqual(
      await publishPrepared(rustUpdate(root, landed), async () => {
        throw new Error("unexpected API");
      }),
      {
        status: "unchanged",
        version: landed.source.revision,
      },
    );
    current = landed;
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
  const job = wf.jobs.sources;
  assert.deepEqual(job.strategy, {
    "fail-fast": false,
    matrix: {
      source: [...sources],
    },
  });
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
