import assert from "node:assert/strict";
import { readFileSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  checkReadRoute,
  checkToolContracts,
  readToolContracts,
} from "../../scripts/check-tool-contracts.ts";
import { fixtureRepository, repositoryRoot } from "./fixtures.ts";

test("core inventory has the independently expected delivered subjects and valid bindings", () => {
  const expected = [
    "agents-installer",
    "prose-check",
    "id-check",
    "ref-check",
    "aliyun-sms",
    "wechatide",
    "wechatide-call",
    "wechatide-install-check",
    "rg",
    "jq",
    "curl",
    "git",
    "gh",
    "github-api",
    "gh-stack",
    "openssh",
    "node",
    "bun",
    "bash",
    "shellcheck",
    "actionlint",
    "zizmor",
    "gitleaks",
    "typescript",
    "markdownlint-cli2",
    "lychee",
    "python",
    "skill-validation",
    "codex-cli-loader",
    "codex-cli",
    "claude-code",
    "pinned-tool-bootstrap",
  ];
  assert.deepEqual(
    readToolContracts(repositoryRoot)
      .inventory.map((row) => row[1])
      .sort(),
    expected.sort(),
  );
  checkToolContracts(repositoryRoot);
});

test("every delivered consumer has its independently expected binding and declared uses cannot disappear", (t) => {
  const expected: Record<string, string[]> = {
    ".github/workflows/check.yml": [
      "bash",
      "bun",
      "node",
      "pinned-tool-bootstrap",
      "git",
      "python",
    ],
    "delivery/skills/figma-design-workflow/SKILL.md": ["claude-code"],
    "delivery/skills/gh-identity/SKILL.md": ["gh"],
    "delivery/skills/project-guide/SKILL.md": ["git", "rg"],
    "delivery/skills/gh-identity/references/auth-readiness.md": ["gh"],
    "scripts/install.ts": ["agents-installer", "git", "node"],
    "scripts/check-prose.mjs": ["prose-check"],
    "scripts/check-ids.mjs": ["id-check"],
    "scripts/check-refs.ts": ["ref-check", "git", "lychee", "node"],
    "scripts/check-codex-loader.ts": ["codex-cli-loader", "codex-cli"],
    "scripts/check-secrets.ts": ["git", "gitleaks"],
    "scripts/install.sh": ["agents-installer", "bash", "node"],
    "scripts/build-install.ts": ["bun"],
    "scripts/bundle-tools.ts": ["bun"],
    "scripts/check-install-build.ts": ["bun", "node"],
    "delivery/skills/alibabacloud-sms-send-short-message/SKILL.md": [
      "aliyun-sms",
    ],
    "delivery/skills/alibabacloud-sms-send-short-message/scripts/send_sms.sh": [
      "aliyun-sms",
      "jq",
    ],
    "delivery/skills/alibabacloud-sms-send-short-message/references/sms-qualification.md":
      ["aliyun-sms"],
    "delivery/skills/wechatide/scripts/call.sh": [
      "wechatide-call",
      "wechatide",
    ],
    "delivery/skills/wechatide/references/cli.md": ["wechatide-call"],
    "delivery/skills/wechatide/references/tasks.md": ["wechatide-call"],
    "delivery/skills/wechatide/skills/automator/SKILL.md": ["wechatide-call"],
    "delivery/skills/wechatide/skills/cloudbase-operator/SKILL.md": [
      "wechatide-call",
    ],
    "delivery/skills/wechatide/skills/compiler/SKILL.md": ["wechatide-call"],
    "delivery/skills/wechatide/skills/debugger/SKILL.md": ["wechatide-call"],
    "delivery/skills/wechatide/skills/initializer/SKILL.md": ["wechatide-call"],
    "delivery/skills/wechatide/skills/installer/SKILL.md": [
      "wechatide-install-check",
    ],
    "delivery/skills/wechatide/skills/installer/scripts/check-install.mjs": [
      "wechatide-install-check",
    ],
    "delivery/skills/wechatide/skills/previewer/SKILL.md": ["wechatide-call"],
    "delivery/skills/wechatide/skills/project-manager/SKILL.md": [
      "wechatide-call",
    ],
    "delivery/policy/tool-contracts.md": ["rg", "jq", "curl", "git", "openssh"],
    "delivery/policy/claude-code.md": ["claude-code"],
    "delivery/policy/models.md": ["claude-code"],
    "delivery/skills/alibabacloud-find-skills/references/agentexplorer-api.md":
      ["curl"],
    "delivery/skills/alibabacloud-find-skills/references/verification-method.md":
      ["jq"],
    "delivery/skills/gh/SKILL.md": ["gh", "github-api", "gh-stack"],
    "delivery/skills/gh/references/extended-commands.md": ["gh"],
    "delivery/skills/gh/references/operations.md": ["gh", "git"],
    "scripts/check.ts": [
      "node",
      "bun",
      "bash",
      "shellcheck",
      "actionlint",
      "zizmor",
      "gitleaks",
      "typescript",
      "git",
      "jq",
      "gh",
      "python",
      "skill-validation",
      "codex-cli-loader",
      "lychee",
      "prose-check",
      "id-check",
    ],
    "scripts/check-docs.ts": ["markdownlint-cli2", "lychee", "node"],
    "scripts/source.ts": ["git"],
    "scripts/skill-validator.py": ["python", "curl"],
    "scripts/check-skills.ts": ["skill-validation", "python", "node"],
    "scripts/tool-bootstrap.sh": [
      "pinned-tool-bootstrap",
      "curl",
      "bash",
      "node",
      "bun",
      "shellcheck",
      "actionlint",
      "zizmor",
      "gitleaks",
      "lychee",
      "skill-validation",
    ],
    "scripts/check.sh": ["node", "bash"],
    "scripts/install-tools.sh": [
      "pinned-tool-bootstrap",
      "jq",
      "bash",
      "node",
      "bun",
      "python",
      "shellcheck",
      "actionlint",
      "zizmor",
      "gitleaks",
      "lychee",
      "skill-validation",
    ],
    "scripts/pre-commit.ts": ["git", "bash", "node"],
    ".githooks/pre-commit": ["git", "node", "bash"],
  };
  assert.deepEqual(
    readToolContracts(repositoryRoot)
      .bindings.map((row) => `${row[1]}:${row[3]}`)
      .sort(),
    Object.entries(expected)
      .flatMap(([file, subjects]) =>
        subjects.map((subject) => `${file}:${subject}`),
      )
      .sort(),
  );
  const f = fixtureRepository(t);
  const original = readFileSync(
    path.join(f.directory, "config/tool-bindings.txt"),
    "utf8",
  );
  for (const [consumer, kind, subject] of [
    [
      "delivery/skills/alibabacloud-sms-send-short-message/scripts/send_sms.sh",
      "script",
      "aliyun-sms",
    ],
    [
      "delivery/skills/alibabacloud-sms-send-short-message/scripts/send_sms.sh",
      "script",
      "jq",
    ],
    [
      "delivery/skills/alibabacloud-sms-send-short-message/references/sms-qualification.md",
      "skill",
      "aliyun-sms",
    ],
    [
      "delivery/skills/wechatide/references/tasks.md",
      "skill",
      "wechatide-call",
    ],
    [
      "delivery/skills/wechatide/skills/initializer/SKILL.md",
      "skill",
      "wechatide-call",
    ],
    [
      "delivery/skills/wechatide/skills/debugger/SKILL.md",
      "skill",
      "wechatide-call",
    ],
    [
      "delivery/skills/wechatide/skills/previewer/SKILL.md",
      "skill",
      "wechatide-call",
    ],
    [
      "delivery/skills/wechatide/skills/project-manager/SKILL.md",
      "skill",
      "wechatide-call",
    ],
    [
      "delivery/skills/wechatide/skills/automator/SKILL.md",
      "skill",
      "wechatide-call",
    ],
    [
      "delivery/skills/wechatide/skills/cloudbase-operator/SKILL.md",
      "skill",
      "wechatide-call",
    ],
    [
      "delivery/skills/wechatide/skills/installer/SKILL.md",
      "skill",
      "wechatide-install-check",
    ],
    ["delivery/skills/gh/references/operations.md", "skill", "git"],
    ["delivery/skills/project-guide/SKILL.md", "skill", "git"],
    ["delivery/skills/project-guide/SKILL.md", "skill", "rg"],
    ["scripts/check-docs.ts", "script", "node"],
    ["scripts/source.ts", "script", "git"],
    ["scripts/check.ts", "script", "lychee"],
    ["scripts/tool-bootstrap.sh", "script", "skill-validation"],
    ["scripts/install-tools.sh", "script", "shellcheck"],
  ]) {
    f.put(
      "config/tool-bindings.txt",
      original
        .split("\n")
        .filter(
          (line) =>
            !line.startsWith(`binding\t${consumer}\t${kind}\t${subject}\t`),
        )
        .join("\n"),
    );
    assert.throws(
      () => checkToolContracts(f.directory),
      /Unregistered consumer use/,
    );
  }
});

