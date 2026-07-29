import test from "node:test";
import assert from "node:assert/strict";

import { SAVE_NODE_LIMITS, sanitizeSaveNodeData } from "./save-node-data.js";

const options = { defaultName: "默认", defaultColor: "#123456" };

test("sanitizes category colors and redirects unknown category references", () => {
    const result = sanitizeSaveNodeData({
        categories: [
            { id: "unsafe", name: "Unsafe", color: `red"></span><script>alert(1)</script>` },
        ],
        nodes: [{ type: "Demo", categoryId: "missing", displayName: "Demo" }],
    }, options);

    assert.equal(result.categories[0].id, "default");
    assert.equal(result.categories.find((item) => item.id === "unsafe").color, "#123456");
    assert.equal(result.nodes[0].categoryId, "default");
    assert.doesNotMatch(JSON.stringify(result), /script/i);
});

test("drops unknown fields, invalid IDs, duplicates, and clamps numeric values", () => {
    const result = sanitizeSaveNodeData({
        categories: [{ id: "bad id", color: "#FFFFFF" }],
        nodes: [
            { type: "Demo", displayName: "Name", categoryId: "default", rating: 99, usageCount: -4, dangerous: true },
            { type: "Demo", displayName: "Duplicate" },
        ],
        snippets: [{ html: "<script />" }],
    }, options);

    assert.equal(result.nodes.length, 1);
    assert.deepEqual(result.nodes[0], {
        type: "Demo",
        displayName: "Name",
        category: "Unknown",
        categoryId: "default",
        addedAt: result.nodes[0].addedAt,
        order: 1,
        usageCount: 0,
        rating: 5,
    });
    assert.equal("dangerous" in result.nodes[0], false);
    assert.equal("snippets" in result, false);
});

test("enforces category and node count limits", () => {
    const result = sanitizeSaveNodeData({
        categories: Array.from({ length: SAVE_NODE_LIMITS.categories + 20 }, (_, index) => ({
            id: `cat_${index}`,
            name: `Category ${index}`,
            color: "#ABCDEF",
        })),
        nodes: Array.from({ length: SAVE_NODE_LIMITS.nodes + 20 }, (_, index) => ({
            type: `Node_${index}`,
            categoryId: "default",
        })),
    }, options);

    assert.equal(result.categories.length, SAVE_NODE_LIMITS.categories);
    assert.equal(result.categories[0].id, "default");
    assert.equal(result.nodes.length, SAVE_NODE_LIMITS.nodes);
});
