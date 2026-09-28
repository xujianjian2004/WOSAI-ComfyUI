# WOSAI-ComfyUI

WOSAI-ComfyUI v2.1 是穿山阅海维护的 ComfyUI 节点与画布增强扩展。它提供 15 个后端节点，以及配色、布局、连线、收藏、运行高亮和画布面板等前端增强能力。

## 安装

### 环境要求

- **ComfyUI**：宿主环境（建议 `0.2.0` 及以上）。
- **Python**：`>=3.9`（见 `pyproject.toml` 的 `requires-python`）。
- **Node.js**：`>=18`（见 `package.json` 的 `engines`），仅前端构建与测试需要（Windows 下命令为 `npm.cmd`）。
- **运行时依赖**：`torch`、`numpy`、`Pillow`、`aiohttp` 由 ComfyUI 宿主提供；本插件不单独安装，其中 `aiohttp` 仅在 `requirements.txt` 中作为可选的开发/测试依赖出现，与 README 措辞一致。

### ComfyUI Manager

在 ComfyUI Manager 搜索 `WOSAI-ComfyUI`，安装后重启 ComfyUI。

### 手动安装

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/xujianjian2004/WOSAI-ComfyUI.git
```

本插件不单独安装 `torch`、`numpy`、`Pillow` 或 `aiohttp`；它们应由 ComfyUI 宿主环境提供。

## 后端节点

| 节点 | 分类 | 实际功能 |
| --- | --- | --- |
| `WOSAI_SizeSelect` | 图像 | 预设或手动尺寸选择；可处理 IMAGE、MASK、LATENT，输出 image、mask、latent、width、height。支持 Crop 与 Scale；接入 VAE 时可对处理后的图像编码。 |
| `WOSAI_OmniSlider` | 工具 | 单个动态数值输出控制节点。前端将配置保存到隐藏 `ch1_cfg`，后端按配置输出 FLOAT 或 INT，通配端口可连接两类数值输入。 |
| `WOSAI_TitleNote` | 画布 | 无输入输出的纯前端标题/注释节点；样式与内容保存在工作流中。 |
| `WOSAI_IgnoreGroups` | 画布 | 无输入输出的输出节点；前端用于选择并切换工作流编组的忽略/旁路状态。 |
| `WOSAI_LogicSwitch` | 逻辑 | 逻辑开关节点（布尔条件切换）：在 `true_input` / `false_input` 之间切换输出；`condition` 未连接时由 `Default_Input` 开关决定回落到哪一路。输入/输出均为任意类型（anytype），端口标签随界面语言切换。 |
| `WOSAI_Selector` | 逻辑 | 可编辑标签按钮选择器，输出从零开始的整数序号。 |
| `WOSAI_BooleanSelector` | 逻辑 | 使用紧凑双按钮选择并输出布尔值。 |
| `WOSAI_CommonColor` | 工具 | 提供 46 个随中英文界面本地化的常用颜色预设（含 WOSAI 品牌与语义色）和自定义取色器；输出可直连空图像颜色的整数值，以及规范化的 `#RRGGBB` 字符串。 |
| `WOSAI_NumberSwitch` | 逻辑 | 按整数序号路由任意类型输入；Nodes 2.0 使用原生 Autogrow 动态端口。 |
| `WOSAI_LazyFallback` | 逻辑 | 主输入存在时跳过回退上游；仅当主输入为 `None` 时计算并输出回退输入。 |
| `WOSAI_PointsEditor` | 图像 | 在批次图像上标注正向点、负向点与矩形框，输出原图像素坐标和帧序号。 |
| `WOSAI_ImageCompare` | 图像 | 使用交互式分割线对比两张图像。 |
| `WOSAI_FirstLastFrame` | 图像 | 从图像批次中提取第一帧与最后一帧。 |
| `WOSAI_GetWidget` | 工具 | 读取已连接目标节点的指定控件或全部控件值。 |
| `WOSAI_PresetPromptSelector` | 提示词 | 中英文提示词预设管理；默认显示 6 个预设，支持分页、重命名、导入、导出、清空和单条/全部输出切换。 |

### SizeSelect

