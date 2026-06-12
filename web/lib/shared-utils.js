// ========== WOSAI 共享工具 ==========
// 由 canvas.js 和 renderer.js 共享
// 字体解析与颜色转换

export const FONT_TTL = 3000;

let _fontCache = null, _fontTime = 0;

export function getUIFont() {
    const now = Date.now();
    if (_fontCache && now - _fontTime < FONT_TTL) return _fontCache;
    const root = getComputedStyle(document.documentElement);
    for (const v of ['--font-family','--fontFamily','--p-font-family','--ui-font-family','--body-font-family']) {
        const val = root.getPropertyValue(v).trim();
        if (val && val !== 'inherit' && val !== 'initial') { _fontCache = val; _fontTime = now; return val; }
    }
    for (const sel of ['.comfy-multiline-input','.p-button','.p-panelmenu','#vue-app','#app']) {
        const el = document.querySelector(sel);
        if (el) { const ff = getComputedStyle(el).fontFamily; if (ff && !/^["']?serif/i.test(ff.trim())) { _fontCache = ff; _fontTime = now; return ff; } }
    }
    for (const el of document.querySelectorAll('button,label,span,.p-component')) {
        const ff = getComputedStyle(el).fontFamily;
        if (ff) { const lo = ff.trim().toLowerCase(); if (lo && lo !== 'serif' && !lo.startsWith('serif,')) { _fontCache = ff; _fontTime = now; return ff; } }
    }
    _fontCache = '"PingFang SC","Microsoft YaHei","Noto Sans",BlinkMacSystemFont,"Segoe UI",sans-serif';
    _fontTime = now; return _fontCache;
}

export function resetFontCache() { _fontCache = null; _fontTime = 0; }

export function hexToRGBA(hex, alpha) {
    if (typeof hex !== 'string') hex = '#333333';
    if (/^#[0-9A-Fa-f]{3}$/.test(hex)) hex = '#'+hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3];
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) hex = '#333333';
    const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${Math.max(0,Math.min(1,+alpha||0))})`;
}

// ── 共享线性图标（Tabler/Lucide 风格自绘，多彩版）──────────
// 默认 stroke=currentColor 随容器变色；多彩元素在 path 上显式指定颜色
export const wsIcon = (inner, size = 16) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;pointer-events:none">${inner}</svg>`;

export const WS_ICONS = {
    // 太阳（暖黄）
    sun: wsIcon('<circle cx="12" cy="12" r="4" stroke="#EF9F27"/><path stroke="#EF9F27" d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    // 月亮（浅金）
    moon: wsIcon('<path stroke="#FAC775" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
    // 图钉：未固定（描边随主题）/ 已固定（品牌橙）
    pin: wsIcon('<path d="M12 17v5"/><path d="M9 10.8V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v5.8l2.3 2.9a1 1 0 0 1-.8 1.6H7.5a1 1 0 0 1-.8-1.6L9 10.8z"/>'),
    pinned: wsIcon('<path stroke="#DD6F4A" d="M12 17v5"/><path stroke="#DD6F4A" fill="rgba(221,111,74,.25)" d="M9 10.8V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v5.8l2.3 2.9a1 1 0 0 1-.8 1.6H7.5a1 1 0 0 1-.8-1.6L9 10.8z"/>'),
    // 吸管（采样线橙色）
    pipette: wsIcon('<path stroke="#DD6F4A" d="M11 7l6 6"/><path d="M4 16L15.7 4.3a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4L8 20H4v-4z"/>'),
    // 骰子（五点多彩）
    dice: wsIcon('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="#E24B4A" stroke="none"/><circle cx="15.5" cy="8.5" r="1.2" fill="#EF9F27" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="#1D9E75" stroke="none"/><circle cx="8.5" cy="15.5" r="1.2" fill="#378ADD" stroke="none"/><circle cx="15.5" cy="15.5" r="1.2" fill="#7F77DD" stroke="none"/>'),
    // 主题自动模式（半填充对比圆）
    auto: wsIcon('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>'),
    // 锁：闭合（橙红警示+淡填充）/ 开口（随主题色）
    lock: wsIcon('<rect stroke="#DD6F4A" fill="rgba(221,111,74,.22)" x="5" y="11" width="14" height="9" rx="2"/><path stroke="#DD6F4A" d="M8 11V7a4 4 0 0 1 8 0v4"/><circle cx="12" cy="15.5" r="1" fill="#DD6F4A" stroke="none"/>'),
    lockOpen: wsIcon('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0"/><circle cx="12" cy="15.5" r="1" fill="currentColor" stroke="none"/>'),
};
