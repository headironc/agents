import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { lint } from "markdownlint/sync";
import type { MicromarkToken } from "markdownlint";
import { z } from "zod";
import { readSourceIdentity } from "./source.ts";
import { listSkillFiles } from "./skills.ts";

const subject = z.string().regex(/^[a-z][a-z0-9-]*$/);
const corePath = z.string().regex(/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/).refine(value =>
  !value.split("/").some(part => [".", "..", ".git", "network"].includes(part)), "Expected a core source path");
const InventorySchema = z.tuple([z.literal("subject"), subject, z.literal("core"), subject, z.literal("active"), z.literal("defined")]);
const OwnerSchema = z.tuple([z.literal("contract"), subject, subject, z.literal("conditional"), corePath,
  z.enum(["contract-subject", "comment-subject", "sha256"]), z.string().min(1)]);
const BindingSchema = z.tuple([z.literal("binding"), corePath, z.enum(["instructions", "skill", "script", "workflow"]), subject,
  corePath, z.enum(["read-before-use", "direct-execution", "enforced-wrapper"]), z.literal("defined")]);

/** Read the three distinct ownership records, also exposing non-doc-check inputs to the hook. */
export function readToolContracts(root: string) {
  function rows<T>(file: string, header: string, schema: z.ZodType<T>): T[] {
    readSourceIdentity(root, [file]);
    const [version, ...lines] = readFileSync(path.join(root, file), "utf8").split("\n");
    if (version !== header) throw new Error(`Invalid contract inventory version: ${file}`);
    const result = lines.filter(line => line !== "" && !line.startsWith("#")).map(line => schema.parse(line.split("\t")));
    if (result.length === 0) throw new Error(`Empty contract inventory: ${file}`);
    return result;
  }
  const inventory = rows("config/tool-inventory.txt", "agents-tool-inventory-v1", InventorySchema);
  const owners = rows("config/tool-contracts.txt", "agents-tool-contracts-v1", OwnerSchema);
  const bindings = rows("config/tool-bindings.txt", "agents-tool-bindings-v1", BindingSchema);
  const subjects = new Map(inventory.map(row => [row[1], row]));
  const definitions = new Map(owners.map(row => [row[1], row]));
  if (subjects.size !== inventory.length || definitions.size !== owners.length || subjects.size !== definitions.size) {
    throw new Error("Duplicate or missing contract ownership");
  }
  for (const owner of owners) {
    if (subjects.get(owner[1])?.[3] !== owner[2]) throw new Error(`Contract category or subject mismatch: ${owner[1]}`);
    if (owner[5] !== "sha256" && owner[6] !== owner[1]) throw new Error(`Owner marker mismatch: ${owner[1]}`);
    if (owner[5] === "sha256" && !/^[a-f0-9]{64}$/.test(owner[6])) throw new Error("Invalid fixed executor digest");
  }
  const keys = bindings.map(row => `${row[1]}\t${row[3]}`);
  if (new Set(keys).size !== bindings.length) throw new Error("Duplicate consumer binding");
  for (const binding of bindings) {
    if (definitions.get(binding[3])?.[4] !== binding[4]) throw new Error(`Binding owner mismatch: ${binding[3]}`);
  }
  for (const name of subjects.keys()) if (!bindings.some(row => row[3] === name)) throw new Error(`Unbound tool subject: ${name}`);
  const paths = [...new Set([...owners.map(row => row[4]), ...bindings.map(row => row[1])])];
  readSourceIdentity(root, paths);
  return { inventory, owners, bindings, paths };
}

// Use the existing public parser API; tokens establish paragraph/list-item and example boundaries.
function paragraphs(source: string): { text: string; line: number }[] {
  const result: { text: string; line: number }[] = [];
  lint({ strings: { source }, config: { default: false, "agents-paragraphs": true }, customRules: [{
    names: ["agents-paragraphs"], description: "Collect operative paragraphs", tags: ["agents"], parser: "micromark",
    function: params => {
      function visit(tokens: MicromarkToken[]): void {
        for (const token of tokens) {
          if (["blockQuote", "codeFenced", "codeIndented", "htmlFlow"].includes(token.type)) continue;
          if (token.type === "paragraph") result.push({ text: token.text, line: token.startLine });
          else visit(token.children);
        }
      }
      visit(params.parsers.micromark.tokens);
    },
  }] });
  return result;
}

