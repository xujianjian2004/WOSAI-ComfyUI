# Changelog

本文件记录 WOSAI-ComfyUI 的用户可见变更。版本号遵循语义化版本。

## [Unreleased]

### License

- **修复一处长期存在的 GPL-3.0 合规缺陷。** 本项目此前整体标注为 MIT，但其中 5 个前端文件实为 GPL-3.0 许可项目的衍生作品，被以 MIT 条款分发，构成许可证违规。经逐行比对量化后，现按 **GPL-3.0-or-later** 单独授权并补齐署名（本项目其余部分仍为 MIT）：

  | 文件 | 上游（许可） | 逐字相同率 | 上游独创命名命中 |
  | --- | --- | --- | --- |
  | `web/auto-connect.js` | ComfyUI-KJNodes `web/js/fillconnect.js`（GPL-3.0，kijai） | 69.6% | 39 |
  | `web/shake-disconnect.js` | ComfyUI-KJNodes `web/js/shake_to_disconnect.js`（GPL-3.0，kijai） | 67.7% | 58 |
  | `web/performance-mode.js` | ComfyUI-KJNodes `web/js/performance.js`（GPL-3.0，kijai） | 51.7% | 35 |
  | `web/shared/graph-utils.js` | ComfyUI-KJNodes `web/js/utility.js`（GPL-3.0，kijai） | 66.7% | 6 |
  | `web/ignore-groups.js` | Goohaitools-comfyui `web/js/nodes pass.js`（GPL-3.0，goohai） | 22.7% | ~130 |

- 新增 `LICENSE-GPL-3.0`（GPL v3 全文）与 `THIRD-PARTY-NOTICES.md`（完整署名、出处，含 MIT 来源与纯设计参考来源的区分）；`LICENSE` 增加「许可证例外说明」章节；README 增加许可证例外表。发布包现随附许可证全文与署名文件。
- 上表 5 个文件均添加 `SPDX-License-Identifier: GPL-3.0-or-later` 文件头与上游项目／作者／原始文件路径注释。
- 新增 `web/shared/licensing-consistency.test.mjs`（4 项断言）：锁定许可证文件齐备、SPDX 标识一致、署名完整，并**禁止 MIT 文件静态引用 GPL 文件**（防 GPL 反向传染）。已通过阴性验证。
- 顺带澄清两条**不构成敞口**的来源：`logic-switch`（移植自 MIT 许可的 ComfyUI-OverrideSwitch，兼容）与 `color-theme.js` / `color-core.js`（参考 ComfyUI_GJJ_Nodes 的数据结构，逐字相同率 0%，颜色与实现均为独立设计）。
- 完整审计记录见 `dev/licensing/PORTING-AUDIT.md`（该目录不随发布包分发）。

### Added

- 图像对比节点新增 4 种对比视图（图像区顶部居中的分段控件切换，状态持久化到 `wosai_compare_view`）：
  - **滑动对比**（默认，原有行为）：单一舞台 + 可拖动分割线。
  - **左右并排**：舞台一分为二，A 占左半、B 占右半。
  - **上下并排**：A 占上半、B 占下半。
  - **自动排布**：按素材宽高比择向——横图（比例 ≥ 1）走上下并排，竖图走左右并排，避免把横图压成细缝或把竖图拉成超高舞台。
- 双拼视图的舞台宽高比按「半幅还原原图比例」动态计算（左右 ×2、上下 ÷2，并夹取到 `[0.5, 3]`），因此每半幅恰好等于素材原比例，图像零留白、零裁切；超出夹取区间时才退化为留白。
- 图像对比节点新增 A/B 尺寸标注：角标直接读取后端载荷的 `width` / `height`，显示为 `A 1024×1024` 形式；载荷缺尺寸时自动退化为只显示字母 `A` / `B`，与旧行为外观一致。
- 新增 `web/shared/compare-view-contract.test.mjs`（21 项）：把「视图类名的 JS 生产者 ↔ CSS 消费者」跨文件契约固化为回归测试（本轮即由它兜住一次类名挂错节点导致的整体布局失效）。其中 5 项覆盖闲置淡出契约：类名生产者/消费者一致、隐藏清单只含控件不含分割线、必须关掉命中、键盘聚焦兜底、闲置态不得进入高度计算且不得使用 `setInterval`。整组断言经阴性验证（逐项注入缺陷后按预期变红），并在**真实 Chrome** 中完成闲置态的渲染验收（加载真实 `media-tools.css` + 复刻节点 DOM，断言计算样式与命中测试结果）：控件 `opacity` 归零且 `pointer-events` 关闭、指针穿过控件后不再命中、分割线保持可见、键盘聚焦恢复可见、disabled 交换按钮不被误唤醒。
- 新增 `wosai_core/media_preview.py`：图像对比节点的媒体载荷构造模块（独立实现）。负责输入类型判定（IMAGE / VIDEO 鸭子类型探测）、批次导出、上游磁盘文件直引、以及视频直引/拷贝/转码三级降级。
- 新增 `tests/test_media_preview.py`（33 项）：覆盖媒体类型判定、托管目录路径解析、执行图反查、批次上限、视频 trim 回退、以及前端载荷字段契约。
- 新增 `web/shared/frontend-reachability.test.mjs`（4 项）：把「发布体积」与「启动解析体积」永久对齐——以 `extension.json` 的 29 个 JS 入口为种子求静态 import 传递闭包，断言 `web/` 下每个 `.js` 都必须落入启动闭包或按需（动态 `import()`）闭包，`web/` 之外不得存在「随包发布但运行时永不加载」的模块。该测试在落地时经阴性验证（临时放入 stray 文件后按预期失败并指名该文件）。
- 新增 `dev/frontend/README.md`：说明该目录收录「已写好、有单测、但尚未接入运行时」的前端纯函数地基（布局引擎 / 布局几何 / 功能注册表），约定不得被 `web/` 运行时模块静态 import，接线时移回 `web/shared/` 并同步本表。

### Changed

