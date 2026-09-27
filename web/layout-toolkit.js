// ══ WOSAI 画布整理套件 —— 节点对齐(阶段一) ══════════════════════════════
//   入口键位：Alt+Q（原生 Keybindings 可改；避开 ColorBar 的 ` 键、浏览器 Alt+A、截图 Alt+Shift+A）
//   本文件为聚合入口：对齐/分布/尺寸、搜索面板、commands/keybindings 已拆分至 web/shared/layout-*.js
import { t } from "./shared/i18n.js";
import { app } from "../../../scripts/app.js";
import { planLinks } from "./shared/link-engine.js";
import { matchSlots } from "./shared/replace-engine.js";
import { match as searchMatch } from "./shared/search-engine.js";
import { computeGuides } from "./shared/crosshair-engine.js";
import { getGlassTheme, onGlassChange } from "./shared/glass-theme.js";
import { mkBtn as hudMkBtn, mkDivider, registerHudTab, unregisterHudTab, runForegroundDraws } from "./shared/hud-kit.js";
import { applySolidHex, randomHSV, hsv2hex, hex2hsv } from "./shared/color-core.js";
import { refreshAllVisuals, openNodeColorPicker } from "./node-color.js";
import { openSettingsPanel, rebuildUI } from "./omni-slider.js";
import { quickToast } from "./shared/toast.js";
import { getSetting, getWOSAIVar, retryUntil } from "./shared/shared-utils.js";
import { getSelectedNodes, getSelectedGroups, getNodesInGroup } from "./shared/canvas-utils.js";
import { centerAndShowOrbs } from "./launcher.js";
import {
    ICONS as ALIGN_ICONS,
    openPanel, closePanel, togglePanel,
    selectSameNodes,
    _panel,
} from "./shared/layout-align.js";
import {
    jumpToNode, jumpBack, jumpForward, connectedNodes, _navMenuItem,
    _flashNode, _flashUntil, FLASH_DUR, FLASH_COLOR,
} from "./shared/layout-search.js";
import { _unregisterLayoutCommands } from "./shared/layout-commands.js";
import { registerSelectionFollower } from "./shared/selection-follow.js";
import { ensureWosaiStyles } from "./shared/dom-widget.js";

if (typeof window !== "undefined") window.__wosaiOpenAlignPanel = openPanel;

// 将 CSS var token 解析为实际颜色值（供 Canvas 绘制使用）
function _resolveColor(token, fallback) {
    if (!token || !token.startsWith("var(")) return token || fallback;
    const name = token.slice(4, -1).trim();
    const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return val || fallback;
}

// 注入样式表（WOSAI 用 <link> 加载 CSS，非 extension.json；带去重，避免重复注入）
function ensureCSS() {
    ensureWosaiStyles([
        ["wosai-layout-css", new URL("./styles/layout-toolkit.css", import.meta.url).href],
    ]);
}

// ── 快速连接 FastLink：读选中节点真端口 → link-engine 规划 → node.connect ──
function applyFastLink(mode, force) {
    const c = app.canvas, graph = c?.graph;
    const sel = getSelectedNodes();
    if (sel.length < 2) { quickToast(t('menus.layoutToolkit.selectTwoOrMore')); return; }
    const descs = sel.filter(nd => nd.pos).map(nd => ({
        id: nd.id, x: nd.pos[0], y: nd.pos[1],
        outputs: (nd.outputs || []).map(o => ({ type: o.type })),
        inputs: (nd.inputs || []).map(inp => ({ type: inp.type, linked: inp.link != null })),
    }));
    const plan = planLinks(descs, mode, { force: !!force });
    if (!plan.length) { quickToast(t('menus.layoutToolkit.noCompatiblePorts')); return; }
    const byId = new Map(sel.map(nd => [nd.id, nd]));
    graph?.beforeChange?.();
    let n = 0;
    for (const l of plan) {
        const from = byId.get(l.from), to = byId.get(l.to);
        if (from && to && typeof from.connect === "function") { from.connect(l.fromSlot, to, l.toSlot); n++; }
    }
    graph?.afterChange?.();
    c.setDirty?.(true, true); c.draw?.(true, true);
    quickToast(t('menus.layoutToolkit.connectedCount').replace('{count}', n));
}

// 清除内部连线：断开两端都在选中范围内的连线
function applyClearInternalLinks() {
    const c = app.canvas, graph = c?.graph;
    const sel = getSelectedNodes();
    if (sel.length < 2) { quickToast(t('menus.layoutToolkit.selectTwoOrMore')); return; }
    const idset = new Set(sel.map(nd => nd.id));
    const lk = graph?.links;
    const linkOf = (id) => lk ? (lk instanceof Map ? lk.get(id) : lk[id]) : null;
    graph?.beforeChange?.();
    let n = 0;
    for (const node of sel) {
        (node.inputs || []).forEach((inp, ii) => {
            if (inp.link == null) return;
            const l = linkOf(inp.link);
            if (l && idset.has(l.origin_id) && typeof node.disconnectInput === "function") { node.disconnectInput(ii); n++; }
        });
    }
    graph?.afterChange?.();
    c.setDirty?.(true, true); c.draw?.(true, true);
    quickToast(t('menus.layoutToolkit.clearedInternalLinks').replace('{count}', n));
}

