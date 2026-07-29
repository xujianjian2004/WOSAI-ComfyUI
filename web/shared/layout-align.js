// ══ WOSAI 画布整理套件 —— 对齐/分布/尺寸统一 ══════════════════════════════
// 由 layout-toolkit.js 聚合调用；本模块负责对齐计算、面板与融合 HUD 的「对齐」tab。

import { t } from "./i18n.js";
import { app } from "../../../../scripts/app.js";
import { compute, resize, stretch, ALIGN_COMMANDS } from "./align-engine.js";
import { glassT, getGlassTheme } from "./glass-theme.js";
import { mkBtn as hudMkBtn, mkDivider as hudDivider } from "./hud-kit.js";
import { bindTip } from "./tooltip.js";
import { quickToast } from "./toast.js";
import { makeDraggable } from "../panel-drag.js";
import { calcSnapToNodeSide, getSelectedNodes } from "./canvas-utils.js";
import { registerSelectionFollower } from "./selection-follow.js";
import { WOSAI_COPYRIGHT } from "./constants.js";

const PANEL_ID = "wosai-align-panel";

function getVisualH(node) {
    if (node.type === 'Reroute' || node.type === 'Reroute (rgthree)') return node.size[1];
    const titleH = (window.LiteGraph && window.LiteGraph.NODE_TITLE_HEIGHT) || 24;
    return node.size[1] + titleH;
}

function bodyH(node) {
    if (node.type === 'Reroute' || node.type === 'Reroute (rgthree)') return 0;
    return (window.LiteGraph && window.LiteGraph.NODE_TITLE_HEIGHT) || 24;
}

function getSelectedBoxes() {
    return getSelectedNodes().map(n => ({ node: n, x: n.pos[0], y: n.pos[1], w: n.size[0], h: getVisualH(n) }));
}

// 查找无上游连接的节点作为分布锚点（优先选最上游那个，保证分布结果一致）
function findAnchorIdx(boxes) {
    const idMap = new Map(boxes.map((b, i) => [b.node.id, i]));
    const noInput = new Set(idMap.keys());
    for (const b of boxes) {
        const inputs = b.node.inputs || [];
        for (const inp of inputs) {
            if (inp.link == null) continue;
            const graph = b.node.graph || app.canvas?.graph;
            if (!graph) continue;
            const lk = graph.links;
            const l = lk ? (lk instanceof Map ? lk.get(inp.link) : lk[inp.link]) : null;
            if (l && noInput.has(l.origin_id)) noInput.delete(l.origin_id);
        }
    }
    if (noInput.size > 0) return idMap.get([...noInput][0]) ?? 0;
    return 0;
}

export function applyAlign(cmd, customGap) {
    const boxes = getSelectedBoxes();
    if (boxes.length < 2) { quickToast(t('menus.layoutToolkit.selectTwoNodes')); return; }
    const graph = app.canvas?.graph;
    graph?.beforeChange?.();
    const anchorIdx = findAnchorIdx(boxes);
    const res = compute(boxes, cmd, { anchorIdx, gap: customGap });
    for (const r of res) { r.node.pos = [r.x, r.y]; }
    graph?.afterChange?.();
    app.canvas?.setDirty?.(true, true);
    app.canvas?.draw?.(true, true);
}

export function applyResize(cmd, base) {
    const boxes = getSelectedBoxes();
    if (boxes.length < 2) { quickToast(t('menus.layoutToolkit.selectTwoNodes')); return; }
    let anchorIndex = boxes.length - 1;
    if (base === "anchor") {
        const cn = app.canvas?.current_node;
        const i = cn ? boxes.findIndex(b => b.node === cn) : -1;
        if (i >= 0) anchorIndex = i;
    }
    const graph = app.canvas?.graph;
    graph?.beforeChange?.();
    const res = resize(boxes, cmd, { base: base === "anchor" ? "anchor" : "max", anchorIndex });
    for (const r of res) {
        const n = r.node;
        const th = bodyH(n);
        if (typeof n.setSize === "function") n.setSize([r.w, r.h - th]);
        else n.size = [r.w, r.h - th];
        try { n.onResize?.(n.size); } catch (_) {}
    }
    graph?.afterChange?.();
    app.canvas?.setDirty?.(true, true);
    app.canvas?.draw?.(true, true);
    quickToast(base === "anchor" ? t('menus.layoutToolkit.resizeAnchor') : t('menus.layoutToolkit.resizeMax'));
}

