import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const script = path.join(root, "skills/wechatide/scripts/call.sh");
const status = [
  "ClaudeCode",
  "check_wechatide_status",
  "--skill-version",
  "0.3.15",
];

function fixture(t, options = {}) {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "agents wechatide call "),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, "bin");
  mkdirSync(bin);
  const calls = path.join(directory, "calls");
  const write = (file, body) =>
    writeFileSync(file, `#!/bin/bash\n${body}`, { mode: 0o755 });
  write(
    path.join(bin, "uname"),
    `printf '%s\\n' "${options.platform ?? "Darwin"}"\n`,
  );
  write(
    path.join(bin, "id"),
    `printf 'unexpected id access\\n' >> "${calls}"; exit 9\n`,
  );
  write(
    path.join(bin, "security"),
    `printf 'unexpected keychain access\\n' >> "${calls}"; exit 44\n`,
  );
  if (options.cli !== "missing") {
    const macos = path.join(
      directory,
      options.cli === "unbound"
        ? "tools"
        : "WeChat DevTools.app/Contents/MacOS",
    );
    mkdirSync(macos, { recursive: true });
    const executable = path.join(macos, "wechatide");
    write(
      executable,
      `printf 'cli' >> "${calls}"; printf ' [%s]' "$@" >> "${calls}"; printf '\\n' >> "${calls}"
printf '%s\\n' '${options.stdout ?? '{"ok":true,"tool":"check_wechatide_status","result":{"loginExpired":false}}'}'
printf '%s' '${options.stderr ?? ""}' >&2
exit ${options.exit ?? 0}
`,
    );
    symlinkSync(executable, path.join(bin, "wechatide"));
  }
  return (args) => {
    const result = spawnSync("/bin/bash", [script, ...args], {
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: directory },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.ifError(result.error);
    const recorded = existsSync(calls)
      ? readFileSync(calls, "utf8").trim().split("\n")
      : [];
    assert.ok(
      recorded.every((call) => call.startsWith("cli ")),
      "the executor must not read the account or keychain",
    );
    assert.ok(
      recorded.every((call) => !call.includes("[--token")),
      "the executor must not inject a token",
    );
    return { ...result, calls: recorded };
  };
}

test("calls the bundled CLI without a token even when keychain access is unavailable", (t) => {
  const result = fixture(t)(status);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    '{"ok":true,"tool":"check_wechatide_status","result":{"loginExpired":false}}\n',
  );
  assert.deepEqual(result.calls, [
    `cli [-c] [ClaudeCode] [check_wechatide_status] [--skill-version] [0.3.15]`,
  ]);
});

for (const [name, args] of [
  [
    "a compiler page open",
    [
      "ClaudeCode",
      "simulator_open_page",
      "--project",
      "/work/app",
      "--page",
      "pages/index/index",
    ],
  ],
  [
    "a single-file compile",
    [
      "Codex",
      "compile_wxss",
      "--project",
      "/work/app",
      "--file-path",
      "pages/index/index.wxss",
    ],
  ],
])
  test(`runs ${name} without a token`, (t) => {
    const result = fixture(t)(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.calls.at(-1),
      `cli [-c] [${args[0]}] [${args[1]}] ${args
        .slice(2)
        .map((value) => `[${value}]`)
        .join(" ")}`,
    );
  });

