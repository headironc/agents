#!/usr/bin/env node
// Contract subject: `prose-check`.
//
// Checks two sentence-level conventions in [writing conventions](../delivery/policy/writing.md).
//
// Usage: node check-prose.mjs [grades] [--exclude PREFIX]... [--changed FILE] [--fix]
//                             [--errors-only] [--format json] PATH...
//        node check-prose.mjs --version
//
// Advises on Chinese sentence length and enforces spacing between Chinese characters and Latin
// letters or digits. The other sentence-level conventions need a reader's judgement. Exits 0 when
// no spacing error remains, 1 on a spacing error, and 2 on a usage error.
//
// The length thresholds belong to Chinese, so each run of prose is first placed in the language it is
// written in rather than in whichever language it contains: the count of Chinese characters against
// the count of Latin words, taken over the sentence and over its paragraph. Dividing the sentences
// knows the same seam, because a Latin sentence ends at a mark the Chinese rule does not divide on
// and the two would otherwise be placed as one. Spacing is decided without that question, because
// two scripts that meet need their space in either language.
//
// `--version` prints one bare token, which is what a consumer's tool manifest matches against.
//
// `--errors-only` lists what fails the run and nothing else. Length findings are editorial advice,
// so where a gate reads the output they would bury spacing errors. The summary counts them either
// way, so nothing is held back in silence: the text line reads them out as before, and JSON uses
// `cautionsNotListed` to expose the count omitted from its findings array.
// It is for a caller reading a whole tree; an author reads their own file with the cautions on.
//
// `--changed FILE` scopes the report to the paragraphs a caller says this change touched, given as
// `<path>:<start>-<end>` or `<path>:<line>`, one per line, `#` starting a comment. A file with no
// entry reports nothing, and a relative path on either side resolves against this run's working
// directory, with symbolic links in it opened where the file exists. Deriving those ranges means
// reading Git, which belongs to the caller, so this tool
// takes them rather than computing them; for a hunk that only deletes, the caller writes the line
// the deletion landed beside, since nothing on the new side names it. A range that reaches no
// scanned file is counted rather than refused, because a caller deriving ranges from a diff has
// entries for files that are not Markdown or that `--exclude` removed. Every run says how many
// findings fell outside the change, because a scoped run that reported nothing else would read like
// a clean one. It refuses `--fix`: the repair loop reasons about a whole file, and one space can be
// what makes an earlier one safe.
//
// The `grades` subcommand lists the words that grade a requirement while standing outside the closed
// set the conventions admit. It decides nothing. Whether a sentence states a requirement or narrates
// behaviour is the reader's call, so the listing exits 0 with candidates as readily as without, and
// it belongs in a deliberate run after a wording rule changes rather than in a gate: a listing whose
// entries a reader dismisses every day stops being read. Hand scanning has missed this rule five
// times running, which is why the mechanical half is worth having at all.
//
// The Markdown is read through a CommonMark syntax tree rather than line by line. Which construct a
// line belongs to depends on its context, and every rule here is about what a reader parses, so the
// parser owns that question. This file is the source; `delivery/tools/check-prose.mjs` is the
// bundled product that ships.

import fs from "node:fs";
import path from "node:path";
import { parse, postprocess, preprocess } from "micromark";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { frontmatter } from "micromark-extension-frontmatter";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";

// A consumer pins this tool the way it pins every other one, by a version its own checker can match
// against a manifest entry. Adding or removing a rule changes what a clean run means, so that is a
// major bump — and so is a change to which passages a rule reaches, by the same reason rather than
// by the same words: a document that passed can now fail, or stop failing, without the rule list
// moving. An option a caller may pass is a minor bump, a repair or a message change neither.
//
// 2.0.0 places a run of prose in the language it is written in, where 1.0.0 measured any run
// carrying a Chinese character. It also added `--errors-only` and `cautionsNotListed`, which alone
// would have been a minor bump: pinning the earlier token while passing the new option gets a
// usage error rather than a misreading, but the token has to move for the run's meaning either way.
// 3.0.0 makes sentence length advisory: the exit status no longer rejects a long sentence.
const VERSION = "3.0.0";

// These thresholds identify sentences worth an editorial pass, not mechanical failures.
const CEILING = 40;
const CAUTION = 30;

// Words that grade a requirement while standing outside the four the conventions admit. The rule
// names `可以`, `不能`, `需要`, `需`, `要` and `都要`; the scenarios add `须` and reach `应该` by the
// same closed-set reading. Bare `需` and `要` stay out on purpose: measured over this repository they
// carry 17 and 42 more entries than the six below, most of them narration, and a listing that long
// is the noise this subcommand exists to avoid. An author who wants them can grep.
const GRADING_CANDIDATES = [
  // `须` inside `必须` is the admitted form, so the listing has to step over it.
  { word: "须", pattern: /(?<!必)须/g },
  { word: "需要", pattern: /需要/g },
  { word: "都要", pattern: /都要/g },
  { word: "不能", pattern: /不能/g },
  { word: "可以", pattern: /可以/g },
  { word: "应该", pattern: /应该/g },
];

