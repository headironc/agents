// Contract subject: `upstream-pr`.
// Scheduled source preparation and PR publication; never assesses, approves, merges or installs.
import { readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { modernWebUpdate, prepareModernWeb } from "./upstream-modern-web.ts";
import { prepareRust, rustUpdate } from "./upstream-rust-api.ts";
import { preparePbt, pbtUpdate } from "./upstream-property-testing.ts";
import { microsoftRustUpdate } from "./microsoft-rust-source.ts";
import {
  publishPrepared,
  repository,
  repositoryId,
} from "./upstream-publish.ts";
import type { Api } from "./upstream-publish.ts";
export { changes } from "./upstream-modern-web.ts";
export type { UpdatePlan } from "./upstream-modern-web.ts";
export { repository, repositoryId } from "./upstream-publish.ts";
export type { Api } from "./upstream-publish.ts";

// Preserve the existing Modern Web entry for its successive-update regression tests.
export async function publish(root: string, input: unknown, api: Api) {
  return publishPrepared(modernWebUpdate(root, input), api);
}
export const sources = [
  "modern-web-guidance",
  "rust-api-guidelines",
  "property-based-testing",
  "microsoft-rust-guidelines",
] as const;
export function preparedUpdate(root: string, source: string, input: unknown) {
  if (source === "modern-web-guidance") return modernWebUpdate(root, input);
  if (source === "rust-api-guidelines") return rustUpdate(root, input);
  if (source === "property-based-testing") return pbtUpdate(root, input);
  if (source === "microsoft-rust-guidelines")
    return microsoftRustUpdate.update(root, input);
  throw new Error("Unknown upstream source");
}

async function main(): Promise<void> {
  const [mode, source, file] = process.argv.slice(2);
  if (
    process.argv.length !== 5 ||
    !file ||
    !["prepare", "publish"].includes(mode!) ||
    !sources.includes(source as (typeof sources)[number])
  )
    throw new Error(
      `Usage: upstream-pr.ts prepare|publish ${sources.join("|")} PLAN.json`,
    );
  const root = path.resolve(import.meta.dirname, "..");
  const base = z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .parse(process.env.GITHUB_SHA);
  if (
    process.env.GITHUB_REPOSITORY !== repository ||
    process.env.GITHUB_REPOSITORY_ID !== String(repositoryId) ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    !["schedule", "workflow_dispatch"].includes(
      process.env.GITHUB_EVENT_NAME ?? "",
    )
  )
    throw new Error("Only the bound main workflow may run");
  if (mode === "prepare") {
    const plan =
      source === "modern-web-guidance"
        ? await prepareModernWeb(root, base)
        : source === "rust-api-guidelines"
          ? await prepareRust(root, base)
          : source === "property-based-testing"
            ? await preparePbt(root, base)
            : await microsoftRustUpdate.prepare(root, base);
    preparedUpdate(root, source!, plan);
    writeFileSync(file, JSON.stringify(plan), { mode: 0o600, flag: "wx" });
    console.log(`Prepared verified source: ${source}`);
    return;
  }
  const stat = statSync(file);
  if (!stat.isFile() || stat.size > 60 * 1024 * 1024)
    throw new Error("Invalid update plan file");
  const update = preparedUpdate(
    root,
    source!,
    JSON.parse(readFileSync(file, "utf8")),
  );
  if (update.base !== base)
    throw new Error("Plan belongs to another workflow candidate");
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("Missing workflow token");
  const api: Api = async (method, endpoint, body) => {
    const response = await fetch(`https://api.github.com${endpoint}`, {
      method,
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok)
      throw new Error(`GitHub ${method} failed: HTTP ${response.status}`);
    const result = (await response.json()) as any;
    if (result.errors) throw new Error("GitHub returned GraphQL errors");
    return result;
  };
  console.log(JSON.stringify(await publishPrepared(update, api)));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Upstream update failed",
    );
    process.exitCode = 1;
  });
