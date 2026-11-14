---
name: wechatide
description: >-
  Route WeChat Mini Program and Mini Game work on macOS to delivered skills for project configuration, DevTools initialization, compilation, debugging, previews and trial uploads, project lists and snippets, page automation, cloud development, and installation diagnosis. Excludes ordinary source edits and non-WeChat tasks.
metadata:
  version: "0.3.15"
---

# WeChat project routing

Read the [capability and handoff contract](references/capabilities.md) before selecting an entrypoint or accepting its result. Resolve references from this skill's physical directory.

Choose the current primary goal from the request and retained task context, then load its entry from the capability index. Each entry owns its business procedure.

Check availability before any readiness, login, CLI help or tool invocation. Only operations listed for a delivered entry are callable, through the [CLI contract](references/cli.md). For an unavailable goal, report the missing capability and preserve the task. Do not fall back to an installed legacy child, invent an operation, or execute the unavailable workflow in this router. Continue independent work already authorized by the user.

Use the handoff contract to pass the task and verify the returned evidence against the original request. A child invocation or valid JSON alone does not establish task completion. Continue only remaining authorized work supported by delivered capabilities.

Ordinary source edits, map API questions and general desktop tasks do not require this router or establish permission to download another skill.
