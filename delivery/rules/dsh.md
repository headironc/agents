# DeepSeek Harness behavior

- Follow the native instruction discovery order: `${DSH_HOME:-$HOME/.dsh}/AGENTS.md`, then `${DSH_AGENTS_HOME:-$HOME/.agents}/AGENTS.md`, followed by applicable project instructions. The client also loads workspace `AGENTS.md` and `CLAUDE.md`; account for the actual input material before invocation.
- Use only tools and permission or approval modes supported by the running Harness. Apply the [invocation contract](../policy/deepseek-harness.md) to execution, completion evidence, and recovery; a zero exit code alone does not establish completed work.
- Keep model and provider selection within effective Human authorization and the actual route's capabilities. The shared rules do not grant Codex Desktop tools or Codex-specific model defaults to this client.
