import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
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
import { create } from "tar";
import { gzipSync } from "node:zlib";
import { applyModernWebImport } from "../../scripts/update-modern-web-guidance.ts";
import {
  modernWebLock,
  modernWebRoot,
  modernWebSourceSchema,
  modernWebTarget,
  readModernWebArchive,
  sha256,
  verifiedModernWebFiles,
  verifyModernWebSource,
  fetchModernWebBytes,
} from "../../scripts/modern-web-source.ts";

function temporary(t: test.TestContext): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "modern-web-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const integrity = (bytes: Buffer): string =>
  `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

test("published source verifies every original byte and optional absence is strict", (t) => {
  const root = temporary(t);
  assert.equal(verifiedModernWebFiles(root).size, 0);
  mkdirSync(path.join(root, modernWebRoot), { recursive: true });
  assert.throws(() => verifiedModernWebFiles(root));
  const repo = path.resolve(import.meta.dirname, "../..");
  const source = modernWebSourceSchema.parse(
    JSON.parse(readFileSync(path.join(repo, modernWebLock), "utf8")),
  );
  for (const file of source.files) {
    const destination = path.join(root, file.target);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(path.join(repo, file.target)));
  }
  mkdirSync(path.join(root, "config"));
  writeFileSync(path.join(root, modernWebLock), JSON.stringify(source));
  assert.deepEqual(
    verifyModernWebSource(root),
    new Set(source.files.map((file) => file.target)),
  );
  const first = source.files[0]!;
  const replacement = new Map(
    source.files.map((file) => [
      file.target,
      readFileSync(path.join(root, file.target)),
    ]),
  );
  replacement.set(first.target, Buffer.from("invalid replacement"));
  assert.throws(
    () => applyModernWebImport(root, { source, files: replacement }),
    /Import plan bytes differ/,
  );
  assert.deepEqual(
    verifyModernWebSource(root),
    new Set(source.files.map((file) => file.target)),
  );
  const untouched = path.join(root, "untouched");
  writeFileSync(untouched, "preserved");
  const extra = new Map(replacement);
  extra.set("../escape", Buffer.from("untrusted"));
  assert.throws(
    () => applyModernWebImport(root, { source, files: extra }),
    /membership differs/,
  );
  extra.delete(first.target);
  assert.throws(
    () => applyModernWebImport(root, { source, files: extra }),
    /Import plan bytes differ/,
  );
  const redirected = structuredClone(source);
  redirected.files[0]!.target = "../escape";
  assert.throws(
    () =>
      applyModernWebImport(root, { source: redirected, files: replacement }),
    /Invalid or duplicate source mapping/,
  );
  assert.equal(readFileSync(untouched, "utf8"), "preserved");
  const target = path.join(root, first.target);
  writeFileSync(target, "changed");
  assert.throws(() => verifyModernWebSource(root), /bytes differ/);
  writeFileSync(target, readFileSync(path.join(repo, first.target)));
  writeFileSync(path.join(root, modernWebRoot, "extra"), "untracked");
  assert.throws(() => verifyModernWebSource(root), /membership differs/);
  rmSync(path.join(root, modernWebRoot, "extra"));
  rmSync(target);
  symlinkSync(path.join(repo, first.target), target);
  assert.throws(() => verifyModernWebSource(root), /symlink/);
  rmSync(target);
  symlinkSync(path.join(root, "nonexistent"), target);
  assert.throws(
    () =>
      applyModernWebImport(root, {
        source,
        files: new Map(
          source.files.map((file) => [
            file.target,
            readFileSync(path.join(repo, file.target)),
          ]),
        ),
      }),
    /symlink/,
  );
  assert.equal(readFileSync(untouched, "utf8"), "preserved");
});

test("archive integrity and tar safety precede any extraction", async (t) => {
  const root = temporary(t);
  mkdirSync(path.join(root, "package"));
  writeFileSync(path.join(root, "package/file"), "original bytes\r\n");
  const stream = create({ cwd: root, gzip: true }, ["package/file"]);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const archive = Buffer.concat(chunks);
  const read = await readModernWebArchive(archive, integrity(archive));
  assert.equal(read.get("package/file")?.toString(), "original bytes\r\n");
  await assert.rejects(
    readModernWebArchive(archive, integrity(Buffer.from("different"))),
    /integrity mismatch/,
  );
  const duplicateChunks: Buffer[] = [];
  for await (const chunk of create({ cwd: root, gzip: true }, [
    "package/file",
    "package/file",
  ]))
    duplicateChunks.push(chunk as Buffer);
  const duplicate = Buffer.concat(duplicateChunks);
  await assert.rejects(
    readModernWebArchive(duplicate, integrity(duplicate)),
    /duplicate/,
  );
  symlinkSync("file", path.join(root, "package/link"));
  const linkedChunks: Buffer[] = [];
  for await (const chunk of create({ cwd: root, gzip: true }, ["package/link"]))
    linkedChunks.push(chunk as Buffer);
  const linked = Buffer.concat(linkedChunks);
  await assert.rejects(
    readModernWebArchive(linked, integrity(linked)),
    /Unsupported tar member/,
  );
  const traversalChunks: Buffer[] = [];
  for await (const chunk of create(
    { cwd: root, gzip: true, prefix: "../escape" },
    ["package/file"],
  ))
    traversalChunks.push(chunk as Buffer);
  const traversal = Buffer.concat(traversalChunks);
  await assert.rejects(
    readModernWebArchive(traversal, integrity(traversal)),
    /Unsafe/,
  );
});

test("source mappings cannot escape or introduce another skill entrypoint", () => {
  assert.equal(
    modernWebTarget("package/skills/modern-web-guidance/SKILL.md"),
    `${modernWebRoot}/SKILL.upstream.md`,
  );
  assert.equal(
    modernWebTarget("package/README.md"),
    `${modernWebRoot}/README.upstream.txt`,
  );
  assert.equal(
    modernWebTarget("package/skills/chrome-extensions/SKILL.md"),
    undefined,
  );
  assert.throws(
    () => modernWebTarget("package/skills/modern-web-guidance/../escape"),
    /Unsafe/,
  );
  assert.notEqual(sha256(Buffer.from("x\r\n")), sha256(Buffer.from("x\n")));
});

test("source downloads reject non-registry origins before making a request", async () => {
  for (const url of [
    "http://registry.npmjs.org/package",
    "https://example.org/package",
    "https://user:password@registry.npmjs.org/package",
    "https://registry.npmjs.org/package?token=secret",
  ])
    await assert.rejects(fetchModernWebBytes(url), /Unexpected source host/);
});

test("archive resource limits stop oversized input and excessive entries", async (t) => {
  const oversized = Buffer.alloc(16 * 1024 * 1024 + 1);
  await assert.rejects(
    readModernWebArchive(oversized, integrity(oversized)),
    /size limit/,
  );
  const inflated = gzipSync(Buffer.alloc(40 * 1024 * 1024 + 1));
  await assert.rejects(
    readModernWebArchive(inflated, integrity(inflated)),
    /larger than/,
  );
  const root = temporary(t);
  mkdirSync(path.join(root, "package"));
  const files = Array.from({ length: 401 }, (_, index) => `package/${index}`);
  for (const file of files) writeFileSync(path.join(root, file), "");
  const chunks: Buffer[] = [];
  for await (const chunk of create({ cwd: root, gzip: true }, files))
    chunks.push(chunk as Buffer);
  const archive = Buffer.concat(chunks);
  await assert.rejects(
    readModernWebArchive(archive, integrity(archive)),
    /Too many/,
  );
});
