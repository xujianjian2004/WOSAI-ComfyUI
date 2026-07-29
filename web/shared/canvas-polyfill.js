// ========== Canvas API 兼容垫片 ==========
// 统一封装旧浏览器 / 测试环境中缺失的 Canvas 2D API。
// 本模块只操作传入的 2D context，不依赖 DOM / ComfyUI 全局对象，可在 Node 测试环境直接 import。

/**
 * 安全绘制圆角矩形路径。
 * 优先调用原生 ctx.roundRect；不存在时使用 arcTo / lineTo 多段路径模拟，
 * 支持数字半径或 [左上,右上,右下,左下] 数组。
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number|number[]} radii
 */
export function roundRect(ctx, x, y, w, h, radii) {
    if (!ctx) return;
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, w, h, radii);
        return;
    }

    let tl, tr, br, bl;
    if (Array.isArray(radii)) {
        tl = Math.max(0, radii[0] || 0);
        tr = Math.max(0, radii[1] || 0);
        br = Math.max(0, radii[2] || 0);
        bl = Math.max(0, radii[3] || 0);
    } else {
        const r = Math.max(0, +radii || 0);
        tl = tr = br = bl = r;
    }

    // 限制半径不超过宽高的一半，避免 arcTo 产生异常路径
    const maxR = Math.min(Math.abs(w), Math.abs(h)) / 2;
    tl = Math.min(tl, maxR);
    tr = Math.min(tr, maxR);
    br = Math.min(br, maxR);
    bl = Math.min(bl, maxR);

    const right = x + w;
    const bottom = y + h;

    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.lineTo(right - tr, y);
    if (tr > 0) ctx.arcTo(right, y, right, y + tr, tr);
    ctx.lineTo(right, bottom - br);
    if (br > 0) ctx.arcTo(right, bottom, right - br, bottom, br);
    ctx.lineTo(x + bl, bottom);
    if (bl > 0) ctx.arcTo(x, bottom, x, bottom - bl, bl);
    ctx.lineTo(x, y + tl);
    if (tl > 0) ctx.arcTo(x, y, x + tl, y, tl);
    ctx.closePath();
}

/**
 * 检测当前环境是否支持 roundRect（含原生与本垫片）。
 * @param {CanvasRenderingContext2D} [ctx]
 * @returns {boolean}
 */
export function supportsRoundRect(ctx) {
    return !!ctx && (typeof ctx.roundRect === 'function' || typeof roundRect === 'function');
}
