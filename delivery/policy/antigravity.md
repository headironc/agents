# Antigravity 使用支持

本文定义 Antigravity（CLI 与 App）的全局规则边界、会话与子代理运行时规约，并供使用者直接操作 CLI 时参考。其他代理不从本文取得调用或委派 Antigravity CLI 的路线。授权与操作边界由[公共规则](common.md)拥有，工作区、临时资源与收尾核对由[执行规则](execution.md)拥有。

## 安装、技能发现与规则预算

Antigravity 保留为可选安装产品。仓库交付原生全局规则入口、通用 Skills、必要政策和工具，不安装 CLI、账号、密钥或个人设置。安装目标、格式校验与个人环境中的实际发现分别验收。

原生全局规则使用 `~/.gemini/AGENTS.md`，供 App 与 CLI 共享。[官方规则发现说明](https://antigravity.google/docs/customization-discovery/)也列出 `~/.gemini/GEMINI.md`；不要把两者作为互不相关的规则安装位置。共享技能使用 `~/.gemini/config/skills/<name>/SKILL.md`，配套政策和工具位于同一 `config/` 资产根，保留相对引用。标准目录自动发现，无须写入 `skills.json`。

App 不读取 `~/.gemini/antigravity-cli/skills/` 和 `~/.gemini/skills/`，CLI 则优先读取这两处旧目录。升级后核对同名旧副本的实际来源，按安装合同处理受管旧资产。CLI 通过 `/skills` 核对来源，App 通过已安装技能列表及新会话调用核验。静态交付闭包不证明个人环境中的实际发现。

Antigravity 没有自由文本隐式 `memory` 工具，持久化均走显式 Rule 与 Skill 文件。按 [CLI 参考](https://antigravity.google/docs/cli/reference)，`/learn` 同样在工作区 `.agents/`（及兼容别名目录）或全局目录生成规则与技能。持久偏好与规则缺口必须按[需求评估](common.md#working-together)和[规则归属](common.md#code-preferences)回到权威源维护。代理不得手改生成的 `~/.gemini/AGENTS.md` 或已安装 `config/` 副本，也不得在受控业务仓库工作树写入未获授权的 `.agents/` 文件充当隐式记忆。

按[官方规则与工作流说明](https://antigravity.google/docs/rules-workflows)，全局规则同时扫描 `~/.gemini/AGENTS.md`（及 `GEMINI.md`）与模块化 `~/.gemini/config/rules/*.md`（支持 `always_on`、`glob`、`model_decision`、`manual` 触发模式）；传统 `workflows/` 已向 Agent Skills 与动态 `run_workflow` 迁移。单个规则文件展开 `@[label](path)` 引用后的上限为 `24,000` 字节（`24 KB`），超出部分按行截断。全部 `always_on` 与全局常驻规则共享 `20,000` tokens 内联预算，超出预算的规则降级为文件路径指针按需读取。编译进 `~/.gemini/AGENTS.md` 的内容必须保持凝练并远低于 `24,000` 字节，展开细则下沉至 `config/policy/` 按需读取。

## 会话空间与只读边界

虽然全局 `AGENTS.md` 与 `config/` 由各端共享，但应用数据目录 `<appDataDir>` 按客户端隔离：CLI 使用 `~/.gemini/antigravity-cli/`，App（Antigravity 2.0）使用 `~/.gemini/antigravity/`，IDE 使用 `~/.gemini/antigravity-ide/`。各端在自身 `<appDataDir>/brain/<conversation-id>/` 下维护独立于业务仓库工作树的会话空间，包含结构化 Artifacts、会话内持久化临时目录 `scratch/`，以及 `.system_generated/logs/transcript.jsonl` 与 `transcript_full.jsonl`。回查会话日志时先读紧凑 `transcript.jsonl`；仅当记录含 `truncated_fields` 时，按对应行号读取 `transcript_full.jsonl`。

按[操作边界](common.md#operation-boundaries)，检视、代码审查或只读架构推演中的“只读”与“不修改文件”约束，保护对象是被检视的目标仓库工作树、外部材料与受管配置。除非使用者显式禁止写入会话 `brain/`，当前会话专属的 `<appDataDir>/brain/<conversation-id>/scratch/`（及明确要求的会话 Artifact）可承载会话内分析草稿、状态锚点与子代理长文交接，不污染目标仓库。只读任务不得在受检工作树内写入 `progress.md`、`spec.md` 或临时报告。收尾与清理遵循[临时目录生命周期](execution.md#task-temporary-directories)和[演练清理规则](execution.md#test-and-exercise-cleanup)。

## 子代理通信与长报告回传

`invoke_subagent`、`swarm`、`run_workflow`、后台 `run_command` 与 `schedule` 在完成或收到消息时自动唤醒会话。启动异步工作后继续独立步骤或结束当前回合等待唤醒，禁止编写轮询循环或用 shell `sleep` 充当定时器；仅 `swarm` 协调器在无需回复使用者时按其协议调用 `swarm_wait`。按 [CLI 功能说明](https://antigravity.google/docs/cli/features)，只读检视、核验与单写者阶段将子代理 `workspace` 保持为默认 `inherit`；仅在[工作区规则](execution.md#workspaces)允许的并发隔离写入时使用 `share` 或 `branch`，并在执行 `kill` 删除工作区前验证并合入改动。

Antigravity 存在三类原生多代理通道：`invoke_subagent`（及 `/boost` 多阶段子代理）通过点对点 `send_message` 异步回传结果；`swarm` 通过全员可见的共享留言板（`post_message` / `read_board`）协作；`run_workflow` 由 Python 脚本编排 `agent` 并经 `finish` 返回结构化结果。其中 `send_message` 单条消息具有 `20,480` UTF-8 字节硬上限，超出即在传输层截断为 `<truncated ... bytes>`；子代理的 `write_file` 仅可写入子代理自身的 `<appDataDir>/brain/<self-conversation-id>/scratch/`，无法写入父会话或其他会话的 `brain/` 目录。

当子代理具备写工具权限，且产出的报告或分析结果预计接近或超过 `send_message` 上限（如大于 `16 KB` UTF-8）时，子代理必须将完整未删减内容写入自身的 `<appDataDir>/brain/<self-conversation-id>/scratch/` 文件。随后通过 `send_message` 回传文件绝对路径与精炼结论摘要，由父会话收到路径后调用 `read_file` 读取全文（`swarm` 成员产出长篇报告时同样写入文件并在留言板仅发路径与精炼摘要，避免全员上下文膨胀）。禁止要求子代理写入父会话 `brain/` 目录；禁止为硬塞单条消息在循环中反复调用 `python3`、`wc -c` 等命令测算字节数，或反复破坏性删减正文。

当子代理处于无写工具只读沙箱（如内置 `research`）或遇到宿主写入拒绝时，保留拒绝事实，按紧凑结构或有序分段一次回传，不做无界重算。协调器派发长篇推演或深度审查子任务时，应在授权范围内选用具备写工具的子代理，并在派发简报中写明子代理自身 `brain/<self-conversation-id>/scratch/` 回传路径与受检仓库只读边界。父会话消费完 `read_file` 内容后，再执行相关的子代理收尾或演练清理。

## 直接使用与账号

- 先核实际可执行文件、`--version`、`--help`、[认证方式](https://antigravity.google/docs/install?tab=cli)、实际接收服务、计费账号与有效使用限制（不输出凭据）。`agy models` 可能初始化日志、安装标识及语言服务；遇到宿主写入拒绝时保留拒绝并核进程终态，不改 `HOME`、账号或日志路径绕过。
- 按[官方 FAQ](https://antigravity.google/docs/faq) 核支持范围：官方 `headless` 面向直接脚本和 CI，消费计划不支持第三方编码代理或应用嵌套调用 `agy`，也不支持自动轮换账号。登录、换账号、获取密钥、购买额度及持久配置由使用者决定。

## 工作区、材料与参数

- 绑定任务结果、实际工作区、候选、必要材料、允许操作和验收；核对[自动发现](https://antigravity.google/docs/customization-discovery/)的规则、技能、插件、hooks、MCP 和额外目录，排除秘密与无关内容，保留可信 hooks、原有 deny 和宿主限制。
- 按[模型说明](https://antigravity.google/docs/models/)和 [effort 说明](https://antigravity.google/docs/cli/commands/effort/)核对所选模型与显式 `--effort`（及完整模型 ID 的档位后缀或系列别名解析结果）是否一致；冲突或不支持时保留错误，不自动降档或换系列。配置、请求参数、返回标识和服务端执行事实分别报告。

## 直接脚本与 CI

使用者可按 [headless 说明](https://antigravity.google/docs/cli/headless/)配置直接脚本或 CI。固定短提示可用 `-p`。任务材料通过标准输入发送；采用 `--input-format stream-json --output-format stream-json` 时，不同时传 `-p`。一行 user 消息的形状为：

```json
{ "event": "user", "message": { "content": "<authorized task material>" } }
```

逐行消费输出，收到本轮 result 后关闭 stdin，并等待前台进程及子进程终结。显式设置任务适用的有界 `--print-timeout`，核实际版本的单位和含义。

单次覆盖可使用受支持的 `--settings`，核对实际合并结果。[设置说明](https://antigravity.google/docs/settings?tab=cli)提供配置语义。继续原会话时绑定已核实的 `conversation_id`，不使用最近一次会话作为未知任务的恢复目标。

## 权限与执行模式

按[权限说明](https://antigravity.google/docs/permissions)核有效的 deny、ask、allow、工作区范围和 MCP 集合。权限请求无法获批时，headless 会软拒绝（soft-deny）该工具并向 `stderr` 输出通知，进程仍可能继续并以退出码 `0` 返回。非交互模式和 plan 模式都不构成宿主隔离。

按[执行模式说明](https://antigravity.google/docs/cli/modes)核实际模式及 sandbox 前提。headless 中 `auto` 不可用时可能警告后回退，不能把请求 auto 写成已具备无人值守执行能力。不使用全局跳过权限来解除拒绝，不删除 deny、禁用可信 hooks 或改宿主配置绕过限制。

## 结果与恢复

同时核进程退出码、结构化终态、报告完整性及任务所需工具的实际结果。stderr 的拒绝、截断、遗漏或实际失败仍须处理；成功状态不代替真实差异和检查。

保留 `conversation_id`、请求参数、必要工具证据、产物、候选和限制。日志先脱敏，省略凭据、鉴权头、原始 thinking、图片 base64 及无关个人信息。usage 只作为返回的用量元数据，不推算未核实的账单。

失败后核原句柄、已产生的差异、子进程和外部操作。未知写先回读同一目标。超时或本地取消不证明服务端结束。诊断后沿受支持机制恢复，不直接重发未知操作。

帮助、格式校验和静态场景不证明真实模型行为、端到端开发或正式审查已验收。
