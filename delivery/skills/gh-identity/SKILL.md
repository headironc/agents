---
name: gh-identity
description: >-
  Select or recover headironc for a named GitHub workflow. Use for identity readiness or expired credentials; not PR mutations.
---

# GitHub identity readiness

Before the first GitHub command, load the available `gh` skill by its installed name. Read its invocation contract before using CLI or API operations. The repository binding is [gh](../gh/SKILL.md). Use tool `gh` only within that contract.

Use this support skill only after the caller has resolved its target host and authorized identity operation under gh's workflow contract. It selects or recovers the human identity, then proves it before the caller's GitHub mutation. Recovery requires the Human's own browser or device interaction; this skill never supplies, stores or displays a token.

Read [authentication readiness](references/auth-readiness.md) for that profile.

This skill does not select a repository, grant permissions, inspect a pull request, or make a pull-request, release, or Git mutation.
