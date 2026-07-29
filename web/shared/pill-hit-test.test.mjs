import assert from "node:assert/strict";
import test from "node:test";

import {
    normalizePillPointerX,
    resolvePillHitAction,
} from "./pill-hit-test.js";

test("pill arrows use the smallest valid drawing coordinate width", () => {
    assert.equal(resolvePillHitAction(20, [640, 360]), "previous");
    assert.equal(resolvePillHitAction(350, [640, 360]), "next");
    assert.equal(resolvePillHitAction(180, [640, 360]), "menu");
});

test("pill hit testing recovers missing and invalid dimensions", () => {
    assert.equal(resolvePillHitAction(250, [undefined, 270]), "next");
    assert.equal(resolvePillHitAction(Number.NaN, [270]), "menu");
});

test("Nodes 2.0 CSS-scaled pointers map back to widget draw coordinates", () => {
    const drawX = normalizePillPointerX(438, 33, 475, 270, 0);
    assert.equal(Math.round(drawX), 230);
    assert.equal(resolvePillHitAction(drawX, [270]), "next");
    assert.equal(normalizePillPointerX(20, 0, 0, 270, 15), 15);
});
