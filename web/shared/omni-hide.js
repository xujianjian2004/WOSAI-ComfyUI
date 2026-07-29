/* WOSAI OmniSlider — 隐藏模式逻辑（从 omni-slider.js 提取，减小主文件体积） */
import { app } from "../../../../scripts/app.js";
import { getWOSAIVar } from "./shared-utils.js";

// ── 节点精简显示控制（三项独立，持久化在 node.properties）══════════════════
//   osHideTitle / osHideBadge / osHidePortLabel —— LiteGraph 自动序列化。
//   画布层隐藏（标题/角标）统一由 node-color.js 的 drawNodeShape wrapper 执行，
//   omni-slider 不再单独 hook 画布方法（避免双钩子冲突）。

// DOM 引用缓存：node.id -> { container, inner, body }
const _domCache = new Map();

// CSS 规则缓存：node.id -> CSS 字符串
const _cssCache = new Map();

function _getStyleEl() {
    let style = document.getElementById("wosai-os-dom-hide");
    if (!style) {
        style = document.createElement("style");
        style.id = "wosai-os-dom-hide";
        document.head.appendChild(style);
    }
    return style;
}

function _buildNodeCSS(node) {
    const sel = `[data-node-id="${node.id}"]`;
    let css = "";
    if (node._osHideTitle) {
        css += `${sel} [data-testid^="node-header"]{display:none!important;}`;
        css += `${sel} .border-component-node-border{border-color:transparent!important;}`;
        css += `${sel} [data-testid="node-inner-wrapper"],${sel} [data-testid^="node-body"]{background-color:transparent!important;}`;
    }
    if (node._osHideBadge) {
        css += `${sel} .mt-auto.text-muted-foreground{display:none!important;}`;
    }
    if (node._osHidePortLabel) {
        css += `${sel} .lg-slot--output .text-node-component-slot-text{display:none!important;}`;
    }
    return css;
}

function _getDOMRefs(node) {
    let refs = _domCache.get(node.id);
    if (refs && refs.container?.isConnected) return refs;

    const container = document.querySelector(`[data-node-id="${node.id}"]`);
    if (!container) {
        _domCache.delete(node.id);
        return null;
    }
    refs = {
        container,
        inner: container.querySelector('[data-testid="node-inner-wrapper"]'),
        body: container.querySelector(`[data-testid="node-body-${node.id}"]`) || container.querySelector('[data-testid^="node-body"]'),
    };
    _domCache.set(node.id, refs);
    return refs;
}

function _clearInlineBackground(node) {
    if (node._osHideTitle || node._gradient) return;
    const refs = _getDOMRefs(node);
    if (!refs) return;
    if (refs.inner) {
        refs.inner.style.removeProperty('--component-node-background');
        refs.inner.style.removeProperty('background-color');
        refs.inner.style.removeProperty('background-image');
    }
    if (refs.body) {
        refs.body.style.removeProperty('--component-node-background');
        refs.body.style.removeProperty('background-color');
        refs.body.style.removeProperty('background-image');
    }
}

function _cleanupStaleCSS(graph) {
    if (!_cssCache.size) return;
    const getNode = graph?.getNodeById;
    if (typeof getNode !== 'function') return;
    for (const id of _cssCache.keys()) {
        if (!getNode.call(graph, id)) _cssCache.delete(id);
    }
}

function _rebuildAllCSS(style, graph) {
    _cssCache.clear();
    const nodes = (graph?._nodes || graph?.nodes || []).filter(
        n => n && n.type === "WOSAI_OmniSlider" && (n._osHideTitle || n._osHideBadge || n._osHidePortLabel));
    for (const node of nodes) {
        const css = _buildNodeCSS(node);
        if (css) _cssCache.set(node.id, css);
    }
    const next = Array.from(_cssCache.values()).join("");
    if (style.textContent !== next) style.textContent = next;
}

