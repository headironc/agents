import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts/check-prose.mjs");

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "agents prose "));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const put = (relative, body) => {
    const file = path.join(directory, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body.endsWith("\n") ? body : `${body}\n`);
    return relative;
  };
  const run = (...args) => {
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd: directory,
      encoding: "utf8",
      timeout: 20_000,
    });
    assert.ifError(result.error);
    return { ...result, json: () => JSON.parse(result.stdout) };
  };
  return { directory, put, run };
}

const rules = (out) =>
  out
    .trim()
    .split("\n")
    .slice(0, -1)
    .map((line) => line.split(": ")[2]);

// A Chinese character or a Chinese punctuation mark, which is where a bare address stops reading as
// an address. Spelled out here rather than imported, so the tool cannot define away what it is held to.
const CHINESE = /[㐀-䶿一-鿿豈-﫿。！？，；：、]/;

test("reports a sentence past 40 characters without failing the run", (t) => {
  const f = fixture(t);
  // The sentence terminator is not counted, so the body carries the whole length.
  f.put("at.md", `${"字".repeat(40)}。`);
  f.put("over.md", `${"字".repeat(41)}。`);
  const at = f.run("at.md");
  assert.equal(at.status, 0);
  assert.match(at.stdout, /caution: sentence-length-caution: 40 chars/);
  const over = f.run("over.md");
  assert.equal(over.status, 0);
  assert.match(over.stdout, /caution: sentence-length: 41 chars/);
});

test("reports the 30-character advice band without failing the run", (t) => {
  const f = fixture(t);
  f.put("caution.md", `${"字".repeat(33)}。`);
  const result = f.run("caution.md");
  assert.equal(result.status, 0, "a caution is not a failure");
  assert.match(result.stdout, /caution: sentence-length-caution: 33 chars/);
  assert.match(result.stdout, /0 errors, 1 cautions/);
});

test("leaves a short sentence and an English paragraph alone", (t) => {
  const f = fixture(t);
  f.put("short.md", "这句很短。");
  f.put(
    "english.md",
    "This sentence is written entirely in English and carries no Chinese characters at all.",
  );
  const result = f.run("short.md", "english.md");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /2 files, 0 errors, 0 cautions/);
});

test("hides advisory sentence lengths while retaining their count", (t) => {
  const f = fixture(t);
  f.put("mixed.md", `${"字".repeat(41)}。${"言".repeat(33)}。`);
  assert.match(
    f.run("mixed.md").stdout,
    /caution: sentence-length-caution: 33 chars/,
  );
  const quiet = f.run("--errors-only", "mixed.md");
  assert.equal(quiet.status, 0);
  assert.doesNotMatch(quiet.stdout, /sentence-length: 41 chars/);
  assert.doesNotMatch(quiet.stdout, /caution: sentence-length-caution/);
  // The count is what keeps a held-back caution from passing in silence, so it stays either way.
  assert.match(quiet.stdout, /1 files, 0 errors, 2 cautions/);
  // The listing is one thing in both formats, and a caller reading JSON asked the same question.
  const json = f.run("--errors-only", "--format", "json", "mixed.md").json();
  assert.equal(json.findings.length, 0);
  assert.equal(json.cautionsNotListed, 2);
  // The case a caller cannot otherwise tell apart: an empty listing with nothing held back reads
  // exactly like an empty listing holding every caution, because `errors` is zero in both.
  f.put("quiet.md", `${"言".repeat(33)}。`);
  const quietly = f.run("--errors-only", "--format", "json", "quiet.md").json();
  assert.deepEqual(quietly, {
    files: 1,
    errors: 0,
    cautionsNotListed: 1,
    findings: [],
  });
});

test("keeps spacing errors blocking when length cautions are hidden", (t) => {
  const f = fixture(t);
  f.put("mixed-error.md", `${"字".repeat(41)}。见Node。`);
  const result = f.run("--errors-only", "mixed-error.md");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /error: cjk-latin-spacing/);
  assert.doesNotMatch(result.stdout, /caution: sentence-length/);
  assert.match(result.stdout, /1 files, 1 errors, 1 cautions/);
  const json = f
    .run("--errors-only", "--format", "json", "mixed-error.md")
    .json();
  assert.equal(json.errors, 1);
  assert.equal(json.cautionsNotListed, 1);
  assert.equal(json.findings.length, 1);
  assert.equal(json.findings[0].rule, "cjk-latin-spacing");
});

test("leaves English prose alone where it quotes a Chinese phrase", (t) => {
  const f = fixture(t);
  // English carries no terminator this tool splits on, so the paragraph measures as one sentence.
  // Under the conventions it is an English passage, which sets no numeric limit, and the quoted
  // phrase does not move it. Two delivered documents read this way before the passage decision
  // existed, and the only repair either could have taken was to stop quoting.
  f.put(
    "quoting.md",
    'For "把本地文件同步到 OSS", first use an available matching skill. Only an explicit discovery request or a confirmed missing capability enters discovery; then `把本地文件同步到 OSS` is a useful intent phrase.',
  );
  const result = f.run("quoting.md");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /1 files, 0 errors, 0 cautions/);
});

test("measures a Chinese sentence that enumerates Latin names", (t) => {
  const f = fixture(t);
  // Counted alone this sentence carries more Latin words than Chinese characters, and nobody reads
  // it as English. The paragraph around it settles the language, so length advice still reaches it.
  f.put(
    "listing.md",
    "宿主机需要 Bash、Git、jq、gh、curl、tar、unzip、python、shasum 与 zip。安装器不装系统软件，缺一个就直接失败。",
  );
  const result = f.run("listing.md");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /caution: sentence-length: 52 chars/);
});

test("reads a run of numbers as evidence for neither language", (t) => {
  const f = fixture(t);
  // Version numbers, not words. Counting each digit group as a Latin word made this Chinese
  // sentence outnumbered ten to six and suppressed Chinese length advice.
  f.put(
    "numbers.md",
    "版本 1.0、1.1、1.2、1.3、1.4、1.5、1.6、1.7、1.8、1.9 均受支持。",
  );
  const result = f.run("numbers.md");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /caution: sentence-length: 45 chars/);
});

test("keeps a Chinese sentence whole across an abbreviation inside it", (t) => {
  const f = fixture(t);
  // The period ends `e.g.`, not the sentence. Dividing there leaves two halves that each clear the
  // 40-character threshold, so the seam only ever divides a run that is Latin all through.
  f.put(
    "abbreviation.md",
    "这是原本完整的中文句子，用到缩写 e.g. 后面仍然是同一句话而且长度已经超过了规范要求的上限。",
  );
  const result = f.run("abbreviation.md");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /caution: sentence-length: 45 chars/);
});

test("measures Latin prose on the Chinese it carries, not on itself", (t) => {
  const f = fixture(t);
  // The Latin words outnumber the Chinese characters and no full stop divides them, so this run is
  // written in Latin, where no Chinese length threshold applies. What is measured is the quotation:
  // 31 characters, reported as a caution that names the Chinese rather
  // than the English around it.
  f.put(
    "quote.md",
    "The rule reads: 这一句中文很长很长很长很长很长很长很长很长超过了四十个字的上限 and the paragraph then carries on in English for long enough that the Latin words outnumber those characters by a wide margin, with no full stop anywhere before the quotation.",
  );
  const quoted = f.run("quote.md");
  assert.equal(quoted.status, 0);
  assert.match(
    quoted.stdout,
    /caution: sentence-length-caution: 31 chars: 这一句中文/,
  );
  // The same shape with a quotation past 40 characters: the author can judge whether to divide the
  // passage the finding names, without deleting it because the English around it was counted in.
  f.put(
    "long.md",
    "The rule reads: 这一句中文很长很长很长很长很长很长很长很长很长很长很长很长很长超过了四十个字的上限 and the paragraph then carries on in English for long enough that the Latin words outnumber those characters by a wide margin, with no full stop anywhere before the quotation, which is the arrangement this case is about.",
  );
  assert.match(
    f.run("long.md").stdout,
    /caution: sentence-length: 41 chars: 这一句中文/,
  );
});