- **设备面板（侧栏「设备」）改为可视化优先的布局，把后端已经采集、此前却几乎没渲染的数字真正显示出来。** 原面板五张卡片全是「标签 + 右对齐文本」的同一种形态，且丢掉了一批更有用的数据：`memory.percent` / `disk.percent` 已由后端算好却**零引用**；GPU 的型号、温度、功耗、驱动、显存分配口径从未显示；`row()` 里写好的 `dataset.search` 没有任何输入框消费；`locales` 的 `deviceInfo` 共 65 项中 **28 项**从未被渲染（`temperature` / `power` / `pytorchAllocated` / `pytorchReserved` / `smiUsed` / `cudnn` / `network` / `startup` / `simple` / `advanced` / `search` …）；`device-info.css` 里 **36.1%（2.7 KiB）** 的规则没有任何 JS 消费者——这一版其实是一个更完整的设计被砍剩的结果。本次补齐为：
  - **「运行环境」与「关键依赖」合并为一张卡，并移到内容区首位**：两张卡都是「标签 + 右对齐值」的短行清单，分列首尾只让首屏平白多一道边界；合并后 `操作系统 / Python / PyTorch / Git` 与 6 项依赖版本同处一卡。卡内用一枚 h3 小节标签「关键依赖」划界（新增 `.ws-di-group-label`）——否则 `Git` 之下紧跟一行 `Torch`，会被读成上方 `PyTorch` 那一行的重复。
  - **新增概览磁贴**：显存 / 内存 / 磁盘各一块磁贴，显示占用率 + 紧凑用量 + 占用条，一屏之内先看到最该看到的数字。这组磁贴排在「硬件资源」卡顶部，与该卡的 GPU 体征区块共用一张卡（下一轮去重时合并，见下方条目）。
  - **占用条取代三段式文本**：`20.2GB 已用 / 3.7GB 可用 / 总计 24.0GB` → `84.2%　20.2 / 24.0 GB` + 条形。分档阈值 <70% 用品牌橙、70–89% 用 `--ws-warning`、≥90% 用 `--ws-danger`，与后端 `_health()` 现有的 90% 磁盘判据**同源**，不另造一套标准。
  - **GPU 区块补上身份与体征**：显示型号（抹掉 `NVIDIA GeForce` 前缀以适配窄侧栏）、温度、功耗、驱动版本，作为 chip 排在显存条下方。
  - **显存改为三层嵌套条**：`pytorch_allocated ⊆ pytorch_reserved ⊆ smi_used ⊆ total` 是**包含**关系而非相加，分段后「驱动占了 20.2 GB、PyTorch 只认领 1.2 GB」这类碎片问题一眼可见，并配四色图例（分配 / 保留 / 驱动已用 / 空闲）。
  - **健康度由大号数字改为环形进度**（内联 SVG + `stroke-dasharray`，随 2s 实时刷新平滑过渡），问题清单仍以 pill 呈现。
  - **数据缺档时逐级退化，绝不画 `0%` 的误导性空条**：无法计算占用率时条不渲染填充、不携带 `progressbar` 语义，文本显示「不可用」。所有条与环形均带 `role` / `aria-valuenow` / `aria-label`。
  - 复用而非重写：`.ws-di-metric`（磁贴）与 `.ws-di-gpu`（GPU 区块）本就是这次要用的形态，直接沿用并收窄子选择器；仅删除确无需要的 `.ws-di-subtitle`，并保留 `.ws-di-search` / `.ws-di-view-switch` / `.ws-di-tools` 供下一步（概览/详细切换与搜索接线）使用。
  - 新增几何令牌 `--ws-di-bar-height`(6px)、`--ws-di-bar-height-lg`(9px)、`--ws-di-bar-min-fill`(2px)、`--ws-di-swatch-size`(7px)、`--ws-di-tile-min-width`(148px)、`--ws-di-ring-size`(46px)、`--ws-di-ring-width`(5px)。**颜色令牌刻意不在变量表里包一层**，原因见 Fixed 段。
  - 缓存破坏：`device-info.js` `?v=9 → 10`、`device-info.css` `?v=5 → 7`（后者在 `extension.json` 与 `web/device-info.js` 内成对递增，本轮合并卡片后再次递增）、`wosai-variables.css` `?v=22 → 23`（`extension.json` 与 `web/shared/dom-widget.js` 成对递增）。
- **设备面板补齐「简洁 / 高级」两级视图与搜索过滤 —— 即原设计中被砍掉的那一半。** `simple` / `advanced` / `search` / `searchPlaceholder` 四条文案与 `.ws-di-tools` / `.ws-di-search` / `.ws-di-view-switch` 的全部样式从落库起就在仓库里，却没有任何代码引用；本次把这条链路接上：
  - **分段控件**：简洁版只留「运行环境（基础四项）+ 硬件资源（含概览磁贴）+ 环境健康度」三张卡；高级版追加系统架构、Python 解释器、CUDA 运行时、cuDNN、ComfyUI 版本、5 项依赖清单，以及「网络与启动参数」「ComfyUI 路径」两张卡。偏好写入 `localStorage`（`wosai.device-info.view`），跨会话保留。
  - **搜索框**：消费 `row()` / `tile()` 早已写好却无人读取的 `dataset.search`。搜索语料收录**英文键 + 本地化标签 + 实际值**三者，中英文查询都能命中；多词按「与」匹配。卡片标题命中则保留整卡，否则只保留命中自身的条目；卡内无一命中即整卡隐藏，全部隐藏时显示「没有匹配的设备信息。」
  - 切换视图只改显隐、**不整块重渲染**，因此滚动位置与正在输入的搜索词都不会丢；后台 2s 刷新在搜索框持有焦点时主动跳过——否则整块重建会打断输入法组合，并把光标抢回去。
- **设备面板补齐后端已采集、前端从未渲染的诊断数据**：`system.machine`（系统架构）、`system.executable`（Python 解释器）、`runtime.cuda_runtime` / `runtime.cudnn`、`comfyui.version`——以上归入高级版，让简洁版保持精简；新增「网络与启动参数」卡，展示 `network.http_proxy` / `https_proxy` / `no_proxy` 与 `runtime.arguments`（启动参数为空时显示「无」而不是一行空白）；路径行开始消费 `paths.*.value[].writable`，对可读不可写的目录标出「只读」（目录不存在时后端同样报 `writable=false`，那是「缺失」不是「只读」，不标）。代理项后端只回报 `Set` / `Not set` 两个英文串，前端映射为界面语言，其余取值原样透出——宁可显示原文，也不谎报一个语义。
- 设备面板另收口三处易错点：`valueOf()` 现在把**空数组也视作「没有值」**（`[].join(" ")` 是空串，会让启动参数渲染成一片空白）；被过滤隐藏的行自身仍是 `display: flex`，故样式显式声明了 `[hidden] { display: none !important }`——`display: flex/grid` 会盖掉浏览器默认的 `[hidden]` 规则，漏掉这一条就会出现「逻辑上隐藏了、视觉上还在」的假隐藏；新增 `data-section` 属性供真实浏览器验收稳定定位（卡片标题随界面语言变化，不能拿来当选择器）。
- 新增 9 条 i18n 文案（zh / en 同步）：`machine`、`executable`、`httpProxy`、`httpsProxy`、`noProxy`、`set`、`notSet`、`readonly`、`noMatch`。另有 8 条由「已存在但无人使用」转为实际渲染：`simple`、`advanced`、`search`、`searchPlaceholder`、`network`、`startup`、`cudaRuntime`、`cudnn`。
- 缓存破坏：`device-info.js` `?v=10 → 11`、`device-info.css` `?v=7 → 8`（后者在 `extension.json` 与 `web/device-info.js` 内成对递增）。
- 体积：主 JavaScript **1361.0 → 1380.5 KiB**（余 35.5 KiB）、样式 **232.0 → 237.0 KiB**（余 13.0 KiB），预算内。
- **设备面板移除「简洁 / 高级」两级视图，只留单一完整视图。** 分段控件当初是为了收窄 15 行长的环境卡；改用左右两栏后卡高已由「较高的一栏」决定，再靠砍内容省高度收益很薄，代价却是同一块面板要维护两套显隐规则、且不同用户看到的面板不一致。改动如下：
  - 删除分段控件、`viewMode` 状态与 `localStorage` 键 `wosai.device-info.view`；原先只在高级版出现的系统架构、Python 解释器、CUDA 运行时、cuDNN、ComfyUI 版本、依赖清单，以及「ComfyUI 路径」卡，现全部常显。
  - **搜索框保留**——它是现在唯一的显隐来源，行为完全不变（语料、多词与匹配、无结果提示均照旧）。
  - 连带移除 `markAdvanced()` 与各处 `advanced` 标记；`applyFilters()` 由「视图 + 搜索」两段裁决收缩为纯搜索裁决，栏级裁决仍与逐单元裁决同趟完成：只命中右栏时整条左栏隐藏，右栏因栅格 `auto-fit` 折叠空轨道自动占满整宽。
  - CSS 删除 `.ws-di-view-switch` 的三条规则并从按钮分组选择器中摘除；`.ws-di-tools` 现在只装一个搜索框，故去掉不再需要的 `flex-direction: column`。
  - `simple` / `advanced` 两条文案随之停用，但**不从 locale 删除**：面板存在大量动态键消费（`label(key, …)` 的键来自数组与对象，如 `["simple","simple"]`、`` label(`issues.${issue}`) ``），键名不以字面量出现在代码里，静态判据无法可靠区分死键与动态键（宽判据报 0 个死键、严判据误报 32 个），误删风险大于收益。
  - 缓存破坏：`device-info.js` `?v=13 → 14`、`device-info.css` `?v=10 → 11`（后者在 `extension.json` 与 `web/device-info.js` 内成对递增）。
  - 体积：主 JavaScript **1380.0 → 1377.6 KiB**（余 38.4 KiB）、样式 **238.1 → 237.6 KiB**（余 12.4 KiB），预算内。

