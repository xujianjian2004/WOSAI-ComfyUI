/* WOSAI IgnoreGroups v1.0 | 作者：穿山阅海 | COPYRIGHT © WOSAI STUDIO */
/**
 * IgnoreGroups — 忽略编组节点
 * 样式注入：使用 WOSAI CSS 变量（--ws-*），不硬编码颜色
 */

import { app } from "../../../scripts/app.js";
import { getGlassTheme, getGlassMode, setGlassMode, onGlassChange } from "./shared/glass-theme.js";
import { t, applyNodeDefTranslation, onLangChange } from "./shared/i18n.js";
import { WOSAI_COPYRIGHT, STORAGE_KEYS } from "./shared/constants.js";
import { getWOSAIVar, getWOSAIVarNum } from "./shared/shared-utils.js";
import { registerSelectionFollower } from "./shared/selection-follow.js";
import { readIgnoreGroupsState, writeIgnoreGroupsState } from "./shared/ignore-groups-state.js";
import { ensureWosaiStyles } from "./shared/dom-widget.js";
import {
    groupBounds as readGroupBounds,
    groupColor,
    nodeBounds,
    rectangleInside,
    rectanglesOverlap,
} from "./shared/ignore-groups-geometry.js";

/* ── 动态注入 WOSAI 公共样式与本节点样式 ──
   ComfyUI 部分版本/配置不会自动从 extension.json 加载 css，
   因此由 JS 自行确保样式表注入，避免 UI 渲染为无样式原生元素。 */
(function ensureIgnoreGroupsCSS() {
    ensureWosaiStyles([
        ["wosai-ignore-groups-css", new URL("./styles/ignore-groups.css?v=3", import.meta.url).href]
    ]);
})();

/* ════════════════════════════════════════════════════════════════
   样式说明：
   - 静态样式统一位于 web/styles/ignore-groups.css
   - 每个实例通过 --wosai-ig-accent 局部变量注入自定义强调色
   ════════════════════════════════════════════════════════════════*/

/* ════════════════════════════════════════════════════════════════
   主入口：buildIgnoreGroupsUI(node)
   ════════════════════════════════════════════════════════════════*/

let _globalIgCounter = 0;
const _igActiveNodes = new Set();
let _igGraphChangeHooked = false;
let _igOrigGraphChange = null;
let _igOrigAddGroup = null;
let _igOrigRemoveGroup = null;
let _igOrigOnNodeMoved = null;

let _igStyleEl = null;
let _igDomObs = null;
let _igSetupTimer = null;
const _igInitialPatchTimers = [];
const _igNodeCleanup = new Map();

let _igNodeType = null;
let _igOrigOnNodeCreated = null;
let _igOrigOnSerialize = null;
let _igOrigOnConfigure = null;
let _igOrigOnRemoved = null;

/* ── 尺寸工具 ────────────────────────────────────────────
   节点宽度改为设计稿定宽（见 calcWidth），不再随编组名实测加宽，
   因此原先挂在 body 上的隐藏 span 文本测量工具已移除。            */
function _igResolveLen(varName) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    if (!raw) return 0;
    if (raw.endsWith("rem")) return parseFloat(raw) * 16;
    if (raw.endsWith("em"))  return parseFloat(raw) * getWOSAIVarNum('--ws-text-md');
    return parseFloat(raw) || 0;
}

