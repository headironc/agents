---
name: alibabacloud-sms-send-short-message
description: >-
  Send or query SMS through Alibaba Cloud Short Message Service, including
  signature and template status, delivery records, and sending statistics.
  Use for requested Alibaba Cloud SMS operations, not generic notifications
  or application code that merely integrates an SMS provider.
license: Apache-2.0
metadata:
  compatibility: aliyun-cli >= 3.3.3; existing dysmsapi plugin; jq for the helper.
  maintenance: local
  upstream-repository: https://github.com/aliyun/alibabacloud-aiops-skills
  upstream-revision: e66d133113a408268edbaa9139d55f15b37ef9a4
  upstream-path: skills/entcmc/dysms/alibabacloud-sms-send-short-message
  upstream-archive-sha256: f3ec3b2ca2263513f836c8a29d8be88f33729cb127ecd61a0566152db50215d7
---

# Alibaba Cloud SMS

## CLI readiness and authorization

Contract subject: `aliyun-sms`.

Resolve this skill's physical directory before using its helper or references.
Use the existing authorized account, credential provider, profile and region.
Read [RAM permissions](references/ram-policies.md) for the selected operation.
Do not print credentials or full configuration to establish readiness.
A profile name alone does not prove the intended account.

Check `aliyun version` (3.3.3 or later) and `aliyun plugin list` before invoking
an installed product plugin.
Missing CLI, jq or dysmsapi stops dependent work.
Installation, plugin updates, service activation, permission grants and profile
or credential changes require their own explicit authorization.
Preserve existing AI-mode and user-agent settings on success, failure and cancellation.
Ordinary SMS calls do not install plugins or write configuration.
This skill does not discover or install other skills.

Every SMS API call uses API version `2017-05-25`, kebab-case parameters,
`--read-timeout 3`, and
`--user-agent AlibabaCloud-Agent-Skills/alibabacloud-sms-send-short-message`.
Pass values as separate quoted arguments; never use eval or interpolate a shell command.
Use the same selected account/profile/region for prerequisites, sending and readback.
The helper defaults region to `cn-hangzhou`; supply `--region` when the approved target differs.

Before a real send, inspect the installed plugin version and its command help
(`aliyun dysmsapi send-sms --help`), then verify that version's documented
retry defaults and supported per-call controls. Do not guess a retry flag.
Disable send retries through supported per-call controls without changing
personal configuration; if that cannot be established, pause sending.
If a required control is unavailable in the helper, use the direct CLI path
with the verified control and the same approved plan, or pause sending.
The direct path must also parse stdout separately from stderr, require one JSON
object with Code=OK and a nonempty BizId, and preserve bounded diagnostics.
The helper makes one CLI send invocation and has no retry loop.
One CLI invocation does not prove that the plugin makes one network request.
Successful API calls return JSON on stdout; progress is on stderr.
Pre-send verification failures mean no send was attempted. Failed queries do
not change the original send outcome. Failed send results require reconciliation.

## Prepare the send plan

Recover the active task's supplied values and still-valid confirmation.
Do not guess recipients, signature, template, variables or account.
Documentation examples are placeholders and must never become real recipients.

Resolve these together before presenting the complete plan:

- Account/profile, region, exact recipients and count, including domestic or international scope.
- Signature, template code and approved template content.
- Required placeholder values, rendered message and per-recipient mapping.
- Single shared payload or personalized batch, and any tracking OutId.
- Existing attempt state and the operation's authorized send count.

Use authorized list queries to offer missing signature/template choices.
List schemas differ from detail schemas: confirm each chosen sign through
`get-sms-sign` and template through `get-sms-template`.
Require `Code=OK` and detail `SignStatus=1` / `TemplateStatus=1`.
Surface per-carrier `SignIspRegisterDetailList[*].RegisterResult` as information;
do not reject an otherwise approved sign solely for carrier registration.
Match all template placeholders to supplied string values.
For personalized batches, recipient, signature and parameter arrays must align
one-to-one; do not infer missing entries.

Present the concrete plan and obtain explicit confirmation covering it.
Reuse that confirmation while target, content, limits and attempt state remain valid.
A changed account, recipient, signature, template or content needs a changed plan.
A completed or outcome-unknown attempt cannot reuse its confirmation to send again.
Do not silently deduplicate recipients or split a plan into extra sends;
resolve duplicate entries and any required chunking before confirmation.

## Execute and read back

Use [the helper](scripts/send_sms.sh) for shared-payload sending and ordinary queries.
Help is offline and needs no CLI or credentials.
The helper resolves existing credentials through the CLI; it does not validate
account identity or interpret Human confirmation.
Its local JSON check requires a template-parameter object containing string values.
Its argument checks are not proof of template compatibility.

