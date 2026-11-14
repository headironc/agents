import path from "node:path";
import { memberCategories, products } from "./delivery.ts";

export const recordedProducts = [
  products[0],
  "claude",
  products[1],
  products[2],
] as const;
export type RecordedProduct = (typeof recordedProducts)[number];

// Old plans can name the retired claude product or codex-sessions fragment. New selections are
// checked against the current delivery manifest separately; keeping the record syntax does not publish them.
export const adoptKeyPattern =
  /^(?:codex|claude|dsh|antigravity):(?:[a-z0-9]+(?:-[a-z0-9]+)*|AGENTS\.md|README\.md|policy\/[a-z-]+\.md|tools\/[a-z-]+\.mjs|capability\/(?:README\.md|codex\.toml|codex-sessions\.toml|dsh-headless\.patch\.yml|rust-lints\.toml))$/;

// These retired member identities are needed to read old records before dispatching to their runtime.
// Only the active delivery manifest is used to select targets when creating a plan.
export const retiredClaudeMembers = [
  ["policy", "policy/writing.md"],
  ["policy", "policy/tool-contracts.md"],
  ["policy", "policy/review.md"],
  ["tool", "tools/check-ids.mjs"],
  ["tool", "tools/check-prose.mjs"],
  ["tool", "tools/task-temp.mjs"],
] as const;
export const retiredCodexMembers = [
  ["policy", "policy/claude-code.md"],
] as const;
export const retiredV7CodexMembers = [
  ["policy", "policy/codex-sessions.md"],
  ["tool", "tools/codex-sessions.mjs"],
  ["capability", "capability/codex-sessions.toml"],
] as const;

export function legacyFileMembers(version: 5 | 6 | 7): {
  product: RecordedProduct;
  category: (typeof memberCategories)[number];
  relative: string;
  source: string;
}[] {
  const members: {
    product: RecordedProduct;
    category: (typeof memberCategories)[number];
    relative: string;
    source: string;
  }[] = [];
  // Freeze the pre-V8 publication map: current entrypoints and policy additions must not
  // reinterpret a persistent plan or prevent its original runtime from restoring it.
  for (const product of ["codex", "dsh", "antigravity"] as const) {
    const policies = [
      "writing",
      "tool-contracts",
      "review",
      ...(product !== "antigravity"
        ? ["rust", "sql", "models", "deepseek-harness"]
        : []),
      ...(product === "codex" ? ["antigravity"] : []),
    ];
    for (const name of policies)
      members.push({
        product,
        category: "policy",
        relative: `policy/${name}.md`,
        source: `delivery/policy/${name}.md`,
      });
    for (const name of ["check-ids", "check-prose", "task-temp"])
      members.push({
        product,
        category: "tool",
        relative: `tools/${name}.mjs`,
        source: `delivery/tools/${name}.mjs`,
      });
    if (product !== "antigravity") {
      members.push({
        product,
        category: "instructions",
        relative: "AGENTS.md",
        source: "delivery/AGENTS.md",
      });
      for (const name of [
        "README.md",
        "dsh-headless.patch.yml",
        "rust-lints.toml",
        ...(product === "codex" ? ["codex.toml"] : []),
      ])
        members.push({
          product,
          category: "capability",
          relative: `capability/${name}`,
          source: `delivery/capability/${name}`,
        });
    }
  }
  members.push({
    product: "codex",
    category: "guide",
    relative: "README.md",
    source: "delivery/README.md",
  });
  for (const [category, relative] of retiredClaudeMembers)
    members.push({
      product: "claude",
      category,
      relative,
      source: `delivery/${relative}`,
    });
  for (const [category, relative] of retiredCodexMembers)
    members.push({
      product: "codex",
      category,
      relative,
      source: `delivery/${relative}`,
    });
  if (version === 7) {
    for (const [category, relative] of retiredV7CodexMembers)
      members.push({
        product: "codex",
        category,
        relative,
        source: `delivery/${relative}`,
      });
  }
  return members;
}

export function validLegacyProductRoots(
  version: 5 | 6,
  roots: {
    codex?: unknown;
    claude?: unknown;
    dsh?: unknown;
    antigravity?: unknown;
  },
): boolean {
  return (
    roots.codex !== undefined &&
    roots.claude !== undefined &&
    roots.dsh === undefined &&
    (version === 6) === (roots.antigravity !== undefined)
  );
}

export function privateRunDirectory(
  version: 5 | 6 | 7 | 8,
  roots: { state: { path: string }; codex?: { path: string } | undefined },
  id: string,
): string {
  return version >= 7
    ? path.join(roots.state.path, "agents/install", id)
    : path.join(roots.codex?.path ?? "", ".agents-install", id);
}

export function isLegacyPrivateRun(
  roots: { codex?: { path: string } | undefined },
  privateRun: string,
): boolean {
  return (
    roots.codex !== undefined &&
    path.dirname(privateRun) === path.join(roots.codex.path, ".agents-install")
  );
}
