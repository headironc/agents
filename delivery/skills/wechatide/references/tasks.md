# Pending DevTools tasks

A result with status `pending` and a `taskId` waits for interaction inside
DevTools, such as scanning a QR code or authorizing a client. It is neither
success nor failure. Tell the user what to complete in DevTools; the
interaction does not happen in chat.

## Active polling

Only login tasks and client authorization tasks block later operations,
including authorization started automatically after a connection failure.
After telling the user, start polling without waiting for a chat reply.
Read the [call executor](../scripts/call.sh). Use tool `wechatide-call` for
`polling_task_result --task-id TASK` with the original task ID.

Query every 10 seconds, at most 10 times per round, and stop at the first
status other than `pending`:

- `success`: confirm the intended state, such as a status check after login,
  before continuing dependent work.
- `failed`, `cancelled` or `expired`: report it and stop dependent work.
- Still `pending` after 10 queries: report that the interaction is incomplete,
  keep the task, and start another round only when the user continues.
- A failed query or unknown status: report that the original outcome is unknown.

## Other pending tasks

Do not poll other pending tasks. Tell the user which confirmation remains in
DevTools and keep the task context.

## Task context

Keep `taskId`, the operation, a non-secret parameter summary, the last status
and the query count. Never include a token.
Pass this record in a handoff; it does not reset a polling round.

## Repeating an operation

Before repeating an operation that has a retained task, query its original task:

| Original status | Handling |
| --- | --- |
| `pending` | Do not repeat; continue active polling for login or authorization, otherwise report that confirmation remains |
| `success` | Do not repeat; use the original result |
| `failed` | Start again only under that operation's own authorization and inputs |
| `cancelled`, `expired` | Start again only on the user's explicit request |
| Unknown | Do not repeat an operation with effects; report the unknown state |
