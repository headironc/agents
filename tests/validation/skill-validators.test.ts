import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  validateSkills,
  validateSkillProduct,
  validatorInputs,
  validatorEnvironment,
} from "../../scripts/check-skills.ts";
import { fixtureRepository, repositoryRoot } from "./fixtures.ts";

const skill = (name: string) =>
  `---\nname: ${name}\ndescription: Validate a synthetic supplied input.\n---\n\n# ${name}\n\nRead the input.\n`;

for (const product of ["codex", "claude"] as const)
  test(`pinned ${product} validator accepts a valid skill and rejects an unsupported field`, (t) => {
    const f = fixtureRepository(t);
    const directory = path.join(f.directory, "delivery/skills/probe");
    f.put("delivery/skills/probe/SKILL.md", skill("probe"));
    validateSkills(product, [directory]);
    f.put(
      "delivery/skills/probe/SKILL.md",
      skill("probe").replace(
        "name: probe",
        "name: probe\nunsupported-field: true",
      ),
    );
    assert.throws(
      () => validateSkills(product, [directory]),
      /unsupported-field/,
    );
    assert.throws(
      () => validateSkills(product, []),
      /Empty .* validation selection/,
    );
  });

test("real product validation covers parent and nested child without changing source", (t) => {
  const f = fixtureRepository(t);
  f.putSkillManifest("suite\tshared\nsuite/skills/child\tshared\n");
  const paths = [
    "delivery/skills/suite/SKILL.md",
    "delivery/skills/suite/skills/child/SKILL.md",
  ];
  for (const file of paths)
    f.put(file, skill(path.basename(path.dirname(file))));
  const before = paths.map((file) =>
    readFileSync(path.join(f.directory, file)),
  );
  validateSkillProduct(f.directory, "codex");
  validateSkillProduct(f.directory, "claude");
  for (const [index, file] of paths.entries())
    assert.deepEqual(readFileSync(path.join(f.directory, file)), before[index]);
});

test("pinned validator inputs are all bound to the repository cache", () => {
  const inputs = validatorInputs(repositoryRoot);
  assert.ok(inputs.length > 0);
  assert.ok(inputs.every((file) => file.startsWith(".cache/agents-tools/")));
  for (const product of ["codex", "claude"])
    assert.ok(
      inputs.some((file) => file.endsWith(`/${product}/quick_validate.py`)),
    );
});

