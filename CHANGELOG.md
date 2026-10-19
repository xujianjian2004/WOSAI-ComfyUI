# Changelog

本文件记录 WOSAI-ComfyUI 的用户可见变更。版本号遵循语义化版本。

## [Unreleased]

### License

- **修复一处长期存在的 GPL-3.0 合规缺陷。** 本项目此前整体标注为 MIT，但其中 5 个前端文件（含本轮已移除的摇断，现余 4 个）实为 GPL-3.0 许可项目的衍生作品，被以 MIT 条款分发，构成许可证违规。经逐行比对量化后，现按 **GPL-3.0-or-later** 单独授权并补齐署名（本项目其余部分仍为 MIT）：

  | 文件 | 上游（许可） | 逐字相同率 | 上游独创命名命中 |
  | --- | --- | --- | --- |
  | `web/auto-connect.js` | ComfyUI-KJNodes `web/js/fillconnect.js`（GPL-3.0，kijai） | 69.6% | 39 |
  | `web/performance-mode.js` | ComfyUI-KJNodes `web/js/performance.js`（GPL-3.0，kijai） | 51.7% | 35 |
  | `web/shared/graph-utils.js` | ComfyUI-KJNodes `web/js/utility.js`（GPL-3.0，kijai） | 66.7% | 6 |
  | `web/ignore-groups.js` | Goohaitools-comfyui `web/js/nodes pass.js`（GPL-3.0，goohai） | 22.7% | ~130 |

- 新增 `LICENSE-GPL-3.0`（GPL v3 全文）与 `THIRD-PARTY-NOTICES.md`（完整署名、出处，含 MIT 来源与纯设计参考来源的区分）；`LICENSE` 增加「许可证例外说明」章节；README 增加许可证例外表。发布包现随附许可证全文与署名文件。
- 上表 4 个文件均添加 `SPDX-License-Identifier: GPL-3.0-or-later` 文件头与上游项目／作者／原始文件路径注释。
- 新增 `web/shared/licensing-consistency.test.mjs`（4 项断言）：锁定许可证文件齐备、SPDX 标识一致、署名完整，并**禁止 MIT 文件静态引用 GPL 文件**（防 GPL 反向传染）。已通过阴性验证。
- 顺带澄清两条**不构成敞口**的来源：`logic-switch`（移植自 MIT 许可的 ComfyUI-OverrideSwitch，兼容）与 `color-theme.js` / `color-core.js`（参考 ComfyUI_GJJ_Nodes 的数据结构，逐字相同率 0%，颜色与实现均为独立设计）。
- 完整审计记录见 `dev/licensing/PORTING-AUDIT.md`（该目录不随发布包分发）。

### Removed

- **移除 WOSAI 摇断（ShakeDisconnect）功能。** 删除 `web/shake-disconnect.js` 及其全部接入点：从 `extension.json` 入口与 `dev/frontend/feature-registry.js` 注销；撤销 HUB 栏开关按钮、设置中心两项（启用开关 `wosai-shakeEnabled`、触发反转次数 `wosai-shakeReversals`）；清理中英文 `menus.json` / `settings.json` 的摇断文案与提示；移除 `layout-toolkit.js` / `layout-toolkit.css` 中的摇断注释；同步清理 `check-i18n` 死键豁免、`dom-safety.test.mjs` 断言项与 `licensing-consistency.test.mjs` 的 GPL 清单。GPL-3.0 衍生文件集合由 5 个降为 4 个（`auto-connect` / `performance-mode` / `shared/graph-utils` / `ignore-groups`），并同步更新 `LICENSE`、`THIRD-PARTY-NOTICES.md`、`PORTING-AUDIT.md` 的署名与计数（README 许可证例外表同步）。

### Added

- 图像对比节点新增 3 种对比视图（底部工具栏左侧的分段控件切换，状态持久化到 `wosai_compare_view`）：
  - **滑动对比**（默认，原有行为）：单一舞台 + 可拖动分割线。
  - **左右并排**：舞台一分为二，A 占左半、B 占右半。
  - **上下并排**：A 占上半、B 占下半。
- 双拼视图的舞台宽高比按「半幅还原原图比例」动态计算（左右 ×2、上下 ÷2，并夹取到 `[0.5, 3]`），因此每半幅恰好等于素材原比例，图像零留白、零裁切；超出夹取区间时才退化为留白。
- 新增 `web/shared/compare-view-contract.test.mjs`（21 项）：把「视图类名的 JS 生产者 ↔ CSS 消费者」跨文件契约固化为回归测试（本轮即由它兜住一次类名挂错节点导致的整体布局失效）。其中 5 项覆盖闲置淡出契约：类名生产者/消费者一致、隐藏清单只含控件不含分割线、必须关掉命中、键盘聚焦兜底、闲置态不得进入高度计算且不得使用 `setInterval`。整组断言经阴性验证（逐项注入缺陷后按预期变红），并在**真实 Chrome** 中完成闲置态的渲染验收（加载真实 `media-tools.css` + 复刻节点 DOM，断言计算样式与命中测试结果）：控件 `opacity` 归零且 `pointer-events` 关闭、指针穿过控件后不再命中、分割线保持可见、键盘聚焦恢复可见、disabled 交换按钮不被误唤醒。
- 新增 `wosai_core/media_preview.py`：图像对比节点的媒体载荷构造模块（独立实现）。负责输入类型判定（IMAGE / VIDEO 鸭子类型探测）、批次导出、上游磁盘文件直引、以及视频直引/拷贝/转码三级降级。
- 新增 `tests/test_media_preview.py`（33 项）：覆盖媒体类型判定、托管目录路径解析、执行图反查、批次上限、视频 trim 回退、以及前端载荷字段契约。
- 新增 `web/shared/frontend-reachability.test.mjs`（4 项）：把「发布体积」与「启动解析体积」永久对齐——以 `extension.json` 的 29 个 JS 入口为种子求静态 import 传递闭包，断言 `web/` 下每个 `.js` 都必须落入启动闭包或按需（动态 `import()`）闭包，`web/` 之外不得存在「随包发布但运行时永不加载」的模块。该测试在落地时经阴性验证（临时放入 stray 文件后按预期失败并指名该文件）。
- 新增 `dev/frontend/README.md`：说明该目录收录「已写好、有单测、但尚未接入运行时」的前端纯函数地基（布局引擎 / 布局几何 / 功能注册表），约定不得被 `web/` 运行时模块静态 import，接线时移回 `web/shared/` 并同步本表。
- 新增 `web/shared/draggable-contract.test.mjs`（6 项）与 `web/shared/panel-builder-contract.test.mjs`（3 项），把本轮两处结构性去重固化为回归测试（详见 Fixed / Changed 段对应条目）。
- 新增 `web/shared/wheel-forward.js`：`forwardWheelToCanvas()` 把节点内 DOM 控件上的滚轮转发给画布，恢复「鼠标停在节点上也能缩放画布」，并由 `addSizedDOMWidget()` 对所有节点内 DOM widget 默认挂载；配套 `web/shared/wheel-forward-contract.test.mjs`（7 项）。
- 忽略编组节点**根治「缩放比调大后标题不跟随放大」**。第一性原理：ComfyUI 画布标题带的全部几何量都在「绘制期」与「帧首测量期」读 LiteGraph 全局常量——背景带以 `rect(0,-h,w,h)` 画在节点框原点上方、高取 `NODE_TITLE_HEIGHT`，文字基线取 `NODE_TITLE_TEXT_Y - NODE_TITLE_HEIGHT`，字体派生自 `NODE_TEXT_SIZE`；帧首 `computeVisibleNodes → updateArea → measure` 用同一常量算 `boundingRect`（命中判定 `isPointInside` 直接用它），折叠热区 `isPointInCollapse` 取「pos 上方 `NODE_TITLE_HEIGHT` 见方」。缩放比调大后 `node.size` 随档位增长，而标题恒为 30 画布像素 ⇒ 标题与可点热区相对缩水。现对本类型节点按 `wosai_ig_scale` 在这两个窗口内**临时覆盖这几个常量**（`finally` 逐一还原 + 重入守卫），让**原生标题本身**等比放大：不重复渲染 DOM 标题、不占内容高度、命中区/热区同步增大，拖动/多选/参考线一律走 LiteGraph 原生路径。
  - 五层补丁经 `patchMethod` 组合（与 rgthree/Goohai 等既有 `drawNode` 补丁共存）：`drawNode`（绘制窗口，三常量全覆盖）、`updateArea`（帧首测量窗口，`boundingRect`/`renderArea` 同步放大——只补绘制层会出现「标题带画大了仍点不中、点击穿透到下层节点」，原生拖动/多选失效）、`isPointInCollapse`（标题带放大后折叠圆点画在带中央，热区仍取 30px 见方会点空，仅覆盖 `NODE_TITLE_HEIGHT`）、`drawTitleBox`（小方块尺寸取调用点硬编码值，单独按缩放比放大）、`drawTitleText`（低缩放比 LOD 豁免，见下）。
  - **低缩放比 LOD 豁免**：ComfyUI 在画布缩放低于「最小可读字号 / (字号 × √dpr)」时进入 low_quality 模式，`drawTitleText` 直接 return 不画标题文字（dpr=2、最小字号默认 8 时阈值 ≈40.4%；本机设置为 7 时 ≈35.4%——对应用户两次反馈「缩放小于约 40% 标题文字不可见」「缩放比 1.0×、画布缩放约 40% 时标题消失」）。该阈值只按基础字号 14px 推算：缩放比 5× 的节点实际屏幕字号是基准的数倍仍被判「不可读」；缩放比 1× 时更是与所有节点标题一起消失。普通节点还有控件体可辨认，本类型是编组容器（无输入输出槽、DOM 体），标题是它唯一的画布标识；平台自身的编组原语 `LGraphGroup.draw` 画标题**就没有任何 low_quality 判断**（任意缩放保留标签）⇒ 本节点同理：补丁 `drawTitleText`，把透传的 `low_quality` 改 `false`，**只放行标题文字一项**（标题带直角简版、无投影等低质量简化仍与其他节点一致），且与缩放档无关（1× 同样豁免），全程不碰画布级 `_isLowQuality`（零全局污染）。实测（dpr=2、最小字号 7）：10%–36% 各档画布缩放下本类型标题照常绘制，同时刻 KSampler 标题正确遵循全局 LOD 隐藏。
  - Vue 模式（Nodes 2.0）标题由覆盖层渲染，自动跳过本层。配套 `web/shared/ignore-groups-title-scale-contract.test.mjs`（13 项，含阴性验证）。缓存破坏：`ignore-groups.js ?v=5 → 9`、`ignore-groups.css ?v=3 → 6`（双源）。
