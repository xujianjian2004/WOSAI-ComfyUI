# ComfyUI 节点元素隐藏最佳实践

> 适用范围：在自定义节点中隐藏「标题栏 / 节点体面板 / 边框 / 角标(来源 Badge) / 端口名 / 原生右键菜单 / 参数 Widget(消除空行)」。
> 配套技能：标题与版标可参考 `comfyui-title-hiding`，隐藏参数 widget 的"藏参五件套"可参考 `comfyui-hidden-widget`，本文档在二者基础上补齐 **Nodes 2.0 Vue DOM** 与各元素的统一实践。
> 关键前提：ComfyUI v10 存在 **两套并行渲染**，任何隐藏功能都必须**两条路都覆盖**，否则只在一种模式下生效。

---

## 0. 两套渲染模式

| 模式 | 渲染方式 | 节点来源 | 控制手段 |
| --- | --- | --- | --- |
| **Classic（经典）** | LiteGraph 在 `<canvas>` 上 2D 绘制 | 画布像素，无独立 DOM | 覆写 `LGraphCanvas.prototype.*` 绘制方法、改 `node.*` 属性 |
| **Nodes 2.0** | Vue 组件渲染成真实 DOM | 每个节点是 `[data-node-id]` DOM 子树 | 注入 CSS / 操作 DOM；画布钩子对它**无效** |

判断当前节点走哪条路：

```js
const domNode = document.querySelector(`[data-node-id="${node.id}"]`);
// domNode 存在 → Nodes 2.0(Vue DOM)；不存在 → Classic(画布)
```

> 用户可随时在设置里切换渲染模式，**不要假设只有一种**。最稳妥是两套机制同时挂上，按节点是否有 DOM 各自生效。

---

## 1. 总体架构原则

1. **画布钩子全局只挂一个**。`drawNodeShape` / `drawNode` 这类原型方法若被多个扩展各自 hook，会因加载顺序/轮询互相覆盖，导致功能**反复失效**。同一插件内应收敛到**单一 wrapper**，内部按标志分发（配色、隐藏等都在这一个 wrapper 里处理）。
2. **Nodes 2.0 用「按 node-id 注入 CSS」而非 MutationObserver**。CSS 规则对「未来出现/被 Vue 重渲的 DOM」自动生效，无需监听、无需反复打补丁、零常驻开销。只在标志变化时重建样式表文本。
3. **写 `node.*` 属性前要容错**。Nodes 2.0 把部分属性变成**只读 getter**（如 `title_mode`），直接赋值抛 `Cannot set property ... which has only a getter`，会**中断整个处理函数**。一律 `try/catch`。
4. **状态持久化 + 可逆**。隐藏标志存 `node.properties`（LiteGraph 自动序列化随工作流保存）；关闭时完整还原 `color / bgcolor / title_mode / badges / label`。
5. **隐藏不破坏功能**。端口名隐藏要保留圆点与连线；标题隐藏要保留节点体与 widget 交互。

```js
// 单一入口：切换标志后统一调用，内部同时处理画布属性 + Nodes 2.0 注入 CSS
function applyNodeDisplay(node) {
  // 1) 仅 Classic 改 node.color/bgcolor（Nodes 2.0 别碰，见 §3）+ try/catch 处理 title_mode
  // 2) 还原/清空 node.badges、写 output.label
  // 3) 调用 refreshDOMHide() 注入/刷新 Nodes 2.0 的隐藏 CSS
  // 4) setDirtyCanvas 重绘
}
```

---

## 2. 隐藏标题栏

### Classic
标题画在 `drawNodeShape` 内（v10 的 ComfyUI 把标题/节点体都收在 `drawNodeShape`，**不是** `drawNodeTitle`）。对目标节点跳过 `drawNodeShape` 即可隐藏标题+背景，而原始 `drawNode` 随后仍会画端口/widget。

```js
const orig = LGraphCanvas.prototype.drawNodeShape;
LGraphCanvas.prototype.drawNodeShape = function (node, ctx) {
  if (node?._hideTitle && node.type === MY_TYPE) {
    node.bgcolor = "transparent"; node.color = "#fff0";
    return;                       // 跳过标题+节点体背景；端口由 drawNode 后续绘制
  }
  return orig.apply(this, arguments);
};
```