- **设备面板合并同类项：删掉重复的「概览」卡，并把「Torch」与「PyTorch」合为一行。** 概览卡与硬件资源卡讲的是同一件事——显存、内存、各磁盘在两处各画一遍，连取值表达式都逐字相同（`numberOrNull(memory.percent?.value) ?? percentOf(...)` 在两张卡里各出现一次），并排只会让人怀疑哪里渲染错了。
  - 合并为一张「硬件资源」卡，卡内自顶向下为「磁贴行（一眼可见的占用率）→ GPU 体征区块 → 处理器」，磁贴与 GPU 区之间以一道分隔线划开。GPU 块**不再复述百分比**，只保留磁贴给不出的三层显存构成、四色图例与温度 / 功耗 / 驱动。
  - 卡片总数 6 → 5，硬件资源卡上移至环境健康度之前（它承接了原概览卡的位置职责）。简洁版因此由四张卡收敛为三张。
  - 合并后 `usageRow()` / `percentText()` 两个函数与 `.ws-di-usage-row` / `.ws-di-percent` 两条样式规则失去全部引用，一并删除（`.ws-di-percent` 同时带走了它的两档配色变体）。
  - `Torch` 与 `PyTorch` 是同一个包被 `importlib.metadata.version("torch")` 与 `torch.__version__` 各报了一次，版本号逐字相同却在同一张卡里并排两行。保留运行环境基础区的 `PyTorch` 行（简洁版可见的关键标识），依赖清单剔除 `Torch`（6 项 → 5 项）。**仅当两个版本号一致时才剔除**：口径不同意味着它们可能不一致（源码构建或可编辑安装时 `__version__` 带本地后缀而元数据不带），那时两行并存本身就是值得暴露的信号，不该静默吞掉。
  - 缓存破坏：`device-info.js` `?v=11 → 12`、`device-info.css` `?v=8 → 9`（后者在 `extension.json` 与 `web/device-info.js` 内成对递增）。
  - 体积：主 JavaScript **1380.5 → 1380.2 KiB**（余 35.8 KiB）、样式 **237.0 → 236.8 KiB**（余 13.2 KiB），预算内。

- **设备面板：运行环境卡改左右两栏、移除「网络与启动参数」卡、环境健康度置顶。**
  - **运行环境卡一卡两栏**：左栏「环境标识」（系统 / 架构 / Python / 解释器 / PyTorch / CUDA / cuDNN / ComfyUI / Git 共九行），右栏「关键依赖」（5 项依赖版本）。原先两者纵向串成 15 行，并排后卡高只由较高的一栏决定，同样的信息少占约四成高度（实测卡高 317px，单栏排列需 406px）。依赖原靠一枚纵向小节标签划界——否则 `Git` 之下紧跟一行 `Torch` 会被读成上方 `PyTorch` 那一行的重复——改成横向分栏后这层歧义自然消失，标签转为右栏的栏标题、与左栏首行同高起排，栏间以一道竖线分隔。
  - 两栏由栅格 `repeat(auto-fit, minmax(min(100%, var(--ws-di-column-min-width)), 1fr))` 排布：窄侧栏下自动塌成单栏；简洁版隐藏整条依赖栏后，左栏还会因 `auto-fit` **折叠空轨道**而自动占满整卡宽度——因此不需要额外判断「还剩几栏」。栏级显隐并入既有的统一裁决 `applyFilters()`，与逐单元裁决同一趟完成。
  - 新增几何令牌 `--ws-di-column-min-width`（110px）。刻意取小：栅格要在容器宽 ≥ 2 倍此值时才排成两栏，取大了会让常规宽度的侧栏直接塌成单栏——这个值只负责「窄到什么程度才塌」。
  - 栏内标签不再吃 `.ws-di-label` 的 40% 固定宽（半栏放不下），改为按内容取宽并可换行，长包名不会把右侧的版本号挤成两行。
  - **移除「网络与启动参数」卡**：删除 `renderNetwork()` / `proxyText()` 与卡片注册。卡片总数 5 → 4；简洁版仍是三张。`network` / `httpProxy` / `httpsProxy` / `noProxy` / `startup` / `set` / `notSet` / `none` 这 8 条文案随之停用，但**未从 locale 删除**——`deviceInfo` 里存在大量动态键消费（`label(key, …)` 的键来自数组与对象，如 `["simple", "simple"]`、`` label(`issues.${issue}`) ``），静态文本判据只能在「几乎全活」与「误判一片」之间摆动，误删风险大于收益。
  - **「环境健康度」提到内容区首位**（原为第三位）：它是这套数据的结论，先给结论再给明细。卡片顺序现为「环境健康度 → 运行环境 → 硬件资源 → ComfyUI 路径」。
  - 分节标签不再挂在卡片直接子元素下（`dependenciesHeading()` 的唯一调用点在 `renderEnvironment`，且总落在栏内），故 `.ws-di-card > .ws-di-group-label` 已成永不匹配的死选择器，改写为 `.ws-di-column > .ws-di-group-label` 并把字号、配色一并迁入——漏掉这步会让栏标题回退成 h3 默认的 14px 正文色（此缺陷由真实浏览器验收抓出）。
  - 缓存破坏：`device-info.js` `?v=12 → 13`、`device-info.css` `?v=9 → 10`（后者在 `extension.json` 与 `web/device-info.js` 内成对递增）、`wosai-variables.css` `?v=23 → 24`（`extension.json` 与 `web/shared/dom-widget.js` 成对递增）。
  - 体积：主 JavaScript **1380.2 → 1380.0 KiB**（余 36.0 KiB）、样式 **236.8 → 238.1 KiB**（余 11.9 KiB），预算内。

