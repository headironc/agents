import { z } from "zod";
import { SourceIdentitySchema } from "./source.ts";

const commit = z.string().regex(/^[a-f0-9]{40}$/);
const positiveId = z.string().regex(/^[1-9][0-9]*$/);
// These are supervisor observations. Admission must independently authenticate the run and artifact.
export const CiExecutionSchema = z.strictObject({
  executions: z.array(
    z.strictObject({
      name: z.string().min(1),
      argv: z.array(z.string()).min(1),
      cwd: z.string().min(1),
      environment: z.record(z.string(), z.string()),
    }),
  ),
  release: z.strictObject({
    commit,
    tree: commit,
    lock: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  run: z.strictObject({
    repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    repositoryId: positiveId,
    id: positiveId,
    attempt: positiveId,
    job: z.string().min(1),
    workflowRef: z.string().min(1),
    workflowSha: commit,
  }),
  candidate: z.discriminatedUnion("event", [
    z.strictObject({
      event: z.literal("pull_request_target"),
      base: commit,
      head: commit,
      integration: commit,
      tree: commit,
    }),
    z.strictObject({ event: z.literal("push"), commit, tree: commit }),
  ]),
});

const CheckResultSchema = z.strictObject({
  name: z.string().min(1),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  durationMs: z.number().nonnegative(),
  diagnostic: z.string(),
  passed: z.boolean(),
});
export const CheckReportSchema = z
  .strictObject({
    version: z.literal(1),
    source: SourceIdentitySchema.nullable(),
    checker: z.string().regex(/^[a-f0-9]{64}$/),
    groups: z.array(z.enum(["repository", "ci", "docs"])).min(1),
    planned: z.array(z.string().min(1)),
    results: z.array(CheckResultSchema),
    tools: z.record(z.string(), z.string()),
    platform: z.strictObject({
      os: z.string(),
      arch: z.string(),
      node: z.string(),
    }),
    errors: z.array(z.string()),
    passed: z.boolean(),
    ci: CiExecutionSchema.optional(),
  })
  .superRefine((report, context) => {
    if (
      report.ci &&
      (report.ci.executions.length !== report.results.length ||
        report.ci.executions.some(
          (execution, index) => execution.name !== report.results[index]?.name,
        ))
    )
      context.addIssue({
        code: "custom",
        message: "CI results require the actual settled command inputs",
      });
    if (
      report.ci &&
      report.source?.baseline !==
        (report.ci.candidate.event === "pull_request_target"
          ? report.ci.candidate.integration
          : report.ci.candidate.commit)
    )
      context.addIssue({
        code: "custom",
        message: "CI execution and source identity differ",
      });
    if (
      report.passed &&
      (report.source === null ||
        report.errors.length !== 0 ||
        report.planned.length === 0 ||
        new Set(report.planned).size !== report.planned.length ||
        report.results.length !== report.planned.length ||
        report.results.some(
          (result, index) =>
            result.name !== report.planned[index] ||
            !result.passed ||
            result.exitCode !== 0 ||
            result.signal !== null,
        ))
    ) {
      context.addIssue({
        code: "custom",
        message: "A passing report requires complete successful coverage",
      });
    }
  });
export type CheckReportV1 = z.infer<typeof CheckReportSchema>;
export type CheckResult = z.infer<typeof CheckResultSchema>;
