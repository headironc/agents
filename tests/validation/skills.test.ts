import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  readSkillEntries,
  listSkillFiles,
  selectSkillEntries,
} from "../../scripts/skills.ts";
import {
  skillCheckNames,
  validatorEnvironment,
} from "../../scripts/check-skills.ts";
import { canonicalDigest } from "../../scripts/source.ts";
import { publicMembers } from "../../scripts/delivery.ts";
import { fixtureRepository, repositoryRoot } from "./fixtures.ts";

const skill = (name: string) =>
  `---\nname: ${name}\ndescription: Read a synthetic fixture.\n---\n\n# Fixture\n\nRead the supplied value.\n`;

test("design orchestration stays Codex-only while shared skills reach both validators", () => {
  const entries = readSkillEntries(repositoryRoot);
  assert.equal(entries.length, 16);
  assert.equal(
    entries.find((entry) => entry.path === "project-guide")?.target,
    "shared",
  );
  assert.ok(
    entries.every(
      (entry) => entry.target === "shared" || entry.target === "codex",
    ),
  );
  assert.deepEqual(selectSkillEntries(entries, "codex"), entries);
  assert.deepEqual(
    selectSkillEntries(entries, "claude"),
    entries.filter((entry) => entry.path !== "figma-design-workflow"),
  );
  assert.deepEqual(
    publicMembers(entries)
      .filter(
        (member) => member.source === "delivery/skills/figma-design-workflow",
      )
      .map((member) => member.product),
    ["codex"],
  );
  assert.deepEqual(skillCheckNames(entries), [
    "Skill membership: DELIVERED; Codex 16, Claude 15",
    "Codex skill validation: 16 entries",
    "Claude skill validation: 15 entries",
  ]);
});

test("nested members belong to their top-level skill and do not add install targets", (t) => {
  const f = fixtureRepository(t);
  f.putSkillManifest(
    "suite\tshared\nsuite/skills/child\tshared\nprivate\tcodex\n",
  );
  for (const name of ["suite", "suite/skills/child", "private"])
    f.put(`delivery/skills/${name}/SKILL.md`, skill(path.posix.basename(name)));
  const entries = readSkillEntries(f.directory);
  assert.equal(
    entries.find((entry) => entry.path === "suite/skills/child")?.topLevel,
    "suite",
  );
  assert.equal(new Set(entries.map((entry) => entry.topLevel)).size, 9);
  assert.equal(selectSkillEntries(entries, "claude").length, 17);
  assert.ok(
    !selectSkillEntries(entries, "claude").some(
      (entry) => entry.path === "private",
    ),
  );
  assert.deepEqual(skillCheckNames(entries), [
    "Skill membership: DELIVERED; Codex 19, Claude 17",
    "Codex skill validation: 19 entries",
    "Claude skill validation: 17 entries",
  ]);
});

test("design workflow membership and product cannot be weakened", (t) => {
  const f = fixtureRepository(t);
  const manifest = "config/personal-skills.txt";
  const original = readFileSync(path.join(f.directory, manifest), "utf8");
  f.put(manifest, original.replace("figma-design-workflow\tcodex\n", ""));
  assert.throws(
    () => readSkillEntries(f.directory),
    /Required skill is missing: figma-design-workflow/,
  );
  f.put(
    manifest,
    original.replace(
      "figma-design-workflow\tcodex",
      "figma-design-workflow\tshared",
    ),
  );
  assert.throws(
    () => readSkillEntries(f.directory),
    /Required skill product differs: figma-design-workflow/,
  );
  f.put(manifest, original);
  rmSync(
    path.join(f.directory, "delivery/skills/figma-design-workflow/SKILL.md"),
  );
  assert.throws(
    () => readSkillEntries(f.directory),
    /manifest and source entrypoints differ/,
  );
});