- **设备面板：运行环境卡移除「操作系统」「系统架构」「Python 解释器」三行。** 这三行是「装完就不再变」的机器指纹——系统版本与架构在报错信息里总能顺带看到，解释器路径更是只有多环境串台时才需要——却占着左栏最贵的前三行。移除后左栏由九行收缩为六行（Python / PyTorch / CUDA 运行时 / cuDNN / ComfyUI / Git），卡高 317 → **230px**，比单栏排列的 319px 少近三成。
  - **只动渲染，不动数据**：后端 `system.os` / `system.machine` / `system.executable` 三项照旧采集。其中 `system.os` 仍是**活键**——导出报告的 `compactReport()` 经 `Object.entries(report.system)` + `label(key, …)` **动态**取它，与三条静态行是否渲染无关；`machine` / `executable` 两条文案随之停用，但**不从 locale 删除**，与上一轮 `network` / `startup` 等 8 条同一处置：`deviceInfo` 里存在大量动态键消费（键名来自数组与对象，如 `Object.entries(report.system)`、`` label(`issues.${issue}`) ``），静态判据无法可靠区分死键与动态键，误删风险大于收益。
  - 缓存破坏：`device-info.js` `?v=14 → 15`（`device-info.css` 未改动，故不递增）。
  - 体积：主 JavaScript **1377.6 → 1377.5 KiB**（余 38.5 KiB，缩进与注释改写抵消了大部分删减的 3 行）、样式 **237.6 KiB**（余 12.4 KiB，无变化），预算内。

- **设备面板：硬件资源的「处理器」由朴素行改为磁贴，并挪到磁盘磁贴之后。** 处理器型号是一条长文本（`AMD Ryzen 9 9950X 16-Core Processor (4.30 GHz)`），在朴素行里被右对齐挤成两行、第二行还贴到卡片边缘。它是这台机器的固定配置，和内存、磁盘一样属于「一眼扫过去」的静态信息，与占用率磁贴同处一栏比单独占一行更好扫读。
  - 新增 `textTile()`：沿用占用率磁贴的外壳（同款底色、圆角、小字标签），但**不画占用条** —— 后端并不采集 CPU 占用率，硬塞一根空条只会被读成「这项数据没加载出来」，与既有的「算不出占用率就不画 0% 空条」是同一条原则。空值同样走「不可用」降级。
  - 型号全名允许折行、不截成省略号：型号是排障时要逐字抄下来的信息。行高用新增几何令牌 `--ws-di-tile-text-line-height`(15px) —— 型号最长要折三行，行距比正文密排更易读。
  - 静态磁贴以 `is-static` 与占用率磁贴区分，验收脚本据此分流条形断言：磁贴 5 → **6** 个，其中带条仍是 5 个（+ 显存分段条），故 `progressbar` 总数仍为 6，处理器磁贴不计数。
  - 卡内顺序变为「磁贴行（显存 / 内存 / 各磁盘 / 处理器）→ GPU 体征区块」——硬件资源卡**不再有任何朴素行**。
  - 缓存破坏：`device-info.js` `?v=15 → 16`、`device-info.css` `?v=11 → 12`（后者在 `extension.json` 与 `web/device-info.js` 内成对递增）、`wosai-variables.css` `?v=24 → 25`（`extension.json` 与 `web/shared/dom-widget.js` 成对递增）。
  - 体积：主 JavaScript **1377.5 → 1378.4 KiB**（余 37.6 KiB）、样式 **237.6 → 238.1 KiB**（余 11.9 KiB），预算内。

- **设备面板：硬件资源卡的「处理器」磁贴由行末提到行首**（承接上一条，最终顺序以本条为准）。处理器答的是「这台机器是什么」，显存 / 内存 / 磁盘答的是「现在占用多少」——先给机器身份再给实时指标，与「环境健康度置顶」是同一种「先结论后明细」的排布。磁贴总数与 `progressbar` 计数均不变（处理器磁贴仍为 `is-static`、不画条），实际只是把 `textTile()` 的追加位置从磁盘循环之后移到磁贴行创建之初。
  - 卡内顺序最终为「磁贴行（**处理器** / 显存 / 内存 / 各磁盘）→ GPU 体征区块」。
  - 缓存破坏：`device-info.js` `?v=16 → 17`（`device-info.css` 与 `wosai-variables.css` 均未改动，故不递增）。
  - 体积：主 JavaScript **1378.4 KiB**（余 37.6 KiB，与上一条持平——仅移动一行的追加位置与改写注释）、样式 **238.1 KiB**（余 11.9 KiB），预算内。

- **设备面板：「硬件资源」与「运行环境」互换位置。** 卡片顺序现为「环境健康度 → **硬件资源** → 运行环境 → ComfyUI 路径」。前两张卡现在都是「一眼扫读」型（结论性的健康度环形 + 硬件磁贴），两张明细卡（环境行表、路径表）跟在后面。
- **设备面板：ComfyUI 路径的打开失败现在说明原因。** 点击路径行请求后端在系统文件管理器里打开该目录——这条链路一直在（后端 `POST /wosai/device_info/open_path`，Windows 走 `os.startfile`、macOS `open`、Linux `xdg-open`），但**所有失败都只弹一句「无法打开此目录」**，把「点了没反应」这个最难排查的形态固化下来：无法区分是目录被移走、请求被浏览器判为跨站，还是自定义节点压根没加载。现按状态码给出可读的原因——404 说「目录不存在或已被移走」、403 说「浏览器拒绝了这个请求（跨站来源）」、其余附带 HTTP 状态码；服务端返回的英文原文同时写入控制台（本地化会把它抹平，排查需要它）。
  - 新增 `openPathBlocked` / `openPathMissing` 两条文案键（`locales` 键数 1343 → **1345**）。代码里的兜底文案仍为英文（与面板其它行一致），中文由 locale 承担。
  - 缓存破坏：`device-info.js` `?v=17 → 18`（CSS 未改动，故不递增）。
  - 体积：主 JavaScript **1378.4 → 1379.9 KiB**（余 36.1 KiB）、样式 **238.1 KiB**（余 11.9 KiB，无变化），预算内。

