import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { load } from "js-yaml";

const root = path.resolve(import.meta.dirname, "../..");
const bun = path.join(root, ".cache/agents-tools/bin/bun");

/**
 * The TOML members of the capability category.
 *
 * The whole category exists to be merged by hand into a product's or a project's own configuration.
 * A fragment that does not parse fails at that one step, which is the only thing this category
 * delivers.
 *
 * TOML goes through the pinned Bun rather than a parser written here, because the repository does
 * not build parsers and Bun is already pinned for the bundler.
 */
const fragments = [
  "delivery/capability/codex.toml",
  "delivery/capability/rust-lints.toml",
];

/**
 * Parses TOML text through the pinned Bun's `Bun.TOML.parse` and reports what it read. A nonzero
 * exit is the rejection, checked against text the reader must accept and text it must reject.
 *
 * The parser is Bun's because this repository does not write parsers and Bun is already pinned for
 * the bundler. `Bun.TOML.parse` rather than importing the file as a module: an import resolves a
 * path and goes through the module cache, and reports a module-loading failure where this wants a
 * parse failure. Taking text rather than a path also removes the temporary files the probes needed.
 *
 * The keys come back from the parse rather than being split out of the text here. The parser has
 * already decided what the keys are, and deriving them a second time by hand would be the parsing
 * this repository does not write.
 */
