// ========== WOSAI 玻璃主题标准（全插件共用）==========
// 三态模式：auto（默认，跟随画布亮度）/ light / dark
// 偏好全插件共享一份（localStorage 'wosai-glass-theme'）；
// 任何 UI 切换模式都会广播，已打开的其他面板可订阅联动。
//
// 用法：
//   import { getGlassMode, getGlassTheme, glassT, cycleGlassMode,
//            onGlassChange, GLASS_MODE_DEFS } from "./shared/glass-theme.js";
//   panel.setAttribute('data-theme', getGlassTheme());      // 初始
//   const off = onGlassChange(t => panel.setAttribute('data-theme', t)); // 联动
//   btn.onclick = () => cycleGlassMode();                    // 三态循环

import { app } from "../../../../scripts/app.js";
import { t } from "./i18n.js";
import { resetWOSAICache } from "./shared-utils.js";

const LS_KEY = 'wosai-glass-theme';
const GLASS_SURFACE_SELECTOR = '[data-wosai-panel]:not([data-wosai-orb]), .wosai-panel--glass';
const LS_LEGACY = 'wosai-colorbar-theme';   // 旧 ColorBar 偏好，首次迁移
const INVALIDATOR_DISPOSE_KEY = '__wosaiGlassInvalidatorDispose';

// ── 液态玻璃双 token（玻璃独有属性 + 文字/图标镜像 --ws-* CSS 令牌）──
// 注意：text/textMuted/iconColor/iconAccent 是 --ws-* CSS 令牌的 JS 镜像，
//   用于 canvas/JS 内联样式等无法引用 CSS 变量的场景。
//   修改时需同步更新 wosai-variables.css 中的对应令牌。
export const GLASS_TOKENS = {
    dark: {
        // 玻璃独有（引用 --ws-gt-* 设计 token，深色/浅色值由 glass-theme 管理）
        glass: 'var(--ws-gt-glass-dark)',
        blur: 'var(--ws-gt-blur)',
        border: 'var(--ws-gt-border-dark)',
        shadow: 'var(--ws-gt-shadow-dark)',
        divider: 'var(--ws-gt-divider-dark)',
        chipRing: 'var(--ws-gt-chip-ring-dark)',
        rowHover: 'var(--ws-gt-row-hover-dark)',
        // 文字/图标（直接引用全局 --ws-* CSS 令牌）
        text: 'var(--ws-text)',
        textMuted: 'var(--ws-text-muted)',
        btnBg: 'var(--ws-gt-btn-bg-dark)',
        iconColor: 'var(--ws-icon)',
        iconAccent: 'var(--ws-accent)',
    },
    light: {
        // 玻璃独有
        glass: 'var(--ws-gt-glass-light)',
        blur: 'var(--ws-gt-blur)',
        border: 'var(--ws-gt-border-light)',
        shadow: 'var(--ws-gt-shadow-light)',
        divider: 'var(--ws-gt-divider-light)',
        chipRing: 'var(--ws-gt-chip-ring-light)',
        rowHover: 'var(--ws-gt-row-hover-light)',
        // 文字/图标
        text: 'var(--ws-text)',
        textMuted: 'var(--ws-text-muted)',
        btnBg: 'var(--ws-gt-btn-bg-light)',
        iconColor: 'var(--ws-icon)',
        iconAccent: 'var(--ws-accent)',
    },
};

// ── 画布主题缓存（避免每次 glassT() 都重新计算）──────────────────
let _cachedCanvasLight = null;
let _cachedGlassTheme = null;

function _invalidateGlassCache() {
    _cachedCanvasLight = null;
    _cachedGlassTheme = null;
}

function _onThemeMaybeChanged() {
    // 记录当前主题（缓存可能已被 setDirty 清空，需立即计算）
    const prev = _cachedGlassTheme !== null ? _cachedGlassTheme : getGlassTheme();
    _invalidateGlassCache();
    resetWOSAICache();
    // 主题实际发生变化时广播，通知所有面板更新 data-theme
    const curr = getGlassTheme();
    if (prev !== curr) _broadcast();
}

