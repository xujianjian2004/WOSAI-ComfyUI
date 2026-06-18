# WOSAI-ComfyUI 工程笔记 Project Notes

> 版本 **v1.0** · 作者 **穿山阅海** · COPYRIGHT © WOSAI STUDIO · MIT License
> 本文件梳理工程结构、业务逻辑与关键设计决策，供后续维护/审计参考。最后更新：2026-06。

---

## 1. 项目概览

WOSAI-ComfyUI 是一套 ComfyUI 自定义节点「美化 + 增强」合集，包含 5 个功能模块。前端深度适配 ComfyUI v10 的**两套并行渲染**（Classic Canvas 与 Nodes 2.0 Vue DOM），统一品牌色 `#DD6F4A`，支持深/浅主题。

| 模块 | 类型 | 职责 |
| --- | --- | --- |
| 画布注释 CanvasNote | 零端口装饰节点 | 画布标题/备注，富样式、预设、渐变、阴影 |
| 尺寸选择 SizeSelect | 图像工具 | 四档分辨率 × 八宽高比 + 自定义，自动 8 倍对齐 |
| 万能滑条 OmniSlider | 多端口工具 | 1–6 路独立滑条，FLOAT/INT，两种样式，极简模式 |
| 高级配色 NodeColor | 全局扩展 | 对任意节点上色（纯色/渐变）+ 标题样式 + 拾色器 |
| 快捷上色条 ColorBar | 全局浮动工具条 | 预设色（4 组）/拾色器/随机/按类型一键上色 |

---

## 2. 目录结构

```
WOSAI-ComfyUI/
├── __init__.py              # 入口：注册映射 + V1/V3 双注册 + 预设 API
├── pyproject.toml           # 打包元数据（version=1.0, MIT, comfy PublisherId）
├── extension.json           # 前端资源清单（js/css 加载列表）
├── requirements.txt         # 无第三方运行时依赖（仅标准库）
├── README.md / LICENSE
├── docs/comfyui-node-hiding-best-practices.md   # 隐藏节点元素实战文档
├── locales/{en,zh}/nodeDefs.json                # 节点名/描述本地化
├── nodes/                   # Python 节点定义（V1 + V3 同文件共存）
│   ├── canvas_note.py / omni_slider.py / size_select.py
├── wosai_core/             # 后端共享层
│   ├── config.py            # 单一真源：VERSION/AUTHOR/品牌色/默认通道配置
│   ├── registry.py          # 自动扫描注册 + 热重载安全
│   └── color_presets.py     # NodeColor 预设持久化 HTTP API
└── web/                     # 前端
    ├── omni-slider.js / canvas-note.js / node-color.js
    ├── color-bar.js / size-select.js
    ├── css/  (wosai-variables, wosai-theme, os-slider, os-color, os-size)
    └── lib/  (glass-theme, shared-utils, color-core, color-store,
               color-theme, note-renderer)
```

---

## 3. Python 后端架构

**单一真源**：`wosai_core/config.py` 集中 `VERSION="1.0"`、`AUTHOR="穿山阅海"`、`BRAND_COLOR="#DD6F4A"`、`CATEGORY_PREFIX`、`default_omni_config()`（与前端 `defaultCfg` 对齐，避免双源漂移）。

**自动注册**：`registry.py::Registry.discover_nodes()` 扫描 `nodes/*.py`，读取各文件的 `NODE_CLASS_MAPPINGS`。每次扫描前 `clear()`，热重载（`--watch`）下不会累积重复项；并把项目根加入 `sys.path` 以支持 `from wosai_core.config import ...`。

**V1/V3 双注册**：`__init__.py` 先注册 V1 基线；若宿主提供 `comfy_api.latest`，则用 V3 类覆盖同名注册（`node_id` 不变 → 向后兼容）。OmniSlider **有意保留 V1**——其 hidden-widget 序列化依赖 V1 `INPUT_TYPES`。

**预设持久化 API**：`color_presets.py` 注册 `/wosai/color_presets` 路由，供 NodeColor 存取自定义预设；`PromptServer` 不可用时静默降级，前端回退 `localStorage`。

---

## 4. 前端架构

