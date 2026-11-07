import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, "..");
const SCRIPTS_DIR = path.join(SKILL_DIR, "scripts");

const SWIFT_MEASURE = path.join(SCRIPTS_DIR, "measure-coretext.swift");
const PY_MEASURE = path.join(SCRIPTS_DIR, "coretext_measure.py");
const PY_AUDIT = path.join(SCRIPTS_DIR, "sketch_offline_audit.py");
const PY_ROUNDTRIP = path.join(SCRIPTS_DIR, "sketch_mcp_roundtrip.py");
const PY_EXPORT = path.join(SCRIPTS_DIR, "sketch_export_manifest.py");

function runPython(scriptPath, args, options = {}) {
  return spawnSync("python3", [scriptPath, ...args], {
    encoding: "utf8",
    timeout: 60000,
    ...options,
  });
}

function runPythonAsync(scriptPath, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [scriptPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

function buildSyntheticSketch(sketchPath, builderPath) {
  const pyCode = `
import json, sys, zipfile
from pathlib import Path

spec = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
out_path = Path(sys.argv[2])
with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for member, content in spec.items():
        if isinstance(content, (dict, list)):
            zf.writestr(member, json.dumps(content, ensure_ascii=False, indent=2) + "\\n")
        else:
            zf.writestr(member, content.encode("latin-1"))
`;
  const res = spawnSync("python3", ["-c", pyCode, builderPath, sketchPath], {
    encoding: "utf8",
  });
  assert.equal(res.status, 0, res.stderr);
}

function createCleanSketchSpec({ textHeight = 44, hotspotY = 76 } = {}) {
  return {
    "meta.json": {
      commit: "b7ac3fd",
      version: 164,
      app: "com.bohemiancoding.sketch3",
      appVersion: "2026.3.1",
      build: 234013,
    },
    "document.json": {
      _class: "document",
      do_objectID: "10000000-0000-4000-8000-000000000001",
      sharedSwatches: {
        _class: "swatchContainer",
        do_objectID: "10000000-0000-4000-8000-000000000002",
        objects: [
          {
            _class: "swatch",
            do_objectID: "9C112233-4444-4555-8666-777788889999",
            name: "Brand/Primary",
            value: {
              _class: "color",
              alpha: 1,
              red: 0.12,
              green: 0.42,
              blue: 0.96,
            },
          },
        ],
      },
      layerStyles: {
        _class: "sharedStyleContainer",
        do_objectID: "10000000-0000-4000-8000-000000000003",
        objects: [],
      },
      layerTextStyles: {
        _class: "sharedTextStyleContainer",
        do_objectID: "10000000-0000-4000-8000-000000000004",
        objects: [],
      },
    },
    "pages/20000000-0000-4000-8000-000000000001.json": {
      _class: "page",
      do_objectID: "20000000-0000-4000-8000-000000000001",
      name: "Page 1",
      layers: [
        {
          _class: "symbolMaster",
          do_objectID: "30000000-0000-4000-8000-000000000001",
          symbolID: "30000000-0000-4000-8000-000000000099",
          name: "Button/Primary",
          frame: { _class: "rect", x: 0, y: 0, width: 311, height: 48 },
          layers: [
            {
              _class: "text",
              do_objectID: "30000000-0000-4000-8000-000000000002",
              name: "Label",
              textBehaviour: 0,
              frame: { _class: "rect", x: 16, y: 13, width: 279, height: 22 },
              attributedString: {
                _class: "attributedString",
                string: "立即认证",
                attributes: [
                  {
                    _class: "stringAttribute",
                    location: 0,
                    length: 4,
                    attributes: {
                      MSAttributedStringFontAttribute: {
                        _class: "fontDescriptor",
                        attributes: { name: "PingFangSC-Medium", size: 16 },
                      },
                      paragraphStyle: {
                        _class: "paragraphStyle",
                        minimumLineHeight: 22,
                        maximumLineHeight: 22,
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          _class: "artboard",
          do_objectID: "40000000-0000-4000-8000-000000000001",
          name: "Home",
          isFlowHome: true,
          frame: { _class: "rect", x: 0, y: 0, width: 375, height: 812 },
          layers: [
            {
              _class: "text",
              do_objectID: "40000000-0000-4000-8000-000000000002",
              name: "StatusBar/Time",
              textBehaviour: 0,
              frame: { _class: "rect", x: 24, y: 14, width: 54, height: 18 },
              attributedString: {
                _class: "attributedString",
                string: "9:41",
                attributes: [
                  {
                    _class: "stringAttribute",
                    location: 0,
                    length: 4,
                    attributes: {
                      MSAttributedStringFontAttribute: {
                        _class: "fontDescriptor",
                        attributes: {
                          NSCTFontUIUsageAttribute: "CTFontRegularUsage",
                          size: 14,
                        },
                      },
                    },
                  },
                ],
              },
            },
            {
              _class: "group",
              do_objectID: "40000000-0000-4000-8000-000000000003",
              name: "CardStack",
              clippingBehavior: 0,
              frame: {
                _class: "rect",
                x: 16,
                y: 80,
                width: 343,
                height: 16 + textHeight + 16 + 48 + 16,
              },
              groupLayout: {
                _class: "MSImmutableFlexGroupLayout",
                do_objectID: "40000000-0000-4000-8000-000000000004",
                flexDirection: 1,
                justifyContent: 0,
                alignItems: 0,
                allGuttersGap: 16,
                hasIndividualPadding: false,
                padding: 16,
                horizontalSizing: 0,
                verticalSizing: 1,
              },
              layers: [
                {
                  _class: "symbolInstance",
                  do_objectID: "40000000-0000-4000-8000-000000000005",
                  name: "SubmitButtonFocus",
                  hasFocusRing: true,
                  symbolID: "30000000-0000-4000-8000-000000000099",
                  frame: {
                    _class: "rect",
                    x: 16,
                    y: 16 + textHeight + 16,
                    width: 311,
                    height: 48,
                  },
                  style: {
                    _class: "style",
                    borders: [
                      {
                        _class: "border",
                        isEnabled: true,
                        position: 2,
                        thickness: 2,
                        color: {
                          _class: "color",
                          alpha: 1,
                          red: 0.12,
                          green: 0.42,
                          blue: 0.96,
                          swatchID: "9C112233-4444-4555-8666-777788889999",
                        },
                      },
                    ],
                  },
                  overrideValues: [
                    {
                      _class: "overrideValue",
                      do_objectID: "40000000-0000-4000-8000-000000000006",
                      overrideName:
                        "30000000-0000-4000-8000-000000000002_stringValue",
                      value: "立即认证",
                    },
                  ],
                },
                {
                  _class: "text",
                  do_objectID: "40000000-0000-4000-8000-000000000007",
                  name: "NoticeCopy",
                  textBehaviour: 1,
                  frame: {
                    _class: "rect",
                    x: 16,
                    y: 16,
                    width: 180,
                    height: textHeight,
                  },
                  attributedString: {
                    _class: "attributedString",
                    string: "账户安全验证已开启，请在五分钟内完成确认。",
                    attributes: [
                      {
                        _class: "stringAttribute",
                        location: 0,
                        length: 21,
                        attributes: {
                          MSAttributedStringFontAttribute: {
                            _class: "fontDescriptor",
                            attributes: {
                              name: "PingFangSC-Regular",
                              size: 15,
                            },
                          },
                          paragraphStyle: {
                            _class: "paragraphStyle",
                            minimumLineHeight: 22,
                            maximumLineHeight: 22,
                            paragraphSpacing: 0,
                          },
                        },
                      },
                    ],
                  },
                },
              ],
            },
            {
              _class: "MSImmutableHotspotLayer",
              do_objectID: "40000000-0000-4000-8000-000000000008",
              name: "HotSpot/Submit",
              frame: {
                _class: "rect",
                x: 32,
                y: 80 + hotspotY,
                width: 311,
                height: 48,
              },
              flow: {
                _class: "MSImmutableFlowConnection",
                do_objectID: "40000000-0000-4000-8000-000000000009",
                destinationArtboardID: "50000000-0000-4000-8000-000000000001",
                maintainScrollPosition: true,
              },
            },
          ],
        },
        {
          _class: "artboard",
          do_objectID: "50000000-0000-4000-8000-000000000001",
          name: "Detail",
          isFlowHome: false,
          frame: { _class: "rect", x: 440, y: 0, width: 375, height: 812 },
          layers: [
            {
              _class: "MSImmutableHotspotLayer",
              do_objectID: "50000000-0000-4000-8000-000000000002",
              name: "HotSpot/Back",
              frame: { _class: "rect", x: 16, y: 44, width: 48, height: 44 },
              flow: {
                _class: "MSImmutableFlowConnection",
                do_objectID: "50000000-0000-4000-8000-000000000003",
                destinationArtboardID: "back",
              },
            },
          ],
        },
      ],
    },
  };
}

test("all sketch-native scripts support --help and exit 0", () => {
  for (const script of [PY_MEASURE, PY_AUDIT, PY_ROUNDTRIP, PY_EXPORT]) {
    const res = runPython(script, ["--help"]);
    assert.equal(res.status, 0, `${script} --help failed: ${res.stderr}`);
    assert.match(res.stdout, /usage:/i);
  }
  const swiftRes = spawnSync("swift", [SWIFT_MEASURE, "--help"], {
    encoding: "utf8",
  });
  assert.equal(swiftRes.status, 0, swiftRes.stderr);
  assert.match(swiftRes.stdout, /Usage: measure-coretext\.swift/);
});

test("coretext_measure.py measures specs and re-bakes textBehaviour == 1 + Flex Stack + HotSpot", () => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "sketch-native-coretext-"),
  );
  try {
    const specsPath = path.join(tmpDir, "specs.json");
    fs.writeFileSync(
      specsPath,
      JSON.stringify([
        {
          id: "clock-1",
          text: "9:41",
          uiUsage: "CTFontRegularUsage",
          fontSize: 14,
          lineHeight: 18,
          width: 54,
        },
        {
          id: "body-1",
          text: "账户安全验证已开启，请在五分钟内完成确认。",
          fontName: "PingFangSC-Regular",
          fontSize: 15,
          lineHeight: 22,
          width: 180,
        },
      ]),
    );

    const measureRes = runPython(PY_MEASURE, ["--input", specsPath]);
    assert.equal(measureRes.status, 0, measureRes.stderr);
    const measured = JSON.parse(measureRes.stdout);
    assert.equal(measured.count, 2);
    assert.equal(measured.results[0].usedSystemUIFont, true);
    assert.equal(measured.results[0].bakedHeight, 18);
    assert.equal(measured.results[1].lineCount, 2);
    assert.equal(measured.results[1].bakedHeight, 44);

    // Create a .sketch with wrong 1-line text height (22 instead of 44) -> detect drift, then --rebake
    const driftedBuilder = path.join(tmpDir, "drifted-spec.json");
    const driftedSketch = path.join(tmpDir, "drifted.sketch");
    fs.writeFileSync(
      driftedBuilder,
      JSON.stringify(createCleanSketchSpec({ textHeight: 22, hotspotY: 54 })),
    );
    buildSyntheticSketch(driftedSketch, driftedBuilder);

    const auditDriftRes = runPython(PY_MEASURE, ["--sketch", driftedSketch]);
    assert.equal(
      auditDriftRes.status,
      1,
      "Expected exit code 1 when height drift exists",
    );
    const driftReport = JSON.parse(auditDriftRes.stdout);
    assert.equal(driftReport.passed, false);
    assert.equal(driftReport.driftCount, 1);
    assert.equal(driftReport.drifts[0].code, "NATIVE-LAYOUT-HOTSPOT-DESYNC");

    const rebakeRes = runPython(PY_MEASURE, [
      "--sketch",
      driftedSketch,
      "--rebake",
    ]);
    assert.equal(rebakeRes.status, 0, rebakeRes.stderr);
    const rebakeReport = JSON.parse(rebakeRes.stdout);
    assert.equal(rebakeReport.passed, true);
    assert.equal(rebakeReport.rebakedCount, 1);

    // Re-audit after rebake -> 0 drift, and offline structural audit passes
    const verifyAfterRebake = runPython(PY_MEASURE, [
      "--sketch",
      driftedSketch,
    ]);
    assert.equal(verifyAfterRebake.status, 0, verifyAfterRebake.stderr);
    const fullAuditAfterRebake = runPython(PY_AUDIT, [
      "--sketch",
      driftedSketch,
    ]);
    assert.equal(fullAuditAfterRebake.status, 0, fullAuditAfterRebake.stdout);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("sketch_offline_audit.py passes clean .sketch and catches blocking violations", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sketch-native-audit-"));
  try {
    const cleanBuilder = path.join(tmpDir, "clean-spec.json");
    const cleanSketch = path.join(tmpDir, "clean.sketch");
    fs.writeFileSync(
      cleanBuilder,
      JSON.stringify(createCleanSketchSpec({ textHeight: 44, hotspotY: 76 })),
    );
    buildSyntheticSketch(cleanSketch, cleanBuilder);

    const passRes = runPython(PY_AUDIT, ["--sketch", cleanSketch]);
    assert.equal(passRes.status, 0, passRes.stdout);
    const passReport = JSON.parse(passRes.stdout);
    assert.equal(passReport.passed, true);
    assert.equal(passReport.blockingCount, 0);
    assert.ok(passReport.elapsedMs < 1000);

    // Introduce blocking violations: hardcoded SFPro on clock, Noto font, start-artboard "back" trap, clipping ancestor
    const badSpec = createCleanSketchSpec({ textHeight: 44, hotspotY: 76 });
    const page = badSpec["pages/20000000-0000-4000-8000-000000000001.json"];
    const homeAb = page.layers[1];
    // 1. Hardcoded SFProText-Regular on status bar clock
    homeAb.layers[0].attributedString.attributes[0].attributes.MSAttributedStringFontAttribute.attributes =
      { name: "SFProText-Regular", size: 14 };
    // 2. Clipping ancestor on CardStack with Focus Ring child
    homeAb.layers[1].clippingBehavior = 1;
    // 3. Start artboard (isFlowHome: true) using "back" destination
    homeAb.layers[2].flow.destinationArtboardID = "back";

    const badBuilder = path.join(tmpDir, "bad-spec.json");
    const badSketch = path.join(tmpDir, "bad.sketch");
    fs.writeFileSync(badBuilder, JSON.stringify(badSpec));
    buildSyntheticSketch(badSketch, badBuilder);

    const failRes = runPython(PY_AUDIT, ["--sketch", badSketch]);
    assert.equal(failRes.status, 1);
    const failReport = JSON.parse(failRes.stdout);
    assert.equal(failReport.passed, false);
    const codes = new Set(failReport.findings.map((f) => f.code));
    assert.ok(codes.has("FONT-HARDCODED-SFPRO"));
    assert.ok(codes.has("CLOCK-MISSING-CTFONT-REGULAR-USAGE"));
    assert.ok(codes.has("FOCUS-RING-ANCESTOR-CLIPPED"));
    assert.ok(codes.has("FLOW-START-ARTBOARD-BACK-TRAP"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("sketch_mcp_roundtrip.py executes 6-step non-activating roundtrip with offline zip diff", async () => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "sketch-native-roundtrip-"),
  );
  const anchorId = "00000000-0000-4000-8000-000000000099";
  const workDocId = "10000000-0000-4000-8000-000000000001";
  const copySketch = path.join(tmpDir, "disposable-copy.sketch");
  const specPath = path.join(tmpDir, "clean-spec.json");
  fs.writeFileSync(
    specPath,
    JSON.stringify(createCleanSketchSpec({ textHeight: 44, hotspotY: 76 })),
  );
  buildSyntheticSketch(copySketch, specPath);

  // Create a mock `open` executable that records args and notifies the mock state file
  const stateFile = path.join(tmpDir, "mcp-state.json");
  fs.writeFileSync(
    stateFile,
    JSON.stringify({ workOpen: false, mutatedText: null, openCalls: [] }),
  );
  const mockOpenBin = path.join(tmpDir, "mock-open");
  fs.writeFileSync(
    mockOpenBin,
    `#!/usr/bin/env python3
import json, sys
from pathlib import Path
state_path = Path(${JSON.stringify(stateFile)})
state = json.loads(state_path.read_text(encoding="utf-8"))
state["openCalls"].append(sys.argv[1:])
state["workOpen"] = True
state_path.write_text(json.dumps(state), encoding="utf-8")
`,
    { mode: 0o755 },
  );

  // 1x1 PNG bytes for screenshot verification
  const pngBase64Pre =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
  const pngBase64Post =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPgPAAEDAQAIicLsAAAASUVORK5CYII=";

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const rpc = JSON.parse(body || "{}");
      if (rpc.method === "initialize") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Mcp-Session-Id": "session-test-1",
        });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpc.id,
            result: { protocolVersion: "2025-03-26", capabilities: {} },
          }),
        );
        return;
      }
      if (rpc.method === "notifications/initialized") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
        return;
      }
      const params = rpc.params || {};
      const toolName = params.name;
      const toolArgs = params.arguments || {};
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));

      if (toolName === "get_screenshot") {
        const imgData = state.mutatedText ? pngBase64Post : pngBase64Pre;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpc.id,
            result: {
              content: [
                { type: "image", data: imgData, mimeType: "image/png" },
              ],
            },
          }),
        );
        return;
      }

      if (toolName === "run_code") {
        const title = String(toolArgs.title || "");
        let replyObj = {};
        if (title.includes("precheck") || title.includes("final-slot-check")) {
          replyObj = {
            anchorId,
            anchorPresent: true,
            totalOpen: state.workOpen ? 2 : 1,
            matching: state.workOpen
              ? [{ id: workDocId, path: copySketch }]
              : [],
          };
        } else if (
          title.includes("wait-open") ||
          title.includes("wait-reopen")
        ) {
          replyObj = {
            ready: state.workOpen,
            docId: workDocId,
            pagesCount: 1,
          };
        } else if (title.includes("mutate-and-save")) {
          state.mutatedText = "立即认证（已更新）";
          fs.writeFileSync(stateFile, JSON.stringify(state));
          // Mutate only the targeted SymbolInstance override inside copySketch
          const pyMutate = `
import json, sys, zipfile
from pathlib import Path
p = Path(sys.argv[1])
with zipfile.ZipFile(p, "r") as zf:
    members = {n: zf.read(n) for n in zf.namelist()}
page_key = "pages/20000000-0000-4000-8000-000000000001.json"
page = json.loads(members[page_key].decode("utf-8"))
inst = page["layers"][1]["layers"][1]["layers"][0]
inst["overrideValues"][0]["value"] = "立即认证（已更新）"
members[page_key] = (json.dumps(page, ensure_ascii=False, indent=2) + "\\n").encode("utf-8")
with zipfile.ZipFile(p, "w", compression=zipfile.ZIP_DEFLATED) as zout:
    for n, raw in members.items():
        zout.writestr(n, raw)
`;
          spawnSync("python3", ["-c", pyMutate, copySketch]);
          replyObj = {
            ok: true,
            topCounts: {
              docId: workDocId,
              pagesCount: 1,
              pageTopLayerCounts: [
                {
                  id: "20000000-0000-4000-8000-000000000001",
                  name: "Page 1",
                  topLayers: 3,
                },
              ],
              swatchesCount: 1,
              sharedTextStylesCount: 0,
              sharedLayerStylesCount: 0,
            },
            applied: [
              {
                layerID: "40000000-0000-4000-8000-000000000005",
                name: "SubmitButtonFocus",
              },
            ],
          };
        } else if (title.includes("close")) {
          state.workOpen = false;
          fs.writeFileSync(stateFile, JSON.stringify(state));
          replyObj = { closed: true, remainingNonAnchor: [] };
        } else if (title.includes("readback")) {
          replyObj = {
            ok: true,
            docId: workDocId,
            readbacks: [
              {
                layerID: "40000000-0000-4000-8000-000000000005",
                text: null,
                overrideValue: state.mutatedText,
                borderThickness: 2,
              },
            ],
          };
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpc.id,
            result: {
              content: [{ type: "text", text: JSON.stringify(replyObj) }],
            },
          }),
        );
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const mcpUrl = `http://127.0.0.1:${address.port}/mcp`;

  try {
    const outReportPath = path.join(tmpDir, "roundtrip-report.json");
    const shotsDir = path.join(tmpDir, "screenshots");
    const editSpec = {
      pageID: "20000000-0000-4000-8000-000000000001",
      artboardID: "40000000-0000-4000-8000-000000000001",
      edits: [
        {
          layerID: "40000000-0000-4000-8000-000000000005",
          overrideID: "30000000-0000-4000-8000-000000000002_stringValue",
          overrideValue: "立即认证（已更新）",
        },
      ],
    };

    const res = await runPythonAsync(PY_ROUNDTRIP, [
      "--sketch",
      copySketch,
      "--anchor-id",
      anchorId,
      "--edit-spec",
      JSON.stringify(editSpec),
      "--output",
      outReportPath,
      "--screenshots-dir",
      shotsDir,
      "--mcp-url",
      mcpUrl,
      "--open-bin",
      mockOpenBin,
    ]);
    assert.equal(res.status, 0, res.stdout + "\n" + res.stderr);
    const report = JSON.parse(fs.readFileSync(outReportPath, "utf8"));
    assert.equal(report.passed, true);
    assert.equal(report.steps.step5OfflineZipDiff.unexpectedDriftCount, 0);
    assert.equal(report.steps.step5OfflineZipDiff.expectedChangedCount, 1);
    assert.equal(
      report.steps.step6ReopenVerifyAndRelease.screenshotSha256Match,
      true,
    );
    assert.equal(report.steps.step6ReopenVerifyAndRelease.finalSlotClean, true);

    const finalState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    assert.equal(finalState.openCalls.length, 2);
    for (const callArgs of finalState.openCalls) {
      assert.equal(callArgs[0], "-g");
      assert.equal(callArgs[1], "-a");
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("sketch_export_manifest.py exports 1x/2x PNG, lossless WebP, and verifies .SFNS-Regular PDF", () => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "sketch-native-export-"),
  );
  try {
    const cleanBuilder = path.join(tmpDir, "clean-spec.json");
    const cleanSketch = path.join(tmpDir, "clean.sketch");
    fs.writeFileSync(
      cleanBuilder,
      JSON.stringify(createCleanSketchSpec({ textHeight: 44, hotspotY: 76 })),
    );
    buildSyntheticSketch(cleanSketch, cleanBuilder);

    const mockSketchtool = path.join(tmpDir, "mock-sketchtool");
    fs.writeFileSync(
      mockSketchtool,
      `#!/usr/bin/env python3
import base64, struct, sys, zlib
from pathlib import Path

args = sys.argv[1:]
kind = args[1]
item_id = [a.split("=", 1)[1] for a in args if a.startswith("--item=")][0]
out_dir = Path([a.split("=", 1)[1] for a in args if a.startswith("--output=")][0])
out_dir.mkdir(parents=True, exist_ok=True)

if kind == "artboards":
    scale = int([a.split("=", 1)[1] for a in args if a.startswith("--scales=")][0])
    w, h = 375 * scale, 812 * scale
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    png = b"\\x89PNG\\r\\n\\x1a\\n" + chunk(b"IHDR", ihdr) + chunk(b"IEND", b"")
    (out_dir / f"{item_id}.png").write_bytes(png)
elif kind == "layers":
    pdf_bytes = b"%PDF-1.4\\n1 0 obj\\n<< /Type /Font /Subtype /TrueType /BaseFont /AAAAAB+.SFNS-Regular >>\\nendobj\\n%%EOF\\n"
    (out_dir / f"{item_id}.pdf").write_bytes(pdf_bytes)
`,
      { mode: 0o755 },
    );

    const outDir = path.join(tmpDir, "exports");
    const manifestPath = path.join(outDir, "manifest.json");
    const rendersPath = path.join(outDir, "renders.json");

    const exportRes = runPython(PY_EXPORT, [
      "--sketch",
      cleanSketch,
      "--output-dir",
      outDir,
      "--sketchtool",
      mockSketchtool,
      "--manifest",
      manifestPath,
      "--renders",
      rendersPath,
      "--scales",
      "1,2",
      "--webp",
      "--verify-clock-pdf",
    ]);
    assert.equal(
      exportRes.status,
      0,
      exportRes.stdout + "\n" + exportRes.stderr,
    );
    const report = JSON.parse(exportRes.stdout);
    assert.equal(report.passed, true);
    assert.equal(report.artboardsExported, 2);
    assert.equal(report.rendersCount, 4);
    assert.equal(report.clockPdfChecks.length, 1);
    assert.equal(report.clockPdfChecks[0].hasSFNSRegular, true);
    assert.equal(report.clockPdfChecks[0].hasTrueTypeSubtype, true);

    // Run --verify-only against the generated manifest.json
    const verifyRes = runPython(PY_EXPORT, [
      "--sketch",
      cleanSketch,
      "--output-dir",
      outDir,
      "--sketchtool",
      mockSketchtool,
      "--manifest",
      manifestPath,
      "--verify-only",
    ]);
    assert.equal(verifyRes.status, 0, verifyRes.stdout);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