test("runs a diagnostic operation with its grep pattern as one argument", (t) => {
  const result = fixture(t)([
    "ClaudeCode",
    "get_simulator_console",
    "--project",
    "/work/app",
    "--command",
    "grep -i error",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.calls.at(-1),
    `cli [-c] [ClaudeCode] [get_simulator_console] [--project] [/work/app] [--command] [grep -i error]`,
  );
});

for (const [name, args] of [
  [
    "a network filter",
    [
      "ClaudeCode",
      "get_simulator_network",
      "--project",
      "/work/app",
      "--command",
      "grep -n .",
    ],
  ],
  [
    "a screenshot",
    [
      "Codex",
      "simulator_screenshot",
      "--project",
      "/work/app",
      "--wait-for-selector",
      ".submit-btn",
    ],
  ],
  [
    "a cache clear",
    [
      "Codex",
      "debug_clear_cache",
      "--project",
      "/work/app",
      "--action",
      "cleanStorageCache",
    ],
  ],
])
  test(`runs ${name} without a token`, (t) => {
    const result = fixture(t)(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.calls.at(-1),
      `cli [-c] [${args[0]}] [${args[1]}] ${args
        .slice(2)
        .map((value) => `[${value}]`)
        .join(" ")}`,
    );
  });

for (const [name, args] of [
  [
    "a pushed phone preview",
    [
      "ClaudeCode",
      "auto_preview",
      "--project",
      "/work/app",
      "--page-path",
      "pages/index/index",
    ],
  ],
  [
    "a preview QR code",
    [
      "Codex",
      "create_preview_qrcode",
      "--project",
      "/work/app",
      "--qr-format",
      "window",
    ],
  ],
  [
    "a trial upload",
    [
      "ClaudeCode",
      "upload",
      "--project",
      "/work/app",
      "--upload-version",
      "1.0.0",
      "--desc",
      "first trial",
    ],
  ],
])
  test(`runs ${name} without a token`, (t) => {
    const result = fixture(t)(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.calls.at(-1),
      `cli [-c] [${args[0]}] [${args[1]}] ${args
        .slice(2)
        .map((value) => `[${value}]`)
        .join(" ")}`,
    );
  });

for (const [name, args] of [
  ["a project listing", ["ClaudeCode", "project_list", "--scope", "all"]],
  ["a project import", ["Codex", "project_import", "--project", "/work/app"]],
  [
    "a snippet share",
    ["ClaudeCode", "share_minicode", "--project", "/work/app"],
  ],
  [
    "a snippet import",
    [
      "Codex",
      "import_minicode",
      "--link",
      "https://developers.weixin.qq.com/s/example",
    ],
  ],
  [
    "a list removal",
    ["ClaudeCode", "project_remove", "--project", "/work/app"],
  ],
])
  test(`runs ${name} without a token`, (t) => {
    const result = fixture(t)(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.calls.at(-1),
      `cli [-c] [${args[0]}] [${args[1]}] ${args
        .slice(2)
        .map((value) => `[${value}]`)
        .join(" ")}`,
    );
  });

for (const [name, args] of [
  [
    "a page navigation",
    [
      "ClaudeCode",
      "automation_navigate",
      "--project",
      "/work/app",
      "--action",
      "navigateTo",
      "--url",
      "/pages/detail/detail?id=1",
      "--wait-for-selector",
      ".list",
    ],
  ],
  [
    "an element tap by selector",
    [
      "Codex",
      "automation_element_action",
      "--project",
      "/work/app",
      "--action",
      "tap",
      "--selector",
      ".submit-btn",
      "--wait-for-selector",
      ".submit-btn",
    ],
  ],
  [
    "an element tap by coordinates",
    [
      "ClaudeCode",
      "automation_element_action",
      "--project",
      "/work/app",
      "--action",
      "tap",
      "--x",
      "195",
      "--y",
      "471",
    ],
  ],
  [
    "a page data read",
    [
      "Codex",
      "automation_page_action",
      "--project",
      "/work/app",
      "--action",
      "getData",
      "--data-path",
      "list",
    ],
  ],
  [
    "a page scroll",
    [
      "ClaudeCode",
      "automation_viewport_action",
      "--project",
      "/work/app",
      "--action",
      "pageScrollTo",
      "--scroll-top",
      "600",
    ],
  ],
  [
    "a canvas tap in image space",
    [
      "Codex",
      "automation_game_action",
      "--project",
      "/work/app",
      "--action",
      "tap",
      "--x",
      "240",
      "--y",
      "680",
      "--coordinate-space",
      "image",
      "--image-width",
      "750",
      "--image-height",
      "1334",
    ],
  ],
  [
    "a runtime evaluation",
    [
      "ClaudeCode",
      "automation_evaluate",
      "--project",
      "/work/app",
      "--fn-source",
      "function() { return wx.getSystemInfoSync() }",
    ],
  ],
  [
    "a test account listing",
    [
      "Codex",
      "automation_testaccount",
      "--project",
      "/work/app",
      "--action",
      "list",
    ],
  ],
  [
    "a script generation",
    ["ClaudeCode", "automation_generate_script", "--include-failed", "false"],
  ],
])
  test(`runs ${name} without a token`, (t) => {
    const result = fixture(t)(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.calls.at(-1),
      `cli [-c] [${args[0]}] [${args[1]}] ${args
        .slice(2)
        .map((value) => `[${value}]`)
        .join(" ")}`,
    );
  });

for (const [name, args] of [
  [
    "an environment listing",
    ["ClaudeCode", "cloud_env_list", "--appid", "wx0000000000000000"],
  ],
  [
    "an environment listing resolved from a project",
    ["Codex", "cloud_env_list", "--project", "/work/app"],
  ],
  [
    "a cloud function listing",
    [
      "ClaudeCode",
      "cloud_fn_list",
      "--appid",
      "wx0000000000000000",
      "--env",
      "prod-1a2b",
    ],
  ],
  [
    "a cloud function detail read",
    [
      "Codex",
      "cloud_fn_info",
      "--appid",
      "wx0000000000000000",
      "--env",
      "prod-1a2b",
      "--names",
      "login,order",
    ],
  ],
  [
    "a full function deploy",
    [
      "ClaudeCode",
      "cloud_fn_deploy",
      "--appid",
      "wx0000000000000000",
      "--env",
      "prod-1a2b",
      "--path",
      "/work/app/cloudfunctions/login",
      "--remote-npm-install",
    ],
  ],
  [
    "an incremental function deploy",
    [
      "Codex",
      "cloud_fn_inc_deploy",
      "--appid",
      "wx0000000000000000",
      "--env",
      "prod-1a2b",
      "--path",
      "/work/app/cloudfunctions/login",
      "--file",
      "index.js",
    ],
  ],
  [
    "a collection structure read",
    [
      "ClaudeCode",
      "cloud_db_read_struct",
      "--appid",
      "wx0000000000000000",
      "--env",
      "prod-1a2b",
      "--action",
      "listCollections",
    ],
  ],
  [
    "a collection structure change",
    [
      "Codex",
      "cloud_db_write_struct",
      "--appid",
      "wx0000000000000000",
      "--env",
      "prod-1a2b",
      "--action",
      "createCollection",
      "--collection-name",
      "orders",
    ],
  ],
  [
    "a storage listing",
    [
      "ClaudeCode",
      "cloud_query_storage",
      "--appid",
      "wx0000000000000000",
      "--env",
      "prod-1a2b",
      "--action",
      "list",
      "--cloud-path",
      "files/",
    ],
  ],
  [
    "a storage directory delete",
    [
      "Codex",
      "cloud_manage_storage",
      "--appid",
      "wx0000000000000000",
      "--env",
      "prod-1a2b",
      "--action",
      "delete",
      "--cloud-path",
      "files/old/",
      "--is-directory",
    ],
  ],
  [
    "a message-push read without an environment",
    [
      "ClaudeCode",
      "cloud_query_msg_push",
      "--appid",
      "wx0000000000000000",
      "--action",
      "listSupportedEvents",
    ],
  ],
  [
    "a message-push subscription",
    [
      "Codex",
      "cloud_manage_msg_push",
      "--appid",
      "wx0000000000000000",
      "--env",
      "prod-1a2b",
      "--function-name",
      "onMessage",
      "--action",
      "subscribe",
      "--msg-type",
      "text",
    ],
  ],
  [
    "an explicitly disabled subscription",
    [
      "ClaudeCode",
      "cloud_manage_msg_push",
      "--appid",
      "wx0000000000000000",
      "--env",
      "prod-1a2b",
      "--function-name",
      "onMessage",
      "--action",
      "setEnable",
      "--enable",
      "false",
    ],
  ],
])
  test(`runs ${name} without a token`, (t) => {
    const result = fixture(t)(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.calls.at(-1),
      `cli [-c] [${args[0]}] [${args[1]}] ${args
        .slice(2)
        .map((value) => `[${value}]`)
        .join(" ")}`,
    );
  });

test("runs a cloud document read and a cloud document write through their JSON file flags", (t) => {
  const run = fixture(t);
  const read = run([
    "ClaudeCode",
    "cloud_db_read_doc",
    "--appid",
    "wx0000000000000000",
    "--env",
    "prod-1a2b",
    "--collection-name",
    "orders",
    "--query-file",
    "/work/query.json",
    "--sort-file",
    "/work/sort.json",
  ]);
  assert.equal(read.status, 0, read.stderr);
  assert.equal(
    read.calls.at(-1),
    `cli [-c] [ClaudeCode] [cloud_db_read_doc] [--appid] [wx0000000000000000] [--env] [prod-1a2b] [--collection-name] [orders] [--query-file] [/work/query.json] [--sort-file] [/work/sort.json]`,
  );
  const write = run([
    "Codex",
    "cloud_db_write_doc",
    "--appid",
    "wx0000000000000000",
    "--env",
    "prod-1a2b",
    "--action",
    "update",
    "--collection-name",
    "orders",
    "--query-file",
    "/work/query.json",
    "--update-file",
    "/work/update.json",
  ]);
  assert.equal(write.status, 0, write.stderr);
  assert.equal(
    write.calls.at(-1),
    `cli [-c] [Codex] [cloud_db_write_doc] [--appid] [wx0000000000000000] [--env] [prod-1a2b] [--action] [update] [--collection-name] [orders] [--query-file] [/work/query.json] [--update-file] [/work/update.json]`,
  );
});

test("allows the JSON file form for a page method call and refuses the literal array flag", (t) => {
  const run = fixture(t);
  const result = run([
    "Codex",
    "automation_page_action",
    "--project",
    "/work/app",
    "--action",
    "callMethod",
    "--method",
    "onLoad",
    "--args-file",
    "/work/args.json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.calls.at(-1),
    `cli [-c] [Codex] [automation_page_action] [--project] [/work/app] [--action] [callMethod] [--method] [onLoad] [--args-file] [/work/args.json]`,
  );
  const refused = run([
    "Codex",
    "automation_evaluate",
    "--project",
    "/work/app",
    "--fn-source",
    "function(a) { return a }",
    "--args",
    "[1]",
  ]);
  assert.equal(refused.status, 2);
  assert.equal(refused.stderr, "wechatide-call: reserved-option\n");
});

test("allows the JSON file form that replaces the refused array flag", (t) => {
  const result = fixture(t)([
    "Codex",
    "automation_wx_api",
    "--project",
    "/work/app",
    "--action",
    "mock",
    "--method",
    "wx.request",
    "--args-file",
    "/work/args.json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.calls.at(-1),
    `cli [-c] [Codex] [automation_wx_api] [--project] [/work/app] [--action] [mock] [--method] [wx.request] [--args-file] [/work/args.json]`,
  );
});

for (const errorType of ["MCP_TOKEN_AUTH_ERROR", "CLI_TOKEN_AUTH_ERROR"])
  test(`passes ${errorType} through once without fallback`, (t) => {
    const stdout = JSON.stringify({
      ok: false,
      errorType,
      reason: "fixture_auth_failure",
    });
    const stderr = "fixture CLI diagnostic\n";
    const result = fixture(t, { stdout, stderr, exit: 1 })([
      "Codex",
      "open_project_window",
      "--project",
      "/work/mini app",
    ]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, `${stdout}\n`);
    assert.equal(result.stderr, stderr);
    assert.deepEqual(result.calls, [
      "cli [-c] [Codex] [open_project_window] [--project] [/work/mini app]",
    ]);
  });

for (const result of [
  { cliTokenRequired: true, versionRelation: "equal" },
  { tokenRequired: true, versionRelation: "equal" },
  { versionRelation: "agent_behind" },
  { versionRelation: "skip_check" },
  { status: "pending", taskId: "fixture-authorization-1" },
])
  test(`preserves readiness or pending evidence without starting dependent work: ${JSON.stringify(result)}`, (t) => {
    const stdout = JSON.stringify({
      ok: true,
      tool: "check_wechatide_status",
      result,
    });
    const output = fixture(t, { stdout })(status);
    assert.equal(output.status, 0);
    assert.equal(output.stdout, `${stdout}\n`);
    assert.deepEqual(output.calls, [
      "cli [-c] [ClaudeCode] [check_wechatide_status] [--skill-version] [0.3.15]",
    ]);
  });

for (const [name, args, code] of [
  ["missing operation", ["ClaudeCode"], "usage"],
  [
    "unknown client",
    ["Cursor", "check_wechatide_status"],
    "unsupported-client",
  ],
  [
    "a CLI alias of a delivered operation",
    [
      "ClaudeCode",
      "miniprogram_upload",
      "--project",
      "/work/app",
      "--upload-version",
      "1.0.0",
    ],
    "undelivered-operation",
  ],
  [
    "a CloudBase MCP internal name",
    ["Codex", "queryMessagePush", "--appid", "wx0000000000000000"],
    "undelivered-operation",
  ],
  [
    "deprecated operation",
    ["Codex", "project_setting_update"],
    "undelivered-operation",
  ],
  ...[
    "simulator_get_device",
    "simulator_set_device",
    "simulator_set_darkmode",
    "simulator_popup",
  ].map((operation) => [
    operation,
    ["Codex", operation, "--project", "/work/app"],
    "undelivered-operation",
  ]),
  ["MCP bridge mode", ["ClaudeCode", "mcp"], "undelivered-operation"],
  [
    "caller token",
    ["ClaudeCode", "check_wechatide_status", "--token", "other"],
    "reserved-option",
  ],
  [
    "caller token assignment",
    ["ClaudeCode", "check_wechatide_status", "--token=other"],
    "reserved-option",
  ],
  [
    "second client",
    ["ClaudeCode", "get_user_appids", "-c", "Codex"],
    "reserved-option",
  ],
  [
    "attached second client",
    ["ClaudeCode", "get_user_appids", "--client-name=Codex"],
    "reserved-option",
  ],
  [
    "attached short client",
    ["ClaudeCode", "get_user_appids", "-cCodex"],
    "reserved-option",
  ],
  [
    "second tool",
    ["ClaudeCode", "get_user_appids", "--tool", "upload"],
    "reserved-option",
  ],
  [
    "attached second tool",
    ["ClaudeCode", "get_user_appids", "--tool=upload"],
    "reserved-option",
  ],
  [
    "attached tool arguments",
    ["ClaudeCode", "get_user_appids", "--args={}"],
    "reserved-option",
  ],
  [
    "bridge flag",
    ["Codex", "check_wechatide_status", "--mcp"],
    "reserved-option",
  ],
  [
    "attached bridge flag",
    ["Codex", "check_wechatide_status", "--mcp=1"],
    "reserved-option",
  ],
  [
    "authorization arguments",
    ["Codex", "auth", "--client-name", "Other"],
    "reserved-option",
  ],
  ["authorization extra argument", ["Codex", "auth", "extra"], "usage"],
])
  test(`refuses ${name} before any DevTools access`, (t) => {
    const result = fixture(t)(args);
    assert.equal(result.status, 2);
    assert.equal(result.stderr, `wechatide-call: ${code}\n`);
    assert.deepEqual(result.calls, []);
  });

for (const [name, options, code] of [
  ["non-macOS host", { platform: "Linux" }, "unsupported-platform"],
  ["missing CLI", { cli: "missing" }, "cli-unavailable"],
  ["CLI outside an application bundle", { cli: "unbound" }, "cli-unbound"],
])
  test(`stops on ${name} before contacting DevTools`, (t) => {
    const result = fixture(t, options)(status);
    assert.equal(result.status, 3);
    assert.equal(result.stderr, `wechatide-call: ${code}\n`);
    assert.deepEqual(result.calls, []);
  });

test("client authorization and local help preserve their fixed client and arguments", (t) => {
  const run = fixture(t);
  assert.equal(run(["Codex", "auth"]).status, 0);
  const help = run(["ClaudeCode", "open_project_window", "-h"]);
  assert.equal(help.status, 0);
  assert.deepEqual(help.calls, [
    "cli [auth] [-c] [Codex]",
    "cli [-c] [ClaudeCode] [open_project_window] [-h]",
  ]);
});