> 备选：`node.title_mode = LiteGraph.NO_TITLE` + 覆写 `drawNodeTitle`。但实测 v10 标题走 `drawNodeShape`，且 `title_mode` 在 Nodes 2.0 只读（见踩坑#1），所以**主用 drawNodeShape**。

### Nodes 2.0
标题是独立 DOM `[data-testid="node-header-<id>"]`，注入 CSS 隐藏：

```css
[data-node-id="76"] [data-testid^="node-header"]{ display:none !important; }
```

---

## 3. 隐藏节点体面板（背景）

### Classic
跳过 `drawNodeShape`（见上）即不画面板背景；兜底设 `node.bgcolor = "transparent"`。

### Nodes 2.0
面板背景在 `node-body` 的 Tailwind 类上，需 CSS 覆盖（`node.bgcolor` 改不动 Tailwind 类）：

```css
[data-node-id="76"] [data-testid="node-inner-wrapper"],
[data-node-id="76"] [data-testid^="node-body"]{ background-color:transparent !important; }
```

> ⚠ **千万不要在 Nodes 2.0 下设 `node.bgcolor = "transparent"` 来隐藏面板**（哪怕只想兜底）。
> ComfyUI 会把 `node.bgcolor` 写进 `node-inner-wrapper` 的 **inline CSS 变量 `--component-node-background`**（面板色正是由它驱动）。隐藏时写成 `transparent` 后，显示时即便 `delete node.bgcolor`，**Vue 不会回收这个 inline 变量**，于是面板**永久透明、无法恢复**。
>
> 正确做法：Nodes 2.0 的面板透明**完全交给上面的 CSS 规则**；`node.color / bgcolor` **仅 Classic（canvas 绘制）模式**才设。判断后分流：
>
> ```js
> const isNodes2 = !!document.querySelector(`[data-node-id="${node.id}"]`);
> if (hideTitle) {
>   if (!isNodes2) { node.color = "#fff0"; node.bgcolor = "transparent"; }  // 仅 Classic
>   // Nodes 2.0：透明由 _osRefreshDOMHide 注入的 CSS 负责，不碰 node.bgcolor
> }
> ```
>
> 兜底清理（应对历史会话已污染的节点）：显示时主动删 inner-wrapper / body 上的残留 inline——`removeProperty('--component-node-background')`、`removeProperty('background-color')`、`removeProperty('background-image')`。只有在「不再每次隐藏都重设 bgcolor」之后，这个删除才不会被 Vue 反复回写而稳定生效。

---

## 4. 隐藏边框

### Classic
随 `drawNodeShape` 跳过一并消失。

### Nodes 2.0
边框是一个**独立的绝对定位浮层**（`absolute inset-0` + `.border-component-node-border`），不在容器/inner-wrapper 上：

```css
[data-node-id="76"] .border-component-node-border{ border-color:transparent !important; }
```

---

## 5. 隐藏角标（节点来源 Badge，如 "WOSAI"）

### Classic
角标是画布绘制的 `LGraphBadge`，存在 `node.badges` 数组里、在 `drawNode` 内绘制。**在 `drawNodeShape`（角标绘制之前）清空 `node.badges`** 即可（先存原值以便还原）：

```js
// drawNodeShape wrapper 内，"每帧先还原再按需清空" → 关闭开关后自动恢复
if (node._origBadges !== undefined) { node.badges = node._origBadges; node._origBadges = undefined; }
if (node._hideBadge && node.badges?.length) { node._origBadges = node.badges; node.badges = []; }
```

> ⚠ 不要为了清角标单独再 hook `drawNode`——会破坏 `drawNodeShape` 的标题拦截。统一放进同一个 `drawNodeShape` wrapper。

### Nodes 2.0 — 形态 A：节点内「来源角标」（随节点 DOM）
角标是底部一行 DOM，定位特征是 `.mt-auto.text-muted-foreground`（mt-auto 把它推到节点底部，这俩类组合唯一对应角标行），在 `[data-node-id]` 作用域内，用注入 CSS 隐藏：

```css
[data-node-id="76"] .mt-auto.text-muted-foreground{ display:none !important; }
```