- **设备面板：移除「环境健康度」卡片与搜索框。** 把设备面板从「结论 → 扫描 → 明细」的形态改成「信息速查」形态：去掉健康度环形、issue pill 与问题清单，也去掉搜索框和基于搜索词的显隐裁决。面板现在由三张卡组成——硬件资源、运行环境、ComfyUI 路径。所有内容常显，没有折叠/隐藏。
  - 连带的清理：删除 `searchQuery`、`renderTools()`、`applyFilters()`、`searchIsActive()`；删除 8 处 `dataset.search` 搜索语料赋值；删除 `.ws-di-tools` / `.ws-di-search` 样式与 `--ws-di-ring-size` / `--ws-di-ring-width` 令牌；`load()` 里「搜索输入时跳过后台刷新」的保护随之移除（面板已无可输入文本的控件）。
  - 保留但停用（不删除 locale 键）的文案：`health` / `healthScore` / `healthy` / `issues.*` / `search` / `searchPlaceholder` / `noMatch` —— 它们或是动态键消费、或随搜索功能停用；静态死键判据在这里会误报，所以统一保留。
  - 缓存破坏：`device-info.js` `?v=18 → 19`、`device-info.css` `?v=12 → 13`（双源）、`wosai-variables.css` `?v=25 → 26`（双源）。
  - 体积：主 JavaScript **1379.9 → 1373.0 KiB**（余 77.0 KiB）、样式 **238.1 → 236.0 KiB**（余 14.0 KiB），预算内。

- `web/shared/media-preview.js` 扩展为对比节点的纯函数层：新增 `normalizeViewMode` / `resolveViewMode` / `stageAspectRatio` / `mediaSourceRatio` / `formatMediaSize` / `formatMediaBadgeLabel`，配套单测由 3 项扩到 15 项。
- 图像对比的前端载荷宽高比改由载荷尺寸先行给出（不必等图片解码），首帧不再先按 16:9 兜底再跳变。
- `WOSAI_ImageCompare` 不再无条件写 temp 副本：能通过 `/view` 直引磁盘文件时（LoadImage 之类的磁盘来源，或沿执行图反查到上游 loader 的 widget 值）直接返回 `{filename, subfolder, type}` 引用，仅对计算得到的张量落盘。少一次 PNG 编解码，也保住原始分辨率与元数据。
- 图像批次由「只取首帧」改为最多导出 10 帧（`MAX_BATCH_PREVIEWS`），载荷以 `batch` / `batch_size` / `batch_index` 描述，含每帧 `width` / `height`。
- 载荷新增 `version`（当前为 2）与 `kind` 字段；`filename` / `subfolder` / `type` 三个旧字段保持不变，现有前端无需改动即可继续工作。
- 两侧都未连接时返回 `preserve` 指令，前端可据此保留上一次预览；旧前端读到空值仍按原行为清空。
- 两侧输入类型不一致（图像 + 视频混合）时明确抛出 `TypeError`，不再产出半截预览。
- `WOSAI_ImageCompare` 移除已无用途的 `extra_pnginfo` 隐藏输入，改为声明 `unique_id`（用于沿执行图反查上游文件引用）。
- 拖拽光标由分割热区的基础态移入滑动视图态：双拼视图不再出现「有 `ew-resize` 光标但拖不动」的误导。
- 图像对比新增设计令牌 `--ws-compare-view-size`（24px）、`--ws-compare-view-icon-size`（14px）；i18n 新增 `nodes.imageCompare.views` / `viewSlide` / `viewSide` / `viewStack` / `viewAuto`。
- **图像对比的浮层控件改为闲置自动淡出，解决图标遮挡图片的问题。** 视图切换条、A/B 尺寸角标与交换按钮都是压在图像区上的绝对定位浮层——顶部条落在水平居中处（正是主体的构图重心），底部一行横跨图片过半宽度，常驻显示会持续打断观看。现改为：指针离开节点 400ms、或在图像区内静止 1800ms 后，三组控件整体淡出，指针移入、键盘聚焦、拖拽分割线、切换视图、换图任一动作都立刻唤回（动作触发后另有 1500ms 的强制可见期，避免刚点完就消失）。要点：
  - 淡出时**必须同时关闭命中**（`pointer-events: none`）：交换按钮正落在拖分割线的常用路径上，只做视觉隐藏会点到看不见的按钮。
  - 分割线、拖拽热区与十字手柄**不参与**隐藏——它们是「这是一张对比图」的语义表达，不是操作项；一并隐掉会让节点退化成一张普通图片。
  - 用 `opacity` 而非 `visibility` / `display`：`opacity: 0` 的元素仍留在无障碍树中，屏幕阅读器依旧能读到角标里的尺寸文本。键盘 Tab 到控件时由 `:focus-within` 恢复可见，选择器带 `:not(:disabled)` 以免把 disabled 交换按钮自身的降级透明度覆盖成 1。
  - 闲置态只切 `stage` 上的 `.is-idle` 类名，**完全不进入 `getWidgetHeight()` 的高度计算**，因此节点尺寸与既有高度断言不受影响（控件增删不改变节点高度）。指针移入隐藏控件原位置时不会补发 `pointerenter`，另用一次 `elementFromPoint` 补判锁定，否则会陷入「唤回 → 收起 → 按钮点不到」的循环。
  - 定时器用可重置的 `setTimeout`（不用 `setInterval`——门禁对其数量有预算），并在节点销毁时随 `cleanups` 一并清除（定时器不受 `AbortController` 管辖，不清会让订阅闭包持有整棵 DOM 子树）。

### Performance

- **前端体积优化（为 P3 视频传输控件 / P4 批次与缩放平移腾出预算余量）。** 本提交净变化：主 JavaScript **1392.3 → 1353.8 KiB**（文件数 82 → 79；预算 `mainJavaScript: 1_450_000` B ≈ 1416.0 KiB，余量 23.7 → **62.2 KiB**），样式 **230.9 → 232.0 KiB**（预算 `styles: 256_000` B = 250.0 KiB，余量 19.1 → **18.0 KiB** —— CSS 侧回收的 5.4 KiB 被本轮新增的对比视图与闲置淡出样式反超，故净增 1.1 KiB）；发布包 **162 → 162 文件**（迁出 3 个运行时零加载模块 = −3、新增 `wosai_core/media_preview.py` = +1、随附 `LICENSE-GPL-3.0` 与 `THIRD-PARTY-NOTICES.md` = +2，净变化 0）。度量口径为 `web/` 下 `.js` / `.css` 的**原始磁盘字节**，构建压缩与注释压缩均不计入，因此措施全部是「真实删减或移出发布目录」。分三步：
  1. **移出运行时零加载模块（−25.2 KiB）**：`layout-engine.js`（12.9 KiB）、`feature-registry.js`（8.8 KiB）、`layout-geometry.js`（3.6 KiB）三者均无任何 import、也未被 `extension.json` 引用，属「随包发布但启动时永不解析」的死重；`git mv` 至 `dev/frontend/` 后同时退出发布目录与体积预算。顺带把 `benchmark-frontend.mjs` 的 import 指向新路径（其布局性能预算仍需守住）。
  2. **删除确定无引用的死声明（−30.7 KiB，11 文件 / 净删 568 行）**：以「整个仓库（`web/` + `dev/` + `scripts/` + `tests/`）文本语料中标识符出现次数 == 1（仅声明处）」为判据，并用行边界法逐块测量（按顶层声明起始行切分，避免前一声明函数体内出现下一声明字面量而误切）。批量删除后按 eslint 与独立死码扫描器**迭代四轮**至收敛，逐层处理连锁暴露（删 `buildAlignItems` → `_buildSpacingGapInput` / `_resizeBtn` / `_alignBtn` → `BAR_LABELS` / `barLabel` / `hudMkBtn` / `glassT` import）。刻意保留 382 B 的**有意保留 API 面**（`hub-bar.js` 的 `showHubBar()` / `hideHubBar()` / `positionHubBarAboveNode()` 等带 `/** Compatibility bridge … */` 注释的 HTMLOverlay 公开方法），与「功能已禁用」的空实现桩（`_zoomTick()` / `_needsZoomTick()`）区分对待后者的删除。
  3. **CSS 死规则与死令牌回收（−5.4 KiB）**：采用**可证明安全**的判据——「该类名在**整个仓库**中仅出现于这一条 CSS 规则、其他任何文件（含其他 CSS 选择器）都零出现」⇒ 没有任何元素能带上该类 ⇒ 规则永不匹配。辅以两道守卫：①**选择器列表守卫**（`/* 统一禁态 */ .ws-disabled, [data-wosai-panel] [disabled], …` 这类混有纯属性选择器分支的规则整条保留）；②**动态类名排查**（确认全仓无 `classList.add(变量)` / `className = 变量` / `` `prefix-${x}` `` 形式的类名构造，故「非 CSS 语料零出现」是可靠判据）。删规则后连锁orphan的 **33 个 `--ws-*` 令牌**一并从 `wosai-variables.css` 删除（含 `--ws-sh-*` 语法高亮色、`--ws-os-*` 滑块控件尺寸、`--ws-pp-*` 预设面板尺寸等），并清理 2 处失去标注对象的分区横幅。
