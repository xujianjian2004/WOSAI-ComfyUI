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
 * 为弹出式面板 / 浮层添加「任意位置拖拽」能力。
 *
 * 这是全项目唯一的拖拽实现：`web/panel-drag.js` 的全局自动接管，以及
 * link-fx / visual-fx / color-bar / save-node / layout-align 的显式调用，
 * 全部收敛于此。历史上这里与 panel-drag 各有一份同名实现，仅靠一个
 * `panel._wosaiDraggable` 标记去重，漏写即双重绑定（两套 handler 同时改写
 * left/top，且基准算法不同：offsetLeft vs getBoundingClientRect）。
 *
 * @param {HTMLElement} panel - 被拖拽的元素（通常 position:fixed）
 * @param {{
 *   handle?: HTMLElement,
 *   cursor?: string,
 *   clamp?: boolean,
 *   threshold?: number,
 *   onDragStart?: (e: PointerEvent) => void,
 *   onDragEnd?: (e: PointerEvent) => void,
 * }} [opts] - handle 缺省为面板自身；clamp 缺省为 true（约束在视口内）
 * @returns {() => void} 解绑函数（重复调用安全）
 */
export function makeDraggable(panel, opts = {}) {
    if (!panel) return () => {};
    // 已绑定则复用既有清理函数，永不叠加第二套 handler
    if (panel._wosaiDraggable) return panel._wosaiDragCleanup || (() => {});
    const handle = opts.handle || panel;
    const threshold = opts.threshold ?? 4;
    const clamp = opts.clamp !== false;
    const origCursor = handle.style.cursor;
    if (!origCursor) handle.style.cursor = opts.cursor || 'grab';
    panel._wosaiDraggable = true;

    let dragging = false, startX = 0, startY = 0, baseLeft = 0, baseTop = 0, origTransition = '';

    function onMove(e) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!dragging) {
            // 阈值：避免点击控件时的亚像素抖动被当成拖拽
            if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
            dragging = true;
            panel.dataset.wosaiManualPosition = 'true';
            handle.style.cursor = 'grabbing';
            handle.classList.add('ws-dragging');
            opts.onDragStart?.(e);
        }
        let nx = baseLeft + dx;
        let ny = baseTop + dy;
        if (clamp) {
            const w = panel.offsetWidth, h = panel.offsetHeight;
            nx = Math.max(0, Math.min(nx, window.innerWidth - w));
            ny = Math.max(0, Math.min(ny, window.innerHeight - h));
        }
        panel.style.left = nx + 'px';
        panel.style.top = ny + 'px';
    }

    function onUp(e) {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        panel.style.transition = origTransition;
        document.body.style.userSelect = '';
        if (dragging) {
            handle.style.cursor = origCursor;
            handle.classList.remove('ws-dragging');
            opts.onDragEnd?.(e);
        }
        dragging = false;
    }

    function onDown(e) {
        if (e.button !== 0) return;
        const el = e.target;
        if (el.isContentEditable ||
            el.closest?.("button, a, input, select, textarea, [role='button'], [data-no-drag], .ws-no-drag")) return;
        dragging = false;
        startX = e.clientX;
        startY = e.clientY;
        // right/bottom 与 left/top 混用会互相打架：先换算成等效的 left/top
        const r = panel.getBoundingClientRect();
        if (panel.style.right || panel.style.bottom) {
            panel.style.left = r.left + 'px';
            panel.style.top = r.top + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        }
        // 百分比 left/top 不可靠，回退到 getBoundingClientRect
        const rawLeft = panel.style.left;
        const rawTop = panel.style.top;
        baseLeft = (rawLeft && !rawLeft.includes('%')) ? parseFloat(rawLeft) : r.left;
        baseTop = (rawTop && !rawTop.includes('%')) ? parseFloat(rawTop) : r.top;
        origTransition = panel.style.transition;
        panel.style.transition = 'none';
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
        document.body.style.userSelect = 'none';
    }

    handle.addEventListener('pointerdown', onDown);

    const cleanup = () => {
        handle.removeEventListener('pointerdown', onDown);
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        document.body.style.userSelect = '';
        handle.style.cursor = origCursor;
        handle.classList.remove('ws-dragging');
        panel._wosaiDraggable = false;
        panel._wosaiDragCleanup = null;
    };
    // 全局自动接管（panel-drag.js）靠这个钩子批量解绑
    panel._wosaiDragCleanup = cleanup;
    return cleanup;
}
