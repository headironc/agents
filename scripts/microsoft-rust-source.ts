import path from "node:path";
import { pathToFileURL } from "node:url";
import { referenceSource } from "./reference-source.ts";
import { referenceUpdate } from "./upstream-reference.ts";

export const microsoftRust = referenceSource({
  name: "Microsoft Rust",
  title: "Microsoft Rust Guidelines",
  key: "microsoft-rust-guidelines",
  repository: "microsoft/rust-guidelines",
  repositoryId: 1020012680,
  branch: "main",
  lock: "config/microsoft-rust-source.json",
  root: "config/upstream/microsoft-rust-guidelines",
  policy: "delivery/policy/rust.md",
  inputs: [
    { source: "LICENSE.md", sections: ["References"] },
    {
      source: "src/guidelines/correctness/M-UNSAFE.md",
      sections: ["Safety and FFI"],
    },
    {
      source: "src/guidelines/correctness/M-UNSOUND.md",
      sections: ["Safety and FFI"],
    },
    {
      source: "src/guidelines/ffi/M-FFI-TRANSLATES.md",
      sections: ["Safety and FFI"],
    },
    {
      source: "src/guidelines/libs/building/M-FEATURES-ADDITIVE.md",
      sections: ["Workspace validation"],
    },
    {
      source: "src/guidelines/performance/M-HOTPATH.md",
      sections: ["Performance and asynchronous work"],
    },
    {
      source: "src/guidelines/performance/M-YIELD-POINTS.md",
      sections: ["Performance and asynchronous work"],
    },
  ],
});
export const microsoftRustUpdate = referenceUpdate(microsoftRust);

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (process.argv.length !== 3 || process.argv[2] !== "--check")
    throw new Error("Usage: microsoft-rust-source.ts --check");
  const source = microsoftRust.verify(path.resolve(import.meta.dirname, ".."));
  console.log(
    `Microsoft Rust Guidelines assessment verified: ${source.revision}`,
  );
}