const CJK = "\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff";
const LATIN = "A-Za-z0-9";
// Where a bare address stops reading as an address. The terminator belongs to the prose half as
// much as the characters do: left in the address half it is never measured, so the sentence it
// closes runs on into the next one. These marks are outside `CJK`, so the seam itself never becomes
// a boundary the spacing rule reports.
const FIRST_CHINESE = new RegExp(`[${CJK}。！？，；：、]`);

const USAGE =
  "Usage: node check-prose.mjs [grades] [--exclude PREFIX]... [--changed FILE] [--fix] [--errors-only] [--format json] PATH...\n       node check-prose.mjs --version";

function usage(message) {
  process.stderr.write(`prose-check: ${message}\n${USAGE}\n`);
  process.exit(2);
}

/**
 * The path two spellings of one file agree on.
 *
 * `path.resolve` leaves an absolute path alone, so a directory reached through a symbolic link keeps
 * a different prefix from the same directory reached by name. macOS puts the temporary directory
 * behind one, which made a range written relative to the working directory miss a command-line
 * argument naming the same file. A path that does not exist, such as a range naming a deleted or
 * non-Markdown file, has no real path and keeps the resolved one.
 */
function samePath(value) {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Reads the changed-line ranges a caller computed, as `<path>:<start>-<end>` or `<path>:<line>`.
 *
 * The caller owns the ranges because deriving them means reading Git, and this tool reads Markdown.
 * Line numbers are the ones in the file as it stands now, which is what a diff against the previous
 * revision reports for the new side. A relative path is resolved against the working directory of
 * this run, on both sides, so a caller passing `docs/x.md` in the range file and `./docs/x.md` or an
 * absolute path on the command line still matches: spelling them differently would otherwise drop
 * every finding and call it a clean run.
 *
 * A hunk that only deletes lines leaves nothing on the new side to name. The caller writes the line
 * the deletion landed beside, because the paragraphs around a removal are what the removal changed,
 * and no range at all would report the joined sentence it produced as somebody else's.
 */
function loadRanges(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    usage(`cannot read ${file}`);
  }
  const ranges = new Map();
  for (const [index, line] of text.split("\n").entries()) {
    const entry = line.trim();
    if (!entry || entry.startsWith("#")) continue;
    const match = /^(.*):(\d+)(?:-(\d+))?$/.exec(entry);
    if (!match) usage(`${file}:${index + 1}: expected <path>:<start>-<end>`);
    const start = Number(match[2]);
    const end = match[3] === undefined ? start : Number(match[3]);
    if (!start || end < start) usage(`${file}:${index + 1}: invalid range`);
    if (!match[1]) usage(`${file}:${index + 1}: range names no path`);
    const key = samePath(match[1]);
    if (!ranges.has(key)) ranges.set(key, []);
    ranges.get(key).push([start, end]);
  }
  return ranges;
}

/**
 * A finding belongs to the paragraph that carries it, not to one line inside it.
 *
 * The rendered text a rule reads has joined the wrapped lines, so a sentence spanning lines 12 to 14
 * of a paragraph starting at line 10 is found at line 10. Asking whether the change reached that one
 * line would drop the finding the author just wrote. Asking whether it reached the paragraph holds
 * wherever the change put a line there, which is every hunk that adds or replaces one. It can charge
 * an author for an untouched sentence in a paragraph they did edit, which is the safe direction and
 * still far narrower than the whole file.
 *
 * It does not hold on its own for a hunk that only deletes, which leaves no new-side line to name.
 * That case rests on the caller writing the line the deletion landed beside, which the range format
 * requires of it.
 */
function inScope(ranges, finding) {
  if (!ranges) return true;
  const spans = ranges.get(samePath(finding.file));
  if (!spans) return false;
  const last = finding.last ?? finding.line;
  return spans.some(([start, end]) => start <= last && end >= finding.line);
}

/**
 * Counts range entries naming a file this run never scanned.
 *
 * A caller that derives ranges from a diff has entries for every changed file, most of which are not
 * Markdown, and `--exclude` removes more. Refusing the run would make an ordinary change unrunnable,
 * and silence would hide a mistyped path, so the count goes in the summary beside the held findings.
 *
 * The unit is the entry the caller wrote, not the path it named, because that is what every
 * statement of this count says and what the caller can compare against its own range file. A diff
 * routinely writes several hunks for one file, so the two differ on an ordinary change.
 */
function unreachedRanges(ranges, files) {
  if (!ranges) return 0;
  const scanned = new Set(files.map((file) => samePath(file)));
  return [...ranges]
    .filter(([key]) => !scanned.has(key))
    .reduce((count, [, spans]) => count + spans.length, 0);
}

