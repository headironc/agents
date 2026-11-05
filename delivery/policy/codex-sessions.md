# Bounded Codex session client

Contract subject: `codex-sessions`.

使用固定 Node 运行 `tools/codex-sessions.mjs --request-json LITERAL_JSON --receipts DIR`。入口只连接指定的现有 Unix socket，不启动或管理 server。`--help` 显示参数，`--version` 输出版本。成功退出 0，失败退出 1。连接诊断包含实际 host、socket 目标与 inode、初始化响应。相同存储或 CODEX_HOME 不证明共享活跃运行时；对子线程写入前核协调线程已加载；向已绑定主协调报告可在同一 live socket 按 ID 接续 idle/notLoaded，再核返回身份和加载状态。有原生 Project 时核 root；没有时保留缺省事实，另验 App 按 cwd 的分组，不创建 Project。JSON 输出仅表示实际读取或提交，不是业务接受或任务完成。

使用 `--request-json LITERAL_JSON` 提交，最大 2 MiB，并受操作系统参数长度限制。不接受 `--request FILE`，避免检查后的文件替换。字面 JSON 进入命令审查和记录，不放凭据，并按 shell 规则引用；限定审批不接受脚本或命令替换在审批后展开内容。结构为 `{version: 1, context, operation}`。`context` 包含绝对 `socket`、物理 `cwd`、协调聊天 UUID `coordinator` 和可回查的原始 Human `authorization` 引用。收据目录必须已存在，为当前用户所有的 0700 物理路径。收据仅记录操作身份、目标和结果，不是任务进度台账。引用和收据都不授予权限；调用者核原始授权、材料、目标及唯一写者，不伪造收据接管其他任务。

`operation.type` 支持 `status`、`list`、`read`、`recover`、`create`、`send`、`rename`、`archive`。`list` 仅列本绑定创建的线程。`read` 接受 `threadId`、可选 `cursor` 和至多 45000 的 `waitMs`。等待只观察 active 状态，每页至多 50 项，返回原始分页结果；超时或不再 active 不等于业务成功。协调聊天允许读取和受权报告。其他线程除创建回执外，还核 server 保留的首条 external 输入、原协调者、授权引用、请求及已知 turn ID，并拒绝复制或分叉的历史。仅凭调用者可写的回执不能认证子线程。当前连接亲自创建的句柄沿实际响应核身份；部分创建尚无原输入时保留未知，由原负责人沿原操作核查，不自动投递。消息固定使用 external tool output，保留代理来源，不提供普通用户输入、任意 RPC 或全权限入口。

写操作使用新的 UUID `requestId`。`create` 另含 `title`、`message`、显式 `sandbox`（read-only 或 workspace-write），创建独立持久线程并开始一轮。保存的模型和审批默认值由 server 选择。`send` 另含 `threadId`、`message`，在同一 server 按 ID 接续并核身份，不替换模型、历史、目录或权限。它也接受给已卸载主协调的受权报告；不会启动 server 或承诺重启后自动协调。`rename` 另含目标和 `title`；`archive` 另含目标和可回查的 `acceptance` 引用。两者要求 idle，并读回结果；归档前仍按[聊天收尾](models.md#task-completion-and-chat-archival)核最新方向、接受、依赖和资源。

断开仅结束本客户端，不发送 interrupt、unsubscribe 或服务命令；重连后读取实际输出，不以断开成功证明任务完成。该客户端不批准 server 的审批、问题或工具请求。交互由实际宿主客户端和 reviewer 处理，保留拒绝，不换执行路径绕过。

UUID 输入统一为小写后保存和比较。连接直接使用原始文件系统路径，避免 URL 编码改变 socket 目标。写前取得目标锁，锁内重新核身份及命名/归档的空闲条件，再保存回执。创建锁同时约束已返回 ID 的子线程；原创建未决时，不能另取子线程锁继续写。超时、断线或部分失败保留回执和锁。用 `recover` 与原 `requestId` 回读原目标，不重放。创建响应丢失且没有目标 ID 时仍属未知；原负责人核查原 server，不新建替代线程。确认原执行终结且结果已知后，原负责人才能在既有授权内移除对应 `.lock`；保留回执，不改目录绕锁。该锁只协调本入口，人工或其他入口仍遵守唯一写者规则。

限定自动审批文本见 [codex-sessions.toml](../capability/codex-sessions.toml)，由 Human 审查并合并。managed `guardian_extra_policy` 优先。解析或保存成功不证明运行 reviewer 已加载；实际决策、权限、模型行为与 reviewer 输入可见性分别留证。不写产品配置或改默认全权限来代替验证。
