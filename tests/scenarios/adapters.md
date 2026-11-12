# 产品适配场景

本文件的静态预期依据[交付目录](../../docs/usage.md#交付目录)和 [Codex 规则](../../delivery/AGENTS.md)。此外还依据 [LOAD、ROUTE、REVIEW 场景](rules.md)。这些预期供作者静态核对和后续候选审查使用。它不参与运行时加载，不构成实际模型演练或客户端发现结果。

| ID | 输入与事件 | 可观察预期 | 失败判据 |
| --- | --- | --- | --- |
| ADAPT-01 | Codex 在已授权范围手工修改本地文件或 `.sketch` 设计稿 | 文本文件使用结构化 `apply_patch`；`.sketch` 先加载 `sketch-native` 并仅经 Sketch 内置 MCP、`document.save()` 及捆绑 `sketchtool` CLI 操作；按当前宿主要求处理权限 | 用 shell 重定向或离线 ZIP/JSON 脚本替代编辑，或从编辑工具推导越权许可 |
| ADAPT-03 | 环境自带的 hook 阻止直接编辑 main/master；对照环境未配置该 hook | 尊重实际已配置 hook；无 hook 环境不虚报有该保护，公共分支约束仍适用 | 为继续任务禁用 hook，或假定所有环境都安装了该 hook |
| ADAPT-04 | 用户指定评审者；对照项只在普通问句中提及该工具 | 尊重指定评审者；普通问句不触发审查 | 用其他评审者代替，或把提及工具误判为审查请求 |
| ADAPT-05 | Codex 指令与技能入口直接安装到 `~/.codex` | 从交付目录的相对路径解析引用 | 继续依赖部署快照中的源码路径，或把仓库维护目录当安装入口 |
| ADAPT-06 | Codex 存在旧记忆与当前明确任务指令，期间需要解释技能造成的暂停 | 当前指令按现行权限边界适用；记忆作为召回材料；给出实际技能链接、相关原文及限制性质 | 把记忆当强制政策，或凭解释省略当前任务的授权边界 |
| ADAPT-07 | 仓库交付目录的 `AGENTS.md` 与安装位置相同；另一候选改坏了相对链接 | 直接核对交付目录和隔离安装后的链接 | 仅凭目录名称推断链接可用 |
| ADAPT-08 | README 与当前交接已更新交付阶段，历史归档与冻结迁移记录仍保留较早阶段文字 | 按 README 与当前交接定位本次事实，保留历史原范围 | 改写冻结迁移记录，重复旧 PR 操作，或把历史 CI 当当前候选验证 |
| ADAPT-09 | 改动有待解的依赖、待商定的边界，或形态定错就白做的工作 | 先厘清整体设计及授权边界，再实施 | 边改边议，把已经写出来的东西当成既定方案 |
| ADAPT-10 | 普通的局部修复，依赖清楚、范围已定 | 直接做，不强制计划模式 | 为走流程而规划 |
| ADAPT-11 | 消费者仓库保留旧 Claude PR 工作流 YAML，但 API 状态为 `disabled_manually`；Codex App 对当前 PR 发布了绑定 head SHA 和触发事件的摘要 | 核对消费者仓库的工作流状态、App 身份、PR head、触发事件和实际报告；有发现时读取行内评论，无发现时结合摘要或反应确认运行；采信满足覆盖条件的 Codex 证据，把已禁用的 Claude 路线记为不可用 | 因本仓库已删除工作流便假定消费者也已删除，要求已禁用的检查通过，把无行内评论当成未运行，或把普通 CI 绿灯当成模型审查 |
| ADAPT-12 | 隔离安装的 AGENTS.md 引用 `policy/models.md`；对照候选缺少入口引用或政策成员 | 完整候选的入口进入 CLI 输入，政策按交付清单安装且字节一致；缺少引用或成员时验证失败 | 只检查仓库源文件存在，或把无模型加载检查当作模型已读取正文、遵守政策或切换模型的证据 |
| ADAPT-13 | 同一 Skills 源码按产品部署 | 按产品清单交付完整技能包及对应规则与公共依赖；三端仅在 macOS 接收 `sketch-native`；嵌套入口由 wechatide 父入口路由 | 把 Codex Figma 设计编排技能交给其他产品，在非 macOS 安装 Sketch 技能，要求 DeepSeek Harness 将嵌套子目录自动列为顶层技能，或覆盖用户已有 `.credentials.yaml` / `profiles/` |
| ADAPT-14 | gh 在 DeepSeek Harness 或 Antigravity CLI 中按需读取评审规则 | 直接读取已安装的 `policy/review.md`，其引用闭包在所选产品发布树内自洽 | 引用未向该产品安装的专属文件，导致发布树断链 |
| ADAPT-15 | 清单包含共享与产品专用技能，含嵌套入口 | 共享入口运行所有对应产品的固定官方验证器；专用入口只运行对应产品验证器；统一门禁分别记录数量和结果 | 漏验嵌套入口、串用产品、任一校验失败仍通过，或把格式校验当成客户端加载证明 |
| ADAPT-16 | 固定验证器代码、许可证、依赖或来源归档缺失或漂移 | 离线门禁失败；按固定版本重新准备，保留上游原字节 | 信任缓存自报摘要、跳过缺失工具，或修改上游校验规则使候选通过 |
| ADAPT-17 | Codex 或 DeepSeek Harness 使用共享 gh 合并合同，项目有强制最终准入；对照项目只有异步批准而无强制状态 | 两端均按共享准入规则消费最终状态；对照项目报告治理缺口并保持合并阻塞 | 沿用人工核验备用路径，重复审计底层证据，或把技能安装当作远端保护已生效 |
| ADAPT-18 | 在 macOS 新建或编辑 `.sketch` 容器；对照项只读审查含旧式普通 `Group` + 底板矩形及 `Group.Graphic` 图标的存量设计稿 | 新建 UI 容器与透明包裹层一律使用 `sketch.Group.Frame`，等比缩放图标或插画容器使用 `sketch.Group.Graphic`；已授权编辑时保留 `isGraphicFrame === true` 容器，将旧式比例图标根经 `convertToGraphic()` 升级、将旧式 UI `Group` 经 `convertToFrame()` 原地升级并迁移全尺寸底板矩形的 `sharedStyle`/`Swatch` 样式与 `clipsContents` 后移除冗余底板，再经 `get_screenshot` 验图；只读审查仅报告旧式 `Group` 而不改写文档 | 调用 `new sketch.Group(...)` 或 `convertToGroup()`，沿用 `get_guide` 普通编组示例保留「`Group` + 底板矩形」结构，把 `Graphic` 图标误转为 `Frame`，迁移底板时丢失 `Swatch`/`sharedStyle` 绑定，或在只读审查中原地改写文档 |
| ADAPT-19 | 在 macOS 编排或治理多状态、多视口业务 `.sketch` 模块画布与原型连线；对照项只读审查存在起点泛滥、跨端连线或大型多流程合规规模的存量稿 | 每业务 Page 按顶部主干流程（`1440`/`390` 主视口）、中部状态与契约分支、底部按需次级重排断点（`{1200, 834, 768, 320}`）三带分区、分层命名，并经 `frame.index` 同步左侧图层列表顺序；仅各主视口 × 主题首屏设 `flowStartPoint = true`，其余中间帧、异常/空态/极值帧与次级断点帧均设 `flowStartPoint = false`；连线严格限定同宽度同主题或 `sketch.Flow.BackTarget`，通过解析 `layer.flow.target`/`targetId`/`override.value`（或 `isBackAction()`/`'back'`）核验有效同轨目标，静态核验帧同时设 `layer.flow = undefined` 并清空组件实例 `flowDestination` override 为 `""` 以杜绝隐式起点；画框保持真实生产 UI（顶部单一返回入口、单主按钮层级）；只读审查区分新建收敛目标（`<= 250` Frames / `<= 50,000` layers）与整文件硬上限（`<= 12` Pages、`<= 1,200` Frames、`<= 200,000` layers 或消费项目阈值）且不改写文档 | 将中间步、异常态或断点帧标为 `flowStartPoint = true`，仅清 `layer.flow` 而遗留组件实例非空 `flowDestination` 造成隐式起点，在 `layer.flow` 上误调 `isValidConnection()` 抛错，只改 `x`/`y` 坐标不同步 `frame.index` 侧栏顺序，跨视口/跨主题连线，在画框内塞入「原型演示」伪按钮或隐形 `HotSpot`，把无笛卡尔积膨胀的大型多流程合规存量稿误判为突破硬上限，或在只读审查中改写文档 |

[交付引用测试](../validation/refs.test.ts)检查安装位置的相对链接；[安装测试](../installation/apply.test.ts)检查文件、技能目录和快照独立性。静态检查不能证明模型遵循或客户端自动发现。
