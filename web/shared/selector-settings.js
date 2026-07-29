export const MAX_SELECTOR_LABELS = 10;
export const MAX_SELECTOR_COLUMNS = 5;
export const DEFAULT_SELECTOR_LABELS = Object.freeze(
    Array.from({ length: MAX_SELECTOR_LABELS }, (_, index) => String(index)),
);

export const DEFAULT_SELECTOR_SETTINGS = Object.freeze({
    fontSize: 12,
    buttonHeight: 30,
    gap: 6,
    falseLabel: "",
    trueLabel: "",
});

function clampInteger(value, fallback, min, max) {
    const number = Number.parseInt(value, 10);
    return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
}

function normalizeLabel(value) {
    return String(value ?? "").trim().slice(0, 48);
}

export function normalizeSelectorLabels(raw) {
    try {
        const value = JSON.parse(String(raw || "[]"));
        const labels = Array.isArray(value)
            ? value
                .map(normalizeLabel)
                .filter(Boolean)
                .slice(0, MAX_SELECTOR_LABELS)
            : [];
        return labels.length ? labels : [...DEFAULT_SELECTOR_LABELS];
    } catch (_) {
        return [...DEFAULT_SELECTOR_LABELS];
    }
}

export function normalizeSelectorSettings(raw) {
    let value = raw;
    if (typeof raw === "string") {
        try {
            value = JSON.parse(raw || "{}");
        } catch (_) {
            value = {};
        }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) value = {};

    return {
        fontSize: clampInteger(value.fontSize, DEFAULT_SELECTOR_SETTINGS.fontSize, 10, 24),
        buttonHeight: clampInteger(value.buttonHeight, DEFAULT_SELECTOR_SETTINGS.buttonHeight, 30, 80),
        gap: clampInteger(value.gap, DEFAULT_SELECTOR_SETTINGS.gap, 0, 20),
        falseLabel: normalizeLabel(value.falseLabel),
        trueLabel: normalizeLabel(value.trueLabel),
    };
}

export function serializeSelectorSettings(settings) {
    return JSON.stringify(normalizeSelectorSettings(settings));
}