- CSS 规范 lint 棘轮基线 **72 → 58**（`--update-baseline` 下调）：`未使用变量` 由 13 条归零、`硬编码颜色` 27 → 26、`硬编码尺寸` 32 条不变（严重 27 → 26、重要 45 → 32）。此次下调同时**还清了上一轮 JS 死码删除所连带造成的欠账**（删除 `_syntaxColors` / `getSyntaxColors` / `_buildSpacingGapInput` 后，其消费的 `--ws-sh-*` / `--ws-lt-*` 令牌成为未使用变量，而当时只验证了 `lint:js`（eslint）未复跑 CSS 令牌 lint）。

### Fixed

- 修复设备面板**占用率缺失时被渲染成 `0%` 空条**的问题。`Number(null)` 与 `Number("")` 都等于 `0`，取值函数把「无数据」当成了「0%」，于是画出一条 `--ws-di-bar-min-fill`(2px) 的品牌橙填充并附带 `role="progressbar"` —— 肉眼与读屏都会理解成「几乎没占用」，恰好是这套可视化最不该犯的错。现于转换前先挡掉 `null` / `undefined` / `""`。此缺陷由真实浏览器验收（容量字段全空场景）发现。
- 修复设备面板新增配色在**浅色主题下不跟随切换**的问题。把颜色包一层派生令牌写在 `:root` / `[data-theme="dark"]` 块里（如 `--ws-di-segment-reserved: color-mix(in srgb, var(--ws-accent) 45%, transparent)`）时，自定义属性会在**声明处**就解析成具体颜色；而面板的 `data-theme` 是挂在面板元素上的，覆盖不到已固化的派生值——浅色主题下占用条轨道与显存分段仍是深色。现改为在**消费处**直接引用基础令牌（`background: var(--ws-surface-2)`、`color-mix(in srgb, var(--ws-text-muted) 55%, var(--ws-surface-2))`），表达式在面板作用域内重新解析；`wosai-variables.css` 中因此只保留几何令牌，并留下注释说明为何不在此处包装颜色。
- 修复画布右键菜单里 **WOSAI 四个动作被拆成「3 + 1」** 的问题（「桌面壁纸」被隔到别的扩展条目之后）。根因在 `rgthree-comfy` 的 `initializeContextMenu()`：它用一串 `idx = idx || list.findIndex(…)` 定位插入点，前两级带 `+1`（未命中得 `0`，假值会继续往下找），后两级（`"Convert to Group"` / `"Arrange ("`）**没有 `+1`**，未命中直接得 `-1` —— 而 `-1` 在 JS 里是**真值**，被 `||` 链锁死，最终 `splice(-1, 0, …)` 等价于「插到倒数第一项之前」。WOSAI 的条目恰好排在菜单数组尾部，末项（桌面壁纸）就这样被顶开了。数组层没有稳定的规避办法（谁最后包装 `getCanvasMenuOptions` 谁才说了算，扩展之间的包装次序不受我们控制），故新增 `web/shared/context-menu-coalesce.js`：在菜单渲染完成后于 **DOM 层**把画布条目重新聚成一块 —— 只搬动节点，不重建、不读写条目的属性与显隐状态，与「菜单隐藏」等功能互不干扰；思路与节点菜单既有的 DOM 收拢一致。附带补上「组后补一道分隔符」与「清掉转成悬空的分隔线」两处收尾，重复调用为幂等。
- 合并画布菜单与节点菜单**两套功能等价的 DOM 收拢实现**：`layout-toolkit.js` 此前另有一份 `_coalesceWosaiNodeMenuItems`（自带条目选择器、分隔符选择器、分隔符构造与匹配循环），与 `web/shared/context-menu-coalesce.js` 行为等价却各自维护 —— 同一处缺陷要改两遍，且只有其中一份被验收覆盖。合并后统一由 `coalesceMenuItems()` 承担，两者只以锚点策略区分（画布 `anchor:"group"` 保持组当前层级位置、节点菜单 `anchor:"top"` 一律收到最前），菜单根选择器收敛为共享模块导出的 `MENU_ROOT_SELECTOR` 单一来源。合并过程中暴露并修复了三个此前被掩盖的缺陷：①**幂等判据未考虑锚点** —— 只判断「组内是否连续」时，节点菜单在「组已连续但位置靠后」的情况下会直接返回 `false`，「一律收到最前」永远不生效，现 `anchor:"top"` 额外要求组前面只剩分隔符；②**条目数下限** —— 原先要求命中 ≥ 2 条才处理，而节点菜单在只选中一个普通节点、且收藏功能不可用时确实只注册一条 WOSAI 项，会被静默跳过，现不设下限（单条在 `anchor:"group"` 下天然「已收拢」而直接返回）；③**连续分隔线** —— 本组搬走后原位置遗留的分隔符会与新补的相邻而渲染成双线，现合并为一条。
- 新增 `web/shared/context-menu-coalesce.test.mjs`（9 项）锁定两处消费者共用同一实现、菜单根选择器单一来源、锚点策略差异、`anchor:"top"` 的幂等分支存在，以及 `normalizeMenuLabel` / `isMenuSeparator` / 非法入参安全返回；仓库外的真实 Chrome 验收同步扩展到 **50 项**，新增节点菜单的四个场景（散落条目一律收到最前、只注册一条仍收到最前、已在最前时幂等、同一形态下 `group` 不搬而 `top` 要搬）。同步 `web/layout-toolkit.js` 的缓存破坏版本号 `?v=3` → `?v=4`。
- 修复 `preset-prompt.css` 的缓存破坏版本号**双源不一致**：`extension.json` 声明 `?v=18`、而 `web/preset-prompt.js` 以 `?v=51` 加载，同一文件被以两个 URL 各取一次。现统一为 `?v=52`。
- 同步本轮改动文件的缓存破坏版本号：`wosai-variables.css` 21 → 22、`wosai-theme.css` 3 → 4（两处均在 `extension.json` 与 `web/shared/dom-widget.js` 成对更新，`check-frontend-performance.mjs` 会断言两者一致）、`layout-toolkit.css` 21 → 22、`title-note.css` 5 → 6、`device-info.css` 4 → 5、`media-tools.css` 10 → 13（`media-tools.js` 10 → 11）。
- 修复图像对比节点**滑动视图的 A/B 图层与角标左右颠倒**：B 图层原先用 `inset(0 X% 0 0)` 从右侧裁剪，导致分割线以左显示的是 B、以右显示的是 A，而左下角角标标注的是 `A`（CHANGELOG 2.1.0 已明确约定「A 为左下角胶囊、B 为右下角胶囊」）。现改为 `inset(0 0 0 X%)` 从左侧裁剪，图像内容与角标语义一致，也与新增的双拼视图（A 恒在左/上）保持一致。此缺陷由本轮像素级验收发现（几何断言无法察觉）。
- 修复图像对比节点 DOM 控件高度估算所用内边距与 CSS 不同源的问题：估算读的是 `--ws-compare-swap-size / 2`（17px），而 CSS 的 `padding-inline` 用的是 `--ws-compare-handle-size / 2`（14px），首帧按节点宽度估算时每侧偏 3px，高度契约在挂载前存在 6px 偏差。现统一读手柄令牌。
- 修复图像对比节点视图类名与 CSS 选择器不一致的问题：视图状态类若挂在根容器上，而样式选择器写的是 `.wosai-image-compare-stage.is-view-*`，双拼布局会整体不生效且无任何报错。现已统一挂在 stage 上，并由 `compare-view-contract.test.mjs` 锁定。

