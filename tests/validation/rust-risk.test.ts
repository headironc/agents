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
  rustRiskSource as source,
  rustRiskUpdate as adapter,
} from "../../scripts/rust-risk-source.ts";
import { pbtSource } from "../../scripts/property-testing-source.ts";
import { digest, gitBlob } from "../../scripts/upstream-git.ts";
import { preparedUpdate } from "../../scripts/upstream-pr.ts";
import { publishPrepared } from "../../scripts/upstream-publish.ts";
import { publicMembers } from "../../scripts/delivery.ts";
import { readSkillEntries } from "../../scripts/skills.ts";
import { repositoryRoot } from "./fixtures.ts";
import { updateServer } from "./upstream-fixtures.ts";

const { contract } = source;
const baseline = () => source.verify(repositoryRoot);
const newer = "d".repeat(40),
  base = "a".repeat(40);
function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(os.tmpdir(), "rust-risk-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of [contract.lock, contract.root, contract.skill]) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    cpSync(path.join(repositoryRoot, file), path.join(root, file), {
      recursive: true,
    });
  }
  return root;
}
function upstream(fault = "", changed = true, revision = newer) {
  const previous = baseline();
  const contents = new Map(
    previous.files.map((f) => [
      f.source,
      readFileSync(path.join(repositoryRoot, f.target)),
    ]),
  );
  const selected = contract.inputs[1]!;
  if (changed)
    contents.set(
      selected,
      Buffer.concat([
        contents.get(selected)!,
        Buffer.from("\nFixture clarification.\n"),
      ]),
    );
  return async (url: string) => {
    const api = `https://api.github.com/repos/${contract.repository}`;
    if (url === api)
      return Buffer.from(
        JSON.stringify({
          id: fault === "identity" ? 1 : contract.repositoryId,
          full_name: contract.repository,
          default_branch: "main",
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
          truncated: false,
          tree: [...contents]
            .filter(([p]) => !(fault === "license" && p === "LICENSE"))
            .map(([p, b]) => ({
              path: p,
              type: "blob",
              mode: fault === "link" && p === selected ? "120000" : "100644",
              sha: gitBlob(b),
            })),
        }),
      );
    const prefix = `https://raw.githubusercontent.com/${contract.repository}/${revision}/`;
    assert.ok(url.startsWith(prefix));
    const bytes = contents.get(url.slice(prefix.length));
    assert.ok(bytes);
    return fault === "blob" ? Buffer.from("wrong bytes") : bytes;
  };
}
async function plan(changed = true, revision = newer) {
  const imported = await source.planImport(
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

test("review patterns have exact assessed bytes and complete three-product delivery", () => {
  const current = baseline();
  assert.equal(current.files.length, 8);
  assert.equal(current.adaptation!.files.length, 5);
  const members = publicMembers(readSkillEntries(repositoryRoot));
  assert.deepEqual(
    members.filter((x) => x.source === contract.skill).map((x) => x.product),
    ["codex", "dsh", "antigravity"],
  );
  assert.ok(!members.some((x) => x.source.startsWith(contract.root)));
});
test("local guidance, original bytes, links and unlisted assets invalidate assessment", (t) => {
  for (const kind of ["local", "original", "link", "extra"]) {
    const root = fixture(t);
    if (kind === "local")
      writeFileSync(path.join(root, contract.skill, "SKILL.md"), "changed");
    if (kind === "original")
      writeFileSync(path.join(root, baseline().files[1]!.target), "changed");
    if (kind === "link") {
      const target = path.join(root, contract.skill, "LICENSE.txt");
      rmSync(target);
      symlinkSync(
        path.join(repositoryRoot, contract.skill, "LICENSE.txt"),
        target,
      );
    }
    if (kind === "extra")
      writeFileSync(path.join(root, contract.skill, "extra.txt"), "unexpected");
    assert.throws(() => source.verify(root), /pending|differ|Linked/);
  }
});
test("forward changes keep the prior adaptation and require deliberate reassessment", async (t) => {
  const root = fixture(t),
    next = await plan();
  const update = preparedUpdate(root, "rust-risk-review", next);
  assert.equal(update.draft, true);
  assert.equal(update.branchPrefix, "codex/update-rust-risk-review-");
  assert.deepEqual(next.source.adaptation, baseline().adaptation);
  assert.ok(update.body.includes("cancel-safety-finder.md"));
  assert.deepEqual(
    update.additions.map((x) => x.path),
    [baseline().files[1]!.target, contract.lock],
  );
  for (const f of update.additions)
    writeFileSync(path.join(root, f.path), Buffer.from(f.contents, "base64"));
  assert.throws(() => source.verify(root), /adaptation pending/);
  const current = source.verify(root, false);
  const entry = path.join(root, contract.skill, "SKILL.md");
  writeFileSync(
    entry,
    readFileSync(entry, "utf8").replaceAll(baseline().revision, newer),
  );
  current.adaptation!.revision = newer;
  current.adaptation!.files = current.adaptation!.files.map((f) => ({
    ...f,
    sha256: digest(readFileSync(path.join(root, contract.skill, f.path))),
  }));
  writeFileSync(path.join(root, contract.lock), JSON.stringify(current));
  assert.equal(source.verify(root).revision, newer);
});
test("unrelated upstream commits do not create empty updates", async () => {
  assert.deepEqual(
    adapter.update(repositoryRoot, await plan(false)).additions,
    [],
  );
});
test("upstream identity, history, license, regular files and blob hashes fail closed", async () => {
  for (const fault of ["identity", "history", "license", "link", "blob"])
    await assert.rejects(() => source.planImport(baseline(), upstream(fault)));
});
test("another same-repository source, forged adaptation and malformed plan bytes are rejected", async () => {
  const next = await plan();
  assert.throws(
    () =>
      adapter.update(repositoryRoot, {
        ...next,
        source: pbtSource.verify(repositoryRoot),
      }),
    { name: "ZodError" },
  );
  const forged = structuredClone(next);
  forged.source.adaptation!.revision = newer;
  assert.throws(() => adapter.update(repositoryRoot, forged), /cannot author/);
  for (const kind of ["path", "duplicate", "base64"]) {
    const altered = structuredClone(next);
    if (kind === "path") altered.files[0]!.path = "delivery/AGENTS.md";
    if (kind === "duplicate") altered.files[1] = altered.files[0]!;
    if (kind === "base64") altered.files[0]!.content += "\n";
    assert.throws(() => adapter.update(repositoryRoot, altered));
  }
});
test("the bounded publisher creates one draft and does not replay an uncertain publication", async () => {
  const update = adapter.update(repositoryRoot, await plan());
  const server = updateServer(update);
  assert.equal((await publishPrepared(update, server.api)).status, "created");
  assert.equal(
    (await publishPrepared(update, server.api)).status,
    "already-proposed",
  );
  const uncertain = updateServer(update, "lost-pr");
  await assert.rejects(publishPrepared(update, uncertain.api), /read back/);
});
