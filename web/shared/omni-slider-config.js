export const OMNI_SLIDER_COLORS = Object.freeze([
    "var(--ws-os-preset-color-1)",
    "var(--ws-os-preset-color-2)",
    "var(--ws-os-preset-color-3)",
    "var(--ws-os-preset-color-4)",
    "var(--ws-os-preset-color-5)",
    "var(--ws-os-preset-color-6)",
    "var(--ws-os-preset-color-7)",
    "var(--ws-os-preset-color-8)",
    "var(--ws-os-preset-color-9)",
    "var(--ws-os-preset-color-10)",
]);

export function defaultOmniSliderConfig(index = 1) {
    const normalizedIndex = Math.max(1, Math.trunc(Number(index) || 1));
    return {
        label: "",
        type: "FLOAT",
        min: 0,
        max: 1,
        step: 0.01,
        value: 0.5,
        color: OMNI_SLIDER_COLORS[(normalizedIndex - 1) % OMNI_SLIDER_COLORS.length],
        style: "fill",
        trackBg: "var(--ws-surface-3)",
        trackColor: "",
        thumbColor: "",
        textColor: "var(--ws-text)",
        labelY: -20,
        labelX: 0,
        thumbSize: 18,
        trackHeight: 4,
        snapEnabled: false,
        snapPoints: [null, null, null, null, null],
        snapColor: "",
        snapSize: 5,
    };
}

export function parseOmniSliderConfig(value) {
    try {
        const config = value ? JSON.parse(value) : {};
        if (!config || typeof config !== "object" || Array.isArray(config)) return {};
        if (typeof config.label === "string") {
            const legacyNumbered = config.label.match(/^滑条\s*(\d+)$/);
            if (legacyNumbered) config.label = `C${legacyNumbered[1]}`;
            else if (config.label === "滑条") config.label = "";
        }
        return config;
    } catch {
        return {};
    }
}

export function serializeOmniSliderConfig(config) {
    return JSON.stringify(config);
}
