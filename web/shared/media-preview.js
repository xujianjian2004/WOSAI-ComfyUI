export function normalizeSplitPercent(value, fallback = 50) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(100, parsed));
}

export function compareDisplayPair(payload, swapped = false) {
    const pair = {
        a: payload?.a ?? null,
        b: payload?.b ?? null,
    };
    return swapped ? { a: pair.b, b: pair.a } : pair;
}
