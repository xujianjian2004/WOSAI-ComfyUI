/**
 * WOSAI 统一 Toast 通知系统
 * 消除 node-bookmark.js / layout-toolkit.js / color-bar.js 中的重复 Toast 创建代码
 */

import { glassT, getGlassTheme } from './glass-theme.js';
import { iconEl } from './svg-icons.js';
import { hideTip } from './tooltip.js';

let _toastEl = null, _toastTimer = null, _flashEl = null, _flashTimer = null;

/**
 * 通用 Toast 通知（底部居中，支持图标）
 * @param {string} msg - 消息文本
 * @param {Object} [opts={}] - 配置
 * @param {string} [opts.icon] - 图标名称（如 'check' / 'warning'）
 * @param {string} [opts.iconColor] - 图标颜色
 * @param {number} [opts.duration=2000] - 显示时长(ms)
 */
export function showToast(msg, opts = {}) {
    const { icon, iconColor, duration = 2000 } = opts;
    const T = glassT();

    if (!_toastEl) {
        _toastEl = document.createElement("div");
        // 防御: 创建时 display:none + opacity:0，防止未初始化时在 DOM 中可见
        _toastEl.style.cssText = `display:none;opacity:0;align-items:center;gap:var(--ws-gap);position:fixed;z-index:var(--ws-z-toast);bottom:var(--ws-toast-bottom);left:50%;transform:translateX(-50%);padding:var(--ws-toast-padding);border-radius:var(--ws-toast-radius);background:${T.glass};backdrop-filter:${T.blur};-webkit-backdrop-filter:${T.blur};border:${T.border};color:${T.text};font-size:var(--ws-text-md);box-shadow:${T.shadow};white-space:nowrap;width:fit-content;max-width:80vw;height:auto;min-height:0;max-height:none;overflow:hidden;transition:opacity .3s`;
        document.body.appendChild(_toastEl);
    }
    _toastEl.setAttribute("data-theme", getGlassTheme());
    _toastEl.innerHTML = "";
    if (icon) _toastEl.appendChild(iconEl(icon, 18, iconColor ? { color: iconColor } : undefined));
    const span = document.createElement("span");
    span.textContent = msg;
    _toastEl.appendChild(span);
    _toastEl.style.display = "inline-flex";
    _toastEl.style.opacity = "1";

    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { if (_toastEl) { _toastEl.style.opacity = "0"; _toastEl.style.display = "none"; } }, duration);
}

/**
 * 在元素旁显示短暂提示（替代 color-bar.js 的 flash）
 * @param {HTMLElement} el - 锚定元素
 * @param {string} msg - 消息文本
 * @param {number} [duration=3000] - 显示时长(ms)
 */
export function flashToast(el, msg, duration = 3000) {
    if (!el) { showToast(msg, { duration }); return; }
    const T = glassT();
    hideTip();
    const tip = document.createElement("div");
    tip.textContent = msg;
    tip.style.cssText = `position:fixed;padding:var(--ws-toast-flash-padding);background:${T.glass};backdrop-filter:${T.blur};-webkit-backdrop-filter:${T.blur};color:${T.text};font-size:var(--ws-text-base);border-radius:var(--ws-gap-sm);z-index:var(--ws-z-flash);pointer-events:none;white-space:nowrap;width:fit-content;max-width:var(--ws-toast-flash-max-width);height:auto;max-height:none;transform:translateX(-50%);border:${T.border}`;
    document.body.appendChild(tip);
    const r = el.getBoundingClientRect();
    const top = r.top - tip.offsetHeight - 6;
    tip.style.left = (r.left + r.width / 2) + "px";
    tip.style.top = (top < 4 ? r.bottom + 6 : top) + "px";
    setTimeout(() => tip.remove(), duration);
}

/**
 * 快速简单提示（替代 layout-toolkit.js 的 _flash）
 * @param {string} msg - 消息文本
 * @param {number} [duration=1400] - 显示时长(ms)
 */
