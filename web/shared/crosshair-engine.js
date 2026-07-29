// ── WOSAI 实时对齐参考线引擎 CrosshairEngine（纯函数，无 ComfyUI/DOM，可单测）──
//   拖动某节点时，将其 左/中/右 与其它节点的 左/中/右 比对（垂直线），
//   上/中/下 同理（水平线）；在阈值内即生成参考线，并给出最近吸附位移。
//   computeGuides(drag, others, threshold) →
//     { vLines:[x...], hLines:[y...], snapDX, snapDY }
//   - vLines/hLines：应绘制参考线的图坐标位置（其它节点的对齐锚点）
//   - snapDX/DY：把 drag 平移该量即吸附到最近参考线（无则 0）
//   盒：{ x, y, w, h }（左上角 + 宽高）

export function computeGuides(drag, others, threshold = 5) {
    const empty = { vLines: [], hLines: [], snapDX: 0, snapDY: 0 };
    if (!drag || !Array.isArray(others) || !others.length) return empty;

    // drag 的三锚点
    const dX = [drag.x, drag.x + drag.w / 2, drag.x + drag.w];   // 左/中/右
    const dY = [drag.y, drag.y + drag.h / 2, drag.y + drag.h];   // 上/中/下

    const vSet = new Set(), hSet = new Set();
    let bestX = null, bestY = null;   // { pos, delta }

    for (const o of others) {
        if (!o) continue;
        const oX = [o.x, o.x + o.w / 2, o.x + o.w];
        const oY = [o.y, o.y + o.h / 2, o.y + o.h];
        for (const d of dX) for (const a of oX) {
            const diff = a - d;
            if (Math.abs(diff) <= threshold) {
                vSet.add(a);
                if (!bestX || Math.abs(diff) < Math.abs(bestX.delta)) bestX = { pos: a, delta: diff };
            }
        }
        for (const d of dY) for (const a of oY) {
            const diff = a - d;
            if (Math.abs(diff) <= threshold) {
                hSet.add(a);
                if (!bestY || Math.abs(diff) < Math.abs(bestY.delta)) bestY = { pos: a, delta: diff };
            }
        }
    }
    return {
        vLines: [...vSet],
        hLines: [...hSet],
        snapDX: bestX ? bestX.delta : 0,
        snapDY: bestY ? bestY.delta : 0,
    };
}
