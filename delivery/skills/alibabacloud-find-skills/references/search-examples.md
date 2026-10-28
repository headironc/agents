# Search examples

These examples illustrate the [entrypoint](../SKILL.md); they are not catalog
results or authority to install or use a selected skill.
Construct requests through the [HTTP reference](agentexplorer-api.md) and apply
the [result checks](verification-method.md).

## Single capability

For "find skills for ECS connectivity and performance diagnosis", search
`ECS instance diagnosis connectivity CPU disk` with semantic mode.
Inspect detail content if descriptions leave coverage uncertain.
For "把本地文件同步到 OSS", first use an available matching skill.
Only an explicit discovery request or a confirmed missing capability enters
discovery; then `把本地文件同步到 OSS` is a useful intent phrase.

## Category listing

For "list all database skills and identify RDS daily-operation candidates",
resolve the database category, list without keyword or semantic mode, and follow
returned tokens. Summarize likely matches within the enumerated results.
If a page fails, report partial coverage and do not install anything.
Use semantic search inside that category for a best-match request rather than
an exhaustive listing.

Illustrative domain hints from the retained reference:

| Domain | Category hint | Refinement |
| --- | --- | --- |
| ECS and servers | `computing` | instance, diagnosis, patch |
| RDS, PolarDB, Tair | `database` | SQL, backup, performance |
| OSS, files, logs | `storage` | sync, upload, index |
| Data projects | `analyticscomputing` | DataWorks, Flink, Hologres |
| AI and knowledge bases | `aiml` | Bailian, RAG, retrieval |
| Security | `security` | KMS, WAF, vulnerability |
| Network diagnosis | `netcdn` | reachability, NIS |
| Deployment and operations | `migrationom` | OOS, Terraform, import |

Resolve actual categories when using these hints; the table is not an exhaustive
or current catalog and does not prove child-code support.

## Compound discovery with support needs

For an explicit Alibaba Cloud skill search to generate structured output from
documents, consult internal standards, and handle requested runtime blockers,
keep three intent units:

| Requirement | Capability-oriented phrase |
| --- | --- |
| Generate output from documents | document parsing structured content generation |
| Consult internal standards | knowledge base retrieval document Q&A citation |
| Handle runtime blockers | runtime dependency environment troubleshooting |

Search each uncovered unit. Replace private policy titles with capability terms.
If weak results only match surface wording, refine the phrase before declaring
the unit uncovered. Keep complementary selections and explain their roles.
A runtime-support candidate is a discovery result, not permission to install a
dependency or alter the environment.

## Result handoff

Return the exact skill names and sources, coverage for each intent unit,
description-only versus content-inspected evidence, gaps, and any partial pages.
Deduplicate an installation plan only when installation is requested and apply
[its separate boundary](installation.md). Do not label a discovery list as a
global installation plan.