test("measures a Chinese sentence standing inside English prose", (t) => {
  const f = fixture(t);
  // The opposite case, which is why the sentence keeps a say of its own: the paragraph carries more
  // Latin words than Chinese characters, and the one Chinese sentence still receives length advice.
  // The Chinese comes first, because this tool splits at `。` alone: English standing ahead
  // of a Chinese sentence in one paragraph is charged to it.
  const chinese =
    "这一句是完整的中文行文，它故意写得很长很长很长很长很长很长很长超过了四十个字的上限。";
  const english =
    "The consumer pins this tool the way it pins every other one, by a version its own checker matches against a manifest entry it carries, and that is the whole of what the pin buys here, which is why the rest of this paragraph runs on in English.";
  f.put("inside.md", `${chinese} ${english}`);
  // The same sentence in the other order. English ends at a mark this tool does not divide on, so
  // without the seam the two run together: the pair reads as Latin and this sentence disappears.
  f.put("after.md", `${english} ${chinese}`);
  const result = f.run("inside.md", "after.md");
  assert.equal(result.status, 0);
  assert.deepEqual(rules(result.stdout), [
    "sentence-length",
    "sentence-length",
  ]);
  for (const line of result.stdout.trim().split("\n").slice(0, -1))
    assert.match(line, /caution: sentence-length: 41 chars/);
});

test("divides by where the Latin run is placed, not by what it quotes", (t) => {
  const f = fixture(t);
  // The sentence carries a tool name, so its Chinese is two stretches rather than one. Asking only
  // whether a Chinese character appeared ahead of the mark left this undivided: the merged run was
  // placed in Latin, measured on the longer stretch — 26 characters, under the band — and reported
  // nothing, while the same sentence behind a paragraph quoting nothing reported 53. Whether a
  // Chinese sentence is measured cannot turn on what the English ahead of it happened to quote.
  const english =
    "and the rest of this English paragraph runs on for a good while longer so that the Latin words plainly outnumber the Chinese characters that follow them in the same paragraph, which is the arrangement this case is about and the reason it has to be written out at this length rather than summarised in a clause or two.";
  const chinese =
    "这一句中文本来就超过了四十个字的上限，中间用到 Node 这个工具的名字，后面还继续写下去直到明显超过上限为止。";
  f.put(
    "quoting.md",
    `The contract quotes 写作规范 once in passing, ${english} ${chinese}`,
  );
  f.put(
    "plain.md",
    `The contract quotes it once in passing, ${english} ${chinese}`,
  );
  // No seam at all: a comma where the full stop was, so nothing divides the paragraph and the
  // passage is measured where it sits. A term standing inside it does not end it, or whether this
  // sentence is measured would turn on the punctuation of the English ahead of it.
  f.put(
    "comma.md",
    `The contract quotes it once in passing, ${english}, ${chinese}`,
  );
  // The same, naming a file rather than a bare word. A term is one token to a reader however it is
  // spelled, so the marks that hold an identifier together do not end the passage either — this
  // repository's Chinese prose names its tools that way throughout.
  f.put(
    "dotted.md",
    `The contract quotes it once in passing, ${english}, ${chinese.replace("Node", "check-prose.mjs")}`,
  );
  for (const file of ["quoting.md", "plain.md", "comma.md"]) {
    const result = f.run(file);
    assert.equal(result.status, 0, file);
    assert.match(
      result.stdout,
      /caution: sentence-length: 53 chars: 这一句中文/,
    );
  }
  // The file name is written bare rather than in a span, so a reader parses its characters and the
  // count carries them: the same passage, eleven characters longer than the one naming `Node`.
  assert.match(
    f.run("dotted.md").stdout,
    /caution: sentence-length: 64 chars: 这一句中文/,
  );
});

test("measures Chinese across omitted code and whitespace inside Latin prose", (t) => {
  const f = fixture(t);
  const english = `${"English prose continues here ".repeat(30)}, `;
  for (const [name, separator, length] of [
    ["code", " `Node` ", 41],
    ["spaces", "  ", 41],
    ["term", "  Node  ", 45],
    ["wrapped", "\nNode\n", 45],
  ]) {
    f.put(
      `${name}.md`,
      `${english}${"字".repeat(20)}${separator}${"字".repeat(21)}。`,
    );
    const result = f.run("--format", "json", `${name}.md`);
    assert.equal(result.status, 0, name);
    assert.deepEqual(
      result.json().findings.map(({ rule, length }) => ({ rule, length })),
      [{ rule: "sentence-length", length }],
      name,
    );
  }
  f.put(
    "two-words.md",
    `${english}${"字".repeat(20)} Markdown lint ${"字".repeat(21)}。`,
  );
  assert.deepEqual(
    f.run("--format", "json", "two-words.md").json().findings,
    [],
  );
  // Invisible padding must not make a short stretch displace the one past the ceiling.
  f.put(
    "longest.md",
    `${english}${"短".repeat(10)}${" ".repeat(80)}短 separate words ${"字".repeat(41)}。`,
  );
  const longest = f.run("--format", "json", "longest.md");
  assert.equal(longest.status, 0);
  assert.equal(longest.json().findings[0].length, 41);
});

test("reports each edge of a Latin run that touches Chinese", (t) => {
  const f = fixture(t);
  f.put("spacing.md", "这里缺空格Node直接贴着汉字。");
  const result = f.run("spacing.md");
  assert.equal(result.status, 1);
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 3, "two edges and the summary");
  assert.match(
    lines[0],
    /spacing\.md:1: error: cjk-latin-spacing: missing space: 这里缺空格\|Node/,
  );
  assert.match(
    lines[1],
    /spacing\.md:1: error: cjk-latin-spacing: missing space: 缺空格Node\|直接/,
  );
});

test("asks for a space only between the two scripts, never around punctuation", (t) => {
  const f = fixture(t);
  // A line may open with Latin, and punctuation of either width already separates the scripts on
  // whichever side it falls, including the side the sources never covered.
  f.put(
    "ok.md",
    [
      "CI 在行首。",
      "这里用 Node 运行，版本 24 可用。",
      "右侧是标点，例如 CI。",
      "全角括号也算，例如（CI）。",
      "标点在左也一样，与 mock、debug_clear_cache 的清理。",
      "冒号之后同理：Node 可用。",
    ].join("\n"),
  );
  const result = f.run("ok.md");
  assert.equal(result.status, 0, result.stdout);
});

test("drops link targets and treats inline code as Latin for spacing only", (t) => {
  const f = fixture(t);
  // The URL must not count as prose, and the span's own letters still need their spaces.
  f.put(
    "links.md",
    "见[写作规范](https://example.com/a-very-long-target-that-is-not-prose)的说明。",
  );
  f.put("code.md", "这里写`code`贴着。");
  assert.equal(f.run("links.md").status, 0);
  const code = f.run("code.md");
  assert.equal(code.status, 1);
  assert.deepEqual(rules(code.stdout), [
    "cjk-latin-spacing",
    "cjk-latin-spacing",
  ]);
});

test("treats a span as nothing for length and as Latin for spacing, in one file", (t) => {
  const f = fixture(t);
  // The two rules read the same construct differently, which the policy now states. The blank line
  // keeps these two paragraphs apart, so each reports under its own number.
  f.put(
    "span.md",
    ["这里写 `code` 有空格。", "", "这里写`code`没空格。"].join("\n"),
  );
  const result = f.run("span.md");
  assert.equal(result.status, 1);
  const lines = result.stdout.trim().split("\n");
  assert.equal(
    lines.length,
    3,
    "only the unspaced paragraph reports, and it reports both edges",
  );
  assert.ok(lines.slice(0, 2).every((line) => line.startsWith("span.md:3:")));
});

test("excludes inline code from the measured length", (t) => {
  const f = fixture(t);
  // Without the exclusion this line would pass the ceiling on the identifier alone. The span is
  // spaced correctly so that only the length rule can speak here.
  f.put("len.md", `${"字".repeat(30)} \`${"x".repeat(40)}\` 。`);
  const result = f.run("len.md");
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /caution: sentence-length-caution: 30 chars/);
});

test("counts neither the list marker nor the emphasis delimiters", (t) => {
  const f = fixture(t);
  // A reader parses neither, so a bullet at the ceiling passes and emphasis adds nothing.
  f.put(
    "markup.md",
    [`- ${"字".repeat(40)}。`, "", `**${"字".repeat(36)}**。`].join("\n"),
  );
  const result = f.run("markup.md");
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /caution: sentence-length-caution: 40 chars/);
  assert.match(result.stdout, /caution: sentence-length-caution: 36 chars/);
});

