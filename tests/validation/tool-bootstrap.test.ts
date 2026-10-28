import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
function fixture(
  t: TestContext,
  format: "tar.gz" | "tar.xz" | "zip" | "binary",
  version = "1.2.3",
) {
  const directory = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "agents-bootstrap-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, "bin"));
  mkdirSync(path.join(directory, "payload"));
  const executable = path.join(directory, "payload/sample");
  writeFileSync(executable, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`, {
    mode: 0o755,
  });
  const archive = path.join(directory, `sample.${format}`);
  if (format === "binary") writeFileSync(archive, readFileSync(executable));
  else if (format === "zip")
    execFileSync("zip", ["-q", archive, "sample"], {
      cwd: path.join(directory, "payload"),
    });
  else
    execFileSync(
      "tar",
      [format === "tar.gz" ? "-czf" : "-cJf", archive, "sample"],
      { cwd: path.join(directory, "payload") },
    );
  const digest = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  const cache = path.join(directory, "cache");
  writeFileSync(
    path.join(directory, "bin/curl"),
    '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = "-o" ]; then cp "$FIXTURE_ARCHIVE" "$2"; exit; fi\n  shift\ndone\nexit 99\n',
    { mode: 0o755 },
  );
  function prepare(
    overrides: {
      digest?: string;
      format?: string;
      url?: string;
      name?: string;
      environment?: NodeJS.ProcessEnv;
    } = {},
  ) {
    return spawnSync(
      "bash",
      [
        "-c",
        'source "$1"; shift; prepare_pinned_tool "$@"',
        "fixture",
        path.join(root, "scripts/tool-bootstrap.sh"),
        overrides.name ?? "sample",
        "1.2.3",
        overrides.format ?? (format === "binary" ? "binary" : "archive"),
        overrides.url ?? `https://example.invalid/sample.${format}`,
        overrides.digest ?? digest,
        "--version",
        cache,
      ],
      {
        encoding: "utf8",
        timeout: 15_000,
        env: {
          ...process.env,
          ...overrides.environment,
          PATH: `${directory}/bin:${process.env.PATH}`,
          FIXTURE_ARCHIVE: archive,
        },
      },
    );
  }
  return { directory, archive, digest, cache, prepare };
}

for (const format of ["tar.gz", "tar.xz", "zip", "binary"] as const) {
  test(`${format} prepares a verified executable from cold and validated warm cache`, (t) => {
    const state = fixture(t, format);
    const cold = state.prepare();
    assert.equal(cold.status, 0, cold.stderr);
    const candidate = cold.stdout.trim();
    assert.equal(
      execFileSync(candidate, ["--version"], { encoding: "utf8" }).trim(),
      "1.2.3",
    );
    assert.ok(existsSync(path.join(state.cache, "archives", state.digest)));
    writeFileSync(state.archive, "download now unavailable");
    const warm = state.prepare();
    assert.equal(warm.status, 0, warm.stderr);
    assert.equal(
      execFileSync(warm.stdout.trim(), ["--version"], {
        encoding: "utf8",
      }).trim(),
      "1.2.3",
    );
  });
}

test("corrupt cache is rejected before execution and leaves the installed target intact", (t) => {
  const state = fixture(t, "binary");
  mkdirSync(path.join(state.cache, "archives"), { recursive: true });
  const marker = path.join(state.directory, "executed");
  writeFileSync(
    path.join(state.cache, "archives", state.digest),
    `#!/bin/sh\ntouch '${marker}'\necho 1.2.3\n`,
    { mode: 0o755 },
  );
  writeFileSync(path.join(state.cache, "installed"), "existing");
  const result = state.prepare();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Checksum mismatch/);
  assert.equal(existsSync(marker), false);
  assert.equal(
    readFileSync(path.join(state.cache, "installed"), "utf8"),
    "existing",
  );
  assert.equal(
    readdirSync(state.cache).some(
      (name) => name.startsWith(".prepare") || name.startsWith(".candidate"),
    ),
    false,
    result.stderr,
  );
});

test("wrong versions, unsupported formats and linked archive caches fail", (t) => {
  const wrong = fixture(t, "binary", "9.9.9");
  assert.equal(wrong.prepare().status, 1);
  const state = fixture(t, "tar.gz");
  assert.equal(state.prepare({ format: "unknown" }).status, 2);
  assert.equal(existsSync(state.cache), false);
  assert.equal(
    state.prepare({ url: "http://example.invalid/sample.tar.gz" }).status,
    2,
  );
  mkdirSync(path.join(state.cache, "archives"), { recursive: true });
  symlinkSync(state.archive, path.join(state.cache, "archives", state.digest));
  assert.equal(state.prepare().status, 1);
});

