# Antigravity CLI

Contract subject: `antigravity-cli`.

本合同约束 `agy` 的调用、材料、权限与结果。触发条件由[模型政策](models.md#antigravity-cli-delegation)拥有。开发执行遵循[仅本机开发](models.md#local-development)。客户端缺少 Desktop 工具时，按[能力核对](models.md#desktop-capabilities)安排对应阶段。选用路线后再读取本合同，不因文档或可执行文件存在就启动模型。

## 路线与账号就绪

先核实际可执行文件、`--version` 和 `--help`。核对本次调用方式、认证类型、实际接收服务、计费账号及有效使用限制。不输出凭据。CLI 名称或模型别名不证明后端身份。

`agy models` 也可能初始化日志、安装标识及语言服务，不按命令名称认定无副作用。遇到宿主写入拒绝时保留拒绝，核本次进程终态，再报告目录未核实；不改 HOME、账号或日志路径绕过。

按[官方 FAQ](https://antigravity.google/docs/faq) 核支持范围。消费计划不支持由第三方编码代理或应用嵌套调用 `agy`，也不支持自动轮换账号。官方 headless 面向直接脚本和 CI。仅在实际账号与调用方式受支持、材料和操作已授权时调用。安装、登录或持有订阅不证明这些条件成立。未知时暂停依赖调用，继续独立工作。

[认证方式](https://antigravity.google/docs/install?tab=cli)与本次实际 provider 一并核对。存在 API key 不单独证明已选用对应路线。不自动登录、换账号、获取密钥、购买额度或修改持久配置。复用覆盖本项目、材料、接收方和操作的有效授权；不增加例行逐次确认或未经要求的费用上限。

## 任务、材料与参数

绑定单一结果、实际工作区、基线候选、必要材料、允许操作、写区和验收。沿用[委派规则](models.md#delegation-and-acceptance)及唯一写者要求。只读委派保持只读；发布、合并、部署和配置变更分别核权。

核对[自动发现](https://antigravity.google/docs/customization-discovery/)的规则、技能、插件、hooks、MCP 和额外目录。自动加载的内容也属于材料。排除秘密和无关内容，不依靠提示词声明代替实际权限边界。保留可信 hooks、原有 deny 和宿主限制。边界无法满足时停止依赖调用，不通过跳过配置或更换执行者规避拒绝。

按实际支持选择模型和 effort，显式传入已选定且获准的参数。[模型说明](https://antigravity.google/docs/models/)和 [effort 说明](https://antigravity.google/docs/cli/commands/effort/)提供核对入口；网页列举、另一个 CLI 的档位或 Codex 模型表不证明本次组合可用。配置、请求参数、返回标识和服务端执行事实分别报告。切换模型不扩大接收服务或操作范围。

## 有界调用

使用 [headless 合同](https://antigravity.google/docs/cli/headless/)提供的非交互入口。固定无敏感材料的短提示可用 `-p`。任务材料通过标准输入发送；采用 `--input-format stream-json --output-format stream-json` 时，不同时传 `-p`。一行 user 消息的形状为：

```json
{ "event": "user", "message": { "content": "<authorized task material>" } }
```

只发送当前有界任务所需的消息。逐行消费输出，收到本轮 result 后关闭 stdin，并等待前台进程及子进程终结。不要把等待进程退出作为流式会话的唯一读取方式。显式设置任务适用的有界 `--print-timeout`，核实际版本的单位和含义，不依赖网页或 CLI 的默认时长。

需要单次覆盖时使用受支持的 `--settings`，核对其实际合并结果，不写个人设置文件。[设置说明](https://antigravity.google/docs/settings?tab=cli)只提供配置语义，不授予配置变更权限。继续原会话时绑定已核实的 `conversation_id`；不使用最近一次会话作为未知任务的恢复目标，也不为取得完整报告直接重发未知操作。

## 权限与执行模式

按[权限合同](https://antigravity.google/docs/permissions)核有效的 deny、ask、allow、工作区范围和 MCP 集合。权限请求无法获批时，headless 可能拒绝必要工具而继续返回。非交互模式不是只读保证，许可规则也不构成宿主隔离。

只读分析使用受支持的 `--mode=plan`，并核实际文件、命令和 MCP 权限；计划模式的行为说明不代替权限限制。有界执行只开放当前任务所需能力。按[执行模式说明](https://antigravity.google/docs/cli/modes)核 `auto` 的 sandbox 前提及实际模式。headless 中 `auto` 不可用时可能警告后回退，不能把请求 auto 写成已具备无人值守执行能力。

不使用 `--dangerously-skip-permissions` 作为通用兜底，不删除 deny、禁用可信 hooks 或改宿主配置解除拒绝。正常审批或必要工具不可用时，保留具体原因，接回剩余工作或报告依赖缺口。

## 结果、日志与恢复

同时核进程退出码、结构化终态、报告完整性及任务所需工具的实际结果。要求退出码为 0、终态为 `SUCCESS`，且本次输出合同已满足。stderr 的拒绝、截断、遗漏或实际失败仍须处理；成功状态不代替真实差异、检查和负责人接纳。

保留 `conversation_id`、请求参数、必要工具证据、产物、候选和限制。日志先脱敏，省略凭据、鉴权头、原始 thinking、图片 base64 及无关个人信息。usage 只作为返回的用量元数据，不推算未核实的账单。

失败后核原句柄、已产生的差异、子进程和外部操作。未知写先回读同一目标。超时或本地取消不证明服务端结束。诊断后沿受支持机制恢复，或由原负责人接回剩余工作；不重复同一失败，不自动重试、换账号或改服务商。

本仓库交付规则与手工调用合同，不交付 CLI、账号、密钥、自动调用执行器或个人设置。帮助和离线检查不证明真实模型行为、端到端开发或正式审查已验收。
