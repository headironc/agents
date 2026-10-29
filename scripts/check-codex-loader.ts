#!/usr/bin/env node
// Contract subject: `codex-cli-loader`.
// Contract subject: `codex-cli`.
// Exercise Codex's prompt loader against the installer's published layout without a model call.
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { layOutPublished } from "./check-refs.ts";
import { publicMembers } from "./delivery.ts";
import { readSkillEntries, selectSkillEntries } from "./skills.ts";

const root = path.resolve(import.meta.dirname, "..");

type LoaderResult = {
  error?: Error;
  status: number | null;
  signal: NodeJS.Signals | null;
  stderr: string | null;
};

export function loaderFailure(result: LoaderResult): Error {
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  const diagnostic = stderr.length > 2048 ? `…${stderr.slice(-2048)}` : stderr;
  const details = [
    `status=${result.status ?? "none"}`,
    `signal=${result.signal ?? "none"}`,
    ...(diagnostic ? [`stderr=${JSON.stringify(diagnostic)}`] : []),
  ];
  return new Error(`Codex prompt loader failed (${details.join(", ")})`, {
    cause: result.error,
  });
}

export function checkCodexLoader(
  directory = root,
  toolsRoot = directory,
): void {
  const root = directory;
  const entries = selectSkillEntries(readSkillEntries(root), "codex");
  const temporary = mkdtempSync(path.join(os.tmpdir(), "agents-codex-loader-"));
  try {
    const codexHome = path.join(temporary, "codex");
    const project = path.join(temporary, "project");
    mkdirSync(codexHome);
    mkdirSync(project);
    layOutPublished(root, publicMembers(entries, "codex"), codexHome);

    const result = spawnSync(
      process.execPath,
      [
        path.join(toolsRoot, "node_modules/@openai/codex/bin/codex.js"),
        "debug",
        "prompt-input",
        "Inspect the installed instructions and skill catalog.",
      ],
      {
        cwd: project,
        env: {
          HOME: temporary,
          CODEX_HOME: codexHome,
          PATH: process.env.PATH ?? "",
        },
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    if (result.error || result.status !== 0) throw loaderFailure(result);
    let messages: unknown;
    try {
      messages = JSON.parse(result.stdout);
    } catch (cause) {
      throw new Error("Codex prompt loader returned invalid JSON", { cause });
    }
    if (!Array.isArray(messages))
      throw new Error("Codex prompt loader returned invalid messages");
    const content = messages.flatMap((message) =>
      typeof message === "object" &&
      message !== null &&
      Array.isArray(message.content)
        ? message.content
            .filter(
              (part: unknown) =>
                typeof part === "object" &&
                part !== null &&
                "text" in part &&
                typeof part.text === "string",
            )
            .map((part: { text: string }) => part.text)
        : [],
    );
    const prompt = content.join("\n");
    const instructions = readFileSync(
      path.join(codexHome, "AGENTS.md"),
      "utf8",
    );
    if (!prompt.includes(instructions))
      throw new Error("Codex did not load the delivered AGENTS.md");
    const modelPolicy = "policy/models.md";
    if (!instructions.includes(`](${modelPolicy})`))
      throw new Error("Codex instructions do not reference the model policy");
    for (const section of [
      "workspaces",
      "task-temporary-directories",
      "task-completion-and-chat-archival",
    ]) {
      if (!instructions.includes(`](${modelPolicy}#${section})`))
        throw new Error(`Codex instructions lack lifecycle route: ${section}`);
    }
    const mergeCleanup =
      "skills/gh/references/operations.md#post-merge-cleanup";
    if (!instructions.includes(`](${mergeCleanup})`))
      throw new Error(
        "Codex instructions lack lifecycle route: post-merge-cleanup",
      );
    if (
      !readFileSync(path.join(codexHome, modelPolicy)).equals(
        readFileSync(path.join(root, "delivery", modelPolicy)),
      )
    )
      throw new Error("The model policy differs in the installed layout");
    if (
      !prompt.includes(
        `- \`r0\` = \`${path.join(realpathSync(codexHome), "skills")}\``,
      )
    )
      throw new Error("Codex skill catalog is not rooted in the candidate");
    for (const entry of entries) {
      const name = path.posix.basename(entry.path);
      const descriptor = `(file: r0/${entry.path}/SKILL.md)`;
      if (!prompt.includes(`- ${name}:`) || !prompt.includes(descriptor))
        throw new Error(`Codex did not load delivered skill: ${entry.path}`);
    }
    console.log(
      `Codex loaded AGENTS.md and ${entries.length} delivered skills; model policy is available on demand`,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  checkCodexLoader();
