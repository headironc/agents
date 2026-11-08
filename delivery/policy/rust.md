# Rust Coding Preferences

These preferences, including type grouping, apply within the scope explicitly adopted by a project's instructions, subject to explicit project overrides. Apply them together with the shared rules in [AGENTS.md](../AGENTS.md), resolved relative to this document.

These requirements remain applicable when a consuming project has not enabled the delivered lint configuration. The configuration enforces part of this document; a missing check or a missed violation does not change the requirement. Keep invocation details and measured coverage limits with that configuration.

## Workspace validation

- Use the project-pinned toolchains and CI commands for builds, tests, Clippy, rustdoc and formatting. Keep a separately pinned formatting toolchain from changing the default build toolchain.
- During iterative coding and refactoring, run fast incremental checks (`cargo check -p <package>` and targeted `cargo test -p <package> <test_name>`) to avoid workspace-wide feature-unification recompilation thrashing, reusing valid results while inputs remain unchanged.
- Before publication or when dependency features change, build each workspace package's normal delivered library and binary targets per package and run per-package tests alongside the consuming project's required Clippy, rustdoc, and formatting checks (keeping exact commands, feature selections, warning policies, and toolchain versions in that project). Workspace-wide builds, `--all-targets`, or test builds do not substitute for per-package delivery builds because `dev-dependencies` or other workspace packages can implicitly enable features. Expand validation to affected consumers for shared changes, including delivered binaries and test fixture packages.
- When a package directly uses a dependency feature, declare that feature in the consuming package's dependency specification. Do not rely on another workspace package to enable it.
- Keep test fixtures, test-only embedded databases and other test tools out of application packages' normal and build dependency graphs. Applications consume fixture libraries through `dev-dependencies`; test-only fixture packages may use normal dependencies to implement those libraries. An embedded database used as production storage remains a normal application dependency.
- Keep deployment and migration dependencies in the packages that own those operations. Check production dependency boundaries through the project's CI and preserve those gates when the scope changes.
- Before database tests, read the project's database safety and verification requirements for isolation, migrations, runtime identity, fixture lifecycle and host requirements. Apply the [shared validation boundary](../AGENTS.md#checks).

## Module layout

- When a module has both `<name>.rs` and a corresponding `<name>/` directory, place the module root in `<name>/mod.rs` instead of beside the directory. For example, `user.rs` and `user/profile.rs` become `user/mod.rs` and `user/profile.rs`.
- Keep a leaf module without a corresponding directory in a single `<name>.rs` file.
- Keep module declaration blocks and their imports together.
- Keep unit tests in an inline `#[cfg(test)] mod tests { ... }` within the same source file as the code under test. Do not split unit tests into separate files, including `tests.rs` or files loaded through `#[path]` or `include!`. Integration tests in the crate's `tests/` directory remain separate.
- Organize integration tests by noun and acceptance tests by surface, registering new modules in the layer's `main.rs` where that layout applies. Acceptance tests exercise the public surface. Out-of-process service or CLI acceptance tests must not import workspace implementation libraries; library acceptance tests may import the crate under test through its public API.

## Type grouping

Within a file, keep a type definition and its associated `impl` blocks together. Place supporting types, including error enums, before or after that group.

## Derive order

- Order needed standard derives as `Debug`, `Default`, `Clone`, `Copy`, `PartialEq`, `Eq`, `PartialOrd`, `Ord`, `Hash`. Omit traits the type does not need.
- Place other derives afterward, grouped by purpose in this order: serialization, database conversion, validation, then errors. Place an unlisted derive beside the traits it serves.
- Preserve the required relative order of procedural derives, including newly added ones, even when it overrides the purpose grouping above.

## Naming

