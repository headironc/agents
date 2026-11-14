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
  microsoftRust,
  microsoftRustUpdate,
} from "../../scripts/microsoft-rust-source.ts";
import { digest, gitBlob } from "../../scripts/upstream-git.ts";
import type { ReadSource } from "../../scripts/upstream-git.ts";
import { preparedUpdate, sources } from "../../scripts/upstream-pr.ts";
import { publishPrepared } from "../../scripts/upstream-publish.ts";
import { publicMembers } from "../../scripts/delivery.ts";
import { readSkillEntries } from "../../scripts/skills.ts";
import { verifyRustSource } from "../../scripts/rust-api-source.ts";
import { repositoryRoot } from "./fixtures.ts";
import { updateServer } from "./upstream-fixtures.ts";

const baseline = () => microsoftRust.verify(repositoryRoot);
const { contract } = microsoftRust;
const base = "a".repeat(40),
  newer = "b".repeat(40);
function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(os.tmpdir(), "microsoft-rust-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const relative of [contract.lock, contract.root, contract.policy]) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    cpSync(path.join(repositoryRoot, relative), path.join(root, relative), {
      recursive: true,
    });
  }
  return root;
}
function origin(fault = "", changed = true, revision = newer) {
  const previous = baseline();
  const contents = new Map(
    previous.files.map((f) => [
      f.source,
      readFileSync(path.join(repositoryRoot, f.target)),
    ]),
  );
  const selected = "src/guidelines/performance/M-YIELD-POINTS.md";
  if (changed)
    contents.set(
      selected,
      Buffer.concat([
        contents.get(selected)!,
        Buffer.from("\nFixture clarification.\n"),
      ]),
    );
  const api = `https://api.github.com/repos/${contract.repository}`;
  const read: ReadSource = async (url) => {
    if (fault === "http") throw new Error("HTTP 503");
    if (url === api)
      return Buffer.from(
        JSON.stringify({
          id: fault === "identity" ? 1 : 1020012680,
          full_name: contract.repository,
          default_branch: fault === "branch" ? "other" : "main",
        }),
      );
    if (url === `${api}/commits/main`)
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
            .filter(([p]) => !(fault === "license" && p === "LICENSE.md"))
            .map(([p, b]) => ({
              path: p,
              type: "blob",
              mode: fault === "symlink" ? "120000" : "100644",
              sha: gitBlob(b),
            })),
        }),
      );
    const prefix = `https://raw.githubusercontent.com/${contract.repository}/${revision}/`;
    assert.ok(url.startsWith(prefix));
    const bytes = contents.get(url.slice(prefix.length));
    assert.ok(bytes);
    return fault === "blob" ? Buffer.from("wrong") : bytes;
  };
  return read;
}
async function next(changed = true, revision = newer) {
  const imported = await microsoftRust.planImport(
    baseline(),
    origin("", changed, revision),
  );
  return {
    base,
    source: imported.source,
    files: [...imported.files].map(([path, bytes]) => ({
      path,
      content: bytes.toString("base64"),
    })),
  };
}

test("selected Microsoft references bind the same delivered policy as Rust API without adding a skill", () => {
  const source = baseline();
  assert.equal(source.repositoryId, 1020012680);
  assert.equal(source.branch, "main");
  assert.deepEqual(
    source.files.map((f) => f.source),
    [
      "LICENSE.md",
      "src/guidelines/correctness/M-UNSAFE.md",
      "src/guidelines/correctness/M-UNSOUND.md",
      "src/guidelines/ffi/M-FFI-TRANSLATES.md",
      "src/guidelines/libs/building/M-FEATURES-ADDITIVE.md",
      "src/guidelines/performance/M-HOTPATH.md",
      "src/guidelines/performance/M-YIELD-POINTS.md",
    ],
  );
  assert.equal(
    source.assessment!.policySha256,
    verifyRustSource(repositoryRoot).assessment!.policySha256,
  );
  const members = publicMembers(readSkillEntries(repositoryRoot));
  assert.ok(!members.some((m) => m.source.startsWith("config/upstream/")));
  assert.deepEqual(
    members.filter((m) => m.source === contract.policy).map((m) => m.product),
    ["codex", "dsh", "antigravity"],
  );
  assert.ok(sources.includes("microsoft-rust-guidelines"));
});

