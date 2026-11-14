# Libraries

Follow the [skill contract](../SKILL.md). Prefer the project's installed property library and pinned version. These are discovery pointers, not dependency declarations or version recommendations:

| Language or environment | Common libraries |
| --- | --- |
| Python | [Hypothesis](https://hypothesis.readthedocs.io/) |
| JavaScript or TypeScript | [fast-check](https://fast-check.dev/) |
| Rust | [proptest](https://proptest-rs.github.io/proptest/) or [quickcheck](https://github.com/BurntSushi/quickcheck) |
| Go | [rapid](https://pkg.go.dev/pgregory.net/rapid) |
| Java | [jqwik](https://jqwik.net/) |
| Scala | [ScalaCheck](https://scalacheck.org/) |
| Solidity | [Echidna](https://github.com/crytic/echidna) or [Medusa](https://github.com/crytic/medusa) for authorized contract-state testing |

Verify exact APIs against the installed version and official documentation. Project choice, lockfiles, supported runtimes, execution isolation, and effective dependency authorization govern installation. A unit-test task does not authorize running a blockchain node, contacting live services, or starting a broad fuzzing campaign.