function scriptHeader(source: string): string {
  const lines = source.split("\n");
  const first = lines.findIndex(line => line.trim() !== "" && !/^(?:#!|#|\/\/)/.test(line));
  return lines.slice(0, first < 0 ? lines.length : first).join("\n");
}

function headerRules(source: string): string {
  // Preserve separators so distinct comment paragraphs cannot become one operative route.
  return scriptHeader(source).split("\n").map(line =>
    /^(?:# |\/\/ )/.test(line) ? line.replace(/^(?:# |\/\/ )/, "") : "").join("\n");
}

/** Verify a documented tool's first operative use is routed in the same paragraph. */
export function checkReadRoute(source: string, owner: string, name: string): void {
  const use = `Use tool \`${name}\``;
  const unit = paragraphs(source).find(item => item.text.includes(use));
  if (!unit) throw new Error(`No operative tool use: ${name}`);
  const reference = new RegExp(`\\]\\(${RegExp.escape(owner)}(?:#[^\\s)]*)?\\)`);
  const position = unit.text.search(reference);
  if (position < 0 || position > unit.text.indexOf(use) || !/\b(?:Read|read)\b/.test(unit.text.slice(0, position))) {
    throw new Error(`Missing same-paragraph route before first use: ${name}`);
  }
}

/** Validate current core owners and consumer bindings; never inspect the network domain. */
export function checkToolContracts(root: string): void {
  const { owners, bindings } = readToolContracts(root);
  const declaredFiles = [...new Set([...bindings.map(row => row[1]),
    ...listSkillFiles(root).filter(file => file.endsWith(".md") ||
      file.includes("/scripts/") && !file.includes("/tests/") && /(?:\.(?:mjs|cjs|ts|sh|sh\.in)|\/resolve-latest-model-info)$/.test(file)),
    ...readdirSync(path.join(root, "scripts")).filter(file => /\.(?:ts|sh|py)$/.test(file)).map(file => `scripts/${file}`), ".githooks/pre-commit"])];
  readSourceIdentity(root, declaredFiles);
  for (const file of declaredFiles) {
    const source = readFileSync(path.join(root, file), "utf8");
    const declaration = file.endsWith(".md") ? source : headerRules(source);
    for (const unit of paragraphs(declaration)) for (const use of unit.text.matchAll(/Use tool `([a-z][a-z0-9-]*)`/g)) {
      if (!bindings.some(row => row[1] === file && row[3] === use[1] && row[5] === "read-before-use")) throw new Error(`Unregistered consumer use: ${file}: ${use[1]}`);
    }
  }
  for (const owner of owners) {
    const source = readFileSync(path.join(root, owner[4]), "utf8");
    const marker = `Contract subject: \`${owner[1]}\`.`;
    if (owner[5] === "sha256") {
      if (createHash("sha256").update(source).digest("hex") !== owner[6]) throw new Error(`Fixed executor changed: ${owner[1]}`);
    } else if (owner[5] === "comment-subject") {
      if (!scriptHeader(source).split("\n").some(line => line === `# ${marker}` || line === `// ${marker}`)) throw new Error(`Missing execution header: ${owner[1]}`);
    } else {
      const units = paragraphs(source);
      const matches = units.filter(unit => unit.text === marker);
      if (matches.length !== 1) throw new Error(`Missing or duplicate owner marker: ${owner[1]}`);
      const next = units[units.indexOf(matches[0]!) + 1];
      if (!next || next.text.startsWith("Contract subject:")) throw new Error(`Empty owner definition: ${owner[1]}`);
    }
  }
  for (const binding of bindings) {
    const source = readFileSync(path.join(root, binding[1]), "utf8");
    if (binding[5] === "read-before-use") {
      const declaration = ["script", "workflow"].includes(binding[2])
        ? headerRules(source)
        : source;
      if (binding[1] !== binding[4]) checkReadRoute(declaration, path.posix.relative(path.posix.dirname(binding[1]), binding[4]), binding[3]);
    } else if (binding[5] === "enforced-wrapper") {
      const marker = `Contract wrapper: \`${binding[3]}\` -> \`${binding[4]}\`.`;
      if (!scriptHeader(source).includes(marker)) throw new Error(`Missing wrapper declaration: ${binding[1]}`);
      // These are the delivered wrapper forms, not a general shell parser.
      const calls: Record<string, string> = {
        "scripts/check.sh": 'exec "$node" "$repository_root/scripts/check.ts" "$@"',
        "scripts/install.sh": 'exec "$node" "$repository_root/scripts/install.ts" "$@"',
        "scripts/install-tools.sh": 'source "$repository_root/scripts/tool-bootstrap.sh"',
      };
      if (!calls[binding[1]] || !source.split("\n").includes(calls[binding[1]]!)) throw new Error(`Missing actual wrapper call: ${binding[1]}`);
    } else if (binding[1] !== binding[4]) throw new Error("Direct execution must be owned by the consumer");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) { process.exitCode = 2; throw new Error("Usage: node scripts/check-tool-contracts.ts"); }
    checkToolContracts(path.resolve(import.meta.dirname, ".."));
    console.log("Core tool ownership and consumer routes passed");
  } catch (error) { console.error(error instanceof Error ? error.message : "Contract check failed"); process.exitCode ||= 1; }
}
