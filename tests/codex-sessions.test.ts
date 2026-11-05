import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";
import {
  AppServer,
  execute,
  OutcomeUnknown,
  Receipts,
  requestSchema,
} from "../scripts/codex-sessions.ts";

const coordinator = "01a1ab93-2999-7fe0-8553-37ecedc0f2b3";
const worker = "01a1ab94-2999-7fe0-8553-37ecedc0f2b3";
const requestId = "01a1ab95-2999-7fe0-8553-37ecedc0f2b3";
const nextId = "01a1ab96-2999-7fe0-8553-37ecedc0f2b3";
const context = {
  socket: "/tmp/existing.sock",
  cwd: "/work",
  coordinator,
  authorization: "Human source chat and turn",
};

function fixture(t: { after: (fn: () => void) => void }, nativeProject = true) {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "sessions-test-")),
  );
  chmodSync(root, 0o700);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const receipts = new Receipts(root);
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let active = false;
  let loaded = true;
  let failTurn = false;
  let name = "Worker";
  let archived = false;
  let firstInput: { turnId: string; item: object } | undefined;
  const rpc = async (method: string, raw?: object): Promise<unknown> => {
    const params = (raw ?? {}) as Record<string, unknown>;
    calls.push({ method, params });
    if (method === "thread/read")
      return {
        thread: {
          id: params.threadId,
          cwd: "/work",
          projectId: nativeProject ? "project" : null,
          parentThreadId: null,
          forkedFromId: null,
          name,
          status: {
            type:
              params.threadId === coordinator && !loaded
                ? "notLoaded"
                : params.threadId === worker && active
                  ? "active"
                  : "idle",
          },
        },
      };
    if (method === "thread/loaded/list")
      return { data: loaded ? [coordinator] : [] };
    if (method === "project/list")
      return {
        data: [{ id: "project", roots: [{ path: "/work" }] }],
        nextCursor: null,
      };
    if (method === "thread/start")
      return {
        thread: {
          id: worker,
          cwd: "/work",
          projectId: nativeProject ? "project" : null,
          parentThreadId: null,
          forkedFromId: null,
          status: { type: "idle" },
        },
      };
    if (method === "thread/name/set") {
      name = params.name as string;
      return {};
    }
    if (method === "turn/start") {
      if (!firstInput && params.threadId === worker)
        firstInput = {
          turnId: "actual-turn",
          item: {
            type: "functionCallOutput",
            ...(params.toolOutput as object),
          },
        };
      if (failTurn) throw new OutcomeUnknown("Connection lost after sending");
      return { turn: { id: "actual-turn", status: "inProgress" } };
    }
    if (method === "thread/resume") {
      loaded = true;
      return {
        thread: {
          id: params.threadId,
          cwd: "/work",
          projectId: nativeProject ? "project" : null,
          parentThreadId: null,
          forkedFromId: null,
          status: { type: "idle" },
        },
      };
    }
    if (method === "thread/items/list" && params.sortDirection === "asc")
      return { data: firstInput ? [firstInput] : [], nextCursor: null };
    if (method === "thread/items/list")
      return {
        data: [{ item: { type: "agentMessage", text: "ACTUAL_OUTPUT" } }],
        nextCursor: "older-page",
      };
    if (method === "thread/archive") {
      archived = true;
      return {};
    }
    if (method === "thread/list")
      return { data: archived ? [{ id: worker }] : [], nextCursor: null };
    throw new Error(`Unexpected method: ${method}`);
  };
  const run = (operation: object) =>
    execute(
      requestSchema.parse({ version: 1, context, operation }),
      receipts,
      rpc,
    );
  const create = () =>
    run({
      type: "create",
      requestId,
      title: "Worker",
      message: "Inspect the authorized work",
      sandbox: "read-only",
    });
  return {
    rpc,
    root,
    receipts,
    calls,
    run,
    create,
    setActive: () => {
      active = true;
    },
    unload: () => {
      loaded = false;
    },
    loseTurn: () => {
      failTurn = true;
    },
  };
}