- 忽略编组**设置窗口随缩放比同步放大**：把弹窗视觉样式与 `zoom` 移入内层 `.wosai-ig-pop-body`（`zoom` 直接加在 `position:fixed` 元素上会连同 `left/top` 一起放大），外层 `#wosai_ig_pop` 仅作定位锚点并保持 `max-content`，使跟随器量到缩放后的真实尺寸。缩放以「视口可容纳」为硬上限并封顶 2×（4×/5× 直接放大会把弹窗撑出屏幕），缩放比滑条松手（`change`）时重算，拖动过程中不重排以免滑条从指针下跳走。
- `scripts/check-i18n.mjs` 新增**反向检查**（此前只检查「用到的键必须存在」，不检查「定义了却没人用」）：以 `web/**/*.{js,mjs,json}` 与 `wosai_core` / `nodes` 的 Python 源为语料，键名只要以①完整字符串形式出现，或②以「字面量前缀 + 运行时拼接」形式出现（`"saveText." + key`、`` `nodeDefs.${type}.display_name` ``），即视为已消费——动态键因此不会被误判。其余记为死键；**新增死键会让检查失败**，历史遗留登记在 `UNUSED_KEY_BASELINE`（218 项）里，只减不增，键被重新启用时也必须同步从基线移除（否则检查同样失败，避免基线腐烂）。判据经阴性验证（临时注入 `common.zzzTestDead` 后按预期报错并指名）。

### Changed

- 图像对比节点**移除分割线手柄图标**（原十字准心，本轮曾短暂换为 ↔ 后按反馈整体去掉）：分割线悬停与拖拽行为不变（热区与 `ew-resize` 光标保留），仅去掉圆盘图形。同步删除仅服务手柄的 `.wosai-image-compare-handle` 全部样式与孤儿令牌 `--ws-compare-handle-icon-size`；缓存破坏：`media-tools.js ?v=25 → 26`、`media-tools.css ?v=21 → 22`（extension.json / get-widget.js / media-tools.js 三处双源成对递增）、`wosai-variables.css ?v=29 → 30`（extension.json ↔ dom-widget.js）。

- 快捷对齐面板的四个方向键改为**常驻中文标签**：← → ↑ ↓ 下方永久显示「左对齐 / 右对齐 / 顶对齐 / 底对齐」，不再只在悬停时用 Tooltip 揭示（原来悬停会用 `::after` 把图标整块换成文字，指针一移开名字就没了，等于图标永远无标签）。标签改为真实 `<span>` 子元素（可被读屏朗读、高对比度下不丢），按钮转竖排、图标尺寸统一由 `--ws-lt-quick-icon-size` 控制；同步移除 `data-inline-tip` 及其悬停替换样式。标签字号与下方「等宽 / 等高 / 等尺寸」按钮统一为面板基准 `--ws-text-md`（13px），同一块面板不再出现两种正文大小。缓存破坏：`layout-toolkit.js ?v=7 → 8`、`layout-toolkit.css ?v=22 → 24`。

- **修复尺寸选择节点「取原图尺寸」在上游换图后不刷新**的问题（用户反馈：切换图片 1→图片 2 后点击取原图尺寸，预览仍显示图片 1 的旧尺寸）。根因是原图尺寸只在 `onConnectionsChange` 与首次挂载时解析并缓存到 `_ss_srcW/_ss_srcH`，而 LoadImage 换文件只替换 `node.imgs` 里的 `<img>` 元素、**连线不变**，故三个钩子一个都不触发，按钮读到的永远是上一张图；同时旧 `<img>` 的 `load` 回调可能晚于新图到达，把旧尺寸覆盖回新尺寸。现：① 点击时 `await _ssTrackSourceImage()` 重新解析（新图未解码则等 `load`，不再拿旧值硬填）；② 订阅上游 `executed` 事件，新图落盘 / latent 重建后自动重解析；③ `apply` 前校验当前挂着的仍是同一个 `<img>`，杜绝旧图回填。缓存破坏：`size-select.js ?v=10 → 11`。

- 图像对比节点改为 **rgthree 式悬停对比**：指针在图像区左右移动即实时移动分割线，**无需按下鼠标**（对照此前「必须点击/拖住分割线」）。悬停在底部视图 / 交换控件上时浮标不跟手，避免误移分割线；触摸设备无悬停，按下拖拽路径照常工作。滑动视图额外给出 `ew-resize` 光标提示可水平滑动。缓存破坏：`media-tools.js ?v=26 → 27`、`media-tools.css ?v=22 → 23`（三处双源成对递增）。

- **体积与预算**：本轮为忽略编组根治标题缩放（原生标题随缩放比等比放大 + 命中区/折叠热区同步 + LOD 豁免）与设置窗同步缩放，主 JavaScript **1415.9 → 1422.2 KiB**（工作区磁盘字节口径）。原预算 `1_450_000 B`（1416.0 KiB）在此前功能累计后仅剩 <0.2 KiB 余量，属预算用尽而非新增死码；按既有再校准惯例上调至 `1_472_000 B`（≈1437.5 KiB，余约 15.3 KiB），原因记录在 `scripts/check-frontend-performance.mjs`。样式 **236.7 → 236.8 KiB**（余约 19.2 KiB）。预算内。

- **尺寸选择节点消除底部多余的一行空白。** 上一轮为「适配 / 缩放」加了第二行（长边短边 / 倍数滑条）并让它只在用得上它的模式出现，但**节点高度仍按最高状态定值**（预设 455 / 自定义 375）：Crop 模式下第二行整行收起、内容自然高度少了 32px，这 32px 就沉到节点底部变成一条空白——用户反馈「节点底部始终多余一行空白，需要进行优化」。根因是 **ComfyUI 会把 DOM widget 拉伸占满「节点高 − 标题 − 端口行 − 两个组合控件 − 上下留白」之后的全部剩余空间（该固定占用实测恒为 174px）**，而 `.ss-wrap` 是 `height:100%` 的弹性列 ⇒ 定高一旦高于内容自然高度，差值全部变成底部空白。现 `getFixedHeight()` 按「第二行是否出现」分四档（= 174 + 内容自然高 + 4px 余量）：

  | 模式 | 第二行收起（Crop） | 第二行显示（适配 / 缩放） | 内容自然高（收起 / 显示） |
  | --- | --- | --- | --- |
  | 预设 | 417 | 449 | 239 / 271 |
  | 自定义 | 341 | 373 | 163 / 195 |

  - 切缩放方式时立刻重算节点高度（`_ssSyncMethodBtns()` 内调 `updateNodeHeight()`）；读档时按存盘的 `scale_method` 选档（`onConfigure` 读 `widgets_values[1]`，即 serialize 顺序里的第二个值）。
  - 数值全部实测得来：内容自然高度用「临时把 wrap 改成 `height:auto` 后读 `offsetHeight`」取得，且与节点宽度无关（220–400px 下五枚控制按钮均 `white-space:nowrap` + 省略号，不换行）；节点变矮后 ComfyUI 会把 DOM widget 同步重算到新的剩余空间（实测 415 → 241px），故降档不会裁内容。
  - 契约测试 `size-select-fit-contract.test.mjs` 新增 1 项（共 13 项）：四档数值必须等于「174 + 自然高 + 4」、两档之差必须正好是第二行的 32px（24px 行高 + 8px 上间距）、切方式必须触发高度重算、读档必须按 `scale_method` 选档。已做阴性验证：把四档改回单值、去掉切换时的高度重算，分别让该项变红。
  - **已在运行中的 ComfyUI 实例上端到端验收**：四态实测节点高 417 / 449 / 341 / 373，DOM widget 高 243 / 275 / 167 / 199，与内容自然高的差恒为 4px（即预留余量），全程无 page error；自定义模式下版权行紧贴预览条下方（间距 4px），不再悬在节点中段。缓存破坏：`size-select.js` `?v=9 → 10`。

