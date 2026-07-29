import { t } from "./i18n.js";
// ========== WOSAI NodeColor 配色主题系统 ==========
// 全图语义化配色：节点 → 12 功能大类 → 主题色（数据结构借鉴 GJJ node_color_theme，
// 颜色与实现均为独立设计）。
// WOSAI 差异化：主题支持渐变风格（_gradient），复用 node-color.js 渲染层。

import { hex2hsv, hsv2hex, deriveDarkBg, applyNodeColor, palettesPromise } from "./color-core.js";

// ── 12 功能大类（内部使用，不对外导出）──────────────────────
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
function classifyNode(node) {
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
// 六套纯色风格 + 六套渐变风格
// 注：*_COLORS 主题调色板数据已外置到 web/data/color-palettes.json，通过 color-core.js 的 palettesPromise 动态加载后填充。
export let THEME_STYLES = {};
export const themesPromise = palettesPromise.then(palettes => {
    const themes = (palettes && palettes.themes) || {};
    const {
        soft: SOFT_COLORS,
        vivid: VIVID_COLORS,
        dark: DARK_COLORS,
        deep: DEEP_COLORS,
        muted: MUTED_COLORS,
        forest: FOREST_COLORS,
        ocean: OCEAN_COLORS,
        dusk: DUSK_COLORS,
    } = themes;
    THEME_STYLES = {
        // ── 纯色 Solid ──
        'wosai-soft':       { label: t('widgets.colorTheme.themeSoftLabel'),     desc: t('widgets.colorTheme.themeSoftDesc'),   group: 'solid', kind: 'solid', colors: SOFT_COLORS },
        'wosai-contrast':   { label: t('widgets.colorTheme.themeContrastLabel'),     desc: t('widgets.colorTheme.themeContrastDesc'),  group: 'solid', kind: 'solid', colors: VIVID_COLORS },
        'wosai-dark':       { label: t('widgets.colorTheme.themeDarkLabel'),     desc: t('widgets.colorTheme.themeDarkDesc'), group: 'solid', kind: 'solid', colors: DARK_COLORS },
        'wosai-muted':      { label: t('widgets.colorTheme.themeMutedLabel'),     desc: t('widgets.colorTheme.themeMutedDesc'), group: 'solid', kind: 'solid', colors: MUTED_COLORS },
        'wosai-forest':     { label: t('widgets.colorTheme.themeForestLabel'),     desc: t('widgets.colorTheme.themeForestDesc'),       group: 'solid', kind: 'solid', colors: FOREST_COLORS },
        'wosai-ocean':      { label: t('widgets.colorTheme.themeOceanLabel'),     desc: t('widgets.colorTheme.themeOceanDesc'),       group: 'solid', kind: 'solid', colors: OCEAN_COLORS },
        // ── 渐变 Gradient ──
        'wosai-grad-soft':  { label: t('widgets.colorTheme.themeGradSoftLabel'),     desc: t('widgets.colorTheme.themeGradSoftDesc'), group: 'grad',   kind: 'grad', dir: '↓', colors: SOFT_COLORS },
        'wosai-grad-vivid': { label: t('widgets.colorTheme.themeGradVividLabel'),     desc: t('widgets.colorTheme.themeGradVividDesc'),   group: 'grad',   kind: 'grad', dir: '↓', colors: VIVID_COLORS },
        'wosai-grad-deep':  { label: t('widgets.colorTheme.themeGradDeepLabel'),     desc: t('widgets.colorTheme.themeGradDeepDesc'),             group: 'grad',   kind: 'grad', dir: '↘', colors: DEEP_COLORS },
        'wosai-grad-dusk':  { label: t('widgets.colorTheme.themeGradDuskLabel'),     desc: t('widgets.colorTheme.themeGradDuskDesc'),         group: 'grad',   kind: 'grad', dir: '↘', colors: DUSK_COLORS },
        'wosai-grad-wave':  { label: t('widgets.colorTheme.themeGradWaveLabel'),     desc: t('widgets.colorTheme.themeGradWaveDesc'),         group: 'grad',   kind: 'grad', dir: '→', colors: OCEAN_COLORS },
        'wosai-grad-grove': { label: t('widgets.colorTheme.themeGradGroveLabel'),     desc: t('widgets.colorTheme.themeGradGroveDesc'),             group: 'grad',   kind: 'grad', dir: '↓', colors: FOREST_COLORS },
    };
    return THEME_STYLES;
});

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
            applyNodeColor(n, hex, darkHex, {
                gradient: { dir: style.dir || '↓', stops: [{ p: 0, hex }, { p: 1, hex: darkHex }] },
            });
        } else {
            applyNodeColor(n, hex, darkHex);
        }
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
