---
name: wechatide
description: >-
  Route WeChat Mini Program and Mini Game work on macOS to delivered skills for project configuration, DevTools initialization, compilation, debugging, previews and trial uploads, project lists and snippets, page automation, cloud development, and installation diagnosis. Excludes ordinary source edits and non-WeChat tasks.
metadata:
  version: "0.3.11"
---

# WeChat project routing

Read the [capability and handoff contract](references/capabilities.md) before selecting an entrypoint or accepting its result. Resolve references from this skill's physical directory.

Choose the current primary goal from the request and retained task context. Load the entrypoint for that goal:

- [project-config](skills/project-config/SKILL.md): local project configuration.
- [initializer](skills/initializer/SKILL.md): DevTools status, login, project windows, AppIDs, runtime context or quitting DevTools.
- [compiler](skills/compiler/SKILL.md): opening a page, refreshing the simulator, building npm or inspecting one WXML or WXSS compilation summary.
- [debugger](skills/debugger/SKILL.md): console and network evidence, screenshots, wx API diagnostics or clearing local debug caches.
- [previewer](skills/previewer/SKILL.md): phone previews, preview QR codes or explicitly requested trial-version uploads.
- [project-manager](skills/project-manager/SKILL.md): the DevTools project list, adding or removing list entries, or sharing and importing code snippets.
- [automator](skills/automator/SKILL.md): page or Mini Game canvas actions, page data, runtime evaluation, test-account tickets or automator scripts.
- [cloudbase-operator](skills/cloudbase-operator/SKILL.md): cloud environments, functions, database, storage or message-push configuration.
- [installer](skills/installer/SKILL.md): diagnosis after `cli-unavailable` or `cli-unbound`, or when the user asks whether DevTools is installed; it does not download, install or repair PATH.

Each entry owns its business procedure; do not reproduce it here.

Check availability before any readiness, login, CLI help or tool invocation. Only operations listed for a delivered entry are callable, through the [CLI contract](references/cli.md). For an unavailable goal, report the missing capability and preserve the task. Do not fall back to an installed legacy child, invent an operation, or execute the unavailable workflow in this router. Continue independent work already authorized by the user.

Pass the confirmed target, requested changes, applicable authorization and existing facts to the child using the handoff contract. On return, verify the target, changed files and fields, validation and remaining blockers against the original request. Keep partial work and unknown results explicit. A child invocation or valid JSON alone does not establish task completion. Continue only remaining authorized work supported by delivered capabilities.

Ordinary source edits, map API questions and general desktop tasks do not require this router or establish permission to download another skill.
