import test from "node:test";
import assert from "node:assert/strict";

import {
    clampFloatingPanel,
    dockFloatingPanelLeft,
    placeFloatingPanel,
} from "./viewport-layout.js";

test("clampFloatingPanel preserves a pointer-adjacent position inside the viewport", () => {
    assert.deepEqual(clampFloatingPanel({
        anchorX: 320,
        anchorY: 180,
        panelWidth: 310,
        panelHeight: 360,
        viewportWidth: 1280,
        viewportHeight: 720,
        gutter: 16,
    }), { left: 320, top: 180 });
});

test("clampFloatingPanel keeps right and bottom edges within the safe gutter", () => {
    assert.deepEqual(clampFloatingPanel({
        anchorX: 1200,
        anchorY: 680,
        panelWidth: 310,
        panelHeight: 360,
        viewportWidth: 1280,
        viewportHeight: 720,
        gutter: 16,
    }), { left: 954, top: 344 });
});

test("clampFloatingPanel pins an oversized panel instead of producing negatives", () => {
    assert.deepEqual(clampFloatingPanel({
        anchorX: 200,
        anchorY: 100,
        panelWidth: 900,
        panelHeight: 700,
        viewportWidth: 600,
        viewportHeight: 400,
        gutter: 16,
    }), { left: 16, top: 16 });
});

test("dockFloatingPanelLeft places the palette outside the Save Node panel", () => {
    assert.deepEqual(dockFloatingPanelLeft({
        hostLeft: 640,
        hostTop: 80,
        panelWidth: 310,
        panelHeight: 260,
        viewportWidth: 1280,
        viewportHeight: 720,
        gutter: 16,
    }), { left: 314, top: 80 });
});

test("dockFloatingPanelLeft falls back to the left safe gutter when space is tight", () => {
    assert.deepEqual(dockFloatingPanelLeft({
        hostLeft: 6,
        hostTop: 20,
        panelWidth: 310,
        panelHeight: 260,
        viewportWidth: 980,
        viewportHeight: 720,
        gutter: 16,
    }), { left: 16, top: 20 });
});

test("placeFloatingPanel prefers a graph target's right side", () => {
    assert.deepEqual(placeFloatingPanel({
        panelWidth: 240,
        panelHeight: 180,
        viewportWidth: 1200,
        viewportHeight: 800,
        target: { pos: [100, 120], size: [200, 100] },
        canvas: { left: 20, top: 30, scale: 1.5, offset: [10, 5] },
    }), { left: 497, top: 202.5 });
});

test("placeFloatingPanel flips to the left and clamps a vertical HUD anchor", () => {
    assert.deepEqual(placeFloatingPanel({
        panelWidth: 240,
        panelHeight: 180,
        viewportWidth: 600,
        viewportHeight: 400,
        target: { pos: [400, 100], size: [100, 80] },
        canvas: { left: 0, top: 0, scale: 1, offset: [0, 0] },
    }), { left: 148, top: 50 });
    assert.deepEqual(placeFloatingPanel({
        panelWidth: 240,
        panelHeight: 180,
        viewportWidth: 600,
        viewportHeight: 400,
        anchor: { orient: "v", left: 4, right: 40, top: 360, width: 36, height: 36 },
    }), { left: 52, top: 210 });
});
