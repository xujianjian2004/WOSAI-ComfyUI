// ── WOSAI SVG 图标库 — 统一管理 UI 图标，替代 emoji ──
// 所有图标继承 currentColor，尺寸 18x18，viewBox 为 0 0 24 24

/** @type {Record<string, string>} 图标名 → SVG 路径 */
const ICONS = { close: '<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    export: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    import_: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    random: '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/>',
    reset: '<polyline points="1 4 1 10 7 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    folder: '<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    lightbulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 00-7 7c0 2.4 1.2 4.5 3 5.7V17a2 2 0 002 2h4a2 2 0 002-2v-2.3c1.8-1.2 3-3.3 3-5.7a7 7 0 00-7-7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    hamburger: '<line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="18" x2="21" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    eyedropper: '<path d="M11 7l6 6" stroke="currentColor" stroke-width="2"/><path d="M4 16L15.7 4.3a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4L8 20H4v-4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    orangeDot: '<circle cx="12" cy="12" r="7" fill="var(--ws-accent)"/>',
    bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    search: '<circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" stroke-width="2"/><line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    check: '<polyline points="20 6 9 17 4 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    chevronRight: '<polyline points="9 18 15 12 9 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    // 主题模式图标
    auto: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>',
    sun: '<circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="1" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="21" x2="12" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="1" y1="12" x2="3" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="21" y1="12" x2="23" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
};

/**
 * 创建 SVG DOM 元素
 * @param {string} name 图标名
 * @param {number} [size=18] 像素尺寸
 * @param {{color?:string, block?:boolean}} [opts] color 覆盖颜色，block 设 display:block
 * @returns {SVGElement}
 */
export function iconEl(name, size = 18, opts = {}) {
    const d = ICONS[name];
    if (!d) { const el = document.createElement('span'); el.textContent = '?'; return el; }
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', 'none');
    svg.style.cssText = `flex-shrink:0;vertical-align:middle;${opts.block ? 'display:block;' : ''}${opts.color ? 'color:' + opts.color + ';' : ''}`;
    svg.innerHTML = d;
    return svg;
}

/**
 * 创建带 SVG 图标和文字的按钮
 * @param {string} iconName 图标名
 * @param {string} text 按钮文字
 * @param {number} [size=18]
 * @returns {HTMLButtonElement}
 */
export function iconBtn(iconName, text, size = 18) {
    const b = document.createElement('button');
    b.style.cssText = "display:inline-flex;align-items:center;gap:var(--ws-gap-sm);width:100%;height:var(--ws-btn-h);border-radius:var(--ws-radius);border:var(--ws-border-width-thin) solid var(--ws-border);background:var(--ws-surface-2);color:var(--ws-text);font-size:var(--ws-text-md);cursor:pointer;margin-top:var(--ws-gap);padding:0 var(--ws-gap-lg);justify-content:center";
    b.appendChild(iconEl(iconName, size));
    const span = document.createElement('span'); span.textContent = text; b.appendChild(span);
    return b;
}

/**
 * 创建带 SVG 图标的关闭按钮 (✕)
 * @param {number} [size=18]
 * @returns {HTMLSpanElement}
 */
export function closeIcon(size = 18) {
    const s = document.createElement('span');
    s.setAttribute('data-no-drag', '');
    s.style.cssText = 'cursor:pointer;color:var(--ws-text-secondary);display:inline-flex;align-items:center';
    s.appendChild(iconEl('close', size));
    return s;
}

/**
 * 创建橙色 WOSAI 品牌圆点 (替代 🟠)
 * @param {number} [size=14]
 * @returns {SVGElement}
 */
export function orangeDotIcon(size = 14) {
    return iconEl('orangeDot', size, { block: false });
}
