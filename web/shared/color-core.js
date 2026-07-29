// ========== WOSAI NodeColor Core ==========
// 上色核心模块：颜色转换、预设数据、渐变算法、节点写入。
// 由 node-color.js（主面板）与未来的 color-bar.js（HUD 工具条）共用。
// 本模块为纯逻辑层：不创建 DOM、不调用 canvas.setDirty —— 由调用方负责刷新。
import { t } from "./i18n.js";

// ── 兼容旧运行时的动态 JSON 加载 ───────────────────────────
// 旧运行时（及某些测试环境）不支持 `import ... with { type: 'json' }`。
// 这里优先使用 fetch + JSON.parse；失败时回退到 import assertion；最终失败返回空兜底数据。
async function loadPalettes() {
    const url = new URL('../data/color-palettes.json', import.meta.url);
    try {
        const res = await fetch(url);
        if (res.ok) return await res.json();
    } catch (e) {
        console.warn('[WOSAI color-core] fetch palettes failed:', e);
    }
    try {
        return (await import(url.href, { assert: { type: 'json' } })).default;
    } catch (e) {
        console.warn('[WOSAI color-core] import assertion fallback failed:', e);
    }
    return { solidPresets: [], grayPresets: [], gradPresets: [] };
}

let _palettes = null;
export const palettesPromise = (async () => {
    _palettes = await loadPalettes();
    // 通过 in-place 填充保持旧同步引用可用（调用方 await palettesPromise 后即可读取）
    SOLID_PRESETS.splice(0, SOLID_PRESETS.length, ...(_palettes.solidPresets || []));
    GRAY_PRESETS.splice(0, GRAY_PRESETS.length, ...(_palettes.grayPresets || []));
    GRAD_PRESETS.splice(0, GRAD_PRESETS.length, ...(_palettes.gradPresets || []));
    return _palettes;
})();

// ── 颜色转换 ──────────────────────────────────────────────
/**
 * HSV 转 HEX 字符串
 * @param {number} h - 色相 0~360
 * @param {number} s - 饱和度 0~100
 * @param {number} v - 明度 0~100
 * @returns {string} 6位 HEX 色值
 */
export function hsv2hex(h, s, v) {
    s /= 100; v /= 100;
    const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return '#' + [f(5), f(3), f(1)].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
}

/**
 * HEX 转 HSV
 * @param {string} hex - 6位 HEX 色值
 * @returns {{h:number,s:number,v:number}} HSV 对象
 */
export function hex2hsv(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    const sv = mx ? d / mx : 0;
    if (d) { if (mx === r) h = ((g - b) / d + 6) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; }
    return { h: Math.round(h), s: Math.round(sv * 100), v: Math.round(mx * 100) };
}

/**
 * 计算 HEX 色值的相对亮度（用于自动选择文字颜色）
 * @param {string} hex - 6位 HEX 色值
 * @returns {number} 亮度值 0~255
 */
function hexLuminance(hex) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * 根据背景亮度自动选择标题文字颜色
 * @param {string} bgHex - 背景 HEX 色值
 * @returns {string} 深色或浅色 HEX
 * 注：返回的对比色直接供 Canvas fillStyle / DOM color 使用，必须为有效 HEX。
 */
const CONTRAST_DARK = hsv2hex(0, 0, 10);
const CONTRAST_LIGHT = hsv2hex(0, 0, 100);

export function autoTitleTextColor(bgHex) {
    return hexLuminance(bgHex) > 128 ? CONTRAST_DARK : CONTRAST_LIGHT;
}

// ── 派生算法（单一来源，原 node-color.js 中重复 3 处） ──────
/**
 * 由标题色自动衍生面板暗版
 * @param {number} h - 色相
 * @param {number} s - 饱和度
 * @param {number} v - 明度
 * @returns {{h:number,s:number,v:number}} 暗版 HSV
 */
export function deriveDarkBg(h, s, v) {
    return { h, s: Math.min(100, Math.round(s * 1.1)), v: Math.max(8, Math.round(v * 0.42)) };
}

/**
 * 三色渐变中间色：色相偏移 +30°，饱和度/亮度取两端较高者
 * @param {{h:number,s:number,v:number}} s0 - 起始 stop
 * @param {{h:number,s:number,v:number}} s1 - 终止 stop
 * @returns {{h:number,s:number,v:number}} 中间 stop
 */
export function deriveMidStop(s0, s1) {
    return {
        h: (Math.round((s0.h + s1.h) / 2) + 30) % 360,
        s: Math.min(100, Math.round(Math.max(s0.s, s1.s) * 0.9)),
        v: Math.min(100, Math.round(Math.max(s0.v, s1.v) * 0.8)),
    };
}

/**
 * 生成随机 HSV 色值（限制 S/V 范围保证可读性）
 * @param {Object} [opts={}] - 配置
 * @param {number} [opts.sMin=45]
 * @param {number} [opts.sMax=90]
 * @param {number} [opts.vMin=35]
 * @param {number} [opts.vMax=80]
 * @returns {{h:number,s:number,v:number}}
 */
