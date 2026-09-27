# Changelog

本文件记录 WOSAI-ComfyUI 的用户可见变更。版本号遵循语义化版本。

## [Unreleased]

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
