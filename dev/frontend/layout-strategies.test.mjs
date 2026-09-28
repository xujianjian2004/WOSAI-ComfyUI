import assert from "node:assert/strict";
import test from "node:test";

import { getNodeLayoutBox } from "./layout-geometry.js";
import { computeLayout, resolveLayoutOverlaps } from "./layout-engine.js";

function assertPositions(result, expectedIds) {
    assert.deepEqual(Object.keys(result.positions).sort(), expectedIds.slice().sort());
    for (const position of Object.values(result.positions)) {
        assert.equal(position.length, 2);
        assert.ok(position.every(Number.isFinite));
    }
}

test("layout geometry includes the title bar without mutating the node", () => {
    const node = { id: 1, pos: [10, 20], size: [120, 60] };
    const before = JSON.stringify(node);
    const box = getNodeLayoutBox(node, { titleH: 24, measure: false });
    assert.deepEqual(box, {
        id: 1, x: 10, y: 20, w: 120, h: 84, bodyH: 60, titleH: 24,
        collapsed: false, reroute: false, type: "", pinned: false,
    });
    assert.equal(JSON.stringify(node), before);
});

test("layout measurement does not let computeSize resize node.size", () => {
    const node = {
        id: 2,
        pos: [0, 0],
        size: [120, 60],
        computeSize(out) {
            out[0] = 480;
            out[1] = 260;
            this.size = [900, 700];
            return out;
        },
    };
    const box = getNodeLayoutBox(node, { titleH: 24 });
    assert.deepEqual(node.size, [120, 60]);
    assert.equal(box.w, 480);
    assert.equal(box.h, 284);
});

test("layout geometry uses title-only height for collapsed nodes", () => {
    const box = getNodeLayoutBox({ id: 1, size: [120, 60], flags: { collapsed: true } }, { measure: false });
    assert.equal(box.h, 24);
});

test("overlap safety pass separates variable-height nodes", () => {
    const boxes = [
        { id: "a", w: 180, h: 160 },
        { id: "b", w: 120, h: 80 },
        { id: "c", w: 100, h: 60 },
    ];
    const result = resolveLayoutOverlaps(boxes, {
        a: [0, 0],
        b: [0, 20],
        c: [260, 20],
    }, { vGap: 24 });
    assert.deepEqual(result.a, [0, 0]);
    assert.deepEqual(result.b, [0, 184]);
    assert.deepEqual(result.c, [260, 20]);
});

test("overlap safety pass keeps pinned obstacles fixed", () => {
    const result = resolveLayoutOverlaps(
        [{ id: "movable", w: 120, h: 60 }],
        { movable: [0, 0] },
        { vGap: 20, fixedNodes: [{ id: "pinned", x: 0, y: 10, w: 160, h: 90 }] },
    );
    assert.deepEqual(result.movable, [0, 120]);
});

test("flow layout compresses a cycle into one horizontal component", () => {
    const cycle = ["a", "b", "c"].map((id) => ({ id, w: 100, h: 60 }));
    const result = computeLayout(cycle, [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
    ], { anchorX: 0, startY: 0, vGap: 20 });
    assertPositions(result, ["a", "b", "c"]);
    assert.equal(new Set(Object.values(result.positions).map((position) => position[0])).size, 1);
});
