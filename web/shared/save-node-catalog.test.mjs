import test from "node:test";
import assert from "node:assert/strict";

import {
    favoriteDisplayName,
    resolveSaveNodePalette,
    saveNodeColorLabel,
    seedDefaultWosaiFavorites,
} from "./save-node-catalog.js";

test("save-node palette drops missing CSS tokens", () => {
    const colors = resolveSaveNodePalette((token) => (
        token === "--ws-sn-palette-green" ? "#00AA00" : ""
    ));
    assert.deepEqual(colors, ["#00AA00"]);
});

test("save-node color labels follow palette token order", () => {
    assert.equal(
        saveNodeColorLabel("#00aa00", ["#00AA00"], (key) => `t:${key}`),
        "t:saveNode.colorGreen",
    );
    assert.equal(saveNodeColorLabel("#123456", [], (key) => key), "#123456");
});

test("favorite display names prefer locale, registry, then fallback", () => {
    assert.equal(
        favoriteDisplayName("WOSAI_CommonColor", {
            translate: () => "常用颜色",
        }),
        "常用颜色",
    );
    assert.equal(
        favoriteDisplayName("ThirdParty", {
            translate: (key) => key,
            registeredNodeTypes: { ThirdParty: { title: "Third Party" } },
        }),
        "Third Party",
    );
});

test("default WOSAI favorites seed once without replacing user records", () => {
    const empty = { nodes: [] };
    assert.equal(seedDefaultWosaiFavorites(empty, (type) => type, 100), true);
    assert.ok(empty.nodes.length >= 15);
    assert.equal(empty.nodes[0].addedAt, 100);
    assert.equal(seedDefaultWosaiFavorites(empty, (type) => type, 200), false);

    const existing = { nodes: [{ type: "UserNode" }] };
    assert.equal(seedDefaultWosaiFavorites(existing, (type) => type, 100), true);
    assert.deepEqual(existing.nodes, [{ type: "UserNode" }]);
});
