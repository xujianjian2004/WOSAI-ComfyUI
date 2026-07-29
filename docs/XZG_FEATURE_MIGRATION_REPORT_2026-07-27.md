# XZG 特色功能迁移报告

日期：2026-07-27  
目标：在不接管 ComfyUI 全局菜单、不执行文件删除或运行时下载的前提下，将 `_ref/xzg` 中可复用的节点与效率功能按 P0–P3 迁移到 WOSAI。

## 迁移原则

- 保持 WOSAI 节点 ID、CSS 变量、i18n 和生命周期管理规范。
- 优先使用 ComfyUI 原生能力；新版 Number Switch 使用 Nodes 2.0 `Autogrow`，旧版使用有界兼容实现。
- 工作流状态必须随节点序列化，不使用跨节点共享的可变全局状态。
- 预览文件只写入 ComfyUI 临时目录，不复制参考项目的磁盘管理、自动下载和全局菜单劫持逻辑。
- 新增快捷入口采用独立命令、上下文菜单和面板按钮，保持功能可发现、可关闭、可回退。

## P0：基础逻辑节点

| 功能 | WOSAI 实现 | 说明 |
| --- | --- | --- |
| 标签选择器 | `WOSAI_Selector` | 可编辑标签、列数与稳定整数输出；最多 24 项。 |
| 布尔选择器 | `WOSAI_BooleanSelector` | 双按钮布尔选择，保留标准 `BOOLEAN` 输入输出。 |
| 编号切换 | `WOSAI_NumberSwitch` | Nodes 2.0 原生动态端口；旧版最多 32 个通配输入。 |
| 惰性回退 | `WOSAI_LazyFallback` | 主输入有效时不计算回退分支。 |

前端由 `web/selector.js` 和 `web/route-switch.js` 提供，后端位于 `nodes/selector.py` 与 `nodes/route_switch.py`。

## P1：图像交互节点

| 功能 | WOSAI 实现 | 说明 |
| --- | --- | --- |
| 点框标注 | `WOSAI_PointsEditor` | 正向点、负向点、矩形框、撤销、清除和批次帧切换。坐标以 0–1 归一化数据保存。 |
| 图像对比 | `WOSAI_ImageCompare` | A/B 临时预览与可拖动分割线，不持久化图像副本。 |

交互状态保存在节点控件中，事件监听使用可释放的生命周期管理；前端位于 `web/media-tools.js`，后端位于 `nodes/media_tools.py`。

## P2：工作流辅助节点

| 功能 | WOSAI 实现 | 说明 |
| --- | --- | --- |
| 获取控件值 | `WOSAI_GetWidget` | 读取连接节点的指定或全部序列化输入值，可保留字段名、可去除常见扩展名。 |
| 首尾帧提取 | `WOSAI_FirstLastFrame` | 从图像批次提取第一帧和最后一帧，保持张量 dtype 与 device。 |

`WOSAI_GetWidget` 的目标控件下拉选项由前端按实际连接节点动态生成，不依赖固定节点类型清单。

## P3：收藏片段与快速节点（已移除）

经功能收敛评估，节点片段收藏与快速节点面板不再随 WOSAI 加载。SaveNode 仅保留节点收藏、分类、搜索、导入导出及文本收藏能力；旧数据中的 `snippets` 与 `quickTypes` 字段会在读取时丢弃。

## 国际化与设计规范

- 8 个新增节点已补齐中英文 `nodeDefs` 元数据。
- 选择器、图像交互与控件读取均使用中英文运行时词条。
- 新 UI 使用 `--ws-*` 颜色、间距、圆角、字体和尺寸变量，并支持 WOSAI 深色、浅色与 Auto 主题。
- DOM 事件和扩展补丁均提供卸载路径，避免刷新或扩展重载后重复注册。

## 验收结果

- Python：18 项单元测试通过。
- JavaScript：170 项单元测试通过。
- ESLint：`web` 与 `scripts` 全量通过。
- i18n：1137 个语言键、550 个静态调用、14 个节点定义通过一致性检查。
- 版本：Python、前端清单与 npm 版本均为 `2.0.0`。
- ComfyUI 宿主：8 个新增节点均出现在 `/object_info`。
- 前端资源：28 个 JavaScript 入口、16 个清单样式和 9 个运行时样式通过宿主加载测试。

## 已知边界

- 节点片段与快速节点功能已从当前版本移除，不再注册快捷键、上下文菜单或面板入口。
- 现有 `web/hub-bar.js` 仍有历史 CSS token/i18n 静态检查债务；本次新增 P0–P3 文件未引入新的 WOSAI UI linter 问题。