function buildWosaiIgnoreGroupsUI(node) {
    const _uid = "wig_" + (++_globalIgCounter);

    /* ── 状态 ─────────────────────────────────────────────── */
    const initialState = readIgnoreGroupsState(node.properties);
    let {
        filter,
        mode,
        active,
        activeSet,
        nameColor,
        disabled: igDisable,
        sortOrder,
        colorFilter,
        scale: igScale,
    } = initialState;
    let dirty         = true;
    let prevVisibleTitles = new Set();

    function updateAccent() {
        if (!rootEl) return;
        // 实例级强调色：自定义主题色，否则回退品牌橙。驱动 active 标签 / on 徽章底 / toggle 开启底。
        rootEl.style.setProperty("--wosai-ig-accent", nameColor || "var(--ws-accent)");
        if (nameColor) {
            // 主题色分支：标签文字 + 数字圆圈 + 开关 三者统一为自定义色；
            // off 态为该色的半透明变体（color-mix 由自定义色实时派生，无需另存透明度变量）。
            rootEl.style.setProperty("--wosai-ig-on", nameColor);
            rootEl.style.setProperty("--wosai-ig-off", "color-mix(in srgb, " + nameColor + " 25%, transparent)");
            rootEl.style.setProperty("--wosai-ig-off-bg", "color-mix(in srgb, " + nameColor + " 12%, transparent)");
        } else {
            // 默认分支：on 浅橙（--ws-accent-hover），off 半透明品牌橙。
            rootEl.style.setProperty("--wosai-ig-on", "var(--ws-accent-hover)");
            rootEl.style.setProperty("--wosai-ig-off", "var(--ws-ig-off)");
            rootEl.style.setProperty("--wosai-ig-off-bg", "var(--ws-ig-off-bg)");
        }
    }

    function save() {
        node.properties = writeIgnoreGroupsState(node.properties || {}, {
            filter,
            mode,
            active,
            activeSet,
            nameColor,
            disabled: igDisable,
            sortOrder,
            colorFilter,
            scale: igScale,
        });
    }

    function syncFromProps() {
        ({
            filter,
            mode,
            active,
            activeSet,
            nameColor,
            disabled: igDisable,
            sortOrder,
            colorFilter,
            scale: igScale,
        } = readIgnoreGroupsState(node.properties));
        lastSig = "";
        _lastBuildSig = "";
        lastStateSig = "";
        prevVisibleTitles = new Set();
        _preserveActive = true;
        dirty = true;
        node._igDirty = true;
        refresh(true);
    }

    node._wosaiSyncGroups = syncFromProps;

    /* ── 尺寸计算（单列布局，匹配设计稿）────────────────────
       以下常量用于 JS 数值计算节点尺寸，受 ComfyUI/LiteGraph 尺寸系统约束，
       不直接作用于 CSS，因此作为无法 token 化的运行时计算常量保留。      */
    function igCols() { return 1; }

    /* 模式检测：Nodes 2.0 (Vue DOM) vs Classic (Canvas)。
       当前 ComfyUI 两种模式共存，DOM Widget 的可用空间差异较大，尺寸计算需区分。
       ——收窄到当前节点自身 [data-testid="node-body-${node.id}]，
         而非全局 [data-node-id]，避免"画布上任意其他节点已挂载"干扰本节点判断。
         首次加载与 Fix node(recreate) 在同一查询语义下必然收敛到相同结果。 */
    function isNodes20Mode() {
        return !!document.querySelector(`[data-testid="node-body-${node.id}"]`);
    }

    /* 标签列固定宽度（设计稿定宽的唯一可调项）：
       行内其余元素（徽章 / 开关 / 定位）均为固定像素，标签 flex:1 吃余量、
       超长名走 text-overflow:ellipsis（悬停 label.title 看全名）。
       => 节点宽度是与编组名称无关的常量，重建（Fix node）后必然复现同一宽度。 */
    const IG_LABEL_W = 240;   // 标签列宽：容纳常见中文编组名（6~9字）+ 600字重 + letter-spacing 不省略

    function calcWidth() {
        // 行内固定占位（全部来自设计令牌，无运行时文本测量）：
        //   3·gap-md = list 左右外边距(2) + label 右边距(1)
        //   2·gap-sm = row 左右内边距
        //   toggle-w = 开关；locW = 行末定位按钮（与徽章同宽）；+gap-md = 定位左间距
        //   +1 防亚像素裁切
        const gapMd = _igResolveLen("--ws-gap-md");
        const gapSide = _igResolveLen("--ws-gap-sm");
        const tW = _igResolveLen("--ws-ig-toggle-w");
        const locW = _igResolveLen("--ws-ig-badge-size");
        const chrome = 3 * gapMd + 2 * gapSide + tW + locW + gapMd + 1;

        // 序号徽章固定占位：徽章宽 + 右间距 gap-md（≤2 位数够用；3 位数由徽章自身 padding 兜底）
        const badgeW = _igResolveLen("--ws-ig-badge-size");
        const badgeFootprint = badgeW + gapMd;

        return Math.round(chrome + badgeFootprint + IG_LABEL_W);
    }

    function calcHeight() {
        const rowH   = 30;
        const rGap   = 8;
        const cnt    = visible().length;
        const tabH   = 28;
        const tabsPadBot = 12;
        const padBot = 22;
        if (cnt === 0) return tabH + tabsPadBot + padBot + 40;
        const rows = cnt;
        return tabH + tabsPadBot + rows * (rowH + rGap) - rGap + padBot;
    }

    /* 缩放后节点尺寸 = （基准尺寸 + Nodes2.0 body padding 补偿）× 档位（≥1）。
       宽度：calcWidth() 已是与内容无关的常量 → 无状态、重建后必然复现同值。
       高度：calcHeight() 随可见编组数实时增长（见其定义）。
       Nodes2.0 的 node-body 对 DOM Widget 有对称内边距，需在两轴各补 2×padding，
       使内容不被挤压；padX/padY 均由 isNodes20Mode() 每次现算，同样无状态。
       ——已彻底移除旧的 hostRightComp“只补右侧”运行时测量补偿：它是有状态变量，
         Fix node(recreate) 后归零且无人重算，正是右内边距丢失的根因。 */
    function scaledSize() {
        const s = (igScale && igScale > 0) ? igScale : 1;
        const padX = isNodes20Mode() ? 2 * _igResolveLen("--ws-ig-node-body-padding-x") : 0;
        const padY = isNodes20Mode() ? 2 * _igResolveLen("--ws-ig-node-body-padding-y") : 0;
        return [
            Math.round((calcWidth() + padX) * s),
            Math.round((calcHeight() + padY) * s),
        ];
    }

    /*
       尺寸所有权：IgnoreGroups 的行内控件是固定宽度，因而不能允许宿主把
       节点缩到内容的最小宽度以下。此前只在创建/刷新时写 node.size；Nodes 2.0
       随后的拖拽会单独改写外框宽度，而 contentEl 仍保持原宽度，遂发生面板与
       控件分离。

       minSize 是 LiteGraph 与 Nodes 2.0 都能理解的约束；额外写入已挂载的 DOM
       是为 Nodes 2.0 的 Vue 外框提供同一条约束。不要把这两个值拆成两套补偿。
    */
    let _igResizeObserver = null;
    let _igObservedHost = null;
    let _igConstraintQueued = false;

    function _igSetNodeSize(size) {
        const [width, height] = size;
        const current = node.size || [0, 0];
        if (Math.abs((current[0] || 0) - width) < 0.5 &&
            Math.abs((current[1] || 0) - height) < 0.5) return;

        if (typeof node.setSize === "function") node.setSize([width, height]);
        else node.size = [width, height];
        node.setDirtyCanvas?.(true, true);
    }

    function _igApplyDomMinSize(minWidth, minHeight) {
        const body = document.querySelector(`[data-testid="node-body-${node.id}"]`);
        if (!body) return;

        /* node.element 在不同 ComfyUI 小版本中可能是外框、body 或不存在；
           body 本身始终要约束，再尽可能约束外框。 */
        const host = node.element || body.closest("[data-node-id]") || body;
        [body, host].forEach((el) => {
            if (!el || !el.style) return;
            el.style.minWidth = minWidth + "px";
            el.style.minHeight = minHeight + "px";
        });

        if (_igObservedHost !== host && typeof ResizeObserver !== "undefined") {
            _igResizeObserver?.disconnect();
            _igObservedHost = host;
            _igResizeObserver = new ResizeObserver(() => {
                /* 拖拽或 Vue 重排后，下一帧再钳制，避开 ResizeObserver loop。 */
                if (_igConstraintQueued) return;
                _igConstraintQueued = true;
                requestAnimationFrame(() => {
                    _igConstraintQueued = false;
                    _igEnsureMinimumSize();
                });
            });
            _igResizeObserver.observe(host);
        }
    }

    function _igEnsureMinimumSize() {
        const [minWidth, minHeight] = scaledSize();
        node.minSize = [minWidth, minHeight];
        _igApplyDomMinSize(minWidth, minHeight);

        const current = node.size || [0, 0];
        const nextWidth = Math.max(current[0] || 0, minWidth);
        const nextHeight = Math.max(current[1] || 0, minHeight);
        _igSetNodeSize([nextWidth, nextHeight]);
    }

    /* 应用整体缩放：内层 contentEl 用 CSS zoom 放大，node.size 同步按常量重算。
       实时预览无需重建 DOM，仅更新样式与尺寸即可。 */
    function _applyScale() {
        if (!contentEl) return;
        const s = (igScale && igScale > 0) ? igScale : 1;
        const bw = calcWidth(), bh = calcHeight();
        contentEl.style.width  = bw + "px";
        contentEl.style.height = bh + "px";
        contentEl.style.transformOrigin = "top left";
        // 用 CSS zoom 代替 transform:scale：
        // transform:scale 先按 1× 栅格化成位图再放大 → 高倍下文字/边框发虚；
        // zoom 触发真实重排，文字按目标尺寸重新栅格化 → 任意倍数都清晰。
        // 清掉旧的 transform / 合成层，避免残留位图缓存继续发糊。
        contentEl.style.transform = "";
        contentEl.style.willChange = "";
        contentEl.style.zoom = s === 1 ? "" : String(s);
        // 外层 rootEl 高度随缩放增长（宽度由 DOM Widget 100% 跟随 node.size）
        rootEl.style.height = (bh * s) + "px";
        _igEnsureMinimumSize();
    }

    /* ── 滚轮转发 ────────────────────────────────────────── */
    function forwardWheelToCanvas(e) {
        e.preventDefault();
        e.stopPropagation();
        try {
            const canvasEl = (app.canvas && app.canvas.canvas) || document.querySelector("canvas");
            if (canvasEl) {
                canvasEl.dispatchEvent(new WheelEvent("wheel", {
                    clientX: e.clientX, clientY: e.clientY,
                    deltaY: e.deltaY, deltaX: e.deltaX,
                    deltaMode: e.deltaMode, bubbles: true, cancelable: true,
                }));
            }
        } catch (_) {}
    }

    /* ── 编组工具函数 ───────────────────────────────────── */
    /* ── rawGroups 缓存 ────────────────────────────────── */
    let _rgCache = null;

    function rawGroups(invalidate) {
        if (invalidate) { _rgCache = null; }
        if (_rgCache) return _rgCache;
        const g = app.graph;
        if (!g || !g._groups) { _rgCache = []; return _rgCache; }
        /* 同名编组去重标识：
           title 不能唯一标识编组（多个编组可重名），仅用于展示/搜索/排序。
           选中态（active / activeSet）必须使用 key 做身份判定，key 基于
           "同名出现顺序" 生成：第一个同名实例沿用纯 title（向后兼容旧存档），
           第二个及之后追加 "\u0000#序号" 后缀以区分。 */
        const _nameSeen = new Map();
        _rgCache = g._groups.map(gr => {
            const color = groupColor(gr);
            const title = (gr.title || "").trim() || "Unnamed";
            const occ   = _nameSeen.get(title) || 0;
            _nameSeen.set(title, occ + 1);
            const key = occ === 0 ? title : (title + "\u0000#" + occ);
            return {
                title:  title,
                key:    key,
                bounds: readGroupBounds(gr),
                ref:    gr,
                color:  color,
            };
        });
        return _rgCache;
    }

    function visible(cachedAll) {
        let list = cachedAll || rawGroups();
        if (!cachedAll) list = list.slice();
        list = list.filter(g => collectNodes(g, list, cachedAll).length > 0);
        if (filter.trim()) {
            const kw = filter.trim().toLowerCase();
            list = list.filter(g => g.title.toLowerCase().includes(kw));
        }
        if (colorFilter && colorFilter !== "none") {
            list = list.filter(g => {
                if (colorFilter === "__transparent__") return !g.color;
                return g.color && g.color.toLowerCase() === colorFilter.toLowerCase();
            });
        }
        if (sortOrder === "position") {
            list.sort((a, b) => {
                const ax = a.bounds[0], ay = a.bounds[1];
                const bx = b.bounds[0], by = b.bounds[1];
                if (ay !== by) return ay - by;
                return ax - bx;
            });
        } else {
            list.sort((a, b) =>
                a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
            );
        }
        return list;
    }

    function collectNodes(grp, allGroups, cachedAll) {
        const g = app.graph;
        if (!g || !g._nodes) return [];
        const all  = allGroups || rawGroups();
        const pb   = grp.bounds;
        const rects = [pb];
        all.forEach(ag => {
            if (ag.ref !== grp.ref && rectangleInside(ag.bounds, pb)) {
                rects.push(ag.bounds);
            }
        });
        return g._nodes.filter(n => {
            /* 排除控制器自身及其它忽略编组节点，避免管理的分组把本节点一起旁路/禁用
               （参照原始 gjj_group_bypasser：setGroupState 中 if(item===controllerNode)return） */
            if (n === node || n.type === "WOSAI_IgnoreGroups") return false;
            const titleHeight = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_TITLE_HEIGHT) || 30;
            const nb = nodeBounds(n, { titleHeight });
            return rects.some(r => rectanglesOverlap(nb, r));
        });
    }

    function getAllNestedGroups(parentGroup) {
        const all = rawGroups();
        const result = [];
        const visited = new Set();
        visited.add(parentGroup.ref);
        function findNested(parent) {
            all.forEach(ag => {
                if (!visited.has(ag.ref) && rectangleInside(ag.bounds, parent.bounds)) {
                    visited.add(ag.ref);
                    result.push(ag);
                    findNested(ag);
                }
            });
        }
        findNested(parentGroup);
        return result;
    }

    function bypassGroup(grp, cachedAll) {
        collectNodes(grp, null, cachedAll).forEach(n => {
            if (igDisable) { n.mode = 2; } else { n.mode = 4; }
        });
    }

    function restoreGroup(grp, cachedAll) {
        collectNodes(grp, null, cachedAll).forEach(n => {
            n.mode = 0;
            if (n.flags) n.flags.disabled = false;
        });
    }

    function isNodeActive(n) {
        return n.mode !== 4 && n.mode !== 2 && !n.flags?.disabled;
    }

    function getGroupState(grp, cachedAll) {
        const nodes = collectNodes(grp, null, cachedAll);
        if (nodes.length === 0) return true;
        const allActive   = nodes.every(n => isNodeActive(n));
        const allInactive = nodes.every(n => !isNodeActive(n));
        if (allActive)   return true;
        if (allInactive) return false;
        return null;
    }

    function computeStateSig(list, cachedAll) {
        return list.map(g => {
            const s = getGroupState(g, cachedAll);
            return g.key + ":" + (s === true ? "1" : s === false ? "0" : "m");
        }).join("\x00");
    }

    function syncExternalState(cachedAll) {
        if (!app.graph || !app.graph._nodes || app.graph._nodes.indexOf(node) < 0) return false;

        let changed = false;

        if (mode === "default") {
            if (!Array.isArray(activeSet)) return false;
            const allList = rawGroups();
            allList.forEach(g => {
                const gs = getGroupState(g, cachedAll);
                const isActive = activeSet.includes(g.key);
                if (gs === true && !isActive) {
                    activeSet.push(g.key);
                    changed = true;
                } else if (gs === false && isActive) {
                    activeSet = activeSet.filter(t => t !== g.key);
                    changed = true;
                }
            });
        } else {
            const filteredList = visible(cachedAll);
            if (mode === "always_one") {
                if (active) {
                    const grp = filteredList.find(g => g.key === active);
                    if (grp && getGroupState(grp, cachedAll) === false) {
                        const nextActive = filteredList.find(g => getGroupState(g, cachedAll) === true);
                        active = nextActive ? nextActive.key : (filteredList.length ? filteredList[0].key : null);
                        changed = true;
                    } else if (!grp) {
                        if (filteredList.length) {
                            const firstActive = filteredList.find(g => getGroupState(g, cachedAll) === true);
                            active = firstActive ? firstActive.key : filteredList[0].key;
                        } else {
                            active = null;
                        }
                        changed = true;
                    }
                }
                if (!active && filteredList.length) {
                    const firstActive = filteredList.find(g => getGroupState(g, cachedAll) === true);
                    if (firstActive) {
                        active = firstActive.key;
                        changed = true;
                    }
                }
            } else if (mode === "at_most_one") {
                if (active) {
                    const grp = filteredList.find(g => g.key === active);
                    if (grp && getGroupState(grp, cachedAll) === false) {
                        active = null;
                        changed = true;
                    } else if (!grp) {
                        active = null;
                        changed = true;
                    }
                }
                if (!active) {
                    for (const g of filteredList) {
                        if (getGroupState(g, cachedAll) === true) {
                            active = g.key;
                            changed = true;
                            break;
                        }
                    }
                }
            }
        }

        if (changed) save();
        return changed;
    }

    /* ── DOM 构建 ─────────────────────────────────────────── */
    const rootEl = document.createElement("div");
    rootEl.className = `wosai-ig wosai-ig-${_uid}`;
    rootEl.style.visibility = "hidden";
    updateAccent();

    rootEl.addEventListener("wheel", forwardWheelToCanvas, { passive: false });

    let _lastBuildSig = "";
    let lastSig = "";
    let lastStateSig = "";
    let _preserveActive = false;
    let contentEl = null;   // 缩放内层包裹：承载 tabs/list，整体 transform:scale

    // 语言切换时强制重建 DOM，刷新所有翻译文字
    const _offLangChange = onLangChange(() => {
        _lastBuildSig = "";
        lastSig = "";
        lastStateSig = "";
        refresh(true);
    });

    function buildDom(force) {
        const list = visible();

        const sig = list.map(g => {
            const isOn = mode === "default"
                ? (Array.isArray(activeSet) && activeSet.includes(g.key))
                : g.key === active;
            return g.key + (isOn ? ":1" : ":0");
        }).join("\x00");

        if (sig === _lastBuildSig && !force) return;
        _lastBuildSig = sig;

        // 内容承载于内层 contentEl（用于整体缩放）；首次构建时创建并挂到 rootEl
        if (!contentEl) {
            contentEl = document.createElement("div");
            contentEl.className = "wosai-ig-content";
            rootEl.appendChild(contentEl);
        }
        contentEl.innerHTML = "";

        /* 计算当前应高亮的 tab */
        const allSelected = list.length > 0 && mode === "default" &&
            Array.isArray(activeSet) &&
            list.every(g => activeSet.includes(g.key));
        let activeTab = "multiselect";
        if (mode === "at_most_one" || mode === "always_one") activeTab = "single";
        else if (allSelected) activeTab = "all";

        /* ── Tab 胶囊栏 ── */
        const tabsWrap = document.createElement("div");
        tabsWrap.className = "wosai-ig-tabs";
        const tabDefs = [
            { id: "single",    label: t('nodes.ignoreGroups.tabSingle', 'Single') },
            { id: "multiselect", label: t('nodes.ignoreGroups.tabMulti', 'Multi') },
            { id: "all",       label: t('nodes.ignoreGroups.tabAll', 'All') },
            { id: "settings",  label: t('nodes.ignoreGroups.tabSettings', 'Set') },
        ];
        tabDefs.forEach(def => {
            const btn = document.createElement("button");
            btn.className = "wosai-ig-tab" + (activeTab === def.id ? " active" : "");
            btn.textContent = def.label;
            btn.addEventListener("mousedown", (e) => {
                e.preventDefault(); e.stopPropagation();
                if (def.id === "settings") {
                    let sx, sy;
                    try {
                        const ds = app.canvas.ds;
                        const offX = Array.isArray(ds.offset) ? ds.offset[0] : (ds.offset?.x || 0);
                        const offY = Array.isArray(ds.offset) ? ds.offset[1] : (ds.offset?.y || 0);
                        const scale = ds.scale || 1;
                        const rect = app.canvas.canvas.getBoundingClientRect();
                        sx = rect.left + (node.pos[0] + node.size[0]) * scale + offX + 10;
                        sy = rect.top  + (node.pos[1] + node.size[1] / 2) * scale + offY - 230;
                    } catch (e) {
                        sx = innerWidth / 2 - 130;
                        sy = innerHeight / 2 - 200;
                    }
                    showSettings(Math.round(sx), Math.round(sy));
                    return;
                }
                if (def.id === "single") {
                    if (mode !== "at_most_one") {
                        mode = "at_most_one";
                        active = list.length ? list[0].key : null;
                        activeSet = null;
                        save(); refresh(true);
                    }
                } else if (def.id === "multiselect") {
                    if (mode !== "default" || allSelected) {
                        mode = "default";
                        activeSet = [];
                        active = null;
                        save(); refresh(true);
                    }
                } else if (def.id === "all") {
                    mode = "default";
                    activeSet = list.map(g => g.key);
                    active = null;
                    save(); refresh(true);
                }
            });
            btn.addEventListener("pointerdown", (e) => e.stopPropagation());
            btn.addEventListener("wheel", forwardWheelToCanvas, { passive: false });
            tabsWrap.appendChild(btn);
        });
        contentEl.appendChild(tabsWrap);

        if (!list.length) {
            const empty = document.createElement("div");
            empty.className = "wosai-ig-empty";
            empty.textContent = filter.trim() ? t('nodes.ignoreGroups.noMatchingGroups', 'No matching groups') : t('nodes.ignoreGroups.noGroupsInWorkflow', 'No groups or empty groups in workflow');
            contentEl.appendChild(empty);
        } else {
            const listEl = document.createElement("div");
            listEl.className = "wosai-ig-list";
            listEl.style.gridTemplateColumns = "repeat(" + igCols() + ", minmax(0, 1fr))";

            list.forEach((g, i) => {
                const isOn = mode === "default"
                    ? activeSet.includes(g.key)
                    : g.key === active;

                const row = document.createElement("div");
                row.className = "wosai-ig-row" + (isOn ? "" : " off");

                // 左侧顺序序号徽章（代表当前可见列表中的序号 / 分组数量）
                const badge = document.createElement("div");
                badge.className = "wosai-ig-badge";
                badge.textContent = String(i + 1);
                badge.setAttribute("aria-hidden", "true");

                const label = document.createElement("div");
                label.className = "wosai-ig-label";
                label.textContent = g.title;
                label.title = g.title;   // 超长名触发省略号时，悬停看全名

                const toggle = document.createElement("div");
                toggle.className = "wosai-ig-toggle" + (isOn ? " on" : "");

                const knob = document.createElement("div");
                knob.className = "wosai-ig-knob";
                toggle.appendChild(knob);

                // 行末定位按钮：跳转画布并高亮该编组（准星图标，随主题变色）
                const locate = document.createElement("div");
                locate.className = "wosai-ig-locate";
                locate.title = t('nodes.ignoreGroups.locate', 'Locate group on canvas');
                locate.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>';

                row.appendChild(badge);
                row.appendChild(label);
                row.appendChild(toggle);
                row.appendChild(locate);

                // 标签自管点击：单击（240ms 去抖）切换忽略 / 双击原地重命名。
                // 必须 stopPropagation 不冒泡到行——否则单击先触发 refresh 重建 DOM，
                // 会在双击第二下前销毁本标签元素，导致重命名失效。
                let _lblTimer = null;
                label.addEventListener("mousedown", (e) => {
                    e.preventDefault(); e.stopPropagation();
                    if (e.detail >= 2) {
                        if (_lblTimer) { clearTimeout(_lblTimer); _lblTimer = null; }
                        startRename(g, label);
                        return;
                    }
                    if (_lblTimer) clearTimeout(_lblTimer);
                    _lblTimer = setTimeout(() => { _lblTimer = null; handleToggle(g.key); }, 240);
                });
                label.addEventListener("pointerdown", (e) => e.stopPropagation());

                // 定位按钮：只跳转，不切换忽略态
                locate.addEventListener("mousedown", (e) => {
                    e.preventDefault(); e.stopPropagation();
                    locateGroup(g);
                });
                locate.addEventListener("pointerdown", (e) => e.stopPropagation());
                locate.addEventListener("wheel", forwardWheelToCanvas, { passive: false });

                row.addEventListener("mousedown", (e) => {
                    e.preventDefault(); e.stopPropagation();
                    handleToggle(g.key);
                });
                row.addEventListener("pointerdown", (e) => e.stopPropagation());
                row.addEventListener("wheel", forwardWheelToCanvas, { passive: false });

                listEl.appendChild(row);
            });
            contentEl.appendChild(listEl);
        }

        // 应用整体缩放（contentEl 尺寸 + node.size 同步），保证实时预览一致
        _applyScale();

        /* 内容变化后只抬高最小尺寸，不覆盖用户主动放大的节点宽度。 */
        _igEnsureMinimumSize();
    }

    /* ── computeSize ──────────────────────────────────────── */
    const domWidget = node.addDOMWidget("wosai_ig", "HTML", rootEl, {
        serialize: false,
        hideOnZoom: false,
    });

    const _origNodeComputeSize = node.computeSize;
    const _origWidgetComputeSize = domWidget ? domWidget.computeSize : null;

    if (domWidget) {
        domWidget.computeSize = function () {
            return scaledSize();
        };
    }

    node.computeSize = function () {
        return scaledSize();
    };

    /* ── handleToggle ─────────────────────────────────────── */
    function handleToggle(key) {
        if (mode === "default") {
            if (!Array.isArray(activeSet)) activeSet = [];
            const list = visible();
            const grp  = list.find(g => g.key === key);
            const idx  = activeSet.indexOf(key);
            const turnOn = idx < 0;

            if (turnOn) {
                if (!activeSet.includes(key)) activeSet.push(key);
                if (grp) {
                    getAllNestedGroups(grp).forEach(ng => {
                        if (!activeSet.includes(ng.key)) activeSet.push(ng.key);
                    });
                }
            } else {
                const offSet = new Set();
                offSet.add(key);
                if (grp) {
                    getAllNestedGroups(grp).forEach(ng => offSet.add(ng.key));
                }
                activeSet = activeSet.filter(t => !offSet.has(t));
            }
        } else if (mode === "always_one") {
            if (active === key) return;
            active = key;
        } else {
            if (active === key) { active = null; }
            else { active = key; }
        }
        save();
        refresh(true);
    }

    /* ── 定位到画布 + 品牌橙高亮 ─────────────────────────────
       高亮通过 onDrawForeground 钩子在“图空间”直接描边（ctx 已随画布变换），
       规避 DPR/坐标换算坑；单钩子 + _locState 状态，避免多次点击重复挂钩。
       相位：闪烁 2s → 边框淡出 2s → 自动清除，总时长 4s。 */
    let _locState = null;
    let _locHookInstalled = false;
    let _locTimer = null;
    let _locRaf = 0;
    const LOC_PULSE_DURATION = 2000;
    const LOC_FADE_DURATION = 2000;
    const LOC_TOTAL_DURATION = LOC_PULSE_DURATION + LOC_FADE_DURATION;

    // Read the brand colour from the design token so canvas overlays follow
    // the active theme as well as DOM components.
    function _igReadBrandRGB() {
        const v = getWOSAIVar("--ws-accent", "");
        const m = v.match(/^#?([0-9a-fA-F]{6})$/);
        if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
        const m2 = v.match(/(\d+)\D+(\d+)\D+(\d+)/);
        if (m2) return [+m2[1], +m2[2], +m2[3]];
        return [0, 0, 0];
    }
    const IG_BRAND = _igReadBrandRGB();

    function _igRoundRectPath(ctx, x, y, w, h, r) {
        r = Math.max(0, Math.min(r, w / 2, h / 2));
        if (typeof ctx.roundRect === "function") { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function installLocHook() {
        if (_locHookInstalled) return;
        const canvas = app.canvas;
        if (!canvas) return;
        _locHookInstalled = true;
        const prev = canvas.onDrawForeground;
        canvas.onDrawForeground = function (ctx, ...args) {
            if (typeof prev === "function") prev.call(this, ctx, ...args);
            if (!_locState) return;
            const now = performance.now();
            if (now >= _locState.endAt) { _locState = null; return; }
            const b = _locState.bounds;
            const ds = canvas.ds;
            const scale = (ds && ds.scale) || 1;
            const x = b[0], y = b[1], w = b[2], h = b[3];
            const rGraph = 14 / scale;                       // 屏幕恒定圆角
            const elapsed = now - _locState.start;
            const pulsing = elapsed < _locState.pulseDur;
            let alpha, lw;
            if (pulsing) {
                const p = elapsed / _locState.pulseDur;        // 0..1
                const s = 0.5 - 0.5 * Math.cos(p * Math.PI * 3);
                alpha = 0.35 + 0.65 * s;
                lw = (3 + 4 * s) / scale;
            } else {
                alpha = 1;
                lw = 2.5 / scale;
            }
            if (!pulsing) {
                const fadeProgress = Math.min(1, (elapsed - _locState.pulseDur) / _locState.fadeDur);
                const fade = 1 - fadeProgress;
                alpha = fade;
                lw = (2.5 * (0.7 + 0.3 * fade)) / scale;
            }
            if (pulsing) {
                const settle = Math.min(1, Math.max(0, (elapsed - _locState.pulseDur + 180) / 180));
                if (settle > 0) alpha += (1 - alpha) * settle;
            }
            const [R, G, Bb] = IG_BRAND;
            ctx.save();
            // 外圈低透明度光晕，增强品牌感
            ctx.strokeStyle = "rgba(" + R + "," + G + "," + Bb + "," + (0.22 * alpha).toFixed(3) + ")";
            ctx.lineWidth = lw + 8 / scale;
            _igRoundRectPath(ctx, x, y, w, h, rGraph);
            ctx.stroke();
            // 主品牌橙边框
            ctx.strokeStyle = "rgba(" + R + "," + G + "," + Bb + "," + alpha.toFixed(3) + ")";
            ctx.lineWidth = lw;
            _igRoundRectPath(ctx, x, y, w, h, rGraph);
            ctx.stroke();
            ctx.restore();
        };
    }
    function flashGroup(bounds) {
        if (!bounds || bounds.length < 4) return;
        const canvas = app.canvas;
        if (!canvas) return;
        installLocHook();
        const now = performance.now();
        if (_locTimer) { clearTimeout(_locTimer); _locTimer = null; }
        if (_locRaf) { cancelAnimationFrame(_locRaf); _locRaf = 0; }
        const state = _locState = {
            bounds: [bounds[0], bounds[1], bounds[2], bounds[3]],
            start: now,
            pulseDur: LOC_PULSE_DURATION,
            fadeDur: LOC_FADE_DURATION,
            endAt: now + LOC_TOTAL_DURATION,
        };
        // 闪烁与淡出阶段都持续重绘，确保无交互时也能完整播放 4s 动画
        const tick = () => {
            _locRaf = 0;
            if (_locState !== state) return;
            canvas.setDirty(true, true);
            if ((performance.now() - state.start) < LOC_TOTAL_DURATION) {
                _locRaf = requestAnimationFrame(tick);
            }
        };
        _locRaf = requestAnimationFrame(tick);
        // 4s 后强制清除（即便画布无交互也消失）
        _locTimer = setTimeout(() => {
            if (_locState === state) {
                _locState = null;
                _locTimer = null;
                if (_locRaf) { cancelAnimationFrame(_locRaf); _locRaf = 0; }
                canvas.setDirty(true, true);
            }
        }, LOC_TOTAL_DURATION);
    }
    function groupBounds(g) {
        const ref = g && g.ref;
        if (ref && (ref._bounding || ref.bounding)) return [...(ref._bounding || ref.bounding)];
        if (g && g.bounds) return [...g.bounds];
        return null;
    }
    function locateGroup(g) {
        try {
            const canvas = app.canvas;
            if (!canvas) return;
            const b = groupBounds(g);
            if (b && b.length >= 4) {
                const ds = canvas.ds;
                const scale = (ds && ds.scale) || 1;
                const cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
                // 与 LiteGraph centerOnNode 同一约定：offset = 画布中心/scale − 目标中心
                const offX = (canvas.canvas.width * 0.5) / scale - cx;
                const offY = (canvas.canvas.height * 0.5) / scale - cy;
                if (Array.isArray(ds.offset)) { ds.offset[0] = offX; ds.offset[1] = offY; }
                else if (ds.offset) { ds.offset.x = offX; ds.offset.y = offY; }
                canvas.setDirty(true, true);
            } else if (g && g.ref && typeof canvas.centerOnNode === "function") {
                canvas.centerOnNode(g.ref);   // 兜底：拿不到 bounds 时用原生居中
            }
            flashGroup(b);
        } catch (_) {}
    }

    /* ── 原地重命名编组 ──────────────────────────────────────
       label → input 原地替换；提交后同步真实编组 title，并把忽略态从旧 key
       迁移到新 key（key 由 title 派生，改名会换 key，不迁移会丢开关状态）。 */
    let _igRenaming = false;
    function startRename(g, labelEl) {
        if (_igRenaming || !labelEl || !labelEl.isConnected) return;
        _igRenaming = true;
        const oldTitle = (g.ref && g.ref.title) || g.title || "";
        const wasOn = mode === "default"
            ? (Array.isArray(activeSet) && activeSet.includes(g.key))
            : (active === g.key);

        const input = document.createElement("input");
        input.className = "wosai-ig-rename";
        input.value = oldTitle;
        input.spellcheck = false;
        labelEl.replaceWith(input);
        input.focus();
        input.select();

        input.addEventListener("mousedown", (e) => e.stopPropagation());
        input.addEventListener("pointerdown", (e) => e.stopPropagation());
        input.addEventListener("dblclick", (e) => e.stopPropagation());
        input.addEventListener("wheel", forwardWheelToCanvas, { passive: false });

        let finished = false;
        const finish = (commit) => {
            if (finished) return;
            finished = true;
            _igRenaming = false;
            if (commit) {
                const nv = input.value.trim();
                if (nv && nv !== oldTitle && g.ref) {
                    g.ref.title = nv;
                    app.graph?.setDirtyCanvas?.(true, true);
                    rawGroups(true);   // title/key 已变，失效缓存后重算
                    const fresh = rawGroups().find(x => x.ref === g.ref);
                    if (fresh && fresh.key !== g.key) {
                        if (mode === "default" && Array.isArray(activeSet)) {
                            const idx = activeSet.indexOf(g.key);
                            if (idx >= 0) activeSet.splice(idx, 1);
                            if (wasOn && !activeSet.includes(fresh.key)) activeSet.push(fresh.key);
                        } else if (active === g.key) {
                            active = fresh.key;
                        }
                    }
                    save();
                }
            }
            refresh(true);   // 重建 DOM，input 随之移除
        };

        input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") { e.preventDefault(); finish(true); }
            else if (e.key === "Escape") { e.preventDefault(); finish(false); }
        });
        input.addEventListener("blur", () => finish(true));
    }

    /* ════════════════════════════════════════════════════════════════
       设置弹窗
       ════════════════════════════════════════════════════════════════*/
    let _settingsCleanup = null;

    function showSettings(x, y) {
        if (_settingsCleanup) { _settingsCleanup(); _settingsCleanup = null; }

        // 重置主题为 AUTO 模式
        if (getGlassMode() !== 'auto') { setGlassMode('auto'); }

        const overlay = document.createElement("div");
        overlay.id = "wosai_ig_overlay";
        Object.assign(overlay.style, {
            position: "fixed", inset: "0", zIndex: "99998",
            background: "transparent", cursor: "default",
        });
        overlay.addEventListener("wheel", forwardWheelToCanvas, { passive: false });
        document.body.appendChild(overlay);

        const pop = document.createElement("div");
        pop.id = "wosai_ig_pop";
        pop.setAttribute("data-wosai-panel", "");
        pop.setAttribute("data-theme", getGlassTheme());
        Object.assign(pop.style, {
            position: "fixed",
            background: "var(--ws-glass-bg)",
            border: "var(--ws-glass-border)",
            borderRadius: "var(--ws-radius-lg)",
            padding: "var(--ws-panel-padding)",
            zIndex: "99999", minWidth: "var(--ws-panel-width-sm)", maxWidth: "var(--ws-panel-width)",
            boxShadow: "var(--ws-glass-shadow)",
            backdropFilter: "var(--ws-glass-blur)",
            WebkitBackdropFilter: "var(--ws-glass-blur)",
            color: "var(--ws-text)", fontFamily: "var(--ws-font-family)",
            fontSize: "var(--ws-text-base)",
        });
        pop.addEventListener("wheel", forwardWheelToCanvas, { passive: false });

        let _followCleanup = () => {};

        function closePopup() {
            _followCleanup();
            if (overlay.parentNode) overlay.remove();
            if (pop.parentNode)     pop.remove();
            document.removeEventListener("keydown", onEsc);
            document.removeEventListener("mousedown", closeColorPanel);
            if (pop._offGlass) { pop._offGlass(); pop._offGlass = null; }
            _settingsCleanup = null;
        }
        _settingsCleanup = closePopup;

        overlay.addEventListener("mousedown", (e) => {
            e.preventDefault(); e.stopPropagation(); closePopup();
        });
        function onEsc(e) { if (e.key === "Escape") closePopup(); }
        document.addEventListener("keydown", onEsc);

        /* 订阅主题变化 */
        pop._offGlass = onGlassChange((t) => { pop.setAttribute("data-theme", t); });

        /* 待应用的离散选项（由 WOSAI 分段标签按钮更新，applyAll 读取） */
        let uiDisable = igDisable;
        let uiMode    = mode;
        let uiSort    = sortOrder;

        /* 设置行：左侧标签 + 右侧控件（匹配设计稿左右布局） */
        function srow(labelText) {
            const row = document.createElement("div");
            Object.assign(row.style, {
                display: "grid", gridTemplateColumns: "auto minmax(0, var(--ws-ig-setting-input-min-width))", alignItems: "center", gap: "var(--ws-ig-row-gap)",
                marginBottom: "var(--ws-gap-lg)",
            });
            const lab = document.createElement("div");
            lab.textContent = labelText;
            Object.assign(lab.style, {
                fontSize: "var(--ws-text-md)", fontWeight: "500", color: "var(--ws-text-muted)",
                whiteSpace: "nowrap", justifySelf: "start",
            });
            row.appendChild(lab);
            const valWrap = document.createElement("div");
            Object.assign(valWrap.style, {
                display: "flex", alignItems: "center", gap: "var(--ws-gap-xs)",
                minWidth: "0",
            });
            row.appendChild(valWrap);
            return { row, valWrap };
        }

        /* WOSAI 独立分段按钮组（设计稿：每个按钮各自有边框，互不相连）
           返回 { el, setActive }：setActive(value) 可程序化回设选中态，
           供「重置」一键复位控件显示。 */
        function segmented(items, getCurrent, onPick) {
            const wrap = document.createElement("div");
            Object.assign(wrap.style, {
                display: "flex", gap: "var(--ws-gap-sm)", width: "100%",
            });
            const btns = [];
            items.forEach((it) => {
                const b = document.createElement("button");
                b.textContent = it.label;
                b._value = it.value;
                Object.assign(b.style, {
                    flex: "1", padding: "var(--ws-ig-seg-btn-padding-y) var(--ws-ig-seg-btn-padding-x)", fontSize: "var(--ws-text-sm)", lineHeight: "1.3",
                    border: "var(--ws-border-width-thin) solid var(--ws-border)", borderRadius: "var(--ws-radius)",
                    cursor: "pointer", whiteSpace: "nowrap",
                    background: "transparent", color: "var(--ws-text-muted)",
                    transition: "background var(--ws-transition), color var(--ws-transition), border-color var(--ws-transition)",
                    fontFamily: "inherit",
                });
                b._set = (on) => {
                    if (on) {
                        b.style.background = "var(--ws-accent)";
                        b.style.color      = "var(--ws-text-on-accent)";
                        b.style.borderColor = "var(--ws-accent)";
                        b.style.fontWeight = "500";
                    } else {
                        b.style.background = "transparent";
                        b.style.color      = "var(--ws-text-muted)";
                        b.style.borderColor = "var(--ws-border)";
                        b.style.fontWeight = "400";
                    }
                };
                b._set(it.value === getCurrent());
                b.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
                b.addEventListener("click", (e) => {
                    e.preventDefault(); e.stopPropagation();
                    btns.forEach((x) => x._set(false));
                    b._set(true);
                    onPick(it.value);
                });
                wrap.appendChild(b);
                btns.push(b);
            });
            return {
                el: wrap,
                setActive(value) { btns.forEach((x) => x._set(x._value === value)); },
            };
        }

        function applyAll() {
            filter      = fInput.value;
            colorFilter = cFilter;
            nameColor   = cInput.value || null;
            igDisable   = uiDisable;
            sortOrder   = uiSort;
            const newMode = uiMode;

            updateAccent();

            if (newMode !== mode) {
                if (newMode === "default") {
                    activeSet = visible().map(g => g.key);
                } else if (newMode === "always_one") {
                    const fl = visible();
                    const ft = new Set(fl.map(g => g.key));
                    if (activeSet && activeSet.length) {
                        const match = activeSet.find(t => ft.has(t));
                        active = match || (fl.length ? fl[0].key : null);
                    } else {
                        active = fl.length ? fl[0].key : null;
                    }
                    activeSet = null;
                } else {
                    const fl = visible();
                    const ft = new Set(fl.map(g => g.key));
                    if (activeSet && activeSet.length) {
                        const match = activeSet.find(t => ft.has(t));
                        active = match || null;
                    } else if (mode === "always_one" && active && ft.has(active)) {
                        /* keep */
                    } else {
                        active = null;
                    }
                    activeSet = null;
                }
                mode = newMode;
            } else {
                if (mode === "always_one" && !active) {
                    const list = visible();
                    if (list.length) active = list[0].key;
                }
            }
            save();
            refresh(true);
        }

        /* ── 弹窗标题 ───────────────── */
        const titleRow = document.createElement("div");
        Object.assign(titleRow.style, {
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: "var(--ws-ig-title-row-gap)",
        });
        const titleEl = document.createElement("div");
        titleEl.textContent = t('nodes.ignoreGroups.panelTitle', 'Ignore Group Settings');
        Object.assign(titleEl.style, {
            fontSize: "var(--ws-text-xl)", fontWeight: "600",
            color: "var(--ws-text)", letterSpacing: "0.02em",
        });
        titleRow.appendChild(titleEl);
        pop.appendChild(titleRow);

        /* 路由控制 */
        const dRow = srow(t('nodes.ignoreGroups.controller'));
        const dSeg = segmented(
            [{ value: false, label: t('nodes.ignoreGroups.bypass') }, { value: true, label: t('common.disable') }],
            () => uiDisable,
            (v) => { uiDisable = v; applyAll(); }
        );
        dRow.valWrap.appendChild(dSeg.el);
        pop.appendChild(dRow.row);

        /* 关键词筛选 */
        const fRow = srow(t('nodes.ignoreGroups.keywordFilter'));
        const fInput = document.createElement("input");
        fInput.type = "text"; fInput.value = filter; fInput.placeholder = t('nodes.ignoreGroups.filterPlaceholder');
        Object.assign(fInput.style, {
            flex: "1", minWidth: "0", padding: "var(--ws-ig-input-padding-y) var(--ws-ig-input-padding-x)", fontSize: "var(--ws-text-sm)",
            background: "var(--ws-input-bg)", border: "var(--ws-border-width-thin) solid var(--ws-input-border)",
            borderRadius: "var(--ws-radius)", color: "var(--ws-input-text)",
            outline: "none", boxSizing: "border-box",
        });
        fInput.addEventListener("focus", () => { fInput.style.borderColor = "var(--ws-border-accent)"; });
        fInput.addEventListener("blur",  () => { fInput.style.borderColor = "var(--ws-input-border)"; });
        fRow.valWrap.appendChild(fInput);
        pop.appendChild(fRow.row);
        let filterTimer = null;
        fInput.addEventListener("input", () => {
            if (filterTimer) clearTimeout(filterTimer);
            filterTimer = setTimeout(applyAll, 200);
        });

        /* 颜色筛选 */
        const cRow = srow(t('nodes.ignoreGroups.colorFilter'));
        let cFilter = colorFilter || "none";

        const cdContainer = document.createElement("div");
        Object.assign(cdContainer.style, { position: "relative", flex: "1", minWidth: "0" });

        const cdTrigger = document.createElement("div");
        Object.assign(cdTrigger.style, {
            width: "100%", padding: "var(--ws-ig-input-padding-y) var(--ws-ig-input-padding-x)", fontSize: "var(--ws-text-sm)",
            background: "var(--ws-input-bg)", border: "var(--ws-border-width-thin) solid var(--ws-input-border)",
            borderRadius: "var(--ws-radius)", color: "var(--ws-input-text)",
            boxSizing: "border-box", cursor: "pointer",
            display: "flex", alignItems: "center", gap: "var(--ws-gap-sm)", userSelect: "none",
        });
        const cdColorRect = document.createElement("span");
        Object.assign(cdColorRect.style, {
            display: "inline-block", width: "var(--ws-ig-swatch-w)", height: "var(--ws-ig-swatch-h)",
            borderRadius: "var(--ws-ig-swatch-radius)", border: "var(--ws-border-width-thin) solid var(--ws-border)", flexShrink: "0",
        });
        const cdColorText = document.createElement("span");
        Object.assign(cdColorText.style, { flex: "1", fontSize: "var(--ws-text-sm)" });
        const cdArrow = document.createElement("span");
        cdArrow.textContent = "▾";
        Object.assign(cdArrow.style, { marginLeft: "auto", fontSize: "var(--ws-text-xs)", color: "var(--ws-text-muted)" });
        // cdArrow 使用文字符号，无额外尺寸硬编码
        cdTrigger.appendChild(cdColorRect); cdTrigger.appendChild(cdColorText); cdTrigger.appendChild(cdArrow);

        function updateColorPreview() {
            if (cFilter === "none") {
                cdColorRect.style.display = "none"; cdColorText.textContent = t('nodes.ignoreGroups.none');
            } else if (cFilter === "__transparent__") {
                cdColorRect.style.display = "inline-block"; cdColorRect.style.background = "transparent";
                cdColorText.textContent = t('nodes.ignoreGroups.transparentColor');
            } else {
                cdColorRect.style.display = "inline-block"; cdColorRect.style.background = cFilter;
                cdColorText.textContent = cFilter.toUpperCase();
            }
        }
        updateColorPreview();
        cdContainer.appendChild(cdTrigger);

        let cdPanel = null;
        function buildColorOptions() {
            const allRaw = rawGroups();
            const colorMap = new Map();
            allRaw.forEach(g => { const c = g.color || "__transparent__"; if (!colorMap.has(c)) colorMap.set(c, g); });
            const colors = Array.from(colorMap.keys());
            if (cdPanel) { cdPanel.remove(); cdPanel = null; }
            cdPanel = document.createElement("div");
            Object.assign(cdPanel.style, {
                position: "absolute", left: "0", right: "0", top: "calc(100% + var(--ws-gap-2xs))",
                background: "var(--ws-glass-bg)", border: "var(--ws-glass-border)",
                borderRadius: "var(--ws-radius)", zIndex: "100001", maxHeight: "var(--ws-ig-color-panel-max-h)", overflowY: "auto",
                boxShadow: "var(--ws-glass-shadow)",
                backdropFilter: "var(--ws-glass-blur)",
                WebkitBackdropFilter: "var(--ws-glass-blur)",
            });
            cdPanel.addEventListener("wheel", forwardWheelToCanvas, { passive: false });
            function makeColorItem(bgColor, label, value, isTransparent, isNone) {
                const item = document.createElement("div");
                Object.assign(item.style, {
                    display: "flex", alignItems: "center", gap: "var(--ws-gap)",
                    padding: "var(--ws-ig-input-padding-y) var(--ws-ig-input-padding-x)", cursor: "pointer", fontSize: "var(--ws-text-sm)",
                    transition: "background var(--ws-transition)",
                });
                item.addEventListener("mouseenter", () => { item.style.background = "var(--ws-surface-raised)"; });
                item.addEventListener("mouseleave", () => { item.style.background = "transparent"; });
                if (!isNone) {
                    const rect = document.createElement("span");
                    Object.assign(rect.style, {
                        display: "inline-block", width: "var(--ws-ig-swatch-w)", height: "var(--ws-ig-swatch-h)",
                        borderRadius: "var(--ws-ig-swatch-radius)", border: "var(--ws-border-width-thin) solid var(--ws-border)",
                        background: isTransparent ? "transparent" : bgColor, flexShrink: "0",
                    });
                    item.appendChild(rect);
                }
                const txt = document.createElement("span");
                txt.textContent = label; txt.style.color = "var(--ws-text)"; item.appendChild(txt);
                item.addEventListener("click", (e) => {
                    e.stopPropagation(); cFilter = value; updateColorPreview();
                    if (cdPanel) { cdPanel.remove(); cdPanel = null; } applyAll();
                });
                return item;
            }
            cdPanel.appendChild(makeColorItem("var(--ws-surface)", t('nodes.ignoreGroups.none'), "none", false, true));
            colors.forEach(c => {
                if (c === "__transparent__") { cdPanel.appendChild(makeColorItem("var(--ws-surface)", t('nodes.ignoreGroups.transparentColor'), "__transparent__", true, false)); }
                else { cdPanel.appendChild(makeColorItem(c, c.toUpperCase(), c, false, false)); }
            });
            cdContainer.appendChild(cdPanel);
        }
        cdTrigger.addEventListener("click", (e) => {
            e.stopPropagation();
            if (cdPanel) { cdPanel.remove(); cdPanel = null; } else { buildColorOptions(); }
        });
        cRow.valWrap.appendChild(cdContainer);
        pop.appendChild(cRow.row);

        const closeColorPanel = (e) => {
            if (cdPanel && !cdContainer.contains(e.target)) { cdPanel.remove(); cdPanel = null; }
        };
        document.addEventListener("mousedown", closeColorPanel);

        /* 排序 */
        const sRow = srow(t('nodes.ignoreGroups.sortOrder'));
        const sSeg = segmented(
            [{ value: "position", label: t('nodes.ignoreGroups.sortByPosition') }, { value: "alphabet", label: t('nodes.ignoreGroups.sortByAlphabet') }],
            () => uiSort,
            (v) => { uiSort = v; applyAll(); }
        );
        sRow.valWrap.appendChild(sSeg.el);
        pop.appendChild(sRow.row);

        /* 缩放档位（1–5 倍整体放大，拖动实时预览） */
        const zRow = srow(t('nodes.ignoreGroups.scale'));
        const zWrap = document.createElement("div");
        Object.assign(zWrap.style, { display: "flex", alignItems: "center", gap: "var(--ws-gap-sm)", width: "100%" });
        const zSlider = document.createElement("input");
        zSlider.type = "range";
        zSlider.min = "1"; zSlider.max = "5"; zSlider.step = "0.5";
        zSlider.value = String(igScale);
        Object.assign(zSlider.style, {
            flex: "1", minWidth: "0", cursor: "pointer",
            accentColor: "var(--ws-accent)",
        });
        const zVal = document.createElement("div");
        zVal.textContent = Number(igScale).toFixed(1) + "×";
        Object.assign(zVal.style, {
            minWidth: "var(--ws-ig-color-value-min-width)", textAlign: "right", fontSize: "var(--ws-text-sm)",
            color: "var(--ws-text)", fontVariantNumeric: "tabular-nums",
        });
        zSlider.addEventListener("mousedown", (e) => { e.stopPropagation(); });
        zSlider.addEventListener("input", () => {
            igScale = parseFloat(zSlider.value) || 1;
            zVal.textContent = igScale.toFixed(1) + "×";
            _applyScale();   // 实时预览：立即缩放面板
            save();          // 持久化档位
        });
        zWrap.appendChild(zSlider);
        zWrap.appendChild(zVal);
        zRow.valWrap.appendChild(zWrap);
        pop.appendChild(zRow.row);

        /* 主题颜色 */
        const tcRow = srow(t('nodes.ignoreGroups.themeColor'));
        const cInput = document.createElement("input");
        cInput.type = "color"; cInput.value = nameColor || getWOSAIVar('--ws-accent');
        Object.assign(cInput.style, {
            width: "var(--ws-ig-color-input-w)", height: "var(--ws-ig-color-input-h)", padding: "0", flexShrink: "0",
            border: "none", borderRadius: "var(--ws-radius-sm)",
            background: "transparent", cursor: "pointer",
        });
        const cHex = document.createElement("input");
        cHex.type = "text"; cHex.value = nameColor || getWOSAIVar('--ws-accent');
        Object.assign(cHex.style, {
            flex: "1", minWidth: "0", padding: "var(--ws-input-padding)", fontSize: "var(--ws-text-sm)",
            background: "var(--ws-input-bg)", border: "var(--ws-border-width-thin) solid var(--ws-input-border)",
            borderRadius: "var(--ws-radius)", color: "var(--ws-input-text)",
            outline: "none", boxSizing: "border-box",
            fontFamily: "var(--ws-font-mono)",
        });
        cInput.addEventListener("input", () => { cHex.value = cInput.value.toUpperCase(); applyAll(); });
        cHex.addEventListener("input", () => {
            const v = cHex.value.toUpperCase();
            cHex.value = v;
            if (/^#[0-9A-F]{6}$/.test(v)) { cInput.value = v; applyAll(); }
        });
        tcRow.valWrap.appendChild(cInput);
        tcRow.valWrap.appendChild(cHex);
        pop.appendChild(tcRow.row);

        /* ── 一键恢复默认参数 ───────────────── */
        function resetAll() {
            // 1) 复位全部状态变量到出厂默认
            filter    = "";
            mode      = "default";
            active    = null;
            activeSet = null;
            nameColor = null;
            igDisable = false;
            sortOrder = "position";
            colorFilter = "none";
            igScale   = 1;
            // 2) 复位 UI 临时变量
            uiDisable = false;
            uiSort    = "position";
            uiMode    = "default";
            // 3) 同步控件显示到默认
            fInput.value = "";
            cFilter = "none"; updateColorPreview();
            const accent = getWOSAIVar('--ws-accent');
            cInput.value = accent; cHex.value = accent.toUpperCase();
            zSlider.value = "1"; zVal.textContent = Number(1).toFixed(1) + "×";
            dSeg.setActive(false);       // 控制器 → 绕过
            sSeg.setActive("position");  // 排序 → 按位置
            // 4) 实时缩放复位
            _applyScale();
            // 5) 应用并持久化（nameColor 取默认强调色，视觉等价于初始 null）
            applyAll();
        }

        /* 底部操作按钮：重置（一键恢复默认）/ 确认（关闭面板） */
        const actions = document.createElement("div");
        actions.className = "wosai-ig-actions";
        const resetBtn = document.createElement("button");
        resetBtn.className = "wosai-ig-action-btn";
        resetBtn.textContent = t('common.reset');
        resetBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
        resetBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); resetAll(); });
        const confirmBtn = document.createElement("button");
        confirmBtn.className = "wosai-ig-action-btn primary";
        confirmBtn.textContent = t('common.confirm');
        confirmBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
        confirmBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); closePopup(); });
        actions.appendChild(resetBtn);
        actions.appendChild(confirmBtn);
        pop.appendChild(actions);

        /* 底部版权 */
        const footer = document.createElement("div");
        footer.textContent = WOSAI_COPYRIGHT;
        Object.assign(footer.style, {
            padding: "var(--ws-gap-xs) 0 0", flexShrink: "0",
            textAlign: "center", whiteSpace: "nowrap",
            color: "var(--ws-text-muted)", fontSize: "var(--ws-text-xs)",
            letterSpacing: "var(--ws-ig-footer-letter-spacing)",
        });
        pop.appendChild(footer);

        document.body.appendChild(pop);
        const canvas = app.canvas;
        if (canvas?.canvas && node) {
            pop.style.transform = "";
            const gap = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--ws-ig-popup-gap')) || 14;
            _followCleanup = registerSelectionFollower(pop, {
                placement: "side",
                gap,
                targets: [node],
                canvas,
            });
        } else {
            pop.style.left = Math.min(x, innerWidth - 300) + "px";
            pop.style.top = Math.min(y, innerHeight - 580) + "px";
        }
        fInput.focus();
        pop.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); });
    }

    node._wosaiShowSettings = showSettings;

    /* ── graph.change 拦截（全局单例，避免叠加包装） ─────── */
    if (!_igGraphChangeHooked && app.graph) {
        _igGraphChangeHooked = true;
        _igOrigGraphChange = app.graph.change || null;
        if (_igOrigGraphChange) {
            app.graph.change = function () {
                _igActiveNodes.forEach(n => { if (!n._igSelfChanging) n._igDirty = true; });
                return _igOrigGraphChange.apply(this, arguments);
            };
        }
    }
    node._igDirty = true;
    node._igSelfChanging = false;
    _igActiveNodes.add(node);

    function onKeyDown(e) {
        if ((e.ctrlKey || e.metaKey) &&
            (e.key === "m" || e.key === "b" || e.key === "M" || e.key === "B")) {
            setTimeout(() => { dirty = true; }, 100);
        }
    }
    document.addEventListener("keydown", onKeyDown);

    let pageVisible = !document.hidden;
    function onVisibilityChange() {
        const nowVisible = !document.hidden;
        if (nowVisible && !pageVisible) { pageVisible = true; dirty = true; }
        else { pageVisible = nowVisible; }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    /* ── 刷新逻辑 ────────────────────────────────────────── */
    function refresh(forceApply) {
        const cachedAll = rawGroups(true);

        const list = visible(cachedAll);
        const currentVisibleTitles = new Set(list.map(g => g.key));
        const sig  = list.map(g => g.key).join("\x00");
        const listChanged = (sig !== lastSig);
        lastSig = sig;

        let stateChanged = false;

        if (mode === "default") {
            if (!Array.isArray(activeSet)) {
                activeSet = [];
                cachedAll.forEach(g => {
                    const gs = getGroupState(g, cachedAll);
                    if (gs !== false) {
                        activeSet.push(g.key);
                    }
                });
                stateChanged = true;
            } else {
                const allKeys = new Set(cachedAll.map(g => g.key));
                const before = activeSet.length;
                activeSet = activeSet.filter(t => allKeys.has(t));
                if (activeSet.length !== before) stateChanged = true;

                if (listChanged) {
                    list.forEach(g => {
                        if (!prevVisibleTitles.has(g.key)) {
                            const gs = getGroupState(g, cachedAll);
                            const idx = activeSet.indexOf(g.key);
                            if (gs === true && idx < 0) {
                                activeSet.push(g.key);
                                stateChanged = true;
                            } else if (gs === false && idx >= 0) {
                                activeSet.splice(idx, 1);
                                stateChanged = true;
                            }
                        }
                    });
                }
            }
        } else {
            if (!_preserveActive) {
                const hasFilter = !!(filter.trim() || (colorFilter && colorFilter !== "none"));

                if (active && !cachedAll.some(g => g.key === active)) {
                    active = (mode === "always_one" && list.length) ? list[0].key : null;
                    stateChanged = true;
                }

                if (active && hasFilter) {
                    const filteredKeys = new Set(list.map(g => g.key));
                    if (!filteredKeys.has(active)) {
                        if (mode === "always_one" && list.length) {
                            active = list[0].key;
                        } else {
                            active = null;
                        }
                        stateChanged = true;
                    }
                }

                if (mode === "always_one" && !active && list.length) {
                    active = list[0].key;
                    stateChanged = true;
                }
            }
        }

        _preserveActive = false;
        if (stateChanged) save();

        if (forceApply || stateChanged || listChanged) {
            node._igSelfChanging = true;
            try {
                list.forEach(g => {
                    const isOn = mode === "default"
                        ? activeSet.includes(g.key)
                        : g.key === active;
                    if (isOn) restoreGroup(g, cachedAll);
                    else      bypassGroup(g, cachedAll);
                });
                try { app.graph.change(); } catch (_) {}
            } finally {
                node._igSelfChanging = false;
            }
        }

        prevVisibleTitles = currentVisibleTitles;

        // 同步 stateSig，防止轮询误判状态变化导致 syncExternalState 覆盖用户操作
        lastStateSig = computeStateSig(list, cachedAll);

        buildDom(forceApply || stateChanged || listChanged);
    }

    /* ── 轮询刷新 ────────────────────────────────────────── */
    let timer = setInterval(() => {
        if (!node.graph) {
            cleanupNode();
            return;
        }

        if (!app.graph || !app.graph._nodes || app.graph._nodes.indexOf(node) < 0) return;

        if (!pageVisible) return;

        if (dirty) {
            dirty = false;
            const cachedAll = rawGroups(true);
            const list = visible(cachedAll);
            const sig = list.map(g => g.key).join("\x00");
            const listChanged = (sig !== lastSig);
            const stateSig = computeStateSig(list, cachedAll);
            const stateChanged = (stateSig !== lastStateSig);

            if (listChanged || stateChanged) {
                lastStateSig = stateSig;
                node._igSelfChanging = true;
                try {
                    const syncChanged = syncExternalState(cachedAll);
                    if (listChanged || syncChanged) {
                        refresh(true);
                    } else {
                        buildDom(true);
                    }
                    try { app.graph.change(); } catch (_) {}
                } finally {
                    node._igSelfChanging = false;
                }
            }
        }
    }, 500);

    function cleanupNode() {
        if (timer) { clearInterval(timer); timer = null; }
        if (_offLangChange) { _offLangChange(); }
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        _igActiveNodes.delete(node);
        _igNodeCleanup.delete(node);
        if (node._wosaiShowSettings) {
            const ov = document.getElementById("wosai_ig_overlay");
            const pp = document.getElementById("wosai_ig_pop");
            if (ov) ov.remove();
            if (pp) pp.remove();
        }
        if (_origNodeComputeSize) node.computeSize = _origNodeComputeSize;
        if (domWidget && _origWidgetComputeSize) domWidget.computeSize = _origWidgetComputeSize;
        if (_igResizeObserver) { _igResizeObserver.disconnect(); _igResizeObserver = null; }
        _igObservedHost = null;
    }
    node._wosaiCleanup = cleanupNode;
    /* 暴露 _applyScale 给顶层 _igPatchNodeDOM 调用：
       节点 body DOM（Vue）真正挂载后需补算一次尺寸，
       因 isNodes20Mode() 已收窄到本节点自身探测，
       首次 onNodeCreated 同步阶段必然返回 false（Vue 未就绪）。 */
    node._wosaiReapplyScale = _applyScale;
    _igNodeCleanup.set(node, cleanupNode);

    refresh(false);
    lastStateSig = computeStateSig(visible());
    dirty = false;

    _igEnsureMinimumSize();

    requestAnimationFrame(() => { rootEl.style.visibility = "visible"; });
}

