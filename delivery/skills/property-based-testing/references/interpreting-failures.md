# Interpreting failures

Follow the [skill contract](../SKILL.md). Reproduce the reported seed and shrink path with the same library, runtime, and relevant environment before changing the test or implementation. Retain the minimal failing input and exact observed versus required outcome while diagnosis remains active.

Classify the result:

| Class | Next action |
| --- | --- |
| Wrong property or generator | Identify the contradicted contract or out-of-domain input; correct the test within its authorized scope |
| Ambiguous specification | State the competing behaviors and the business decision needed; keep dependent changes pending |
| Implementation defect | Show the independently justified requirement, valid input, and wrong result; repair only within the authorized scope |
| Environment or harness failure | Diagnose setup, exhaustion, timeout, missing await, or nondeterminism; report behavior unverified until the test actually runs |

Do not weaken a property merely to obtain a green run. A smaller counterexample is easier to inspect, but does not establish the root cause or severity by itself. If a defect is repaired, retain an appropriate regression in the project's ordinary tests and run affected examples alongside the property suite. Remove disposable copies after diagnosis and review consumers finish.
