# Codex 交付内容

这份说明随安装发布，位于 `${CODEX_HOME:-$HOME/.codex}/README.md`。以下路径均相对于该目录。

| 位置 | 内容 | 详细说明 |
| --- | --- | --- |
| `AGENTS.md` | Codex 行为规则 | [规则入口](AGENTS.md) |
| `policy/` | 任务组织、模型路线、会话、工作区、Goal 与协作收尾，以及 Rust、SQL、评审、写作、工具参考 | [任务与协作](policy/models.md)、[辅助调用](policy/claude-code.md)、[Rust](policy/rust.md)、[SQL](policy/sql.md)、[评审](policy/review.md)、[写作](policy/writing.md)、[工具](policy/tool-contracts.md) |
| `tools/` | 可直接运行的检查器 | [工具契约](policy/tool-contracts.md)的对应小节 |
| `capability/` | 推荐的产品与项目配置 | [能力配置说明](capability/README.md) |
| `skills/` | 完整技能目录 | 各目录中的 `SKILL.md` |

规则入口说明各份按需参考的加载条件。工具的调用方式、选项与退出码见[工具契约](policy/tool-contracts.md)。

[任务起点](policy/models.md#task-start-and-execution-routing)在组织执行前衔接需求、授权、模型路线、会话、工作区及适用 Goal。普通短任务留在当前会话。复杂调查与关键判断、已定设计下的完整实现、界面操作及设计稿各有适用路线。模型偏好不扩大权限；Goal 创建另核明确授权及全文回读。首次组织或关键输入变化时读取相关小节，复用未变规则和证据。

[Claude Code 与 DeepSeek](policy/models.md#claude-code-and-deepseek-delegation) 的分工从任务拆解时主动评估。适任且授权、工具就绪的完整分析、设计、编辑、测试或修复结果，应实际交给客户端执行。负责人绑定单一结果与写区，并验收实际产物；不设调用比例或逐项审批。[调用合同](policy/claude-code.md)区分只读、有界执行和 Figma 设计模式。客户端由使用者提供，安装规则不启用模型或扩大权限。

[项目导航与验证](skills/project-guide/SKILL.md)提供四项能力。它识别项目与版本，发现权威资料，选择并执行原生检查，报告证据与缺口。按任务需要使用，不增加普通开发的必经流程。命令、业务规则及授权范围由目标项目和当前任务决定。

[Figma 设计工作流](skills/figma-design-workflow/SKILL.md)供 Codex 编排本地 Claude Code，完成授权内的可编辑设计、Design critique 与主代理看图验收。使用时动态发现实际插件。源码交付不代表插件已安装或真实设计演练已通过。
