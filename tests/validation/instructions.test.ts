import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import {
  buildInstructions,
  generatedInstructionPaths,
  renderInstructions,
} from "../../scripts/build-instructions.ts";

function fixture(t: TestContext): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "agents-instructions-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "delivery/policy"), { recursive: true });
  mkdirSync(path.join(root, "delivery/rules"), { recursive: true });
  writeFileSync(
    path.join(root, "delivery/policy/common.md"),
    "# Shared instructions\n\n## Collaboration\n\nPreserve authorized work.\n\n[Checks](review.md#checks)\n",
  );
  for (const product of ["codex", "dsh", "antigravity"])
    writeFileSync(
      path.join(root, `delivery/rules/${product}.md`),
      `## ${product} adapter\n\nOnly ${product} uses this adapter.\n`,
    );
  return root;
}

test("all native entries include the complete shared body once and only their own adapter", (t) => {
  const root = fixture(t);
  buildInstructions(root);
  const products = ["codex", "dsh", "antigravity"];
  for (const [index, file] of generatedInstructionPaths.entries()) {
    const output = readFileSync(path.join(root, file), "utf8");
    const prefix = products[index] === "antigravity" ? "config/" : "";
    const sharedBody = `## Collaboration\n\nPreserve authorized work.\n\n[Checks](${prefix}policy/review.md#checks)`;
    assert.equal(output.split(sharedBody).length, 2);
    for (const product of products)
      assert.equal(
        output.includes(`Only ${product} uses this adapter.`),
        product === products[index],
      );
  }
  assert.doesNotThrow(() => buildInstructions(root, true));
});

test("freshness verification rejects a missing or changed entry and accepts regeneration", (t) => {
  const root = fixture(t);
  assert.throws(
    () => buildInstructions(root, true),
    /Missing generated instructions/,
  );
  buildInstructions(root);
  const entry = path.join(root, generatedInstructionPaths[1]!);
  writeFileSync(entry, "stale\n");
  assert.throws(
    () => buildInstructions(root, true),
    /Stale generated instructions/,
  );
  buildInstructions(root);
  writeFileSync(
    path.join(root, "delivery/rules/dsh.md"),
    "## Updated native behavior\n",
  );
  assert.throws(
    () => buildInstructions(root, true),
    /Stale generated instructions/,
  );
  buildInstructions(root);
  assert.doesNotThrow(() => buildInstructions(root, true));
});

test("unsupported source links reject the build before any generated entry changes", (t) => {
  const root = fixture(t);
  buildInstructions(root);
  const before = generatedInstructionPaths.map((file) =>
    readFileSync(path.join(root, file), "utf8"),
  );
  writeFileSync(
    path.join(root, "delivery/rules/antigravity.md"),
    "[Unknown](../unowned/file.md)\n",
  );
  assert.throws(() => buildInstructions(root), /Unsupported instruction link/);
  assert.deepEqual(
    generatedInstructionPaths.map((file) =>
      readFileSync(path.join(root, file), "utf8"),
    ),
    before,
  );
  assert.throws(
    () =>
      renderInstructions(
        "# Shared instructions\n[x](../skills/../../private.md)",
        "",
        "codex",
      ),
    /Unsupported instruction link/,
  );
});

test("declared source links resolve from each native entry and retain fragments", () => {
  const source =
    "# Shared instructions\n[Policy](execution.md#workspaces) [Tool](../tools/check-prose.mjs) [Skill](../skills/gh/SKILL.md) [Here](#local) [Web](https://example.com/)\n";
  const adapter = "[Route](../policy/models.md#goals)\n";
  for (const product of ["codex", "dsh", "antigravity"] as const) {
    const prefix = product === "antigravity" ? "config/" : "";
    const output = renderInstructions(source, adapter, product);
    for (const target of [
      "policy/execution.md#workspaces",
      "tools/check-prose.mjs",
      "skills/gh/SKILL.md",
      "policy/models.md#goals",
    ])
      assert.ok(output.includes(`](${prefix}${target})`));
    assert.ok(output.includes("[Here](#local) [Web](https://example.com/)"));
  }
});
