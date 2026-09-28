// Shared node geometry used by automatic layout and alignment adapters.
// This module is intentionally DOM-free; callers may provide titleH/measure.

const DEFAULT_TITLE_HEIGHT = 24;
const MIN_WIDTH = 40;
const MIN_HEIGHT = 30;

function readSize(node, titleH, measure) {
    const current = Array.isArray(node?.size) ? node.size : [];
    let width = Number(current[0]);
    let bodyHeight = Number(current[1]);

    if (measure && typeof node?.computeSize === "function") {
        const originalSizeRef = node.size;
        const originalSize = Array.isArray(originalSizeRef) ? originalSizeRef.slice(0, 2) : null;
        try {
            // LiteGraph's computeSize(out) is allowed to write into `out`.
            // Never pass node.size itself: doing so silently resizes the node
            // while automatic layout is only supposed to measure it.
            const out = current.length >= 2 ? [current[0], current[1]] : undefined;
            const measured = node.computeSize(out);
            const measuredWidth = Array.isArray(measured) ? measured[0] : measured?.width;
            const measuredHeight = Array.isArray(measured) ? measured[1] : measured?.height;
            if (Number.isFinite(Number(measuredWidth)) && Number(measuredWidth) > 0) width = Number(measuredWidth);
            if (Number.isFinite(Number(measuredHeight)) && Number(measuredHeight) > 0) bodyHeight = Number(measuredHeight);
        } catch {
            // Custom nodes are allowed to throw from computeSize; retain current size.
        } finally {
            // A few custom nodes assign this.size from inside computeSize. Size
            // probing must remain observational, so restore both the reference
            // and its original values before returning to the layout pipeline.
            if (Array.isArray(originalSizeRef) && originalSize) {
                originalSizeRef[0] = originalSize[0];
                originalSizeRef[1] = originalSize[1];
                if (node.size !== originalSizeRef) node.size = originalSizeRef;
            } else if (node.size !== originalSizeRef) {
                node.size = originalSizeRef;
            }
        }
    }

    return {
        width: Math.max(MIN_WIDTH, Number.isFinite(width) ? width : MIN_WIDTH),
        bodyHeight: Math.max(MIN_HEIGHT, Number.isFinite(bodyHeight) ? bodyHeight : MIN_HEIGHT),
        titleHeight: titleH,
    };
}

export function isRerouteNode(node) {
    const type = String(node?.type || "");
    return type === "Reroute" || type === "Reroute (rgthree)";
}

/**
 * Return a pure layout box. `height` is the visible canvas height, including
 * the title bar for normal nodes. No node properties are mutated.
 */
export function getNodeLayoutBox(node, options = {}) {
    const titleH = Math.max(0, Number(options.titleH ?? DEFAULT_TITLE_HEIGHT));
    const measured = readSize(node, titleH, options.measure !== false);
    const collapsed = !!node?.flags?.collapsed;
    const height = isRerouteNode(node)
        ? measured.bodyHeight
        : (collapsed ? titleH : measured.bodyHeight + titleH);
    return {
        id: node?.id,
        x: Number(node?.pos?.[0]) || 0,
        y: Number(node?.pos?.[1]) || 0,
        w: measured.width,
        h: Math.max(isRerouteNode(node) ? MIN_HEIGHT : titleH, height),
        bodyH: measured.bodyHeight,
        titleH,
        collapsed,
        reroute: isRerouteNode(node),
        type: node?.type || "",
        pinned: !!node?.flags?.pinned,
    };
}

export const LAYOUT_GEOMETRY_DEFAULTS = Object.freeze({
    titleH: DEFAULT_TITLE_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
});
