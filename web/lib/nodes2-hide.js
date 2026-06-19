/**
 * Nodes 2.0 Vue DOM 兼容层 — 原生 widget 隐藏系统
 * 支持 Classic Canvas 与 Nodes 2.0 双渲染模式
 */

/**
 * 将元素彻底移出文档流（比 display:none 更彻底，避免 flex gap 残留）
 */
export function hideEl(el, addClass = false) {
    if (!el || el.nodeType !== 1) return;
    const s = el.style;
    s.setProperty("position", "absolute", "important");
    s.setProperty("left", "-9999px", "important");
    s.setProperty("top", "-9999px", "important");
    s.setProperty("width", "0", "important");
    s.setProperty("height", "0", "important");
    s.setProperty("min-width", "0", "important");
    s.setProperty("min-height", "0", "important");
    s.setProperty("max-width", "0", "important");
    s.setProperty("max-height", "0", "important");
    s.setProperty("overflow", "hidden", "important");
    s.setProperty("padding", "0", "important");
    s.setProperty("margin", "0", "important");
    s.setProperty("border", "none", "important");
    s.setProperty("pointer-events", "none", "important");
    s.setProperty("opacity", "0", "important");
    s.setProperty("visibility", "hidden", "important");
    if (addClass) el.classList.add("wosai-hidden-widget");
}

/**
 * 从子元素向上隐藏祖先容器（最多 8 层）
 */
export function hideWidgetRow(childEl, root) {
    let p = childEl.parentElement;
    for (let i = 0; i < 8 && p && p !== root && p !== document.body && p !== document.documentElement; i++) {
        hideEl(p);
        p = p.parentElement;
    }
}

/**
 * 对 widget 应用 GJJ 标准藏参五件套
 */
export function ghostWidget(w) {
    w.hidden = true;
    w.computeSize = () => [0, 0];
    w.getHeight = () => 0;
    w.draw = () => {};
    w.label = "";
    w.last_y = 0;
    w.computedHeight = 0;
    w.margin_top = 0;
    w.size = [0, 0];
    w.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, height: 0, minWidth: 0 });
    if (w.options !== false) w.options = { serialize: true };
}

/**
 * 注入全局 CSS 规则隐藏指定名称的 widget
 */
export function injectGlobalHideCSS(widgetNames, styleId = "wosai-os-hide-av-global") {
    if (document.getElementById(styleId)) return;
    const s = document.createElement("style");
    s.id = styleId;
    const rules = [];
    for (const n of widgetNames) {
        rules.push(
            `[data-testid="node-widget"]:has([aria-label="${n}"])`,
            `.lg-node-widget:has([aria-label="${n}"])`,
            `.lg-node-widget:has([data-path*="${n}"])`,
            `.lg-node-widget:has(input[name="${n}"])`,
        );
    }
    s.textContent = rules.join(",") + `{display:none!important;visibility:hidden!important;height:0!important;min-height:0!important;max-height:0!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important;padding:0!important;margin:0!important;border:none!important;}`;
    document.head.appendChild(s);
}

/**
 * 创建并管理 Nodes 2.0 隐藏 Observer
 * @returns {Object} { observer, disconnect, nukeHidden }
 */
export function createHiddenObserver(node, hiddenWidgets, callbacks = {}) {
    const { onCollapsed, updateSize } = callbacks;
    const HIDDEN_WIDGET_NAMES = Object.keys(hiddenWidgets);
    let _hidObTimer = null;

    // 策略1: 通过 widget.element 直接隐藏
    const _hideByWidgetEl = (root) => {
        for (const name of HIDDEN_WIDGET_NAMES) {
            const w = hiddenWidgets[name];
            if (!w) continue;
            const we = w.element || w.dom || w.inputEl;
            if (we && we.parentElement) {
                hideEl(we, true);
                hideWidgetRow(we, root);
            }
        }
    };

    // 策略2: 在 node.element DOM 中，隐藏 DOM widget 容器之前的所有原生 widget 行
    const _hideByDomPosition = (root) => {
        const wrap = node._osWrap;
        if (!wrap) return false;
        let ourContainer = wrap;
        while (ourContainer.parentElement && ourContainer.parentElement !== root) {
            ourContainer = ourContainer.parentElement;
        }
        if (!ourContainer || ourContainer === root) return false;
        const SLOT_GUARD = '[class*="slot"], [class*="socket"], [data-testid*="slot"], .lg-slot, .output, .outputs';
        let found = false;
        let prev = ourContainer.previousElementSibling;
        while (prev) {
            const isSlotRow = prev.matches?.(SLOT_GUARD) || prev.querySelector?.(SLOT_GUARD);
            if (!isSlotRow) {
                prev.style.setProperty("display", "none", "important");
                prev.style.setProperty("height", "0", "important");
                prev.style.setProperty("min-height", "0", "important");
                prev.style.setProperty("margin", "0", "important");
                prev.style.setProperty("padding", "0", "important");
                prev.style.setProperty("overflow", "hidden", "important");
                found = true;
            }
            prev = prev.previousElementSibling;
        }
        return found;
    };

    // 策略3: 兜底 — 找 osWrap 之前的原生 widget input 并隐藏
    const _nukeHidden = () => {
        if (!node._osWrap) return;
        const root = node.element || node.dom;
        if (!root) return;
        const inputs = root.querySelectorAll("input, textarea");
        for (const inp of inputs) {
            if (!inp.offsetParent) continue;
            const pos = inp.compareDocumentPosition(node._osWrap);
            if (pos & Node.DOCUMENT_POSITION_FOLLOWING) continue;
            if (inp.closest(".wosai-hidden-widget")) continue;
            let el = inp;
            while (el && el !== root) {
                el.style.setProperty("display", "none", "important");
                el.style.setProperty("visibility", "hidden", "important");
                el.style.setProperty("height", "0", "important");
                el.style.setProperty("overflow", "hidden", "important");
                el = el.parentElement;
            }
        }
    };

    // MutationObserver：监听后续动态渲染的 widget
    const observer = new MutationObserver((mutations) => {
        if (_hidObTimer) return;
        const hasAdded = mutations.some(m => m.addedNodes.length > 0);
        _hidObTimer = setTimeout(() => {
            _hidObTimer = null;
            const root = node.element || node.dom;
            if (!root) return;
            observer.disconnect();
            try {
                _hideByWidgetEl(root);
                const collapsed = _hideByDomPosition(root);
                if (collapsed && onCollapsed) onCollapsed();
                if (hasAdded) _nukeHidden();
            } finally {
                const r2 = node.element || node.dom;
                if (r2) observer.observe(r2, { childList: true, subtree: true });
            }
        }, 80);
    });

    // 启动序列
    let _hideTries = 0;
    const _tryHide = () => {
        const root = node.element || node.dom;
        if (!root) {
            if (++_hideTries < 20) setTimeout(_tryHide, 150);
            return;
        }
        observer.observe(root, { childList: true, subtree: true });
        _hideByWidgetEl(root);
        const collapsed = _hideByDomPosition(root);
        if (collapsed && updateSize) updateSize();
        if (_hideTries++ < 5) setTimeout(_tryHide, 300);
    };

    return {
        observer,
        disconnect() {
            if (_hidObTimer) { clearTimeout(_hidObTimer); _hidObTimer = null; }
            observer.disconnect();
        },
        nukeHidden: _nukeHidden,
        start() {
            requestAnimationFrame(_tryHide);
            requestAnimationFrame(() => requestAnimationFrame(_nukeHidden));
        }
    };
}