> 注意：DOM 角标选择器随 ComfyUI 前端版本可能变化，**务必现场 F12 核对**（见附录诊断脚本）。早期猜的 `[data-testid="node-badge"]` / `:has(.bg-...)` 在本版本均未命中。

### Nodes 2.0 — 形态 B：页面级「浮动版标」（不在节点 DOM 里）
某些版本/某些版标是**页面级浮层**，用 CSS 变量定位、挂在 `<body>` 下而非 `[data-node-id]` 内 —— 按 node-id 作用域的 CSS **抓不到**，必须全局清理：

```js
// 1) 全局 CSS（隐藏已知版标容器）
const s = document.createElement("style");
s.textContent = `
  div.pointer-events-none.fixed.top-0.left-0.z-40[style*="--tb-x"]{display:none!important;}
  [data-testid="node-badge"],.node-badge,[class*="node-badge"],[class*="node_badge"]{display:none!important;}`;
document.head.appendChild(s);

// 2) MutationObserver + 定时兜底（处理后插入的版标）
function removeBadges() {
  document.querySelectorAll('div.pointer-events-none.fixed.top-0.left-0.z-40,[data-testid="node-badge"],.node-badge,[class*="node-badge"]')
    .forEach(el => {
      if (el.closest('[data-my-panel],.my-panel')) return;        // ⚠ 排除自家 UI，别误删
      if ((el.textContent||'').trim() === MY_TITLE) el.remove();    // ⚠ 只删本节点的版标（按文本匹配）
    });
}
new MutationObserver(removeBadges).observe(document.body, { childList:true, subtree:false });
[500,1500,3000].forEach(d => setTimeout(removeBadges, d));         // 异步渲染兜底
```

> ⚠ 两个安全红线：(a) `closest()` **排除自家面板/弹窗**（设置面板里常含版权"WOSAI"字样，否则会把自己删掉 → 面板弹不出来）；(b) 按 `textContent === 本节点标题` **精确匹配**，避免误删其它节点的版标。`subtree:false` 只看 body 直接子节点，降开销。

---

## 6. 隐藏端口名（保留圆点与连线）

要点：只隐藏**文字**，不动圆点（否则没法连线）。

### Classic
端口显示文字取 `slot.label ?? slot.name`。把 `output.label` 设为**零宽空格 `​`**（空串在 v10 会回退显示 `name`，所以用零宽空格而非 `""`）：

```js
node.outputs[i].label = hidePort ? "​" : realLabel;   // 圆点/连线不受影响
```

### Nodes 2.0
端口名是 `.lg-slot--output` 内的 `span.text-node-component-slot-text`：

```css
[data-node-id="76"] .lg-slot--output .text-node-component-slot-text{ display:none !important; }
```

---

## 7. 隐藏参数 Widget（Python hidden 参数 / 消除空行）

Python 端 `INPUT_TYPES` 的 `"hidden"` dict 只是标记「不作为输入端口」，**不会**让前端不渲染——LiteGraph 仍遍历 `node.widgets` 为每个控件累加高度，导致节点底部出现**空白行**。纯 DOM-widget 节点（如 OmniSlider 用自绘 DOM 替代原生控件）尤其需要彻底藏掉这些原生 widget。

### 「藏参五件套」+ v10 布局属性

```js
function hideWidget(w) {
  w.hidden = true;
  w.computeSize = () => [0, 0];     // Classic 布局：宽高 0
  w.getHeight = () => 0;
  w.draw = () => {};                // 不画
  w.label = "";
  w.last_y = 0;                     // ⭐ 最关键：LiteGraph 用 last_y 累加总高；必须 0，不能用负值
  w.computedHeight = 0;
  w.margin_top = 0;
  w.size = [0, 0];
  // ⭐ ComfyUI v10 新布局引擎用 computeLayoutSize（而非 computeSize）算行高，必须一并归零
  w.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, height: 0, minWidth: 0 });
  // 显式可序列化（部分版本会给 hidden widget 自动设 serialize:false）
  if (w.options) w.options.serialize = true; else w.options = { serialize: true };
  // 隐藏关联 DOM
  const el = w.element || w.dom;
  if (el) { el.style.cssText = "display:none!important;height:0!important;margin:0!important;padding:0!important;"; }
}
```

