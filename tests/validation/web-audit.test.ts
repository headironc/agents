import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import {
  webAuditSource as source,
  webAuditUpdate as adapter,
} from "../../scripts/web-audit-source.ts";
import { rustRiskSource } from "../../scripts/rust-risk-source.ts";
import { digest, gitBlob } from "../../scripts/upstream-git.ts";
import { preparedUpdate } from "../../scripts/upstream-pr.ts";
import { publishPrepared } from "../../scripts/upstream-publish.ts";
import { publicMembers } from "../../scripts/delivery.ts";
import { readSkillEntries } from "../../scripts/skills.ts";
import { repositoryRoot } from "./fixtures.ts";
import { updateServer } from "./upstream-fixtures.ts";

const { contract } = source;
function plan(changed = true) {
  const current = source.verify(repositoryRoot);
  const files = current.files.map((f) => ({
    path: f.target,
    content: readFileSync(path.join(repositoryRoot, f.target)).toString(
      "base64",
    ),
  }));
  if (changed) {
    const bytes = Buffer.concat([
      Buffer.from(files[2]!.content, "base64"),
      Buffer.from("\nFixture measurement clarification.\n"),
    ]);
    files[2]!.content = bytes.toString("base64");
    current.revision = "d".repeat(40);
    current.files[2] = {
      ...current.files[2]!,
      bytes: bytes.length,
      sha256: digest(bytes),
      blob: gitBlob(bytes),
    };
  }
  return { base: "a".repeat(40), source: current, files };
}
test("the complete audit adaptation and MIT notice reach all products without original instructions", () => {
  const current = source.verify(repositoryRoot);
  assert.equal(current.repositoryId, 1136782037);
  assert.deepEqual(
    current.files.map((x) => x.source),
    [
      "LICENSE",
      "skills/web-quality-audit/SKILL.md",
      "skills/performance/references/MEASUREMENT.md",
    ],
  );
  assert.equal(current.adaptation!.files.length, 4);
  const members = publicMembers(readSkillEntries(repositoryRoot));
  assert.deepEqual(
    members.filter((x) => x.source === contract.skill).map((x) => x.product),
    ["codex", "dsh", "antigravity"],
  );
  assert.ok(!members.some((x) => x.source.startsWith(contract.root)));
});
test("measurement changes open bounded drafts and stale guidance cannot pass delivery", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "web-audit-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of [contract.lock, contract.root, contract.skill]) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    cpSync(path.join(repositoryRoot, file), path.join(root, file), {
      recursive: true,
    });
  }
  const next = plan(),
    update = preparedUpdate(root, "web-quality-audit", next);
  assert.equal(update.draft, true);
  assert.equal(update.branchPrefix, "codex/update-web-quality-audit-");
  assert.deepEqual(
    update.additions.map((x) => x.path),
    [currentMeasurement(), contract.lock],
  );
  assert.deepEqual(next.source.adaptation, source.verify(root).adaptation);
  for (const file of update.additions)
    writeFileSync(
      path.join(root, file.path),
      Buffer.from(file.contents, "base64"),
    );
  assert.throws(() => source.verify(root), /adaptation pending/);
  assert.equal(source.verify(root, false).revision, next.source.revision);
});
function currentMeasurement() {
  return contract.target("skills/performance/references/MEASUREMENT.md");
}
test("empty changes, foreign contracts, forged assessments and byte/path tampering cannot publish local content", () => {
  assert.deepEqual(adapter.update(repositoryRoot, plan(false)).additions, []);
  assert.throws(() =>
    adapter.update(repositoryRoot, {
      ...plan(),
      source: rustRiskSource.verify(repositoryRoot),
    }),
  );
  for (const fault of ["assessment", "path", "bytes"]) {
    const next = plan();
    if (fault === "assessment")
      next.source.adaptation!.revision = next.source.revision;
    if (fault === "path") next.files[2]!.path = contract.skill + "/SKILL.md";
    if (fault === "bytes") next.files[2]!.content += "\n";
    assert.throws(() => adapter.update(repositoryRoot, next));
  }
});
test("audit proposals use existing deduplication and uncertain-write boundaries", async () => {
  const update = adapter.update(repositoryRoot, plan());
  const server = updateServer(update);
  assert.equal((await publishPrepared(update, server.api)).status, "created");
  assert.equal(
    (await publishPrepared(update, server.api)).status,
    "already-proposed",
  );
  const uncertain = updateServer(update, "lost-pr");
  await assert.rejects(publishPrepared(update, uncertain.api), /read back/);
});
