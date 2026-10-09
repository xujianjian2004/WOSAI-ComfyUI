import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function source(relativePath) {
    return fs.readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const hubBar = source("../hub-bar.js");
const zhMenus = JSON.parse(source("../locales/zh/menus.json"));
const enMenus = JSON.parse(source("../locales/en/menus.json"));

test("uses a Set-backed multi-reason popup hide state", () => {
    assert.match(hubBar, /const _popupHideReasons = new Set\(\)/);
    assert.match(hubBar, /function _hideMiniBarForPopup\(reason = "default"\)/);
    assert.match(hubBar, /function _restoreMiniBarsAfterPopup\(reason = "default"\)/);
    assert.match(hubBar, /if \(reason\) _popupHideReasons\.add\(reason\)/);
    assert.match(hubBar, /if \(reason\) _popupHideReasons\.delete\(reason\)/);
    assert.match(hubBar, /if \(_popupHideReasons\.size > 0\) return;/);
});

test("observes the native ComfyUI color picker popup", () => {
    assert.match(hubBar, /const NATIVE_COLOR_PICKER_REASON = "nativeColor"/);
    assert.match(hubBar, /function _isNativeColorPickerOpen\(toolbox\)/);
    assert.match(hubBar, /function _syncNativeColorPickerPopupState\(\)/);
    assert.match(hubBar, /function _observeNativeColorPicker\(\)/);
    assert.match(hubBar, /_observeNativeColorPicker\(\)/);
});

test("coalesces native color picker mutations into one per-frame pass (no main-thread pin)", () => {
    assert.match(hubBar, /let _nativeColorSyncQueued = false/);
    assert.match(hubBar, /function _queueNativeColorSync\(\)/);
    // The MutationObserver callback must NOT call _syncNativeColorPickerPopupState
    // synchronously; it must route through the throttled _queueNativeColorSync.
    assert.match(hubBar, /new MutationObserver\(\(\) => _queueNativeColorSync\(\)\)/);
    assert.match(hubBar, /requestAnimationFrame\(\(\) => \{/);
});

test("detects the native color picker by its relative + absolute popup structure", () => {
    assert.match(hubBar, /button\[data-testid="color-picker-button"\]/);
    assert.match(hubBar, /button\.closest\("\.relative"\)/);
    assert.match(hubBar, /wrapper\.querySelector\(":scope > \.absolute"\)/);
    // Detection must not rely on the popup containing <button> elements; the
    // swatch list uses icon elements, so presence of a visible popup is enough.
    assert.match(hubBar, /popup\.offsetParent !== null/);
    assert.doesNotMatch(hubBar, /popup\.querySelectorAll\("button"\)\.length > 0/);
});

test("skins subgraph edit and publish buttons by their Lucide icon classes", () => {
    const actions = hubBar.match(/NATIVE_MINI_ACTIONS = Object\.freeze\(\[[\s\S]*?\]\)/)?.[0] || "";
    assert.match(actions, /iconClass:\s*"icon-\[lucide--settings-2\]"/);
    assert.match(actions, /key:\s*"editSubgraph"/);
    assert.match(actions, /labelKey:\s*"nativeEditSubgraph"/);
    assert.match(actions, /iconClass:\s*"icon-\[lucide--book-open\]"/);
    assert.match(actions, /key:\s*"publishSubgraph"/);
    assert.match(actions, /labelKey:\s*"nativePublishSubgraph"/);
});

test("provides SVG icons for the new subgraph actions", () => {
    assert.match(hubBar, /editSubgraph:\s*'<svg[\s\S]*?<\/svg>'/);
    assert.match(hubBar, /publishSubgraph:\s*'<svg[\s\S]*?<\/svg>'/);
});

test("has bilingual labels for subgraph edit and publish actions", () => {
    assert.equal(zhMenus.layoutToolkit.nativeEditSubgraph, "编辑");
    assert.equal(zhMenus.layoutToolkit.nativePublishSubgraph, "发布");
    assert.equal(enMenus.layoutToolkit.nativeEditSubgraph, "Edit Widgets");
    assert.equal(enMenus.layoutToolkit.nativePublishSubgraph, "Publish");
});
