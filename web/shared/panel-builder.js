/**
 * 面板构建辅助函数
 * 提取自 visual-fx.js / link-fx.js / settings.js，消除重复代码
 */

/**
 * 创建分段标题行
 * @param {string} text - 标题文本
 * @param {Object} [style] - 额外样式
 * @returns {HTMLDivElement}
 */
export function _sec(text, style) {
    const d = document.createElement("div");
    d.textContent = text;
    d.style.cssText = style || "font-size:var(--ws-text-md);color:var(--ws-text-secondary);margin:var(--ws-gap-md) 0 var(--ws-gap)";
    return d;
}

/**
 * 创建水平排列行
 * @param {Object} [style] - 额外样式
 * @returns {HTMLDivElement}
 */
export function _row(style) {
    const d = document.createElement("div");
    d.style.cssText = style || "display:flex;align-items:center;gap:var(--ws-gap-md)";
    return d;
}