- **尺寸选择节点新增第三种缩放方式「适配」（Fit）：不变形、不裁剪地把整图等比装进目标框。** 此前的 `scale_method` 只有二选一——`Crop`（先按目标比例中心裁剪、再拉伸到目标尺寸，**会裁掉内容**）与 `Scale`（按倍数缩放，**不看目标尺寸**）；想要「保持原比例又落在目标画幅内」只能先手算尺寸再走自定义，属于能力缺口。现补齐第三种：
  - `nodes/size_select.py`：`scale_method` 组合改为 `["Crop", "Fit", "Scale"]`，新增 advanced 输入 `fit_edge`（`["Long", "Short"]`，默认 `Long`）。`_fit_scale(src, target, fit_edge)` 给出等比系数——`Long` = contain（`min(tw/sw, th/sh)`，整图装入、任何一边都不超出），`Short` = 短边贴齐（`min(tw,th)/min(sw,sh)`，短边填满目标、长边按比例超出，即 cover 但不裁剪）。`_resize_image_and_mask` 只在 `Crop` 下裁剪（Fit 与 Scale 一样是纯等比缩放，倍率由目标框算出而已）。
  - **没有 image / latent 就没有基准**：此时 Fit 退化为直接使用目标尺寸（与 Crop 同结果），不会抛异常也不会产出 0 尺寸。
  - Fit 出来的宽高同样过 `_align_grid()`——本节点自己产 latent，像素必须能被压缩率整除，否则 latent 形状只能靠整除截断、与输出的 width/height 对不上。
  - `web/size-select.js`：控制行由 4 枚按钮扩为 5 枚（预设｜自定义｜裁剪｜适配｜缩放），`_ssSyncMethodBtns()` 三枚互斥高亮；**「长边 / 短边」复用缩放滑条那一行**（互斥出现：Scale 显示滑条、Fit 显示两枚按钮、**Crop 整行收起**）——不为适配边新增一行，节点高度按该行是否出现分档（见上文「消除底部多余的一行空白」）。Fit 下该行不再响应拖拽与滚轮（否则会误改缩放倍数）。
  - **第二行只在用得上它的模式出现。** 首版把 Crop 模式做成「整行锁定」：滑条内容虽被隐藏，行本身仍以 `opacity:.4` 挂着一个**空药丸**白占一块地方；更糟的是 Fit 模式下行是活的（按钮可点），却同样被压成 .4 的禁用相。现改为 `ss-hidden` 整行折叠（`margin` 一并归零，不留缝）， Crop 下直接消失；随之 `.ss-disabled` 样式与 JS 切换都已不可达，**连规则一起删掉**，不留死样式。
  - 预览与后端**同源复算**：新增 `_ssFitScale()`（与 `_fit_scale` 同口径），Fit 分支按 `scaleAlign(src × 系数, step)` 出尺寸——这正是本节点此前反复踩坑的地方（舍入口径、网格口径都曾前后端分叉），预览一旦各算各的就会骗人。
  - `fit_edge` 已进 `IS_CHANGED` / V3 `fingerprint_inputs` / `serialize`（V1 签名与前端 `coreWidgets` 顺序一一对应，错位会让所有 widget 的值串味），保存再打开不会丢回默认。
  - 新增 `web/shared/size-select-fit-contract.test.mjs`（13 项）锁定：三选一口径（V1/V3 双 schema）、`fit_edge` 双 schema 且 advanced 且默认 Long、缓存指纹含 `fit_edge`、contain/cover 两个公式与除零保护、Fit 分支仍走 `_align_grid`、Fit 不裁剪、前端公式与后端同源、三按钮互斥、适配边复用同一行、**第二行只在用得上它的模式出现且 `ss-disabled` 不得复活**、序列化顺序、i18n 双语言齐备且每个键都被消费（已做阴性验证：删掉 Fit 选项、改错 cover 公式、把适配边组改成常驻显示、把整行折叠改回 `ss-disabled` 压灰，分别让 4 项变红）。Python 侧新增 `SizeSelectFitModeTests`（4 项）。缓存破坏：`size-select.js` `?v=8 → 9`；`os-size.css` 双源 `?v=3 → 4`。
  - 以上改动**已在运行中的 ComfyUI 实例上做端到端验收**（真实 Chrome + 真实 `os-size.css`）：创建 `WOSAI_SizeSelect` 节点，依次点击裁剪 / 适配 / 缩放 / 裁剪，实测计算样式——Crop 下第二行 `display:none`、行高 0、`margin-top:0`（连缝都不留）；Fit 下该行 `display:flex`、行高 21.6px、`opacity:1`（不再被压灰），组内「长边」带 `active`；Scale 下滑条与「原图 ×1.0」标签恢复显示。三种状态的截图已逐张核对。
- **尺寸选择节点手动模式新增「取原图尺寸」一键按钮。** 节点此前已经为 Scale 预览解析过上游 image / latent 的尺寸（`_ssTrackSourceImage` 填 `_ss_srcW/_ss_srcH`），但手动模式只能把尺寸**一个数字一个数字敲进去**——要对齐上游图，得先看图、再心算、再输入，还要自己按对齐粒度取整。现手动面板并排两枚等宽按钮：「取原图尺寸」把解析到的源尺寸填入自定义宽高（按当前对齐粒度取整，复用预览同一个 helper，保证回显与后端产出不可能不一致），旁边是原有的「互换宽高」。**未接上游时按钮置灰**（置灰且不响应 hover）——点了没反应的按钮比没有按钮更糟；禁用态由 `syncPreview()` 刷新，而它本来就会在连线上/下线时跑。新增 `web/shared/size-select-source-size-contract.test.mjs`（5 项，阴性验证：去掉 `useSrcBtn.disabled = !has` 后第 3 项变红）。缓存破坏：`size-select.js` `?v=6 → 7`；`os-size.css` 双源 `?v=1 → 2`。
- **修正尺寸选择节点三处正确性缺陷（空 latent 形状与回显尺寸不一致 / 写死的 8 倍数校验 / 只接 mask 时遮罩被静默丢弃）。**
  - **空 latent 与节点回显的 width/height 不一致。** 旧实现里 `processing_ratio = latent_ratio if has_latent or has_vae else 1`：没接 latent / VAE 时尺寸只按 `align_multiple` 对齐，而空 latent 却按 `// latent_ratio`（8）建造。实测 `align_multiple=3`、输入 1023 → 节点回显 1023×1023，产出的 latent 却是 127×127（即 1016×1016），**差 7px，下游采样器按 1016 画**。本节点自己产 latent ⇒ 像素必须能被压缩率整除，与接不接东西无关；现三条路径（预设 / 自定义 / Scale）统一走 `_align_grid(value, multiple, ratio)`，无 latent / VAE 时压缩率按 8 计，接了 VAE 自动取真实值（如 16× 模型）。
  - **`custom_width % 8 != 0` 的硬编码校验与可配的 `align_multiple` 直接矛盾。** 用户把对齐粒度设成 3，输入 1023（合法：落在 lcm(3,8)=24 的 1032 上）却被「宽度必须是 8 的倍数」拒掉。现 `VALIDATE_INPUTS` 只校验「整数 / ≥256」，倍数约束完全交给对齐逻辑。
  - **只接 mask（无 image / latent）时遮罩被静默丢弃。** 旧代码的 mask 处理挂在 `has_image` / `has_latent` 分支里，单独接入的 MASK 既不缩放也不输出。现补 mask-only 分支：按目标尺寸缩放遮罩并输出，`image=None`；2D mask 保持 2D。
  - Python 侧新增 `SizeSelectLatentConsistencyTests`（2 项）与 `SizeSelectMaskOnlyTests`（2 项）；`size-select-align-contract.test.mjs` 同步收紧（`_align_grid` 调用点 ≥3、禁止 `_aligned_dimension` 复辟、禁止对齐挂回 `has_latent` 分支）。已做阴性验证：还原旧 `processing_ratio` 表达式后一致性测试变红，还原 `%8` 校验后契约测试变红。
- **尺寸选择节点（SizeSelect）取消自定义模式的最大尺寸限制。** 此前自定义（手动）模式把宽高夹到 `resolutions.json` 的 `max_dimension`（2048）：后端 `_determine_target_size` 做 `min(MAX_DIMENSION, …)`、`VALIDATE_INPUTS` 直接报错拒绝、两个 INT 端口声明 `max=MAX_DIMENSION`、前端 `roundTo8(v, MAX_DIMENSION)` 还会把输入框里刚敲进去的数值改写回 2048——四条限制并存，用户无法输入更大的尺寸。与之矛盾的是 `Scale` 模式本就不设上限（注释即写明「Scale 模式不限制上限」），同一节点两种模式口径不一致。现统一为**自定义模式不再受 2048 限制**，与 `Scale` 模式对齐，仅保留 8px 网格对齐与最小值（256）约束；UI 侧的输入上限显式声明为 16384（ComfyUI 通用分辨率口径），后端计算与校验仍不夹任何上限。配套改动：
  - `web/data/resolutions.json`：`max_dimension` 改名为 `default_custom_height`（该值此后只作为「新建节点时自定义高度」的初始值，不再是上限），`scripts/check-shared-data.mjs` 的断言同步改名。
  - `nodes/size_select.py`：V1 `INPUT_TYPES` 与 V3 `_io.Int.Input` **显式声明 `max=MAX_DIMENSION`（16384）**；`_determine_target_size` 手动分支只做 `max(MIN_DIMENSION, …)`；`VALIDATE_INPUTS` 不再因「超过上限」报错，改为只校验「必须是整数 / ≥256 / 8 的倍数」，并顺手修掉旧实现在 `Custom_Width` 为 `None` 时抛 `TypeError` 的隐患。
  - `web/size-select.js`：`roundTo8` 不再接受上限参数（只按最小值约束 + 8px 对齐）；初始播种 `Custom_Width` / `Custom_Height` 时不再夹上限。缓存破坏：`size-select.js` `?v=3 → 4`。
  - 新增 `web/shared/size-select-manual-limit-contract.test.mjs`（6 项）锁定：JSON 不再有 `max_dimension`、`roundTo8` 无上限参数也无 `Math.min` 夹取、三处调用点不再传上限、Python 手动分支无上限夹取、两侧 INT 端口**显式声明大于 2048 的 `max`**、校验仍保留最小值与 8px 约束（已做阴性验证：把 `roundTo8` 改回带上限的版本后第 2 项变红；把 `MAX_DIMENSION` 调成 1024 后第 5 项变红）。Python 侧新增 4 项单测（4096×8192 原样通过、低于最小值抬到 256 且 4100 对齐到 4096、8192×8192 校验通过、128 / 4097 仍被拒）。
  - ⚠️ 提示：**超大尺寸会显著增加显存 / 内存占用**（无输入时会直接按目标尺寸分配空 latent），请按显存容量设置；`README.md` 同步说明。
