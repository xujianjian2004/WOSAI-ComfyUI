// ========== WOSAI 画布共享工具 ==========
// 选中节点 / 分组检测 —— 统一实现，所有模块共享
// 由 color-bar.js / node-color.js / layout-toolkit.js / node-bookmark.js 共同引用

/**
 * 判断对象是否为分组（LGraphGroup）
 * 三路检测：instanceof → recomputeInsideNodes → constructor.name
 * @param {*} it
 * @returns {boolean}
 */
export function isGroupObj(it) {
    if (!it) return false;
    // LGraphGroup instanceof（最可靠，但 LiteGraph 未加载时可能抛异常）
    try { if (typeof LGraphGroup !== 'undefined' && it instanceof LGraphGroup) return true; } catch (e) {}
    // recomputeInsideNodes 方法（分组核心方法）
    if (typeof it.recomputeInsideNodes === 'function') return true;
    // 构造函数名兜底
    return it.constructor?.name === 'LGraphGroup';
}

/**
 * 读取 ComfyUI 宿主 app 实例。
 * 注意：本模块刻意不静态 import scripts/app.js（保持可单测 / 无宿主依赖），
 * 因此必须经 window 访问；裸引用 app 在不暴露该全局的宿主中会抛 ReferenceError，
 * 且 `app?.graph` 这类可选链也无法兜底未声明的标识符。
 * @returns {object|null}
 */
function resolveApp() {
    if (typeof window === "undefined") return null;
    return window.app || window.comfyAPI?.app?.app || null;
}

/**
 * 获取当前画布选中的节点（排除分组对象）
 * Classic + Nodes 2.0 双向兼容：
 *   selected_nodes → selectedItems(Set) → node.selected 标志 — 三路兜底去重
 * @param {object} [canvas] - app.canvas 引用（可选，默认读取当前画布）
 * @returns {Array} 选中节点数组
 */
function getActiveCanvas() {
    if (typeof window === "undefined") return null;
    return window.LGraphCanvas?.active_canvas || resolveApp()?.canvas || null;
}

export function getSelectedNodes(canvas = getActiveCanvas()) {
    const c = canvas; if (!c) return [];
    const out = new Map();
    const add = (n) => {
        if (n && n.id != null && n.pos && n.size && !isGroupObj(n)) out.set(n.id, n);
    };
    // 路径 1：旧版 selected_nodes
    if (c.selected_nodes) Object.values(c.selected_nodes).forEach(add);
    // 路径 2：新版 selectedItems（Set，含节点+分组+reroute）
    if (c.selectedItems && typeof c.selectedItems.forEach === 'function') c.selectedItems.forEach(add);
    // 路径 3：节点自身 selected 标志兜底
    const nodes = c.graph?._nodes || c.graph?.nodes || [];
    for (const n of nodes) if (n.selected || n.is_selected) add(n);
    return [...out.values()];
}

/**
 * 获取当前画布选中的分组框
 * 三路兼容：selectedItems → 分组 selected 标志 → selected_group 兜底
 * @returns {Array} 选中分组数组
 */
export function getSelectedGroups(canvas = getActiveCanvas()) {
    const c = canvas; if (!c) return [];
    const out = new Set();
    // 路径 1：新版 selectedItems（Set，含节点+分组+reroute）
    const items = c.selectedItems;
    if (items && typeof items.forEach === 'function') {
        items.forEach(it => { if (isGroupObj(it)) out.add(it); });
    }
    // 路径 2：分组对象自身的选中标志
    const groups = c.graph?._groups || c.graph?.groups || [];
    for (const g of groups) {
        if (g.selected || g._selected) out.add(g);
    }
    // 路径 3：画布最近交互的分组（部分版本点击分组标题只记录在这里）
    const sg = c.selected_group;
    if (out.size === 0 && sg && isGroupObj(sg) && groups.includes(sg)) out.add(sg);
    return [...out];
}

/**
 * 计算分组框内的所有节点（recomputeInsideNodes 不可用时回退到边界包含判断）
 * @param {object} g - LGraphGroup 实例
 * @returns {Array} 分组框内的节点数组
 */
export function getNodesInGroup(g) {
    try { g.recomputeInsideNodes?.(); } catch (_) {}
    const inside = g._nodes || g.nodes || [];
    if (inside.length) return inside;
    // 回退：手动计算边界包含
    const graph = resolveApp()?.graph;
    if (!graph || !g?.pos || !g?.size) return [];
    const all = graph._nodes || graph.nodes || [];
    const gx = g.pos[0], gy = g.pos[1], gw = g.size[0], gh = g.size[1];
    return all.filter(n => {
        if (!n?.pos || !n?.size) return false;
        const nx = n.pos[0], ny = n.pos[1], nw = n.size[0], nh = n.size[1];
        return nx >= gx && ny >= gy && nx + nw <= gx + gw && ny + nh <= gy + gh;
    });
}

/**
 * 计算弹窗吸附到选区左右外侧、并相对选区垂直居中的位置。
 * 两侧均可放置时优先选择可用空间更大的方向；空间不足时限制在视口内。
 * @param {number} panelW - 弹窗宽度
 * @param {number} panelH - 弹窗高度
 * @param {number} [gap=12] - 弹窗与节点之间的间距
 * @returns {{ x: number, y: number }} - 屏幕坐标（fixed 定位用）
 */
export function calcSnapToNodeSide(panelW, panelH, gap = 12, selectedNodes = null) {
    const c = resolveApp()?.canvas;
    if (!c?.ds || !c?.canvas) {
        return { x: (window.innerWidth - panelW) / 2, y: (window.innerHeight - panelH) / 2 };
    }
    const sel = Array.isArray(selectedNodes)
        ? selectedNodes.filter(n => n?.pos && n?.size)
        : [...(c.graph?._nodes || [])].filter(n => n.is_selected && n.pos && n.size);
    if (!sel.length) {
        return { x: (window.innerWidth - panelW) / 2, y: (window.innerHeight - panelH) / 2 };
    }
    const rect = c.canvas.getBoundingClientRect();
    const sc = c.ds.scale, ox = c.ds.offset[0], oy = c.ds.offset[1];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of sel) {
        const sx = rect.left + (n.pos[0] + ox) * sc;
        const sy = rect.top + (n.pos[1] + oy) * sc;
        const sw = n.size[0] * sc, sh = n.size[1] * sc;
        if (sx < minX) minX = sx;
        if (sy < minY) minY = sy;
        if (sx + sw > maxX) maxX = sx + sw;
        if (sy + sh > maxY) maxY = sy + sh;
    }
    const inset = 8;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const centerY = (minY + maxY) / 2 - panelH / 2;
    const maxPanelY = Math.max(inset, viewportH - panelH - inset);
    const clampedY = Math.max(inset, Math.min(centerY, maxPanelY));

    // 用选区最左/最右节点边缘计算两侧外部空间；两侧都够用时也选空间更大的那侧。
    const spaceRight = Math.max(0, viewportW - inset - maxX);
    const spaceLeft = Math.max(0, minX - inset);
    const preferRight = spaceRight >= spaceLeft;
    const desiredX = preferRight ? maxX + gap : minX - panelW - gap;
    const maxPanelX = Math.max(inset, viewportW - panelW - inset);
    const clampedX = Math.max(inset, Math.min(desiredX, maxPanelX));
    return { x: clampedX, y: clampedY };
}
