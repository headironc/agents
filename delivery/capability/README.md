# 能力配置

本目录发布供使用者合并的推荐配置片段，不写产品配置或消费项目的 `Cargo.toml`。个人文件可能包含其他设置，合并由使用者完成。

## 安装

| 片段 | 合并位置或使用方式 |
| --- | --- |
| `codex.toml` | `${CODEX_HOME:-$HOME/.codex}/config.toml` |
| `dsh-headless.patch.yml` | `${DSH_HOME:-$HOME/.dsh}/profiles/headless/cordis.patch.yml`，或调用时通过 `--patch` 传入 |
| `rust-lints.toml` | 明确采用 `policy/rust.md` 的项目的 `Cargo.toml` |

## 推荐值

`codex.toml` 以注释展示与[操作边界](../policy/common.md#operation-boundaries)相配的可选设置；安装片段不启用这些设置。

`dsh-headless.patch.yml` 让官方 `headless` profile 复用桌面端托管凭据，并选择 `opencode-go` 路由。片段只含插件开关和凭据引用名，不含密钥。默认 profile、凭据优先级、模型与参数由 [DeepSeek Harness 调用合同](../policy/deepseek-harness.md)维护。

## 规则与执行配置

[规则](../policy/rust.md)拥有行为要求，配置片段拥有启用方式。消费者未启用片段时，已经采用的规则仍然有效，但不能声称工具已强制执行。

`rust-lints.toml` 只收录在目标工具链上实测能拒绝违规输入、放行合规输入的 lint；其他要求仍由 Rust 规则正文约束。DeepSeek Harness 的声明配置及使用边界见上述调用合同。
