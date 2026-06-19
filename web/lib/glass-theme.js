// ========== WOSAI 玻璃主题标准（全插件共用）==========
// 三态模式：auto（默认，跟随画布亮度）/ light / dark
// 偏好全插件共享一份（localStorage 'wosai-glass-theme'）；
// 任何 UI 切换模式都会广播，已打开的其他面板可订阅联动。
//
// 用法：
//   import { getGlassMode, getGlassTheme, glassT, cycleGlassMode,
//            onGlassChange, GLASS_MODE_DEFS } from "./lib/glass-theme.js";
//   panel.setAttribute('data-theme', getGlassTheme());      // 初始
//   const off = onGlassChange(t => panel.setAttribute('data-theme', t)); // 联动
//   btn.onclick = () => cycleGlassMode();                    // 三态循环

import { app } from "../../../scripts/app.js";

const LS_KEY = 'wosai-glass-theme';
const LS_LEGACY = 'wosai-colorbar-theme';   // 旧 ColorBar 偏好，首次迁移

// ── 液态玻璃双 token（玻璃独有属性 + 文字/图标镜像 --ws-* CSS 令牌）──
// 注意：text/textMuted/iconColor/iconAccent 是 --ws-* CSS 令牌的 JS 镜像，
//   用于 canvas/JS 内联样式等无法引用 CSS 变量的场景。
//   修改时需同步更新 wosai-variables.css 中的对应令牌。
export const GLASS_TOKENS = {
    dark: {
        // 玻璃独有
        glass: 'rgba(26,27,32,0.5)',
        blur: 'blur(40px) saturate(1.8)',
        border: '1px solid rgba(255,255,255,.16)',
        shadow: '0 8px 32px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.10)',
        divider: 'rgba(255,255,255,.16)',
        chipRing: 'rgba(255,255,255,.25)',
        rowHover: 'rgba(221,111,74,.22)',
        // 文字/图标（镜像 --ws-*，保持与 wosai-variables.css 同步）
        text: '#E4E4E7',             // --ws-text
        textMuted: '#7A7A7A',         // --ws-text-muted
        btnBg: 'rgba(255,255,255,0.08)',  // 玻璃内按钮底色：微透白，与玻璃背景形成层次
        iconColor: '#AEBFD0',         // --ws-icon
        iconAccent: '#DD6F4A',        // --ws-accent
    },
    light: {
        // 玻璃独有
        glass: 'rgba(255,255,255,0.55)',
        blur: 'blur(40px) saturate(1.8)',
        border: '1px solid rgba(0,0,0,.10)',
        shadow: '0 8px 32px rgba(0,0,0,.16), inset 0 1px 0 rgba(255,255,255,.65)',
        divider: 'rgba(0,0,0,.14)',
        chipRing: 'rgba(0,0,0,.16)',
        rowHover: 'rgba(221,111,74,.18)',
        // 文字/图标（镜像 --ws-*，保持与 wosai-variables.css 同步）
        text: '#201914',              // --ws-text
        textMuted: '#8A7A70',         // --ws-text-muted
        btnBg: 'rgba(0,0,0,0.06)',       // 玻璃内按钮底色：微透黑，与玻璃背景形成层次
        iconColor: '#5E6B7A',         // --ws-icon
        iconAccent: '#DD6F4A',        // --ws-accent
    },
};

// ── 画布背景亮度检测（clear_background_color → canvas 元素 → body 逐级回退）──
export function canvasIsLight() {
    try {
        // ComfyUI clear_background_color 可能是数组 [r,g,b]（0-1 float）或 null
        let c = app.canvas?.clear_background_color;
        if (c && Array.isArray(c)) {
            const r = Math.round((c[0] || 0) * 255);
            const g = Math.round((c[1] || 0) * 255);
            const b = Math.round((c[2] || 0) * 255);
            return (0.299 * r + 0.587 * g + 0.114 * b) > 140;
        }
        if (!c || typeof c === 'string') {
            const el = app.canvas?.canvas;
            if (el) c = getComputedStyle(el).backgroundColor;
        }
        if (!c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)') c = getComputedStyle(document.body).backgroundColor;
        if (!c) return false;
        let r, g, b;
        if (typeof c === 'string' && c.startsWith('#')) {
            const h = c.length === 4 ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c;
            r = parseInt(h.slice(1, 3), 16); g = parseInt(h.slice(3, 5), 16); b = parseInt(h.slice(5, 7), 16);
        } else if (typeof c === 'string') {
            const m = c.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
            if (!m) return false;
            r = +m[1]; g = +m[2]; b = +m[3];
        } else {
            return false;
        }
        return (0.299 * r + 0.587 * g + 0.114 * b) > 140;
    } catch (e) { return false; }
}

// ── 三态状态 ──────────────────────────────────────────────
export function getGlassMode() {
    try {
        let v = localStorage.getItem(LS_KEY);
        if (!v) {
            // 兼容迁移：沿用旧 ColorBar 偏好一次
            const legacy = localStorage.getItem(LS_LEGACY);
            if (legacy === 'dark' || legacy === 'light') { v = legacy; localStorage.setItem(LS_KEY, v); }
        }
        return (v === 'dark' || v === 'light') ? v : 'auto';
    } catch (e) { return 'auto'; }
}

export function getGlassTheme() {
    const m = getGlassMode();
    return m === 'auto' ? (canvasIsLight() ? 'light' : 'dark') : m;
}

export function glassT() { return GLASS_TOKENS[getGlassTheme()]; }

// ── 变更广播 ──────────────────────────────────────────────
const _listeners = new Set();
export function onGlassChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }
function _broadcast() {
    const t = getGlassTheme();
    // 迭代快照：回调中可能注册新订阅（如面板重建），Set.forEach 会访问
    // 迭代中新增的成员，导致同一次广播触发新订阅 → 无限循环（已踩坑）
    [..._listeners].forEach(fn => { try { fn(t, getGlassMode()); } catch (e) {} });
}

export function setGlassMode(m) {
    try { localStorage.setItem(LS_KEY, m); } catch (e) {}
    _broadcast();
}

// 三态循环：自动 → 浅色 → 深色 → 自动
export const GLASS_MODE_NEXT = { auto: 'light', light: 'dark', dark: 'auto' };
export function cycleGlassMode() {
    const next = GLASS_MODE_NEXT[getGlassMode()] || 'auto';
    setGlassMode(next);
    return next;
}

// 模式元信息（label/tip；图标由各 UI 按自身尺寸体系自配）
export const GLASS_MODE_DEFS = {
    auto:  { label: '自动', tip: '主题：自动跟随画布亮度（点击切浅色）' },
    light: { label: '浅色', tip: '主题：浅色（点击切深色）' },
    dark:  { label: '深色', tip: '主题：深色（点击切自动）' },
};
