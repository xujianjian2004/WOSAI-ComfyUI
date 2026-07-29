import test from "node:test";
import assert from "node:assert/strict";

import {
    filterFavoriteNodes,
    formatShortcut,
    fuzzyMatch,
    isShortcutMatch,
    matchesFavoriteNode,
    shortcutFromEvent,
} from "./save-node-query.js";

test("save-node shortcuts format, capture, and compare consistently", () => {
    const event = { key: "F", altKey: true, ctrlKey: false, shiftKey: false, metaKey: false };
    const shortcut = shortcutFromEvent(event);
    assert.equal(formatShortcut(shortcut), "Alt+F");
    assert.equal(isShortcutMatch(event, shortcut), true);
    assert.equal(isShortcutMatch({ ...event, shiftKey: true }, shortcut), false);
});

test("fuzzy search accepts direct and subsequence matches", () => {
    assert.equal(fuzzyMatch("Common Color", "color"), true);
    assert.equal(fuzzyMatch("CommonColor", "cmcl"), true);
    assert.equal(fuzzyMatch("CommonColor", "xyz"), false);
    assert.equal(matchesFavoriteNode({ displayName: "补帧", type: "FrameInterpolation" }, "bz", ["bz", "buzhen"]), true);
});

test("favorite filtering combines sort, category, and every search term", () => {
    const nodes = [
        { type: "B", displayName: "Beta Color", category: "WOSAI", categoryId: "default", usageCount: 3, order: 2 },
        { type: "A", displayName: "Alpha Color", category: "WOSAI", categoryId: "default", usageCount: 8, order: 1 },
        { type: "C", displayName: "Gamma", category: "Other", categoryId: "other", usageCount: 20, order: 3 },
    ];
    const filtered = filterFavoriteNodes(nodes, {
        category: "default",
        search: "color WOSAI",
        sort: "freq",
    });
    assert.deepEqual(filtered.map(({ type }) => type), ["A", "B"]);
    assert.deepEqual(nodes.map(({ type }) => type), ["B", "A", "C"]);
});