- **尺寸选择节点借鉴 ComfyUI 原生 `ResolutionSelector`，重做「网格对齐」并新增面积回显。** 原生节点的三个控制量是正交的：**比例决定形状 → megapixels 决定面积 → multiple 决定网格粒度**（`scale = sqrt(mp·1024²/(wr·hr))`，再 `round(v/m)·m`）。对照后本节点有四处可改进，本轮一次性落地：
  - **对齐改为四舍五入（`round`）而非向下取整（`floor`）。** 旧的 `_r8` / `_aligned_dimension` 都是 `floor`，尺寸系统性偏小最多 7px，Scale 模式连续取整还会累积；现统一为 `_align()`（`round`，与原生同口径）。因为 Python `round()` 是银行家舍入、前端 `Math.round()` 不是，前端同步换成 `roundHalfToEven()`——否则 `.5` 处预览会比执行结果大一个步长（正是原生 `WidgetResolutionPreview` 里那个 `roundHalfToEven` 的用意）。
  - **对齐粒度提为 advanced 输入 `align_multiple`（默认 8，1–128）。** 原生 `multiple` 的语义是「VAE 下采样率」而非越大越好；本节点此前硬编码 8，只在 `has_latent or has_vae` 时才改用 VAE 压缩率，三条路径口径不一致。现统一为 `_align_grid(value, multiple, ratio) = _align(value, lcm(multiple, ratio))`：像素既要落在粒度网格上，也要能被 latent 压缩率整除（否则 latent 形状只能靠整除截断、与输出的 width/height 对不上）。V1 `INPUT_TYPES` 与 V3 `_io.Int.Input` 均已声明，`serialize` 也已带上该 widget，保存再打开不会丢回默认。
  - **回显真实像素总量与 latent 网格。** 原生用 `ResolutionPreview` widget 在前端同源复算并显示真实 MP——对齐后的尺寸通常不等于设定值，不显示就等于默认「和你想的一样」。本节点此前只显示 `1920 × 1080`，而**同一档位切换宽高比时面积并不守恒**（FHD：1:1 = 1.00 MP，16:9 = 1.98 MP，21:9 = 2.64 MP，跨度 2.64×），用户却以为都叫「1080P」。现底部预览追加 `· 1.50 MP · latent 192 × 128`，超过 4 MP 转警示色、超过 8 MP 转危险色（**提示而非硬夹**，上限形态仍留给面积预算而不是单边像素）。
  - 新增 `web/shared/size-select-align-contract.test.mjs`（7 项）锁定：前后端舍入同源、默认粒度一致、`_align` 不 floor、`_lcm` 与三条路径统一、V1/V3 都声明 `align_multiple`、`serialize` 不漏新 widget（已做阴性验证：把前端改回 `Math.floor` 后第 1 项变红）。Python 侧新增 `SizeSelectAlignGridTests`（4 项）。缓存破坏：`size-select.js` `?v=4 → 5`。
- **尺寸选择节点底部预览：去掉「尺寸预览」标签，保证单行不再横向溢出。** 上一版预览把「尺寸预览 + 宽高 + 面积 + latent 网格」全塞在一行：节点最小宽度 220px，去掉左右内边距后仅约 204px 可用，而这一行约 330px，宽度方向必然撑出节点框。现按「内容优先级」重排为 `1920 × 1080  1.98 MP · latent 240 × 135`：
  - **删掉装饰性标签「尺寸预览」**：四个字要吃掉约 44px，且「宽 × 高」本身已自解释，不需要额外说明。该 i18n 键（`menus.sizeSelect.imageDimensions`，zh/en）与 `.ss-preview-lbl` 样式一并删除（否则 i18n 反向检查报新增死键、CSS 出现死规则）。
  - **面积与 latent 网格改用更小字号（`--ws-text-xs`）**，横向内边距由 12px 收到 8px，让出约 24px。
  - **兜底不再依赖「刚好放得下」**：药丸本身 `overflow: hidden`，两个文本 span 都可收缩（`flex: 0 1 auto` + `min-width: 0` + `text-overflow: ellipsis`）——flex 项默认 `min-width: auto` 会顶开容器，必须显式归零。节点被拖到极窄时从**尾部**省略，顺序即优先级：面积比 latent 网格重要，先舍掉后者；完整串挂到 `title` 上仍可取回。
  - `size-select-align-contract.test.mjs` 新增 2 项契约（标签与 i18n 键已清除、单行高度 + 溢出兜底 + 两个 span 都能收缩；已做阴性验证：删掉 `.ss-preview` 的 `overflow: hidden` 后该项变红）。缓存破坏：`size-select.js` `?v=5 → 6`；`os-size.css` 此前**没有版本号**（只能靠硬刷新），现补上 `?v=1`（extension.json + size-select.js 注入处）；`wosai-variables.css` 双源同步 `?v=28 → 29`。
- **修正「去掉后端 `max` 后实测仍卡在 2048」。** 上一条把两个 INT 端口的 `max` 一并删掉，实测自定义宽高最大值仍是 2048。根因不在本仓库：ComfyUI 前端 `useIntWidget()` 里写死了 `{ min: spec.min ?? 0, max: spec.max ?? 2048, … }`——**省略 `max` 不等于「无上限」，而是被前端兜底成 2048**。也就是说「不声明 max」恰好等价于「上限 2048」，删得越干净、卡得越死。现改为显式声明 `MAX_DIMENSION = 16384`（与 ComfyUI 官方 `MAX_RESOLUTION` 同口径，`EmptyLatentImage` 等节点一致），既喂给 UI 一个真实上限，又保留后端对更大值的宽容（API 调用不受此值限制）。注释已写在常量旁，避免后来者再「顺手删掉」。`README.md` 的手动宽高说明同步更新。

- **忽略编组节点的默认排序改为「按字母」。** 位置排序会随画布布局变化而跳动——拖动一个编组，列表顺序就跟着变，编组一多便无法预期；字母序是稳定可预期的顺序。改动只影响默认值：新建节点与「一键恢复默认参数」均落在按字母，面板分段控件同步显示；**已在工作流里显式保存过 `wosai_ig_sort_order` 的旧存档不受影响**（显式取值优先于默认值），仍可手动切回按位置。新增 `web/shared/ignore-groups-defaults-contract.test.mjs`（5 项）锁定默认值、非法值回落方向、`resetAll` 的状态与控件同步，以及两个排序选项都仍然提供。缓存破坏：`ignore-groups.js` `?v=4 → 5`。

