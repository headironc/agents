import path from "node:path";
import { run } from "node:test";
import { tap } from "node:test/reporters";
import type { TestEvent } from "node:test/reporters";

const files = process.argv.slice(2).map((file) => path.resolve(file));
if (files.length === 0 || new Set(files).size !== files.length) {
  throw new Error("Expected a nonempty list of unique test files");
}

// Use runner events, not console output: tests can print TAP-looking text.
async function* verifiedEvents(source: AsyncIterable<TestEvent>) {
  const completed = new Set<string>();
  let finalSummary = false;
  let incomplete = false;
  for await (const event of source) {
    // Node's summary counts omit skipped and TODO suites.
    if (
      (event.type === "test:pass" || event.type === "test:fail") &&
      (event.data.skip || event.data.todo)
    ) {
      incomplete = true;
    }
    if (event.type === "test:summary") {
      const { counts, file, success } = event.data;
      if (file === undefined) finalSummary = true;
      else completed.add(path.resolve(file));
      if (
        !success ||
        counts.tests === 0 ||
        counts.skipped > 0 ||
        counts.todo > 0 ||
        counts.cancelled > 0
      ) {
        incomplete = true;
      }
    }
    yield event;
  }
  // An empty file is a synthetic passing test in Node, but emits no file summary.
  if (
    incomplete ||
    !finalSummary ||
    files.some((file) => !completed.has(file))
  ) {
    process.exitCode = 1;
    process.stderr.write(
      "Incomplete test coverage: failed, skipped, todo, cancelled, empty or missing test results\n",
    );
  }
}

for await (const output of tap(
  verifiedEvents(run({ files, concurrency: true })),
)) {
  process.stdout.write(output);
}