test("keeps a whole comment block outside, not only the line that opens it", (t) => {
  const f = fixture(t);
  // A reader sees none of it, so neither rule may speak about any of its lines.
  f.put(
    "comment.md",
    [
      "<!--",
      `${"字".repeat(60)}。`,
      "这里写Node贴着。",
      "-->",
      "",
      "正文一句。",
    ].join("\n"),
  );
  const comment = f.run("comment.md");
  assert.equal(comment.status, 0, "no line of the block is measured");
  assert.match(comment.stdout, /1 files, 0 errors, 0 cautions/);
  // An inline comment inside a paragraph is invisible the same way.
  f.put("inline.md", `正文${"字".repeat(30)}<!-- 这里写Node贴着 -->。`);
  const inline = f.run("inline.md");
  assert.equal(inline.status, 0);
  assert.match(inline.stdout, /caution: sentence-length-caution: 32 chars/);
});

test("reads an autolink as the URL a reader sees", (t) => {
  const f = fixture(t);
  // The angle brackets are markup, so they must not hide the boundary against the Chinese.
  f.put("auto.md", "见<https://example.com>的说明。");
  const result = f.run("auto.md");
  assert.equal(result.status, 1, "both edges of the URL report");
  assert.equal(result.stdout.trim().split("\n").length, 3);
});

test("leaves a bare URL out of the length and inside the spacing", (t) => {
  const f = fixture(t);
  // A reader does not read a URL, so it adds no length; it still renders as Latin.
  f.put(
    "url.md",
    `${"字".repeat(36)} https://example.com/${"x".repeat(40)} 的说明。`,
  );
  const url = f.run("url.md");
  assert.equal(url.status, 0, "thirty-nine characters of prose remain");
  assert.match(url.stdout, /caution: sentence-length-caution: 39 chars/);
  assert.match(url.stdout, /1 files, 0 errors, 1 cautions/);
  // The same address written without a scheme still carries one in the target, so the two
  // spellings must measure the same; an address is not read either way.
  f.put(
    "www.md",
    `${"字".repeat(36)} www.example.com/${"x".repeat(40)} 的说明。`,
  );
  const www = f.run("www.md");
  assert.equal(
    www.status,
    0,
    "the scheme-less spelling measures as the other one",
  );
  assert.match(www.stdout, /caution: sentence-length-caution: 39 chars/);
  assert.match(www.stdout, /1 files, 0 errors, 1 cautions/);
  // A real link's text is prose, and its target happening to end in that text changes nothing.
  f.put(
    "text.md",
    `${"字".repeat(38)}见[写作规范](https://example.com/写作规范)。`,
  );
  assert.match(f.run("text.md").stdout, /caution: sentence-length: 43 chars/);
  f.put("tight.md", "见https://example.com 的说明。");
  const tight = f.run("tight.md");
  assert.equal(
    tight.status,
    1,
    "the boundary against the Chinese character still reports",
  );
  assert.equal(tight.stdout.trim().split("\n").length, 2);
});

test("measures a sentence that the source wraps across lines", (t) => {
  const f = fixture(t);
  // A soft break renders as a space, so the two lines are one sentence to a reader.
  f.put("wrap.md", [`${"字".repeat(25)}`, `${"字".repeat(25)}。`].join("\n"));
  const result = f.run("wrap.md");
  assert.equal(result.status, 0, "the wrapped sentence is advisory");
  assert.match(result.stdout, /wrap\.md:1: caution: sentence-length: 50 chars/);
  // A blank line still ends the paragraph, so these stay two short sentences.
  f.put(
    "split.md",
    [`${"字".repeat(25)}。`, "", `${"字".repeat(25)}。`].join("\n"),
  );
  const split = f.run("split.md");
  assert.equal(split.status, 0);
  assert.match(split.stdout, /1 files, 0 errors, 0 cautions/);
});

test("keeps an underscore that belongs to an identifier", (t) => {
  const f = fixture(t);
  // CommonMark makes no emphasis between word characters, so a reader sees these underscores.
  f.put("snake.md", `${"字".repeat(36)} a_b_c。`);
  const result = f.run("snake.md");
  assert.equal(result.status, 0, "the five identifier characters all count");
  assert.match(result.stdout, /caution: sentence-length: 41 chars/);
});

test("sees through emphasis for spacing as a reader does", (t) => {
  const f = fixture(t);
  f.put("bold.md", "这里用**Node**运行。");
  const result = f.run("bold.md");
  assert.equal(result.status, 1, "the delimiters must not hide the boundary");
  assert.equal(result.stdout.trim().split("\n").length, 3);
});

test("measures a nested bullet that ordinary indentation puts at four spaces", (t) => {
  const f = fixture(t);
  // Inside a list this is nesting, not an indented code block.
  f.put(
    "nested.md",
    ["- 一级", "  - 二级", `    - 三级：${"字".repeat(60)}。`].join("\n"),
  );
  const nested = f.run("nested.md");
  assert.equal(nested.status, 0);
  assert.match(nested.stdout, /nested\.md:3: caution: sentence-length/);
  // Outside a list the same indentation is still a code block.
  f.put("code.md", ["普通一行。", "", `    ${"字".repeat(60)}。`].join("\n"));
  const code = f.run("code.md");
  assert.equal(code.status, 0);
  assert.match(code.stdout, /1 files, 0 errors, 0 cautions/);
});

test("skips headings, tables, quotes, indented blocks and fenced code", (t) => {
  const f = fixture(t);
  const long = "字".repeat(60);
  f.put(
    "structure.md",
    [
      `# ${long}`,
      "",
      "| 列 |",
      "| --- |",
      `| ${long} |`,
      "",
      `> ${long}`,
      "",
      `    ${long}`,
      "",
      "```",
      long,
      "```",
      "",
      "~~~",
      long,
      "~~~",
    ].join("\n"),
  );
  const result = f.run("structure.md");
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /1 files, 0 errors, 0 cautions/);
});

test("keeps front matter outside, blank line or not", (t) => {
  const f = fixture(t);
  // Front matter is metadata, not prose. A blank line inside it must not turn the rest into text.
  f.put(
    "meta.md",
    [
      "---",
      "name: demo",
      "",
      `description: ${"字".repeat(60)}。`,
      "---",
      "",
      "正文一句。",
    ].join("\n"),
  );
  const result = f.run("meta.md");
  assert.equal(result.status, 0, "no line of the block is measured");
  assert.match(result.stdout, /1 files, 0 errors, 0 cautions/);
});

test("measures a pipe line that no delimiter row turns into a table", (t) => {
  const f = fixture(t);
  // A table needs its delimiter row. Without one the line renders as literal text, pipes and all,
  // so it is prose and the two pipe characters count with everything else.
  f.put("pipes.md", `| ${"字".repeat(60)} |`);
  const result = f.run("pipes.md");
  assert.equal(result.status, 0, "the line is prose, not a table row");
  assert.match(result.stdout, /caution: sentence-length: 62 chars/);
});

test("inserts the missing space only where the rule speaks", (t) => {
  const f = fixture(t);
  const before = [
    "# 标题里有Node",
    "",
    "正文里有Node和数字24。这里写`code`贴着。",
    "",
    "| 单元格里有Node |",
    "| --- |",
    "| 行里有Node |",
    "",
    "> 引用里有Node",
    "",
    "链接 [文字里有Node](https://example.com/a没空格b) 之后。",
  ].join("\n");
  f.put("fix.md", before);
  const result = f.run("--fix", "fix.md");
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /0 errors, 0 cautions, 6 spaces inserted/);
  const after = readFileSync(path.join(f.directory, "fix.md"), "utf8").split(
    "\n",
  );
  assert.equal(after[2], "正文里有 Node 和数字 24。这里写 `code` 贴着。");
  assert.equal(
    after[10],
    "链接 [文字里有 Node](https://example.com/a没空格b) 之后。",
    "the target is not prose",
  );
  // A heading, a table cell and a quoted block are outside the rule, so a repair must not reach them.
  for (const index of [0, 4, 6, 8])
    assert.equal(after[index], before.split("\n")[index]);
});

test("repairs the spacing and leaves the length alone", (t) => {
  const f = fixture(t);
  // Where to divide a sentence is the author's judgement, so the tool reports it and stops.
  f.put("both.md", `这里有Node贴着，${"字".repeat(45)}。`);
  const result = f.run("--fix", "both.md");
  assert.equal(
    result.status,
    0,
    "the remaining sentence-length advice is non-blocking",
  );
  assert.match(result.stdout, /caution: sentence-length/);
  assert.doesNotMatch(result.stdout, /cjk-latin-spacing/);
  assert.match(
    readFileSync(path.join(f.directory, "both.md"), "utf8"),
    /这里有 Node 贴着，/,
  );
});

