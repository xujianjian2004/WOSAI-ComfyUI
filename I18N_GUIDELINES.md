# WOSAI i18n 双语规范 / Bilingual i18n Guidelines

WOSAI 的用户界面统一支持中文（`zh`）和英文（`en`）。新增或修改功能时，所有用户可见文案都必须遵循本规范。

## 1. 前端文案

使用共享模块提供的 `t()`，键名采用“语言包层级 + camelCase”格式：

```js
import { t, onLangChange } from "./shared/i18n.js";

button.textContent = t("menus.example.action", "Example action");
button.title = t("menus.example.actionHint", "Run the example action");
```

- 禁止直接把中文或英文 UI 文案写入 `textContent`、`title`、`placeholder`、Toast、确认框或菜单项。
- fallback 使用英文，保证语言包加载失败时仍可读。
- 技术标识、文件扩展名、单位、快捷键和内部协议字段不需要翻译；解析器中的语言别名应使用 Unicode 转义或在 lint 白名单中说明原因。
- 动态文案使用 `{name}`、`{count}` 等占位符，并在调用处替换；中英文键必须保留相同占位符。

### 紧凑控件文案

按钮、右键菜单、命令名称、节点分类和紧凑设置项使用短英文标签，建议控制在 24 个字符以内；完整解释放到独立的 `*Hint`、`*Tooltip` 或描述词条中。不要为了缩短提示词、确认信息、Toast 或帮助文案而牺牲可读性。

每个新键必须同时添加到：

```text
web/locales/zh/<layer>.json
web/locales/en/<layer>.json
```

层级选择：`common` 公共按钮，`menus` 菜单/HUD，`settings` 设置，`nodes` 节点面板，`widgets` 控件，`saveNode`/`saveText` 专用面板。

## 2. 节点元数据

每个 `WOSAI_*` 节点都必须在 `web/locales/zh/nodeDefs.json` 和 `web/locales/en/nodeDefs.json` 提供：

```json
{
  "display_name": "…",
  "description": "…",
  "category": "🟠 WOSAI Studio / …",
  "inputs": { "internal_name": { "name": "…", "tooltip": "…" } },
  "outputs": { "internal_name": { "name": "…" } }
}
```

节点内部输入名必须保持稳定，用于工作流序列化和 `getWidget()` 查找；只更新显示标签，不要改写 `widget.name`。

共享 `web/shared/i18n.js` 会处理节点标题、分类、端口、控件标签和语言切换刷新。纯前端节点的属性标题使用 `localizedProp()`，节点类使用 `registerLocalizedNode()`。

## 3. 语言切换

面板创建后仍需监听 `onLangChange()`，重新渲染已经存在的 DOM；不能只在模块加载时调用一次 `t()`。节点实例的端口/控件由共享 i18n 层自动刷新。

## 4. 校验

提交前运行：

```bash
npm.cmd run check:i18n
npm.cmd test
npm.cmd run lint
```

`check:i18n` 会验证 JSON、中文/英文键树、静态 `t()` 键、所有 WOSAI 节点元数据，以及受控英文紧凑标签不超过 24 个字符。