- **图像对比节点视觉对比度与圆角调整。** 橙色品牌色（`--ws-accent`）在暖色调主体图片上融为背景，导致分割线与底部活跃按钮看不清：现把分割线、十字手柄悬停态、底部视图按钮 / 交换按钮的 active 态统一改为主文本色（`--ws-text`），在深浅主题下均为最高对比度，并保留 12% 透明主文本色作为 active 背景以区分 hover。同时把图像区四角从 `--ws-radius-lg`（12px）改为直角，让画幅完整呈现、不再被圆角裁切；双拼视图的内 / 外侧圆角同步归零。`compare-view-contract.test.mjs` 新增 4 项契约断言（直角舞台 / 直角图片层 / 主文本色分割线 / 主文本色活跃控件）并同步更新双拼圆角断言。缓存破坏：`media-tools.css` `?v=18 → 19`。
- **图像对比节点预览改为按 RGB 取图，与执行侧张量同源（修「看着是遮罩 vs 最终图」）。** 现象是 A 侧出现一块矩形「遮罩」：取证后确认 A 侧接的是 Clipspace 涂抹产物（`clipspace-painted-output-*__ghm-original-red-*`），这类文件把涂抹区挖成 alpha=0，但**底下的 RGB 一字未改、仍是原图内容**（实测与同批 `clipspace-painted-*.png` 逐像素相同，最大差 0）。`/view` 默认按 rgba 返回，透明区于是透出舞台底色，看着像遮罩；而执行侧 `LoadImage` 会 `convert("RGB")` 丢掉 alpha——节点真正比对的其实是完整原图，即**「看到的」与「正在比对的」不是同一张图**。现新增 `opaqueImageUrl()`：给 `/view` 补上 `channel=rgb`（服务端只丢 alpha、保留 RGB，与 `convert("RGB")` 等价），并同时覆盖两条取图路径——载荷 / 缓存拼出来的 URL，与上游预览元素自带的 URL（`upstream.imgs[0].src`）；`blob:` / `data:` 出图与非 `/view` 路径原样放过，旧服务端不认该取值时回落为原样返回，行为不劣化。`compare-view-contract.test.mjs` 新增 1 项契约断言（改写取值、两条路径覆盖、非 `/view` 出图不改写、URL 仍只算一次）。缓存破坏：`media-tools.js` `?v=22 → 23`。
- **图像对比节点初始态改为紧凑形态，并支持上游直读自动预览（无需重跑工作流）。** 对照 rgthree-comfy 图像对比节点：两侧均无素材时，控件高度收为 0，节点只剩标题 + 两行输入端口（图像 A / 图像 B），不再垫一块永远填不满的 16:9 空白舞台；任一端口接入素材即整块展开，尺寸仍由舞台宽高比换算接管（紧凑态的最小高度下限同步改为「有图才夹、无图不夹」，避免收起后下方撑出空白）。接入上游节点时自动出图的三条路径全部打通：①连线变动（`onConnectionsChange`）②打开 / 粘贴工作流（`onAfterGraphConfigured`，早于连线建立，故不能只挂 `onConfigure`）③上游单独执行（订阅 `api` 的 `executed` 事件）；素材取自前端执行缓存 `app.nodeOutputs`，按 `nodeOutputLocatorKeys()` 列出的「最具体 → 最宽松」三种定位符键（`rootGraphId:nodeId` / `~root:nodeId` / 裸 `nodeId`）逐个试探以兼容不同前端版本，并用 `upstreamToken` 防连续拖线竞态、用 URL 复用（`imageUrl` 优先返回 `data.url`）防重复请求。节点销毁时摘掉 `executed` 监听并删除 `__wosaiCompareRefreshUpstream`。i18n 同步：删除不再使用的 `imageCompare.empty` 键（否则反向检查报新增死键），把 `imageCompare.incomplete` 文案改为「连接一张图像到另一侧 / Connect an image to the other side」。缓存破坏：`media-tools.js` `?v=21 → 22`。**另修紧凑态的一处观感缺陷**：舞台元素本身此前照旧渲染（只把高度算作 0），而舞台自带背景与一像素轮廓、内部还挂着分割线，于是节点底部残留一条「黑条 + 中间一根白竖线」的切片，看着像多出来又点不动的控件；现把紧凑态的整块舞台一并收起（`:not(.has-first):not(.has-second) .wosai-image-compare-stage { display: none }`，stage 是 root 的唯一子节点），紧凑态真正只剩标题与两行输入端口。缓存破坏：`media-tools.css` `?v=19 → 20`（extension.json / media-tools.js / get-widget.js 三处同步）。
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

- `web/shared/media-preview.js` 扩展为对比节点的纯函数层：新增 `normalizeViewMode` / `stageAspectRatio` / `mediaSourceRatio`，配套单测由 3 项扩到 10 项。
- 图像对比的前端载荷宽高比改由载荷尺寸先行给出（不必等图片解码），首帧不再先按 16:9 兜底再跳变。
- `WOSAI_ImageCompare` 不再无条件写 temp 副本：能通过 `/view` 直引磁盘文件时（LoadImage 之类的磁盘来源，或沿执行图反查到上游 loader 的 widget 值）直接返回 `{filename, subfolder, type}` 引用，仅对计算得到的张量落盘。少一次 PNG 编解码，也保住原始分辨率与元数据。
- 图像批次由「只取首帧」改为最多导出 10 帧（`MAX_BATCH_PREVIEWS`），载荷以 `batch` / `batch_size` / `batch_index` 描述，含每帧 `width` / `height`。
- 载荷新增 `version`（当前为 2）与 `kind` 字段；`filename` / `subfolder` / `type` 三个旧字段保持不变，现有前端无需改动即可继续工作。
- 两侧都未连接时返回 `preserve` 指令，前端可据此保留上一次预览；旧前端读到空值仍按原行为清空。
- 两侧输入类型不一致（图像 + 视频混合）时明确抛出 `TypeError`，不再产出半截预览。
- `WOSAI_ImageCompare` 移除已无用途的 `extra_pnginfo` 隐藏输入，改为声明 `unique_id`（用于沿执行图反查上游文件引用）。
- 拖拽光标由分割热区的基础态移入滑动视图态：双拼视图不再出现「有 `ew-resize` 光标但拖不动」的误导。
- 图像对比新增设计令牌 `--ws-compare-view-size`（24px）、`--ws-compare-view-icon-size`（14px）；i18n 新增 `nodes.imageCompare.views` / `viewSlide` / `viewSide` / `viewStack`。
- **图像对比的浮层控件改为闲置自动淡出，解决图标遮挡图片的问题。** 控件都压在图像区上，常驻显示会持续打断观看（尤其落在水平居中处——正是主体的构图重心）。现改为：指针离开节点 400ms、或在图像区内静止 1800ms 后，三组控件整体淡出，指针移入、键盘聚焦、拖拽分割线、切换视图、换图任一动作都立刻唤回（动作触发后另有 1500ms 的强制可见期，避免刚点完就消失）。要点：
  - 淡出时**必须同时关闭命中**（`pointer-events: none`）：交换按钮正落在拖分割线的常用路径上，只做视觉隐藏会点到看不见的按钮。
  - 分割线、拖拽热区与十字手柄**不参与**隐藏——它们是「这是一张对比图」的语义表达，不是操作项；一并隐掉会让节点退化成一张普通图片。
  - 用 `opacity` 而非 `visibility` / `display`：`opacity: 0` 的元素仍留在无障碍树中，屏幕阅读器依旧能读到角标里的尺寸文本。键盘 Tab 到控件时由 `:focus-within` 恢复可见，选择器带 `:not(:disabled)` 以免把 disabled 交换按钮自身的降级透明度覆盖成 1。
  - 闲置态只切 `stage` 上的 `.is-idle` 类名，**完全不进入 `getWidgetHeight()` 的高度计算**，因此节点尺寸与既有高度断言不受影响（控件增删不改变节点高度）。指针移入隐藏控件原位置时不会补发 `pointerenter`，另用一次 `elementFromPoint` 补判锁定，否则会陷入「唤回 → 收起 → 按钮点不到」的循环。
  - 定时器用可重置的 `setTimeout`（不用 `setInterval`——门禁对其数量有预算），并在节点销毁时随 `cleanups` 一并清除（定时器不受 `AbortController` 管辖，不清会让订阅闭包持有整棵 DOM 子树）。
- **图像对比：分割线方向改为「拖动方向 = 画面呈现的图」。** 此前滑动视图下 0%（最左）显示的是 B、100%（最右）显示的是 A，与「把分割线从 A 拖到 B，画面就该从 A 过渡到 B」的直觉相悖。现为：**拖到最左端 = 整张 A、最右端 = 整张 B**，中间位置时分割线左侧为 B、右侧为 A。
  - 实现上只调换图层分配：底层铺满、占据分割线左侧，上层 `clip-path: inset(0 0 0 X%)` 只保留右侧，因此**底层放 B、上层放 A**，裁切公式本身一行未改。照字面按 A/B 顺序分配（底层 A / 上层 B）会让整套方向反转，且双拼视图（底层占左/上半幅）会跟着一起反，切换视图时左右对调。
  - **移除底部 A/B 角标与尺寸标注**（`.wosai-image-compare-label` 及全部样式、已无消费者的 `formatMediaBadgeLabel` / `formatMediaSize`、`--ws-compare-badge-size` 令牌）：角标该标「端点」（左 A 右 B）还是标「所在面板」（左下会随图层反转成 B）两难，任何一版都与拖动方向自相矛盾，故改为不显示——方向只由拖动本身表达，A/B 身份由交换按钮承担。
  - **左右 / 上下并排视图同步改为 A 占左/上半幅、B 占右/下半幅**（CSS 半幅分配反转），否则并排时会出现「左半幅写着 A 却显示 B 图」；并排视图没有分割线，不与拖动语义冲突。
  - `compare-view-contract.test.mjs` 新增方向契约断言（底层 = `display.b`、上层 = `display.a`、双拼半幅与圆角归属），删除角标归位与尺寸标注两组断言，并加哨兵断言锁住「JS / CSS 中不得再出现 `wosai-image-compare-label`」（21 → 20 项）；**真实 Chrome** 命中测试验收：0% 整屏 A、50% 左 B 右 A、100% 整屏 B、`side` 左 A 右 B、`stack` 上 A 下 B。
  - 体积：主 JavaScript **1373.4 → 1372.0 KiB**、样式 **236.0 → 234.4 KiB**，预算内。
  - 缓存破坏：`media-tools.js` `?v=11 → 14`、`media-tools.css` `?v=13 → 15`、`wosai-variables.css` `?v=26 → 27`（后两者在 `extension.json` 与 `web/media-tools.js` / `web/get-widget.js` / `web/shared/dom-widget.js` 内成对递增）。
