import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  digest,
  gitBlob,
  readGitSource,
  readGitBytes,
} from "./upstream-git.ts";
import type { ReadSource } from "./upstream-git.ts";

export interface AdaptedContract {
  name: string;
  key: string;
  repository: string;
  repositoryId: number;
  lock: string;
  root: string;
  skill: string;
  inputs: readonly string[];
  local: readonly string[];
  license: string;
  target: (source: string) => string;
  completeDirectories: string[];
}
// Contracts are code-owned; plans cannot select repositories or paths.
export function adaptedSource(contract: AdaptedContract) {
  const oid = z.string().regex(/^[a-f0-9]{40}$/),
    hash = z.string().regex(/^[a-f0-9]{64}$/);
  const schema = z
    .strictObject({
      schemaVersion: z.literal(1),
      repository: z.literal(contract.repository),
      repositoryId: z.literal(contract.repositoryId),
      branch: z.literal("main"),
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
      adaptation: z
        .strictObject({
          revision: oid,
          files: z
            .array(z.strictObject({ path: z.string(), sha256: hash }))
            .length(contract.local.length),
          decisions: z
            .array(
              z.strictObject({
                source: z.string(),
                decision: z.enum(["adopted", "adapted", "retained"]),
                reason: z.string().trim().min(20).max(2000),
              }),
            )
            .length(contract.inputs.length),
        })
        .nullable(),
    })
    .superRefine((value, context) => {
      if (
        JSON.stringify(value.files.map((x) => x.source)) !==
          JSON.stringify(contract.inputs) ||
        value.files.some((x) => x.target !== contract.target(x.source)) ||
        (value.adaptation &&
          (JSON.stringify(value.adaptation.files.map((x) => x.path)) !==
            JSON.stringify(contract.local) ||
            JSON.stringify(value.adaptation.decisions.map((x) => x.source)) !==
              JSON.stringify(contract.inputs)))
      )
        context.addIssue({
          code: "custom",
          message: `${contract.name} membership differs`,
        });
    });
  type Source = z.infer<typeof schema>;

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
        throw new Error(`Unsafe ${contract.name} path: ${relative}`);
    }
    return readFileSync(current);
  }

  function verify(root: string, adapted = true): Source {
    const source = schema.parse(
      JSON.parse(regular(root, contract.lock).toString("utf8")),
    );
    if (
      JSON.stringify(readdirSync(path.join(root, contract.root)).sort()) !==
      JSON.stringify(source.files.map((x) => path.basename(x.target)).sort())
    )
      throw new Error(`${contract.name} originals differ`);
    for (const file of source.files) {
      const bytes = regular(root, file.target);
      if (
        bytes.length !== file.bytes ||
        digest(bytes) !== file.sha256 ||
        gitBlob(bytes) !== file.blob
      )
        throw new Error(`${contract.name} bytes differ: ${file.source}`);
    }
    const localFiles: string[] = [];
    const visit = (relative: string) => {
      for (const name of readdirSync(
        path.join(root, contract.skill, relative),
      )) {
        const file = path.posix.join(relative, name),
          stat = lstatSync(path.join(root, contract.skill, file));
        if (stat.isSymbolicLink())
          throw new Error(`Linked ${contract.name} asset`);
        if (stat.isDirectory()) visit(file);
        else {
          regular(root, `${contract.skill}/${file}`);
          localFiles.push(file);
        }
      }
    };
    visit("");
    if (
      JSON.stringify(localFiles.sort()) !==
      JSON.stringify([...contract.local].sort())
    )
      throw new Error(`${contract.name} skill membership differs`);
    if (
      adapted &&
      (source.adaptation?.revision !== source.revision ||
        source.adaptation.files.some(
          (x) =>
            digest(regular(root, `${contract.skill}/${x.path}`)) !== x.sha256,
        ) ||
        !regular(root, `${contract.skill}/SKILL.md`)
          .toString("utf8")
          .includes(
            `https://github.com/${contract.repository}/tree/${source.revision}`,
          ) ||
        !regular(root, `${contract.skill}/LICENSE.txt`).equals(
          regular(root, contract.target(contract.license)),
        ))
    )
      throw new Error(
        `${contract.name} adaptation pending or local skill changed; assess this revision and exact delivered files`,
      );
    return source;
  }

  async function planImport(
    previous: Source | null,
    read: ReadSource = readGitBytes,
    revision?: string,
  ) {
    const imported = await readGitSource(
      {
        name: contract.name,
        repository: contract.repository,
        repositoryId: contract.repositoryId,
        branch: "main",
        files: contract.inputs.map((source) => ({
          source,
          target: contract.target(source),
        })),
        completeDirectories: contract.completeDirectories,
      },
      previous?.revision ?? null,
      read,
      revision,
    );
    const source = schema.parse({
      schemaVersion: 1,
      repository: contract.repository,
      repositoryId: contract.repositoryId,
      branch: "main",
      revision: imported.revision,
      files: imported.entries,
      adaptation: previous?.adaptation ?? null,
    });
    if (
      previous?.revision === source.revision &&
      JSON.stringify(previous.files) !== JSON.stringify(source.files)
    )
      throw new Error(`Same-revision ${contract.name} drift`);
    return { source, files: imported.files };
  }

  return { contract, schema, verify, planImport };
}
export type AdaptedSource = ReturnType<typeof adaptedSource>;
