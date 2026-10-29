# Agents

本仓库维护可复用的代理规则、技能和配套工具。共享 Skills 从一个源码位置交付到 Codex 与 Claude Code。Codex 另接收规则入口和专属政策；Claude 只接收 Skills 及必要依赖。PR 模型审查由仓库外的提供方执行；本地与原生 CI 复用完整检查入口。技能成员以[技能清单](config/personal-skills.txt)为准，源码交付不代表个人环境已经启用。

## 当前能力

本内容源保留可交付规则、技能、工具及原生检查入口，不继承旧仓库的 Git 历史或平台证据。[原生 CI 源码](.github/workflows/check.yml)为 Linux/macOS 调用完整 `all`。实例身份、配置与运行的验证边界由[项目约定](docs/review-gate.md#实例与证据边界)维护；旧系统来源见[退役说明](docs/admission-controller.md)。

| 能力 | 入口 | 使用边界 |
| --- | --- | --- |
| Codex 规则与专业偏好 | [Codex 规则](delivery/AGENTS.md)、[写作规范](delivery/policy/writing.md)、[Rust](delivery/policy/rust.md)、[SQL](delivery/policy/sql.md) | 专业偏好由项目明确采用 |
| 任务组织、模型路线、会话与 Goal | [任务起点](delivery/policy/models.md#task-start-and-execution-routing)、[模型政策](delivery/policy/models.md) | 组织执行前按需选择模型与路线，再绑定会话、工作区及适用 Goal，进入执行与验收；普通短任务直接完成，实际经验见[验证边界](docs/usage.md#验证能说明什么) |
| 总协调启动提示词 | [通用模板与 Nucleus 使用约定](docs/prompts/coordinator.md) | 明确启用后，总协调派发、跟进和接纳，负责人实施与验证；普通文档，不安装，也不自动继承持续交付或合并授权 |
| 本机协作提醒 | [使用与恢复](docs/usage.md#本机协作提醒) | 本机可选配置，独立于源码交付；启用状态与授权按实际环境核对 |
| Claude Code 与 DeepSeek 主动委派 | [分工与授权](delivery/policy/models.md#claude-code-and-deepseek-delegation)、[调用合同](delivery/policy/claude-code.md) | 主动委派适任且已授权的完整分析、设计、编辑、测试或修复结果；负责人判断与验收，不设调用比例；未接入 CI 或审查关卡 |
| Figma 设计委派与看图验收 | [figma-design-workflow](delivery/skills/figma-design-workflow/SKILL.md) | Codex 专用；显式授权设计写入，动态使用 Figma 与 Design 插件；单页实测范围及限制见[验证边界](docs/usage.md#验证能说明什么) |
| 产品指令 | [交付目录](docs/usage.md#交付目录) | 直接维护与安装位置相同的源码布局 |
| 文档检查器 | [工具契约](delivery/policy/tool-contracts.md) | 提示中文句长，阻塞混排空格及表格编号错误 |
| 任务临时目录与遗留扫描 | [生命周期](delivery/policy/models.md#task-temporary-directories)、[调用入口](delivery/policy/tool-contracts.md#task-temp) | 前台命令使用私有 scratch 并收尾；遗留扫描只读，历史目录不自动删除 |
| 推荐配置 | [配置说明](delivery/capability/README.md) | 提供片段，由使用者合并到自己的配置 |
| GitHub 操作 | [gh](delivery/skills/gh/SKILL.md)、[gh-identity](delivery/skills/gh-identity/SKILL.md) | 分别负责调用与工作流合同、身份就绪 |
| 项目导航与验证 | [project-guide](delivery/skills/project-guide/SKILL.md) | 共享技能；发现项目版本、权威资料与原生检查，报告实际证据；演练范围见[来源登记](docs/skill-sources.md#project-guide) |
| 原生 CI 与交付 | [运行合同](docs/tooling.md#ci-与审查边界)、[实例与证据边界](docs/review-gate.md#实例与证据边界) | 两平台复用完整检查；实际配置、运行与独立审查分别绑定实例验证 |
| 阿里云技能发现与短信 | [技能发现](delivery/skills/alibabacloud-find-skills/SKILL.md)、[短信](delivery/skills/alibabacloud-sms-send-short-message/SKILL.md) | 发现、安装及发送遵循各自授权 |
| 微信开发者工具 | [wechatide](delivery/skills/wechatide/SKILL.md) | 九个子入口已交付；实际 DevTools 操作限 macOS |
| 安装与恢复 | [安装合同](docs/usage.md#双端安装) | 一份计划绑定两个产品根，分别复制受检内容；状态目录保存计划、回执与备份 |

规则拥有行为要求，技能拥有完整能力单元。项目决定采用范围及检查参数。工具打包器负责生成可执行产物，安装器负责目标绑定及恢复。安装后的使用入口见随交付发布的 [README.md](delivery/README.md)。

## 仓库结构

| 位置 | 职责 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | 本仓库维护要求 |
| [delivery/](delivery/README.md) | 唯一交付源；成员由交付模块选择产品，`tools/` 为生成产物 |
| `scripts/` | 检查、工具准备、打包与安装恢复实现 |
| `config/` | 技能成员与工具归属、消费者绑定清单 |
| `tests/` | 仓库自动回归与静态行为场景；技能专属测试随技能保留 |
| [docs/usage.md](docs/usage.md)、[docs/tooling.md](docs/tooling.md) | 使用合同与维护方法 |
| [docs/skill-sources.md](docs/skill-sources.md) | 来源、许可及历史索引 |
| [.githooks/](.githooks/pre-commit)、[.github/workflows/](.github/workflows/check.yml) | 可选本地提交检查与双平台原生 CI 入口 |
| `.cache/` | 忽略的固定工具、构建产物和本地报告，不是交付源 |

### 维护实现的职责

按消费者查找实现：命令入口调用共享能力，交付清单与检查清单各自维护一份。源码目录与安装目标的映射由交付模块拥有，安装器在此基础上绑定目标状态。

| 职责 | 源码位置 | 主要消费者 |
| --- | --- | --- |
| 交付成员与布局 | [delivery.ts](scripts/delivery.ts)、[skills.ts](scripts/skills.ts) | 安装计划、引用检查、Codex 加载检查 |
| 检查分组与必需文件 | [check-catalog.ts](scripts/check-catalog.ts) | 检查执行器、提交钩子与工作流回归 |
| 检查执行与报告 | [check.ts](scripts/check.ts)、[check-report.ts](scripts/check-report.ts)、`check-*.ts` | 本地 `check.sh` 与安装计划 |
| 安装命令与计划 | [install.ts](scripts/install.ts) | `install.sh` 与独立安装器产物 |
| 安装执行与恢复 | [install-apply.ts](scripts/install-apply.ts)、[install-current.ts](scripts/install-current.ts) | 安装命令与状态查询 |
| 安装记录与目标状态 | [install-records.ts](scripts/install-records.ts)、[install-state.ts](scripts/install-state.ts) | 安装计划、执行、验证与恢复 |
| 源码快照与身份 | [source.ts](scripts/source.ts) | 检查报告、成员校验与安装计划 |
| 产物构建与工具准备 | [bundle-tools.ts](scripts/bundle-tools.ts)、[build-install.ts](scripts/build-install.ts)、[install-tools.sh](scripts/install-tools.sh) | 交付检查器、独立安装器与本地门禁 |

`check.sh` 调度验证并生成源码报告；`install.sh` 消费受检源码和报告，生成计划后执行安装或恢复。交付检查器由工具打包器生成。维护脚本和检查报告不随规则安装到使用项目。

规则路由从交付的 [AGENTS.md](delivery/AGENTS.md) 进入按需政策。[任务起点](delivery/policy/models.md#task-start-and-execution-routing)衔接模型路线、会话、工作区和 Goal，再进入既有协作、验收及收尾规则。首次组织执行或关键输入变化时读取相关小节，复用未变证据。Rust、SQL 仍由项目明确采用。技能路由从各技能的 `SKILL.md` 进入引用和工具。本仓库的 [AGENTS.md](AGENTS.md) 则路由到维护合同。退役审查系统仅保留 [Git 历史入口](docs/skill-sources.md#retired-review-system)，不参与当前门禁。

## 维护导航

| 入口 | 当前用途 |
| --- | --- |
| [使用指南](docs/usage.md) | 交付目录、技能闭包、安装目标与恢复合同 |
| [工具说明](docs/tooling.md) | 工具准备、完整门禁及源码身份 |
| [静态场景](tests/scenarios/rules.md) | 从规则推导的行为预期，区别于真实模型测试 |
| [技能来源](docs/skill-sources.md) | 上游身份、许可、采用范围及历史设计入口 |
| [安装快照过渡](docs/usage.md#既有安装快照过渡) | 既有安装来源和新版切换限制 |

维护时先读取项目指令及受影响的合同。规则变化同步相关场景，生成物由对应生成器更新。完整验证运行 `bash scripts/check.sh all`，前置和参数见工具说明。提交或发布前保留各项检查的实际范围与结果。

本地检查、GitHub CI、候选审查与实际产品加载各自提供证据。任一历史报告只覆盖它绑定的候选。安装器消费完整且受检的源码快照。开发缓存或其他工作树不充当安装源。

## 已知验证边界

WechatIDE 的入口与本地回归已交付。此前真实 DevTools 仅验证客户端授权与只读状态。编译、诊断、预览、上传尚无实测证据。项目列表、自动化及云端操作也未实测。安装诊断脚本已有本机只读运行记录，具体来源见[登记](docs/skill-sources.md#wechatide-installer-inputs)。

文档检查器已包含在源码中。英文正文中的中文引用仍可能因括号或引号漏检，当前由人工复核。写作规范已要求保留必要引文。项目语言配置仍未交付。供检查器识别引用的显式协议也未交付。现行调用方式仍以工具契约为准。

## 执行记录

运行、审查和配置证据按实际仓库 ID、任务及候选绑定。外部 `review-launch-status.json` 的 `current_handoff` 仅导航它实际指向的任务；使用前核对所属实例，不套用旧仓库的交接。源码不交付私人运行记录、安装回执或恢复备份。

必要历史来源与许可由[来源索引](docs/skill-sources.md)维护。私有归档的访问与迁移边界也由该页说明。当前功能和使用合同在本内容源内自足，不依赖读取私有历史。个人配置与安装状态仍按实际目标回读，不从源码推断。
