# WOSAI-ComfyUI 代码质量改进报告

日期：2026-07-28  
版本：2.0.0  
范围：Python 节点、aiohttp 路由、LiteGraph Classic / Nodes 2.0 前端、设计系统、测试、性能与发布工程。

## 1. 结论

本轮已按风险与收益顺序完成计划内优化，未改变既有节点 ID、关键输入输出名称或工作流序列化主契约。当前自动门禁全部通过，CommonColor 已在 Classic 与 Nodes 2.0 中完成真实交互回归，项目已具备可重复的质量检查、性能预算和发布检查流程。

主要结果：

- WOSAI UI lint 从 97 项降为 0 项，并纳入 `npm run quality`。
- Node 单元测试 232/232 通过。
- Python 单元、节点契约与请求级集成测试 53/53 通过。
- ComfyUI 真实资源冒烟测试通过：29 个入口、79 个递归模块、15 个清单样式、14 个运行时样式。
- i18n 校验通过：1166 个语言键、544 个静态调用键、15 个节点类型。
- 前端主 JavaScript 为 1328.9 KiB；526.1 KiB 拼音库保持延迟加载。
- Playwright 双前端交互、热重载、Preset Manager 窄宽度布局和 180 节点压力测试 4/4 通过。
- npm 依赖安全审计为 0 个漏洞。
- 浏览器确认共享变量与主题样式各只加载一份，版本为 v15 / v2。
- 浏览器确认无 WOSAI 自身的 deprecated menu monkey-patch 告警。

## 2. 已完成改进

### 2.1 服务端安全与数据边界

- 有副作用的颜色预设保存和目录打开接口拒绝显式跨站浏览器请求。
- 目录打开由原始路径改为服务端已登记的路径键与索引，不接受任意本地路径。
- 设备报告隐藏代理值、完整 Python 路径和命令行参数值。
- 颜色预设限制请求体、记录数量及 HEX 格式，并使用锁、同目录临时文件、`fsync` 和原子替换。
- SaveNode 导入、缓存及颜色数据使用同一套有界清洗契约。

### 2.2 节点契约与兼容性

- CommonColor 输出固定为可连接 EmptyImage `color` 的 INT，并同时提供规范化 HEX。
- SizeSelect 支持 IMAGE、MASK、LATENT、VAE，保留元数据并支持非固定空间压缩倍率。
- OmniSlider 的后端通配数值端口与前端动态 INT/FLOAT 输出一致。
- NumberSwitch、LazyFallback 与 OmniSlider 共用通配类型实现。
- 保持既有工作流字段和关键节点标识不变。

### 2.3 UI 设计系统

- CommonColor、HubBar 的历史硬编码颜色、尺寸和字体已迁移到 WOSAI 设计令牌。
- 纯数据文件不再触发视觉硬编码误报。
- CommonColor 菜单、隐藏取色触发器和两个胶囊控件使用统一样式契约。
- UI lint 提供摘要模式，0 问题门禁已接入 CI。
- 中英文菜单、节点名称和紧凑标签均由 i18n 校验覆盖。

### 2.4 双前端真实回归

LiteGraph Classic 与 Nodes 2.0 均已验证：

- CommonColor 可创建，两个胶囊的几何、文字对齐和间距一致。
- 颜色预设左右三角可切换，中部可打开下拉菜单。
- 可选择品牌橙、HUB 紫等预设，颜色名称与 HEX 实时更新。
- 英文界面下，预设胶囊和下拉菜单统一显示 `Custom`、`Brand Orange`、`HUB Violet` 等本地化名称，同时保留中文稳定值用于工作流序列化。
- 自定义颜色取色器可触发。
- 切换 Nodes 2.0 后控件仍可交互，测试后已恢复用户原有 Classic 设置。
- 自动 UI 套件覆盖双模式交互、180 个 CommonColor 节点压力和连续三次页面重载。
- 实际 176% 画布缩放复核发现 Nodes 2.0 专用控件画布的 CSS 指针坐标与内部绘制坐标不一致，现已按画布边界换算回绘制坐标，并补充纯函数及真实 DOM 指针回归。
- Preset Manager 改用统一 DOM Widget 尺寸契约；手动缩窄时操作区和标签网格响应式重排，单页分页区不再占位；多页分页改按节点真实底边测量，清除 Nodes 2.0 重复品牌页脚占位，并将 Classic/Nodes 2.0 的底部间距约束为不超过 12px。
- Classic 的 180 节点冷启动预算保持 5 秒；Nodes 2.0 因需挂载 360 个 Vue Canvas 使用独立的 6.5 秒预算，稳态帧率和堆增长预算不放宽。

