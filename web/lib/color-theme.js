// ========== WOSAI NodeColor 配色主题系统 ==========
// 全图语义化配色：节点 → 12 功能大类 → 主题色（数据结构借鉴 GJJ node_color_theme，
// 颜色与实现均为独立设计）。
// WOSAI 差异化：主题支持渐变风格（_gradient），复用 node-color.js 渲染层。

import { hex2hsv, hsv2hex, deriveDarkBg, autoTitleTextColor } from "./color-core.js";

// ── 12 功能大类 ──────────────────────────────────────────
export const CATEGORIES = [
    { id: 'input',  label: '输入' },
    { id: 'guide',  label: '引导' },
    { id: 'sample', label: '采样' },
    { id: 'output', label: '输出' },
    { id: 'decode', label: '解码' },
    { id: 'encode', label: '编码' },
    { id: 'model',  label: '模型' },
    { id: 'prompt', label: '提示' },
    { id: 'image',  label: '图像' },
    { id: 'video',  label: '视频' },
    { id: 'audio',  label: '音频' },
    { id: 'tool',   label: '工具' },
];

// ── 分类规则（按优先级顺序匹配，先命中先得） ──────────────
// 输入 = type + ' ' + title + ' ' + category（统一小写）
const RULES = [
    { id: 'output', re: /save|preview|output|export/ },
    { id: 'guide',  re: /controlnet|ipadapter|ip-adapter|guide|guidance|reference|inpaint\s*condition|redux|instantid/ },
    // prompt 必须在 decode/encode 之前：CLIPTextEncode 含 "encode" 但语义是提示词
    { id: 'prompt', re: /cliptext|clip\s*text|conditioning|prompt|text\s*encode|t5|style\s*model/ },
    { id: 'decode', re: /vae\s*decode|decode|latent\s*to/ },
    { id: 'encode', re: /vae\s*encode|encode(?!r\s*loader)/ },
    { id: 'sample', re: /sampler|sampling|sigma|scheduler|noise|denoise|cfg|flux\s*guidance/ },
    { id: 'model',  re: /checkpoint|unet|lora|hypernetwork|model\s*(loader|merge|patch)|loaders|gguf|diffusion/ },
    { id: 'video',  re: /video|animate|frame|motion|wan|ltx|svd|hunyuan\s*video/ },
    { id: 'audio',  re: /audio|sound|music|tts|voice|speech/ },
    { id: 'input',  re: /load\s*image|loadimage|primitive|\bint\b|\bfloat\b|\bstring\b|\bnote\b|seed|width|height|empty\s*latent|input/ },
    { id: 'image',  re: /image|upscale|resize|crop|mask|composite|blend|color\s*correct/ },
];

// 节点 → 大类 id（未命中归 'tool'）
export function classifyNode(node) {
    const hay = [
        node.type || '',
        node.comfyClass || '',
        node.constructor?.category || node.category || '',
    ].join(' ').toLowerCase();
    for (const r of RULES) {
        if (r.re.test(hay)) return r.id;
    }
    return 'tool';
}

