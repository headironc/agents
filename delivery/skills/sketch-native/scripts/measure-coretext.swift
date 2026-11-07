#!/usr/bin/env swift
import Foundation
#if canImport(CoreFoundation) && canImport(CoreGraphics) && canImport(CoreText)
import CoreFoundation
import CoreGraphics
import CoreText
#endif

struct TextRunInput: Codable {
    let location: Int
    let length: Int
    let fontName: String?
    let uiUsage: String?
    let fontSize: Double?
    let lineHeight: Double?
    let paragraphSpacing: Double?
    let kerning: Double?
}

struct MeasureInputItem: Codable {
    let id: String
    let text: String
    let fontName: String?
    let uiUsage: String?
    let fontSize: Double
    let lineHeight: Double?
    let width: Double
    let paragraphSpacing: Double?
    let kerning: Double?
    let textBehaviour: Int?
    let runs: [TextRunInput]?
}

struct MeasuredLine: Codable {
    let index: Int
    let location: Int
    let length: Int
    let text: String
    let width: Double
    let lineHeight: Double
}

struct MeasureOutputItem: Codable {
    let id: String
    let text: String
    let requestedFontName: String
    let resolvedPostScriptName: String
    let usedSystemUIFont: Bool
    let fontSize: Double
    let singleLineHeight: Double
    let width: Double
    let paragraphSpacing: Double
    let lineCount: Int
    let lines: [MeasuredLine]
    let bakedHeight: Double
}

struct MeasureBatchReport: Codable {
    let tool: String
    let engine: String
    let count: Int
    let results: [MeasureOutputItem]
}

func printHelp() {
    let help = """
    Usage: measure-coretext.swift [--input <specs.json|->] [--output <out.json>] [--pretty]

    Measures exact macOS CoreText line breaks (CTTypesetterSuggestLineBreak / CTFramesetter)
    and baked text heights for Sketch text layers (textBehaviour == 1) and SymbolInstance overrides.

    Input JSON format (array of objects or {"items": [...]}):
      [
        {
          "id": "layer-uuid",
          "text": "账户安全验证已开启",
          "fontName": "PingFangSC-Regular",
          "uiUsage": null,
          "fontSize": 15,
          "lineHeight": 22,
          "width": 311,
          "paragraphSpacing": 0,
          "kerning": 0
        }
      ]

    System UI font support:
      Set "uiUsage": "CTFontRegularUsage" or "fontName": "CTFontRegularUsage" / ".SFNS-Regular" / "system"
      to resolve via CTFontCreateUIFontForLanguage(.system, size, nil).
    """
    print(help)
}