### 2.5 模块拆分与前端 API

- IgnoreGroups 的工作流状态读写提取到纯模块并覆盖恢复、范围约束和无关属性保留测试。
- OmniSlider 的默认配置、旧格式迁移和序列化提取到纯模块。
- MenuHide 与 LayoutToolkit 不再覆写 `getCanvasMenuOptions` / `getNodeMenuOptions`，已迁移至 ComfyUI 官方扩展菜单钩子。
- RunHighlight 移除 WOSAI 对旧 `scripts/ui.js` 的依赖，并由性能门禁阻止重新引入已弃用前端模块。
- RunHighlight 的缺失输入、缺失节点与限时错误状态已恢复可达；错误高亮会在 6 秒后主动刷新并停止计时，不再残留或形成无效重绘。
- NodeColor、ColorBar、TitleNote 和 SaveNode 的异步初始化、短延时任务、观察器、画布补丁及全局回调均增加代次保护和对称卸载；SaveNode 改为在 `setup()` 内惰性建实例。
- 方法补丁使用可组合、可逆的稳定补丁管理器，降低热重载和卸载顺序风险。
- NodeColor 状态/定位、SaveNode 目录/配色/搜索、IgnoreGroups 状态/几何、Launcher 形象状态/视口几何继续拆分为无 DOM 的纯模块。
- SaveNode 收藏筛选与排序只保留一套实现，避免渲染与批量操作结果分叉。
- 单个主 JavaScript 文件预算从 128 KB 经 112 KB 继续收紧到 107 KB。

### 2.6 请求级集成测试

新增真实 aiohttp 应用与测试客户端，覆盖：

- 颜色预设 GET/POST 往返及数据清洗。
- 跨站请求、非法 JSON、非法载荷结构和超限请求体。
- DeviceInfo 动态刷新参数。
- 目录打开的跨站拒绝、未知路径、非法 JSON 与安全成功路径。
- Windows `startfile`、macOS `open`、Linux `xdg-open` 的无 Shell 参数契约。
- 16× 空间压缩 VAE 编码的像素对齐和 latent 形状。

测试中的目录打开使用替身，不会调用系统文件管理器。GitHub Actions 会显式安装测试所需 aiohttp。

### 2.7 性能与资源加载

- 变量和主题 CSS 的版本与注入统一到 `ensureWosaiStyles`，DeviceInfo、IgnoreGroups、LayoutToolkit、TitleNote 不再各自加载旧版本。
- 性能门禁限制主 JavaScript、单文件、样式和延迟拼音包体积；主 JS 总量预算同步收紧到 1.4 MB。
- 门禁禁止静态导入拼音库、禁止绕过共享主题加载器、禁止创建无清理路径的定时器。
- 门禁禁止缺少 `disconnect()` 的 MutationObserver，并对 MutationObserver / interval 总数设置 10 / 3 的回归预算。
- 新增可重复基准：800 节点布局、5000 条节点搜索、2000 条 SaveNode 清洗；本机中位数约为 1.6 / 7.0 / 2.1 ms。
- 当前审计统计：81 个主 JS 文件、15 个样式、9 个 MutationObserver、3 个 interval；预算全部通过。

### 2.8 发布工程