// ── 内置主题（独立设计的色值）──────────────────────────────
// group: 'solid' 纯色（写 color/bgcolor）| 'grad' 渐变（写 _gradient，暗端自动衍生）
const SOFT_COLORS = {
    input:  '#587E9C', guide:  '#7B6FA8', sample: '#A8824E',
    output: '#5E9A72', decode: '#69A089', encode: '#5E8B84',
    model:  '#8A6FA0', prompt: '#6F76A8', image:  '#5B93A4',
    video:  '#A08850', audio:  '#7E8C66', tool:   '#6A767E',
};
const VIVID_COLORS = {
    input:  '#2D6FD0', guide:  '#9D4EDD', sample: '#E8920A',
    output: '#23A85E', decode: '#0FB5C9', encode: '#2F9BE0',
    model:  '#7048D8', prompt: '#0E9E78', image:  '#15A8A0',
    video:  '#D4B012', audio:  '#8FC92C', tool:   '#8593A6',
};
const DARK_COLORS = {
    input:  '#33526B', guide:  '#4A4070', sample: '#6E5524',
    output: '#2F5E40', decode: '#2F5E55', encode: '#2E4F52',
    model:  '#553F6B', prompt: '#3D4470', image:  '#2E5A66',
    video:  '#6B5A28', audio:  '#4A5536', tool:   '#3C4750',
};
const DEEP_COLORS = {
    input:  '#3A6B9C', guide:  '#6B4FA8', sample: '#B07820',
    output: '#2E8B57', decode: '#2AA198', encode: '#3D8BA8',
    model:  '#7A4FB8', prompt: '#4A5FB8', image:  '#2E96B8',
    video:  '#B89A2A', audio:  '#7FA040', tool:   '#5C6B7A',
};
// 粉黛：莫兰迪式灰调，低饱和高级感
const MUTED_COLORS = {
    input:  '#8C7E8A', guide:  '#9A8AA0', sample: '#B09A7E',
    output: '#7E9A8A', decode: '#7AA09A', encode: '#7E948C',
    model:  '#A08AA0', prompt: '#8A92A8', image:  '#7E9AA8',
    video:  '#B0A07E', audio:  '#94A08A', tool:   '#8A9098',
};
// 森系：大地绿棕，自然护眼
const FOREST_COLORS = {
    input:  '#4E7A5E', guide:  '#6E8A4E', sample: '#A8862E',
    output: '#3E8A5E', decode: '#4E9A7A', encode: '#527E6A',
    model:  '#7A8A3E', prompt: '#5E8A6E', image:  '#4E8A8A',
    video:  '#A89A3E', audio:  '#8AA04E', tool:   '#6A7A62',
};
// 海雾：冷调蓝灰，统一海洋色系
const OCEAN_COLORS = {
    input:  '#4E7A9A', guide:  '#5E6EA8', sample: '#7A8AB0',
    output: '#3E8A9A', decode: '#4EA0B0', encode: '#5288A0',
    model:  '#6E7AC0', prompt: '#5E72B0', image:  '#45A0C0',
    video:  '#8A9AC8', audio:  '#6E9AB0', tool:   '#62788A',
};
// 暮山：黄昏紫橙暖调
const DUSK_COLORS = {
    input:  '#8A5E9A', guide:  '#A05EA8', sample: '#C87838',
    output: '#B06048', decode: '#985878', encode: '#8A5E88',
    model:  '#A0529A', prompt: '#7A5EA8', image:  '#B0688A',
    video:  '#C8883A', audio:  '#A87858', tool:   '#8A6E7A',
};

export const THEME_STYLES = {
    // ── 纯色 Solid ──
    'wosai-soft':       { label: '柔和', group: 'solid', kind: 'solid', colors: SOFT_COLORS },
    'wosai-contrast':   { label: '鲜明', group: 'solid', kind: 'solid', colors: VIVID_COLORS },
    'wosai-dark':       { label: '暗调', group: 'solid', kind: 'solid', colors: DARK_COLORS },
    'wosai-muted':      { label: '粉黛', group: 'solid', kind: 'solid', colors: MUTED_COLORS },
    'wosai-forest':     { label: '森系', group: 'solid', kind: 'solid', colors: FOREST_COLORS },
    'wosai-ocean':      { label: '海雾', group: 'solid', kind: 'solid', colors: OCEAN_COLORS },
    // ── 渐变 Gradient ──
    'wosai-grad-soft':  { label: '流岚', group: 'grad', kind: 'grad', dir: '↓', colors: SOFT_COLORS },
    'wosai-grad-vivid': { label: '幻彩', group: 'grad', kind: 'grad', dir: '↓', colors: VIVID_COLORS },
    'wosai-grad-deep':  { label: '深邃', group: 'grad', kind: 'grad', dir: '↘', colors: DEEP_COLORS },
    'wosai-grad-dusk':  { label: '暮山', group: 'grad', kind: 'grad', dir: '↘', colors: DUSK_COLORS },
    'wosai-grad-wave':  { label: '碧波', group: 'grad', kind: 'grad', dir: '→', colors: OCEAN_COLORS },
    'wosai-grad-grove': { label: '翠谷', group: 'grad', kind: 'grad', dir: '↓', colors: FOREST_COLORS },
};

const LS_SELECTED = 'wosai-nodecolor-theme';
export function getSelectedStyleId() {
    const v = localStorage.getItem(LS_SELECTED);
    return THEME_STYLES[v] ? v : 'wosai-soft';
}
export function setSelectedStyleId(id) {
    if (THEME_STYLES[id]) localStorage.setItem(LS_SELECTED, id);
}