// ── 画布背景亮度检测（body/data-theme → body 背景色 → canvas → clear_background_color 逐级回退）──
function _computeCanvasIsLight() {
    try {
        // 1. 优先：检查 ComfyUI 的 data-theme 属性（最可靠的 UI 主题信号）
        const root = document.documentElement;
        const body = document.body;
        const rootTheme = root?.getAttribute('data-theme') || body?.getAttribute('data-theme');
        if (rootTheme === 'light') return true;
        if (rootTheme === 'dark') return false;

        // 2. 检查 body 的 class 中是否包含主题关键词
        const bodyClass = body?.className || '';
        if (/\blight\b/.test(bodyClass) || /\btheme-light\b/.test(bodyClass) || /\bcomfy-light\b/.test(bodyClass)) return true;
        if (/\bdark\b/.test(bodyClass) || /\btheme-dark\b/.test(bodyClass) || /\bcomfy-dark\b/.test(bodyClass)) return false;

        // 3. 检查 body 背景色
        let c = getComputedStyle(body).backgroundColor;
        if (c && c !== 'transparent' && !/^rgba\(0,\s*0,\s*0,\s*0\)$/.test(c)) {
            let r, g, b;
            if (c.startsWith('#')) {
                const h = c.length === 4 ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c;
                r = parseInt(h.slice(1, 3), 16); g = parseInt(h.slice(3, 5), 16); b = parseInt(h.slice(5, 7), 16);
            } else {
                const m = c.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
                if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
            }
            if (r !== undefined) return (0.299 * r + 0.587 * g + 0.114 * b) > 140;
        }

        // 4. 回退：检查 canvas 元素背景色
        const canvasEl = app.canvas?.canvas;
        if (canvasEl) {
            c = getComputedStyle(canvasEl).backgroundColor;
            if (c && c !== 'transparent' && !/^rgba\(0,\s*0,\s*0,\s*0\)$/.test(c)) {
                let r, g, b;
                if (c.startsWith('#')) {
                    const h = c.length === 4 ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c;
                    r = parseInt(h.slice(1, 3), 16); g = parseInt(h.slice(3, 5), 16); b = parseInt(h.slice(5, 7), 16);
                } else {
                    const m = c.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
                    if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
                }
                if (r !== undefined) return (0.299 * r + 0.587 * g + 0.114 * b) > 140;
            }
        }

        // 5. 最后回退：clear_background_color（LiteGraph 画布背景，不随 UI 主题变化）
        const cc = app.canvas?.clear_background_color;
        if (cc && Array.isArray(cc)) {
            const r = Math.round((cc[0] || 0) * 255);
            const g = Math.round((cc[1] || 0) * 255);
            const b = Math.round((cc[2] || 0) * 255);
            return (0.299 * r + 0.587 * g + 0.114 * b) > 140;
        }

        return false;
    } catch (e) { return false; }
}

export function canvasIsLight() {
    if (_cachedCanvasLight !== null) return _cachedCanvasLight;
    _cachedCanvasLight = _computeCanvasIsLight();
    return _cachedCanvasLight;
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
    if (_cachedGlassTheme !== null) return _cachedGlassTheme;
    const m = getGlassMode();
    _cachedGlassTheme = m === 'auto' ? (canvasIsLight() ? 'light' : 'dark') : m;
    return _cachedGlassTheme;
}

export function glassT() { return GLASS_TOKENS[getGlassTheme()]; }

// 所有 WOSAI 面板、工具栏和弹窗统一使用同一份主题属性与液态玻璃表面类。
// 新旧模块只需标记 data-wosai-panel 或 wosai-panel--glass，即可免去逐个订阅主题变化。
export function syncGlassSurfaces(root = document, theme = getGlassTheme()) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const surfaces = [];
    if (root.matches?.(GLASS_SURFACE_SELECTOR)) surfaces.push(root);
    surfaces.push(...root.querySelectorAll(GLASS_SURFACE_SELECTOR));
    for (const surface of surfaces) {
        surface.setAttribute('data-theme', theme);
        surface.classList.add('wosai-glass-surface');
    }
}

