// ── WOSAI 检索引擎 SearchEngine（纯函数，无 ComfyUI / DOM 依赖，可单测）──
//   在「画布已有节点」中按多字段检索（区别于节点库 add-node 搜索）。
//   match(nodes, query, opts) → 命中节点子集（保持入参顺序）；入参不被修改。
//   node 描述（由 UI 层从 graph.nodes 提取）：
//     { id, title?, type?, widgets?: [{name, value}], properties?: {} }
//   opts.mode : 'normal'(忽略大小写包含,默认) | 'wildcard'(* ?) | 'regex'
//   opts.fields: 限定搜索字段(可选)；默认全部:
//     ['title','type','id','widgetName','widgetValue','property']

const DEFAULT_FIELDS = ['title', 'type', 'id', 'widgetName', 'widgetValue', 'property'];

function wildcardToRegExp(pat) {
    // 转义正则元字符（保留 * ?），* → .*，? → .
    const esc = pat.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    return new RegExp('^' + esc.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
}

// 构造匹配器；非法正则返回 null
function makeMatcher(query, mode) {
    try {
        if (mode === 'regex') { const re = new RegExp(query, 'i'); return (s) => re.test(s); }
        if (mode === 'wildcard') { const re = wildcardToRegExp(query); return (s) => re.test(s); }
        const q = String(query).toLowerCase();
        return (s) => s.toLowerCase().indexOf(q) >= 0;
    } catch (_) { return null; }
}

function nodeMatches(n, test, fields) {
    if (fields.has('title') && n.title != null && test(String(n.title))) return true;
    if (fields.has('type') && n.type != null && test(String(n.type))) return true;
    if (fields.has('id') && n.id != null && test(String(n.id))) return true;
    if (Array.isArray(n.widgets)) {
        for (const w of n.widgets) {
            if (!w) continue;
            if (fields.has('widgetName') && w.name != null && test(String(w.name))) return true;
            if (fields.has('widgetValue') && w.value != null && test(String(w.value))) return true;
        }
    }
    if (fields.has('property') && n.properties && typeof n.properties === 'object') {
        for (const k in n.properties) {
            if (test(String(k))) return true;
            const v = n.properties[k];
            if (v != null && test(String(v))) return true;
        }
    }
    return false;
}

/**
 * 在节点集合中检索。
 * @param {Array} nodes 节点描述数组（不被修改）
 * @param {string} query 查询串
 * @param {{mode?:string, fields?:string[]}} opts
 * @returns {Array} 命中节点子集（原序）；空查询/非法正则返回 []
 */
export function match(nodes, query, opts = {}) {
    if (!Array.isArray(nodes) || query == null || query === '') return [];
    const test = makeMatcher(query, opts.mode || 'normal');
    if (!test) return [];
    const fields = new Set(opts.fields && opts.fields.length ? opts.fields : DEFAULT_FIELDS);
    const out = [];
    for (const n of nodes) if (n && nodeMatches(n, test, fields)) out.push(n);
    return out;
}


