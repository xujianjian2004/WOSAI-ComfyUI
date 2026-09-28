// ========== WOSAI 共享工具 ==========
// 由 canvas.js 和 renderer.js 共享
// 设计令牌读取、字体缓存与通用等待/拖拽辅助

import { app } from "../../../scripts/app.js";

let _fontCache = null, _fontTime = 0;

/** 清除字体缓存，主题切换后调用 */
export function resetFontCache() { _fontCache = null; _fontTime = 0; }

const _TOKEN_ROOT = (typeof document !== 'undefined') ? document.documentElement : null;
const _WOSAI_VAR_CACHE = new Map();

/**
 * 安全读取 WOSAI CSS 自定义属性（token）
 * 读取结果会缓存，主题切换后需调用 resetWOSAICache() 刷新
 * @param {string} name - CSS 变量名（如 --ws-accent）
 * @param {*} [fallback] - 变量不存在时的回退值
 * @returns {string|*} 变量值或 fallback
 */
export function getWOSAIVar(name, fallback) {
    if (!_TOKEN_ROOT) return fallback;
    if (_WOSAI_VAR_CACHE.has(name)) return _WOSAI_VAR_CACHE.get(name);
    const v = getComputedStyle(_TOKEN_ROOT).getPropertyValue(name);
    const val = v ? v.trim() : fallback;
    _WOSAI_VAR_CACHE.set(name, val);
    return val;
}

/**
 * 读取 WOSAI CSS 自定义属性并转为数值
 * @param {string} name - CSS 变量名
 * @param {number} [fallback] - 回退数值
 * @returns {number}
 */
export function getWOSAIVarNum(name, fallback) {
    const v = getWOSAIVar(name);
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
}

/** 清除 WOSAI token 与字体缓存，主题切换后调用 */
export function resetWOSAICache() {
    _WOSAI_VAR_CACHE.clear();
    resetFontCache();
}

/**
 * 创建 WOSAI 风格 SVG 图标字符串
 * @param {string} inner - SVG 内部元素
 * @param {number} [size=16] - 图标尺寸（px）
 * @returns {string} SVG 字符串
 */
export const wsIcon = (inner, size = 16) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;pointer-events:none">${inner}</svg>`;

export const WS_ICONS = {
    sun: wsIcon('<circle cx="12" cy="12" r="4" stroke="var(--ws-sh-icon-sun)"/><path stroke="var(--ws-sh-icon-sun)" d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    moon: wsIcon('<path stroke="var(--ws-sh-icon-moon)" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
    pin: wsIcon('<path d="M12 17v5"/><path d="M9 10.8V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v5.8l2.3 2.9a1 1 0 0 1-.8 1.6H7.5a1 1 0 0 1-.8-1.6L9 10.8z"/>'),
    pinned: wsIcon('<path stroke="var(--ws-accent)" d="M12 17v5"/><path stroke="var(--ws-accent)" fill="var(--ws-sh-accent-fill)" d="M9 10.8V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v5.8l2.3 2.9a1 1 0 0 1-.8 1.6H7.5a1 1 0 0 1-.8-1.6L9 10.8z"/>'),
    pipette: wsIcon('<path d="M11 7l6 6"/><path d="M4 16L15.7 4.3a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4L8 20H4v-4z"/>', 20),
    dice: wsIcon('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/>', 20),
    auto: wsIcon('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>'),
    lock: wsIcon('<rect stroke="var(--ws-accent)" fill="var(--ws-sh-accent-fill-muted)" x="5" y="11" width="14" height="9" rx="2"/><path stroke="var(--ws-accent)" d="M8 11V7a4 4 0 0 1 8 0v4"/><circle cx="12" cy="15.5" r="1" fill="var(--ws-accent)" stroke="none"/>'),
    lockOpen: wsIcon('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0"/><circle cx="12" cy="15.5" r="1" fill="currentColor" stroke="none"/>'),
};

/**
 * 重试直到条件满足（用于等待 DOM 就绪）
 * @param {()=>boolean} condition
 * @param {number} [maxRetries=50]
 * @param {number} [interval=100]
 * @returns {Promise<void>}
 */
export function retryUntil(condition, maxRetries = 50, interval = 100) {
    return new Promise((resolve, reject) => {
        let retries = 0;
        const check = () => {
            if (condition()) return resolve();
            if (++retries >= maxRetries) return reject(new Error('retryUntil timeout'));
            setTimeout(check, interval);
        };
        check();
    });
}

/**
 * 读取 ComfyUI 设置值
 * @param {string} id - 设置项 ID
 * @param {*} [dflt] - 默认值
 * @returns {*}
 */
export function getSetting(id, dflt) {
    try {
        const v = app.ui?.settings?.getSettingValue?.(id);
        return (v === undefined || v === null) ? dflt : v;
    } catch (e) { return dflt; }
}

/**
 * 为弹出式面板添加任意位置拖拽能力
 * @param {HTMLElement} panel - 面板 DOM 元素（position:fixed）
 * @param {{ handle?: HTMLElement, onDragStart?: (e:PointerEvent)=>void, onDragEnd?: (e:PointerEvent)=>void }} [opts]
 */
export function makeDraggable(panel, opts = {}) {
    let dragging = false, startX = 0, startY = 0, origX = 0, origY = 0, origTransition = '';
    const handle = opts.handle || panel;

    function onDown(e) {
        if (e.button !== 0) return;
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable ||
            e.target.closest?.('button, a, [role="button"], [data-no-drag], .ws-no-drag')) return;
        dragging = false;
        startX = e.clientX;
        startY = e.clientY;
        origX = panel.offsetLeft;
        origY = panel.offsetTop;
        origTransition = panel.style.transition;
        panel.style.transition = 'none';
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    }

    function onMove(e) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!dragging) {
            if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
            dragging = true;
            opts.onDragStart?.(e);
            handle.style.cursor = 'grabbing';
            handle.classList.add('ws-dragging');
        }
        panel.style.left = (origX + dx) + 'px';
        panel.style.top = (origY + dy) + 'px';
    }

    function onUp(e) {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        panel.style.transition = origTransition;
        if (dragging) {
            handle.style.cursor = '';
            handle.classList.remove('ws-dragging');
            opts.onDragEnd?.(e);
        }
        dragging = false;
    }

    handle.style.cursor = 'grab';
    handle.addEventListener('pointerdown', onDown);

    return () => {
        handle.style.cursor = '';
        handle.removeEventListener('pointerdown', onDown);
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
    };
}