// ── 替换节点：以新类型热替换旧节点，迁移参数与连线(matchSlots) ──
function applyReplace(oldNode, type) {
    const LG = window.LiteGraph;
    const graph = oldNode?.graph || app.canvas?.graph;
    if (!LG || typeof LG.createNode !== "function" || !graph || !oldNode) { quickToast(t('menus.layoutToolkit.replaceFailed')); return; }
    const node = LG.createNode(type);
    if (!node) { quickToast(t('menus.layoutToolkit.createTypeFailed') + type); return; }
    const lk = graph.links, linkOf = (id) => lk ? (lk instanceof Map ? lk.get(id) : lk[id]) : null;
    const getN = (id) => graph.getNodeById ? graph.getNodeById(id) : (graph._nodes || []).find(x => x.id === id);
    graph.beforeChange?.();
    node.pos = [oldNode.pos[0], oldNode.pos[1]];
    graph.add(node);
    (oldNode.widgets || []).forEach(w => {
        const nw = (node.widgets || []).find(x => x.name === w.name);
        if (nw && w.value !== undefined) { try { nw.value = w.value; } catch (_) {} }
    });
    const inMap = matchSlots((oldNode.inputs || []).map(i => ({ name: i.name, type: i.type })), (node.inputs || []).map(i => ({ name: i.name, type: i.type })));
    (oldNode.inputs || []).forEach((inp, oi) => {
        if (inp.link == null) return;
        const l = linkOf(inp.link); if (!l) return;
        const src = getN(l.origin_id), ni = inMap.get(oi);
        if (src && ni != null) { try { src.connect(l.origin_slot, node, ni); } catch (_) {} }
    });
    const outMap = matchSlots((oldNode.outputs || []).map(o => ({ name: o.name, type: o.type })), (node.outputs || []).map(o => ({ name: o.name, type: o.type })));
    (oldNode.outputs || []).forEach((o, oi) => {
        const ni = outMap.get(oi); if (ni == null) return;
        (o.links || []).slice().forEach(lid => { const l = linkOf(lid); if (!l) return; const tgt = getN(l.target_id); if (tgt) { try { node.connect(ni, tgt, l.target_slot); } catch (_) {} } });
    });
    try { node.size = [Math.max(node.size[0] || 0, oldNode.size[0] || 0), node.size[1]]; } catch (_) {}
    graph.remove(oldNode);
    graph.afterChange?.();
    app.canvas?.setDirty?.(true, true); app.canvas?.draw?.(true, true);
    quickToast(t('menus.layoutToolkit.replacedTo').replace('{type}', type));
}

// 类型选择器（玻璃面板 + 检索注册类型，复用搜索框样式）
const RP_ID = "wosai-replace-picker";
let _rp = null, _rpInput = null, _rpList = null, _rpTarget = null, _rpFollowCleanup = null;
function _allNodeTypes() {
    const reg = window.LiteGraph?.registered_node_types || {};
    return Object.keys(reg).map(t => ({ id: t, type: t, title: (reg[t] && reg[t].title) ? reg[t].title : t, widgets: [], properties: {} }));
}
function _rpRender(items) {
    _rpList.innerHTML = "";
    if (!items.length) { const e = document.createElement("div"); e.className = "wosai-sr-empty"; e.textContent = t('menus.layoutToolkit.noMatchingType'); _rpList.appendChild(e); return; }
    items.slice(0, 60).forEach(d => {
        const it = document.createElement("div");
        it.className = "wosai-sr-item";
        // Node titles and types come from all installed extensions. Render them
        // as text so third-party metadata cannot inject markup into this panel.
        const title = document.createElement("span");
        title.className = "wosai-sr-t";
        title.textContent = String(d.title ?? "");
        const type = document.createElement("span");
        type.className = "wosai-sr-ty";
        type.textContent = String(d.type ?? "");
        it.append(title, type);
        it.onclick = () => { const t = _rpTarget; closeReplacePicker(); if (t) applyReplace(t, d.type); };
        _rpList.appendChild(it);
    });
}
function buildReplacePicker() {
    const p = document.createElement("div");
    p.id = RP_ID; p.className = "wosai-sb"; p.setAttribute("data-wosai-panel", "");
    p.setAttribute("data-theme", getGlassTheme());
    p.onpointerdown = (e) => e.stopPropagation();
    const row = document.createElement("div"); row.className = "wosai-sb-row";
    _rpInput = document.createElement("input"); _rpInput.className = "wosai-sb-in";
    _rpInput.placeholder = t('menus.layoutToolkit.replacePickerPlaceholder');
    _rpInput.spellcheck = false; _rpInput.setAttribute("autocomplete", "off");
    _rpInput.oninput = () => { const q = _rpInput.value.trim(); _rpRender(q ? searchMatch(_allNodeTypes(), q, { mode: "normal", fields: ["title", "type"] }) : _allNodeTypes().slice(0, 60)); };
    _rpInput.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); closeReplacePicker(); } };
    row.appendChild(_rpInput);
    p.appendChild(row);
    _rpList = document.createElement("div"); _rpList.className = "wosai-sr-list";
    p.appendChild(_rpList);
    document.body.appendChild(p);
    return p;
}
function openReplacePicker(node) {
    if (!node) { quickToast(t('menus.layoutToolkit.selectNodeToReplace')); return; }
    ensureCSS();
    _rpTarget = node;
    if (!_rp) _rp = buildReplacePicker();
    _rp.setAttribute("data-theme", getGlassTheme());
    _rp.style.display = "block";
    _rp.style.transform = "";
    delete _rp.dataset.wosaiManualPosition;
    _rpInput.value = ""; _rpRender(_allNodeTypes().slice(0, 60));
    _rpFollowCleanup?.();
    _rpFollowCleanup = registerSelectionFollower(_rp, {
        placement: "side",
        gap: 12,
        targets: [node],
    });
    setTimeout(() => _rpInput.focus(), 0);
}
function closeReplacePicker() {
    _rpFollowCleanup?.();
    _rpFollowCleanup = null;
    _rpTarget = null;
    if (_rp) _rp.style.display = "none";
}

// 挂载到 window 供 hub-bar.js 使用
window.__wosaiCenterAndShowOrbs = centerAndShowOrbs;

// ══ M5 实时对齐参考线 ══════════════════════════════════════════════════════
let _chEnabled = true;
window.__wosaiSetCrosshairEnabled = (value) => {
    _chEnabled = !!value;
    app.canvas?.setDirty?.(true, true);
};
let _ctrlHeld = false;
const CH_SNAP = 5;
const CH_COLOR = "var(--ws-accent)";
let _origOnDrawForeground = null;
let _wrappedOnDrawForeground = null;
let _chInstalled = false;

function _chBox(n) { return { x: n.pos[0], y: n.pos[1], w: n.size[0], h: n.size[1] }; }

