# External Model CLI Bridge (`claude-code`)

Contract subject: `claude-code`.

本合同定义通过本地 CLI 桥接器调用 DeepSeek、OpenCode 等非 Anthropic 模型的结构化契约、参数与结果核验规则。可选委派、模型分层及授权由[模型政策](models.md#claude-code-and-deepseek-delegation)定义。开发执行遵循[开发设备选择](models.md#local-development)。客户端缺少 Desktop 工具时，按[能力核对](models.md#desktop-capabilities)安排对应阶段。仅在选用本桥接路线时，按任务选择只读、有界执行或显式设计模式。设计稿默认路线见[任务起点](models.md#task-start-and-execution-routing)，可编辑结果与视觉验收见[设计工作流](../skills/figma-design-workflow/SKILL.md)。先核对实际 CLI 版本、实际接收端点及有效参数。

禁用 Anthropic Claude 原生模型及特化提示词写法；模型接口仅连接本合同定义的 DeepSeek 官方、OpenCode 官方或其他已获准并纳入本合同的兼容开源模型端点。负责人在允许范围内选择满足任务需要的路线，合适时复用当前配置，无须逐次请示。`https://api.deepseek.com/anthropic` 是 DeepSeek 官方兼容端点。OpenCode 路线按其官方 API 文档核对实际地址。第三方转发或自建兼容地址不因使用同一模型名而进入允许范围。核对本次实际接收端点、凭据来源、模型和 effort，不显示密钥或鉴权头。

按实际服务解析模型名，优先显式传入目标模型标识（如 `deepseek-flash` 或 `deepseek-v4.1-flash`），避免依赖 `claude-*` 兼容别名。日常编码、重构、单测与轻量辅助任务显式将推理档位（effort）设为 `low` 以消除思考卡顿；仅在多跳复杂推理或疑难排查时升至 `high`。

当前 V4.1 Flash 在 [DeepSeek 官方 API](https://api-docs.deepseek.com/quick_start/pricing/) 使用 `deepseek-flash`。[OpenCode Go 目录](https://opencode.ai/v2/docs/console/go)将其列为 `deepseek-v4.1-flash`。按实际服务和协议解析，不跨路线照搬。

[DeepSeek 推理档位](https://api-docs.deepseek.com/guides/thinking_mode/)的规范值为 `low`、`high`、`max`。核对所选服务及客户端实际支持和传递的值。客户端接受参数，不证明服务端有效档位。

## 只读辅助

只读分析使用 print 模式 `-p`。材料已完整提供且无需工具时，以 `--tools ""` 禁用内置工具。需要读取源文件时，只开放适用的读取工具。没有 MCP 需要时，使用 `--strict-mcp-config` 且不传入 server 配置；需要 MCP 时核对只读工具及实际服务器集合。另用 `--no-session-persistence` 避免保存会话历史。核对有效输入中没有额外工具或未授权材料。验证所需的临时写入按[检查规则](review.md#checks)限定命令与输出位置，不授权修改被审查源码。

## 有界执行

按模型政策主动交付适任的完整结果，包括已授权的分析、设计、代码或文档编辑、测试和修复。可见任务负责人绑定单一结果、宿主、真实工作区、基线候选及允许操作。材料包含必要调用链，排除秘密和无关内容。共享工作区只留一个写者，并行写任务使用隔离写区。执行期间，负责人不同时修改同一写区。关键业务判断与验收仍由负责人承担；执行者遇到未决业务或范围变化时报告，继续独立的范围内工作。

使用 `-p` 和 `--no-session-persistence`。按任务开放所需的读写、编辑和命令工具，核对命令效果及输出位置。没有 MCP 需要时，保留 `--strict-mcp-config` 且不传 server 配置；需要时按[工具与权限](#工具与权限)绑定集合。普通执行不继承 Figma 许可，也不增加发布、部署或敏感操作权限。实际效果仍须由有效任务授权覆盖。

在自己的已授权开发仓库中，Claude Code 与负责人沿用同一任务范围和宿主权限规则。正常读写、命令与测试不因委派而增加单独审批或强制沙箱要求。委派也不提供绕过宿主拒绝的权限。只有实际材料来源或执行效果出现具体边界问题时，才处理受影响的调用；不要把假设中的恶意仓库当作当前仓库已受攻击的证据。

返回实际差异、产物位置、检查命令和结果、当前候选及遗留进程。失败和未知外部写结果分别报告。负责人核对原运行、实际产物及匹配候选的证据后接纳。报告成功不代替业务验收或正式交付。

## 显式设计模式

本模式仅适用于用户有效指令选用 Claude Code 制作或迭代设计稿的任务。单纯的设计请求沿用[模型政策的设计路线](models.md#task-start-and-execution-routing)。选用本模式后，按[设计技能](../skills/figma-design-workflow/SKILL.md#bind-the-design-task)复用有效任务授权。负责人自行落实材料选择、既定服务商调用及目标和编辑范围。技术绑定不要求用户另批精确材料包或逐个节点。仅有只读辅助授权时，继续使用[只读模式](#只读辅助)。设计模式使用 `-p` 和 `--no-session-persistence`，按实际插件所需开放内置工具与 MCP。逐项列出本次所需工具和技能，排除无关操作。不复制历史全 Figma 通配许可作为默认值。

## 工具与权限

`--tools` 限制内置工具集合，`--allowedTools` 提供免提示许可，调用前核对继承权限、技能 `allowed-tools`、可信 hooks 及实际 MCP 集合。需要显式 MCP 配置时使用 `--strict-mcp-config --mcp-config`。

### 权限模式与实际生效

已授权的有界开发优先按实际支持显式传入 `--permission-mode auto`（SDK 为 `permissionMode: "auto"`）；仅在当前子进程按需设置受支持的审批模型环境变量（如 `CLAUDE_CODE_AUTO_MODE_MODEL`），使审批接收方仍限原授权范围。核对实际生效模式、实际审批模型或服务端 classifier 判定及终态；仅传参数、别名、保存配置或收到主模型响应不证明 `auto` 已生效，兼容性未证时保持未知。`dontAsk` 会把内部安全预检查（如含复杂补丁或引号 heredoc 的命令）的 `ask` 直接转为拒绝，仅用于明确接受未获准动作直接失败的只读或受限任务，不作为无人值守开发的默认模式，也不将此类内部拒绝混作宿主拒绝或材料未获授权。

### 正常审批转交

`auto` 不可用或触发正常审批转交时，通过 SDK `canUseTool` 或 CLI `--permission-prompt-tool` 接收范围内原始工具请求。原负责人依据有效用户授权核对完整输入、工作区、目标、实际效果、真实理由与请求标识后，范围内只批本次且不写新权限（不返回 blanket allow、按前缀批量准许或扩大许可的 `updatedPermissions`）；既有 `deny`、可信 hook 拒绝或专属用户决定保持阻断。未收到实际回调、classifier 无判定或真实开发未完成时，分开报告机制、候选与真实终态，不把配置保存或外发成功当作端到端修复完成。

## 公共调用与结果

通过标准输入传递任务材料，仅在本次子进程设置模型、effort（将 `CLAUDE_CODE_EFFORT_LEVEL` 与 CLI 参数对齐，日常默认 `low`）及网关地址，不修改个人持久配置，也不默认使用会跳过 hooks 的 `--bare`。

结构化采集使用 `--output-format stream-json --verbose`，日志脱敏省略凭据、鉴权头、原始 thinking 与图片 base64。完成时同时核对退出码为 `0`、`is_error: false` 以及结构化结果完整；失败或超时后先回读已产生的差异和原目标状态，诊断原因后再由负责人决定修复或接回，不盲目重发未知写操作。参数依据见 [Claude Code CLI](https://code.claude.com/docs/en/cli-reference)、[权限模式](https://code.claude.com/docs/en/permission-modes)、[DeepSeek Anthropic API](https://api-docs.deepseek.com/guides/anthropic_api/) 与 [OpenCode 接入说明](https://opencode.ai/v2/docs/console/harnesses/claude-code/)。
