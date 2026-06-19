// ========== WOSAI NodeColor Core ==========
// 上色核心模块：颜色转换、预设数据、渐变算法、节点写入。
// 由 node-color.js（主面板）与未来的 color-bar.js（HUD 工具条）共用。
// 本模块为纯逻辑层：不创建 DOM、不调用 canvas.setDirty —— 由调用方负责刷新。

// ── 颜色转换 ──────────────────────────────────────────────
export function hsv2hex(h, s, v) {
    s /= 100; v /= 100;
    const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return '#' + [f(5), f(3), f(1)].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
}

export function hex2hsv(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0, sv = mx ? d / mx : 0;
    if (d) { if (mx === r) h = ((g - b) / d + 6) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; }
    return { h: Math.round(h), s: Math.round(sv * 100), v: Math.round(mx * 100) };
}

export function hexLuminance(hex) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function hex2rgb(hex) {
    return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

// 根据背景亮度自动选择标题文字颜色
export function autoTitleTextColor(bgHex) {
    return hexLuminance(bgHex) > 128 ? '#1a1a1a' : '#ffffff';
}

// ── 派生算法（单一来源，原 node-color.js 中重复 3 处） ──────
// 由标题色自动衍生面板暗版
export function deriveDarkBg(h, s, v) {
    return { h, s: Math.min(100, Math.round(s * 1.1)), v: Math.max(8, Math.round(v * 0.42)) };
}

// 三色渐变中间色：色相偏移 +30°，饱和度/亮度取两端较高者
export function deriveMidStop(s0, s1) {
    return {
        h: (Math.round((s0.h + s1.h) / 2) + 30) % 360,
        s: Math.min(100, Math.round(Math.max(s0.s, s1.s) * 0.9)),
        v: Math.min(100, Math.round(Math.max(s0.v, s1.v) * 0.8)),
    };
}

// 随机色：限制 S/V 范围保证标题文字可读性
export function randomHSV(opts = {}) {
    const { sMin = 45, sMax = 90, vMin = 35, vMax = 80 } = opts;
    return {
        h: Math.floor(Math.random() * 360),
        s: sMin + Math.floor(Math.random() * (sMax - sMin + 1)),
        v: vMin + Math.floor(Math.random() * (vMax - vMin + 1)),
    };
}

// ── 渐变方向（8 个方向：上/下/左/右 + 四个对角线，2行×4列排列）───────────────
export const DIRS = [
    { sym: '↑', deg: 0 }, { sym: '←', deg: 270 }, { sym: '↖', deg: 315 }, { sym: '↗', deg: 45 },
    { sym: '↓', deg: 180 }, { sym: '→', deg: 90 }, { sym: '↙', deg: 225 }, { sym: '↘', deg: 135 },
];
export const DIR_TIPS = {
    '↖': '左上渐暗', '↑': '向上渐暗', '↗': '右上渐暗',
    '←': '向左渐暗',                  '→': '向右渐暗',
    '↙': '左下渐暗', '↓': '向下渐暗', '↘': '右下渐暗',
};

const DEG_MAP = {
    '↖': '315deg', '↑': '0deg', '↗': '45deg',
    '←': '270deg',              '→': '90deg',
    '↙': '225deg', '↓': '180deg', '↘': '135deg',
};
export function degOf(dir) { return DEG_MAP[dir] || '180deg'; }

const CSS_DIR_MAP = {
    '↖': 'to top left', '↑': 'to top', '↗': 'to top right',
    '←': 'to left',                     '→': 'to right',
    '↙': 'to bottom left', '↓': 'to bottom', '↘': 'to bottom right',
};
export function cssGradientDir(dir) { return CSS_DIR_MAP[dir] || 'to bottom'; }

// 将平滑渐变转为硬边渐变：两端保持纯色，中间窄带快速过渡，拉开方向辨识度
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
export const SOLID_PRESETS = [
    { n: '红色', e: 'Red', h: '#C0392B', b: '#7B241C' }, { n: '棕色', e: 'Brown', h: '#A0522D', b: '#5D2E1A' },
    { n: '橙色', e: 'Orange', h: '#D35400', b: '#873600' }, { n: '金色', e: 'Gold', h: '#D4AC0D', b: '#7D6608' },
    { n: '绿色', e: 'Green', h: '#1E8449', b: '#145A32' }, { n: '深青', e: 'Teal', h: '#117A65', b: '#0E6655' },
    { n: '深蓝', e: 'Dark Blue', h: '#1A5276', b: '#0E344C' }, { n: '蓝色', e: 'Blue', h: '#2471A3', b: '#154360' },
    { n: '紫色', e: 'Purple', h: '#6C3483', b: '#4A235A' }, { n: '粉红', e: 'Pink', h: '#E91E63', b: '#880E4F' },
    { n: '灰色', e: 'Gray', h: '#4A4A4A', b: '#1c1c1c' }, { n: '炭黑', e: 'Charcoal', h: '#2C3E50', b: '#1A252F' },
];

// 灰度色卡（Shift 切换）：12 级，由亮到暗
export const GRAY_PRESETS = [
    { n: '灰95', e: 'G95', h: '#F2F2F2', b: '#A6A6A6' }, { n: '灰85', e: 'G85', h: '#D9D9D9', b: '#8C8C8C' },
    { n: '灰75', e: 'G75', h: '#BFBFBF', b: '#737373' }, { n: '灰65', e: 'G65', h: '#A6A6A6', b: '#595959' },
    { n: '灰55', e: 'G55', h: '#8C8C8C', b: '#404040' }, { n: '灰48', e: 'G48', h: '#7A7A7A', b: '#363636' },
    { n: '灰40', e: 'G40', h: '#666666', b: '#2B2B2B' }, { n: '灰33', e: 'G33', h: '#545454', b: '#232323' },
    { n: '灰26', e: 'G26', h: '#424242', b: '#1C1C1C' }, { n: '灰20', e: 'G20', h: '#333333', b: '#161616' },
    { n: '灰14', e: 'G14', h: '#242424', b: '#101010' }, { n: '灰8', e: 'G8', h: '#141414', b: '#0A0A0A' },
];

export const GRAD_PRESETS = [
    { n: '日落', e: 'Sunset', s: [{ h: 0, s: 78, v: 83 }, { h: 15, s: 88, v: 45 }] },
    { n: '珊瑚', e: 'Coral', s: [{ h: 8, s: 60, v: 62 }, { h: 356, s: 55, v: 32 }] },
    { n: '松石', e: 'Turquoise', s: [{ h: 175, s: 52, v: 55 }, { h: 182, s: 56, v: 28 }] },
    { n: '森林', e: 'Forest', s: [{ h: 120, s: 68, v: 70 }, { h: 145, s: 78, v: 28 }] },
    { n: '海洋', e: 'Ocean', s: [{ h: 175, s: 72, v: 72 }, { h: 195, s: 82, v: 28 }] },
    { n: '天空', e: 'Sky', s: [{ h: 210, s: 78, v: 78 }, { h: 228, s: 84, v: 32 }] },
    { n: '薰衣草', e: 'Lavender', s: [{ h: 255, s: 68, v: 74 }, { h: 275, s: 76, v: 28 }] },
    { n: '粉红', e: 'Pink', s: [{ h: 315, s: 64, v: 72 }, { h: 335, s: 78, v: 28 }] },
    { n: '霓虹', e: 'Neon', s: [{ h: 280, s: 78, v: 82 }, { h: 320, s: 86, v: 38 }] },
    { n: '靛蓝', e: 'Indigo', s: [{ h: 232, s: 58, v: 54 }, { h: 242, s: 60, v: 28 }] },
    { n: '黑白', e: 'Mono', s: [{ h: 0, s: 0, v: 52 }, { h: 0, s: 0, v: 18 }] },
    { n: '灰蓝', e: 'Slate', s: [{ h: 215, s: 28, v: 48 }, { h: 222, s: 38, v: 18 }] },
];

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
export function applyColorState(nodes, state) {
    if (!nodes?.length || !state) return;
    const S = state;
    nodes.forEach(n => {
        // 颜色（标题色）：单色 = 标题目标；渐变 = 取 stops 首端色
        let titleHex, bgHex;
        if (S.stopCount === 1) {
            // 单色模式：title / bg 各自独立，sync 时两端保持一致（标题色 = 面板色 ）
            if (S.editTarget === 'sync') {
                titleHex = hsv2hex(S.title.h, S.title.s, S.title.v);
                bgHex = hsv2hex(S.bg.h, S.bg.s, S.bg.v);
            } else if (S.editTarget === 'hdr') {
                titleHex = hsv2hex(S.title.h, S.title.s, S.title.v);
                bgHex = n.bgcolor || deriveDarkBgHex(S.title.h, S.title.s, S.title.v);
            } else {
                bgHex = hsv2hex(S.bg.h, S.bg.s, S.bg.v);
                titleHex = n.color || deriveLightBgHex(S.bg.h, S.bg.s, S.bg.v);
            }
        } else {
            // 渐变模式：取 stops 首端色作为标题色，面板色自动衍暗版
            const s0 = S.stops[0];
            titleHex = hsv2hex(s0.h, s0.s, s0.v);
            const d = deriveDarkBg(s0.h, s0.s, s0.v);
            bgHex = hsv2hex(d.h, d.s, d.v);
        }

        n.color = titleHex;
        n.bgcolor = bgHex;
        if (typeof n.setColorOption === "function") n.setColorOption({ color: titleHex, bgcolor: bgHex });
        n.constructor.title_text_color = autoTitleTextColor(titleHex);

        // ── 渐变写入 ──
        // 节点数据结构：
        //   n._gradient = null                              // 无渐变
        //   n._gradient = { mode: 'sync', dir, stops }      // 整体渐变
        if (S.stopCount === 1) {
            delete n._gradient;
        } else {
            n._gradient = {
                mode: 'sync',
                dir: S.dir,
                stops: S.stops.map(s => ({ p: s.p, hex: hsv2hex(s.h, s.s, s.v) })),
            };
        }

        if (S.titleStyle) n._titleStyle = { ...S.titleStyle };
    });
}

// 派生浅色背景（面板色反向使用）
function deriveLightBgHex(h, s, v) {
    return hsv2hex(h, Math.min(100, Math.round(s * 0.9)), Math.min(100, Math.round(v * 0.95)));
}
function deriveDarkBgHex(h, s, v) {
    const d = deriveDarkBg(h, s, v);
    return hsv2hex(d.h, d.s, d.v);
}

// 便捷封装：以单一 hex 为节点上色（标题色 + 自动衍生暗版面板）
// ColorBar / 随机色 / 批量配色共用入口
// 注：标题色直接写入原 hex（不经 HSV 往返，避免 ±1 取整损耗），仅暗版走派生
export function applySolidHex(nodes, hex, titleStyle) {
    if (!nodes?.length || !hex) return;
    const t = hex2hsv(hex);
    const b = deriveDarkBg(t.h, t.s, t.v);
    const bgHex = hsv2hex(b.h, b.s, b.v);
    nodes.forEach(n => {
        const oldColor = n.color;
        const oldBg = n.bgcolor;
        n.color = hex;
        n.bgcolor = bgHex;
        if (typeof n.setColorOption === "function") n.setColorOption({ color: hex, bgcolor: bgHex });
        n.constructor.title_text_color = autoTitleTextColor(hex);
        if (titleStyle) n._titleStyle = { ...titleStyle };
        delete n._gradient;
        // v10 Nodes 2.0 Vue 兼容：触发 property changed 事件通知 Vue 响应式更新
        if (n.graph?.trigger) {
            n.graph.trigger('node:property:changed', {
                nodeId: n.id,
                property: 'color',
                oldValue: oldColor,
                newValue: hex
            });
            n.graph.trigger('node:property:changed', {
                nodeId: n.id,
                property: 'bgcolor',
                oldValue: oldBg,
                newValue: bgHex
            });
        }
    });
}
