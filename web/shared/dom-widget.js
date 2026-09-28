import { createHiddenObserver, ghostWidget } from "./nodes2-hide.js";

const BASE_STYLES = [
    ["wosai-vars-link", new URL("../styles/wosai-variables.css?v=22", import.meta.url).href],
    ["wosai-theme-css", new URL("../styles/wosai-theme.css?v=4", import.meta.url).href],
];

function resolveMetric(value, fallback = 0) {
    const resolved = typeof value === "function" ? value() : value;
    const number = Number(resolved);
    return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

/**
 * ComfyUI does not reliably attach extension.json styles in every frontend
 * mode. Load WOSAI styles explicitly and de-duplicate them by stable id.
 */
export function ensureWosaiStyles(styles = []) {
    if (typeof document === "undefined") return [];
    const attached = [];
    for (const [id, href] of [...BASE_STYLES, ...styles]) {
        const existing = document.getElementById(id);
        if (existing) {
            if (existing.rel === "stylesheet" && existing.href !== href) {
                existing.href = href;
            }
            attached.push(existing);
            continue;
        }
        const link = document.createElement("link");
        link.id = id;
        link.rel = "stylesheet";
        link.href = href;
        document.head.appendChild(link);
        attached.push(link);
    }
    return attached;
}

/**
 * Keep backend widget values serializable while removing both Classic Canvas
 * and Nodes 2.0 DOM renderers from layout, painting, and hit testing.
 */
export function hideSerializableWidget(widget) {
    if (!widget || widget.__wosaiGhosted) return widget;
    widget.__wosaiGhosted = true;
    ghostWidget(widget);
    for (const element of [widget.element, widget.dom, widget.inputEl]) {
        element?.style?.setProperty("display", "none", "important");
        if (element) element.hidden = true;
    }
    return widget;
}

/**
 * Register a DOM widget with an explicit layout contract understood by both
 * Classic LiteGraph and the Nodes 2.0 frontend.
 */
export function addSizedDOMWidget(node, name, type, element, options = {}) {
    if (!node?.addDOMWidget) return null;
    const layoutGutter = resolveMetric(options.layoutGutter, 16);
    const getContentMinHeight = () => resolveMetric(options.getMinHeight ?? options.height, 32);
    const getContentMaxHeight = () => Math.max(
        getContentMinHeight(),
        resolveMetric(options.getMaxHeight ?? options.height, getContentMinHeight()),
    );
    const getContentHeight = () => Math.max(
        getContentMinHeight(),
        Math.min(
            getContentMaxHeight(),
            resolveMetric(options.getHeight ?? options.height, getContentMinHeight()),
        ),
    );
    // ComfyUI reserves an 8px layout gutter above and below every DOM widget,
    // then subtracts it from the fixed overlay element. The public WOSAI
    // contract describes usable content height, so add the host gutter here.
    const getMinHeight = () => getContentMinHeight() + layoutGutter;
    const getMaxHeight = () => getContentMaxHeight() + layoutGutter;
    const getHeight = () => getContentHeight() + layoutGutter;
    const widget = node.addDOMWidget(name, type, element, {
        serialize: options.serialize ?? false,
        hideOnZoom: options.hideOnZoom ?? false,
        getMinHeight,
        getMaxHeight,
        getHeight,
    });
    if (!widget) return null;
    widget.computeSize = (width) => [
        Math.max(0, Number(width) || Number(node.size?.[0]) || 0),
        getHeight(),
    ];
    widget.getHeight = getHeight;
    widget.computeLayoutSize = () => ({
        minHeight: getMinHeight(),
        maxHeight: getMaxHeight(),
        height: getHeight(),
        minWidth: 0,
    });
    widget.__wosaiContentHeight = getContentHeight;
    return widget;
}

function node2HiddenStyle(node, names) {
    if (typeof document === "undefined" || !node?.id || !names?.length) return null;
    const styleId = `wosai-node2-hidden-${node.id}`;
    let style = document.getElementById(styleId);
    if (!style) {
        style = document.createElement("style");
        style.id = styleId;
        document.head.appendChild(style);
    }
    const scope = `[data-node-id="${node.id}"]`;
    const selectors = names.flatMap((name) => {
        const escaped = String(name).replace(/(["\\])/g, "\\$1");
        return [
            `${scope} [data-testid="node-widget"]:has([aria-label="${escaped}"])`,
            `${scope} .lg-node-widget:has([aria-label="${escaped}"])`,
            `${scope} .lg-node-widget:has([data-path*="${escaped}"])`,
            `${scope} .lg-node-widget:has(input[name="${escaped}"])`,
        ];
    });
    style.textContent = `${selectors.join(",")} { display:none!important; visibility:hidden!important; height:0!important; min-height:0!important; max-height:0!important; overflow:hidden!important; opacity:0!important; pointer-events:none!important; padding:0!important; margin:0!important; border:none!important; }`;
    return style;
}

/**
 * Hide backend widgets in both Classic and Nodes 2.0. Classic uses the
 * zero-sized ghost widget; Vue needs a node-scoped CSS rule plus a small DOM
 * observer because its widget rows can be mounted after onNodeCreated.
 */
export function mountNode2HiddenWidgets(node, root, hiddenWidgets) {
    if (!node || !root || !hiddenWidgets) return () => {};
    const previousWrap = node._osWrap;
    node._osWrap = root;
    const names = Object.keys(hiddenWidgets);
    const style = node2HiddenStyle(node, names);
    const manager = createHiddenObserver(node, hiddenWidgets, {
        updateSize: () => node.setDirtyCanvas?.(true, true),
    });
    manager.start();
    let cleaned = false;
    return () => {
        if (cleaned) return;
        cleaned = true;
        manager.disconnect?.();
        style?.remove?.();
        if (node._osWrap === root) node._osWrap = previousWrap;
    };
}

/**
 * Grow a node to the space required by its current widgets without shrinking
 * a size restored from the workflow.
 */
export function ensureNodeMinSize(node, minWidth, minHeight) {
    if (!node?.setSize) return;
    const computed = typeof node.computeSize === "function" ? node.computeSize() : [0, 0];
    const width = Math.max(
        resolveMetric(minWidth),
        Number(computed?.[0]) || 0,
        Number(node.size?.[0]) || 0,
    );
    const height = Math.max(
        resolveMetric(minHeight),
        Number(computed?.[1]) || 0,
        Number(node.size?.[1]) || 0,
    );
    node.setSize([width, height]);
    node.setDirtyCanvas?.(true, true);
}

/**
 * Compact a node once to the size required by its current widgets.
 *
 * ComfyUI restores `node.size` from the workflow before extensions attach
 * their DOM widgets.  `ensureNodeMinSize` intentionally preserves that size
 * (it is the right behavior for a user-resized node), but old WOSAI versions
 * wrote overly-large automatic heights into workflows.  This helper performs
 * a one-time migration for those automatic sizes while normally keeping the
 * restored width. Small controls may opt out of width preservation, and later
 * content changes still grow through ensureNodeMinSize.
 */
export function compactNodeToContent(
    node,
    minWidth = 0,
    minHeight = 0,
    { preserveWidth = true, maxWidth = Infinity } = {},
) {
    if (!node?.setSize || node.__wosaiCompactSizeApplied) return false;
    const computed = typeof node.computeSize === "function" ? node.computeSize() : [0, 0];
    const measuredWidth = Math.max(
        resolveMetric(minWidth),
        Number(computed?.[0]) || 0,
        preserveWidth ? Number(node.size?.[0]) || 0 : 0,
    );
    const width = Math.min(resolveMetric(maxWidth, Infinity), measuredWidth);
    const height = Math.max(
        resolveMetric(minHeight),
        Number(computed?.[1]) || 0,
    );
    if (!(width > 0) || !(height > 0)) return false;
    node.setSize([width, height]);
    node.__wosaiCompactSizeApplied = true;
    node.setDirtyCanvas?.(true, true);
    return true;
}
