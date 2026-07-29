// ── WOSAI 连线动画引擎 LinkFXEngine（纯函数，无 ComfyUI/DOM，可单测）──
//   只负责几何/相位计算；具体绘制由渲染层按 mode 决定。
//   bezier(p0,p1,p2,p3,t) → [x,y]              三次贝塞尔取点
//   ctrlPoints(a,b)       → [c1,c2]            仿 LiteGraph 的水平控制点
//   particleTs(count,phase) → [t...]           沿线均布的粒子参数(随 phase 环绕推进)
//   纯函数：不修改入参。

export const LINK_MODES = ['particle', 'dashed', 'image', 'text'];

export function bezier(p0, p1, p2, p3, t) {
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

export function ctrlPoints(a, b) {
    const d = Math.max(40, Math.abs(b[0] - a[0]) * 0.25);   // 水平外扩，越远越弯
    return [[a[0] + d, a[1]], [b[0] - d, b[1]]];
}

export function particleTs(count, phase) {
    const out = [], n = Math.max(1, count | 0);
    const ph = ((phase % 1) + 1) % 1;
    for (let i = 0; i < n; i++) out.push(((ph + i / n) % 1 + 1) % 1);
    return out;
}

// 按造型返回折线点序列（与 _drawRoute 一致）；default 返回 null(用贝塞尔)
export function routePoints(a, b, route) {
    const x0 = a[0], y0 = a[1], x1 = b[0], y1 = b[1], mx = (x0 + x1) / 2;
    if (route === "straight") return [[x0, y0], [x1, y1]];
    if (route === "ortho" || route === "round") return [[x0, y0], [mx, y0], [mx, y1], [x1, y1]];
    if (route === "wave") {
        const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
        const amp = Math.min(14, len * 0.06), waves = Math.max(2, Math.round(len / 60)), segs = 28, pts = [[x0, y0]];
        for (let i = 1; i <= segs; i++) { const t = i / segs, off = Math.sin(t * Math.PI * waves) * amp * Math.sin(t * Math.PI); pts.push([x0 + dx * t + nx * off, y0 + dy * t + ny * off]); }
        return pts;
    }
    return null;
}

// 沿折线按弧长比例 t(0..1) 取点
export function polyPointAt(pts, t) {
    if (!pts || pts.length < 2) return pts && pts[0] ? pts[0].slice() : [0, 0];
    const seg = []; let total = 0;
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); total += d; }
    if (total <= 0) return pts[0].slice();
    let target = Math.max(0, Math.min(1, t)) * total;
    for (let i = 0; i < seg.length; i++) {
        if (target <= seg[i] || i === seg.length - 1) { const f = seg[i] ? target / seg[i] : 0; const p = pts[i], q = pts[i + 1]; return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]; }
        target -= seg[i];
    }
    return pts[pts.length - 1].slice();
}
