# Bundled CLI contract

Contract subject: `modern-web-guidance`.

Run the official `upstream/modern-web.mjs` with Node.js 22 or later, as required by the bundled CLI's startup check. Verify the runtime before first execution and reuse that binding while unchanged. If it is unavailable, report the missing prerequisite; this contract does not authorize an installation. Resolve `SKILL_ROOT` to this skill's physical installed directory. All arguments remain separate, quoted values.

Set `DISABLE_TELEMETRY=1` and `ENABLE_FILE_LOGGING=false` for each invocation. Do not change the user's shell configuration. Read the bundled `upstream/skill-version.txt` and pass that value as `--skill-version`; it controls version messaging, not the selected corpus. The invoked bundle selects the actual corpus.

```bash
DISABLE_TELEMETRY=1 ENABLE_FILE_LOGGING=false node "$SKILL_ROOT/upstream/modern-web.mjs" search "modal dialog" --skill-version "$SKILL_VERSION"
DISABLE_TELEMETRY=1 ENABLE_FILE_LOGGING=false node "$SKILL_ROOT/upstream/modern-web.mjs" retrieve "dialog" --skill-version "$SKILL_VERSION"
DISABLE_TELEMETRY=1 ENABLE_FILE_LOGGING=false node "$SKILL_ROOT/upstream/modern-web.mjs" list --skill-version "$SKILL_VERSION"
```

Use IDs exactly as returned; the example is not a guarantee that every later release retains an ID. `retrieve` accepts comma-separated IDs. Read its full output, including applicability and fallback guidance. A zero exit code alone does not prove every requested ID was found: inspect errors and returned sections. Treat an unknown ID, malformed output, or incomplete file read as missing guidance.

The CLI searches for `.mwgrc` from the working directory towards the project root, with a home-directory fallback. Preserve that file and the project's browser support decisions. Do not invoke configuration setters as part of search or retrieval. Origin-trial and volatile features require explicit project adoption; this skill does not opt projects in.

Read the [temporary-directory contract](../../../policy/tool-contracts.md#task-temp). Use tool `task-temp` for disposable CLI output. Large retrievals can produce a file instead of inline content. Redirect retrieval stdout into a regular file inside the managed temporary directory and read the entire file during the same foreground command, or retain an explicitly owned allocation until its reader finishes. Keep all resulting files within the tracked allocation and verify cleanup. Do not use a shared fixed `/tmp` filename. Preserve evidence still required for an unresolved check, then apply the [exercise cleanup rules](../../../policy/execution.md#test-and-exercise-cleanup).

## Broad modernization

`legacy-scan` is for a requested broad assessment. It offers a deterministic subset of modernization candidates, not an exhaustive codebase audit. Run it under the same runtime, telemetry, output, and cleanup contract. Check each candidate's `keepWhen` and `dropWhen` conditions against actual project code before reporting a finding. An assessment does not authorize edits; implement only changes covered by the user's request.

If an invocation fails, report the exact capability and failure, then continue unaffected work. Do not silently install another version, remove browser gates, or substitute unrelated guides to claim success.
