# Native CI acceptance

The negative candidate [H1](https://github.com/headironc/agents/commit/cc36f49344e5e931ad3c06a2028cfc1272f683c8) added `Native CI acceptance: intentional Linux failure` in `tests/validation/check.test.ts`. The [negative run](https://github.com/headironc/agents/actions/runs/40699802716) recorded the expected Linux failure (42/43 checks passing) while macOS completed 43/43. Required checks blocked the ready PR.

Recovery candidate [H2](https://github.com/headironc/agents/commit/c472045566d361f72150c608bd36e1cac4274faa) removed that test. The [recovery run](https://github.com/headironc/agents/actions/runs/40703145714) completed 43/43 on both platforms. This note intentionally retains the PR's remaining diff; do not reintroduce the failing test.

Never merge this PR. Before closing, record each phase's exact candidate and target baseline, complete Linux and macOS results, actual required-check states, and the current candidate's independent code and security review route, results and disposition of every finding. Close only after that acceptance is complete.
