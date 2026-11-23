# Developer Knowledge REST API Fallback

Use `https://developerknowledge.googleapis.com/v1` only when Developer Knowledge MCP tools are unavailable in the active runtime and `DEVELOPERKNOWLEDGE_API_KEY` is configured. Read [the shared HTTP contract](../../../../../policy/tool-contracts.md#curl) before executing requests. Use tool `curl` with stdin config (`-K -`) so credentials stay out of URLs, process `argv`, and tool stdout.

## Authentication Boundary (No OAuth Tokens in Agent Stdout or Secrets in URLs)

1. **Google OAuth (`google_credentials`) -> Use MCP Only**:
   - **Never run** `gcloud auth print-access-token` or `gcloud auth application-default print-access-token` in agent shell commands. Tool `stdout` enters the model session before redaction can apply, and the `gcloud` contract forbids `$(...)` command substitution, pipes, and redirection.
   - Users relying on Google OAuth credentials without a Developer Knowledge API key must use the mounted Developer Knowledge MCP server ([MCP Usage](mcp-usage.md)).
2. **REST Fallback -> Header-Based `DEVELOPERKNOWLEDGE_API_KEY` via `curl -K -`**:
   - Confirm `DEVELOPERKNOWLEDGE_API_KEY` is non-empty and single-line without quotes, backslashes, or newlines (never print its value).
   - Pipe the header over stdin via shell builtin `printf` into `curl -fsS -K -` (`printf` runs inside the shell without exposing the secret in external `argv` or URLs). **Never** append `?key=` to any URL or pass `-H "X-Goog-Api-Key: ..."` inline on the command line.
   - If MCP is unavailable and `DEVELOPERKNOWLEDGE_API_KEY` is unset, report the missing credential and direct the user to [Developer Knowledge quickstart](https://developers.google.com/knowledge/quickstart).

## Endpoints

### 1. `:answerQuery` (Conceptual Guides and Overviews)

```bash
printf 'header = "X-Goog-Api-Key: %s"\n' "${DEVELOPERKNOWLEDGE_API_KEY}" \
  | curl -fsS -K - --connect-timeout 10 --max-time 30 \
    -X POST "https://developerknowledge.googleapis.com/v1:answerQuery" \
    -H "Content-Type: application/json" \
    -d '{"query": "How do I configure public read access prevention on Cloud Storage?"}'
```

On HTTP `429` (`RESOURCE_EXHAUSTED`), switch immediately to `documents:searchDocumentChunks` with 2–5 focused keywords.

### 2. `documents:searchDocumentChunks` (Flags, Permissions, and Syntax)

```bash
printf 'header = "X-Goog-Api-Key: %s"\n' "${DEVELOPERKNOWLEDGE_API_KEY}" \
  | curl -fsS -G -K - --connect-timeout 10 --max-time 30 \
    "https://developerknowledge.googleapis.com/v1/documents:searchDocumentChunks" \
    --data-urlencode "query=gcloud logging metrics create"
```

Optional query parameters: `filter` (for example `data_source = "docs.cloud.google.com"`) and `pageSize` (default `10`).

### 3. `documents/{URI_WITHOUT_SCHEME}` (Full Document Retrieval)

```bash
printf 'header = "X-Goog-Api-Key: %s"\n' "${DEVELOPERKNOWLEDGE_API_KEY}" \
  | curl -fsS -K - --connect-timeout 10 --max-time 30 \
    "https://developerknowledge.googleapis.com/v1/documents/docs.cloud.google.com/run/docs/overview/what-is-cloud-run"
```

### 4. `documents:batchGet` (Up to 20 Documents via GET)

Must be `GET` with repeated `--data-urlencode "names=documents/..."` parameters (a `POST` returns HTTP `404`). Pass `view=DOCUMENT_VIEW_BASIC` when only titles/URIs are needed to save context.

```bash
printf 'header = "X-Goog-Api-Key: %s"\n' "${DEVELOPERKNOWLEDGE_API_KEY}" \
  | curl -fsS -G -K - --connect-timeout 10 --max-time 30 \
    "https://developerknowledge.googleapis.com/v1/documents:batchGet" \
    --data-urlencode "names=documents/docs.cloud.google.com/run/docs/overview/what-is-cloud-run" \
    --data-urlencode "names=documents/docs.cloud.google.com/storage/docs/creating-buckets"
```