> 关键点：`last_y = 0`（GJJ 实测，**不要用 `-10000` 负值**，某些版本会布局错乱）；v10 必须额外覆盖 `computeLayoutSize`，否则每个隐藏 widget 仍占 ~24px → 顶部/中部大片空白。

### 多层防护（widget 列表会在不同阶段重建）

| 时机 | 作用 |
| --- | --- |
| `beforeRegisterNodeDef` / `onNodeCreated` | 新建节点即时隐藏 |
| `onConfigure` | 加载工作流时隐藏（需延迟 ~120ms 二次确认，DOM 可能晚渲染） |
| `setup()` 全局扫描 | 处理启动时画布已存在的节点 |
| Nodes 2.0 兜底 | 全局 CSS 按 `aria-label`/`data-path`/`input[name]` 命中隐藏 widget 行 `display:none`；MutationObserver 收口 |

### 删除隐藏参数残留的输入端口

隐藏 widget 可能在左侧留下悬空输入圆点，需主动删 `node.inputs`：

```js
function removeHiddenInputSockets(node, names) {
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    if (names.has(node.inputs[i]?.name)) {
      try { node.disconnectInput?.(i); } catch (_) {}
      node.removeInput ? node.removeInput(i) : node.inputs.splice(i, 1);
    }
  }
}
```

### Proxy Widget（纯序列化用）

需要新增「不在 Python INPUT_TYPES、仅用于随工作流序列化」的隐藏 widget 时，直接 push 一个 proxy 进 `node.widgets`（v10 下 hidden 输入可能既不在 widgets 也不在 inputs，必须主动创建）：

```js
node.widgets.push({
  name, type: "STRING", value, hidden: true, options: { serialize: true },
  callback(v){ if (v !== undefined) this.value = v; },
  computeSize: () => [0,0], getHeight: () => 0, draw: () => {}, label: "",
  last_y: 0, computedHeight: 0, margin_top: 0, size: [0,0],
  computeLayoutSize: () => ({ minHeight:0, maxHeight:0, height:0, minWidth:0 }),
});
```

### 收尾

每次隐藏/显示后刷新尺寸，否则空白不消失：

```js
function refreshNodeSize(node) {
  const s = node.computeSize?.() || [];
  node.setSize?.([Math.max(200, node.size?.[0]||s[0]||200), Math.max(60, s[1]||node.size?.[1]||60)]);
  node.setDirtyCanvas?.(true, true);
}
```

> 动态显隐（下拉切模式）：`showWidget` 把上述被覆盖的方法/属性还原为 `undefined` 让 LiteGraph 重算，再 `refreshNodeSize`。

### 隐藏必填 Widget（Required Input）

若 Widget 在 Python `INPUT_TYPES` 中是**必填**（无 `optional`/`default`），**不能**用 `setWidgetVis(w, false)` 或任何会从 `node.widgets` splice 的函数——ComfyUI 提交时会校验 `node.widgets` 中是否存在必填项，缺失即报 `Required input is missing`。

正确做法：用「藏参五件套」**只隐藏外观、不移除数组**：

```js
// ❌ 错误：从数组移除，必填校验失败
node.widgets.splice(node.widgets.indexOf(w), 1);

// ✅ 正确：保留数组，只隐藏
w.hidden = true;
w.computeSize = () => [0, 0];
w.getHeight = () => 0;
w.draw = () => {};
w.last_y = 0;
w.computedHeight = 0;
w.margin_top = 0;
w.size = [0, 0];
w.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, height: 0, minWidth: 0 });
if (w.options) w.options.serialize = true; else w.options = { serialize: true };
const el = w.element || w.dom;
if (el) el.style.cssText = "display:none!important;height:0!important;margin:0!important;padding:0!important;";
```

> **鉴别方法**：Python 端 `INPUT_TYPES` 中有 `"required": True`（默认）且无 `optional` 标记的字段，即为必填。若拿不准，一律用藏参五件套而非 splice。

---

## 8. 屏蔽 / 替换原生右键菜单

需求通常是「在节点（或某个控件）上右键 → 打开自定义面板，而不是 LiteGraph 原生菜单」。

