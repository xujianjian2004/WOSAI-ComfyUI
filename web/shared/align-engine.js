// ── WOSAI 对齐引擎 AlignEngine（纯几何，无 ComfyUI / DOM 依赖，可单测）──
//   输入：盒数组 [{ id?, x, y, w, h }, ...]（x/y=左上角，w/h=可见宽高）
//   输出：同长度新数组（浅拷贝 + 更新 x/y），入参不被修改
//   调用方负责：读 node.pos/size → compute() → 写回 + undo 快照（graph.beforeChange/afterChange）
//
// 支持命令（与节点对齐面板一致，共 14 项）：
//   基础(6)  left / right / top / bottom / h_center / v_center
//   等间距(2) dist_h / dist_v
//   复合(6)  dist_h+top / dist_h+v_center / dist_h+bottom
//            dist_v+left / dist_v+h_center / dist_v+right
//   复合 = 一轴等间距分布 + 垂直另一轴对齐（两轴正交，互不覆盖）

export function bbox(boxes) {
    const minX = Math.min(...boxes.map(b => b.x));
    const maxX = Math.max(...boxes.map(b => b.x + b.w));
    const minY = Math.min(...boxes.map(b => b.y));
    const maxY = Math.max(...boxes.map(b => b.y + b.h));
    const avgCX = boxes.reduce((a, b) => a + b.x + b.w / 2, 0) / boxes.length;
    const avgCY = boxes.reduce((a, b) => a + b.y + b.h / 2, 0) / boxes.length;
    return { minX, maxX, minY, maxY, avgCX, avgCY };
}

// 基础对齐：每项只改一个轴（x 类改 x，y 类改 y）
const X_OPS = {
    left:     (b, n) => b.minX,
    right:    (b, n) => b.maxX - n.w,
    h_center: (b, n) => b.avgCX - n.w / 2,
};
const Y_OPS = {
    top:      (b, n) => b.minY,
    bottom:   (b, n) => b.maxY - n.h,
    v_center: (b, n) => b.avgCY - n.h / 2,
};

// 等间距分布：端点固定，各盒按主轴排序后等 gap 排布；返回 ref→新坐标 映射
// anchor 可选：{ idx }，锚点节点的轴坐标保持不变，两侧节点分别均布
// fixedGap 可选：指定固定像素间距，不使用 bbox 均分
function distribute(boxes, axis, b, anchor, fixedGap) {
    const P = axis === 0 ? 'x' : 'y';
    const S = axis === 0 ? 'w' : 'h';
    const min = axis === 0 ? b.minX : b.minY;
    const max = axis === 0 ? b.maxX : b.maxY;
    const sorted = boxes.slice().sort((a, c) => a[P] - c[P]);
    const map = new Map();

    // 固定间距模式：从首节点开始，依次以 fixedGap 排列，不受 bbox 约束
    if (fixedGap != null && sorted.length >= 2) {
        let cur = sorted[0][P];
        for (const n of sorted) { map.set(n, cur); cur += n[S] + fixedGap; }
        return { map, P };
    }

    if (anchor && anchor.idx >= 0 && anchor.idx < boxes.length && sorted.length > 2) {
        const an = boxes[anchor.idx];
        // 找到锚点在排序数组中的位置
        let aIdx = 0;
        for (let i = 0; i < sorted.length; i++) {
            if (sorted[i] === an) { aIdx = i; break; }
        }
        const anP = an[P];  // 锚点原坐标
        // 左侧：从 min 到 anP（不含锚点）均匀分布
        const left = sorted.slice(0, aIdx);
        if (left.length > 0) {
            const lTotal = left.reduce((acc, n) => acc + n[S], 0);
            const lGap = left.length > 1 ? (anP - min - lTotal) / (left.length - 1) : 0;
            let cur = min;
            for (const n of left) { map.set(n, cur); cur += n[S] + lGap; }
        }
        // 锚点保持原坐标
        map.set(an, anP);
        // 右侧：从 anP + an[S] 到 max 均匀分布
        const right = sorted.slice(aIdx + 1);
        if (right.length > 0) {
            const rStart = anP + an[S];
            const rTotal = right.reduce((acc, n) => acc + n[S], 0);
            const rGap = right.length > 1 ? (max - rStart - rTotal) / (right.length - 1) : 0;
            let cur = rStart;
            for (const n of right) { map.set(n, cur); cur += n[S] + rGap; }
        }
        return { map, P };
    }

    // 无锚点时：经典均匀分布
    const total = sorted.reduce((acc, n) => acc + n[S], 0);
    const gap = sorted.length > 1 ? (max - min - total) / (sorted.length - 1) : 0;
    let cur = min;
    for (const n of sorted) { map.set(n, cur); cur += n[S] + gap; }
    return { map, P };
}

