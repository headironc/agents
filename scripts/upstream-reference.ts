import path from "node:path";
import { z } from "zod";
import { digest, gitBlob } from "./upstream-git.ts";
import type { ReferenceSource } from "./reference-source.ts";
import type { PreparedUpdate } from "./upstream-publish.ts";

export function referenceUpdate(reference: ReferenceSource) {
  const { contract, schema, verify, planImport } = reference;
  const planSchema = z.strictObject({
    base: z.string().regex(/^[a-f0-9]{40}$/),
    source: schema,
    files: z
      .array(
        z.strictObject({ path: z.string(), content: z.string().max(700_000) }),
      )
      .length(contract.inputs.length),
  });
  async function prepare(root: string, base: string) {
    const imported = await planImport(verify(root));
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
    const previous = verify(root);
    const plan = planSchema.parse(input);
    if (
      JSON.stringify(plan.source.assessment) !==
      JSON.stringify(previous.assessment)
    )
      throw new Error(
        `Automation cannot author ${contract.name} assessment decisions`,
      );
    const files = new Map(plan.files.map((x) => [x.path, x.content]));
    if (files.size !== plan.source.files.length)
      throw new Error(`${contract.name} plan membership differs`);
    const additions: PreparedUpdate["additions"] = [];
    const changed: string[] = [];
    for (const file of plan.source.files) {
      const content = files.get(file.target);
      if (content === undefined)
        throw new Error(`Missing ${contract.name} plan file`);
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
        changed.push(file.source);
        additions.push({ path: file.target, contents: content });
      }
    }
    if (plan.source.revision === previous.revision && changed.length)
      throw new Error(`Same-revision ${contract.name} source drift`);
    if (changed.length)
      additions.push({
        path: contract.lock,
        contents: Buffer.from(
          JSON.stringify(plan.source, null, 2) + "\n",
        ).toString("base64"),
      });
    const mapping = contract.inputs
      .filter((x) => changed.includes(x.source))
      .map(
        (x) =>
          `- ${x.source}: ${path.basename(contract.policy)} — ${x.sections.join(", ")}`,
      )
      .join("\n");
    return {
      base: plan.base,
      version: plan.source.revision,
      branchPrefix: `codex/update-${contract.key}-`,
      additions,
      deletions: [],
      draft: true,
      title: `chore(upstream): assess ${contract.title} ${plan.source.revision.slice(0, 7)}`,
      body: `Proposes updated reference originals for the existing Rust policy. The previous assessment is preserved and the source check must fail until this candidate has been assessed.\n\n[Upstream comparison](https://github.com/${contract.repository}/compare/${previous.revision}...${plan.source.revision})\n\nAffected policy sections:\n${mapping}\n\nFollow docs/tooling.md's Rust reference assessment procedure: review each changed reference and license, decide whether rust.md needs an edit, update its pinned reference and the source lock assessment against the exact policy bytes, then run the complete checks. Reassess every adopted reference bound to the shared policy after any policy edit. Mark ready only after that work. Complete normal code/security review, CI and authorized merge. This workflow does not assess, approve, merge or install.\n`,
    };
  }
  return { planSchema, prepare, update };
}
