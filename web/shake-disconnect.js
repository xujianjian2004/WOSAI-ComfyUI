// WOSAI 摇断连接（移植自 ComfyUI-KJNodes shake_to_disconnect.js）
// 拖动节点时快速来回抖动可断开其外部连线；被断开的上游会做绕过（bypass）重连，
// 多节点选中时节点之间的内部连线保留并向下游传播绕过。
// 注：KJNodes 中默认关闭；按 WOSAI 方案此处默认开启，并在 HUB 栏提供开关按钮。
import { app } from "../../../scripts/app.js";
import { quickToast } from "./shared/toast.js";
import { wosaiGetBool, wosaiGetInt, wosaiSetBool } from "./shared/wosai-prefs.js";
import { registerHubBarButton, unregisterHubBarButton } from "./hub-bar.js";
import { t } from "./shared/i18n.js";

const K = "wosai-shakeEnabled";      // 默认开
let _teardown = null;
const KR = "wosai-shakeReversals";   // 默认 3

const state = {
    pointerDown: false, lastDelta: [0, 0], lastPos: null,
    reversalTimes: [], lastScanTime: 0, triggered: false,
};

function getNodeAnchor(node) {
    return [node.pos[0], node.pos[1]];
}

function getDraggedNodes(lgCanvas) {
    const items = lgCanvas.selectedItems;
    if (!items || items.size === 0) return [];
    return [...items].filter(n => n.inputs || n.outputs);
}

function nodeHasLinks(node) {
    if (node.inputs?.some(i => i.link != null)) return true;
    if (node.outputs?.some(o => o.links?.length > 0)) return true;
    return false;
}

// 与直接删除节点的效果相同，但保留选中节点之间的内部连线
function executeShakeBreak(draggedNodes, graph, lgCanvas) {
    if (draggedNodes.length === 0) return;
    const selectedIds = new Set(draggedNodes.map(n => n.id));
    lgCanvas.emitBeforeChange?.();
    graph.beforeChange?.();
    try {
        for (const node of draggedNodes) bypassExternal(node, selectedIds, graph);
        for (const node of draggedNodes) disconnectExternal(node, selectedIds, graph);
    } finally {
        graph.afterChange?.();
        lgCanvas.emitAfterChange?.();
    }
    lgCanvas.setDirty(true, true);
    state.triggered = true;
    state.reversalTimes = [];
}

function bypassExternal(node, selectedIds, graph) {
    const inputs = node.inputs || [];
    for (let i = 0; i < inputs.length; i++) {
        if (inputs[i].link == null) continue;
        const inLink = graph.getLink(inputs[i].link);
        if (!inLink || selectedIds.has(inLink.origin_id)) continue;
        const inNode = graph.getNodeById(inLink.origin_id);
        if (!inNode) continue;
        traceAndBypass(node, i, inNode, inLink, selectedIds, graph, new Set());
    }
}

// 每一步沿 output[slot]（即我们到达的 input slot 对应的输出）追踪；
// 内部目标递归，外部目标做「上游 → 目标」直连。
function traceAndBypass(currentNode, slot, inNode, inLink, selectedIds, graph, visited) {
    const key = `${currentNode.id}:${slot}`;
    if (visited.has(key)) return;
    visited.add(key);
    const output = currentNode.outputs?.[slot];
    if (!output?.links?.length) return;
    for (const outLinkId of [...output.links]) {
        const outLink = graph.getLink(outLinkId);
        if (!outLink) continue;
        if (selectedIds.has(outLink.target_id)) {
            const nextNode = graph.getNodeById(outLink.target_id);
            if (nextNode) traceAndBypass(nextNode, outLink.target_slot, inNode, inLink, selectedIds, graph, visited);
        } else {
            const outNode = graph.getNodeById(outLink.target_id);
            if (outNode) inNode.connect(inLink.origin_slot, outNode, outLink.target_slot, inLink.parentId);
        }
    }
}

