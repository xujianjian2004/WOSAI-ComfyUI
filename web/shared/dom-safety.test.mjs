import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function source(relativePath) {
    return fs.readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

test("replace picker renders third-party node metadata as text", () => {
    const code = source("../layout-toolkit.js");
    assert.match(code, /title\.textContent = String\(d\.title/);
    assert.match(code, /type\.textContent = String\(d\.type/);
    assert.doesNotMatch(code, /it\.innerHTML = `[^`]*\$\{d\.title\}/);
});

test("menu-hide panel does not concatenate menu labels into HTML", () => {
    const code = source("../menu-hide.js");
    assert.match(code, /checkbox\.dataset\.item = item/);
    assert.match(code, /text\.textContent = display/);
    assert.doesNotMatch(code, /data-item="\$\{safe\}"/);
    assert.doesNotMatch(code, /<span>\$\{display\}<\/span>/);
});

test("WOSAI native settings use one stable registration owner", () => {
    const settings = source("../settings.js");
    const constants = source("./constants.js");
    const expectedIds = [
        "wosai-glass-theme",
        "WOSAI.ColorBar.HoldMode",
        "WOSAI.LayoutToolkit.Crosshair",
        "wosai-autoConnect",
        "wosai-shakeEnabled",
        "wosai-shakeReversals",
        "wosai-perf-singleCanvasPan",
        "wosai-perf-throttleRenderInfo",
        "wosai-perf-disableShadows",
        "wosai-perf-disableConnectionBorders",
        "wosai-perf-disableRoundedCorners",
        "WOSAI.About.Copyright",
    ];

    assert.match(settings, /app\.ui\.settings\.addSetting\(definition\)/);
    assert.match(settings, /await registerNativeWosaiSettings\(\)/);
    for (const id of expectedIds) assert.ok(settings.includes(`"${id}"`), `missing setting ${id}`);

    // 常量型 id 经 STORAGE_KEYS 引用（单一来源），其值在 constants.js 中定义。
    for (const [key, value] of [
        ["fps", "wosai-fps"],
        ["showLauncher", "WOSAI.ColorBar.ShowLauncher"],
        ["menuHideEnabled", "wosai-menu-hide-enabled"],
    ]) {
        assert.match(
            settings,
            new RegExp(`id:\\s*STORAGE_KEYS\\.${key}\\b`),
            `missing STORAGE_KEYS.${key} setting`,
        );
        assert.match(
            constants,
            new RegExp(`${key}:\\s*"${value.replace(/\./g, "\\.")}"`),
            `STORAGE_KEYS.${key} must be ${value}`,
        );
    }
    assert.match(source("../color-bar.js"), /name: "WOSAI\.ColorBar",[\s\S]*?settings: \[\]/);
    assert.match(source("../layout-toolkit.js"), /name: "WOSAI\.LayoutToolkit",[\s\S]*?settings: \[\]/);
});

test("MiniBar actions reuse initialized extension modules", () => {
    const code = source("../hub-bar.js");
    const moduleUrls = code.match(/const CORE_MODULE_URLS[\s\S]*?\}\);/)?.[0] || "";

    assert.ok(moduleUrls.includes('color: "./color-bar.js"'));
    assert.ok(moduleUrls.includes('node: "./layout-toolkit.js"'));
    assert.ok(moduleUrls.includes('autoConnect: "./auto-connect.js"'));
    assert.doesNotMatch(moduleUrls, /\?v=/);
    assert.match(code, /let openHud = window\.__wosaiOpenHud/);
    assert.match(code, /let openAlign = window\.__wosaiOpenAlignPanel/);
    assert.match(code, /let openReplace = window\.__wosaiOpenReplacePicker/);
    assert.match(code, /let handler = window\[globalName\]/);
    assert.match(code, /const direct = window\.__wosaiAutoConnect/);
    assert.match(code, /__wosaiSelectionToolboxCoreRegistered === ADAPTER_VERSION/);
    assert.match(code, /export function createHubBar\(\)\s*\{\s*_registerCoreCommands\(\);\s*\}\s*[\s\S]*?_registerCoreCommands\(\);/);
    assert.match(code, /return el\?\.closest\?\.\("button,\[role='button'\]"\)/);
    // TitleNote 抑制判定覆盖整个选中集合，而非单个 selectedItem。
    assert.match(code, /if \(_isTitleNoteMiniBarSelection\(\)\) return \[\];/);
    assert.match(
        code,
        /function _isTitleNoteMiniBarSelection\(\)\s*\{\s*return _selectedMiniBarItems\(\)\.some\(\(item\) => item\?\.type === "WOSAI_TitleNote"\);\s*\}/,
    );
    assert.match(code, /button\[data-wosai-mini-captioned\]/);
    assert.ok(code.includes("return /\\barrange\\b|\\u6392\\u5217/i.test(marker)"));
    assert.match(code, /button\[data-wosai-mini-captioned\] \{\s+position:relative!important;\s+overflow:visible!important;\s+width:var\(--ws-hk-mini-button-width\)!important;[\s\S]*?height:var\(--ws-hk-mini-button-height\)!important;/);
    assert.match(code, /button\[data-wosai-mini-captioned\]::before \{\s+content:"";[\s\S]*?top:var\(--ws-hk-mini-icon-bg-top\);[\s\S]*?width:var\(--ws-hk-btn-size\);[\s\S]*?height:var\(--ws-hk-btn-size\);/);
    assert.match(code, /data-wosai-mini-arrange-surface/);
    assert.match(code, /arrange: '<svg viewBox="0 0 24 24"/);
    assert.match(code, /wosai-mini-arrange-original/);
});

test("context menus use ComfyUI extension hooks instead of prototype monkey patches", () => {
    const menuHide = source("../menu-hide.js");
    const layoutToolkit = source("../layout-toolkit.js");

    assert.match(menuHide, /getCanvasMenuItems\(\)/);
    assert.match(menuHide, /getNodeMenuItems\(\)/);
    assert.match(layoutToolkit, /getNodeMenuItems\(node\)/);
    assert.doesNotMatch(menuHide, /prototype\.get(?:Canvas|Node)MenuOptions\s*=/);
    assert.doesNotMatch(layoutToolkit, /prototype\.getNodeMenuOptions\s*=/);
});

test("internal JavaScript imports preserve one ComfyUI module identity", () => {
    const webRoot = fileURLToPath(new URL("../", import.meta.url));
    const files = fs.readdirSync(webRoot, { recursive: true })
        .filter((name) => name.endsWith(".js") && !name.includes("node_modules"));

    for (const name of files) {
        const code = fs.readFileSync(new URL(`../${name.replaceAll("\\", "/")}`, import.meta.url), "utf8");
        assert.doesNotMatch(
            code,
            /(?:\bfrom\s*|\bimport\s*\()\s*["'][^"']+\?v=/,
            `${name} creates a duplicate versioned module instance`,
        );
    }
});
