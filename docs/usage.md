# 交付与使用指南

本仓库为 Codex 与 Claude Code 交付共享 Skills 及必要依赖。Codex 另接收指令、模型选择政策和 Rust/SQL 偏好。本地验证入口覆盖两端交付内容。维护入口见 [README 导航](../README.md#维护导航)。执行证据按 [README 执行记录](../README.md#执行记录)绑定实际实例、任务、分支与候选；不继承旧仓库的全局交接。历史设计审查不覆盖后来的实现。

按任务查阅：[阅读与采用](#阅读与采用)列出文档入口，[交付目录](#交付目录)说明源码布局。[双端安装](#双端安装)给出计划、应用与恢复步骤，[验证能说明什么](#验证能说明什么)列出证据边界。各技能的使用说明见本页对应章节。

## 阅读与采用

| 读者与任务 | 当前入口 | 适用范围 |
| --- | --- | --- |
| 在本仓库工作 | [AGENTS.md](../AGENTS.md) → [Codex 规则](../delivery/AGENTS.md) | 先加载 Codex 规则，再读相关使用与维护合同 |
| 维护或审查 Codex 规则 | [Codex 规则](../delivery/AGENTS.md)、[行为场景](../tests/scenarios/rules.md) | 核对现行规则归属、例外和独立推导的预期；场景不是第二份运行规则 |
| 维护产品指令 | [交付目录](#交付目录)、[Codex 规则](../delivery/AGENTS.md)、[产品场景](../tests/scenarios/adapters.md) | 直接维护交付目录的唯一规则源 |
| 组织执行、选择模型路线、安排会话与 Goal，或协作、接续和收尾 | [任务起点](../delivery/policy/models.md#task-start-and-execution-routing)、[模型政策](../delivery/policy/models.md)、[模型场景](../tests/scenarios/rules.md#模型选择与接续) | 由 Codex 规则入口按需加载；衔接需求与授权、工作区选择与绑定、Goal、自主执行、结果接纳及收尾，实际经验见[验证边界](#验证能说明什么) |
| 使用 Claude Code 经官方接口主动委派 | [分工与授权](../delivery/policy/models.md#claude-code-and-deepseek-delegation)、[调用合同](../delivery/policy/claude-code.md) | 仅使用 DeepSeek 官方或 OpenCode 官方 API，主动交付适任完整工作；保留任务边界及结果验收，不增加逐次审批 |
| 项目明确采用 Rust 偏好 | [Rust 偏好](../delivery/policy/rust.md)与[代码偏好](../delivery/AGENTS.md#code-preferences) | 依项目明确采用的范围读取 |
| 项目明确采用 SQL 偏好 | [SQL 偏好](../delivery/policy/sql.md)与[代码偏好](../delivery/AGENTS.md#code-preferences) | 按项目采用范围加载 SQL correctness 及其错误处理引用；PostgreSQL 约定仅适用于该数据库，表名遵循[表与模式命名偏好](../delivery/policy/sql.md#tables-and-schemas) |
| 协同设计数据模型 | [代码偏好](../delivery/AGENTS.md#code-preferences)、[SQL 建模偏好](../delivery/policy/sql.md#data-modeling) | 先恢复整体流程与已定职责，再围绕实际未决选择细化；不设固定逐表审批，具体拆分、应用 ID 和类型取值由所属项目记录 |
| 撰写中文或英文文档 | [写作参考](../delivery/policy/writing.md)、[检查脚本](../scripts/check-prose.mjs) | 脚本阻塞中西文空格错误，句长只给出提示；其余由作者判断 |
| 维护按编号引用的表格 | [标识符检查](../scripts/check-ids.mjs) | 同一前缀按出现顺序递增、不重复；跳号允许 |
| 采用能力配置推荐值 | [能力配置](../delivery/capability/README.md)、[Codex 片段](../delivery/capability/codex.toml)、[Rust lint](../delivery/capability/rust-lints.toml) | 全是推荐文本，合并由本人做一次。安装后位于 `${CODEX_HOME:-$HOME/.codex}/capability/`。本仓库不写任何产品或消费项目的配置文件 |
| 准备或验证本仓库工具 | [工具说明](tooling.md) | 使用仓库固定工具和锁定依赖；不安装个人配置 |
| 发现项目资料或执行项目检查 | [project-guide](../delivery/skills/project-guide/SKILL.md) | 共享技能；按目标版本发现权威来源与原生检查，报告实际覆盖及缺口；来源与演练边界见[登记](skill-sources.md#project-guide) |
| 维护规则与工具绑定 | [登记维护](tooling.md#仓库登记维护)、[工具调用](../delivery/policy/tool-contracts.md) | inventory、owner 索引和 consumer bindings 各自承担不同职责；只登记已交付能力 |

其他仓库使用这些源码时，项目指令必须明确引用实际位置。复制一个路径名不会使文件自动加载。当前检查保留工具归属和消费者绑定验证。两平台 CI 结果见 [README](../README.md)。安装器提供[计划、应用与恢复](#双端安装)。实际替换个人配置仍必须逐次授权。交付目录只是可检查的候选，不切换个人配置。

### 规则放置与实施范围

[实施切片规则](../delivery/AGENTS.md#implementation-slices)规定单次实施边界。整体架构的认可不授权实施全部阶段。“开始”与“继续”指向当前明确提出的切片。片内持续完成，片后报告并等待选择。验收预期见[小切片场景](../tests/scenarios/rules.md#小切片实施)。

[代码偏好](../delivery/AGENTS.md#code-preferences)区分个人偏好与项目规范。复用的个人 Rust、SQL 偏好保留在交付 `policy/`。项目按需明确采用，入口不复制全文。团队强制规则、业务不变量和验证命令由消费仓库拥有。团队、CI 或托管审查必需的规范必须纳入项目版本控制。项目 AGENTS.md 明确适用范围和权威文件位置，避免依赖作者的个人主目录。

将规范纳入项目时，保留实际采用章节及必需引用。Rust 的数据库错误章节引用 SQL 失败边界，不表示采用全部 SQL 命名偏好。迁入的项目规则在声明范围内由项目维护。个人偏好后续更新不自动覆盖项目决定。本仓库继续提供复用源，不自动迁移或安装到其他项目。

[模型政策](../delivery/policy/models.md)拥有从任务组织到执行、验收及收尾的决策。[任务起点](../delivery/policy/models.md#task-start-and-execution-routing)在执行安排前触发；普通短任务直接完成，已明确分工不反复重建。[工作区章节](../delivery/policy/models.md#workspaces)先评估主工作区和有用 WIP，再决定复用或隔离。通用代码工具的绑定由[执行上下文](../delivery/policy/tool-contracts.md#执行上下文)拥有。[Goal 章节](../delivery/policy/models.md#goals)规定适用条件、明确创建授权、内容语义及[实际接口限制](../delivery/policy/models.md#goal-tool-interfaces)。收尾章节规定证据保留及可恢复回收。默认映射只在模型政策维护。团队、CI 或托管审查强制采用时，沿用上述项目内版本化和单一所有者要求。项目入口注明采用范围、权威位置及覆盖项，保留政策所需的操作与审查引用。入口引用不等于正文已经加载，安装政策也不切换模型或修改客户端配置。

Claude Code 与 DeepSeek 的主动委派由模型政策管理。模型接口限定为 DeepSeek 官方和 OpenCode 官方服务。负责人在允许范围内自行选择或复用可用路线，不逐次请示。实际接收端点、凭据来源、模型与 effort 按本次调用核对。兼容协议或同名模型不构成第三方接收方许可。保留任务的材料、操作边界及更窄的明确限制。

任务拆解时评估客户端能交付的完整结果。适任且授权、工具就绪时实际派发，不默认由负责人完成全部执行。范围涵盖分析、设计、实现、文档、测试和修复。负责人先完成必要的业务、授权、事务与恢复判断，确认实现边界与设计。授权路线可用时，把适任的完整实现连同相关测试、文档和修复一并委派。整体任务复杂，或负责人保留关键判断、验收和交付责任，都不是收回全部实现的理由。能力、工具或拆分同一职责的成本不适当时，适用模型政策保留的兜底路线。负责人自行选择任务、模型与 effort，必要时接回；不设比例或机械必调。调用前按任务选择只读、有界执行或设计模式。执行绑定实际宿主、工作区、候选及允许操作，遵守唯一写者或隔离写区要求。已交付内容是规则与合同；CLI、账号与服务由使用者提供。本仓库不安装客户端或修改个人配置，也未将这条路线接入 CI 或项目审查关卡。实际演练与静态检查的区别见[验证边界](#验证能说明什么)。

这种分层依据 [Codex 指令发现文档](https://developers.openai.com/codex/guides/agents-md)。Codex 分层加载全局与项目入口，普通政策文件由入口按需引用。[Astra 指令建议](https://developers.openai.com/api/docs/guides/latest-model#instruction-following)强调处理含混或冲突的文件指令。这里据此明确采用范围、规则归属与切片停止点。它们是本仓库的工作约定，不是模型自动保证的行为。

自己的已授权开发仓库沿用同一任务范围和宿主权限规则。正常读写、命令和测试不因交给 Claude Code 而增加单独审批或强制沙箱要求。实际出现材料或执行边界问题时，按[调用合同](../delivery/policy/claude-code.md#有界执行)处理受影响的调用。

## 微信项目配置、DevTools 初始化、编译、诊断、预览、项目列表、自动化、云开发与安装诊断

[wechatide](../delivery/skills/wechatide/SKILL.md) 从[实际交付索引](../delivery/skills/wechatide/references/capabilities.md)选择子入口，并核验其返回。

[project-config](../delivery/skills/wechatide/skills/project-config/SKILL.md) 读取并合并修改本地配置。它不启动 DevTools，也不登录或调用 CLI。项目 hooks 也不运行。字段与 private/common 规则由[配置参考](../delivery/skills/wechatide/skills/project-config/references/fields.md)持有。风险仍按修改语义判断。

[initializer](../delivery/skills/wechatide/skills/initializer/SKILL.md) 只在 macOS 上工作。它查询状态、扫码登录、开关项目窗口。它还列出 AppID，读取运行时信息。明确要求时它才退出 DevTools。所有操作经[调用执行器](../delivery/skills/wechatide/scripts/call.sh)，按 [CLI 合同](../delivery/skills/wechatide/references/cli.md)完成首次状态检查。执行器只接受已交付操作和固定客户端名 `ClaudeCode`、`Codex`。MCP Token 从登录钥匙串读取。首次使用前，本人在 DevTools 中复制 MCP 配置。位置是「设置 → 安全」。再用交互命令保存其中的 Token，不经过对话：

```bash
security add-generic-password -U -s wechatide-mcp-token -a "$(id -un)" -w
```

同一用户的进程可以读取该钥匙串项。CLI 运行期间 Token 也出现在其进程参数中。DevTools 要求 CLI 访问令牌时，本单元报告不支持。登录与客户端授权按[异步任务](../delivery/skills/wechatide/references/tasks.md)有界轮询。二维码出现不等于登录成功。

[compiler](../delivery/skills/wechatide/skills/compiler/SKILL.md) 打开指定页面、刷新模拟器、构建 npm。它也只读获取单个 WXML/WXSS 的编译摘要。开窗由 initializer 负责。触发成功不等于编译通过。单文件摘要只覆盖局部，且仅适用小程序页面。`build_npm` 会写本地产物，只在任务要求或失败指向缺少构建时执行。刷新后仍有异常，交给 debugger 取证。证据包括 console、network 和截图。

[debugger](../delivery/skills/wechatide/skills/debugger/SKILL.md) 在已开窗的项目上取证。console 与 network 按 grep 表达式过滤。截图统一用 `simulator_screenshot`。它还可读取运行时信息。`automation_wx_api` 的调用与 mock、`debug_clear_cache` 的清理都会改变运行中的项目。这些属于改动而非诊断，必须有本人要求或确认。mock 未恢复时如实报告。空的过滤结果只说明没有匹配行。刷新与重新编译属 compiler，带着现象交回调用方。

[previewer](../delivery/skills/wechatide/skills/previewer/SKILL.md) 把预览直接推送到开发者微信，用 `auto_preview`。它也能生成预览二维码，用 `create_preview_qrcode`，默认新窗口展示。两者无需先开项目窗口，但需要已登录账号。`upload` 上传代码包、发布体验版，是对外发布的写操作。它只在本人明确要求「上传代码」或「发布体验版」时执行。版本号取自要求而非猜测。预览确认与上传返回的 pendingTask 不主动轮询。只提示在 DevTools 内确认。重发前先查原 taskId。超时或结果未知时如实报告，不重发。

[project-manager](../delivery/skills/wechatide/skills/project-manager/SKILL.md) 管理项目列表与代码片段。两类操作均不开 DevTools 窗口。`project_list` 只读列出已导入项目，默认 `miniprogram`，可用 `--scope other` 或 `all`。`project_import` 把本地目录加入列表，并像开窗一样校验路径、配置与 AppID。`project_remove` 只删列表项、不动磁盘，并会关闭该项目已开的窗口。`share_minicode` 把项目代码上传到微信，返回任何持有者都能导入的链接。它属于对外发布，只在本人明确要求分享该项目时执行。`import_minicode` 把链接指向的代码下载到 DevTools 选定的目录并登记。导入的代码视为未审查。先检查配置，包括 `scripts` hooks。还要检查依赖脚本、可执行代码、网络与文件操作。再由本人决定是否开窗或编译。从零创建项目不是已交付流程。目录与最小文件属普通源码工作。配置交 project-config。本入口只负责最后的导入。

[automator](../delivery/skills/wechatide/skills/automator/SKILL.md) 在已开窗的项目上做页面自动化。它先按项目类型分流。小程序用 `automation_navigate`、`automation_element_action`、`automation_page_action` 与 `automation_viewport_action --action pageScrollTo`。元素操作的 selector 与视口坐标二选一。页面操作里 getData 与 querySelector 为读。setData 与 callMethod 为改。小游戏只用 `automation_game_action` 与 `automation_evaluate`。画布用画布坐标，或用 `--coordinate-space image` 配截图返回的宽高。交互成功只说明已派发。每条断言必须有证据。可用元素读取、page data 或运行时返回值。截图路径也可作证据。`automation_evaluate` 会执行代码。函数必须由本人提供或认可。取证用的只读表达式也可运行，且必须报告源码。换测试号、刷新 ticket 与真机调试只在明确要求时执行。被拒即停。`automation_generate_script` 生成的脚本审查后交给本人。安装 `miniprogram-automator` 与运行属普通源码工作。截图统一用 `simulator_screenshot`，关窗交 initializer。

[cloudbase-operator](../delivery/skills/wechatide/skills/cloudbase-operator/SKILL.md) 管理云开发资源。它无需开窗，支持读取和写入。AppID 只来自用户或上游已确认事实。对 `cloud_env_list`、`cloud_fn_list`、`cloud_fn_info` 也可用 `--project` 从该项目配置解析，并报告确认。`--env` 只来自用户、已确认事实或 `cloud_env_list` 的返回。多环境时让用户选，禁止自动挑。目标不明确时先读后写。云函数走 `cloud_fn_list` → `cloud_fn_info`。数据库走 `cloud_db_read_struct` → `cloud_db_read_doc`。存储走 `cloud_query_storage` 的 `list`/`info`。消息推送走 `cloud_query_msg_push --action list`。六个写操作每次必须针对该 AppID、环境与目标单独确认：

- 云函数的完整部署与增量部署
- 库结构修改与文档修改
- 存储的 upload 与 delete
- 消息推送管理

一次确认不覆盖下一次。拒绝或确认超时即停。删除存储目录先列出前缀内容，再确认精确 `--cloud-path`。文档 update/delete 不发空 `--query`。部署有依赖时带 `--remote-npm-install`。同一 (MsgType, Event) 只绑一个云函数。subscribe 会替换原函数。事件名取自 `listSupportedEvents`。云托管的 `ensureContainerMode` 与 `setContainerCallback` 不交付。遇到这类请求，报告未交付。再指向 DevTools 云开发控制台。临时下载链接会过期，只在当前任务内使用。不要把它写进源码、文档、提交或记忆。部分成功原样保留返回结构。结果未知先用读操作核实，不重发。

[installer](../delivery/skills/wechatide/skills/installer/SKILL.md) 只诊断本机安装。它不登记任何 DevTools 操作。因此它不走执行器，也不需要 MCP Token 与就绪检查。执行器报 `cli-unavailable` 或 `cli-unbound` 时才进。本人问是否装了开发者工具时也进。日常业务前不跑。`node SKILL_ROOT/skills/installer/scripts/check-install.mjs` 输出一个 JSON。`reason` 区分十二种结论。未安装、NW.js 版、缺运行时标记各一种。版本不可读、版本不可比、版本过低各一种。缺 CLI、CLI 自身 help 失败各一种。PATH 无命令、PATH 指向应用包外各一种。还有一种是被查目录兼容，但 PATH 指向另一个应用包。`executorCode` 说明它解释的是哪一条执行器拒绝，且只由 PATH 决定。PATH 上有应用包内的 CLI 时，即使结论失败也不带该字段。这时用 `pathInstallRoot` 指出真正会跑的安装。`remedy` 写本人要做什么，脚本自己从不做。版本门槛优先从已安装目录读取。读不到才用仓库记录值，并以 `minimumVersionSource: recorded` 声明可能落后上游。默认路径查不到时，先用 `--install-root` 复查再下结论。下载、安装、更新与补 PATH 软链都不在交付内。`cli_not_on_path` 报告可用绝对路径，并说明补 PATH 属本人的工作。不自建软链，也不因此重装。`cli_unbound` 先报告 PATH 上那个文件是什么，再由本人决定。要装要更新只给官方下载页。不拼链接，不替本人选渠道架构版本。

上游 skill 的每个 scene 现在都有已交付入口。未登记名称仍被执行器拒绝。包括 CLI 别名和两个废弃的 project_setting。它们的 pendingTask 保留身份，不查询也不重发。十个入口均为验证成员，安装成员只有顶层 wechatide。来源和边界见[来源记录](skill-sources.md#wechatide)。静态预期见九个场景小节：

- [本地配置](../tests/scenarios/rules.md#wechatide-顶层与本地配置)
- [初始化](../tests/scenarios/rules.md#wechatide-devtools-初始化)
- [编译](../tests/scenarios/rules.md#wechatide-编译与刷新)
- [诊断](../tests/scenarios/rules.md#wechatide-诊断)
- [预览](../tests/scenarios/rules.md#wechatide-预览与上传)
- [项目列表](../tests/scenarios/rules.md#wechatide-项目列表与代码片段)
- [自动化](../tests/scenarios/rules.md#wechatide-页面自动化)
- [云开发](../tests/scenarios/rules.md#wechatide-云开发)
- [安装诊断](../tests/scenarios/rules.md#wechatide-安装诊断)

执行器测试使用假 CLI 和假钥匙串。安装诊断测试使用合成安装目录。2026-09-18 在 Mac 上使用真实 DevTools。实测覆盖客户端授权和只读状态检查。升级至 Nightly 2.02.2609182 后复测。`versionRelation` 仍为 `equal`。2026-09-19 又在同一台 Mac 上复测。云开发操作的 `-h` 逐个核对。`versionRelation` 仍为 `equal`。尚未实测开窗、登录、AppID、运行时信息和退出。编译、诊断、预览、上传也未实测。项目列表、自动化和任何云端读写同样未实测。安装诊断脚本在本机真实跑过，返回 `compatible: true`，门槛取自已安装目录。它不安装也不改动任何东西。源码验证不表示个人配置已安装。

## 阿里云技能发现

[alibabacloud-find-skills](../delivery/skills/alibabacloud-find-skills/SKILL.md) 已交付。产品归属登记为 `shared`。它适用于明确的阿里云技能发现请求，或已确认的能力缺口。已有匹配能力时直接使用。不要从普通阿里云关键词启动发现。

入口负责需求拆分、搜索选择、互补技能和结果交接。[HTTP 参考](../delivery/skills/alibabacloud-find-skills/references/agentexplorer-api.md)拥有请求形式。[验证参考](../delivery/skills/alibabacloud-find-skills/references/verification-method.md)拥有响应和分页判据。[安装参考](../delivery/skills/alibabacloud-find-skills/references/installation.md)区分下载、安装与后续使用。[示例](../delivery/skills/alibabacloud-find-skills/references/search-examples.md)仅说明选择方法。来源、原件摘要和退役依据见[来源记录](skill-sources.md#alibabacloud-find-skills)。

该技能的候选与执行证据见独立切片交接。交接位置由 [README](../README.md) 列出。它不替换全局 `current_handoff`。本地门禁与[静态场景](../tests/scenarios/rules.md#阿里云技能发现与操作边界)不证明 AgentExplorer 实际兼容。它们也不证明模型行为、当前实现的审查覆盖或安装成功。本片不安装个人配置。

## 交付目录

[delivery](../delivery/README.md) 是共享源码根，内部相对引用在两端部署后保持不变。交付模块明确选择每个产品的成员。`AGENTS.md` 是直接维护的 Codex 规则入口，按需正文由 `policy/` 中各文件拥有。工具由 `scripts/bundle-tools.ts` 生成到同一目录。安装器按清单复制文件与完整顶层技能目录，安装后的副本独立于备份和快照。修改交付内容后运行完整门禁，分别检查仓库引用、交付目录引用和隔离安装行为。

## 日常开发与工具操作

普通实现、计划、审计、审查可直接提出任务。文档编辑和重命名也一样。它们不要求通用流程技能、tier 或交接模板。授权范围内连续完成本地准备、修改与验证。项目明确要求的审查和外部操作权限仍有效。

- [Codex 规则](../delivery/AGENTS.md)保留沟通、操作边界和代码偏好。
- [模型政策](../delivery/policy/models.md)拥有模型选择、工作区寿命、协作分工、委派验收、接任及归档要求。
- [写作参考](../delivery/policy/writing.md)保留来源、现行与历史区分。它也保留删除、合并和双语句子规范。
- [工具约束](../delivery/policy/tool-contracts.md)按需说明 Git/SSH 和常用命令。
- 审查与合并准入的通用责任由[共享审查规则](../delivery/policy/review.md)拥有。项目声明平台强制条件、审查流程承担的条件及接受的限制。agents main 当前采用[重建期项目约定](review-gate.md#重建期交付规则)，由其规定检查、审查和普通合并条件。审查阶段仍复用有效覆盖并处理发现，推送 PR 修复前先检查并核对 diff。
- [gh](../delivery/skills/gh/SKILL.md) 及[操作参考](../delivery/skills/gh/references/operations.md)负责 GitHub 命令和操作。已安装且经核验的身份合同仍是前置，不得从命令示例推导权限。

当前成员与产品归属以[清单](../config/personal-skills.txt)为准。旧流程技能只保留历史来源，不继续安装。写作和工具参考属于公共 `policy/` 路径的成员。安装来源与限制见[安装快照过渡](#既有安装快照过渡)。

[gh 的工作流合同](../delivery/skills/gh/references/workflow-authorization.md)拥有目标、修复范围及自动审查授权。[共享观察规则](../delivery/policy/review.md#asynchronous-observation)拥有异步等待与观察恢复边界。自动审查按实际提供方核验。限定发现清单与限定修复范围分别处理，已有授权内的新缺陷继续修复。[gh-identity 源码入口](../delivery/skills/gh-identity/SKILL.md)只负责 `headironc` 的身份就绪与认证恢复。`cladiron[bot]` 与其固定 provider 已于 2026-09-18 退役。GitHub App 凭据能力与安装状态见[安装快照过渡](#既有安装快照过渡)。

## 规则与技能维护

公共规则拥有跨任务约束和代码偏好。工具拥有服务权限、调用参数、错误与恢复合同。规则变更同步实际消费者、产品生成物和适用场景。静态检查、实际模型行为和候选审查分别报告。Rust 与 SQL 偏好只适用于明确采用它们的项目。

工具技能按完整单元交付。入口、引用、必要资产、执行器、测试与许可证共同验收。来源记录保留原件身份和采用范围。跨技能调用使用可用安装名。内部引用从物理安装目录解析，保持完整可达。清单决定成员与产品，不授予业务权限。新增入口同步登记、反例与完整门禁。不得删减清单来绕过缺失能力。

合并遵循目标项目的有效合同；agents main 的范围、检查、审查、授权和退出条件由[重建期规则](review-gate.md#重建期交付规则)拥有。其他目标按[通用合并准入规则](../delivery/policy/review.md#merge-admission)核各自已采用的流程及实际保护，不能借用本库例外或擅自降低既定条件。命名工作流的业务授权由 [gh 工作流合同](../delivery/skills/gh/references/workflow-authorization.md)约束。身份就绪与认证恢复由 gh-identity 负责。已采用的上游工具不为统一语言而改写。无实际调用方的历史脚本不自动恢复。实际服务、模型与个人安装分别取得授权并回读。

## 任务临时目录与收尾

[生命周期](../delivery/policy/models.md#task-temporary-directories)拥有任务临时资源的归属和收尾责任。[调用合同](../delivery/policy/tool-contracts.md#task-temp)拥有参数、清理边界及错误处理。入口随两端工具交付，不安装定时任务或个人配置。以下命令从仓库运行；安装后把工具路径换为产品根下的 `tools/task-temp.mjs`，并使用兼容 Node。

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

触发入口在 [AGENTS.md](../delivery/AGENTS.md#working-together)，短任务同样按事件加载相关小节。开始或恢复实施时核已有工作区，客户端预建的 worktree 计入已有绑定。直接建临时目录或运行会生成目录的命令前，加载临时目录合同。命令退出时核清理结果；中断恢复时先核已知目录及原操作。获授权的合并流程确认 PR 已合并后，立即进入[工作树和分支清理](../delivery/skills/gh/references/operations.md#post-merge-cleanup)。恢复后确认由他人完成的合并也走同一入口。报告完成、交接或归档前，由收尾章节核资源去向。普通进度回复不触发在用工作区退役。已读规则和未变绑定沿用，不逐轮重读或扫描整机。

合并后清理覆盖该 PR 独占的 worktree 及对应本地、远端分支。客户端预建的任务工作树同样纳入核对。工作树退役后，确认本地分支没有被其他 worktree 使用，再核对分支头并删除。主工作区、共享资源、变化后的分支头和在用材料按合同保留。队列受理、未知结果或关闭未合并都不触发删除。各项清理分别回读，已由平台移除的目标只核缺失。保留项在最终结果中说明所有者、原因和下一清理条件。

仓库源码和无模型加载检查不代表个人环境已生效。发布安装并回读后，新会话才能从对应安装入口读取候选规则。已有会话沿实际已加载版本核对。客户端在首轮之前创建目录的动作，无法由尚未加载的模型规则预先拦截。真实触发仍通过获授权的模型场景演练确认。

## 工具偏好

[依赖规则](../delivery/AGENTS.md#code-preferences)要求先查看适合目标仓库的现成工具库，包括 npm 生态。它还要求核对已有依赖、维护证据、官方文档和实际契约。已有标准库或项目依赖能合适地提供能力时，优先复用它们。

[维护工具语言偏好](../delivery/AGENTS.md#code-preferences)面向新写工具，默认选择 TypeScript。它服从目标仓库明确的语言和运行环境要求。它不要求迁移已有工具或改写业务代码。本仓库另有几项固定选择，由 [AGENTS.md](../AGENTS.md) 单独规定。选择包括固定 Node、Bash 下载启动器。上游 Python 工具也保留。

## 双端安装

安装器已交付 plan、apply、verify 和 rollback。一份计划将共享 Skills 及必要依赖复制到 Codex 与 Claude Code，Codex 另接收专属成员。在候选源码上完成构建和完整门禁后生成计划。未提交改动由门禁报告的源码身份绑定：

```bash
umask 077
.cache/agents-tools/bin/bun run build:install
mkdir -p .cache/reports
bash scripts/check.sh all --report .cache/reports/check.json
bash scripts/install.sh plan --source "$PWD" --report .cache/reports/check.json \
  --output /path/outside/checkout/agents-plan.json
```

报告必须来自同一平台和固定 Node 的完整通过的 `all`。检出 HEAD 必须等于报告基线，源码字节必须与报告一致。计划记录本机稳定标识：Linux 取 `/etc/machine-id`，macOS 取 `sysctl -n kern.uuid`。取不到即拒绝。apply、verify、rollback 均核对该标识。主机名变更只在 verify 中报告。报告绑定的被忽略文件同样阻止计划。V5 运行目录位于 `${XDG_STATE_HOME:-$HOME/.local/state}/agents/deploy/<run-id>/`，只保存计划与回执。候选和恢复运行副本位于 `${CODEX_HOME:-$HOME/.codex}/.agents-install/<run-id>/`。计划另在 `--output` 写出同字节审阅副本。它只读公开目标，但会建立私有安装器目录。

已有链接，包括指向旧部署快照的链接，都必须用 `--adopt KEY` 显式接管。悬空链接、普通文件和已有目录同样如此。接管文件或目录时，目标及目录成员必须由安装用户拥有。复制备份无法恢复其他用户的所有权，计划会报告 `backup-owner-unrestorable`。已交付内容与新候选完全一致时列为不变。KEY 见[安装目标](#安装目标与接管)。未列入清单的名称只以路径列在 `reported` 中；安装器不读取其内容。

新计划与回执记录为版本 5。公开目标为普通文件或完整技能目录。V5 入口拒绝 V4 及更早版本的 apply、verify 和 rollback，不转换记录或清理旧材料。原 V4 运行副本和必要材料仍在时，可用原回执提供的恢复命令。`status` 不识别旧回执；部署目录中仍有旧回执时报告 `indeterminate`，并在 `unreadable` 中列出路径。这一限制在新 V5 目标验证通过后仍存在。

参数错误返回 2。缺口以 JSON `gaps` 输出并返回 1，此时不建立运行目录。源、报告、根目录与目标的读取问题也列为缺口。候选目标超出记录大小限制时报告 `source-unreadable`。权限问题同样一次列出。计划写入中途失败只删除本次创建的运行目录、私有候选和审阅副本。新建上级目录仅在仍为空时删除。

逐项审阅计划并确认个人配置授权后应用。应用结果和回读都记录在运行目录的回执中：

```bash
bash scripts/install.sh apply --plan /path/outside/checkout/agents-plan.json
bash scripts/install.sh verify --receipt RUN/deployment-receipt.json
bash scripts/install.sh rollback --receipt RUN/deployment-receipt.json
bash scripts/install.sh status
```

仓库入口先核验私有 `runtime/node` 与 `runtime/install.mjs`，再交给该副本执行。检出删除后，可直接运行 JSON 输出 `recovery` 中的命令。apply 与 rollback 持有部署根下的 `.install.lock`。锁被占用时拒绝，不自动清除旧锁。前置检查不通过时输出 `refused` 与 `problems` 并返回 1。此时回执与公开目标都不改变。同一计划只应用一次。

应用前整体核对两个产品的目标，任一缺口都在首次目标写入前拒绝。应用过程中逐个替换目标。目录目标通过同级暂存和两次重命名切换，可能短暂不可见。客户端也可能看到新旧混合的指令和技能；应暂停两端正在使用交付内容的会话。每步先备份和回读，再记录待应用步骤。任一端失败时跨两端逆序恢复仍匹配的目标；第三方改动或无法确认归属的临时项会保留并报告不完整。rollback 同样只恢复仍匹配的目标和本次创建的空目录，冲突时可处置后重试。verify 核对已安装或已回滚的结果。结果中 `directories.pending` 不为 0，说明计划目录已存在，但回执未记录由本次创建。工具保留它供核对。备份、计划、候选和回执在回滚后保留。

全为 `unchanged` 的运行没有替换步骤。对其 rollback 会把回执标为 `rolled-back`，但原有目标仍在。若无其他已安装回执，`status` 将返回 `none`。这不是卸载入口。

### 安装目标与接管

所有公开目标直接保存内容。技能安装完整顶层目录，内部引用从该目录解析。固定类别与技能清单共同决定目标，不按历史数量验收。

| 目标类别 | 安装位置 | 候选来源 |
| --- | --- | --- |
| 指南 | `${CODEX_HOME:-$HOME/.codex}/README.md` | `delivery/README.md` |
| Codex 按需参考 | `${CODEX_HOME:-$HOME/.codex}/policy/{writing,tool-contracts,review,rust,sql,models,claude-code}.md` | `delivery/policy/` 对应七个文件 |
| 工具 | `${CODEX_HOME:-$HOME/.codex}/tools/<name>.mjs` | `delivery/tools/` 打包产物 |
| 推荐配置 | `${CODEX_HOME:-$HOME/.codex}/capability/<name>` | `delivery/capability/` 对应三个文件 |
| Codex 指令 | `${CODEX_HOME:-$HOME/.codex}/AGENTS.md` | `delivery/AGENTS.md` |
| Codex 技能 | `${CODEX_HOME:-$HOME/.codex}/skills/<name>` | `delivery/skills/` 清单选出的顶层技能目录 |
| Claude 按需参考 | `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/policy/{writing,tool-contracts,review}.md` | 同一份 `delivery/policy/` 公共合同 |
| Claude 工具 | `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/tools/<name>.mjs` | 同一份 `delivery/tools/` 打包产物 |
| Claude 技能 | `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/<name>` | `delivery/skills/` 中归属为 `shared` 的完整顶层目录 |

Codex 交付七个完整顶层技能包，十六个内容入口参与验证。Claude 接收其中六个共享包、十五个内容入口。Codex 专用的 `figma-design-workflow` 不交给 Claude，避免客户端递归编排自己。wechatide 的九个子入口由父入口按相对链接路由，不要求 Claude 自动发现所有内容入口。Claude 不接收 `CLAUDE.md`、`AGENTS.md`、模型政策、Rust/SQL 偏好或配置片段。推荐配置只交付给 Codex，合并到产品配置由本人完成。

部署根分别为 `${CODEX_HOME:-$HOME/.codex}` 和 `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`。备份根为 `${AGENTS_BACKUP_ROOT:-${XDG_STATE_HOME:-$HOME/.local/state}/agents/backups}`。计划记录物理根、变量来源和祖先身份。两个产品根相同或互相包含时拒绝。产品根与源码、部署记录、备份或审阅副本重叠时同样拒绝。公开目标不得覆盖私有候选或恢复运行副本。

adopt KEY 必须包含产品前缀。技能使用 `codex:gh` 或 `claude:gh`；其他成员使用 `codex:AGENTS.md`、`claude:policy/writing.md` 等相对路径。一个 KEY 只接管对应产品的目标。裸技能名、未知或未使用的 KEY 均拒绝。任一产品的根、权限或接管缺口阻止整个计划。清单外名称仅报告，保留原值。

### 安装记录与恢复边界

报告只证明已记录的检查，不授予安装权限。候选绑定源码字节、完整报告与固定运行副本。复制前后及计划冻结时均核对身份。候选冻结后不原地更新。私有运行副本包含固定 Node、安装 bundle 和许可证，由 Codex 私有目录承载本次双端恢复。Claude 公开内容不依赖该目录，但恢复命令依赖它。缺失、损坏或平台不符时拒绝，不联网修复。

持久计划是恢复依据，审阅副本只是同字节副本。应用前核对同次持久计划，再把其身份写入回执。审阅副本随后缺失不影响 verify 或 rollback。持久计划损坏、移动或被链接替换时拒绝。工具不扫描其他运行来猜测替代记录。计划与回执字段由 `scripts/install-records.ts` 唯一定义。结构验证不替代主机、路径与当前目标核对。

每步核对 before，保存备份，再写回执并替换。回执写入失败时停止后续写入。普通文件与目录都使用同级暂存；已有目标先改名让位，再安装新目标。这不保证多项同时切换，也不是断电事务。锁只协调同一状态根下的本安装器，不能阻止其他程序或使用不同状态根的安装器写入。

中断恢复逐项读取实际状态，不只相信阶段标记。目标仍为 before 时视为未改变。目标等于本次写入时才恢复，其他内容保留。若中断发生在原目标让位后，且让位项仍精确匹配 before，回滚先恢复公开目标。暂存项仍保留，并报告恢复不完整。有冲突时继续恢复其他可恢复目标，并报告不完整。回滚不依赖候选源码完好，但依赖持久记录、备份与私有运行副本。若 before 是旧快照链接，回滚后的链接仍依赖原快照。清理旧快照前，应先建立安装前状态为直接目标的新基线。旧锁须先核实来源，不自动抢占。临时项的路径和内容不足以证明创建者；回滚保留无法确认归属的残留并报告不完整，核对后由本人清理并重试。运行副本依赖当前主机系统库，不保证跨平台恢复。

安装测试独立列出目标，不从计划输出生成预期。测试覆盖旧链接接管、目录接管、漂移、故障、中断、冲突，以及移走候选快照和检出后的回读与恢复。真实安装后仍须核对文件、完整技能目录、工具入口及客户端加载。未实际验证的产品保持未验证。

## 既有安装快照过渡

逐台安装状态由部署记录拥有。每次运行的 `deployment-plan.json` 记录主机标识与源基线，`deployment-receipt.json` 记录逐目标结果；V5 运行目录位于 `${XDG_STATE_HOME:-$HOME/.local/state}/agents/deploy/<run-id>/`。`install.sh status` 从最新成功的 V5 计划读取候选摘要与基线提交，并把基线提交与当前检出的 HEAD 比较。未提交改动的实际交付字节由 `candidate.sha256` 标识；`checkout.commit` 只表示基线。状态核验本机、恢复运行副本和两个产品的每个目标，不读取候选源码。旧回执、无法读取的 V5 回执、较晚的未完成运行或核验缺口会使结果为 `indeterminate`。旧记录的留存取决于实际清理状态，不能据此推断恢复入口仍在。合并源码不会自动更新已安装目标。

个人安装形态只有一种，没有 managed 模式或 bot 入口目标。`~/.agents/github-app/` 不在安装范围内，本地 bot 凭据提供器已退役。个人安装不交付 App 私钥或本地令牌签发入口。旧项目审查关卡及其签发入口已移除，不属于当前源码或个人安装目标。

bot 退役之前生成的回执，其 rollback 不再是可用退路。这些 rollback 会试图恢复已被删除的 bot 入口。没有链接指向的旧运行同样不是活动来源；是否仍有旧记录，以实际清理状态为准。

文件与技能目录回读不证明新产品会话能正确加载指令和技能。以实际会话核验为准；已运行的会话保留已加载的指令。

实际任务中，从当前环境定位已安装入口。可使用技能目录或可用技能清单，并确认入口可读。仓库的 `delivery/` 是交付源码，不是当前个人安装。缺失入口只阻止相应动作，不得据此改写快照或安装目标。

## 本机协作提醒

协作提醒是本机可选配置，独立于源码交付与个人规则安装。启用状态、目标会话和周期以对应自动化的回读为准；内容源不证明当前环境已启用。提醒只跟进用户已授权的任务。

主协调活跃时仍使用有界等待。跨回合恢复时，先读取最新用户指令和原任务，再读取当前负责人及候选的结果。`wait_threads` 提供紧凑状态和游标；具体证据缺失时再深入历史。任务、PR 和聊天记录继续拥有事实，提醒提示不复制旧批次流水账。

协调者按[协作政策](../delivery/policy/models.md#delegation-and-acceptance)消费结果。运行中的负责人继续原任务，已处理的事件不触发重复派工或催办。发送结果未知时，先回读同一目标，再决定恢复动作。同一负责人继续原职责无需重复接受；责任转移保留接收者的明确接受证据。接纳、完成通知与归档按[收尾规则](../delivery/policy/models.md#task-completion-and-chat-archival)执行。

持续监控范围和停止条件由当次有效授权确定。没有未完成授权任务，或状态未变且无需动作时，提醒安静结束本次检查。主协调只报告实质进展、完成、失败或所需决定。已完成任务保持结束状态，提醒不产生新工作或新的操作权限。

本地调度依赖电脑开机、应用运行。计划周期不是最大响应时限。状态查询与发送并非一个原子操作，连续唤醒不保证任意并发或故障下严格只执行一次。[官方定时任务说明](https://learn.chatgpt.com/docs/automations?surface=app)描述产品能力。

历史提醒部署和文档审查属于旧环境记录，不随内容源交付，也不证明其他机器已启用。

## 验证能说明什么

本节的既有实践来自内容来源的有界观察，不是新仓库实例的配置或验收结果。实际平台证据按[实例与证据边界](review-gate.md#实例与证据边界)重新绑定。

2026-10-29 的临时资源演练使用 CLI 0.160.0，请求 `gpt-6.1-sol` 和 high。五个隔离会话读取候选规则与合成 fixture。模型在短任务中先加载临时目录规则，也核对了预建工作树。第二个工作树限制、中断恢复及完成交接也触发了相关规则。五项均观察到预期动作。命令退出时清理结果得到核对。第二个 checkout 未创建，未知原操作未重启。验收原件保留，交接未被冒称完成。

预建目录使用真实 Git worktree 模拟，恢复和交接条件由合成记录提供。演练未验证桌面创建流程、真实进程崩溃或跨会话接任，也不证明所有后续运行必然遵守。请求模型及 effort 已记录，服务端实际身份未独立核实。命令、工具返回、最终回答、材料摘要及 fixture 收尾结果保留在该任务验收记录。个人安装未被这次演练更新。

2026-10-30 的合并后清理演练请求 `gpt-6.1-sol` 和 high。两次重测均在回读合成 PR 后主动进入清理。模型核对 Git 状态，删除了符合条件的合成远端分支。分支头已变化和仍在排队的资源得到保留。验收原件外置后完成字节核验。

首次两次会话受嵌套沙箱启动错误阻挡，未执行命令。重测从正常宿主启动 CLI，仍保留 workspace 沙箱。worktree 移除和部分本地 Git 更新被沙箱拒绝。模型保留受阻资源并报告原因，完整删除路径尚未验证。服务端模型身份也未独立核实。原始失败、重测轨迹及资源回读保留在任务验收记录。本轮 fixture 最后由测试负责人清除，该结果不作为模型自动清理成功的证据。

2026-10-23 在 dev 上通过当前网关运行 Claude Code 2.1.309，完成调用合同、使用说明和对应场景的有界编辑及原有文档检查。请求模型和响应标识均为 `deepseek-v4.1-flash`，请求 effort 为 low，CLI、子进程环境与临时 settings 对齐。实际使用 Read 和 Bash，通过 apply_patch 修改三个限定文件。进程退出码为 0，结果 `is_error` 为 false；负责人读取原始运行与差异后接纳。进程枚举曾被 dontAsk 拒绝，该限制保留在原始报告中。此记录只覆盖该次执行，不证明实际上游身份、服务端有效 effort、完整场景行为或现有客户端已加载新合同。

[Figma 设计工作流](../delivery/skills/figma-design-workflow/SKILL.md)从已授权设计实践提炼。它绑定材料、服务商、目标和写入范围，并动态加载 Figma 与 Design 技能。主代理看实际预览验收。设计专用 Max Effort 偏好与普通执行分别适用。CLI 参数与权限由[公共调用合同](../delivery/policy/claude-code.md)持有。

来源实践使用 Claude Code 请求 DeepSeek；历史成功调用请求 effort 为 low，响应标识为 `deepseek-flash`。日志包含实际 `design:design-critique` 调用与 PNG 读取，评审也曾误读颜色、图片类型和文字布局。主代理核实后筛选修正。这些历史观察不证明独立审查或服务端有效档位。来源范围见[技能来源](skill-sources.md#figma-design-workflow)。

2026-10-28 的一次合成协调页演练通过官方 OpenCode Go 请求 DeepSeek 和 `max`。实际调用了 Figma 与 Design 技能，生成原生可编辑稿。长标题经真实替换、检查后还原。Terra 与主责读取同版完整画面。辅助发现由主责核实、回交修复，再核对最终节点与持久预览。Design critique 记录为制作模型的自查。

该次演练保留了 MCP 绑定失败与组件技能前置遗漏。后续修复和核验不把早期偏差改写为合规。服务端有效 effort 与 Terra 服务端身份仍缺独立证据。实测仅覆盖一个静态桌面页，不证明交互、跨尺寸、其他业务稿或场景全集。静态检查与无模型加载也不能代替这些实际行为验证。

[工具门禁](tooling.md#选择检查)会将非忽略的新 Markdown 文件纳入显式检查集合。它检查机器路径、格式、本地链接和锚点。`all` 还运行源码检查、契约绑定、技能成员、工具打包新鲜度、发布形态引用、固定产品验证器、隔离安装回归及无模型 Codex 加载检查。加载检查确认隔离候选的指令和技能目录进入 CLI 输入。它也核对模型政策入口及隔离文件的字节一致性。这不证明模型读取了按需正文、实际切换模型或遵循规则，也不证明个人安装已加载。语义遗漏仍须依据场景和适用审查核对。

技能候选只从仓库清单与源码读取。清单是 [personal-skills.txt](../config/personal-skills.txt)，不从个人 HOME 读取已安装技能。两端入口数量由当前清单实时推导。每个顶层成员只安装一次，wechatide 的九个嵌套入口随顶层包交付并参与验证。删除清单行、必需引用、执行器或随技能测试均不能绕过完整门禁。共享与专用技能按[技能格式校验合同](tooling.md#技能格式校验)执行对应官方验证器。当前入口数量见[安装目标](#安装目标与接管)。格式校验不代表 Claude CLI 加载或模型使用已验证。

本地审查路线没有本仓库交付的执行器，门禁也不启动任何模型。场景只静态核对规则文本。门禁证据不覆盖实际审查者行为。CLI 服务兼容性与评审者资格也不在其中。

Claude Code 的[权限模式与审批转交](../delivery/policy/claude-code.md#权限模式与实际生效)按实际支持选择 `auto`，并核对审批模型及判定。2.1.309 的一次真实开发失败中，`dontAsk` 将内部待审批的补丁直接拒绝。离线核对原 18 条补丁输入。10 条被拒输入全部命中 brace 与 quote 预检查，8 条成功输入均未命中。该检查把 quoted heredoc 的补丁正文纳入判断。这是特定版本的拒绝原因证据。不能将其归为 Codex 宿主再次拒绝，也不证明候选修法成功。官方审批回调的机制已确认。DeepSeek/OpenCode 的实际 `auto` 审批及完整开发链路仍待真实验收，由原业务负责人负责。文档检查和无模型加载不补足这项缺口。

本机可见任务的派发、跟进和等待已有实际观察。授权范围内的结果报告和协调者读取也已有观察。候选的真实差异与源码身份验收也已使用。已观察到同机、同工作树的新会话接任，当时协作任务均空闲。证据保留在现有会话与任务记录。实际模型与 effort 未独立核实，请求配置不能充当运行身份。

活动写任务交接、跨主机接任及确认缺失后的恢复尚未演练。自主完成、主动回报及接纳通知仍缺完整的模型遵循演练。持续交付分工、完成判定及归档同样保留这一限制。静态场景或普通上下文压缩恢复不能代替这些演练，也不能证明全部模型场景通过。

[本机提醒](#本机协作提醒)已完成配置回读及连续真实定时恢复。主协调在上一轮结束后自动恢复，消费已有结果，并保留仍在运行的原负责人。下一次无变化唤醒只读取状态，安静结束，没有重复派工或催办。这些观察覆盖有未完任务时的接续。全部任务完成后的安静退出尚未验证，待文档交付后单独核实。发送结果丢失、断网、关机与并发竞争尚未实测。

本内容源交付原生 CI 源码，实例配置与验收按[项目约定](review-gate.md#重建期交付规则)执行。旧 App 验收和 PR 记录的访问边界见[历史来源](review-gate.md#历史合同与验收)，不代表新实例已启用保护或审查。以下证据说明继续适用于审查、发现修复和明确审计；内容源独立不等于省略已承接的审查。

仓库的远端审查机制不固定为某个模型或某个工作流。直接核实时，用 GitHub 的只读接口核对实际入口和触发方式。检查工作流是否启用、审查 App 或 bot 的身份、PR 触发事件、评论或 review 绑定的 head SHA、结果及覆盖声明。`disabled_manually`、缺少运行记录或只存在 YAML 时，把该路线记为不可用或覆盖未核实。旧的 Claude PR 工作流已从仓库源码移除；历史运行不证明当前候选受审，普通 CI 绿灯也不能当成模型审查。当前消费者实际使用的 Codex、Claude 或其他已配置入口，均按同一证据规则判断。

Codex App 有发现时通常发布行内评论；没有发现时没有 finding 行内评论，但可能留下完成摘要或 👍 反应。[官方 Codex Code Review 合同](https://learn.chatgpt.com/docs/third-party/github)以 PR diff 为输入。核对完成摘要的发布者是否为已核验的审查 App，摘要是否属于本次运行并绑定当前 PR 和 head。还须核实审查时的目标分支基线、触发与完成状态，并确认本次运行的评论和线程没有发现或失败。旧运行的发现另按处置规则跟踪。目标基线在审查后移动时，须取得覆盖新基线的审查。单独的 👍 反应只能作为运行信号，不能证明无发现覆盖；没有正式 GitHub review 对象也不能据此认定模型未运行。

本页记录的输入合同仍适用时，直接复用。新的 PR 不要求重查官方文档。审查和审计仍核对该 PR 的实际运行证据。证据齐全且发现已处置，就结束审查核验。合并仍须满足已采用流程的其他条件及操作授权。复核的触发条件与范围见[审查覆盖规则](../delivery/policy/review.md#review-coverage)。

直接核实后续提交时，留意已有 bot 摘要可能已更新。`latestReviews` 仍可能列出旧 head 的有发现 review。回读摘要正文与更新时间，核对 bot 身份、当前 PR 和 head。再核对审查基线、触发事件、完成状态、行内评论与线程。旧 review 不证明新 head 未受审。完成记录只证明本次运行；它不证明审查者逐一阅读了哪些文件。摘要无法绑定当前 head，或审查基线无法核实时，记为未核实。

审查阶段由维护者按授权核对报告并处置发现。非阻塞建议可实施、说明延期理由，或提供不采纳的证据。理由留在原发现线程或原报告讨论中，已有有效记录直接复用。批准只能证明关卡实际核验的条件。旧关卡及其覆盖限制见[历史来源](review-gate.md#历史合同与验收)。解决线程不等于必须修改代码。操作细节见 [gh 操作参考](../delivery/skills/gh/references/operations.md#automatic-review-and-feedback)。

pre-commit 源码已提供，现有 `core.hooksPath` 保持原配置。覆盖选择、工具前置和临时仓库测试边界见[提交入口](tooling.md#提交入口)。`pr-review` 不作为独立技能恢复或安装。PR 打开、审查与合并操作由 [gh 操作参考](../delivery/skills/gh/references/operations.md)承担。原已验证候选保留原交接和验证范围。位置见 [README 执行记录](../README.md#执行记录)。

[公共行为场景](../tests/scenarios/rules.md)和[产品场景](../tests/scenarios/adapters.md)从设计和历史契约推导输入与预期。作者静态核对、候选审查和实际模型演练分别记录。模型演练必须有覆盖模型、材料和调用范围的授权。授权复用与范围变化按[模型政策](../delivery/policy/models.md#claude-code-and-deepseek-delegation)处理。旧交接修复的五类演练保留原版本范围，不算当前候选的行为证据。安装切换后的结果以实际目标回读为准。

## 阿里云短信

[短信技能](../delivery/skills/alibabacloud-sms-send-short-message/SKILL.md)提供发送、签名和模板查询。它也提供送达详情、统计及按需资质查询。发送前固定账号、收件范围、模板变量与具体授权。受理响应不代表送达。未知结果只查询原目标，不盲目重发。Bash 工具保留七个命令。入口说明列表和详情的首屏限制。完整查询对同一目标直接分页。个性化批量发送仍由直接 CLI 路径提供。

技能回归仅运行假 aliyun CLI。它不发送短信、不访问账户。它也不建立真实插件重试、账号身份或送达证明。工具不替代发送授权。真实操作前必须核验已安装 CLI/plugin 的重试行为。来源、保留工具与限制见[统一记录](skill-sources.md#alibabacloud-sms-send-short-message)。
