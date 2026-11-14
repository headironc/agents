import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { referenceSource } from "./reference-source.ts";
export {
  digest,
  gitBlob,
  readGitBytes as readRustBytes,
} from "./upstream-git.ts";
export type { ReadSource } from "./upstream-git.ts";

export const rustRepository = "rust-lang/api-guidelines";
export const rustRepositoryId = 81125442;
export const rustLock = "config/rust-api-guidelines-source.json";
export const rustRoot = "config/upstream/rust-api-guidelines";
export const rustPolicy = "delivery/policy/rust.md";
export const rustInputs = [
  { source: "LICENSE-APACHE", sections: ["References"] },
  { source: "LICENSE-MIT", sections: ["References"] },
  { source: "src/flexibility.md", sections: ["Ownership and abstraction"] },
  {
    source: "src/interoperability.md",
    sections: [
      "Derive order",
      "Naming",
      "Imports and conversions",
      "Errors and validation",
      "Ownership and abstraction",
    ],
  },
  { source: "src/naming.md", sections: ["Naming"] },
  {
    source: "src/type-safety.md",
    sections: ["Value types", "Input and result models"],
  },
] as const;
export const rustReference = referenceSource({
  name: "Rust",
  title: "Rust API Guidelines",
  key: "rust-api-guidelines",
  repository: rustRepository,
  repositoryId: rustRepositoryId,
  branch: "master",
  lock: rustLock,
  root: rustRoot,
  policy: rustPolicy,
  inputs: rustInputs,
});
export const rustTarget = rustReference.target;
export const rustSourceSchema = rustReference.schema;
export type RustSource = z.infer<typeof rustSourceSchema>;
export type RustImport = { source: RustSource; files: Map<string, Buffer> };
export const verifyRustSource = rustReference.verify;
export const planRustImport = rustReference.planImport;

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (process.argv.length !== 3 || process.argv[2] !== "--check")
    throw new Error("Usage: rust-api-source.ts --check");
  const source = verifyRustSource(path.resolve(import.meta.dirname, ".."));
  console.log(`Rust API Guidelines assessment verified: ${source.revision}`);
}