let _ptrDown = false;
const _dragBaseline = new Map();
function _snapshotPositions() {
    _dragBaseline.clear();
    const nodes = app.canvas?.graph?._nodes || app.canvas?.graph?.nodes || [];
    for (const n of nodes) if (n.pos) _dragBaseline.set(n.id, [n.pos[0], n.pos[1]]);
}
function _detectDrag(canvas) {
    if (canvas.node_dragged) return canvas.node_dragged;
    if (!_ptrDown) return null;
    const nodes = canvas.graph?._nodes || canvas.graph?.nodes || [];
    let moved = null;
    for (const n of nodes) {
        if (!n.pos) continue;
        const p = _dragBaseline.get(n.id);
        if (p && (Math.abs(p[0] - n.pos[0]) > 0.5 || Math.abs(p[1] - n.pos[1]) > 0.5)) moved = n;
    }
    return moved;
}

function _snapOnRelease() {
    if (!_chEnabled || _ctrlHeld) return;
    const c = app.canvas; if (!c || !c.graph) return;
    const nodes = c.graph._nodes || c.graph.nodes || [];
    const groups = c.graph._groups || c.graph.groups || [];
    const moved = [];
    for (const n of nodes) {
        if (!n.pos) continue;
        const p = _dragBaseline.get(n.id);
        if (p && (Math.abs(p[0] - n.pos[0]) > 0.5 || Math.abs(p[1] - n.pos[1]) > 0.5)) moved.push(n);
    }
    if (!moved.length) return;
    const dn = moved[0];
    if (!dn.size) return;
    const movedSet = new Set(moved);
    const others = [];
    for (const n of nodes) if (!movedSet.has(n) && n.pos && n.size) others.push(_chBox(n));
    for (const g of groups) if (!movedSet.has(g) && g.pos && g.size) others.push(_chBox(g));
    if (!others.length) return;
    const g = computeGuides(_chBox(dn), others, CH_SNAP);
    if (g.snapDX || g.snapDY) {
        for (const n of moved) { n.pos[0] += g.snapDX; n.pos[1] += g.snapDY; }
        c.setDirty(true, true);
        try { c.graph.afterChange?.(); } catch (_) {}
    }
}

function _installCH() {
    const c = app.canvas;
    if (!c) return false;
    if (c._wosaiCHWrapped || _chInstalled) return true;
    _origOnDrawForeground = c.onDrawForeground;
    _wrappedOnDrawForeground = function (ctx, canvasEl) {
        if (_origOnDrawForeground) _origOnDrawForeground.call(this, ctx, canvasEl);
        runForegroundDraws(ctx, this);
        // 跳转金色闪烁高亮（独立于参考线开关）
        if (_flashNode && _flashNode.pos && _flashNode.size) {
            const now = performance.now();
            if (now < _flashUntil) {
                const t = (_flashUntil - now) / FLASH_DUR;
                const pulse = 0.45 + 0.4 * Math.abs(Math.sin(now / 110));
                let bx = _flashNode.pos[0], by = _flashNode.pos[1], bw = _flashNode.size[0], bh = _flashNode.size[1];
                if (typeof _flashNode.getBounding === "function") {
                    try { const bb = _flashNode.getBounding(new Float32Array(4)); bx = bb[0]; by = bb[1]; bw = bb[2]; bh = bb[3]; } catch (_) {}
                }
                const s = this.ds?.scale || 1, pad = 7, r = 9;
                const x = bx - pad, y = by - pad, w = bw + pad * 2, h = bh + pad * 2;
                ctx.save();
                ctx.strokeStyle = _resolveColor(FLASH_COLOR, getWOSAIVar('--ws-lt-flash-color'));
                ctx.lineWidth = 3 / s;
                ctx.globalAlpha = Math.min(1, t * 1.2) * pulse;
                ctx.shadowColor = _resolveColor(FLASH_COLOR, getWOSAIVar('--ws-lt-flash-color')); ctx.shadowBlur = 16 / s;
                ctx.beginPath();
                ctx.moveTo(x + r, y);
                ctx.arcTo(x + w, y, x + w, y + h, r);
                ctx.arcTo(x + w, y + h, x, y + h, r);
                ctx.arcTo(x, y + h, x, y, r);
                ctx.arcTo(x, y, x + w, y, r);
                ctx.closePath();
                ctx.stroke();
                ctx.restore();
            }
        }
        if (!_chEnabled || _ctrlHeld) return;
        const dn = _detectDrag(this);
        if (!dn || !dn.pos || !dn.size) return;
        const nodes = this.graph?._nodes || this.graph?.nodes || [];
        const groups = this.graph?._groups || this.graph?.groups || [];
        const others = [];
        for (const n of nodes) if (n !== dn && n.pos && n.size) others.push(_chBox(n));
        for (const g of groups) if (g !== dn && g.pos && g.size) others.push(_chBox(g));
        if (!others.length) return;
        const g = computeGuides(_chBox(dn), others, CH_SNAP);
        if (g.snapDX || g.snapDY) {
            dn.pos[0] += g.snapDX;
            dn.pos[1] += g.snapDY;
            this.setDirty(true, true);
        }
        if (!g.vLines.length && !g.hLines.length) return;
        const va = this.visible_area;
        if (!va) return;
        ctx.save();
        ctx.strokeStyle = _resolveColor(CH_COLOR, getWOSAIVar('--ws-accent'));
        ctx.lineWidth = 1 / (this.ds?.scale || 1);
        ctx.setLineDash([6 / (this.ds?.scale || 1), 4 / (this.ds?.scale || 1)]);
        ctx.beginPath();
        for (const x of g.vLines) { ctx.moveTo(x, va[1]); ctx.lineTo(x, va[1] + va[3]); }
        for (const y of g.hLines) { ctx.moveTo(va[0], y); ctx.lineTo(va[0] + va[2], y); }
        ctx.stroke();
        ctx.restore();
    };
    c.onDrawForeground = _wrappedOnDrawForeground;
    c._wosaiCHWrapped = true;
    _chInstalled = true;
    return true;
}
function _uninstallCH() {
    const c = app.canvas;
    if (!c) return;
    if (c.onDrawForeground === _wrappedOnDrawForeground) {
        c.onDrawForeground = _origOnDrawForeground;
    }
    c._wosaiCHWrapped = false;
    _chInstalled = false;
    _origOnDrawForeground = null;
    _wrappedOnDrawForeground = null;
}
function installCrosshair() {
    if (_installCH()) return;
    retryUntil(() => _installCH(), 40, 250);
}

