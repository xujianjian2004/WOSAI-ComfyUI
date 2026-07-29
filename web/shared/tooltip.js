// 共享即时悬浮提示（统一 ColorBar / OmniSlider / NodeColor / CanvasNote 四套实现）
//   - 单例 fixed 元素，挂 body，绝不撑大任何面板
//   - mouseenter 立即显示，无原生 title 的 ~0.5s 延迟、无淡入
//   - 视口钳制：左右拉回、上方优先、顶部不够翻到下方
//   - 通过自身 data-theme + --ws-* 变量自动适配深/浅主题
//   - 全局拦截原生 title → 即时 tooltip（零延迟）
import { getGlassTheme } from './glass-theme.js';

let _tipEl = null;

/**
 * 创建或获取 tooltip DOM 元素
 * @returns {HTMLElement} tooltip 元素
 */
function _ensure() {
    if (_tipEl && document.body.contains(_tipEl)) return _tipEl;
    _tipEl = document.createElement('div');
    _tipEl.className = 'ws-tip';
    _tipEl.style.cssText =
        'position:fixed;z-index:var(--ws-z-tooltip);padding:var(--ws-tt-padding);font-size:var(--ws-tt-font-size);line-height:1.3;' +
        'white-space:nowrap!important;word-break:keep-all;pointer-events:none;border-radius:var(--ws-tt-radius);display:none;' +
        'width:max-content!important;min-width:0;max-width:min(var(--ws-tt-max-width),92vw);height:auto;min-height:0;max-height:none;' +   // !important + max-content：防止全局 CSS 把提示压成竖排长条
        'background:var(--ws-surface);color:var(--ws-text);' +
        'border:var(--ws-border-width-thin) solid var(--ws-border);box-shadow:var(--ws-tt-shadow)';
    document.body.appendChild(_tipEl);
    return _tipEl;
}

function _isCaptionedMiniBarAnchor(anchorEl) {
    return !!(
        anchorEl?.closest?.('[data-wosai-mini-caption]') ||
        anchorEl?.querySelector?.('[data-wosai-mini-caption]')
    );
}

/**
 * 在指定元素旁显示 tooltip
 * @param {HTMLElement} anchorEl - 目标锚定元素
 * @param {string} text - 提示文本
 */
export function showTip(anchorEl, text) {
    if (!text || !anchorEl) return;
    // A mini-bar caption is a persistent, correctly positioned name. Do not
    // create a second floating tip for it, including when a native toolbar
    // wrapper (rather than the button itself) is used as the anchor.
    if (_isCaptionedMiniBarAnchor(anchorEl)) {
        hideTip();
        return;
    }
    const t = _ensure();
    clearTimeout(_hideTipTimer);    // 取消淡出定时器，防止 show 之后立刻被隐藏
    try { t.setAttribute('data-theme', getGlassTheme()); } catch (_) {}
    t.textContent = text;
    t.style.display = 'block';
    t.style.opacity = '1';
    t.style.pointerEvents = 'none';
    const r = anchorEl.getBoundingClientRect();
    const tr = t.getBoundingClientRect();
    let left = r.left + r.width / 2 - tr.width / 2;
    left = Math.max(6, Math.min(left, window.innerWidth - tr.width - 6));   // 左右拉回视口
    let top = r.top - tr.height - 8;
    if (top < 6) top = r.bottom + 8;                                        // 顶部不够则显示在下方
    t.style.left = left + 'px';
    t.style.top = top + 'px';
}

/** 隐藏当前 tooltip */
let _hideTipTimer = null;
export function hideTip() {
    if (!_tipEl) return;
    _tipEl.style.opacity = '0';
    _tipEl.style.pointerEvents = 'none';
    // 淡出后隐藏，防止零宽透明条残留在 DOM 中影响布局
    clearTimeout(_hideTipTimer);
    _hideTipTimer = setTimeout(() => {
        if (_tipEl && _tipEl.style.opacity === '0') _tipEl.style.display = 'none';
    }, 200);
}

// ── 为任意 element 提供自动 tooltip ───────────────────────────
// 对已经包含有效 title 属性的元素，hover 时提取 title 显示为 tooltip
/**
 * 为元素绑定自动 tooltip（支持 title 属性或自定义文本）
 * @param {HTMLElement} el - 目标元素
 * @param {string|Function} [text] - 自定义文本或生成函数
 * @returns {HTMLElement} 原元素
 */
export function bindTip(el, text) {
    if (!el) return el;
    el.addEventListener('mouseenter', () => showTip(el, typeof text === 'function' ? text() : text));
    el.addEventListener('mouseleave', hideTip);
    return el;
}

// ── 全局拦截原生 title → 即时 tooltip（零延迟）─────────────────
// 纯事件委托方案：
//   mouseover 时向上查找带 title 的元素，立即显示 ws-tip 并临时清除原生 title
//   mouseout 时恢复原生 title、隐藏 ws-tip
//   不使用 MutationObserver，避免 title='' 触发 observer 导致文字丢失

let _titleEl = null;   // 当前正在拦截的元素
let _titleText = '';     // 暂存的原始 title 文字

function _isCaptionedMiniBarTarget(target) {
    return target?.nodeType === 1 && !!target.closest?.('[data-wosai-mini-caption]');
}

// mouseover 在画布上随鼠标高频触发，回调必须极轻：
//   ① 仍在当前已拦截元素子树内移动 → 立即 return（跳过父级遍历 + 重复 showTip，最常见路径）
//   ② Element 节点才处理（忽略文本节点等）
//   ③ passive 监听，浏览器无需等待可能的 preventDefault
document.addEventListener('mouseover', (e) => {
    // Mini-bar actions already have persistent captions. More importantly,
    // their native toolbar can carry a parent title that belongs to another
    // action, so never resolve a shared title tooltip from this subtree.
    if (_isCaptionedMiniBarTarget(e.target)) {
        if (_titleEl) {
            _titleEl.title = _titleText;
            _titleEl = null;
            _titleText = '';
            hideTip();
        }
        return;
    }
    if (_titleEl && _titleEl.contains(e.target)) return;   // 热路径：原地移动直接跳过
    let el = e.target;
    if (!el || el.nodeType !== 1) return;
    for (let i = 0; i < 4 && el && el !== document.body; i++, el = el.parentElement) {
        const t = el.title;                                // 缓存一次属性读取
        if (t) {
            if (_titleEl && _titleEl !== el) _titleEl.title = _titleText;  // 恢复上一个被拦截元素
            _titleEl = el;
            _titleText = t;
            el.title = '';            // 临时清除，阻止浏览器默认提示
            showTip(el, t);
            return;
        }
    }
}, { passive: true });

document.addEventListener('mouseout', (e) => {
    if (!_titleEl) return;
    // 仅当鼠标真正离开 _titleEl（而非进入其子元素）才收起
    if (!_titleEl.contains(e.relatedTarget)) {
        _titleEl.title = _titleText;  // 恢复原生 title
        _titleEl = null;
        _titleText = '';
        hideTip();
    }
}, { passive: true });
