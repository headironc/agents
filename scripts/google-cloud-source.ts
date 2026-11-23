import path from "node:path";
import { pathToFileURL } from "node:url";
import { adaptedSource } from "./adapted-source.ts";
import { adaptedUpdate } from "./upstream-adapted.ts";

const root = "config/upstream/google-cloud";
const targetMap: Record<string, string> = {
  LICENSE: `${root}/LICENSE.txt`,
  "plugins/cloud/google-cloud-developer/rules/google-cloud-discovery.md": `${root}/google-cloud-discovery.md.txt`,
  "plugins/cloud/google-cloud-developer/skills/gcloud/SKILL.md": `${root}/gcloud--SKILL.md.txt`,
  "plugins/cloud/google-cloud-developer/skills/gcloud/references/cli-usage.md": `${root}/gcloud--cli-usage.md.txt`,
  "plugins/cloud/google-cloud-developer/skills/gcloud/references/mcp-usage.md": `${root}/gcloud--mcp-usage.md.txt`,
  "plugins/cloud/google-cloud-developer/skills/google-cloud-recipe-auth/SKILL.md": `${root}/google-cloud-recipe-auth--SKILL.md.txt`,
  "plugins/cloud/google-cloud-developer/skills/google-cloud-recipe-onboarding/SKILL.md": `${root}/google-cloud-recipe-onboarding--SKILL.md.txt`,
  "plugins/cloud/google-cloud-developer/skills/finding-google-skills/SKILL.md": `${root}/finding-google-skills--SKILL.md.txt`,
  "plugins/cloud/google-cloud-developer/skills/retrieving-developer-knowledge/SKILL.md": `${root}/retrieving-developer-knowledge--SKILL.md.txt`,
  "plugins/cloud/google-cloud-developer/skills/retrieving-developer-knowledge/references/mcp-usage.md": `${root}/retrieving-developer-knowledge--mcp-usage.md.txt`,
  "plugins/cloud/google-cloud-developer/skills/retrieving-developer-knowledge/references/api-fallback.md": `${root}/retrieving-developer-knowledge--api-fallback.md.txt`,
  "plugins/cloud/google-cloud-developer/skills/retrieving-developer-knowledge/references/supported-domains.md": `${root}/retrieving-developer-knowledge--supported-domains.md.txt`,
  "skills/cloud/google-cloud-storage-basics/SKILL.md": `${root}/google-cloud-storage-basics--SKILL.md.txt`,
  "skills/cloud/google-cloud-storage-basics/references/mcp-usage.md": `${root}/google-cloud-storage-basics--mcp-usage.md.txt`,
  "skills/cloud/cloud-sql-basics/SKILL.md": `${root}/cloud-sql-basics--SKILL.md.txt`,
  "skills/cloud/cloud-sql-basics/references/mcp-usage.md": `${root}/cloud-sql-basics--mcp-usage.md.txt`,
};
export const googleCloudSource = adaptedSource({
  name: "Google Cloud skills",
  key: "google-cloud",
  repository: "google/skills",
  repositoryId: 1197652028,
  lock: "config/google-cloud-source.json",
  root,
  skill: "delivery/skills/google-cloud",
  inputs: Object.keys(targetMap),
  local: [
    "LICENSE.txt",
    "SKILL.md",
    "references/capabilities.md",
    "skills/cloud-sql-postgresql/SKILL.md",
    "skills/finding-google-skills/SKILL.md",
    "skills/gcloud/SKILL.md",
    "skills/gcloud/references/cli-usage.md",
    "skills/gcloud/references/mcp-usage.md",
    "skills/google-cloud-auth/SKILL.md",
    "skills/google-cloud-onboarding/SKILL.md",
    "skills/google-cloud-storage/SKILL.md",
    "skills/retrieving-developer-knowledge/SKILL.md",
    "skills/retrieving-developer-knowledge/references/api-fallback.md",
    "skills/retrieving-developer-knowledge/references/mcp-usage.md",
    "skills/retrieving-developer-knowledge/references/supported-domains.md",
  ],
  license: "LICENSE",
  target: (source) =>
    targetMap[source] ?? `${root}/${path.posix.basename(source)}.txt`,
  completeDirectories: [],
});
export const googleCloudUpdate = adaptedUpdate(googleCloudSource);
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (process.argv.length !== 3 || process.argv[2] !== "--check")
    throw new Error("Usage: google-cloud-source.ts --check");
  console.log(
    `Google Cloud adaptation verified: ${googleCloudSource.verify(path.resolve(import.meta.dirname, "..")).revision}`,
  );
}
