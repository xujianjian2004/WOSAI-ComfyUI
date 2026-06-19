import { app } from "../../../scripts/app.js";
import { getUIFont, resetFontCache, hexToRGBA, WS_ICONS } from "./lib/shared-utils.js";
import { getGlassTheme, getGlassMode, cycleGlassMode, onGlassChange, GLASS_MODE_DEFS } from "./lib/glass-theme.js";
import { drawNodeText, drawResizeHandle, parseTextBlocks, buildTokenList, wrapChars, measureTable } from "./lib/note-renderer.js";
import { bindTip } from "./lib/tooltip.js";

// ========== 兼容性 polyfill ==========
// ctx.roundRect 需 Chrome 99+ / Safari 16+；旧环境补齐，避免绘制时抛错（本文件与 note-renderer 共用）
if (typeof CanvasRenderingContext2D !== "undefined" && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
        let rr = typeof r === "number" ? [r, r, r, r] : (Array.isArray(r) ? r : [0, 0, 0, 0]);
        if (rr.length === 1) rr = [rr[0], rr[0], rr[0], rr[0]];
        else if (rr.length === 2) rr = [rr[0], rr[1], rr[0], rr[1]];
        const lim = Math.min(Math.abs(w) / 2, Math.abs(h) / 2);
        const [tl, tr, br, bl] = rr.map(v => Math.min(v, lim));
        this.moveTo(x + tl, y);
        this.lineTo(x + w - tr, y); this.arcTo(x + w, y, x + w, y + tr, tr);
        this.lineTo(x + w, y + h - br); this.arcTo(x + w, y + h, x + w - br, y + h, br);
        this.lineTo(x + bl, y + h); this.arcTo(x, y + h, x, y + h - bl, bl);
        this.lineTo(x, y + tl); this.arcTo(x, y, x + tl, y, tl);
        this.closePath();
        return this;
    };
}

// ========== CONSTANTS ==========
const NODE_TYPE  = "WOSAI_CanvasNote";
const NODE_TITLE = "Canvas Note";
const PRESET_KEY   = "wosai-custom-presets";
const PANEL_WIDTH  = 360;
const PANEL_OFFSET = 12;
const SWATCH_SIZE  = 22;
const BADGE_DELAYS = [500, 1500, 3000];
const DOM_PREFIX   = "wosai";
function getThemeState() {
    // 返回 var() 引用而非解析值：面板带 data-theme 属性时，CSS 引擎按
    // wosai-variables.css 的深/浅作用域实时取值（接入全插件玻璃主题标准）
    const v = (name, fallback = "") =>
        fallback ? `var(${name}, ${fallback})` : `var(${name})`;
    return {
        panelBg: v("--ws-surface"),
        controlBg: v("--ws-surface-2"),
        inputBg: v("--ws-surface-2"),
        borderMuted: v("--ws-border-muted"),
        borderNormal: v("--ws-border"),
        activeBg: v("--ws-accent"),
        activeBorder: v("--ws-accent"),
        activeHoverBg: v("--ws-accent"),
        textPrimary: v("--ws-text"),
        textSecondary: v("--ws-text-secondary"),
        textMuted: v("--ws-text-muted"),
        textAccent: v("--ws-accent"),
        textActive: v("--ws-text-on-accent"),
        textHover: v("--ws-text-on-accent"),
        saveBg: v("--ws-accent"),
        saveBorder: v("--ws-accent"),
        panelBorder: v("--ws-border"),
        panelShadow: v("--ws-shadow-panel"),
        sliderBg: v("--ws-slider-bg"),
        success: v("--ws-success", "#43a047"),
        danger: v("--ws-danger", "#ef4444"),
    };
}
// 主题判定统一走全插件玻璃主题标准（lib/glass-theme.js：auto 跟随画布亮度 / 手动锁定）
function isDarkTheme() { return getGlassTheme() === 'dark'; }
const VUE_BODY_SELS = ".node-body,.litegraph-node-body,[class*='node-body'],[class*='node_body']";
const _refs = {};

// ========== PRESETS ==========
const DEFAULT_PROPS = {
    text:"📍双击输入内容", fontSize:52, fontWeight:"bold", textAlign:"left", fontColor:"#ffffff", backgroundColor:"#000000", backgroundAlpha:0, lineHeight:1.4, padding:20, borderRadius:0, borderEnabled:false, borderColor:"#2a2d36", borderWidth:0, shadowColor:"#000000", shadowBlur:0, width:600, gradientEnabled:false, gradientColor:"#000000", gradientDirection:0
};
// 预设去重：每项只写「与 DEFAULT_PROPS 的差异」；绝大多数 dark===light，仅"注释"浅色文字不同。
// 末尾构建回原 { dark, light } 结构，消费代码（isDark?pr.dark:pr.light）不变，行为完全等价。
const _PRESET_BASE = {
    "注释": { ...DEFAULT_PROPS },
    "标题": { ...DEFAULT_PROPS, text:"🔥工作流标题", fontSize:72, backgroundColor:"#1d4ed8", backgroundAlpha:0.92, lineHeight:0.8, borderRadius:50, borderColor:"#3b82f6", shadowColor:"#3b82f6" },
    "正文": { ...DEFAULT_PROPS, text:"📚正文 ✦", fontSize:24, fontWeight:"normal", backgroundColor:"#065f46", backgroundAlpha:0.88, borderRadius:8, borderEnabled:true, borderColor:"#10b981", borderWidth:2, shadowColor:"#10b981" },
    "便签": { ...DEFAULT_PROPS, text:"🏷️便签 ✦", fontSize:24, fontWeight:"normal", fontColor:"#3E1600", backgroundColor:"#FFFFCC", backgroundAlpha:1, borderRadius:16, borderEnabled:true, borderColor:"#d4a843", borderWidth:1, shadowColor:"#d4a843", shadowBlur:12 },
    "序号": { ...DEFAULT_PROPS, text:"1", fontSize:60, textAlign:"center", backgroundColor:"#452626", backgroundAlpha:0.88, lineHeight:0.8, borderRadius:50, borderEnabled:true, borderColor:"#643c3c", borderWidth:2, shadowColor:"#643c3c", width:100, height:100 },
};
// 所有预设都不再随主题变文字色（原"注释"浅色 #555555 依赖 canvasIsLight()，
// 但 Nodes 2.0 画布背景常透明→误判浅色→深色画布下注释变灰字。改为恒定，消除该问题）
const _PRESET_LIGHT = {};
const BUILTIN_PRESETS = Object.fromEntries(
    Object.entries(_PRESET_BASE).map(([n, base]) => [n, { dark: { ...base }, light: { ...base, ...(_PRESET_LIGHT[n] || {}) } }])
);
function loadCustomPresets() { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || "{}"); } catch { return {}; } }
function saveCustomPresets(obj) { try { localStorage.setItem(PRESET_KEY, JSON.stringify(obj)); } catch {} }