- 新增 `CHANGELOG.md`。
- 新增 `docs/RELEASE_CHECKLIST.md`。
- 新增 `workflows/WOSAI_frontend_compat_test.json`，包含 CommonColor → EmptyImage INT 连接及 6 个兼容性节点。
- 新增 `check:release`，校验版本、发布文档、兼容工作流、包清单和扩展资源路径。
- `release:check` 串联全量质量门禁与真实 ComfyUI 资源冒烟测试。
- `MANIFEST.in` 已包含变更记录、节点、核心模块、Web 资源、工作流和文档。
- `build_release.py` 生成排序、固定时间戳的确定性 ZIP 和 SHA-256。
- `test:comfy` 会从 29 个清单入口递归抓取扩展内模块，阻止拆分后的共享依赖漏部署。
- `check:integrity` 会解析全部 JSON，核对内部相对导入、扩展资源、运行时依赖声明、包锁版本与代码空白字符。
- 新增 `.gitattributes`，统一源码与文档的 LF 入库格式并显式标记二进制资源，避免跨平台换行漂移。
- `verify_release.py` 在隔离 `ComfyUI/custom_nodes` 目录解包，检查 SHA-256、重复条目、路径穿越、开发文件泄漏、内部 import、JSON、前端入口、JS 语法和 Python 编译。
- 已验证 158 个发布文件、29 个 JSON、44 个扩展资源；同一源码状态重复构建哈希一致。

## 3. 最终验证

执行并通过：

```text
npm run quality
H:\ComfyUI\python\python.exe -B -m unittest discover -s tests -p "test_*.py" -v
npm run test:comfy
npm run test:ui
npm audit --audit-level=high
H:\ComfyUI\python\python.exe scripts/build_release.py
H:\ComfyUI\python\python.exe scripts/verify_release.py
git diff --check
```

结果：

| 门禁 | 结果 |
| --- | --- |
| ESLint | 通过 |
| WOSAI UI lint | 0 问题 |
| Node 测试 | 232/232 |
| Python 测试 | 53/53 |
| i18n | 1166 locale keys，15 节点 |
| 共享数据 | 46 颜色，4 分辨率档位 |
| 项目完整性 | 249 文件，30 JSON，内部导入与依赖声明一致 |
| 版本/作者 | 2.0.0 / 穿山阅海，一致 |
| 性能预算 | 通过 |
| 发布静态检查 | 6 个兼容节点，29 脚本，15 样式 |
| ComfyUI 冒烟 | 29 入口，79 递归模块，15 清单样式，14 运行时样式 |
| Playwright UI | 4/4，双模式、176% 命中、窄宽度布局、热重载、180 节点压力 |
| npm 安全审计 | 0 vulnerabilities |
| 算法基准 | 布局约 1.6 ms，搜索约 7.0 ms，清洗约 2.1 ms |
| 发布包 | 158 文件，隔离安装通过，确定性 SHA-256（见 `dist/WOSAI-ComfyUI-2.0.0.zip.sha256`） |
| diff 空白检查 | 通过 |

## 4. 剩余风险与后续建议

以下不是本轮阻断项：

1. `node-color.js`、`save-node.js`、`ignore-groups.js`、`launcher.js` 当前分别约 103.4 / 93.1 / 86.5 / 83.2 KiB，均低于 107,000 B（约 104.5 KiB）门禁。后续仍可按“DOM 构建、画布渲染、生命周期”继续拆分，但已不构成本轮阻断项。
2. 当前 ComfyUI 页面仍会报告其他扩展及宿主旧菜单的弃用告警；最新页面中未发现归属于 WOSAI 的菜单 monkey-patch 告警。
3. 16× VAE 形状和 DeviceInfo 平台命令已有宿主替身测试，但 GPU/VAE 模型执行与实际系统文件管理器仍需发布前人工确认。
4. 标准 wheel 不是本插件推荐安装路径；继续以 ComfyUI Manager 或源码目录安装为主。
5. 工作区包含用户此前的大量迁移改动，本轮未自动暂存、提交、撤销或清理这些改动。

## 5. 发布建议

代码质量门禁与源码安装包均达到候选发布状态。正式发布前只需按 `docs/RELEASE_CHECKLIST.md` 完成实际 GPU/VAE、系统目录打开和目标版本截图留档。