test("offline validators accept protected supervisor inputs without granting installation ownership", (t) => {
  const f = fixtureRepository(t);
  const directory = path.join(f.directory, "delivery/skills/probe");
  f.put("delivery/skills/probe/SKILL.md", skill("probe"));
  // Only metadata is simulated: the real pinned archives, unpacked bytes and both validators run.
  const result = spawnSync(
    "python3",
    [
      "-I",
      "-B",
      "-c",
      `import hashlib, json, os, runpy, stat, sys
from pathlib import Path
from unittest.mock import patch

validator = runpy.run_path(sys.argv[1])
root = validator['ROOT']
manifest_bytes = (root / 'scripts/skill-validator-versions.json').read_bytes()
manifest = json.loads(manifest_bytes)
destination = validator['CACHE'] / 'skill-validators' / hashlib.sha256(manifest_bytes).hexdigest()
archive = validator['CACHE'] / 'archives' / manifest['codex']['sha256']
skill = Path(sys.argv[2])
original_stat = Path.stat
changed = {}

def supervisor_stat(current, *args, **kwargs):
    fields = list(original_stat(current, *args, **kwargs))
    fields[4] = 0
    fields[0] &= ~0o022
    if current == Path('/tmp'):
        fields[0] |= stat.S_ISVTX | 0o022
    if current in changed:
        fields[4], permissions = changed[current]
        fields[0] = stat.S_IFMT(fields[0]) | permissions
    return os.stat_result(fields)

def rejects(action, message):
    try:
        action()
    except ValueError as error:
        assert message in str(error), str(error)
    else:
        raise AssertionError('Expected rejection: ' + message)

with patch('os.getuid', return_value=65534), patch.object(Path, 'stat', supervisor_stat):
    validator['check'](manifest, destination, None, None)
    for product in ('codex', 'claude'):
        validator['check'](manifest, destination, product, [str(skill)])
    with patch('subprocess.run', side_effect=AssertionError('Installation must fail before downloading')):
        rejects(lambda: validator['install'](manifest, destination), 'Unowned validator input')
    for current, owner, permissions, error in (
        (archive, 0, 0o664, 'Writable protected'),
        (archive.parent, 0, 0o777, 'Writable protected'),
        (archive.parent, 65534, 0o755, 'Unowned'),
        (archive.parent, 1234, 0o755, 'Unowned'),
        (archive, 1234, 0o644, 'Unowned'),
    ):
        changed[current] = (owner, permissions)
        rejects(lambda: validator['check'](manifest, destination, None, None), error)
        changed.clear()
    link = skill / 'linked-archive'
    link.symlink_to(archive)
    rejects(lambda: validator['check_path'](link), 'Symlink')
    print('protected-input-boundaries-passed')
`,
      path.join(repositoryRoot, "scripts/skill-validator.py"),
      directory,
    ],
    {
      cwd: repositoryRoot,
      env: validatorEnvironment(f.directory),
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.match(result.stdout, /protected-input-boundaries-passed/);
});

test("shared failures block each product while exclusive failures stay in their product", (t) => {
  const f = fixtureRepository(t);
  f.putSkillManifest("probe\tshared\nexclusive\tcodex\nclaude-only\tclaude\n");
  const valid = skill("probe");
  const invalid = valid.replace(
    "name: probe",
    "name: probe\nunsupported-field: true",
  );
  f.put("delivery/skills/probe/SKILL.md", invalid);
  f.put("delivery/skills/exclusive/SKILL.md", skill("exclusive"));
  // Anthropic accepts compatibility; the pinned Codex validator rejects it.
  const claudeOnly = skill("claude-only").replace(
    "name: claude-only",
    "name: claude-only\ncompatibility: Claude Code",
  );
  f.put("delivery/skills/claude-only/SKILL.md", claudeOnly);
  for (const product of ["codex", "claude"] as const)
    assert.throws(
      () => validateSkillProduct(f.directory, product),
      /probe:.*unsupported-field/,
    );
  f.put("delivery/skills/probe/SKILL.md", valid);
  validateSkillProduct(f.directory, "codex");
  validateSkillProduct(f.directory, "claude");
  f.put(
    "delivery/skills/exclusive/SKILL.md",
    skill("exclusive").replace(
      "name: exclusive",
      "name: exclusive\nunsupported-field: true",
    ),
  );
  validateSkillProduct(f.directory, "claude");
  assert.throws(
    () => validateSkillProduct(f.directory, "codex"),
    /exclusive:.*unsupported-field/,
  );
  f.put("delivery/skills/exclusive/SKILL.md", skill("exclusive"));
  f.put(
    "delivery/skills/claude-only/SKILL.md",
    claudeOnly.replace("Claude Code", "x".repeat(501)),
  );
  validateSkillProduct(f.directory, "codex");
  assert.throws(
    () => validateSkillProduct(f.directory, "claude"),
    /Compatibility is too long/,
  );
});

test("invalid nested shared skill blocks both validators", (t) => {
  const f = fixtureRepository(t);
  f.putSkillManifest("suite\tshared\nsuite/skills/child\tshared\n");
  f.put("delivery/skills/suite/SKILL.md", skill("suite"));
  f.put(
    "delivery/skills/suite/skills/child/SKILL.md",
    skill("child").replace(
      "name: child",
      "name: child\nunsupported-field: true",
    ),
  );
  for (const product of ["codex", "claude"] as const)
    assert.throws(
      () => validateSkillProduct(f.directory, product),
      /child:.*unsupported-field/,
    );
});

test("offline cache verification needs no Git and rejects missing, changed and extra inputs", (t) => {
  const f = fixtureRepository(t);
  const inputs = validatorInputs(repositoryRoot);
  for (const file of inputs) {
    mkdirSync(path.dirname(path.join(f.directory, file)), { recursive: true });
    copyFileSync(path.join(repositoryRoot, file), path.join(f.directory, file));
  }
  rmSync(path.join(f.directory, ".git"), { recursive: true });
  assert.deepEqual(validatorInputs(f.directory), inputs);
  for (const product of ["codex", "claude"]) {
    const file = inputs.find((file) =>
      file.endsWith(`/${product}/quick_validate.py`),
    )!;
    const target = path.join(f.directory, file);
    const original = readFileSync(target);
    rmSync(target);
    assert.throws(() => validatorInputs(f.directory), /missing or extra files/);
    writeFileSync(target, "changed validator");
    assert.throws(
      () => validatorInputs(f.directory),
      /differs from pinned archives/,
    );
    writeFileSync(target, original);
    const extra = path.join(path.dirname(target), "extra.py");
    writeFileSync(extra, "extra");
    assert.throws(() => validatorInputs(f.directory), /missing or extra files/);
    rmSync(extra);
  }
  const manifest = JSON.parse(
    readFileSync(
      path.join(f.directory, "scripts/skill-validator-versions.json"),
      "utf8",
    ),
  );
  const archive = path.join(
    f.directory,
    ".cache/agents-tools/archives",
    manifest.claude.sha256,
  );
  writeFileSync(archive, "changed archive");
  assert.throws(() => validatorInputs(f.directory), /Checksum mismatch/);
  rmSync(archive);
  assert.throws(
    () => validatorInputs(f.directory),
    /Missing pinned validator archive/,
  );
});