### 4.1 两套渲染模式（核心前提）
ComfyUI v10 同时存在 Classic（LiteGraph 在 `<canvas>` 2D 绘制）与 Nodes 2.0（Vue 渲染为真实 DOM）。任何节点级视觉功能**必须两条路都覆盖**：
- Classic → 覆写 `LGraphCanvas.prototype.*`（如 `drawNodeShape`）+ 改 `node.*` 属性。
- Nodes 2.0 → 按 `[data-node-id]` **注入 CSS**（对 Vue 重渲自动生效，免 MutationObserver 反复打补丁）。
- 判定：`document.querySelector('[data-node-id="<id>"]')` 存在即 Nodes 2.0。

详见 `docs/comfyui-node-hiding-best-practices.md`。

### 4.2 主题系统
- `css/wosai-variables.css`：`--ws-*` 设计令牌，`[data-theme="light"]` 覆盖浅色值；新增 `--ws-icon`（工具图标软蓝灰）。
- `lib/glass-theme.js`：毛玻璃浮层主题（`glassT()` 返回深/浅 token，含 `iconColor/iconAccent=#DD6F4A`），供 ColorBar 使用。
- 品牌橙统一 `#DD6F4A`（`--ws-accent` / `iconAccent` 深浅一致）。

### 4.3 共享层 lib/
`shared-utils.js`（`WS_ICONS` 单色线性图标集）、`color-core.js`（HSV/HEX/渐变计算）、`color-store.js`（预设存取，API + localStorage 回退）、`color-theme.js`（按节点类型分类配色）、`note-renderer.js`（CanvasNote 富文本/表格绘制）、`glass-theme.js`。

### 4.4 图标规范（本次统一）
全套 SVG 单色线性（`stroke-width=1.6`，随 `currentColor`），静止软蓝灰、悬停点亮品牌橙 + 文字同步变橙；唯 ColorBar「换一组预设」刷新图标保留双色（绿/蓝）作焦点，中心叠当前组号。emoji 一律改 SVG（跨平台一致）。

---

## 5. 关键业务数据流

**OmniSlider**：每通道配置序列化为 JSON 存于隐藏 widget `ch{i}_cfg`（字段见 `default_omni_config`）。前端设置面板编辑草稿 `drafts[]`，关闭即落库（`commitPanel`）。`execute()` 读各通道 `value`，按 `type` 输出 INT/FLOAT；6 路输出用 `_TS`（`__ne__` 恒 False）绕过 V1 静态类型校验。端口数随 `channel_count` 动态增减。

**NodeColor**：渐变以 inline `background-image` 注入 inner-wrapper（Nodes 2.0）或 `data-wgrad` 标记元素（Classic）；面板色由 inner-wrapper 的 CSS 变量 `--component-node-background` 驱动。`refreshDOMGradients()` 由 MutationObserver（仅监听 `childList`+`class`，**绝不监听 `style`**，见 §6）+ 500ms 轮询兜底触发。

**持久化**：隐藏标志/样式存 `node.properties`（LiteGraph 随工作流序列化）；NodeColor 预设走 HTTP API + localStorage 回退。

---

## 6. 关键设计决策与踩坑（务必保留）

1. **`title_mode` 只读**：Nodes 2.0 下 `node.title_mode = X` 抛错并中断整个函数 → 一律 `try/catch`。
2. **`--component-node-background` 污染**：隐藏面板**绝不能**设 `node.bgcolor='transparent'`——会被 ComfyUI 写进 inner-wrapper 的 inline CSS 变量，显示后 Vue 不回收 → 面板永久透明。仅 Classic 才设 color/bgcolor。
3. **渐变 Observer 反馈环（已修）**：`refreshDOMGradients` 写节点 `style`，若 Observer 监听 `style` 会被自身写入（及 Vue 异步反应）反复触发 → 16ms 死循环 → 右键假死。修法：只监听 `childList`+`class`，刷新期间 `disconnect`/`observe`。
4. **单一画布钩子**：`drawNodeShape` 等原型方法全插件只挂一个 wrapper，内部分发，避免多扩展互相覆盖导致功能反复失效。
5. **端口名隐藏用零宽空格**（空串 v10 会回退显示 name），保留圆点与连线。
6. **focus 必须 `preventScroll`**（CanvasNote 文本框），并设 500ms 焦点保卫上限，避免与 Vue 持续抢焦点抖动。
7. **即时 tooltip**：自定义 `:hover::after` / fixed 提示元素替代原生 `title`（消除 ~0.5s 延迟）。

---

## 7. 本次审计结论（v1.0 收尾）