test("creates an independent persistent worker and sends agent material without policy/model overrides", async (t) => {
  const f = fixture(t);
  const result = (await f.create()) as {
    receipt: { threadId: string; turnId: string };
  };
  assert.equal(result.receipt.threadId, worker);
  assert.equal(result.receipt.turnId, "actual-turn");
  const start = f.calls.find((c) => c.method === "thread/start")!.params;
  assert.equal(start.projectId, "project");
  assert.equal(start.sandbox, "read-only");
  for (const key of [
    "model",
    "approvalPolicy",
    "approvalsReviewer",
    "config",
    "parentThreadId",
  ])
    assert.equal(key in start, false);
  const turn = f.calls.find((c) => c.method === "turn/start")!.params;
  assert.deepEqual(turn.input, []);
  const output = turn.toolOutput as { output: string; retain: boolean };
  assert.equal(output.retain, true);
  assert.equal(JSON.parse(output.output).source, "agent");
  assert.equal(JSON.parse(output.output).requestId, requestId);
  assert.deepEqual(readdirSync(f.root), [`${requestId}.jsonl`]);
  await assert.rejects(f.create(), /EEXIST/);
  assert.equal(f.calls.filter((c) => c.method === "thread/start").length, 1);
});

test("rejects unowned threads, mismatched binding, unloaded coordinator and active archival before writes", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    f.run({ type: "read", threadId: worker }),
    /not a child/,
  );
  f.unload();
  await assert.rejects(f.create(), /not loaded/);
  assert.equal(
    f.calls.some((c) => c.method === "thread/start"),
    false,
  );
  const g = fixture(t);
  await g.create();
  g.setActive();
  await assert.rejects(
    g.run({
      type: "archive",
      requestId: nextId,
      threadId: worker,
      acceptance: "Accepted evidence",
    }),
    /idle/,
  );
  assert.equal(
    g.calls.some((c) => c.method === "thread/archive"),
    false,
  );
  await assert.rejects(
    execute(
      requestSchema.parse({
        version: 1,
        context: { ...context, authorization: "Another scope" },
        operation: { type: "read", threadId: worker },
      }),
      g.receipts,
      async () => ({
        thread: {
          id: coordinator,
          cwd: "/work",
          projectId: "project",
          parentThreadId: null,
          forkedFromId: null,
          status: { type: "idle" },
        },
      }),
    ),
    /not a child/,
  );
});

test("unknown delivery retains exact target and lock; recover reads without replaying", async (t) => {
  const f = fixture(t);
  f.loseTurn();
  await assert.rejects(f.create(), OutcomeUnknown);
  assert.equal(f.receipts.read(requestId).threadId, worker);
  assert.equal(f.receipts.read(requestId).stage, "needs-readback");
  assert.equal(
    readFileSync(path.join(f.root, `${coordinator}.lock`), "utf8"),
    requestId,
  );
  const count = f.calls.length;
  const recovered = (await f.run({ type: "recover", requestId })) as {
    items: object;
  };
  assert.ok(recovered.items);
  assert.ok(
    f.calls
      .slice(count)
      .every((c) => ["thread/read", "thread/items/list"].includes(c.method)),
  );
  await assert.rejects(
    f.run({
      type: "create",
      requestId: nextId,
      title: "Duplicate",
      message: "Do not repeat",
      sandbox: "read-only",
    }),
    /EEXIST/,
  );
  assert.equal(f.calls.filter((c) => c.method === "thread/start").length, 1);
});

test("an unresolved create also prevents a new write to its known child", async (t) => {
  const f = fixture(t);
  f.loseTurn();
  await assert.rejects(f.create(), OutcomeUnknown);
  await assert.rejects(
    f.run({
      type: "send",
      requestId: nextId,
      threadId: worker,
      message: "Continue",
    }),
    /creation is unresolved/,
  );
  assert.equal(f.calls.filter((c) => c.method === "turn/start").length, 1);
  assert.deepEqual(
    readdirSync(f.root).sort(),
    [`${coordinator}.lock`, `${requestId}.jsonl`].sort(),
  );
  await f.run({ type: "recover", requestId });
  // The original owner has read the terminal result before removing its exact creation lock.
  unlinkSync(path.join(f.root, `${coordinator}.lock`));
  await assert.rejects(
    f.run({
      type: "send",
      requestId: nextId,
      threadId: worker,
      message: "Continue",
    }),
    OutcomeUnknown,
  );
  assert.equal(f.calls.filter((c) => c.method === "turn/start").length, 2);
});

