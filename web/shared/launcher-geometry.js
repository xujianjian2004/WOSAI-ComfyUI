function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export function clampLauncherPosition(x, y, {
    width,
    height,
    defaultSize,
    viewportWidth,
    viewportHeight,
    gutter = 6,
}) {
    const parsedWidth = finite(width, defaultSize);
    const parsedHeight = finite(height, defaultSize);
    const safeWidth = parsedWidth > 0 ? parsedWidth : Math.max(0, finite(defaultSize));
    const safeHeight = parsedHeight > 0 ? parsedHeight : Math.max(0, finite(defaultSize));
    const safeGutter = Math.max(0, finite(gutter, 6));
    return {
        x: Math.max(safeGutter, Math.min(finite(x), viewportWidth - safeWidth - safeGutter)),
        y: Math.max(safeGutter, Math.min(finite(y), viewportHeight - safeHeight - safeGutter)),
    };
}

export function rectanglesOverlap(first, second) {
    return !(first.right < second.left
        || first.left > second.right
        || first.bottom < second.top
        || first.top > second.bottom);
}

export function launcherDodgePosition(ballRect, panelRect, options) {
    if (!ballRect || !panelRect || panelRect.width === 0 || panelRect.height === 0) return null;
    if (!rectanglesOverlap(ballRect, panelRect)) return null;

    const pad = options.pad ?? 20;
    const size = options.ballSize;
    if (panelRect.width > options.viewportWidth * 0.5) {
        const ballCenterY = (ballRect.top + ballRect.bottom) / 2;
        const panelCenterY = (panelRect.top + panelRect.bottom) / 2;
        const y = ballCenterY > panelCenterY
            ? panelRect.bottom + pad
            : panelRect.top - size - pad;
        return clampLauncherPosition(ballRect.left, y, {
            ...options,
            width: size,
            height: size,
        });
    }

    const ballCenterX = (ballRect.left + ballRect.right) / 2;
    const panelCenterX = (panelRect.left + panelRect.right) / 2;
    const x = ballCenterX > panelCenterX
        ? panelRect.right + pad
        : panelRect.left - size - pad;
    return clampLauncherPosition(x, ballRect.top, options);
}

export function smartFanAngle(cx, cy, viewportWidth, viewportHeight) {
    const marginX = Math.min(viewportWidth * 0.18, 160);
    const marginY = Math.min(viewportHeight * 0.18, 120);
    if (cy < marginY) {
        if (cx < marginX) return Math.PI / 4;
        if (cx > viewportWidth - marginX) return 3 * Math.PI / 4;
        return Math.PI / 2;
    }
    if (cy > viewportHeight - marginY) {
        if (cx < marginX) return -Math.PI / 4;
        if (cx > viewportWidth - marginX) return -3 * Math.PI / 4;
        return -Math.PI / 2;
    }
    return cx < viewportWidth / 2 ? 0 : Math.PI;
}

export function enclosingRect(rectangles) {
    const rects = rectangles.filter(Boolean);
    if (rects.length === 0) return null;
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
}