export function applyStretch(cmd) {
    const boxes = getSelectedBoxes();
    if (boxes.length < 2) { quickToast(t('menus.layoutToolkit.selectTwoNodes')); return; }
    const graph = app.canvas?.graph;
    graph?.beforeChange?.();
    const res = stretch(boxes, cmd);
    for (const r of res) {
        const n = r.node;
        n.pos = [r.x, r.y];
        const th = bodyH(n);
        if (typeof n.setSize === "function") n.setSize([r.w, r.h - th]);
        else n.size = [r.w, r.h - th];
        try { n.onResize?.(n.size); } catch (_) {}
    }
    graph?.afterChange?.();
    app.canvas?.setDirty?.(true, true);
    app.canvas?.draw?.(true, true);
}

export function applyResetSize() {
    const boxes = getSelectedBoxes();
    if (!boxes.length) { quickToast(t('menus.layoutToolkit.selectNode')); return; }
    const graph = app.canvas?.graph;
    graph?.beforeChange?.();
    for (const b of boxes) {
        const n = b.node;
        const sz = (typeof n.computeSize === "function") ? n.computeSize() : n.size;
        if (typeof n.setSize === "function") n.setSize([sz[0], sz[1]]);
        else n.size = [sz[0], sz[1]];
        try { n.onResize?.(n.size); } catch (_) {}
        try { n._wosaiAfterResetSize?.(); } catch (_) {}
    }
    graph?.afterChange?.();
    app.canvas?.setDirty?.(true, true);
    app.canvas?.draw?.(true, true);
    quickToast(t('menus.layoutToolkit.resetSizeDone').replace('{count}', boxes.length));
}

// ── 挂载到 window 供 hub-bar.js 桥接调用（避免循环依赖）──
window.__wosaiApplyAlign = applyAlign;
window.__wosaiApplyResize = applyResize;

export function selectSameNodes() {
    const c = app.canvas, graph = c?.graph;
    if (!c || !graph) return;
    const sel = getSelectedNodes();
    if (!sel.length) { quickToast(t('menus.layoutToolkit.selectAtLeastOneNode')); return; }
    const types = new Set(sel.map(n => n.type));
    const all = graph._nodes || graph.nodes || [];
    let n = 0;
    for (const node of all) if (types.has(node.type)) { c.selectNode?.(node, true); n++; }
    c.setDirty?.(true, true); c.draw?.(true, true);
    quickToast(t('menus.layoutToolkit.selectedSameType').replace('{count}', n));
}

