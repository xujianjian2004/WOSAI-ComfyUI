function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

/**
 * Place a floating panel near its anchor while keeping the complete panel
 * inside the usable viewport. Oversized panels are pinned to the safe gutter;
 * CSS remains responsible for shrinking their rendered dimensions.
 */
export function clampFloatingPanel({
    anchorX,
    anchorY,
    panelWidth,
    panelHeight,
    viewportWidth,
    viewportHeight,
    gutter = 16,
}) {
    const safeGutter = Math.max(0, finite(gutter));
    const width = Math.max(0, finite(panelWidth));
    const height = Math.max(0, finite(panelHeight));
    const viewportW = Math.max(0, finite(viewportWidth));
    const viewportH = Math.max(0, finite(viewportHeight));
    const minLeft = Math.min(safeGutter, viewportW);
    const minTop = Math.min(safeGutter, viewportH);
    const maxLeft = Math.max(minLeft, viewportW - width - safeGutter);
    const maxTop = Math.max(minTop, viewportH - height - safeGutter);

    return {
        left: Math.min(Math.max(finite(anchorX, minLeft), minLeft), maxLeft),
        top: Math.min(Math.max(finite(anchorY, minTop), minTop), maxTop),
    };
}

/**
 * Dock a floating panel immediately to the left of a host panel. When the host
 * is already against the viewport edge, the regular viewport clamp moves the
 * floating panel to the left safe gutter instead of allowing overflow.
 */
export function dockFloatingPanelLeft({
    hostLeft,
    hostTop,
    panelWidth,
    panelHeight,
    viewportWidth,
    viewportHeight,
    gutter = 16,
}) {
    const safeGutter = Math.max(0, finite(gutter));
    return clampFloatingPanel({
        anchorX: finite(hostLeft) - Math.max(0, finite(panelWidth)) - safeGutter,
        anchorY: finite(hostTop, safeGutter),
        panelWidth,
        panelHeight,
        viewportWidth,
        viewportHeight,
        gutter: safeGutter,
    });
}

/**
 * Place a panel beside a graph target, HUD anchor, or viewport center.
 * Graph-space coordinates are converted by the caller-provided canvas rect,
 * scale, and offset so this helper remains independent from LiteGraph.
 */
export function placeFloatingPanel({
    panelWidth,
    panelHeight,
    viewportWidth,
    viewportHeight,
    target,
    canvas,
    anchor,
    gap = 12,
    gutter = 10,
}) {
    let left;
    let top;
    if (target?.pos && target?.size && canvas) {
        const targetLeft = canvas.left + (target.pos[0] + canvas.offset[0]) * canvas.scale;
        const targetTop = canvas.top + (target.pos[1] + canvas.offset[1]) * canvas.scale;
        const targetWidth = target.size[0] * canvas.scale;
        const targetHeight = target.size[1] * canvas.scale;
        const right = targetLeft + targetWidth + gap;
        const leftSide = targetLeft - panelWidth - gap;
        left = right + panelWidth <= viewportWidth - gutter || leftSide < gutter
            ? right
            : leftSide;
        top = targetTop + targetHeight / 2 - panelHeight / 2;
    } else if (anchor) {
        if (anchor.orient === "v") {
            const leftSide = anchor.left - panelWidth - gap;
            left = leftSide >= gutter ? leftSide : anchor.right + gap;
            top = anchor.top + anchor.height / 2 - panelHeight / 2;
        } else {
            left = anchor.left + anchor.width / 2 - panelWidth / 2;
            top = anchor.bottom + gap;
        }
    } else {
        left = (viewportWidth - panelWidth) / 2;
        top = (viewportHeight - panelHeight) / 2;
    }

    return clampFloatingPanel({
        anchorX: left,
        anchorY: top,
        panelWidth,
        panelHeight,
        viewportWidth,
        viewportHeight,
        gutter,
    });
}
