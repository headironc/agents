---
name: web-quality-audit
description: Audit a web page or user flow for accessibility, measured performance, rendered semantics, and applicable SEO or browser best practices. Use for a requested page-quality assessment or verification after a web fix. Excludes ordinary implementation, server-only review, security certification, and native or mini-program runtime automation.
license: MIT
metadata:
  maintenance: local-adaptation
  upstream-repository: https://github.com/addyosmani/web-quality-skills
  upstream-path: skills/web-quality-audit
---

# Web quality audit

Adapted from Addy Osmani's [audit and measurement workflows](https://github.com/addyosmani/web-quality-skills/tree/afa8da942115f2961fdbfa80807ea0b232ff6c00). Retain the [MIT license](LICENSE.txt). This is an unofficial community resource, not a Google product or endorsement. Local changes scope the audit, preserve operation authority, distinguish evidence types and replace mandatory sibling tooling with available capabilities.

Bind the target URL or source, important state and user journey, public or authenticated audience, supported browsers and requested dimensions. A read-only audit reports findings without modifying source or configuration. Do not expand a focused interaction check into a compulsory site-wide audit.

- For a runnable page or performance claim, read [measurement](references/measurement.md). Use actual available browser capabilities and collect a minimal baseline before broad source inspection.
- For accessibility, semantics, SEO or browser practices, read [checks](references/checks.md). Consult relevant installed `modern-web-guidance` under its own contract for implementation details and browser support.
- When no browser or required measurement tool is available, continue the useful static review and identify the specific evidence gap. Do not invent a trace, Lighthouse score, accessibility-tree inspection or keyboard test.

Trace an observed problem to the responsible source when available. Separate measured failures, browser observations, source hypotheses and unavailable evidence. Prioritize concrete user impact and confidence under the host's review contract, rather than category scores or a fixed severity table. Ask for missing authority only where a proposed operation exceeds the task, such as submitting a private URL to an external audit service or installing tools.

After an authorized fix, repeat the affected flow under comparable conditions. Report the exact scope, observations and remaining limits; no aggregate score proves accessibility, security, search ranking or complete quality. New features such as WebMCP or llms.txt are not prerequisites for passing an audit.

Remove temporary reports, browser tabs, test sessions and fixtures after their consumers finish. The creating host owns deletion of an ended test session; the running session reports its known identity or location and remaining host cleanup instead of deleting itself. Preserve the current installation and needed recovery materials.