test("proposes a split only where both halves fit", (t) => {
  const f = fixture(t);
  f.put(
    "hint.md",
    [
      "这是一句相当长的中文句子，它在中间有一个明确的逗号边界，因此应当给出两边都不超限的建议。",
      "",
      "这是一句同样超过上限但整句里没有任何标点边界可用因此不应该硬给一个断点建议只报长度嗯。",
    ].join("\n"),
  );
  const lines = f.run("hint.md").stdout.trim().split("\n");
  assert.match(lines[0], / \| split 28\+15$/);
  assert.doesNotMatch(
    lines[1],
    /split/,
    "a sentence with no boundary gets no invented one",
  );
});

test("repairs past a construct that decoded shorter than its source", (t) => {
  const f = fixture(t);
  // A character reference and an escape each occupy more source than they decode to, so the value
  // alone cannot say where a later character came from. The token stream says it: the decoded
  // character belongs to its whole construct, so the space goes past the construct and lands
  // outside the markup rather than inside it.
  f.put("entity.md", "前面&amp;后面有Node贴着。");
  const entity = f.run("--fix", "entity.md");
  assert.equal(entity.status, 0, entity.stdout);
  assert.match(entity.stdout, /2 spaces inserted/);
  assert.equal(
    readFileSync(path.join(f.directory, "entity.md"), "utf8"),
    "前面&amp;后面有 Node 贴着。\n",
  );
  f.put("escape.md", "另见 a\\_b后面有Node贴着。");
  const escape = f.run("--fix", "escape.md");
  assert.equal(escape.status, 0, escape.stdout);
  assert.match(escape.stdout, /3 spaces inserted/);
  assert.equal(
    readFileSync(path.join(f.directory, "escape.md"), "utf8"),
    "另见 a\\_b 后面有 Node 贴着。\n",
  );
  // Boundaries standing before the construct reach the same place, which is what the reconstruction
  // this replaced could manage; the ones behind it are what it could not.
  f.put("before.md", "这里有Node贴着，另见 a\\_b。");
  const before = f.run("--fix", "before.md");
  assert.equal(before.status, 0, before.stdout);
  assert.match(before.stdout, /2 spaces inserted/);
  assert.equal(
    readFileSync(path.join(f.directory, "before.md"), "utf8"),
    "这里有 Node 贴着，另见 a\\_b。\n",
  );
});

test("refuses a node whose reference decodes to more than one character", (t) => {
  const f = fixture(t);
  // A reference is one construct but not always one character: `&#128512;` is a single emoji held
  // in two units, `&fjlig;` decodes to two letters. Counting one for the construct would leave
  // every later character an offset short, and the space would land inside `Node`. Worse, it would
  // not clear the boundary it aimed at, so the next pass would find it again and insert another.
  for (const [name, body] of [
    ["astral.md", "这里有Node贴着，另见 x&#128512;中文Node。"],
    ["ligature.md", "a&fjlig;中文Node"],
  ]) {
    f.put(name, body);
    const fixed = f.run("--fix", name);
    assert.equal(fixed.status, 1, fixed.stdout);
    assert.match(fixed.stdout, /0 spaces inserted/);
    for (const line of fixed.stdout.trim().split("\n").slice(0, -1)) {
      assert.match(
        line,
        / \| position unrecoverable$/,
        `${name}: every finding in the node is refused`,
      );
    }
    assert.equal(
      readFileSync(path.join(f.directory, name), "utf8"),
      `${body}\n`,
      `${name} is untouched`,
    );
  }
});

test("keeps the offsets of a node that begins inside a run", (t) => {
  const f = fixture(t);
  // A task list item drops the space after its checkbox from the text and moves the node's start
  // past it, while the run the tokenizer reports still covers that space. Reading the run only when
  // it starts inside the node throws the whole node away, so the same prose repairs under a plain
  // bullet and refuses under a checkbox — the difference being markup the rule never speaks about.
  f.put(
    "task.md",
    "- [ ] 这里有Node贴着。\n- [x] 另见Node贴着。\n- 这里有Node贴着。",
  );
  const fixed = f.run("--fix", "task.md");
  assert.equal(fixed.status, 0, fixed.stdout);
  assert.match(fixed.stdout, /6 spaces inserted/);
  assert.equal(
    readFileSync(path.join(f.directory, "task.md"), "utf8"),
    "- [ ] 这里有 Node 贴着。\n- [x] 另见 Node 贴着。\n- 这里有 Node 贴着。\n",
  );
});

test("counts a line ending by what it leaves in the text, not by one", (t) => {
  const f = fixture(t);
  // A document written with CRLF keeps both characters in the value the tree hands back, so a line
  // ending stands for its own source the way ordinary text does. Counting one for it would leave
  // every wrapped paragraph in such a document short, and the whole node would go unrepairable —
  // a class of file the rule has nothing to say about, silently losing its repairs.
  f.put("crlf.md", "这里有Node贴着，\r\n续行也有Node贴着。");
  const fixed = f.run("--fix", "crlf.md");
  assert.equal(fixed.status, 0, fixed.stdout);
  assert.match(fixed.stdout, /4 spaces inserted/);
  assert.equal(
    readFileSync(path.join(f.directory, "crlf.md"), "utf8"),
    "这里有 Node 贴着，\r\n续行也有 Node 贴着。\n",
    "the repairs land and the line ending survives",
  );
});

test("measures the prose behind an address the tokenizer never saw", (t) => {
  const f = fixture(t);
  // The tree transform and the tokenizer disagree about what may precede a bare `www.`, and after a
  // full-width mark the transform fires alone. The node it builds carries no position, so nothing
  // in it can be repaired — but read as an address whole, the sentence behind it leaves both rules,
  // and a colon before an address is ordinary Chinese rather than a corner. It is a literal by
  // construction, so it is read as one: the prose is measured and the seam reports.
  const sentence = "字".repeat(45);
  f.put("transform.md", `详见：www.example.com/x${sentence}。`);
  const before = readFileSync(path.join(f.directory, "transform.md"), "utf8");
  const fixed = f.run("--fix", "transform.md");
  assert.equal(fixed.status, 1);
  assert.match(
    fixed.stdout,
    /caution: sentence-length: 48 chars/,
    "the sentence is measured",
  );
  assert.match(
    fixed.stdout,
    /cjk-latin-spacing: .* \| position unrecoverable/,
    "the seam reports",
  );
  assert.match(fixed.stdout, /0 spaces inserted/);
  assert.equal(
    readFileSync(path.join(f.directory, "transform.md"), "utf8"),
    before,
    "untouched",
  );
});

test("marks the finding it refuses, and only that one", (t) => {
  const f = fixture(t);
  // One run carrying both kinds. Three boundaries have a place for the space; the one inside a
  // shortcut reference label has none, because the label is the identifier that has to keep
  // matching. Without the suffix all four lines read alike, so `--fix` repairs three, still exits
  // 1, and a second run repeats the fourth word for word.
  f.put(
    "mixed.md",
    "这里有Node贴着，另见[中文Node]的说明。\n\n[中文Node]: https://example.com",
  );
  const lines = f.run("mixed.md").stdout.trim().split("\n").slice(0, -1);
  assert.equal(lines.length, 4);
  const marked = lines.filter((line) =>
    / \| position unrecoverable$/.test(line),
  );
  assert.equal(marked.length, 1, "only the refused position carries the mark");
  assert.match(marked[0], /中文\|Node/, "and it is the one inside the label");
  // What remains after a repair is exactly that one, which is what tells the author to act.
  const fixed = f.run("--fix", "mixed.md");
  assert.equal(fixed.status, 1);
  assert.match(fixed.stdout, /3 spaces inserted/);
  const left = fixed.stdout.trim().split("\n").slice(0, -1);
  assert.equal(left.length, 1);
  assert.match(left[0], / \| position unrecoverable$/);
});

test("keeps the repair outside the delimiters that close a container", (t) => {
  const f = fixture(t);
  // Emphasis and a link close after their last character, so that character's own offset sits
  // inside the markup. A space written there stops the delimiter from closing, and the re-check
  // then finds nothing, so the run would report success over a broken file.
  f.put(
    "inside.md",
    [
      "这里写**Node**贴着。",
      "",
      "链接 [文字里有Node](https://example.com/x) 之后。",
    ].join("\n"),
  );
  const result = f.run("--fix", "inside.md");
  assert.equal(result.status, 0, result.stdout);
  const after = readFileSync(path.join(f.directory, "inside.md"), "utf8").split(
    "\n",
  );
  assert.equal(after[0], "这里写 **Node** 贴着。");
  assert.equal(after[2], "链接 [文字里有 Node](https://example.com/x) 之后。");
});