// ── 对齐图标（单色线性，随主题 currentColor）──
const _ic = (inner) => `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const _bar = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="currentColor" stroke="none"/>`;
const QUICK_LUCIDE_ICONS = {
    left: _ic('<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>'),
    right: _ic('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'),
    top: _ic('<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>'),
    bottom: _ic('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>'),
};
export const ICONS = {
    left:     _ic(`<path d="M3 3v18"/>${_bar(6,6,12,4)}${_bar(6,14,8,4)}`),
    right:    _ic(`<path d="M21 3v18"/>${_bar(6,6,12,4)}${_bar(10,14,8,4)}`),
    h_center: _ic(`<path d="M12 3v18"/>${_bar(5,6,14,4)}${_bar(7,14,10,4)}`),
    top:      _ic(`<path d="M3 3h18"/>${_bar(6,6,4,12)}${_bar(14,6,4,8)}`),
    bottom:   _ic(`<path d="M3 21h18"/>${_bar(6,6,4,12)}${_bar(14,10,4,8)}`),
    v_center: _ic(`<path d="M3 12h18"/>${_bar(6,5,4,14)}${_bar(14,7,4,10)}`),
    dist_h:   _ic(`${_bar(3,8,3,8)}${_bar(10.5,8,3,8)}${_bar(18,8,3,8)}`),
    dist_v:   _ic(`${_bar(8,3,8,3)}${_bar(8,10.5,8,3)}${_bar(8,18,8,3)}`),
    auto:     _ic(`${_bar(2,9.5,5,5)}${_bar(17,3,5,5)}${_bar(17,16,5,5)}<path d="M7 12h4M11 12V5.5h6M11 12v6.5h6"/>`),
    "dist_h+top":      _ic(`<path d="M3 4.5h18"/>${_bar(4.5,7,3,7)}${_bar(10.5,7,3,11)}${_bar(16.5,7,3,9)}`),
    "dist_h+v_center": _ic(`<path d="M3 12h18"/>${_bar(4.5,8,3,8)}${_bar(10.5,6,3,12)}${_bar(16.5,9,3,6)}`),
    "dist_h+bottom":   _ic(`<path d="M3 19.5h18"/>${_bar(4.5,10,3,7)}${_bar(10.5,6,3,11)}${_bar(16.5,8,3,9)}`),
    "dist_v+left":     _ic(`<path d="M4.5 3v18"/>${_bar(7,4.5,7,3)}${_bar(7,10.5,11,3)}${_bar(7,16.5,9,3)}`),
    "dist_v+h_center": _ic(`<path d="M12 3v18"/>${_bar(8,4.5,8,3)}${_bar(6,10.5,12,3)}${_bar(9,16.5,6,3)}`),
    "dist_v+right":    _ic(`<path d="M19.5 3v18"/>${_bar(10,4.5,7,3)}${_bar(6,10.5,11,3)}${_bar(8,16.5,9,3)}`),
    eq_w:    _ic(`<rect x="4" y="4" width="7" height="16" rx="1.5"/><rect x="13" y="8" width="7" height="12" rx="1.5"/>`),
    eq_h:    _ic(`<rect x="4" y="5" width="6" height="14" rx="1.5"/><rect x="12" y="5" width="9" height="14" rx="1.5"/>`),
    eq_both: _ic(`<rect x="4" y="6" width="7" height="12" rx="1.5"/><rect x="13" y="6" width="7" height="12" rx="1.5"/>`),
    more:    _ic(`<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>`),
    bypass:   _ic(`<path d="M4 12h15"/><path d="M13 7l6 5-6 5"/>`),
    mute:     _ic(`<circle cx="12" cy="12" r="9"/><path d="M6.5 6.5l11 11"/>`),
    collapse: _ic(`<path d="M5 8h14"/><path d="M9 15l3-3 3 3"/>`),
    expand:   _ic(`<path d="M5 8h14"/><path d="M9 12l3 3 3-3"/>`),
    clone:    _ic(`<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>`),
    del:      _ic(`<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/>`),
    favorite: _ic(`<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`),
    lock:           _ic(`<rect x="6" y="11" width="12" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`),
    unlock:         _ic(`<rect x="6" y="11" width="12" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><path d="M16 7V5"/>`),
    reset_size:     _ic(`<path d="M4 4v5h5"/><path d="M4.5 9a8 8 0 1 1-1 4.5"/>`),
    select_same:    _ic(`<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>`),
    stretch_top:    _ic(`<rect x="6" y="9" width="12" height="11" rx="1.5"/><path d="M9 5l3-3 3 3"/>`),
    stretch_bottom: _ic(`<rect x="6" y="4" width="12" height="11" rx="1.5"/><path d="M9 19l3 3 3-3"/>`),
    stretch_left:   _ic(`<rect x="9" y="6" width="11" height="12" rx="1.5"/><path d="M5 9l-3 3 3 3"/>`),
    stretch_right:  _ic(`<rect x="4" y="6" width="11" height="12" rx="1.5"/><path d="M19 9l3 3-3 3"/>`),
};

const cmdIcon = (cmd) => ICONS[cmd] || ICONS[cmd.split('+')[0]] || ICONS.dist_h;

const LABELS = {
    left: t('menus.layoutToolkit.alignLeft'),
    h_center: t('menus.layoutToolkit.alignCenterHorizontal'),
    right: t('menus.layoutToolkit.alignRight'),
    top: t('menus.layoutToolkit.alignTop'),
    bottom: t('menus.layoutToolkit.alignBottom'),
    v_center: t('menus.layoutToolkit.alignCenterVertical'),
    dist_h: t('menus.layoutToolkit.distHorizontal'),
    dist_v: t('menus.layoutToolkit.distVertical'),
    "dist_h+top": t('menus.layoutToolkit.distHAlignTop'),
    "dist_h+v_center": t('menus.layoutToolkit.distHAlignCenter'),
    "dist_h+bottom": t('menus.layoutToolkit.distHAlignBottom'),
    "dist_v+left": t('menus.layoutToolkit.distVAlignLeft'),
    "dist_v+h_center": t('menus.layoutToolkit.distVAlignCenter'),
    "dist_v+right": t('menus.layoutToolkit.distVAlignRight'),
    eq_w: t('menus.layoutToolkit.equalWidth'),
    eq_h: t('menus.layoutToolkit.equalHeight'),
    eq_both: t('menus.layoutToolkit.equalSize'),
    stretch_top: t('menus.layoutToolkit.stretchTop'),
    stretch_bottom: t('menus.layoutToolkit.stretchBottom'),
    stretch_left: t('menus.layoutToolkit.stretchLeft'),
    stretch_right: t('menus.layoutToolkit.stretchRight'),
    reset_size: t('menus.layoutToolkit.resetSize'),
    select_same: t('menus.layoutToolkit.selectSameNodes'),
};

