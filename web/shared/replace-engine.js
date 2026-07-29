// ── WOSAI 替换节点引擎 ReplaceEngine（纯函数，无 ComfyUI/DOM，可单测）──
//   替换节点时把"旧节点的端口"映射到"新节点的端口"，以便迁移连线。
//   matchSlots(oldSlots, newSlots) → Map(oldIndex → newIndex)（仅含匹配上的）
//     slots: [{ name, type }]
//   策略：① 名称优先（忽略大小写）且类型兼容；② 余下按"类型唯一"匹配（该类型在新端口中仅剩 1 个空位）。
//   类型兼容：相等 / 任一为 '*' / 任一缺省。纯函数：不修改入参。

function typeOk(a, b) {
    return a === b || a === '*' || b === '*' || a == null || b == null;
}

export function matchSlots(oldSlots, newSlots) {
    const map = new Map();
    if (!Array.isArray(oldSlots) || !Array.isArray(newSlots)) return map;
    const usedNew = new Set();

    // ① 名称匹配（忽略大小写）+ 类型兼容
    oldSlots.forEach((o, oi) => {
        if (o == null || o.name == null) return;
        const on = String(o.name).toLowerCase();
        for (let ni = 0; ni < newSlots.length; ni++) {
            if (usedNew.has(ni)) continue;
            const n = newSlots[ni];
            if (n && n.name != null && String(n.name).toLowerCase() === on && typeOk(o.type, n.type)) {
                map.set(oi, ni); usedNew.add(ni); break;
            }
        }
    });

    // ② 余下旧槽：按"严格同类型且新端口中该类型仅剩一个空位"匹配
    oldSlots.forEach((o, oi) => {
        if (map.has(oi) || o == null) return;
        const cands = [];
        newSlots.forEach((n, ni) => { if (!usedNew.has(ni) && n && o.type != null && n.type === o.type) cands.push(ni); });
        if (cands.length === 1) { map.set(oi, cands[0]); usedNew.add(cands[0]); }
    });

    return map;
}