在该控件的 DOM 上监听 `contextmenu`，`preventDefault + stopPropagation` 阻断冒泡到画布：

```js
el.addEventListener("contextmenu", e => {
  e.preventDefault();
  e.stopPropagation();        // 阻止 LiteGraph 原生菜单
  openMyPanel(node);
});
```

配套：
- **拖动只认左键**：`pointerdown` 里 `if (e.button !== 0) return;`，把右键留给 contextmenu。
- 仅拦截**控件区域**的右键；节点其余位置/标题栏右键仍出原生菜单。
- 保留一个**右键菜单兜底项**（`getNodeMenuItems`）作为发现入口，触摸端长按也会触发 `contextmenu`。
- 若个别 v10 版本在 document 捕获阶段处理 contextmenu 导致原生菜单仍闪出，改成捕获阶段监听拦截。

---

## 9. Nodes 2.0 DOM 选择器速查表

> 均以 `[data-node-id="<id>"]` 作用域前缀。**版本相关，使用前请现场核对。**

| 目标 | 选择器 | 处理 |
| --- | --- | --- |
| 标题栏 | `[data-testid^="node-header"]` | `display:none` |
| 边框 | `.border-component-node-border` | `border-color:transparent` |
| 标题色背景 | `[data-testid="node-inner-wrapper"]` | `background-color:transparent` |
| 面板背景 | `[data-testid^="node-body"]` | `background-color:transparent` |
| 来源角标行 | `.mt-auto.text-muted-foreground` | `display:none` |
| 输出端口名 | `.lg-slot--output .text-node-component-slot-text` | `display:none` |
| 折叠按钮 | `[data-testid="node-collapse-button"]` | （随 header 一起隐藏） |

注入实现（核心）：

```js
function refreshDOMHide(nodes) {
  let style = document.getElementById("my-dom-hide")
    || document.head.appendChild(Object.assign(document.createElement("style"), { id: "my-dom-hide" }));
  let css = "";
  for (const node of nodes) {              // 只含开启了任一隐藏标志的本类型节点
    const s = `[data-node-id="${node.id}"]`;
    if (node._hideTitle) css += `${s} [data-testid^="node-header"]{display:none!important;}` +
      `${s} .border-component-node-border{border-color:transparent!important;}` +
      `${s} [data-testid="node-inner-wrapper"],${s} [data-testid^="node-body"]{background-color:transparent!important;}`;
    if (node._hideBadge) css += `${s} .mt-auto.text-muted-foreground{display:none!important;}`;
    if (node._hidePort)  css += `${s} .lg-slot--output .text-node-component-slot-text{display:none!important;}`;
  }
  style.textContent = css;                  // 重建即可，CSS 自动对现/未来 DOM 生效
}
```

---

## 10. 状态持久化与还原

```js
// 持久化（随工作流保存）
node.properties.hideTitle = on;   node._hideTitle = on;

// 加载（onConfigure 里回读）
node._hideTitle = !!node.properties.hideTitle;  // badge / port 同理
applyNodeDisplay(node);

// 关闭 / 扩展卸载：还原
node.color = node._origColor; node.bgcolor = node._origBgColor;
try { node.title_mode = node._origTitleMode; } catch (_) {}
if (node._origBadges !== undefined) node.badges = node._origBadges;
updateOutputLabel(node);          // 还原端口名
// 原型方法在 remove() 中恢复，注入的 <style> 清空/移除
```

---

## 11. 踩坑清单