test("reports both edges of a one-character run and converges in one pass", (t) => {
  const f = fixture(t);
  // Both boundaries sit on the same character, so a rule that consumed the pair would step past the
  // second and leave the file needing another pass.
  f.put("one.md", "共2个。");
  const before = f.run("one.md");
  assert.equal(
    before.stdout.trim().split("\n").length,
    3,
    "two edges and the summary",
  );
  const fixed = f.run("--fix", "one.md");
  assert.equal(fixed.status, 0, fixed.stdout);
  assert.match(fixed.stdout, /2 spaces inserted/);
  assert.equal(
    readFileSync(path.join(f.directory, "one.md"), "utf8"),
    "共 2 个。\n",
  );
});

test("repairs around an ampersand that opens nothing", (t) => {
  const f = fixture(t);
  // The pessimism belongs to a node that decoded shorter. This one did not: it is as long as its
  // source, so every offset in it is exact. Dropping alignment at the `&` would make the same
  // sentence repairable or not depending on which side of the boundaries the ampersand sits.
  //
  // The sentence sits in the second paragraph on purpose. A node that opens the document starts at
  // offset 0, where the length comparison holds whichever way the two numbers are combined, so a
  // first-paragraph case leaves the arithmetic itself unpinned.
  const before = ["前面一段没有问题。", "", "见 A&B 公司的Node服务。"].join(
    "\n",
  );
  f.put("amp.md", before);
  const result = f.run("--fix", "amp.md");
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /2 spaces inserted/);
  assert.equal(
    readFileSync(path.join(f.directory, "amp.md"), "utf8"),
    "前面一段没有问题。\n\n见 A&B 公司的 Node 服务。\n",
  );
});

test("reads a bare address as ending where the script changes", (t) => {
  const f = fixture(t);
  // A GFM autolink literal runs to the next space, so Chinese written straight after an address is
  // inside the link: the node swallows the sentence and its target becomes an address the author
  // never wrote. Both rules have to keep speaking over that prose, or a paragraph passes with an
  // unmeasured sentence and a rewritten link.
  const sentence = "字".repeat(45);
  f.put("literal.md", `见 https://example.com/x${sentence}。`);
  f.put("www.md", `见 www.example.com/x${sentence}。`);
  for (const name of ["literal.md", "www.md"]) {
    const lines = f.run(name).stdout.trim().split("\n").slice(0, -1);
    assert.equal(lines.length, 2, `${name}: the sentence and the seam`);
    assert.match(
      lines[0],
      /caution: sentence-length: 46 chars/,
      `${name}: the sentence is measured`,
    );
    assert.match(
      lines[1],
      /error: cjk-latin-spacing: .*\| position unrecoverable$/,
      `${name}: the seam reports`,
    );
  }
  // Never repaired: the same position inside an address that does carry Chinese would split a
  // working link. The file has to come back untouched.
  const before = readFileSync(path.join(f.directory, "literal.md"), "utf8");
  const fixed = f.run("--fix", "literal.md");
  assert.equal(fixed.status, 1);
  assert.match(fixed.stdout, /0 spaces inserted/);
  assert.equal(
    readFileSync(path.join(f.directory, "literal.md"), "utf8"),
    before,
  );
  // The delimited spelling is the author's way to say the Chinese belongs to the address, and it
  // stays silent, which is also what clears the finding above.
  f.put("delimited.md", `见 <https://example.com/x${sentence}> 的说明。`);
  assert.equal(f.run("delimited.md").status, 0);
});

test("lets a terminator written against a bare address close its sentence", (t) => {
  const f = fixture(t);
  // A literal runs to the next space, so `。` written flush against an address is inside the link
  // too. Left in the address half it is never measured, and the sentence it closes runs on into the
  // next one: two compliant sentences arrive as one long violation.
  const sentence = "字".repeat(40);
  f.put("flush.md", `见 https://example.com/x。${sentence}。`);
  f.put("spaced.md", `见 https://example.com/x 。${sentence}。`);
  const flush = f.run("flush.md");
  assert.equal(flush.status, 0, flush.stdout);
  assert.match(
    flush.stdout,
    /caution: sentence-length-caution: 40 chars/,
    "measured on its own",
  );
  // The spelling that never had the problem is the yardstick: both must read the same.
  assert.equal(
    f.run("spaced.md").stdout.replace("spaced", "flush"),
    flush.stdout,
  );
});

test("reads an inline tag as no separation and an empty container as none of its own", (t) => {
  const f = fixture(t);
  // A tag renders no glyph, so the scripts on either side of it really do touch and both edges
  // report. The repair lands at each character's own offset, which puts one space inside the
  // element and one before it; a second pass then finds nothing.
  f.put("tag.md", "中文<span>Node</span>之后。");
  assert.equal(rules(f.run("tag.md").stdout).length, 2);
  const tagged = f.run("--fix", "tag.md");
  assert.equal(tagged.status, 0, tagged.stdout);
  assert.equal(
    readFileSync(path.join(f.directory, "tag.md"), "utf8"),
    "中文 <span>Node </span>之后。\n",
  );
  // A link whose only child is a tag renders nothing at all, so the entry before it belongs to the
  // preceding text and must keep its own offset. Overwriting it with the container's end would move
  // this repair past the whole link, to a position no character of the container occupies. An image
  // inside would not do: a picture separates the scripts, so that container is not empty.
  f.put("empty.md", "中文[<span></span>](https://example.com/x)Node 之后。");
  const empty = f.run("--fix", "empty.md");
  assert.equal(empty.status, 0, empty.stdout);
  assert.match(empty.stdout, /1 spaces inserted/);
  assert.equal(
    readFileSync(path.join(f.directory, "empty.md"), "utf8"),
    "中文 [<span></span>](https://example.com/x)Node 之后。\n",
  );
});

test("reads a picture as separating the two scripts and a tag as not", (t) => {
  const f = fixture(t);
  // The rule asks for a space because the scripts would otherwise touch. A picture stands between
  // them, so they do not, and the space an author would add lands beside the picture rather than
  // between the scripts — the edit the report asked for would settle nothing. A tag renders no
  // glyph, so the scripts really do touch and both edges report.
  f.put("picture.md", "中文![图](a.png)Node 之后。");
  f.put("reference.md", "中文![图][r]Node 之后。\n\n[r]: a.png");
  f.put("tag.md", "中文<span>Node</span>之后。");
  assert.equal(f.run("picture.md").status, 0);
  assert.equal(
    f.run("reference.md").status,
    0,
    "a reference to a picture is still a picture",
  );
  assert.equal(
    rules(f.run("tag.md").stdout).length,
    2,
    "a tag separates nothing",
  );
  // The alt text describes the picture rather than standing on the page, so it never lengthens a
  // sentence: the words below would carry this one past the ceiling if they counted.
  f.put("alt.md", `![${"字".repeat(45)}](a.png)这句只有十个字。`);
  assert.equal(
    f.run("alt.md").status,
    0,
    "the description stays out of the measured sentence",
  );
});

test("refuses a space that would hand a bare address the prose behind it", (t) => {
  const f = fixture(t);
  // Adding the space is what turns a flush address into a link, and the contract says that is the
  // compliant spelling. It stops being compliant when the address has Chinese behind it: a literal
  // runs to the next space, so the target swallows the rest of the sentence. The repair would then
  // have rewritten the document beyond the space and reported success, because what it reads back
  // is no longer a violation.
  f.put("grab.md", "详见www.example.com。后面还有字。");
  const before = readFileSync(path.join(f.directory, "grab.md"), "utf8");
  const grab = f.run("--fix", "grab.md");
  assert.equal(grab.status, 1);
  assert.match(grab.stdout, /0 spaces inserted/);
  assert.match(grab.stdout.split("\n")[0], / \| position unrecoverable$/);
  assert.equal(
    readFileSync(path.join(f.directory, "grab.md"), "utf8"),
    before,
    "untouched",
  );
  // A second pass says the same thing rather than trying again.
  assert.match(f.run("--fix", "grab.md").stdout, /0 spaces inserted/);
  // The same address cited twice must not license the second one. Asking whether the target is new
  // to the document answers yes only until some other paragraph already points there; the question
  // is whether this edit produced one more link to it.
  f.put(
    "twice.md",
    [
      "见 www.example.com。后面还有字。",
      "",
      "详见www.example.com。后面还有字。",
    ].join("\n"),
  );
  const twice = f.run("--fix", "twice.md");
  assert.equal(twice.status, 1, twice.stdout);
  assert.match(twice.stdout, /0 spaces inserted/);
  assert.match(
    readFileSync(path.join(f.directory, "twice.md"), "utf8"),
    /\n详见www\.example\.com。/,
  );
  // The benign shape still repairs: with a space already on its right, the address the link takes
  // is the address the author wrote.
  f.put("plain.md", "详见www.example.com 后面还有字。");
  const plain = f.run("--fix", "plain.md");
  assert.equal(plain.status, 0, plain.stdout);
  assert.equal(
    readFileSync(path.join(f.directory, "plain.md"), "utf8"),
    "详见 www.example.com 后面还有字。\n",
  );
});