// ── 「节点」批量操作 tab：对选中节点 绕过/禁用/折叠/展开/克隆/删除 ──
function _selNodes() {
    const out = new Map();
    for (const n of getSelectedNodes()) if (n?.id != null) out.set(n.id, n);
    for (const g of getSelectedGroups()) {
        const inside = getNodesInGroup(g);
        inside.forEach(n => { if (n?.id != null) out.set(n.id, n); });
    }
    return [...out.values()];
}
function _nodeOp(fn, msg) {
    const sel = _selNodes(); if (!sel.length) { quickToast(t('menus.layoutToolkit.selectNode')); return; }
    const g = app.canvas?.graph; g?.beforeChange?.();
    sel.forEach(n => { try { fn(n); } catch (_) {} });
    g?.afterChange?.(); app.canvas?.setDirty?.(true, true); app.canvas?.draw?.(true, true);
    if (msg) quickToast(msg);
}
function nodeBypass() { _nodeOp(n => { n.mode = (n.mode === 4 ? 0 : 4); }, t('menus.layoutToolkit.nodeOpBypass')); }
function nodeMute() { _nodeOp(n => { n.mode = (n.mode === 2 ? 0 : 2); }, t('menus.layoutToolkit.nodeOpMute')); }
function _collapseAction() {
    const sel = _selNodes();
    if (!sel.length) return 'collapse';
    return sel.some(n => !(n.flags && n.flags.collapsed)) ? 'collapse' : 'expand';
}
function _applyCollapseToggle() {
    const sel = _selNodes(); if (!sel.length) { quickToast(t('menus.layoutToolkit.selectNodesOrGroup')); return; }
    const action = _collapseAction();
    const g = app.canvas?.graph; g?.beforeChange?.();
    sel.forEach(n => { n.flags = n.flags || {}; n.flags.collapsed = (action === 'collapse'); });
    g?.afterChange?.(); app.canvas?.setDirty?.(true, true); app.canvas?.draw?.(true, true);
    quickToast(action === 'collapse' ? t('menus.layoutToolkit.nodeOpCollapse') : t('menus.layoutToolkit.nodeOpExpand'));
}
function _mkCollapseToggle() {
    const col0 = _collapseAction() === 'collapse';
    const b = hudMkBtn(col0 ? ALIGN_ICONS.collapse : ALIGN_ICONS.expand, col0 ? t('menus.layoutToolkit.collapseToggleTooltip') : t('menus.layoutToolkit.expandToggleTooltip'), col0 ? t('menus.layoutToolkit.collapseLabel') : t('menus.layoutToolkit.expandLabel'));
    const sync = () => {
        const col = _collapseAction() === 'collapse';
        if (b.children[0]) b.children[0].innerHTML = col ? ALIGN_ICONS.collapse : ALIGN_ICONS.expand;
        if (b.children[1]) b.children[1].textContent = col ? t('menus.layoutToolkit.collapseLabel') : t('menus.layoutToolkit.expandLabel');
        b._tip = col ? t('menus.layoutToolkit.collapseToggleTooltip') : t('menus.layoutToolkit.expandToggleTooltip');
    };
    b.onclick = () => { _applyCollapseToggle(); sync(); };
    return b;
}
function nodeLockToggle() {
    const sel = _selNodes();
    const selGroups = getSelectedGroups();
    if (!sel.length && !selGroups.length) { quickToast(t('menus.layoutToolkit.selectNodesOrGroup')); return; }
    const graph = app.graph;
    // 固定状态判断需同时考虑节点与分组框本身（LiteGraph 原生 LGraphGroup 支持 flags.pinned/pin()）
    const anyPinned = sel.some(n => n.flags?.pinned) || selGroups.some(g => g.flags?.pinned);
    try { graph?.beforeChange?.(); } catch (_) {}
    sel.forEach(n => {
        try {
            n.flags = n.flags || {};
            if (anyPinned) {
                n.flags.pinned = void 0;
                n.resizable = true;
            } else {
                n.flags.pinned = true;
                n.resizable = false;
            }
            if (typeof n.pin === "function") n.pin(!anyPinned);
            else if (n.__affected) n.__affected("flags", n.flags);
        } catch (_) {}
    });
    // 分组框本身也需要固定/取消固定，否则选中分组框时"固定"按钮只影响组内节点，
    // 分组框自身仍可被拖动/缩放（LGraphGroup 原生 move()/resize() 会检查 flags.pinned）
    selGroups.forEach(g => {
        try {
            if (typeof g.pin === "function") { g.pin(!anyPinned); }
            else {
                g.flags = g.flags || {};
                if (anyPinned) delete g.flags.pinned;
                else g.flags.pinned = true;
            }
        } catch (_) {}
    });
    try { graph?.afterChange?.(); } catch (_) {}
    try { graph?.setDirtyCanvas?.(true, true); } catch (_) {}
    try { app.canvas?.setDirty?.(true, true); } catch (_) {}
    try { app.canvas?.draw?.(true, true); } catch (_) {}
    quickToast(anyPinned ? t('menus.layoutToolkit.unpinned') : t('menus.layoutToolkit.pinned'));
}
const _CLONE_GAP = 40;
function _cloneGroup(grp, dx, dy, graph) {
    try {
        const LG = (typeof LGraphGroup !== "undefined") ? LGraphGroup : grp.constructor;
        const ng = new LG();
        const b = grp._bounding || grp.bounding || [grp.pos[0], grp.pos[1], grp.size[0], grp.size[1]];
        const nb = [b[0] + dx, b[1] + dy, b[2], b[3]];
        if (typeof ng.configure === "function") {
            ng.configure({ title: grp.title, bounding: nb, color: grp.color, font_size: grp.font_size });
        } else {
            try { ng.pos = [nb[0], nb[1]]; } catch (_) {}
            try { ng.size = [nb[2], nb[3]]; } catch (_) {}
            ng.title = grp.title; ng.color = grp.color;
        }
        if (typeof graph.add === "function") graph.add(ng);
        else if (typeof graph.addGroup === "function") graph.addGroup(ng);
        else (graph._groups || graph.groups || []).push(ng);
        return ng;
    } catch (_) { return null; }
}
function _removeGroup(grp, graph) {
    try { if (typeof graph.remove === "function") { graph.remove(grp); return; } } catch (_) {}
    try { if (typeof graph.removeGroup === "function") { graph.removeGroup(grp); return; } } catch (_) {}
    const arr = graph._groups || graph.groups;
    if (arr) { const i = arr.indexOf(grp); if (i >= 0) arr.splice(i, 1); }
}
function _hueDist(a, b) { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); }
function _pickDistinctColor() {
    const nodes = app.canvas?.graph?._nodes || app.canvas?.graph?.nodes || [];
    const used = [];
    for (const n of nodes) {
        if (n && typeof n.color === "string" && /^#[0-9a-fA-F]{6}$/.test(n.color)) used.push(hex2hsv(n.color).h);
    }
    let best = randomHSV(), bestScore = -1;
    for (let i = 0; i < 28; i++) {
        const c = randomHSV();
        const score = used.length ? Math.min(...used.map(h => _hueDist(c.h, h))) : 999;
        if (score > bestScore) { bestScore = score; best = c; }
    }
    return hsv2hex(best.h, best.s, best.v);
}
function nodeClone() {
    const sel = _selNodes();
    const groups = getSelectedGroups();
    if (!sel.length && !groups.length) { quickToast(t('menus.layoutToolkit.selectNodesOrGroup')); return; }
    const g = app.canvas?.graph; if (!g) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const acc = (x, y, w, h) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h); };
    sel.forEach(n => acc(n.pos[0], n.pos[1], n.size[0], n.size[1]));
    groups.forEach(grp => { const b = grp._bounding || grp.bounding || [grp.pos[0], grp.pos[1], grp.size[0], grp.size[1]]; acc(b[0], b[1], b[2], b[3]); });
    const dx = (isFinite(minX) ? (maxX - minX) : 0) + _CLONE_GAP;
    const dy = 0;
    g.beforeChange?.();
    const clonedNodes = [];
    sel.forEach(n => { const c = (typeof n.clone === "function") ? n.clone() : null; if (c) { c.pos = [n.pos[0] + dx, n.pos[1] + dy]; g.add(c); clonedNodes.push(c); } });
    const clonedGroups = [];
    groups.forEach(grp => { const ng = _cloneGroup(grp, dx, dy, g); if (ng) clonedGroups.push(ng); });
    const hex = _pickDistinctColor();
    if (clonedNodes.length) applySolidHex(clonedNodes, hex);
    clonedGroups.forEach(ng => { ng.color = hex; });
    g.afterChange?.(); app.canvas?.setDirty?.(true, true); app.canvas?.draw?.(true, true);
    refreshAllVisuals();
    quickToast(clonedGroups.length ? t('menus.layoutToolkit.clonedNodesAndGroups').replace('{nodes}', sel.length).replace('{groups}', clonedGroups.length) : t('menus.layoutToolkit.clonedNodes').replace('{count}', sel.length));
}
function nodeDelete() {
    const sel = _selNodes();
    const groups = getSelectedGroups();
    if (!sel.length && !groups.length) { quickToast(t('menus.layoutToolkit.selectNodesOrGroup')); return; }
    const g = app.canvas?.graph; g?.beforeChange?.();
    sel.forEach(n => { try { g.remove(n); } catch (_) {} });
    groups.forEach(grp => _removeGroup(grp, g));
    g?.afterChange?.(); app.canvas?.setDirty?.(true, true); app.canvas?.draw?.(true, true);
    quickToast(groups.length ? t('menus.layoutToolkit.deletedNodesAndGroups').replace('{nodes}', sel.length).replace('{groups}', groups.length) : t('menus.layoutToolkit.deletedNodes').replace('{count}', sel.length));
}

