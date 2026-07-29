# WOSAI-ComfyUI 技术改进报告（代码质量审计）

> 审计日期：2026-07-29
> 审计性质：**只读审计**，未修改任何源码。本报告仅输出问题清单与优化方案，所有修改动作待用户确认后执行。
> 方法：4 路并行探查（后端 / 前端 / 工程化·测试 / 文档） + 关键论断人工复核（已核验证据见附录）。

---

## 0. 一句话结论

项目架构清晰、安全基线良好（无 `eval/exec/os.system/pickle`、subprocess 受路径白名单约束），**无 P0 级安全或崩溃缺陷**。主要风险集中在三处：**导入期静默失败、魔法路径/魔法数字、以及仓库与发布包的资源漂移（presets/ 被 gitignore 却参与打包）**。前端存在典型的"上帝文件 + 全局污染 + 重复弹窗"问题，工程化链路缺聚合测试与类型检查。

---

## 1. 工程结构与业务逻辑概览

### 1.1 它是什么
WOSAI-ComfyUI 是一套 **ComfyUI 可视化辅助工具集**（作者"穿山阅海"，面向中文用户），以"自定义节点包 + 前端扩展"双栈提供能力：

- **Python 后端**：节点计算 + 一组只读诊断路由。
- **前端 ESM 扩展**：悬浮球启动器、节点/文本收藏、主题、多语言、HUB 命令栏、对齐布局、运行高亮、设备信息等。

### 1.2 三层架构
| 层 | 入口 | 职责 |
|---|---|---|
| 后端注册 | `__init__.py` → `wosai_core/registry.py` | 递归扫描 `nodes/` 自动注册节点（热重载安全） |
| 后端路由 | `wosai_core/color_presets.py` / `device_info.py` / `wosai_size_probe.py` | 3 个 aiohttp 只读路由（带同源校验） |
| 前端扩展 | `extension.json`（29 个 js 入口） | 各入口自行 `app.registerExtension`，经 `launcher.js` 等总入口串联 |
| 持久化 | `localStorage`（即时） + `presets/color_presets.json`（经 `/wosai/color_presets` API） | 收藏与配色预设 |

### 1.3 已注册节点（14 类）
SizeSelect、PointsEditor / ImageCompare / GetWidget / FirstLastFrame、CommonColor、LogicSwitch、NumberSwitch / LazyFallback、Selector / BooleanSelector、OmniSlider、PresetPromptSelector、IgnoreGroups、TitleNote。（部分节点在 `comfy_api.latest` 可用时由 V3 子类覆盖原 ID。）

### 1.4 已知前情
`docs/CODE_QUALITY_IMPROVEMENT_REPORT_2026-07-28.md` 已存在一份（昨日）质量报告，声称 53/53 Python + 232/232 前端测试通过、达"候选发布"。本报告与其关系：**补充一份独立的、按严重度分级的改进清单**，并修正其中暴露出的 CHANGELOG 版本归位问题（见 P1-13）。

---

## 2. 问题清单（按严重度分级）

符号说明：`P0`= 必须立即修（安全/崩溃）；`P1`= 应优先修（正确性/一致性/可维护）；`P2`= 可改进（整洁度/健壮性）。

### 2.1 P0 —— 无
未检出 `eval/exec/os.system/pickle`；`subprocess` 仅 `device_info.py` 使用，且参数固定 + `_known_path` 路径白名单约束。**安全基线合格。**

### 2.2 P1 —— 优先修复（13 项）

**后端（5）**
- **P1-1 导入失败被静默吞掉** · `wosai_core/registry.py:62-73`
  `except Exception` 仅 `logger.warning`，节点加载期致命错误（如 `size_select.py:14` 读 `web/data/resolutions.json`、`common_color.py:36` 读 `common-colors.json` 失败）会导致**节点静默消失**、无 ERROR 级日志。→ 改为 ERROR 级 + 在启动日志中列出失败节点清单。
- **P1-2 持锁期间执行重导入阻塞热重载** · `wosai_core/registry.py:34`
  `with cls._lock:` 覆盖整个 `exec_module`（含 torch 导入），`--watch` 热重载下会阻塞服务线程。→ 把 `exec_module` 移出锁，或仅对映射合并加锁。