- 预设分辨率：SD 480P、HD 720P、FHD 1080P、QHD 2K+。
- 支持 3:2、2:3、4:3、3:4、16:9、9:16、21:9、1:1。
- 手动宽高范围为 256–2048，按 8 对齐。
- `Crop` 按目标比例中心裁剪后缩放；`Scale` 按输入尺寸与倍率缩放。
- 连接 image 时同步处理 image/mask；仅连接 latent 时处理 latent；无图像和 latent 时输出尺寸与空 latent。
- latent 缩放保留 `batch_index` 等附加元数据，支持 VAE/latent 声明的非 8× 空间压缩比，并同步处理 `noise_mask`。

### LogicSwitch

- `condition`（可选）：为 True 时输出 `true_input`，为 False 时输出 `false_input`。
- `Default_Input`（开关）：当 `condition` 未连接时，决定回落到 `true_input`（开）还是 `false_input`（关）。
- 某一路输入缺失时按逻辑返回另一路或 `None`，便于做条件短路与缺省兜底。

## 前端增强功能

| 模块 | 功能 |
| --- | --- |
| NodeColor / ColorBar | 节点和分组配色、纯色/渐变、标题样式、取色历史、预设与快捷悬浮球。 |
| LayoutToolkit / HubBar | 节点对齐、分布、尺寸处理、搜索、替换、连线规划和快捷 HUD。 |
| LinkFX / RunHighlight | 连线视觉效果、运行中的节点与编组高亮。 |
| SaveNode / TextFavorites | 收藏节点、收藏文本、分类、搜索、导入导出与快捷键。 |
| Settings / VisualFX / PanelDrag | WOSAI 设置面板、画布背景效果和通用浮层拖拽。 |
| i18n | 中英文界面与节点端口标签；语言变化通过设置和 DOM 事件同步。 |

### 入口分工

- 启动器：打开收藏、颜色、对齐、节点、背景、连线和设置模块。
- 选区 HUB：只显示当前选区的高频操作；低频工具放入节点操作面板。
- 悬浮条：保留高频对齐；完整对齐、尺寸和拉伸工具集中在快捷对齐面板。
- 右键菜单：提供当前上下文的单一入口，不重复铺开完整工具箱。
- 设置中心：承载背景、连线、外观、性能、菜单和配置导入导出等全局设置。

前端样式位于 `web/styles/`，共享模块位于 `web/shared/`。颜色与分辨率的前后端共享配置位于 `web/data/`。运行时按需加载的 CSS 与 `extension.json` 中的样式清单均使用 `/extensions/WOSAI-ComfyUI/styles/` 路径。

## 快速上手

- **启动器（悬浮球）**：点击画布上的 WOSAI 悬浮球，快速打开收藏、配色、对齐、节点、背景、连线与设置模块。
- **配色**：`NodeColor` / `ColorBar` 可为节点和分组上色（纯色或渐变），并保存取色历史、预设与快捷悬浮球。
- **收藏**：`SaveNode` 收藏节点、`TextFavorites` 收藏文本，支持分类、搜索、导入导出与快捷键。
- **快捷键**：`IgnoreGroups` 通过 `igShortcut`（默认 `i`，可在设置中修改）切换选中编组的忽略/旁路；收藏面板支持单条/全部输出、重命名、导入导出等快捷操作。
- **设置中心**：承载背景、连线、外观、性能、菜单与配置导入导出等全局设置；语言可在设置中切换，界面与节点端口标签随之本地化。

## 服务端接口

| 接口 | 方法 | 用途 |
| --- | --- | --- |
| `/wosai/color_presets` | GET / POST | 读取或保存 NodeColor 的最近颜色与自定义预设。 |
| `/wosai/device_info` | GET | 读取已脱敏的运行环境、硬件和路径状态。 |
| `/wosai/device_info/open_path` | POST | 打开设备面板中已登记的目录；拒绝显式跨站请求。 |
| `/wosai/probe_image_size` | GET | 探测 ComfyUI 输入目录中的图片尺寸，供 SizeSelect 前端兜底使用。 |

服务端接口不可用时，前端会对相应功能降级处理。

## 兼容性

### 版本与画布

- 最低声明的 ComfyUI 版本：`0.2.0`。
- 同时支持 **LiteGraph 经典画布** 与 **Nodes 2.0** 两套界面。

### Nodes 2.0

- `SizeSelect` 在可用时注册 Nodes 2.0 V3 Schema；旧版环境保留 V1 节点定义。
- `NumberSwitch` 使用原生 Autogrow 动态端口。

### Classic 画布