test("unregistered skill executors are discovered independently of consumer bindings", (t) => {
  const f = fixtureRepository(t);
  f.put(
    "delivery/skills/gh/tests/scripts/fake.mjs",
    "// Read [fixture](unused.md). Use tool `git`.\n",
  );
  checkToolContracts(f.directory);
  for (const [name, marker] of [
    ["unregistered.mjs", "//"],
    ["unregistered.cjs", "//"],
    ["unregistered.sh", "#"],
    ["unregistered.ts", "//"],
    ["unregistered.sh.in", "#"],
    ["resolve-latest-model-info", "#"],
  ]) {
    const file = `delivery/skills/gh/scripts/${name}`;
    f.put(
      file,
      `${marker} Read [Git transport](../../../delivery/policy/tool-contracts.md). Use tool \`git\`.\n`,
    );
    assert.throws(
      () => checkToolContracts(f.directory),
      /Unregistered consumer use/,
    );
    rmSync(path.join(f.directory, file));
  }
});

test("missing and duplicate owners, incorrect bindings and network paths fail", (t) => {
  const f = fixtureRepository(t);
  const owners = readFileSync(
    path.join(f.directory, "config/tool-contracts.txt"),
    "utf8",
  );
  // The first row that carries a record, not the first line: the file opens with a version line
  // and a column header, and duplicating either of those proves nothing about duplicate owners.
  const firstRow = owners
    .split("\n")
    .find((line) => line.startsWith("contract\t"))!;
  for (const broken of [
    owners
      .split("\n")
      .filter((line) => !line.startsWith("contract\trg\t"))
      .join("\n"),
    owners + firstRow + "\n",
    owners.replace("delivery/policy/tool-contracts.md", "network/facts.md"),
    owners.replace(
      "delivery/policy/tool-contracts.md",
      "delivery/policy/../delivery/policy/tool-contracts.md",
    ),
  ]) {
    f.put("config/tool-contracts.txt", broken);
    assert.throws(() => checkToolContracts(f.directory));
  }
  f.put("config/tool-contracts.txt", owners);
  f.put(
    "config/tool-bindings.txt",
    readFileSync(
      path.join(f.directory, "config/tool-bindings.txt"),
      "utf8",
    ).replace(
      "\trg\tdelivery/policy/tool-contracts.md",
      "\trg\tdelivery/policy/writing.md",
    ),
  );
  assert.throws(() => checkToolContracts(f.directory), /owner mismatch/);
});

