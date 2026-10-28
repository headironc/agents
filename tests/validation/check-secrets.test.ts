import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { screenSource } from "../../scripts/check-secrets.ts";
import { fixtureEnvironment } from "./fixtures.ts";

const root = path.resolve(import.meta.dirname, "../..");
const scanner = path.join(root, ".cache/agents-tools/bin/gitleaks");
const entry = path.join(root, "scripts/check-secrets.ts");

test("screening refuses a clean copy of a source that still contains a secret", (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "agents-secret-race-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const environment = fixtureEnvironment();
  execFileSync("git", ["init", "--quiet", directory], {
    env: environment,
  });
  writeFileSync(path.join(directory, ".gitleaks.toml"), 'title = "probe"\n');
  const source = path.join(directory, "secret.txt");
  const secret = "PROBE_SECRET_ABCDEFGH\n";
  writeFileSync(source, secret);
  execFileSync("git", ["add", "secret.txt"], {
    cwd: directory,
    env: environment,
  });

  const copySource: typeof copyFileSync = (from, to, mode) => {
    if (from !== source) return copyFileSync(from, to, mode);
    writeFileSync(source, "ordinary content\n");
    try {
      copyFileSync(from, to, mode);
    } finally {
      writeFileSync(source, secret);
    }
  };
  assert.throws(
    () => screenSource(directory, scanner, copySource),
    /Secret screening snapshot differs from source/,
  );
  assert.equal(readFileSync(source, "utf8"), secret);
});

test("screening refuses source changes after an earlier file was copied", (t) => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "agents-secret-postcopy-"),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const environment = fixtureEnvironment();
  execFileSync("git", ["init", "--quiet", directory], {
    env: environment,
  });
  writeFileSync(path.join(directory, ".gitleaks.toml"), 'title = "probe"\n');
  const earlier = path.join(directory, "a.txt");
  const later = path.join(directory, "b.txt");
  writeFileSync(earlier, "ordinary content\n");
  writeFileSync(later, "ordinary content\n");
  execFileSync("git", ["add", "a.txt", "b.txt"], {
    cwd: directory,
    env: environment,
  });

  const secret = "PROBE_SECRET_ABCDEFGH\n";
  const copySource: typeof copyFileSync = (from, to, mode) => {
    copyFileSync(from, to, mode);
    if (from === later) writeFileSync(earlier, secret);
  };
  assert.throws(
    () => screenSource(directory, scanner, copySource),
    /Source changed while preparing secret screening/,
  );
  assert.equal(readFileSync(earlier, "utf8"), secret);
});

test("ignored Cargo output is skipped while force-tracked output is screened", (t) => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "agents-secret-fixture-"),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const environment = fixtureEnvironment();
  execFileSync("git", ["init", "--quiet", directory], {
    env: environment,
  });
  writeFileSync(path.join(directory, ".gitignore"), "target/\n");
  writeFileSync(
    path.join(directory, ".gitleaks.toml"),
    [
      'title = "secret screening probe"',
      "[[rules]]",
      'id = "probe-secret"',
      "regex = '''PROBE_SECRET_[A-Z]{8}'''",
      "",
    ].join("\n"),
  );
  mkdirSync(path.join(directory, "target"));
  writeFileSync(
    path.join(directory, "target/ignored.txt"),
    "PROBE_SECRET_ABCDEFGH\n",
  );
  const scan = () =>
    spawnSync(process.execPath, [entry, directory, scanner], {
      encoding: "utf8",
      env: environment,
    });
  const ignored = scan();
  assert.equal(ignored.status, 0, ignored.stderr);
  writeFileSync(
    path.join(directory, "target/tracked.txt"),
    "PROBE_SECRET_HGFEDCBA\n",
  );
  execFileSync("git", ["add", "-f", "target/tracked.txt"], {
    cwd: directory,
    env: environment,
  });
  const tracked = scan();
  assert.equal(tracked.status, 1, tracked.stderr);
  assert.doesNotMatch(tracked.stderr + tracked.stdout, /PROBE_SECRET_HGFEDCBA/);
  execFileSync("git", ["rm", "--cached", "-f", "target/tracked.txt"], {
    cwd: directory,
    env: environment,
  });
  writeFileSync(
    path.join(directory, "inline.txt"),
    "PROBE_SECRET_ABCDEFGH # gitleaks:allow\n",
  );
  execFileSync("git", ["add", "inline.txt"], {
    cwd: directory,
    env: environment,
  });
  const inline = scan();
  assert.equal(inline.status, 1, inline.stderr);
  assert.doesNotMatch(inline.stderr + inline.stdout, /PROBE_SECRET_ABCDEFGH/);
});

