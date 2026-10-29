# 仓库工具与验证

本库的本地检查选择、工具与报告格式由本文和现有检查目录拥有。旧可信执行与自动准入已退役，见[退役说明](admission-controller.md)。本地检查不发布 GitHub 准入结论。

完整 `all` 检查覆盖工具启动、源码身份、文档、技能成员与安装行为。成员和产品数量从清单推导；工具归属与消费者绑定由独立预期检查。[按需工具参考](../delivery/policy/tool-contracts.md)约束 Git、SSH、curl、jq 和 rg。

wechatide 的顶层及嵌套入口参与验证，但只安装顶层目录。执行器、安装诊断脚本及各自的离线测试参与门禁。门禁不调用真实 DevTools 或钥匙串。入口与具体行为见[使用指南](usage.md#微信项目配置devtools-初始化编译诊断预览项目列表自动化云开发与安装诊断)。

prose-check 是仓库自写的检查脚本，另有离线测试。它强制检查中西文之间的空格，对中文句长给出不阻塞的提示。它跳过标题、表格、引用、HTML 注释与代码块。缩进四格及以上只在列表之外算代码块。列表之内是嵌套或续行，那些行照常检查。它按空行合并折行再断句，跨行的一句按整句度量。它按读者所见计数，列表标记与强调符号不计入长度。`--fix` 只补空格，不改句长。超过 40 字的句子有可用标点边界时给出断点建议。它另有 `grades` 子命令，列举封闭集之外的分级词候选，只列举不判定。该子命令不参与门禁，供改动措辞规则后主动运行。

解析使用 CommonMark 语法树。哪一行属于哪种构造要看上下文，按行正则表达不了上下文。

修复位置取自 micromark 的记号流。语法树把解码后的字符摊平，不给逐字符的源码位置；记号流保留每一段的范围，实体与转义因此可修。少数实体解码出多个字符，那个文本节点整体不修。全角标点后的地址由树变换单独生成，没有源码位置。这一类同样整段不修。行内图片按分隔处理：它渲染出一个图形，两侧的文种已经分开。

GFM 的尾部标点裁剪只认 ASCII。中文句末的裸地址会把句号留在链接目标里。工具不管链接目标，这一条由作者自己看。

id-check 检查表格首列标识符。同一前缀的编号必须按出现顺序递增，标识符不得重复。跳号允许，回退不允许。默认形状可用 `--pattern` 替换。

两个检查器的源码都有运行时依赖。安装后的工具必须独立于仓库依赖运行，因此 `scripts/bundle-tools.ts` 把它们打包进 `delivery/tools/`。四项测试守住它：

- 产物等于当次构建
- 不含任何包导入
- 由源码实际加载的入口构建，不是 development 入口
- 脱离仓库运行时与源码结论一致

两者现在都覆盖本仓库文档，在文档组里各占一项检查。它们读的源码清单与 markdownlint 同一份。prose-check 带 `--errors-only`，只列阻塞的空格错误。汇总行仍计入所有句长提示。旧设计文档已退役，句长提示不再排除任何文件。id-check 不排除任何文件，接入时全仓零错误。调用方式写在[按需工具参考](../delivery/policy/tool-contracts.md)，它随部署发布；本页不发布。

两者都能用 `--version` 打印裸版本号。消费者按这个版本号固定工具。prose-check 另有 `--changed`。它只报告本次改动碰到的段落。报告也计数改动之外的发现。id-check 没有这个选项。顺序错误报在下降的那一行，限定范围会藏掉插入造成的缺陷。

gh 拥有通用 CLI/API/stack 调用合同，没有执行器。旧取消执行器已移除。alibabacloud-find-skills 没有执行器。该单元交付 curl/jq 消费绑定和完整资源。它也交付缺失成员、产品选择和私有视图回归。门禁不发起技能搜索、下载或安装。短信 Bash 工具及假 CLI 测试保留在技能目录。统一门禁调用测试、ShellCheck、两端官方技能验证器与完整成员检查。aliyun-sms owner 和消费者进入既有工具登记。不新增真实云服务验证。完整工具身份与调用参考绑定见[绑定规则](#仓库登记维护)。当前交付状态与维护导航见 [README](../README.md#维护导航)。

任务临时目录入口的源码为 [task-temp.ts](../scripts/task-temp.ts)，打包到 `delivery/tools/task-temp.mjs` 并随两端工具安装。[调用合同](../delivery/policy/tool-contracts.md#task-temp)约束前台执行、收尾及只读扫描。仓库回归覆盖成功与失败清理、中断保留、Git 与归属保护、链接边界，以及扫描不改写历史内容。无模型加载检查另核对工作区、临时目录和收尾三条入口链接。缺任一链接时失败；它只证明入口存在且进入提示，不证明语义完整或模型按时执行。这些检查也不证明历史目录已经可回收。该入口不安装自动清理配置。

## 准备工具

宿主机需要 Bash、Git、jq、gh、curl。还需要 tar、unzip、Python 3.9 或更高版本。摘要工具可用 `sha256sum` 或 `shasum`。安装器不安装系统软件。它不修改 shell、个人代理或 agent 配置。归档测试还使用 `zip`。缺少必需工具会失败。

```bash
umask 077
bash scripts/install-tools.sh
.cache/agents-tools/bin/bun install --frozen-lockfile --ignore-scripts
.cache/agents-tools/bin/bun run build:install
```

Node 和 Bun 的版本由 [package.json](../package.json) 指定。[tool-versions.json](../scripts/tool-versions.json) 指定其他工具版本。它也固定平台、URL 和摘要。`verifiedAt` 是整个清单的上游核验基线日期。只有重新核验所有工具条目后才能更新。只更新单个工具时保留原日期。npm 依赖使用精确版本，并通过 [bun.lock](../bun.lock) 锁定。安装时禁用生命周期脚本。TypeScript 只做类型检查。固定 Node 直接执行维护脚本。

改动的源文件只要受 Prettier 支持，就运行以下入口。支持 Markdown 和 JavaScript。还支持 TypeScript、JSON 与 YAML。普通 Markdown 段落保持一段一行，使用 `--prose-wrap never`。其他排版采用默认值。生成文件只由生成器更新，不再运行 Prettier。上游原件遵循其保留约束。

生成器负责内容，Prettier 负责受支持文件的排版。依赖变更先由固定 Bun 更新 `bun.lock`，再按 JSONC 格式化。格式化不能替代依赖解析；完成后核对冻结安装仍接受该锁文件。

```bash
.cache/agents-tools/bin/bun run format <路径...>
.cache/agents-tools/bin/bun run format:check <路径...>
```

`format` 写回排版，`format:check` 只检查并通过退出码报告结果。两者传入同一批改动文件，不做全仓重排。格式检查独立于 `check.sh all`，完成改动时两者都运行。Prettier 处理源码排版。文档门禁阻塞混排空格和编号错误，并汇总句长提示。

本仓库是这些维护工具的第一个消费者。文档门禁直接检查仓库文档，工具打包检查比对真实产物。技能引用检查读取发布视图，安装回归在临时目标验证交付与恢复。Codex 加载检查把安装清单铺到临时 `CODEX_HOME`。它用固定版本 CLI 的 `debug prompt-input` 回读完整指令和清单中的 Codex 技能入口。模型政策另核对入口引用和隔离文件与源码的字节一致性。按需正文仍由模型在触发时读取，加载检查不证明该行为。检查不调用模型，也不修改个人安装。这些检查进入统一本地门禁。提交钩子另须配置 `core.hooksPath` 才会自动触发；入口存在不代表已经启用。旧 GitHub CI 入口已退役。PR 审查结果的部分覆盖不能证明整个候选已受审。

### CI 重建状态

旧冻结配方、监督执行、报告上传、自动准入、凭据签发和可信合并入口均已移除。新 CI 从零建立，不要求兼容旧配方、旧报告协议或旧来源指定。

本地工具、依赖锁、源码检查和安装回归继续维护。[原生工作流](../.github/workflows/check.yml)复用这些入口。真实运行、保护与审查配置按[实例与证据边界](review-gate.md#实例与证据边界)绑定，本地检查不发布 GitHub 准入结论。

成员解析器计算当前清单的产品数量。门禁不依赖本文的历史阶段数量。gh-identity 的固定 provider 已退役。它的构建命令也已退役。`.cache/agents-build/` 只保留安装器产物。

双端安装器的构建命令生成 `.cache/agents-build/install.mjs`。它还生成 Zod、js-yaml 许可证 `install-licenses.txt`。工具安装器从同一已核验归档提取 Node 的唯一顶层许可证。它写到 `.cache/agents-tools/licenses/node-LICENSE`。完整门禁绑定这些文件与固定 Node，作为安装运行副本的输入。安装计划将运行副本放在 Codex 私有安装器目录，状态目录只新增计划、回执和备份。门禁在临时目录重建并比对，也在脱离依赖的位置运行 bundle。缺失或过期失败。

安装器只把已验证的候选原子替换到 `.cache/agents-tools/bin/`。归档缓存每次重新校验摘要。随后它流式读取唯一的目标成员并检查版本。已有可执行文件不能仅凭版本输出绕过归档验证。损坏缓存、目录或链接目标、未知格式及版本不匹配都会失败。失败工具的旧目标保持原样。先前已成功准备的工具和有效下载缓存保留。

默认准备还包含[验证器清单](../scripts/skill-validator-versions.json)固定的上游 Python 原文件、PyYAML 与许可证。Codex 与 Anthropic 验证器保存在仓库私有缓存。每次离线检查从固定归档重建预期字节。它拒绝修改过的代码，也拒绝缺失或多余文件与链接。校验不信任可改写的缓存清单。准备过程会下载官方工具并执行版本探针。它不进行模型请求或个人安装。

## 技能格式校验

共享技能必须通过 Codex 和 Anthropic 两套官方技能验证器。专用技能只运行对应产品的验证器。成员解析器验证完整清单、顶层与嵌套归属以及元数据。Codex 选择 `shared|codex`，Claude 选择 `shared|claude`；所有嵌套入口随所属产品参与校验。安装和验证使用同一产品选择。

[适配器](../scripts/check-skills.ts)调用[固定上游执行入口](../scripts/skill-validator.py)。Codex 使用 OpenAI `codex` 仓库的 `skill-creator/scripts/quick_validate.py`；Claude 使用 Anthropic `skills` 仓库的同名工具。版本、下载地址与 SHA-256 由验证器清单唯一维护。保留上游原字节与许可证，不修改校验规则来让候选通过。

`repository` 和 `all` 门禁分别登记两端的校验结果与实际入口数量。任何验证器失败、缺失、损坏或覆盖不完整都阻断门禁。显式执行空选择同样失败。离线回归覆盖两套工具的真实正反例、共享与专用选择、嵌套入口以及缓存完整性。校验子进程使用临时 HOME，不传递模型凭据。

两端还分别检查完整发布引用。上游工具只校验其固定版本支持的技能格式，不证明完整客户端兼容性、加载或模型行为。Anthropic 技能验证器不等于 Claude 插件包验证器。当前没有 Claude CLI 加载或模型使用证明；新增产品字段时先核对上游支持范围。

## 选择检查

```bash
bash scripts/check.sh all
bash scripts/check.sh repository
bash scripts/check.sh ci
bash scripts/check.sh docs
bash scripts/check.sh docs markdown
bash scripts/check.sh docs links
```

| 选择 | 覆盖 |
| --- | --- |
| `repository` | 类型检查、安装器构建闭包、仓库回归、契约绑定与技能成员、两端官方技能校验、能力层、发布形态引用、Codex 实际加载与密钥筛查 |
| `ci` | 原生工作流合同回归、Shell 语法、ShellCheck、actionlint 与 zizmor |
| `docs` | 文档 runner 回归、机器路径、显式 Markdown 文件列表、lint、离线链接与锚点 |
| `all` | 上述三组，每个登记检查执行一次 |

两端交付内容直接保存在 `delivery/`，产品选择由交付模块拥有。发布形态引用检查按安装清单分别建立两个产品的隔离目录，检查各自闭包内的链接。Codex 加载检查在相同形态下确认 CLI 会读到交付指令和技能目录。安装回归再验证文件与完整技能目录的替换和恢复。工具仍由固定 Bun 打包，产物的新鲜度由门禁检查。加载检查只证明 CLI 识别入口，不证明模型遵守规则或技能操作可用。产品行为场景的静态核对见[使用指南](usage.md#验证能说明什么)。

文档子选择器只缩小 lint 或链接检查的范围。文档 runner 回归仍会执行。因此两种子选择器都需要 Markdown 依赖和 Lychee。外部 URL 在离线链接检查中排除。不得据此判断远端内容可访问或正确。

开跑前，stderr 可能提示当前分支落后于 `origin/main`。这里的基准是本机上次取回的 ref。提示不进报告，也不影响退出码。每项检查只读一个快照。回退已合并决定的分支，在自身快照里仍可能自洽。不在仓库、没有远端 ref、与基相等或领先时一律沉默。它不 fetch，所以比较的是上次取回的结果。这个提示不是准入，不证明平台采用了 strict 同步策略；实际要求按[实例配置](review-gate.md#实例与证据边界)核对。

参数错误返回 2。缺少前置或检查失败时返回 1。子进程超时、收到信号、源码漂移或报告写入失败也返回 1。全部选中检查成功才返回 0。检查器保留完整子进程输出，每项报告只保留有界诊断摘要。单项检查有超时和输出上限。超限会终止其进程组并记录失败。

Node 测试由 [check-tests.ts](../scripts/check-tests.ts) 消费原生结构化事件。每个选中文件必须产生非空测试汇总，并收到最终汇总。失败、取消、跳过和 TODO 均使该项检查失败。空文件的进程退出码即使为零，也不算通过。测试输出仍由 Node 的 TAP reporter 呈现；控制台文字不能充当验收证据。统一门禁、CI 和提交入口沿用同一判定。

## 结果与身份

报告位置必须明确。父目录必须已存在且为物理路径。目标可位于仓库外，或仓库内已忽略的输出目录。它不得覆盖源码、工具与依赖目录、符号链接或其他用户的文件。

```bash
mkdir -p .cache/reports
bash scripts/check.sh all --report .cache/reports/check.json
```

报告采用 0600 权限原子写入。它记录实际选择、计划检查和逐项结果。工具版本、平台和源码身份也在其中。失败也保留已得到的观察。在模块加载之前失败时可能没有报告，CI 同样判为失败。

源码身份绑定四类文件：

- 当前存在的 Git 跟踪文件
- 非忽略未跟踪文件
- 实际使用的仓库工具
- 安装依赖的普通文件

执行涉及的目录也纳入被忽略文件。范围包括 `scripts/`、`tests/`、`delivery/policy/`、`config/`、`.githooks/`、全部技能资产和 CI 的 `.github/`。这样可避免工具读取未绑定输入。报告还绑定两端固定验证器代码和许可证。隔离依赖及其来源归档也在绑定范围内。命令使用包内真实入口。生成的 `node_modules/.bin` 链接不参与执行。普通源码或依赖中的其他链接和特殊文件拒绝接入。检查前后重新枚举并比较内容与权限。报告和 `.git` 不作为源文件。

这个身份记录受检内容与执行环境。它不能证明未来文件不会改变，也不授予安装或发布权限。不同平台的依赖与工具可能不同，不要求它们产生相同源码摘要。

## CI 与审查边界

原生 [checks](../.github/workflows/check.yml) 监听发往 `main` 的 `pull_request` 和 `main` push。PR 事件包括 opened、synchronize、reopened、ready_for_review 和 edited。草稿及元数据编辑也执行两个平台，没有路径或 job 条件跳过。PR 检查本次平台 merge SHA；push 检查本次 push SHA。checkout 固定为 `github.sha`，Action 使用完整 commit pin，并关闭凭据持久化。

两个结果名称为 `repository (ubuntu-latest)` 和 `repository (macos-latest)`。每个平台完整准备工具、冻结安装依赖、构建安装器，再执行 `all --report .cache/reports/check.json`。每个写入步骤设置 `umask 077`，Bash 使用失败退出和 pipefail。矩阵关闭 fail-fast，一个平台失败不会取消另一个。每 job 超时 30 分钟，首片没有缓存。日志记录实际 runner 系统、架构、checkout SHA 和 PR head/base。

工作流只声明 `contents: read`，在 GitHub 托管 runner 执行，不使用 secrets。并发按 workflow、事件和 PR 编号或 ref 分组，新运行取消同组旧运行。main push 按 ref 检查最新状态，不保证被后续 push 替代的历史提交完成检查。被取消的运行保留 cancelled 结论，不计为通过。关闭 PR 不新建运行，在途任务可自然结束。取消、失败、超时和等待平台批准均不是成功。合并冲突与 fork 批准等待也不构成已验收结果。

Actions 日志与 job 结论提供托管结果。JSON 报告仅供诊断，不是认证凭证；准备失败可能没有报告，job 仍失败。actionlint 检查工作流及内嵌 Shell，zizmor 检查权限等静态风险；项目回归用现有 js-yaml 解析事件、矩阵、权限和完整命令合同。它们不证明真实平台已执行。工作流注册、两平台运行和 required 配置均按[实例与证据边界](review-gate.md#实例与证据边界)验收，不沿用旧仓库结果。

正式代码与安全审查由仓库外的提供方执行。按[使用指南](usage.md#验证能说明什么)核对提供方、候选、实际报告和发现处置。按[项目约定](review-gate.md#原生-ci-与独立审查)选择提供方，消费所选提供方的实际报告。本地检查或 CI 通过不替代独立审查。

当前合并要求由[项目约定](review-gate.md#重建期交付规则)拥有。旧实现保存在 Git 历史，运行原件与未知操作仍按原身份恢复。源码删除不证明旧外部操作已经终结，也不授权重复发送。

## 仓库登记维护

本节只供仓库维护，不随公共工具契约发布。安装后的调用者按需读取[工具约束](../delivery/policy/tool-contracts.md)。

| 清单 | 职责 |
| --- | --- |
| [inventory](../config/tool-inventory.txt) | 盘点本片已交付的 subject、领域和工具类别 |
| [owner 索引](../config/tool-contracts.txt) | 每个 subject 对应唯一手工契约或保留的固定执行器 |
| [consumer bindings](../config/tool-bindings.txt) | 指明消费者通过读取、直接执行或 wrapper 使用哪个 owner |

三份文件使用各自版本头及固定列数的 TAB 行。未知列、重复项、未知 subject、缺失 owner 均失败。空集合和不一致引用也失败。当前只登记 core，根检查器拒绝 `network/` 路径。网络能力尚未交付，未来接入须有领域验证器。

gh-identity 曾登记三项执行边界。第一项是固定 provider。第二项是只读 inspector。第三项是启动模板。该 bot 路径已退役。相关 subject、契约与绑定已从三份清单移除。当前只保留其对 `gh` 的读取声明。

绑定完整性覆盖已登记 subject 的可变生产消费者声明。独立预期清单核对当前消费者集合。脚本与可变工作流必须在首个执行语句之前声明约束。注释列表要求先读 owner，再用工具。检查器对这些声明与绑定做双向核对。已登记的 Markdown 消费文件读取完整正文。声明位于段落或列表项中。检查器从候选技能目录独立枚举全部 Markdown，也枚举技能 `scripts/` 中已交付的 Bash、MJS、CJS 执行文件。测试替身不作为生产消费者。新增执行格式时由所属切片接入实际声明与完整性检查。

声明约束维护及调用前的阅读。它不声称运行时执行了 Markdown。按摘要固定的执行器登记自有 subject 和完整执行能力；内部工具使用由对应摘要与测试覆盖。当前不再登记已删除的工作流或取消控制器。

[gh 技能](../delivery/skills/gh/SKILL.md)拥有 `gh`、`github-api` 与 `gh-stack` 的通用调用合同。检查器自身的 gh 版本探针绑定到 gh 技能。

执行工具的版本探针同样属于消费者使用。安装入口选择的固定工具及启动器的实际探针均完整登记。检查器也登记其直接执行的探针。只读取依赖清单里的版本字段不算执行该工具。

调用已登记的 `enforced-wrapper` 时，消费者必须绑定其 subject。subject 由该 wrapper 声明。包装内部的非探针辅助工具由被委托执行器绑定。调用方不递归复制绑定。例如安装入口的 curl 使用由工具启动器登记。这个边界不免除调用方自己直接执行的工具和上述版本探针。

Markdown owner 使用独立正文段落中的 `Contract subject:` 标记。代码示例、引用块和 HTML 注释不算定义。标记后必须有实际规则正文。脚本 owner 在首个执行语句之前使用对应注释。代码也必须落实其边界。固定执行器采用显式 SHA-256。仍有消费者的执行器保留准确字节和测试，已退役入口不继续登记。

`read-before-use` 首次使用时，必须先链接 owner。链接位于同一正文段落或列表项中。之后再出现 `Use tool` 与 subject 的明确调用标记。代码块、引用块和 HTML 注释中的使用标记不算声明。非执行示例应在代码块、引用块或 HTML 注释内。不能用普通正文冒充声明。消费者就是 owner 时，定义和本段规则提供直接归属。`enforced-wrapper` 除头部声明外，还必须匹配已交付 wrapper 的执行行。只有注释、打印或示例中的路径无效。新增工作流时再按其实际调用维护相应回归。

[检查器](../scripts/check-tool-contracts.ts)使用固定 markdownlint 的 token API。它检查本仓库的 owner、声明与路由。通用 Markdown 由库解析。实际消费者的独立预期来自验证测试。原 [R2 场景](../tests/scenarios/rules.md#归属与加载-fixture)保留迁移背景。它不再要求公共规则包含旧工作流路由句式。它也不读取个人 HOME。

结构检查不证明规则语义完整、没有冲突或模型会遵守指令。工具打包产物的新鲜度由构建闭包检查；直接维护的规则源由必需成员检查核对是否存在。语义遗漏仍由行为场景与审查识别。历史旧值保留在原记录中，不因与现值不同而失败。

## 提交入口

[pre-commit](../.githooks/pre-commit) 只调用仓库固定 Node 与统一检查入口。运行前必须准备上述固定工具和冻结依赖。入口未自动启用，本片不写现有 `core.hooksPath`。

可选择 `docs` 的条件有四个：

- 集合非空
- 完全暂存
- 没有其他未跟踪或未暂存改动
- 全为普通文档

结构检查必需文件和契约路径即使是 Markdown，也选择 `all`。这里的契约路径指 owner 与 consumer。下列改动同样选择 `all`：

- 源码、指令、policy、技能
- 可执行文件、重命名、删除
- 部分暂存及无法确认的排除清单
- `docs/usage.md` 的操作合同。安装测试从中独立推导目标预期，改动后运行完整检查。

Git 读取失败直接拒绝。

选择器读取 Git 交给 hook 的索引。它清除 Git 的仓库局部环境，然后启动检查。这样可防止临时索引或仓库位置泄漏到测试。`all` 检查工作树。部分暂存或路径提交时，不得把该结果说成提交索引的内容证明。临时仓库回归实际触发普通、`-a`、路径及替代索引提交。受控失败 gate 必须拒绝提交。暂存内容、HEAD 和配置均必须保留。单独运行 hook 不改写索引字节。这些测试不在主工作区创建提交或配置 hook。

选择完成后，固定 Node 用 `process.execve` 将自身替换为统一 Shell 入口。信号、每项超时及子进程清理由既有检查器负责。hook 不再留下额外的等待父进程。该入口使用本仓库固定的 Node。它覆盖 macOS 与 Linux，未提供 Windows 适配。