- **P1-3 魔法层级反推 ComfyUI 根** · `wosai_core/device_info.py:157`
  `Path(__file__).resolve().parents[3]` 硬编码目录深度，目录结构一变即失效（仅 git 兜底）。→ 用环境变量/配置锚点或 `importlib.metadata` 定位。
- **P1-4 VAE 缩放硬编码 8 倍** · `nodes/size_select.py:177-179, 238-239`
  创建空 latent 时硬编码 `//8` 与 `downscale_ratio_spacial:8`，未使用 `latent_ratio`；非 8× VAE 时尺寸错位。→ 提升为常量或读取 VAE 提供的 ratio。
- **P1-5 路由缺同源校验** · `wosai_core/wosai_size_probe.py`
  另两个路由有 `is_same_origin_request` 校验，本路由缺（仅泄露宽高，低风险但仍应统一）。→ 补同源校验。

**前端（4）**
- **P1-6 上帝文件** · `node-color.js`(~2000)、`save-node.js`(~2056)、`ignore-groups.js`(~1932)、`omni-slider.js`(~1672)、`title-note.js`(~1698)、`launcher.js`(~1382)
  单文件多职责、难测试。→ 按"数据/UI/行为"拆分，优先拆 `save-node.js` 与 `node-color.js`。
- **P1-7 重复确认弹窗/面板** · `save-node.js`（7 处近似弹窗：478/566/1504/1665/1739/1781/1878）、`menu-hide.js`（两套近似面板）、`settings.js`（FPS 选择器重复）、`visual-fx.js`（大量重复 inline `style.cssText`）
  → 抽取统一 `dialog`/`toast` 工厂，消除拷贝。
- **P1-8 i18n 的 app 导入路径错误 + 注册时序** · `web/shared/i18n.js:16`
  `await import("../../../../scripts/app.js")` 层级少一级（应为 `../../../../../scripts/app.js` 指向 ComfyUI 根），**永远走 catch 回退** `globalThis.app`；且顶层 `await` + `registerExtension` 依赖 app 已就绪，早加载则 `WOSAI.NodeSearchI18n` 不注册。→ 修正路径或将注册延后到 `appReady`。
- **P1-9 全局污染 / 紧耦合** · `web/shared/layout-toolkit.js:510-671` 等共 40+ 处 `window.__wosai*`
  跨模块 API 靠全局变量，难追踪、易冲突、阻碍 Tree-shaking。→ 引入事件总线或依赖注入容器。

**工程化·文档（4）**
- **P1-10 presets/ 资源漂移（高信号）** · `.gitignore:19` vs `MANIFEST.in`
  `.gitignore` 整目录忽略 `presets/`，但 `MANIFEST.in` 用 `recursive-include presets *.json` 打包 → 唯一预设 `presets/color_presets.json` **不在版本控制**，仓库与发布包不一致。→ 改为 `!presets/color_presets.json` 放行该文件，或调整打包策略。
- **P1-11 测试无法一键聚合 / Playwright 不自启** · `package.json`、`playwright.config.mjs:3`
  `quality` 脚本串起 JS lint + `npm test`，但**未含** `test:python`（9 个）与 `test:ui`（Playwright）；Playwright 无 `webServer` 自启，须手启 `127.0.0.1:8188` 活服务才能在 CI 跑。→ 加 `test:all` 聚合命令 + `webServer` 配置。
- **P1-12 ESLint 双配置 + 无类型检查** · `.eslintrc.json`（legacy）与 `eslint.config.mjs`（flat）并存；规则偏宽松（`no-unused-vars/eqeqeq/no-var/prefer-const` 仅 warn），**无类型检查**。→ 删 legacy 配置、加 `typescript-eslint` 或至少 `pyright` 到质量门禁。
- **P1-13 CHANGELOG 与既有报告版本矛盾** · `CHANGELOG.md` `[Unreleased]` vs `docs/CODE_QUALITY_IMPROVEMENT_REPORT_2026-07-28.md`
  报告称修复已完成并达候选发布，CHANGELOG 仍把修复挂 `[Unreleased]`，用户无法确认是否已随 2.0.0 发出。→ 将确已发布的修复归位到 `[2.0.0]`，或发布 2.0.1 并补日期。

### 2.3 P2 —— 可改进（摘录，非穷举）