function parseArguments(argv) {
  const options = {
    mode: "check",
    exclude: [],
    format: "text",
    fix: false,
    errorsOnly: false,
    paths: [],
    ranges: null,
  };
  if (argv.length === 1 && argv[0] === "--version") {
    process.stdout.write(`${VERSION}\n`);
    process.exit(0);
  }
  // The subcommand is a leading verb, so a path can never be read as one: every path this tool
  // accepts is a directory or a name ending in `.md`.
  const rest =
    argv[0] === "grades" ? ((options.mode = "grades"), argv.slice(1)) : argv;
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--fix") {
      options.fix = true;
    } else if (flag === "--errors-only") {
      options.errorsOnly = true;
    } else if (
      flag === "--exclude" ||
      flag === "--format" ||
      flag === "--changed"
    ) {
      const value = rest[index + 1];
      if (!value || value.startsWith("--"))
        usage(`option ${flag} needs a value`);
      if (flag === "--exclude") options.exclude.push(value.replace(/\/+$/, ""));
      else if (flag === "--changed") options.ranges = loadRanges(value);
      else if (value !== "text" && value !== "json")
        usage(`unknown format: ${value}`);
      else options.format = value;
      index += 1;
    } else if (flag.startsWith("--")) {
      usage(`unknown option: ${flag}`);
    } else {
      options.paths.push(flag);
    }
  }
  if (!options.paths.length) usage("no path given");
  // The listing has nothing to repair: which grade a sentence needs follows from whether it states a
  // requirement, and that is the reader's judgement. Accepting the flag and ignoring it would let a
  // caller believe a run had rewritten something.
  if (options.mode === "grades" && options.fix) usage("grades takes no --fix");
  // The listing has no severity to filter by: a grade candidate is a question for a reader, and
  // every one of them is the same kind of question.
  if (options.mode === "grades" && options.errorsOnly)
    usage("grades takes no --errors-only");
  // The repair loop reasons about the whole file: a space it inserts can be what makes an earlier
  // one safe, so a run that repaired only part of a file would decide each candidate against a
  // different file than the one it wrote. Scoping the report is sound; scoping the repair is not.
  if (options.ranges && options.fix) usage("--changed takes no --fix");
  return options;
}

// A heading, a table cell, a quoted block and code carry compressed or verbatim text rather than
// sentences, and a comment reaches no reader at all. The walk stops at these rather than descending.
const OPAQUE = new Set([
  "heading",
  "table",
  "blockquote",
  "code",
  "html",
  "definition",
  "yaml",
  "toml",
]);

/**
 * An autolink is the address itself, and a reader does not read an address. A written link carries
 * prose in its text, so only its target drops out.
 *
 * The parser already made this distinction and the tree does not keep it: both arrive as `link`.
 * Recovering it from the target would mean guessing, because an autolink without a scheme gains one
 * in the target while `[abc](https://x.com/abc)` also ends in its own text. The source settles it:
 * a written link opens with a bracket and no autolink form does.
 */
const isAutolink = (node, source) =>
  node.type === "link" && source[node.position?.start?.offset] !== "[";

/**
 * Renders one paragraph twice, because the two rules read the same construct differently. Length
 * counts what a reader parses as prose; spacing keeps whatever renders as Latin, which includes the
 * characters of an inline code span and of a URL.
 *
 * Spacing also carries `after`, the source offset just past each rendered character, so a repair
 * lands where a reader saw the gap. A character whose source position cannot be recovered carries
 * null there and is reported without a repair rather than patched at a guessed offset.
 */
