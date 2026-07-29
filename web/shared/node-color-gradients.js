const CUSTOM_GRADIENTS_KEY = "wosai-nodecolor-grad-custom";
const DIRECTION_DEGREES = Object.freeze({
    "↓": 180,
    "→": 90,
    "↘": 135,
    "↗": 45,
});

export function createDefaultGradientSlots(defaults, toHsv) {
    if (!Array.isArray(defaults) || typeof toHsv !== "function") return [];
    return defaults
        .filter((item) => item && Array.isArray(item.hex) && item.hex.length === 3)
        .map((item) => ({
            dir: item.dir,
            stops: item.hex.map((hex, index) => ({
                p: index / 2,
                ...toHsv(hex),
            })),
        }));
}

export function loadCustomGradientSlots(storage) {
    try {
        const value = JSON.parse(storage?.getItem(CUSTOM_GRADIENTS_KEY));
        return Array.isArray(value) ? value : [];
    } catch {
        return [];
    }
}

export function saveCustomGradientSlots(storage, slots) {
    try {
        storage?.setItem(
            CUSTOM_GRADIENTS_KEY,
            JSON.stringify(Array.isArray(slots) ? slots : []),
        );
        return true;
    } catch {
        return false;
    }
}

export function gradientSlotCss(slot, toHex) {
    const degree = DIRECTION_DEGREES[slot?.dir] || 180;
    const colors = (slot?.stops || []).slice(0, 3).map(
        (stop) => toHex(stop.h, stop.s, stop.v),
    );
    if (colors.length !== 3) return "";
    return `linear-gradient(${degree}deg, ${colors[0]} 0%, ${colors[0]} 18%, `
        + `${colors[1]} 42%, ${colors[1]} 58%, ${colors[2]} 82%, ${colors[2]} 100%)`;
}