/* ════════════════════════════════════════════════════════════════
   Nodes 2.0 兼容：DOM 覆盖层透明化 + 版标清理
   ════════════════════════════════════════════════════════════════ */
const _IG_TYPE    = "WOSAI_IgnoreGroups";
const _IG_TITLE   = t("nodes.ignoreGroups.nodeTitle", "IgnoreGroups");
const _IG_DOM_PREFIX = "wosai-ig-node";

(function () {
    _igStyleEl = document.createElement("style");
    _igStyleEl.id = "wosai-ig-nodes2-compat";
    _igStyleEl.textContent = `
        /* Nodes 2.0 覆盖层透明化 —— 让 DOM Widget 内容可见 */
        [data-testid^="node-body-"].${_IG_DOM_PREFIX}-body {
            background: transparent !important;
            background-color: transparent !important;
        }
        /* 确保内容区域不遮挡 widget */
        [data-testid^="node-body-"].${_IG_DOM_PREFIX}-body > div:not(header):not(.comfy-node-header):not(.wosai-ig) {
            background: transparent !important;
            min-height: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
        }
    `;
    document.head.appendChild(_igStyleEl);
})();

function _igPatchNodeDOM(node) {
    if (!node || node.type !== _IG_TYPE) return;
    const el = document.querySelector(`[data-testid="node-body-${node.id}"]`);
    if (!el) { setTimeout(() => _igPatchNodeDOM(node), 80); return; }
    el.classList.add(_IG_DOM_PREFIX + "-body");
    /* 节点 body DOM（Vue）已就绪 → isNodes20Mode() 现在会返回 true。
       补算一次尺寸，使首次加载与 recreate 最终收敛到同一结果。 */
    node._wosaiReapplyScale?.();
}

