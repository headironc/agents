# Reviewing tests

Apply the [skill contract](../SKILL.md) and the project's read-only review boundary. Trace each property from its declared rule through generation, invocation, assertion, and failure handling.

- Check that generated values exercise the intended behavior rather than a trivial subset. Inspect discarded cases, constant results, unreachable branches, and exception handlers that convert failures to success.
- Check independence. A second copy of the implementation or two mutually compatible but incorrect conversion functions can pass while violating the specification.
- Check the equality relation: ordered collections, multisets, Unicode normalization, floating-point tolerance, timezone handling, and lossy encodings need explicit semantics.
- Check that asynchronous assertions are awaited and that timeout, filtering exhaustion, and infrastructure errors fail or report incomplete execution rather than a pass.
- Retain concrete regressions and known boundary examples. Property tests complement them.

Report an actionable finding with the current trigger, incorrect acceptance or rejection, governing rule, and the assertion or generator that permits it. Do not request broad production refactoring just because the test could be shorter. When permitted, demonstrate a weak assertion with a narrow disposable faulty variant; keep that diagnostic separate from the reviewed source.
