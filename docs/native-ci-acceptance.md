# Native CI acceptance

This temporary PR tests native CI only. It intentionally adds a Linux failure to an existing repository regression. The Linux check must fail while the macOS check continues through the complete gate, exercising independent matrix results and required checks.

Do not merge this PR. After recording the failure, remove only the intentional test and verify the recovered candidate. Keep this note so the PR retains a diff, then close the PR after acceptance.
