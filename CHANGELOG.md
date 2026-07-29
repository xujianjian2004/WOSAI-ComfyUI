# Changelog

本文件记录 WOSAI-ComfyUI 的用户可见变更。版本号遵循语义化版本。

## [Unreleased]

_(暂无未发布变更。)_

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