const BAR_LABELS = {
    dist_h: t('menus.layoutToolkit.barDistHorizontal'),
    dist_v: t('menus.layoutToolkit.barDistVertical'),
    "dist_h+top": t('menus.layoutToolkit.barDistHAlignTop'),
    "dist_h+v_center": t('menus.layoutToolkit.barDistHAlignCenter'),
    "dist_h+bottom": t('menus.layoutToolkit.barDistHAlignBottom'),
    "dist_v+left": t('menus.layoutToolkit.barDistVAlignLeft'),
    "dist_v+h_center": t('menus.layoutToolkit.barDistVAlignCenter'),
    "dist_v+right": t('menus.layoutToolkit.barDistVAlignRight'),
};

const barLabel = (c) => BAR_LABELS[c] || LABELS[c];

// ── 面板 ───────────────────────────────────────────────────────────────
let _panel = null;
let _panelFollowCleanup = null;
let _updateQuickAvailability = null;
function _buildQuickAlign() {
    const quick = document.createElement("section");
    quick.className = "wosai-al-quick";

    const grid = document.createElement("div");
    grid.className = "wosai-al-tian";
    const add = (className, label, action, icon) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `wosai-al-tian-btn ${className}`;
        button.setAttribute("aria-label", label);
        button.dataset.inlineTip = label;
        button.innerHTML = icon;
        button.onclick = (event) => { event.stopPropagation(); action(); };
        grid.appendChild(button);
    };

    add("cell-left", LABELS.left, () => applyAlign("left"), QUICK_LUCIDE_ICONS.left);
    const center = document.createElement("div");
    center.className = "wosai-al-center-stack cell-center";
    const addCenterAction = (label, action, icon) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "wosai-al-center-action";
        button.setAttribute("aria-label", label);
        button.dataset.inlineTip = label;
        button.innerHTML = icon;
        button.onclick = (event) => { event.stopPropagation(); action(); };
        center.appendChild(button);
    };
    addCenterAction(LABELS.top, () => applyAlign("top"), QUICK_LUCIDE_ICONS.top);
    addCenterAction(LABELS.bottom, () => applyAlign("bottom"), QUICK_LUCIDE_ICONS.bottom);
    grid.appendChild(center);
    add("cell-right", LABELS.right, () => applyAlign("right"), QUICK_LUCIDE_ICONS.right);
    quick.appendChild(grid);

    const distributeControls = document.createElement("div");
    distributeControls.className = "wosai-al-quick-controls wosai-al-quick-controls--pair";
    const equalControls = document.createElement("div");
    equalControls.className = "wosai-al-quick-controls";
    const utilityControls = document.createElement("div");
    utilityControls.className = "wosai-al-quick-controls wosai-al-quick-controls--pair";
    const addControl = (container, cmd, action, withIcon = true, label = LABELS[cmd]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "wosai-al-quick-control";
        button.innerHTML = `${withIcon ? `<span class="wosai-al-ic">${cmdIcon(cmd)}</span>` : ""}<span>${label}</span>`;
        button.onclick = (event) => { event.stopPropagation(); action(); };
        container.appendChild(button);
    };
    addControl(distributeControls, "dist_h+top", () => applyAlign("dist_h+top", _spacingGap), false, t('menus.layoutToolkit.quickDistHorizontalTop'));
    addControl(distributeControls, "dist_v+left", () => applyAlign("dist_v+left", _spacingGap), false, t('menus.layoutToolkit.quickDistVerticalLeft'));
    addControl(equalControls, "eq_w", () => applyResize("eq_w", "max"), false);
    addControl(equalControls, "eq_h", () => applyResize("eq_h", "max"), false);
    addControl(equalControls, "eq_both", () => applyResize("eq_both", "max"), false);
    addControl(utilityControls, "reset_size", () => applyResetSize(), false);
    quick.append(grid, equalControls, distributeControls, utilityControls);
    return { quick, utilityControls };
}

