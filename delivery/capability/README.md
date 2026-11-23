# 能力配置

本目录发布供使用者合并的推荐配置片段，不写产品配置或消费项目的 `Cargo.toml`。个人文件可能包含其他设置，合并由使用者完成。

## 安装

| 片段                                  | 合并位置或使用方式                                                                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex.toml`                          | `${CODEX_HOME:-$HOME/.codex}/config.toml`                                                                                                                                                                                             |
| `dsh-headless.patch.yml`              | `${DSH_HOME:-$HOME/.dsh}/profiles/headless/cordis.patch.yml`，或调用时通过 `--patch` 传入                                                                                                                                             |
| `gcloud-mcp-denylist.json`            | `@google-cloud/gcloud-mcp` 的前缀黑名单模板；个人启用时将 `-c` 与此文件物理绝对路径传给 `gcloud` MCP 参数                                                                                                                             |
| `gcloud.mcp.json`                     | `$HOME/.gemini/config/mcp_config.json` 或其他支持 `mcpServers` JSON 的客户端配置；Codex 合并 `codex.toml` 中的 `mcp_servers.gcloud` 段落                                                                                              |
| `google-developer-knowledge.mcp.json` | `$HOME/.gemini/config/mcp_config.json`（通过 `authProviderType: "google_credentials"` 鉴权）；Codex 合并 `codex.toml` 中的 `mcp_servers.developer-knowledge`（通过 `env_http_headers` 读取 `DEVELOPERKNOWLEDGE_API_KEY`）             |
| `google-observability.mcp.json`       | `$HOME/.gemini/config/mcp_config.json` 或其他支持 `mcpServers` JSON 的客户端配置（12 项只读工具）；Codex 合并 `codex.toml` 中的 `mcp_servers.google-observability` 段落                                                               |
| `google-storage.mcp.json`             | `$HOME/.gemini/config/mcp_config.json` 或其他支持 `mcpServers` JSON 的客户端配置（默认安全模式）；Codex 合并 `codex.toml` 中的 `mcp_servers.google-storage` 段落                                                                      |
| `rust-lints.toml`                     | 明确采用 `policy/rust.md` 的项目的 `Cargo.toml`                                                                                                                                                                                       |
| `chrome-devtools.mcp.json`            | `$HOME/.gemini/config/mcp_config.json` 或其他支持 `mcpServers` JSON 的客户端配置（跨平台；若 macOS Antigravity 已启用 `chrome-devtools-plugin` 则不重复合并此 JSON）；Codex 合并 `codex.toml` 中的 `mcp_servers.chrome-devtools` 段落 |
| `sketch.mcp.json`                     | 仅 macOS：`$HOME/.gemini/config/mcp_config.json` 或其他支持 `mcpServers` JSON 的客户端配置（配套 `sketch-native`）；Codex 合并 `codex.toml` 中的 `mcp_servers.sketch` 段落                                                            |
| `wx-docs.mcp.json`                    | `$HOME/.gemini/config/mcp_config.json` 或其他支持 `mcpServers` JSON 的客户端配置；Codex 也可合并 `codex.toml` 中的 `mcp_servers.wx-docs` 段落                                                                                         |

## 推荐值

`codex.toml` 以注释展示与[操作边界](../policy/common.md#operation-boundaries)相配的可选设置，以及 `wx-docs`、`sketch`（仅 macOS）、`chrome-devtools` 与 Google Cloud 官方 MCP 示例；安装片段不启用这些设置。

`dsh-headless.patch.yml` 让官方 `headless` profile 复用桌面端托管凭据，并选择 `opencode-go` 路由。片段只含插件开关和凭据引用名，不含密钥。默认 profile、凭据优先级、模型与参数由 [DeepSeek Harness 调用合同](../policy/deepseek-harness.md)维护。

`sketch.mcp.json` 指向 Sketch 2026.4+ 本机回环 MCP 端点（`http://localhost:31126/mcp`，不支持 Mac App Store 版），仅在 macOS 安装交付。`codex.toml` 将 `run_code`、`save_comment` 与 `delete_comment` 均注释推荐为 `approval_mode = "prompt"`（按 Codex `AppToolApproval` 语义，`prompt` 为每次询问，`approve` 为直接自动放行；个人在受信任设计稿上可自行放宽 `run_code`，Workspace 评论写操作仍保持询问）。