test("finishes in one call when a later space is what makes an earlier one safe", (t) => {
  const f = fixture(t);
  // One write carries every repair of a file, and the space after the address is what stops the
  // new link from taking the prose behind it. Judging the first insertion on its own refuses it,
  // leaves the file needing a second call, and prints the leftover with nothing on the line to say
  // so — the caller is told to act and the only act that works is the command just run.
  f.put("pair.md", "见www.example.com的说明。");
  const fixed = f.run("--fix", "pair.md");
  assert.equal(fixed.status, 0, fixed.stdout);
  assert.match(fixed.stdout, /2 spaces inserted/);
  assert.equal(
    readFileSync(path.join(f.directory, "pair.md"), "utf8"),
    "见 www.example.com 的说明。\n",
  );
});

test("keeps the repair out of a label that is its own identifier", (t) => {
  const f = fixture(t);
  // A shortcut or collapsed reference matches its definition by the label itself, so a space
  // written inside it leaves the brackets standing in the text where a link used to be, and the
  // re-check finds nothing to say about it. A full reference names its identifier separately, so
  // its label is prose and takes the space.
  const definition =
    "\n\n[中文Node]: https://example.com\n[ref]: https://example.com";
  f.put("short.md", `见[中文Node]的说明。${definition}`);
  f.put("collapsed.md", `见[中文Node][]的说明。${definition}`);
  f.put("full.md", `见[文字里有Node][ref]的说明。${definition}`);
  for (const name of ["short.md", "collapsed.md"]) {
    const fixed = f.run("--fix", name);
    assert.equal(
      fixed.status,
      1,
      `${name}: the label boundary has no place to go`,
    );
    assert.match(fixed.stdout.split("\n")[0], / \| position unrecoverable$/);
    assert.match(
      fixed.stdout,
      /1 spaces inserted/,
      `${name}: the boundary past the bracket is still repaired`,
    );
    // What matters is that the reference still resolves; the space landed outside the label.
    assert.match(
      readFileSync(path.join(f.directory, name), "utf8"),
      /见\[中文Node\](\[\])? 的说明。/,
    );
  }
  const full = f.run("--fix", "full.md");
  assert.equal(full.status, 0, full.stdout);
  assert.match(
    readFileSync(path.join(f.directory, "full.md"), "utf8"),
    /见\[文字里有 Node\]\[ref\] 的说明。/,
  );
});

test("says nothing about a change of script inside a span", (t) => {
  const f = fixture(t);
  // A space there would land inside the code or inside the URL, so reporting it would be an error
  // the author cannot clear: `--fix` could not supply it and a second pass would say the same.
  f.put(
    "inside.md",
    [
      "这里用`用户名abc`登录。",
      "",
      "见 <https://example.com/中文abc> 的说明。",
    ].join("\n"),
  );
  const result = f.run("inside.md");
  assert.equal(result.status, 1, "the boundary against the span still reports");
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 2, "one finding and the summary");
  assert.match(lines[0], /inside\.md:1: .*用户名abc\|登录/);
  // That one is repairable, and nothing is left behind.
  const fixed = f.run("--fix", "inside.md");
  assert.equal(fixed.status, 0, fixed.stdout);
  assert.match(
    readFileSync(path.join(f.directory, "inside.md"), "utf8"),
    /`用户名abc` 登录。/,
  );
});

test("a repair only ever inserts spaces, whatever the construct", async (t) => {
  const f = fixture(t);
  // Every example test asserts one expected output, which is why three repairs that corrupted a
  // document still passed: emphasis that stopped closing, a container's inner offset, an entity cut
  // in half. This asserts the property instead. Whatever `--fix` writes, the document a reader
  // parses must be the one it parsed before, apart from the spaces themselves.
  const { fromMarkdown } = await import("mdast-util-from-markdown");
  const { gfm } = await import("micromark-extension-gfm");
  const { gfmFromMarkdown } = await import("mdast-util-gfm");
  const parsed = (body) => {
    const tree = fromMarkdown(body, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    });
    const parts = [];
    const spans = [];
    const targets = [];
    const walk = (node) => {
      if (node.type === "text" || node.type === "inlineCode")
        parts.push(node.value);
      if (node.type === "inlineCode") spans.push(node.value);
      if (node.type === "link") targets.push(node.url);
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
    // The characters a reader reads, not the nodes carrying them. Spacing a bare address turns it
    // into a link, which changes the tree and not one character; breaking a delimiter or cutting an
    // entity in half puts its markup into the text, which this sees.
    //
    // Stripping whitespace is what lets the address case pass, and it is also the one corruption it
    // cannot see: a space written inside a code span leaves the span's own characters intact, so the
    // stripped text matches. The spans travel beside it unstripped, where a space does show.
    //
    // Neither channel watches where a link points, and that is where two corruptions landed: a
    // space that let a new literal take the sentence behind it changed no character a reader reads
    // and nothing inside a span. Targets cannot be asserted unchanged, because spacing a bare
    // address legitimately creates one, so the assertion is the invariant the repair actually
    // promises: a target carrying Chinese was already a target before.
    return { text: parts.join("").replace(/\s/g, ""), spans, targets };
  };
  const corpus = [
    "这里写**Node**贴着。",
    "这里写*Node*贴着。",
    "链接 [文字里有Node](https://example.com/x) 之后。",
    "这里写`code`贴着。",
    "这里用`用户名abc`登录。",
    "见<https://example.com>的说明。",
    "见 <https://example.com/中文abc> 的说明。",
    "见www.example.com的说明。",
    "写成&amp;am中",
    "前面&amp;后面有Node贴着。",
    "这里有Node贴着，另见 a\\_b。",
    "共2个。",
    "嵌套 **[Node](https://example.com/y)** 贴着中文。",
    "见[中文Node]的说明。\n\n[中文Node]: https://example.com",
    "见 www.example.com。后面还有字。\n\n详见www.example.com。后面还有字。",
    "- 列表里有Node贴着\n  续行也有Node贴着。",
    "| 单元格里有Node |\n| --- |\n| 行里有Node |",
    "# 标题里有Node\n\n正文里有Node。",
  ];
  for (const [index, body] of corpus.entries()) {
    const name = `case-${index}.md`;
    f.put(name, body);
    const before = parsed(body);
    f.run("--fix", name);
    const after = parsed(readFileSync(path.join(f.directory, name), "utf8"));
    assert.equal(
      after.text,
      before.text,
      `${name} changed more than the spacing: ${JSON.stringify(body)}`,
    );
    assert.deepEqual(
      after.spans,
      before.spans,
      `${name} spaced inside a code span: ${JSON.stringify(body)}`,
    );
    // Counted, not looked up: the same address cited twice would otherwise let a repair add a
    // second link to a target the document already had, which is the corruption itself.
    const count = (list, url) => list.filter((target) => target === url).length;
    for (const url of new Set(
      after.targets.filter((target) => CHINESE.test(target)),
    )) {
      assert.ok(
        count(after.targets, url) <= count(before.targets, url),
        `${name} added a link to Chinese: ${JSON.stringify(url)}`,
      );
    }
  }
});

test("walks a directory, keeps only Markdown, and honours an excluded prefix", (t) => {
  const f = fixture(t);
  const long = `${"字".repeat(45)}。`;
  f.put("docs/current.md", long);
  f.put("docs/drafts/retained.md", long);
  f.put("docs/notes.txt", long);
  const all = f.run("docs");
  assert.equal(all.status, 0);
  assert.match(
    all.stdout,
    /2 files, 0 errors, 2 cautions/,
    "the text file is not prose",
  );
  const kept = f.run("docs", "--exclude", "docs/drafts");
  assert.equal(kept.status, 0);
  assert.match(kept.stdout, /1 files, 0 errors, 1 cautions/);
  assert.doesNotMatch(kept.stdout, /retained/);
  const slash = f.run("docs", "--exclude", "docs/drafts/");
  assert.equal(slash.status, 0, "a trailing slash is the same prefix");
  assert.match(slash.stdout, /1 files, 0 errors, 1 cautions/);
});