**后端**
- 模块级 `logger.info("...已加载")` 在热重载时刷屏（`logic_switch.py:11`、`ignore_groups.py:6`、`title_note.py:9`）→ 改为 debug 或仅在首次加载打印。
- 版本不一致：`__init__.py:5` `__version__="2.0.0"` vs `config.py:3` `VERSION="2.0"` → 统一从单源读取。
- 节点 `execute/switch` 缺类型提示；`size_select.py:92` `_determine_target_size` 的 `kwargs` 为死参数 → 删或补类型。
- `media_tools.py:234` `IS_CHANGED` 返回 `float("nan")` 强制每次重执行（疑似有意为之，但属隐患）→ 加注释或显式开关。
- `media_tools.py:273-287` `get_widget` 直接 `raise ValueError/KeyError/NameError` → 转 500 而非友好提示，建议包装为结构化错误。

**前端**
- 死代码：`web/shared/*.js._chk.mjs` 共 7 个（toast/tooltip/svg-icons/shared-utils/search-engine/replace-engine/wosai-prefs），编辑器遗留 checkpoint、未 git 跟踪 → 删除。
- 事件泄漏风险：`ignore-groups.js`(48 处)、`save-node.js`(105 处) `addEventListener`；弹窗类需确认 `remove()`/卸载时对称解绑。
- 魔法字符串：localStorage key 分散（`wosai-fps`、`wosai-lang`），`web/shared/constants.js` 仅 326B 近乎空 → 集中常量。
- i18n 兜底：`locale` 加载失败 `t()` 返回 key（非中文环境显示裸 key）；首屏 `fetch` 慢致早期 `t()` 拿到空字典闪烁 → 加兜底文案 + 初始化竞态保护。

**工程化·文档**
- `web/node_modules/` vendored `acorn`+`acorn-walk` 与根依赖重复 → 复用根依赖或显式声明。
- `MANIFEST.in` 未含 `I18N_GUIDELINES.md`（`build_release.py` 含）→ 细微不一致，统一。
- README 缺安装前提（Node≥18 / Python≥3.9）；aiohttp 措辞矛盾（README 称"不单独安装"，`requirements.txt` 列运行时依赖）；兼容性声明过粗（Classic vs Nodes 2.0 各自支持哪些特性未分）；缺"快速上手"小节（启动器/配色/收藏/快捷键）；命令 `npm` vs `npm.cmd` 不一致。

---

## 3. 优化方案（分模块）

### 3.1 后端健壮性（对应 P1-1~5）
1. **注册失败可观测**：`registry.py` 将 `except Exception` 提升为 `logger.error` 并收集失败清单，在 `__init__.py` 启动后打印一次摘要；对 `size_select`/`common_color` 的配置读取加 `try/except` 回退到内置默认值，避免节点消失。
2. **缩小锁粒度**：仅对 `NODE_CLASS_MAPPINGS` 合并加锁，`exec_module` 移到锁外。
3. **去魔法路径**：`device_info.py` 用 `os.environ.get("COMFYUI_PATH")` 或固定锚点（如相对 `web` 目录）定位 ComfyUI 根；`parents[3]` 改为可读常量。
4. **VAE 比例常量化**：引入 `LATENT_DOWNSAMPLE = 8`（或从 VAE 读取），替换 `//8` 与 `downscale_ratio_spacial:8`。
5. **路由同源统一**：`wosai_size_probe.py` 套用与另两路由相同的 `is_same_origin_request`。

### 3.2 前端可维护性（对应 P1-6~9, 部分 P2）
1. **弹窗/Toast 工厂**：新建 `web/shared/dialog.js`，`save-node.js`/`menu-hide.js`/`settings.js`/`visual-fx.js` 复用，消除拷贝。
2. **拆分上帝文件**：优先拆 `save-node.js`（数据层 vs UI 层）与 `node-color.js`；目标单文件 < 600 行。
3. **i18n 修复**：修正 app 导入路径，并将 `WOSAI.NodeSearchI18n` 注册延后到 `appReady` 事件，消除顶层 await 时序依赖。
4. **解耦全局**：引入轻量事件总线（`web/shared/bus.js`）逐步替换 `window.__wosai*`，先收敛 `layout-toolkit.js` 的 20 个全局函数。
5. **清理**：删 `._chk.mjs`；localStorage key 集中到 `constants.js`；弹窗类统一 `destroy()` 对称解绑。