- **移除「自动排布」对比视图，保留滑动 / 左右 / 上下三种。** 自动排布按素材宽高比在运行时择向，同一张图换个批次就可能换方向，用户无法预期也不好描述；三种显式视图已覆盖全部使用场景。
  - `COMPARE_VIEW_MODES` 收缩为 `["slide", "side", "stack"]`，删除 `resolveViewMode()`（无 `auto` 后它就是 `normalizeViewMode()` 的别名）；`state.resolvedView` 这一「运行时解析结果」字段随之删除，视图模式即实际布局。
  - 删除 `auto` 图标、`viewText()` 的 `auto` 分支与 `viewAuto` i18n 键（zh/en 同步）。**旧工作流里已存下的 `wosai_compare_view = "auto"` 由 `normalizeViewMode()` 自动回落为滑动视图**，不会退化成「没有任何视图类名」的裸状态（那样双拼 CSS 与分割线会同时失效）。
  - `compare-view-contract.test.mjs` 新增哨兵断言：`viewAuto` 不得再出现、`COMPARE_VIEW_MODES` 不得再含 `"auto"`、`resolveViewMode` 不得复活；`media-preview.test.mjs` 删除 3 组 `resolveViewMode` 测试、新增「旧值 `auto` 回落 slide」（15 → 10 项）。
  - 缓存破坏：`media-tools.js` `?v=14 → 15`（CSS 未改动，故不递增）。
- **图像对比的 A/B 交换按钮改为正圆并缩小**：尺寸 `--ws-compare-swap-size` `34 → 28px`、图标改用新的 `--ws-compare-swap-icon-size`（16px，原为通用 `--ws-media-action-icon-size` 18px），圆角由 `--ws-radius`（8px 方角）改为 `--ws-radius-full`（50% 正圆），与顶部视图切换条的胶囊按钮同属一套圆形语汇；按钮更小后对画面的遮挡也随之减少。交换按钮只作浮层存在，不进入 `getWidgetHeight()` 的高度计算，故节点尺寸不变。缓存破坏：`media-tools.css` `?v=15 → 16`、`wosai-variables.css` `?v=27 → 28`、`media-tools.js` `?v=15 → 16`。
- **图像对比的视图切换与交换按钮合并为底部一条工具栏，且改为四个独立圆形按钮。** 原先视图切换条在图像区顶部居中、交换按钮在底部居中，用户需要在上下两处找操作；现合并到图像区底部居中一条工具栏内：左侧是「滑动 / 左右 / 上下」三个圆形视图按钮，最右侧是圆形的「交换 A/B」按钮。不再使用公共胶囊背景，每个按钮自带圆形玻璃背景与边框，选中项以强调色圆形高亮，hover 时边框加深。
  - 新增 `.wosai-image-compare-bottom` 容器统管定位与玻璃态样式；`.wosai-image-compare-views` 只负责内部 flex 布局，`.wosai-image-compare-swap` 不再是绝对定位，而是工具栏最右侧的 flex 项。
  - 闲置淡出、无图隐藏、键盘聚焦唤回、disabled 降级透明度等规则统一切到容器：`is-idle` 下隐藏 `.wosai-image-compare-bottom`，焦点进入时再整体唤回；disabled 交换按钮在容器 `opacity: 1` 时仍用额外选择器保留自己的半透。
  - `compare-view-contract.test.mjs` 同步更新「闲置隐藏清单」「命中关闭」「键盘唤回」三组断言，新增「底部工具栏整体淡出」哨兵。
  - 缓存破坏：`media-tools.js` `?v=16 → 17`、`media-tools.css` `?v=17 → 18`。
- **玻璃控制面板的外壳收敛为单一生产者。** `visual-fx`（背景）、`link-fx`（连线特效）、`settings`（设置中心）三处各自复刻了一整套外壳：`div.wosai-control-panel` + `data-wosai-panel` / `data-theme` + 一长串内联玻璃样式（背景、模糊、边框、阴影、圆角、最大高度）+ 头部（标题 + `closeIcon()`）+ 版权行 + `document.body.appendChild` + 拖拽绑定。任何一处改样式都要手动同步另外两处，漏一处就是「同一个面板两套观感」且无任何报错。现统一由 `web/shared/panel-builder.js::buildControlPanel()` 产出，差异以参数表达（`wsControl` / `wsModule` / `extraClass` / `width` / `stickyHeader` / `copyright`），三处调用点分别瘦身约 18 / 18 / 12 行，并顺带回收了不再使用的 `glassT` / `closeIcon` / `WOSAI_COPYRIGHT` / `makeDraggable` 等 import。新增 `panel-builder-contract.test.mjs`（3 项）锁定：面板类名只允许在 builder 里生产、三处消费者必须调用 `buildControlPanel`、以及 `data-wosai-panel` / `data-theme` / `stopPropagation` / 拖拽绑定 / 版权行类名等关键契约不丢失。
- **补齐 20 个 JS 入口缺失的缓存破坏版本号。** `extension.json` 的 29 个 JS 入口此前有 20 个不带 `?v=`（`omni-slider` / `node-color` / `color-bar` / `auto-connect` / `shake-disconnect` / `visual-fx` / `link-fx` / `settings` / `performance-mode` / `menu-hide` / `panel-drag` / `run-highlight` / `ignore-groups` / `save-node` / `save-text` / `compact-nodes` / `logic-switch` / `route-switch` / `size-select` / `reset-defaults`），改动这些文件后浏览器可能继续用旧副本，且没有任何断言兜底。现已全部纳入版本管理（新纳入者起 `?v=1`，本轮统一递增到 `?v=2`），其余入口同步递增。CSS 侧按既有约定不动（`os-slider*` / `os-color` / `os-size` / `save-node` 等刻意不带版本号）。

### Performance

- **前端体积优化（为 P3 视频传输控件 / P4 批次与缩放平移腾出预算余量）。** 本提交净变化：主 JavaScript **1392.3 → 1353.8 KiB**（文件数 82 → 79；预算 `mainJavaScript: 1_450_000` B ≈ 1416.0 KiB，余量 23.7 → **62.2 KiB**），样式 **230.9 → 232.0 KiB**（预算 `styles: 256_000` B = 250.0 KiB，余量 19.1 → **18.0 KiB** —— CSS 侧回收的 5.4 KiB 被本轮新增的对比视图与闲置淡出样式反超，故净增 1.1 KiB）；发布包 **162 → 162 文件**（迁出 3 个运行时零加载模块 = −3、新增 `wosai_core/media_preview.py` = +1、随附 `LICENSE-GPL-3.0` 与 `THIRD-PARTY-NOTICES.md` = +2，净变化 0）。度量口径为 `web/` 下 `.js` / `.css` 的**原始磁盘字节**，构建压缩与注释压缩均不计入，因此措施全部是「真实删减或移出发布目录」。分三步：
  1. **移出运行时零加载模块（−25.2 KiB）**：`layout-engine.js`（12.9 KiB）、`feature-registry.js`（8.8 KiB）、`layout-geometry.js`（3.6 KiB）三者均无任何 import、也未被 `extension.json` 引用，属「随包发布但启动时永不解析」的死重；`git mv` 至 `dev/frontend/` 后同时退出发布目录与体积预算。顺带把 `benchmark-frontend.mjs` 的 import 指向新路径（其布局性能预算仍需守住）。
  2. **删除确定无引用的死声明（−30.7 KiB，11 文件 / 净删 568 行）**：以「整个仓库（`web/` + `dev/` + `scripts/` + `tests/`）文本语料中标识符出现次数 == 1（仅声明处）」为判据，并用行边界法逐块测量（按顶层声明起始行切分，避免前一声明函数体内出现下一声明字面量而误切）。批量删除后按 eslint 与独立死码扫描器**迭代四轮**至收敛，逐层处理连锁暴露（删 `buildAlignItems` → `_buildSpacingGapInput` / `_resizeBtn` / `_alignBtn` → `BAR_LABELS` / `barLabel` / `hudMkBtn` / `glassT` import）。刻意保留 382 B 的**有意保留 API 面**（`hub-bar.js` 的 `showHubBar()` / `hideHubBar()` / `positionHubBarAboveNode()` 等带 `/** Compatibility bridge … */` 注释的 HTMLOverlay 公开方法），与「功能已禁用」的空实现桩（`_zoomTick()` / `_needsZoomTick()`）区分对待后者的删除。
  3. **CSS 死规则与死令牌回收（−5.4 KiB）**：采用**可证明安全**的判据——「该类名在**整个仓库**中仅出现于这一条 CSS 规则、其他任何文件（含其他 CSS 选择器）都零出现」⇒ 没有任何元素能带上该类 ⇒ 规则永不匹配。辅以两道守卫：①**选择器列表守卫**（`/* 统一禁态 */ .ws-disabled, [data-wosai-panel] [disabled], …` 这类混有纯属性选择器分支的规则整条保留）；②**动态类名排查**（确认全仓无 `classList.add(变量)` / `className = 变量` / `` `prefix-${x}` `` 形式的类名构造，故「非 CSS 语料零出现」是可靠判据）。删规则后连锁orphan的 **33 个 `--ws-*` 令牌**一并从 `wosai-variables.css` 删除（含 `--ws-sh-*` 语法高亮色、`--ws-os-*` 滑块控件尺寸、`--ws-pp-*` 预设面板尺寸等），并清理 2 处失去标注对象的分区横幅。
- CSS 规范 lint 棘轮基线 **72 → 58**（`--update-baseline` 下调）：`未使用变量` 由 13 条归零、`硬编码颜色` 27 → 26、`硬编码尺寸` 32 条不变（严重 27 → 26、重要 45 → 32）。此次下调同时**还清了上一轮 JS 死码删除所连带造成的欠账**（删除 `_syntaxColors` / `getSyntaxColors` / `_buildSpacingGapInput` 后，其消费的 `--ws-sh-*` / `--ws-lt-*` 令牌成为未使用变量，而当时只验证了 `lint:js`（eslint）未复跑 CSS 令牌 lint）。

### Fixed

