# agents CI 重建与交付

## 当前退役状态

旧 CI 门禁、冻结来源要求及控制器规则已移除。仓库不再提供冻结配方、报告上传、自动批准、自动准入、凭据签发或可信合并入口。旧实现及专属回归从当前源码移除，新 CI 从零建立，不维护兼容桥接。

原生 CI 的[工作流源码](../.github/workflows/check.yml)随内容源交付。源码不配置平台保护，也不声明任何实例已启用。

## 实例与证据边界

本内容源与旧仓库历史独立。旧仓库的 PR、CI 运行、审查、ruleset 和安装报告均不作为新实例的证据。每次建立实例或切换来源时，绑定准确仓库 ID、根提交及实际配置，再取得匹配的运行和审查结果。未有匹配证据前，不把工作流源码存在称为 Actions、required checks 或审查接入已经启用。

同步策略以实际生效配置为准。strict=false 不因候选仅落后 main 就必然阻断；strict=true 则按其实际同步要求验收。两种配置下，候选或目标基线变化都仍按[审查覆盖规则](../delivery/policy/review.md#review-coverage)补齐受影响覆盖。源码不预设新实例采用哪一种同步配置。

## 重建期交付规则

本约定面向以本内容源建立的 `headironc/agents` 实例及发往 `main` 的普通 PR，按[共享合并流程](../delivery/policy/review.md#merge-admission)采用原生 CI 与独立审查。它不继承旧实例的自动准入、批准或冻结来源，也不授权创建、发布或修改平台配置。初始化发布另行绑定准确对象及授权，不伪造 PR 或 required 结果。

变更保持一个已选结果，完成[适用本地检查](tooling.md#选择检查)和独立代码及安全审查。修复阻断项，记录其他发现的处置。已知缺陷仍须处理。本地检查、正式审查、平台条件和真实交付分别确认，不互相替代。

发布与合并遵循 Human 的有效授权。对准确候选使用平台支持的普通合并，保留仍生效的保护，不使用管理员绕过。输入变化后只补齐受影响覆盖。外部写入结果未知时先读取原对象，不重复发送。

源码维护采用仓库原生 CI、独立审查和实际分支保护。代码、测试、依赖与 workflow 可在同一 PR 中修改，检查机制的变化接受独立审查。不预建共享执行器、报告认证或集合准入平台。

## 原生 CI 与独立审查

运行合同由[工具说明](tooling.md#ci-与审查边界)拥有。两个稳定结果为 `repository (ubuntu-latest)` 和 `repository (macos-latest)`。工作流源码不设置保护，也不证明这两个 context 已成为 required。配置 owner 在获得准确平台授权后，核对现存 ruleset、传统保护、来源绑定及 bypass，再按真实结果配置和验收。首片不新增 required approval 计数或批准控制器。

独立代码及安全审查的常规提供方与 Cubic 额度不足时的替代，由[提供方选择](../delivery/policy/review.md#review-provider-selection)统一维护。按 [gh 触发合同](../delivery/skills/gh/references/operations.md#automatic-review-and-feedback)显式请求，读取所选提供方针对当前候选的实际报告。按[审查覆盖](../delivery/policy/review.md#review-coverage)核对候选、目标基线、覆盖和完成状态。报告中的阻断发现先修复，其他发现保留处置理由。Cubic 的成功状态可能仍有发现或实际跳过审查；成功检查、普通评论或解决线程都不单独证明发现已妥善处置。审查者核对 workflow、检查目录、脚本、工具与依赖的变更，识别删除检查、条件跳过、伪造成功和扩大权限。

普通 required checks 只强制平台认可的结果及生产者。候选可以修改工作流和检查代码，同名绿灯不能证明执行器未被篡改。独立审查及发现处置仍是负责人交付责任，平台显示可合并不证明审查已完成。源码不提供平台强制独立 APPROVED review 的保证，实际批准要求以该实例配置为准。

源码发布、托管验收、保护配置和保护验收分别留证。同仓与 fork PR、草稿与 ready、重开、编辑元数据及改 base 均按运行合同验收。候选更新应替代旧运行；植入确定失败应使对应 job 失败，另一平台继续完成。恢复后核对新候选；main push 另有结果。配置后验证缺失或失败平台结果及未解决讨论的实际约束，同步要求按该实例的 strict 值核对。尚未执行的边界保留未验状态，不能由本地回归或旧实例报告补作成功。

## 历史合同与验收

退役前的[合同与恢复说明](https://github.com/headironcc/agents/blob/1864935c27fca5de3f98ea508c81c177d37e2472/docs/review-gate.md)和[可信执行实现](https://github.com/headironcc/agents/tree/1864935c27fca5de3f98ea508c81c177d37e2472/scripts)使用私有归档的计划定位，访问与迁移边界见[来源说明](skill-sources.md)。这些历史材料不包含在本内容源中。旧结果不证明新实例已完成验收，也不授权恢复旧入口。