### 3.3 工程化与质量门禁（对应 P1-10~12, 部分 P2）
1. **资源漂移修复**：`.gitignore` 放行 `presets/color_presets.json`（或改打包从已跟踪源读取）。
2. **聚合测试**：`package.json` 加 `test:all = test:python && test:js && test:ui`；`playwright.config.mjs` 加 `webServer` 自动拉起 ComfyUI。
3. **质量门禁升级**：删 `.eslintrc.json`；`eslint.config.mjs` 将关键规则升为 `error`；引入 `typescript-eslint` 或 `pyright` 作为可选门禁。
4. **依赖收敛**：评估 `web/node_modules` 的 acorn 是否必需，能复用则删。

### 3.4 文档（对应 P1-13, P2）
1. CHANGELOG 版本归位 / 发 2.0.1。
2. README 补安装前提、统一 aiohttp 措辞、拆分 Classic/Nodes 2.0 兼容性、加"快速上手"、统一命令写法。

---

## 4. 待确认后的执行计划（分阶段，明确改动文件）

> 以下为**计划**，确认后我才动手。每阶段可独立验收。

**阶段 A — 正确性/一致性（建议先做，低风险高收益）**
- 改 `wosai_core/registry.py`（P1-1/2）
- 改 `wosai_core/device_info.py`（P1-3）、`wosai_core/wosai_size_probe.py`（P1-5）
- 改 `nodes/size_select.py`（P1-4）
- 改 `.gitignore` + 确认 `MANIFEST.in`（P1-10）
- 改 `CHANGELOG.md`（P1-13）

**阶段 B — 前端可维护性（中等风险，建议小步）**
- 新增 `web/shared/dialog.js` + 重构 4 处重复（P1-7）
- 修 `web/shared/i18n.js`（P1-8）
- 拆 `save-node.js` / `node-color.js`（P1-6，可选、可延后）
- 删 `web/shared/*.js._chk.mjs`、清理全局（P1-9/P2）

**阶段 C — 工程化与文档（低风险）**
- `package.json`/`playwright.config.mjs` 聚合测试（P1-11）
- ESLint 清理与升级（P1-12）
- README/文档修订（P2 文档项）

---

## 5. 风险与注意事项
- **阶段 B 拆分上帝文件属结构性改动**，需配套回归（Playwright 5 用例 + 前端单测）。建议先补 `web/*.js` 关键控制器单测再拆，降低回归风险。
- **presets/ 漂移修复**需确认 `color_presets.json` 当前内容是否已是最新——若仓库从未跟踪，修复后首次提交会把它纳入版本控制，需人工核对内容正确。
- **i18n 路径修复**改动虽小，但影响启动器注册时序，改后必须验证悬浮球/节点搜索在正常与旧版 ComfyUI 下均可用。
- 全部改动建议在独立分支进行，跑通 `test:all` 后再合并。

---

## 附录 A — 已人工核验的证据
| 论断 | 证据 |
|---|---|
| presets/ 被 gitignore 却打包 | `.gitignore:19` = `presets/`；`MANIFEST.in` = `recursive-include presets *.json` |
| 版本字符串不一致 | `__init__.py:5` = `2.0.0`；`wosai_core/config.py:3` = `2.0` |
| i18n app 路径错误 | `web/shared/i18n.js:16` = `await import("../../../../scripts/app.js")`（层级少一级） |
| 导入失败仅 warning | `wosai_core/registry.py:62-73` = `except Exception ... logger.warning` |
| 持锁期间 exec_module | `wosai_core/registry.py:34` = `with cls._lock:` 覆盖 `exec_module`（:63） |

## 附录 B — 审计覆盖范围
- 后端：`wosai_core/*.py`（7）、`nodes/*.py`（11）全量深读。
- 前端：`web/` 29 个扩展入口 + `shared/` 核心模块 + `i18n/locales`，代表性文件深读。
- 工程化：`package.json`、`pyproject.toml`、`eslint.config.mjs`、`playwright.config.mjs`、`scripts/`、`tests/`、`MANIFEST.in`、`requirements.txt`、`presets/`。
- 文档：`README.md`、`docs/*`、`CHANGELOG.md`、`I18N_GUIDELINES.md`、`LICENSE`、`VERSION`。