function render(
  node,
  document,
  out = { length: "", spacing: "", after: [], span: [] },
) {
  const source = document.source;
  const opaqueSpan = (value, endOffset) => {
    // Backticks and angle brackets make the inside of a span shorter than its source, so only the
    // end of the whole span is a position a repair may use. The characters also carry the span's
    // own mark, because a change of script between two of them is inside code or inside a URL,
    // where the rule does not speak and no space could be written even if it did.
    const mark = out.after.length;
    for (let index = 0; index < value.length; index += 1) {
      out.after.push(index === value.length - 1 ? endOffset : null);
      out.span.push(mark);
    }
    out.spacing += value;
  };
  for (const child of node.children ?? []) {
    if (child.type === "text") {
      out.length += child.value;
      out.spacing += child.value;
      for (const offset of characterOffsets(
        document.runs,
        child.position,
        child.value.length,
      )) {
        out.after.push(offset);
        out.span.push(null);
      }
    } else if (child.type === "inlineCode") {
      opaqueSpan(child.value, child.position?.end?.offset ?? null);
    } else if (child.type === "break") {
      out.length += " ";
      out.spacing += " ";
      out.after.push(child.position?.end?.offset ?? null);
      out.span.push(null);
    } else if (child.type === "image" || child.type === "imageReference") {
      // A reader sees a picture standing between the two scripts, and the rule asks for a space
      // because the scripts would otherwise touch. They do not touch here, and the space an author
      // would add lands beside the picture rather than between the scripts, so it settles nothing.
      // Nothing reaches the length either: the alt text describes the picture, it is not prose on
      // the page. Raw HTML gets no such reading, because `<span>` renders no glyph while `<img>`
      // does and the tree says only that it is html.
      out.spacing += " ";
      out.after.push(null);
      out.span.push(null);
    } else if (isAutolink(child, source)) {
      const value = child.children[0]?.value ?? child.url;
      const start = child.position?.start?.offset;
      const end = child.position?.end?.offset;
      // A bare address runs to the next space, so Chinese written straight after one is inside the
      // link rather than after it: the node swallows the sentence, its target becomes an address
      // the author never wrote, and both rules would go silent over real prose. The author's
      // address ended at the last character before the change of script. A delimited `<…>` autolink
      // carries its own end, so whatever sits inside it stays the address.
      // A node the tree transform built instead of the tokenizer carries no position at all: the
      // two disagree about what may precede a bare `www.`, and after a full-width mark the
      // transform fires alone. It is a literal by construction, so it is read as one. Without a
      // position nothing in it can be repaired, but the prose behind the address still has to be
      // measured — leaving it inside the address is how a whole sentence escapes both rules.
      const literal =
        start === undefined ||
        (end !== undefined && end - start === value.length);
      const seam = literal ? value.search(FIRST_CHINESE) : -1;
      if (seam > 0) {
        opaqueSpan(value.slice(0, seam), null);
        // Measured and reported, but never repaired: the same position inside an address that does
        // carry Chinese would split a working link, and nothing here can tell the two apart. The
        // finding says `position unrecoverable`, and the author clears it the way Markdown already
        // provides, by delimiting the address as `<…>`.
        const prose = value.slice(seam);
        out.length += prose;
        out.spacing += prose;
        for (let index = 0; index < prose.length; index += 1) {
          out.after.push(null);
          out.span.push(null);
        }
      } else {
        opaqueSpan(value, end ?? null);
      }
    } else {
      const before = out.after.length;
      render(child, document, out);
      // A shortcut or collapsed reference has no identifier of its own: the label is what matches
      // the definition. A space written inside it stops the reference resolving and leaves the
      // brackets standing in the text, so those positions are refused and the boundary is left to
      // the author, who can make room for it by giving the reference its own identifier. A `full`
      // reference keeps that identifier apart, so its label is ordinary prose.
      if (child.type === "linkReference" && child.referenceType !== "full") {
        for (let index = before; index < out.after.length; index += 1)
          out.after[index] = null;
      }
      // Emphasis, a link and strikethrough all close after their last character, so that character's
      // own offset sits inside the markup. Only the container's end is a position a repair may use;
      // a space written at the inner offset would stop the delimiter from closing.
      if (out.after.length > before)
        out.after[out.after.length - 1] = child.position?.end?.offset ?? null;
    }
  }
  return out;
}

// One list for both readings of a document. The tree says what each construct is; the token stream
// says where each character came from. They only agree if they are told the same grammar.
const SYNTAX = [gfm(), frontmatter(["yaml", "toml"])];

const syntaxTree = (text) =>
  fromMarkdown(text, {
    extensions: SYNTAX,
    mdastExtensions: [
      gfmFromMarkdown(),
      frontmatterFromMarkdown(["yaml", "toml"]),
    ],
  });

// What a token contributes to the text a node holds. The first two stand for their own source, one
// character for one — a line ending included, because a document written with CRLF keeps both
// characters in the value it hands back. The second list decodes to a single character however long
// it runs, so that character belongs to the whole construct. Everything absent from both
// contributes nothing: a continuation indent, the spaces before a line ending, and the two
// spellings of a hard break.
const ONE_FOR_ONE = new Set(["data", "lineEnding"]);
const DECODES_TO_ONE = new Set(["characterReference", "characterEscape"]);

/** The source runs that produce text, in order, so a character can be traced back to its place. */
function characterRuns(text) {
  const events = postprocess(
    parse({ extensions: SYNTAX })
      .document()
      .write(preprocess()(text, "utf8", true)),
  );
  const runs = [];
  for (const [kind, token] of events) {
    if (kind !== "enter") continue;
    if (ONE_FOR_ONE.has(token.type))
      runs.push({
        start: token.start.offset,
        end: token.end.offset,
        whole: false,
      });
    else if (DECODES_TO_ONE.has(token.type))
      runs.push({
        start: token.start.offset,
        end: token.end.offset,
        whole: true,
      });
  }
  return runs.sort((left, right) => left.start - right.start);
}

/**
 * The source offset just past each character of a text node.
 *
 * A character reference and an escape decode to fewer characters than they occupy, so comparing the
 * value against the source could only guess where each later character came from. The runs carry
 * the answer: one that decodes to a single character hands it the position past the whole
 * construct, which is where a space belongs and where writing one cannot land inside the markup.
 *
 * Nulls when the runs do not account for exactly the characters the node holds. A reference is one
 * construct but not always one character — `&#128512;` is an emoji JavaScript holds in two units,
 * `&fjlig;` decodes to two letters — and counting one for it would leave every later character an
 * offset short. That is not merely a wrong space: the repair would not clear the boundary it aimed
 * at, so the pass that follows would find it again and insert another, without end.
 */
