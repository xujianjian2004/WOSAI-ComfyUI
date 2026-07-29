// ── WOSAI HUD 套件 hud-kit（玻璃悬浮条共享基建）──────────────────────────
//   把 ColorBar 的胶囊条构件抽成全插件共享，保证 ColorBar / 对齐条等 HUD「像素级一致」。
//   依赖：glass-theme.js（三态玻璃 token）、tooltip.js（悬停提示）。
//   - mkItem(visualEl, label, tip, hooks)  纯图标条目，含 hover 提亮/变橙 + tooltip
//   - mkBtn(iconSvg, tip, label, hooks)    32px 半透明圆底按钮（线性 SVG 图标）
//   - mkDivider(orient)                    分隔线（横/竖）
//   - applyGlassBar(el, orient)            给元素套上胶囊玻璃外观（背景/模糊/描边/阴影）
//   hooks: { onEnter(wrap), onLeave(wrap) } 可选——ColorBar 用它挂 Hold 模式的 _hoverItem，
//          其它 HUD 不传即可，行为与原 ColorBar 完全一致。
import { glassT, getGlassTheme } from "./glass-theme.js";
import { showTip, hideTip } from "./tooltip.js";

// Match ComfyUI's MiniBar: neutral monochrome at rest, accent only on hover.
const HUD_ICON_COLOR = 'var(--ws-text-secondary)';

export function mkItem(visualEl, label, tip, hooks = {}) {
    const wrap = document.createElement('div');
    const hasIcon = !!visualEl.querySelector && !!visualEl.querySelector('svg');
    wrap.className = 'wosai-hud-item';
    wrap.style.cssText = `display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${hasIcon && label ? 'var(--ws-hk-item-gap)' : '0'};cursor:pointer;user-select:none;flex-shrink:0`;
    wrap.appendChild(visualEl);
    const hasCaption = hasIcon && !!label;
    if (hasCaption) {
        const caption = document.createElement('span');
        caption.className = 'wosai-hud-caption';
        caption.textContent = label;
        caption.style.cssText = 'font:var(--ws-hk-caption-weight) var(--ws-hk-caption-size)/1 var(--ws-font-family);color:var(--ws-text-secondary);white-space:nowrap;pointer-events:none';
        wrap.appendChild(caption);
    }
    const accessibleLabel = label || tip;
    if (accessibleLabel) wrap.setAttribute('aria-label', accessibleLabel);
    wrap.setAttribute('role', 'button');
    wrap.tabIndex = 0;
    wrap.onmousedown = e => e.preventDefault();
    wrap.onkeydown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        wrap.click();
    };
    // A persistent caption is already the clearest description for an icon.
    // Only uncaptioned controls retain hover help (for example, color chips).
    wrap._tip = hasCaption ? '' : (label || tip || '');
    const _isIcon = () => hasIcon;
    wrap.onmouseenter = () => {
        visualEl.style.transform = 'scale(1.1)';
        if (_isIcon()) {
            const T = glassT();
            const isDark = getGlassTheme() === 'dark';
            // 悬停提亮色随主题切换，使用 --ws-hk-* token 而非硬编码
            visualEl.style.background = isDark ? 'var(--ws-hk-btn-hover-bg-dark)' : 'var(--ws-hk-btn-hover-bg-light)';
            visualEl.dataset.baseColor = visualEl.style.color; visualEl.style.color = T.iconAccent;
        }
        else visualEl.style.filter = 'brightness(1.4)';
        if (hooks.onEnter) hooks.onEnter(wrap);
        if (wrap._tip) showTip(wrap, wrap._tip);
    };
    wrap.onmouseleave = () => {
        visualEl.style.transform = ''; visualEl.style.filter = '';
        if (_isIcon()) {
            const T = glassT();
            visualEl.style.background = T.btnBg;
            visualEl.style.color = visualEl.dataset.baseColor || HUD_ICON_COLOR;
        }
        if (hooks.onLeave) hooks.onLeave(wrap);
        hideTip();
    };
    return wrap;
}

