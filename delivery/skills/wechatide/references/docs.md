# Official WeChat documentation lookup

Consult official WeChat documentation through the unauthenticated Streamable HTTP MCP server `wx-doc-mcp-server` (`https://developers.weixin.qq.com/doc/mcp`). This workflow runs read-only documentation queries only: skip the DevTools CLI readiness check, do not require DevTools login, a CLI access token, or an MCP token, and never invoke `wechatide`.

When a request combines a documentation question with a DevTools execution action, answer the documentation question here and route the execution action to its owning child entry in the [capability index](capabilities.md).

## Availability and configuration boundary

Only invoke these seven read-only MCP tools when `wx-docs` is available in the active session:

- `list_sectors`
- `search_docs`
- `read_doc`
- `list_directory`
- `search_knowledge`
- `get_knowledge`
- `list_knowledge_by_doc`

Do not invoke any unlisted or write interface on the documentation server.

If `wx-docs` tools are absent in the current session, answer any `project.config.json` question covered by the [field reference](../skills/project-config/references/fields.md), then report that the `wx-docs` MCP server is not mounted. Direct the user to merge [wx-docs.mcp.json](../../../capability/wx-docs.mcp.json) into their MCP JSON client configuration (such as `~/.gemini/config/mcp_config.json`) or uncomment the `[mcp_servers.wx-docs]` block in `capability/codex.toml` for Codex. Never write product MCP configuration files yourself and never run `wechatide` CLI calls to substitute for missing documentation.

## Sector routing and search order

Choose the search scope from the user's question:

1. **`project.config.json` fields and write rules**: Read the [field reference](../skills/project-config/references/fields.md) and [project-config](../skills/project-config/SKILL.md) first. Answer covered fields from those files. Only when a field is absent there, read `miniprogram/dev/devtools/projectconfig.md` (or `minigame/dev/devtools/projectconfig.md` for Mini Games) via `read_doc` and label the answer as an official documentation supplement.
2. **DevTools questions** (CLI, HTTP calls, security/service-port settings, Skills setup, download channels, Nightly versus Stable differences, or release changelogs):
   - Prefer `sector: "minigame/dev/devtools"` when `compileType` is `game` or the user specifies a Mini Game; otherwise start with `sector: "miniprogram/dev/devtools"`.
   - High-frequency DevTools paths (replace `miniprogram` with `minigame` only after confirming the path exists on the Mini Game side):
     - CLI: `miniprogram/dev/devtools/cli.md`
     - HTTP calls: `miniprogram/dev/devtools/http.md`
     - Project config: `miniprogram/dev/devtools/projectconfig.md`
     - Settings and service port: `miniprogram/dev/devtools/settings.md`
     - Skills guide: `miniprogram/dev/devtools/Skills.md`
     - Downloads (Stable / Nightly): `miniprogram/dev/devtools/download.md`
     - Stable changelog: `miniprogram/dev/devtools/log.md`
   - If the chosen DevTools sector returns no usable result, search the other DevTools sector once before broadening.
3. **Full-site official WeChat documentation** (Mini Program and Mini Game frameworks, components, `wx.*` APIs, CloudBase, WeChat Pay, Channels/Store, Official Accounts, Open Platform, or other official sectors):
   - Call `list_sectors` when the exact `sector` path is unknown, then pass matching `sectors[].path` values to `search_docs` (use `limit` around `8` to `20`, or omit `sector` when a cross-sector keyword query is warranted).
   - Call `read_doc` on the top matching `path`. When `chunk.hasMore` is `true`, read targeted sections using `chunk.nextOffset` instead of dumping entire changelogs or multi-part guides.
   - Use `search_knowledge`, `get_knowledge`, and `list_knowledge_by_doc` (with the online URL or site path from `read_doc`) when the main guide omits FAQ answers.

Cite only exact online URLs returned by `read_doc` (`metadata`) or `list_knowledge_by_doc`. Do not invent unverified URLs, flags, menu paths, or error codes.

## Precedence when sources disagree

1. **Project configuration semantics**: The [field reference](../skills/project-config/references/fields.md) and [project-config](../skills/project-config/SKILL.md) govern every field and `common` vs. `private` rule they document. Use online `projectconfig.md` only for unlisted fields, marked as documentation supplements.
2. **`wechatide` CLI tools, flags, and authentication**: [SKILL.md](../SKILL.md), [capabilities.md](capabilities.md), [cli.md](cli.md), the owning child entries, and `OPERATION -h` govern execution. If online documentation (including the public Skills page) names older tool names or layouts, follow this package and note that the web documentation lags bundled skill `0.3.17`.
3. **IDE menus, release-line differences, frameworks, and platform APIs**: Follow the verified official documentation read in the current turn.
