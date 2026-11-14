---
name: property-based-testing
description: Write, review, or diagnose property-based tests for parsers, serializers, conversions, validators, collections, and domain invariants. Use when an independently stated property can cover an input domain, or when investigating generated counterexamples. Excludes ordinary example-only tests, coverage-guided fuzzing, benchmarking, security scanning, and end-to-end UI automation.
license: CC-BY-SA-4.0
metadata:
  maintenance: local-adaptation
  upstream-repository: https://github.com/trailofbits/skills
  upstream-path: plugins/property-based-testing/skills/property-based-testing
---

# Property-Based Testing

Identify the behavior and permitted effects before selecting a property. Use the consuming project's language, pinned tools, test command, and dependency policy. Preserve useful example tests. A source review permits applicable validation, but does not authorize rewriting the reviewed code or installing dependencies.

This skill adapts Trail of Bits' [property-based-testing guidance](https://github.com/trailofbits/skills/tree/149d7b21f4067765b82e67029730b42d228ef4b4/plugins/property-based-testing/skills/property-based-testing), originally authored by Henrik Brodin and contributors, under [CC-BY-SA-4.0](LICENSE.txt). Local changes narrow triggers, preserve project authority, remove client-specific effort and evaluation machinery, and qualify property strength and refactoring advice. The local adaptation carries the same license. Source maintenance and attribution do not imply Trail of Bits endorsement.

## Choose the task

Load the reference needed for the actual task:

| Task | Reference |
| --- | --- |
| Design properties and generators | [Generating tests](references/generating.md) |
| Judge an existing property's value | [Reviewing tests](references/reviewing.md) |
| Investigate a failing generated case | [Interpreting failures](references/interpreting-failures.md) |
| Assess a missing test seam | [Refactoring boundaries](references/refactoring.md) |
| Select an existing or proposed test library | [Libraries](references/libraries.md) |

## Ground the property

State the rule and its source: a documented API contract, business invariant, algebraic law, or independent implementation. Define valid inputs, invalid inputs, allowed normalization, and observable equality before writing the generator. Missing semantics are a specification question; a plausible property is not automatically a requirement.

| Candidate | Necessary qualification |
| --- | --- |
| Roundtrip | Account for normalization, lossy fields, ordering, and equality semantics |
| Oracle comparison | Establish oracle independence, domain, and precision |
| Idempotence | Pair with an independently justified postcondition; an identity function is also idempotent |
| Invariant or metamorphic relation | Connect the relation to permitted input changes and promised output behavior |
| Commutativity or associativity | Verify that ordering and numeric precision permit the law |
| No crash | Assert documented outcomes too when possible; do not hide unexpected exceptions |

Choose properties that can reject plausible wrong behavior. An inverse pair can share a bug; add independent examples or invariants where needed. Do not impose a universal ranking that makes roundtrip stronger than every business invariant.

## Execute and report

Reuse the project's existing property library. Adding a dependency or changing production seams follows the task's effective authorization and project policy; ask only for an uncovered decision. Read-only review retains its boundary. Do not add a helper framework or production API solely to make this skill applicable.

Use bounded generators, explicit test timeouts, and the runner's failure and shrinking output. Report the actual command, seed or replay path, completed case count when available, and whether execution stopped or exhausted its input filter. A sampled pass does not prove a universal law or complete coverage.

Classify a failure before proposing a fix. Preserve the minimal input and replay instructions while a diagnosis or review still needs them. After their consumers finish, apply the host's exercise cleanup rules. The creating or managing host removes any test session after it ends; a running test session reports itself as pending host cleanup and never deletes itself.
