import test from "node:test";
import assert from "node:assert/strict";

import {
    groupBounds,
    groupColor,
    nodeBounds,
    rectangleInside,
    rectanglesOverlap,
} from "./ignore-groups-geometry.js";

test("ignore-group geometry reads host bounds and normalizes colors", () => {
    assert.deepEqual(groupBounds({ _bounding: [1, 2, 3, 4] }), [1, 2, 3, 4]);
    assert.deepEqual(groupBounds({ pos: [5, 6], size: [7, 8] }), [5, 6, 7, 8]);
    assert.equal(groupColor({ color: "#abc" }), "#aabbcc");
    assert.equal(groupColor({ color: 0x123456 }), "#123456");
    assert.equal(groupColor({ color: "invalid" }), "");
});

test("collapsed node bounds use host width or a title fallback", () => {
    assert.deepEqual(nodeBounds({ pos: [2, 4], size: [100, 80] }), [2, 4, 100, 80]);
    assert.deepEqual(nodeBounds({
        pos: [2, 4],
        collapsed: true,
        _collapsed_width: 120,
    }, { titleHeight: 26 }), [2, 4, 120, 26]);
    assert.deepEqual(nodeBounds({
        pos: [2, 4],
        collapsed: true,
        title: "Node",
    }), [2, 4, 80, 30]);
});

test("rectangle predicates distinguish overlap, containment, and edge contact", () => {
    assert.equal(rectanglesOverlap([0, 0, 10, 10], [5, 5, 10, 10]), true);
    assert.equal(rectanglesOverlap([0, 0, 10, 10], [10, 0, 10, 10]), false);
    assert.equal(rectangleInside([2, 2, 4, 4], [0, 0, 10, 10]), true);
    assert.equal(rectangleInside([-1, 2, 4, 4], [0, 0, 10, 10]), false);
});
