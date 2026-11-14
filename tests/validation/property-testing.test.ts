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
import { digest, gitBlob } from "../../scripts/upstream-git.ts";
import {
  pbtInputs,
  pbtLocal,
  pbtLock,
  pbtRepository,
  pbtRepositoryId,
  pbtRoot,
  pbtSkill,
  pbtSourceSchema,
  pbtUpstream,
  planPbtImport,
  verifyPbtSource,
} from "../../scripts/property-testing-source.ts";
import { pbtUpdate } from "../../scripts/upstream-property-testing.ts";
import { publishPrepared } from "../../scripts/upstream-publish.ts";
import { preparedUpdate } from "../../scripts/upstream-pr.ts";
import { publicMembers } from "../../scripts/delivery.ts";
import { readSkillEntries } from "../../scripts/skills.ts";
import { updateServer } from "./upstream-fixtures.ts";
import { repositoryRoot } from "./fixtures.ts";

const base = "a".repeat(40),
  newer = "c".repeat(40);
const baseline = () =>
  pbtSourceSchema.parse(
    JSON.parse(readFileSync(path.join(repositoryRoot, pbtLock), "utf8")),
  );
function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(os.tmpdir(), "property-testing-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const relative of [pbtLock, pbtRoot, pbtSkill]) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    cpSync(path.join(repositoryRoot, relative), path.join(root, relative), {
      recursive: true,
    });
  }
  return root;
}
function upstream(fault = "", changed = true, revision = newer) {
  const previous = baseline(),
    contents = new Map(
      previous.files.map((f) => [
        f.source,
        readFileSync(path.join(repositoryRoot, f.target)),
      ]),
    );
  if (changed)
    contents.set(
      pbtInputs[1]!,
      Buffer.concat([
        contents.get(pbtInputs[1]!)!,
        Buffer.from("\nOfficial fixture clarification.\n"),
      ]),
    );
  return async (url: string) => {
    if (fault === "http") throw new Error("HTTP 503");
    const api = `https://api.github.com/repos/${pbtRepository}`;
    let value: unknown;
    if (url === api)
      value = {
        id: fault === "identity" ? 1 : pbtRepositoryId,
        full_name: pbtRepository,
        default_branch: "main",
      };
    else if (url === `${api}/commits/main`) value = { sha: revision };
    else if (url.includes("/compare/"))
      value = {
        status: fault === "history" ? "diverged" : "ahead",
        merge_base_commit: { sha: previous.revision },
      };
    else if (url.includes("/git/trees/"))
      value = {
        truncated: fault === "truncated",
        tree: [...contents]
          .filter(([p]) => !(fault === "missing-license" && p === "LICENSE"))
          .map(([p, b]) => ({
            path: p,
            type: "blob",
            mode:
              fault === "symlink" && p === pbtInputs[1] ? "120000" : "100644",
            sha: gitBlob(b),
          }))
          .concat(
            fault === "extra"
              ? [
                  {
                    path: `${pbtUpstream}/references/new.md`,
                    type: "blob",
                    mode: "100644",
                    sha: "d".repeat(40),
                  },
                ]
              : [],
          ),
      };
    else {
      const prefix = `https://raw.githubusercontent.com/${pbtRepository}/${revision}/`;
      if (!url.startsWith(prefix)) throw new Error(`Unexpected URL: ${url}`);
      const bytes = contents.get(url.slice(prefix.length));
      assert.ok(bytes);
      return fault === "blob" ? Buffer.from("Wrong bytes") : bytes;
    }
    return Buffer.from(JSON.stringify(value));
  };
}
async function plan(changed = true, revision = newer) {
  const imported = await planPbtImport(
    baseline(),
    upstream("", changed, revision),
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

test("the exact adapted skill and license are assessed and reach all three products without maintenance originals", () => {
  const source = verifyPbtSource(repositoryRoot);
  assert.equal(source.adaptation!.revision, source.revision);
  const members = publicMembers(readSkillEntries(repositoryRoot));
  assert.deepEqual(
    members.filter((x) => x.source === pbtSkill).map((x) => x.product),
    ["codex", "dsh", "antigravity"],
  );
  assert.ok(!members.some((x) => x.source.startsWith(pbtRoot)));
});

test("changed local guidance, linked inputs, extra assets and altered originals fail closed", (t) => {
  for (const kind of ["local", "link", "extra", "original"]) {
    const root = fixture(t);
    if (kind === "local")
      writeFileSync(path.join(root, pbtSkill, "SKILL.md"), "Changed guidance");
    if (kind === "link") {
      const file = path.join(root, pbtSkill, "LICENSE.txt");
      rmSync(file);
      symlinkSync(path.join(repositoryRoot, pbtSkill, "LICENSE.txt"), file);
    }
    if (kind === "extra")
      writeFileSync(
        path.join(root, pbtSkill, "unexpected.md"),
        "Unexpected entry",
      );
    if (kind === "original")
      writeFileSync(
        path.join(root, baseline().files[0]!.target),
        "Changed license",
      );
    assert.throws(() => verifyPbtSource(root), /pending|Linked|differ/);
  }
});

test("a real candidate preserves prior adaptation and blocks delivery until exact local files are assessed", async (t) => {
  const root = fixture(t),
    candidate = await plan();
  assert.deepEqual(candidate.source.adaptation, baseline().adaptation);
  const update = preparedUpdate(root, "property-based-testing", candidate);
  assert.equal(update.draft, true);
  assert.deepEqual(
    update.additions.map((x) => x.path),
    [candidate.source.files[1]!.target, pbtLock],
  );
  for (const file of update.additions)
    writeFileSync(
      path.join(root, file.path),
      Buffer.from(file.contents, "base64"),
    );
  assert.throws(() => verifyPbtSource(root), /adaptation pending/);
  const entry = path.join(root, pbtSkill, "SKILL.md");
  writeFileSync(
    entry,
    readFileSync(entry, "utf8").replaceAll(baseline().revision, newer),
  );
  candidate.source.adaptation = {
    ...candidate.source.adaptation!,
    revision: newer,
    files: pbtLocal.map((p) => ({
      path: p,
      sha256: digest(readFileSync(path.join(root, pbtSkill, p))),
    })),
  };
  writeFileSync(path.join(root, pbtLock), JSON.stringify(candidate.source));
  assert.equal(verifyPbtSource(root).revision, newer);
});

test("irrelevant commits stay unchanged and corrupted origins or undeclared reference growth stop preparation", async () => {
  const unchanged = pbtUpdate(repositoryRoot, await plan(false));
  assert.deepEqual(
    await publishPrepared(unchanged, async () => {
      throw new Error("Unexpected API");
    }),
    { status: "unchanged", version: newer },
  );
  for (const fault of [
    "http",
    "identity",
    "history",
    "truncated",
    "missing-license",
    "symlink",
    "blob",
    "extra",
  ])
    await assert.rejects(planPbtImport(baseline(), upstream(fault)));
  await assert.rejects(
    planPbtImport(baseline(), upstream("", true, baseline().revision)),
    /Same-revision/,
  );
});

test("plans cannot edit local adaptations, escape file ownership or forge assessment", async () => {
  const original = await plan();
  const forged = structuredClone(original);
  forged.source.adaptation!.revision = newer;
  assert.throws(() => pbtUpdate(repositoryRoot, forged), /cannot author/);
  const escaped = structuredClone(original);
  escaped.source.files[1]!.target =
    "delivery/skills/property-based-testing/SKILL.md";
  assert.throws(() => pbtUpdate(repositoryRoot, escaped));
  const changed = structuredClone(original);
  changed.files[0]!.content = Buffer.from("Other").toString("base64");
  assert.throws(() => pbtUpdate(repositoryRoot, changed), /bytes differ/);
  const duplicate = structuredClone(original);
  duplicate.files[1] = duplicate.files[0]!;
  assert.throws(() => pbtUpdate(repositoryRoot, duplicate), /membership/);
});

test("publication reuses draft creation, deduplication and uncertain-write recovery", async () => {
  const update = pbtUpdate(repositoryRoot, await plan());
  const server = updateServer(update);
  assert.equal((await publishPrepared(update, server.api)).status, "created");
  assert.equal(
    (await publishPrepared(update, server.api)).status,
    "already-proposed",
  );
  for (const fault of ["closed", "pending"]) {
    const existing = updateServer(update, fault);
    assert.equal(
      (await publishPrepared(update, existing.api)).status,
      fault === "closed" ? "already-proposed" : "pending-review",
    );
    assert.equal(existing.writes.length, 0);
  }
  for (const fault of ["lost-write", "lost-commit", "lost-pr"]) {
    const failed = updateServer(update, fault);
    await assert.rejects(publishPrepared(update, failed.api), /read back/);
  }
});
