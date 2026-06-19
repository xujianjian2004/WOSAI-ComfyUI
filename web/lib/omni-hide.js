/* WOSAI OmniSlider — 隐藏模式逻辑（从 omni-slider.js 提取，减小主文件体积） */
import { app } from "../../../scripts/app.js";

// ── 节点精简显示控制（三项独立，持久化在 node.properties）══════════════════
//   osHideTitle / osHideBadge / osHidePortLabel —— LiteGraph 自动序列化。
//   画布层隐藏（标题/角标）统一由 node-color.js 的 drawNodeShape wrapper 执行，
//   omni-slider 不再单独 hook 画布方法（避免双钩子冲突）。

// 刷新 Nodes 2.0 DOM 隐藏 CSS（标题/边框/角标）
export function _osRefreshDOMHide() {
    let style = document.getElementById("wosai-os-dom-hide");
    if (!style) { style = document.createElement("style"); style.id = "wosai-os-dom-hide"; document.head.appendChild(style); }
    const graph = app.graph;
    const nodes = (graph?._nodes || graph?.nodes || []).filter(
        n => n && n.type === "WOSAI_OmniSlider" && (n._osHideTitle || n._osHideBadge || n._osHidePortLabel));
    let css = "";
    for (const node of nodes) {
        const sel = `[data-node-id="${node.id}"]`;
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
    }
    style.textContent = css;

    // 显示态修复：清除残留 inline 透明背景
    const allOs = (graph?._nodes || graph?.nodes || []).filter(n => n && n.type === "WOSAI_OmniSlider");
    for (const node of allOs) {
        if (node._osHideTitle || node._gradient) continue;
        const c = document.querySelector(`[data-node-id="${node.id}"]`);
        if (!c) continue;
        const inner = c.querySelector('[data-testid="node-inner-wrapper"]');
        const body = c.querySelector(`[data-testid="node-body-${node.id}"]`) || c.querySelector('[data-testid^="node-body"]');
        inner?.style.removeProperty('--component-node-background');
        inner?.style.removeProperty('background-color');
        inner?.style.removeProperty('background-image');
        body?.style.removeProperty('--component-node-background');
        body?.style.removeProperty('background-color');
        body?.style.removeProperty('background-image');
    }
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
        const isNodes2 = !!document.querySelector(`[data-node-id="${node.id}"]`);
        if (hideTitle) {
            if (!isNodes2) {
                node.color = '#fff0';
                node.bgcolor = 'transparent';
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

        try { _osRefreshDOMHide(); } catch (_) {}
        try { window.__wosaiColorRefresh?.(); } catch (_) {}

        if (typeof node.setSize === 'function' && node.size) {
            node.setSize([node.size[0], node.size[1]]);
        }
        app.graph?.setDirtyCanvas(true, true);
        const canvas = app.canvas || app.graph?.canvas;
        if (canvas) {
            canvas.setDirty?.(true, true);
            requestAnimationFrame(() => { try { _osRefreshDOMHide(); } catch (_) {} canvas.setDirty?.(true, true); });
        }
    } catch (e) {
        console.warn('[WOSAI OmniSlider] applyNodeDisplay error:', e.message);
    }
}
