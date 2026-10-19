// 忽略编组「原生标题随缩放比放大」契约（治本方案）。
// 背景（第一性原理）：ComfyUI 画布标题带的全部几何量都在绘制期读 LiteGraph
// 全局常量——背景带 rect(0,-h,w,h) 高取 NODE_TITLE_HEIGHT、文字基线取
// NODE_TITLE_TEXT_Y - NODE_TITLE_HEIGHT、字体派生自 NODE_TEXT_SIZE、
// 标题小方块定位由 title_height 推导。缩放比调大后 node.size 随档位增长，
// 而标题恒为 30 画布像素 ⇒ 标题与可点热区相对缩水。
// 根治 = 绘制期按 wosai_ig_scale 临时覆盖这几个常量，让原生标题本身等比放大：
// 不重复渲染 DOM 标题、不占内容高度、命中区同步增大，拖动走 LiteGraph 原生路径。
// （旧方案「DOM 标题条 + 隐藏原生标题」已整套删除，本测试同时防回归。）
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE = fs.readFileSync(path.join(ROOT, "ignore-groups.js"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "styles", "ignore-groups.css"), "utf8");
const VARS = fs.readFileSync(path.join(ROOT, "styles", "wosai-variables.css"), "utf8");
const LT_SOURCE = fs.readFileSync(path.join(ROOT, "layout-toolkit.js"), "utf8");
const DOM_WIDGET = fs.readFileSync(path.join(ROOT, "shared", "dom-widget.js"), "utf8");
const zhNodes = JSON.parse(fs.readFileSync(path.join(ROOT, "locales", "zh", "nodes.json"), "utf8"));
const enNodes = JSON.parse(fs.readFileSync(path.join(ROOT, "locales", "en", "nodes.json"), "utf8"));

function extractFunctionBody(code, name) {
    const start = code.indexOf(`function ${name}`);
    if (start === -1) return null;
    const brace = code.indexOf("{", start);
    if (brace === -1) return null;
    let depth = 0;
    let end = -1;
    for (let i = brace; i < code.length; i += 1) {
        if (code[i] === "{") depth += 1;
        else if (code[i] === "}") {
            depth -= 1;
            if (depth === 0) { end = i + 1; break; }
        }
    }
    return code.slice(brace, end);
}

const INSTALL_BODY = extractFunctionBody(SOURCE, "_igInstallTitleScale");
const NODE_SCALE_BODY = extractFunctionBody(SOURCE, "_igNodeScale");
const WITH_CONST_BODY = extractFunctionBody(SOURCE, "_igWithTitleConstants");
const FORCE_LOD_BODY = extractFunctionBody(SOURCE, "_igForceFullQuality");
const CALC_HEIGHT_BODY = extractFunctionBody(SOURCE, "calcHeight");
const APPLY_SCALE_BODY = extractFunctionBody(SOURCE, "_applyScale");
const POPUP_SCALE_BODY = extractFunctionBody(SOURCE, "applyPopupScale");