test("definition markers in examples and late execution declarations cannot own a contract", (t) => {
  const f = fixtureRepository(t);
  const source = readFileSync(
    path.join(f.directory, "delivery/policy/tool-contracts.md"),
    "utf8",
  );
  f.put(
    "delivery/policy/tool-contracts.md",
    source.replace(
      "Contract subject: `rg`.",
      "```md\nContract subject: `rg`.\n```",
    ),
  );
  assert.throws(() => checkToolContracts(f.directory), /owner marker/);
  f.put("delivery/policy/tool-contracts.md", source);
  f.put(
    "scripts/check.ts",
    readFileSync(path.join(f.directory, "scripts/check.ts"), "utf8").replace(
      "// Contract subject: `node`.\n",
      "",
    ) + "\n// Contract subject: `node`.\n",
  );
  assert.throws(() => checkToolContracts(f.directory), /execution header/);
});

test("a wrapper declaration without its actual delegate is rejected", (t) => {
  const f = fixtureRepository(t);
  f.put(
    "scripts/check.sh",
    "#!/usr/bin/env bash\n# Contract wrapper: `node` -> `scripts/check.ts`.\n# exec scripts/check.ts\nexit 0\n",
  );
  assert.throws(() => checkToolContracts(f.directory), /actual wrapper call/);
});