// ── 变更广播 ──────────────────────────────────────────────
const _listeners = new Set();
export function onGlassChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }
function _broadcast() {
    const t = getGlassTheme();
    syncGlassSurfaces(document, t);
    // 迭代快照：回调中可能注册新订阅（如面板重建），Set.forEach 会访问
    // 迭代中新增的成员，导致同一次广播触发新订阅 → 无限循环（已踩坑）
    [..._listeners].forEach(fn => { try { fn(t, getGlassMode()); } catch (e) { console.warn("[WOSAI glass] listener error:", e); } });
}

export function setGlassMode(m) {
    try { localStorage.setItem(LS_KEY, m); } catch (e) {}
    _onThemeMaybeChanged();
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
// 使用 getter 延迟求值，确保访问时 i18n 已加载完成。
export const GLASS_MODE_DEFS = {
    get auto()  { return { label: t('widgets.glassTheme.auto'),  tip: t('widgets.glassTheme.autoTip') }; },
    get light() { return { label: t('widgets.glassTheme.light'), tip: t('widgets.glassTheme.lightTip') }; },
    get dark()  { return { label: t('widgets.glassTheme.dark'),  tip: t('widgets.glassTheme.darkTip') }; },
};

// ── 缓存失效监听：主题切换 / app.canvas.setDirty ───────────────
function _installGlassCacheInvalidators() {
    if (typeof document === 'undefined') return () => {};
    const observers = [];
    const themeEvents = ['changeTheme', 'themechange', 'comfy:themechange', 'colorPalette'];
    let surfaceFrame = 0;
    let pollFrame = 0;
    let hookedCanvas = null;
    let originalSetDirty = null;
    let wrappedSetDirty = null;

    // 1. DOM 属性变化（ComfyUI / WOSAI 主题切换通常会改 class / style / data-theme）
    if (typeof MutationObserver !== 'undefined') {
        const mo = new MutationObserver(() => _onThemeMaybeChanged());
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
        if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
        observers.push(mo);

        let syncQueued = false;
        const surfaceObserver = new MutationObserver(() => {
            if (syncQueued) return;
            syncQueued = true;
            surfaceFrame = requestAnimationFrame(() => {
                surfaceFrame = 0;
                syncQueued = false;
                syncGlassSurfaces();
            });
        });
        surfaceObserver.observe(document.documentElement, { childList: true, subtree: true });
        observers.push(surfaceObserver);
    }

    syncGlassSurfaces();

    // 2. 常见 ComfyUI 主题事件
    for (const evt of themeEvents) {
        window.addEventListener?.(evt, _onThemeMaybeChanged, true);
    }

    // 3. Hook app.canvas.setDirty：画布重绘通常意味着背景/主题可能变化
    const hookSetDirty = () => {
        const c = app.canvas;
        if (!c || c._wosaiGlassSetDirtyHooked) return;
        originalSetDirty = c.setDirty;
        wrappedSetDirty = function(...args) {
            _invalidateGlassCache();
            return originalSetDirty.apply(this, args);
        };
        c.setDirty = wrappedSetDirty;
        c._wosaiGlassSetDirtyHooked = true;
        hookedCanvas = c;
    };

    if (app.canvas) hookSetDirty();
    else {
        let tries = 0;
        const step = () => {
            if (app.canvas) { hookSetDirty(); return; }
            if (++tries > 120) return; // 最多轮询约 2 秒
            pollFrame = requestAnimationFrame(step);
        };
        pollFrame = requestAnimationFrame(step);
    }

    return () => {
        observers.forEach((observer) => observer.disconnect());
        themeEvents.forEach((event) => window.removeEventListener?.(event, _onThemeMaybeChanged, true));
        if (surfaceFrame) cancelAnimationFrame(surfaceFrame);
        if (pollFrame) cancelAnimationFrame(pollFrame);
        if (hookedCanvas?.setDirty === wrappedSetDirty) hookedCanvas.setDirty = originalSetDirty;
        if (hookedCanvas) delete hookedCanvas._wosaiGlassSetDirtyHooked;
    };
}

globalThis[INVALIDATOR_DISPOSE_KEY]?.();
globalThis[INVALIDATOR_DISPOSE_KEY] = _installGlassCacheInvalidators();