test("new references create a bounded draft and cannot pass until the exact policy is reassessed", async (t) => {
  const root = fixture(t),
    plan = await next();
  assert.deepEqual(plan.source.assessment, baseline().assessment);
  const update = preparedUpdate(root, "microsoft-rust-guidelines", plan);
  assert.equal(update.draft, true);
  assert.deepEqual(
    update.additions.map((f) => f.path),
    [
      `${contract.root}/src-guidelines-performance-M-YIELD-POINTS.md.txt`,
      contract.lock,
    ],
  );
  assert.match(
    update.body,
    /M-YIELD-POINTS.md: rust.md — Performance and asynchronous work/,
  );
  assert.equal(update.branchPrefix, "codex/update-microsoft-rust-guidelines-");
  for (const file of update.additions)
    writeFileSync(
      path.join(root, file.path),
      Buffer.from(file.contents, "base64"),
    );
  assert.throws(() => microsoftRust.verify(root), /assessment pending/);
  const policy = readFileSync(
    path.join(root, contract.policy),
    "utf8",
  ).replaceAll(baseline().revision, newer);
  writeFileSync(path.join(root, contract.policy), policy);
  plan.source.assessment = {
    ...plan.source.assessment!,
    revision: newer,
    policySha256: digest(policy),
  };
  writeFileSync(path.join(root, contract.lock), JSON.stringify(plan.source));
  assert.equal(microsoftRust.verify(root).revision, newer);
  writeFileSync(path.join(root, contract.policy), policy + "\nChanged.\n");
  assert.throws(() => microsoftRust.verify(root), /policy changed/);
});

test("unchanged bytes and unrelated commits make no remote writes", async () => {
  for (const revision of [baseline().revision, newer]) {
    const update = microsoftRustUpdate.update(
      repositoryRoot,
      await next(false, revision),
    );
    assert.deepEqual(update.additions, []);
    assert.equal(
      (
        await publishPrepared(update, async () => {
          throw new Error("Unexpected API call");
        })
      ).status,
      "unchanged",
    );
  }
});

test("identity, branch, history, tree, license and blob failures stop preparation", async () => {
  for (const fault of [
    "http",
    "identity",
    "branch",
    "history",
    "truncated",
    "license",
    "symlink",
    "blob",
  ])
    await assert.rejects(microsoftRust.planImport(baseline(), origin(fault)));
  await assert.rejects(
    microsoftRust.planImport(baseline(), origin("", true, baseline().revision)),
    /Same-revision/,
  );
});

test("plans cannot forge assessment, duplicate members, change bytes or escape source ownership", async () => {
  const original = await next();
  const forged = structuredClone(original);
  forged.source.assessment!.revision = newer;
  assert.throws(
    () => microsoftRustUpdate.update(repositoryRoot, forged),
    /cannot author/,
  );
  const outside = structuredClone(original);
  outside.files[0]!.path = "delivery/policy/common.md";
  assert.throws(
    () => microsoftRustUpdate.update(repositoryRoot, outside),
    /Missing/,
  );
  const bytes = structuredClone(original);
  bytes.files[0]!.content = "eA==";
  assert.throws(
    () => microsoftRustUpdate.update(repositoryRoot, bytes),
    /bytes differ/,
  );
  const duplicate = structuredClone(original);
  duplicate.files[1] = duplicate.files[0]!;
  assert.throws(
    () => microsoftRustUpdate.update(repositoryRoot, duplicate),
    /membership/,
  );
  assert.throws(() =>
    preparedUpdate(repositoryRoot, "rust-api-guidelines", original),
  );
});

test("local extra files, symlinks, changed licenses and missing policy sections fail closed", (t) => {
  const root = fixture(t);
  const extra = path.join(root, contract.root, "extra.txt");
  writeFileSync(extra, "extra");
  assert.throws(() => microsoftRust.verify(root), /membership/);
  rmSync(extra);
  const file = baseline().files[0]!;
  rmSync(path.join(root, file.target));
  symlinkSync(
    path.join(repositoryRoot, file.target),
    path.join(root, file.target),
  );
  assert.throws(() => microsoftRust.verify(root), /Unsafe/);
  rmSync(path.join(root, file.target));
  writeFileSync(path.join(root, file.target), "changed license");
  assert.throws(() => microsoftRust.verify(root), /bytes differ/);
  cpSync(path.join(repositoryRoot, file.target), path.join(root, file.target));
  writeFileSync(
    path.join(root, contract.policy),
    readFileSync(path.join(root, contract.policy), "utf8").replace(
      "## Safety and FFI",
      "## Renamed",
    ),
  );
  assert.throws(() => microsoftRust.verify(root, false), /Missing/);
});

test("Microsoft publication inherits deduplication and uncertain-write recovery", async () => {
  const update = microsoftRustUpdate.update(repositoryRoot, await next());
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
