import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import {
  digest,
  gitBlob,
  planRustImport,
  rustInputs,
  rustLock,
  rustPolicy,
  rustRepository,
  rustRepositoryId,
  rustRoot,
  rustSourceSchema,
  verifyRustSource,
} from "../../scripts/rust-api-source.ts";
import type { ReadSource, RustSource } from "../../scripts/rust-api-source.ts";
import { rustUpdate } from "../../scripts/upstream-rust-api.ts";
import type { RustPlan } from "../../scripts/upstream-rust-api.ts";
import { publishPrepared } from "../../scripts/upstream-publish.ts";
import { publicMembers } from "../../scripts/delivery.ts";
import { readSkillEntries } from "../../scripts/skills.ts";
import { repositoryRoot } from "./fixtures.ts";
import { updateServer } from "./upstream-fixtures.ts";

const baseline = () =>
  rustSourceSchema.parse(
    JSON.parse(readFileSync(path.join(repositoryRoot, rustLock), "utf8")),
  );
const base = "a".repeat(40);
const newer = "c".repeat(40);
function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(os.tmpdir(), "rust-guidelines-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const relative of [rustLock, rustPolicy, rustRoot]) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    cpSync(path.join(repositoryRoot, relative), path.join(root, relative), {
      recursive: true,
    });
  }
  return root;
}
function origin(
  previous: RustSource,
  fault = "",
  changed = true,
  revision = newer,
) {
  const contents = new Map(
    previous.files.map((f) => [
      f.source,
      readFileSync(path.join(repositoryRoot, f.target)),
    ]),
  );
  if (changed)
    contents.set(
      "src/naming.md",
      Buffer.concat([
        contents.get("src/naming.md")!,
        Buffer.from("\nUpstream fixture clarification.\n"),
      ]),
    );
  const api = `https://api.github.com/repos/${rustRepository}`;
  const calls: string[] = [];
  const read: ReadSource = async (url) => {
    calls.push(url);
    if (fault === "http") throw new Error("Source HTTP 503");
    if (url === api)
      return Buffer.from(
        JSON.stringify({
          id: fault === "identity" ? 1 : rustRepositoryId,
          full_name: rustRepository,
          default_branch: "master",
        }),
      );
    if (url === `${api}/commits/master`)
      return Buffer.from(JSON.stringify({ sha: revision }));
    if (url.includes("/compare/"))
      return Buffer.from(
        JSON.stringify({
          status: fault === "history" ? "diverged" : "ahead",
          merge_base_commit: { sha: previous.revision },
        }),
      );
    if (url.includes("/git/trees/"))
      return Buffer.from(
        JSON.stringify({
          truncated: fault === "truncated",
          tree: [...contents]
            .filter(
              ([p]) => !(fault === "missing-license" && p === "LICENSE-MIT"),
            )
            .map(([p, b]) => ({
              path: p,
              type: "blob",
              mode: fault === "symlink" ? "120000" : "100644",
              sha: gitBlob(b),
            })),
        }),
      );
    const prefix = `https://raw.githubusercontent.com/${rustRepository}/${revision}/`;
    assert.ok(url.startsWith(prefix));
    const bytes = contents.get(url.slice(prefix.length));
    assert.ok(bytes);
    return fault === "blob" ? Buffer.from("wrong bytes") : bytes;
  };
  return { read, calls };
}
async function nextPlan(previous = baseline()): Promise<RustPlan> {
  const plan = await planRustImport(previous, origin(previous).read);
  return {
    base,
    source: plan.source,
    files: [...plan.files].map(([path, bytes]) => ({
      path,
      content: bytes.toString("base64"),
    })),
  };
}

test("the actual reference baseline is reviewed against this exact policy and never installed", () => {
  const source = verifyRustSource(repositoryRoot);
  assert.equal(source.assessment!.revision, source.revision);
  assert.equal(source.files.length, 6);
  const members = publicMembers(readSkillEntries(repositoryRoot));
  assert.ok(!members.some((x) => x.source.startsWith("config/")));
  assert.deepEqual(
    members.filter((x) => x.source === rustPolicy).map((x) => x.product),
    ["codex", "dsh", "antigravity"],
  );
});

test("upstream originals and the assessed policy remain independently bound", (t) => {
  const root = fixture(t);
  writeFileSync(
    path.join(root, rustPolicy),
    readFileSync(path.join(root, rustPolicy), "utf8") + "\nPolicy changed.\n",
  );
  assert.throws(
    () => verifyRustSource(root),
    /assessment pending or policy changed/,
  );
  assert.doesNotThrow(() => verifyRustSource(root, false));
  const file = baseline().files[0]!;
  writeFileSync(path.join(root, file.target), "changed license");
  assert.throws(() => verifyRustSource(root, false), /bytes differ/);
});

