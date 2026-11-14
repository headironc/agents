import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  fetchModernWebBytes,
  modernWebLock,
  modernWebSourceSchema,
  planModernWebImport,
  sha256,
  verifyModernWebSource,
} from "./modern-web-source.ts";

const branchPrefix = "codex/update-modern-web-guidance-";
const oid = z.string().regex(/^[a-f0-9]{40}$/);
const version = z
  .string()
  .regex(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/);
export const planSchema = z.strictObject({
  base: oid,
  source: modernWebSourceSchema,
  files: z
    .array(z.strictObject({ path: z.string(), content: z.string() }))
    .max(400),
});
export type UpdatePlan = z.infer<typeof planSchema>;
export function changes(root: string, input: unknown) {
  const plan = planSchema.parse(input);
  version.parse(plan.source.version);
  verifyModernWebSource(root);
  const previous = modernWebSourceSchema.parse(
    JSON.parse(readFileSync(path.join(root, modernWebLock), "utf8")),
  );
  const newer = plan.source.version.split(".").map(BigInt);
  const older = previous.version.split(".").map(BigInt);
  const first = newer.findIndex((n, i) => n !== older[i]);
  if (first < 0) {
    if (JSON.stringify(plan.source) !== JSON.stringify(previous))
      throw new Error("Same-version source drift");
  } else if (newer[first]! < older[first]!)
    throw new Error("Upstream downgrade refused");
  const files = new Map(plan.files.map((file) => [file.path, file.content]));
  if (
    files.size !== plan.files.length ||
    files.size !== plan.source.files.length
  )
    throw new Error("Invalid update membership");
  const additions: { path: string; contents: string }[] = [];
  for (const file of plan.source.files) {
    const content = files.get(file.target);
    if (content === undefined) throw new Error("Missing update file");
    const bytes = Buffer.from(content, "base64");
    if (
      bytes.toString("base64") !== content ||
      bytes.length !== file.bytes ||
      sha256(bytes) !== file.sha256
    )
      throw new Error("Invalid update bytes");
    const before = previous.files.find((old) => old.target === file.target);
    if (!before || before.sha256 !== file.sha256)
      additions.push({ path: file.target, contents: content });
  }
  if (first < 0) return { plan, additions: [], deletions: [] };
  additions.push({
    path: modernWebLock,
    contents: Buffer.from(JSON.stringify(plan.source, null, 2) + "\n").toString(
      "base64",
    ),
  });
  const deletions = previous.files
    .filter((file) => !files.has(file.target))
    .map((file) => ({ path: file.target }));
  if (
    Buffer.byteLength(JSON.stringify({ additions, deletions })) >
    35 * 1024 * 1024
  )
    throw new Error("Update exceeds publisher's 35 MiB request limit");
  return { plan, additions, deletions };
}

export async function prepareModernWeb(
  root: string,
  base: string,
): Promise<UpdatePlan> {
  verifyModernWebSource(root);
  const metadata = JSON.parse(
    (
      await fetchModernWebBytes(
        "https://registry.npmjs.org/modern-web-guidance/latest",
        1024 * 1024,
      )
    ).toString("utf8"),
  );
  const imported = await planModernWebImport(version.parse(metadata.version));
  return {
    base,
    source: imported.source,
    files: [...imported.files].map(([path, bytes]) => ({
      path,
      content: bytes.toString("base64"),
    })),
  };
}

export function modernWebUpdate(
  root: string,
  input: unknown,
): import("./upstream-publish.ts").PreparedUpdate {
  const { plan, additions, deletions } = changes(root, input);
  return {
    base: plan.base,
    version: plan.source.version,
    branchPrefix,
    additions,
    deletions,
    draft: false,
    title: `chore(upstream): update modern-web-guidance to ${plan.source.version}`,
    body: `Updates the complete official npm runtime, index, guides and licenses to ${plan.source.version}.\n\nSource revision: ${plan.source.gitHead}\nIntegrity: ${plan.source.integrity}\n\nLocal skill adaptations are unchanged. Review upstream interface/license changes before merging. Approve any waiting Actions runs, then complete normal CI, independent review and merge requirements. This workflow does not approve, merge or install.\n`,
  };
}
