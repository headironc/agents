# DeepSeek Harness (`dsh`) 调用合同

Contract subject: `dsh`.

本合同定义通过本机安装的官方 DeepSeek Harness CLI（`dsh`）执行只读分析、有界开发与修复的结构化契约、参数与结果核验规则。可选委派、模型分层及授权由[模型政策](models.md#deepseek-harness-delegation)定义。开发执行遵循[开发设备选择](models.md#local-development)。客户端缺少 Desktop 工具时，按[能力核对](models.md#desktop-capabilities)安排对应阶段。设计稿默认路线见[任务起点](models.md#task-start-and-execution-routing)，可编辑结果与视觉验收见 Codex 的 `figma-design-workflow` 技能。先核对实际 CLI 版本、实际接收服务、凭据来源及有效参数。

## 执行客户端、接收服务与凭据来源

- **执行客户端与路由定位（及与已退役桥接器的对照）**：使用官方 DeepSeek Harness 桌面应用内置或已链接到 `PATH` 的 `dsh`（macOS 默认路径为 `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`，实测版本 `0.2.2-rc.1`）。调用前通过 `dsh --version`、`dsh --help` 与 `dsh headless --help` 核对实际二进制、支持选项及 profile 组合。相较于已从本仓库移除的 Claude Code 桥接器（以第三方 `claude` CLI 为执行客户端、经 Anthropic 兼容协议转发 DeepSeek/OpenCode 端点、仅依赖启动环境变量注入密钥并通过 `-p --output-format stream-json` 调用），官方 `dsh headless` 直接以原生 Cordis 插件树连接 OpenCode Go（`openai-completions` 协议）或 DeepSeek 官方服务，支持桌面端 `${DSH_HOME:-$HOME/.dsh}/.credentials.yaml` 托管凭据复用（配合 patch 叠加）与 `.env`/环境变量分级回退，并以 `--permission-mode`、`--approval-policy`、`--add-dir` 与 `--json` 提供只读分析、有界工作区写入及显式设计原型辅助。
- **模型接收服务与模型标识**：仅连接本合同定义的官方服务路由：
  - **OpenCode Go 路由（`opencode-go`）**：由 `@deepseek-ai/dsh-llm-pi-ai` 承载，默认端点为 `https://opencode.ai/inference/go/v1`（`openai-completions` 协议，`thinkingFormat: "deepseek"`），日常编码与重构默认模型为 `deepseek-v4.1-flash`。
  - **DeepSeek 官方路由（`deepseek-official`）**：由 `@deepseek-ai/dsh-llm-deepseek-api-key` 承载，连接 DeepSeek 官方 API，对应 V4.1 Flash 模型标识为 `deepseek-flash`。
  - 第三方未核实转发或自建兼容地址不因使用同一模型名而进入允许范围。负责人在允许范围内选择满足任务需要的路线，合适时复用当前配置，无须逐次请示。
- **凭据来源与查找优先级**：
  - 桌面端（`desktop` profile）与 Web 端默认启用 `@deepseek-ai/dsh-credentials-local`（位于 `${DSH_HOME:-$HOME/.dsh}/.credentials.yaml`）、`@deepseek-ai/dsh-authorization` 与 `@deepseek-ai/dsh-deepseek-account-platform`。配置只保存凭据引用名（如 `apiKeyEnv: OPENCODE_GO_API_KEY`），不把明文密钥写入 profile 文件。启用托管凭据存储时，按固定优先级解析：`${DSH_HOME:-$HOME/.dsh}/.credentials.yaml` > 启动环境（`OPENCODE_GO_API_KEY=...`）> `<调用 cwd>/.env` > `${DSH_HOME:-$HOME/.dsh}/.env`。
  - 官方发布的 `headless` profile 默认将 `credentials`、`authorization` 和 `deepseek-account` 设为 `disabled: true`（见[官方凭据说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/headless/README.md#credentials)）。未叠加配置时，`dsh headless` 忽略桌面端已保存的托管密钥，仅读取启动环境、`<调用 cwd>/.env` 与 `${DSH_HOME:-$HOME/.dsh}/.env`。若启动环境中导出了空字符串（如 `OPENCODE_GO_API_KEY=""`），会遮蔽 `.env` 回退；无环境密钥时须显式 `unset OPENCODE_GO_API_KEY`（或使用 `env -u OPENCODE_GO_API_KEY`）。
  - 要在 `headless` 中复用 Harness 托管凭据与 `opencode-go` 默认路由，由使用者将仓库交付的无密钥配置片段 [`dsh-headless.patch.yml`](../capability/dsh-headless.patch.yml) 合并进 `${DSH_HOME:-$HOME/.dsh}/profiles/headless/cordis.patch.yml`（详见[能力配置说明](../capability/README.md)）；在持久配置尚未合并或写入受宿主拦截时，可在单次调用中显式传入 `--patch <path>/dsh-headless.patch.yml`。严禁将任何 API key 写入仓库、配置片段、命令行参数或日志。

## 适用场景与执行模式

### 只读辅助

只读分析、代码审查与静态排查使用 `dsh headless --permission-mode read-only --approval-policy never --json -`，通过标准输入传入任务与必要上下文。`read-only` 预设将文件沙箱限制为只读，且 `never` 直接拒绝需要交互审批的越界操作。验证所需的临时写入按[检查规则](review.md#checks)限定命令与输出位置，不授权修改被审查源码。

### 有界执行

在已授权的开发仓库或独立 Git 工作树中，按模型政策主动交付适任的完整结果，包括已授权的分析、代码或文档编辑、测试和修复。可见任务负责人绑定单一结果、宿主、真实工作区、基线候选及允许操作，排除秘密和无关内容。共享工作区只留一个写者，并行写任务使用隔离写区。

使用 `dsh headless --permission-mode workspace-write --approval-policy never --json -`，将子进程当前工作目录（`cwd`）绑定到目标检出或工作树（`sandbox-policy` 默认以 `process.cwd()` 作为 `workspaceRoot`）。当任务在关联工作树（linked worktree）中需要访问共享 Git 元数据目录（如执行索引暂存、提交或触发仓库 hooks）时，先解析物理绝对路径 `git_dir=$(git rev-parse --path-format=absolute --git-common-dir)`，并以可重复的 `--add-dir "$git_dir"` 显式授予该次调用。共享 `.git` 授权覆盖 refs、hooks 和 config，仅用于受信任任务，宿主后续执行 Git 操作前须核对元数据改动。若已显式配置并启用实验性 Auto review，可按其合同使用 `--permission-mode auto --approval-policy never`。普通有界执行不自动继承桌面 GUI 专属工具，也不增加发布、合并或部署权限。

### 显式设计模式

单纯的设计稿创建与迭代沿用[模型政策的设计路线](models.md#task-start-and-execution-routing)与 Codex 的 `figma-design-workflow` 技能。仅当用户有效指令显式选用 DeepSeek Harness 辅助设计草稿或前端原型时，按本合同的只读或有界执行模式绑定目标目录、权限与输入材料，最终像素与交互判断仍由主负责人验收。

## 模型、推理档位与命令参数

- **模型与推理档位（`reasoningEffort`）**：通过 `@deepseek-ai/dsh-agent-default-model` 的 `provider`、`model` 与可选 `reasoningEffort` 字段配置（可用 `--dump-config` 核对合成后的生效配置树，不输出密钥）。在 `opencode-go` 路由下，`deepseek-v4.1-flash` 的 `thinkingLevelMap` 仅支持 `low`、`high`、`max` 三档（`off`、`minimal`、`medium`、`xhigh` 映射为 `null`）；`deepseek-official` 路由下的 `deepseek-flash` 同样使用 `low`、`high`、`max`。日常编码、重构、单测与轻量辅助默认显式使用 `low` 档位以消除推理延迟；仅在多跳复杂推理或疑难根因排查时升至 `high`。
- **标准输入与任务参数**：`dsh headless` 每次调用执行单个任务后退出。优先使用单独的 `-` 作为位置参数并通过标准输入传入完整任务文本（例如 `dsh headless ... --json - < task.txt`）。不要传入空白位置参数（哪怕标准输入非空，空白位置参数也会直接报错并以退出码 `1` 退出），也不要将 `-` 与其他位置词混写。
- **会话接续（`--session-id`）**：每次默认运行分配新的 `session-<uuid>`，并在 `--json` 首条 `session` 事件中返回。需要多步跟进或修复时，在同一工作目录传入 `--session-id <id>` 并重复显式传入 `--permission-mode`、`--approval-policy` 与所需的 `--add-dir`。`--session-id` 要求目标会话已持久化、当前进程内无同名活动实例、记录的 `cwd` 与当前解析目录一致且 agent preset 兼容；任意不匹配都会在任务运行前报错拒绝。

## 事件采集、成功判据与异常恢复

- **结构化事件流（`--json`）**：使用 `--json` 将标准输出替换为 NDJSON 事件流（标准错误仅保留 `dsh:` 诊断信息）。事件流以 `session`（含 `sessionId`）开始，中间输出已提交步骤的 `status`、`text`、`thinking`、`tool_call` 与 `tool_result`，正常回合结束时输出终端 `final` 事件（含 `sessionId`、`reason` 与未截断的完整最终回复文本）。除 `final` 外，单字段字符串上限为 8 KiB（超长标记 `truncated: true`），单行上限为 32 KiB。日志归档与回传前先脱敏，省略任何凭据、鉴权头、原始 thinking 及无关敏感输出。
- **成功判据**：必须**同时满足**进程退出码为 `0` 且终端 `final` 事件的 `final.reason.kind === "completed"`，才能判定本次 `dsh` 运行完成。回合内失败仍可能输出带非完成 `reason` 的 `final` 事件并以退出码 `1` 退出；回合外或启动期失败则输出 `error` 事件（无 `final`）并以退出码 `1` 退出。注意 `tool_result` 的 `completed` 仅代表工具调用返回，其内部执行的 shell 命令仍可能返回非零退出码；负责人必须独立核对实际 `git diff`、产物文件及门禁命令退出码后才接纳结果。
- **缺凭据、超时与未知写恢复**：
  - **缺凭据或鉴权失败**：当返回 `MISSING_CREDENTIAL`、`INVALID_CREDENTIAL` 或因 `headless` 默认关闭托管凭据而报缺少 API key 时，先核对是否遗漏 `--patch` 叠加层或启动环境中存在遮蔽回退的空环境变量；持久配置写入被宿主拦截时保留拦截事实，使用授权范围内的 `--patch` 临时叠加或报告具体阻塞，不得尝试读取 `.credentials.yaml` 明文或改写宿主权限绕过。
  - **超时、中断与结果未知**：若调用超时或被负责人中断，必须先等待原 `dsh` 进程彻底退出后再决定是否使用 `--session-id` 恢复（进程未退出前重用同一 `sessionId` 会因实例仍在运行而被拒绝）。发生失败、超时或中断后，先在目标工作区回读已产生的 `git status`、`git diff` 与外部目标状态，诊断原因后再由负责人决定继续接续或本地接回修复，严禁盲目重发未知写操作。
