# Refactoring boundaries

Follow the [skill contract](../SKILL.md). First inspect the existing public API, inputs, outputs, and observable effects. A mutating operation can often be tested by saving its input and observing its result; mutation alone does not make before/after assertions impossible.

When a valuable property is hidden behind I/O or global state, identify the smallest existing seam or test injection point. A pure calculation extracted from I/O may help, but a source review does not authorize that change. Preserve public behavior, transaction boundaries, and ownership when implementation work does permit it.

Do not add an inverse parser, generic renderer, wrapper, or public API solely to manufacture a roundtrip. Independent known vectors, metamorphic relations, or ordinary example tests may cover the requirement without new production responsibilities.

If a proposed seam materially changes architecture or public behavior, name the concrete property and the added responsibility before seeking the missing decision. If no useful independent property exists, explain that outcome and use the project's appropriate existing tests.