function characterOffsets(runs, position, length) {
  const start = position?.start?.offset;
  const end = position?.end?.offset;
  const offsets = [];
  if (start !== undefined && end !== undefined) {
    for (const run of runs) {
      if (run.start >= end) break;
      if (run.end <= start || run.end > end) continue;
      // A node can begin inside a run: a task list item drops the space after `[ ]` from its text
      // and moves its start past it, while the run still covers that space. The tail of a run that
      // stands for its own source is the node's, one character for one, so it is clamped rather
      // than dropped. A run that decodes to a single character is not clamped, because taking it
      // would be claiming that character for this node; it falls to the count below instead.
      if (run.whole) {
        if (run.start >= start) offsets.push(run.end);
      } else
        for (let at = Math.max(run.start, start); at < run.end; at += 1)
          offsets.push(at + 1);
    }
  }
  return offsets.length === length ? offsets : new Array(length).fill(null);
}

/**
 * How many links a document points at each target, so a repair can be held against the ones it
 * would add. Counted rather than named: the same address cited twice would otherwise let an edit
 * produce a second link to a target the document already carried, which is the case the caller is
 * there to refuse.
 */
function linkTargets(text) {
  const targets = new Map();
  const walk = (node) => {
    if (node.type === "link")
      targets.set(node.url, (targets.get(node.url) ?? 0) + 1);
    for (const child of node.children ?? []) walk(child);
  };
  walk(syntaxTree(text));
  return targets;
}

/** Decides when to ask the parser what an inserted space would produce, not what it produces. */
const ADDRESS_OPENER = /^(?:www\.|https?:\/\/|ftp:\/\/)/i;

