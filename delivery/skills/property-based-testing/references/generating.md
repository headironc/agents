# Generating tests

Start with the [skill contract](../SKILL.md) and a named behavioral rule. Generate the rule's domain directly: bounded sizes, valid relationships between fields, and meaningful distributions of edge and ordinary values. Use the library's combinators and dependent generators instead of rejecting nearly every generated case.

Keep invalid-input generators separate when the API promises rejection. Check the expected error category and absence of forbidden effects; catching every exception can conceal defects. Use isolated fixtures for filesystem, database, or network effects and preserve the consuming project's safety checks.

Pin known boundaries as examples: empty and singleton values, duplicates, Unicode, numeric extremes, and representation ambiguities when relevant. Shrinking should preserve the generator's validity constraints so the final case still belongs to the stated domain.

Use a bounded case budget and explicit timeout appropriate to the actual test. For asynchronous properties, await the runner and enforce cancellation or teardown at the project boundary. Record seeds and shrink paths on failure. A fixed CI seed makes regression runs reproducible; it samples one deterministic sequence rather than proving broad coverage. Deliberately broaden seeds only when the task calls for exploration.

Check that a plausible incorrect result would fail the assertion. Avoid reimplementing the function under test as the expected-value calculation. Useful examples include key-order invariance for unordered object records, ordering sensitivity for ordered sequences, preserved units, or agreement with independently maintained fixtures.