test("ambient Git overrides cannot redirect source candidate screening", (t) => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "agents-secret-source-"),
  );
  const other = mkdtempSync(path.join(os.tmpdir(), "agents-secret-other-"));
  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  });
  const environment = fixtureEnvironment();
  for (const repository of [directory, other]) {
    execFileSync("git", ["init", "--quiet", repository], {
      env: environment,
    });
    writeFileSync(path.join(repository, "common.txt"), "ordinary content\n");
    execFileSync("git", ["add", "common.txt"], {
      cwd: repository,
      env: environment,
    });
  }
  writeFileSync(
    path.join(directory, ".gitleaks.toml"),
    [
      'title = "secret screening probe"',
      "[[rules]]",
      'id = "probe-secret"',
      "regex = '''PROBE_SECRET_[A-Z]{8}'''",
      "",
    ].join("\n"),
  );
  writeFileSync(path.join(directory, "secret.txt"), "PROBE_SECRET_ABCDEFGH\n");
  execFileSync("git", ["add", "secret.txt"], {
    cwd: directory,
    env: environment,
  });
  const redirected = spawnSync(process.execPath, [entry, directory, scanner], {
    encoding: "utf8",
    env: {
      ...environment,
      GIT_DIR: path.join(other, ".git"),
      GIT_WORK_TREE: other,
    },
  });
  assert.equal(redirected.status, 1, redirected.stderr);
  assert.doesNotMatch(
    redirected.stdout + redirected.stderr,
    /PROBE_SECRET_ABCDEFGH/,
  );
});

test("secret screening fails closed on an undecodable tracked filename", (t) => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "agents-secret-invalid-name-"),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const environment = fixtureEnvironment();
  execFileSync("git", ["init", "--quiet", directory], {
    env: environment,
  });
  writeFileSync(path.join(directory, ".gitleaks.toml"), 'title = "probe"\n');
  // The index exposes raw Git path bytes even when the filesystem rejects them.
  const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: directory,
    env: environment,
    input: "PROBE_SECRET_ABCDEFGH\n",
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["update-index", "-z", "--index-info"], {
    cwd: directory,
    env: environment,
    input: Buffer.concat([
      Buffer.from(`100644 ${blob}\t`),
      Buffer.from([0xff, 0]),
    ]),
  });
  assert.deepEqual(
    execFileSync("git", ["ls-files", "-z", "--cached"], {
      cwd: directory,
      env: environment,
    }),
    Buffer.from([0xff, 0]),
  );
  const result = spawnSync(process.execPath, [entry, directory, scanner], {
    encoding: "utf8",
    env: environment,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /encoded data/);
  assert.doesNotMatch(result.stderr + result.stdout, /PROBE_SECRET_ABCDEFGH/);
});

test("secret screening includes a pathname beginning with a UTF-8 BOM", (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "agents-secret-bom-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const environment = fixtureEnvironment();
  execFileSync("git", ["init", "--quiet", directory], {
    env: environment,
  });
  writeFileSync(
    path.join(directory, ".gitleaks.toml"),
    [
      'title = "secret screening probe"',
      "[[rules]]",
      'id = "probe-secret"',
      "regex = '''PROBE_SECRET_[A-Z]{8}'''",
      "",
    ].join("\n"),
  );
  const name = "\uFEFFsecret.txt";
  writeFileSync(path.join(directory, name), "PROBE_SECRET_ABCDEFGH\n");
  execFileSync("git", ["add", "--", name], {
    cwd: directory,
    env: environment,
  });
  const result = spawnSync(process.execPath, [entry, directory, scanner], {
    encoding: "utf8",
    env: environment,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.doesNotMatch(result.stderr + result.stdout, /PROBE_SECRET_ABCDEFGH/);
});
