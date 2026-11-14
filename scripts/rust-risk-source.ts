import path from "node:path";
import { pathToFileURL } from "node:url";
import { adaptedSource } from "./adapted-source.ts";
import { adaptedUpdate } from "./upstream-adapted.ts";

const root = "config/upstream/rust-risk-review";
export const rustRiskPrompts = [
  "cancel-safety",
  "send-sync-bounds",
  "unsafe-sync-impl",
  "panic-unwind-unsafe",
  "closure-ffi",
  "resource-exhaustion",
  "toctou",
] as const;
export const rustRiskSource = adaptedSource({
  name: "Rust risk review",
  key: "rust-risk-review",
  repository: "trailofbits/skills",
  repositoryId: 1134447175,
  lock: "config/rust-risk-source.json",
  root,
  skill: "delivery/skills/rust-risk-review",
  inputs: [
    "LICENSE",
    ...rustRiskPrompts.map(
      (x) => `plugins/rust-review/prompts/general/${x}-finder.md`,
    ),
  ],
  local: [
    "LICENSE.txt",
    "SKILL.md",
    "references/async-and-threads.md",
    "references/unsafe-and-ffi.md",
    "references/resources-and-files.md",
  ],
  license: "LICENSE",
  target: (source) => `${root}/${path.posix.basename(source)}.txt`,
  // Only these self-contained bug patterns are adopted, not the orchestrator or other detectors.
  completeDirectories: [],
});
export const rustRiskUpdate = adaptedUpdate(rustRiskSource);
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (process.argv.length !== 3 || process.argv[2] !== "--check")
    throw new Error("Usage: rust-risk-source.ts --check");
  console.log(
    `Rust risk review adaptation verified: ${rustRiskSource.verify(path.resolve(import.meta.dirname, "..")).revision}`,
  );
}