function parseToml(body: string): {
  status: number | null;
  stderr: string;
  keys: string[];
} {
  const script =
    "console.log(JSON.stringify(Object.keys(Bun.TOML.parse(await Bun.stdin.text()))))";
  const result = spawnSync(bun, ["-e", script], {
    cwd: root,
    input: body,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.ifError(result.error);
  const keys =
    result.status === 0 ? (JSON.parse(result.stdout.trim()) as string[]) : [];
  return { status: result.status, stderr: result.stderr, keys };
}

for (const fragment of fragments)
  test(`${fragment} parses`, () => {
    const body = readFileSync(path.join(root, fragment), "utf8");
    const result = parseToml(body);
    assert.equal(
      result.status,
      0,
      `${fragment} is not valid TOML: ${result.stderr.trim()}`,
    );
  });

test("delivery/capability/codex.toml's commented recommendations parse once uncommented", () => {
  // Every line of that file is a comment, so parsing it as written reads an empty document and
  // cannot fail whatever those lines say. Measured: `# sandbox_mode = workspace-write` — invalid
  // the moment it is uncommented — passed the whole gate. Adoption is uncommenting them, per the
  // file's own text, so those are the bytes that have to reach the parser.
  const body = readFileSync(
    path.join(root, "delivery/capability/codex.toml"),
    "utf8",
  );
  const recommended = body
    .split("\n")
    .filter((line) => /^#\s*(?:\[[a-z0-9_.-]+\]|[a-z_]+\s*=)/i.test(line))
    .map((line) => line.replace(/^#\s*/, ""));
  const result = parseToml(`${recommended.join("\n")}\n`);
  assert.equal(
    result.status,
    0,
    `the commented recommendations are not valid TOML: ${result.stderr.trim()}`,
  );
  // The keys the README tells a reader to merge, as the parser read them. Asserting them catches a
  // future edit that silently drops a recommended key.
  assert.deepEqual([...result.keys].sort(), [
    "approval_policy",
    "mcp_servers",
    "sandbox_mode",
  ]);
  const fullParsed = spawnSync(
    bun,
    [
      "-e",
      "const parsed = Bun.TOML.parse(await Bun.stdin.text()); console.log(JSON.stringify(parsed.mcp_servers));",
    ],
    {
      cwd: root,
      input: `${recommended.join("\n")}\n`,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.equal(fullParsed.status, 0, fullParsed.stderr.trim());
  assert.deepEqual(JSON.parse(fullParsed.stdout.trim()), {
    "wx-docs": { url: "https://developers.weixin.qq.com/doc/mcp" },
    sketch: {
      url: "http://localhost:31126/mcp",
      tools: {
        run_code: { approval_mode: "prompt" },
        save_comment: { approval_mode: "prompt" },
        delete_comment: { approval_mode: "prompt" },
      },
    },
    "chrome-devtools": {
      command: "npx",
      args: [
        "-y",
        "chrome-devtools-mcp@1.13.0",
        "--no-usage-statistics",
        "--no-performance-crux",
      ],
    },
    gcloud: {
      command: "npx",
      args: ["-y", "@google-cloud/gcloud-mcp@0.5.3"],
      tools: {
        run_gcloud_command: { approval_mode: "prompt" },
      },
    },
    "google-observability": {
      command: "npx",
      args: ["-y", "@google-cloud/observability-mcp@0.2.3"],
    },
    "google-storage": {
      command: "npx",
      args: ["-y", "@google-cloud/storage-mcp@0.6.0"],
      tools: {
        create_bucket: { approval_mode: "prompt" },
        write_object_new: { approval_mode: "prompt" },
        upload_object_new: { approval_mode: "prompt" },
        copy_object_new: { approval_mode: "prompt" },
      },
    },
    "developer-knowledge": {
      url: "https://developerknowledge.googleapis.com/mcp",
      env_http_headers: {
        "X-Goog-Api-Key": "DEVELOPERKNOWLEDGE_API_KEY",
      },
    },
  });
});

test("delivery/capability MCP JSON fragments parse with expected zero-secret definitions", () => {
  const readJson = (name: string) =>
    JSON.parse(
      readFileSync(path.join(root, "delivery/capability", name), "utf8"),
    );
  assert.deepEqual(readJson("wx-docs.mcp.json"), {
    mcpServers: {
      "wx-docs": { url: "https://developers.weixin.qq.com/doc/mcp" },
    },
  });
  assert.deepEqual(readJson("sketch.mcp.json"), {
    mcpServers: {
      sketch: { url: "http://localhost:31126/mcp" },
    },
  });
  assert.deepEqual(readJson("chrome-devtools.mcp.json"), {
    mcpServers: {
      "chrome-devtools": {
        command: "npx",
        args: [
          "-y",
          "chrome-devtools-mcp@1.13.0",
          "--no-usage-statistics",
          "--no-performance-crux",
        ],
      },
    },
  });
  assert.deepEqual(readJson("gcloud.mcp.json"), {
    mcpServers: {
      gcloud: {
        command: "npx",
        args: ["-y", "@google-cloud/gcloud-mcp@0.5.3"],
      },
    },
  });
  assert.deepEqual(readJson("google-observability.mcp.json"), {
    mcpServers: {
      "google-observability": {
        command: "npx",
        args: ["-y", "@google-cloud/observability-mcp@0.2.3"],
      },
    },
  });
  const storageMcp = readJson("google-storage.mcp.json");
  assert.deepEqual(storageMcp, {
    mcpServers: {
      "google-storage": {
        command: "npx",
        args: ["-y", "@google-cloud/storage-mcp@0.6.0"],
      },
    },
  });
  assert.ok(
    !storageMcp.mcpServers["google-storage"].args.includes(
      "--enable-destructive-tools",
    ),
  );
  assert.deepEqual(readJson("google-developer-knowledge.mcp.json"), {
    mcpServers: {
      "developer-knowledge": {
        url: "https://developerknowledge.googleapis.com/mcp",
        authProviderType: "google_credentials",
      },
    },
  });
  const denylist = readJson("gcloud-mcp-denylist.json") as {
    allow?: unknown;
    deny: string[];
  };
  assert.equal(denylist.allow, undefined);
  assert.ok(Array.isArray(denylist.deny) && denylist.deny.length > 0);
  assert.deepEqual(
    [...new Set(denylist.deny)].sort(),
    denylist.deny,
    "gcloud-mcp-denylist.json entries must be unique and sorted",
  );
  assert.ok(
    denylist.deny.every((item) => !item.includes("*")),
    "gcloud-mcp prefix matcher must not contain glob wildcards",
  );
  assert.ok(
    denylist.deny.every((item) => !/^gcloud\b/i.test(item.trim())),
    "gcloud-mcp lints command strings without the leading gcloud binary name",
  );

  // Mirror @google-cloud/gcloud-mcp denyCommands prefix normalization and release-track matching.
  const normalizeGcloud = (value: string) =>
    `${value.toLowerCase().trim()} `;
  const isDenied = (parsedCommand: string) => {
    const cmd = normalizeGcloud(parsedCommand);
    return denylist.deny.some((entry) =>
      ["", "alpha", "beta", "preview"].some((track) =>
        cmd.startsWith(normalizeGcloud(`${track} ${entry}`)),
      ),
    );
  };
  for (const blocked of [
    "projects add-iam-policy-binding my-proj",
    "beta projects add-iam-policy-binding my-proj",
    "alpha projects set-iam-policy my-proj policy.json",
    "projects remove-iam-policy-binding my-proj",
    "resource-manager folders add-iam-policy-binding 123",
    "resource-manager folders set-iam-policy 123 policy.json",
    "storage buckets add-iam-policy-binding gs://b",
    "storage buckets set-iam-policy gs://b p.json",
    "secrets add-iam-policy-binding s",
    "secrets set-iam-policy s p.json",
    "run services add-iam-policy-binding svc",
    "run jobs set-iam-policy job p.json",
    "functions add-iam-policy-binding fn",
    "functions add-invoker-policy-binding fn",
    "pubsub topics add-iam-policy-binding t",
    "pubsub subscriptions set-iam-policy s p.json",
    "artifacts repositories add-iam-policy-binding r",
    "compute instances set-iam-policy vm p.json",
    "iap web add-iam-policy-binding",
    "org-policies set-policy p.yaml",
    "services api-keys create",
    "iam service-accounts keys create k.json",
    "preview iam roles update r",
  ]) {
    assert.equal(isDenied(blocked), true, `Expected denylist to block: ${blocked}`);
  }
  for (const permitted of [
    "projects list",
    "projects describe my-proj",
    "projects get-iam-policy my-proj",
    "storage buckets describe gs://b",
    "storage buckets get-iam-policy gs://b",
    "secrets describe s",
    "run services describe svc",
    "compute instances list",
  ]) {
    assert.equal(
      isDenied(permitted),
      false,
      `Expected read-only command not to match denylist: ${permitted}`,
    );
  }
  assert.throws(() => JSON.parse("{invalid"), SyntaxError);
});

test("the readers used here reject a malformed file", () => {
  // Without this the cases above pass on any reader that never rejects anything, which is the
  // shape this repository keeps finding: a check present, running, and deciding nothing.
  assert.equal(
    parseToml("a = 1\n").status,
    0,
    "the TOML reader rejects text it should accept",
  );
  assert.notEqual(
    parseToml("a = = 1\n").status,
    0,
    "the TOML reader accepts text it should reject",
  );
  assert.throws(
    () => load("- id: [unclosed\n"),
    "the YAML reader accepts text it should reject",
  );
});

test("delivery/capability/dsh-headless.patch.yml parses as a secret-free Cordis patch list", () => {
  const body = readFileSync(
    path.join(root, "delivery/capability/dsh-headless.patch.yml"),
    "utf8",
  );
  const parsed = load(body);
  assert.equal(Array.isArray(parsed), true);
  assert.deepEqual(parsed, [
    { id: "credentials", disabled: false },
    { id: "authorization", disabled: false },
    { id: "deepseek-account", disabled: false },
    {
      id: "llm-pi-ai",
      name: "@deepseek-ai/dsh-llm-pi-ai",
      config: {
        providers: {
          "opencode-go": {
            apiKeyEnv: "OPENCODE_GO_API_KEY",
          },
        },
      },
    },
    {
      id: "agent-default-model",
      name: "@deepseek-ai/dsh-agent-default-model",
      config: {
        provider: "opencode-go",
        model: "deepseek-v4.1-flash",
        reasoningEffort: "low",
      },
    },
  ]);
});