#if canImport(CoreFoundation) && canImport(CoreGraphics) && canImport(CoreText)
func createResolvedFont(fontName: String?, uiUsage: String?, size: CGFloat) -> (CTFont, Bool) {
    let usage = (uiUsage ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let rawName = (fontName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let systemTokens: Set<String> = [
        "CTFontRegularUsage",
        "CTFontEmphasizedUsage",
        "CTFontMediumUsage",
        ".SFNS-Regular",
        ".SFUI-Regular",
        "system",
        "System"
    ]
    if !usage.isEmpty || systemTokens.contains(rawName) || rawName.isEmpty {
        let uiType: CTFontUIFontType = (usage == "CTFontEmphasizedUsage" || rawName == "CTFontEmphasizedUsage")
            ? .emphasizedSystem
            : .system
        if let sysFont = CTFontCreateUIFontForLanguage(uiType, size, nil) {
            return (sysFont, true)
        }
    }
    let font = CTFontCreateWithName(rawName as CFString, size, nil)
    return (font, false)
}

func defaultSingleLineHeight(font: CTFont, explicitLineHeight: Double?) -> Double {
    if let explicit = explicitLineHeight, explicit > 0 {
        return explicit
    }
    let ascent = Double(CTFontGetAscent(font))
    let descent = Double(CTFontGetDescent(font))
    let leading = max(0.0, Double(CTFontGetLeading(font)))
    return ceil(ascent + descent + leading)
}

func makeParagraphStyle(lineHeight: Double, paragraphSpacing: Double) -> CTParagraphStyle {
    var minLH = CGFloat(lineHeight)
    var maxLH = CGFloat(lineHeight)
    var pSpace = CGFloat(paragraphSpacing)
    let settings: [CTParagraphStyleSetting] = [
        withUnsafeBytes(of: &minLH) { raw in
            CTParagraphStyleSetting(
                spec: .minimumLineHeight,
                valueSize: MemoryLayout<CGFloat>.size,
                value: raw.baseAddress!
            )
        },
        withUnsafeBytes(of: &maxLH) { raw in
            CTParagraphStyleSetting(
                spec: .maximumLineHeight,
                valueSize: MemoryLayout<CGFloat>.size,
                value: raw.baseAddress!
            )
        },
        withUnsafeBytes(of: &pSpace) { raw in
            CTParagraphStyleSetting(
                spec: .paragraphSpacing,
                valueSize: MemoryLayout<CGFloat>.size,
                value: raw.baseAddress!
            )
        }
    ]
    return CTParagraphStyleCreate(settings, settings.count)
}

func measureItem(_ item: MeasureInputItem) -> MeasureOutputItem {
    let size = CGFloat(max(1.0, item.fontSize))
    let (ctFont, usedSystemUI) = createResolvedFont(
        fontName: item.fontName,
        uiUsage: item.uiUsage,
        size: size
    )
    let resolvedPSName = (CTFontCopyPostScriptName(ctFont) as String)
    let singleLineH = defaultSingleLineHeight(font: ctFont, explicitLineHeight: item.lineHeight)
    let paraSpacing = max(0.0, item.paragraphSpacing ?? 0.0)
    let kerningVal = item.kerning ?? 0.0
    let constrainedWidth = max(1.0, item.width)
    let paragraphStyle = makeParagraphStyle(lineHeight: singleLineH, paragraphSpacing: paraSpacing)

    struct ResolvedRun {
        let start: Int
        let end: Int
        let font: CTFont
        let lineHeight: Double
        let paragraphSpacing: Double
        let kerning: Double
    }
    var resolvedRuns: [ResolvedRun] = []
    if let rawRuns = item.runs {
        for r in rawRuns where r.length > 0 {
            let rSize = CGFloat(max(1.0, r.fontSize ?? item.fontSize))
            let (rFont, _) = createResolvedFont(
                fontName: r.fontName ?? item.fontName,
                uiUsage: r.uiUsage ?? item.uiUsage,
                size: rSize
            )
            let rLH = defaultSingleLineHeight(font: rFont, explicitLineHeight: r.lineHeight ?? item.lineHeight)
            let rPSpace = max(0.0, r.paragraphSpacing ?? paraSpacing)
            let rKern = r.kerning ?? kerningVal
            resolvedRuns.append(
                ResolvedRun(
                    start: max(0, r.location),
                    end: max(0, r.location + r.length),
                    font: rFont,
                    lineHeight: rLH,
                    paragraphSpacing: rPSpace,
                    kerning: rKern
                )
            )
        }
    }
    let maxRunLineH = resolvedRuns.map { $0.lineHeight }.max() ?? singleLineH

    let nsText = item.text as NSString
    if nsText.length == 0 {
        return MeasureOutputItem(
            id: item.id,
            text: item.text,
            requestedFontName: item.fontName ?? (item.uiUsage ?? "CTFontRegularUsage"),
            resolvedPostScriptName: resolvedPSName,
            usedSystemUIFont: usedSystemUI,
            fontSize: item.fontSize,
            singleLineHeight: maxRunLineH,
            width: constrainedWidth,
            paragraphSpacing: paraSpacing,
            lineCount: 1,
            lines: [
                MeasuredLine(
                    index: 0,
                    location: 0,
                    length: 0,
                    text: "",
                    width: 0.0,
                    lineHeight: maxRunLineH
                )
            ],
            bakedHeight: round(maxRunLineH)
        )
    }

    let rawParagraphs = item.text.components(separatedBy: "\n")
    var measuredLines: [MeasuredLine] = []
    var globalUTF16Cursor = 0
    var lineIndex = 0

    for pText in rawParagraphs {
        let pNS = pText as NSString
        let pLen = pNS.length
        if pLen == 0 {
            measuredLines.append(
                MeasuredLine(
                    index: lineIndex,
                    location: globalUTF16Cursor,
                    length: 0,
                    text: "",
                    width: 0.0,
                    lineHeight: singleLineH
                )
            )
            lineIndex += 1
            globalUTF16Cursor += 1
            continue
        }

        var baseAttrs: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): ctFont,
            NSAttributedString.Key(kCTParagraphStyleAttributeName as String): paragraphStyle
        ]
        if kerningVal != 0.0 {
            baseAttrs[NSAttributedString.Key(kCTKernAttributeName as String)] = NSNumber(value: kerningVal)
        }
        let attrStr = NSMutableAttributedString(string: pText, attributes: baseAttrs)
        let pStart = globalUTF16Cursor
        let pEnd = globalUTF16Cursor + pLen
        for rr in resolvedRuns {
            let interStart = max(pStart, rr.start)
            let interEnd = min(pEnd, rr.end)
            if interEnd > interStart {
                let localRange = NSRange(location: interStart - pStart, length: interEnd - interStart)
                let rPStyle = makeParagraphStyle(lineHeight: rr.lineHeight, paragraphSpacing: rr.paragraphSpacing)
                var rAttrs: [NSAttributedString.Key: Any] = [
                    NSAttributedString.Key(kCTFontAttributeName as String): rr.font,
                    NSAttributedString.Key(kCTParagraphStyleAttributeName as String): rPStyle
                ]
                if rr.kerning != 0.0 {
                    rAttrs[NSAttributedString.Key(kCTKernAttributeName as String)] = NSNumber(value: rr.kerning)
                }
                attrStr.setAttributes(rAttrs, range: localRange)
            }
        }
        let typesetter = CTTypesetterCreateWithAttributedString(attrStr as CFAttributedString)

        var start = 0
        while start < pLen {
            let count = CTTypesetterSuggestLineBreak(typesetter, start, constrainedWidth)
            let safeCount = max(1, count)
            let range = CFRange(location: start, length: min(safeCount, pLen - start))
            let ctLine = CTTypesetterCreateLine(typesetter, range)
            let lineWidth = CTLineGetTypographicBounds(ctLine, nil, nil, nil)
            let subRange = NSRange(location: range.location, length: range.length)
            let sliceText = pNS.substring(with: subRange)
            let absLineStart = globalUTF16Cursor + range.location
            let absLineEnd = absLineStart + range.length
            var effectiveLineH = singleLineH
            if !resolvedRuns.isEmpty {
                var matchedMax: Double? = nil
                for rr in resolvedRuns {
                    if min(absLineEnd, rr.end) > max(absLineStart, rr.start) {
                        matchedMax = max(matchedMax ?? 0.0, rr.lineHeight)
                    }
                }
                if let m = matchedMax {
                    effectiveLineH = m
                }
            }
            measuredLines.append(
                MeasuredLine(
                    index: lineIndex,
                    location: absLineStart,
                    length: range.length,
                    text: sliceText,
                    width: (lineWidth * 100.0).rounded() / 100.0,
                    lineHeight: effectiveLineH
                )
            )
            lineIndex += 1
            start += range.length
        }
        globalUTF16Cursor += pLen + 1
    }

    let nonEmptyParagraphBreaks = max(0, rawParagraphs.count - 1)
    let sumLineHeights = measuredLines.reduce(0.0) { $0 + $1.lineHeight }
    let totalHeight = sumLineHeights + Double(nonEmptyParagraphBreaks) * paraSpacing
    return MeasureOutputItem(
        id: item.id,
        text: item.text,
        requestedFontName: item.fontName ?? (item.uiUsage ?? "CTFontRegularUsage"),
        resolvedPostScriptName: resolvedPSName,
        usedSystemUIFont: usedSystemUI,
        fontSize: item.fontSize,
        singleLineHeight: maxRunLineH,
        width: constrainedWidth,
        paragraphSpacing: paraSpacing,
        lineCount: measuredLines.count,
        lines: measuredLines,
        bakedHeight: round(totalHeight)
    )
}
#endif

