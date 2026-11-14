import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  digest,
  gitBlob,
  readGitBytes,
  readGitSource,
} from "./upstream-git.ts";
import type { ReadSource } from "./upstream-git.ts";

export interface ReferenceContract {
  name: string;
  title: string;
  key: string;
  repository: string;
  repositoryId: number;
  branch: string;
  lock: string;
  root: string;
  policy: string;
  inputs: readonly { source: string; sections: readonly string[] }[];
}

function regular(root: string, relative: string): Buffer {
  let current = root;
  const parts = relative.split("/");
  for (const [i, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = lstatSync(current);
    if (
      stat.isSymbolicLink() ||
      (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())
    )
      throw new Error(`Unsafe reference path: ${relative}`);
  }
  return readFileSync(current);
}

// Contracts come from trusted source modules, never a downloaded plan or CLI path.
export function referenceSource(contract: ReferenceContract) {
  const target = (source: string) =>
    `${contract.root}/${source.replaceAll("/", "-")}.txt`;
  const oid = z.string().regex(/^[a-f0-9]{40}$/);
  const hash = z.string().regex(/^[a-f0-9]{64}$/);
  const schema = z
    .strictObject({
      schemaVersion: z.literal(1),
      repository: z.literal(contract.repository),
      repositoryId: z.literal(contract.repositoryId),
      branch: z.literal(contract.branch),
      revision: oid,
      files: z
        .array(
          z.strictObject({
            source: z.string(),
            target: z.string(),
            bytes: z
              .number()
              .int()
              .positive()
              .max(512 * 1024),
            sha256: hash,
            blob: oid,
          }),
        )
        .length(contract.inputs.length),
      assessment: z
        .strictObject({
          revision: oid,
          policySha256: hash,
          decisions: z
            .array(
              z.strictObject({
                source: z.string(),
                decision: z.enum(["adopted", "retained", "not-applicable"]),
                reason: z.string().trim().min(20).max(2000),
              }),
            )
            .length(contract.inputs.length),
        })
        .nullable(),
    })
    .superRefine((value, context) => {
      const expected = contract.inputs.map((x) => x.source);
      if (
        JSON.stringify(value.files.map((x) => x.source)) !==
          JSON.stringify(expected) ||
        value.files.some((x) => x.target !== target(x.source)) ||
        (value.assessment &&
          JSON.stringify(value.assessment.decisions.map((x) => x.source)) !==
            JSON.stringify(expected))
      )
        context.addIssue({
          code: "custom",
          message: `${contract.name} source membership differs`,
        });
    });
  type Source = z.infer<typeof schema>;

  function verify(root: string, reviewed = true): Source {
    const source = schema.parse(
      JSON.parse(regular(root, contract.lock).toString("utf8")),
    );
    const expected = source.files.map((x) => path.basename(x.target)).sort();
    if (
      JSON.stringify(readdirSync(path.join(root, contract.root)).sort()) !==
      JSON.stringify(expected)
    )
      throw new Error(`${contract.name} reference membership differs`);
    for (const file of source.files) {
      const bytes = regular(root, file.target);
      if (
        bytes.length !== file.bytes ||
        digest(bytes) !== file.sha256 ||
        gitBlob(bytes) !== file.blob
      )
        throw new Error(
          `${contract.name} reference bytes differ: ${file.source}`,
        );
    }
    const policy = regular(root, contract.policy);
    for (const input of contract.inputs)
      for (const section of input.sections)
        if (!policy.toString("utf8").includes(`\n## ${section}\n`))
          throw new Error(
            `Missing ${contract.name} policy section: ${section}`,
          );
    if (
      reviewed &&
      (source.assessment?.revision !== source.revision ||
        source.assessment.policySha256 !== digest(policy) ||
        !policy
          .toString("utf8")
          .includes(
            `https://github.com/${contract.repository}/tree/${source.revision}`,
          ))
    )
      throw new Error(
        `${contract.name} reference assessment pending or policy changed; assess this revision and exact ${path.basename(contract.policy)} before delivery`,
      );
    return source;
  }

  async function planImport(
    previous: Source | null,
    read: ReadSource = readGitBytes,
    revision?: string,
  ) {
    const {
      revision: next,
      entries,
      files,
    } = await readGitSource(
      {
        name: contract.name,
        repository: contract.repository,
        repositoryId: contract.repositoryId,
        branch: contract.branch,
        files: contract.inputs.map((x) => ({
          source: x.source,
          target: target(x.source),
        })),
      },
      previous?.revision ?? null,
      read,
      revision,
    );
    const source = schema.parse({
      schemaVersion: 1,
      repository: contract.repository,
      repositoryId: contract.repositoryId,
      branch: contract.branch,
      revision: next,
      files: entries,
      assessment: previous?.assessment ?? null,
    });
    if (
      previous?.revision === next &&
      JSON.stringify(previous.files) !== JSON.stringify(entries)
    )
      throw new Error(`Same-revision ${contract.name} source drift`);
    return { source, files };
  }
  return { contract, target, schema, verify, planImport };
}

export type ReferenceSource = ReturnType<typeof referenceSource>;