test("failed post-submit readback retains the creation lock for its known child", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    execute(
      requestSchema.parse({
        version: 1,
        context,
        operation: {
          type: "create",
          requestId,
          title: "Worker",
          message: "Bounded work",
          sandbox: "read-only",
        },
      }),
      f.receipts,
      async (method, params) => {
        if (
          method === "thread/read" &&
          (params as { threadId: string }).threadId === worker
        )
          throw new OutcomeUnknown("Readback connection lost");
        return f.rpc(method, params);
      },
    ),
    OutcomeUnknown,
  );
  assert.equal(f.receipts.read(requestId).stage, "needs-readback");
  assert.equal(
    readFileSync(path.join(f.root, `${coordinator}.lock`), "utf8"),
    requestId,
  );
  await assert.rejects(
    f.run({
      type: "send",
      requestId: nextId,
      threadId: worker,
      message: "Continue",
    }),
    /creation is unresolved/,
  );
  assert.equal(f.calls.filter((c) => c.method === "turn/start").length, 1);
});

test("rename and archive recheck idle state after obtaining their target lock", async (t) => {
  for (const type of ["rename", "archive"] as const) {
    const f = fixture(t);
    await f.create();
    let interleaved = false;
    const rpc = async (method: string, params?: object) => {
      const result = await f.rpc(method, params);
      if (
        !interleaved &&
        method === "thread/read" &&
        (params as { threadId: string }).threadId === worker
      ) {
        interleaved = true;
        await f.run({
          type: "send",
          requestId: nextId,
          threadId: worker,
          message: "New work",
        });
        f.setActive();
      }
      return result;
    };
    await assert.rejects(
      execute(
        requestSchema.parse({
          version: 1,
          context,
          operation: {
            type,
            requestId: "01a1ab97-2999-7fe0-8553-37ecedc0f2b3",
            threadId: worker,
            ...(type === "rename"
              ? { title: "Accepted" }
              : { acceptance: "Prior result" }),
          },
        }),
        f.receipts,
        rpc,
      ),
      /must be idle/,
    );
    assert.equal(interleaved, true);
    assert.equal(
      f.calls.filter((c) => c.method === "thread/archive").length,
      0,
    );
    assert.equal(
      f.calls.filter((c) => c.method === "thread/name/set").length,
      1,
    );
    assert.equal(
      readdirSync(f.root).some((name) => name.endsWith(".lock")),
      false,
    );
  }
});

test("uppercase UUID inputs remain discoverable through create, list and read", async (t) => {
  const f = fixture(t);
  const request = requestSchema.parse({
    version: 1,
    context: { ...context, coordinator: coordinator.toUpperCase() },
    operation: {
      type: "create",
      requestId: requestId.toUpperCase(),
      title: "Worker",
      message: "Bounded work",
      sandbox: "read-only",
    },
  });
  await execute(request, f.receipts, f.rpc);
  assert.equal(f.receipts.read(requestId.toUpperCase()).requestId, requestId);
  const listed = (await f.run({ type: "list" })) as {
    threads: { id: string }[];
  };
  assert.deepEqual(
    listed.threads.map((thread) => thread.id),
    [worker],
  );
  await f.run({ type: "read", threadId: worker.toUpperCase() });
  assert.equal(f.calls.at(-1)!.params.threadId, worker);
});

test("read pages actual items; continue preserves runtime settings; rename/archive read back the result", async (t) => {
  const f = fixture(t);
  await f.create();
  await f.run({ type: "read", threadId: worker, cursor: "older-page" });
  assert.equal(f.calls.at(-1)!.params.cursor, "older-page");
  await f.run({
    type: "send",
    requestId: nextId,
    threadId: worker,
    message: "Continue within scope",
  });
  assert.deepEqual(f.calls.find((c) => c.method === "thread/resume")!.params, {
    threadId: worker,
    excludeTurns: true,
  });
  await f.run({
    type: "rename",
    requestId: "01a1ab97-2999-7fe0-8553-37ecedc0f2b3",
    threadId: worker,
    title: "Accepted worker",
  });
  await f.run({
    type: "archive",
    requestId: "01a1ab98-2999-7fe0-8553-37ecedc0f2b3",
    threadId: worker,
    acceptance: "Exact accepted result",
  });
  assert.equal(f.calls.at(-1)!.method, "thread/list");
  assert.equal(f.calls.at(-1)!.params.archived, true);
});