export function randomHSV(opts = {}) {
    const { sMin = 45, sMax = 90, vMin = 35, vMax = 80 } = opts;
    return {
        h: Math.floor(Math.random() * 360),
        s: sMin + Math.floor(Math.random() * (sMax - sMin + 1)),
        v: vMin + Math.floor(Math.random() * (vMax - vMin + 1)),
    };
}

// ── 渐变方向（4 个方向：下/右/右下/右上，单行排列）───────────────
export const DIRS = [
    { sym: '↓', deg: 180 }, { sym: '→', deg: 90 }, { sym: '↘', deg: 135 }, { sym: '↗', deg: 45 },
];
const DIR_TIP_KEYS = {
    '↓': 'dirDown', '→': 'dirRight', '↘': 'dirDownRight', '↗': 'dirUpRight',
};
export function getDirTip(sym) {
    return t('widgets.colorCore.' + (DIR_TIP_KEYS[sym] || 'dirDown'));
}

const CSS_DIR_MAP = {
    '↖': 'to top left', '↑': 'to top', '↗': 'to top right',
    '←': 'to left',                     '→': 'to right',
    '↙': 'to bottom left', '↓': 'to bottom', '↘': 'to bottom right',
};
/**
 * 方向符号转 CSS gradient 方向字符串
 * @param {string} dir - 方向符号
 * @returns {string} CSS 方向字符串
 */
export function cssGradientDir(dir) { return CSS_DIR_MAP[dir] || 'to bottom'; }

/**
 * 将平滑渐变转为硬边渐变 CSS 字符串
 * @param {string} dir - CSS 渐变方向
 * @param {Array<{hex:string,p:number}>} stops - 色标数组
 * @returns {string} linear-gradient CSS 字符串
 */
export function sharpGradientCSS(dir, stops) {
    if (stops.length === 2) {
        return `linear-gradient(${dir}, ${stops[0].hex} 0%, ${stops[0].hex} 30%, ${stops[1].hex} 70%, ${stops[1].hex} 100%)`;
    } else if (stops.length === 3) {
        return `linear-gradient(${dir}, ${stops[0].hex} 0%, ${stops[0].hex} 18%, ${stops[1].hex} 42%, ${stops[1].hex} 58%, ${stops[2].hex} 82%, ${stops[2].hex} 100%)`;
    }
    const parts = stops.map(s => `${s.hex} ${Math.round(s.p * 100)}%`).join(', ');
    return `linear-gradient(${dir}, ${parts})`;
}

// ── 预设数据 ──────────────────────────────────────────────
// SOLID_PRESETS / GRAY_PRESETS / GRAD_PRESETS 为设计系统调色板数据，
// 已从 color-core.js 外置到 web/data/color-palettes.json，通过 palettesPromise 动态加载后填充。
export const SOLID_PRESETS = [];
export const GRAY_PRESETS = [];
export const GRAD_PRESETS = [];

// ── 上色核心：将颜色状态写入节点 ──────────────────────────
// state 为纯数据快照：
// {
//   stopCount: 1|2|3,
//   editTarget: 'hdr'|'bg'|'sync',              // 始终有效：单色 = 两区域各自纯色；渐变 = 整体渐变
//   title: {h,s,v}, bg: {h,s,v},                // 单色模式两个目标（标题色 / 面板色）
//   dir: '↓', stops: [{p,h,s,v}, ...],          // 整体渐变（标题与面板共用同渐变）
//   titleStyle: {size,color,align,weight},      // 始终写入
// }
// 不触发任何刷新；调用方负责 canvas.setDirty / DOM 渐变刷新。

/**
 * 设置节点标题文字颜色：优先写入实例属性，避免污染同类全部节点。
 * 若 LiteGraph 渲染层必须从类静态属性读取，则仅在首次为该类设置时同步写入 constructor。
 * @param {Object} n - ComfyUI 节点实例
 * @param {string} titleHex - 标题背景 HEX 色值
 */
function setNodeTitleTextColor(n, titleHex) {
    if (!n || !titleHex) return;
    const textColor = autoTitleTextColor(titleHex);
    n.title_text_color = textColor;
    const ctor = n.constructor;
    if (ctor && !ctor._wosaiTitleTextColorSet) {
        ctor.title_text_color = textColor;
        ctor._wosaiTitleTextColorSet = true;
    }
}

/**
 * 将颜色值写入单个节点，并触发 Vue / LiteGraph 兼容事件。
 * 这是 applyColorState / applySolidHex / applyTheme 的公共底层写入函数。
 * @param {Object} n - ComfyUI 节点实例
 * @param {string} [colorHex] - 标题色（falsy 则清除）
 * @param {string} [bgHex] - 面板色（falsy 则清除）
 * @param {Object} [opts={}] - 选项
 * @param {Object} [opts.gradient] - 渐变配置（提供则写入，否则清除）
 * @param {Object} [opts.titleStyle] - 标题样式
 * @param {boolean} [opts.updateTitleTextColor=true] - 是否根据 colorHex 更新 title_text_color
 */
