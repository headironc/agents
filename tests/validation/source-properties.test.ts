import assert from "node:assert/strict";
import test from "node:test";
import * as fc from "fast-check";
import { canonicalDigest } from "../../scripts/source.ts";

// Installation records promise sorted object keys and preserved array order.
// Generate JSON values, so undefined, sparse arrays and non-finite numbers are not silently normalized by the generator.
const json = fc.json().map((text) => JSON.parse(text) as unknown);
const settings = { seed: 20261114, numRuns: 200 };
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, item]) => [key, reverseKeys(item)]),
    );
  return value;
}

test(
  "installation record identity ignores object insertion order at every nesting level",
  { timeout: 10_000 },
  () => {
    fc.assert(
      fc.property(json, (value) => {
        const original = JSON.stringify(value);
        assert.equal(
          canonicalDigest(value),
          canonicalDigest(reverseKeys(value)),
        );
        assert.equal(JSON.stringify(value), original);
      }),
      settings,
    );
  },
);

test(
  "installation record identity survives JSON persistence but preserves sequence order",
  { timeout: 10_000 },
  () => {
    fc.assert(
      fc.property(json, (value) => {
        assert.equal(
          canonicalDigest(value),
          canonicalDigest(JSON.parse(JSON.stringify(value))),
        );
        const first = { slot: "first", value },
          second = { slot: "second", value };
        assert.notEqual(
          canonicalDigest([first, second]),
          canonicalDigest([second, first]),
        );
      }),
      settings,
    );
  },
);

test(
  "installation record identity rejects unsupported nested values instead of dropping or coercing them",
  { timeout: 10_000 },
  () => {
    fc.assert(
      fc.property(
        json,
        fc.constantFrom(undefined, NaN, Infinity, -Infinity, 1n, new Date(0)),
        (value, invalid) => {
          assert.throws(
            () => canonicalDigest({ value, nested: [invalid] }),
            /only JSON values/,
          );
        },
      ),
      settings,
    );
  },
);