| 现象 | 根因 | 解决 |
| --- | --- | --- |
| 切到 Nodes 2.0 后**整段隐藏全失效** | 给只读 getter `node.title_mode` 赋值抛错，中断 `applyNodeDisplay`，后续 DOM 注入没执行 | 所有 `node.title_mode = x` 包 `try/catch` |
| 隐藏功能**时好时坏/反复** | 多个扩展各自 hook `drawNodeShape`，加载顺序+轮询互相覆盖 | 同插件收敛到**单一 wrapper**，内部分发 |
| 标题隐藏了但**端口也没了** | 在 `drawNode` 层整段 `return` 只画背景，跳过了端口绘制 | 改跳 `drawNodeShape`，让原始 `drawNode` 继续画端口 |
| 加"清角标"后**标题又冒出来** | 额外 hook `drawNode` 破坏了 `drawNodeShape` 的标题拦截 | 清角标放进 `drawNodeShape` wrapper，别再包 drawNode |
| 角标关掉后**不恢复** | 一次性 restore 时机不对/被每帧清空覆盖 | wrapper 内「每帧先还原再按需清空」 |
| 端口名置 `""` 仍显示 | v10 `label` 为空串时回退显示 `name` | 用零宽空格 `​` |
| Nodes 2.0 注入 CSS 不生效 | 选择器是**猜的**，与真实 DOM 不符 | F12 现场核对真实 `data-testid` / class |
| 设置面板（含版权"WOSAI"字样）被自己删 | 角标 DOM 清理选择器过宽、误删自家面板 | 清理选择器严格限定 + `closest()` 排除自身 UI |
| 浅色模式输入框文字看不清 | 主题 CSS 选择器写成 `[data-theme=light] .panel`，但 `data-theme` 在 `.panel` 自身上 | 用 `.panel[data-theme="light"]` |
| 隐藏参数后节点底部仍有**空白行** | 只设 `hidden=true`，`last_y` 未归零 | 上「藏参五件套」，`last_y = 0`（非负值）+ `computedHeight = 0` |
| v10 下隐藏 widget 仍占 ~24px 空白 | 只覆盖了 `computeSize`，没覆盖 v10 的 `computeLayoutSize` | 补 `computeLayoutSize = () => ({height:0,...})` |
| 节点左侧有**悬空输入圆点** | 隐藏 widget 残留 `node.inputs` 端口 | `removeHiddenInputSockets()` 删除匹配端口 |
| 角标按 node-id 注 CSS 仍隐藏不掉 | 该版标是**页面级浮层**，不在 `[data-node-id]` 内 | 改全局 CSS + Observer + 定时 + 文本匹配（形态 B） |
| 工作流重开后空白行/隐藏失效 | 缺 `onConfigure` 钩子或没延迟二次确认 | `onConfigure` 里同步隐藏 + ~120ms 再确认一次 |
| Nodes 2.0 隐藏面板后**再显示仍透明、无法恢复** | 隐藏时设了 `node.bgcolor="transparent"`，被 ComfyUI 写进 inner-wrapper 的 inline CSS 变量 `--component-node-background`，显示后 Vue **不回收**该变量 | Nodes 2.0 **不设 `node.bgcolor`**（透明交给注入 CSS）；只 Classic 才设。详见 §3 警告 |
| 手动删 `--component-node-background` 能恢复、但代码删无效 | 旧逻辑每次隐藏都重设 `bgcolor`，Vue 在你删除后又**反复回写** | 先断掉「隐藏时设 bgcolor」的源头，`removeProperty` 才能稳定生效 |

---

## 附录：现场诊断脚本

在 ComfyUI 控制台（F12）运行，拿到真实 DOM 结构再写选择器：

```js
(() => {
  const omni = [...document.querySelectorAll('[data-node-id]')]
    .find(el => (el.textContent || '').includes('你的节点标题'));
  if (!omni) return 'MODE=CANVAS（无 data-node-id，是画布渲染）';
  const out = [];
  omni.querySelectorAll('*').forEach(el => {
    const t = el.getAttribute('data-testid');
    const cls = typeof el.className === 'string' ? el.className : '';
    const txt = (el.textContent || '').trim();
    if (t || /header|title|badge|wrapper|body|border|slot/i.test(cls) || ['WOSAI'].includes(txt))
      out.push(el.tagName.toLowerCase() + (t ? ` [testid=${t}]` : '') + ` .${cls.split(/\s+/).slice(0,4).join('.')}`);
  });
  return 'MODE=VUE id=' + omni.getAttribute('data-node-id') + '\n' + out.slice(0, 50).join('\n');
})()
```

---

## 12. 与 WOSAI 设计规范的整合

节点隐藏/显示功能本身也是 WOSAI UI 的一部分，其触发入口、提示文案、状态反馈必须遵循《WOSAI UI 开发规范》与 `wosai-design` skill。

### 12.1 触发控件统一使用 WOSAI 组件

用于切换隐藏的按钮、开关、菜单项，应优先复用：

