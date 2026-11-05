# Codex 交付内容

这份说明随安装发布，位于 `${CODEX_HOME:-$HOME/.codex}/README.md`。以下路径均相对于该目录。

| 位置 | 内容 | 详细说明 |
| --- | --- | --- |
| `AGENTS.md` | Codex 行为规则 | [规则入口](AGENTS.md) |
| `policy/` | 任务组织、模型路线、会话、工作区、Goal 与协作收尾，以及 Rust、SQL、评审、写作、工具参考 | [任务与协作](policy/models.md)、[辅助调用](policy/claude-code.md)、[Rust](policy/rust.md)、[SQL](policy/sql.md)、[评审](policy/review.md)、[写作](policy/writing.md)、[工具](policy/tool-contracts.md) |
| `tools/` | 文档检查器、任务临时目录，以及受权会话客户端 | [工具契约](policy/tool-contracts.md)的对应小节 |
| `capability/` | 推荐的产品与项目配置 | [能力配置说明](capability/README.md) |
| `skills/` | 完整技能目录 | 各目录中的 `SKILL.md` |

规则入口说明各份按需参考的加载条件。工具的调用方式、选项与退出码见[工具契约](policy/tool-contracts.md)。

[任务起点](policy/models.md#task-start-and-execution-routing)在创建任务会话或组织执行前触发。该处衔接需求、授权、模型路线、会话、工作区及适用 Goal。普通短任务留在当前会话。复杂调查与关键判断、已定设计下的完整实现、界面操作及设计稿各有适用路线。模型偏好不扩大权限；Goal 创建另核明确授权及全文回读。首次组织或关键输入变化时读取相关小节，复用未变规则和证据。

[开发设备选择](policy/models.md#local-development)绑定 Human 明确选定的实际宿主，可用 Mac 或 SSH 连接的原生 Linux。前后端、设计和验收保留原职责。[Desktop 能力核对](policy/models.md#desktop-capabilities)复用实际执行者的工具及未变证据。[委派与验收](policy/models.md#delegation-and-acceptance)按实际方向验证发送或读取路径；缺入口时，使用双方可达的既有结果路径。依赖与平台缺口沿工作区及检查规则处理，不擅自换设备，也不把安装成功当作平台兼容证据。

[模型选择](policy/models.md#current-defaults)分别维护 Codex 职责映射与[外部路线模型偏好](policy/models.md#route-model-preferences)。按任务需要选择获准路线及适任模型，核实际标识、effort 和可用能力。持续选择按原始采用范围复用。创建接口的模型和档位字段分别判断，不因默认值存在就省略已允许参数。

[Claude Code 与 DeepSeek](policy/models.md#claude-code-and-deepseek-delegation) 按任务与能力适配选用。选用后可交付适任完整结果。设计稿采用[设计专用路线](policy/models.md#task-start-and-execution-routing)。负责人绑定单一结果与写区，并验收实际产物；不设调用比例或逐项审批。[调用合同](policy/claude-code.md)区分只读、有界执行和选用本客户端后的显式设计模式。客户端由使用者提供，安装规则不启用模型或扩大权限。

[Antigravity 使用支持](policy/antigravity.md)保留安装、技能发现和使用者直接操作 CLI 的说明。Antigravity CLI 可选安装通用 Skills 及必要依赖；Codex 不再从该文档选择或委派模型路线。

[项目导航与验证](skills/project-guide/SKILL.md)提供四项能力。它识别项目与版本，发现权威资料，选择并执行原生检查，报告证据与缺口。按任务需要使用，不增加普通开发的必经流程。命令、业务规则及授权范围由目标项目和当前任务决定。

[设计工作流](skills/figma-design-workflow/SKILL.md)供 Codex 制作授权内的可编辑设计稿，核对实际像素并由负责人验收。模型与 effort 见[模型政策](policy/models.md#current-defaults)。Figma 按任务需要使用；选用时加载实际技能并读回目标。源码交付不代表模型已经切换、插件已安装或真实设计演练已通过。