export function buildPanel() {
    const p = document.createElement("div");
    p.id = PANEL_ID;
    p.className = "wosai-al-panel";
    p.setAttribute("data-wosai-panel", "");
    p.setAttribute("data-theme", getGlassTheme());
    p.onpointerdown = (e) => e.stopPropagation();

    const head = document.createElement("div");
    head.className = "wosai-al-head";
    const title = document.createElement("strong");
    title.textContent = t('menus.layoutToolkit.quickAlign');
    const right = document.createElement("div");
    right.style.cssText = "display:flex;align-items:center;gap:var(--ws-gap-lg)";
    const close = document.createElement("span");
    close.className = "wosai-al-x";
    close.setAttribute("data-no-drag", "");
    bindTip(close, t('menus.layoutToolkit.closePanel'));
    close.innerHTML = _ic(`<path d="M5 5l14 14M19 5L5 19"/>`);
    close.onclick = closePanel;
    right.appendChild(close);
    head.append(title, right);
    p.appendChild(head);

    const { quick, utilityControls } = _buildQuickAlign();
    p.appendChild(quick);
    const advancedToggle = document.createElement("button");
    advancedToggle.type = "button";
    advancedToggle.className = "wosai-al-advanced-toggle";
    advancedToggle.innerHTML = `<span>${ICONS.more}</span><span>${t('menus.layoutToolkit.quickAdvanced')}</span>`;
    utilityControls.appendChild(advancedToggle);
    const advanced = document.createElement("div");
    advanced.className = "wosai-al-advanced";
    advanced.hidden = true;
    advancedToggle.onclick = (event) => {
        event.stopPropagation();
        advanced.hidden = !advanced.hidden;
        advancedToggle.classList.toggle("is-open", !advanced.hidden);
        advancedToggle.lastElementChild.textContent = t(advanced.hidden
            ? 'menus.layoutToolkit.quickAdvanced'
            : 'menus.layoutToolkit.quickCollapse');
    };

    const updateQuickAvailability = () => {
        const count = getSelectedNodes().length;
        const enabled = count >= 2;
        quick.classList.toggle("is-disabled", !enabled);
        quick.querySelectorAll("button:not(.wosai-al-advanced-toggle)").forEach(button => { button.disabled = !enabled; });
    };
    _updateQuickAvailability = updateQuickAvailability;
    document.addEventListener("pointerup", () => {
        if (_panel?.style.display !== "none") requestAnimationFrame(updateQuickAvailability);
    }, true);
    updateQuickAvailability();

    const _pBtn = (icon, label, onclick) => {
        const b = document.createElement("button");
        b.className = "wosai-al-btn";
        b.innerHTML = `<span class="wosai-al-ic">${icon}</span><span class="wosai-al-lb">${label}</span>`;
        b.onclick = (e) => { e.stopPropagation(); onclick(e); };
        return b;
    };
    const secS = document.createElement("div"); secS.className = "wosai-al-sec wosai-al-sec--stretch"; secS.textContent = t('menus.layoutToolkit.sectionStretch');
    advanced.appendChild(secS);
    const gS = document.createElement("div"); gS.className = "wosai-al-grid g2";
    ALIGN_COMMANDS.stretch.forEach(c => gS.appendChild(_pBtn(cmdIcon(c), LABELS[c], () => applyStretch(c))));
    advanced.appendChild(gS);

    const copyright = document.createElement("div");
    copyright.className = "wosai-copyright";
    copyright.textContent = WOSAI_COPYRIGHT;
    advanced.appendChild(copyright);

    p.appendChild(advanced);

    document.body.appendChild(p);
    // 对齐面板采用整块拖拽：普通内容区域均可拖动，交互控件仍由拖拽器自动排除。
    makeDraggable(p, p);
    return p;
}