/** Every paragraph a reader sees, in source order, with the line it opens on. */
function paragraphs(text) {
  const tree = syntaxTree(text);
  // Read once for the whole document: a paragraph's characters are traced through the same runs.
  const document = { source: text, runs: characterRuns(text) };
  const blocks = [];
  const walk = (node) => {
    if (OPAQUE.has(node.type)) return;
    if (node.type === "paragraph") {
      // A finding is reported at the paragraph's first line, because the rendered text it is found
      // in has joined the wrapped lines. `last` keeps the other end, so a caller scoping to a change
      // can ask whether the change reached this paragraph at all.
      blocks.push({
        number: node.position.start.line,
        last: node.position.end.line,
        ...render(node, document),
      });
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return blocks;
}

// Two kinds of boundary. `。！？` close a Chinese sentence and are not part of what it measures.
// The second is the seam where Chinese begins behind Latin prose in one paragraph: a Latin
// terminator, whatever closes a quotation after it, then space and a Chinese character. Without it
// the Latin run and the Chinese sentence measure as one, and the pair is wrong either way — read as
// Latin the Chinese sentence escapes the ceiling, read as Chinese it is charged characters nobody
// wrote in it. The seam asks for a Chinese character after the space, so it never divides `0.3.10`,
// a file name, or an English sentence followed by another.
const SENTENCE_BOUNDARY = new RegExp(
  `([。！？])|[.!?]["'”’)\\]]*\\s+(?=[${CJK}])`,
  "g",
);

function splitSentences(text) {
  const parts = [];
  let start = 0;
  for (const match of text.matchAll(SENTENCE_BOUNDARY)) {
    // The seam divides a run written in Latin from the Chinese after it, and nothing else. A period
    // inside a Chinese sentence ends an abbreviation rather than the sentence — `用到缩写 e.g. 后面`
    // is one sentence, and dividing it there leaves two halves that each clear the ceiling the whole
    // was over. What stands ahead of the mark is placed the way everything else here is placed, by
    // the same counts. Asking merely whether it carried a Chinese character was enough while a
    // merged run measured as a whole sentence and could only over-report; once Latin prose is
    // measured on its longest Chinese stretch, the merge loses findings instead. An English
    // paragraph quoting four characters in passing kept a 53-character Chinese sentence written
    // after it from ever being divided out, and the stretch that remained was under the band, so
    // nothing was reported at all — while the same sentence behind a paragraph that quoted nothing
    // reported 53. Whether a Chinese sentence is measured cannot turn on what the English ahead of
    // it happened to quote.
    if (!match[1] && writtenInChinese(text.slice(start, match.index))) continue;
    // A Chinese terminator stays out of the sentence it closes; a Latin one belongs to the run it
    // ends, which is the Latin side of the seam.
    parts.push(
      text.slice(start, match.index + (match[1] ? 0 : match[0].length)),
    );
    start = match.index + match[0].length;
  }
  parts.push(text.slice(start));
  return parts.filter((part) => part.trim());
}

const hasChinese = (text) => new RegExp(`[${CJK}]`).test(text);
const visibleLength = (text) => text.replace(/\s/g, "").length;

// Which script a run of prose is written in, which decides whether the ceiling reaches it at all. A
// Chinese character appearing somewhere does not make the run Chinese: English prose quotes a
// search phrase, a product's message or a rule's own wording often enough, and the conventions bind
// the language a passage is actually written in. English also carries no terminator this tool
// splits on, so a paragraph of it measures as one sentence. A quotation inside would then receive
// Chinese length advice that was never meant for it. One Chinese character and one Latin word are
// comparable units. The scripts need different ceilings, so the comparison counts characters on
// one side and words on the other. A word here is letters only, because a
// number is read the same in either language and is evidence for neither: counting the digit groups
// of `版本 1.0、1.1、…` as ten Latin words handed a Chinese sentence to the language that has no
// ceiling. That is why this pattern is its own and not the character set the spacing rule uses,
// where a digit does stand against a Chinese character. Spacing stays outside this decision
// entirely: where the two scripts meet they need their space whichever language the run belongs to.
//
// The Chinese side is the total and not the longest stretch, which was measured and rejected: a
// Chinese sentence naming eight tools holds no stretch longer than a few characters, so the
// longest reading called `Node、Bun、Markdown lint、ShellCheck、…` Latin prose and lost two findings
// this repository has today. Against that, totalling reads four quoted phrases in an English
// paragraph as Chinese. The first is a rule going silent on prose someone wrote in Chinese, the
// second reports a sentence nobody can repair, and the first is the one this repository owns.
const LATIN_WORD = /[A-Za-z]+/g;
const CHINESE_CHARACTER = new RegExp(`[${CJK}]`, "g");

// The longest unbroken stretch of Chinese in a run, which is the most of a Chinese passage that run
// can hold. The marks that divide clauses belong to the stretch; the three that end a sentence do
// not, because a quotation carrying one was already divided into sentences above.
// A term is one token to a reader however it is spelled, so the run that may stand inside a stretch
// carries the marks that hold an identifier together: `check-prose.mjs`, `debug_clear_cache` and
// `CI/CD` are each one name. Whitespace contributes no length and an omitted code span leaves only
// whitespace, so neither ends a Chinese passage. A term still cannot contain a space:
// `Markdown lint` is two words and still ends the passage.
const TERM = "[A-Za-z0-9]+(?:[-_./][A-Za-z0-9]+)*";
const CHINESE_RUN = new RegExp(
  `[${CJK}，；：、]+(?:\\s*(?:${TERM}\\s*)?[${CJK}，；：、]+)*`,
  "g",
);
const longestChineseRun = (text) =>
  (text.match(CHINESE_RUN) ?? []).reduce(
    (longest, run) =>
      visibleLength(run) > visibleLength(longest) ? run : longest,
    "",
  );

const writtenInChinese = (text) =>
  (text.match(CHINESE_CHARACTER) ?? []).length >
  (text.match(LATIN_WORD) ?? []).length;

// Where an author already put a boundary. Splitting there keeps the author's own division of the
// meaning, which is what the rule asks for; the tool proposes the place and never rewrites.
const BOUNDARY = /[，；：、]/;

/** The boundary that leaves both halves within the ceiling, preferring the most even division. */
function splitHint(sentence) {
  let best = null;
  for (let index = 0; index < sentence.length; index += 1) {
    if (!BOUNDARY.test(sentence[index])) continue;
    const head = visibleLength(sentence.slice(0, index + 1));
    const tail = visibleLength(sentence.slice(index + 1));
    if (!head || !tail || head > CEILING || tail > CEILING) continue;
    const skew = Math.abs(head - tail);
    if (!best || skew < best.skew) best = { head, tail, skew };
  }
  return best && { head: best.head, tail: best.tail };
}

function lengthFindings(file, block) {
  const findings = [];
  if (!hasChinese(block.length)) return findings;
  // The paragraph decides as well as the sentence, because a Chinese sentence that enumerates Latin
  // names — a host needs these seven tools, this file renders to those two — carries more words
  // than characters while nobody would read it as English. Its paragraph settles that. The sentence
  // keeps its own say for the opposite case, a Chinese sentence standing inside English prose.
  const passage = writtenInChinese(block.length);
  for (const sentence of splitSentences(block.length)) {
    if (!hasChinese(sentence)) continue;
    // Nothing is exempt from advice. A run written in Latin is measured on the Chinese it carries
    // and on that alone: counting its Latin characters would inflate the reported length.
    // Measuring the Chinese by itself says something true either way — a quoted phrase is short and
    // reported by nobody, a quoted passage long enough to be prose of its own is reported at its own
    // length, and the author judges whether to divide it. Earlier this was
    // a threshold instead, admitting the run once its Chinese reached the caution band and then
    // measuring the whole of it: the number that reported was one the English had produced, and it
    // could only ever be an error, so a Chinese length the conventions accepted failed the gate.
    //
    // It is the longest stretch, never the sum. Four quoted phrases of eight characters are four
    // phrases, and their total is not a passage anybody wrote. A stretch runs through the marks
    // that hold a Chinese sentence together, because a quotation carrying a comma is still one
    // passage; `。` and its two companions already divide sentences above, whatever stands around
    // them.
    const measured =
      passage || writtenInChinese(sentence)
        ? sentence
        : longestChineseRun(sentence);
    const length = visibleLength(measured);
    if (length < CAUTION) continue;
    const over = length > CEILING;
    const split = over ? splitHint(measured) : null;
    findings.push({
      file,
      line: block.number,
      last: block.last,
      rule: over ? "sentence-length" : "sentence-length-caution",
      severity: "caution",
      length,
      ...(split ? { split } : {}),
      // What was measured, which for Latin prose is the Chinese stretch rather than the sentence
      // around it: a finding that quoted the English would name characters it did not count.
      text: measured.trim().slice(0, 60),
    });
  }
  return findings;
}

/**
 * Lists every candidate grading word in the block, in the order a reader meets them. The length
 * string is the one to read: an inline code span counts as nothing there, so a word quoted as an
 * identifier is not a candidate, while a word in link text is prose and stays one.
 *
 * The whole sentence travels with each candidate, because the reader decides from the sentence
 * whether the word grades a requirement or narrates behaviour, and no shorter excerpt settles that.
 */
function gradeFindings(file, block) {
  const findings = [];
  for (const sentence of splitSentences(block.length)) {
    // Offsets only order words inside their own sentence, so the sort stays there and the sentences
    // keep the order the block has.
    const hits = [];
    for (const candidate of GRADING_CANDIDATES) {
      for (const match of sentence.matchAll(candidate.pattern))
        hits.push({ at: match.index, word: candidate.word });
    }
    hits.sort((left, right) => left.at - right.at);
    for (const hit of hits) {
      // The whole sentence, never an excerpt. A length finding reports its measurement as a number
      // and only needs enough text to be recognised, but here the sentence is the evidence: cut it
      // and the candidate itself can fall outside what the reader is shown, which sends them back
      // into the file this field exists to save them from. A deliberate listing can afford the width.
      findings.push({
        file,
        line: block.number,
        last: block.last,
        rule: "grading-word",
        severity: "candidate",
        word: hit.word,
        text: sentence.trim(),
      });
    }
  }
  return findings;
}

function spacingFindings(file, block, source) {
  const findings = [];
  const text = block.spacing;
  if (!hasChinese(text)) return findings;
  let existing = null;
  // A Latin run must not touch a Chinese character on either side. The rule asks for a space only
  // between the two scripts, and that needs no guard here: a match takes one character from each
  // class, so punctuation of either width already separates them and an opening run touches nothing.
  // One character wide, with the neighbour behind a lookahead. Consuming both would step past the
  // second, and a one-character run such as `共2个` has its two boundaries on that same character.
  const missing = new RegExp(
    `[${CJK}](?=[${LATIN}])|[${LATIN}](?=[${CJK}])`,
    "g",
  );
  for (const match of text.matchAll(missing)) {
    // Both characters inside one span: the change of script is inside code or a URL. The rule is
    // about what a reader reads as prose, and no space may be written there, so reporting it would
    // be an error the author cannot clear.
    if (
      block.span[match.index] !== null &&
      block.span[match.index] === block.span[match.index + 1]
    )
      continue;
    // No column: this offset is into the rendered paragraph, which has dropped link targets and
    // joined wrapped lines, so it would point somewhere else in the source. `offset` is the source
    // position the space belongs at, which the render recovered, or null when it could not.
    const at = match.index;
    let offset = block.after[at] ?? null;
    // The space may turn what follows into a bare address, which is the compliant spelling. But a
    // literal runs to the next space, so Chinese standing behind that address joins its target: the
    // repair would hand the document a link over the author's own prose and then report success,
    // because nothing it reads afterwards is a violation. The parser is asked what the edit would
    // produce; the pattern above only decides when it is worth asking.
    if (offset !== null && ADDRESS_OPENER.test(source.slice(offset))) {
      existing ??= linkTargets(source);
      const grown = linkTargets(
        `${source.slice(0, offset)} ${source.slice(offset)}`,
      );
      if (
        [...grown].some(
          ([url, count]) =>
            count > (existing.get(url) ?? 0) && FIRST_CHINESE.test(url),
        )
      )
        offset = null;
    }
    findings.push({
      file,
      line: block.number,
      last: block.last,
      rule: "cjk-latin-spacing",
      severity: "error",
      offset,
      text: `${text.slice(Math.max(0, at - 6), at + 1)}|${text.slice(at + 1, at + 8)}`,
    });
  }
  return findings;
}

function excluded(file, prefixes) {
  const normalized = file.split(path.sep).join("/");
  return prefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

function collect(target, prefixes, out) {
  if (excluded(target, prefixes)) return;
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    usage(`cannot read ${target}`);
  }
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target).sort())
      collect(path.join(target, name), prefixes, out);
  } else if (target.endsWith(".md")) {
    out.push(target);
  }
}