function openURL(url) { try { if (!/^https?:\/\//i.test(url)) url="https://"+url; window.open(url,"_blank","noopener,noreferrer"); } catch(e) {} }
// 链接命中检测（统一三处调用：onMouseDown / processMouseDown / Vue link click）。
// lx,ly 为节点内容坐标；统一叠加 _scrollY，修正滚动后链接错位。命中返回该 link，否则 null。
function hitLinkArea(node, lx, ly) {
    if (!node.linkAreas?.length) return null;
    const sLy = ly + (node._scrollY || 0);
    for (const a of node.linkAreas) {
        if (lx >= a.x && lx <= a.x + a.width && sLy >= a.y && sLy <= a.y + a.height) return a;
    }
    return null;
}

// ========== DOM ==========
const _vueSelCache = new Map();
function vueSels(id) {
    let cached = _vueSelCache.get(id);
    if (!cached) { cached = [`[data-node-id="${id}"]`,`[data-id="${id}"]`,`#node-${id}`]; _vueSelCache.set(id, cached); }
    return cached;
}
function clearVueSelCache(id) { _vueSelCache.delete(id); }
function hasVueDomNode(node) {
    const now = Date.now();
    if (node._vueDomCache !== undefined && now - node._vueDomCacheTime < 16) return node._vueDomCache;
    let found = false;
    for (const sel of vueSels(node.id)) { const el = document.querySelector(sel); if (el && el.getBoundingClientRect().width > 0) { found = true; break; } }
    node._vueDomCache = found; node._vueDomCacheTime = now; return found;
}
function getNodeViewportRect(node) {
    const cv = window.app?.canvas || LGraphCanvas.active_canvas;
    // Nodes 2.0 优先：用节点 DOM 实际矩形（canvas 坐标换算在 Vue 模式下会失真）。
    // ⚠ 仅用最严格的 [data-node-id] 选择器——宽松的 [data-id]/#node-N 会在
    // Classic 模式误命中页面上其他插件的元素，把编辑框定位到页面底部（已踩坑）
    const vueEl = document.querySelector(`[data-node-id="${node.id}"]`);
    if (vueEl) {
        const body = vueEl.querySelector(VUE_BODY_SELS), r = (body || vueEl).getBoundingClientRect();
        if (r.width > 0) {
            const sc = cv?.ds?.scale ?? 1;
            // 容器矩形含标题区（node.pos 是内容区原点）：用实测高度差校正，
            // 文字编辑框与 canvas 绘制的内容区精确对齐（实测差值 = 30px×scale）
            const titleH = body ? 0 : Math.max(0, r.height - node.size[1] * sc);
            return { left: r.left, top: r.top + titleH, scale: sc };
        }
    }
    // Classic 回退：canvas 坐标换算
    if (cv?.canvas && cv?.ds) { const rect = cv.canvas.getBoundingClientRect(), sc = cv.ds.scale; return { left:rect.left+(node.pos[0]+cv.ds.offset[0])*sc, top:rect.top+(node.pos[1]+cv.ds.offset[1])*sc, scale:sc }; }
    return null;
}
function applyNodeStyle(node, isEditing) {
    if (!node?.properties) return;
    const p = node.properties, tid = `${DOM_PREFIX}-bg-${node.id}`;
    const maxR = Math.min(node.size[0], node.size[1]) / 2, rad = Math.min(p.borderRadius||0, maxR)+"px";
    node.bgcolor = "transparent"; node.color = "#fff0";
    let el = document.getElementById(tid);
    // 性能 memo：圆角值未变且 <style> 已存在 → 跳过整段重刷。
    //   注入的 <style> 用 !important 且选择器含「节点 *」，已覆盖节点及全部后代（含 Vue
    //   重渲后新出现的元素），圆角不变时每帧重写 textContent + 逐元素 inline 纯属白做。
    if (el && node._styleRad === rad) return;
    node._styleRad = rad;
    if (!el) { el = document.createElement("style"); el.id = tid; document.head.appendChild(el); }
    const sels = vueSels(node.id).join(",");
    el.textContent =
        `${sels}{background:transparent!important;background-color:transparent!important;border:none!important;box-shadow:none!important;border-radius:0!important;overflow:hidden!important;color:transparent!important;}`+
        `${sels} *{background:transparent!important;background-color:transparent!important;border:none!important;box-shadow:none!important;border-radius:${rad}!important;color:transparent!important;}`+
        `${sels} ${VUE_BODY_SELS},${sels} .litegraph-node,${sels} .node-container{background:transparent!important;background-color:transparent!important;border:none!important;box-shadow:none!important;border-radius:0!important;overflow:hidden!important;color:transparent!important;}`;
    for (const sel of vueSels(node.id)) {
        const dom = document.querySelector(sel);
        if (!dom) continue;
        dom.style.setProperty("background","transparent","important"); dom.style.setProperty("background-color","transparent","important");
        dom.style.setProperty("border","none","important"); dom.style.setProperty("box-shadow","none","important");
        dom.style.setProperty("border-radius","0","important"); dom.style.setProperty("overflow","hidden","important"); dom.style.setProperty("color","transparent","important");
        dom.querySelectorAll(`${VUE_BODY_SELS}, .litegraph-node, .node-container`).forEach(c => {
            c.style.setProperty("background","transparent","important"); c.style.setProperty("background-color","transparent","important");
            c.style.setProperty("border","none","important"); c.style.setProperty("box-shadow","none","important");
            c.style.setProperty("border-radius",rad,"important"); c.style.setProperty("color","transparent","important"); c.style.setProperty("overflow","hidden","important");
        });
    }
}
function removeNodeStyle(nodeId) { document.getElementById(`${DOM_PREFIX}-bg-${nodeId}`)?.remove(); }
function ensureSliderCSS() {
    document.getElementById(`${DOM_PREFIX}-slider-css`)?.remove();
    const T = getThemeState(), s = document.createElement("style");
    s.id = `${DOM_PREFIX}-slider-css`;
    s.textContent = `#${DOM_PREFIX}-panel input[type="range"]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;background:${T.textAccent};cursor:pointer;transition:transform .15s,background .15s}#${DOM_PREFIX}-panel input[type="range"]::-webkit-slider-thumb:hover{transform:scale(1.25)}#${DOM_PREFIX}-panel input[type="range"]::-webkit-slider-thumb:active{transform:scale(1.4)}#${DOM_PREFIX}-panel input[type="range"]::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:${T.textAccent};cursor:pointer;border:none;transition:transform .15s}#${DOM_PREFIX}-panel input[type="range"]::-moz-range-thumb:hover{transform:scale(1.25)}#${DOM_PREFIX}-panel input[type="range"]::-moz-range-thumb:active{transform:scale(1.4)}#${DOM_PREFIX}-panel label[id$="-sw"]:hover{transform:scale(1.12)}#${DOM_PREFIX}-panel label[id$="-sw"]:hover svg{color:${T.activeBorder} !important}`;
    document.head.appendChild(s);
}

// ========== UI ==========
function createTextEditor(node) {
    if (node.editTextarea) removeTextEditor(node); resetFontCache();
    const p = node.properties, vr = getNodeViewportRect(node);
    if (!vr) return;
    const sc = vr.scale;
    const ta = document.createElement("textarea");
    ta.value = p.text; ta.spellcheck = false; ta.dataset.wosaiEdit = node.id;
    ta.style.cssText = `position:fixed;left:${vr.left+p.padding*sc}px;top:${vr.top+8*sc}px;width:${(node.size[0]-2*p.padding)*sc}px;height:${(node.size[1]-16)*sc}px;border:none;outline:none;resize:none;padding:4px;box-sizing:border-box;z-index:100000;text-align:${p.textAlign};background:transparent;overflow:auto;word-break:break-word;`;
    node.editTextarea = ta; syncTextareaStyle(node);
    document.body.appendChild(ta);
    // 所有 focus 必须 preventScroll：默认 focus 会滚动页面/画布容器，
    // 与 Vue 抢焦点叠加时引发剧烈抖动、输入位置漂移（已踩坑）
    requestAnimationFrame(() => { ta.focus({ preventScroll: true }); ta.select(); });
    // Nodes 2.0 焦点保卫：Vue 节点容器（tabindex=0）会在双击后异步抢焦点，
    // 使用 rAF 替代 setInterval，性能更好且自动随页面不可见暂停
    let _focusTries = 0;
    const _focusTick = () => {
        if (!node.editTextarea || ++_focusTries > 8 || node._removed) { node._focusGuard = null; return; }
        if (node._composing) { node._focusGuard = requestAnimationFrame(_focusTick); return; }
        const ae = document.activeElement;
        if (ae !== ta && !document.getElementById(`${DOM_PREFIX}-panel`)?.contains(ae)) ta.focus({ preventScroll: true });
        node._focusGuard = requestAnimationFrame(_focusTick);
    };
    node._focusGuard = requestAnimationFrame(_focusTick);
    node._blurRetries = 0;   // blur 抢回次数上限计数（防 focus 拉锯战）
    const saveClose = () => {
        if (!node.editTextarea) return;
        p.text = ta.value; node._manualHeight = null;
        const newSize = node.computeSize();
        if (newSize[1] !== node.size[1]) node.setSize([node.size[0], newSize[1]]);
        removeTextEditor(node); node.setDirtyCanvas?.(true, true); window.app?.graph?.setDirtyCanvas(true);
    };
    const _posTick = () => {
        if (!node.editTextarea) { node._posRaf = null; return; }   // 编辑器关闭即自停
        const nr = getNodeViewportRect(node);
        if (nr) {
            const s = nr.scale;
            ta.style.left=nr.left+p.padding*s+"px"; ta.style.top=nr.top+8*s+"px";
            ta.style.width=(node.size[0]-2*p.padding)*s+"px"; ta.style.height=(node.size[1]-16)*s+"px";
            syncTextareaStyle(node);
        }
        node._posRaf = requestAnimationFrame(_posTick);
    };
    node._posRaf = requestAnimationFrame(_posTick);
    ta.addEventListener("input", () => { node._userText = ta.value; });
    // IME 组合期间禁止任何 focus 干预（会打断输入法组词，中文输入无预览）
    ta.addEventListener("compositionstart", () => { node._composing = true; });
    ta.addEventListener("compositionend", () => { node._composing = false; });
    ta.addEventListener("keydown", e => { if (e.key==="Escape") removeTextEditor(node); else if (e.key==="Enter"&&(e.ctrlKey||e.metaKey)) saveClose(); e.stopPropagation(); });
    node._docClickHandler = e => {
        if (!node.isEditing||!node.editTextarea) return;
        if (ta.contains(e.target)||document.getElementById(`${DOM_PREFIX}-panel`)?.contains(e.target)) return;
        saveClose();
    };
    setTimeout(() => { if (node.isEditing) document.addEventListener("click", node._docClickHandler, true); }, 200);
    ta.addEventListener("blur", () => { setTimeout(() => {
        if (!node.isEditing||document.activeElement===ta||document.getElementById(`${DOM_PREFIX}-panel`)?.contains(document.activeElement)) return;
        // Nodes 2.0：焦点被节点 Vue 容器抢走时抢回继续编辑，而不是误判为离开。
        // 限次 + preventScroll：无上限抢回会与 Vue 形成 focus 拉锯战（画布抖动/输入漂移/打断 IME）
        const ae = document.activeElement;
        if (ae && vueSels(node.id).some(sel => ae.closest?.(sel))) {
            if ((node._blurRetries = (node._blurRetries || 0) + 1) <= 4) { ta.focus({ preventScroll: true }); }
            // 超过上限：焦点留给容器但不关闭编辑器，用户点回文本框即可继续
            return;
        }
        saveClose();
    }, 150); });
    node.isEditing = true;
}
function syncTextareaStyle(node) {
    if (!node.editTextarea) return;
    const vr=getNodeViewportRect(node), s=vr?.scale??1, p=node.properties;
    Object.assign(node.editTextarea.style, { fontSize:p.fontSize*s+"px", fontFamily:getUIFont(), fontWeight:p.fontWeight||"normal", color:p.fontColor, backgroundColor:"transparent", textAlign:p.textAlign, lineHeight:String(p.lineHeight) });
}
function removeTextEditor(node) {
    if (node._focusGuard) { clearInterval(node._focusGuard); node._focusGuard=null; }
    if (node._posRaf) { cancelAnimationFrame(node._posRaf); node._posRaf=null; }
    if (node._docClickHandler) { document.removeEventListener("click",node._docClickHandler,true); node._docClickHandler=null; }
    if (node.editTextarea) { node.editTextarea.remove(); node.editTextarea=null; }
    delete node._userText; node.isEditing=false;
}
function attachVueDblClick(node) {
    if (node._vueDblClickBound) return;
    const handler = (e) => {
        if (node._removed||document.getElementById(`${DOM_PREFIX}-panel`)?.contains(e.target)) return;
        node._dblClickHandled=true; setTimeout(()=>{node._dblClickHandled=false;},50);
        e.stopPropagation(); e.preventDefault();
        if (!node.isEditing) createTextEditor(node); openStylePanel(node);
    };
    const tryBind = () => {
        if (node._removed) return true;
        for (const sel of vueSels(node.id)) { const el=document.querySelector(sel); if (el) { el.addEventListener("dblclick",handler,true); node._vueDblClickBound={el,handler}; return true; } }
        return false;
    };
    if (!tryBind()) { let tries=0; node._dblClickBindTimer=setInterval(()=>{if(tryBind()||++tries>20){clearInterval(node._dblClickBindTimer);node._dblClickBindTimer=null;}},100); }
}
function detachVueDblClick(node) {
    if (node._dblClickBindTimer) { clearInterval(node._dblClickBindTimer); node._dblClickBindTimer=null; }
    if (!node._vueDblClickBound) return;
    node._vueDblClickBound.el.removeEventListener("dblclick",node._vueDblClickBound.handler,true);
    node._vueDblClickBound=null;
}
function attachVueLinkClick(node) {
    if (node._vueLinkClickBound) return;
    const handler = (e) => {
        if (node._removed||node.isEditing||!node.linkAreas?.length) return;
        const cv = window.app?.canvas||LGraphCanvas.active_canvas;
        let lx, ly;
        if (typeof cv.convertEventToCanvasOffset==='function') { const cp=cv.convertEventToCanvasOffset(e); if (cp) { lx=cp[0]-node.pos[0]; ly=cp[1]-node.pos[1]; } }
        if (lx===undefined||ly===undefined) { const vr=getNodeViewportRect(node); if(!vr)return; lx=(e.clientX-vr.left)/vr.scale; ly=(e.clientY-vr.top)/vr.scale; }
        const a = hitLinkArea(node, lx, ly); if (a) { openURL(a.url); e.preventDefault(); e.stopPropagation(); return; }
    };
    const tryBind = () => {
        if (node._removed) return true;
        for (const sel of vueSels(node.id)) { const el=document.querySelector(sel); if (el) { el.addEventListener("mousedown",handler,true); node._vueLinkClickBound={el,handler}; return true; } }
        return false;
    };
    if (!tryBind()) { let tries=0; node._linkClickBindTimer=setInterval(()=>{if(tryBind()||++tries>20){clearInterval(node._linkClickBindTimer);node._linkClickBindTimer=null;}},100); }
}
function detachVueLinkClick(node) {
    if (node._linkClickBindTimer) { clearInterval(node._linkClickBindTimer); node._linkClickBindTimer=null; }
    if (!node._vueLinkClickBound) return;
    node._vueLinkClickBound.el.removeEventListener("mousedown",node._vueLinkClickBound.handler,true);
    node._vueLinkClickBound=null;
}
function positionPanel(node) {
    const panel = node._stylePanel; if (!panel) return;
    const cv = window.app?.canvas||LGraphCanvas.active_canvas;
    if (!cv?.canvas) return;
    const cr=cv.canvas.getBoundingClientRect(), sc=cv.ds?.scale??1, off=cv.ds?.offset??[0,0];
    // 面板随画布缩放（钳制 1.0~1.5 避免过小/过大），origin 固定 top-left 防错位
    const pScale = Math.max(1.0, Math.min(sc, 1.5));
    panel.style.transformOrigin = 'top left';
    panel.style.transform = `scale(${pScale})`;
    const nx=cr.left+(node.pos[0]+off[0])*sc, ny=cr.top+(node.pos[1]+off[1])*sc, nw=node.size[0]*sc;
    const pr=panel.getBoundingClientRect();             // 含缩放后的实际尺寸
    const pw=pr.width||PANEL_WIDTH*pScale, ph=pr.height||420*pScale;
    const vw=window.innerWidth, vh=window.innerHeight, rx=nx+nw+PANEL_OFFSET;
    panel.style.left = (rx+pw+8<=vw) ? rx+"px" : (nx-pw-PANEL_OFFSET>=8) ? (nx-pw-PANEL_OFFSET)+"px" : Math.max(8,vw-pw-8)+"px";
    panel.style.top = Math.max(8,Math.min(ny,vh-ph-8))+"px";
    panel.style.maxHeight = Math.max(200,(vh-16)/pScale)+"px";   // maxHeight 是未缩放值，需除回
}
function openStylePanel(node) {
    const old = document.getElementById(`${DOM_PREFIX}-panel`);
    if (old) { if (old._wosaiClose) old._wosaiClose(); else { if (old._raf) cancelAnimationFrame(old._raf); old.remove(); } }
    ensureSliderCSS();
    const p = node.properties, isDark = isDarkTheme(), T = getThemeState();
    // 拾色器：复用 ColorBar「取色」样式 —— 中性圆形按钮底(T.controlBg) + 居中吸管 SVG。
    //   吸管用固定主题色(T.textSecondary)，不随所选色变化；即时 tooltip 显示当前 HEX。
    const swatchHTML = (id,val) => `<label id="${id}-sw" style="width:${SWATCH_SIZE}px;height:${SWATCH_SIZE}px;border-radius:50%;background:${T.controlBg};cursor:pointer;flex-shrink:0;position:relative;display:inline-flex;align-items:center;justify-content:center;transition:background .15s,transform .12s;"><input type="color" id="${id}" value="${val}" style="position:absolute;opacity:0;width:100%;height:100%;cursor:pointer;border:none;padding:0;"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;color:${T.textSecondary}"><path d="M11 7l6 6"/><path d="M4 16L15.7 4.3a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4L8 20H4v-4z"/></svg></label>`;
    // 吸管固定色 + 固定提示文案，选色无需刷新外观（保留空函数兼容旧调用）
    const repaintSwatch = (_id,_val) => {};
    const SP = { row:'margin-bottom:14px;', sect:'margin-bottom:12px;', labelW:'min-width:44px;' };
    const setSliderFill = (el) => { const min=parseFloat(el.min),max=parseFloat(el.max),val=parseFloat(el.value); const pct=((val-min)/(max-min)*100).toFixed(1); el.style.background=`linear-gradient(to right,${T.activeBorder} 0%,${T.activeBorder} ${pct}%,${T.sliderBg} ${pct}%,${T.sliderBg} 100%)`; };
    const sliderRow = (label,id,min,max,step,val,unit,last) => `<div style="display:flex;align-items:center;gap:12px;${last?'':SP.row}"><span style="color:${T.textSecondary};font-size:13px;${SP.labelW}flex-shrink:0;">${label}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}" style="flex:1;height:6px;border-radius:3px;outline:none;-webkit-appearance:none;cursor:pointer;"><span id="${id}-v" style="color:${T.textAccent};font-size:13px;width:38px;text-align:right;flex-shrink:0;font-weight:500;">${val}${unit}</span></div>`;
    const panel = document.createElement("div");
    panel.id = `${DOM_PREFIX}-panel`;
    panel.setAttribute("data-wosai-panel", "");
    panel.setAttribute("data-theme", getGlassTheme());   // var() 引用按此作用域取深/浅值
    panel.style.cssText = `position:fixed;width:${PANEL_WIDTH}px;min-height:200px;background:${T.panelBg};border:1.5px solid ${T.panelBorder};border-radius:16px;padding:0;z-index:99999;color:${T.textPrimary};font-family:"PingFang SC","Microsoft YaHei",Arial,sans-serif;font-size:12px;box-shadow:${T.panelShadow};display:flex;flex-direction:column;user-select:none;`;
    const activePresetName = (()=>{for(const [n,pr] of Object.entries(BUILTIN_PRESETS)){const pc=isDark?pr.dark:pr.light;if(Object.keys(pc).every(k=>pc[k]===p[k]))return n;}return null;})();
    panel.innerHTML =
`<div style="padding:14px 14px 16px;overflow-y:auto;flex:1;box-sizing:border-box;">
  <div style="display:flex;align-items:center;margin-bottom:14px;min-height:32px;">
    <span style="flex:1;text-align:center;font-size:14px;font-weight:600;color:${T.textPrimary};letter-spacing:0.5px;">画布注释 CanvasNote</span>
    <div style="display:flex;gap:5px;flex-shrink:0;margin-left:8px;">
      <button id="wosai-pin" class="${node.flags?.pinned?'wosai-active':''}" title="${node.flags?.pinned?'取消固定':'固定节点'}" style="width:32px;height:32px;padding:0;cursor:pointer;border-radius:6px;font-size:15px;font-family:inherit;display:flex;align-items:center;justify-content:center;background:transparent;border:1.5px solid transparent;color:${node.flags?.pinned?T.activeBorder:T.textSecondary};">${node.flags?.pinned?WS_ICONS.pinned:WS_ICONS.pin}</button>
      <button id="wosai-theme" title="${GLASS_MODE_DEFS[getGlassMode()].tip}" style="width:32px;height:32px;padding:0;cursor:pointer;border-radius:6px;font-size:15px;font-family:inherit;display:flex;align-items:center;justify-content:center;background:transparent;border:1.5px solid transparent;color:${T.textSecondary};">${({auto:WS_ICONS.auto,light:WS_ICONS.sun,dark:WS_ICONS.moon})[getGlassMode()]}</button>
    </div>
  </div>
  <div style="${SP.sect}">
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:14px;">
      ${Object.entries(BUILTIN_PRESETS).map(([name,pr])=>{
        const pc=isDark?pr.dark:pr.light, on=name===activePresetName;
        return `<button class="wosai-preset${on?' wosai-active':''}" data-p="${name}" style="height:34px;padding:0 6px;display:flex;align-items:center;gap:5px;${on?`background:${T.saveBg};border:1.5px solid ${T.activeBorder};color:${T.textActive}`:`background:${T.controlBg};border:1.5px solid ${T.borderNormal};color:${T.textSecondary}`};cursor:pointer;border-radius:6px;font-size:11px;font-family:inherit;overflow:hidden;"><span style="width:7px;height:7px;border-radius:50%;flex-shrink:0;${pc.backgroundAlpha===0?`background:transparent;border:1.5px solid ${T.textSecondary};`:`background:${pc.backgroundColor};border:1px solid ${pc.borderEnabled&&pc.borderWidth>0?pc.borderColor:'transparent'};`}"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span></button>`;
      }).join('\n      ')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:6px;">
      <input id="wosai-pname" type="text" placeholder="输入名称，保存自定义样式" style="grid-column:1/5;background:${T.inputBg};color:${T.textPrimary};border:1px solid ${T.borderNormal};border-radius:6px;font-size:12px;padding:0 10px;font-family:inherit;height:34px;box-sizing:border-box;">
      <button id="wosai-psave" style="grid-column:5/6;height:34px;padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:6px;font-size:11px;font-family:inherit;background:${T.controlBg};border:1.5px solid ${T.borderNormal};color:${T.textSecondary};overflow:hidden;">保存</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;min-height:4px;margin-bottom:8px;" id="wosai-custom-tags"></div>
  </div>
  <div style="display:flex;align-items:center;gap:12px;${SP.row}">
    <span style="color:${T.textSecondary};font-size:13px;${SP.labelW}flex-shrink:0;">对齐</span>
    <div style="display:flex;gap:6px;flex:1;">
      <button class="wosai-align ${p.textAlign==='left'?'wosai-active':''}" data-a="left"   style="flex:1;height:34px;padding:0;cursor:pointer;border-radius:6px;font-size:13px;background:${p.textAlign==='left'?T.saveBg:T.controlBg};border:1.5px solid ${p.textAlign==='left'?T.activeBorder:T.borderNormal};color:${p.textAlign==='left'?T.textActive:T.textSecondary};display:flex;align-items:center;justify-content:center;gap:5px;"><svg width="14" height="10" viewBox="0 0 14 10"><rect x="0" y="0" width="14" height="2" rx="1" fill="currentColor"/><rect x="0" y="4" width="10" height="2" rx="1" fill="currentColor"/><rect x="0" y="8" width="6" height="2" rx="1" fill="currentColor"/></svg>左对齐</button>
      <button class="wosai-align ${p.textAlign==='center'?'wosai-active':''}" data-a="center" style="flex:1;height:34px;padding:0;cursor:pointer;border-radius:6px;font-size:13px;background:${p.textAlign==='center'?T.saveBg:T.controlBg};border:1.5px solid ${p.textAlign==='center'?T.activeBorder:T.borderNormal};color:${p.textAlign==='center'?T.textActive:T.textSecondary};display:flex;align-items:center;justify-content:center;gap:5px;"><svg width="14" height="10" viewBox="0 0 14 10"><rect x="0" y="0" width="14" height="2" rx="1" fill="currentColor"/><rect x="2" y="4" width="10" height="2" rx="1" fill="currentColor"/><rect x="4" y="8" width="6" height="2" rx="1" fill="currentColor"/></svg>居中对齐</button>
      <button class="wosai-align ${p.textAlign==='right'?'wosai-active':''}" data-a="right"  style="flex:1;height:34px;padding:0;cursor:pointer;border-radius:6px;font-size:13px;background:${p.textAlign==='right'?T.saveBg:T.controlBg};border:1.5px solid ${p.textAlign==='right'?T.activeBorder:T.borderNormal};color:${p.textAlign==='right'?T.textActive:T.textSecondary};display:flex;align-items:center;justify-content:center;gap:5px;"><svg width="14" height="10" viewBox="0 0 14 10"><rect x="0" y="0" width="14" height="2" rx="1" fill="currentColor"/><rect x="4" y="4" width="10" height="2" rx="1" fill="currentColor"/><rect x="8" y="8" width="6" height="2" rx="1" fill="currentColor"/></svg>右对齐</button>
    </div>
  </div>
  <div style="display:flex;align-items:center;gap:10px;${SP.row}flex-wrap:wrap;">
    <span style="color:${T.textSecondary};font-size:13px;${SP.labelW}flex-shrink:0;">背景</span>
    ${swatchHTML('wosai-bgc',p.backgroundColor)}
    <span style="color:${T.textSecondary};font-size:13px;flex-shrink:0;margin-left:4px;">文字</span>
    ${swatchHTML('wosai-fgc',p.fontColor)}
    <span style="color:${T.textSecondary};font-size:13px;flex-shrink:0;margin-left:4px;">字重</span>
    <div style="display:flex;gap:5px;flex:1;">
      <button class="wosai-fw ${p.fontWeight==='lighter'?'wosai-active':''}" data-w="lighter" style="flex:1;height:34px;padding:0;cursor:pointer;border-radius:6px;font-size:14px;background:${p.fontWeight==='lighter'?T.saveBg:T.controlBg};border:1.5px solid ${p.fontWeight==='lighter'?T.activeBorder:T.borderNormal};color:${p.fontWeight==='lighter'?T.textActive:T.textSecondary};">细</button>
      <button class="wosai-fw ${p.fontWeight==='normal'?'wosai-active':''}" data-w="normal"  style="flex:1;height:34px;padding:0;cursor:pointer;border-radius:6px;font-size:14px;background:${p.fontWeight==='normal'?T.saveBg:T.controlBg};border:1.5px solid ${p.fontWeight==='normal'?T.activeBorder:T.borderNormal};color:${p.fontWeight==='normal'?T.textActive:T.textSecondary};">中</button>
      <button class="wosai-fw ${p.fontWeight==='bold'?'wosai-active':''}" data-w="bold"    style="flex:1;height:34px;padding:0;cursor:pointer;border-radius:6px;font-size:14px;background:${p.fontWeight==='bold'?T.saveBg:T.controlBg};border:1.5px solid ${p.fontWeight==='bold'?T.activeBorder:T.borderNormal};color:${p.fontWeight==='bold'?T.textActive:T.textSecondary};">粗</button>
    </div>
  </div>
  <div style="display:flex;align-items:center;gap:10px;${SP.row}flex-wrap:wrap;">
    <span style="color:${T.textSecondary};font-size:13px;${SP.labelW}flex-shrink:0;">渐变</span>
    ${swatchHTML('wosai-gdc',p.gradientColor)}
    <div id="wosai-grad-group" style="display:flex;flex:1;gap:1px;">
      <button class="wosai-gdir ${p.gradientEnabled&&p.gradientDirection===0?'wosai-active':''}" data-d="0"   style="flex:1;height:26px;padding:0;cursor:pointer;font-size:16px;font-family:inherit;display:flex;align-items:center;justify-content:center;background:${p.gradientEnabled&&p.gradientDirection===0?T.saveBg:'transparent'};border:none;border-radius:4px;color:${p.gradientEnabled&&p.gradientDirection===0?T.textActive:T.textSecondary};">→</button>
      <button class="wosai-gdir ${p.gradientEnabled&&p.gradientDirection===90?'wosai-active':''}" data-d="90"  style="flex:1;height:26px;padding:0;cursor:pointer;font-size:16px;font-family:inherit;display:flex;align-items:center;justify-content:center;background:${p.gradientEnabled&&p.gradientDirection===90?T.saveBg:'transparent'};border:none;border-radius:4px;color:${p.gradientEnabled&&p.gradientDirection===90?T.textActive:T.textSecondary};">↓</button>
      <button class="wosai-gdir ${p.gradientEnabled&&p.gradientDirection===180?'wosai-active':''}" data-d="180" style="flex:1;height:26px;padding:0;cursor:pointer;font-size:16px;font-family:inherit;display:flex;align-items:center;justify-content:center;background:${p.gradientEnabled&&p.gradientDirection===180?T.saveBg:'transparent'};border:none;border-radius:4px;color:${p.gradientEnabled&&p.gradientDirection===180?T.textActive:T.textSecondary};">←</button>
      <button class="wosai-gdir ${p.gradientEnabled&&p.gradientDirection===270?'wosai-active':''}" data-d="270" style="flex:1;height:26px;padding:0;cursor:pointer;font-size:16px;font-family:inherit;display:flex;align-items:center;justify-content:center;background:${p.gradientEnabled&&p.gradientDirection===270?T.saveBg:'transparent'};border:none;border-radius:4px;color:${p.gradientEnabled&&p.gradientDirection===270?T.textActive:T.textSecondary};">↑</button>
    </div>
  </div>
  <div id="wosai-advanced" style="display:block;">
  ${sliderRow('大小','wosai-fs',8,200,1,p.fontSize,'px')}
  ${sliderRow('行距','wosai-lh',0.8,3.0,0.1,p.lineHeight,'')}
  ${(()=>{const raw=sliderRow('透明','wosai-ba',0,1,0.05,p.backgroundAlpha,'%');const displayVal=Math.round(p.backgroundAlpha*100)+'%';const origVal=p.backgroundAlpha+'%';return raw.includes(origVal)?raw.replace(origVal,displayVal):raw.replace(/(\d+\.?\d*)%/,displayVal);})()}
  <div style="display:flex;align-items:center;gap:10px;${SP.row}">
    <span style="color:${T.textSecondary};font-size:13px;${SP.labelW}flex-shrink:0;">边框</span>
    ${swatchHTML('wosai-bdc',p.borderColor)}
    <input type="range" id="wosai-bw" min="0" max="10" step="1" value="${p.borderWidth}" style="flex:1;min-width:40px;height:6px;border-radius:3px;outline:none;-webkit-appearance:none;cursor:pointer;">
    <span id="wosai-bw-v" style="color:${T.textAccent};font-size:13px;width:38px;text-align:right;flex-shrink:0;font-weight:500;">${p.borderWidth}px</span>
  </div>
  <div style="display:flex;align-items:center;gap:10px;${SP.row}">
    <span style="color:${T.textSecondary};font-size:13px;${SP.labelW}flex-shrink:0;">阴影</span>
    ${swatchHTML('wosai-sdc',p.shadowColor)}
    <input type="range" id="wosai-sb" min="0" max="60" step="1" value="${p.shadowBlur}" style="flex:1;height:6px;border-radius:3px;outline:none;-webkit-appearance:none;cursor:pointer;">
    <span id="wosai-sb-v" style="color:${T.textAccent};font-size:13px;width:38px;text-align:right;flex-shrink:0;font-weight:500;">${p.shadowBlur}</span>
  </div>
  ${sliderRow('圆角','wosai-br',0,300,1,p.borderRadius,'px')}
  ${sliderRow('内边距','wosai-pd',0,60,1,p.padding,'px',true)}
</div>
</div>
<div style="padding:8px 16px 12px;text-align:center;flex-shrink:0;">
  <span style="color:${isDark?'#7A7A7A':T.textSecondary};font-size:10px;letter-spacing:0.5px;">COPYRIGHT © WOSAI STUDIO | 穿山阅海</span>
</div>`;
    document.body.appendChild(panel); node._stylePanel = panel; positionPanel(node);
    let lastPos = null;
    const tick = () => {
        if (!panel.isConnected||node._stylePanel!==panel) return;
        const cv = window.app?.canvas||LGraphCanvas.active_canvas;
        const needUpdate = cv?.dragging_canvas||cv?.ds?.offset!==lastPos;
        if (needUpdate||!lastPos) { lastPos=cv?.ds?.offset?[...cv.ds.offset]:null; positionPanel(node); }
        panel._raf = requestAnimationFrame(tick);
    };
    panel._raf = requestAnimationFrame(tick);
    const btnBase=(bg,bd,co)=>({background:bg,border:`1.5px solid ${bd}`,color:co});
    const btnNorm=()=>btnBase(T.controlBg,T.borderNormal,T.textSecondary);
    const btnActive=()=>btnBase(T.saveBg,T.activeBorder,T.textActive);
    const btnHover=()=>btnBase(T.activeHoverBg,T.activeBorder,T.textHover);
    function applyBtnHover(el) {
        el.addEventListener('mouseenter',()=>Object.assign(el.style,btnHover()));
        el.addEventListener('mouseleave',()=>{const on=el.classList.contains('wosai-active');Object.assign(el.style,on?btnActive():btnNorm());});
    }
    function applyBtnPress(el) {
        let isPressed = false;
        const press = () => {
            if (isPressed) return;
            isPressed = true;
            el.style.filter = 'brightness(0.85)';
            el.style.transition = 'none';
        };
        const release = () => {
            if (!isPressed) return;
            isPressed = false;
            el.style.filter = '';
            el.style.transition = '';
        };
        el.addEventListener('mousedown', press);
        el.addEventListener('mouseup', release);
        el.addEventListener('mouseleave', release);
    }
    function refreshPanel() {
        panel.querySelectorAll(".wosai-align").forEach(b=>{const on=b.dataset.a===p.textAlign;b.className=`wosai-align${on?' wosai-active':''}`;Object.assign(b.style,{flex:'1',height:'34px',padding:'0',cursor:'pointer',borderRadius:'6px',fontSize:'13px',fontFamily:'inherit',display:'flex',alignItems:'center',justifyContent:'center',gap:'5px',...(on?btnActive():btnNorm())});});
        panel.querySelectorAll(".wosai-fw").forEach(b=>{const on=b.dataset.w===p.fontWeight;b.className=`wosai-fw${on?' wosai-active':''}`;Object.assign(b.style,{flex:'1',height:'34px',padding:'0',cursor:'pointer',borderRadius:'6px',fontSize:'14px',fontFamily:'inherit',...(on?btnActive():btnNorm())});});
        const set=(id,val)=>{const el=panel.querySelector(`#${id}`);if(el)el.value=val;};
        const txt=(id,val)=>{const el=panel.querySelector(`#${id}`);if(el)el.textContent=val;};
        const sw=(id,val)=>repaintSwatch(id,val);   // 同步背景 + 吸管对比色 + tooltip
        set('wosai-bgc',p.backgroundColor); sw('wosai-bgc',p.backgroundColor);
        set('wosai-fgc',p.fontColor); sw('wosai-fgc',p.fontColor);
        set('wosai-bdc',p.borderColor); sw('wosai-bdc',p.borderColor);
        set('wosai-sdc',p.shadowColor); sw('wosai-sdc',p.shadowColor);
        set('wosai-gdc',p.gradientColor); sw('wosai-gdc',p.gradientColor);
        const dirs=[0,180,90,270,45,225,315,135], arrows=['→','←','↓','↑','↘','↖','↗','↙'];
        panel.querySelectorAll(".wosai-gdir").forEach(b=>{const val=parseInt(b.dataset.d), on=p.gradientEnabled&&val===(p.gradientDirection||0);b.className=`wosai-gdir${on?' wosai-active':''}`;b.innerHTML=arrows[dirs.indexOf(val)]||'→';Object.assign(b.style,{flex:'1',height:'26px',padding:'0',cursor:'pointer',fontSize:'16px',fontFamily:'inherit',display:'flex',alignItems:'center',justifyContent:'center',background:on?T.saveBg:'transparent',border:'none',borderRadius:'4px',color:on?T.textActive:T.textSecondary});});
        set('wosai-fs',p.fontSize); txt('wosai-fs-v',p.fontSize+'px');
        set('wosai-ba',p.backgroundAlpha); txt('wosai-ba-v',Math.round(p.backgroundAlpha*100)+'%');
        set('wosai-lh',p.lineHeight); txt('wosai-lh-v',p.lineHeight);
        set('wosai-br',p.borderRadius); txt('wosai-br-v',p.borderRadius+'px');
        set('wosai-pd',p.padding); txt('wosai-pd-v',p.padding+'px');
        set('wosai-bw',p.borderWidth); txt('wosai-bw-v',p.borderWidth+'px');
        set('wosai-sb',p.shadowBlur); txt('wosai-sb-v',p.shadowBlur);
        panel.querySelectorAll('input[type="range"]').forEach(el=>setSliderFill(el));
        const pinBtn=panel.querySelector("#wosai-pin");
        if (pinBtn) { const pinOn=!!node.flags?.pinned; pinBtn.className=pinOn?'wosai-active':''; Object.assign(pinBtn.style,{width:'32px',height:'32px',padding:'0',cursor:'pointer',borderRadius:'6px',fontSize:'15px',fontFamily:'inherit',display:'flex',alignItems:'center',justifyContent:'center',background:'transparent',border:'1.5px solid transparent',color:pinOn?T.activeBorder:T.textSecondary}); pinBtn.innerHTML=pinOn?WS_ICONS.pinned:WS_ICONS.pin; pinBtn.title=pinOn?'取消固定':'固定节点'; }
        applyNodeStyle(node,node.isEditing); window.app?.graph?.setDirtyCanvas(true);
    }
    function buildCustomBtns() {
        const box=panel.querySelector("#wosai-custom-tags"); box.innerHTML="";
        Object.keys(loadCustomPresets()).forEach(name=>{   // 单次解析；点击时再 fresh 读取防删改竞态
            const chip=document.createElement("div"); chip.className="wosai-custom-chip"; chip.style.cssText=`display:flex;border-radius:6px;overflow:hidden;min-width:0;`;
            const ab=document.createElement("button"); ab.className="wosai-custom-btn";
            ab.style.cssText=`padding:0 4px;height:34px;width:100%;min-width:0;display:flex;align-items:center;background:${T.controlBg};border:1.5px solid ${T.borderNormal};color:${T.textSecondary};cursor:pointer;font-size:10.5px;font-family:inherit;border-radius:6px;overflow:hidden;`;
            ab.innerHTML=`<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span><span class="wosai-del-btn" style="flex-shrink:0;margin-left:2px;font-size:11px;line-height:1;">×</span>`;
            ab.onclick=(e)=>{if(e.target.classList.contains('wosai-del-btn'))return;const pr=loadCustomPresets()[name];if(!pr)return;Object.assign(p,pr);if(pr.width)node.size[0]=pr.width;if(node.editTextarea){node.editTextarea.value=p.text;syncTextareaStyle(node);}applyNodeStyle(node,node.isEditing);_redraw();panel.querySelectorAll(".wosai-preset").forEach(b=>{b.classList.remove('wosai-active');Object.assign(b.style,btnNorm());});panel.querySelectorAll('.wosai-custom-btn').forEach(b=>{b.classList.remove('wosai-active');Object.assign(b.style,{background:T.controlBg,borderColor:T.borderNormal,color:T.textSecondary});});ab.classList.add('wosai-active');ab.style.background=T.success;ab.style.borderColor=T.success;ab.style.color='#fff';refreshPanel();};
            ab.addEventListener('mouseenter',()=>{if(ab.classList.contains('wosai-active'))return;ab.style.background=T.success;ab.style.borderColor=T.success;ab.style.color='#fff';});
            ab.addEventListener('mouseleave',()=>{if(ab.classList.contains('wosai-active'))return;ab.style.background=T.controlBg;ab.style.borderColor=T.borderNormal;ab.style.color=T.textSecondary;});
            applyBtnPress(ab);
            const delSpan=ab.querySelector('.wosai-del-btn'); delSpan.onclick=(e)=>{e.stopPropagation();const a=loadCustomPresets();delete a[name];saveCustomPresets(a);buildCustomBtns();};
            chip.appendChild(ab); box.appendChild(chip);
        });
    }
    buildCustomBtns();
    panel.querySelectorAll(".wosai-preset").forEach(btn=>{btn.onclick=()=>{const pr=BUILTIN_PRESETS[btn.dataset.p];if(!pr)return;const pc=isDark?pr.dark:pr.light;if(pc.height)node._presetHeight=pc.height;const currentText=node.editTextarea?node.editTextarea.value:node._userText;Object.assign(p,pc);if(btn.dataset.p!=='序号'&&currentText!==undefined&&currentText!==null)p.text=currentText;const pw=pc.width||node.size[0],ph=pc.height||node.size[1];node.setSize([pw,ph]);if(pc.height)node._manualHeight=pc.height;if(node.editTextarea){node.editTextarea.value=p.text;syncTextareaStyle(node);}applyNodeStyle(node,node.isEditing);_redraw();panel.querySelectorAll(".wosai-preset").forEach(b=>{b.classList.remove('wosai-active');Object.assign(b.style,btnNorm());});panel.querySelectorAll('.wosai-custom-btn').forEach(b=>{b.classList.remove('wosai-active');Object.assign(b.style,{background:T.controlBg,borderColor:T.borderNormal,color:T.textSecondary});});btn.classList.add('wosai-active');Object.assign(btn.style,btnActive());refreshPanel();};applyBtnHover(btn);applyBtnPress(btn);});
    panel.querySelector("#wosai-psave").onclick=()=>{const inp=panel.querySelector("#wosai-pname");const name=inp.value.trim();if(!name){inp.style.border=`1px solid ${T.danger}`;setTimeout(()=>inp.style.border=`1px solid ${T.borderNormal}`,1000);return;}const all=loadCustomPresets();const saved={...p};delete saved.text;all[name]=saved;saveCustomPresets(all);inp.value="";buildCustomBtns();const btn=panel.querySelector("#wosai-psave");btn.textContent="已存 ✓";btn.style.background=T.success;setTimeout(()=>{btn.textContent="保存";if(btn.matches(':hover')){btn.style.background=T.success;btn.style.borderColor=T.success;btn.style.color='#fff';}else{Object.assign(btn.style,{background:T.controlBg,border:'1.5px solid '+T.borderNormal,color:T.textSecondary});}},1200);};
    const saveBtn=panel.querySelector("#wosai-psave"); saveBtn.addEventListener('mouseenter',()=>{if(saveBtn.textContent==="保存"){saveBtn.style.background=T.success;saveBtn.style.borderColor=T.success;saveBtn.style.color='#fff';}}); saveBtn.addEventListener('mouseleave',()=>{if(saveBtn.textContent==="保存")Object.assign(saveBtn.style,{background:T.controlBg,border:'1.5px solid '+T.borderNormal,color:T.textSecondary});}); applyBtnPress(saveBtn);
    const closePanel=()=>{if(panel._raf)cancelAnimationFrame(panel._raf);panel.remove();node._stylePanel=null;document.removeEventListener('click',onGlobalClick,true);try{_offGlassCN&&_offGlassCN();}catch(_){}};
    panel._wosaiClose=closePanel;   // 暴露给"替换旧面板"时调用，解绑 document 监听/玻璃订阅，防累积泄漏
    const onGlobalClick=(e)=>{if(!panel.isConnected||node._stylePanel!==panel)return;if(panel.contains(e.target)||node.editTextarea?.contains(e.target))return;closePanel();};
    setTimeout(()=>{if(panel.isConnected&&node._stylePanel===panel)document.addEventListener('click',onGlobalClick,true);},200);
    const pname=panel.querySelector("#wosai-pname"); if(pname){pname.addEventListener('focus',()=>{pname.style.border=`1.5px solid ${T.textAccent}`;pname.style.outline='none';});pname.addEventListener('blur',()=>{pname.style.border=`1px solid ${T.borderNormal}`;});}
    panel.querySelectorAll(".wosai-align").forEach(btn=>{btn.onclick=()=>{p.textAlign=btn.dataset.a;refreshPanel();};applyBtnHover(btn);applyBtnPress(btn);});
    panel.querySelectorAll(".wosai-fw").forEach(btn=>{btn.onclick=()=>{p.fontWeight=btn.dataset.w;refreshPanel();};applyBtnHover(btn);applyBtnPress(btn);});
    panel.querySelectorAll("#wosai-pin,#wosai-theme").forEach(btn=>{applyBtnPress(btn);});
    panel.querySelectorAll(".wosai-gdir").forEach(btn=>{btn.onclick=()=>{p.gradientDirection=parseInt(btn.dataset.d);p.gradientEnabled=true;refreshPanel();};btn.addEventListener('mouseenter',()=>{if(!btn.classList.contains('wosai-active')){btn.style.background=T.activeHoverBg;btn.style.color=T.textHover;}});btn.addEventListener('mouseleave',()=>{const on=btn.classList.contains('wosai-active');btn.style.background=on?T.saveBg:'transparent';btn.style.color=on?T.textActive:T.textSecondary;});applyBtnPress(btn);});
    const _redraw=()=>{setTimeout(()=>{node.setDirtyCanvas?.(true,true);if(window.app?.graph){window.app.graph.setDirtyCanvas(true,true);window.app.graph.change();}const cv=window.app?.canvas||LGraphCanvas.active_canvas;if(cv){cv.dirty_foreground=true;cv.dirty_background=true;cv.draw(true,false);}applyNodeStyle(node,node.isEditing);},0);};
    const _pick=(id,fn)=>{const el=panel.querySelector(id);if(!el)return;const _update=()=>{fn(el.value);_redraw();};el.oninput=_update;el.onchange=_update;};
    _pick("#wosai-bgc",v=>{p.backgroundColor=v;repaintSwatch('wosai-bgc',v);applyNodeStyle(node,node.isEditing);});
    _pick("#wosai-fgc",v=>{p.fontColor=v;repaintSwatch('wosai-fgc',v);});
    _pick("#wosai-bdc",v=>{p.borderColor=v;p.borderEnabled=true;repaintSwatch('wosai-bdc',v);applyNodeStyle(node,node.isEditing);});
    _pick("#wosai-sdc",v=>{p.shadowColor=v;repaintSwatch('wosai-sdc',v);applyNodeStyle(node,node.isEditing);});
    _pick("#wosai-gdc",v=>{p.gradientColor=v;repaintSwatch('wosai-gdc',v);});
    // 拾色器共享即时提示（统一 lib/tooltip.js）
    ['wosai-bgc','wosai-fgc','wosai-bdc','wosai-sdc','wosai-gdc'].forEach(id=>{const sw=panel.querySelector(`#${id}-sw`);if(sw)bindTip(sw,'自定义取色');});
    panel.querySelectorAll('input[type="range"]').forEach(el=>setSliderFill(el));
    const bind=(id,key,parse,unit,extra)=>{const el=panel.querySelector(`#${id}`),vl=panel.querySelector(`#${id}-v`);if(!el)return;el.oninput=()=>{p[key]=parse(el.value);if(vl)vl.textContent=(unit==='%')?Math.round(p[key]*100)+'%':p[key]+unit;setSliderFill(el);if(extra)extra();applyNodeStyle(node,node.isEditing);_redraw();};};
    bind('wosai-fs','fontSize',parseInt,'px'); bind('wosai-ba','backgroundAlpha',parseFloat,'%'); bind('wosai-lh','lineHeight',parseFloat,'');
    bind('wosai-br','borderRadius',parseInt,'px'); bind('wosai-pd','padding',parseInt,'px',()=>{node._manualHeight=null;const ns=node.computeSize();if(ns[1]!==node.size[1])node.setSize([node.size[0],ns[1]]);});
    bind('wosai-bw','borderWidth',parseInt,'px',()=>{p.borderEnabled=p.borderWidth>0;}); bind('wosai-sb','shadowBlur',parseInt,'');
    const pinBtn=panel.querySelector("#wosai-pin"); if(pinBtn){pinBtn.addEventListener("click",()=>{node.flags=node.flags||{};node.flags.pinned=!node.flags.pinned;node.flags.allow_interaction=!node.flags.pinned;refreshPanel();});}
    // 三态主题切换（全插件共享标准）：点击只写偏好并广播，重建由订阅统一处理
    const themeBtn=panel.querySelector("#wosai-theme"); if(themeBtn){themeBtn.addEventListener("click",()=>cycleGlassMode());}
    // 订阅广播：本面板或其他 WOSAI 面板切换主题 → 重建本面板（自清理：面板已被替换时退订）
    const _offGlassCN = onGlassChange(() => {
        if (node._stylePanel !== panel || !panel.isConnected) { _offGlassCN(); return; }
        if (panel._raf) cancelAnimationFrame(panel._raf);
        panel.remove(); node._stylePanel = null;
        document.removeEventListener('click', onGlobalClick, true);
        _offGlassCN();
        // 延迟到广播结束后重建，避免新面板的订阅被同一次广播再次触发
        setTimeout(() => openStylePanel(node), 0);
    });
}

// ========== ENTRY ==========
app.registerExtension({
    name: NODE_TYPE,

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;

        nodeType.title_mode  = LiteGraph.NO_TITLE;
        nodeType.collapsable = false;

        const _origCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            _origCreated?.apply(this, arguments);
            this.flags               = this.flags || {};
            this.flags.allow_interaction = !this.flags.pinned;
            this.resizable           = true;
            this.size                = [600, 120];
            this.properties          = { ...DEFAULT_PROPS };
            this.color               = "#fff0";
            this.bgcolor             = "transparent";
            this.isEditing           = false;
            this.editTextarea        = null;
            this.linkAreas           = [];
            this._stylePanel         = null;
            this._posRaf             = null;
            this._docClickHandler    = null;
            this._addedTimer         = null;
            this._dblClickBindTimer  = null;
            this._vueDomCache        = undefined;
            this._vueDomCacheTime    = 0;
            this._dblClickHandled    = false;
            this._removed            = false;
            this._manualHeight       = null;
            this._scrollY            = 0;
            this._scrollDragging     = false;
            const cs                 = this.computeSize();
            this.size[1]             = cs[1];
            this._lastWidth          = this.size[0];
            this._lastHeight         = this.size[1];
            this._vueLinkClickBound  = null;
            this._linkClickBindTimer = null;
            this._domWidthSynced     = false;
            this._csKey             = undefined;
            this._csResult          = undefined;
            this._lastComputedHeight = null;
        };

        nodeType.prototype.computeSize = function () {
            const p = this.properties || DEFAULT_PROPS;
            const size = this.size || [600, 120];
            const fontSize = p.fontSize || 24;
            const lineH = fontSize * (p.lineHeight || 1.4);
            const uiFont = getUIFont();
            const MIN_WIDTH = 80;
            const text = (p.text || "").replace(/\\n/g, "\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
            const bucketedW = Math.round(size[0] / 5) * 5;
            const csKey = `${text.length}:${text.slice(0,20)}:${text.slice(-20)}:${fontSize}:${p.lineHeight}:${p.padding}:${bucketedW}`;
            if (this._csKey === csKey && this._csResult) return this._csResult;
            const cv = (window.app?.canvas || LGraphCanvas.active_canvas)?.canvas;
            const ctx = cv ? cv.getContext("2d") : null;
            let textHeight;
            if (ctx) {
                ctx.font = `${fontSize}px ${uiFont}`;
                const maxW = size[0] - 2 * (p.padding || 12);
                const lineH2 = fontSize * (p.lineHeight || 1.4);
                const blocks2 = parseTextBlocks(text);
                let totalH = 0;
                for (const blk of blocks2) {
                    if (blk.type === 'table') { const m = measureTable(ctx, blk, maxW, fontSize, uiFont); totalH += lineH2 * 0.3 + m.totalHeight + lineH2 * 0.3; continue; }
                    const tokens = buildTokenList(blk.text);
                    const lines = wrapChars(ctx, tokens, maxW, fontSize, uiFont);
                    for (const row of lines) { let maxFs = fontSize, rowLh = p.lineHeight; for (const tok of row) { let fs = fontSize; if (tok._spanSize) fs = tok._spanSize; else if (tok.isHeading) fs = Math.round(fontSize * (1 + (6 - tok.headingLevel) * 0.15 + 0.1)); if (fs > maxFs) maxFs = fs; if (tok._lineHeight != null) rowLh = tok._lineHeight; } totalH += maxFs * (rowLh || 1.4); }
                }
                textHeight = totalH + 2 * (p.padding || 12);
            } else { const lineCount = text.split("\n").length || 1; textHeight = (lineCount - 1) * lineH + fontSize + 2 * (p.padding || 12); }
            const result = [MIN_WIDTH, Math.max(60, textHeight + 8)];
            this._csKey = csKey; this._csResult = result;
            return result;
        };

        const _origConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            _origConfigure?.apply(this, arguments);
            this.properties = this.properties || { ...DEFAULT_PROPS };
            if (info.properties) Object.assign(this.properties, info.properties);
            if (info.pos)   this.pos   = info.pos;
            if (info.size)  this.size  = info.size;
            if (info.flags) this.flags = info.flags;
            let tries = 0;
            const _cfgTick = () => {
                if (this._removed) { this._configureTimer = null; return; }
                attachVueDblClick(this); attachVueLinkClick(this); applyNodeStyle(this, false);
                if (++tries >= 15) { this._configureTimer = null; return; }
                this._configureTimer = setTimeout(_cfgTick, 100);
            };
            this._configureTimer = setTimeout(_cfgTick, 100);
        };

        const _origSerialize = nodeType.prototype.serialize;
        nodeType.prototype.serialize = function () {
            const d = _origSerialize ? _origSerialize.apply(this, arguments) : {};
            if (!d.id    && this.id)            d.id    = this.id;
            if (!d.order && this.order != null) d.order = this.order;
            if (!d.mode  && this.mode  != null) d.mode  = this.mode;
            d.properties = { ...this.properties };
            if (!d.pos   && this.pos)   d.pos   = [...this.pos];
            if (!d.size  && this.size)  d.size  = [...this.size];
            if (!d.flags && this.flags) d.flags = { ...this.flags };
            return d;
        };

        nodeType.prototype.onAdded = function () {
            this.properties = this.properties || {};
            if (!this.properties.cnr_id) this.properties.cnr_id = "custom-nodes/WOSAI-ComfyUI";
            if (!this.properties.ver) this.properties.ver = "1.0";
            delete this.properties.aux_id;
            attachVueDblClick(this); attachVueLinkClick(this);
            let tries = 0;
            const _addedTick = () => {
                if (this._removed) { this._addedTimer = null; return; }
                applyNodeStyle(this, false);
                if (!this._domWidthSynced && hasVueDomNode(this)) {
                    const cv = app.canvas || LGraphCanvas.active_canvas;
                    if (cv?.ds) { const sc = cv.ds.scale || 1; for (const sel of vueSels(this.id)) { const el = document.querySelector(sel); if (!el) continue; const domW = el.getBoundingClientRect().width; if (domW > 0) { this.size[0] = Math.round(domW / sc); this._lastWidth = this.size[0]; this._domWidthSynced = true; this._csKey = undefined; break; } } }
                }
                if (++tries >= 10) { this._addedTimer = null; return; }
                this._addedTimer = setTimeout(_addedTick, 80);
            };
            this._addedTimer = setTimeout(_addedTick, 80);
        };

        nodeType.prototype.onRemoved = function () {
            this._removed = true;
            if (this._addedTimer)        { clearInterval(this._addedTimer);        this._addedTimer        = null; }
            if (this._configureTimer)    { clearInterval(this._configureTimer);    this._configureTimer    = null; }
            if (this._posRaf)            { cancelAnimationFrame(this._posRaf);     this._posRaf            = null; }
            if (this._stylePanel) { if (this._stylePanel._raf) cancelAnimationFrame(this._stylePanel._raf); this._stylePanel.remove(); this._stylePanel = null; }
            removeTextEditor(this); detachVueDblClick(this); detachVueLinkClick(this); removeNodeStyle(this.id); clearVueSelCache(this.id);
        };

        nodeType.prototype.onDrawBackground = function (ctx) {
            ctx.save();
            // 整数设备像素对齐：拖动时 canvas 文字会按亚像素重栅格化 → 边缘"抖/闪"
            //   （DOM 节点平滑移动时尤其明显）。把当前变换平移分量吸附到整数像素，
            //   文字/边框落在像素网格上，移动时更清晰稳定。在 save/restore 内，自动复原。
            try {
                const _tf = ctx.getTransform();
                if (_tf.a && _tf.d) ctx.translate((Math.round(_tf.e) - _tf.e) / _tf.a, (Math.round(_tf.f) - _tf.f) / _tf.d);
            } catch (_) {}
            const p = this.properties, r = p.borderRadius || 0, w = this.size[0], h = this.size[1];
            if (p.backgroundAlpha > 0) {
                const hasShadowOnly = p.shadowBlur > 0 && !(p.borderEnabled && p.borderWidth > 0);
                if (hasShadowOnly) { ctx.shadowColor = p.shadowColor; ctx.shadowBlur = p.shadowBlur; }
                ctx.beginPath(); ctx.roundRect(0,0,w,h,r);
                if (p.gradientEnabled && p.gradientColor) {
                    const angle = (p.gradientDirection || 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
                    const halfDiag = Math.sqrt(w*w + h*h) / 2, cx = w/2, cy = h/2;
                    const grad = ctx.createLinearGradient(cx - halfDiag*cos, cy - halfDiag*sin, cx + halfDiag*cos, cy + halfDiag*sin);
                    grad.addColorStop(0, hexToRGBA(p.backgroundColor, p.backgroundAlpha));
                    grad.addColorStop(1, hexToRGBA(p.gradientColor, p.backgroundAlpha));
                    ctx.fillStyle = grad;
                } else { ctx.fillStyle = hexToRGBA(p.backgroundColor, p.backgroundAlpha); }
                ctx.fill(); ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
            }
            if (p.borderEnabled && p.borderWidth > 0) {
                if (p.shadowBlur > 0) { ctx.shadowColor = p.shadowColor; ctx.shadowBlur = p.shadowBlur; }
                ctx.strokeStyle = p.borderColor; ctx.lineWidth = p.borderWidth;
                ctx.beginPath(); ctx.roundRect(0,0,w,h,r); ctx.stroke();
                ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
            }
            if (!this.isEditing) {
                const contentH = this.computeSize()[1], overflow = contentH > h;
                if (overflow && !this._presetHeight && !this._manualHeight) {
                    this._csKey = undefined; ctx.restore();
                    if (!this._pendingSizeUpdate) {
                        this._pendingSizeUpdate = true;
                        const targetH = contentH;
                        requestAnimationFrame(() => { this._pendingSizeUpdate = false; if (this._manualHeight || this._presetHeight) return; this.size[1] = targetH; this._lastHeight = targetH; app.graph?.setDirtyCanvas(true); });
                    }
                    return;
                }
                this._scrollY = this._scrollY || 0;
                if (overflow) { const maxScroll = contentH - h; if (this._scrollY > maxScroll) this._scrollY = maxScroll; } else { this._scrollY = 0; }
                ctx.save(); ctx.beginPath(); ctx.roundRect(0, 0, w, h, r); ctx.clip();
                const sbW = 8, sbGap = 4;
                if (overflow) ctx.translate(0, -this._scrollY);
                const extraV = Math.max(0, h - contentH);
                if (extraV > 0) ctx.translate(0, Math.floor(extraV / 2));
                drawNodeText(ctx, this, overflow ? sbW + sbGap : 0);
                ctx.restore();
                if (overflow) {
                    const sbCorner = 4, sbMinThumb = 24, sbX = w - sbW - sbGap, trackT = 4, trackB = 4, trackH = h - trackT - trackB;
                    const thumbH = Math.max(sbMinThumb, trackH * h / contentH), maxScroll2 = contentH - h, thumbY = trackT + (trackH - thumbH) * (this._scrollY / maxScroll2);
                    ctx.fillStyle = "rgba(0,0,0,0.15)"; ctx.beginPath(); ctx.roundRect(sbX, trackT, sbW, trackH, sbCorner); ctx.fill();
                    ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.beginPath(); ctx.roundRect(sbX, thumbY, sbW, thumbH, sbCorner); ctx.fill();
                    this._scrollbarRect = { x: sbX, y: trackT, w: sbW, h: trackH, thumbY, thumbH, contentH };
                } else { this._scrollbarRect = null; }
            }
            if (this.flags?.pinned) { ctx.font = "14px Arial,sans-serif"; ctx.fillStyle = "#888"; ctx.textAlign = "right"; ctx.textBaseline = "top"; ctx.fillText("\u{1F4CC}", w-6, 6); }
            ctx.restore();
        };

        nodeType.prototype.onPropertyChanged = function (name, value) {
            if (this.isEditing) syncTextareaStyle(this);
            applyNodeStyle(this, this.isEditing);
            if (name === 'text' || name === 'fontSize' || name === 'lineHeight' || name === 'padding') {
                this._scrollY = 0; if (this._presetHeight) return; this._manualHeight = null;
                const newSize = this.computeSize();
                if (newSize[1] !== this.size[1]) this.setSize([this.size[0], newSize[1]]);
            }
            this.setDirtyCanvas?.(true, true); app.graph?.setDirtyCanvas(true);
        };

        nodeType.prototype.onMouseDown = function (evt, pos) {
            if (this.flags?.pinned) return false;
            if (this.isEditing) return false;
            const lx = pos[0], ly = pos[1], sb = this._scrollbarRect;
            if (sb && lx >= sb.x && lx <= sb.x + sb.w && ly >= sb.y && ly <= sb.y + sb.h) {
                if (ly >= sb.thumbY && ly <= sb.thumbY + sb.thumbH) { this._scrollDragging = true; this._scrollDragStartY = ly; this._scrollDragStartVal = this._scrollY; }
                else { const ratio = (ly - sb.y - sb.thumbH / 2) / (sb.h - sb.thumbH); const maxScroll = sb.contentH - this.size[1]; this._scrollY = Math.max(0, Math.min(Math.round(ratio * maxScroll), maxScroll)); this._scrollDragging = true; this._scrollDragStartY = ly; this._scrollDragStartVal = this._scrollY; }
                return true;
            }
            const a = hitLinkArea(this, lx, ly); if (a) { openURL(a.url); return true; }
            return false;
        };
        nodeType.prototype.onMouseMove = function (evt, pos) {
            if (!this._scrollDragging || !this._scrollbarRect) return false;
            const sb = this._scrollbarRect, dy = pos[1] - this._scrollDragStartY, ratio = dy / (sb.h - sb.thumbH), maxScroll = sb.contentH - this.size[1];
            this._scrollY = Math.max(0, Math.min(Math.round(this._scrollDragStartVal + ratio * maxScroll), maxScroll));
            app.graph?.setDirtyCanvas(true); return true;
        };
        nodeType.prototype.onMouseUp = function () { if (!this._scrollDragging) return false; this._scrollDragging = false; return false; };
        nodeType.prototype.onDblClick = function () { if (!this.isEditing) createTextEditor(this); openStylePanel(this); };
        nodeType.prototype.onResize = function (size) {
            if (!Array.isArray(size) || size.length < 2) return;
            if (this.isEditing) return;
            const newWidth = Math.max(size[0], 20), newHeight = Math.max(size[1], 20);
            const prevWidth = this._lastWidth ?? this.size[0], prevHeight = this._lastHeight ?? this.size[1];
            const widthChanged = Math.abs(newWidth - prevWidth) > 0.5, heightChanged = Math.abs(newHeight - prevHeight) > 0.5;
            this.size[0] = newWidth;
            if (heightChanged) { this._manualHeight = newHeight; this._presetHeight = null; this.size[1] = newHeight; }
            else if (widthChanged) { this._csKey = undefined; applyNodeStyle(this, false); const computedH = this.computeSize()[1]; this._lastComputedHeight = computedH; const manualH = this._manualHeight ?? this._presetHeight ?? 0; this.size[1] = Math.max(manualH, computedH); }
            this._lastWidth = this.size[0]; this._lastHeight = this.size[1];
            const finalContentH = this.computeSize()[1];
            if (finalContentH <= this.size[1]) this._scrollY = 0;
            else if (this._scrollY > finalContentH - this.size[1]) this._scrollY = finalContentH - this.size[1];
            if (this._stylePanel) positionPanel(this);
            app.graph?.setDirtyCanvas(true);
        };
        nodeType.prototype.onShowCustomPanelInfo = function (panel) {
            panel.querySelector('div.property[data-property="Mode"]')?.remove();
            panel.querySelector('div.property[data-property="Color"]')?.remove();
        };
    },

    async setup() {
        if (!document.getElementById("wosai-vars-inline")) {
            const s = document.createElement("style"); s.id = "wosai-vars-inline";
            s.textContent = `:root{--ws-accent:#DD6F4A;--ws-accent-hover:#C86442;--ws-accent-active:#B45939;--ws-bg:#17181B;--ws-surface:#262729;--ws-surface-2:#1c1d20;--ws-surface-3:#131417;--ws-border:#383B44;--ws-border-muted:#2A2A2A;--ws-text:#E4E4E7;--ws-text-secondary:#A3A3A3;--ws-text-muted:#7A7A7A;--ws-text-on-accent:#FFFFFF;--ws-text-placeholder:#5A5A5A;--ws-success:#43A047;--ws-success-bg:rgba(67,160,71,0.12);--ws-warning:#F59E0B;--ws-danger:#EF4444;--ws-danger-bg:rgba(239,68,68,0.12);--ws-radius-sm:4px;--ws-radius:6px;--ws-radius-md:8px;--ws-radius-lg:12px;--ws-radius-xl:16px;--ws-radius-full:50%;--ws-transition:150ms ease-out;--ws-transition-slow:200ms ease-out;--ws-shadow-panel:0 16px 48px rgba(0,0,0,0.80);--ws-slider-bg:#383B44;--ws-slider-thumb:#DD6F4A;}`;
            document.head.appendChild(s);
        }
        if (!document.getElementById("wosai-vars-link") && !document.querySelector('link[href*="wosai-variables.css"]')) {
            const link = document.createElement("link"); link.id = "wosai-vars-link";
            link.rel = "stylesheet"; link.href = "/extensions/WOSAI-ComfyUI/css/wosai-variables.css";
            document.head.appendChild(link);
        }
        if (!document.documentElement.getAttribute('data-theme')) {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
        ensureSliderCSS();

        // 全局原型 hook 幂等安装：防热重载/重复 setup 叠套。首次记录真实原函数到 _refs
        //   供 remove() 还原；若当前方法已是本插件包装(_wosaiWrapped)，直接复用、返回其保存的原函数。
        function hookProto(obj, name, makeWrapper) {
            const cur = obj[name];
            if (cur && cur._wosaiWrapped) return cur._wosaiOrig;
            const w = makeWrapper(cur);
            w._wosaiWrapped = true; w._wosaiOrig = cur;
            obj[name] = w;
            return cur;
        }

        _refs.drawNodeTitle = hookProto(LGraphCanvas.prototype, 'drawNodeTitle', (orig) =>
            function (node, ctx) { if (node.type === NODE_TYPE) return; return orig.apply(this, arguments); });

        _refs.drawNode = hookProto(LGraphCanvas.prototype, 'drawNode', (orig) =>
            function (node, ctx) {
                if (node.type !== NODE_TYPE) return orig.apply(this, arguments);
                if (!node.properties) node.properties = { ...DEFAULT_PROPS };
                const cv = app.canvas || LGraphCanvas.active_canvas;
                node.selected = !!(cv?.selected_nodes?.[node.id]);
                node.bgcolor = "transparent"; node.color = "#fff0";
                node.onDrawBackground(ctx);
                if (hasVueDomNode(node)) applyNodeStyle(node, node.isEditing);
                drawResizeHandle(ctx, node);
            });

        _refs.processMouseDown = hookProto(LGraphCanvas.prototype, 'processMouseDown', (orig) =>
            function (e) {
                if (this.graph) {
                    const cp = this.convertEventToCanvasOffset(e), node = this.graph.getNodeOnPos(cp[0], cp[1], this.visible_nodes);
                    if (node?.type === NODE_TYPE && !node.isEditing) {
                        const lx = cp[0] - node.pos[0], ly = cp[1] - node.pos[1];
                        const a = hitLinkArea(node, lx, ly); if (a) { openURL(a.url); e.preventDefault(); e.stopPropagation(); return false; }
                    }
                }
                return orig.call(this, e);
            });

        const _mouseState = { down: false, evt: null };
        _refs.onMouseDown_pinned = (e) => { _mouseState.down = true; _mouseState.evt = e; };
        _refs.onMouseUp_pinned   = ()  => { _mouseState.down = false; };
        document.addEventListener("mousedown", _refs.onMouseDown_pinned, true);
        document.addEventListener("mouseup",   _refs.onMouseUp_pinned,   true);

        _refs.getNodeOnPos = LGraph.prototype.getNodeOnPos;
        LGraph.prototype.getNodeOnPos = function (x, y, nodes, margin) {
            if (nodes && _mouseState.down && _mouseState.evt?.type?.includes("down") && _mouseState.evt?.which === 1) {
                const cv = LGraphCanvas.active_canvas, recent = cv && (LiteGraph.getTime() - (cv.last_mouseclick || 0)) < 300;
                if (!recent) nodes = [...nodes].filter(n => !(n.type === NODE_TYPE && n.flags?.pinned));
            }
            return _refs.getNodeOnPos.apply(this, [x, y, nodes, margin]);
        };

        _refs.closeStylePanels = (e) => {
            if (!app.graph?._nodes) return;
            for (const node of app.graph._nodes) {
                if (node.type !== NODE_TYPE || !node._stylePanel) continue;
                const pr = node._stylePanel.getBoundingClientRect();
                if (e.clientX >= pr.left && e.clientX <= pr.right && e.clientY >= pr.top && e.clientY <= pr.bottom) continue;
                const cv = app.canvas || LGraphCanvas.active_canvas;
                if (cv?.canvas) {
                    const cr = cv.canvas.getBoundingClientRect(), sc = cv.ds?.scale ?? 1, off = cv.ds?.offset ?? [0,0];
                    const nl = cr.left + (node.pos[0]+off[0])*sc, nt = cr.top + (node.pos[1]+off[1])*sc;
                    if (e.clientX >= nl && e.clientX <= nl+node.size[0]*sc && e.clientY >= nt && e.clientY <= nt+node.size[1]*sc) continue;
                }
                if (node._stylePanel._raf) cancelAnimationFrame(node._stylePanel._raf);
                node._stylePanel.remove(); node._stylePanel = null;
            }
        };
        document.addEventListener("mousedown", _refs.closeStylePanels, true);

        _refs.globalDblClick = (e) => {
            if (!app.graph?._nodes) return;
            const cv = app.canvas || LGraphCanvas.active_canvas; if (!cv) return;
            const cp = cv.convertEventToCanvasOffset?.(e); if (!cp) return;
            const node = app.graph.getNodeOnPos(cp[0], cp[1], cv.visible_nodes);
            if (node?.type !== NODE_TYPE) return;
            if (document.getElementById(`${DOM_PREFIX}-panel`)?.contains(e.target)) return;
            if (node._dblClickHandled) return;
            if (!node.isEditing) createTextEditor(node);
            openStylePanel(node);
        };
        document.addEventListener("dblclick", _refs.globalDblClick, true);

        function wheelNode(node, evt) {
            const p = node.properties, fontSize = p.fontSize || 24, delta = evt.deltaY > 0 ? fontSize : -fontSize;
            const ch = node.computeSize()[1], nh = node.size[1];
            if (ch <= nh) return;
            const maxScroll = ch - nh;
            node._scrollY = Math.max(0, Math.min((node._scrollY || 0) + delta, maxScroll));
            app.graph?.setDirtyCanvas(true); evt.preventDefault();
        }
        _refs.onMouseWheel = LGraphCanvas.prototype.onMouseWheel;
        LGraphCanvas.prototype.onMouseWheel = function (e) {
            const res = _refs.onMouseWheel.apply(this, arguments);
            const cp = this.convertEventToCanvasOffset(e);
            if (cp) { const node = this.graph?.getNodeOnPos(cp[0], cp[1], this.visible_nodes); if (node?.type === NODE_TYPE && !node.isEditing) wheelNode(node, e); }
            this.graph?._nodes?.forEach(n => { if (n.type === NODE_TYPE && n._stylePanel) positionPanel(n); });
            return res;
        };
        _refs.onMouseMove = LGraphCanvas.prototype.onMouseMove;
        LGraphCanvas.prototype.onMouseMove = function (e) {
            const res = _refs.onMouseMove.apply(this, arguments);
            if (this.dragging_canvas) this.graph?._nodes?.forEach(n => { if (n.type === NODE_TYPE && n._stylePanel) positionPanel(n); });
            return res;
        };

        if (!document.getElementById(`${DOM_PREFIX}-badge-css`)) {
            const s = document.createElement("style"); s.id = `${DOM_PREFIX}-badge-css`;
            s.textContent = `div.pointer-events-none.fixed.top-0.left-0.z-40[style*="--tb-x"]{display:none!important;}[data-testid="node-badge"],.node-badge,[class*="node-badge"],[class*="node_badge"]{display:none!important;}`;
            document.head.appendChild(s);
        }
        const removeBadges = () => { document.querySelectorAll(`div.pointer-events-none.fixed.top-0.left-0.z-40,[data-testid="node-badge"],.node-badge,[class*="node-badge"],[class*="node_badge"]`).forEach(el => { if ((el.textContent||"").includes(NODE_TITLE)) el.remove(); }); };
        _refs.badgeObs = new MutationObserver(removeBadges);
        _refs.badgeObs.observe(document.body, { childList: true, subtree: false });
        BADGE_DELAYS.forEach(d => setTimeout(removeBadges, d));
    },

    async remove() {
        if (_refs.drawNodeTitle)    LGraphCanvas.prototype.drawNodeTitle    = _refs.drawNodeTitle;
        if (_refs.drawNode)         LGraphCanvas.prototype.drawNode         = _refs.drawNode;
        if (_refs.processMouseDown) LGraphCanvas.prototype.processMouseDown = _refs.processMouseDown;
        if (_refs.getNodeOnPos)     LGraph.prototype.getNodeOnPos           = _refs.getNodeOnPos;
        if (_refs.onMouseWheel)     LGraphCanvas.prototype.onMouseWheel     = _refs.onMouseWheel;
        if (_refs.onMouseMove)      LGraphCanvas.prototype.onMouseMove      = _refs.onMouseMove;
        if (_refs.closeStylePanels)     document.removeEventListener("mousedown", _refs.closeStylePanels,     true);
        if (_refs.globalDblClick)       document.removeEventListener("dblclick",  _refs.globalDblClick,       true);
        if (_refs.onMouseDown_pinned) document.removeEventListener("mousedown", _refs.onMouseDown_pinned, true);
        if (_refs.onMouseUp_pinned)   document.removeEventListener("mouseup",   _refs.onMouseUp_pinned,   true);
        if (_refs.badgeObs) _refs.badgeObs.disconnect();
        document.getElementById(`${DOM_PREFIX}-badge-css`)?.remove();
        document.getElementById(`${DOM_PREFIX}-slider-css`)?.remove();
    },
});
