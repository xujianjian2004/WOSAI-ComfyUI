import test from "node:test";
import assert from "node:assert/strict";

import {
    createDefaultGradientSlots,
    gradientSlotCss,
    loadCustomGradientSlots,
    saveCustomGradientSlots,
} from "./node-color-gradients.js";

function storage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem(key) { return values.get(key) ?? null; },
        setItem(key, value) { values.set(key, value); },
    };
}

test("gradient defaults become three stable HSV stops", () => {
    const result = createDefaultGradientSlots(
        [{ dir: "→", hex: ["#111111", "#222222", "#333333"] }],
        (hex) => ({ h: hex, s: 50, v: 60 }),
    );
    assert.deepEqual(result, [{
        dir: "→",
        stops: [
            { p: 0, h: "#111111", s: 50, v: 60 },
            { p: 0.5, h: "#222222", s: 50, v: 60 },
            { p: 1, h: "#333333", s: 50, v: 60 },
        ],
    }]);
});

test("custom gradients recover invalid storage and round-trip", () => {
    const memory = storage({ "wosai-nodecolor-grad-custom": "{" });
    assert.deepEqual(loadCustomGradientSlots(memory), []);
    assert.equal(saveCustomGradientSlots(memory, [{ dir: "↓", stops: [] }]), true);
    assert.deepEqual(loadCustomGradientSlots(memory), [{ dir: "↓", stops: [] }]);
});

test("gradient CSS preserves hard stops and direction", () => {
    const css = gradientSlotCss({
        dir: "↗",
        stops: [
            { h: 1, s: 2, v: 3 },
            { h: 4, s: 5, v: 6 },
            { h: 7, s: 8, v: 9 },
        ],
    }, (h, s, v) => `#${h}${s}${v}`);
    assert.equal(
        css,
        "linear-gradient(45deg, #123 0%, #123 18%, #456 42%, #456 58%, #789 82%, #789 100%)",
    );
});
