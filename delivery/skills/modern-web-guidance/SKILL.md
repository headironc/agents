---
name: modern-web-guidance
description: Consult Google's bundled Modern Web Guidance before implementing or reviewing HTML, CSS, browser JavaScript, web UI components, accessibility, performance, or browser APIs. Search the local official guidance and apply relevant features within the project's browser support policy. Excludes server-only code, infrastructure, non-web native UI, trivial text edits, and maintenance of this skill itself.
---

# Modern Web Guidance

Before browser implementation or a web-specific review, consult the relevant guidance using the workflow below. Preserve the requested scope, project conventions, browser support policy, and operation authority. This skill supplies technical guidance; it does not authorize refactoring an entire application, changing project configuration, installing tools, or publishing anything.

The CLI, search index, and guides are one pinned official npm release. Search runs locally against that release, not against live documentation. Do not describe its results as the latest official content without separately verifying that claim. The repository's update process owns version changes; do not run `npx @latest` or overwrite this installed skill.

Read the [CLI contract](references/cli.md). Use tool `modern-web-guidance` under that contract. Resolve the CLI and references from this skill's physical installed directory, not the working project's directory.

## Find and apply guidance

1. Identify the browser capability implied by the task, such as a dialog, form validation, table, layout, navigation, or animation. Search each relevant capability using two to five plain words. Omit framework names and business vocabulary that do not describe the browser behavior.
2. Inspect result descriptions, then retrieve only matching guide IDs. If the results are weak or empty, rephrase once, then use `list` once if needed. An unrelated guide is not useful evidence; report a remaining gap and use an authoritative source when necessary.
3. Read the complete retrieved guides before implementing their recommendations. Respect their applicability, browser support, accessibility, security, and fallback conditions. The project's explicit browser matrix takes precedence over the default Baseline Widely Available target.
4. Apply the relevant recommendations within the selected task. Keep framework integration consistent with the project. For review-only work, report findings without editing the reviewed material.
5. Report the material choices and supporting guide IDs or official links with the normal task result. Mention the pinned release and any missing or unverified coverage when relevant. Do not add a mandatory report heading, copied quotations, or unrelated modernization suggestions.

Use `legacy-scan` only for an explicitly requested broad modernization assessment. Read the [scan contract](references/cli.md#broad-modernization) first. Ordinary implementation and review use targeted search and retrieval.

## Source and maintenance

The [upstream entry](upstream/SKILL.upstream.md) is retained as provenance, not as a second instruction entry. This local adaptation narrows discovery, binds the bundled runtime, disables telemetry, preserves project authority, and applies the shared temporary-resource lifecycle. It replaces upstream instructions to download a floating CLI, prompt unconditionally for network permission, or impose a separate response format.

Software retains its [Apache-2.0 license](upstream/LICENSE) and [third-party notices](upstream/THIRD_PARTY_NOTICES). Guides use CC-BY-4.0 with the attributions retained in the [official README](upstream/README.upstream.txt) and individual guides. Update original files and their source lock together; never edit bundled executables to repair a local contract.