// ── 挂载到 window 供 hub-bar.js 等外部模块桥接调用（避免循环依赖）──
window.__wosaiNodeLockToggle = nodeLockToggle;
window.__wosaiNodeBypass = nodeBypass;
window.__wosaiNodeMute = nodeMute;
window.__wosaiCollapseAction = _collapseAction;
window.__wosaiApplyCollapseToggle = _applyCollapseToggle;
window.__wosaiNodeClone = nodeClone;
window.__wosaiNodeDelete = nodeDelete;
window.__wosaiJumpToNode = jumpToNode;
window.__wosaiAlignIcons = ALIGN_ICONS;   // 供 hub-bar.js 节点下拉复用同款图标（固定/绕过/禁用/折叠/克隆/删除）

// 把 HUB 栏注册的「节点」分组按钮（自动连点 / 摇断 / 重建）合并到原节点工具栏。
// 复用 window.__wosaiHubButtons 注册表（与 hub-bar.js 节点下拉同源），保证两处内容一致。
function _buildNodeExtraTools(orient = "h") {
    const registry = window.__wosaiHubButtons || [];
    const tools = registry.filter(def => def.group === 'node');
    if (!tools.length) return [];
    const out = [mkDivider(orient)];
    for (const def of tools) {
        const btn = hudMkBtn(def.svg, t(def.tipKey), t(def.labelKey));
        btn.dataset.wsModule = def.id;
        if (def.toggle) {
            const sync = () => btn.classList.toggle('wosai-node-tool-active', !!(def.getActive && def.getActive()));
            sync();
            btn.onclick = (e) => { if (def.onClick) def.onClick(e); sync(); };
        } else {
            btn.onclick = def.onClick;
        }
        out.push(btn);
    }
    return out;
}

// ── 节点工具栏：跳转 / 替换（原 HUB BAR 入口，现并入节点栏，与速联/摇断同组）──
const NODE_JUMP_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m12 16 4-4-4-4"/><path d="M8 12h8"/></svg>';
const NODE_REPLACE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>';