test("Claude-only members stay in their product; malformed rows and nested mismatches fail closed", (t) => {
  const f = fixtureRepository(t);
  f.putSkillManifest("probe\tclaude\n");
  f.put("delivery/skills/probe/SKILL.md", skill("probe"));
  const entries = readSkillEntries(f.directory);
  assert.ok(
    selectSkillEntries(entries, "claude").some(
      (entry) => entry.path === "probe",
    ),
  );
  assert.ok(
    !selectSkillEntries(entries, "codex").some(
      (entry) => entry.path === "probe",
    ),
  );
  assert.deepEqual(
    publicMembers(entries)
      .filter((member) => member.source === "delivery/skills/probe")
      .map((member) => member.product),
    ["claude"],
  );
  rmSync(path.join(f.directory, "delivery/skills/probe"), { recursive: true });
  f.putSkillManifest("suite\tshared\nsuite/skills/child\tcodex\n");
  f.put("delivery/skills/suite/SKILL.md", skill("suite"));
  f.put("delivery/skills/suite/skills/child/SKILL.md", skill("child"));
  assert.throws(() => readSkillEntries(f.directory), /Nested skill product/);
  f.put("config/personal-skills.txt", "probe shared\n");
  assert.throws(() => readSkillEntries(f.directory), /Invalid skill manifest/);
});

test("missing required skills and unlisted or linked assets fail closed", (t) => {
  const f = fixtureRepository(t);
  f.put("config/personal-skills.txt", "gh\tshared\n");
  assert.throws(
    () => readSkillEntries(f.directory),
    /Required skill is missing/,
  );
  f.putSkillManifest("probe\tshared\n");
  f.put("delivery/skills/probe/SKILL.md", skill("probe"));
  assert.ok(
    listSkillFiles(f.directory).includes("delivery/skills/probe/SKILL.md"),
  );
  symlinkSync(
    "SKILL.md",
    path.join(f.directory, "delivery/skills/probe/linked.md"),
  );
  assert.throws(() => readSkillEntries(f.directory), /symlink/);
});

test("project-guide cannot disappear or lose either product", (t) => {
  const f = fixtureRepository(t);
  const manifest = readFileSync(
    path.join(f.directory, "config/personal-skills.txt"),
    "utf8",
  );
  f.put(
    "config/personal-skills.txt",
    manifest.replace("project-guide\tshared\n", ""),
  );
  rmSync(path.join(f.directory, "delivery/skills/project-guide"), {
    recursive: true,
  });
  assert.throws(
    () => readSkillEntries(f.directory),
    /Required skill is missing: project-guide/,
  );
  f.put("delivery/skills/project-guide/SKILL.md", skill("project-guide"));
  for (const product of ["codex", "claude"]) {
    f.put(
      "config/personal-skills.txt",
      manifest.replace(
        "project-guide\tshared\n",
        `project-guide\t${product}\n`,
      ),
    );
    assert.throws(
      () => readSkillEntries(f.directory),
      /Required skill product differs: project-guide/,
    );
  }
});

test("membership command rejects a digest from a different candidate", (t) => {
  const f = fixtureRepository(t);
  const digest = canonicalDigest(readSkillEntries(f.directory));
  f.putSkillManifest("probe\tshared\n");
  f.put("delivery/skills/probe/SKILL.md", skill("probe"));
  const result = spawnSync(
    process.execPath,
    ["scripts/check-skills.ts", "membership", digest],
    { cwd: f.directory, env: f.environment, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /changed after check planning/);
});

test("validator environment does not forward model credentials", () => {
  const environment = validatorEnvironment("/fixture/private");
  assert.deepEqual(Object.keys(environment).sort(), [
    "HOME",
    "LANG",
    "PATH",
    "TMPDIR",
  ]);
  assert.equal(environment.HOME, "/fixture/private");
  assert.equal(environment.ANTHROPIC_API_KEY, undefined);
  assert.equal(environment.CLAUDE_CODE_OAUTH_TOKEN, undefined);
});