test("reports findings as JSON without changing the verdict", (t) => {
  const f = fixture(t);
  f.put("mixed.md", `${"字".repeat(41)}。\n这里缺空格Node贴着。`);
  const result = f.run("mixed.md", "--format", "json");
  assert.equal(result.status, 1);
  const report = result.json();
  assert.equal(report.files, 1);
  assert.equal(report.errors, 2);
  assert.equal(
    report.findings.filter((finding) => finding.severity === "caution").length,
    1,
  );
  assert.deepEqual(
    [...new Set(report.findings.map((finding) => finding.rule))].sort(),
    ["cjk-latin-spacing", "sentence-length"],
  );
  assert.ok(
    report.findings.every(
      (finding) => finding.file === "mixed.md" && finding.line >= 1,
    ),
  );
});

test("lists the candidate grading words and passes over the admitted ones", (t) => {
  const f = fixture(t);
  // The closed set and the ungraded imperatives are the words an author is meant to reach for, so a
  // listing that reported them would send the reader to every correct sentence in the repository.
  f.put(
    "graded.md",
    "读者须核对目标。调用方需要授权，每条都要证据。它不能证明结果，也可以留给作者。作者应该记录范围。\n\n" +
      "调用方必须核对目标，不得跳过。作者应记录范围，可留给读者。不要跳过核对，禁止改写记录。",
  );
  const result = f.run("grades", "graded.md");
  assert.equal(result.status, 0, result.stdout);
  const words = result.stdout
    .trim()
    .split("\n")
    .slice(0, -1)
    .map((line) => line.split(": ")[3]);
  assert.deepEqual(words, ["须", "需要", "都要", "不能", "可以", "应该"]);
  assert.match(result.stdout, /prose-check: 1 files, 6 candidates$/m);
});

test("steps over the 须 inside an admitted 必须", (t) => {
  const f = fixture(t);
  // `必须` is in the set and contains a candidate. Matching the character alone would report every
  // correctly graded requirement in the corpus, which is most of them.
  const f1 = f.put("admitted.md", "调用方必须核对目标。");
  const f2 = f.put("mixed.md", "调用方必须核对目标，读者须自行判断。");
  assert.match(
    f.run("grades", f1).stdout,
    /prose-check: 1 files, 0 candidates$/m,
  );
  const mixed = f.run("grades", f2);
  assert.match(mixed.stdout, /prose-check: 1 files, 1 candidates$/m);
  assert.match(mixed.stdout, /candidate: grading-word: 须: /);
});

test("reads the same prose the length rule reads", (t) => {
  const f = fixture(t);
  // The conventions bind running prose, so a candidate inside a heading, a table cell, a quotation or
  // code is not one. Reading the spacing string instead of the length string would report the inline
  // code span, and dropping the opaque skip would report the other four.
  f.put(
    "shapes.md",
    "# 可以作标题\n\n| 列 | 说明 |\n| --- | --- |\n| 甲 | 需要说明 |\n\n> 引用里写不能。\n\n" +
      "```text\n代码里写应该。\n```\n\n行内 `可以` 是标识符。\n\n- 列表项里写可以。\n",
  );
  const result = f.run("grades", "shapes.md");
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /prose-check: 1 files, 1 candidates$/m);
  assert.match(
    result.stdout,
    /shapes\.md:\d+: candidate: grading-word: 可以: 列表项里写可以/,
  );
});

test("carries the sentence whole, however far into it the candidate stands", (t) => {
  const f = fixture(t);
  // The excerpt a length finding carries is enough to recognise a sentence whose measurement is
  // reported as a number. Cutting this one at the same width drops the candidate out of its own
  // report: six of the candidates in this repository stand past that cut, and each was printed as a
  // word, a line and an excerpt that did not contain the word.
  const body = `${"长".repeat(70)}不能作证据`;
  f.put("far.md", `${body}。`);
  const result = f.run("grades", "far.md", "--format", "json");
  assert.equal(result.status, 0);
  const [finding] = result.json().findings;
  assert.equal(finding.word, "不能");
  assert.ok(finding.text.includes("不能"), finding.text);
  // The terminator closes the sentence rather than belonging to it, which is how the length rule
  // counts it too, so the text arrives without the final mark and with everything before it.
  assert.equal(finding.text, body);
});

test("a listing is not a verdict", (t) => {
  const f = fixture(t);
  // A caller that reads the status decides from it. Exiting nonzero with candidates present would
  // make this a gate on every wording in the repository, which the noise argument rules out.
  f.put("many.md", "它可以读取，也不能写入，读者应该自行判断。");
  const result = f.run("grades", "many.md");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /prose-check: 1 files, 3 candidates$/m);
});

test("reports candidates as JSON with the sentence that decides each one", (t) => {
  const f = fixture(t);
  // The word alone cannot be judged: the reader needs the sentence to tell a requirement from
  // narration. A report that carried only the word and the line would send them back to the file.
  f.put("one.md", "调用方需要授权。");
  const result = f.run("grades", "one.md", "--format", "json");
  assert.equal(result.status, 0);
  const report = result.json();
  assert.equal(report.files, 1);
  assert.equal(report.candidates, 1);
  assert.deepEqual(
    report.findings.map((finding) => [
      finding.file,
      finding.rule,
      finding.severity,
      finding.word,
    ]),
    [["one.md", "grading-word", "candidate", "需要"]],
  );
  assert.match(report.findings[0].text, /^调用方需要授权$/);
  assert.ok(report.findings[0].line >= 1);
});

const LONG =
  "这是一个用来触发句子长度提示的很长的中文句子它需要超过四十个字才会被报告出来所以再多写一些字。";

test("prints one bare version token", (t) => {
  const result = fixture(t).run("--version");
  assert.equal(result.status, 0);
  // A consumer's checker matches this against a manifest entry after splitting on whitespace, so a
  // banner or a name beside the number would leave nothing for it to match.
  assert.match(result.stdout, /^\d+\.\d+\.\d+\n$/);
});

test("scopes the report to the lines a change touched, and says what it left out", (t) => {
  const f = fixture(t);
  f.put("doc.md", `${LONG}\n\n${LONG}`);
  f.put("changed.txt", "doc.md:1");
  const whole = f.run("doc.md");
  assert.equal(whole.status, 0);
  assert.equal(rules(whole.stdout).length, 2);
  const scoped = f.run("--changed", "changed.txt", "doc.md");
  // The second sentence belongs to whoever wrote line 3, so this run neither reports it nor fails
  // on it — and it still says the finding exists, because silence would read as a clean file.
  assert.equal(scoped.status, 0);
  assert.equal(rules(scoped.stdout).length, 1);
  assert.match(scoped.stdout, /1 outside the change/);
});

test("passes when every finding sits outside the change", (t) => {
  const f = fixture(t);
  f.put("doc.md", `${LONG}\n\n${LONG}`);
  f.put("changed.txt", "# only the blank line moved\ndoc.md:2");
  const result = f.run("--changed", "changed.txt", "doc.md");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /0 errors, 0 cautions, 2 outside the change/);
});

test("scopes blocking spacing errors to changed paragraphs", (t) => {
  const f = fixture(t);
  f.put("doc.md", "本次改动。\n\n见Node。");
  f.put("changed.txt", "doc.md:1");
  const outside = f.run("--changed", "changed.txt", "doc.md");
  assert.equal(outside.status, 0);
  assert.match(outside.stdout, /0 errors, 0 cautions, 1 outside the change/);
  f.put("changed.txt", "doc.md:3");
  const inside = f.run("--changed", "changed.txt", "doc.md");
  assert.equal(inside.status, 1);
  assert.match(inside.stdout, /error: cjk-latin-spacing/);
  assert.match(inside.stdout, /1 files, 1 errors, 0 cautions/);
});

test("reports nothing for a file the change never names", (t) => {
  const f = fixture(t);
  f.put("doc.md", LONG);
  f.put("other.md", LONG);
  f.put("changed.txt", "other.md:1-1");
  // Both are scanned; only one is named. The unnamed one belongs to whoever wrote it, so its
  // finding is held rather than charged here.
  const result = f.run("--changed", "changed.txt", "doc.md", "other.md");
  assert.equal(result.status, 0);
  assert.equal(rules(result.stdout).length, 1);
  assert.match(result.stdout, /1 outside the change/);
});

test("refuses to repair a scoped run, having read the ranges first", (t) => {
  const f = fixture(t);
  f.put("doc.md", LONG);
  // The range file has to exist and parse, or the run fails on reading it and never reaches the
  // guard this names. That is what the first version of this test did, which left the guard free to
  // be deleted with every test still green.
  f.put("changed.txt", "doc.md:1");
  const result = f.run("--changed", "changed.txt", "--fix", "doc.md");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--changed takes no --fix/);
});