## [2.1.0] - 2026-09-27

### Added

- 新增 `presets/preset_prompt_catalog.json`（11 分类 × 9 条 = 99 条中英双语预设目录），作为 Prompt Manager 的默认预设源与 `preset_library.json` 的初始种子。节点默认种子取前 6 个分类（`_DEFAULT_CATEGORY_COUNT`），文件保留全部 11 类以便后续扩展。
- 图像对比节点（ImageCompare）新增分割线拖拽提示：鼠标悬停到分割线上时淡入一枚**十字准心手柄**（外圈 + 四向刻度 + 中心点，accent 配色），同时分割线两侧出现 `ew-resize` 拖拽光标，拖动期间手柄保持常亮。原 2px 细线的命中范围被加宽为可抓取的拖拽带，分割线贴左/右边缘时手柄按自身半径自动内收，不会被舞台裁切。

### Fixed

- 修复图像对比节点分割线贴左 / 右边缘时，十字准心手柄（28px）被容器裁掉一块的问题（此前滑块圆形拇指在同一位置也会被切掉 2px 呈 D 形）：节点根容器的左右内边距只有 `--ws-gap-sm`（6px），小于手柄半径 14px，且手柄原本还是舞台（`overflow:hidden`）的子元素，贴边时再被切 8px。现根容器左右内边距改为 `max(--ws-gap-sm, var(--ws-compare-handle-size) / 2)`（= 14px），并把裁剪职责从舞台下移到图像图层（舞台圆角轮廓保留、图像自带 `border-radius` 继承），分割线 / 热区 / 手柄的圆心可一直走到图像区的 0% / 100% 且完整显示。
- 修正图像对比节点 DOM 控件高度的估算偏差：原先直接用「节点宽度」当作图像区宽度，忽略了根容器左右各 14px 的内边距，控件比实际内容高（16:9 约 16px、竖幅图约 41px），图像区被 `flex:1` 拉伸后上下出现留白。现按「舞台实测宽度 ÷ 宽高比 + 上下内边距」计算（首帧未挂载时按节点宽度扣除左右内边距估算），并把舞台改为 `flex: 0 0 auto`，图像区高度严格等于宽高比。
- 修复图像对比图像区边框占位导致的恒定 1px 偏移：`border` 会把内容原点向内推 1px，使分割线与 0–100% 坐标错位；舞台边框改为内嵌 `outline`（`outline-offset` 取负边框宽度），既不占布局、不再溢出容器，也顺手修掉了右/下边框被父级 `overflow:hidden` 裁掉的问题。
- 修复图像对比节点手动缩放节点框时，图像 A/B 预览区不跟随放大缩小的问题；舞台高度现在按图像实际宽高比随节点宽度动态计算。
- 修复图像对比节点在预览区拖动分割线时，浏览器误将图片当作可拖拽对象、拖出后在新窗口打开而非移动比较分割线的问题；已禁用图片原生拖拽并阻止默认行为。
- 修复颜色预设前后端契约漂移：前端 `color-store.js` 推送的 `customSolid` / `customGrad2` / `customGrad3` 被后端静默丢弃，导致自定义预设无法跨浏览器同步；`color_presets.py` 现按 v2 结构接收并净化三类自定义预设（色标数量截断、方向白名单、色标位置钳制在 0–1）。
- 修复 `web/shared/canvas-utils.js` 裸引用宿主全局 `app` 的隐患：`app.canvas` 与 `app?.graph` 在未暴露该全局的宿主中会抛 `ReferenceError`（可选链无法兜底未声明标识符）；统一改为经 `window.app` / `comfyAPI` 解析。
- 修复 `web/shared/glass-theme.js`、`web/shared/color-theme.js` 中局部变量 `const t` 遮蔽 i18n 翻译函数 `t` 的问题（局部量重命名为 `theme` / `hsv`）。
- 清理语言包重复键（`menus.json` 的 `hubBar.favorite`、`hubBar.favNotLoaded`、`layoutToolkit.favorite`，`saveNode.json` 的 `categoryNameLabel`）。其中英文 `hubBar.favorite` 存在取值冲突（`Favorite` 被后一条 `SaveNode` 静默覆盖），移除前一条后保持原有效值不变。
- 修复 `nodeDefs.json` 中 PresetPrompt 节点的过时端口词条：删除后端已移除的 `batch_output` 输入，并改写"单条/全部输出"的过时描述。
- 移除图像对比节点中无任何 CSS 规则对应的 `is-swapped` 类切换（死类）。
- 修复 CSS 规范 linter 的两类真实误报：`t("key", "中文兜底")` 的兜底参数被当作硬编码文案，以及与后端同步的默认分类标识（`通用` / `未分类`）被当作待翻译文案。修复后 `i18n 硬编码` 误报由 30 条降为 0 条。
- 修复发布校验的 staging 目录残留：`verify_release.py` 编译校验写入的 `__pycache__` 会被 Windows 杀软/索引器短暂占用，导致一次性 `rmtree` 间歇性失败、残留的 `.wosai-release-*` 目录随后被项目完整性扫描当作源码并误报"导入文件缺失"；现改为带重试的兜底清理，并让 `check-project-integrity.mjs` 按前缀跳过该类目录。

