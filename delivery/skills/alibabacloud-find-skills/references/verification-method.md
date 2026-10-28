# Verify discovery results

Use the [request settings](agentexplorer-api.md#request-settings).
Keep transport status, HTTP status, parsed application result, and relevance
separate. Exit zero, a `requestId`, or field names inside an error message do not
prove a successful operation.

If already available, read the shared
[command input and result contract](../../../policy/tool-contracts.md)
before optional JSON filtering. Use tool `jq` with fixed filters and input values
passed through `--arg` or `--argjson`.
Otherwise inspect the parsed JSON using available capabilities; installing a
JSON tool is not a discovery prerequisite.
Do not lose the HTTP producer's failure through a successful parser or pipeline.

## Operation results

Require successful transport, a successful HTTP status, valid JSON, no application
error, and the shape needed by the requested operation.
Malformed or unexpected responses remain unverified; do not coerce them into
empty results.

| Operation | Inspect |
| --- | --- |
| Search or category listing | `data` array of skill objects; nonempty `skillName`, `displayName`, `description`, and category fields used in the result; numeric `totalCount` and `maxResults` when returned |
| Categories | `data` array with category `code` and `name`; inspect `children` as category objects when present |
| Skill details | Nonempty Markdown `content`; inspect its `name` and `description` frontmatter and the actual capability instructions |

For details, require the frontmatter `name` to match the requested skill name.
A different skill's valid Markdown does not satisfy that request.

Search objects may include `categoryCode`, `categoryName`, `subCategoryCode`,
`subCategoryName`, `installCount`, and `likeCount`.
Counts, when supplied, must be nonnegative integers; do not invent missing counts.
An empty `data` array is a valid empty result after the success checks.
Verify relevance to the intent and, for category queries, the selected category.
Content returned by the details endpoint is not proof of the complete installable
package, its references, or its runtime behavior.

## Pagination and completeness

Read only the parsed top-level `nextToken` after a successful category response.
Missing, null, or empty tokens end pagination.
Reject other types rather than converting them to strings.
Pass a nonempty string unchanged using the [category request](agentexplorer-api.md#select-the-operation).
Never fabricate a token or extract one by searching raw response text.
Stop on a repeated token or failed page and report the partial coverage.
Do not claim an exhaustive listing while a page remains unread.

## Failures and completion

For a DNS, connection, TLS, or timeout failure (including curl exit 28), retry the same read-only request
at most once within the active task limits. Report a remaining failure with the
operation and endpoint, without credentials or private query contents.
Do not turn HTTP or JSON errors into automatic retries, weaken TLS checks,
change proxy policy, or switch to Aliyun CLI without the applicable authorization.
A failed request is not evidence of a missing skill.
Weak successful results use the entrypoint's search refinement, not transport retry.

For downloads and installations, apply the separate
[installation readback](installation.md#verify-and-hand-back).
Record discovery, downloaded bytes, installed files, client visibility, and
actual use separately. Static examples and product format checks do not prove
that a model follows the skill or that the live service works.