test("holds a finding whose paragraph the change never reached", (t) => {
  const f = fixture(t);
  // Two paragraphs, the second wrapped across three lines. A change inside the wrapped one must
  // carry its finding, because the rendered text a rule reads has joined those lines and reports at
  // the paragraph's first line.
  f.put("doc.md", `${LONG}\n\n短句。\n${LONG}\n短句。`);
  f.put("inside.txt", "doc.md:4");
  const inside = f.run("--changed", "inside.txt", "doc.md");
  assert.equal(inside.status, 0);
  assert.equal(rules(inside.stdout).length, 1);
  f.put("elsewhere.txt", "doc.md:1");
  const elsewhere = f.run("--changed", "elsewhere.txt", "doc.md");
  assert.equal(rules(elsewhere.stdout).length, 1);
  assert.match(elsewhere.stdout, /1 outside the change/);
});

test("matches a range against a path spelled differently", (t) => {
  const f = fixture(t);
  f.put("docs/doc.md", LONG);
  f.put("changed.txt", "docs/doc.md:1");
  // A caller takes paths from `git diff` on one side and from its own wrapper on the other, so the
  // two spellings meet here. Comparing them literally would drop every finding and report a clean
  // run, which is the one outcome a scoped run must never fake.
  for (const spelling of [
    "./docs/doc.md",
    path.join(f.directory, "docs/doc.md"),
  ]) {
    const result = f.run("--changed", "changed.txt", spelling);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /0 outside the change/);
  }
});

test("matches a range against a path reached through a symbolic link", (t) => {
  const f = fixture(t);
  f.put("docs/doc.md", LONG);
  f.put("changed.txt", "docs/doc.md:1");
  // macOS puts the temporary directory behind a link, so a range resolved against the working
  // directory carries the real prefix while a command-line argument carries the linked one. This
  // held on Linux and failed there, which is what the two-platform gate is for.
  const linked = path.join(f.directory, "linked");
  symlinkSync(f.directory, linked);
  const result = f.run(
    "--changed",
    "changed.txt",
    path.join(linked, "docs/doc.md"),
  );
  assert.equal(result.status, 0);
  assert.match(result.stdout, /0 outside the change/);
});

test("counts a range that reached no scanned file instead of refusing the run", (t) => {
  const f = fixture(t);
  f.put("doc.md", LONG);
  f.put("changed.txt", "doc.md:1\nbuild.ts:4\n");
  // A caller deriving ranges from a diff has entries for files that are not Markdown. Refusing
  // would make an ordinary change unrunnable; saying nothing would hide a mistyped path.
  const result = f.run("--changed", "changed.txt", "doc.md");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /1 ranges reached no scanned file/);
});

test("counts the entries a caller wrote, not the paths they named", (t) => {
  const f = fixture(t);
  f.put("doc.md", LONG);
  // A diff writes one hunk per changed region, so several entries for one file is the ordinary
  // case rather than the odd one. Collapsing them to the path would hand back a number the caller
  // cannot match against the range file it just wrote — and every other case here names each
  // unreachable path once, which is exactly why none of them can tell the two apart.
  f.put("changed.txt", "doc.md:1\nbuild.ts:10-12\nbuild.ts:40-45\n");
  const result = f.run("--changed", "changed.txt", "doc.md");
  assert.match(result.stdout, /2 ranges reached no scanned file/);
});

test("keeps running when a range names a file --exclude removed", (t) => {
  const f = fixture(t);
  f.put("kept.md", LONG);
  f.put("old/held.md", LONG);
  f.put("changed.txt", "kept.md:1\nold/held.md:1\n");
  const result = f.run("--exclude", "old", "--changed", "changed.txt", ".");
  assert.equal(result.status, 0);
  assert.equal(rules(result.stdout).length, 1);
  assert.match(result.stdout, /1 ranges reached no scanned file/);
});

test("carries a deletion through the line the caller writes beside it", (t) => {
  const f = fixture(t);
  // Removing the middle line joins the halves into one over-long sentence. The hunk for a pure
  // deletion names no new-side line, so the caller writes the line it landed beside; without that
  // the checker would report the sentence this very change produced as somebody else's.
  // The file as it stands after the removal: the two halves are now one wrapped paragraph.
  f.put(
    "doc.md",
    "这一句的前半段写得很长需要凑够字数才会超过上限\n后半段同样很长合起来就会超过四十个字的上限\n",
  );
  f.put("changed.txt", "doc.md:1");
  const result = f.run("--changed", "changed.txt", "doc.md");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /sentence-length/);
});

test("carries both scoped counts into JSON", (t) => {
  const f = fixture(t);
  f.put("doc.md", `${LONG}\n\n${LONG}`);
  f.put("changed.txt", "doc.md:3");
  const report = f
    .run("--changed", "changed.txt", "--format", "json", "doc.md")
    .json();
  assert.equal(report.errors, 0);
  assert.equal(report.outsideChange, 1);
  // Asserted so it cannot be dropped with the suite green. A JSON consumer has no other signal
  // that its range file named a file this run never scanned.
  assert.equal(report.unreachedRanges, 0);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].line, 3);
  f.put("wider.txt", "doc.md:3\nbuild.ts:4\n");
  const unreached = f
    .run("--changed", "wider.txt", "--format", "json", "doc.md")
    .json();
  assert.equal(unreached.unreachedRanges, 1);
});

test("carries the scoped counts through the listing too", (t) => {
  const f = fixture(t);
  // The listing path builds its own summary and JSON, so it can lose either count on its own.
  f.put("doc.md", "第一段需要授权才能继续。\n\n第二段也需要授权才能继续。");
  f.put("changed.txt", "doc.md:1\nbuild.ts:4\n");
  const report = f
    .run("grades", "--changed", "changed.txt", "--format", "json", "doc.md")
    .json();
  assert.equal(report.candidates, 1);
  assert.equal(report.outsideChange, 1);
  assert.equal(report.unreachedRanges, 1);
  const text = f.run("grades", "--changed", "changed.txt", "doc.md");
  assert.equal(text.status, 0);
  assert.match(
    text.stdout,
    /1 outside the change, 1 ranges reached no scanned file/,
  );
});

for (const [name, entry, reason] of [
  ["an entry with no line number", "doc.md", /expected <path>:<start>-<end>$/],
  ["a range that ends before it starts", "doc.md:10-5", /invalid range$/],
  // `git diff` writes a new-side start of 0 for a hunk that deletes from line 1, so a caller
  // deriving ranges from a diff reaches this on an ordinary change. Letting [0, 0] through would
  // put every finding outside the change and report a gutted file clean.
  ["a line number of zero", "doc.md:0", /invalid range$/],
  ["an entry naming no path", ":5", /range names no path$/],
])
  test(`refuses ${name} in the range file`, (t) => {
    const f = fixture(t);
    // The scanned file exists and carries a finding, so the refusal is the range file's own and the
    // run has something to lose by falling silent instead.
    f.put("doc.md", LONG);
    f.put("changed.txt", entry);
    const result = f.run("--changed", "changed.txt", "doc.md");
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(
      result.stderr.split("\n")[0],
      /^prose-check: changed\.txt:1: /,
    );
    assert.match(result.stderr.split("\n")[0], reason);
  });

for (const [name, args] of [
  ["an unknown option", ["--verbose", "a.md"]],
  ["a value-less option", ["--exclude"]],
  ["an unknown format", ["--format", "yaml", "a.md"]],
  ["no path at all", []],
  ["an unreadable path", ["absent.md"]],
  ["an unreadable range file", ["--changed", "absent.txt", "a.md"]],
  // Accepting the flag and repairing nothing would let a caller believe the run had rewritten a
  // grade, which is the reader's judgement rather than the tool's.
  ["a repair of the listing", ["grades", "--fix", "a.md"]],
  // Every grade candidate is the same kind of question for a reader, so there is no severity to
  // filter the listing by and accepting the flag would answer a question the tool never asked.
  ["a severity filter on the listing", ["grades", "--errors-only", "a.md"]],
  ["a value-less option after the subcommand", ["grades", "--format"]],
])
  test(`refuses ${name} with the usage status`, (t) => {
    const f = fixture(t);
    // The named path exists and carries a finding, so each refusal is the option's own. Without the
    // file, a missing path answers with the same status and every row here passes on that instead:
    // measured by removing the two subcommand guards, which stayed green until this line was added.
    f.put("a.md", LONG);
    const result = f.run(...args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^prose-check: /);
  });