function disconnectExternal(node, selectedIds, graph) {
    if (node.inputs) {
        for (let i = 0; i < node.inputs.length; i++) {
            const linkId = node.inputs[i].link;
            if (linkId == null) continue;
            const link = graph.getLink(linkId);
            if (!link || selectedIds.has(link.origin_id)) continue;
            node.disconnectInput(i, true);
        }
    }
    if (node.outputs) {
        for (let o = 0; o < node.outputs.length; o++) {
            const links = node.outputs[o].links;
            if (!links?.length) continue;
            for (const linkId of [...links]) {
                const link = graph.getLink(linkId);
                if (!link || selectedIds.has(link.target_id)) continue;
                const targetNode = graph.getNodeById(link.target_id);
                if (targetNode) targetNode.disconnectInput(link.target_slot, true);
            }
        }
    }
}

function clearState() {
    state.pointerDown = false;
    state.lastDelta = [0, 0];
    state.lastPos = null;
    state.reversalTimes = [];
    state.lastScanTime = 0;
    state.triggered = false;
}

function isEnabled() { return wosaiGetBool(K, true); }
function getReversals() { const v = wosaiGetInt(KR, 3); return v >= 2 && v <= 6 ? v : 3; }

window.__wosaiToggleShake = function () {
    const next = !wosaiGetBool(K, true);
    wosaiSetBool(K, next);
    quickToast(next ? t('menus.hubBar.shakeOn') : t('menus.hubBar.shakeOff'));
};

app.registerExtension({
    name: "WOSAI.ShakeToDisconnect",
    setup() {
        if (_teardown) return;
        const lgCanvas = app.canvas;
        const canvasEl = lgCanvas.canvas;
        const onPointerDown = (e) => {
            if (e.button !== 0) return;
            const onCanvas = e.target === canvasEl;
            const onVueNode = e.target?.closest?.("[data-node-id]");
            if (!onCanvas && !onVueNode) return;
            state.pointerDown = true;
            state.lastDelta = [0, 0];
            state.lastPos = null;
            state.reversalTimes = [];
            state.triggered = false;
        };
        const onPointerMove = () => {
            if (!state.pointerDown) return;
            if (state.triggered) return;
            if (lgCanvas.connecting_links?.length) return;
            if (lgCanvas.resizing_node) return;
            if (lgCanvas.node_widget) return;
            if (!isEnabled()) return;
            const graph = lgCanvas.graph || app.graph;
            if (!graph) return;
            const now = performance.now();
            const nodeCount = graph._nodes?.length ?? 0;
            const throttle = nodeCount > 200 ? 50 : nodeCount > 100 ? 32 : 16;
            if (now - state.lastScanTime < throttle) return;
            state.lastScanTime = now;
            const draggedNodes = getDraggedNodes(lgCanvas);
            if (draggedNodes.length === 0) return;
            const curPos = getNodeAnchor(draggedNodes[0]);
            if (state.lastPos) {
                const scale = lgCanvas.ds?.scale ?? 1;
                const sdx = (curPos[0] - state.lastPos[0]) * scale;
                const sdy = (curPos[1] - state.lastPos[1]) * scale;
                const dot = sdx * state.lastDelta[0] + sdy * state.lastDelta[1];
                const magnitude = Math.sqrt(sdx * sdx + sdy * sdy);
                if (dot < 0 && magnitude > 5) state.reversalTimes.push(now);
                if (magnitude > 2) state.lastDelta = [sdx, sdy];
            }
            state.lastPos = curPos;
            const cutoff = now - 600;
            while (state.reversalTimes.length && state.reversalTimes[0] < cutoff) state.reversalTimes.shift();
            if (state.reversalTimes.length >= getReversals() && draggedNodes.some(nodeHasLinks)) {
                executeShakeBreak(draggedNodes, graph, lgCanvas);
            }
        };
        const onPointerUp = (e) => {
            if (e.button !== 0) return;
            clearState();
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("pointermove", onPointerMove, true);
        document.addEventListener("pointerup", onPointerUp, true);
        _teardown = () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("pointermove", onPointerMove, true);
            document.removeEventListener("pointerup", onPointerUp, true);
            clearState();
        };
    },
    remove() {
        _teardown?.();
        _teardown = null;
        unregisterHubBarButton("shake");
        delete window.__wosaiToggleShake;
    },
});

// ── HUB 栏开关按钮 ──
registerHubBarButton({
    id: "shake",
    group: "node",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg>',
    labelKey: "menus.hubBar.shake",
    tipKey: "menus.hubBar.tips.shake",
    selectionToolbox: false,
    toggle: true,
    getActive: () => wosaiGetBool(K, true),
    onClick: () => window.__wosaiToggleShake(),
});
