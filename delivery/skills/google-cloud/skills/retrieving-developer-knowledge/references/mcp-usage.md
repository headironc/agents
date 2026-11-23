# Developer Knowledge MCP Usage

Connects to the managed read-only Streamable HTTP endpoint `https://developerknowledge.googleapis.com/mcp`. Never write client MCP configurations directly; merge [google-developer-knowledge.mcp.json](../../../../../capability/google-developer-knowledge.mcp.json) (Antigravity) or uncomment `[mcp_servers.developer-knowledge]` in `capability/codex.toml` (Codex via `DEVELOPERKNOWLEDGE_API_KEY`).

## Available Read-Only Tools

1. **`search_documents`**:
   - Accepts 2–5 focused query keywords (for example `cloud run filestore nfs mount gcloud`).
   - Returns matching documentation chunks with `content` and `parent` URI fields.
2. **`answer_query`**:
   - Accepts a natural-language question for conceptual guides, architecture comparisons, or multi-step workflows, returning synthesized guidance with source citations.
   - Has stricter quota; on HTTP `429` (`RESOURCE_EXHAUSTED`), fall back immediately to `search_documents`.
3. **`get_documents`**:
   - Fetches full Markdown documentation pages by resource name.
   - Pass `names: ["documents/{uri_without_scheme}"]` (for example `["documents/docs.cloud.google.com/run/docs/overview/what-is-cloud-run"]`).