| 场景 | 推荐组件 |
| --- | --- |
| 设置面板内开关 | `.wosai-btn` + `.wosai-active` |
| 多选模式切换 | `.wosai-seg` / `.wosai-seg-item` |
| 标签/过滤胶囊 | `.wosai-tag-btn` |
| 右键菜单项 | `.wosai-panel` 内 `.wosai-btn` |
| 图标入口 | `.wosai-icon-btn` |

### 12.2 文案必须走 i18n

所有与用户相关的文案禁止硬编码：

```js
// 推荐
btn.textContent = i18n.t("hideNodeTitle");
tooltip.textContent = i18n.t("hideNodeTitleHint");

// 禁止
btn.textContent = "隐藏标题";
```

建议键名：
- `hideNodeTitle` / `showNodeTitle`
- `hideNodeBadge` / `showNodeBadge`
- `hidePortNames` / `showPortNames`
- `compactMode` / `normalMode`

### 12.3 状态视觉反馈

开启隐藏后，触发控件本身应给出明确反馈：
- 按钮切换为 `.wosai-active`，背景填充 `--ws-accent`
- 必要时在节点旁显示 `.wosai-badge` 提示当前状态
- 禁用/不可用的隐藏选项使用 `--ws-text-muted` 并置 `cursor: not-allowed`

### 12.4 面板内布局

若隐藏功能放在节点设置面板内，必须使用 `.wosai-row` 双列 Grid：

```css
.wosai-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--ws-gap-lg);
  align-items: center;
}
```

## 13. 性能、可访问性与测试

### 13.1 性能建议

- **避免每个节点一个 MutationObserver**：全局只需一个 Observer，在 body 层级观察，内部按 node-id / 文本过滤。
- **CSS 规则批量重建**：`refreshDOMHide` 一次性重建整段样式表，不要逐节点反复 `insertRule`。
- **节点数量大时**：如果工作流中有数百个节点，建议把隐藏规则按类型聚合，只维护一条全局规则而非按 node-id 穷举。
- **清理时机**：扩展卸载、节点删除、工作流清空时，移除注入的 `<style>`、恢复原型方法、断开 Observer。

### 13.2 可访问性

- 隐藏标题后，节点仍应可通过键盘聚焦。
- 使用 `aria-label` / `aria-pressed` 标注切换按钮的当前状态。
- 端口名隐藏后，确保屏幕阅读器仍可通过 `aria-label` 读取端口含义。
- 动态显隐时，焦点不应丢失；如果控件被隐藏，焦点应回到父容器或相邻控件。

### 13.3 测试策略

每次修改隐藏逻辑后，至少在以下两种环境下验证：

| 环境 | 检查项 |
| --- | --- |
| Classic（画布）模式 | 标题/背景/边框/角标/端口名是否正常隐藏与恢复 |
| Nodes 2.0（Vue DOM）模式 | 真实 DOM 选择器是否命中、面板透明后能否恢复 |
| 浅色主题 | 隐藏后残留元素颜色是否突兀 |
| 工作流保存/加载 | 隐藏状态是否正确持久化与还原 |
| 大量节点 | 是否有明显卡顿、Observer 是否过载 |

### 13.4 调试清单

- 打开 F12，运行「附录：现场诊断脚本」确认渲染模式与 DOM 结构。
- 在 `applyNodeDisplay` 入口加 `console.log("mode", isNodes2, node.id, flags)`，确认两条路都走到。
- 检查 `node.properties` 中是否正确写入了隐藏标志。
- 检查注入的 `<style id="my-dom-hide">` 的 `textContent` 是否包含目标规则。
- 检查是否有其它扩展也 hook 了 `drawNodeShape` 并覆盖了本扩展的行为。

## 14. 完整示例：WOSAI 紧凑节点

下面是一个同时处理 Classic + Nodes 2.0 的完整最小示例，整合了本文档的关键实践：