### Changed

- 项目版本号统一升级到 `2.1.0`：`VERSION`、`wosai_core/config.py::VERSION`（单一版本源）、`pyproject.toml`、`package.json`、`package-lock.json`、`extension.json` 保持一致；`README.md` 与 `requirements.txt` 的面向用户版本标注同步为 `v2.1`，`check-version.mjs` 的 README 断言同步更新。
- 图像对比节点移除图像区下方那条独立滑块行（34px 行 + 6px 间距 → 节点总高 332 → 292px，图像区高度不变）：分割位置改由图像区内的拖拽控制——2px 分割线的命中范围加宽为 28px 热区，悬停淡入十字准心手柄；原生 `input[type=range]` 降级为 1px 隐藏控件（新令牌 `--ws-compare-range-size`），保留键盘方向键微调与 `aria-label`，键盘聚焦时点亮十字手柄作为可见焦点提示。
- 图像对比的 A/B 角标与交换按钮全部移到图像区浮层：A 为左下角毛玻璃胶囊、B 为右下角胶囊、交换按钮居中于两者之间（按钮中心 = 图像区中心，实测 Δ = 0.00px），三者圆心共线（原先各自底沿对齐、圆心差 5px，现 0.000px）；无图时三者自动淡出。
- 图像对比的分割位置统一为单一百分比变量 `--wosai-compare-split`（写在节点根容器上）：分割线（`translateX(-50%)` 使线心落在该百分比）、拖拽热区、十字准心手柄读取同一个值，在 300 / 420 / 600px 节点宽度 × 0/25/50/81/100% 分割位置下圆心相对期望位置偏差 ≤ 0.007px。
- 图像对比设计令牌调整：新增 `--ws-compare-swap-size`（34px）、`--ws-compare-range-size`（1px，隐藏滑块占位）、`--ws-compare-badge-size`（24px）、`--ws-compare-handle-size`（28px）与 `--ws-compare-handle-icon-size`（18px）；移除随滑块行一并废弃的 `--ws-compare-thumb-size` / `--ws-compare-track-height`；`--ws-compare-node-min-height` 320 → 280px（同步减去被移除的 40px 行高）。
- NodeColor 颜色预设持久化结构升级到 v2（`recent` + `customSolid` / `customGrad2` / `customGrad3`），`presets/color_presets.json` 同步升级；后端 `_MAX_CUSTOM` 与前端一致收紧为 16。
- 前端体积预算重校准：主 JavaScript 总量上限 1_400_000 → 1_450_000 字节。复核确认无"无引用"死模块（唯一候选 `web/shared/dialog.js` 自带"逐步替换历史实现"计划，属待采纳而非死代码），且单文件仍低于 107 KB 上限。
- `.gitattributes` 补充 `*.cjs` / `*.in` 的 LF 归一化；`.gitignore` 增补 `*.zip`、`comfyui_detail.log` 与运行时生成的 `presets/preset_library*.json`。
- `MANIFEST.in` 用 `prune web/node_modules` 取代对目录无效的 `global-exclude node_modules`，避免开发依赖（acorn/acorn-walk）进入 sdist。
- `pyproject.toml` 移除对不存在目录（`data/**`）且对非包目录（`web/`）无效的 `package-data` 声明，改为注释说明运行时资源经 `MANIFEST.in` / `build_release.py` 分发。
- `I18N_GUIDELINES.md` 补齐语言包层级列表（新增 `main`、`nodeDefs`）。
- `check-version.mjs` 改为校验 `wosai_core/config.py::VERSION` 并断言 `__init__.py` 的 `= VERSION` 单一版本源引用。
- `nodes/media_tools.py` 的 `WOSAI_ImageCompare` 显式声明 `RETURN_NAMES = ()`，与 `RETURN_TYPES = ()` 保持契约一致。
- `scripts/build_release.py` 将 `*.zip` 纳入排除后缀；`scripts/verify_release.py` 同步禁止归档内出现 `*.zip`。

## [2.0.0] - 2026-07-28

### Added

- 新增 CommonColor、Selector、BooleanSelector、LogicSwitch、NumberSwitch、LazyFallback、PointsEditor、ImageCompare、FirstLastFrame、GetWidget 和预设提示词等节点。
- CommonColor 提供 WOSAI 品牌色、常用色、自定义取色及 INT/HEX 双输出。
- 新增设备信息、安全路径打开、颜色预设持久化接口。
- 新增中英文界面、设计令牌、GitHub Actions 及统一质量门禁。

### Changed

- CommonColor 在 LiteGraph Classic 与 Nodes 2.0 中使用一致的自定义胶囊控件。
- SizeSelect 支持 IMAGE、MASK、LATENT、VAE 以及非固定空间压缩倍率。
- OmniSlider 的前后端动态 INT/FLOAT 类型契约保持一致。
- SaveNode 的大型拼音搜索库改为按需加载。

### Security

- 有副作用的本地接口拒绝显式跨站浏览器请求。
- 导入数据、颜色值、路径索引和设备报告均经过边界校验或脱敏。

### Quality & Hardening

- 建立前端资源体积、共享样式版本及大型依赖延迟加载门禁。
- 补充 aiohttp 请求级集成测试和 Classic / Nodes 2.0 发布回归流程。
- 将画布与节点右键菜单迁移到 ComfyUI 官方扩展菜单 API。
- 新增布局、搜索和 SaveNode 数据清洗的可重复性能基准，以及双前端节点压力测试。
- 新增确定性发布 ZIP、SHA-256 清单和隔离安装验证。
- 拆分 NodeColor 状态/定位、SaveNode 目录/搜索、IgnoreGroups 几何和 Launcher 状态/视口几何等纯逻辑模块。
- 将单个主 JavaScript 上限收紧到 107 KB，并为观察器、定时器数量建立回归预算。
- ComfyUI 资源冒烟测试递归验证共享模块；发布验证增加内部 import、重复条目和 SHA-256 检查。
- 修复 Nodes 2.0 缩放状态下 CommonColor 胶囊箭头命中坐标不一致的问题。
- 修复英文界面中 CommonColor 颜色预设胶囊及下拉菜单仍显示中文颜色名的问题。
- 修复 Preset Manager 手动缩窄后操作按钮和标签网格越出节点、单页分页控件仍占位及底部留白过多的问题；多页模式现按节点真实底边校验，Classic 与 Nodes 2.0 的分页区底部间距均不超过 12px。
- 补充 16× VAE、DeviceInfo 平台目录启动和扩展热重载生命周期测试。
- 修复 RunHighlight 缺失输入/错误状态不可达及错误高亮计时器提前停止的问题。
- 修复 NodeColor、ColorBar、TitleNote 和 SaveNode 在卸载、异步初始化与热重载期间可能残留的定时器、观察器、补丁和全局回调。
- 新增项目完整性、后端节点契约、受支持扩展回调、SaveNode 快捷键声明及 Nodes 2.0 真实缩放指针回归。
