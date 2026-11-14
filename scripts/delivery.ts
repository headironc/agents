import { selectSkillEntries } from "./skills.ts";
import type { SkillEntry } from "./skills.ts";

export const memberCategories = [
  "guide",
  "policy",
  "tool",
  "capability",
  "instructions",
  "skill",
] as const;

export const products = ["codex", "dsh", "antigravity"] as const;
export type Product = (typeof products)[number];
export const darwinOnlySkills = new Set(["sketch-native"]);
const sharedPolicies = [
  "writing",
  "tool-contracts",
  "review",
  "common",
  "execution",
];
const agentPolicies = ["rust", "sql", "models", "deepseek-harness"];
const codexOnlyPolicies = ["antigravity"];
// Deployed executables a consuming project runs directly, published beside the rules they enforce.
// Kept in name order, so a new entry lands in one place and the plan stays comparable.
const tools: [string, string][] = [
  ["check-ids.mjs", "delivery/tools/check-ids.mjs"],
  ["check-prose.mjs", "delivery/tools/check-prose.mjs"],
  ["task-temp.mjs", "delivery/tools/task-temp.mjs"],
];
// Configuration the rules depend on, published so a consuming project and this machine can diff
// their own against it. Every member is a recommendation: these files are merged by hand into
// configuration that belongs to the person or the project, and nothing here writes those files.
const capability: [string, string][] = [
  ["README.md", "delivery/capability/README.md"],
  ["codex.toml", "delivery/capability/codex.toml"],
  ["dsh-headless.patch.yml", "delivery/capability/dsh-headless.patch.yml"],
  ["rust-lints.toml", "delivery/capability/rust-lints.toml"],
];
const dshCapability: [string, string][] = [
  ["README.md", "delivery/capability/README.md"],
  ["dsh-headless.patch.yml", "delivery/capability/dsh-headless.patch.yml"],
  ["rust-lints.toml", "delivery/capability/rust-lints.toml"],
];

export type PublicMember = {
  category: (typeof memberCategories)[number];
  product: Product;
  relative: string;
  source: string;
};

/**
 * Every member of the public layer, as the relative path it is published at and the source it
 * comes from. Exported because a second list of these would drift: whoever checks what the
 * published tree looks like has to read the same list the installer builds it from.
 */
export function publicMembers(
  entries: SkillEntry[],
  selected?: Product,
  platform?: NodeJS.Platform,
): PublicMember[] {
  const skills = (product: Product) =>
    [
      ...new Set(
        selectSkillEntries(entries, product).map((entry) => entry.topLevel),
      ),
    ]
      .filter(
        (name) =>
          platform === undefined ||
          platform === "darwin" ||
          !darwinOnlySkills.has(name),
      )
      .sort((left, right) =>
        Buffer.compare(Buffer.from(left), Buffer.from(right)),
      );
  const members: PublicMember[] = [
    {
      category: "guide",
      product: "codex",
      relative: "README.md",
      source: "delivery/README.md",
    },
  ];
  for (const product of products) {
    for (const name of [
      ...sharedPolicies,
      ...(product === "antigravity" ? ["rust", "sql"] : []),
      ...(product === "codex" || product === "dsh"
        ? agentPolicies.filter(
            (name) => product === "codex" || name !== "models",
          )
        : []),
      ...(product === "codex" ? codexOnlyPolicies : []),
    ])
      members.push({
        category: "policy",
        product,
        relative: `policy/${name}.md`,
        source: `delivery/policy/${name}.md`,
      });
    for (const [name, source] of tools)
      members.push({
        category: "tool",
        product,
        relative: `tools/${name}`,
        source,
      });
  }
  for (const [name, source] of capability)
    members.push({
      category: "capability",
      product: "codex",
      relative: `capability/${name}`,
      source,
    });
  for (const [name, source] of dshCapability)
    members.push({
      category: "capability",
      product: "dsh",
      relative: `capability/${name}`,
      source,
    });
  members.push({
    category: "capability",
    product: "antigravity",
    relative: "capability/rust-lints.toml",
    source: "delivery/capability/rust-lints.toml",
  });
  for (const product of products)
    members.push({
      category: "instructions",
      product,
      relative: "AGENTS.md",
      source:
        product === "codex"
          ? "delivery/AGENTS.md"
          : `delivery/products/${product}/AGENTS.md`,
    });
  for (const product of products)
    for (const name of skills(product)) {
      members.push({
        category: "skill",
        product,
        relative: `skills/${name}`,
        source: `delivery/skills/${name}`,
      });
    }
  return products
    .filter((product) => selected === undefined || product === selected)
    .flatMap((product) =>
      members
        .filter((member) => member.product === product)
        .map((member) =>
          product === "antigravity" && member.category !== "instructions"
            ? { ...member, relative: `config/${member.relative}` }
            : member,
        ),
    );
}
