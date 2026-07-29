import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
const hexPattern = /^#[0-9A-F]{6}$/;

const colors = await readJson("web/data/common-colors.json");
assert.equal(typeof colors.default_custom_color, "string");
assert.match(colors.default_custom_color, hexPattern);
assert.equal(typeof colors.custom?.zh, "string");
assert.equal(typeof colors.custom?.en, "string");
assert.ok(Array.isArray(colors.colors) && colors.colors.length > 0);
const colorNames = new Set();
for (const color of colors.colors) {
    assert.equal(typeof color.name, "string");
    assert.equal(typeof color.en, "string");
    assert.match(color.hex, hexPattern);
    assert.ok(!colorNames.has(color.name), `duplicate color name: ${color.name}`);
    colorNames.add(color.name);
}

const sizes = await readJson("web/data/resolutions.json");
assert.ok(Number.isInteger(sizes.min_dimension) && sizes.min_dimension > 0);
assert.ok(Number.isInteger(sizes.max_dimension) && sizes.max_dimension >= sizes.min_dimension);
assert.ok(Array.isArray(sizes.aspect_ratios) && sizes.aspect_ratios.length > 0);
assert.ok(sizes.resolutions?.[sizes.default_resolution], "default resolution must exist");
const aspectKeys = new Set(sizes.aspect_ratios.map((label) => label.split(" ")[0]));
assert.ok(aspectKeys.has(sizes.default_ratio.split(" ")[0]), "default aspect ratio must exist");
for (const [resolution, ratios] of Object.entries(sizes.resolutions)) {
    assert.deepEqual(new Set(Object.keys(ratios)), aspectKeys, `${resolution} aspect ratios differ`);
    for (const [ratio, dimensions] of Object.entries(ratios)) {
        assert.ok(
            Array.isArray(dimensions)
                && dimensions.length === 2
                && dimensions.every((value) => Number.isInteger(value) && value > 0 && value % 8 === 0),
            `${resolution}/${ratio} must contain two positive 8-aligned dimensions`,
        );
    }
}

const commonColorSource = await readFile(new URL("nodes/common_color.py", root), "utf8");
const sizeSource = await readFile(new URL("nodes/size_select.py", root), "utf8");
assert.match(commonColorSource, /common-colors\.json/);
assert.match(sizeSource, /resolutions\.json/);

console.log(`Shared data OK: ${colors.colors.length} colors, ${Object.keys(sizes.resolutions).length} resolution tiers`);
