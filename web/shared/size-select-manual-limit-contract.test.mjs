import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

// 契约：尺寸选择节点的**自定义（手动）模式不再被 2048 卡住**，
//   只保留最小值约束与 latent 的 8px 网格对齐。
//   历史实现把宽高夹到 resolutions.json 的 max_dimension（2048），
//   导致用户输入更大尺寸时被静默改回 2048。
//   ⚠ 注意「去掉 max」并不等于解除上限：ComfyUI 前端 `useIntWidget()` 里
//   `max: spec.max ?? 2048` 会把缺失的 max 兜底成 2048，所以端口必须**显式**
//   声明一个远大于 2048 的 max（后端计算与校验仍不夹它）。

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

test("front-end alignment clamps to the minimum only", () => {
    assert.ok(!/MAX_DIMENSION/.test(sizeSelectJs), "size-select.js must not reference MAX_DIMENSION anymore");
    const fn = sizeSelectJs.match(/function alignTo\([\s\S]*?\n\}/);
    assert.ok(fn, "alignTo not found");
    assert.match(fn[0], /function alignTo\(v, multiple = DEFAULT_ALIGN_MULTIPLE\) \{/, "alignTo takes the grid step as an argument");
    assert.ok(!/Math\.min\(/.test(fn[0]), "alignTo must not clamp to an upper bound");
    assert.ok(!/Math\.floor\(n \/ step\)/.test(fn[0]), "alignTo must not floor to the grid");
    assert.match(fn[0], /Math\.max\(MIN_DIMENSION/, "alignTo must still clamp to the minimum");
});

test("front-end seeds the custom dimension widgets without an upper clamp", () => {
    assert.match(sizeSelectJs, /if \(cusW\) cusW\.value = alignTo\(cusW\.value, gridStep\(almW\?\.value\)\);/);
    assert.match(sizeSelectJs, /if \(cusH\) cusH\.value = alignTo\(cusH\.value, gridStep\(almW\?\.value\)\);/);
    assert.match(sizeSelectJs, /let baseHeight\s+= cusH\?\.value \|\| DEFAULT_CUSTOM_HEIGHT;/);
});

test("python does not clamp custom dimensions to an upper bound", () => {
    // MAX_DIMENSION 现在存在（UI 需要显式上限），但只能出现在端口声明里，
    // 不能出现在计算分支——后端对通过 API 传入的更大值仍然宽容。
    const branch = sizeSelectPy.match(/if Manual_Mode == "on":[\s\S]*?\n {8}else:/);
    assert.ok(branch, "manual branch of _determine_target_size not found");
    assert.ok(!/[^\s]min\(/.test(branch[0]), "manual branch must not clamp to an upper bound");
    assert.ok(!/MAX_DIMENSION/.test(branch[0]), "manual branch must not reference MAX_DIMENSION");
    assert.match(branch[0], /w = max\(MIN_DIMENSION, int\(Custom_Width or MIN_DIMENSION\)\)/);
    assert.match(branch[0], /h = max\(MIN_DIMENSION, int\(Custom_Height or MIN_DIMENSION\)\)/);
});

// ⚠ 关键陷阱：ComfyUI 前端 `useIntWidget()` 写死了 `max: spec.max ?? 2048`。
//   「省略 max」不等于无上限——它会被前端兜底成 2048，于是「后端已解锁、UI 仍卡
//   2048」。要真正解除 2048，必须显式声明一个远大于它的 max。
test("python INT specs declare an explicit max above the legacy 2048 cap", () => {
    const declared = sizeSelectPy.match(/^MAX_DIMENSION = (\d+)$/m);
    assert.ok(declared, "MAX_DIMENSION constant not found");
    assert.ok(Number(declared[1]) > 2048, `MAX_DIMENSION must exceed the legacy 2048 cap (got ${declared[1]})`);
    for (const name of ["Custom_Width", "Custom_Height"]) {
        const v1 = sizeSelectPy.match(new RegExp(`"${name}":\\s*\\("INT".*?\\),`));
        assert.ok(v1, `V1 spec for ${name} not found`);
        assert.match(v1[0], /"max": MAX_DIMENSION/, `V1 ${name} must declare an explicit max`);
        assert.match(v1[0], /"min": MIN_DIMENSION/);

        const v3 = sizeSelectPy.match(new RegExp(`_io\\.Int\\.Input\\("${name}"[\\s\\S]*?\\),`));
        assert.ok(v3, `V3 spec for ${name} not found`);
        assert.match(v3[0], /max=MAX_DIMENSION/, `V3 ${name} must declare an explicit max`);
        assert.match(v3[0], /min=MIN_DIMENSION/);
    }
});

test("python validation still enforces the minimum and the 8px grid", () => {
    assert.match(sizeSelectPy, /if custom_width < MIN_DIMENSION or custom_height < MIN_DIMENSION:/);
    assert.match(sizeSelectPy, /if custom_width % 8 != 0 or custom_height % 8 != 0:/);
});
