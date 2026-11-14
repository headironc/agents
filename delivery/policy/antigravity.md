# Antigravity 使用支持

本文说明 Antigravity 的全局规则入口，并供使用者直接使用 CLI 时参考。其他 agent 不从本文取得调用或委派 Antigravity CLI 的路线。授权与操作边界由[公共规则](common.md)拥有，工作区与能力核对由[执行规则](execution.md)拥有。

## 安装与技能发现

Antigravity 保留为可选安装产品。仓库交付原生全局规则入口、通用 Skills、必要合同和工具，不安装 CLI、账号、密钥或个人设置。具体交付入口见[交付内容](../README.md)。安装目标、格式校验与个人环境中的实际发现分别验收。

原生全局规则使用 `~/.gemini/AGENTS.md`，供 App 与 CLI 共享。[官方规则发现说明](https://antigravity.google/docs/customization-discovery/)也列出 `~/.gemini/GEMINI.md`；不要把两者作为互不相关的规则安装位置。共享技能使用 `~/.gemini/config/skills/<name>/SKILL.md`，配套政策和工具位于同一 `config/` 资产根，保留相对引用。标准目录自动发现，无须写入 `skills.json`。

App 不读取 `~/.gemini/antigravity-cli/skills/` 和 `~/.gemini/skills/`，CLI 则优先读取这两处旧目录。升级后核对同名旧副本的实际来源，按安装合同处理受管旧资产。CLI 通过 `/skills` 核对来源，App 通过已安装技能列表及新会话调用核验。静态交付闭包不证明个人环境中的实际发现。

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

按[权限说明](https://antigravity.google/docs/permissions)核有效的 deny、ask、allow、工作区范围和 MCP 集合。权限请求无法获批时，headless 可能拒绝必要工具而继续返回。非交互模式和 plan 模式都不构成宿主隔离。

按[执行模式说明](https://antigravity.google/docs/cli/modes)核实际模式及 sandbox 前提。headless 中 `auto` 不可用时可能警告后回退，不能把请求 auto 写成已具备无人值守执行能力。不使用全局跳过权限来解除拒绝，不删除 deny、禁用可信 hooks 或改宿主配置绕过限制。

## 结果与恢复

同时核进程退出码、结构化终态、报告完整性及任务所需工具的实际结果。stderr 的拒绝、截断、遗漏或实际失败仍须处理；成功状态不代替真实差异和检查。

保留 `conversation_id`、请求参数、必要工具证据、产物、候选和限制。日志先脱敏，省略凭据、鉴权头、原始 thinking、图片 base64 及无关个人信息。usage 只作为返回的用量元数据，不推算未核实的账单。

失败后核原句柄、已产生的差异、子进程和外部操作。未知写先回读同一目标。超时或本地取消不证明服务端结束。诊断后沿受支持机制恢复，不直接重发未知操作。

帮助、格式校验和静态场景不证明真实模型行为、端到端开发或正式审查已验收。