function onNodeJump(e) {
    const sel = _selNodes();
    if (!sel.length) { quickToast(t('menus.layoutToolkit.selectNode')); return; }
    const { ins, outs } = connectedNodes(sel[0]);
    const items = [];
    if (ins.length) {
        items.push({ content: t("menus.layoutToolkit.inputSide"), disabled: true });
        ins.forEach(n => items.push({ content: `← ${n.title || n.type} #${n.id}`, callback: () => jumpToNode(n) }));
    }
    if (outs.length) {
        items.push({ content: t("menus.layoutToolkit.outputSide"), disabled: true });
        outs.forEach(n => items.push({ content: `→ ${n.title || n.type} #${n.id}`, callback: () => jumpToNode(n) }));
    }
    if (!items.length) { quickToast(t('menus.layoutToolkit.noConnectedNodes')); return; }
    const LG = window.LiteGraph;
    if (LG && LG.ContextMenu) {
        const menu = new LG.ContextMenu(items, { title: t("menus.layoutToolkit.connectedNodesTitle") });
        if (menu.root && e) {
            const gap = 6;
            menu.root.style.left = e.clientX + "px";
            menu.root.style.top = (e.clientY + gap) + "px";
            setTimeout(() => {
                if (!menu.root) return;
                menu.root.style.setProperty('z-index', '100002', 'important');
                const overlay = menu.root.parentElement?.querySelector?.('.litegraph-menu-overlay');
                if (overlay) overlay.style.setProperty('z-index', '100001', 'important');
            }, 0);
        }
    }
}

function onNodeReplace() {
    const sel = _selNodes();
    if (sel.length !== 1) { quickToast(t('menus.layoutToolkit.selectSingleNode')); return; }
    openReplacePicker(sel[0]);
}

function buildNodeItems(orient = "h") {
    const mk = (icon, label, tip, fn) => { const b = hudMkBtn(icon, tip, label); b.onclick = fn; return b; };
    return [
        // 状态：只影响当前选区的运行/显示状态。
        mk(ALIGN_ICONS.lock, t('menus.layoutToolkit.lock'), t('menus.layoutToolkit.lockTooltip'), nodeLockToggle),
        mk(ALIGN_ICONS.bypass, t('menus.layoutToolkit.bypass'), t('menus.layoutToolkit.bypassTooltip'), nodeBypass),
        mk(ALIGN_ICONS.mute, t('menus.layoutToolkit.mute'), t('menus.layoutToolkit.muteTooltip'), nodeMute),
        _mkCollapseToggle(),
        mkDivider(orient),
        // 编辑：改变节点本身或其结构。
        mk(ALIGN_ICONS.clone, t('menus.layoutToolkit.clone'), t('menus.layoutToolkit.cloneTooltip'), nodeClone),
        mk(ALIGN_ICONS.del, t('menus.layoutToolkit.delete'), t('menus.layoutToolkit.deleteTooltip'), nodeDelete),
        mk(NODE_REPLACE_SVG, t('menus.layoutToolkit.replaceNode'), t('menus.hubBar.tips.replace'), onNodeReplace),
        // 导航：先跳转，再执行速联/重建/摇断等节点级工具。
        mk(NODE_JUMP_SVG, t('menus.layoutToolkit.jumpToConnected'), t('menus.hubBar.tips.jump'), onNodeJump),
        ..._buildNodeExtraTools(orient),
    ];
}

// ── 扩展生命周期清理 ──
let _ltMouseSideHandler = null;
let _ltKeyDownCtrlHandler = null;
let _ltKeyUpCtrlHandler = null;
let _ltBlurHandler = null;
let _ltPtrDownHandler = null;
let _ltPtrUpHandler = null;
let _ltPtrCancelHandler = null;
let _ltKeyQHandler = null;
let _ltKeyDHandler = null;
let _ltKeyEscHandler = null;
let _ltPtrDownDocHandler = null;
let _ltOffGlassChange = null;

function _removeLayoutPanelDOM() {
    closePanel();
    closeReplacePicker();
    // _panel/_sbox 的内部 DOM 由对应模块自行持有，这里仅做面板关闭与下拉隐藏
}

function _getWosaiNodeMenuItems(node) {
    if (node.type === "WOSAI_CanvasNote") return [];
    try {
        const selAll = getSelectedNodes() || [];
        const inSel = selAll.some(n => n.id === node.id);
        const colorNodes = (inSel && selAll.length > 1)
            ? selAll.filter(n => n.type !== "WOSAI_CanvasNote")
            : [node];
        const result = [];
        if (colorNodes.length && node.type !== "WOSAI_TitleNote") {
            result.push({
                content: (colorNodes.length > 1 ? t("menus.layoutToolkit.contextMenuAdvancedColor") + ` (${colorNodes.length})` : t("menus.layoutToolkit.contextMenuAdvancedColor")),
                callback: () => openNodeColorPicker(colorNodes, undefined, getSelectedGroups()),
            });
        }
        result.push(_navMenuItem(node));
        if (selAll.length >= 2) {
            result.push({
                content: `🟠 ${t("menus.layoutToolkit.quickAlign")}`,
                callback: () => window.__wosaiOpenAlignPanel?.(),
            });
        }
        if (node.type === "WOSAI_OmniSlider") {
            result.push({
                content: t("menus.layoutToolkit.omniSlider"),
                callback: () => { try { openSettingsPanel(node, 0, () => rebuildUI(node)); } catch (e) { console.error('[WOSAI OmniSlider] openSettingsPanel failed:', e); } },
            });
        }
        if (typeof window.__wosaiIsFavorited === "function") {
            const favorited = window.__wosaiIsFavorited(node.type);
            result.push({
                content: favorited ? t("saveNode.favMenuRemove") : t("saveNode.favMenuAdd"),
                callback: () => {
                    if (favorited) window.__wosaiRemoveFavorite(node.type);
                    else window.__wosaiShowChooseCategoryDialog(node);
                },
            });
        }
        for (const provider of window.__wosaiNodeMenuItemProviders ?? []) {
            const items = provider?.(node);
            if (Array.isArray(items)) result.push(...items);
        }
        result.forEach((item) => {
            if (item && typeof item === "object") item.wosaiNodeAction = true;
        });
        return result;
    } catch (e) { return []; }
}