export function applyNodeColor(n, colorHex, bgHex, opts = {}) {
    if (!n) return;
    const { gradient, titleStyle, updateTitleTextColor = true } = opts;
    const oldColor = n.color;
    const oldBg = n.bgcolor;
    try { delete n._wosaiForceClear; } catch (_) {}   // 重新上色 → 解除清除标记

    if (colorHex) {
        n.color = colorHex;
    } else {
        try { n.color = ''; } catch (_) { n.color = void 0; }
        try { delete n.color; } catch (_) {}
    }

    if (bgHex) {
        n.bgcolor = bgHex;
    } else {
        try { n.bgcolor = ''; } catch (_) { n.bgcolor = void 0; }
        try { delete n.bgcolor; } catch (_) {}
    }

    const colorOption = {};
    if (colorHex) colorOption.color = colorHex;
    if (bgHex) colorOption.bgcolor = bgHex;
    if (typeof n.setColorOption === "function") {
        if (Object.keys(colorOption).length) {
            n.setColorOption(colorOption);
        } else {
            n.setColorOption({ color: '', bgcolor: '' });
        }
    }

    if (gradient) {
        n._gradient = gradient;
    } else {
        try { delete n._gradient; } catch (_) {}
    }

    if (titleStyle) n._titleStyle = { ...titleStyle };

    if (updateTitleTextColor && colorHex) {
        // 渐变模式：标题文字固定用白色，直接写入属性（绕过 setNodeTitleTextColor 的自动对比度计算）
        if (gradient?.stops?.length > 1) {
            n.title_text_color = CONTRAST_LIGHT;
            const ctor = n.constructor;
            if (ctor && !ctor._wosaiTitleTextColorSet) {
                ctor.title_text_color = CONTRAST_LIGHT;
                ctor._wosaiTitleTextColorSet = true;
            }
        } else {
            setNodeTitleTextColor(n, colorHex);
        }
    }

    // Nodes 2.0 Vue 兼容：触发 property changed 事件通知 Vue 响应式更新
    if (n.graph?.trigger) {
        n.graph.trigger('node:property:changed', {
            nodeId: n.id, property: 'color', oldValue: oldColor, newValue: n.color
        });
        n.graph.trigger('node:property:changed', {
            nodeId: n.id, property: 'bgcolor', oldValue: oldBg, newValue: n.bgcolor
        });
    }
}

/**
 * 将颜色状态批量写入节点（标题色 + 面板色 + 渐变 + 标题样式）
 * @param {Array<Object>} nodes - ComfyUI 节点实例数组
 * @param {Object} state - 颜色状态快照
 */
export function applyColorState(nodes, state) {
    if (!nodes?.length || !state) return;
    const S = state;
    nodes.forEach(n => {
        if (S.stopCount === 1) {
            // 单色模式：按 editTarget 决定写入范围
            if (S.editTarget === 'sync') {
                // 整体上色：标题 + 面板都写
                const titleHex = hsv2hex(S.title.h, S.title.s, S.title.v);
                const bgHex = hsv2hex(S.bg.h, S.bg.s, S.bg.v);
                applyNodeColor(n, titleHex, bgHex, { titleStyle: S.titleStyle });
            } else if (S.editTarget === 'hdr') {
                // 只写标题色，同时清除面板色（互斥：颜色效果不叠加）
                const titleHex = hsv2hex(S.title.h, S.title.s, S.title.v);
                applyNodeColor(n, titleHex, null, { titleStyle: S.titleStyle });
            } else {
                // editTarget === 'bg'：只写面板色，同时清除标题色（互斥：颜色效果不叠加）
                const bgHex = hsv2hex(S.bg.h, S.bg.s, S.bg.v);
                applyNodeColor(n, null, bgHex, { titleStyle: S.titleStyle, updateTitleTextColor: false });
            }
        } else {
            // 渐变模式：标题色 = stops[0]，面板色 = 暗版，两个都写
            const s0 = S.stops[0];
            const titleHex = hsv2hex(s0.h, s0.s, s0.v);
            const d = deriveDarkBg(s0.h, s0.s, s0.v);
            const bgHex = hsv2hex(d.h, d.s, d.v);
            applyNodeColor(n, titleHex, bgHex, {
                gradient: {
                    mode: 'sync',
                    dir: S.dir,
                    stops: S.stops.map(s => ({ p: s.p, hex: hsv2hex(s.h, s.s, s.v) })),
                },
                titleStyle: S.titleStyle,
            });
        }
    });
}

// 单一纯色（覆盖模式）：给 node 分配一个固定的纯色方案。
// 支持 Widget Title 颜色降级，因此调用方可以直接复用。
/**
 * 给节点批量应用单一纯色方案
 * @param {Array<Object>} nodes - ComfyUI 节点实例数组
 * @param {string} hex - 6位 HEX 色值
 * @param {boolean} [titleStyle] - 是否覆盖标题样式
 */
export function applySolidHex(nodes, hex, titleStyle) {
    if (!nodes?.length || !hex) return;
    const hsv = hex2hsv(hex);
    const b = deriveDarkBg(hsv.h, hsv.s, hsv.v);
    const bgHex = hsv2hex(b.h, b.s, b.v);
    nodes.forEach(n => {
        applyNodeColor(n, hex, bgHex, { titleStyle });
    });
}
