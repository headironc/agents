# RAM Policies

This Skill calls the Alibaba Cloud Short Message Service (dysmsapi) OpenAPIs and therefore
requires permissions for the complete requested flow, including its prerequisite
checks and result readback.
Read [the invocation boundary](../SKILL.md#cli-readiness-and-authorization)
before using these examples.
Query-only work needs no send permission; this reference grants no permission
to attach policies or change an account.

## Required Permissions

| Action | Description | Required |
| ---------------------------- | --------------------------------- | -------- |
| `dysms:SendSms` | Send an SMS | Only for SendSms |
| `dysms:SendBatchSms` | Batch send SMS (per-recipient sign/template params, up to 100) | Only for SendBatchSms |
| `dysms:GetSmsSign` | Query signature approval status | Required for send planning; also for a requested signature query |
| `dysms:GetSmsTemplate` | Query template approval status | Required for send planning; also for a requested template query |
| `dysms:QuerySmsSignList` | Query the signature list | Only for the corresponding requested query |
| `dysms:QuerySmsTemplateList` | Query the template list | Only for the corresponding requested query |
| `dysms:QuerySendDetails` | Query SMS send details | Required for delivery readback and uncertain-send reconciliation |
| `dysms:QuerySendStatistics` | Query SMS send statistics | Only for the corresponding requested query |
| `dysms:QuerySmsQualificationRecord` | List SMS qualification records | Only for the corresponding requested query |
| `dysms:QuerySingleSmsQualification` | Get single qualification detail | Only for the corresponding requested query |

## Minimum Permission Policy

The minimum action set for this skill's SendSms flow includes signature/template
approval checks, one authorized send and delivery readback. A SendSms-only
policy cannot complete this flow. For a SendBatchSms flow, replace SendSms with
SendBatchSms; include both send actions only when both are requested. This
example does not authorize applying a policy or widening an existing role.

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dysms:GetSmsSign",
        "dysms:GetSmsTemplate",
        "dysms:SendSms",
        "dysms:QuerySendDetails"
      ],
      "Resource": "*"
    }
  ]
}
```

## Combined Permission Example

Send SMS plus queries; narrow this example to the authorized operations:

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dysms:SendSms",
        "dysms:SendBatchSms",
        "dysms:GetSmsSign",
        "dysms:GetSmsTemplate",
        "dysms:QuerySmsSignList",
        "dysms:QuerySmsTemplateList",
        "dysms:QuerySendDetails",
        "dysms:QuerySendStatistics",
        "dysms:QuerySmsQualificationRecord",
        "dysms:QuerySingleSmsQualification"
      ],
      "Resource": "*"
    }
  ]
}
```

## How to Apply

Only perform the following steps within separately authorized RAM setup.

1. Sign in to the [RAM console](https://ram.console.aliyun.com/).
2. Create a custom policy and paste the JSON above.
3. Attach the policy to the appropriate RAM user or role.
