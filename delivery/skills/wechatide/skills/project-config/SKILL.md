---
name: project-config
description: >-
  Inspect or edit WeChat Mini Program or Mini Game project.config.json and
  project.private.config.json using the existing field and override rules.
  Does not call DevTools, manage global preferences or edit unrelated projects.
---

# Local project configuration

Read the [handoff contract](../../references/capabilities.md) and the
[field reference](references/fields.md) before editing.
Use this entry directly for configuration requests or receive it from the router.
Skip DevTools readiness, installation diagnostics, CLI help, login and windows.
Do not invoke wechatide for this workflow.

## Resolve the requested change

Recover the confirmed absolute project path, requested fields and values,
authorization, existing facts and blockers.
Resolve missing information from authorized context first.
If the target or intended value is still ambiguous, pause the dependent edit
and ask for that decision.
Do not invent an AppID, environment, source directory or configuration value.

Classify the semantic effect under the applicable project and shared rules.
Local JSON editing does not exempt security, identity, shared artifact or
configuration-semantics changes from the shared operation boundaries; confirm
the intended target and its authorization before such a change.
An existing local preference adjustment that satisfies those rules needs no
separate confirmation.

## Read and edit

Read project.config.json and any project.private.config.json at the confirmed
project root using a standard JSON parser.
Report missing, unreadable or invalid input before overwriting it.
An absent private file is not a malformed file; create it only when the
authorized local preference change needs it.
Do not silently replace missing common configuration or discard invalid bytes.
If a repair or new configuration is requested, resolve its scope and required
values before writing.
If existing evidence shows an unusually large directory that does not resemble
a Mini Program or Mini Game project, confirm the target with the user before
creating configuration there.
Do not recursively scan a large directory just to establish this condition.

Apply the override and target-file rules in the field reference.
Explain an existing private override when it prevents the requested common
value from becoming effective; do not silently modify an extra target.
Merge the authorized fields, preserving unrelated keys, values and files.
Use the host's structured file-editing tool.
Follow applicable project backup rules, including the shared requirement to
back up unversioned personal configuration before replacement when it applies
to the selected file, such as project.private.config.json.
Do not overwrite a file changed by another actor since it was read; re-read
and reconcile the affected fields before proceeding.

Parse the final files again and inspect the complete changed diff.
Confirm the requested fields, their effective values and preservation of
unrelated configuration.
Editing a scripts field does not authorize executing its shell command.
Do not run project hooks, compilation, preview or upload as local validation.

## Return or pause

Return the exact project, inspected/changed files and fields, effective values,
validation performed and remaining blockers.
When called by the router, include the intended nextScene if any.
For an inspection or already-satisfied request, report that no edit occurred.
If a later edit or validation fails, identify any earlier completed writes;
do not describe the whole request as complete.

Configuration changes may require reopening a project or other runtime work.
Report those requirements to the caller without executing them: the router
when it selected this entry, otherwise the user.
Reopening a project window belongs to initializer, recompiling or refreshing the
simulator to compiler, previewing or uploading to previewer, and adding the
configured directory to the DevTools project list to project-manager, each
after the caller's authorization.
Cloud environments, functions, database, storage and message push belong to
cloudbase-operator, and installation diagnosis to installer;
do not substitute legacy entries.
Local JSON validity does not prove runtime effect.
