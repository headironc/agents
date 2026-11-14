import path from "node:path";
import { pathToFileURL } from "node:url";
import { adaptedSource } from "./adapted-source.ts";
import { adaptedUpdate } from "./upstream-adapted.ts";

const root = "config/upstream/web-quality-audit";
export const webAuditSource = adaptedSource({
  name: "Web quality audit",
  key: "web-quality-audit",
  repository: "addyosmani/web-quality-skills",
  repositoryId: 1136782037,
  lock: "config/web-audit-source.json",
  root,
  skill: "delivery/skills/web-quality-audit",
  inputs: [
    "LICENSE",
    "skills/web-quality-audit/SKILL.md",
    "skills/performance/references/MEASUREMENT.md",
  ],
  local: [
    "LICENSE.txt",
    "SKILL.md",
    "references/measurement.md",
    "references/checks.md",
  ],
  license: "LICENSE",
  target: (source) => `${root}/${path.posix.basename(source)}.txt`,
  // Adopt the audit/measurement workflow, not the sibling category skills or analyzer.
  completeDirectories: [],
});
export const webAuditUpdate = adaptedUpdate(webAuditSource);
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (process.argv.length !== 3 || process.argv[2] !== "--check")
    throw new Error("Usage: web-audit-source.ts --check");
  console.log(
    `Web quality audit adaptation verified: ${webAuditSource.verify(path.resolve(import.meta.dirname, "..")).revision}`,
  );
}