export function mkBtn(iconSvg, tip, label, hooks = {}) {
    const T = glassT();
    const b = document.createElement('div');
    b.className = 'wosai-hud-icon';
    b.innerHTML = iconSvg;
    const svg = b.querySelector('svg');
    if (svg) {
        svg.style.width = 'var(--ws-hk-icon-size)';
        svg.style.height = 'var(--ws-hk-icon-size)';
        svg.style.strokeWidth = 'var(--ws-hk-icon-stroke)';
    }
    b.style.cssText = `width:var(--ws-hk-btn-size);height:var(--ws-hk-btn-size);display:flex;align-items:center;justify-content:center;border-radius:var(--ws-radius-full);background:${T.btnBg};color:${HUD_ICON_COLOR};transition:color .15s,background .15s,filter .15s,transform .12s;pointer-events:none`;
    b.dataset.baseColor = HUD_ICON_COLOR;
    return mkItem(b, label, tip, hooks);
}

export function mkDivider(orient) {
    const d = document.createElement('div');
    d.style.cssText = orient === 'v'
        ? `height:var(--ws-divider-width);width:var(--ws-hk-divider-v-w);background:${glassT().divider};flex-shrink:0;margin:var(--ws-hk-divider-margin-v);align-self:center`
        : `width:var(--ws-divider-width);height:var(--ws-hk-divider-h-h);background:${glassT().divider};flex-shrink:0;margin:var(--ws-hk-divider-margin-h);align-self:center`;
    return d;
}

// 给元素套上 ColorBar 同款胶囊玻璃外观（含初始 opacity:0 / scale(.92) 入场态）
export function applyGlassBar(el, orient = 'h') {
    const T = glassT();
    el.style.cssText = `position:fixed;z-index:var(--ws-z-hud);display:flex;flex-direction:${orient === 'v' ? 'column' : 'row'};align-items:center;gap:${orient === 'v' ? 'var(--ws-hk-bar-gap-v)' : 'var(--ws-hk-bar-gap)'};padding:var(--ws-hk-bar-padding);border-radius:var(--ws-hk-bar-radius);background:${T.glass};backdrop-filter:${T.blur};-webkit-backdrop-filter:${T.blur};border:${T.border};box-shadow:${T.shadow};opacity:0;transform:scale(.92);transition:opacity .18s ease,transform .18s ease;width:fit-content;max-width:96vw;height:auto;min-height:0;max-height:${window.innerHeight - 20}px;overflow:visible`;
}

// 模式切换（圆形按钮）：与其它 HUD 按钮同款(圆底图标 + 下方文字)，文字显示当前 HUD 模式(配色/对齐)，
//   点击切到下一模式。复用 mkBtn。
// ── HUD 多 tab 注册表：各功能模块注册 tab，ColorBar 作宿主取用；避免循环依赖 ──
//   tab: { id, label, order, build(orient)→DOM[] }
const _hudTabs = [];
let _openReqCb = null;         // (tabId) => void   请求宿主打开/切换到某 tab
export function registerHudTab(tab) {
    const i = _hudTabs.findIndex(t => t.id === tab.id);
    if (i >= 0) _hudTabs[i] = tab; else _hudTabs.push(tab);
    _hudTabs.sort((a, b) => (a.order || 0) - (b.order || 0));
}
export function unregisterHudTab(id) {
    const i = _hudTabs.findIndex(t => t.id === id);
    if (i >= 0) _hudTabs.splice(i, 1);
}
export function getHudTabs() { return _hudTabs.map(t => ({ id: t.id, label: t.label, panel: !!t.panel })); }
export function getHudTab(id) { return _hudTabs.find(t => t.id === id) || null; }
export function getHudBuilder(id) { const t = _hudTabs.find(x => x.id === id); return t ? t.build : null; }
export function onHudOpenRequest(cb) { _openReqCb = cb; }
export function offHudOpenRequest(cb) { if (_openReqCb === cb) _openReqCb = null; }
export function requestHudOpen(tabId) { if (_openReqCb) _openReqCb(tabId); }

// ── 画布前景绘制注册表：各模块注册 (ctx,canvas) 回调，由 layout-toolkit 的单一 onDrawForeground 包裹统一调用 ──
const _fgDraws = [];
export function registerForegroundDraw(fn) { if (typeof fn === 'function') _fgDraws.push(fn); }
export function unregisterForegroundDraw(fn) {
    const i = _fgDraws.indexOf(fn);
    if (i >= 0) _fgDraws.splice(i, 1);
}
export function runForegroundDraws(ctx, canvas) { for (const f of _fgDraws) { try { f(ctx, canvas); } catch (_) {} } }