- 修复**图像对比节点接收来自 VAE 解码（VAEDecode）等纯计算节点的数据时实时预览失效**的问题。上游直读只认「上游节点自身有前端缓存」的素材（`app.nodeOutputs` / `imgs`）；VAE 解码、缩放这类张量进张量出的节点永远不写缓存，接线后舞台必然空白——即使同一份解码输出已流入下游的保存图像节点（缓存里就有这张图）。现补三层回退：
  1. **上游自身缓存**（原有行为，含 `imgs` 兜底）；
  2. **同源兄弟**：直读落空时沿本输入链接的 origin 输出向下游 BFS（第一跳精确匹配 `(origin_id, origin_slot)`，之后按 origin_id 自动穿过 reroute 类直通节点，深度上限 4），取第一个带媒体缓存的下游节点借用其文件——保存 / 预览节点与对比节点共享同一份上游产物，命中即「连线即出图」；
  3. **本节点上次载荷**：以上两层都补不上的空位，从 `app.nodeOutputs` 里本节点自己的 `ui.wosai_compare` 载荷逐侧补齐——undo/redo、工作流切换、任务恢复都会回填 nodeOutputs，但 `onExecuted` 不会重放，没有这层这些场景下张量上游的预览会凭空消失。已命中的侧优先于兜底（那是更新的数据）。
  同时把 `executed` 事件的刷新范围从「直上游」扩展到「与本输入同源的下游兄弟」：部分重跑只重跑了保存分支时，预览也会跟着缓存一起更新。新增纯函数 `collectDownstreamTargets()`（`web/shared/media-preview.js`，链接容器兼容 Map / 对象 / 数组三种形态，5 项单测）与契约测试 2 项（三层回退的顺序与手段、兄弟执行带动刷新）。**已在运行中的 ComfyUI 实例上端到端验收**（真实 Chrome）：LoadImage 直连出图（回归）／执行后重接张量上游立即借兄弟缓存出图（`type=output` 文件引用）／无兄弟时自身载荷逐侧补空，三场景全过。缓存破坏：`media-tools.js ?v=23 → 24`。
- 修复**标题便签节点（TitleNote）最小尺寸钳制静默失效**的问题。新版 litegraph 的 `node.size` 已是 **Float64Array**（`Object.prototype.toString` 实测确认），`Array.isArray()` 对它恒为 `false`；`title-note.js` 的 `onResize` 守卫 `Array.isArray(size)` 因此永不成立，`Math.max(size, 5)` 最小尺寸钳制整段失效。现改用 `size.length >= 2` 判定（读写 `size[0]`/`size[1]` 对 Float64Array 同样有效）。缓存破坏：`title-note.js ?v=10 → 11`。
- 修复**进入画布时整个界面卡死**的问题。上一轮为隐藏原生颜色选择器弹窗下的操作栏，新增的 `_observeNativeColorPicker()` 用 `MutationObserver` 监听了整个 `document.body` 的 `childList` 变动，但回调 `_syncNativeColorPickerPopupState()` **没有做节流**。ComfyUI 启动挂载整个 Vue 应用时，body 子树高频发生 DOM 增删，每次变动都同步跑一遍 `querySelectorAll` + 遍历 toolbox，主线程被淹没 → 进入画布即卡死。现与文件内已有的 `_tooltipObserver`(`_queueTooltipRefresh`) 保持一致，给回调加 `requestAnimationFrame` + 标志位节流（每帧最多同步一次），并新增契约测试锁定「observer 回调必须走节流函数、禁止同步直调」。缓存破坏：`hub-bar.js` `?v=83 → 84`。
- 修复**选中子图节点后，操作栏「编辑组件」「发布子图」中文标签过长、与相邻按钮文字连成一片**的问题。将两个标签分别缩短为两字「编辑」/「发布」，与英文「Edit Widgets」/「Publish」保持语义对应，同时更新 `hub-bar-native-popup-contract.test.mjs` 的断言。
- 修复**点击原生「颜色」按钮弹出颜色选择器后，下方操作栏仍可见**的问题。该弹窗由 ComfyUI 原生 `ColorPickerButton` 直接渲染，不走 WOSAI `color-bar.js` 的 HUD，因此此前操作栏没有跟随隐藏。上轮改为用 `MutationObserver` 检测弹窗并调用 `hideMiniBarForPopup`，但隐藏规则使用 `opacity:0`——原生弹窗本身是 `selection-toolbox` 的子元素，结果弹窗随操作栏一起被隐藏，实测「菜单没有变化」。现改为 `visibility:hidden` 隐藏操作栏，并通过 `button[data-testid="color-picker-button"] ~ .absolute { visibility:visible }` 例外规则保持弹窗可见；检测条件也不再要求弹窗内必须包含 `<button>`（PrimeVue 的色板列表使用 `<i>` 图标），改为判断弹窗存在且可见（`offsetParent !== null` / computed visibility）。缓存破坏：`hub-bar.js` `?v=84 → 85`。
- 修复**点击原生「颜色」按钮弹出颜色选择器后，下方操作栏不会隐藏**的问题（基础实现）。该弹窗由 ComfyUI 原生 `ColorPickerButton` 直接渲染，不走 WOSAI `color-bar.js` 的 HUD。现改为：在 `hub-bar.js` 中通过 `MutationObserver` 监听原生颜色选择器弹窗容器的出现与消失，出现时调用 `hideMiniBarForPopup`、消失时恢复；同时把 `_popupHiddenMiniBars` boolean 改为 `_popupHideReasons` Set，支持多 reason，避免 WOSAI HUD 与原生颜色选择器并发时一个关闭就把另一个也恢复。新增 `web/shared/hub-bar-native-popup-contract.test.mjs`（6 项）锁定：多 reason 状态机、原生颜色选择器检测结构、以及子图编辑/发布按钮的皮肤化。缓存破坏：`hub-bar.js` `?v=82 → 83`。
- 修复**选中子图节点后，操作栏「编辑子图组件」与「发布子图」按钮只有图标没有文字**的问题。这两个按钮来自 ComfyUI 原生 `ConfigureSubgraph` / `PublishSubgraphButton` 组件，只有 Lucide 图标类、没有 `data-testid`，此前的 `NATIVE_MINI_ACTIONS` 未收录，导致未被皮肤化。现按图标类 `icon-[lucide--settings-2]` 与 `icon-[lucide--book-open]` 匹配，补齐「编辑组件」/ "Edit Widgets" 和「发布子图」/ "Publish" 标签与对应 SVG 图标。
- 修复**操作栏弹出菜单后下方操作栏仍可见、与弹出菜单互相遮挡**的问题。选中节点后点击操作栏「颜色 / 节点」等按钮会弹出 ColorBar HUD 菜单，而原生 MiniBar 操作栏仍停留在节点上方，两者紧邻、视觉混杂。现改为：**HUD 弹出时（`openBar`）显式隐藏操作栏、关闭（Esc / 点击画布等真实关闭）时恢复**；切换 tab 与语言切换时的「收起再展开」传 `keepHidden` 不恢复，避免操作栏闪现。配套地，`palette` / `node` 不再走「点击即隐藏并保持」的 `AUTO_HIDE_MINI_ACTIONS`，统一由弹出态语义驱动（关闭即恢复）；其余非 HUD 面板的动作（对齐 / 替换 / 折叠 / 克隆 / 锁定 / 自动连接 / 展开）保持原「动作完成后保持隐藏」语义不变。新增 `web/shared/hub-bar-popup-hide-contract.test.mjs`（5 项）锁定：自动隐藏集合变化、`hideMiniBarForPopup` / `restoreMiniBarsAfterPopup` 已导出、弹出态隐藏的 CSS、以及 `color-bar.js` 三处接线。缓存破坏：`hub-bar.js` `?v=81 → 82`、`color-bar.js` `?v=4 → 5`。
- 修复选中节点上方操作栏「遮罩编辑器」按钮只有图标没有文字的问题。
- 修复从操作栏弹出的菜单（配色 / 节点等 ColorBar HUD）背景透显下方操作栏图标、视觉上不易辨别的问题。`web/shared/hud-kit.js::applyGlassBar()` 原使用玻璃背景 + 模糊，现改为不透明 `var(--ws-surface)` 并移除 `backdrop-filter`，让弹出的胶囊菜单完全覆盖下方内容。缓存破坏：`color-bar.js` `?v=3 → 4`。ComfyUI 的 MaskEditorButton 没有 `data-testid`，WOSAI 的 MiniBar 皮肤化逻辑此前只按 `data-testid` 匹配，导致选中图像节点（如「加载图像」「图像对比」）时该按钮未被皮肤化、底部无文字标签。现增加按图标类匹配（`icon-[comfy--mask]`），并为其补齐「遮罩」/ "Mask" 标签与对应图标。缓存破坏：`hub-bar.js` `?v=80 → 81`。
- 修复**忽略编组节点操作缩放比后，节点尺寸不跟随缩放**的问题。`_applyScale()` 原先只调用 `_igEnsureMinimumSize()`，而该函数会保留当前较大的 `node.size`（只抬升、不收缩），导致用户把缩放档位从 3.0× 调回 1.0× 时节点的视觉内容已缩小，外框却仍保持放大状态。现仍在 `_applyScale()` 中先更新 `minSize` 与 DOM 最小约束，随后直接按 `scaledSize()` 写入 `node.size`，使节点外框在放大与缩小两个方向都严格跟随档位。新增 `web/shared/ignore-groups-scale-contract.test.mjs`（4 项）锁定：`_applyScale` 必须调用 `_igSetNodeSize(scaledSize())`、且必须先设最小约束再写精确尺寸，同时 `_igEnsureMinimumSize` 保持「只抬升」语义不变。缓存破坏：`ignore-groups.js` `?v=3 → 4`。
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
- 修复 **浮层面板被两套拖拽实现各绑一次**的问题。项目里存在两份同名的 `makeDraggable`：`web/panel-drag.js`（`mousedown` 系，靠 `panel._wosaiDraggable` 去重，并由 MutationObserver 全局自动接管所有 `[data-wosai-panel]`）与 `web/shared/shared-utils.js`（`pointerdown` 系，供 `link-fx` / `visual-fx` / `color-bar` / `save-node` 显式调用）。后者**不写那个去重标记**，于是带 `data-wosai-panel` 的面板会被观察器判定为「未绑定」而补绑第二套 —— 拖拽时两个 handler 同时改写 `left` / `top`，且两者基准算法不同（`offsetLeft` vs `getBoundingClientRect`），行为不可预期。现让 `shared-utils` 版本也维护同一标记（并在其返回的清理函数里复位），使全局自动接管正确跳过已绑定的面板。
- 修复 **`node-color.js` 面板初始化链上的未捕获 Promise**：`initStore().then(() => { renderRecentPicks(); buildPresets(); })` 没有 `.catch`。`initStore()` 自身虽吞掉了后端 fetch 错误，但 `then` 回调内部抛错仍会产生 `unhandledrejection`，并让配色面板停在半初始化状态。现补上 `catch` 并打点告警（同步那一行已先渲染过一次，故失败不会白屏）。
- 修复 **两个 Python 测试模块在缺可选依赖时以 ERROR 失败**的问题。`tests/test_media_preview.py` 顶层直接 `from PIL import Image`、`tests/test_http_routes.py` 直接 `from aiohttp import web`，在没有 Pillow / aiohttp 的环境（打包环境即如此）会因导入失败被 unittest 记成 **ERROR**，掩盖真正的回归；本次环境下 `python -m unittest discover` 即报 `FAILED (errors=2)`。现改为条件导入 + `@unittest.skipIf(...)`（skip 标记会被子类继承，`MediaPreviewTestCase` 一处即可覆盖其 5 个子类），`test_http_routes` 模块级的 `_register_routes()` 调用在缺依赖时同样跳过。修复后为 `OK (skipped=53)` —— 在装齐依赖的 ComfyUI 运行环境中这些用例照常执行。

