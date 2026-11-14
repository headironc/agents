---
name: rust-risk-review
description: Review Rust unsafe and FFI boundaries, Send/Sync invariants, async cancellation, panic cleanup, resource exhaustion, and filesystem races. Use for a scoped risk review or diagnosis of these paths. Excludes general style review, whole-repository security certification, scanner operation, fuzzing, and ordinary property-test design.
license: CC-BY-SA-4.0
metadata:
  maintenance: local-adaptation
  upstream-repository: https://github.com/trailofbits/skills
  upstream-path: plugins/rust-review/prompts/general
---

# Rust risk review

Adapted from seven selected [Trail of Bits Rust review prompts](https://github.com/trailofbits/skills/tree/149d7b21f4067765b82e67029730b42d228ef4b4/plugins/rust-review/prompts/general). Credit Trail of Bits and contributors. Local changes narrow detection scope, retain counterexample checks, and replace upstream orchestration and reporting mandates with the host's review contract. This adaptation retains [CC-BY-SA-4.0](LICENSE.txt); no endorsement is implied.

## Select the boundary

Bind the review to the requested code, revision, supported targets, features, runtime and panic strategy. Locate constructors, callers, ownership transfer, cleanup and error paths before interpreting a suspicious pattern. Read only the relevant reference:

| Code under review | Reference |
| --- | --- |
| Dropped futures, task transfer, manual Send/Sync | [Async and threads](references/async-and-threads.md) |
| Unsafe initialization, unwinding, callbacks and foreign resources | [Unsafe and FFI](references/unsafe-and-ffi.md) |
| Untrusted cost or check/use of filesystem names | [Resources and files](references/resources-and-files.md) |

A search hit is a lead. Establish a reachable call sequence, violated invariant, affected configuration and concrete impact. Check the strongest plausible defense, including compiler rejection, exclusive ownership, upstream input limits and a properly enforced synchronization or lifetime contract. Distinguish an actionable defect from a hypothesis requiring missing caller or platform evidence. Do not assign severity from keywords, absence of tests, or code size.

## Validate within the task

Preserve read-only review boundaries and use the project's existing validation commands when authorized. A fixture containing undefined behavior is evidence to inspect, not permission to execute it. Miri, sanitizers, Loom, fuzzers and external scanners are separate capabilities with target and coverage limits; never claim they ran because a skill or tool exists. Do not install dependencies or launch additional agents merely to imitate the upstream workflow.

Report the smallest relevant location, triggering sequence, violated contract, impact, and a repair that preserves the owning API's behavior. Identify untested configurations and unresolved evidence. Reuse the host's review output and finding disposition process; no mandatory report directory or SARIF conversion is required. A bounded review with no findings is not a whole-program safety proof.

After a test ends and its results are consumed, the creating host removes temporary fixtures, sessions and unneeded evidence. A running test session leaves itself pending host cleanup, with its known identity or location and remaining deletion conditions.