test("a report wakes only the bound unloaded coordinator and retains agent provenance", async (t) => {
  const f = fixture(t);
  f.unload();
  await f.run({
    type: "send",
    requestId,
    threadId: coordinator,
    message: "Mac reports the accepted result",
  });
  const resumed = f.calls.find((c) => c.method === "thread/resume")!;
  assert.deepEqual(resumed.params, {
    threadId: coordinator,
    excludeTurns: true,
  });
  assert.equal(
    f.calls.filter((c) => c.method === "thread/loaded/list").length,
    2,
  );
  const turn = f.calls.find((c) => c.method === "turn/start")!.params;
  assert.deepEqual(turn.input, []);
  assert.equal(
    JSON.parse((turn.toolOutput as { output: string }).output).source,
    "agent",
  );
  assert.equal(
    f.calls.some((c) => c.method === "thread/start"),
    false,
  );
  const g = fixture(t);
  g.unload();
  await assert.rejects(
    execute(
      requestSchema.parse({
        version: 1,
        context,
        operation: {
          type: "send",
          requestId,
          threadId: coordinator,
          message: "Report",
        },
      }),
      g.receipts,
      async (method, params) =>
        method === "thread/resume"
          ? {
              thread: {
                id: worker,
                cwd: "/work",
                projectId: "project",
                parentThreadId: null,
                forkedFromId: null,
                status: { type: "idle" },
              },
            }
          : g.rpc(method, params),
    ),
    /does not match/,
  );
  assert.equal(
    g.calls.some((c) => c.method === "turn/start"),
    false,
  );
  assert.equal(g.receipts.read(requestId).stage, "needs-readback");
});

test("copied lineage cannot reuse a retained input as independent child provenance", async (t) => {
  const f = fixture(t);
  await f.create();
  await assert.rejects(
    execute(
      requestSchema.parse({
        version: 1,
        context,
        operation: { type: "read", threadId: worker },
      }),
      f.receipts,
      async (method, params) => {
        const result = await f.rpc(method, params);
        if (
          method === "thread/read" &&
          (params as { threadId: string }).threadId === worker
        ) {
          const response = result as { thread: object };
          return { thread: { ...response.thread, forkedFromId: coordinator } };
        }
        return result;
      },
    ),
    /copied lineage/,
  );
});

test("a retained input from another coordinator cannot authenticate a local receipt", async (t) => {
  const f = fixture(t);
  await f.create();
  await assert.rejects(
    execute(
      requestSchema.parse({
        version: 1,
        context,
        operation: { type: "read", threadId: worker },
      }),
      f.receipts,
      async (method, params) => {
        if (
          method === "thread/items/list" &&
          (params as { sortDirection: string }).sortDirection === "asc"
        )
          return {
            data: [
              {
                turnId: "actual-turn",
                item: {
                  type: "functionCallOutput",
                  name: "agents_coordination",
                  namespace: null,
                  output: JSON.stringify({
                    source: "agent",
                    coordinator: worker,
                    authorizationReference: context.authorization,
                    requestId,
                  }),
                },
              },
            ],
          };
        return f.rpc(method, params);
      },
    ),
    /Server provenance/,
  );
});

test("preserves absent native Project without importing one or confusing App grouping", async (t) => {
  const f = fixture(t, false);
  await f.create();
  assert.equal(
    f.calls.some((c) => c.method === "project/list"),
    false,
  );
  assert.equal(
    "projectId" in f.calls.find((c) => c.method === "thread/start")!.params,
    false,
  );
  assert.equal(
    f.calls.some((c) =>
      ["project/create", "project/import"].includes(c.method),
    ),
    false,
  );
});