- `NodeColor`、`OmniSlider`、`SizeSelect`、`TitleNote` 与 `IgnoreGroups` 均包含 LiteGraph 经典画布的兼容处理。

### 其它

- `LogicSwitch` 为后端逻辑节点，前端仅通过 `web/logic-switch.js` 做端口标签国际化，无 Nodes 2.0 兼容负担。
- Screen EyeDropper 依赖浏览器的 `EyeDropper` API；不支持时自动降级。

## 验证与测试

```bash
npm test
npm run quality
npm run check:i18n
npm run check:integrity
npm run benchmark:frontend
npm run test:comfy
npm run test:ui
npm run release:package
npm run lint
```

- `npm test`：运行 `web/shared/` 中的纯函数单元测试。
- `npm run quality`：依次运行 ESLint、设计令牌检查、前端测试、i18n、版本/作者、共享数据、项目完整性、体积预算、性能基准和发布静态检查；GitHub Actions 使用同一命令。
- `npm run check:i18n`：校验中英文语言包、静态 `t()` 调用、节点元数据和紧凑英文标签长度。
- `npm run check:integrity`：解析全部 JSON，核对内部导入、扩展资源、依赖声明、包锁版本和代码空白字符。
- `npm run benchmark:frontend`：重复测量 800 节点布局、5000 条节点搜索和 2000 条 SaveNode 数据清洗，并执行中位数/P95 预算。
- `npm run test:comfy`：访问已启动 ComfyUI 的真实资源服务，从清单入口递归验证共享模块、清单样式与运行时动态样式路径。
- `npm run test:ui`：使用 Playwright 在 Classic 与 Nodes 2.0 中验证 CommonColor 的真实指针/下拉/端口交互、176% 缩放命中、Preset Manager 窄宽度布局、180 节点压力和连续重载。
- `npm run release:package`：生成确定性 ZIP 和 SHA-256，并在隔离的 `ComfyUI/custom_nodes` 目录验证校验和、内部 import、安装内容与语法。
- `npm run lint`：检查 WOSAI CSS/JS 中的设计令牌、硬编码样式与 i18n 问题。

正式发布仍需在目标 ComfyUI 版本中保留 Classic / Nodes 2.0 截图，并对实际 GPU/VAE 模型组合做一次完整工作流执行。

## 项目结构

```text
WOSAI-ComfyUI/
├── nodes/                 # 后端节点定义
├── wosai_core/            # 注册表、配置与服务端接口
├── web/
│   ├── *.js               # ComfyUI 前端扩展入口
│   ├── shared/            # 可复用模块与单元测试
│   ├── styles/            # 设计令牌、主题与功能样式
│   ├── locales/           # 中英文翻译
│   └── data/              # 调色板数据
├── scripts/               # Lint 与 ComfyUI 宿主回归脚本
├── dev/                   # 未接入运行时的前端地基与内部审计（不随发布包分发）
├── tests/                 # Python、aiohttp 与 Playwright 宿主测试
├── workflows/             # 示例工作流
├── docs/                  # 技术报告与发布清单
└── extension.json         # 扩展资源清单
```

## 许可证

[MIT License](LICENSE) · 作者：穿山阅海

本项目**主体**按 MIT 授权。其中 5 个前端文件是 GPL-3.0 许可项目的衍生作品，
按 **GPL-3.0-or-later** 授权，**不适用** MIT 条款：

| 文件 | 来源项目（许可） |
| --- | --- |
| `web/auto-connect.js` | [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes)（GPL-3.0，kijai） |
| `web/shake-disconnect.js` | 同上 |
| `web/performance-mode.js` | 同上 |
| `web/shared/graph-utils.js` | 同上 |
| `web/ignore-groups.js` | [Goohaitools-comfyui](https://github.com/goohai/Goohaitools-comfyui)（GPL-3.0，goohai） |

完整条款见 [LICENSE-GPL-3.0](LICENSE-GPL-3.0)；完整署名、出处与审计记录见
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 发布维护

- 版本变更见 [CHANGELOG.md](CHANGELOG.md)。
- 双前端兼容工作流见 `workflows/WOSAI_frontend_compat_test.json`。
- 发布前按 [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) 完成自动门禁与人工回归。
- 已启动本地 ComfyUI 时，可执行 `npm run release:check` 完成质量门禁、真实资源/UI 回归和发布包验证。
