---

name: comfyui-port-i18n

description: ComfyUI 节点端口多语言翻译方案——切换语言时端口名同步汉化/英化，且不触发 Vue Nodes 2.0 重复端口。

---

# ComfyUI 端口 i18n 方案

## 适用场景

自定义节点需要在 ComfyUI 切换语言时，同步翻译输入/输出端口名称（如 `"image"` → `"图像"`）。

## 根因（第一性原理）

`applyNodePortTranslation`（i18n.js）改写 `port.name` 后，ComfyUI Vue Nodes 2.0 的端口校验逻辑会因 `port.name !== nodeDef.name` 判定端口缺失，直接 `push` 新端口到 `node.inputs`，**完全绕过 `addInput`**，造成重复端口。

## 解决方案：`port.label` 替代 `port.name`

LiteGraph 中：

- `port.name`：身份标识，用于匹配/序列化，**不要改**
- `port.label`：显示字段，`port.label || port.name` 决定画布上显示的文字

保持 `port.name` 始终为原始英文名 → Vue 校验永远匹配 → 不产生重复 → 不需要轮询/去重。

## 代码模板

```javascript
import { t, onLangChange } from "./shared/i18n.js";

/**
 * 仅设 port.label 用于显示，不改 port.name（保持与 nodeDef 一致，防止 Vue 误判端口缺失）
 * 翻译 key 格式：nodeDefs.{NodeType}.inputs.{origName}.name / nodeDefs.{NodeType}.outputs.{origName}.name
 */
function applyPortLabel(node) {
    if (!node?.type) return;
    for (const [ports, section] of [[node.inputs, 'inputs'], [node.outputs, 'outputs']]) {
        if (!ports) continue;
        for (const port of ports) {
            if (port._wosaiOrigName == null) port._wosaiOrigName = port.name;
            const key = `nodeDefs.${node.type}.${section}.${port._wosaiOrigName}.name`;
            const trans = t(key);
            if (trans !== key && trans !== port.label) {
                port.label = trans;
            }
        }
    }
}
```

## 语言切换集成

```javascript
// setup() 或 beforeRegisterNodeDef 中注册
onLangChange(() => {
    if (!app.graph?._nodes) return;
    for (const n of app.graph._nodes) {
        if (n.type !== MY_TYPE) continue;
        applyPortLabel(n);
    }
    app.graph.setDirtyCanvas(true, true);
});
```

## 节点创建时集成

```javascript
nodeType.prototype.onNodeCreated = function () {
    origOnCreated?.apply(this, arguments);
    applyPortLabel(this);
    // ... 其他初始化
};
```

## locale 文件格式

`web/locales/{lang}/nodeDefs.json`：

```json
{
  "WOSAI_MyNode": {
    "inputs": {
      "image":  { "name": "图像" },
      "mask":   { "name": "遮罩" }
    },
    "outputs": {
      "image":  { "name": "图像" },
      "width":  { "name": "宽度" }
    }
  }
}
```

## 踩坑清单

| 问题 | 原因 | 解决 |
| --- | --- | --- |
| 切换语言后端口重复 | 改了 `port.name`，Vue 找不到匹配 | 只设 `port.label`，不碰 `port.name` |
| 端口名未翻译 | `applyPortLabel` 未在 `onLangChange` 中调用 | 确保回调中遍历所有本类型节点 |
| `_wosaiOrigName` 未设置 | 首次翻译前未初始化 | `if (port._wosaiOrigName == null) port._wosaiOrigName = port.name` |
| 翻译 key 找不到 | key 格式错误或 locale 文件缺少条目 | key 格式：`nodeDefs.{type}.{inputs\ | outputs}.{origName}.name` |
| 创建时 widget 显示原始名 | `waitForWidgets` 回调里漏设 label，只在 `_ss_refreshLang` 中设 | 创建时立即设 label，不能只靠语言切换回调 |
| Widget label 切换语言后没更新 | `_ss_refreshLang` 只在 `onLangChange` 中调用 | 确保 `onLangChange` 回调调用 `_ss_refreshLang()` |
| 经典模式下 widget 永久隐藏 | 需要在 `waitForWidgets` 回调中立即调用 `setWidgetVis(w, false)` | 不要放在 `applyMode` 里做条件切换 |

## 禁止事项

- ❌ 调用 `applyNodePortTranslation`（会改 `port.name`）
- ❌ 直接赋值 `port.name = translatedName`
- ❌ 用轮询/setTimeout 赌 Vue 挂载时机（不可靠）

## 相关文件

- `web/shared/i18n.js`：`t()` 函数、`onLangChange`、`applyNodePortTranslation`（**不要用**）
- `web/locales/{lang}/nodeDefs.json`：端口翻译字典