export function openPanel({ anchorSelection = false } = {}) {
    if (!_panel) _panel = buildPanel();
    _panelFollowCleanup?.();
    _panelFollowCleanup = null;
    _panel.setAttribute("data-theme", getGlassTheme());
    _panel.style.display = "block";
    _updateQuickAvailability?.();
    const r = _panel.getBoundingClientRect();
    const pos = anchorSelection
        ? calcSnapToNodeSide(r.width, r.height, undefined, getSelectedNodes())
        : { x: (window.innerWidth - r.width) / 2, y: (window.innerHeight - r.height) / 2 };
    _panel.style.left = Math.round(pos.x) + "px";
    _panel.style.top = Math.round(pos.y) + "px";
    if (anchorSelection) {
        delete _panel.dataset.wosaiManualPosition;
        _panelFollowCleanup = registerSelectionFollower(_panel, {
            placement: "side",
            gap: 12,
        });
    }
}
export function closePanel() {
    _panelFollowCleanup?.();
    _panelFollowCleanup = null;
    if (_panel) _panel.style.display = "none";
}
if (typeof window !== "undefined") window.__wosaiCloseAlignPanel = closePanel;
export function togglePanel() { (_panel && _panel.style.display !== "none") ? closePanel() : openPanel(); }
export { _panel };

// ── 自定义间距输入状态 ──
let _spacingGap = 20;
function _ensureGapCSS() {
    if (document.getElementById('wosai-gap-css')) return;
    const s = document.createElement('style');
    s.id = 'wosai-gap-css';
    s.textContent = '.wosai-gap-in::-webkit-outer-spin-button,.wosai-gap-in::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}.wosai-gap-in{-moz-appearance:textfield}.wosai-gap-in:focus,.wosai-gap-in:focus-visible{box-shadow:none!important;outline:none!important}';
    document.head.appendChild(s);
}
function _buildSpacingGapInput() {
    _ensureGapCSS();
    const T = glassT();
    const border = T.border;
    const muted = T.textMuted;
    const wrap = document.createElement('div');
    wrap.style.cssText = `display:inline-flex;align-items:center;gap:var(--ws-gap-2xs);height:var(--ws-lf-btn-height);padding:0 var(--ws-gap);border-radius:var(--ws-radius);border:var(--ws-border-width-thin) solid ${border};background:${T.btnBg};box-sizing:border-box;transition:border-color .15s;flex-shrink:0;cursor:text`;
    const MIN_GAP = 10, MAX_GAP = 500;
    const inp = document.createElement('input');
    inp.className = 'wosai-gap-in';
    inp.type = 'number'; inp.min = String(MIN_GAP); inp.max = String(MAX_GAP); inp.step = '5';
    inp.placeholder = t('menus.layoutToolkit.gapPlaceholder');
    inp.title = t('menus.layoutToolkit.gapTitle').replace('{min}', MIN_GAP).replace('{max}', MAX_GAP);
    if (_spacingGap != null) inp.value = _spacingGap;
    inp.style.cssText = `width:var(--ws-lt-spacing-input-width);height:100%;border:none;background:transparent;color:${T.text};font-size:var(--ws-text-base);text-align:center;outline:none;padding:0`;
    const unit = document.createElement('span');
    unit.textContent = 'px';
    unit.style.cssText = `font-size:var(--ws-text-sm);color:${muted};user-select:none;pointer-events:none;letter-spacing:var(--ws-lt-letter-spacing-tight)`;
    inp.addEventListener('input', () => {
        const v = parseInt(inp.value, 10);
        _spacingGap = (!isNaN(v) && v >= MIN_GAP) ? Math.min(v, MAX_GAP) : null;
        unit.style.color = inp.value ? T.iconAccent : muted;
    });
    inp.addEventListener('blur', () => {
        let v = parseInt(inp.value, 10);
        if (isNaN(v) || v <= 0) { inp.value = ''; _spacingGap = null; unit.style.color = muted; return; }
        v = Math.max(MIN_GAP, Math.min(MAX_GAP, v));
        inp.value = v; _spacingGap = v; unit.style.color = T.iconAccent;
    });
    inp.addEventListener('pointerdown', e => e.stopPropagation());
    wrap.addEventListener('pointerdown', () => inp.focus());
    if (_spacingGap != null) unit.style.color = T.iconAccent;
    wrap.appendChild(inp);
    wrap.appendChild(unit);
    return { wrap, inp };
}