test("rejects unsafe request shapes and a shared receipt directory", (t) => {
  const f = fixture(t);
  assert.equal(
    requestSchema.safeParse({
      version: 1,
      context,
      operation: {
        type: "create",
        requestId,
        title: "No",
        message: "No",
        sandbox: "danger-full-access",
      },
    }).success,
    false,
  );
  assert.equal(
    requestSchema.safeParse({
      version: 1,
      context,
      operation: {
        type: "send",
        requestId,
        threadId: worker,
        message: "No",
        model: "override",
      },
    }).success,
    false,
  );
  chmodSync(f.root, 0o755);
  assert.throws(() => new Receipts(f.root), /0700/);
});

test(
  "uses WebSocket over an existing Unix socket; disconnect sends no lifecycle mutation",
  { timeout: 10_000 },
  async (t) => {
    const f = fixture(t);
    const server = createServer();
    const ws = new WebSocketServer({ server });
    const methods: string[] = [];
    ws.on("connection", (socket) =>
      socket.on("message", (bytes) => {
        const request = JSON.parse(bytes.toString());
        assert.ok(request.params && typeof request.params === "object");
        methods.push(request.method);
        if (request.id)
          socket.send(
            JSON.stringify({
              id: request.id,
              result:
                request.method === "initialize"
                  ? { userAgent: "fixture", codexHome: "/fixture" }
                  : { data: [] },
            }),
          );
      }),
    );
    server.listen(path.join(f.root, "control.sock"));
    await once(server, "listening");
    const client = new AppServer(path.join(f.root, "control.sock"));
    try {
      await client.initialize();
      await client.call("thread/loaded/list");
    } finally {
      client.close();
      await new Promise<void>((resolve) =>
        ws.close(() => server.close(() => resolve())),
      );
    }
    assert.deepEqual(methods, [
      "initialize",
      "initialized",
      "thread/loaded/list",
    ]);
  },
);

test(
  "socket paths reach the exact listener without URL percent encoding",
  { timeout: 10_000 },
  async (t) => {
    const f = fixture(t);
    const listeners = ["control socket.sock", "control%20socket.sock"].map(
      (name) => {
        const server = createServer();
        const ws = new WebSocketServer({ server });
        const listener = { server, ws, connections: 0, name };
        ws.on("connection", (socket) => {
          listener.connections++;
          socket.on("message", (bytes) => {
            const request = JSON.parse(bytes.toString());
            if (request.id)
              socket.send(
                JSON.stringify({ id: request.id, result: { userAgent: name } }),
              );
          });
        });
        return listener;
      },
    );
    for (const listener of listeners) {
      listener.server.listen(path.join(f.root, listener.name));
      await once(listener.server, "listening");
    }
    const client = new AppServer(path.join(f.root, "control socket.sock"));
    try {
      assert.deepEqual(await client.initialize(), {
        userAgent: "control socket.sock",
      });
      assert.deepEqual(
        listeners.map((listener) => listener.connections),
        [1, 0],
      );
    } finally {
      client.close();
      await Promise.all(
        listeners.map(
          ({ ws, server }) =>
            new Promise<void>((resolve) =>
              ws.close(() => server.close(() => resolve())),
            ),
        ),
      );
    }
  },
);