test("extra files, links and removed mapped sections fail closed", (t) => {
  const root = fixture(t);
  const extra = path.join(root, rustRoot, "extra.txt");
  writeFileSync(extra, "unowned");
  assert.throws(() => verifyRustSource(root), /membership/);
  rmSync(extra);
  const target = path.join(root, baseline().files[0]!.target);
  rmSync(target);
  symlinkSync(path.join(repositoryRoot, baseline().files[0]!.target), target);
  assert.throws(() => verifyRustSource(root), /Unsafe/);
  rmSync(target);
  cpSync(path.join(repositoryRoot, baseline().files[0]!.target), target);
  writeFileSync(
    path.join(root, rustPolicy),
    readFileSync(path.join(root, rustPolicy), "utf8").replace(
      "## Naming",
      "## Renamed",
    ),
  );
  assert.throws(
    () => verifyRustSource(root, false),
    /Missing Rust policy section/,
  );
});

test("a new Git revision verifies selected blob bytes and preserves assessment pending", async (t) => {
  const root = fixture(t),
    previous = baseline();
  const plan = await nextPlan(previous);
  assert.equal(plan.source.revision, newer);
  assert.deepEqual(plan.source.assessment, previous.assessment);
  const update = rustUpdate(root, plan);
  assert.equal(update.draft, true);
  assert.deepEqual(
    update.additions.map((x) => x.path),
    [`${rustRoot}/src-naming.md.txt`, rustLock],
  );
  assert.match(update.body, /src\/naming.md: rust.md — Naming/);
  for (const file of update.additions)
    writeFileSync(
      path.join(root, file.path),
      Buffer.from(file.contents, "base64"),
    );
  assert.throws(() => verifyRustSource(root), /assessment pending/);
  assert.equal(verifyRustSource(root, false).revision, newer);
  const assessed = structuredClone(plan.source);
  const policy = readFileSync(path.join(root, rustPolicy), "utf8").replaceAll(
    previous.revision,
    newer,
  );
  writeFileSync(path.join(root, rustPolicy), policy);
  assessed.assessment = {
    revision: newer,
    policySha256: digest(policy),
    decisions: previous.assessment!.decisions,
  };
  writeFileSync(path.join(root, rustLock), JSON.stringify(assessed));
  assert.equal(verifyRustSource(root).revision, newer);
});

test("unrelated commits and unchanged sources do not create empty PRs", async () => {
  const previous = baseline();
  for (const revision of [previous.revision, newer]) {
    const plan = await planRustImport(
      previous,
      origin(previous, "", false, revision).read,
    );
    const update = rustUpdate(repositoryRoot, {
      base,
      source: plan.source,
      files: [...plan.files].map(([path, bytes]) => ({
        path,
        content: bytes.toString("base64"),
      })),
    });
    assert.deepEqual(update.additions, []);
    assert.equal(
      (
        await publishPrepared(update, async () => {
          throw new Error("Unexpected remote call");
        })
      ).status,
      "unchanged",
    );
  }
});

test("repository drift, history rewrites, incomplete sources and wrong blobs stop preparation", async () => {
  const previous = baseline();
  for (const fault of [
    "http",
    "identity",
    "history",
    "truncated",
    "missing-license",
    "symlink",
    "blob",
  ])
    await assert.rejects(
      planRustImport(previous, origin(previous, fault).read),
    );
  await assert.rejects(
    planRustImport(
      previous,
      origin(previous, "", true, previous.revision).read,
    ),
    /Same-revision/,
  );
});

test("prepared plans cannot author assessments, escape ownership or alter bytes", async () => {
  const original = await nextPlan();
  const assessment = structuredClone(original);
  assessment.source.assessment!.revision = newer;
  assert.throws(() => rustUpdate(repositoryRoot, assessment), /cannot author/);
  const outside = structuredClone(original);
  outside.files[0]!.path = "delivery/policy/common.md";
  assert.throws(() => rustUpdate(repositoryRoot, outside), /Missing Rust/);
  const bytes = structuredClone(original);
  bytes.files[0]!.content = "eA==";
  assert.throws(() => rustUpdate(repositoryRoot, bytes), /bytes differ/);
  const duplicate = structuredClone(original);
  duplicate.files[1] = duplicate.files[0]!;
  assert.throws(() => rustUpdate(repositoryRoot, duplicate), /membership/);
  assert.equal(rustInputs.length, original.files.length);
});

test("Rust publication creates one draft PR; history and uncertain writes retain the original target", async () => {
  const update = rustUpdate(repositoryRoot, await nextPlan());
  const fake = updateServer(update);
  assert.equal((await publishPrepared(update, fake.api)).status, "created");
  assert.deepEqual(fake.writes, [
    "/repos/headironc/agents/git/refs",
    "/graphql",
    "/repos/headironc/agents/pulls",
  ]);
  for (const fault of ["closed", "pending"]) {
    const existing = updateServer(update, fault);
    assert.notEqual(
      (await publishPrepared(update, existing.api)).status,
      "created",
    );
    assert.deepEqual(existing.writes, []);
  }
  for (const fault of [
    "base-drift",
    "orphan",
    "lost-write",
    "lost-commit",
    "lost-pr",
    "bad-blob",
    "unrelated",
    "truncated",
    "unsigned",
  ]) {
    const failed = updateServer(update, fault);
    await assert.rejects(publishPrepared(update, failed.api));
    assert.equal(new Set(failed.writes).size, failed.writes.length);
  }
});
