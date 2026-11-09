# 交付与使用指南

本仓库按产品交付 Skills 及必要依赖。安装支持 Codex、DeepSeek Harness (`dsh`) 和 Antigravity CLI。安装计划没有默认产品，只向明确选中的产品交付内容。Codex 与 DeepSeek Harness 接收全局指令 `AGENTS.md`、模型选择政策、调用合同、Rust/SQL 偏好与对应推荐配置片段。本地验证入口覆盖各产品的交付内容。维护入口见 [README 导航](../README.md#维护导航)。执行证据按 [README 执行记录](../README.md#执行记录)绑定实际实例、任务、分支与候选；不继承旧仓库的全局交接。历史设计审查不覆盖后来的实现。

按任务查阅：[阅读与采用](#阅读与采用)列出文档入口，[交付目录](#交付目录)说明源码布局。[产品选择与安装](#产品选择与安装)给出计划、应用与恢复步骤，[验证能说明什么](#验证能说明什么)列出证据边界。各技能的使用说明见本页对应章节。

## 阅读与采用

| 读者与任务 | 当前入口 | 适用范围 |
| --- | --- | --- |
| 在本仓库工作 | [AGENTS.md](../AGENTS.md) → [Codex 规则](../delivery/AGENTS.md) | 先加载 Codex 规则，再读相关使用与维护合同 |
| 维护或审查 Codex 规则 | [Codex 规则](../delivery/AGENTS.md)、[行为场景](../tests/scenarios/rules.md) | 核对现行规则归属、例外和独立推导的预期；场景不是第二份运行规则 |
| 维护产品指令 | [交付目录](#交付目录)、[Codex 规则](../delivery/AGENTS.md)、[产品场景](../tests/scenarios/adapters.md) | 直接维护交付目录的唯一规则源 |
| 组织执行、选择模型路线、安排会话与 Goal，或协作、接续和收尾 | [任务起点](../delivery/policy/models.md#task-start-and-execution-routing)、[模型政策](../delivery/policy/models.md)、[模型场景](../tests/scenarios/rules.md#模型选择与接续) | 由 Codex 规则入口按需加载；衔接需求与授权、工作区选择与绑定、Goal、自主执行、结果接纳及收尾，实际经验见[验证边界](#验证能说明什么) |
| 按任务选用 DeepSeek Harness (`dsh`) | [分工与授权](../delivery/policy/models.md#deepseek-harness-delegation)、[调用合同](../delivery/policy/deepseek-harness.md) | 仅使用本合同定义的 OpenCode Go 或 DeepSeek 官方路由；按能力适配交付完整工作，保留任务边界及验收，不设调用比例 |
| 项目明确采用 Rust 偏好 | [Rust 偏好](../delivery/policy/rust.md)与[代码偏好](../delivery/AGENTS.md#code-preferences) | 依项目明确采用的范围读取 |
| 项目明确采用 SQL 偏好 | [SQL 偏好](../delivery/policy/sql.md)与[代码偏好](../delivery/AGENTS.md#code-preferences) | 按项目采用范围加载 SQL correctness 及其错误处理引用；PostgreSQL 约定仅适用于该数据库，表名遵循[表与模式命名偏好](../delivery/policy/sql.md#tables-and-schemas) |
| 协同设计数据模型 | [代码偏好](../delivery/AGENTS.md#code-preferences)、[SQL 建模偏好](../delivery/policy/sql.md#data-modeling) | 先恢复整体流程与已定职责，再围绕实际未决选择细化；不设固定逐表审批，具体拆分、应用 ID 和类型取值由所属项目记录 |
| 撰写中文或英文文档 | [写作参考](../delivery/policy/writing.md)、[检查脚本](../scripts/check-prose.mjs) | 脚本阻塞中西文空格错误，句长只给出提示；其余由作者判断 |
| 维护按编号引用的表格 | [标识符检查](../scripts/check-ids.mjs) | 同一前缀按出现顺序递增、不重复；跳号允许 |
| 采用能力配置推荐值 | [能力配置](../delivery/capability/README.md)、[Codex 片段](../delivery/capability/codex.toml)、[DeepSeek Harness 片段](../delivery/capability/dsh-headless.patch.yml)、[Rust lint](../delivery/capability/rust-lints.toml) | 全是推荐文本，合并由本人做一次。安装后位于 `${CODEX_HOME:-$HOME/.codex}/capability/` 或 `${DSH_HOME:-$HOME/.dsh}/capability/`。本仓库不写任何产品或消费项目的配置文件 |
| 准备或验证本仓库工具 | [工具说明](tooling.md) | 使用仓库固定工具和锁定依赖；不安装个人配置 |
| 发现项目资料或执行项目检查 | [project-guide](../delivery/skills/project-guide/SKILL.md) | 共享技能；按目标版本发现权威来源与原生检查，报告实际覆盖及缺口；来源与演练边界见[登记](skill-sources.md#project-guide) |
| 维护规则与工具绑定 | [登记维护](tooling.md#仓库登记维护)、[工具调用](../delivery/policy/tool-contracts.md) | inventory、owner 索引和 consumer bindings 各自承担不同职责；只登记已交付能力 |

其他仓库使用这些源码时，项目指令必须明确引用实际位置。复制一个路径名不会使文件自动加载。当前检查保留工具归属和消费者绑定验证。两平台 CI 结果见 [README](../README.md)。安装器提供[计划、应用与恢复](#产品选择与安装)。实际替换个人配置仍必须逐次授权。交付目录只是可检查的候选，不切换个人配置。

公共入口保留动作触发点，详细步骤由链接的权威章节维护。首次编辑进入[工作区规则](../delivery/policy/models.md#workspaces)，最后一次编辑后进入[检查规则](../delivery/policy/review.md#checks)。合并回读和任务收尾仍各自触发对应流程，包括短任务和恢复后的任务。按标题读取当前动作所需正文，复用未变内容；入口变短不免除正文中的前置、例外和恢复要求。

### 规则放置与实施范围

[实施切片规则](../delivery/AGENTS.md#implementation-slices)规定单次实施边界。整体架构的认可不授权实施全部阶段。默认“开始”与“继续”指向当前明确提出的切片。后续选片按[持续交付边界](../delivery/AGENTS.md#continuing-delivery)核对原授权：有效批次内继续，未覆盖时等待选择。每片仍独立完整交付，发布、合并和部署各自核权。验收预期见[小切片场景](../tests/scenarios/rules.md#小切片实施)。

[代码偏好](../delivery/AGENTS.md#code-preferences)区分个人偏好与项目规范。复用的个人 Rust、SQL 偏好保留在交付 `policy/`。项目按需明确采用，入口不复制全文。团队强制规则、业务不变量和验证命令由消费仓库拥有。团队、CI 或托管审查必需的规范必须纳入项目版本控制。项目 AGENTS.md 明确适用范围和权威文件位置，避免依赖作者的个人主目录。

将规范纳入项目时，保留实际采用章节及必需引用。Rust 的数据库错误章节引用 SQL 失败边界，不表示采用全部 SQL 命名偏好。迁入的项目规则在声明范围内由项目维护。个人偏好后续更新不自动覆盖项目决定。本仓库继续提供复用源，不自动迁移或安装到其他项目。

[模型政策](../delivery/policy/models.md)拥有任务组织、执行、验收及收尾的决策。按任务从[任务起点](../delivery/policy/models.md#task-start-and-execution-routing)进入，查阅[工作区](../delivery/policy/models.md#workspaces)、[Goal](../delivery/policy/models.md#goals) 及[收尾](../delivery/policy/models.md#task-completion-and-chat-archival)规则。代码工具的通用绑定见[执行上下文](../delivery/policy/tool-contracts.md#执行上下文)。团队采用仍遵循上述项目内版本化要求。入口引用不等于正文已经加载；安装政策不切换模型或修改客户端配置。

已授权的权限缺口梳理、自动审批附加策略更新和接班，按[策略接续](../delivery/policy/models.md#automatic-review-policy-succession)处理。Goal 与策略的[正文归属及动作映射](../delivery/policy/models.md#goal-and-authorization-content)由同一政策维护；具体实例留在执行材料，原授权限制仍逐次核对。配置写入、会话创建和审批器实际加载分别取证。

[阶段职责](../delivery/policy/models.md#delegation-and-acceptance)拥有委派、缺口核实、交付责任及结果接纳。阶段共用检出与写者交接见[工作区规则](../delivery/policy/models.md#workspaces)。

[Codex 模型偏好](../delivery/policy/models.md#current-defaults)与[外部路线模型偏好](../delivery/policy/models.md#route-model-preferences)分别维护具体模型及档位。创建、续接和变更时的参数及证据要求见[运行限制](../delivery/policy/models.md#runtime-limits)。

[总协调模板](prompts/coordinator.md)提供明确启用时的分工和可选授权文本，采用方法由模板拥有。

[DeepSeek Harness 委派政策](../delivery/policy/models.md#deepseek-harness-delegation)拥有选用、材料授权、服务范围、分工与兜底条件。[调用合同](../delivery/policy/deepseek-harness.md)拥有实际客户端定位、凭据优先级、权限参数、事件流终态核验与异常恢复。本仓库交付这些规则、合同及无密钥配置片段 [`dsh-headless.patch.yml`](../delivery/capability/dsh-headless.patch.yml)；CLI、账号与密钥由使用者提供并托管。该路线未接入 CI 或项目审查关卡，实际演练范围见[验证边界](#验证能说明什么)。

这种分层依据 [Codex 指令发现文档](https://developers.openai.com/codex/guides/agents-md)。Codex 分层加载全局与项目入口，普通政策文件由入口按需引用。[Astra 指令建议](https://developers.openai.com/api/docs/guides/latest-model#instruction-following)强调处理含混或冲突的文件指令。这里据此明确采用范围、规则归属与切片停止点。它们是本仓库的工作约定，不是模型自动保证的行为。

## 本机开发与 Desktop 工具

[模型政策](../delivery/policy/models.md#local-development)拥有开发执行位置。Human 可明确选择当前 Mac 或 SSH 连接的原生 Linux，例如 `dev`。[官方远程连接说明](https://learn.chatgpt.com/docs/remote-connections)描述远程项目的宿主与工具使用。Desktop 窗口在 Mac 上，不表示 SSH 项目的源码和命令也在 Mac。实际宿主、目录和候选仍按本次绑定核实。[Desktop 能力核对](../delivery/policy/models.md#desktop-capabilities)拥有工具选择、证据复用和局部缺口处理。

开发沿所选设备上项目支持的原生环境，不以 VM 或容器为前提。分别验证源码、依赖和实际检查；安装规则不证明 Linux 兼容。macOS 专属客户端及原生或像素验收仍由有相应能力的获准设备完成。[共用执行合同](../delivery/policy/tool-contracts.md#不可信输入的执行)区分已授权可信输入与来源尚未可信的代码。后者先静态读取，只在已验证边界的环境执行。所选设备缺少该边界时沿已有且适用的隔离 CI，保留准确候选、实际运行及未运行项。worktree 或 `workspace-write` 不单独证明敏感文件读取已隔离。

| 能力 | 选择路径 | 核对要点 |
| --- | --- | --- |
| 源码、构建、调试和测试 | 所选设备的命令入口或集成终端，使用项目原生命令 | 实际宿主和目录、固定工具链、候选、原运行句柄及实际输出 |
| 项目与隔离写区 | 实际客户端可用的项目或工作区入口 | 实际宿主、项目、附件、工作树依赖与唯一写者 |
| 会话协作 | 实际客户端和宿主可用的发送入口，或已验证的结果读取路径 | 双方 host/thread、原始授权、唯一写者、结果位置、主动取回者与接纳 |
| 浏览器和桌面验证 | Desktop 浏览器、桌面操作或适任专用工具 | 真实运行的本机页面、可读画面、同版候选及已获准目标 |
| 连接器与专业能力 | 先用适任连接器或 API，再按技能选择本机工具 | 实际执行者的入口、连接状态、必要材料及允许操作 |
| 平台专属验收 | 项目支持的本机原生环境、已有且适用的 CI 或对应客户端 | 实际开发设备、执行边界、准确候选和运行，保留未覆盖的平台与业务行为；其他环境只沿已核实能力与授权选择 |

[官方本地环境说明](https://learn.chatgpt.com/docs/environments/local-environment)提醒，工作树可能缺少未提交到 Git 的依赖和文件。[浏览器文档](https://learn.chatgpt.com/docs/browser)区分 Desktop 与 CLI 的入口。[插件文档](https://learn.chatgpt.com/docs/plugins)另列适用客户端、连接和权限条件。某执行者缺少入口时，按政策安排对应阶段，不判定整个本机缺能力。上表用于选择路径，不是已安装、已登录或行为验收的快照。

### Mac 与 dev 的结果回传

[委派政策](../delivery/policy/models.md#delegation-and-acceptance)拥有结果路径和接纳。[官方跨设备协作规则](../delivery/policy/models.md#official-codex-coordination-across-devices)说明会话选择、宿主权限及接任后的报告目标。分派前核实际 server、会话、目录、候选和唯一写者。界面所在设备不决定任务在哪台机器执行。

[官方远程连接](https://learn.chatgpt.com/docs/remote-connections)让受支持的客户端控制 dev 会话。Mac 作为控制端时，无须同时开启 Mac CLI daemon 的受控主机功能。SSH、显式端点和 Remote Control 分别核实；它们可能连接同一后台。配对成功后，另核实际打开的会话及执行目录。Mac 原有本地会话仍归原 server。

#### dev 主协调与 Mac 本地协调示例

仅在明确采用这项分工时，由 dev 持总体安排、阶段条件及原始句柄。若原始授权覆盖 Goal，由 dev 主协调设置并回读完整目标。Mac 本地协调负责已分配的设备专属阶段。两端按各自操作范围准备审批政策；若新会话依赖获准更新的 `auto_review.extra_policy`，先写入并回读，再核新会话的实际配置。保存结果不能代替真实 reviewer 的输入或决策。

要求 Mac 和 iPhone 都能接任或继续时，使用 dev 官方 app-server 上的官方交互会话。可从支持显式端点的交互 CLI 连接原 Unix socket；实际端点、权限及沙箱审批按本机核对。用同一会话 ID 在要求的客户端打开并验证继续入口。`codex exec` 适合后台任务。即使能按 ID 接续，也不能据此保证会话进入手机普通列表。

| 方向 | 入口与读回 |
| --- | --- |
| dev 派单，Mac 领取 | 用双方可达的既有任务或 PR 记录安排；Mac 本地负责人读原任务并确认领取。dev CLI 不以 Remote Control 设备标识直发 Mac 本地会话。 |
| Mac 回报 dev | 若 App 提供已验证的发送入口，Mac 本地会话向现任协调者的实际 host 与会话 ID 主动报告。核原目标实际收到，负责人再读证据并接纳。 |
| dev 工作会话回报 | 在同一 server 使用已授权且已核对目标的原生队列或既有结果路径。[官方 CLI 说明](https://learn.chatgpt.com/docs/cli/reference)列出 `codex queue` 与 `--remote`；[开发命令说明](https://learn.chatgpt.com/docs/developer-commands?surface=cli)说明 `--resume` 失败可能仅警告。入队、接续、送达和接纳分别确认。 |

离线时在约定入口保留就绪或阻塞结果。恢复后先读最新有效指令、候选与原句柄，再补报；未知发送先回读原目标。正式接任经两方确认后，更新约定入口中的现任 host 和会话 ID。在途操作保留原目标与观察者。会话打开、CLI 退出或 daemon 在线不证明模型继续推进。

[官方会话 handoff](https://learn.chatgpt.com/docs/remote-connections#hand-off-a-chat-between-hosts) 会移动会话和 Git 状态，并打断活动回合。日常跨端控制、报告送达和负责人接任分别验收。静态规则检查不证明这些真实行为。

## 微信项目配置、DevTools 初始化、编译、诊断、预览、项目列表、自动化、云开发与安装诊断

[wechatide](../delivery/skills/wechatide/SKILL.md) 从[实际交付索引](../delivery/skills/wechatide/references/capabilities.md)路由九个子入口并核验返回：

- **本地配置与安装诊断（无需启动 DevTools）**：[project-config](../delivery/skills/wechatide/skills/project-config/SKILL.md) 按[字段规则](../delivery/skills/wechatide/skills/project-config/references/fields.md)读取与合并本地 JSON 配置，不触发项目 hooks；[installer](../delivery/skills/wechatide/skills/installer/SKILL.md) 仅在执行器报 `cli-unavailable` / `cli-unbound` 或用户明确询问安装状态时调用只读 `check-install.mjs`，诊断十二类安装与 `PATH` 状态，不自动下载、安装或修改 `PATH`。
- **DevTools CLI 执行与业务子入口（仅限 macOS）**：[initializer](../delivery/skills/wechatide/skills/initializer/SKILL.md)、[compiler](../delivery/skills/wechatide/skills/compiler/SKILL.md)、[debugger](../delivery/skills/wechatide/skills/debugger/SKILL.md)、[previewer](../delivery/skills/wechatide/skills/previewer/SKILL.md)、[project-manager](../delivery/skills/wechatide/skills/project-manager/SKILL.md)、[automator](../delivery/skills/wechatide/skills/automator/SKILL.md) 与 [cloudbase-operator](../delivery/skills/wechatide/skills/cloudbase-operator/SKILL.md) 统一经[调用执行器](../delivery/skills/wechatide/scripts/call.sh)与 [CLI 合同](../delivery/skills/wechatide/references/cli.md)（适配 DevTools `2.02.2610302` / 技能 `0.3.15` skill-call 路线，固定客户端名 `ClaudeCode`、`Codex`，不读取钥匙串或注入 Token；登录与客户端授权按[异步任务](../delivery/skills/wechatide/references/tasks.md)有界轮询）。对外发布（`upload`、`share_minicode`）、运行态改动（`automation_wx_api`、`debug_clear_cache`、`automation_evaluate`）及六项云开发写操作均须用户针对具体目标单独确认；未知写结果先读回核实，不盲目重发。

十个入口均为验证成员，安装成员只有顶层 `wechatide`（上游 `0.3.15` 新增的 `simulator` 入口及未登记别名仍拒绝）。来源与实测边界见[来源记录](skill-sources.md#wechatide)（本机已实测客户端授权、只读状态、云开发 `-h` 与 `check-install.mjs`，其余开窗、编译、自动化、预览上传与云端读写由离线假 CLI 回归与下列静态场景覆盖）：

- [本地配置](../tests/scenarios/rules.md#wechatide-顶层与本地配置)
- [初始化](../tests/scenarios/rules.md#wechatide-devtools-初始化)
- [编译](../tests/scenarios/rules.md#wechatide-编译与刷新)
- [诊断](../tests/scenarios/rules.md#wechatide-诊断)
- [预览](../tests/scenarios/rules.md#wechatide-预览与上传)
- [项目列表](../tests/scenarios/rules.md#wechatide-项目列表与代码片段)
- [自动化](../tests/scenarios/rules.md#wechatide-页面自动化)
- [云开发](../tests/scenarios/rules.md#wechatide-云开发)
- [安装诊断](../tests/scenarios/rules.md#wechatide-安装诊断)

## 阿里云技能发现

[alibabacloud-find-skills](../delivery/skills/alibabacloud-find-skills/SKILL.md) 已交付给 Codex、DeepSeek Harness 与 Antigravity CLI。它适用于明确的阿里云技能发现请求，或已确认的能力缺口。已有匹配能力时直接使用。不要从普通阿里云关键词启动发现。

入口负责需求拆分、搜索选择、互补技能和结果交接。[HTTP 参考](../delivery/skills/alibabacloud-find-skills/references/agentexplorer-api.md)拥有请求形式。[验证参考](../delivery/skills/alibabacloud-find-skills/references/verification-method.md)拥有响应和分页判据。[安装参考](../delivery/skills/alibabacloud-find-skills/references/installation.md)区分下载、安装与后续使用。[示例](../delivery/skills/alibabacloud-find-skills/references/search-examples.md)仅说明选择方法。来源、原件摘要和退役依据见[来源记录](skill-sources.md#alibabacloud-find-skills)。

执行证据定位见 [README 执行记录](../README.md#执行记录)。本地门禁与[静态场景](../tests/scenarios/rules.md#阿里云技能发现与操作边界)仅验证结构与静态预期，不证明 AgentExplorer 线上兼容、模型行为或个人安装已生效。

## 交付目录

[delivery](../delivery/README.md) 是共享源码根，内部相对引用在各产品部署后保持不变。交付模块明确选择每个产品的成员。`AGENTS.md` 是直接维护的 Codex 规则入口，按需正文由 `policy/` 中各文件拥有。工具由 `scripts/bundle-tools.ts` 生成到同一目录。安装器按清单复制文件与完整顶层技能目录，安装后的副本独立于备份和快照。修改交付内容后运行完整门禁，分别检查仓库引用、交付目录引用和隔离安装行为。

## 日常开发与工具操作

普通实现、计划、审计、审查可直接提出任务。文档编辑和重命名也一样。它们不要求通用流程技能、tier 或交接模板。授权范围内连续完成本地准备、修改与验证。项目明确要求的审查和外部操作权限仍有效。

- [Codex 规则](../delivery/AGENTS.md)保留沟通、操作边界和代码偏好。
- [模型政策](../delivery/policy/models.md)拥有模型选择、工作区寿命、协作分工、委派验收、接任及归档要求。
- [写作参考](../delivery/policy/writing.md)保留来源、现行与历史区分。它也保留删除、合并和双语句子规范。
- [工具约束](../delivery/policy/tool-contracts.md)按需说明 Git/SSH 和常用命令。
- 审查与合并准入的通用责任由[共享审查规则](../delivery/policy/review.md)拥有。项目声明平台强制条件、审查流程承担的条件及接受的限制。agents main 当前采用[重建期项目约定](review-gate.md#重建期交付规则)，由其规定检查、审查和普通合并条件。审查阶段仍复用有效覆盖并处理发现，推送 PR 修复前先检查并核对 diff。
- [gh](../delivery/skills/gh/SKILL.md) 及[操作参考](../delivery/skills/gh/references/operations.md)负责 GitHub 命令和操作。已安装且经核验的身份合同仍是前置，不得从命令示例推导权限。

当前成员与产品归属以[清单](../config/personal-skills.txt)为准。旧流程技能只保留历史来源，不继续安装。写作和工具参考属于公共 `policy/` 路径的成员。安装来源与限制见[安装快照过渡](#既有安装快照过渡)。

[gh 的工作流合同](../delivery/skills/gh/references/workflow-authorization.md)拥有目标、修复范围及审查请求授权。先核实[受限的依赖更新豁免](../delivery/policy/review.md#dependency-updates)与[纯原生 Sketch 设计稿豁免](../delivery/policy/review.md#pure-sketch-design-slices)，保留适用检查和合并边界。可信自动化提交的低风险清单／锁文件更新，以及已采用该例外的项目中经机械与本机独立验收核实的纯 `.sketch` 设计稿切片适用例外。人工依赖更新、主版本升级、混入可执行或越界改动的切片及资格未知项走正常审查。仍需 AI 审查时，常规提供方与 Cubic 额度不足时的替代由[提供方选择](../delivery/policy/review.md#review-provider-selection)统一维护。选定方按[触发合同](../delivery/skills/gh/references/operations.md#automatic-review-and-feedback)显式 `@` 请求。已有有效覆盖或请求时复用；不要依赖 PR 事件自动触发。[共享观察规则](../delivery/policy/review.md#asynchronous-observation)拥有异步等待与观察恢复边界。限定发现清单与限定修复范围分别处理，已有授权内的新缺陷继续修复。[gh-identity 源码入口](../delivery/skills/gh-identity/SKILL.md)负责 `headironc` 的身份就绪与认证恢复；历史凭据与安装状态见[安装快照过渡](#既有安装快照过渡)。

## 规则与技能维护

公共规则拥有跨任务约束和代码偏好。工具拥有服务权限、调用参数、错误与恢复合同。规则变更同步实际消费者、产品生成物和适用场景。静态检查、实际模型行为和候选审查分别报告。Rust 偏好支持迭代期增量 `cargo check -p <package>` 与定向单测，在发布前执行逐包构建与完整门禁；SQL 偏好支持清晰的复合 `snake_case` 复数表名（如 `order_items`）。Rust 与 SQL 偏好只适用于明确采用它们的项目。

工具技能按完整单元交付。入口、引用、必要资产、执行器、测试与许可证共同验收。来源记录保留原件身份和采用范围。跨技能调用使用可用安装名。内部引用从物理安装目录解析，保持完整可达。清单决定成员与产品，不授予业务权限。新增入口同步登记、反例与完整门禁。不得删减清单来绕过缺失能力。

合并遵循目标项目的有效合同（本仓库采用[重建期规则](review-gate.md#重建期交付规则)，其他目标按[通用合并准入规则](../delivery/policy/review.md#merge-admission)核对）。已采用的上游工具不为统一语言而改写；无实际调用方的历史脚本不自动恢复；实际服务、模型与个人安装分别取得授权并回读。

## 任务临时目录与收尾

[生命周期](../delivery/policy/models.md#task-temporary-directories)拥有任务临时资源的归属和收尾责任。[调用合同](../delivery/policy/tool-contracts.md#task-temp)拥有参数、清理边界及错误处理。入口随各产品工具交付，不安装定时任务或个人配置。以下命令从仓库运行；安装后把工具路径换为产品根下的 `tools/task-temp.mjs`，并使用兼容 Node。

```bash
.cache/agents-tools/bin/node delivery/tools/task-temp.mjs run \
  --owner task-example --purpose fixture-validation -- \
  .cache/agents-tools/bin/node -e 'console.log(process.env.TASK_TEMP_DIR)'

.cache/agents-tools/bin/node delivery/tools/task-temp.mjs scan --root /tmp
.cache/agents-tools/bin/node delivery/tools/task-temp.mjs scan \
  --root "${CODEX_HOME:-$HOME/.codex}/worktrees"
```

run 保持原工作目录，只清理本次分配的 scratch 及归属目录。前台命令须等待全部后代结束，并使用工具提供的临时路径。正常非零退出也清理；诊断原件先输出或写到目录之外。中断、Git 元数据、归属变化和检查失败留下路径及原因，任务收尾继续核实。扫描只列直接子目录和可读归属，无法判断会话是否结束或目录是否可删。历史目录不补标记、不删除。工具不接管已有测试工具的清理，也不代替客户端 worktree 退役。

[工作区规则](../delivery/policy/models.md#workspaces)限制每个会话最多拥有一个源码实施 worktree。第二个独立实施工作树交给另一个获授权会话。恢复原绑定及测试内部自行创建并清除的 Git fixture 不计作新增实施工作树。这是代理行为约束；扫描工具不提供跨会话配额拦截。有限模型演练见[验证边界](#验证能说明什么)。

触发入口在 [AGENTS.md](../delivery/AGENTS.md#working-together)。单人单会话开发默认直接在当前已核实的主检出（Primary checkout）与特性分支写入；仅在并发多会话写入、存在冲突 WIP、隔离实验性 spike 或明确要求隔离时，才按[工作区规则](../delivery/policy/models.md#workspaces)分配独立 worktree 并核对编辑工具实际指向的目录。最后一次编辑后，由作者回读并运行[适用检查](../delivery/policy/review.md#checks)。只读调查沿用 Local；已有写入绑定按续作规则核对。

直接建临时目录或运行会生成目录的命令前，加载临时目录合同。命令退出时核清理结果；中断恢复时先核已知目录及原操作。获授权的合并流程确认 PR 已合并后，立即进入[工作树和分支清理](../delivery/skills/gh/references/operations.md#post-merge-cleanup)。恢复后确认由他人完成的合并也走同一入口。报告完成、交接或归档前，由收尾章节核资源去向。普通进度回复不触发在用工作区退役。已读规则和未变绑定沿用，不逐轮重读或扫描整机。

合并后清理覆盖该 PR 独占的 worktree 及对应本地、远端分支。客户端预建的任务工作树同样纳入核对。工作树退役后，确认本地分支没有被其他 worktree 使用，再核对分支头并删除。主工作区、共享资源、变化后的分支头和在用材料按合同保留。队列受理、未知结果或关闭未合并都不触发删除。各项清理分别回读，已由平台移除的目标只核缺失。保留项在最终结果中说明所有者、原因和下一清理条件。

仓库源码和无模型加载检查不代表个人环境已生效。发布安装并回读后，新会话才能从对应安装入口读取候选规则。已有会话沿实际已加载版本核对。客户端在首轮之前创建目录的动作，无法由尚未加载的模型规则预先拦截。真实触发仍通过获授权的模型场景演练确认。

## 工具偏好

[依赖规则](../delivery/AGENTS.md#code-preferences)要求先查看适合目标仓库的现成工具库，包括 npm 生态。它还要求核对已有依赖、维护证据、官方文档和实际契约。已有标准库或项目依赖能合适地提供能力时，优先复用它们。

[维护工具语言偏好](../delivery/AGENTS.md#code-preferences)面向新写工具，默认选择 TypeScript。它服从目标仓库明确的语言和运行环境要求。它不要求迁移已有工具或改写业务代码。本仓库另有几项固定选择，由 [AGENTS.md](../AGENTS.md) 单独规定。选择包括固定 Node、Bash 下载启动器。上游 Python 工具也保留。

## 产品选择与安装

安装器已交付 plan、apply、verify 和 rollback。plan 必须至少传入一个 `--product`，值为 `codex`、`dsh` 或 `antigravity`。重复该参数可明确选择多个产品；没有默认双端安装。缺少选择、无效值或重复产品均返回参数错误，不创建计划。旧 `--include-product` 参数及已退役的 `claude` 产品名不再接受。在候选源码上完成构建和完整门禁后生成 V7 计划。未提交改动由门禁报告的源码身份绑定：

```bash
umask 077
.cache/agents-tools/bin/bun run build:install
mkdir -p .cache/reports
bash scripts/check.sh all --report .cache/reports/check.json
bash scripts/install.sh plan --product codex --source "$PWD" --report .cache/reports/check.json \
  --output /path/outside/checkout/agents-plan.json
```

上例只选择 Codex。改为 `--product dsh` 或 `--product antigravity` 可单独选择另一产品。两端安装使用 `--product codex --product dsh`；三端安装再加 `--product antigravity`。计划只记录选中产品的根，并仅核对这些产品的变量和目标。未选产品的目录、权限和既有安装保持原状；无效的未选产品变量也不阻止计划。

DeepSeek Harness（`0.2.2-rc.1` 实测）的 `desktop` 与 `headless` 两个 profile 共同继承 `@deepseek-ai/dsh-base`，默认启用 `@deepseek-ai/dsh-agent-instructions`、`@deepseek-ai/dsh-skill`、`@deepseek-ai/dsh-skill-filesystem` 和 `@deepseek-ai/dsh-tool-skill`，并共享用户主目录 `${DSH_HOME:-$HOME/.dsh}`。全局指令按固定顺序先读取 `${DSH_HOME:-$HOME/.dsh}/AGENTS.md`，再读取 `${DSH_AGENTS_HOME:-$HOME/.agents}/AGENTS.md`（正文去首尾空白相同则去重），随后按从 Git 根到当前工作目录（`cwd`）由浅入深读取项目级 `AGENTS.md`、`CLAUDE.md`、`AGENTS.local.md` 与 `CLAUDE.local.md`（总上限 64 KiB；全局级不读取 `CLAUDE.md`）。技能发现按单层 `<root>/<name>/SKILL.md` 或 `<root>/<name>.md` 扫描（跳过 `.` 开头隐藏目录，单文件上限 256 KiB），优先级由高到低为：项目 `<projectRoot>/.dsh/skills`（`100`）> `<projectRoot>/.agents/skills`（`200`）> 自定义 `customSkillDirs`（`300`）> 用户级 `${DSH_HOME:-$HOME/.dsh}/skills`（`400`）> `${DSH_AGENTS_HOME:-$HOME/.agents}/skills`（`500`）> 内置技能目录（`600`）。因此 `--product dsh` 直接将规则与技能安装到 `${DSH_HOME:-$HOME/.dsh}`，桌面端与 `headless` 共享同一安装位置且无须额外开关即可自动加载指令与技能；用户原有的 `.credentials.yaml`、`.anonymous-user-id`、`profiles/`、`sessions/`、`storages/` 和 `attachments/` 保持原样。

Antigravity CLI 的目标根固定为 `$HOME/.gemini/antigravity-cli`，只发布下表成员。安装器不创建 Plugin，也不写 `settings.json`、发现 manifest、hooks、MCP 或规则入口。该根的 `skills/` 由 CLI 自动发现，App 不读取。已有 CLI 专属或共享目录中的同名技能可能影响优先级；实际来源通过 `/skills` 核对，见[官方发现规则](https://antigravity.google/docs/customization-discovery?tab=cli)。

仅更新部分受管目标时，重复传入 `--target KEY` 指定完整目标集合。KEY 与下述接管名称相同，例如 `--target codex:policy/review.md --target codex:gh`。选择接受已选产品的受管文件和完整技能目录，拒绝重复、未知名称及技能内部文件路径。技能目录沿用完整备份、替换、回读和回滚，不拆分安装内部成员。未传时沿用整批计划。`--target` 不替代 `--adopt`；已有差异目标仍须明确接管。调用者按当前任务核对完整依赖，安装器不自动加入其他目标。未选目标不读取内容、不要求接管，也不修改权限。完整源码检查与冻结快照仍覆盖原候选。

目标选择写入计划的 `selectedTargets`，并与实际目标集合严格匹配。apply、verify 和 rollback 均只处理计划目标。`status` 同时展示该选择，不把部分交付称为整批安装。旧 V5/V6 计划没有该字段时保持原语义；不支持所选目标的旧安装器会拒绝计划，恢复使用本计划绑定的运行副本。

报告必须来自同一平台和固定 Node 的完整通过的 `all`。检出 HEAD 必须等于报告基线，源码字节必须与报告一致。计划记录本机稳定标识：Linux 取 `/etc/machine-id`，macOS 取 `sysctl -n kern.uuid`。取不到即拒绝。apply、verify、rollback 均核对该标识。主机名变更只在 verify 中报告。报告绑定的被忽略文件同样阻止计划。

运行目录位于 `${XDG_STATE_HOME:-$HOME/.local/state}/agents/deploy/<run-id>/`，保存计划与回执。V7 的候选和恢复运行副本位于同一状态根的 `agents/install/<run-id>/`，独立于产品目录。计划另在 `--output` 写出同字节审阅副本。计划不写公开目标内容。为核对文件系统的大小写别名和共享祖先，会建立选中产品缺失的根及祖先。计划成功后保留这些目录和私有安装器目录。规划阶段准备的根不列入 apply 创建的目录，rollback 保留这些根。计划失败时只清理本次建立的目录；祖先仍为空时才移除。既有目录及权限保持原状。

已有链接，包括指向旧部署快照的链接，都必须用 `--adopt KEY` 显式接管。悬空链接、普通文件和已有目录同样如此。接管文件或目录时，目标及目录成员必须由安装用户拥有。复制备份无法恢复其他用户的所有权，计划会报告 `backup-owner-unrestorable`。已交付内容与新候选完全一致时列为不变。KEY 见[安装目标](#安装目标与接管)。未列入清单的名称只以路径列在 `reported` 中；安装器不读取其内容。

新入口同时接受 V5 双端、V6 三端与 V7 显式选择记录。V5/V6 保留原先的产品集合及 Codex 根下的 `.agents-install/<run-id>/` 恢复路径，不迁移或扩大旧记录。V5 不推导第三端目标；各版本回执与计划版本一致。公开目标为普通文件或完整技能目录。入口拒绝 V4 及更早版本的 apply、verify 和 rollback，不转换记录或清理旧材料。原 V4 运行副本和必要材料仍在时，可用原回执提供的恢复命令。`status` 不识别这些旧回执；部署目录中仍有旧回执时报告 `indeterminate`，并在 `unreadable` 中列出路径。这一限制在新目标验证通过后仍存在。

参数错误返回 2。缺口以 JSON `gaps` 输出并返回 1，此时不建立运行目录。源、报告、根目录与目标的读取问题也列为缺口。候选目标超出记录大小限制时报告 `source-unreadable`。权限问题同样一次列出。计划写入中途失败只删除本次创建的运行目录、私有候选和审阅副本。新建上级目录仅在仍为空时删除。

逐项审阅计划并确认个人配置授权后应用。应用结果和回读都记录在运行目录的回执中：

```bash
bash scripts/install.sh apply --plan /path/outside/checkout/agents-plan.json
bash scripts/install.sh verify --receipt RUN/deployment-receipt.json
bash scripts/install.sh rollback --receipt RUN/deployment-receipt.json
bash scripts/install.sh status
```

仓库入口先核验私有 `runtime/node` 与 `runtime/install.mjs`，再交给该副本执行。检出删除后，可直接运行 JSON 输出 `recovery` 中的命令。apply 与 rollback 持有部署根下的 `.install.lock`。锁被占用时拒绝，不自动清除旧锁。前置检查不通过时输出 `refused` 与 `problems` 并返回 1。此时回执与公开目标都不改变。同一计划只应用一次。

应用前整体核对计划中全部产品的目标，任一缺口都在首次目标写入前拒绝。应用过程中逐个替换目标。目录目标通过同级暂存和两次重命名切换，可能短暂不可见。客户端也可能看到新旧混合的指令和技能；应暂停计划涉及的使用会话。每步先备份和回读，再记录待应用步骤。任一端失败时跨全部选中产品逆序恢复仍匹配的目标；第三方改动或无法确认归属的临时项会保留并报告不完整。rollback 同样只恢复仍匹配的目标和本次创建的空目录，冲突时可处置后重试。verify 核对已安装或已回滚的结果。结果中 `directories.pending` 不为 0，说明计划目录已存在，但回执未记录由本次创建。工具保留它供核对。备份、计划、候选和回执在回滚后保留。

全为 `unchanged` 的运行没有替换步骤。对其 rollback 会把回执标为 `rolled-back`，但原有目标仍在。若无其他已安装回执，`status` 将返回 `none`。这不是卸载入口。

Codex 的 [Antigravity 使用支持](../delivery/policy/antigravity.md)保留安装、技能发现及使用者直接操作 CLI 的说明。其他 agent 的调用入口、委派和模型路线已移除。原有安装目标及旧 V5/V6 记录的验证和恢复保持不变。

### 安装目标与接管

所有公开目标直接保存内容。技能安装完整顶层目录，内部引用从该目录解析。固定类别与技能清单共同决定目标，不按历史数量验收。

| 目标类别 | 安装位置 | 候选来源 |
| --- | --- | --- |
| 指南 | `${CODEX_HOME:-$HOME/.codex}/README.md` | `delivery/README.md` |
| Codex 按需参考 | `${CODEX_HOME:-$HOME/.codex}/policy/{writing,tool-contracts,review,rust,sql,models,deepseek-harness,antigravity}.md` | `delivery/policy/` 对应八个文件 |
| 工具 | `${CODEX_HOME:-$HOME/.codex}/tools/<name>.mjs` | `delivery/tools/` 打包产物 |
| 推荐配置 | `${CODEX_HOME:-$HOME/.codex}/capability/<name>` | `delivery/capability/` 对应四个文件 |
| Codex 指令 | `${CODEX_HOME:-$HOME/.codex}/AGENTS.md` | `delivery/AGENTS.md` |
| Codex 技能 | `${CODEX_HOME:-$HOME/.codex}/skills/<name>` | `delivery/skills/` 清单选出的顶层技能目录 |
| DeepSeek Harness 按需参考 | `${DSH_HOME:-$HOME/.dsh}/policy/{writing,tool-contracts,review,rust,sql,models,deepseek-harness}.md` | 同一份 `delivery/policy/` 七个适用文件 |
| DeepSeek Harness 工具 | `${DSH_HOME:-$HOME/.dsh}/tools/<name>.mjs` | 同一份 `delivery/tools/` 打包产物 |
| DeepSeek Harness 推荐配置 | `${DSH_HOME:-$HOME/.dsh}/capability/{README.md,dsh-headless.patch.yml,rust-lints.toml}` | 同一份 `delivery/capability/` 适用配置片段 |
| DeepSeek Harness 指令 | `${DSH_HOME:-$HOME/.dsh}/AGENTS.md` | `delivery/AGENTS.md` |
| DeepSeek Harness 技能 | `${DSH_HOME:-$HOME/.dsh}/skills/<name>` | 清单选择 `dsh` 的完整顶层目录 |
| Antigravity CLI 按需参考 | `$HOME/.gemini/antigravity-cli/policy/{writing,tool-contracts,review}.md` | 同一份公共合同，由技能引用 |
| Antigravity CLI 工具 | `$HOME/.gemini/antigravity-cli/tools/<name>.mjs` | 同一份打包工具 |
| Antigravity CLI 技能 | `$HOME/.gemini/antigravity-cli/skills/<name>` | 清单明确选择 Antigravity 的完整顶层目录 |

Codex 交付八个完整顶层技能包，十七个内容入口参与验证。DeepSeek Harness（`dsh`）接收其中七个共享包、十六个内容入口。`figma-design-workflow` 依赖 Codex 的模型路线与负责人验收，仅交付给 Codex。`sketch-native` 依赖 macOS 原生 Sketch 与内置 MCP 服务，仅在 macOS 上向 Codex、DeepSeek Harness 和 Antigravity CLI 安装，非 macOS 平台自动跳过。wechatide 的九个子入口由父入口按相对链接路由，符合 DeepSeek Harness 单层 `<root>/<name>/SKILL.md` 发现规则。DeepSeek Harness 同时接收 `AGENTS.md`、七份政策、三个打包工具及三份配置片段（不含 Codex 专属的 `README.md`、`policy/antigravity.md` 和 `capability/codex.toml`）。配置片段合并到产品配置由本人完成。

Antigravity CLI 接收 `gh`、`gh-identity`、`project-guide`、`alibabacloud-find-skills` 和 `alibabacloud-sms-send-short-message`。macOS 另交付 `sketch-native`，共六个顶层包及六个入口；其他平台保持五个包。配套依赖为三份公共合同和三个工具，不接收 Codex 规则、模型路线、Figma 设计工作流或配置片段。wechatide 的执行器只接受上游固定的 `Codex` 与 `ClaudeCode` 客户端枚举，不向 Antigravity 发布。清单支持按固定顺序列出 `codex,dsh,antigravity` 的子集；`shared` 表示 Codex 与 DeepSeek Harness，不自动扩张。

Codex 与 DeepSeek Harness 的默认部署根分别为 `${CODEX_HOME:-$HOME/.codex}` 和 `${DSH_HOME:-$HOME/.dsh}`。选择 Antigravity CLI 时使用上述固定根。备份根为 `${AGENTS_BACKUP_ROOT:-${XDG_STATE_HOME:-$HOME/.local/state}/agents/backups}`。计划记录选中产品的物理根、变量来源和祖先身份。任何两个选中产品根相同或互相包含时拒绝。产品根与部署记录、备份或审阅副本重叠时同样拒绝。源码只允许位于选中 Codex 根的 `worktrees/` 子目录内，或在所有选中产品根之外。源码仍须通过 Git 检出和完整报告身份核对。实际公开目标不得覆盖源码、私有候选或恢复运行副本；物理路径检查也保留这些边界。Antigravity 接管 KEY 使用 `antigravity:gh` 或 `antigravity:policy/review.md` 等产品限定名称。

adopt KEY 必须包含产品前缀。技能使用 `codex:gh` 或 `dsh:gh`；其他成员使用 `codex:AGENTS.md`、`dsh:policy/writing.md` 等相对路径。一个 KEY 只接管对应产品的目标。裸技能名、未知、未选产品或未使用的 KEY 均拒绝。任一选中产品的根、权限或接管缺口阻止整个计划。清单外名称仅报告，保留原值。

### 安装记录与恢复边界

报告只证明已记录的检查，不授予安装权限。候选绑定源码字节、完整报告与固定运行副本。复制前后及计划冻结时均核对身份。候选冻结后不原地更新。私有运行副本包含固定 Node、安装 bundle 和许可证。V7 由状态目录承载恢复，单产品安装也不依赖其他产品根。V5/V6 仍依赖记录中的 Codex 私有目录。公开内容不依赖恢复目录，恢复命令依赖该目录。缺失、损坏或平台不符时拒绝，不联网修复。

持久计划是恢复依据，审阅副本只是同字节副本。应用前核对同次持久计划，再把其身份写入回执。审阅副本随后缺失不影响 verify 或 rollback。持久计划损坏、移动或被链接替换时拒绝。工具不扫描其他运行来猜测替代记录。计划与回执字段由 `scripts/install-records.ts` 唯一定义。结构验证不替代主机、路径与当前目标核对。

每步核对 before，保存备份，再写回执并替换。回执写入失败时停止后续写入。普通文件与目录都使用同级暂存；已有目标先改名让位，再安装新目标。这不保证多项同时切换，也不是断电事务。锁只协调同一状态根下的本安装器，不能阻止其他程序或使用不同状态根的安装器写入。

中断恢复逐项读取实际状态，不只相信阶段标记。目标仍为 before 时视为未改变。目标等于本次写入时才恢复，其他内容保留。若中断发生在原目标让位后，且让位项仍精确匹配 before，回滚先恢复公开目标。暂存项仍保留，并报告恢复不完整。有冲突时继续恢复其他可恢复目标，并报告不完整。回滚不依赖候选源码完好，但依赖持久记录、备份与私有运行副本。若 before 是旧快照链接，回滚后的链接仍依赖原快照。清理旧快照前，应先建立安装前状态为直接目标的新基线。旧锁须先核实来源，不自动抢占。临时项的路径和内容不足以证明创建者；回滚保留无法确认归属的残留并报告不完整，核对后由本人清理并重试。运行副本依赖当前主机系统库，不保证跨平台恢复。

安装测试独立列出目标，不从计划输出生成预期。测试覆盖旧链接接管、目录接管、漂移、故障、中断、冲突，以及移走候选快照和检出后的回读与恢复。真实安装后仍须核对文件、完整技能目录、工具入口及客户端加载。未实际验证的产品保持未验证。

## 既有安装快照过渡

自研会话客户端、合同和专属审批片段已退出新交付。新计划只报告现存的清单外文件，不接管或卸载。旧计划继续通过其绑定的安装器和原恢复材料读回与恢复。退役不改写旧计划、回执、恢复快照或会话记录。

逐台安装状态由部署记录拥有。每次运行的 `deployment-plan.json` 记录主机标识与源基线，`deployment-receipt.json` 记录逐目标结果。V5/V6/V7 运行目录均位于 `${XDG_STATE_HOME:-$HOME/.local/state}/agents/deploy/<run-id>/`。`install.sh status` 从最新成功的受支持计划读取候选摘要与基线提交，并把基线提交与当前检出的 HEAD 比较。V7 的 plan、apply、verify 和 rollback，以及新入口的 status，通过 JSON `products` 展示实际产品集合。计划的 `roots` 中仅记录选中产品的根，由这些根唯一拥有该选择。旧运行副本保持原有输出格式。未提交改动的实际交付字节由 `candidate.sha256` 标识；`checkout.commit` 只表示基线。状态核验本机、恢复运行副本和该计划的每个目标，不读取候选源码。无法读取或不受支持的回执、较晚的未完成运行或核验缺口会使结果为 `indeterminate`。新计划不卸载未选产品的既有安装；status 只证明当前计划的目标，未被该计划列出的旧成员保持原样。合并源码不会自动更新已安装目标。

个人安装形态只有一种，没有 managed 模式或 bot 入口目标。`~/.agents/github-app/` 不在安装范围内，本地 bot 凭据提供器已退役。个人安装不交付 App 私钥或本地令牌签发入口。旧项目审查关卡及其签发入口已移除，不属于当前源码或个人安装目标。

bot 退役之前生成的回执，其 rollback 不再是可用退路。这些 rollback 会试图恢复已被删除的 bot 入口。没有链接指向的旧运行同样不是活动来源；是否仍有旧记录，以实际清理状态为准。

文件与技能目录回读不证明新产品会话能正确加载指令和技能。以实际会话核验为准；已运行的会话保留已加载的指令。

实际任务中，从当前环境定位已安装入口。可使用技能目录或可用技能清单，并确认入口可读。仓库的 `delivery/` 是交付源码，不是当前个人安装。缺失入口只阻止相应动作，不得据此改写快照或安装目标。

## 本机协作提醒

协作提醒是独立的周期性检查配置，不随源码或个人规则安装交付。启用状态、检查范围和周期以对应自动化的回读为准；内容源不证明当前环境已启用。不要为跟踪某个任务、PR 或检查运行至完成创建 automation。当前协作沿上文的结果读取路径推进，不依赖定时提醒。

主协调活跃时仍使用有界等待。跨回合恢复时，先读取最新用户指令和原任务，再读取当前负责人及候选的结果。`wait_threads` 提供紧凑状态和游标；具体证据缺失时再深入历史。任务、PR 和聊天记录继续拥有事实，提醒提示不复制旧批次流水账。

协调者按[协作政策](../delivery/policy/models.md#delegation-and-acceptance)消费结果。运行中的负责人继续原任务，已处理的事件不触发重复派工或催办。发送结果未知时，先回读同一目标，再决定恢复动作。同一负责人继续原职责无需重复接受；责任转移保留接收者的明确接受证据。接纳、完成通知与归档按[收尾规则](../delivery/policy/models.md#task-completion-and-chat-archival)执行。

持续监控范围和停止条件由当次有效授权确定。没有未完成授权任务，或状态未变且无需动作时，提醒安静结束本次检查。主协调只报告实质进展、完成、失败或所需决定。已完成任务保持结束状态，提醒不产生新工作或新的操作权限。

本地调度依赖电脑开机、应用运行。计划周期不是最大响应时限。状态查询与发送并非一个原子操作，连续唤醒不保证任意并发或故障下严格只执行一次。[官方定时任务说明](https://learn.chatgpt.com/docs/automations?surface=app)描述产品能力。

历史提醒部署和文档审查属于旧环境记录，不随内容源交付，也不证明其他机器已启用。

## 验证能说明什么

本节界定本地门禁、无模型加载检查、历史有界演练与真实实例验收之间的证据边界；实际平台保护与运行证据按[实例与证据边界](review-gate.md#实例与证据边界)重新绑定：

- **本地门禁与无模型加载检查**（[工具门禁](tooling.md#选择检查)）：`all` 验证类型、构建闭包、打包工具新鲜度、[技能清单](../config/personal-skills.txt)成员、三端[技能格式校验](tooling.md#技能格式校验)、发布形态引用、隔离安装回归及 Codex `debug prompt-input` 加载检查。这些检查确认源码自洽且 CLI 能识别入口，但**不证明**个人环境已安装、客户端已发现技能、模型在运行中读取了按需正文或遵守了行为规则。
- **静态行为场景**（[公共行为场景](../tests/scenarios/rules.md)与[产品场景](../tests/scenarios/adapters.md)）：从现行规则与工具合同推导输入、预期与失败判据，供静态核对与候选审查使用。真实模型行为验证须另行取得覆盖模型、材料与调用范围的授权（参见[模型政策](../delivery/policy/models.md#deepseek-harness-delegation)）。
- **工作区、临时资源、合并后清理与协作提醒的有界演练**：历史隔离演练已覆盖 `task-temp` 前台清理、单会话单实施 worktree 限制、PR 合并后远端分支清理、[本机提醒](#本机协作提醒)定时恢复与同机空闲会话接任；但受沙箱拦截的本地 worktree 移除、活动写任务跨主机接任、断网或进程崩溃恢复及服务端实际模型/effort 身份仍需按实际任务环境核实。
- **设计工作流与原生 Sketch 验证**：[figma-design-workflow](../delivery/skills/figma-design-workflow/SKILL.md) 与 [sketch-native](../delivery/skills/sketch-native/SKILL.md) 绑定可编辑产物、原生组件与真实像素验收（早期演练来源见[技能来源](skill-sources.md#figma-design-workflow)）；单页静态演练不替代多状态交互、跨尺寸布局或真实系统输入验收。
- **DeepSeek Harness (`dsh`) 与外部 PR 审查**：`dsh` 桌面端与叠加 [`dsh-headless.patch.yml`](../delivery/capability/dsh-headless.patch.yml) 的 `headless` 模式已实测托管凭据复用与[事件流终态核验](../delivery/policy/deepseek-harness.md#事件采集成功判据与异常恢复)（退出码 `0` 且 `final.reason.kind === "completed"`）。正式代码与安全审查由外部提供方按[共享审查规则](../delivery/policy/review.md#review-coverage)与 [gh 操作参考](../delivery/skills/gh/references/operations.md#automatic-review-and-feedback)执行；候选更新后须核对当前最新摘要与评论，不能单凭旧 head 的 `latestReviews` 或本地绿灯替代独立审查。

## 阿里云短信

[短信技能](../delivery/skills/alibabacloud-sms-send-short-message/SKILL.md)提供发送、签名和模板查询。它也提供送达详情、统计及按需资质查询。发送前固定账号、收件范围、模板变量与具体授权。受理响应不代表送达。未知结果只查询原目标，不盲目重发。Bash 工具保留七个命令。入口说明列表和详情的首屏限制。完整查询对同一目标直接分页。个性化批量发送仍由直接 CLI 路径提供。

技能回归仅运行假 aliyun CLI。它不发送短信、不访问账户。它也不建立真实插件重试、账号身份或送达证明。工具不替代发送授权。真实操作前必须核验已安装 CLI/plugin 的重试行为。来源、保留工具与限制见[统一记录](skill-sources.md#alibabacloud-sms-send-short-message)。