- Use `snake_case` for modules, functions, methods and variables, `UpperCamelCase` for types, traits and variants, and `SCREAMING_SNAKE_CASE` for constants and statics. [The delivered lint configuration](../capability/rust-lints.toml) denies `rustc`'s `nonstandard_style` group to enforce these requirements when enabled.
- Use `snake_case` for macros; review this separately from ordinary identifier lints.
- Treat acronyms as words in type names, as in `HttpClient` and `Uuid`; review this even when Clippy reports no violation.
- Use module context to omit redundant prefixes, as in `session::Token`, `Id`, or `Error`, while keeping names unambiguous at their use sites.
- Name business models for the concepts they represent. Do not replace the business name with a generic storage label such as `Stored`.
- Use enum context to avoid redundant variant names, as in `Status::Active`.
- Keep the names in one state set consistent in grammatical form and meaning.
- Keep standard predicate method names such as `is_empty()`. Provide `is_empty()` alongside a public `len()`. Review predicate names in addition to CI's configured checks.
- Name ordinary getters after the value, as in `name()` or `id()`.
- Name mutable getters with the `_mut` suffix when they are needed.
- Use `new` for ordinary construction, including construction that returns `Result`. Have `new()` construct the enclosing type, and provide `Default` alongside an argument-less `new()` that returns `Self`. Review the choice of constructor name alongside the configured constructor lints.
- Use `as_*` for cheap borrowed views.
- Use `to_*` for conversions that leave the source usable, including conversions from `Copy` values.
- Use `into_*` for conversions that consume the source value.
- Choose among these three by what the conversion does to the source; a passing lint check does not establish the naming contract.
- Do not require a `try_` prefix solely because a function returns `Result`.
- Name queries by their purpose. Use a singular business noun after `find_` for a single result and its plural for a collection, as in `find_user_by_mobile` and `find_users_by_role`.
- For single-result queries, `find_*` expresses absence with `Option`; `fetch_*` requires a value and returns `Result`. Preserve both failure and absence in the result model when the operation has both outcomes.
- Collection queries express zero matches with an empty collection. Do not add `Option` merely to represent zero matches; preserve technical failures separately from an empty successful result.
- Name local variables of type `Option<T>` `option`. After extracting the contained value, name it by its meaning.
- Allow variable shadowing as one concept moves through successive representations.
- Use distinct names such as `raw_mobile` and `mobile` when both representations remain relevant.

## Literals

- Write a literal containing a quote, a backslash, or a regex escape as `r#"..."#` rather than escaping those characters, as in `r#"^\d{11}$"#` and `r#"{"mobile": "13800000000"}"#`.
- Keep the one `#`, including where the content would allow `r"..."`, so every raw literal reads the same. Add another only when the content itself contains `"#`. This preference opposes `clippy::needless_raw_string_hashes`, which is off by default; a project that enables the pedantic group chooses between the two and records that choice with its other lint allowances.
- Keep an escape where the value has no raw form, as in `\t`, `\0`, and `\u{1f600}`, or where a real line break would change the surrounding layout.

## Imports and conversions

- Use `crate::...` for imports and re-exports within the crate, including tests. Leave a blank line between module declarations and imports.
- Follow the project's rustfmt settings for edition and import formatting: standard-library, external-crate and local-module groups separated by blank lines, with crate-level import granularity. Other workspace crates belong to the external group.
- Use the shortest unambiguous paths at use sites. Import unique type names directly, use module qualification for collisions, and use full paths only when necessary.
- Do not rename imports with `use ... as ...`; resolve collisions through module qualification.
- Avoid `as` casts. Prefer coercions or the semantically appropriate `From` and `TryFrom` conversions.

## Value types

- Use semantic value types when meaning, units, or invariants need protection.
- Use an enum for a closed business vocabulary; keep open-ended text as text.
- Reuse the matching standard-library, dependency, or owning SDK type before introducing an application newtype or retaining a primitive representation.
- Let an SDK own its public value types and intrinsic validation; let the application own input sources, required settings, and deployment pairing rules.
- Introduce a local newtype for a distinct application meaning or invariant not already represented by an available type, not for every string or number.
- Name an entity's identifier type `Id` inside its owning module (distinguished by module qualification as in `user::Id` and `role::Id`, with variables and parameters named `user_id` or `role_id`); a shared macro may generate a separate `Id` newtype in each owning module.
- Keep noninterchangeable business values distinct even when their representation is the same string or UUID type. Credentials and identifiers for different protocols or roles may share format validation without sharing a business type.
- Express timeout and measurement units through a suitable existing type, such as `Duration` or an SDK unit type; introduce a unit-specific newtype only when the contract needs distinct unit semantics or additional invariants.

## Input and result models

- Group parameters with a common meaning into an input struct with a clear responsibility; use nesting for actual ownership or invariants.
- Prefer a struct for an ordinary response and an enum when its valid forms are mutually exclusive.
- Use `Option<T>` only when absence is a valid state. Acquire resources required throughout an object's usable lifetime before returning it, and store them directly. Do not introduce `None` merely to defer required construction; retain optionality when the actual lifecycle permits absence.
- Keep database `Row`, column selection, and decoding inside the fixed query's implementation. Return the model or projection needed by current callers, and choose query scope from the actual business flow.
- Express fallible row-to-model conversion with `TryFrom<Row>` rather than an equivalent inherent `decode` or `from_row` method.
- When database callers consume semantic value types, use the driver's applicable conversion traits, such as `FromSql` and `ToSql`, to preserve those invariants across decoding and encoding instead of repeatedly dismantling and rebuilding values in business code. Inspect derived and manual conversions for unchecked construction; add only implementations needed by actual consumers.