- 修复 **两份 `makeDraggable` 并存**这一结构性隐患（上一轮只做了「补写去重标记」的止血）。`web/panel-drag.js`（`mousedown` 系 + MutationObserver 全局接管）与 `web/shared/shared-utils.js`（`pointerdown` 系 + 显式调用）各有一份实现，行为差异散布在细节里：前者做视口夹取与 `right`/`bottom` → `left`/`top` 换算、后者带 4px 起拖阈值与拖拽期 `transition` 关闭，去重全靠 `panel._wosaiDraggable` 一个标记，任一侧漏写即双重绑定。现合并为 `shared-utils.js` 的唯一实现，取两家之长（pointer 事件 + 起拖阈值 + 视口夹取 + 定位换算 + 拖拽期禁用过渡与文本选中 + 写入 `wosaiManualPosition` + 返回清理函数并挂 `_wosaiDragCleanup`），`panel-drag.js` 只保留「发现浮层 → 识别手柄 → 绑定」的自动接管。新增 `draggable-contract.test.mjs`（6 项）：全仓 `function makeDraggable` 只允许出现一次、去重标记与清理钩子成对、所有调用点必须是选项对象形式（禁止旧式裸 handle 传参）；另有两项把函数体抽出来在最小 DOM stub 上真跑——断言阈值内不产生位移、位移后落在 `基准 + Δ`、越界时夹到 `视口 − 尺寸`、抬手后 document 监听清零、重复绑定不替换 handler。测试经阴性验证（把定义改回旧式调用后按预期变红）。
- 修复 **对齐面板的 document 级匿名监听无法解绑**：`layout-align.js` 在 `buildPanel()` 里注册 `document.addEventListener("pointerup", () => {...}, true)` 用于刷新按钮可用态，匿名函数既无法 `removeEventListener`，也随面板一起常驻到页面结束。现改为具名保存（`_selectionSyncHandler`），并新增 `disposePanel()` 成对回收「关闭 → 解绑拖拽 → 解绑选中态同步 → 移除 DOM → 清空引用」，由 `layout-toolkit.js` 的 `remove()` 钩子调用；面板重建（先 dispose 再 build）也能正确重建闭包。顺带修掉 `settings.js` 的同类问题：`rebuild()` 原先只 `_panel.remove()`，拖拽监听残留，现先调 `_panel._wosaiDragCleanup?.()`。
- 清理 **33 个全仓零引用的 `common.*` 死键**（`wosaiNodeAlign` / `wosaiSelectSame` / `alignCenter` / `interfaceLanguage` …）：这些条目属于早期「通用词库」，随 UI 改版后已无任何消费者，`t()` 的兜底参数让缺失不会暴露。删除后 zh / en 两侧键数 1344 → 1311，并由新增的 i18n 反向检查防止再堆积。
- 修复 **鼠标停在节点内 DOM 控件上时无法滚轮缩放画布**（图像对比节点即为此症状）。节点内 DOM widget 是覆盖在画布之上的兄弟元素，滚轮事件不会冒泡到 canvas —— LiteGraph 的缩放监听（`_mousewheel_callback` → `processMouseWheel`）绑在 canvas 元素自身，ComfyUI 只为多行输入框做过转发。现由 `web/shared/wheel-forward.js::forwardWheelToCanvas()` 把无法被内部滚动消费的滚轮原样派发给画布：`clientX/Y`、`deltaX/Y/Z`、`deltaMode` 与 ctrl/shift/alt/meta 全部透传（缩放中心因此与指针一致，ctrl+滚轮的「缩放 / 平移」分支也不会走错），并 `preventDefault` + `stopPropagation`，避免页面跟着滚与嵌套绑定重复处理。内部滚动优先：事件路径上若存在仍可纵向滚动的容器则让位，且判定只到控件根元素为止，不越过它（免得被外层容器误判成「内部还能滚」）。`addSizedDOMWidget()` 默认挂载（`forwardWheel: false` 可关闭），所有节点内 DOM widget 一并受益；`ignore-groups.js` 原先自带的同款实现（8 处绑定）改为复用共享实现，并以 `respectInnerScroll: false` 保持其「一律转发」的既有语义。新增 `wheel-forward-contract.test.mjs`（7 项：全仓唯一实现、默认挂载、内部让位、修饰键透传、无画布时静默放弃），并在**真实 Chrome** 中完成 7 项验收：画布收到一次 wheel 且增量 / 坐标一致、默认滚动被阻止（页面 `scrollY` 不变）、内部容器照常滚动、画布外滚轮作为对照仍会滚动页面、ctrl 修饰键透传。

- 修复 **切换对比视图（滑动 / 左右 / 上下）后节点尺寸不跟随**的问题。切换视图改变的是舞台宽高比（左右 ×2 → 变矮、上下 ÷2 → 变高），但 `node.size` 是持久化值，ComfyUI 不会因 DOM widget 的高度契约变化而自动调整节点 ⇒ 切到左右排列时图像区下方留出一大块空白、切到上下排列时图像区被压缩。现新增 `fitNodeToStage()`：宽度沿用节点当前宽度（左右排列时若过窄则补到「两幅最小预览宽」，免得两张图都缩成缩略图），高度按 `node.computeSize()` 重算并标脏。三个易错点：①**宽度变化必须先落下去再取高度** —— 高度契约读的是 stage 实测宽度，同一帧里取到的还是旧宽度，故分两步（先落宽、下一帧取高）；②**切换视图不夹初始最小高度** `--ws-compare-node-min-height`，否则左右排列会被撑回 280 而继续留白，仅「首次载入」仍夹，避免节点初始坍缩；③延迟回调里确认 `root.isConnected`，节点在两帧之间被删除时不再改尺寸。新增 5 项契约断言（切换必调尺寸重算、实现单一、左右更矮 / 上下更高、只改高度不动宽度、过窄补宽），其中「左右 / 上下高度关系」是把 `getWidgetHeight` 与 `fitNodeToStage` 抽到 stub 上真跑得出的。

- **左右排列（side）现在把节点宽度翻倍**，使每半幅的显示尺寸与滑动视图下的整幅一致——此前只重算高度、宽度沿用，切到左右后两张图各占一半宽，等于同时缩小一倍。宽度以「单幅基准宽度」展开而非「节点当前宽度」：`state.baseWidth` 记录单幅视图下的宽度，左右视图取其两倍。新增 `syncBaseWidth()`，**`setView()` 必须在改 `state.viewMode` 之前调用它**——顺序反了就会把双幅宽度当成单幅基准，切回去节点不收窄，且来回切换会逐级翻倍（slide → side → slide → side 每次 ×2）。用户在左右视图下手动拖宽过节点时，基准按当前视图折回一半再展开，不覆盖手动调整。下限仍保留「两幅最小预览宽」（`--ws-media-preview-min-width` × 2）与节点最小宽。新增 4 项契约断言：左右翻倍、来回切换不逐级翻倍、手动拖宽后切回取一半、`setView` 里 `syncBaseWidth()` 必须排在 `state.viewMode = next` 之前。缓存破坏：`media-tools.js` `?v=20 → 21`。

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
