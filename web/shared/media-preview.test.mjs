import test from "node:test";
import assert from "node:assert/strict";

import { compareDisplayPair, normalizeSplitPercent } from "./media-preview.js";

test("normalizeSplitPercent preserves both comparison endpoints", () => {
    assert.equal(normalizeSplitPercent("0"), 0);
    assert.equal(normalizeSplitPercent("100"), 100);
});

test("normalizeSplitPercent clamps range and falls back for invalid values", () => {
    assert.equal(normalizeSplitPercent(-10), 0);
    assert.equal(normalizeSplitPercent(130), 100);
    assert.equal(normalizeSplitPercent("invalid"), 50);
});

test("compareDisplayPair swaps display roles without mutating the payload", () => {
    const payload = { a: { filename: "a.png" }, b: { filename: "b.png" } };
    assert.deepEqual(compareDisplayPair(payload, false), payload);
    assert.deepEqual(compareDisplayPair(payload, true), {
        a: payload.b,
        b: payload.a,
    });
    assert.equal(payload.a.filename, "a.png");
    assert.equal(payload.b.filename, "b.png");
});
