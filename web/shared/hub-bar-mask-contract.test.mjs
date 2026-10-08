import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function source(relativePath) {
    return fs.readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

test("MaskEditor button is skinned with icon class and caption label", () => {
    const hubBar = source("../hub-bar.js");

    const actionsMatch = hubBar.match(/const NATIVE_MINI_ACTIONS = Object\.freeze\(\[[\s\S]*?\]\);/);
    assert.ok(actionsMatch, "NATIVE_MINI_ACTIONS not found");
    const actions = actionsMatch[0];

    assert.match(actions, /key:\s*"mask"/);
    assert.match(actions, /iconClass:\s*"icon-\[comfy--mask\]"/);
    assert.match(actions, /labelKey:\s*"nativeMask"/);

    const loopMatch = hubBar.match(/for \(const action of NATIVE_MINI_ACTIONS\) \{[\s\S]*?_skinMiniButton\(button, action\.key, label\);/);
    assert.ok(loopMatch, "NATIVE_MINI_ACTIONS loop not found");
    const loop = loopMatch[0];
    assert.match(loop, /if \(action\.testId\) \{[\s\S]*?button = toolbox\.querySelector\(`button\[data-testid="\$\{action\.testId\}"\]`\)/);
    assert.match(loop, /else if \(action\.iconClass\)/);
    assert.match(loop, /_buttonAnchor\(icon\)/);

    assert.match(hubBar, /mask:\s*'<svg[\s\S]*?<\/svg>'/);
});

test("MaskEditor caption label exists in both i18n locales", () => {
    const zh = JSON.parse(source("../locales/zh/menus.json"));
    const en = JSON.parse(source("../locales/en/menus.json"));

    assert.equal(zh.layoutToolkit.nativeMask, "遮罩");
    assert.equal(en.layoutToolkit.nativeMask, "Mask");
});