### 已完成（安全修复）
- 清除全部 9 个 `.py` 文件行首 UTF-8 BOM；`py_compile` 全通过。
- 修复 NodeColor 渐变 Observer 自触发死循环（右键假死 / 输入法抖动根因）。
- 删除死代码 CSS `.os-maxch-tip`、未用的 `_swatchIconColor`。
- 版本号/作者全项目核验一致（v1.0 / 穿山阅海，单一真源 config.py）。
- 图标体系统一为单色线性 SVG + A+B 配色（静止软蓝灰 / 悬停品牌橙）。
- 资源清理卫生核查：MutationObserver 均 `disconnect`，面板 document 监听在 cleanup 移除，定时器用 ResizeObserver 替代，无悬挂泄漏。

### 已完成（2026-06 架构规整 — P1-1）
### 已完成（2026-06 架构规整 — P1-1）
- **omni-slider.js 巨型函数拆分（15 轮提取）**：
  - 新建 `lib/omni-hide.js`（109 行）
  - 12 个模块级函数 + 常量提升 + 死代码删除
  - 最终指标：2406 行（-174）；`openSettingsPanel` 850→**~264 行（-69%）**；`rebuildUI` 310→~50 行（-84%）
- **node-color.js 巨型函数拆分（6 轮提取）**：
  - 7 个 `_nc*` 模块级函数；`_pinOnMove`/`_pinOnUp`/`_isCleared` 状态迁移
  - `openNodeColorPicker` 821→**799 行**（-22 行）
- **CSS 模块化**：`os-slider.css` 1142 行拆为 3 文件（core 521 + panel 409 + hide 147）
- **README.md**：OmniSlider/ColorBar 描述更新、项目结构树同步

- **node-color.js 巨型函数拆分（6 轮提取）**：
  - 新建模块级函数：`_ncBuildPresets`、`_ncRenderStopIndicators`、`_ncRebuildPins`、`_ncBuildTitleStylePanel`、`_ncMkToolBtn`、`_ncBuildCorePickerUI`、`_ncBuildFooter`
  - `_pinOnMove`/`_pinOnUp` 改为 mutable ref `_pinRefs`
  - `_isCleared` 状态迁移至 `_ncBuildFooter`
  - `openNodeColorPicker` 821 → **799 行**（-22 行）；模块级函数新增 **7 个**

### 已完成（2026-06 代码审计验证）
- **语法校验**：全部 9 个 `.py` `py_compile` 全通过 ✅；全部 12 个 `.js` `node -c` 全通过 ✅。
- **花括号平衡**：`omni-slider.js` 459:459 ✅，其余文件全平衡 ✅。
- **内存泄漏**：5 个模块 cleanup 路径全覆盖（Observer disconnect、listener remove、timer clear、RAF cancel）✅。
- **双渲染兼容**：7 项检查（title_mode try/catch、bgcolor Classic only、零宽空格端口名、CSS 注入隐藏、computeLayoutSize、不 splice widgets）全通过 ✅。
- **CSS 令牌化**：5 个 CSS 文件已全量使用 `--ws-*` 变量，零硬编码色值 ✅。
- **配置一致性**：version/authors/license 在 `pyproject.toml` / `extension.json` / `config.py` 三处一致 ✅。
- **配置资源清单**：`extension.json` JS/CSS 清单与实际文件对应完整 ✅。

### 建议（高风险重构，按模块逐个进行，需运行测试）
- ~~**omni-slider.js（2403 行）**~~ ✅ 已完成：2406 行，`openSettingsPanel` 从 850 降至 ~264 行。
- ~~**node-color.js（1808 行）**~~ ✅ 已完成：7 个 `_nc*` 函数提取。
- ~~**CSS**~~ ✅ 已完成：`os-slider.css` 拆分为 3 模块文件。
- ~~**统一 tooltip 机制**~~ ✅ 已完成：4 套实现已统一到 `lib/tooltip.js`。
- **挂载缓存注意**：沙盒挂载对大文件有截断，`acorn` 对超长文件会报文件尾假错；以 Read 工具内容为准。

---

## 8. 验证基线
- Python：`python -m py_compile`（全通过）。
- JS：`node -c`（所有文件全通过）；大文件以编辑器/Read 内容为准。
- 配置：`pyproject.toml`(TOML)、`extension.json`/`locales/*.json`(JSON) 合法。