/**
 * 计算对齐后的新坐标。
 * @param {Array} boxes 盒数组（不被修改）
 * @param {string} cmd  命令（见文件头）
 * @param {object} [opts] 选项：{ anchorIdx, gap }。gap 为数字时使用固定像素间距，不自动均分
 * @returns {Array} 新盒数组（含原字段 + 更新后的 x/y）；不足 2 个或未知命令返回 []
 */
export function compute(boxes, cmd, opts = {}) {
    if (!Array.isArray(boxes) || boxes.length < 2 || !cmd) return [];
    const b = bbox(boxes);
    const res = boxes.map(n => ({ ...n }));
    const ref = new Map(boxes.map((n, i) => [n, res[i]]));

    // 解析复合命令
    let distAxis = null, alignKey = cmd;
    if (cmd === 'dist_h') { distAxis = 0; alignKey = null; }
    else if (cmd === 'dist_v') { distAxis = 1; alignKey = null; }
    else if (cmd.indexOf('+') >= 0) {
        const [d, a] = cmd.split('+');
        distAxis = d === 'dist_h' ? 0 : (d === 'dist_v' ? 1 : null);
        alignKey = a;
    }

    // 1) 分布（设主轴坐标）
    if (distAxis !== null) {
        const anchor = (opts.anchorIdx != null) ? { idx: opts.anchorIdx } : undefined;
        const { map, P } = distribute(boxes, distAxis, b, anchor, opts.gap);
        for (const [n, v] of map) ref.get(n)[P] = v;
    }
    // 2) 对齐（设对应轴坐标）
    if (alignKey) {
        if (X_OPS[alignKey]) for (const n of res) n.x = X_OPS[alignKey](b, n);
        else if (Y_OPS[alignKey]) for (const n of res) n.y = Y_OPS[alignKey](b, n);
        else if (distAxis === null) return [];   // 未知命令
    }
    return res;
}

// ── 尺寸统一 resize(boxes, cmd, opts) ──────────────────────────────────────
//   cmd : 'eq_w'(等宽) | 'eq_h'(等高) | 'eq_both'(等尺寸)
//   opts: { base:'max'|'anchor', anchorIndex }
//     base='max'   → 取所有盒的最大 w/h 为基准（默认）
//     base='anchor'→ 取 boxes[anchorIndex]（缺省为最后一个）的 w/h 为基准
//   只算新 w/h（不动 x/y）；返回盒副本，入参不可变。
export function resize(boxes, cmd, opts = {}) {
    if (!Array.isArray(boxes) || boxes.length < 2) return [];
    const base = opts.base === 'anchor' ? 'anchor' : 'max';
    let tw, th;
    if (base === 'anchor') {
        const ai = (opts.anchorIndex >= 0 && opts.anchorIndex < boxes.length) ? opts.anchorIndex : boxes.length - 1;
        tw = boxes[ai].w; th = boxes[ai].h;
    } else {
        tw = Math.max(...boxes.map(b => b.w));
        th = Math.max(...boxes.map(b => b.h));
    }
    return boxes.map(b => {
        const nb = { ...b };
        if (cmd === 'eq_w' || cmd === 'eq_both') nb.w = tw;
        if (cmd === 'eq_h' || cmd === 'eq_both') nb.h = th;
        return nb;
    });
}

// ── 单侧拉伸 stretch(boxes, cmd) ───────────────────────────────────────────
//   把所有盒的某一边拉齐到“组的该侧极值”，并相应改变尺寸（边贴齐 + 填满空档）：
//   'stretch_left' 左缘→minX(同时加宽) | 'stretch_right' 右缘→maxX | 'stretch_top' 顶→minY | 'stretch_bottom' 底→maxY
//   改 x/y/w/h；返回盒副本，入参不可变。
export function stretch(boxes, cmd) {
    if (!Array.isArray(boxes) || boxes.length < 2) return [];
    const b = bbox(boxes);
    const out = boxes.map(o => {
        const nb = { ...o };
        switch (cmd) {
            case 'stretch_left':   nb.w = (o.x + o.w) - b.minX; nb.x = b.minX; break;
            case 'stretch_right':  nb.w = b.maxX - o.x; break;
            case 'stretch_top':    nb.h = (o.y + o.h) - b.minY; nb.y = b.minY; break;
            case 'stretch_bottom': nb.h = b.maxY - o.y; break;
            default: return null;
        }
        return nb;
    });
    return out[0] === null ? [] : out;
}

// 面板命令清单（供 UI 渲染按钮，顺序与示意图一致）
export const ALIGN_COMMANDS = {
    basic: ['left', 'h_center', 'right', 'top', 'v_center', 'bottom'],
    distribute: ['dist_h', 'dist_v',
        'dist_h+top', 'dist_h+v_center', 'dist_h+bottom',
        'dist_v+left', 'dist_v+h_center', 'dist_v+right'],
    resize: ['eq_w', 'eq_h', 'eq_both'],
    stretch: ['stretch_top', 'stretch_bottom', 'stretch_left', 'stretch_right'],
};
