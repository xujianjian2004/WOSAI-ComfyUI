// WOSAI 画布坐标 / 类型辅助。
// 移植自 ComfyUI-KJNodes web/js/utility.js 中的纯函数部分，重写为 WOSAI 风格，
// 供自动连点等多个画布扩展复用。

// 屏幕坐标 → 画布坐标
export function clientToCanvas(lgCanvas, clientX, clientY) {
    const rect = lgCanvas.canvas.getBoundingClientRect();
    return [
        (clientX - rect.left) / lgCanvas.ds.scale - lgCanvas.ds.offset[0],
        (clientY - rect.top) / lgCanvas.ds.scale - lgCanvas.ds.offset[1],
    ];
}

// 命中测试：返回包含 (cx,cy) 的最上层节点
export function getNodeAtPoint(graph, cx, cy) {
    for (let i = graph._nodes.length - 1; i >= 0; i--) {
        if (graph._nodes[i].isPointInside(cx, cy)) return graph._nodes[i];
    }
    return null;
}

// 类型兼容性（兼容 ComfyUI 的联合类型如 "STRING,INT"）
export function typesCompatible(a, b) {
    if (a === "*" || b === "*") return true;
    if (a === b) return true;
    if (typeof a !== "string" || typeof b !== "string") return false;
    if (a.toUpperCase() === b.toUpperCase()) return true;
    if (a.includes(",") || b.includes(",")) {
        const aTokens = a.toUpperCase().split(",").map(s => s.trim()).filter(Boolean);
        const bTokens = b.toUpperCase().split(",").map(s => s.trim()).filter(Boolean);
        if (aTokens.includes("*") || bTokens.includes("*")) return true;
        return aTokens.some(t => bTokens.includes(t));
    }
    return false;
}

// 取端口画布坐标（Vue 模式走 DOM 注册位置，经典画布走 getConnectionPos 兜底）
export function getSlotPos(node, isInput, slotIdx) {
    if (isInput && node.getInputPos) return node.getInputPos(slotIdx);
    if (!isInput && node.getOutputPos) return node.getOutputPos(slotIdx);
    const out = [0, 0];
    node.getConnectionPos(isInput, slotIdx, out);
    return out;
}
