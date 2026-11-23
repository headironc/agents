---
name: retrieving-developer-knowledge
description: >-
  Search, retrieve, and synthesize official Google developer documentation across
  Google Cloud, Gemini/AI, Android, Chrome, Web, Flutter, Go, and Firebase via
  the Developer Knowledge MCP server or Developer Knowledge REST API fallback.
  Skip for local filesystem lookups or non-Google documentation.
license: Apache-2.0
---

# Google Developer Knowledge

Adapted from Google's `retrieving-developer-knowledge` skill. Telemetry attribution headers are omitted by default unless the user explicitly asks to include them.

## Transport Selection and Configuration Boundary

1. **Developer Knowledge MCP (Preferred)**: When `search_documents`, `get_documents`, or `answer_query` are mounted in the active session, query them directly. See [MCP Usage](references/mcp-usage.md).
   - If MCP tools are absent and the user wants to enable the server, never edit client config files yourself; direct them to merge [google-developer-knowledge.mcp.json](../../../../capability/google-developer-knowledge.mcp.json) (Antigravity `google_credentials`) or uncomment `[mcp_servers.developer-knowledge]` in `capability/codex.toml` (`env_http_headers` reading `DEVELOPERKNOWLEDGE_API_KEY`).
2. **REST API Fallback (`https://developerknowledge.googleapis.com/v1`)**: When MCP tools are absent or fail handshake, query the REST API directly. Read [the shared HTTP contract](../../../../policy/tool-contracts.md#curl) and [the gcloud CLI contract](../gcloud/SKILL.md) before issuing authenticated fallback requests. Use tool `curl` for HTTP queries, and Use tool `gcloud` only for printing short-lived access tokens as detailed in [REST API Fallback](references/api-fallback.md).
   - **Never** pass API keys via `?key=` URL query strings (which leak credentials into shell history, proxy logs, or diagnostics). Always use the `X-Goog-Api-Key` HTTP header or OAuth Bearer token header, and never print token values to output.

## Failure Handling and Grounding Rules

- **Verify Actual Payload**: An empty result, HTTP `401`/`403`, `PERMISSION_DENIED`, or `UNAUTHENTICATED` is a failed lookup even if `curl` exited zero.
- **HTTP 429 (`RESOURCE_EXHAUSTED`) Fallback**: `answer_query` / `:answerQuery` has stricter generative QA quota. On `429`, immediately fall back to `search_documents` (MCP) or `documents:searchDocumentChunks` (REST) using 2–5 focused keywords rather than answering from memory.
- **Total Lookup Failure**: If both MCP and REST transports fail or no credential (`gcloud` token or `DEVELOPERKNOWLEDGE_API_KEY`) is configured, state plainly in the reply what failed or what credential is missing, and never fabricate official documentation citations or CLI flags.
- **Supported Corpus**: See [Supported Domains](references/supported-domains.md).

## References

- [MCP Usage](references/mcp-usage.md): `answer_query`, `search_documents`, and `get_documents` parameters.
- [REST API Fallback](references/api-fallback.md): Header-based authentication, endpoints, and rate-limit recovery.
- [Supported Domains](references/supported-domains.md): Official domains indexed by Developer Knowledge.
