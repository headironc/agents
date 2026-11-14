import { z } from "zod";
import { digest, gitBlob } from "./upstream-git.ts";
import type { AdaptedSource } from "./adapted-source.ts";
import type { PreparedUpdate } from "./upstream-publish.ts";
export function adaptedUpdate(source: AdaptedSource) {
  const { contract } = source;
  const schema = z.strictObject({
    base: z.string().regex(/^[a-f0-9]{40}$/),
    source: source.schema,
    files: z
      .array(
        z.strictObject({ path: z.string(), content: z.string().max(700_000) }),
      )
      .length(contract.inputs.length),
  });
  async function prepare(root: string, base: string) {
    const imported = await source.planImport(source.verify(root));
    return {
      base,
      source: imported.source,
      files: [...imported.files].map(([path, bytes]) => ({
        path,
        content: bytes.toString("base64"),
      })),
    };
  }
  function update(root: string, input: unknown): PreparedUpdate {
    const previous = source.verify(root),
      plan = schema.parse(input);
    if (
      JSON.stringify(plan.source.adaptation) !==
      JSON.stringify(previous.adaptation)
    )
      throw new Error(`Automation cannot author ${contract.name} adaptation`);
    const files = new Map(plan.files.map((x) => [x.path, x.content]));
    if (files.size !== contract.inputs.length)
      throw new Error(`${contract.name} plan membership differs`);
    const additions: PreparedUpdate["additions"] = [],
      changed: string[] = [];
    for (const file of plan.source.files) {
      const content = files.get(file.target);
      if (content === undefined)
        throw new Error(`Missing ${contract.name} file`);
      const bytes = Buffer.from(content, "base64");
      if (
        bytes.toString("base64") !== content ||
        bytes.length !== file.bytes ||
        digest(bytes) !== file.sha256 ||
        gitBlob(bytes) !== file.blob
      )
        throw new Error(`${contract.name} plan bytes differ`);
      if (
        previous.files.find((x) => x.source === file.source)!.sha256 !==
        file.sha256
      ) {
        additions.push({ path: file.target, contents: content });
        changed.push(file.source);
      }
    }
    if (plan.source.revision === previous.revision && changed.length)
      throw new Error(`Same-revision ${contract.name} drift`);
    if (changed.length)
      additions.push({
        path: contract.lock,
        contents: Buffer.from(
          JSON.stringify(plan.source, null, 2) + "\n",
        ).toString("base64"),
      });
    return {
      base: plan.base,
      version: plan.source.revision,
      branchPrefix: `codex/update-${contract.key}-`,
      draft: true,
      additions,
      deletions: [],
      title: `chore(upstream): assess ${contract.name} ${plan.source.revision.slice(0, 7)}`,
      body: `Proposes updated upstream inputs for the locally adapted ${contract.key} skill. The prior adaptation is retained; the source gate blocks delivery until the new revision is assessed against every delivered skill file.\n\n[Upstream comparison](https://github.com/${contract.repository}/compare/${previous.revision}...${plan.source.revision})\n\nChanged inputs:\n${changed.map((x) => `- ${x}`).join("\n")}\n\nFollow docs/tooling.md's adapted skill procedure. Compare old originals, new originals and the current local skill; preserve task authorization and dependency ownership, assess licensing and complete reference coverage, update only justified local guidance, and record the new adaptation with exact local file hashes. Run the complete gate and relevant real-session acceptance before marking ready. Normal review, CI and authorized merge remain required. This workflow does not install, approve or merge.\n`,
    };
  }

  return { schema, prepare, update };
}