```js
import { app } from "../../scripts/app.js";

const STYLE_ID = "wosai-compact-node-style";
const TYPE = "WOSAI_CompactNode";

function refreshCompactStyle(nodes) {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  let css = "";
  for (const node of nodes) {
    if (!node._compact) continue;
    const s = `[data-node-id="${node.id}"]`;
    css += `${s} [data-testid^="node-header"]{display:none!important;}`;
    css += `${s} .border-component-node-border{border-color:transparent!important;}`;
    css += `${s} [data-testid="node-inner-wrapper"],${s} [data-testid^="node-body"]{background-color:transparent!important;}`;
    css += `${s} .mt-auto.text-muted-foreground{display:none!important;}`;
  }
  style.textContent = css;
}

function applyCompact(node) {
  const isNodes2 = !!document.querySelector(`[data-node-id="${node.id}"]`);

  // Classic 模式：跳过 drawNodeShape + 透明背景
  if (!isNodes2 && node._compact) {
    node.color = "#fff0";
    node.bgcolor = "transparent";
  } else if (!isNodes2) {
    node.color = node._origColor || node.color;
    node.bgcolor = node._origBgColor || node.bgcolor;
  }

  // 角标：先还原再按需清空
  if (node._origBadges !== undefined) {
    node.badges = node._origBadges;
    node._origBadges = undefined;
  }
  if (node._compact && node.badges?.length) {
    node._origBadges = node.badges;
    node.badges = [];
  }

  // 端口名
  for (let i = 0; i < (node.outputs || []).length; i++) {
    const out = node.outputs[i];
    if (!out._realLabel) out._realLabel = out.label || out.name;
    out.label = node._compact ? "​" : out._realLabel; // 零宽空格
  }

  // Nodes 2.0 注入 CSS
  refreshCompactStyle(Object.values(app.graph._nodes_by_id).filter(n => n.type === TYPE));

  node.setDirtyCanvas?.(true, true);
}

// 画布钩子：单一 wrapper
let drawNodeShapeOrig;
app.registerExtension({
  name: "WOSAI.CompactNode",
  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== TYPE) return;

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onCreated?.apply(this, arguments);
      this._origColor = this.color;
      this._origBgColor = this.bgcolor;
      this._compact = !!this.properties?.compact;
      applyCompact(this);
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      onConfigure?.apply(this, arguments);
      this._compact = !!this.properties?.compact;
      setTimeout(() => applyCompact(this), 120);
    };
  },
  setup() {
    if (!drawNodeShapeOrig) {
      drawNodeShapeOrig = LGraphCanvas.prototype.drawNodeShape;
      LGraphCanvas.prototype.drawNodeShape = function (node, ctx) {
        if (node?._compact && node.type === TYPE) {
          node.color = "#fff0";
          node.bgcolor = "transparent";
          return; // 不画标题/背景；端口由后续 drawNode 绘制
        }
        return drawNodeShapeOrig.apply(this, arguments);
      };
    }
  },
});

// 切换函数（由按钮/右键菜单调用）
export function toggleCompact(node) {
  node.properties = node.properties || {};
  node.properties.compact = !node.properties.compact;
  node._compact = node.properties.compact;
  applyCompact(node);
}
```

---

## 15. 与 WOSAI 收藏节点的协同

收藏节点（F2 打开）在 Nodes 2.0 下可能以悬浮面板形式出现，其自身不应被节点隐藏逻辑误伤：

- 在全局版标清理 Observer 中，用 `closest('[data-wosai-panel],.wosai-panel')` 排除自家面板。
- 收藏节点快捷入口如果采用「页面级浮层」，参考 §5 形态 B 处理，严格按文本/自定义 data 属性匹配。
- 收藏节点内部 UI 完全遵循 `.wosai-panel`、`.wosai-btn`、`.wosai-icon-btn` 规范。

---

## 16. 版本兼容建议

| ComfyUI 版本 | 注意事项 |
| --- | --- |
| v10 早期 | `drawNodeShape` 可能未统一收标题，需同时准备 `drawNodeTitle` 兜底 |
| v10 当前 | 以本文档为准，Nodes 2.0 DOM 选择器需 F12 核对 |
| 未来版本 | 如果 Vue DOM 结构变化，优先改 `refreshDOMHide` 中的选择器，不动业务逻辑 |

---

*基于 WOSAI-ComfyUI（OmniSlider / NodeColor / CanvasNote）实战总结。ComfyUI 前端持续迭代，Nodes 2.0 的 testid/class 可能变化，落地前务必用上方脚本核对。*