test("a first use requires its route in the same operative paragraph or list item", () => {
  for (const target of ["owner.md", "owner.md#first-use"]) {
    const valid = `Read [owner](${target}) before proceeding. Use tool \`probe\` with the supplied input.`;
    checkReadRoute(valid, "owner.md", "probe");
    checkReadRoute(`- ${valid}`, "owner.md", "probe");
    for (const broken of [
      `\`\`\`md\n${valid}\n\`\`\``,
      `> ${valid}`,
      `    ${valid}`,
      `<!-- ${valid} -->`,
      "Use tool `probe`.\n\n" + valid,
      valid.replace(" before proceeding. ", " before proceeding.\n\n"),
      `Use tool \`probe\` then Read [owner](${target}).`,
      valid.replace("Read ", "See "),
    ]) {
      assert.throws(() => checkReadRoute(broken, "owner.md", "probe"));
    }
  }
});

test("a route to a neighboring path cannot satisfy the exact owner identity", () => {
  for (const target of [
    "owner.md.bak",
    "owner.md.bak#first-use",
    "owner.md/other",
    "ownerXmd",
  ]) {
    assert.throws(
      () =>
        checkReadRoute(
          `Read [owner](${target}). Use tool \`probe\`.`,
          "owner.md",
          "probe",
        ),
      /Missing same-paragraph route/,
    );
  }
});

for (const [file, marker, owner, subject] of [
  ["scripts/source.ts", "//", "../delivery/policy/tool-contracts.md", "git"],
  [
    "scripts/tool-bootstrap.sh",
    "#",
    "../delivery/policy/tool-contracts.md",
    "curl",
  ],
] as const)
  test(`${file} preserves header paragraph boundaries before the first tool use`, (t) => {
    const f = fixtureRepository(t);
    const original = readFileSync(path.join(f.directory, file), "utf8");
    const read = `- Read [contract](${owner}).`;
    const use = `Use tool \`${subject}\`.`;
    const declaration = `${marker} ${read} ${use}`;
    assert.ok(original.includes(declaration));
    f.put(
      file,
      original.replace(declaration, `${marker} ${read}\n${marker}   ${use}`),
    );
    checkToolContracts(f.directory);
    for (const separator of ["", marker, `${marker} `, `${marker}\t`, " \t"]) {
      f.put(
        file,
        original.replace(
          declaration,
          `${marker} ${read}\n${separator}\n${marker} ${use}`,
        ),
      );
      assert.throws(
        () => checkToolContracts(f.directory),
        /Missing same-paragraph route/,
        JSON.stringify(separator),
      );
    }
  });

test("a skill Markdown consumer cannot separate either owner route from first use", (t) => {
  const f = fixtureRepository(t);
  const file = "delivery/skills/gh/references/operations.md";
  const original = readFileSync(path.join(f.directory, file), "utf8");
  checkToolContracts(f.directory);
  for (const subject of ["gh", "git"]) {
    const use = `Use tool \`${subject}\``;
    assert.ok(original.includes(use));
    f.put(file, original.replace(use, `\n\n${use}`));
    assert.throws(
      () => checkToolContracts(f.directory),
      /Missing same-paragraph route/,
    );
  }
});

test("empty inventories and symlink owners are rejected without inspecting network", (t) => {
  const f = fixtureRepository(t);
  symlinkSync("/unavailable-network", path.join(f.directory, "network"));
  checkToolContracts(f.directory);
  f.put("config/tool-inventory.txt", "agents-tool-inventory-v1\n");
  assert.throws(() => readToolContracts(f.directory), /Empty/);
  f.put(
    "config/tool-inventory.txt",
    readFileSync(
      path.join(repositoryRoot, "config/tool-inventory.txt"),
      "utf8",
    ),
  );
  rmSync(path.join(f.directory, "delivery/policy/tool-contracts.md"));
  symlinkSync(
    path.join(repositoryRoot, "delivery/policy/tool-contracts.md"),
    path.join(f.directory, "delivery/policy/tool-contracts.md"),
  );
  assert.throws(() => checkToolContracts(f.directory), /symlink/);
});