`chrome-devtools.mcp.json` 以无硬编码路径的 `npx` 启动固定版本 `chrome-devtools-mcp@1.13.0`，默认附带 `--no-usage-statistics` 与 `--no-performance-crux`，避免默认外发遥测或将私密页面 URL 送往 CrUX API；在 macOS GUI 客户端 `PATH` 不含 `nvm` 目录时，请通过稳定用户入口（如 `/opt/homebrew/bin` 或 `~/.local/bin` 软链到兼容 Node）或个人合并 `env.PATH` 提供 `npx`，不在仓库写死版本路径。按方案 2 分工：若在 macOS Antigravity 保留官方 `chrome-devtools-plugin` 以使用其专项排障技能，切勿同时把 `chrome-devtools.mcp.json` 合入全局 `mcp_config.json`，以免重复拉起双份实例。

`wx-docs.mcp.json` 登记微信开放文档官方只读 Streamable HTTP MCP 服务（`https://developers.weixin.qq.com/doc/mcp`），无鉴权。客户端未挂载该服务时，由使用者自行将片段合并到对应 MCP 配置。

`gcloud.mcp.json`、`google-observability.mcp.json` 与 `google-storage.mcp.json` 对应 `googleapis/gcloud-mcp` 仓库（Apache-2.0），上游目前处于 Preview 阶段且不在 GCP SLA/ToS 担保范围内，运行前需本机具备 Node `>=20` 与已认证的 `gcloud` / ADC（推荐服务账号模拟，并配置 quota project）。上游 `gcloud-mcp` 默认仅拦截 10 条交互式 SSH/meta 命令，不默认拦截 `delete`、`iam`、`billing`、`kms`、`organizations` 或资源级 IAM 变更，因此另提供 `gcloud-mcp-denylist.json` 纯前缀黑名单模板（覆盖 `iam`、常见资源级 `add-iam-policy-binding` / `remove-iam-policy-binding` / `set-iam-policy` 与 `org-policies`，GA 前缀自动覆盖 `alpha`/`beta`/GA，禁止写 `*` 通配符或带 `gcloud` 二进制名前缀；启用时必须在配置中通过 `-c` 传入物理绝对路径）。由于 `gcloud` 服务组繁多且黑名单无法穷尽全部未来写接口，`gcloud-mcp-denylist.json` 仅作纵深防御，严禁与自动放行 `run_gcloud_command` 搭配：Codex 须保持 `approval_mode = "prompt"`，Antigravity / DSH 等客户端亦须保持每次调用确认；无人值守的只读场景应改用个人严格只读 `"allow"` 白名单配置（注意 `-c` 中 `allow` 与 `deny` 互斥）。`google-observability.mcp.json` 仅包含 12 项只读观测工具。`google-storage.mcp.json` 严禁默认启用 `--enable-destructive-tools`，且 `codex.toml` 对安全模式中的 4 项新建写操作（`create_bucket`、`write_object_new`、`upload_object_new`、`copy_object_new`）标注 `approval_mode = "prompt"`。`backupdr-mcp` 暂不作为独立默认片段交付。

`google-developer-knowledge.mcp.json` 接入官方只读远程文档服务 `https://developerknowledge.googleapis.com/mcp`。由于 Antigravity 全局 `mcp_config.json` 不展开 `${ENV}`，该片段使用 `authProviderType: "google_credentials"`；Codex 则在 `codex.toml` 中通过 `env_http_headers` 绑定环境变量 `DEVELOPERKNOWLEDGE_API_KEY`，仓库内不写入任何 API Key。

个人开发环境工具（如 `xcode`、`datagrip`）、Codex App 托管服务（`codex_app`、`node_repl`）及个人数据库连接配置（如依赖特定 1Password 条目与私密基础设施的 `postgres` MCP）属于个人偏好或宿主托管能力，不纳入仓库交付。

## 规则与执行配置

[规则](../policy/rust.md)拥有行为要求，配置片段拥有启用方式。消费者未启用片段时，已经采用的规则仍然有效，但不能声称工具已强制执行。

`rust-lints.toml` 只收录在目标工具链上实测能拒绝违规输入、放行合规输入的 lint；其他要求仍由 Rust 规则正文约束。DeepSeek Harness 的声明配置及使用边界见上述调用合同。