export function buildAlignItems(orient = "h") {
    const out = [];
    ALIGN_COMMANDS.basic.forEach((c, i) => {
        out.push(_alignBtn(c));
        if (i === 2) out.push(hudDivider(orient));
    });
    out.push(hudDivider(orient));
    // 悬浮条只保留最常用的“等尺寸”；等宽/等高放入“更多”面板，
    // 完整工具仍由快捷对齐面板承载，避免三处同时铺开。
    out.push(_resizeBtn("eq_both"));
    out.push(hudDivider(orient));
    const gapCtl = _buildSpacingGapInput();
    const distHBtn = hudMkBtn(cmdIcon("dist_h"), LABELS["dist_h"], barLabel("dist_h"));
    distHBtn.onclick = () => applyAlign("dist_h", _spacingGap);
    out.push(distHBtn);
    const distVBtn = hudMkBtn(cmdIcon("dist_v"), LABELS["dist_v"], barLabel("dist_v"));
    distVBtn.onclick = () => applyAlign("dist_v", _spacingGap);
    out.push(distVBtn);
    out.push(gapCtl.wrap);
    out.push(hudDivider(orient));
    { const b = hudMkBtn(ICONS.reset_size, LABELS.reset_size, LABELS.reset_size); b.onclick = () => applyResetSize(); out.push(b); }
    // 折叠组：低频复合分布 / 单侧拉伸 / 选同类
    const low = [];
    const addLow = (el) => { el.style.display = "none"; low.push(el); out.push(el); };
    ["eq_w", "eq_h"].forEach(c => addLow(_resizeBtn(c)));
    ALIGN_COMMANDS.distribute.filter(c => c !== "dist_h" && c !== "dist_v").forEach(c => {
        const b = hudMkBtn(cmdIcon(c), LABELS[c], barLabel(c)); b.onclick = () => applyAlign(c, _spacingGap); addLow(b);
    });
    addLow(hudDivider(orient));
    ALIGN_COMMANDS.stretch.forEach(c => { const b = hudMkBtn(cmdIcon(c), LABELS[c], LABELS[c]); b.onclick = () => applyStretch(c); addLow(b); });
    { const b = hudMkBtn(ICONS.select_same, LABELS.select_same, t('menus.layoutToolkit.selectSameNodes')); b.onclick = () => selectSameNodes(); addLow(b); }
    addLow(hudDivider(orient));

    const T_ = glassT();
    const moreVis = document.createElement('div');
    moreVis.textContent = '▶';
    moreVis.style.cssText = `width:var(--ws-lt-more-btn-size);height:var(--ws-lt-more-btn-size);display:flex;align-items:center;justify-content:center;border-radius:50%;background:${T_.btnBg};color:${T_.iconColor};padding:0;font-size:var(--ws-text-xs);font-weight:600;letter-spacing:var(--ws-lt-letter-spacing-tight);transition:color .15s,background .15s,filter .15s,transform .12s;pointer-events:none;white-space:nowrap;overflow:hidden`;
    const moreBtn = (() => { const w = document.createElement('div'); w.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:var(--ws-gap-xs);cursor:pointer;user-select:none;flex-shrink:0'; w.appendChild(moreVis); w._tip = t('menus.layoutToolkit.moreTip'); return w; })();
    moreBtn.addEventListener('mouseenter', () => { moreVis.style.transform = 'scale(1.1)'; moreVis.style.background = T_.rowHover; moreVis.style.color = T_.iconAccent; });
    moreBtn.addEventListener('mouseleave', () => { moreVis.style.transform = ''; moreVis.style.background = T_.btnBg; moreVis.style.color = T_.iconColor; });
    bindTip(moreBtn, t('menus.layoutToolkit.moreTip'));
    moreBtn.addEventListener('mousedown', e => e.preventDefault());
    let expanded = false;
    moreBtn.onclick = (e) => {
        e.stopPropagation();
        expanded = !expanded;
        low.forEach(el => { el.style.display = expanded ? "" : "none"; });
        moreVis.textContent = expanded ? '◀' : '▶';
        moreBtn._tip = expanded ? t('menus.layoutToolkit.collapseTip') : t('menus.layoutToolkit.moreAlignTip');
    };
    out.push(moreBtn);
    return out;
}

const _alignBtn = (c) => { const b = hudMkBtn(cmdIcon(c), LABELS[c], barLabel(c)); b.onclick = () => applyAlign(c); return b; };
const _resizeBtn = (c) => {
    const b = hudMkBtn(cmdIcon(c), LABELS[c], barLabel(c));
    b.onclick = (e) => applyResize(c, e.altKey ? "anchor" : "max");
    return b;
};