function _igPatchAllNodeDOMs() {
    if (!app.graph) return;
    app.graph._nodes?.forEach(n => { if (n.type === _IG_TYPE) _igPatchNodeDOM(n); });
}

function _igRemoveBadges() {
    /* 只移除版本号角标（文字角标），保留输入/输出端口圆点角标 */
    const selectors = [
        /* Nodes 2.0 版标 */
        `[data-testid="node-badge"]`, `.node-badge`,
        `[class*="node-badge"]`, `[class*="node_badge"]`,
        /* ComfyUI 原生版标 */
        `.comfy-node-badge`,
    ];
    document.querySelectorAll(selectors.join(",")).forEach(el => {
        const text = (el.textContent || "").trim();
        if (text.includes(_IG_TITLE) || text.includes("WOSAI") ||
            text.includes(t("nodes.ignoreGroups.shortTitle", "Ignore")) || text.includes("IgnoreGroups")) {
            el.remove();
        }
    });
}

if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    _igDomObs = new MutationObserver((mutations) => {
        let _needBadgeCleanup = false;
        for (const m of mutations) {
            for (const added of m.addedNodes) {
                if (added.nodeType !== 1) continue;
                const tid = added.dataset?.testid || added.dataset?.testId || "";
                if (tid.startsWith("node-body-")) {
                    const match = tid.match(/node-body-(\d+)/);
                    if (!match) continue;
                    const n = app.graph?.getNodeById(parseInt(match[1]));
                    if (n && n.type === _IG_TYPE) added.classList.add(_IG_DOM_PREFIX + "-body");
                    _needBadgeCleanup = true;
                }
                added.querySelectorAll?.('[data-testid^="node-body-"]').forEach(childEl => {
                    const cTid = childEl.dataset?.testId || childEl.dataset?.testid || "";
                    const cMatch = cTid.match(/node-body-(\d+)/);
                    if (!cMatch) return;
                    const cn = app.graph?.getNodeById(parseInt(cMatch[1]));
                    if (cn && cn.type === _IG_TYPE) childEl.classList.add(_IG_DOM_PREFIX + "-body");
                    _needBadgeCleanup = true;
                });
            }
        }
        /* 仅在有节点 body 变化时才清理版标，避免每次 DOM 变化都全量查询 */
        if (_needBadgeCleanup) _igRemoveBadges();
    });
    if (document.body) _igDomObs.observe(document.body, { childList: true, subtree: true });
}

