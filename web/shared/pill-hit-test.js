export function normalizePillPointerX(
    clientX,
    rectLeft,
    rectWidth,
    drawWidth,
    fallback,
) {
    const values = [clientX, rectLeft, rectWidth, drawWidth].map(Number);
    const [pointer, left, cssWidth, logicalWidth] = values;
    if (
        values.every(Number.isFinite)
        && cssWidth > 0
        && logicalWidth > 0
    ) {
        return (pointer - left) * (logicalWidth / cssWidth);
    }
    return fallback;
}

export function resolvePillHitAction(positionX, widths, edgeSize = 45) {
    const x = Number(positionX);
    if (!Number.isFinite(x)) return "menu";
    const candidates = (Array.isArray(widths) ? widths : [widths])
        .map(Number)
        .filter((width) => Number.isFinite(width) && width > 0);
    const width = candidates.length ? Math.min(...candidates) : 0;
    if (x <= edgeSize) return "previous";
    if (width > 0 && x >= width - edgeSize) return "next";
    return "menu";
}
