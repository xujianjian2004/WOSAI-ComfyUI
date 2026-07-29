import assert from "node:assert/strict";
import test from "node:test";

import {
    normalizeIgnoreGroupsScale,
    readIgnoreGroupsState,
    writeIgnoreGroupsState,
} from "./ignore-groups-state.js";

test("IgnoreGroups state recovers invalid workflow properties", () => {
    const state = readIgnoreGroupsState({
        wosai_ig_filter: 42,
        wosai_ig_mode: "invalid",
        wosai_ig_active_set: ["A", null, 2, "B"],
        wosai_ig_sort_order: "unknown",
        wosai_ig_scale: 99,
    });
    assert.equal(state.filter, "");
    assert.equal(state.mode, "default");
    assert.deepEqual(state.activeSet, ["A", "B"]);
    assert.equal(state.sortOrder, "position");
    assert.equal(state.scale, 5);
});

test("IgnoreGroups scale follows the half-step UI contract", () => {
    assert.equal(normalizeIgnoreGroupsScale(0), 1);
    assert.equal(normalizeIgnoreGroupsScale(2.26), 2.5);
    assert.equal(normalizeIgnoreGroupsScale("4.5"), 4.5);
    assert.equal(normalizeIgnoreGroupsScale("bad"), 1);
});

test("IgnoreGroups state writer preserves unrelated node properties", () => {
    const properties = { userField: "keep" };
    const result = writeIgnoreGroupsState(properties, {
        filter: "hero",
        mode: "always_one",
        active: "A",
        activeSet: null,
        nameColor: null,
        disabled: true,
        sortOrder: "alphabet",
        colorFilter: "none",
        scale: 2,
    });
    assert.equal(result, properties);
    assert.equal(result.userField, "keep");
    assert.equal(result.wosai_ig_mode, "always_one");
    assert.equal(result.wosai_ig_scale, 2);
});
