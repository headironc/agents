---
name: wechatide
description: >-
  Route WeChat Mini Program and Mini Game work on macOS to delivered skills for project configuration, DevTools initialization, compilation, simulator toolbar controls, debugging, previews and trial uploads, project lists and snippets, page automation, cloud development, official documentation lookup, and installation diagnosis. Excludes ordinary source edits and non-WeChat tasks.
metadata:
  version: "0.3.18"
---

# WeChat project routing

This skill is delivered on macOS to Codex, DeepSeek Harness, and Antigravity App and CLI, and skipped off macOS.

Read the [capability and handoff contract](references/capabilities.md) before selecting an entrypoint or accepting its result. Resolve references from this skill's physical directory.

Choose the current primary goal from the request and retained task context, then load its entry from the capability index. Each entry owns its business procedure.

Route official WeChat documentation questions to [official documentation](references/docs.md) without running DevTools readiness checks or invoking `wechatide`. These questions cover DevTools CLI and HTTP interfaces, settings, Nightly versus Stable differences, skills setup, frameworks, components, `wx.*` APIs, CloudBase, Mini Games, and unlisted `project.config.json` fields after checking `project-config`. When a request combines a documentation question with a DevTools action, answer the documentation question through `references/docs.md` and route the action to its owning child entry.

Check availability before any readiness, login, CLI help or tool invocation. Only operations listed for a delivered entry are callable, through the [CLI contract](references/cli.md). For an unavailable goal, report the missing capability and preserve the task. Do not fall back to an installed legacy child, invent an operation, or execute the unavailable workflow in this router. Continue independent work already authorized by the user.

Use the handoff contract to pass the task and verify the returned evidence against the original request. A child invocation or valid JSON alone does not establish task completion. Continue only remaining authorized work supported by delivered capabilities.

Ordinary source edits and general desktop tasks do not establish permission to download an external skill from `skillhub.cn`. External map skills are outside this delivery; opening, compiling, or previewing a page that includes a map still uses `compiler` or `previewer`.