test("multiple executable members are rejected without extraction", (t) => {
  const state = fixture(t, "tar.gz");
  mkdirSync(path.join(state.directory, "payload/extra"));
  writeFileSync(
    path.join(state.directory, "payload/extra/sample"),
    "unexpected",
  );
  execFileSync("tar", ["-czf", state.archive, "sample", "extra/sample"], {
    cwd: path.join(state.directory, "payload"),
  });
  const digest = createHash("sha256")
    .update(readFileSync(state.archive))
    .digest("hex");
  const result = state.prepare({ digest });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /one safe archive member/);
});

test("the runtime license comes only from one top-level member of the verified cached archive", (t) => {
  const directory = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "agents-license-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const cache = path.join(directory, "cache");
  mkdirSync(path.join(cache, "archives"), { recursive: true });
  function archive(members: Record<string, string>): string {
    const payload = mkdtempSync(path.join(directory, "payload-"));
    for (const [member, text] of Object.entries(members)) {
      mkdirSync(path.dirname(path.join(payload, member)), { recursive: true });
      writeFileSync(path.join(payload, member), text);
    }
    const file = path.join(directory, `${path.basename(payload)}.tar.gz`);
    execFileSync("tar", ["-czf", file, ...Object.keys(members)], {
      cwd: payload,
    });
    const digest = createHash("sha256")
      .update(readFileSync(file))
      .digest("hex");
    writeFileSync(path.join(cache, "archives", digest), readFileSync(file));
    return digest;
  }
  const prepare = (
    digest: string,
    url = "https://example.invalid/runtime.tar.gz",
  ) =>
    spawnSync(
      "bash",
      [
        "-c",
        'source "$1"; shift; prepare_pinned_license "$@"',
        "fixture",
        path.join(root, "scripts/tool-bootstrap.sh"),
        "runtime",
        url,
        digest,
        cache,
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
  const valid = archive({
    "runtime-1/LICENSE": "runtime license\n",
    "runtime-1/bin/runtime": "binary",
    "runtime-1/lib/dependency/LICENSE": "dependency license\n",
  });
  const result = prepare(valid);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(result.stdout.trim(), "utf8"), "runtime license\n");
  const ambiguous = archive({
    "runtime-1/LICENSE": "one\n",
    "other/LICENSE": "two\n",
  });
  assert.match(prepare(ambiguous).stderr, /one top-level LICENSE/);
  assert.match(
    prepare(archive({ "runtime-1/bin/runtime": "binary" })).stderr,
    /one top-level LICENSE/,
  );
  assert.match(prepare("f".repeat(64)).stderr, /Missing verified archive/);
  writeFileSync(path.join(cache, "archives", valid), "tampered");
  assert.match(prepare(valid).stderr, /Checksum mismatch/);
  assert.equal(prepare(valid, "https://example.invalid/runtime.bin").status, 2);
  assert.deepEqual(
    readdirSync(cache).filter((name) => name.startsWith(".license")),
    [],
  );
});

test("root installer rejects the whole invalid selector list before cache creation", (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "agents-installer-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, "scripts"));
  for (const file of [
    "install-tools.sh",
    "tool-bootstrap.sh",
    "tool-versions.json",
  ])
    writeFileSync(
      path.join(directory, "scripts", file),
      readFileSync(path.join(root, "scripts", file)),
    );
  writeFileSync(
    path.join(directory, "package.json"),
    readFileSync(path.join(root, "package.json")),
  );
  const result = spawnSync(
    "bash",
    [path.join(directory, "scripts/install-tools.sh"), "node", "unknown"],
    { encoding: "utf8", timeout: 10_000 },
  );
  assert.equal(result.status, 2, result.stderr);
  assert.equal(existsSync(path.join(directory, ".cache")), false);
  const manifest = JSON.parse(
    readFileSync(path.join(directory, "scripts/tool-versions.json"), "utf8"),
  );
  for (const target of Object.values(manifest.tools.lychee.platforms) as {
    url: string;
  }[])
    target.url = "https://example.invalid/unsupported.format";
  writeFileSync(
    path.join(directory, "scripts/tool-versions.json"),
    JSON.stringify(manifest),
  );
  const unsupported = spawnSync(
    "bash",
    [path.join(directory, "scripts/install-tools.sh"), "node", "lychee"],
    { encoding: "utf8", timeout: 10_000 },
  );
  assert.equal(unsupported.status, 2, unsupported.stderr);
  assert.equal(existsSync(path.join(directory, ".cache")), false);
});