const options = parseArguments(process.argv.slice(2));
const files = [];
for (const target of options.paths) collect(target, options.exclude, files);
const unreached = unreachedRanges(options.ranges, files);

if (options.mode === "grades") {
  const candidates = [];
  for (const file of files) {
    for (const block of paragraphs(fs.readFileSync(file, "utf8")))
      candidates.push(...gradeFindings(file, block));
  }
  const listed = candidates.filter((finding) =>
    inScope(options.ranges, finding),
  );
  const held = candidates.length - listed.length;
  if (options.format === "json") {
    console.log(
      JSON.stringify(
        {
          files: files.length,
          candidates: listed.length,
          ...(options.ranges
            ? { outsideChange: held, unreachedRanges: unreached }
            : {}),
          findings: listed,
        },
        null,
        2,
      ),
    );
  } else {
    for (const finding of listed) {
      console.log(
        `${finding.file}:${finding.line}: ${finding.severity}: ${finding.rule}: ${finding.word}: ${finding.text}`,
      );
    }
    // A scoped run that said nothing about what it left out would read like a clean one.
    const scope = options.ranges
      ? `, ${held} outside the change${unreached ? `, ${unreached} ranges reached no scanned file` : ""}`
      : "";
    console.log(
      `prose-check: ${files.length} files, ${listed.length} candidates${scope}`,
    );
  }
  // A listing is not a verdict. Exiting nonzero here would make every caller that reads the status
  // into a gate, which is the one thing this subcommand must not become.
  process.exitCode = 0;
} else {
  /** Inserts each missing space from the end, so an earlier offset is still valid when it is used. */
  function repair(file, text, offsets) {
    const places = [...new Set(offsets)].sort((left, right) => right - left);
    let repaired = text;
    for (const at of places)
      repaired = `${repaired.slice(0, at)} ${repaired.slice(at)}`;
    fs.writeFileSync(file, repaired);
    return places.length;
  }

  const findings = [];
  let repaired = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const found = [];
    for (const block of paragraphs(text))
      found.push(
        ...lengthFindings(file, block),
        ...spacingFindings(file, block, text),
      );
    if (options.fix) {
      // Only the spacing rule is repaired, so the file is read again to report what is left. Length
      // is never touched: where to divide a sentence is the author's judgement, not the tool's.
      //
      // A pass that inserted anything is followed by another. Every repair of a file lands in one
      // write, and a later space can be what makes an earlier one safe: the space that ends a bare
      // address is what keeps the new link off the prose behind it, and a probe that sees only its
      // own candidate would refuse a repair this very write makes harmless. Repeating terminates,
      // because a space can only separate two scripts, never bring them together.
      let current = found;
      let written = text;
      for (;;) {
        const offsets = current
          .filter(
            (finding) =>
              finding.rule === "cjk-latin-spacing" && finding.offset !== null,
          )
          .map((finding) => finding.offset);
        if (!offsets.length) break;
        repaired += repair(file, written, offsets);
        written = fs.readFileSync(file, "utf8");
        current = [];
        for (const block of paragraphs(written)) {
          current.push(
            ...lengthFindings(file, block),
            ...spacingFindings(file, block, written),
          );
        }
      }
      findings.push(...current);
      continue;
    }
    findings.push(...found);
  }

  // A finding outside the lines this run was scoped to belongs to whoever wrote them. Reporting it
  // here would make every edit to a file carry that file's whole backlog, which is what makes an
  // unclean file too expensive to touch at all.
  const reported = findings.filter((finding) =>
    inScope(options.ranges, finding),
  );
  const held = findings.length - reported.length;
  const errors = reported.filter((finding) => finding.severity === "error");
  // A length caution never decides the run. Listing every one of them where a gate reads the output
  // can drown the spacing errors that do decide it. The summary still counts them, so a held-back
  // caution is never silent, and an author running the tool over their own file sees each one.
  const listed = options.errorsOnly ? errors : reported;
  // The text summary always carries the caution count, and JSON leaves a reader to subtract: the
  // findings hold both severities, so the count is in there. Filtering breaks that subtraction and
  // makes the two answers identical, an empty listing with no caution and an empty listing with
  // every caution held back. So the filtered run says how many it held, the way a scoped run says
  // what it left outside the change.
  if (options.format === "json") {
    console.log(
      JSON.stringify(
        {
          files: files.length,
          errors: errors.length,
          ...(options.errorsOnly
            ? { cautionsNotListed: reported.length - errors.length }
            : {}),
          ...(options.ranges
            ? { outsideChange: held, unreachedRanges: unreached }
            : {}),
          ...(options.fix ? { repaired } : {}),
          findings: listed,
        },
        null,
        2,
      ),
    );
  } else {
    for (const finding of listed) {
      const detail = finding.length
        ? `${finding.length} chars`
        : "missing space";
      // Only a spacing finding carries `offset`, and null there means the render could not recover
      // where in the source the space belongs. That one is the author's to place by hand, and saying
      // nothing makes it read like every other line: `--fix` leaves it, and a second run repeats it
      // word for word. The two suffixes cannot meet, since `split` belongs to a length finding.
      const hint = finding.split
        ? ` | split ${finding.split.head}+${finding.split.tail}`
        : finding.offset === null
          ? " | position unrecoverable"
          : "";
      console.log(
        `${finding.file}:${finding.line}: ${finding.severity}: ${finding.rule}: ${detail}: ${finding.text}${hint}`,
      );
    }
    const fixed = options.fix ? `, ${repaired} spaces inserted` : "";
    // A scoped run that said nothing about what it left out would read like a clean one.
    const scope = options.ranges
      ? `, ${held} outside the change${unreached ? `, ${unreached} ranges reached no scanned file` : ""}`
      : "";
    console.log(
      `prose-check: ${files.length} files, ${errors.length} errors, ${reported.length - errors.length} cautions${scope}${fixed}`,
    );
  }
  process.exitCode = errors.length ? 1 : 0;
}