## Settings

- Apply the [shared settings ownership and loading boundary](../AGENTS.md#code-preferences): group settings by consuming capability with private fields and validated constructors, let entrypoint-private Serde input structs own required fields, defaults (applied only when an input is absent, rejecting explicitly empty values), and unknown-field rejection, and convert inputs into domain settings through explicit constructors.
- Name project-owned aggregate containers `Settings` (module/value `settings`), omit redundant enclosing-group field prefixes (as in `Endpoint { host, timeout }`), and preserve official dependency names such as `config::Config`.
- Load production entrypoints directly from agreed sources using an existing crate; keep explicit input maps or environment injection as internal test entrypoints.

## Errors and validation

- Inspect dependency error variants and caller handling before wrapping errors, applying the [shared error and redaction contract](../AGENTS.md#code-preferences) and the [SQL failure boundary](sql.md#database-failures) for database errors.
- Prefer `#[from]` and `?` (or `match` / a named function, without error-conversion closures) for wrapping, and use early returns for completed success paths.
- Log errors with `Debug`, never `Display`, only at the final handling boundary without exposing secrets or raw database payloads.
- Do not use `unwrap()`. Allow `expect()` with a reason only in test modules, integration-test crates, or test-only fixture packages under [workspace validation](#workspace-validation); keep it denied in production and examples.
- Enforce invariants in constructors, `FromStr`, `TryFrom`, and `Deserialize` (mapping validation errors into `D::Error`); never expose unchecked constructors or `From<Raw>` implementations that bypass domain validation.
- Use domain error names such as `name::ParseError`, reduce large payload fields for `clippy::result_large_err` instead of suppressing the lint, and validate fixed regex literals at compile time or one-time lazy initialization rather than on each input's parse path.

## Ownership and abstraction

- Pass one-use values directly unless ownership, borrowing, reuse, or evaluation timing requires a binding.
- Choose borrowing or ownership from the caller's use after the call and the callee's responsibility. Borrow for access that leaves the caller owning the value; move an object when it is consumed, retained, or submitted once with no remaining caller use.
- Borrow mutably when modifying a value that remains owned by the caller.
- Support `Copy` for simple states and values when implicit duplication fits their semantics and API commitments; pass and return suitable small `Copy` values by value.
- Let the caller choose whether to move or clone a value when ownership is required.
- Clone when independent ownership is needed after checking that the ownership boundary is appropriate.
- Consider clone costs on hot paths without complicating lifetimes merely to eliminate every clone.
- Do not require multiple implementations before accepting an otherwise justified trait.
- Prefer a semantically matching standard trait over an equivalent inherent method for a needed operation, such as `FromStr`, `TryFrom`, or `Display`. Use `AsRef<str>` for a needed cheap, infallible borrowed string view.
- Use inherent methods when restricted visibility, clearer domain meaning, or additional behavior requires them. Provide both interfaces only when actual caller needs justify them.
- Provide a direct semantic accessor such as `as_bytes()` when actual callers need that view repeatedly, rather than requiring them to navigate representation conversions at each use.
- Keep semantic value types at business API boundaries where their invariants are required; implementing a conversion trait does not justify weakening those inputs to arbitrary strings. A representation bound such as `AsRef<[u8]>` proves access to bytes, not that a value has the business qualification required by the operation. Check input and result types against that qualification rather than relying on the trait bound alone.

## References

These references provide background for Rust conventions. The preference statements above define the choices adopted here.

- [Rust API Guidelines: naming](https://rust-lang.github.io/api-guidelines/naming.html)
- [Rust API Guidelines: type safety](https://rust-lang.github.io/api-guidelines/type-safety.html)
- [Rust API Guidelines: caller control](https://rust-lang.github.io/api-guidelines/flexibility.html#c-caller-control)
- [Rust API Guidelines: interoperability](https://rust-lang.github.io/api-guidelines/interoperability.html)
- [Rust standard library: AsRef](https://doc.rust-lang.org/std/convert/trait.AsRef.html)
- [Rust standard library: Copy](https://doc.rust-lang.org/std/marker/trait.Copy.html)
- [Rust standard library: From and error handling](https://doc.rust-lang.org/std/convert/trait.From.html)
- [Rust Reference: visibility and privacy](https://doc.rust-lang.org/reference/visibility-and-privacy.html)
- [Rust Book: when to panic](https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html)
- [Serde: converting error types](https://serde.rs/convert-error.html)
- [Serde: container attributes](https://serde.rs/container-attrs.html)
- [Serde: field defaults](https://serde.rs/field-attrs.html)
- [Clippy: large error results](https://rust-lang.github.io/rust-clippy/stable/index.html#result_large_err)
