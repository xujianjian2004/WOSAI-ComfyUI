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
  - **「运行环境」与「关键依赖」合并为一张卡，并移到内容区首位**（概览顺延至第二位）：两张卡都是「标签 + 右对齐值」的短行清单，分列首尾只让首屏平白多一道边界；合并后 `操作系统 / Python / PyTorch / Git` 与 6 项依赖版本同处一卡。卡内用一枚 h3 小节标签「关键依赖」划界（新增 `.ws-di-group-label`）——否则 `Git` 之下紧跟一行 `Torch`，会被读成上方 `PyTorch` 那一行的重复。
  - **新增「概览」卡**：显存 / 内存 / 磁盘各一块磁贴，显示占用率 + 紧凑用量 + 占用条，一屏之内先看到最该看到的数字。
  - **占用条取代三段式文本**：`20.2GB 已用 / 3.7GB 可用 / 总计 24.0GB` → `84.2%　20.2 / 24.0 GB` + 条形。分档阈值 <70% 用品牌橙、70–89% 用 `--ws-warning`、≥90% 用 `--ws-danger`，与后端 `_health()` 现有的 90% 磁盘判据**同源**，不另造一套标准。
  - **GPU 区块补上身份与体征**：显示型号（抹掉 `NVIDIA GeForce` 前缀以适配窄侧栏）、温度、功耗、驱动版本，作为 chip 排在显存条下方。
  - **显存改为三层嵌套条**：`pytorch_allocated ⊆ pytorch_reserved ⊆ smi_used ⊆ total` 是**包含**关系而非相加，分段后「驱动占了 20.2 GB、PyTorch 只认领 1.2 GB」这类碎片问题一眼可见，并配四色图例（分配 / 保留 / 驱动已用 / 空闲）。
  - **健康度由大号数字改为环形进度**（内联 SVG + `stroke-dasharray`，随 2s 实时刷新平滑过渡），问题清单仍以 pill 呈现。
  - **数据缺档时逐级退化，绝不画 `0%` 的误导性空条**：无法计算占用率时条不渲染填充、不携带 `progressbar` 语义，文本显示「不可用」。所有条与环形均带 `role` / `aria-valuenow` / `aria-label`。
  - 复用而非重写：`.ws-di-metric`（磁贴）与 `.ws-di-gpu`（GPU 区块）本就是这次要用的形态，直接沿用并收窄子选择器；仅删除确无需要的 `.ws-di-subtitle`，并保留 `.ws-di-search` / `.ws-di-view-switch` / `.ws-di-tools` 供下一步（概览/详细切换与搜索接线）使用。
  - 新增几何令牌 `--ws-di-bar-height`(6px)、`--ws-di-bar-height-lg`(9px)、`--ws-di-bar-min-fill`(2px)、`--ws-di-swatch-size`(7px)、`--ws-di-tile-min-width`(148px)、`--ws-di-ring-size`(46px)、`--ws-di-ring-width`(5px)。**颜色令牌刻意不在变量表里包一层**，原因见 Fixed 段。
  - 缓存破坏：`device-info.js` `?v=9 → 10`、`device-info.css` `?v=5 → 7`（后者在 `extension.json` 与 `web/device-info.js` 内成对递增，本轮合并卡片后再次递增）、`wosai-variables.css` `?v=22 → 23`（`extension.json` 与 `web/shared/dom-widget.js` 成对递增）。
  - 体积：主 JavaScript **1361.0 → 1371.1 KiB**（余 44.9 KiB）、样式 **232.0 → 236.5 KiB**（余 13.5 KiB），预算内。

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
