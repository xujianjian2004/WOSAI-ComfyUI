import test from "node:test";
import assert from "node:assert/strict";

import { createNodeColorState } from "./node-color-state.js";

const hex2hsv = (hex) => ({
    h: Number.parseInt(hex.slice(1, 3), 16),
    s: Number.parseInt(hex.slice(3, 5), 16),
    v: Number.parseInt(hex.slice(5, 7), 16),
});
const deriveDarkBg = (h, s, v) => ({ h, s: s + 1, v: v - 1 });

test("node color state starts with independent defaults", () => {
    const first = createNodeColorState(null, { hex2hsv, deriveDarkBg });
    const second = createNodeColorState(null, { hex2hsv, deriveDarkBg });
    first.stops[0].h = 99;
    assert.equal(second.stops[0].h, 20);
});

test("node color state expands a short stored gradient to three stops", () => {
    const state = createNodeColorState({
        _gradient: {
            dir: "→",
            stops: [
                { p: 0, hex: "#102030" },
                { p: 1, hex: "#405060" },
            ],
        },
        _titleStyle: { align: "center" },
    }, { hex2hsv, deriveDarkBg });

    assert.equal(state.dir, "→");
    assert.deepEqual(state.stops.map(({ p }) => p), [0, 0.5, 1]);
    assert.equal(state.stops[1].h, 0x40);
    assert.equal(state.titleStyle.align, "center");
});

test("active HSV accessors update the selected stop after selection changes", () => {
    const state = createNodeColorState(null, { hex2hsv, deriveDarkBg });
    state.aStop = 1;
    state.h = 240;
    state.s = 80;
    state.v = 70;
    assert.deepEqual(state.stops[1], { p: 0.5, h: 240, s: 80, v: 70 });
});

test("solid node colors derive a readable final stop", () => {
    const state = createNodeColorState({ color: "#102030" }, { hex2hsv, deriveDarkBg });
    assert.deepEqual(state.stops[2], { p: 1, h: 0x10, s: 0x21, v: 0x2f });
});
