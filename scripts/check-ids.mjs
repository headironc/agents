#!/usr/bin/env node
// Contract subject: `id-check`.
//
// Checks that the identifiers naming rows of a table stay unique and keep their numbering in the
// order a reader meets them.
//
// Usage: node check-ids.mjs [--exclude PREFIX]... [--pattern REGEX] [--format json] PATH...
//        node check-ids.mjs --version
//
// A row identified by a number is cited from elsewhere, so a row inserted in the wrong place leaves
// two documents disagreeing about which case a number names. The file still parses and every other
// check still passes, which is why this one exists. A gap in the numbering is fine; going backwards
// is not. Exits 0 when the order holds, 1 on any violation, and 2 on a usage error.
//
// `--version` prints one bare token, which is what a consumer's tool manifest matches against.
//
// It takes no `--changed`, and the omission is deliberate. An order finding is reported at the row
// that descends, not at the one it descends from, so inserting `X-09` between `X-04` and `X-06`
// reports at the `X-06` line, which the author never touched. Scoping to changed lines would hide
// exactly the defect the insertion caused. The prose checker can scope because a long sentence
// belongs to the line it occupies; an order belongs to a pair.
//
// Rows are read from a syntax tree, so a line that looks like a table row inside a fenced block is
// not one. This file is the source; `delivery/tools/check-ids.mjs` is the product that ships.

import fs from "node:fs";
import path from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { frontmatter } from "micromark-extension-frontmatter";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";

const DEFAULT_PATTERN = "^([A-Za-z][A-Za-z0-9]*)-(\\d+)$";

// A consumer pins this tool the way it pins every other one, by a version its own checker can match
// against a manifest entry. Changing which rows count or which order holds is a major bump.
const VERSION = "1.0.0";

const USAGE =
  "Usage: node check-ids.mjs [--exclude PREFIX]... [--pattern REGEX] [--format json] PATH...\n       node check-ids.mjs --version";

function usage(message) {
  process.stderr.write(`id-check: ${message}\n${USAGE}\n`);
  process.exit(2);
}

function parseArguments(argv) {
  const options = {
    exclude: [],
    pattern: DEFAULT_PATTERN,
    format: "text",
    paths: [],
  };
  if (argv.length === 1 && argv[0] === "--version") {
    process.stdout.write(`${VERSION}\n`);
    process.exit(0);
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--exclude" || flag === "--format" || flag === "--pattern") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--"))
        usage(`option ${flag} needs a value`);
      if (flag === "--exclude") options.exclude.push(value.replace(/\/+$/, ""));
      else if (flag === "--pattern") options.pattern = value;
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
  let pattern;
  try {
    pattern = new RegExp(options.pattern);
  } catch {
    usage(`unusable pattern: ${options.pattern}`);
  }
  if (!/\(.*\).*\(.*\)/s.test(options.pattern))
    usage("pattern needs a prefix group and a number group");
  return { ...options, pattern };
}

/** The plain text of a cell, with whatever markup a reader does not see already gone. */
function plain(node) {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  return (node.children ?? []).map(plain).join("");
}

/** Every identifier naming a table row, in the order a reader meets it. */
function identifiers(text, pattern) {
  const tree = fromMarkdown(text, {
    extensions: [gfm(), frontmatter(["yaml", "toml"])],
    mdastExtensions: [
      gfmFromMarkdown(),
      frontmatterFromMarkdown(["yaml", "toml"]),
    ],
  });
  const found = [];
  const walk = (node) => {
    if (node.type === "tableRow") {
      const cell = node.children?.[0];
      const match = cell && pattern.exec(plain(cell).trim());
      if (match)
        found.push({
          identifier: match[0],
          prefix: match[1],
          number: Number(match[2]),
          line: node.position.start.line,
        });
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return found;
}

function findings(file, text, pattern) {
  const out = [];
  const seen = new Map();
  const last = new Map();
  for (const row of identifiers(text, pattern)) {
    // A pattern whose second group captures nothing makes every number NaN and every comparison
    // false, so the checker would pass anything. A gate must fail loudly on that, not fall silent.
    if (!Number.isFinite(row.number))
      usage(
        `pattern's second group did not capture a number: ${row.identifier}`,
      );
    const first = seen.get(row.identifier);
    if (first !== undefined) {
      // One defect, one finding. The repeat is the fault; whether it also sits below the running
      // maximum says nothing more, and reporting both would suggest two problems.
      out.push({
        file,
        line: row.line,
        rule: "duplicate-identifier",
        severity: "error",
        text: `${row.identifier} is already used at line ${first}`,
      });
      continue;
    }
    seen.set(row.identifier, row.line);
    const previous = last.get(row.prefix);
    if (previous !== undefined && row.number < previous.number) {
      out.push({
        file,
        line: row.line,
        rule: "identifier-order",
        severity: "error",
        text: `${row.identifier} follows ${previous.identifier} at line ${previous.line}`,
      });
    }
    if (previous === undefined || row.number > previous.number)
      last.set(row.prefix, row);
  }
  return out;
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

const all = [];
for (const file of files)
  all.push(...findings(file, fs.readFileSync(file, "utf8"), options.pattern));

if (options.format === "json") {
  console.log(
    JSON.stringify(
      { files: files.length, errors: all.length, findings: all },
      null,
      2,
    ),
  );
} else {
  for (const finding of all)
    console.log(
      `${finding.file}:${finding.line}: error: ${finding.rule}: ${finding.text}`,
    );
  console.log(`id-check: ${files.length} files, ${all.length} errors`);
}
process.exitCode = all.length ? 1 : 0;
