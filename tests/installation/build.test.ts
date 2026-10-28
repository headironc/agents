import assert from "node:assert/strict";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkInstallBuild } from "../../scripts/check-install-build.ts";

const root = path.resolve(import.meta.dirname, "../..");
// The gate contract names these outputs independently of the build module.
const outputs = ["install.mjs", "install-licenses.txt"];

test("the installer bundle rebuilds identically from another root and stale or missing outputs fail", (t) => {
  checkInstallBuild(root);
  const temporary = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "agents-install-closure-")),
  );
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  for (const file of ["scripts", "package.json"])
    cpSync(path.join(root, file), path.join(temporary, file), {
      recursive: true,
    });
  for (const name of ["zod", "js-yaml"])
    cpSync(
      path.join(root, "node_modules", name),
      path.join(temporary, "node_modules", name),
      { recursive: true },
    );
  mkdirSync(path.join(temporary, ".cache/agents-build"), { recursive: true });
  symlinkSync(
    path.join(root, ".cache/agents-tools"),
    path.join(temporary, ".cache/agents-tools"),
  );
  for (const name of outputs)
    copyFileSync(
      path.join(root, ".cache/agents-build", name),
      path.join(temporary, ".cache/agents-build", name),
    );
  checkInstallBuild(temporary);
  // The CI supervisor launches the fixed bundler outside the candidate directory.
  checkInstallBuild(temporary, root);
  assert.match(
    readFileSync(
      path.join(temporary, ".cache/agents-build/install-licenses.txt"),
      "utf8",
    ),
    /== zod ==[\s\S]*== js-yaml ==/,
  );
  for (const name of outputs) {
    const file = path.join(temporary, ".cache/agents-build", name);
    const original = readFileSync(file);
    const diagnostic = new RegExp(name.replaceAll(".", "\\."));
    writeFileSync(file, Buffer.concat([original, Buffer.from("\n// stale\n")]));
    assert.throws(() => checkInstallBuild(temporary), diagnostic);
    rmSync(file);
    assert.throws(() => checkInstallBuild(temporary), diagnostic);
    writeFileSync(file, original);
  }
  checkInstallBuild(temporary);
});
