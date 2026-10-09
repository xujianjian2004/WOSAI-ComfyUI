import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function source(relativePath) {
    return fs.readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const hubBar = source("../hub-bar.js");
const colorBar = source("../color-bar.js");

test("palette / node no longer auto-hide on click (driven by HUD popup instead)", () => {
    const block = hubBar.match(/const AUTO_HIDE_MINI_ACTIONS = new Set\(\[[\s\S]*?\]\);/);
    assert.ok(block, "AUTO_HIDE_MINI_ACTIONS not found");
    const set = block[0];
    assert.ok(!/"palette"/.test(set), "palette should be removed from AUTO_HIDE_MINI_ACTIONS");
    assert.ok(!/"node"/.test(set), "node should be removed from AUTO_HIDE_MINI_ACTIONS");
    // 仍保留其它非 HUD 面板动作
    for (const keep of ["align", "autoConnect", "replace", "collapse", "expand", "clone", "lock"]) {
        assert.match(set, new RegExp(`"${keep}"`), `${keep} should remain in AUTO_HIDE_MINI_ACTIONS`);
    }
});

test("hideMiniBarForPopup / restoreMiniBarsAfterPopup are exported", () => {
    assert.match(hubBar, /export function hideMiniBarForPopup\(\)/);
    assert.match(hubBar, /export function restoreMiniBarsAfterPopup\(\)/);
});

test("popup-hidden attribute hides the toolbox via CSS without hiding the color picker popup", () => {
    const rule = hubBar.match(/\[data-testid="selection-toolbox"\]\[data-wosai-mini-popup-hidden\] \{[\s\S]*?\}/);
    assert.ok(rule, "popup-hidden CSS rule not found");
    assert.match(rule[0], /visibility:hidden!important/);
    // The native color picker popup is a child of the toolbox; make sure we
    // keep it visible instead of hiding it together with the bar.
    assert.match(hubBar, /button\[data-testid="color-picker-button"\] ~ \.absolute/);
    assert.match(hubBar, /visibility:visible!important/);
    assert.match(hubBar, /opacity:1!important/);
});

test("color-bar hides the hub bar when the HUD opens", () => {
    // openBar 内调用 hideMiniBarForPopup
    const openBar = colorBar.match(/async function openBar\(\) \{[\s\S]*?\n\}/);
    assert.ok(openBar, "openBar not found");
    assert.match(openBar[0], /_hubBarMod\?\.hideMiniBarForPopup\?\.\(\)/);
});

test("color-bar restores the hub bar on real close but not on tab/lang switch", () => {
    // closeBar 接受 keepHidden 选项
    assert.match(colorBar, /function closeBar\(opts = \{\}\) \{/);
    // 真实关闭（默认）恢复操作栏
    assert.match(colorBar, /if \(!opts\.keepHidden\) _hubBarMod\?\.restoreMiniBarsAfterPopup\?\.\(\);/);
    // 切 tab / 语言切换时 keepHidden，避免操作栏闪现
    const switches = colorBar.match(/closeBar\(\{ keepHidden: true \}\)/g) || [];
    assert.ok(switches.length >= 2, "tab switch and lang change should both use keepHidden:true");
});