const _WOSAI_NODE_MENU_ENTRY_SELECTOR = ".litemenu-entry, .context-menu-item, .menu-item, .lite-menu-item, [class*='menu-entry'], [class*='menu-item']";
const _WOSAI_NODE_MENU_SEPARATOR_SELECTOR = ".separator, .litemenu-separator, hr";

function _menuEntryLabel(entry) {
    return String(entry?.innerText || entry?.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
}

function _createNodeMenuSeparator(parent) {
    const template = [...parent.children].find((child) => child.matches?.(_WOSAI_NODE_MENU_SEPARATOR_SELECTOR));
    const separator = template?.cloneNode(false) || document.createElement("div");
    if (!template) separator.className = "litemenu-separator";
    separator.removeAttribute?.("id");
    separator.dataset.wosaiNodeMenuSeparator = "";
    return separator;
}

function _coalesceWosaiNodeMenuItems(items) {
    const labels = items
        .filter((item) => item && typeof item === "object" && item.wosaiNodeAction)
        .map((item) => String(item.content || "").replace(/<[^>]*>/g, "").trim())
        .filter(Boolean);
    if (!labels.length) return;

    const wanted = new Set(labels);
    document.querySelectorAll(".litecontextmenu, .context-menu, .litegraph-contextmenu").forEach((menu) => {
        const matchesByParent = new Map();
        menu.querySelectorAll(_WOSAI_NODE_MENU_ENTRY_SELECTOR).forEach((entry) => {
            const label = _menuEntryLabel(entry);
            if (!wanted.has(label) || !entry.parentElement) return;
            const entries = matchesByParent.get(entry.parentElement) || new Map();
            if (!entries.has(label)) entries.set(label, entry);
            matchesByParent.set(entry.parentElement, entries);
        });

        const [parent, entries] = [...matchesByParent.entries()]
            .sort((a, b) => b[1].size - a[1].size)[0] || [];
        if (!parent || !entries?.size) return;

        const orderedEntries = labels.map((label) => entries.get(label)).filter(Boolean);
        if (!orderedEntries.length) return;

        parent.querySelectorAll("[data-wosai-node-menu-separator]").forEach((separator) => separator.remove());
        const actionEntries = new Set(orderedEntries);
        const firstNonWosaiEntry = [...parent.children].find((child) =>
            child.matches?.(_WOSAI_NODE_MENU_ENTRY_SELECTOR) && !actionEntries.has(child));
        const block = document.createDocumentFragment();
        orderedEntries.forEach((entry) => block.appendChild(entry));

        if (firstNonWosaiEntry) {
            parent.insertBefore(block, firstNonWosaiEntry);
            parent.insertBefore(_createNodeMenuSeparator(parent), firstNonWosaiEntry);
        } else {
            parent.appendChild(block);
        }
    });
}

function _scheduleWosaiNodeMenuCoalesce(items) {
    requestAnimationFrame(() => requestAnimationFrame(() => _coalesceWosaiNodeMenuItems(items)));
}

window.__wosaiGetNodeMenuItems = _getWosaiNodeMenuItems;

app.registerExtension({
    name: "WOSAI.LayoutToolkit",
    commands: [
        { id: "wosai-align-panel", label: t('menus.layoutToolkit.commandAlignPanel'), function: () => togglePanel() },
        { id: "wosai-select-same", label: t('menus.layoutToolkit.commandSelectSame'), function: () => selectSameNodes() },
        { id: "wosai-link-chain", label: t('menus.layoutToolkit.commandLinkChain'), function: () => applyFastLink("chain") },
        { id: "wosai-link-gather", label: t('menus.layoutToolkit.commandLinkGather'), function: () => applyFastLink("gather") },
        { id: "wosai-link-broadcast", label: t('menus.layoutToolkit.commandLinkBroadcast'), function: () => applyFastLink("broadcast") },
        { id: "wosai-link-clear", label: t('menus.layoutToolkit.commandLinkClear'), function: () => applyClearInternalLinks() },
        { id: "wosai-replace-node", label: t('menus.layoutToolkit.commandReplaceNode'), function: () => { const s = getSelectedNodes(); s.length === 1 ? openReplacePicker(s[0]) : quickToast(t('menus.layoutToolkit.selectSingleNode')); } },
    ],
    settings: [],
    setup() {
        ensureCSS();
        registerHudTab({ id: "node", label: t("menus.layoutToolkit.tabNode"), order: 2, build: buildNodeItems });

        _ltMouseSideHandler = (e) => {
            if ((e.button === 3 || e.button === 4) && e.target === app.canvas?.canvas) {
                e.preventDefault();
                (e.button === 3) ? jumpBack() : jumpForward();
            }
        };
        window.addEventListener("mousedown", _ltMouseSideHandler, true);
        installCrosshair();
        _chEnabled = getSetting("WOSAI.LayoutToolkit.Crosshair", true) !== false;
        // 以当前选区为基线，避免扩展加载后的第一次任意点击误触发自动对齐面板。

        _ltKeyDownCtrlHandler = (e) => { if (e.key === "Control") _ctrlHeld = true; };
        _ltKeyUpCtrlHandler = (e) => { if (e.key === "Control") _ctrlHeld = false; };
        _ltBlurHandler = () => { _ctrlHeld = false; _ptrDown = false; };
        window.addEventListener("keydown", _ltKeyDownCtrlHandler, true);
        window.addEventListener("keyup", _ltKeyUpCtrlHandler, true);
        window.addEventListener("blur", _ltBlurHandler);

        _ltPtrDownHandler = () => { _ptrDown = true; _snapshotPositions(); };
        _ltPtrUpHandler = () => {
            _ptrDown = false;
            requestAnimationFrame(() => {
                // Nodes 2.0 的选区提交可能发生在当前帧末尾；延后一帧读取，
                // 让 Classic 与 Vue 画布都得到稳定的最终选区。
                requestAnimationFrame(() => {
                    _snapOnRelease();
                });
            });
        };
        _ltPtrCancelHandler = () => { _ptrDown = false; };
        window.addEventListener("pointerdown", _ltPtrDownHandler, true);
        window.addEventListener("pointerup", _ltPtrUpHandler, true);
        window.addEventListener("pointercancel", _ltPtrCancelHandler, true);
        // Ctrl 框选由 HUB 的画布交互层在选区提交后通知，避免不同前端的
        // pointerup/选区更新时序差异导致自动对齐遗漏。
        _ltKeyQHandler = (e) => {
            if (e.key !== "q" && e.key !== "Q") return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const tag = (document.activeElement || {}).tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (document.activeElement || {}).isContentEditable) return;
            e.preventDefault();
            centerAndShowOrbs();
        };
        document.addEventListener("keydown", _ltKeyQHandler);

        // D 只打开节点对齐面板。清除旧版可能残留的“对齐工具栏”绑定，
        // 并在捕获阶段截获事件，避免同时唤起 HUD 工具栏。
        try { app.unregisterKeybinding?.("wosai-align-bar"); } catch (_) {}
        _ltKeyDHandler = (e) => {
            if (e.key !== "d" && e.key !== "D") return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const active = document.activeElement;
            if (active?.tagName === "INPUT" || active?.tagName === "TEXTAREA" || active?.tagName === "SELECT" || active?.isContentEditable) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            openPanel();
        };
        window.addEventListener("keydown", _ltKeyDHandler, true);

        _ltKeyEscHandler = (e) => {
            if (e.key !== "Escape") return;
            if (_panel && _panel.style.display !== "none") { e.preventDefault(); closePanel(); }
            if (_rp && _rp.style.display !== "none") { e.preventDefault(); closeReplacePicker(); }
        };
        document.addEventListener("keydown", _ltKeyEscHandler);

        _ltPtrDownDocHandler = (e) => {
            if (_panel && _panel.style.display !== "none" && !_panel.contains(e.target)) closePanel();
            if (_rp && _rp.style.display !== "none" && !_rp.contains(e.target)) closeReplacePicker();
        };
        document.addEventListener("pointerdown", _ltPtrDownDocHandler, { capture: true });

        _ltOffGlassChange = onGlassChange(() => {
            const t = getGlassTheme();
            if (_panel) _panel.setAttribute("data-theme", t);
            if (_rp) _rp.setAttribute("data-theme", t);
        });

    },
    remove() {
        delete window.__wosaiGetNodeMenuItems;
        delete window.__wosaiOpenAlignPanel;
        delete window.__wosaiCloseAlignPanel;
        delete window.__wosaiSetCrosshairEnabled;
        _unregisterLayoutCommands();
        unregisterHudTab("node");
        if (_ltMouseSideHandler) { window.removeEventListener("mousedown", _ltMouseSideHandler, true); _ltMouseSideHandler = null; }
        if (_ltKeyDownCtrlHandler) { window.removeEventListener("keydown", _ltKeyDownCtrlHandler, true); _ltKeyDownCtrlHandler = null; }
        if (_ltKeyUpCtrlHandler) { window.removeEventListener("keyup", _ltKeyUpCtrlHandler, true); _ltKeyUpCtrlHandler = null; }
        if (_ltBlurHandler) { window.removeEventListener("blur", _ltBlurHandler); _ltBlurHandler = null; }
        if (_ltPtrDownHandler) { window.removeEventListener("pointerdown", _ltPtrDownHandler, true); _ltPtrDownHandler = null; }
        if (_ltPtrUpHandler) { window.removeEventListener("pointerup", _ltPtrUpHandler, true); _ltPtrUpHandler = null; }
        if (_ltPtrCancelHandler) { window.removeEventListener("pointercancel", _ltPtrCancelHandler, true); _ltPtrCancelHandler = null; }
        if (_ltKeyQHandler) { document.removeEventListener("keydown", _ltKeyQHandler); _ltKeyQHandler = null; }
        if (_ltKeyDHandler) { window.removeEventListener("keydown", _ltKeyDHandler, true); _ltKeyDHandler = null; }
        if (_ltKeyEscHandler) { document.removeEventListener("keydown", _ltKeyEscHandler); _ltKeyEscHandler = null; }
        if (_ltPtrDownDocHandler) { document.removeEventListener("pointerdown", _ltPtrDownDocHandler, { capture: true }); _ltPtrDownDocHandler = null; }
        if (_ltOffGlassChange) { _ltOffGlassChange(); _ltOffGlassChange = null; }
        _uninstallCH();
        _removeLayoutPanelDOM();
        _chEnabled = false;
        _ctrlHeld = false;
        _ptrDown = false;
        _dragBaseline.clear();
    },
    getNodeMenuItems(node) {
        const items = _getWosaiNodeMenuItems(node);
        window.__wosaiProtectNodeMenuItems?.(items);
        _scheduleWosaiNodeMenuCoalesce(items);
        return items;
    },
    getCanvasMenuItems(context) {
        const items = [];
        try {
            const graph = context?.graph;
            if (graph) {
                const groups = graph.getGroupOnPos ? graph.getGroupOnPos(context.graph_mouse) : null;
                if (groups?.length) {
                    const groupItems = groups.map(g => g?.group || g).filter(Boolean);
                    if (groupItems.length) {
                        items.push(null);
                        items.push({
                            content: groupItems.length > 1 ? t("menus.layoutToolkit.groupAdvancedColor") + ` (${groupItems.length})` : t("menus.layoutToolkit.groupAdvancedColor"),
                            callback: () => openNodeColorPicker(groupItems),
                        });
                    }
                }
            }
        } catch (e) { console.error('[WOSAI.LayoutToolkit] getCanvasMenuItems error:', e); }
        return items;
    },
});

// ═══════════════════════════════════════════════════════════════
// 挂到 window 供 hub-bar.js 调用（避免循环依赖）
// ═══════════════════════════════════════════════════════════════
window.__wosaiApplyFastLink = applyFastLink;
window.__wosaiOpenReplacePicker = openReplacePicker;

// MiniBar uses these direct exports as its primary bridge. Window globals stay
// available for compatibility with older integrations and context menus.
export {
    openPanel as openAlignPanel,
    openReplacePicker,
    _applyCollapseToggle as applyCollapseToggle,
    nodeClone,
    nodeLockToggle,
};
