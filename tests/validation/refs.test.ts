import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
import {
  againstKnownGaps,
  checkLaidOut,
  checkPublished,
  knownGaps,
  layOutPublished,
} from "../../scripts/check-refs.ts";
import type { Gap } from "../../scripts/check-refs.ts";

const root = path.resolve(import.meta.dirname, "../..");
const script = path.join(root, "scripts/check-refs.ts");
type Member = Parameters<typeof layOutPublished>[1][number];

/** A tiny repository for the same current source listing used by the installer. */
function repository(t: { after: (fn: () => void) => void }) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "agents refs "));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  execFileSync("git", ["-C", directory, "init", "-q"], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  const put = (relative: string, body: string) => {
    mkdirSync(path.dirname(path.join(directory, relative)), {
      recursive: true,
    });
    writeFileSync(path.join(directory, relative), body);
  };
  const add = () =>
    execFileSync("git", ["-C", directory, "add", "--all"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
  const laidOut = (members: Member[]) => {
    const destination = mkdtempSync(path.join(os.tmpdir(), "agents laid "));
    t.after(() => rmSync(destination, { recursive: true, force: true }));
    return {
      destination,
      laid: layOutPublished(directory, members, destination),
    };
  };
  const check = (members: Member[]) => {
    const { destination, laid } = laidOut(members);
    // An empty tree returns no findings, and so does a tree where everything resolves. Without
    // this a forgotten `add()` leaves nothing tracked, nothing is laid out, and every assertion
    // that expects no finding passes on a run that never reached lychee.
    assert.ok(
      laid.some((file) => file.endsWith(".md")),
      "no Markdown was laid out, so the run proves nothing",
    );
    return checkLaidOut(destination, laid);
  };
  return { directory, put, add, laidOut, check };
}

const guide = (source: string): Member => ({
  category: "guide",
  product: "codex",
  relative: "README.md",
  source,
});
const policy: Member = {
  category: "policy",
  product: "codex",
  relative: "policy/writing.md",
  source: "delivery/policy/writing.md",
};

test("a product cannot borrow the other product's dependency to close its references", (t) => {
  const f = repository(t);
  f.put(
    "delivery/skills/probe/SKILL.md",
    "# Probe\n\n[review](../../policy/review.md)\n",
  );
  f.put("delivery/policy/review.md", "# Review\n");
  const skill: Member = {
    category: "skill",
    product: "claude",
    relative: "skills/probe",
    source: "delivery/skills/probe",
  };
  const review: Member = {
    category: "policy",
    product: "codex",
    relative: "policy/review.md",
    source: "delivery/policy/review.md",
  };
  assert.throws(() => f.laidOut([skill, review]), /one product root/);
  assert.ok(
    f.check([skill]).some((finding) => finding.target === "policy/review.md"),
  );
  assert.deepEqual(f.check([skill, { ...review, product: "claude" }]), []);
});

test("a link is resolved at the depth the file is published at, not written at", (t) => {
  const f = repository(t);
  // The same text, the same target, one source position: valid where it is written and broken
  // where it is published. That difference is this checker's whole reason to exist.
  f.put("docs/usage.md", "# Guide\n\n[rules](../delivery/policy/writing.md)\n");
  f.put("delivery/policy/writing.md", "# Shared rules\n");
  f.add();
  const findings = f.check([guide("docs/usage.md"), policy]);
  // One reference, so one finding and one allowance. Both passes reach this one: it leaves the
  // root and has nothing at the other end. The escape is the diagnosis, and it keeps the line.
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.equal(findings[0]!.file, "README.md");
  assert.equal(findings[0]!.line, 3);
  assert.match(findings[0]!.reason, /published root/);
});

test("the same document published at a matching depth resolves", (t) => {
  const f = repository(t);
  f.put("delivery/README.md", "# Guide\n\n[rules](policy/writing.md)\n");
  f.put("delivery/policy/writing.md", "# Shared rules\n");
  f.add();
  assert.deepEqual(f.check([guide("delivery/README.md"), policy]), []);
});

test("an anchor that no longer exists is reported", (t) => {
  const f = repository(t);
  f.put(
    "delivery/README.md",
    "# Guide\n\n[a](policy/writing.md#shared-rules) [b](policy/writing.md#renamed)\n",
  );
  f.put("delivery/policy/writing.md", "# Shared rules\n");
  f.add();
  const findings = f.check([guide("delivery/README.md"), policy]);
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.match(findings[0]!.target, /renamed/);
});

test("a link inside inline code is not a link, and a heading's spaces are not collapsed", (t) => {
  const f = repository(t);
  // Both were defects of the hand-written version this replaced: it read command examples as
  // references, and it slugged two spaces into one hyphen so a live anchor read as missing.
  f.put(
    "delivery/README.md",
    [
      "## Reading files and directories (`gh repo read-file` / `read-dir`)",
      "",
      "See `![error](./gone.png)` and `[x](./missing.md)` in the example.",
      "",
      "[here](#reading-files-and-directories-gh-repo-read-file--read-dir)",
      "",
    ].join("\n"),
  );
  f.add();
  assert.deepEqual(f.check([guide("delivery/README.md")]), []);
});

test("an untracked skill member is checked in its published position", (t) => {
  const f = repository(t);
  f.put("delivery/skills/gh/SKILL.md", "# gh\n");
  f.add();
  f.put(
    "delivery/skills/gh/scratch.md",
    "# scratch\n\n[escape](../../../outside.md)\n",
  );
  const members: Member[] = [
    {
      category: "skill",
      product: "codex",
      relative: "skills/gh",
      source: "delivery/skills/gh",
    },
  ];
  assert.deepEqual(f.laidOut(members).laid, [
    "skills/gh/SKILL.md",
    "skills/gh/scratch.md",
  ]);
  const findings = f.check(members);
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.equal(findings[0]?.file, "skills/gh/scratch.md");
  assert.match(findings[0]!.reason, /published root/);
});

test("a reference that leaves the published root is reported, even when a file sits there", (t) => {
  const f = repository(t);
  f.put("delivery/README.md", "# Guide\n\n[escapes](../outside.md)\n");
  f.add();
  // The escape is invisible to the check run: lychee resolves it against the real filesystem and
  // calls it a success whenever something is there. Measured exactly this way before the dump pass
  // existed, and `ref-check` answered `0 errors`.
  const above = mkdtempSync(path.join(os.tmpdir(), "agents above "));
  t.after(() => rmSync(above, { recursive: true, force: true }));
  writeFileSync(path.join(above, "outside.md"), "# above\n");
  const destination = path.join(above, "published");
  mkdirSync(destination);
  const findings = checkLaidOut(
    destination,
    layOutPublished(f.directory, [guide("delivery/README.md")], destination),
  );
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.equal(findings[0]!.target, "../outside.md");
  assert.match(findings[0]!.reason, /published root/);

  // Twice written is twice reported, because an allowance covers one occurrence. The same target
  // in the same file is the shape three earlier ledger widths each let through.
  writeFileSync(
    path.join(f.directory, "delivery/README.md"),
    "# Guide\n\n[a](../outside.md)\n\n[b](../outside.md)\n",
  );
  f.add();
  const twice = checkLaidOut(
    destination,
    layOutPublished(f.directory, [guide("delivery/README.md")], destination),
  );
  assert.equal(twice.length, 2, JSON.stringify(twice));

  // And when nothing is up there, the same two occurrences arrive from both passes at once. Each
  // one supersedes its own: matching on file and target alone let the second take the first's
  // place, leaving one of them reported as a plain missing file.
  writeFileSync(
    path.join(f.directory, "delivery/README.md"),
    "# Guide\n\n[a](../gone.md)\n\n[b](../gone.md)\n",
  );
  f.add();
  const both = checkLaidOut(
    destination,
    layOutPublished(f.directory, [guide("delivery/README.md")], destination),
  );
  assert.equal(both.length, 2, JSON.stringify(both));
  assert.deepEqual(
    both.map((finding) => finding.reason),
    ["Leaves the published root", "Leaves the published root"],
    JSON.stringify(both),
  );
  assert.deepEqual(both.map((finding) => finding.line).sort(), [3, 5]);
});

test("the root is compared as the path lychee reports, not as it was handed over", (t) => {
  const f = repository(t);
  f.put("delivery/README.md", "# Guide\n\n[rules](policy/writing.md)\n");
  f.put("delivery/policy/writing.md", "# Shared rules\n");
  f.add();
  // macOS hands out `/var/folders/…`, a symbolic link to `/private/var/folders/…`, and lychee
  // reports the real one. Comparing against the path as given made every reference in the tree
  // read as an escape: six of fourteen cases failed there while this machine stayed green, so
  // the local runs had all been in an environment the checker does not only run in.
  const base = mkdtempSync(path.join(os.tmpdir(), "agents symlinked "));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const real = path.join(base, "real");
  const through = path.join(base, "link");
  mkdirSync(real);
  symlinkSync(real, through);
  assert.deepEqual(
    checkLaidOut(
      through,
      layOutPublished(
        f.directory,
        [guide("delivery/README.md"), policy],
        through,
      ),
    ),
    [],
  );
});

test("a link to the published root is inside it", (t) => {
  const f = repository(t);
  f.put(
    "delivery/policy/deep/x.md",
    "# x\n\n[root](../../)\n\n[dots](../..)\n",
  );
  f.put("delivery/policy/writing.md", "# Shared rules\n");
  f.add();
  // The root is not below the root, so a prefix test alone reads a legal link as an escape — and
  // reports it with an empty target, which is not something the gap ledger can name either.
  assert.deepEqual(
    f.check([
      {
        category: "policy",
        product: "codex",
        relative: "policy/deep/x.md",
        source: "delivery/policy/deep/x.md",
      },
      policy,
    ]),
    [],
  );
});

test("a published member with no source stops the run rather than shrinking the tree", (t) => {
  const f = repository(t);
  f.put("delivery/policy/writing.md", "# Shared rules\n");
  f.add();
  // A smaller tree answers with fewer findings, not with an error, so this one cannot be silent.
  assert.throws(
    () => f.laidOut([guide("delivery/README.md"), policy]),
    /no source: delivery\/README\.md/,
  );
});

test("an untracked document member is laid out too", (t) => {
  const f = repository(t);
  f.put("delivery/policy/writing.md", "# Shared rules\n");
  f.add();
  f.put("delivery/README.md", "# Guide\n\n[rules](policy/writing.md)\n");
  const { laid } = f.laidOut([guide("delivery/README.md"), policy]);
  assert.deepEqual(laid, ["README.md", "policy/writing.md"]);
});

test("an allowance is spent once, in the file it names", () => {
  const gaps: Gap[] = [{ file: "a.md", target: "x.md", owner: "someone" }];
  const twice = [
    { file: "a.md", line: 1, target: "x.md", reason: "not found" },
    { file: "a.md", line: 9, target: "x.md", reason: "not found" },
  ];
  // Three earlier widths let a new break through: the link text alone, the pair without counting,
  // and a whole file by naming one path in it.
  assert.deepEqual(
    againstKnownGaps(twice, gaps).blocking.map((finding) => finding.line),
    [9],
  );
  assert.equal(
    againstKnownGaps(
      [{ file: "b.md", line: 1, target: "x.md", reason: "not found" }],
      gaps,
    ).blocking.length,
    1,
  );
  // And it does cover what it names, so the fix is not "reject everything".
  assert.deepEqual(againstKnownGaps([twice[0]!], gaps).blocking, []);
  assert.deepEqual(againstKnownGaps([twice[0]!], gaps).unused, []);
});

test("an allowance for something that no longer happens blocks", () => {
  const gaps: Gap[] = [{ file: "a.md", target: "gone.md", owner: "someone" }];
  assert.deepEqual(againstKnownGaps([], gaps).unused, gaps);
});

test("both product layouts resolve without allowances", () => {
  const findings = checkPublished(root);
  const { blocking, unused } = againstKnownGaps(findings, knownGaps);
  assert.deepEqual(blocking, [], "a reference broke in the published layout");
  assert.deepEqual(unused, [], "a recorded gap no longer occurs");
  // Written out, so an entry added without a decision fails here rather than raising a number
  // nobody reads. The two assertions above already force the lengths to match, so asserting that
  // as well would be an assertion that cannot fail.
  assert.deepEqual(knownGaps, []);
});

test("both link runs read the same settings", () => {
  // One fact, one owner: the repository-form run and the published-form run ask about different
  // trees and must answer the same way, so neither restates the flags.
  const config = readFileSync(path.join(root, "lychee.toml"), "utf8");
  const settings = {
    include_fragments: /--include-fragments/,
    offline: /--offline/,
    no_progress: /--no-progress/,
  };
  // Every caller, not only the two checkers: the third one spelled the flags out, and so it was
  // the only place that would not notice `lychee.toml` changing under it.
  for (const [setting, flag] of Object.entries(settings)) {
    assert.match(
      config,
      new RegExp(`^${setting}\\s*=`, "m"),
      `lychee.toml does not own ${setting}`,
    );
    for (const file of [
      "scripts/check-docs.ts",
      "scripts/check-refs.ts",
      "tests/validation/docs.test.ts",
    ]) {
      const body = readFileSync(path.join(root, file), "utf8");
      assert.match(
        body,
        /"lychee\.toml"/,
        `${file} does not read the shared settings`,
      );
      assert.doesNotMatch(body, flag, `${file} restates ${setting}`);
    }
  }
});

test("refuses an unusable invocation", () => {
  // Including the structured format it used to accept: it had no reader, so it is not an option.
  for (const args of [
    ["--verbose"],
    ["--format"],
    ["--format", "json"],
    ["extra"],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(result.status, 2, args.join(" "));
    assert.equal(result.stdout, "", args.join(" "));
  }
});