The examples below run from the physical skill directory.
Replace fixture values only with the confirmed plan; pass its profile/region
to every helper invocation.

```bash
bash scripts/send_sms.sh --help
bash scripts/send_sms.sh list-signs --profile selected --region cn-hangzhou
bash scripts/send_sms.sh list-templates --profile selected --region cn-hangzhou
bash scripts/send_sms.sh query-sign --sign-name "SelectedSign" --profile selected --region cn-hangzhou
bash scripts/send_sms.sh query-template --template-code "SMS_SELECTED" --profile selected --region cn-hangzhou

# Only after confirmation of this exact send.
bash scripts/send_sms.sh send -p "CONFIRMED_NUMBER" -s "SelectedSign" \
  -t "SMS_SELECTED" -tp '{"code":"CONFIRMED_VALUE"}' --verify --profile selected --region cn-hangzhou

bash scripts/send_sms.sh query-status -p "CONFIRMED_NUMBER" \
  --send-date "20260915" --biz-id "RETURNED_BIZ_ID" --profile selected --region cn-hangzhou
bash scripts/send_sms.sh query-statistics --start-date "20260901" \
  --end-date "20260915" --is-globe 1 --page-index 1 --page-size 50 --profile selected --region cn-hangzhou
```

Send supports `--out-id`; this is correlation data, not an idempotency key.
Statistics also supports `--sign-name` and `--template-type` (0/1/2/3/7).
All helper operations accept `--profile` and `--region`.
Use `send-sms` for shared signatures/parameters (up to 1000 recipients);
use direct `send-batch-sms` for different signatures/parameters (up to 100).
The helper does not implement a batch-send subcommand.

```bash
# Direct personalized batch; requires the same readiness and confirmed-plan boundary.
aliyun dysmsapi send-batch-sms --api-version 2017-05-25 \
  --phone-number-json '["CONFIRMED_NUMBER_A","CONFIRMED_NUMBER_B"]' \
  --sign-name-json '["SelectedSignA","SelectedSignB"]' \
  --template-code "SMS_SELECTED" \
  --template-param-json '[{"code":"VALUE_A"},{"code":"VALUE_B"}]' \
  --profile selected --region cn-hangzhou --read-timeout 3 \
  --user-agent AlibabaCloud-Agent-Skills/alibabacloud-sms-send-short-message
```

Check transport exit, response JSON shape and business `Code` separately.
The helper rejects nonzero CLI exits, malformed JSON and non-OK business responses.
It returns successful JSON without converting it to a delivery verdict.
For sending, require a nonempty `BizId` and retain `RequestId`, original send date,
account/profile/region, recipient mapping and attempt state in the existing task record.
Mask numbers and content in ordinary output; protect any necessary full record.

`Code=OK` means request acceptance, not delivery.
To report arrival, query each original recipient and date with the returned BizId.
Read `SmsSendDetailDTOs.SmsSendDetailDTO[]`, match the original target,
and report `SendStatus`: 1 awaiting receipt, 2 failed, 3 delivered.
Include the applicable `ErrCode`; use [error interpretation](references/sms-error-codes.md).
Aggregate statistics cannot establish a particular message's delivery.

The helper's lists return page 1 (50 items), and query-status returns page 1
(10 items) for one recipient and an explicit date.
For complete list or detail results, use the same direct query with incremented
`--page-index` (lists) or `--current-page` (details) and fixed filters.
For statistics, use the helper's `query-statistics` with incremented `--page-index`,
keeping `--page-size` and filters fixed.
Reconcile collected counts with the API total; report truncation, failed pages
or an empty result as incomplete evidence, never proof of non-delivery.
Use bounded read-only polling under the active task's wait limit.

## Failure and recovery

A timeout, interrupted process, missing BizId, malformed response or incomplete
readback leaves the send outcome unresolved.
Do not blindly resend, switch accounts or expand recipients.
Query the original target; if no uniquely matching record can be established,
retain the uncertainty and obtain a new concrete decision before any new send.
SendSms and SendBatchSms are not idempotent; a second CLI invocation is another attempt.
Query retries do not authorize send retries.

For explicit signature/template errors, offer authorized candidate queries and
correct the plan before seeking a new send confirmation.
Rate limits, balance problems and RAM denial do not authorize billing, permission,
configuration or service changes.
Report bounded diagnostic codes/RequestId instead of raw credential-bearing errors.

## References

- [Qualification list/detail queries](references/sms-qualification.md): load only for requested qualification work.
- [Alibaba Cloud plugin management](https://help.aliyun.com/en/cli/managing-and-using-cli-plugins).
- [SendSms](https://help.aliyun.com/document_detail/419273.html).
- [SendBatchSms](https://help.aliyun.com/document_detail/101414.html).
- [QuerySendDetails](https://help.aliyun.com/document_detail/102352.html).
