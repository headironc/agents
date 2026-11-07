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

const PY_ENV = {
  ...process.env,
  PYTHONDONTWRITEBYTECODE: "1",
};

function runPython(scriptPath, args, options = {}) {
  return spawnSync("python3", ["-B", scriptPath, ...args], {
    encoding: "utf8",
    timeout: 60000,
    env: PY_ENV,
    ...options,
  });
}

function runPythonAsync(scriptPath, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-B", scriptPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: PY_ENV,
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
  const res = spawnSync("python3", ["-B", "-c", pyCode, builderPath, sketchPath], {
    encoding: "utf8",
    env: PY_ENV,
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
  if (process.platform === "darwin") {
    const swiftRes = spawnSync("swift", [SWIFT_MEASURE, "--help"], {
      encoding: "utf8",
    });
    assert.equal(swiftRes.status, 0, swiftRes.stderr);
    assert.match(swiftRes.stdout, /Usage: measure-coretext\.swift/);
  }
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

    if (process.platform !== "darwin") {
      const nonMacRes = runPython(PY_MEASURE, ["--input", specsPath]);
      assert.equal(nonMacRes.status, 2);
      const errReport = JSON.parse(nonMacRes.stdout);
      assert.equal(errReport.passed, false);
      assert.match(errReport.error, /Unsupported platform/);
      return;
    }

    // Verify failure when CoreText helper is unavailable (never silently falls back to character estimation)
    const missingSwiftRes = runPython(PY_MEASURE, [
      "--input",
      specsPath,
      "--swift-bin",
      path.join(tmpDir, "nonexistent-coretext-helper"),
    ]);
    assert.equal(missingSwiftRes.status, 2);
    const missingSwiftReport = JSON.parse(missingSwiftRes.stdout);
    assert.equal(missingSwiftReport.passed, false);

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

    // Multi-override SymbolInstance height delta merging + fixed-height justifyContent=1 (Center) Flex Stack reflow
    const multiSpec = createCleanSketchSpec({ textHeight: 44, hotspotY: 76 });
    const page = multiSpec["pages/20000000-0000-4000-8000-000000000001.json"];
    const symMaster = page.layers[0];
    symMaster.frame.height = 88;
    symMaster.layers = [
      {
        _class: "text",
        do_objectID: "30000000-0000-4000-8000-000000000002",
        name: "TitleLabel",
        isVisible: true,
        textBehaviour: 1,
        frame: { _class: "rect", x: 16, y: 12, width: 180, height: 22 },
        attributedString:
          symMaster.layers[0].attributedString,
      },
      {
        _class: "text",
        do_objectID: "30000000-0000-4000-8000-000000000003",
        name: "SubLabel",
        isVisible: true,
        textBehaviour: 1,
        frame: { _class: "rect", x: 16, y: 42, width: 180, height: 22 },
        attributedString:
          symMaster.layers[0].attributedString,
      },
    ];
    const homeAb = page.layers[1];
    const cardStack = homeAb.layers[1];
    // Fixed-height vertical Flex Stack (verticalSizing: 0, justifyContent: 1 Center, height: 240)
    cardStack.groupLayout.verticalSizing = 0;
    cardStack.groupLayout.justifyContent = 1;
    cardStack.frame.height = 240;
    cardStack.layers[1].frame.y = 48; // BodyCopy y in centered 240px stack before rebake
    const btnInst = cardStack.layers[0];
    btnInst.frame.y = 104; // btnInst y in centered 240px stack before rebake
    btnInst.frame.height = 88; // base height before 2 multi-line overrides (+22 each -> +44 total -> 132)
    homeAb.layers[2].frame.y = 184; // 80 + 104
    homeAb.layers[2].frame.height = 88;
    btnInst.overrideValues = [
      {
        _class: "overrideValue",
        overrideName: "30000000-0000-4000-8000-000000000002_stringValue",
        value: "账户安全验证已开启，请在五分钟内完成确认。",
      },
      {
        _class: "overrideValue",
        overrideName: "30000000-0000-4000-8000-000000000003_stringValue",
        value: "若非本人操作，请立即点击下方按钮冻结账户。",
      },
    ];
    const multiBuilder = path.join(tmpDir, "multi-spec.json");
    const multiSketch = path.join(tmpDir, "multi.sketch");
    fs.writeFileSync(multiBuilder, JSON.stringify(multiSpec));
    buildSyntheticSketch(multiSketch, multiBuilder);

    const multiRebake = runPython(PY_MEASURE, [
      "--sketch",
      multiSketch,
      "--rebake",
    ]);
    assert.equal(multiRebake.status, 0, multiRebake.stderr);
    const multiReport = JSON.parse(multiRebake.stdout);
    assert.equal(multiReport.driftCount, 1);
    assert.equal(multiReport.drifts[0].bakedHeight, 132);

    const multiAudit = runPython(PY_AUDIT, ["--sketch", multiSketch]);
    assert.equal(multiAudit.status, 0, multiAudit.stdout);

    // Multi-run attributedString measurement: Run 1 is 14pt/20px, Run 2 is 36pt/52px on a single line
    const multiRunSpec = createCleanSketchSpec({ textHeight: 44, hotspotY: 76 });
    const mrPage =
      multiRunSpec["pages/20000000-0000-4000-8000-000000000001.json"];
    const mrTextLayer = mrPage.layers[1].layers[1].layers[1];
    mrTextLayer.frame.height = 20; // Stale height matching only Run 1 (20px) instead of Run 2 (52px)
    mrTextLayer.attributedString = {
      _class: "attributedString",
      string: "¥ 2,480",
      attributes: [
        {
          _class: "stringAttribute",
          location: 0,
          length: 2,
          attributes: {
            MSAttributedStringFontAttribute: {
              _class: "fontDescriptor",
              attributes: { name: "PingFangSC-Regular", size: 14 },
            },
            paragraphStyle: {
              _class: "paragraphStyle",
              minimumLineHeight: 20,
              maximumLineHeight: 20,
            },
          },
        },
        {
          _class: "stringAttribute",
          location: 2,
          length: 5,
          attributes: {
            MSAttributedStringFontAttribute: {
              _class: "fontDescriptor",
              attributes: { name: "PingFangSC-Medium", size: 36 },
            },
            paragraphStyle: {
              _class: "paragraphStyle",
              minimumLineHeight: 52,
              maximumLineHeight: 52,
            },
          },
        },
      ],
    };
    const mrBuilder = path.join(tmpDir, "multirun-spec.json");
    const mrSketch = path.join(tmpDir, "multirun.sketch");
    fs.writeFileSync(mrBuilder, JSON.stringify(multiRunSpec));
    buildSyntheticSketch(mrSketch, mrBuilder);

    const mrAudit = runPython(PY_MEASURE, ["--sketch", mrSketch]);
    assert.equal(mrAudit.status, 1);
    const mrReport = JSON.parse(mrAudit.stdout);
    assert.equal(mrReport.driftCount, 1);
    assert.equal(mrReport.drifts[0].bakedHeight, 52);

    // Foreign symbolMaster in document.json.foreignSymbols + hidden sibling with preserveSpaceWhenHidden: true
    const foreignSpec = createCleanSketchSpec({ textHeight: 44, hotspotY: 112 });
    const fPage =
      foreignSpec["pages/20000000-0000-4000-8000-000000000001.json"];
    const movedMaster = fPage.layers.shift(); // Remove symbolMaster from page
    movedMaster.layers[0].textBehaviour = 1;
    movedMaster.layers[0].frame.width = 180;
    foreignSpec["document.json"].foreignSymbols = [
      {
        _class: "MSImmutableForeignSymbol",
        symbolMaster: movedMaster,
      },
    ];
    const fHomeAb = fPage.layers[0];
    const fStack = fHomeAb.layers[1];
    // Insert a hidden layer with preserveSpaceWhenHidden: true (height: 20, gap: 16 -> +36px offset)
    fStack.layers.push({
      _class: "rectangle",
      do_objectID: "40000000-0000-4000-8000-000000000099",
      name: "HiddenBannerReserved",
      isVisible: false,
      flexItem: {
        _class: "MSImmutableFlexItem",
        preserveSpaceWhenHidden: true,
        ignoresStackLayout: false,
      },
      frame: { _class: "rect", x: 16, y: 16, width: 311, height: 20 },
    });
    // NoticeCopy is now second from top (y = 16 + 20 + 16 = 52), SubmitButtonFocus is third (y = 52 + 44 + 16 = 112)
    fStack.layers[1].frame.y = 52;
    fStack.layers[0].frame.y = 112;
    fStack.frame.height = 16 + 20 + 16 + 44 + 16 + 48 + 16;
    // Set foreign SymbolInstance override to a 2-line string while leaving instance height at 48 (stale by 22px)
    fStack.layers[0].overrideValues[0].value =
      "账户安全验证已开启，请在五分钟内完成确认。";
    const foreignBuilder = path.join(tmpDir, "foreign-spec.json");
    const foreignSketch = path.join(tmpDir, "foreign.sketch");
    fs.writeFileSync(foreignBuilder, JSON.stringify(foreignSpec));
    buildSyntheticSketch(foreignSketch, foreignBuilder);

    const foreignRebake = runPython(PY_MEASURE, [
      "--sketch",
      foreignSketch,
      "--rebake",
    ]);
    assert.equal(foreignRebake.status, 0, foreignRebake.stderr);
    const foreignRebakeReport = JSON.parse(foreignRebake.stdout);
    assert.equal(foreignRebakeReport.driftCount, 1);
    assert.equal(foreignRebakeReport.drifts[0].bakedHeight, 70);

    const foreignAudit = runPython(PY_AUDIT, ["--sketch", foreignSketch]);
    assert.equal(foreignAudit.status, 0, foreignAudit.stdout);

    // Side-by-side (Row) SymbolInstance overrides take max height (not sum), and horizontal Row Fit Stack reflows inside Column Stack
    const rowSpec = createCleanSketchSpec({ textHeight: 22, hotspotY: 54 });
    const rPage =
      rowSpec["pages/20000000-0000-4000-8000-000000000001.json"];
    const rMaster = rPage.layers[0];
    rMaster.frame.height = 22;
    rMaster.layers = [
      {
        _class: "text",
        do_objectID: "30000000-0000-4000-8000-000000000002",
        name: "ColLeft",
        isVisible: true,
        textBehaviour: 1,
        frame: { _class: "rect", x: 0, y: 0, width: 180, height: 22 },
        attributedString: rMaster.layers[0].attributedString,
      },
      {
        _class: "text",
        do_objectID: "30000000-0000-4000-8000-000000000003",
        name: "ColRight",
        isVisible: true,
        textBehaviour: 1,
        frame: { _class: "rect", x: 190, y: 0, width: 180, height: 22 },
        attributedString: rMaster.layers[0].attributedString,
      },
    ];
    const rHomeAb = rPage.layers[1];
    const rColStack = rHomeAb.layers[1];
    // Wrap NoticeCopy inside a horizontal Row Fit Stack (flexDirection: 0, verticalSizing: 1)
    const noticeText = rColStack.layers[1];
    rColStack.layers[1] = {
      _class: "group",
      do_objectID: "40000000-0000-4000-8000-000000000077",
      name: "RowWrapper",
      isVisible: true,
      frame: { _class: "rect", x: 16, y: 16, width: 311, height: 22 },
      groupLayout: {
        _class: "MSImmutableFlexGroupLayout",
        flexDirection: 0,
        justifyContent: 0,
        alignItems: 0,
        allGuttersGap: 8,
        hasIndividualPadding: false,
        padding: 0,
        horizontalSizing: 0,
        verticalSizing: 1,
      },
      layers: [
        {
          ...noticeText,
          frame: { _class: "rect", x: 0, y: 0, width: 180, height: 22 },
        },
      ],
    };
    const rInst = rColStack.layers[0];
    rInst.frame.width = 311;
    rInst.frame.height = 22; // Both ColLeft and ColRight wrap to 2 lines (44px) -> Row instance expected height is 44 (not 22+22+22=66!)
    rInst.overrideValues = [
      {
        _class: "overrideValue",
        overrideName: "30000000-0000-4000-8000-000000000002_stringValue",
        value: "账户安全验证已开启，请在五分钟内完成确认。",
      },
      {
        _class: "overrideValue",
        overrideName: "30000000-0000-4000-8000-000000000003_stringValue",
        value: "若非本人操作，请立即点击下方按钮冻结账户。",
      },
    ];
    rHomeAb.layers[2].frame.y = 80 + 54;
    rHomeAb.layers[2].frame.height = 22;
    const rowBuilder = path.join(tmpDir, "row-spec.json");
    const rowSketch = path.join(tmpDir, "row.sketch");
    fs.writeFileSync(rowBuilder, JSON.stringify(rowSpec));
    buildSyntheticSketch(rowSketch, rowBuilder);

    const rowRebake = runPython(PY_MEASURE, [
      "--sketch",
      rowSketch,
      "--rebake",
    ]);
    assert.equal(rowRebake.status, 0, rowRebake.stderr);
    const rowRebakeReport = JSON.parse(rowRebake.stdout);
    const instDrift = rowRebakeReport.drifts.find(
      (d) => d.kind === "symbolInstanceOverride",
    );
    assert.equal(instDrift.bakedHeight, 44);

    const rowAudit = runPython(PY_AUDIT, ["--sketch", rowSketch]);
    assert.equal(rowAudit.status, 0, rowAudit.stdout);

    // SymbolInstance _textStyle override (without _stringValue) switching line-height from 22px to 44px is measured with effective style
    const tsSpec = createCleanSketchSpec({ textHeight: 44, hotspotY: 76 });
    tsSpec["document.json"].layerTextStyles.objects = [
      {
        _class: "sharedStyle",
        do_objectID: "60000000-0000-4000-8000-000000000044",
        name: "Button/TallLineHeight",
        value: {
          _class: "style",
          textStyle: {
            _class: "textStyle",
            encodedAttributes: {
              MSAttributedStringFontAttribute: {
                _class: "fontDescriptor",
                attributes: { name: "PingFangSC-Medium", size: 16 },
              },
              paragraphStyle: {
                _class: "paragraphStyle",
                minimumLineHeight: 44,
                maximumLineHeight: 44,
                paragraphSpacing: 0,
              },
            },
          },
        },
      },
    ];
    const tsPage =
      tsSpec["pages/20000000-0000-4000-8000-000000000001.json"];
    tsPage.layers[0].layers[0].textBehaviour = 1;
    const tsInst = tsPage.layers[1].layers[1].layers[0];
    tsInst.overrideValues = [
      {
        _class: "overrideValue",
        overrideName: "30000000-0000-4000-8000-000000000002_textStyle",
        value: "60000000-0000-4000-8000-000000000044",
      },
    ];
    const tsBuilder = path.join(tmpDir, "ts-spec.json");
    const tsSketch = path.join(tmpDir, "ts.sketch");
    fs.writeFileSync(tsBuilder, JSON.stringify(tsSpec));
    buildSyntheticSketch(tsSketch, tsBuilder);

    const tsAuditRes = runPython(PY_MEASURE, ["--sketch", tsSketch]);
    assert.equal(tsAuditRes.status, 1);
    const tsReport = JSON.parse(tsAuditRes.stdout);
    assert.equal(tsReport.driftCount, 1);
    assert.equal(tsReport.drifts[0].bakedHeight, 70);

    // Verify outer symbolInstance inherits nested symbolInstance default _stringValue override, rebakes cleanly, and re-audits with 0 drift
    const nestedOvSpec = createCleanSketchSpec({
      textHeight: 44,
      hotspotY: 76,
    });
    const noPage =
      nestedOvSpec["pages/20000000-0000-4000-8000-000000000001.json"];
    const innerMaster = noPage.layers[0];
    // Give outerMaster a nested instance of innerMaster with a 2-line default _stringValue override
    const outerMaster = {
      _class: "symbolMaster",
      do_objectID: "30000000-0000-4000-8000-000000000050",
      symbolID: "90000000-0000-4000-8000-000000000050",
      name: "Card/OuterWrapper",
      frame: { _class: "rect", x: 0, y: 120, width: 311, height: 48 },
      groupLayout: {
        _class: "MSImmutableFlexGroupLayout",
        flexDirection: 1,
        verticalSizing: 1,
        padding: 0,
      },
      layers: [
        {
          _class: "symbolInstance",
          do_objectID: "30000000-0000-4000-8000-000000000051",
          symbolID: "30000000-0000-4000-8000-000000000099",
          name: "NestedBtn",
          isVisible: true,
          frame: { _class: "rect", x: 0, y: 0, width: 311, height: 48 },
          overrideValues: [
            {
              _class: "overrideValue",
              overrideName:
                "30000000-0000-4000-8000-000000000002_stringValue",
              value:
                "这是一段在嵌套母版实例上默认配置的双行长按钮文案用于验证外层实例自动继承",
            },
          ],
        },
      ],
    };
    innerMaster.layers[0].textBehaviour = 1;
    noPage.layers.push(outerMaster);
    // Point page instance to outerMaster with NO overrides of its own
    const pageInst = noPage.layers[1].layers[1].layers[0];
    pageInst.symbolID = "90000000-0000-4000-8000-000000000050";
    pageInst.overrideValues = [];
    const nestedOvBuilder = path.join(tmpDir, "nested-ov-spec.json");
    const nestedOvSketch = path.join(tmpDir, "nested-ov.sketch");
    fs.writeFileSync(nestedOvBuilder, JSON.stringify(nestedOvSpec));
    buildSyntheticSketch(nestedOvSketch, nestedOvBuilder);

    const nestedOvRebake = runPython(PY_MEASURE, [
      "--sketch",
      nestedOvSketch,
      "--rebake",
    ]);
    assert.equal(nestedOvRebake.status, 0, nestedOvRebake.stderr);
    const nestedOvRebakeReport = JSON.parse(nestedOvRebake.stdout);
    // Both the nested instance inside outerMaster and the outer instance on the page should be rebaked to 92px
    assert.equal(nestedOvRebakeReport.rebakedCount, 2);
    for (const d of nestedOvRebakeReport.drifts) {
      assert.equal(d.bakedHeight, 92);
    }

    const nestedOvVerify = runPython(PY_MEASURE, ["--sketch", nestedOvSketch]);
    assert.equal(nestedOvVerify.status, 0, nestedOvVerify.stdout);
    assert.equal(JSON.parse(nestedOvVerify.stdout).driftCount, 0);

    // Verify fixed-height SymbolInstance (or custom-resized instance with 0 text delta) preserves its custom height (88 vs master 48)
    const fixedInstSpec = createCleanSketchSpec({
      textHeight: 44,
      hotspotY: 76,
    });
    const fiPage =
      fixedInstSpec["pages/20000000-0000-4000-8000-000000000001.json"];
    fiPage.layers[0].layers[0].textBehaviour = 1;
    fiPage.layers[0].groupLayout = {
      _class: "MSImmutableFlexGroupLayout",
      flexDirection: 1,
      verticalSizing: 0,
      padding: 0,
    };
    // Resize the instance on the page to 88px (master is 48px) and update parent CardStack height accordingly
    fiPage.layers[1].layers[1].layers[0].frame.height = 88;
    fiPage.layers[1].layers[1].frame.height = 16 + 44 + 16 + 88 + 16;
    const fixedInstBuilder = path.join(tmpDir, "fixed-inst-spec.json");
    const fixedInstSketch = path.join(tmpDir, "fixed-inst.sketch");
    fs.writeFileSync(fixedInstBuilder, JSON.stringify(fixedInstSpec));
    buildSyntheticSketch(fixedInstSketch, fixedInstBuilder);

    const fixedInstAudit = runPython(PY_MEASURE, ["--sketch", fixedInstSketch]);
    assert.equal(fixedInstAudit.status, 0, fixedInstAudit.stdout);
    assert.equal(JSON.parse(fixedInstAudit.stdout).driftCount, 0);

    // Verify --rebake rejects paths under a symlinked ancestor directory
    const symParent = path.join(tmpDir, "sym-parent");
    fs.symlinkSync(tmpDir, symParent);
    const symRebakeRes = runPython(PY_MEASURE, [
      "--sketch",
      path.join(symParent, "ts.sketch"),
      "--rebake",
    ]);
    assert.notEqual(symRebakeRes.status, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("sketch_offline_audit.py passes clean .sketch and catches blocking violations", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sketch-native-audit-"));
  try {
    const cleanBuilder = path.join(tmpDir, "clean-spec.json");
    const cleanSketch = path.join(tmpDir, "clean.sketch");
    const cleanSpecWithBizTime = createCleanSketchSpec({
      textHeight: 44,
      hotspotY: 76,
    });
    // Add an ordinary business HH:mm text layer ("Appointment/StartTime" = "14:30") in PingFangSC-Regular
    cleanSpecWithBizTime[
      "pages/20000000-0000-4000-8000-000000000001.json"
    ].layers[1].layers.push({
      _class: "text",
      do_objectID: "40000000-0000-4000-8000-000000000095",
      name: "Appointment/StartTime",
      textBehaviour: 0,
      frame: { _class: "rect", x: 24, y: 320, width: 60, height: 22 },
      attributedString: {
        _class: "attributedString",
        string: "14:30",
        attributes: [
          {
            _class: "stringAttribute",
            location: 0,
            length: 5,
            attributes: {
              MSAttributedStringFontAttribute: {
                _class: "fontDescriptor",
                attributes: { name: "PingFangSC-Regular", size: 15 },
              },
            },
          },
        ],
      },
    });
    // Also include a NavBar/Back symbolMaster containing destinationArtboardID: "back" instantiated on Detail artboard (should NOT trigger FLOW-START-ARTBOARD-BACK-TRAP)
    cleanSpecWithBizTime[
      "pages/20000000-0000-4000-8000-000000000001.json"
    ].layers.push({
      _class: "symbolMaster",
      do_objectID: "30000000-0000-4000-8000-000000000088",
      symbolID: "90000000-0000-4000-8000-000000000088",
      name: "NavBar/Back",
      frame: { _class: "rect", x: 0, y: 200, width: 375, height: 44 },
      layers: [
        {
          _class: "MSImmutableHotspotLayer",
          do_objectID: "30000000-0000-4000-8000-000000000089",
          name: "HotSpot/NavBack",
          frame: { _class: "rect", x: 16, y: 0, width: 48, height: 44 },
          flow: {
            _class: "MSImmutableFlowConnection",
            do_objectID: "30000000-0000-4000-8000-000000000090",
            destinationArtboardID: "back",
          },
        },
      ],
    });
    cleanSpecWithBizTime[
      "pages/20000000-0000-4000-8000-000000000001.json"
    ].layers[2].layers.push({
      _class: "symbolInstance",
      do_objectID: "50000000-0000-4000-8000-000000000088",
      symbolID: "90000000-0000-4000-8000-000000000088",
      name: "DetailNavBar",
      frame: { _class: "rect", x: 0, y: 44, width: 375, height: 44 },
      overrideValues: [],
    });
    fs.writeFileSync(cleanBuilder, JSON.stringify(cleanSpecWithBizTime));
    buildSyntheticSketch(cleanSketch, cleanBuilder);

    const passRes = runPython(PY_AUDIT, ["--sketch", cleanSketch]);
    assert.equal(passRes.status, 0, passRes.stdout);
    const passReport = JSON.parse(passRes.stdout);
    assert.equal(passReport.passed, true);
    assert.equal(passReport.blockingCount, 0);
    assert.ok(passReport.elapsedMs < 1000);

    // Verify nested SymbolInstance override path validation across multiple symbolMasters
    const nestedSpec = createCleanSketchSpec({ textHeight: 44, hotspotY: 76 });
    const nPage = nestedSpec["pages/20000000-0000-4000-8000-000000000001.json"];
    const outerMaster = nPage.layers[0];
    // Add a nested SymbolMaster and nested SymbolInstance inside outerMaster
    const innerMaster = {
      _class: "symbolMaster",
      do_objectID: "30000000-0000-4000-8000-000000000010",
      symbolID: "90000000-0000-4000-8000-000000000010",
      name: "Badge/Inner",
      frame: { _class: "rect", x: 0, y: 120, width: 80, height: 24 },
      layers: [
        {
          _class: "text",
          do_objectID: "30000000-0000-4000-8000-000000000011",
          name: "InnerBadgeText",
          isVisible: true,
          textBehaviour: 1,
          frame: { _class: "rect", x: 0, y: 0, width: 80, height: 22 },
          attributedString: outerMaster.layers[0].attributedString,
        },
      ],
    };
    outerMaster.layers.push({
      _class: "symbolInstance",
      do_objectID: "30000000-0000-4000-8000-000000000009",
      symbolID: "90000000-0000-4000-8000-000000000010",
      name: "NestedBadge",
      isVisible: true,
      frame: { _class: "rect", x: 200, y: 12, width: 80, height: 24 },
      overrideValues: [],
    });
    nPage.layers.unshift(innerMaster);
    const outerInst = nPage.layers[2].layers[1].layers[0];
    outerInst.overrideValues.push({
      _class: "overrideValue",
      overrideName:
        "30000000-0000-4000-8000-000000000009/30000000-0000-4000-8000-000000000011_stringValue",
      value: "已认证",
    });

    const nestedCleanBuilder = path.join(tmpDir, "nested-clean-spec.json");
    const nestedCleanSketch = path.join(tmpDir, "nested-clean.sketch");
    fs.writeFileSync(nestedCleanBuilder, JSON.stringify(nestedSpec));
    buildSyntheticSketch(nestedCleanSketch, nestedCleanBuilder);

    const nestedPassRes = runPython(PY_AUDIT, ["--sketch", nestedCleanSketch]);
    assert.equal(nestedPassRes.status, 0, nestedPassRes.stdout);

    // Corrupt nested override leaf ID -> should trigger REF-DANGLING-OVERRIDE-PATH
    outerInst.overrideValues[1].overrideName =
      "30000000-0000-4000-8000-000000000009/30000000-0000-4000-8000-999999999999_stringValue";
    const nestedBadBuilder = path.join(tmpDir, "nested-bad-spec.json");
    const nestedBadSketch = path.join(tmpDir, "nested-bad.sketch");
    fs.writeFileSync(nestedBadBuilder, JSON.stringify(nestedSpec));
    buildSyntheticSketch(nestedBadSketch, nestedBadBuilder);

    const nestedFailRes = runPython(PY_AUDIT, ["--sketch", nestedBadSketch]);
    assert.equal(nestedFailRes.status, 1);
    const nestedFailCodes = new Set(
      JSON.parse(nestedFailRes.stdout).findings.map((f) => f.code),
    );
    assert.ok(nestedFailCodes.has("REF-DANGLING-OVERRIDE-PATH"));

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
    // 4. Imported foreignTextStyles containing forbidden Noto* font and Type/Platform sample/* name
    badSpec["document.json"].foreignTextStyles = [
      {
        _class: "MSImmutableForeignTextStyle",
        localSharedStyle: {
          _class: "sharedStyle",
          do_objectID: "70000000-0000-4000-8000-000000000077",
          name: "Type/Platform sample/Caption",
          value: {
            _class: "style",
            textStyle: {
              _class: "textStyle",
              encodedAttributes: {
                MSAttributedStringFontAttribute: {
                  _class: "fontDescriptor",
                  attributes: { name: "NotoSansSC-Regular", size: 12 },
                },
              },
            },
          },
        },
      },
    ];
    // 5. Dangling page reference in document.json.pages
    badSpec["document.json"].pages = [
      {
        _class: "MSJSONFileReference",
        _ref_class: "MSImmutablePage",
        _ref: "pages/20000000-0000-4000-8000-000000000001",
      },
      {
        _class: "MSJSONFileReference",
        _ref_class: "MSImmutablePage",
        _ref: "pages/20000000-0000-4000-8000-999999999999",
      },
    ];
    // 6. Embedded foreignSymbols[*].symbolMaster containing forbidden NotoSans-Regular text
    badSpec["document.json"].foreignSymbols = [
      {
        _class: "MSImmutableForeignSymbol",
        symbolMaster: {
          _class: "symbolMaster",
          do_objectID: "80000000-0000-4000-8000-000000000081",
          symbolID: "80000000-0000-4000-8000-000000000082",
          name: "Foreign/Chip",
          frame: { _class: "rect", x: 0, y: 0, width: 80, height: 28 },
          layers: [
            {
              _class: "text",
              do_objectID: "80000000-0000-4000-8000-000000000083",
              name: "ForeignChipText",
              frame: { _class: "rect", x: 8, y: 4, width: 64, height: 20 },
              attributedString: {
                _class: "attributedString",
                string: "标签",
                attributes: [
                  {
                    _class: "stringAttribute",
                    location: 0,
                    length: 2,
                    attributes: {
                      MSAttributedStringFontAttribute: {
                        _class: "fontDescriptor",
                        attributes: { name: "NotoSans-Regular", size: 12 },
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    ];

    // 7. Duplicate do_objectID across two shared styles in document.json
    badSpec["document.json"].layerTextStyles = {
      _class: "sharedTextStyleContainer",
      objects: [
        {
          _class: "sharedStyle",
          do_objectID: "77000000-0000-4000-8000-000000000077",
          name: "Body/Red",
          value: { _class: "style" },
        },
        {
          _class: "sharedStyle",
          do_objectID: "77000000-0000-4000-8000-000000000077",
          name: "Body/Blue",
          value: { _class: "style" },
        },
      ],
    };

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
    assert.ok(codes.has("FONT-FORBIDDEN-NOTO"));
    assert.ok(codes.has("STYLE-FORBIDDEN-PLATFORM-SAMPLE"));
    assert.ok(codes.has("ARCHIVE-MISSING-REFERENCED-PAGE"));
    assert.ok(codes.has("ID-DUPLICATE-OBJECT-ID"));
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
  const specObj = createCleanSketchSpec({ textHeight: 44, hotspotY: 76 });
  // Include a shared text style and an embedded foreignSymbol in document.json, and a second override on the same SymbolInstance
  specObj["document.json"].layerTextStyles.objects = [
    {
      _class: "sharedStyle",
      do_objectID: "60000000-0000-4000-8000-000000000001",
      name: "Body/Default",
      value: {
        _class: "style",
        textStyle: {
          _class: "textStyle",
          encodedAttributes: {
            MSAttributedStringFontAttribute: {
              _class: "fontDescriptor",
              attributes: { name: "PingFangSC-Regular", size: 15 },
            },
          },
        },
      },
    },
  ];
  specObj["document.json"].foreignSymbols = [
    {
      _class: "MSImmutableForeignSymbol",
      do_objectID: "81000000-0000-4000-8000-000000000001",
      symbolMaster: {
        _class: "symbolMaster",
        do_objectID: "81000000-0000-4000-8000-000000000002",
        symbolID: "81000000-0000-4000-8000-000000000003",
        name: "Foreign/Tag",
        frame: { _class: "rect", x: 0, y: 0, width: 64, height: 24 },
        layers: [
          {
            _class: "text",
            do_objectID: "81000000-0000-4000-8000-000000000004",
            name: "ForeignTagLabel",
            frame: { _class: "rect", x: 4, y: 2, width: 56, height: 20 },
            attributedString: {
              _class: "attributedString",
              string: "认证",
              attributes: [
                {
                  _class: "stringAttribute",
                  location: 0,
                  length: 2,
                  attributes: {
                    MSAttributedStringFontAttribute: {
                      _class: "fontDescriptor",
                      attributes: { name: "PingFangSC-Regular", size: 12 },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ];
  const instLayer =
    specObj["pages/20000000-0000-4000-8000-000000000001.json"].layers[1]
      .layers[1].layers[0];
  instLayer.overrideValues.push({
    _class: "overrideValue",
    overrideName: "30000000-0000-4000-8000-000000000003_stringValue",
    value: "副标题原文",
  });
  const specPath = path.join(tmpDir, "clean-spec.json");
  fs.writeFileSync(specPath, JSON.stringify(specObj));
  buildSyntheticSketch(copySketch, specPath);

  // Create a mock `open` executable that records args and notifies the mock state file
  const stateFile = path.join(tmpDir, "mcp-state.json");
  fs.writeFileSync(
    stateFile,
    JSON.stringify({
      workOpen: false,
      mutatedText1: null,
      mutatedText2: null,
      failScreenshotOnce: false,
      openCalls: [],
    }),
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
state["workPath"] = sys.argv[-1]
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
        if (state.failScreenshotOnce) {
          state.failScreenshotOnce = false;
          fs.writeFileSync(stateFile, JSON.stringify(state));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: rpc.id,
              result: {
                isError: true,
                content: [{ type: "text", text: "Simulated screenshot error" }],
              },
            }),
          );
          return;
        }
        const imgData = state.mutatedText1 ? pngBase64Post : pngBase64Pre;
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
          state.mutatedText1 = "立即认证（已更新）";
          state.mutatedText2 = "副标题（已更新）";
          fs.writeFileSync(stateFile, JSON.stringify(state));
          // Mutate both targeted SymbolInstance overrides inside copySketch
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
inst["overrideValues"][1]["value"] = "副标题（已更新）"
members[page_key] = (json.dumps(page, ensure_ascii=False, indent=2) + "\\n").encode("utf-8")
with zipfile.ZipFile(p, "w", compression=zipfile.ZIP_DEFLATED) as zout:
    for n, raw in members.items():
        zout.writestr(n, raw)
`;
          if (!state.skipDiskMutate) {
            spawnSync(
              "python3",
              ["-B", "-c", pyMutate, state.workPath || copySketch],
              {
                env: PY_ENV,
              },
            );
          }
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
              sharedTextStylesCount: 1,
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
                editIndex: 0,
                layerID: "40000000-0000-4000-8000-000000000005",
                overrideID: "30000000-0000-4000-8000-000000000002_stringValue",
                text: null,
                overrideValue: state.mutatedText1,
                borderThickness: 3,
                borderColor: "#1f6bf5ff",
                focusBorderThickness: 3,
                focusBorderColor: "#1f6bf5ff",
              },
              {
                editIndex: 1,
                layerID: "40000000-0000-4000-8000-000000000005",
                overrideID: "30000000-0000-4000-8000-000000000003_stringValue",
                text: null,
                overrideValue: state.mutatedText2,
                borderThickness: 3,
                borderColor: "#1f6bf5ff",
                focusBorderThickness: 3,
                focusBorderColor: "#1f6bf5ff",
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
          focusBorderColor: "#1F6BF5",
          focusBorderThickness: 3,
        },
        {
          layerID: "40000000-0000-4000-8000-000000000005",
          overrideID: "30000000-0000-4000-8000-000000000003_stringValue",
          overrideValue: "副标题（已更新）",
        },
      ],
    };

    // 1. Simulate a mid-slot screenshot failure and verify emergency close releases the slot
    const failState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    failState.failScreenshotOnce = true;
    fs.writeFileSync(stateFile, JSON.stringify(failState));

    const abortedRes = await runPythonAsync(PY_ROUNDTRIP, [
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
    assert.equal(abortedRes.status, 1);
    const stateAfterAbort = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    assert.equal(
      stateAfterAbort.workOpen,
      false,
      "Working document must be closed in finally block after mid-slot failure",
    );

    // Reset openCalls before running the full passing roundtrip
    stateAfterAbort.openCalls = [];
    fs.writeFileSync(stateFile, JSON.stringify(stateAfterAbort));

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

    // Verify a spoofed server returning matching screenshots/readbacks without mutating private working_copy fails
    finalState.skipDiskMutate = true;
    finalState.openCalls = [];
    fs.writeFileSync(stateFile, JSON.stringify(finalState));
    const spoofedRes = await runPythonAsync(PY_ROUNDTRIP, [
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
    assert.equal(spoofedRes.status, 1);
    const spoofedReport = JSON.parse(fs.readFileSync(outReportPath, "utf8"));
    assert.equal(spoofedReport.passed, false);
    assert.equal(
      spoofedReport.steps.step5OfflineZipDiff.archiveMutationsVerified,
      false,
    );
    // Also verify _verify_mcp_listener_peer rejects non-Sketch listener when require_signed_sketch=True
    const peerAuthRes = spawnSync(
      "python3",
      [
        "-B",
        "-c",
        `import sys
sys.path.insert(0, ${JSON.stringify(SCRIPTS_DIR)})
import sketch_mcp_roundtrip as r
try:
    r._verify_mcp_listener_peer(${JSON.stringify(mcpUrl)}, require_signed_sketch=True)
    raise AssertionError("Expected non-Sketch listener to be rejected when require_signed_sketch=True")
except RuntimeError as exc:
    assert "unauthenticated" in str(exc).lower() or "codesign" in str(exc).lower()
`,
      ],
      { encoding: "utf8", env: PY_ENV },
    );
    assert.equal(peerAuthRes.status, 0, peerAuthRes.stderr);

    // Verify offline diff catches sharedTextStyle fontDescriptor drift in document.json AND second-run textRuns font drift
    const driftedDocSketch = path.join(tmpDir, "drifted-doc.sketch");
    const driftedDocSpec = JSON.parse(fs.readFileSync(specPath, "utf8"));
    driftedDocSpec[
      "document.json"
    ].layerTextStyles.objects[0].value.textStyle.encodedAttributes.MSAttributedStringFontAttribute.attributes.name =
      "Heiti SC";
    driftedDocSpec[
      "document.json"
    ].foreignSymbols[0].symbolMaster.layers[0].attributedString.attributes[0].attributes.MSAttributedStringFontAttribute.attributes.name =
      "Heiti SC";
    // Add a second run on NoticeCopy in driftedDocSpec while keeping first run identical, and swap child layer order on Detail artboard
    const noticeLayer =
      driftedDocSpec["pages/20000000-0000-4000-8000-000000000001.json"]
        .layers[1].layers[1].layers[1];
    noticeLayer.attributedString.attributes.push({
      _class: "stringAttribute",
      location: 10,
      length: 5,
      attributes: {
        MSAttributedStringFontAttribute: {
          _class: "fontDescriptor",
          attributes: { name: "Heiti SC", size: 15 },
        },
      },
    });
    const detailAb =
      driftedDocSpec["pages/20000000-0000-4000-8000-000000000001.json"]
        .layers[2];
    detailAb.layers.reverse(); // Reordering child layers changes childIDs on detailAb
    // Also mutate SymbolInstance.symbolID on SubmitButtonFocus and style.fills on StatusBar group
    driftedDocSpec["pages/20000000-0000-4000-8000-000000000001.json"].layers[1].layers[1].layers[0].symbolID =
      "81000000-0000-4000-8000-000000000003";
    driftedDocSpec["pages/20000000-0000-4000-8000-000000000001.json"].layers[1].layers[0].style =
      {
        _class: "style",
        fills: [
          {
            _class: "fill",
            isEnabled: true,
            color: { _class: "color", alpha: 1, red: 0, green: 0, blue: 1 },
          },
        ],
      };
    const driftedDocSpecPath = path.join(tmpDir, "drifted-doc-spec.json");
    fs.writeFileSync(driftedDocSpecPath, JSON.stringify(driftedDocSpec));
    buildSyntheticSketch(driftedDocSketch, driftedDocSpecPath);

    const diffCheck = spawnSync(
      "python3",
      [
        "-B",
        "-c",
        `import json, sys; from pathlib import Path; sys.path.insert(0, ${JSON.stringify(SCRIPTS_DIR)}); import sketch_mcp_roundtrip as r; print(json.dumps(r.diff_sketch_archives_offline(Path(sys.argv[1]), Path(sys.argv[2]), set())))`,
        copySketch,
        driftedDocSketch,
      ],
      { encoding: "utf8", env: PY_ENV },
    );
    assert.equal(diffCheck.status, 0, diffCheck.stderr);
    const diffOut = JSON.parse(diffCheck.stdout);
    assert.ok(
      diffOut.unexpectedDrifts.some(
        (d) => d.layerID === "sharedTextStyle:60000000-0000-4000-8000-000000000001",
      ),
    );
    assert.ok(
      diffOut.unexpectedDrifts.some(
        (d) => d.layerID === "81000000-0000-4000-8000-000000000004",
      ),
    );
    assert.ok(
      diffOut.unexpectedDrifts.some(
        (d) => d.layerID === "40000000-0000-4000-8000-000000000005" && d.after.symbolID === "81000000-0000-4000-8000-000000000003",
      ),
    );
    assert.ok(
      diffOut.unexpectedDrifts.some(
        (d) => d.layerID === "40000000-0000-4000-8000-000000000002" && Array.isArray(d.after.fills) && d.after.fills.length === 1,
      ),
    );
    assert.ok(
      diffOut.unexpectedDrifts.some(
        (d) => d.layerID === "40000000-0000-4000-8000-000000000007",
      ),
    );

    // Verify empty-string readback JS preserves "" and symlinked output paths are rejected
    const jsAndSymlinkCheck = spawnSync(
      "python3",
      [
        "-B",
        "-c",
        `import json, os, sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(SCRIPTS_DIR)})
import sketch_mcp_roundtrip as r
js = r._build_lightweight_readback_js("doc-1", [{"layerID": "l-1", "text": ""}], "page-1")
assert "typeof layer.text === 'string' ? layer.text : null" in js
target_file = Path(sys.argv[1]) / "victim.txt"
target_file.write_text("keep", encoding="utf-8")
symlink_path = Path(sys.argv[1]) / "symlink-before.png"
os.symlink(target_file, symlink_path)
try:
    r._write_bytes_nofollow(symlink_path, b"overwrite")
    raise AssertionError("Expected symlink write to be rejected")
except RuntimeError as exc:
    assert "symlink" in str(exc).lower()
try:
    r._read_regular_owned_bytes_nofollow(symlink_path)
    raise AssertionError("Expected symlink input read to be rejected")
except RuntimeError as exc:
    assert "symlink" in str(exc).lower()
assert target_file.read_text(encoding="utf-8") == "keep"
print("ok")
`,
        tmpDir,
      ],
      { encoding: "utf8", env: PY_ENV },
    );
    assert.equal(jsAndSymlinkCheck.status, 0, jsAndSymlinkCheck.stderr);
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
    const cleanSpecWithBizTime = createCleanSketchSpec({
      textHeight: 44,
      hotspotY: 76,
    });
    // Add an ordinary business HH:mm text layer ("Appointment/StartTime" = "14:30") in PingFangSC-Regular
    cleanSpecWithBizTime[
      "pages/20000000-0000-4000-8000-000000000001.json"
    ].layers[1].layers.push({
      _class: "text",
      do_objectID: "40000000-0000-4000-8000-000000000095",
      name: "Appointment/StartTime",
      textBehaviour: 0,
      frame: { _class: "rect", x: 24, y: 320, width: 60, height: 22 },
      attributedString: {
        _class: "attributedString",
        string: "14:30",
        attributes: [
          {
            _class: "stringAttribute",
            location: 0,
            length: 5,
            attributes: {
              MSAttributedStringFontAttribute: {
                _class: "fontDescriptor",
                attributes: { name: "PingFangSC-Regular", size: 15 },
              },
            },
          },
        ],
      },
    });
    // Also include a NavBar/Back symbolMaster containing destinationArtboardID: "back" instantiated on Detail artboard (should NOT trigger FLOW-START-ARTBOARD-BACK-TRAP)
    cleanSpecWithBizTime[
      "pages/20000000-0000-4000-8000-000000000001.json"
    ].layers.push({
      _class: "symbolMaster",
      do_objectID: "30000000-0000-4000-8000-000000000088",
      symbolID: "90000000-0000-4000-8000-000000000088",
      name: "NavBar/Back",
      frame: { _class: "rect", x: 0, y: 200, width: 375, height: 44 },
      layers: [
        {
          _class: "MSImmutableHotspotLayer",
          do_objectID: "30000000-0000-4000-8000-000000000089",
          name: "HotSpot/NavBack",
          frame: { _class: "rect", x: 16, y: 0, width: 48, height: 44 },
          flow: {
            _class: "MSImmutableFlowConnection",
            do_objectID: "30000000-0000-4000-8000-000000000090",
            destinationArtboardID: "back",
          },
        },
      ],
    });
    cleanSpecWithBizTime[
      "pages/20000000-0000-4000-8000-000000000001.json"
    ].layers[2].layers.push({
      _class: "symbolInstance",
      do_objectID: "50000000-0000-4000-8000-000000000088",
      symbolID: "90000000-0000-4000-8000-000000000088",
      name: "DetailNavBar",
      frame: { _class: "rect", x: 0, y: 44, width: 375, height: 44 },
      overrideValues: [],
    });
    fs.writeFileSync(cleanBuilder, JSON.stringify(cleanSpecWithBizTime));
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

    const mockCwebp = path.join(tmpDir, "mock-cwebp");
    fs.writeFileSync(
      mockCwebp,
      `#!/usr/bin/env python3
import struct, sys
from pathlib import Path
args = sys.argv[1:]
out_idx = args.index("-o") + 1
out_path = Path(args[out_idx])
# Valid minimal VP8L lossless bitstream header starting with 0x2f signature byte
vp8l_stream = b"\\x2f\\x00\\x00\\x00\\x10\\x07\\x10\\x11\\x11\\x88\\x88\\xfe\\x07\\x00"
payload = b"VP8L" + struct.pack("<I", len(vp8l_stream)) + vp8l_stream
webp = b"RIFF" + struct.pack("<I", 4 + len(payload)) + b"WEBP" + payload
out_path.write_bytes(webp)
`,
      { mode: 0o755 },
    );

    const outDir = path.join(tmpDir, "exports");
    const manifestPath = path.join(outDir, "manifest.json");
    const rendersPath = path.join(outDir, "renders.json");

    // 1. Verify --verify-only fails when baseline manifest.json does not exist yet (and does not create it)
    const missingBaselineRes = runPython(PY_EXPORT, [
      "--sketch",
      cleanSketch,
      "--output-dir",
      outDir,
      "--sketchtool",
      mockSketchtool,
      "--cwebp",
      mockCwebp,
      "--manifest",
      manifestPath,
      "--verify-only",
    ]);
    assert.equal(missingBaselineRes.status, 1);
    const missingBaselineReport = JSON.parse(missingBaselineRes.stdout);
    assert.equal(missingBaselineReport.passed, false);
    assert.equal(
      missingBaselineReport.manifestMismatches[0].type,
      "missing_baseline_file",
    );
    assert.equal(fs.existsSync(manifestPath), false);

    // 2. Verify missing cwebp binary fails explicitly when --webp is active
    const missingCwebpRes = runPython(PY_EXPORT, [
      "--sketch",
      cleanSketch,
      "--output-dir",
      outDir,
      "--sketchtool",
      mockSketchtool,
      "--cwebp",
      path.join(tmpDir, "nonexistent-cwebp"),
      "--webp",
    ]);
    assert.equal(missingCwebpRes.status, 1);

    // 3. Full export with valid mock-cwebp
    const exportRes = runPython(PY_EXPORT, [
      "--sketch",
      cleanSketch,
      "--output-dir",
      outDir,
      "--sketchtool",
      mockSketchtool,
      "--cwebp",
      mockCwebp,
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

    // 4. Run --verify-only against the generated manifest.json
    const verifyRes = runPython(PY_EXPORT, [
      "--sketch",
      cleanSketch,
      "--output-dir",
      outDir,
      "--sketchtool",
      mockSketchtool,
      "--cwebp",
      mockCwebp,
      "--manifest",
      manifestPath,
      "--verify-only",
    ]);
    assert.equal(verifyRes.status, 0, verifyRes.stdout);

    // 4b. Verify --verify-only fails when --no-webp is used against a baseline manifest that has webpSha256
    const verifyNoWebpRes = runPython(PY_EXPORT, [
      "--sketch",
      cleanSketch,
      "--output-dir",
      outDir,
      "--sketchtool",
      mockSketchtool,
      "--no-webp",
      "--manifest",
      manifestPath,
      "--verify-only",
    ]);
    assert.equal(verifyNoWebpRes.status, 1);
    const verifyNoWebpReport = JSON.parse(verifyNoWebpRes.stdout);
    assert.ok(
      verifyNoWebpReport.manifestMismatches.some(
        (m) => m.type === "render_mismatch",
      ),
    );

    // 5. Verify --verify-only detects deleted artboard / missing scale entry present in baseline manifest
    const manifestWithExtra = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifestWithExtra.renders.push({
      artboardID: "99999999-0000-4000-8000-000000000099",
      artboardName: "DeletedArtboard",
      scale: 1,
      pngSha256: "0000",
    });
    fs.writeFileSync(manifestPath, JSON.stringify(manifestWithExtra, null, 2));

    const verifyMissingRes = runPython(PY_EXPORT, [
      "--sketch",
      cleanSketch,
      "--output-dir",
      outDir,
      "--sketchtool",
      mockSketchtool,
      "--cwebp",
      mockCwebp,
      "--manifest",
      manifestPath,
      "--scales",
      "1,2",
      "--verify-only",
    ]);
    assert.equal(verifyMissingRes.status, 1);
    const verifyMissingReport = JSON.parse(verifyMissingRes.stdout);
    assert.ok(
      verifyMissingReport.manifestMismatches.some(
        (m) => m.type === "missing_in_export",
      ),
    );

    // 6. Verify check_pingfang_font_access() requires an actual readable PingFang.ttc file
    const fontCheck = spawnSync(
      "python3",
      [
        "-B",
        "-c",
        `import sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(SCRIPTS_DIR)})
import sketch_export_manifest as m
m.platform.system = lambda: "Darwin"
empty_root = Path(sys.argv[1]) / "empty-assets"
font_sub = empty_root / "com_apple_MobileAsset_Font8"
font_sub.mkdir(parents=True, exist_ok=True)
m.PINGFANG_ASSET_ROOT = empty_root
m.PINGFANG_FALLBACK_PATHS = []
res = m.check_pingfang_font_access()
assert res["accessible"] is False, res
ttc = font_sub / "PingFang.ttc"
ttc.write_bytes(b"ttcf0000")
res2 = m.check_pingfang_font_access()
assert res2["accessible"] is True, res2
`,
        tmpDir,
      ],
      { encoding: "utf8", env: PY_ENV },
    );
    assert.equal(fontCheck.status, 0, fontCheck.stderr);

    // 7. Verify pre-existing wildcard symlink (<id>!.png) inside --output-dir is rejected
    const poisonedDir = path.join(tmpDir, "poisoned-exports");
    const poisonedScale1 = path.join(poisonedDir, "1x");
    fs.mkdirSync(poisonedScale1, { recursive: true, mode: 0o700 });
    const victimPng = path.join(tmpDir, "victim-secret.png");
    fs.writeFileSync(victimPng, "secret");
    fs.symlinkSync(
      victimPng,
      path.join(
        poisonedScale1,
        "40000000-0000-4000-8000-000000000001!.png",
      ),
    );
    const poisonedRes = runPython(PY_EXPORT, [
      "--sketch",
      cleanSketch,
      "--output-dir",
      poisonedDir,
      "--sketchtool",
      mockSketchtool,
      "--cwebp",
      mockCwebp,
      "--scales",
      "1",
    ]);
    assert.notEqual(poisonedRes.status, 0);

    // 8. Verify status-bar clock inside a SymbolInstance (including foreignSymbols + _stringValue override) is collected and PDF-verified
    const compClockSpec = createCleanSketchSpec(44);
    const compAb =
      compClockSpec["pages/20000000-0000-4000-8000-000000000001.json"].layers[1];
    // Replace direct StatusBar group with a SymbolInstance referencing a foreign StatusBar symbolMaster
    compClockSpec["document.json"].foreignSymbols = [
      {
        _class: "MSImmutableForeignSymbol",
        do_objectID: "70000000-0000-4000-8000-000000000701",
        symbolMaster: {
          _class: "symbolMaster",
          do_objectID: "70000000-0000-4000-8000-000000000702",
          symbolID: "70000000-0000-4000-8000-000000000703",
          name: "iOS / StatusBar",
          frame: { _class: "rect", x: 0, y: 800, width: 375, height: 44 },
          layers: [
            {
              _class: "text",
              do_objectID: "70000000-0000-4000-8000-000000000704",
              name: "ClockLabel",
              textBehaviour: 0,
              frame: { _class: "rect", x: 24, y: 14, width: 54, height: 18 },
              attributedString: {
                _class: "attributedString",
                string: "00:00",
                attributes: [
                  {
                    _class: "stringAttribute",
                    location: 0,
                    length: 5,
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
          ],
        },
      },
    ];
    compAb.layers[0] = {
      _class: "symbolInstance",
      do_objectID: "70000000-0000-4000-8000-000000000705",
      symbolID: "70000000-0000-4000-8000-000000000703",
      name: "StatusBarInstance",
      frame: { _class: "rect", x: 0, y: 0, width: 375, height: 44 },
      overrideValues: [
        {
          _class: "overrideValue",
          do_objectID: "70000000-0000-4000-8000-000000000706",
          overrideName: "70000000-0000-4000-8000-000000000704_stringValue",
          value: "9:41",
        },
      ],
    };
    const compClockBuilder = path.join(tmpDir, "comp-clock-spec.json");
    const compClockSketch = path.join(tmpDir, "comp-clock.sketch");
    const compClockOutDir = path.join(tmpDir, "comp-clock-exports");
    fs.writeFileSync(compClockBuilder, JSON.stringify(compClockSpec));
    buildSyntheticSketch(compClockSketch, compClockBuilder);

    const compClockRes = runPython(PY_EXPORT, [
      "--sketch",
      compClockSketch,
      "--output-dir",
      compClockOutDir,
      "--sketchtool",
      mockSketchtool,
      "--cwebp",
      mockCwebp,
      "--scales",
      "1",
      "--verify-clock-pdf",
    ]);
    assert.equal(
      compClockRes.status,
      0,
      compClockRes.stdout + "\n" + compClockRes.stderr,
    );
    const compClockReport = JSON.parse(compClockRes.stdout);
    assert.equal(compClockReport.passed, true);
    assert.equal(compClockReport.clockPdfChecks.length, 1);
    assert.equal(
      compClockReport.clockPdfChecks[0].layerID,
      "70000000-0000-4000-8000-000000000704",
    );
    assert.equal(
      compClockReport.clockPdfChecks[0].instanceID,
      "70000000-0000-4000-8000-000000000705",
    );
    assert.equal(compClockReport.clockPdfChecks[0].text, "9:41");
    assert.equal(compClockReport.clockPdfChecks[0].valid, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("sketch-native: round-7 focus-ring border detection, shared style asset refs, and CTFontMediumUsage", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sketch-r7-"));
  try {
    // 1. Verify CTFontMediumUsage resolves to .SFNS-Medium on macOS
    if (process.platform === "darwin") {
      const specPath = path.join(tmpDir, "ui-fonts.json");
      fs.writeFileSync(
        specPath,
        JSON.stringify([
          {
            id: "reg",
            text: "9:41",
            uiUsage: "CTFontRegularUsage",
            fontSize: 14,
            width: 60,
          },
          {
            id: "med",
            text: "标题文案",
            uiUsage: "CTFontMediumUsage",
            fontSize: 16,
            width: 120,
          },
          {
            id: "emp",
            text: "强调文案",
            uiUsage: "CTFontEmphasizedUsage",
            fontSize: 16,
            width: 120,
          },
        ]),
      );
      const uiRes = runPython(PY_MEASURE, ["--input", specPath]);
      assert.equal(uiRes.status, 0, uiRes.stderr);
      const uiPayload = JSON.parse(uiRes.stdout);
      const uiRows = uiPayload.results;
      const byId = Object.fromEntries(uiRows.map((r) => [r.id, r]));
      assert.equal(byId.reg.resolvedPostScriptName, ".SFNS-Regular");
      assert.equal(byId.med.resolvedPostScriptName, ".SFNS-Medium");
      assert.equal(byId.emp.resolvedPostScriptName, ".SFNS-Bold");
    }

    // 2. Verify ordinary-named layer with 2px Outside border is audited as a focus ring
    //    AND shared styles with missing archive images / dangling swatchIDs are flagged
    const r7Spec = createCleanSketchSpec(44);
    const r7Page = r7Spec["pages/20000000-0000-4000-8000-000000000001.json"];
    const r7Stack = r7Page.layers[1].layers[1];
    // Clip parent stack and remove 'focus' from button name + remove hasFocusRing
    r7Stack.clippingBehavior = 1;
    r7Stack.layers[0].name = "Button/Primary";
    delete r7Stack.layers[0].hasFocusRing;

    // Add missing image ref and dangling swatchID inside document.json.layerStyles
    r7Spec["document.json"].layerStyles.objects.push({
      _class: "sharedStyle",
      do_objectID: "80000000-0000-4000-8000-000000000801",
      name: "Fill/BrokenSharedStyle",
      value: {
        _class: "style",
        fills: [
          {
            _class: "fill",
            isEnabled: true,
            color: {
              _class: "color",
              alpha: 1,
              red: 1,
              green: 0,
              blue: 0,
              swatchID: "DEAD0000-0000-4000-8000-000000000802",
            },
            image: {
              _class: "MSJSONFileReference",
              _ref_class: "MSImageData",
              _ref: "images/MISSING_SHARED_STYLE.png",
            },
          },
        ],
      },
    });

    const r7Builder = path.join(tmpDir, "r7-spec.json");
    const r7Sketch = path.join(tmpDir, "r7.sketch");
    fs.writeFileSync(r7Builder, JSON.stringify(r7Spec));
    buildSyntheticSketch(r7Sketch, r7Builder);

    const r7AuditRes = runPython(PY_AUDIT, ["--sketch", r7Sketch]);
    assert.equal(r7AuditRes.status, 1);
    const r7Report = JSON.parse(r7AuditRes.stdout);
    const r7Codes = new Set(r7Report.findings.map((f) => f.code));
    assert.ok(r7Codes.has("FOCUS-RING-ANCESTOR-CLIPPED"));
    assert.ok(r7Codes.has("REF-MISSING-IMAGE-DATA"));
    assert.ok(r7Codes.has("REF-DANGLING-SWATCH-ID"));

    // 3. Verify per-paragraph paragraphSpacing accumulation, Swift --output mode 0600, and unmodified taller sibling in horizontal master
    if (process.platform === "darwin") {
      const paraSpecPath = path.join(tmpDir, "para-spacing.json");
      const swiftOutPath = path.join(tmpDir, "swift-out.json");
      fs.writeFileSync(
        paraSpecPath,
        JSON.stringify([
          {
            id: "multi-para",
            text: "第一段\n第二段\n第三段",
            fontName: "PingFangSC-Regular",
            fontSize: 14,
            lineHeight: 20,
            paragraphSpacing: 0,
            width: 200,
            runs: [
              {
                location: 0,
                length: 4,
                fontName: "PingFangSC-Regular",
                fontSize: 14,
                lineHeight: 20,
                paragraphSpacing: 0,
              },
              {
                location: 4,
                length: 4,
                fontName: "PingFangSC-Regular",
                fontSize: 14,
                lineHeight: 20,
                paragraphSpacing: 40,
              },
              {
                location: 8,
                length: 3,
                fontName: "PingFangSC-Regular",
                fontSize: 14,
                lineHeight: 20,
                paragraphSpacing: 0,
              },
            ],
          },
        ]),
      );
      const swiftRes = spawnSync(
        "swift",
        [SWIFT_MEASURE, "--input", paraSpecPath, "--output", swiftOutPath],
        { encoding: "utf8" },
      );
      assert.equal(swiftRes.status, 0, swiftRes.stderr);
      const outStat = fs.lstatSync(swiftOutPath);
      assert.equal(outStat.mode & 0o777, 0o600);
      const swiftParsed = JSON.parse(fs.readFileSync(swiftOutPath, "utf8"));
      assert.equal(swiftParsed.results[0].lineCount, 3);
      assert.equal(swiftParsed.results[0].bakedHeight, 100);

      // Verify Swift --output rejects symlinked output path
      const symTarget = path.join(tmpDir, "swift-victim.json");
      fs.writeFileSync(symTarget, "keep");
      const symLink = path.join(tmpDir, "swift-symlink.json");
      fs.symlinkSync(symTarget, symLink);
      const swiftSymRes = spawnSync(
        "swift",
        [SWIFT_MEASURE, "--input", paraSpecPath, "--output", symLink],
        { encoding: "utf8" },
      );
      assert.notEqual(swiftSymRes.status, 0);
      assert.equal(fs.readFileSync(symTarget, "utf8"), "keep");

      // Verify horizontal master with 60px unmodified sibling and 20px->44px text override keeps instance height 60
      const hSibSpec = createCleanSketchSpec(44);
      const hSibPage =
        hSibSpec["pages/20000000-0000-4000-8000-000000000001.json"];
      const hSibMaster = hSibPage.layers[0];
      hSibMaster.frame.height = 60;
      hSibMaster.layers[0].textBehaviour = 1;
      hSibMaster.layers[0].frame = {
        _class: "rect",
        x: 0,
        y: 0,
        width: 180,
        height: 22,
      };
      hSibMaster.layers.push({
        _class: "rectangle",
        do_objectID: "30000000-0000-4000-8000-000000000077",
        name: "TallAvatarGraphic",
        isVisible: true,
        frame: { _class: "rect", x: 196, y: 0, width: 60, height: 60 },
      });
      const hSibInst = hSibPage.layers[1].layers[1].layers[0];
      hSibInst.frame.height = 60;
      hSibInst.overrideValues[0].value =
        "账户安全验证已开启，请在五分钟内完成确认。";
      hSibPage.layers[1].layers[1].frame.height = 16 + 44 + 16 + 60 + 16;
      hSibPage.layers[1].layers[2].frame.height = 60;
      const hSibBuilder = path.join(tmpDir, "hsib-spec.json");
      const hSibSketch = path.join(tmpDir, "hsib.sketch");
      fs.writeFileSync(hSibBuilder, JSON.stringify(hSibSpec));
      buildSyntheticSketch(hSibSketch, hSibBuilder);

      const hSibMeasure = runPython(PY_MEASURE, ["--sketch", hSibSketch]);
      assert.equal(hSibMeasure.status, 0, hSibMeasure.stdout);
      const hSibReport = JSON.parse(hSibMeasure.stdout);
      assert.equal(hSibReport.driftCount, 0);
    }

    // 4. Verify _textStyle override pointing to a layerStyle ID is rejected (type-checked style pools),
    //    and nested SymbolInstance default _flowDestination override is merged during flow expansion
    const r9Spec = createCleanSketchSpec(44);
    r9Spec["document.json"].layerStyles.objects.push({
      _class: "sharedStyle",
      do_objectID: "91000000-0000-4000-8000-000000000901",
      name: "Fill/CardSurface",
      value: { _class: "style", fills: [] },
    });
    const r9Page = r9Spec["pages/20000000-0000-4000-8000-000000000001.json"];
    // Add nested BackButton master with default flow="back", and outer Header master whose nested instance overrides _flowDestination to Detail artboard
    r9Page.layers.push(
      {
        _class: "symbolMaster",
        do_objectID: "91000000-0000-4000-8000-000000000902",
        symbolID: "91000000-0000-4000-8000-000000000903",
        name: "Atom/BackBtn",
        frame: { _class: "rect", x: 0, y: 300, width: 48, height: 44 },
        layers: [
          {
            _class: "MSImmutableHotspotLayer",
            do_objectID: "91000000-0000-4000-8000-000000000904",
            name: "BackHotspot",
            frame: { _class: "rect", x: 0, y: 0, width: 48, height: 44 },
            flow: {
              _class: "MSImmutableFlowConnection",
              do_objectID: "91000000-0000-4000-8000-000000000905",
              destinationArtboardID: "back",
              maintainScrollPosition: true,
            },
          },
        ],
      },
      {
        _class: "symbolMaster",
        do_objectID: "91000000-0000-4000-8000-000000000906",
        symbolID: "91000000-0000-4000-8000-000000000907",
        name: "Organism/HomeHeader",
        frame: { _class: "rect", x: 0, y: 360, width: 375, height: 44 },
        layers: [
          {
            _class: "symbolInstance",
            do_objectID: "91000000-0000-4000-8000-000000000908",
            symbolID: "91000000-0000-4000-8000-000000000903",
            name: "NestedBackBtn",
            frame: { _class: "rect", x: 16, y: 0, width: 48, height: 44 },
            overrideValues: [
              {
                _class: "overrideValue",
                do_objectID: "91000000-0000-4000-8000-000000000909",
                overrideName:
                  "91000000-0000-4000-8000-000000000904_flowDestination",
                value: "50000000-0000-4000-8000-000000000001",
              },
            ],
          },
        ],
      },
    );
    // Place Organism/HomeHeader on Home artboard (isFlowHome: true) without re-overriding _flowDestination
    r9Page.layers[1].layers.push({
      _class: "symbolInstance",
      do_objectID: "91000000-0000-4000-8000-000000000910",
      symbolID: "91000000-0000-4000-8000-000000000907",
      name: "HomeHeaderInst",
      frame: { _class: "rect", x: 0, y: 500, width: 375, height: 44 },
      overrideValues: [],
    });
    // Also add a type-mismatched _textStyle override pointing to the layerStyle ID 91000000-0000-4000-8000-000000000901
    r9Page.layers[1].layers[1].layers[0].overrideValues.push({
      _class: "overrideValue",
      do_objectID: "91000000-0000-4000-8000-000000000911",
      overrideName: "30000000-0000-4000-8000-000000000002_textStyle",
      value: "91000000-0000-4000-8000-000000000901",
    });

    const r9Builder = path.join(tmpDir, "r9-spec.json");
    const r9Sketch = path.join(tmpDir, "r9.sketch");
    fs.writeFileSync(r9Builder, JSON.stringify(r9Spec));
    buildSyntheticSketch(r9Sketch, r9Builder);

    const r9Audit = runPython(PY_AUDIT, ["--sketch", r9Sketch]);
    assert.equal(r9Audit.status, 1);
    const r9Report = JSON.parse(r9Audit.stdout);
    const r9Codes = new Set(r9Report.findings.map((f) => f.code));
    assert.ok(r9Codes.has("REF-DANGLING-OVERRIDE-STYLE"));
    assert.ok(!r9Codes.has("FLOW-HOME-DEAD-BACK-BUTTON"));

    // 5. Verify _build_wait_open_js and _build_close_copy_by_path_js require full path match,
    //    diff_sketch_archives_offline catches regular layer style.fills drift, and directory scans do not leak FDs
    const closeCheck = spawnSync(
      "python3",
      [
        "-B",
        "-c",
        `import os, sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(SCRIPTS_DIR)})
import sketch_mcp_roundtrip as rt
import sketch_export_manifest as em

wait_js = rt._build_wait_open_js("ANCHOR-1", "/tmp/copy.sketch")
assert "Boolean(d.path) && String(d.path) === expectedPath" in wait_js, wait_js

close_js = rt._build_close_copy_by_path_js("ANCHOR-1", "/tmp/copy.sketch", "COPY-DOC-1")
assert "pathStr === expectedPath" in close_js, close_js
assert "!pathStr && Boolean(expectedDocId) && idStr === expectedDocId" in close_js, close_js

# Check FD count stays constant across 30 _validate_pinned_dir_fd scans
test_dir = Path(sys.argv[1]) / "fd-leak-check"
test_dir.mkdir(parents=True, exist_ok=True)
os.chmod(test_dir, 0o700)
dir_fd = em._open_pinned_export_dir(test_dir)
try:
    probe_before = os.dup(0)
    os.close(probe_before)
    for _ in range(30):
        em._validate_pinned_dir_fd(dir_fd, test_dir)
        sfd, sname = em._create_pinned_stage_dir(dir_fd, ".stage-", test_dir)
        em._cleanup_pinned_stage_dir(dir_fd, sfd, sname)
    probe_after = os.dup(0)
    os.close(probe_after)
    assert probe_after == probe_before, f"FD leaked: before={probe_before}, after={probe_after}"
finally:
    os.close(dir_fd)

import coretext_measure as cm

# Verify Run 2 with explicit named font clears inherited uiUsage from Run 1
mixed_layer = {
    "_class": "text",
    "do_objectID": "t-mixed",
    "name": "MixedFontText",
    "textBehaviour": 1,
    "frame": {"x": 0, "y": 0, "width": 200, "height": 20},
    "attributedString": {
        "string": "9:41 标题",
        "attributes": [
            {
                "location": 0,
                "length": 5,
                "attributes": {
                    "MSAttributedStringFontAttribute": {
                        "attributes": {"NSCTFontUIUsageAttribute": "CTFontRegularUsage", "size": 14}
                    }
                },
            },
            {
                "location": 5,
                "length": 2,
                "attributes": {
                    "MSAttributedStringFontAttribute": {
                        "attributes": {"name": "PingFangSC-Semibold", "size": 16}
                    }
                },
            },
        ],
    },
}
mixed_spec = cm._extract_text_layer_spec(mixed_layer, {})
assert mixed_spec["runs"][0]["uiUsage"] == "CTFontRegularUsage", mixed_spec
assert mixed_spec["runs"][1]["fontName"] == "PingFangSC-Semibold", mixed_spec
assert mixed_spec["runs"][1]["uiUsage"] is None, mixed_spec

# Verify horizontal Row Stack with alignItems == 3 (Stretch) updates non-text sibling height to inner_h
stretch_row = {
    "_class": "group",
    "frame": {"x": 0, "y": 0, "width": 300, "height": 20},
    "groupLayout": {
        "_class": "MSImmutableFlexGroupLayout",
        "flexDirection": 0,
        "alignItems": 3,
        "verticalSizing": 1,
        "padding": 0,
    },
    "layers": [
        {"_class": "rectangle", "name": "BgBar", "isVisible": True, "frame": {"x": 120, "y": 0, "width": 80, "height": 20}},
        {"_class": "text", "name": "Label", "isVisible": True, "textBehaviour": 1, "frame": {"x": 0, "y": 0, "width": 100, "height": 40}},
    ],
}
cm._reflow_vertical_flex_group(stretch_row)
assert stretch_row["frame"]["height"] == 40, stretch_row
assert stretch_row["layers"][0]["frame"]["height"] == 40, stretch_row["layers"][0]

# Verify SymbolInstance without overrides is collected when its master contains a textBehaviour == 1 text layer inside a Group
master_with_auto = {
    "_class": "symbolMaster",
    "do_objectID": "m-1",
    "symbolID": "sym-1",
    "frame": {"x": 0, "y": 0, "width": 200, "height": 20},
    "layers": [
        {
            "_class": "group",
            "do_objectID": "grp-1",
            "isVisible": True,
            "frame": {"x": 0, "y": 0, "width": 200, "height": 20},
            "layers": [
                {"_class": "text", "do_objectID": "mt-1", "isVisible": True, "textBehaviour": 1, "frame": {"x": 0, "y": 0, "width": 200, "height": 20}}
            ],
        }
    ],
}
auto_paths = cm._collect_master_auto_text_paths(master_with_auto, {"sym-1": master_with_auto}, [])
assert auto_paths == ["mt-1"], auto_paths
resolved_grouped = cm._resolve_nested_override_text_layer(master_with_auto, auto_paths[0], {"sym-1": master_with_auto}, [])
assert resolved_grouped is not None and resolved_grouped[0]["do_objectID"] == "mt-1", resolved_grouped
static_ivs = cm._collect_master_static_leaf_intervals(master_with_auto, set(auto_paths), {"sym-1": master_with_auto}, [])
assert static_ivs == [], static_ivs

# Verify _merge_nested_instance_overrides inherits nested symbolInstance default overrides while allowing outer overrides to win
inner_sym_master = {
    "_class": "symbolMaster",
    "do_objectID": "m-inner",
    "symbolID": "sym-inner",
    "frame": {"x": 0, "y": 0, "width": 180, "height": 22},
    "layers": [
        {
            "_class": "text",
            "do_objectID": "t-inner",
            "isVisible": True,
            "textBehaviour": 1,
            "frame": {"x": 0, "y": 0, "width": 180, "height": 22},
        }
    ],
}
outer_sym_master = {
    "_class": "symbolMaster",
    "do_objectID": "m-outer",
    "symbolID": "sym-outer",
    "frame": {"x": 0, "y": 0, "width": 200, "height": 38},
    "layers": [
        {
            "_class": "symbolInstance",
            "do_objectID": "inst-nested",
            "symbolID": "sym-inner",
            "isVisible": True,
            "frame": {"x": 10, "y": 8, "width": 180, "height": 22},
            "overrideValues": [
                {"_class": "overrideValue", "overrideName": "t-inner_stringValue", "value": "Nested default multiline override text"}
            ],
        }
    ],
}
sym_map = {"sym-inner": inner_sym_master, "sym-outer": outer_sym_master}
merged_ovs = cm._merge_nested_instance_overrides(outer_sym_master, sym_map, [])
assert len(merged_ovs) == 1 and merged_ovs[0]["overrideName"] == "inst-nested/t-inner_stringValue", merged_ovs
assert merged_ovs[0]["value"] == "Nested default multiline override text", merged_ovs

merged_with_outer = cm._merge_nested_instance_overrides(
    outer_sym_master,
    sym_map,
    [{"_class": "overrideValue", "overrideName": "inst-nested/t-inner_stringValue", "value": "Outer explicit override"}],
)
assert len(merged_with_outer) == 1 and merged_with_outer[0]["value"] == "Outer explicit override", merged_with_outer

# Verify _extract_archive_snapshot & diff_sketch_archives_offline detect isVisible changes on non-targeted layers
import zipfile, json
vis_before = Path(sys.argv[1]) / "vis-before.sketch"
vis_after = Path(sys.argv[1]) / "vis-after.sketch"
for p, vis_flag in ((vis_before, True), (vis_after, False)):
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("document.json", json.dumps({"_class": "document", "do_objectID": "doc-1"}))
        zf.writestr(
            "pages/p1.json",
            json.dumps({
                "_class": "page",
                "do_objectID": "page-1",
                "name": "Page 1",
                "layers": [
                    {
                        "_class": "rectangle",
                        "do_objectID": "layer-vis-1",
                        "name": "Badge",
                        "isVisible": vis_flag,
                        "frame": {"x": 0, "y": 0, "width": 40, "height": 20},
                    }
                ],
            }),
        )
vis_diff = rt.diff_sketch_archives_offline(vis_before, vis_after, set())
assert vis_diff["unexpectedDriftCount"] == 1, vis_diff
assert vis_diff["unexpectedDrifts"][0]["layerID"] == "layer-vis-1", vis_diff

# Verify SketchMCPClient bypasses HTTP_PROXY / http_proxy / ALL_PROXY when NO_PROXY is unset
import http.server, threading
proxy_hits = []
origin_hits = []

class _ProxyHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        proxy_hits.append(self.path)
        self.send_response(502)
        self.end_headers()
    def log_message(self, *args):
        pass

class _OriginHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        _ = self.rfile.read(length)
        origin_hits.append(self.path)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"jsonrpc":"2.0","id":1,"result":{"ok":true}}')
    def log_message(self, *args):
        pass

proxy_srv = http.server.HTTPServer(("127.0.0.1", 0), _ProxyHandler)
origin_srv = http.server.HTTPServer(("127.0.0.1", 0), _OriginHandler)
threading.Thread(target=proxy_srv.serve_forever, daemon=True).start()
threading.Thread(target=origin_srv.serve_forever, daemon=True).start()
old_http_proxy = os.environ.get("HTTP_PROXY")
old_http_proxy_lower = os.environ.get("http_proxy")
old_no_proxy = os.environ.get("NO_PROXY")
try:
    proxy_url = f"http://127.0.0.1:{proxy_srv.server_address[1]}"
    os.environ["HTTP_PROXY"] = proxy_url
    os.environ["http_proxy"] = proxy_url
    os.environ.pop("NO_PROXY", None)
    os.environ.pop("no_proxy", None)
    client = rt.SketchMCPClient(
        endpoint=f"http://localhost:{origin_srv.server_address[1]}/mcp",
        require_signed_sketch=False,
    )
    rpc_res = client._post_rpc("ping", {"probe": "direct"})
    assert rpc_res.get("result", {}).get("ok") is True, rpc_res
    assert len(proxy_hits) == 0, f"Proxy should not be hit: {proxy_hits}"
    assert len(origin_hits) == 1, f"Origin should be hit directly: {origin_hits}"
finally:
    if old_http_proxy is None:
        os.environ.pop("HTTP_PROXY", None)
    else:
        os.environ["HTTP_PROXY"] = old_http_proxy
    if old_http_proxy_lower is None:
        os.environ.pop("http_proxy", None)
    else:
        os.environ["http_proxy"] = old_http_proxy_lower
    if old_no_proxy is not None:
        os.environ["NO_PROXY"] = old_no_proxy
    proxy_srv.shutdown()
    origin_srv.shutdown()
    proxy_srv.server_close()
    origin_srv.server_close()

import sketch_offline_audit as soa

# 1. Verify horizontal Row Stack with justifyContent == 1 (Center) checks both main-axis X and vertical Fit height closure
row_center = {
    "_class": "group",
    "do_objectID": "row-center-1",
    "name": "RowCenter",
    "frame": {"x": 0, "y": 0, "width": 200, "height": 100},
    "groupLayout": {
        "_class": "MSImmutableFlexGroupLayout",
        "flexDirection": 0,
        "justifyContent": 1,
        "horizontalSizing": 0,
        "verticalSizing": 1,
        "padding": 0,
        "allGuttersGap": 0,
    },
    "layers": [
        {"_class": "rectangle", "do_objectID": "rc-1", "name": "Chip", "isVisible": True, "frame": {"x": 60, "y": 0, "width": 80, "height": 20}},
    ],
}
row_findings = []
soa._check_flex_group_closure(row_center, "page-1", "ab-1", row_findings)
row_codes = [f["code"] for f in row_findings]
assert "FLEX-CONTAINER-HEIGHT-UNCLOSED" in row_codes, row_findings
assert "FLEX-CHILD-X-MISMATCH" not in row_codes, row_findings

# 2. Verify top-level HotSpot on Freeform control does NOT trigger HOTSPOT-FLEX-DESYNC when artboard also has a Flex stack
mix_sketch = Path(sys.argv[1]) / "mixed-freeform-flex.sketch"
with zipfile.ZipFile(mix_sketch, "w") as zf:
    zf.writestr("meta.json", json.dumps({"version": 164}))
    zf.writestr("document.json", json.dumps({"_class": "document", "do_objectID": "doc-mix"}))
    zf.writestr(
        "pages/p1.json",
        json.dumps({
            "_class": "page",
            "do_objectID": "page-mix",
            "name": "Page 1",
            "layers": [
                {
                    "_class": "artboard",
                    "do_objectID": "ab-mix",
                    "name": "Detail",
                    "frame": {"x": 0, "y": 0, "width": 375, "height": 812},
                    "layers": [
                        {
                            "_class": "rectangle",
                            "do_objectID": "nav-btn",
                            "name": "NavActionBtn",
                            "isVisible": True,
                            "frame": {"x": 16, "y": 0, "width": 48, "height": 44},
                        },
                        {
                            "_class": "group",
                            "do_objectID": "body-flex",
                            "name": "BodyStack",
                            "isVisible": True,
                            "frame": {"x": 16, "y": 80, "width": 343, "height": 48},
                            "groupLayout": {
                                "_class": "MSImmutableFlexGroupLayout",
                                "flexDirection": 1,
                                "horizontalSizing": 0,
                                "verticalSizing": 1,
                                "padding": 0,
                            },
                            "layers": [
                                {
                                    "_class": "rectangle",
                                    "do_objectID": "flex-card",
                                    "name": "CardItem",
                                    "isVisible": True,
                                    "frame": {"x": 0, "y": 0, "width": 343, "height": 48},
                                }
                            ],
                        },
                        {
                            "_class": "MSImmutableHotspotLayer",
                            "do_objectID": "hs-nav",
                            "name": "HotSpot/Nav",
                            "targetLayerID": "nav-btn",
                            "frame": {"x": 16, "y": 0, "width": 48, "height": 44},
                            "flow": {"_class": "MSImmutableFlowConnection", "do_objectID": "fl-nav", "destinationArtboardID": "ab-mix"},
                        },
                    ],
                }
            ],
        }),
    )
mix_res = soa.run_offline_audit(mix_sketch)
mix_codes = [f["code"] for f in mix_res["findings"]]
assert "HOTSPOT-FLEX-DESYNC" not in mix_codes, mix_res["findings"]

# 3. Verify ZIP bomb (>100x compression ratio) is rejected before reading members into memory
bomb_sketch = Path(sys.argv[1]) / "bomb.sketch"
with zipfile.ZipFile(bomb_sketch, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    zf.writestr("document.json", b'{"_class":"document","do_objectID":"d-bomb"}')
    zf.writestr("meta.json", b'{"version":164}')
    zf.writestr("unused-huge.bin", b"\\x00" * (4 * 1024 * 1024))
bomb_audit = soa.run_offline_audit(bomb_sketch)
assert bomb_audit["passed"] is False, bomb_audit
assert any(f["code"] == "ARCHIVE-ZIP-BUDGET-EXCEEDED" for f in bomb_audit["findings"]), bomb_audit
try:
    cm.audit_and_rebake_sketch(bomb_sketch)
    raise AssertionError("Expected audit_and_rebake_sketch to reject high-ratio ZIP member")
except RuntimeError as exc:
    assert "compression ratio limit" in str(exc), exc
`,
        tmpDir,
      ],
      { encoding: "utf8", env: PY_ENV },
    );
    assert.equal(closeCheck.status, 0, closeCheck.stderr);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
