# Skill sources

This register covers the repository-maintained skills selected by [the product manifest](../config/personal-skills.txt) and the [reference sources](#code-quality-maintenance) maintained for `delivery/policy/rust.md`. Third-party upstream skills previously repackaged here (`gh`, `alibabacloud-find-skills`, `alibabacloud-sms-send-short-message`, `google-cloud`, `wechatide`, `modern-web-guidance`, `web-quality-audit`, `property-based-testing`, and `rust-risk-review`) are no longer vendored in this repository; install optional third-party skills on demand as recorded in [README](../README.md#可选第三方技能与官方-mcp). Historical records for retired skills remain in [the preserved source register at 6abebff](https://github.com/headironcc/agents/blob/6abebff9ea9bcbb4d5044e137fcc8fa3456ae48f/docs/skill-sources.md) and Git history; their presence there does not establish current delivery or installation.

Historical links under `headironcc/agents` name the planned private archive destination. This content export does not establish completion of that migration, and access requires permission. These records preserve provenance; current capabilities, operation contracts, and retained licenses are available in this content source without private-history access. Old runs and reviews do not establish the configuration or acceptance of a new repository instance.

## Code-quality maintenance

[Scheduled updates](tooling.md#官方内容自动更新) cover two policy reference consumers: Rust API Guidelines and Microsoft Rust Guidelines, both bound to `delivery/policy/rust.md`. The [maintenance architecture](tooling.md#上游内容维护架构) owns acquisition, assessment, publication, and installation.

| Source                                                  | Disposition                   | Reason, scope and owner                                                                                                                                  |
| ------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Rust API Guidelines](#rust-api-guidelines)             | Maintained selected reference | Four chapters inform the existing Rust policy; public-library advice retains its adoption boundary.                                                      |
| [Microsoft Rust Guidelines](#microsoft-rust-guidelines) | Maintained selected reference | Six chapters add unsafe/FFI, additive features, and measured performance to the same policy. Keep full MIT license and both Rust assessments consistent. |

### Rust guideline disposition

The [Rust policy](../delivery/policy/rust.md) remains authoritative within each project's explicit adoption scope. Its [lint fragment](../delivery/capability/rust-lints.toml) covers only the rules it actually checks.

Rust API Guidelines and Microsoft Rust Guidelines share reference acquisition and assessment machinery while retaining separate source locks and update PRs. Both bind the same policy, so a policy edit requires reassessing both mappings.

## Rust API Guidelines

The existing [Rust policy](../delivery/policy/rust.md) consumes four reference chapters: naming, type safety, flexibility, and interoperability. The [source lock](../config/rust-api-guidelines-source.json) binds repository `rust-lang/api-guidelines` (ID `81125442`), branch `master`, an immutable commit, six exact file/blob identities, and the assessment against the policy's SHA-256. The source module owns the mapping from chapters to local policy sections.

Original chapter bytes and both license alternatives are retained under `config/upstream/rust-api-guidelines/`. The `.txt` suffix identifies maintenance originals rather than local guidance; filenames change, bytes do not. These references and licenses are not product installation members. They provide a review baseline, not a standalone skill or a complete offline copy of the Rust documentation. The linked official sites and immutable upstream commit remain the reading sources for external references.

The initial assessment preserves existing local choices rather than importing every public-library recommendation. Each selected input has a disposition and reason in the source lock. Initial provenance is the real upstream commit `f90deb77959af37e0bc72604fb8a5efe9b97dd20`; later adopted versions are owned by the lock and the policy's pinned reference. Preparation compares the selected bytes and rejects repository drift, non-forward history, incomplete trees, symlinks, missing licenses, and blob mismatches. Unrelated commits produce no PR.

The updater preserves the previous assessment and proposes a draft PR for relevant changes. The current-source regression blocks delivery until assessment revision, exact policy digest, policy reference, and complete dispositions agree. This structural check cannot judge the reasoning itself; normal independent review remains required. Follow the [assessment procedure](tooling.md#rust-api-guidelines-评估), then use the existing three-product policy installation and recovery flow.

## Microsoft Rust Guidelines

The [source lock](../config/microsoft-rust-source.json) binds `microsoft/rust-guidelines` (repository ID `1020012680`), `main`, and seven original files at an immutable commit. The initial assessed revision is `9585e288d21d2da994a0550c926a09b62d79f8bd`. Original bytes, including the full MIT license, are retained under `config/upstream/microsoft-rust-guidelines/`; they are maintenance data excluded from product installation.

The selected consumer is the existing [Rust policy](../delivery/policy/rust.md). M-UNSAFE and M-UNSOUND inform safety arguments and safe API invariants; M-FFI-TRANSLATES informs foreign-boundary ownership; M-FEATURES-ADDITIVE informs public-library feature composition; M-HOTPATH and M-YIELD-POINTS inform measurement and executor fairness. The source lock records each decision. The local policy avoids blanket crate splits, unsupported Miri claims, mandatory benchmark dependencies, universal scheduling intervals, and the assumption that every await yields. No upstream agent instructions, scripts, or complete handbook are installed.

The [reference verifier](../scripts/reference-source.ts) and [reference updater](../scripts/upstream-reference.ts) also serve Rust API Guidelines. Trusted source modules bind each repository, branch, selected paths, and mapped policy sections; downloaded plans cannot select a different contract. Relevant changes create a draft PR while preserving the old assessment. The current-source regression rejects an unassessed revision, changed local policy, missing section, changed license, or altered original. Follow the [Rust assessment procedure](tooling.md#rust-api-guidelines-评估) for both sources, then use the existing three-product policy installation and recovery flow. Static regressions and product installation do not prove a Rust program safe; actual review exercises report their own scope.

## project-guide

This shared skill is maintained locally from authorized repository-orientation and validation work. Its four capabilities are project and version identification, authority discovery, check selection and execution, and evidence reporting. The [entrypoint](../delivery/skills/project-guide/SKILL.md) owns the reusable guidance; target projects retain their paths, business rules, commands, and acceptance criteria. No upstream skill or executable was copied.

The design was checked against two local target repositories with distinct layouts before the skill was written. The first repository was inspected at `origin/dev` revision `909f19a05448379093693f03b3974c0cae4fda30`, distinct from its older working tree; its instructions route to engineering verification guidance and native change classification. The second repository was inspected in a working tree based on `779b3161c712e2858c99ca4aebf92e181751cc1e`, including modified navigation and untracked solver documents; it uses root navigation, an explicit business-document precedence order, and direct script/CI entrypoints. This comparison establishes support for different repository layouts rather than domain independence.

In the second repository's trial, `bash scripts/format.sh check` exited 1 because locked formatting dependencies were absent. The trial installed nothing and changed no inspected source files. The solver acceptance cases remained proposed work, not executed tests. This trial supports the design's discovery and prerequisite boundaries; it does not prove that the completed skill selects or executes checks correctly in every client. The [static scenarios](../tests/scenarios/rules.md#project-guide-项目导航与验证) describe the remaining behavioral expectations. Format validators and the no-model loader provide separate structural evidence.

An authorized live Codex session on 2026-10-22 exercised the completed skill against the second target repository and agents. Session `01a1612f-092a-7031-95fa-f211927dbd76` was created without inherited author conversation or supplied author conclusions. Its recorded turn contexts identify `gpt-6.1-sol` with `high` effort. Actual tool calls confirmed the target repository's working revision, dirty inputs, document precedence, and native script/CI entrypoints. Its format check exited 1 on missing dependencies; its documentation lint exited 127 on a missing executable. The latter was launched despite an observed Bun version mismatch, so the initial run did not satisfy the runtime boundary. The agents documentation check separately completed with exit 0 and four passing checks; it did not establish acceptance for the external target repository.

The skill now requires a compatible existing runtime or a blocked result before launching a dependent check. A focused continuation in the same test session read the repaired skill with SHA-256 `4a70e39f564f43176ee77505ac77ceb498e4cd3d5ec0d75dd0a312cb09c38e20`. It performed environment preflight, observed Bun 1.4.2 against the target repository's required 1.3.14 and absent local check dependencies, and left both target repository documentation checks unexecuted with explicit prerequisite failures. Tool-call readback confirmed that behavior. This repair retest retained the test session's earlier context; it was not a new independent review. No personal installation, business-file edit, or commit was part of those behavior runs. These runs cover the observed navigation, execution, and prerequisite cases only; they do not establish all static scenarios, passing checks in the external repository, or behavior in other client runtimes.

## sketch-native

[sketch-native](../delivery/skills/sketch-native/SKILL.md) is a shared repository-maintained skill for macOS native `.sketch` (`Sketch 2026.4+`) design work through Sketch's built-in MCP server and bundled `sketchtool` CLI. Rather than copying Sketch API manuals or maintaining custom offline ZIP/JSON archive mutators and CoreText measurement scripts, the skill directs agents to verify required Libraries, load Sketch's application-bundled `MCPGuides` (`mcp`, `use`, `layout`, `organization`, `styling`, `symbols`, `assets`, `prototyping`, and `troubleshooting`) via `get_guide`, discover reusable library assets (`get_libraries`, `get_design_assets`, `get_symbol_overrides`), compose screens with `Group.Frame`, `Group.Section`, `Group.VariantSet`, and `StackLayout`, bind `Swatch` Color Variables and Shared Styles, enforce Workspace comment authorization boundaries (`list_comments`, `list_notifications`, `save_comment`, `delete_comment`), verify `sketchtool` commands (`metadata`, `duplicates`, `export frames`), and check appearance changes through `get_screenshot`.

## Retired designs

The seven rebuild documents are preserved in the [fixed Git tree at 621ea5e](https://github.com/headironcc/agents/tree/621ea5e6e58c6b2f89bd66319c357e7785ee06a1/docs/rebuild). They record design history, not current delivery or authorization. The [frozen R2 mapping](https://github.com/headironcc/agents/blob/77320a3b396748a98b497dff19185794c8f31bc5/docs/rebuild/r2-rule-coverage.md) retains its original positions, source identities, and review scope. The [original R2 design](https://github.com/headironcc/agents/blob/77320a3b396748a98b497dff19185794c8f31bc5/docs/rebuild/r2-rules.md) remains historical too.

Current delivery and installation contracts live in the [usage guide](usage.md). Validation and registration belong to the [tooling guide](tooling.md). The product manifest and skill entrypoints own current capability selection and operation boundaries. Existing handoffs, reviews, recovery records, and deployment snapshots remain under the [external record root](../README.md#执行记录).

The former R7 network proposal remains unimplemented. Its proxy, watcher, host-tool, and cache-cleanup designs in the fixed tree do not authorize device access, service changes, or deletion. Resume that work only against confirmed requirements and current evidence; network tools do not belong to the personal skill installation set. Retiring the document does not deliver those tools or discard the recorded proposal.

## Retired review system

The repository no longer ships its former review scheduler, material preparation, model containers, candidate test executor, or finding publisher. PR review is supplied externally. Current CI retains ordinary check reports and does not implement the former review protocol.

The [source tree at b74a877](https://github.com/headironcc/agents/tree/b74a877b2b0df703ecdd911da2b189eb1d88452d/scripts/review), [technical contract and acceptance index](https://github.com/headironcc/agents/blob/b74a877b2b0df703ecdd911da2b189eb1d88452d/docs/tooling.md#ci-与审查边界), and [original scenarios](https://github.com/headironcc/agents/blob/b74a877b2b0df703ecdd911da2b189eb1d88452d/tests/scenarios/rules.md) preserve implementation details, historical results, and their limitations. Existing external recovery and execution records remain intact. These historical sources do not establish current review coverage or authorize restoring the system.

## Retired workflows

[PR #110](https://github.com/headironcc/agents/pull/110) retired the generic workflow layer. Retired skills are absent from the product manifest; their former delivery checks and consumer inventories are not current requirements. Git history preserves retired skills and this register's earlier revisions.

| Retired skill        | Reason and retained responsibility                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| document-maintenance | Ordinary writing needs conventions, not a workflow entry; source, consolidation, and historical-scope rules live in [writing conventions](../delivery/policy/writing.md).      |
| architecture-review  | Generic development no longer mandates a separate architecture workflow; explicit review uses the selected tool and applicable project requirements.                           |
| change-review        | Ordinary reversible changes no longer require a separate local reviewer by default; concrete review and publication boundaries remain in [Codex rules](../delivery/AGENTS.md). |
| audit                | A requested audit is a scoped task; evidence and findings need no additional generic entrypoint.                                                                               |
| rename-sweep         | Reference checks belong to the authorized rename or removal, with the relevant tool contract and project validation.                                                           |
| test-first           | Testing and participant assignments follow the actual project and Human request, without a universal handoff template.                                                         |
| iteration-guide      | Planning and continuation follow the current task, without an extra readiness workflow or role state machine.                                                                  |

Concrete PR review triggers, authorization boundaries, and post-merge cleanup rules live in [review rules](../delivery/policy/review.md) and [execution rules](../delivery/policy/execution.md). Fixed executors are unchanged. Installed copies are separate from repository source and require their own authorized replacement.
