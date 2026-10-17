import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

// 契约：尺寸选择节点的**自定义（手动）模式不设上限**，
//   只保留最小值约束与 latent 的 8px 网格对齐。
//   历史实现把宽高夹到 resolutions.json 的 max_dimension（2048），
//   导致用户输入更大尺寸时被静默改回 2048。

function source(relativePath) {
    return fs.readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const sizeSelectJs = source("../size-select.js");
const sizeSelectPy = source("../../nodes/size_select.py");
const resolutions = JSON.parse(source("../data/resolutions.json"));

test("resolutions.json no longer declares a hard max_dimension", () => {
    assert.equal(resolutions.max_dimension, undefined, "max_dimension must be gone (it was the removed cap)");
    assert.ok(Number.isInteger(resolutions.min_dimension) && resolutions.min_dimension > 0);
    assert.ok(Number.isInteger(resolutions.default_custom_height), "default_custom_height replaces max_dimension");
});

test("front-end roundTo8 clamps to the minimum only", () => {
    assert.ok(!/MAX_DIMENSION/.test(sizeSelectJs), "size-select.js must not reference MAX_DIMENSION anymore");
    const fn = sizeSelectJs.match(/function roundTo8\([\s\S]*?\n\}/);
    assert.ok(fn, "roundTo8 not found");
    assert.match(fn[0], /function roundTo8\(v\) \{/, "roundTo8 must not take an upper-bound argument");
    assert.ok(!/Math\.min\(/.test(fn[0]), "roundTo8 must not clamp to an upper bound");
    assert.match(fn[0], /Math\.max\(MIN_DIMENSION/, "roundTo8 must still clamp to the minimum");
});

test("front-end seeds the custom dimension widgets without an upper clamp", () => {
    assert.match(sizeSelectJs, /if \(cusW\) cusW\.value = roundTo8\(cusW\.value\);/);
    assert.match(sizeSelectJs, /if \(cusH\) cusH\.value = roundTo8\(cusH\.value\);/);
    assert.match(sizeSelectJs, /let baseHeight\s+= cusH\?\.value \|\| DEFAULT_CUSTOM_HEIGHT;/);
});

test("python no longer clamps custom dimensions to an upper bound", () => {
    assert.ok(!/MAX_DIMENSION/.test(sizeSelectPy), "size_select.py must not reference MAX_DIMENSION anymore");
    const branch = sizeSelectPy.match(/if Manual_Mode == "on":[\s\S]*?\n {8}else:/);
    assert.ok(branch, "manual branch of _determine_target_size not found");
    assert.ok(!/[^\s]min\(/.test(branch[0]), "manual branch must not clamp to an upper bound");
    assert.match(branch[0], /w = max\(MIN_DIMENSION, int\(Custom_Width or MIN_DIMENSION\)\)/);
    assert.match(branch[0], /h = max\(MIN_DIMENSION, int\(Custom_Height or MIN_DIMENSION\)\)/);
});

test("python INT specs declare no max for the custom dimensions", () => {
    for (const name of ["Custom_Width", "Custom_Height"]) {
        const v1 = sizeSelectPy.match(new RegExp(`"${name}":\\s*\\("INT".*?\\),`));
        assert.ok(v1, `V1 spec for ${name} not found`);
        assert.ok(/"max"/.test(v1[0]) === false, `V1 ${name} must not declare a max`);
        assert.match(v1[0], /"min": MIN_DIMENSION/);

        const v3 = sizeSelectPy.match(new RegExp(`_io\\.Int\\.Input\\("${name}"[\\s\\S]*?\\),`));
        assert.ok(v3, `V3 spec for ${name} not found`);
        assert.ok(/max\s*=/.test(v3[0]) === false, `V3 ${name} must not declare a max`);
        assert.match(v3[0], /min=MIN_DIMENSION/);
    }
});

test("python validation still enforces the minimum and the 8px grid", () => {
    assert.match(sizeSelectPy, /if custom_width < MIN_DIMENSION or custom_height < MIN_DIMENSION:/);
    assert.match(sizeSelectPy, /if custom_width % 8 != 0 or custom_height % 8 != 0:/);
});
