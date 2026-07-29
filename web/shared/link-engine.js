// ── WOSAI 快速连接引擎 LinkEngine（纯函数，无 ComfyUI/DOM，可单测）──
//   规划「应建立哪些连线」，不直接动图。调用方读真节点端口后传入，再据返回结果 node.connect。
//   planLinks(nodes, mode, opts) → [{ from, fromSlot, to, toSlot }]
//     nodes: [{ id, x, y, outputs:[{type}], inputs:[{type, linked:bool}] }]
//     mode : 'chain' 链式(按位置首尾相接) | 'gather' 多对一(汇聚到最右) | 'broadcast' 一对多(最左广播)
//     opts : { force=false }   force=true 允许占用已连输入(覆盖)
//   类型兼容：相等 或 任一为 '*' 通配。非 force 时跳过已连输入(不破坏既有连线)。
//   纯函数：不修改入参。

export const LINK_MODES = ['chain', 'gather', 'broadcast'];

function compat(outT, inT) {
    if (outT == null || inT == null) return false;
    return outT === inT || inT === '*' || outT === '*';
}

// a 的某 output 与 b 的某可用 input 的首个兼容对；usedIn=已占用的 b 输入槽集合
function firstPair(a, b, usedIn, force) {
    const outs = a.outputs || [], ins = b.inputs || [];
    for (let oi = 0; oi < outs.length; oi++) {
        for (let ii = 0; ii < ins.length; ii++) {
            if (usedIn.has(ii)) continue;
            const inp = ins[ii];
            if (!force && inp.linked) continue;
            if (compat(outs[oi].type, inp.type)) return { oi, ii };
        }
    }
    return null;
}

export function planLinks(nodes, mode, opts = {}) {
    if (!Array.isArray(nodes) || nodes.length < 2) return [];
    const force = !!opts.force;
    const ord = [...nodes].sort((p, q) => (p.x - q.x) || (p.y - q.y));   // 视觉左→右、上→下
    const out = [];

    if (mode === 'chain') {
        for (let i = 0; i < ord.length - 1; i++) {
            const a = ord[i], b = ord[i + 1];
            const pr = firstPair(a, b, new Set(), force);
            if (pr) out.push({ from: a.id, fromSlot: pr.oi, to: b.id, toSlot: pr.ii });
        }
    } else if (mode === 'gather') {
        const target = ord[ord.length - 1];
        const used = new Set();
        for (let i = 0; i < ord.length - 1; i++) {
            const pr = firstPair(ord[i], target, used, force);
            if (pr) { out.push({ from: ord[i].id, fromSlot: pr.oi, to: target.id, toSlot: pr.ii }); used.add(pr.ii); }
        }
    } else if (mode === 'broadcast') {
        const source = ord[0];
        for (let i = 1; i < ord.length; i++) {
            const pr = firstPair(source, ord[i], new Set(), force);
            if (pr) out.push({ from: source.id, fromSlot: pr.oi, to: ord[i].id, toSlot: pr.ii });
        }
    }
    return out;
}
