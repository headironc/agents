import { z } from "zod";
import { digest, gitBlob } from "./upstream-git.ts";
import {
  pbtInputs,
  pbtLock,
  pbtRepository,
  pbtSourceSchema,
  planPbtImport,
  verifyPbtSource,
} from "./property-testing-source.ts";
import type { PreparedUpdate } from "./upstream-publish.ts";

export const pbtPlanSchema = z.strictObject({
  base: z.string().regex(/^[a-f0-9]{40}$/),
  source: pbtSourceSchema,
  files: z
    .array(
      z.strictObject({ path: z.string(), content: z.string().max(700_000) }),
    )
    .length(pbtInputs.length),
});
export async function preparePbt(root: string, base: string) {
  const imported = await planPbtImport(verifyPbtSource(root));
  return {
    base,
    source: imported.source,
    files: [...imported.files].map(([path, bytes]) => ({
      path,
      content: bytes.toString("base64"),
    })),
  };
}
export function pbtUpdate(root: string, input: unknown): PreparedUpdate {
  const previous = verifyPbtSource(root),
    plan = pbtPlanSchema.parse(input);
  if (
    JSON.stringify(plan.source.adaptation) !==
    JSON.stringify(previous.adaptation)
  )
    throw new Error("Automation cannot author property testing adaptation");
  const files = new Map(plan.files.map((x) => [x.path, x.content]));
  if (files.size !== pbtInputs.length)
    throw new Error("Property testing plan membership differs");
  const additions: PreparedUpdate["additions"] = [],
    changed: string[] = [];
  for (const file of plan.source.files) {
    const content = files.get(file.target);
    if (content === undefined) throw new Error("Missing property testing file");
    const bytes = Buffer.from(content, "base64");
    if (
      bytes.toString("base64") !== content ||
      bytes.length !== file.bytes ||
      digest(bytes) !== file.sha256 ||
      gitBlob(bytes) !== file.blob
    )
      throw new Error("Property testing plan bytes differ");
    if (
      previous.files.find((x) => x.source === file.source)!.sha256 !==
      file.sha256
    ) {
      additions.push({ path: file.target, contents: content });
      changed.push(file.source);
    }
  }
  if (plan.source.revision === previous.revision && changed.length)
    throw new Error("Same-revision property testing drift");
  if (changed.length)
    additions.push({
      path: pbtLock,
      contents: Buffer.from(
        JSON.stringify(plan.source, null, 2) + "\n",
      ).toString("base64"),
    });
  return {
    base: plan.base,
    version: plan.source.revision,
    branchPrefix: "codex/update-property-based-testing-",
    draft: true,
    additions,
    deletions: [],
    title: `chore(upstream): assess property testing ${plan.source.revision.slice(0, 7)}`,
    body: `Proposes updated official inputs for the locally adapted property-based-testing skill. The prior adaptation is retained; the source gate blocks delivery until the new revision is assessed against every delivered skill file.\n\n[Upstream comparison](https://github.com/${pbtRepository}/compare/${previous.revision}...${plan.source.revision})\n\nChanged inputs:\n${changed.map((x) => `- ${x}`).join("\n")}\n\nFollow docs/tooling.md's property testing adaptation procedure. Compare old originals, new originals and the current local skill; preserve task authorization and dependency ownership, assess licensing and complete reference coverage, update only justified local guidance, and record the new adaptation with exact local file hashes. Run the complete gate and relevant real-session acceptance before marking ready. Normal review, CI and authorized merge remain required. This workflow does not install, approve or merge.\n`,
  };
}