[200, 800, 2000].forEach(d => _igInitialPatchTimers.push(setTimeout(() => { _igPatchAllNodeDOMs(); _igRemoveBadges(); }, d)));

/* ════════════════════════════════════════════════════════════════
   扩展注册
   ════════════════════════════════════════════════════════════════*/

app.registerExtension({
    name: "wosai.ignoreGroups",

    /* 节点创建后修补 DOM */
    nodeCreated(node) {
        if (node.type === _IG_TYPE) {
            requestAnimationFrame(() => _igPatchNodeDOM(node));
            /* 延迟清理版标（Nodes 2.0 可能延迟注入） */
            node._wosaiBadgeTimers = [];
            [300, 1000, 3000].forEach(d => node._wosaiBadgeTimers.push(setTimeout(() => _igRemoveBadges(), d)));
        }
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        // 为所有 WOSAI 节点注入 display_name 翻译（当前语言）
        if (nodeData?.name?.startsWith("WOSAI_")) {
            applyNodeDefTranslation(nodeData);
        }
        if (nodeData.name !== "WOSAI_IgnoreGroups") return;
        _igNodeType = nodeType;

        _igOrigOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            _igOrigOnNodeCreated?.apply(this, arguments);
            /* Nodes 2.0（ComfyUI v10）：title_mode / collapsable 等可能为只读，
               裸赋值会抛 TypeError 并中断节点创建，导致前端加载不出来。
               逐项 try 包裹，确保 buildWosaiIgnoreGroupsUI 始终执行；
               标题隐藏另有 drawNodeTitle 拦截 + DOM CSS 兜底。 */
            try { this.collapsable = false; } catch (_) {}
            try { this.size = [400, (this.size && this.size[1]) || 200]; } catch (_) {}
            try { buildWosaiIgnoreGroupsUI(this); } catch (e) { console.error("[WOSAI IgnoreGroups] UI 构建失败:", e); }
        };

        /* 持久化：保存时确保 properties 已写入 */
        _igOrigOnSerialize = nodeType.prototype.onSerialize;
        nodeType.prototype.onSerialize = function (serializedNode) {
            _igOrigOnSerialize?.apply(this, arguments);
            /* save() 已写入 node.properties，此处无需额外操作
               ComfyUI 会自动序列化 node.properties */
        };

        /* 恢复：从 properties 读回状态 */
        _igOrigOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            _igOrigOnConfigure?.apply(this, arguments);
            if (this._wosaiSyncGroups) this._wosaiSyncGroups();
        };

        /* 改名为 getWosaiShortcut，避免覆盖 LiteGraph 内置 getShortcut */
        nodeType.prototype.getWosaiShortcut = function () {
            try {
                const stored = localStorage.getItem(STORAGE_KEYS.igShortcut);
                if (stored) return JSON.parse(stored);
            } catch (e) {}
            return { key: "i", ctrl: true, alt: false, shift: false, meta: false };
        };

        nodeType.prototype.saveShortcut = function (shortcut) {
            localStorage.setItem(STORAGE_KEYS.igShortcut, JSON.stringify(shortcut));
        };

        /* 节点删除时清理资源，防止内存泄漏 */
        _igOrigOnRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            _igOrigOnRemoved?.apply(this, arguments);
            _igActiveNodes.delete(this);
            /* 关闭可能打开的设置弹窗并清理监听器/定时器 */
            if (this._wosaiCleanup) { try { this._wosaiCleanup(); } catch (e) { console.warn('[IgnoreGroups] cleanup error:', e); } this._wosaiCleanup = null; }
            const timers = this._wosaiBadgeTimers;
            if (timers) { timers.forEach(id => clearTimeout(id)); this._wosaiBadgeTimers = null; }
        };
    },

    /* 全局设置：监听分组增删，自动触发节点刷新 */
    async setup() {
        function hookGraph() {
            if (!app.graph) { _igSetupTimer = setTimeout(hookGraph, 200); return; }
            /* 防止重复 hook（热重载场景） */
            if (app.graph._wosaiIgHooked) return;
            app.graph._wosaiIgHooked = true;

            _igOrigAddGroup = app.graph.addGroup || null;
            if (_igOrigAddGroup) {
                app.graph.addGroup = function (...args) {
                    const result = _igOrigAddGroup.apply(this, args);
                    _igRefreshAllNodes();
                    return result;
                };
            }
            _igOrigRemoveGroup = app.graph.removeGroup || null;
            if (_igOrigRemoveGroup) {
                app.graph.removeGroup = function (...args) {
                    const result = _igOrigRemoveGroup.apply(this, args);
                    _igRefreshAllNodes();
                    return result;
                };
            }
            /* 节点移动也可能导致分组成员变化，防抖 500ms */
            let _moveTimer = null;
            _igOrigOnNodeMoved = app.graph.onNodeMoved || null;
            app.graph.onNodeMoved = function (node) {
                if (_igOrigOnNodeMoved) _igOrigOnNodeMoved.call(this, node);
                if (_moveTimer) clearTimeout(_moveTimer);
                _moveTimer = setTimeout(() => _igRefreshAllNodes(), 500);
            };
        }
        hookGraph();
    },

    /* 扩展禁用时清理所有全局资源与 monkey-patch */
    remove() {
        if (_igSetupTimer) { clearTimeout(_igSetupTimer); _igSetupTimer = null; }

        _igNodeCleanup.forEach((cleanup) => { try { cleanup(); } catch (_) {} });
        _igNodeCleanup.clear();
        _igActiveNodes.clear();

        if (app.graph) {
            if (_igOrigGraphChange != null) app.graph.change = _igOrigGraphChange;
            if (_igOrigAddGroup != null) app.graph.addGroup = _igOrigAddGroup;
            if (_igOrigRemoveGroup != null) app.graph.removeGroup = _igOrigRemoveGroup;
            if (_igOrigOnNodeMoved != null) app.graph.onNodeMoved = _igOrigOnNodeMoved;
            app.graph._wosaiIgHooked = false;
        }
        _igGraphChangeHooked = false;
        _igOrigGraphChange = null;
        _igOrigAddGroup = null;
        _igOrigRemoveGroup = null;
        _igOrigOnNodeMoved = null;

        if (_igNodeType) {
            if (_igOrigOnNodeCreated != null) _igNodeType.prototype.onNodeCreated = _igOrigOnNodeCreated;
            if (_igOrigOnSerialize != null) _igNodeType.prototype.onSerialize = _igOrigOnSerialize;
            if (_igOrigOnConfigure != null) _igNodeType.prototype.onConfigure = _igOrigOnConfigure;
            if (_igOrigOnRemoved != null) _igNodeType.prototype.onRemoved = _igOrigOnRemoved;
            delete _igNodeType.prototype.getWosaiShortcut;
            delete _igNodeType.prototype.saveShortcut;
            _igNodeType = null;
        }
        _igOrigOnNodeCreated = null;
        _igOrigOnSerialize = null;
        _igOrigOnConfigure = null;
        _igOrigOnRemoved = null;

        if (_igDomObs) { _igDomObs.disconnect(); _igDomObs = null; }
        if (_igStyleEl && _igStyleEl.parentNode) { _igStyleEl.parentNode.removeChild(_igStyleEl); }
        _igStyleEl = null;

        _igInitialPatchTimers.forEach(id => clearTimeout(id));
        _igInitialPatchTimers.length = 0;
    },
});

/* 触发所有 IgnoreGroups 节点刷新 */
function _igRefreshAllNodes() {
    if (!app.graph) return;
    app.graph._nodes?.forEach(n => {
        if (n.type === _IG_TYPE && n._wosaiSyncGroups) {
            n._wosaiSyncGroups();
        }
    });
}
