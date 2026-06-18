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

*基于 WOSAI-ComfyUI（OmniSlider / NodeColor / CanvasNote）实战总结。ComfyUI 前端持续迭代，Nodes 2.0 的 testid/class 可能变化，落地前务必用上方脚本核对。*