// ── 应用 / 撤销 ──────────────────────────────────────────
let _lastSnapshot = null;   // { nodes: [{node,color,bgcolor,gradient}], groups: [{g,color}] }
export function hasSnapshot() { return !!_lastSnapshot; }

function takeSnapshot(nodes) {
    return nodes.map(n => ({
        node: n,
        color: n.color,
        bgcolor: n.bgcolor,
        gradient: n._gradient ? JSON.parse(JSON.stringify(n._gradient)) : null,
    }));
}

// 将主题应用到目标范围。返回各大类命中数统计。
// 范围规则：
//   applyTheme(id)                → 全图节点 + 全部分组框
//   applyTheme(id, nodes)         → 仅这些节点（不涂任何分组框）
//   applyTheme(id, nodes, groups) → 这些节点 + 这些分组框
// 分组框颜色：取组内节点大类众数的暗色（低调衬托，不与节点抢视觉）。
export function applyTheme(styleId, nodes, groups) {
    const style = THEME_STYLES[styleId];
    if (!style) return null;
    const targets = nodes || app_graph_nodes();
    if (!targets.length) return null;

    // 分组目标：显式传入用之；未传 nodes（全图模式）时取全部分组；否则不涂分组
    const graphGroups = groups !== undefined ? groups : (nodes ? [] : app_graph_groups());
    _lastSnapshot = {
        nodes: takeSnapshot(targets),
        groups: graphGroups.map(g => ({ g, color: g.color })),
    };
    const stats = {};

    for (const n of targets) {
        const cat = classifyNode(n);
        stats[cat] = (stats[cat] || 0) + 1;
        const hex = style.colors[cat] || style.colors.tool;
        const t = hex2hsv(hex);
        const d = deriveDarkBg(t.h, t.s, t.v);
        const darkHex = hsv2hex(d.h, d.s, d.v);

        if (style.kind === 'grad') {
            n.color = hex;
            n.bgcolor = darkHex;
            n._gradient = { dir: style.dir || '↓', stops: [{ p: 0, hex }, { p: 1, hex: darkHex }] };
        } else {
            n.color = hex;
            n.bgcolor = darkHex;
            delete n._gradient;
        }
        if (typeof n.setColorOption === "function") n.setColorOption({ color: n.color, bgcolor: n.bgcolor });
        n.constructor.title_text_color = autoTitleTextColor(hex);
    }

    // 分组框：组内节点大类众数 → 该类主题色的暗版；空分组保持原色
    for (const g of graphGroups) {
        try { g.recomputeInsideNodes?.(); } catch (e) {}
        const inside = g._nodes || g.nodes || [];
        if (!inside.length) continue;
        const counts = {};
        for (const n of inside) { const c = classifyNode(n); counts[c] = (counts[c] || 0) + 1; }
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
        const hex = style.colors[top] || style.colors.tool;
        const t = hex2hsv(hex);
        const d = deriveDarkBg(t.h, t.s, t.v);
        g.color = hsv2hex(d.h, d.s, d.v);
    }

    setSelectedStyleId(styleId);
    return stats;
}

// 撤销最近一次 applyTheme（节点 + 分组框）
export function undoTheme() {
    if (!_lastSnapshot) return false;
    const nodeSnaps = _lastSnapshot.nodes || _lastSnapshot;   // 兼容旧数组结构
    for (const s of nodeSnaps) {
        const n = s.node;
        n.color = s.color;
        n.bgcolor = s.bgcolor;
        if (s.gradient) n._gradient = s.gradient;
        else delete n._gradient;
        if (typeof n.setColorOption === "function") {
            n.setColorOption(s.color || s.bgcolor ? { color: s.color, bgcolor: s.bgcolor } : null);
        }
    }
    for (const gs of (_lastSnapshot.groups || [])) {
        gs.g.color = gs.color;
    }
    _lastSnapshot = null;
    return true;
}

// 延迟获取 graph nodes / groups（避免循环依赖 app；typeof 防御非浏览器环境）
function _app() {
    const w = (typeof window !== 'undefined') ? window : globalThis;
    return w.app || w.comfyAPI?.app?.app;
}
function app_graph_nodes() {
    const app = _app();
    return app?.graph?.nodes ? [...app.graph.nodes] : [];
}
function app_graph_groups() {
    const app = _app();
    const g = app?.graph?._groups || app?.graph?.groups;
    return g ? [...g] : [];
}
