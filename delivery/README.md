# Codex 交付内容

本说明随安装发布，位于 `${CODEX_HOME:-$HOME/.codex}/README.md`。以下路径相对于该目录。

| 位置 | 职责与入口 |
| --- | --- |
| `AGENTS.md` | 从通用源与 Codex 差异生成的[常驻入口](AGENTS.md)，不手工编辑 |
| `policy/` | [通用规则](policy/common.md)、[执行与资源](policy/execution.md)、[任务与模型协作](policy/models.md)、[DeepSeek Harness 调用](policy/deepseek-harness.md)、[Rust](policy/rust.md)、[SQL](policy/sql.md)、[评审](policy/review.md)、[写作](policy/writing.md)、[工具](policy/tool-contracts.md)、[Antigravity 使用支持](policy/antigravity.md) |
| `tools/` | 文档检查、临时目录与遗留扫描；调用方式见[工具契约](policy/tool-contracts.md) |
| `capability/` | 供使用者合并的[推荐配置](capability/README.md) |
| `skills/` | 各目录的 `SKILL.md`；[项目导航](skills/project-guide/SKILL.md)与 macOS [Sketch 原生设计](skills/sketch-native/SKILL.md)也从此进入 |

规则入口拥有加载触发条件。按当前任务读取对应章节；实际产品能力、授权和验证范围以所用合同及执行证据为准。
