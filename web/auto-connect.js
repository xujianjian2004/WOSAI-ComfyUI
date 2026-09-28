/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 本文件是 ComfyUI-KJNodes 的衍生作品，按 GNU GPL v3.0 或更新版本授权，
 * 不适用本项目根 LICENSE 的 MIT 条款。
 *   原始项目：ComfyUI-KJNodes
 *   原始作者：kijai
 *   原始文件：web/js/fillconnect.js
 *   原始仓库：https://github.com/kijai/ComfyUI-KJNodes
 * 完整条款见项目根 LICENSE-GPL-3.0；完整署名见 THIRD-PARTY-NOTICES.md。
 */
// WOSAI 自动连点（移植自 ComfyUI-KJNodes fillconnect.js）
// 选中多个节点后，按类型兼容性 + 空间距离智能连线（拓扑排序保证上游在前）。
import { app } from "../../../scripts/app.js";
import { quickToast } from "./shared/toast.js";
import { getSlotPos } from "./shared/graph-utils.js";
import { wosaiGetBool } from "./shared/wosai-prefs.js";
import { registerHubBarButton } from "./hub-bar.js";
import { t } from "./shared/i18n.js";

const K = "wosai-autoConnect"; // 默认开

// 类型匹配层级：2=精确单类型，1=多类型/通配，-1=不兼容
function typeMatchTier(outType, inType) {
    if (!LiteGraph.isValidConnection(outType, inType)) return -1;
    if (typeof outType === "string" && typeof inType === "string"
        && !outType.includes(",") && !inType.includes(",")
        && outType.toUpperCase() === inType.toUpperCase()) return 2;
    return 1;
}

// 拓扑排序选中节点（尊重已有连线方向），其余按空间位置（左→右、上→下）插入
function orderNodes(nodes, graph) {
    const selectedIds = new Set(nodes.map(n => n.id));
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const outEdges = new Map();
    const inDegree = new Map();
    for (const n of nodes) {
        outEdges.set(n.id, new Set());
        inDegree.set(n.id, 0);
    }
    for (const node of nodes) {
        for (const out of (node.outputs || [])) {
            for (const linkId of (out.links || [])) {
                const link = graph.getLink(linkId);
                if (link && selectedIds.has(link.target_id) && link.target_id !== node.id) {
                    if (!outEdges.get(node.id).has(link.target_id)) {
                        outEdges.get(node.id).add(link.target_id);
                        inDegree.set(link.target_id, inDegree.get(link.target_id) + 1);
                    }
                }
            }
        }
    }
    const bySpatial = (a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1];
    const queue = nodes.filter(n => inDegree.get(n.id) === 0);
    queue.sort(bySpatial);
    const ordered = [];
    while (queue.length > 0) {
        const node = queue.shift();
        ordered.push(node);
        for (const targetId of outEdges.get(node.id)) {
            const deg = inDegree.get(targetId) - 1;
            inDegree.set(targetId, deg);
            if (deg === 0 && nodeById.has(targetId)) {
                queue.push(nodeById.get(targetId));
                queue.sort(bySpatial);
            }
        }
    }
    if (ordered.length < nodes.length) {
        const inOrdered = new Set(ordered.map(n => n.id));
        const remaining = nodes.filter(n => !inOrdered.has(n.id));
        remaining.sort(bySpatial);
        ordered.push(...remaining);
    }
    return ordered;
}

// 收集所有候选连接，按最接近 2D 距离全局贪心分配；每个输入/输出每次调用最多用一次
function planConnections(ordered) {
    const candidates = [];
    for (let b = 1; b < ordered.length; b++) {
        const nodeB = ordered[b];
        if (!nodeB.inputs) continue;
        for (let inIdx = 0; inIdx < nodeB.inputs.length; inIdx++) {
            const inp = nodeB.inputs[inIdx];
            if (inp.link != null) continue;
            const inPos = getSlotPos(nodeB, true, inIdx);
            const inputCandidates = [];
            let hasExact = false;
            const inName = (inp.name || inp.label || "").toLowerCase();
            for (let a = b - 1; a >= 0; a--) {
                const nodeA = ordered[a];
                if (!nodeA.outputs) continue;
                for (let outIdx = 0; outIdx < nodeA.outputs.length; outIdx++) {
                    const out = nodeA.outputs[outIdx];
                    const tier = typeMatchTier(out.type, inp.type);
                    if (tier < 0) continue;
                    if (tier === 2) hasExact = true;
                    const outName = (out.name || out.label || "").toLowerCase();
                    const nameMatch = inName !== "" && inName === outName ? 1 : 0;
                    const outPos = getSlotPos(nodeA, false, outIdx);
                    const dx = outPos[0] - inPos[0];
                    const dy = outPos[1] - inPos[1];
                    inputCandidates.push({
                        targetNode: nodeB, inIdx, sourceNode: nodeA, outIdx,
                        tier, nameMatch, dist: dx * dx + dy * dy,
                    });
                }
            }
            for (const c of inputCandidates) c.hasExact = hasExact;
            candidates.push(...inputCandidates);
        }
    }
    const filtered = candidates.filter(c => c.tier === 2 || c.nameMatch || !c.hasExact);
    filtered.sort((x, y) => (y.nameMatch - x.nameMatch) || (y.tier - x.tier) || (x.dist - y.dist));
    const planned = [];
    const usedInputs = new Set();
    const usedOutputs = new Set();
    for (const c of filtered) {
        const inKey = `${c.targetNode.id}:${c.inIdx}`;
        if (usedInputs.has(inKey)) continue;
        const outKey = `${c.sourceNode.id}:${c.outIdx}`;
        if (usedOutputs.has(outKey)) continue;
        planned.push({ sourceNode: c.sourceNode, outIdx: c.outIdx, targetNode: c.targetNode, inIdx: c.inIdx });
        usedInputs.add(inKey);
        usedOutputs.add(outKey);
    }
    return planned;
}

function connectPlanned(planned, graph) {
    for (const p of planned) p.sourceNode.connect(p.outIdx, p.targetNode, p.inIdx);
    graph.change();
}

// 对当前选中节点执行自动连线（HUB 栏按钮入口）
export function wosaiAutoConnectSelected() {
    if (!wosaiGetBool(K, true)) return;
    const canvas = app.canvas;
    if (!canvas) return;
    const graph = canvas.graph;
    const nodes = Object.values(canvas.selected_nodes || {});
    if (nodes.length < 2) { quickToast(t('menus.layoutToolkit.selectTwoOrMore')); return; }
    const ordered = orderNodes(nodes, graph);
    const planned = planConnections(ordered);
    if (planned.length > 0) connectPlanned(planned, graph);
    const msg = planned.length > 0
        ? t('menus.layoutToolkit.connectedCount').replace('{count}', String(planned.length))
        : t('menus.layoutToolkit.noCompatiblePorts');
    quickToast(msg);
}

window.__wosaiAutoConnect = wosaiAutoConnectSelected;

// ── HUB 栏按钮（放在速连旁）──
registerHubBarButton({
    id: "autoConnect",
    group: "node",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>',
    labelKey: "menus.hubBar.autoConnect",
    tipKey: "menus.hubBar.tips.autoConnect",
    selectionToolbox: ({ nodes }) => nodes.length >= 2,
    onClick: () => window.__wosaiAutoConnect(),
});