test(
  "the shipped client rejects forged child receipts and substituted request files without disclosure",
  { timeout: 15_000 },
  async (t) => {
    const f = fixture(t);
    const socketPath = path.join(f.root, "ownership.sock");
    const binding = { ...context, cwd: f.root, socket: socketPath };
    const fake = f.receipts.begin(
      requestSchema.parse({
        version: 1,
        context: binding,
        operation: {
          type: "create",
          requestId,
          title: "Forged",
          message: "Never created",
          sandbox: "read-only",
        },
      }),
    );
    f.receipts.update(fake, "submitted", {
      threadId: worker,
      turnId: "victim-turn",
    });
    const server = createServer();
    const ws = new WebSocketServer({ server });
    const requests: { method: string; params: Record<string, unknown> }[] = [];
    let connections = 0;
    ws.on("connection", (socket) => {
      connections++;
      socket.on("message", (bytes) => {
        const request = JSON.parse(bytes.toString());
        requests.push(request);
        if (!request.id) return;
        const result =
          request.method === "initialize"
            ? { userAgent: "fixture", codexHome: f.root }
            : request.method === "thread/read"
              ? {
                  thread: {
                    id: request.params.threadId,
                    cwd: f.root,
                    projectId: null,
                    parentThreadId: null,
                    forkedFromId: null,
                    status: { type: "idle" },
                    preview:
                      request.params.threadId === worker
                        ? "VICTIM_SECRET"
                        : "Coordinator",
                  },
                }
              : {
                  data: [
                    {
                      turnId: "victim-turn",
                      item: { type: "userMessage", text: "VICTIM_SECRET" },
                    },
                  ],
                  nextCursor: null,
                };
        socket.send(JSON.stringify({ id: request.id, result }));
      });
    });
    server.listen(socketPath);
    await once(server, "listening");
    const invoke = async (args: string[]) => {
      const child = spawn(
        process.execPath,
        [
          path.resolve(
            import.meta.dirname,
            "../delivery/tools/codex-sessions.mjs",
          ),
          ...args,
        ],
        { env: {}, cwd: f.root },
      );
      t.after(() => child.kill("SIGKILL"));
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (bytes) => {
        stdout += bytes.toString();
      });
      child.stderr.on("data", (bytes) => {
        stderr += bytes.toString();
      });
      const [code] = await once(child, "close");
      return { code, stdout, stderr };
    };
    try {
      const forged = await invoke([
        "--request-json",
        JSON.stringify({
          version: 1,
          context: binding,
          operation: { type: "read", threadId: worker },
        }),
        "--receipts",
        f.root,
      ]);
      assert.equal(forged.code, 1);
      assert.match(forged.stderr, /Server provenance/);
      assert.doesNotMatch(forged.stdout + forged.stderr, /VICTIM_SECRET/);
      assert.equal(
        requests.some(
          (r) => r.method === "thread/read" && r.params.threadId === worker,
        ),
        false,
      );
      assert.equal(
        requests.some(
          (r) =>
            r.method === "thread/items/list" &&
            r.params.sortDirection !== "asc",
        ),
        false,
      );
      const count = requests.length;
      const file = path.join(f.root, "approved.json");
      writeFileSync(
        file,
        JSON.stringify({
          version: 1,
          context: binding,
          operation: { type: "status" },
        }),
        { mode: 0o600 },
      );
      writeFileSync(
        file,
        JSON.stringify({
          version: 1,
          context: { ...binding, coordinator: worker },
          operation: { type: "read", threadId: worker },
        }),
      );
      const substituted = await invoke([
        "--request",
        file,
        "--receipts",
        f.root,
      ]);
      assert.equal(substituted.code, 1);
      assert.match(substituted.stderr, /Unknown option/);
      assert.doesNotMatch(
        substituted.stdout + substituted.stderr,
        /VICTIM_SECRET/,
      );
      assert.equal(requests.length, count);
      assert.equal(connections, 1);
    } finally {
      await new Promise<void>((resolve) =>
        ws.close(() => server.close(() => resolve())),
      );
    }
  },
);

test(
  "an interactive request disconnects without racing the owner's approval",
  { timeout: 10_000 },
  async (t) => {
    const f = fixture(t);
    const server = createServer();
    const ws = new WebSocketServer({ server });
    const received: Record<string, unknown>[] = [];
    ws.on("connection", (socket) =>
      socket.on("message", (bytes) => {
        const request = JSON.parse(bytes.toString());
        received.push(request);
        if (request.method === "initialize")
          socket.send(JSON.stringify({ id: request.id, result: {} }));
        if (request.method === "thread/read")
          socket.send(
            JSON.stringify({
              id: "approval",
              method: "item/commandExecution/requestApproval",
              params: { threadId: worker },
            }),
          );
      }),
    );
    server.listen(path.join(f.root, "approval.sock"));
    await once(server, "listening");
    const client = new AppServer(path.join(f.root, "approval.sock"));
    try {
      await client.initialize();
      await assert.rejects(
        client.call("thread/read", { threadId: worker }),
        OutcomeUnknown,
      );
    } finally {
      client.close();
      await new Promise<void>((resolve) =>
        ws.close(() => server.close(() => resolve())),
      );
    }
    assert.equal(
      received.some((message) => message.id === "approval"),
      false,
    );
  },
);