test("drawNode 补丁：标题几何常量按缩放比覆盖，finally 逐一还原", () => {
    assert.ok(INSTALL_BODY, "必须能抽取出 _igInstallTitleScale 函数体");
    assert.ok(WITH_CONST_BODY, "必须能抽取出 _igWithTitleConstants 函数体");
    assert.match(INSTALL_BODY, /patchMethod\(/, "必须通过 patchMethod 组合补丁（与 rgthree/Goohai 等既有 drawNode 补丁共存）");
    assert.match(INSTALL_BODY, /"drawNode"/, "必须拦截 drawNode");
    assert.match(INSTALL_BODY, /"WOSAI\.IgnoreGroups\.scaleNativeTitle"/, "补丁 id 必须稳定唯一");
    // 三个常量都必须缩放：只改高度会让文字基线固定在「带顶下方 20px」而溢出标题带
    assert.match(WITH_CONST_BODY, /LG\[keys\[i\]\]\s*=\s*Math\.round\(prev\[i\]\s*\*\s*s\)/,
        "标题几何常量必须按缩放比覆盖（NODE_TITLE_HEIGHT / NODE_TEXT_SIZE / NODE_TITLE_TEXT_Y 三键）");
    assert.match(WITH_CONST_BODY, /finally\s*\{[\s\S]*LG\[keys\[i\]\]\s*=\s*prev\[i\]/,
        "finally 必须还原全部常量，保证其他节点与后续绘制不受污染");
    assert.match(WITH_CONST_BODY, /if\s*\(s\s*<=\s*1\s*\|\|\s*_igTitleConstDepth\s*>\s*0\)\s*return\s*fn\(\)/,
        "缩放比为 1（默认）或已在覆盖窗口内时必须零干预直接放行");
    assert.match(WITH_CONST_BODY, /_igTitleConstDepth\+\+/,
        "进入覆盖窗口必须递增重入深度");
    assert.match(WITH_CONST_BODY, /_igTitleConstDepth--/,
        "退出覆盖窗口必须递减重入深度（finally 内）");
    assert.match(SOURCE, /_IG_TITLE_KEYS_ALL\s*=\s*\["NODE_TITLE_HEIGHT",\s*"NODE_TEXT_SIZE",\s*"NODE_TITLE_TEXT_Y"\]/,
        "绘制/测量窗口必须同时覆盖三常量");
    assert.match(INSTALL_BODY, /_igWithTitleConstants\(s,\s*_IG_TITLE_KEYS_ALL/,
        "drawNode 补丁必须走共享常量覆盖助手（与 updateArea 同一窗口口径）");
    assert.match(INSTALL_BODY, /if\s*\(\s*s\s*<=\s*1\s*\)\s*return\s*next\.call/,
        "缩放比为 1（默认）时必须零干预直接放行，不能无故改写全局常量");
});

test("updateArea 补丁：帧首测量期同步放大命中区（boundingRect / renderArea）", () => {
    assert.match(INSTALL_BODY, /"updateArea"/,
        "帧首测量入口必须拦截，否则标题带画大了仍点不中（点击穿透到下层节点）");
    assert.match(INSTALL_BODY, /"WOSAI\.IgnoreGroups\.scaleTitleHitArea"/, "补丁 id 必须稳定唯一");
    assert.match(INSTALL_BODY, /_igWithTitleConstants\(s,\s*_IG_TITLE_KEYS_ALL,\s*\(\)\s*=>\s*next\.call\(this,\s*ctx\)\)/,
        "updateArea 必须在同一常量覆盖窗口内执行，boundingRect/renderArea 才按放大后的标题带计算");
    assert.match(INSTALL_BODY, /_igNodeScale\(\s*this\s*\)/, "updateArea 是节点方法，必须用 this 取缩放档");
});

test("isPointInCollapse 补丁：折叠按钮热区随标题带放大", () => {
    assert.match(INSTALL_BODY, /"isPointInCollapse"/,
        "折叠按钮热区入口必须拦截，否则圆点画在带中央而热区仍在顶部 30px 见方，点空");
    assert.match(INSTALL_BODY, /"WOSAI\.IgnoreGroups\.scaleCollapseHit"/, "补丁 id 必须稳定唯一");
    assert.match(INSTALL_BODY, /_igWithTitleConstants\(s,\s*_IG_TITLE_KEYS_H,/,
        "折叠热区只取 NODE_TITLE_HEIGHT，不得顺带缩放字号（命中判定与字号无关）");
    assert.match(SOURCE, /_IG_TITLE_KEYS_H\s*=\s*\["NODE_TITLE_HEIGHT"\]/, "折叠热区键表只含 NODE_TITLE_HEIGHT");
});

test("LOD 豁免：低画布缩放下本节点标题文字不消失", () => {
    assert.ok(FORCE_LOD_BODY, "必须能抽取出 _igForceFullQuality 函数体");
    assert.match(INSTALL_BODY, /_igForceFullQuality\(this,\s*s\)/, "drawNode 补丁必须申请 LOD 豁免");
    assert.match(INSTALL_BODY, /if\s*\(restoreLod\)\s*restoreLod\(\)/, "绘制结束必须还原 LOD 状态，不得污染全局");
    assert.match(FORCE_LOD_BODY, /min_font_size_for_lod/, "LOD 阈值取自画布 min_font_size_for_lod");
    assert.match(FORCE_LOD_BODY, /Math\.sqrt\(canvas\.dpr/, "阈值含 √dpr 修正（与 ComfyUI 口径一致）");
    assert.match(FORCE_LOD_BODY, /s\s*\*\s*scale\s*<\s*threshold/,
        "判据必须是「本节点实际屏幕字号」= 缩放比 × 画布缩放，而非全局画布缩放");
    assert.match(FORCE_LOD_BODY, /canvas\._isLowQuality\s*=\s*false/, "满足判据时强制全质量");
    assert.match(FORCE_LOD_BODY, /canvas\._isLowQuality\s*=\s*prev/, "finally 还原 _isLowQuality");
    assert.match(FORCE_LOD_BODY, /minFont\s*<=\s*0/, "LOD 被禁用（min_font=0）时不得干预");
});

test("drawTitleBox 补丁：标题小方块仅对本类型节点等比放大", () => {
    assert.match(INSTALL_BODY, /"drawTitleBox"/, "标题小方块尺寸取调用点硬编码值，必须单独缩放");
    assert.match(INSTALL_BODY, /"WOSAI\.IgnoreGroups\.scaleTitleBox"/, "补丁 id 必须稳定唯一");
    assert.match(INSTALL_BODY, /LGraphNode\.prototype/, "drawTitleBox 在 LGraphNode.prototype 上");
    assert.match(INSTALL_BODY, /box_size:\s*base\s*\*\s*s/, "box_size 必须乘以缩放比");
    assert.match(INSTALL_BODY, /\{\s*\.\.\.opts,\s*box_size/, "必须保留 opts 其余字段（scale/low_quality/title_height）");
    assert.match(INSTALL_BODY, /_igNodeScale\(\s*this\s*\)/, "drawTitleBox 是节点方法，必须用 this 取缩放档");
});

test("_igNodeScale 门控：仅本类型、Classic 模式、归一化取值", () => {
    assert.ok(NODE_SCALE_BODY, "必须能抽取出 _igNodeScale 函数体");
    assert.match(NODE_SCALE_BODY, /n\.type\s*!==\s*_IG_TYPE/, "非本类型节点必须返回 1，不得干预其他节点");
    assert.match(NODE_SCALE_BODY, /vueNodesMode/, "Vue 模式标题由覆盖层渲染，必须跳过");
    assert.match(NODE_SCALE_BODY, /normalizeIgnoreGroupsScale\(/, "缩放档必须走单一归一化口径（1–5、半步进）");
    assert.match(NODE_SCALE_BODY, /wosai_ig_scale/, "缩放档来源必须是持久化的 node.properties.wosai_ig_scale");
});

test("安装时机：轮询等待 app.canvas，setup 触发，remove 全部销毁", () => {
    assert.match(SOURCE, /_igTryInstallTitleScale\(\);[\s\S]*?function hookGraph\(\)/,
        "setup() 必须触发安装轮询");
    assert.match(SOURCE, /setTimeout\(\(\)\s*=>\s*_igTryInstallTitleScale\(attempts\s*-\s*1\),\s*250\)/,
        "app.canvas 未就绪时必须轮询重试（前端加载时序不确定）");
    assert.match(SOURCE, /_igTitleBoxScaleDispose\(\);\s*_igTitleBoxScaleDispose\s*=\s*null/,
        "remove() 必须销毁 drawTitleBox 补丁（旧代码从未 dispose，属泄漏）");
    assert.match(SOURCE, /_igTitleScaleDispose\(\);\s*_igTitleScaleDispose\s*=\s*null/,
        "remove() 必须销毁 drawNode 补丁");
    assert.match(SOURCE, /_igTitleHitDispose\(\);\s*_igTitleHitDispose\s*=\s*null/,
        "remove() 必须销毁 updateArea 命中区补丁");
    assert.match(SOURCE, /_igCollapseHitDispose\(\);\s*_igCollapseHitDispose\s*=\s*null/,
        "remove() 必须销毁 isPointInCollapse 热区补丁");
    assert.match(SOURCE, /_igTitleConstDepth\s*=\s*0/, "remove() 必须重置重入深度，防止残留挂起状态");
    // 先脱内层再脱外层，顺序无关但要都脱
    const boxIdx = SOURCE.indexOf("_igTitleBoxScaleDispose();");
    const nodeIdx = SOURCE.indexOf("_igTitleScaleDispose();");
    assert.ok(boxIdx !== -1 && nodeIdx !== -1 && boxIdx < nodeIdx,
        "应先销毁 drawTitleBox 补丁再销毁 drawNode 补丁");
});

test("DOM 标题条整套移除：不得回退到「复刻标题 + 隐藏原生」的治标方案", () => {
    for (const symbol of ["buildTitleBar", "_wosaiIgHasTitlebar", "_igTitleCoverShift",
        "_igTitleGutterCache", "_igDrag", "_igEndHandleDrag", "_igOnHandleMove",
        "_igOnHandleUp", "__wosaiPanelNodeDrag", "_igTitleSuppressDispose"]) {
        assert.ok(!SOURCE.includes(symbol), `ignore-groups.js 不得残留 ${symbol}`);
    }
    assert.ok(!/wosai-ig-titlebar/.test(SOURCE), "JS 不得再构建 DOM 标题条");
    assert.ok(!/\.wosai-ig-titlebar/.test(CSS), "CSS 不得保留 .wosai-ig-titlebar 规则");
    for (const token of ["--ws-ig-title-h", "--ws-ig-title-dot", "--ws-ig-title-grip-w",
        "--ws-ig-title-letter-spacing"]) {
        assert.ok(!VARS.includes(token), `wosai-variables.css 不得保留孤儿令牌 ${token}`);
        assert.ok(!SOURCE.includes(token), `ignore-groups.js 不得引用已删令牌 ${token}`);
        assert.ok(!CSS.includes(token), `ignore-groups.css 不得引用已删令牌 ${token}`);
    }
    assert.match(VARS, /--ws-ig-title-row-gap:/, "同名不同义的 --ws-ig-title-row-gap（设置窗行距）必须保留");
    assert.ok(!LT_SOURCE.includes("__wosaiPanelNodeDrag"),
        "layout-toolkit 的互斥守卫必须随设置方一并移除（原生拖动走 canvas.node_dragged）");
    assert.equal(zhNodes.ignoreGroups.dragHandle, undefined, "zh 不得保留 dragHandle 死键");
    assert.equal(enNodes.ignoreGroups.dragHandle, undefined, "en 不得保留 dragHandle 死键");
    assert.ok(!SOURCE.includes("IG-DIAG"), "诊断日志必须清除");
});

test("几何：标题带在框外不占内容高，面板不再上移覆盖", () => {
    assert.ok(CALC_HEIGHT_BODY, "必须能抽取出 calcHeight 函数体");
    assert.ok(!CALC_HEIGHT_BODY.includes("--ws-ig-title-h"),
        "calcHeight 不得再计入 DOM 标题条高度（原生标题带画在框原点上方，不占内容高）");
    assert.ok(!CALC_HEIGHT_BODY.includes("head"),
        "calcHeight 不得保留标题头部变量");
    assert.ok(APPLY_SCALE_BODY, "必须能抽取出 _applyScale 函数体");
    assert.ok(!APPLY_SCALE_BODY.includes("marginTop"),
        "_applyScale 不得再用负 marginTop 上移面板（面板由 widget.y 静态锚在框内，天然位于标题带下方）");
    assert.match(APPLY_SCALE_BODY, /rootEl\.style\.height\s*=\s*\(\s*bh\s*\*\s*s\s*\)\s*\+\s*"px"/,
        "rootEl 高度必须严格等于缩放后的内容高，不再含覆盖位移");
    assert.match(APPLY_SCALE_BODY, /contentEl\.style\.zoom\s*=\s*.*String\(s\)/,
        "必须设置 contentEl.style.zoom 为当前档位");
    assert.match(APPLY_SCALE_BODY, /_igSetNodeSize\(\s*scaledSize\(\)\s*\)/,
        "缩放后必须直接把 node.size 设为 scaledSize()");
});

test("设置窗口随缩放比放大：内层承载 zoom，外层仅定位，且受视口约束", () => {
    assert.ok(POPUP_SCALE_BODY, "必须能抽取出 applyPopupScale 函数体");
    assert.match(POPUP_SCALE_BODY, /body\.style\.zoom/, "zoom 必须加在内层 body 上");
    assert.doesNotMatch(SOURCE, /pop\.style\.zoom/, "zoom 不得加在 fixed 的 pop 上（会连同 left/top 一起放大）");
    assert.match(SOURCE, /width:\s*"max-content"/, "pop 必须 max-content，跟随器才能量到缩放后尺寸");
    assert.match(POPUP_SCALE_BODY, /window\.innerWidth\s*-\s*POPUP_VIEWPORT_MARGIN/,
        "必须按视口宽度夹取，避免高倍弹窗超出屏幕");
    assert.match(POPUP_SCALE_BODY, /window\.innerHeight\s*-\s*POPUP_VIEWPORT_MARGIN/,
        "必须按视口高度夹取");
    assert.match(SOURCE, /zSlider\.addEventListener\(\s*"change",\s*applyPopupScale\s*\)/,
        "缩放比松手后必须重算弹窗缩放");
    assert.match(SOURCE, /body\.setAttribute\(\s*"data-theme"/, "主题切换必须作用在承载视觉样式的内层 body");
});

test("ignore-groups.css 版本号双源必须相等（extension.json ↔ ignore-groups.js）", () => {
    const ext = fs.readFileSync(path.join(ROOT, "..", "extension.json"), "utf8");
    const inExt = ext.match(/"web\/styles\/ignore-groups\.css\?v=(\d+)"/);
    const inJs = SOURCE.match(/ignore-groups\.css\?v=(\d+)/);
    assert.ok(inExt, "extension.json 必须引用 ignore-groups.css");
    assert.ok(inJs, "ignore-groups.js 必须引用 ignore-groups.css");
    assert.equal(inExt[1], inJs[1],
        "两处 ?v 不相等会让 extension.json 侧命中旧缓存（CSS 版本双源陷阱）");
});

test("wosai-variables.css 版本号双源必须相等（extension.json ↔ dom-widget.js）", () => {
    const ext = fs.readFileSync(path.join(ROOT, "..", "extension.json"), "utf8");
    const inExt = ext.match(/"web\/styles\/wosai-variables\.css\?v=(\d+)"/);
    const inDom = DOM_WIDGET.match(/wosai-variables\.css\?v=(\d+)/);
    assert.ok(inExt, "extension.json 必须引用 wosai-variables.css");
    assert.ok(inDom, "dom-widget.js 必须引用 wosai-variables.css");
    assert.equal(inExt[1], inDom[1], "两处 ?v 不相等会命中旧缓存（主题令牌版本双源陷阱）");
});

test("拖动区只属于画布标题带，面板根元素不得吞 pointerdown", () => {
    assert.ok(!/rootEl\.addEventListener\(\s*"pointerdown"/.test(SOURCE),
        "不得把 pointerdown 绑在 rootEl 上，否则整个面板都变成拖动区");
    assert.ok(!/contentEl\.addEventListener\(\s*"pointerdown"/.test(SOURCE),
        "不得把 pointerdown 绑在 contentEl 上，否则行内控件失焦");
});
