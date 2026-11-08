# Codex 交付内容

这份说明随安装发布，位于 `${CODEX_HOME:-$HOME/.codex}/README.md`。以下路径均相对于该目录。

| 位置 | 内容 | 详细说明 |
| --- | --- | --- |
| `AGENTS.md` | Codex 行为规则 | [规则入口](AGENTS.md) |
| `policy/` | 任务组织、模型路线、会话、工作区、Goal 与协作收尾，以及 Rust、SQL、评审、写作、工具与 Antigravity 参考 | [任务与协作](policy/models.md)、[DeepSeek Harness 调用](policy/deepseek-harness.md)、[Rust](policy/rust.md)、[SQL](policy/sql.md)、[评审](policy/review.md)、[写作](policy/writing.md)、[工具](policy/tool-contracts.md)、[Antigravity 使用支持](policy/antigravity.md) |
| `tools/` | 文档检查器、任务临时目录与遗留扫描 | [工具契约](policy/tool-contracts.md)的对应小节 |
| `capability/` | 推荐的产品与项目配置 | [能力配置说明](capability/README.md) |
| `skills/` | 完整技能目录 | 各目录中的 `SKILL.md` |

规则入口说明各份按需参考的加载条件；工具的调用方式、选项与退出码见[工具契约](policy/tool-contracts.md)：

- **任务路由、模型档位与跨端协作**：[任务起点](policy/models.md#task-start-and-execution-routing)衔接[默认三级模型表](policy/models.md#current-defaults)、[开发设备选择](policy/models.md#local-development)、[工作区规则](policy/models.md#workspaces)、[委派与验收](policy/models.md#delegation-and-acceptance)及[官方跨设备协作](policy/models.md#official-codex-coordination-across-devices)，并通过 150K Token 上下文护栏与 `progress.md` / `spec.md` 锚点管理长任务交接。
- **外部 CLI 与产品支持**：[DeepSeek Harness 委派](policy/models.md#deepseek-harness-delegation)与[调用合同](policy/deepseek-harness.md)定义 `dsh` 的只读分析、有界执行及 [`dsh-headless.patch.yml`](capability/dsh-headless.patch.yml) 凭据复用；[Antigravity 使用支持](policy/antigravity.md)说明 Antigravity CLI 的技能安装与发现边界。
- **项目导航与设计交付**：[project-guide](skills/project-guide/SKILL.md) 按需发现项目版本、权威规范与原生检查；[figma-design-workflow](skills/figma-design-workflow/SKILL.md) 与 [sketch-native](skills/sketch-native/SKILL.md) 支持可编辑设计稿生成、离线结构审计与真实像素验收。
