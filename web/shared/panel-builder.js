/**
 * 面板构建辅助函数
 * 提取自 visual-fx.js / link-fx.js / settings.js，消除重复代码
 *
 * 三处「玻璃质感控制面板」原本各自复刻了一遍外壳：div.wosai-control-panel +
 * data-wosai-panel / data-theme + 内联玻璃样式 + 头部（标题 + 关闭图标）+
 * 版权行 + 挂到 body + 绑定拖拽。任何一处改样式都容易漏掉另外两处，
 * 因此统一由 buildControlPanel() 产出。
 */
import { glassT, getGlassTheme } from "./glass-theme.js";
import { closeIcon } from "./svg-icons.js";
import { WOSAI_COPYRIGHT } from "./constants.js";
import { makeDraggable } from "./shared-utils.js";

const PANEL_BASE = "wosai-control-panel";
const HEADER_CLASS = "wosai-control-header";
// 头部默认吸顶（内容滚动时标题常驻），负 margin 抵消面板内边距
const HEADER_STICKY_STYLE = "display:flex;align-items:center;justify-content:space-between;font-size:var(--ws-text-xl);font-weight:500;margin-bottom:var(--ws-gap-md);position:sticky;top:calc(-1 * var(--ws-panel-padding-md));background:transparent;z-index:2;padding:var(--ws-gap-xs) 0;margin-left:calc(-1 * var(--ws-panel-padding-md));margin-right:calc(-1 * var(--ws-panel-padding-md));padding-left:var(--ws-panel-padding-md);padding-right:var(--ws-panel-padding-md)";
const HEADER_PLAIN_STYLE = "display:flex;align-items:center;justify-content:space-between;font-size:var(--ws-text-xl);font-weight:500;margin-bottom:var(--ws-gap-md)";

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

/**
 * 构建一块玻璃质感控制面板（已挂到 document.body 并绑定拖拽）
 * @param {{
 *   wsControl?: string,
 *   wsModule?: string,
 *   extraClass?: string,
 *   width?: string,
 *   title?: string,
 *   onClose?: (e: Event) => void,
 *   content?: HTMLElement | HTMLElement[],
 *   copyright?: boolean,
 *   stickyHeader?: boolean,
 * }} [opts] - width 缺省 var(--ws-panel-width-md)；copyright/stickyHeader 缺省 true
 * @returns {{ panel: HTMLDivElement, header: HTMLDivElement, cleanup: () => void }}
 */
export function buildControlPanel(opts = {}) {
    const theme = glassT();
    const width = opts.width || "var(--ws-panel-width-md)";
    const sticky = opts.stickyHeader !== false;

    const panel = document.createElement("div");
    panel.className = opts.extraClass ? `${PANEL_BASE} ${opts.extraClass}` : PANEL_BASE;
    if (opts.wsControl) panel.dataset.wsControl = opts.wsControl;
    if (opts.wsModule) panel.dataset.wsModule = opts.wsModule;
    panel.setAttribute("data-wosai-panel", "");
    panel.setAttribute("data-theme", getGlassTheme());
    panel.style.cssText = `position:fixed;display:none;z-index:var(--ws-z-hud);width:${width};box-sizing:border-box;padding:var(--ws-panel-padding-md);border-radius:var(--ws-panel-radius-md);background:${theme.glass};backdrop-filter:${theme.blur};-webkit-backdrop-filter:${theme.blur};border:var(--ws-border-width-thin) solid var(--ws-border);box-shadow:var(--ws-shadow-panel);color:var(--ws-text);font-family:var(--ws-font-family);font-size:var(--ws-text-md);user-select:none;max-height:calc(100vh - 32px);overflow-y:auto;overscroll-behavior:contain`;
    panel.onpointerdown = (event) => event.stopPropagation();

    const header = document.createElement("div");
    header.className = HEADER_CLASS;
    if (sticky) header.dataset.panelHead = "";
    header.style.cssText = sticky ? HEADER_STICKY_STYLE : HEADER_PLAIN_STYLE;
    const title = document.createElement("span");
    title.textContent = opts.title || "";
    const close = closeIcon();
    if (opts.onClose) close.onclick = opts.onClose;
    header.append(title, close);

    const children = [header];
    const content = opts.content;
    if (Array.isArray(content)) children.push(...content.filter(Boolean));
    else if (content) children.push(content);
    if (opts.copyright !== false) {
        const copyright = document.createElement("div");
        copyright.className = "wosai-control-copyright";
        copyright.textContent = WOSAI_COPYRIGHT;
        children.push(copyright);
    }
    panel.append(...children);
    document.body.appendChild(panel);

    const cleanup = makeDraggable(panel, { handle: header });
    return { panel, header, cleanup };
}