// 计算提示位置：选中节点上方居中（屏幕坐标），无选中则视口顶部居中
function _toastAnchor(el) {
    const tr = el.getBoundingClientRect();
    const c = window.app?.canvas;
    if (c?.ds && c?.canvas && c.graph) {
        const sel = [...(c.graph._nodes || [])].filter(n => n.is_selected && n.pos && n.size);
        if (sel.length) {
            const rect = c.canvas.getBoundingClientRect();
            const sc = c.ds.scale, ox = c.ds.offset[0], oy = c.ds.offset[1];
            const TH = (window.LiteGraph && window.LiteGraph.NODE_TITLE_HEIGHT) || 0;
            let minX = Infinity, minTitleY = Infinity, maxX = -Infinity, maxBottomY = -Infinity;
            for (const n of sel) {
                const sx = rect.left + (n.pos[0] + ox) * sc;
                const sy = rect.top + (n.pos[1] + oy) * sc;          // 内容区顶部
                const sw = n.size[0] * sc, sh = n.size[1] * sc;
                const titleY = sy - TH * sc;                          // 标题栏顶部
                if (sx < minX) minX = sx;
                if (titleY < minTitleY) minTitleY = titleY;
                if (sx + sw > maxX) maxX = sx + sw;
                if (sy + sh > maxBottomY) maxBottomY = sy + sh;
            }
            let x = minX + (maxX - minX) / 2 - tr.width / 2;
            // 以下 8/10 为运行时计算的像素偏移，属于动态定位。
            let y = minTitleY - tr.height - 10;                      // 节点标题上方十单位偏移
            if (y < 8) y = maxBottomY + 10;                          // 上方太挤 → 放节点下方
            x = Math.max(8, Math.min(x, window.innerWidth - tr.width - 8));
            y = Math.max(8, Math.min(y, window.innerHeight - tr.height - 8));
            return { x, y };
        }
    }
    // 64px 为兜底居中位置，属于运行时动态计算，不 token 化
    return { x: Math.round((window.innerWidth - tr.width) / 2), y: 64 };   // 兜底：顶部居中
}

export function quickToast(msg, duration = 1400) {
    const T = glassT();
    if (!_flashEl) {
        _flashEl = document.createElement("div");
        _flashEl.className = "wosai-al-toast";
        // 防御: 创建时立即隐藏，防止未初始化时残留 DOM 中可见
        _flashEl.style.cssText = "display:none;opacity:0;pointer-events:none";
        document.body.appendChild(_flashEl);
    }
    _flashEl.setAttribute("data-theme", getGlassTheme());
    _flashEl.textContent = msg;
    // ⚠ top/bottom 都显式赋值（含 top:auto 兜底），避免 .wosai-al-toast 类的 top:64px 与内联同时生效撑成长条
    _flashEl.style.cssText = `position:fixed;left:0;top:0;bottom:auto;transform:none;padding:var(--ws-toast-padding);border-radius:var(--ws-toast-radius);background:${T.glass};backdrop-filter:${T.blur};-webkit-backdrop-filter:${T.blur};border:${T.border};color:${T.text};font-size:var(--ws-text-md);box-shadow:${T.shadow};z-index:var(--ws-z-toast);white-space:nowrap;width:fit-content;max-width:80vw;height:auto;min-height:0;max-height:none;overflow:hidden;pointer-events:none;transition:opacity .3s`;
    _flashEl.style.display = "block";
    _flashEl.style.opacity = "1";
    // 定位到选中节点上方居中；无选中则视口顶部居中
    const pos = _toastAnchor(_flashEl);
    _flashEl.style.left = pos.x + "px";
    _flashEl.style.top = pos.y + "px";
    clearTimeout(_flashTimer);
    _flashTimer = setTimeout(() => { if (_flashEl) { _flashEl.style.opacity = "0"; _flashEl.style.display = "none"; } }, duration);
}