struct WrappedInput: Codable {
    let items: [MeasureInputItem]
}

var inputPath = "-"
var outputPath: String? = nil
var pretty = true

let args = Array(CommandLine.arguments.dropFirst())
var idx = 0
while idx < args.count {
    let arg = args[idx]
    switch arg {
    case "-h", "--help":
        printHelp()
        exit(0)
    case "-i", "--input":
        guard idx + 1 < args.count else {
            fputs("Error: --input requires a path\n", stderr)
            exit(2)
        }
        inputPath = args[idx + 1]
        idx += 2
    case "-o", "--output":
        guard idx + 1 < args.count else {
            fputs("Error: --output requires a path\n", stderr)
            exit(2)
        }
        outputPath = args[idx + 1]
        idx += 2
    case "--pretty":
        pretty = true
        idx += 1
    case "--compact":
        pretty = false
        idx += 1
    default:
        if !arg.hasPrefix("-") && inputPath == "-" {
            inputPath = arg
            idx += 1
        } else {
            fputs("Error: unknown argument '\(arg)'. Use --help for usage.\n", stderr)
            exit(2)
        }
    }
}

let inputData: Data
if inputPath == "-" {
    inputData = FileHandle.standardInput.readDataToEndOfFile()
} else {
    let url = URL(fileURLWithPath: inputPath)
    guard let data = try? Data(contentsOf: url) else {
        fputs("Error: unable to read input file at \(inputPath)\n", stderr)
        exit(2)
    }
    inputData = data
}

let decoder = JSONDecoder()
let items: [MeasureInputItem]
if let direct = try? decoder.decode([MeasureInputItem].self, from: inputData) {
    items = direct
} else if let wrapped = try? decoder.decode(WrappedInput.self, from: inputData) {
    items = wrapped.items
} else {
    fputs("Error: input JSON must be an array of measurement specs or {\"items\": [...]}\n", stderr)
    exit(2)
}

#if canImport(CoreFoundation) && canImport(CoreGraphics) && canImport(CoreText)
let results = items.map { measureItem($0) }
#else
fputs("Error: measure-coretext.swift requires macOS CoreText.\n", stderr)
exit(2)
#endif
let report = MeasureBatchReport(
    tool: "measure-coretext.swift",
    engine: "macOS-CoreText-CTTypesetter",
    count: results.count,
    results: results
)

let encoder = JSONEncoder()
if pretty {
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
} else {
    encoder.outputFormatting = [.sortedKeys]
}

guard let encoded = try? encoder.encode(report),
      let jsonString = String(data: encoded, encoding: .utf8) else {
    fputs("Error: failed to encode CoreText measurement report\n", stderr)
    exit(1)
}

if let outPath = outputPath {
    do {
        try (jsonString + "\n").write(toFile: outPath, atomically: true, encoding: .utf8)
    } catch {
        fputs("Error: failed to write output to \(outPath): \(error)\n", stderr)
        exit(1)
    }
}
print(jsonString)
exit(0)
