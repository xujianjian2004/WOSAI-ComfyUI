import test from "node:test";
import assert from "node:assert/strict";

import {
    addSizedDOMWidget,
    compactNodeToContent,
    ensureNodeMinSize,
    ensureWosaiStyles,
    hideSerializableWidget,
} from "./dom-widget.js";

test("hideSerializableWidget removes a backend widget from both layout systems", () => {
    const widget = {
        options: { serialize: true },
        style: {},
        draw() {},
        computeSize() { return [100, 20]; },
    };
    hideSerializableWidget(widget);
    assert.equal(widget.hidden, true);
    assert.deepEqual(widget.computeSize(), [0, 0]);
    assert.equal(widget.getHeight(), 0);
    assert.deepEqual(widget.computeLayoutSize(), {
        minHeight: 0,
        maxHeight: 0,
        height: 0,
        minWidth: 0,
    });
});

test("addSizedDOMWidget includes the host gutter in Classic and Nodes 2.0 layout", () => {
    let receivedOptions;
    const node = {
        size: [240, 100],
        addDOMWidget(name, type, element, options) {
            receivedOptions = options;
            return { name, type, element, options };
        },
    };
    const widget = addSizedDOMWidget(node, "ui", "HTML", {}, { height: 72 });
    assert.equal(receivedOptions.getMinHeight(), 88);
    assert.equal(receivedOptions.getMaxHeight(), 88);
    assert.equal(receivedOptions.getHeight(), 88);
    assert.deepEqual(widget.computeSize(240), [240, 88]);
    assert.equal(widget.computeLayoutSize().height, 88);
    assert.equal(widget.__wosaiContentHeight(), 72);
});

test("ensureNodeMinSize grows but never shrinks restored workflow dimensions", () => {
    const node = {
        size: [360, 220],
        computeSize: () => [280, 180],
        setSize(size) { this.size = size; },
        setDirtyCanvas() {},
    };
    ensureNodeMinSize(node, 300, 170);
    assert.deepEqual(node.size, [360, 220]);
    ensureNodeMinSize(node, 420, 390);
    assert.deepEqual(node.size, [420, 390]);
});

test("compactNodeToContent migrates an oversized automatic height once", () => {
    const node = {
        size: [360, 520],
        computeSize: () => [280, 184],
        setSize(size) { this.size = size; },
        setDirtyCanvas() {},
    };
    assert.equal(compactNodeToContent(node, 300, 132), true);
    assert.deepEqual(node.size, [360, 184]);
    assert.equal(compactNodeToContent(node, 300, 132), false);
    assert.deepEqual(node.size, [360, 184]);
});

test("compactNodeToContent can shrink a compact control width", () => {
    const node = {
        size: [460, 220],
        computeSize: () => [156, 112],
        setSize(size) { this.size = size; },
        setDirtyCanvas() {},
    };
    compactNodeToContent(node, 180, 100, { preserveWidth: false });
    assert.deepEqual(node.size, [180, 112]);
});

test("ensureWosaiStyles attaches required styles once and refreshes stale links", () => {
    const previousDocument = globalThis.document;
    const elements = new Map();
    globalThis.document = {
        getElementById(id) { return elements.get(id) ?? null; },
        createElement() { return {}; },
        head: {
            appendChild(element) { elements.set(element.id, element); },
        },
    };
    try {
        const custom = ["wosai-test-style", "https://example.test/test.css"];
        ensureWosaiStyles([custom]);
        ensureWosaiStyles([custom]);
        const customLink = elements.get("wosai-test-style");
        customLink.href = "https://example.test/stale.css";
        ensureWosaiStyles([custom]);
        assert.ok(elements.has("wosai-vars-link"));
        assert.ok(elements.has("wosai-theme-css"));
        assert.equal(customLink.rel, "stylesheet");
        assert.equal(customLink.href, custom[1]);
        assert.equal(elements.size, 3);
    } finally {
        globalThis.document = previousDocument;
    }
});
