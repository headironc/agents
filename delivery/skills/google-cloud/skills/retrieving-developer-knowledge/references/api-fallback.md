# Developer Knowledge REST API Fallback

Use `https://developerknowledge.googleapis.com/v1` whenever Developer Knowledge MCP tools are unavailable in the active runtime. Read [the shared HTTP contract](../../../../../policy/tool-contracts.md#curl) and [the gcloud CLI contract](../../gcloud/SKILL.md) before executing requests. Use tool `curl` for HTTP requests, and Use tool `gcloud` solely to obtain short-lived tokens when authenticated without echoing tokens to logs or responses.

## Authentication Order (No Secrets in URLs or Logs)

1. **Google Cloud OAuth Access Token (Preferred when `gcloud` is authenticated)**:
   - First try `gcloud auth print-access-token` with `-H "X-Goog-User-Project: <QUOTA_PROJECT>"`.
   - On `401`/`403`/credential errors, retry once with `gcloud auth application-default print-access-token`.
2. **Header-Based API Key (`DEVELOPERKNOWLEDGE_API_KEY`)**:
   - Pass the key exclusively via `-H "X-Goog-Api-Key: ${DEVELOPERKNOWLEDGE_API_KEY}"`. Never append `?key=` to any URL.
   - If neither `gcloud` credentials nor `DEVELOPERKNOWLEDGE_API_KEY` are available, report the missing credential and direct the user to [Developer Knowledge quickstart](https://developers.google.com/knowledge/quickstart).

## Endpoints

### 1. `:answerQuery` (Conceptual Guides and Overviews)

```bash
curl -fsS --connect-timeout 10 --max-time 30 \
  -X POST "https://developerknowledge.googleapis.com/v1:answerQuery" \
  -H "X-Goog-Api-Key: ${DEVELOPERKNOWLEDGE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"query": "How do I configure public read access prevention on Cloud Storage?"}'
```

On HTTP `429` (`RESOURCE_EXHAUSTED`), switch immediately to `documents:searchDocumentChunks` with 2–5 focused keywords.

### 2. `documents:searchDocumentChunks` (Flags, Permissions, and Syntax)

```bash
curl -fsS -G --connect-timeout 10 --max-time 30 \
  "https://developerknowledge.googleapis.com/v1/documents:searchDocumentChunks" \
  -H "X-Goog-Api-Key: ${DEVELOPERKNOWLEDGE_API_KEY}" \
  --data-urlencode "query=gcloud logging metrics create"
```

Optional query parameters: `filter` (for example `data_source = "docs.cloud.google.com"`) and `pageSize` (default `10`).

### 3. `documents/{URI_WITHOUT_SCHEME}` (Full Document Retrieval)

```bash
curl -fsS --connect-timeout 10 --max-time 30 \
  "https://developerknowledge.googleapis.com/v1/documents/docs.cloud.google.com/run/docs/overview/what-is-cloud-run" \
  -H "X-Goog-Api-Key: ${DEVELOPERKNOWLEDGE_API_KEY}"
```

### 4. `documents:batchGet` (Up to 20 Documents via GET)

Must be `GET` with repeated `--data-urlencode "names=documents/..."` parameters (a `POST` returns HTTP `404`). Pass `view=DOCUMENT_VIEW_BASIC` when only titles/URIs are needed to save context.

```bash
curl -fsS -G --connect-timeout 10 --max-time 30 \
  "https://developerknowledge.googleapis.com/v1/documents:batchGet" \
  -H "X-Goog-Api-Key: ${DEVELOPERKNOWLEDGE_API_KEY}" \
  --data-urlencode "names=documents/docs.cloud.google.com/run/docs/overview/what-is-cloud-run" \
  --data-urlencode "names=documents/docs.cloud.google.com/storage/docs/creating-buckets"
```
