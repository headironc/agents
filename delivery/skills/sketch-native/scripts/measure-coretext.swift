#!/usr/bin/env swift
import Darwin
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
        "CTFontSemiboldUsage",
        "CTFontBoldUsage",
        ".SFNS-Regular",
        ".SFNS-Medium",
        ".SFUI-Regular",
        "system",
        "System"
    ]
    if !usage.isEmpty || systemTokens.contains(rawName) || rawName.isEmpty {
        let effectiveUsage: String
        if !usage.isEmpty {
            effectiveUsage = usage
        } else if rawName.hasPrefix("CTFont") && rawName.hasSuffix("Usage") {
            effectiveUsage = rawName
        } else if rawName == ".SFNS-Medium" {
            effectiveUsage = "CTFontMediumUsage"
        } else {
            effectiveUsage = "CTFontRegularUsage"
        }
        let attrs: [CFString: Any] = [
            "NSCTFontUIUsageAttribute" as CFString: effectiveUsage as CFString,
            kCTFontSizeAttribute: size
        ]
        let desc = CTFontDescriptorCreateWithAttributes(attrs as CFDictionary)
        let descFont = CTFontCreateWithFontDescriptor(desc, size, nil)
        let psName = CTFontCopyPostScriptName(descFont) as String
        if psName.hasPrefix(".SF") || psName.contains("SFNS") || psName.contains("SFUI") {
            return (descFont, true)
        }
        let uiType: CTFontUIFontType = (effectiveUsage == "CTFontEmphasizedUsage" || effectiveUsage == "CTFontBoldUsage")
            ? .emphasizedSystem
            : .system
        if let sysFont = CTFontCreateUIFontForLanguage(uiType, size, nil) {
            return (sysFont, true)
        }
        return (descFont, true)
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
    return withUnsafeBytes(of: &minLH) { minRaw in
        withUnsafeBytes(of: &maxLH) { maxRaw in
            withUnsafeBytes(of: &pSpace) { pSpaceRaw in
                let settings: [CTParagraphStyleSetting] = [
                    CTParagraphStyleSetting(
                        spec: .minimumLineHeight,
                        valueSize: MemoryLayout<CGFloat>.size,
                        value: minRaw.baseAddress!
                    ),
                    CTParagraphStyleSetting(
                        spec: .maximumLineHeight,
                        valueSize: MemoryLayout<CGFloat>.size,
                        value: maxRaw.baseAddress!
                    ),
                    CTParagraphStyleSetting(
                        spec: .paragraphSpacing,
                        valueSize: MemoryLayout<CGFloat>.size,
                        value: pSpaceRaw.baseAddress!
                    )
                ]
                return CTParagraphStyleCreate(settings, settings.count)
            }
        }
    }
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
            let rHasFontName = !(r.fontName ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            let rHasUIUsage = !(r.uiUsage ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            let effectiveRunFontName: String? = (rHasFontName || rHasUIUsage) ? r.fontName : item.fontName
            let effectiveRunUIUsage: String? = (rHasFontName || rHasUIUsage) ? r.uiUsage : item.uiUsage
            let (rFont, _) = createResolvedFont(
                fontName: effectiveRunFontName,
                uiUsage: effectiveRunUIUsage,
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
    var totalParagraphSpacing = 0.0

    for (pIdx, pText) in rawParagraphs.enumerated() {
        let pNS = pText as NSString
        let pLen = pNS.length
        let pStart = globalUTF16Cursor
        let pEnd = globalUTF16Cursor + pLen

        var effectiveParaSpacing = paraSpacing
        if !resolvedRuns.isEmpty {
            var matchedSpacing: Double? = nil
            for rr in resolvedRuns {
                let overlaps: Bool
                if pLen == 0 {
                    overlaps = (rr.start <= pStart && pStart <= rr.end)
                } else {
                    overlaps = (min(pEnd, rr.end) > max(pStart, rr.start))
                }
                if overlaps {
                    matchedSpacing = rr.paragraphSpacing
                }
            }
            if let ms = matchedSpacing {
                effectiveParaSpacing = ms
            }
        }
        if pIdx < rawParagraphs.count - 1 {
            totalParagraphSpacing += effectiveParaSpacing
        }

        if pLen == 0 {
            var emptyLineH = singleLineH
            if !resolvedRuns.isEmpty {
                for rr in resolvedRuns {
                    if rr.start <= pStart && pStart <= rr.end {
                        emptyLineH = max(emptyLineH, rr.lineHeight)
                    }
                }
            }
            measuredLines.append(
                MeasuredLine(
                    index: lineIndex,
                    location: globalUTF16Cursor,
                    length: 0,
                    text: "",
                    width: 0.0,
                    lineHeight: emptyLineH
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

    let sumLineHeights = measuredLines.reduce(0.0) { $0 + $1.lineHeight }
    let totalHeight = sumLineHeights + totalParagraphSpacing
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

func writePrivateFileNofollow(path: String, data: Data) throws {
    let rawAbs: String
    if path.hasPrefix("/") {
        rawAbs = path
    } else {
        rawAbs = FileManager.default.currentDirectoryPath + "/" + path
    }
    var parts: [String] = []
    for seg in rawAbs.split(separator: "/", omittingEmptySubsequences: true) {
        let s = String(seg)
        if s == "." {
            continue
        } else if s == ".." {
            if !parts.isEmpty {
                parts.removeLast()
            }
        } else {
            parts.append(s)
        }
    }
    guard let leafName = parts.last else {
        throw NSError(domain: "measure-coretext", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid output path: \(path)"])
    }
    let parentParts = Array(parts.dropLast())
    let uid = getuid()

    var curFd = Darwin.open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    guard curFd >= 0 else {
        throw NSError(domain: "measure-coretext", code: Int(errno), userInfo: [NSLocalizedDescriptionKey: "Unable to open root directory"])
    }
    defer {
        if curFd >= 0 {
            Darwin.close(curFd)
        }
    }

    for (idx, part) in parentParts.enumerated() {
        if idx == 0 && (part == "tmp" || part == "var" || part == "etc") {
            var stLink = stat()
            if fstatat(curFd, part, &stLink, AT_SYMLINK_NOFOLLOW) == 0 {
                if (stLink.st_mode & S_IFMT) == S_IFLNK && stLink.st_uid == 0 {
                    let privFd = openat(curFd, "private", O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
                    guard privFd >= 0 else {
                        throw NSError(domain: "measure-coretext", code: Int(errno), userInfo: [NSLocalizedDescriptionKey: "Unable to open /private"])
                    }
                    Darwin.close(curFd)
                    curFd = privFd
                    var stPriv = stat()
                    guard fstat(curFd, &stPriv) == 0,
                          stPriv.st_uid == 0,
                          (stPriv.st_mode & (S_IWGRP | S_IWOTH)) == 0 else {
                        throw NSError(domain: "measure-coretext", code: 1, userInfo: [NSLocalizedDescriptionKey: "Untrusted /private root directory"])
                    }
                }
            }
        }

        var nextFd = openat(curFd, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        if nextFd < 0 && errno == ENOENT {
            guard mkdirat(curFd, part, 0o700) == 0 else {
                throw NSError(domain: "measure-coretext", code: Int(errno), userInfo: [NSLocalizedDescriptionKey: "Unable to create directory component \(part)"])
            }
            nextFd = openat(curFd, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        }
        guard nextFd >= 0 else {
            throw NSError(domain: "measure-coretext", code: Int(errno), userInfo: [NSLocalizedDescriptionKey: "Refusing symlink or inaccessible ancestor directory: \(part)"])
        }
        Darwin.close(curFd)
        curFd = nextFd

        var stDir = stat()
        guard fstat(curFd, &stDir) == 0, (stDir.st_mode & S_IFMT) == S_IFDIR else {
            throw NSError(domain: "measure-coretext", code: 1, userInfo: [NSLocalizedDescriptionKey: "Ancestor is not a directory: \(part)"])
        }
        if stDir.st_uid != 0 && stDir.st_uid != uid {
            throw NSError(domain: "measure-coretext", code: 1, userInfo: [NSLocalizedDescriptionKey: "Refusing ancestor owned by another user (uid=\(stDir.st_uid)): \(path)"])
        }
        if (stDir.st_mode & (S_IWGRP | S_IWOTH)) != 0 && (stDir.st_mode & S_ISVTX) == 0 {
            throw NSError(domain: "measure-coretext", code: 1, userInfo: [NSLocalizedDescriptionKey: "Refusing group/world-writable ancestor directory: \(path)"])
        }
    }

    var stParent = stat()
    guard fstat(curFd, &stParent) == 0 else {
        throw NSError(domain: "measure-coretext", code: Int(errno), userInfo: [NSLocalizedDescriptionKey: "Unable to stat parent directory"])
    }
    if stParent.st_uid != uid && (stParent.st_mode & S_ISVTX) == 0 {
        throw NSError(domain: "measure-coretext", code: 1, userInfo: [NSLocalizedDescriptionKey: "Refusing to write inside directory not owned by current user: \(path)"])
    }

    func validateExistingLeaf() throws {
        var stLeaf = stat()
        if fstatat(curFd, leafName, &stLeaf, AT_SYMLINK_NOFOLLOW) == 0 {
            let fmt = stLeaf.st_mode & S_IFMT
            if fmt == S_IFLNK {
                throw NSError(domain: "measure-coretext", code: 1, userInfo: [NSLocalizedDescriptionKey: "Refusing to write to symlinked file: \(path)"])
            }
            if fmt != S_IFREG {
                throw NSError(domain: "measure-coretext", code: 1, userInfo: [NSLocalizedDescriptionKey: "Refusing to overwrite non-regular file: \(path)"])
            }
            if stLeaf.st_uid != uid {
                throw NSError(domain: "measure-coretext", code: 1, userInfo: [NSLocalizedDescriptionKey: "Refusing to overwrite file not owned by current user: \(path)"])
            }
            if stLeaf.st_nlink > 1 {
                throw NSError(domain: "measure-coretext", code: 1, userInfo: [NSLocalizedDescriptionKey: "Refusing to overwrite hard-linked file: \(path)"])
            }
        } else if errno != ENOENT {
            throw NSError(domain: "measure-coretext", code: Int(errno), userInfo: [NSLocalizedDescriptionKey: "Failed to stat existing target: \(path)"])
        }
    }

    try validateExistingLeaf()

    let tmpName = ".\(leafName).tmp-\(getpid())-\(UUID().uuidString)"
    let tmpFd = openat(curFd, tmpName, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, mode_t(0o600))
    guard tmpFd >= 0 else {
        throw NSError(domain: "measure-coretext", code: Int(errno), userInfo: [NSLocalizedDescriptionKey: "Failed to create temporary output file in parent directory"])
    }
    var renamed = false
    defer {
        if !renamed {
            _ = unlinkat(curFd, tmpName, 0)
        }
    }
    do {
        guard fchmod(tmpFd, mode_t(0o600)) == 0 else {
            Darwin.close(tmpFd)
            throw NSError(domain: "measure-coretext", code: Int(errno), userInfo: [NSLocalizedDescriptionKey: "fchmod 0600 failed"])
        }
        try data.withUnsafeBytes { rawBuf in
            guard let base = rawBuf.baseAddress else { return }
            var offset = 0
            while offset < rawBuf.count {
                let written = Darwin.write(tmpFd, base.advanced(by: offset), rawBuf.count - offset)
                if written < 0 {
                    if errno == EINTR { continue }
                    throw NSError(domain: "measure-coretext", code: Int(errno), userInfo: [NSLocalizedDescriptionKey: "write failed"])
                }
                offset += written
            }
        }
        _ = fsync(tmpFd)
        Darwin.close(tmpFd)

        try validateExistingLeaf()
        guard renameat(curFd, tmpName, curFd, leafName) == 0 else {
            throw NSError(domain: "measure-coretext", code: Int(errno), userInfo: [NSLocalizedDescriptionKey: "renameat failed"])
        }
        renamed = true
    } catch {
        throw error
    }
}

if let outPath = outputPath {
    do {
        guard let outData = (jsonString + "\n").data(using: .utf8) else {
            fputs("Error: failed to encode UTF-8 output data\n", stderr)
            exit(1)
        }
        try writePrivateFileNofollow(path: outPath, data: outData)
    } catch {
        fputs("Error: failed to write output to \(outPath): \(error)\n", stderr)
        exit(1)
    }
}
print(jsonString)
exit(0)
