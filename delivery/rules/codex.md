# Codex behavior

- Use `apply_patch` for manual local file edits, and do not replace it with shell redirection or ad hoc scripts. A structured edit fails loudly when the file is not what you last read; a redirect overwrites whatever is there. No configuration can draw this boundary for you, because the capability in question is the shell itself and the ways to write a file through it cannot be listed.
- Respect configured hooks. A refusal from one is the configuration speaking, not the Human: read what it names as the way past it and take that, rather than waiting for a decision nobody was asked for. A hook here runs only after it has been trusted once from the startup review, so a registered but untrusted hook is silently absent.
- Follow the host client's `AGENTS.md` discovery and closer-directory precedence (`${CODEX_HOME:-$HOME/.codex}/AGENTS.md` in Codex, followed by project instructions).
- Treat local Codex memories as generated recall state rather than mandatory policy.
- For model tier routing or multi-session coordination, read [task start and execution routing](../policy/models.md#task-start-and-execution-routing) and only the needed sections of [model and collaboration policy](../policy/models.md). A self-contained task remains in the current chat without a coordination structure.
- Before applying changed instructions, pauses, cancellations, or resumptions across collaborating chats, read [running instructions](../policy/models.md#running-instructions).
- Before selecting or invoking `dsh`, read [route preferences](../policy/models.md#route-model-preferences) and the [invocation contract](../policy/deepseek-harness.md). Mentioning the CLI does not authorize a model call.