// 刷新 Nodes 2.0 DOM 隐藏 CSS（标题/边框/角标）
// 不传参时全量重建（兼容旧调用、节点删除时清理缓存）；传 node 或数组时增量更新。
export function _osRefreshDOMHide(nodeOrNodes) {
    const style = _getStyleEl();
    const graph = app.graph;

    // 未传参：执行全量重建，用于清理已删除节点或兜底调用
    if (!nodeOrNodes) {
        _rebuildAllCSS(style, graph);
        const allOs = (graph?._nodes || graph?.nodes || []).filter(n => n && n.type === "WOSAI_OmniSlider");
        for (const node of allOs) _clearInlineBackground(node);
        return;
    }

    // 增量更新：仅重新计算变更节点的 CSS，清理缓存中已不存在的节点
    _cleanupStaleCSS(graph);
    const nodes = Array.isArray(nodeOrNodes) ? nodeOrNodes : [nodeOrNodes];
    for (const node of nodes) {
        if (!node || node.type !== "WOSAI_OmniSlider") continue;
        const css = _buildNodeCSS(node);
        if (css) {
            _cssCache.set(node.id, css);
        } else {
            _cssCache.delete(node.id);
        }
        _clearInlineBackground(node);
    }

    const next = Array.from(_cssCache.values()).join("");
    if (style.textContent !== next) style.textContent = next;
}

// 应用节点精简显示（隐藏标题/角标/端口），管理 LiteGraph 属性恢复
export function applyNodeDisplay(node, syncOutputPorts, updateOutputLabel) {
    if (!node) return;
    try {
        const hideTitle = !!node._osHideTitle;

        if (!node._osColorSaved) {
            node._osOrigColor = node.color;
            node._osOrigBgColor = node.bgcolor;
            node._osColorSaved = true;
        }

        const NO_TITLE = (typeof LiteGraph !== 'undefined' && LiteGraph.NO_TITLE != null) ? LiteGraph.NO_TITLE : 0;

        // 优先使用节点缓存标志判断是否为 Nodes 2.0，避免每次 querySelector
        if (node._osIsVue === undefined) {
            node._osIsVue = !!document.querySelector(`[data-node-id="${node.id}"]`);
        }
        const isNodes2 = node._osIsVue;

        if (hideTitle) {
            if (!isNodes2) {
                node.color = getWOSAIVar('--ws-nc-transparent');
                node.bgcolor = getWOSAIVar('--ws-nc-transparent');
            }
            try {
                if (node._osOrigTitleMode === undefined) node._osOrigTitleMode = node.title_mode;
                node.title_mode = NO_TITLE;
            } catch (_) { /* Nodes 2.0：title_mode 只读，忽略；标题改由 DOM CSS 隐藏 */ }
        } else {
            if (node._osOrigColor == null || node._osOrigColor === '') delete node.color;
            else node.color = node._osOrigColor;
            if (node._osOrigBgColor == null || node._osOrigBgColor === '') delete node.bgcolor;
            else node.bgcolor = node._osOrigBgColor;
            node._osColorSaved = false;
            if (node._osOrigTitleMode !== undefined) {
                try { node.title_mode = node._osOrigTitleMode; } catch (_) {}
                delete node._osOrigTitleMode;
            }
        }

        if (!node._osHideBadge && node._osOrigBadges !== undefined) {
            node.badges = node._osOrigBadges;
            delete node._osOrigBadges;
        }

        try { syncOutputPorts(node); } catch (_) {}
        try { updateOutputLabel(node); } catch (_) {}

        // 增量刷新 DOM 隐藏样式，只处理当前节点
        try { _osRefreshDOMHide(node); } catch (_) {}
        try { window.__wosaiColorRefresh?.(); } catch (_) {}

        if (typeof node.setSize === 'function' && node.size) {
            node.setSize([node.size[0], node.size[1]]);
        }
        app.graph?.setDirtyCanvas(true, true);
        const canvas = app.canvas || app.graph?.canvas;
        if (canvas) {
            canvas.setDirty?.(true, true);
        }
    } catch (e) {
        console.warn('[WOSAI OmniSlider] applyNodeDisplay error:', e.message);
    }
}
