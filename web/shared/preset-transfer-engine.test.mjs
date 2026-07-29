import assert from "node:assert/strict";
import test from "node:test";

import { parsePresetImport, serializePresetExport } from "./preset-transfer-engine.js";

test("structured TXT export round-trips", () => {
    const presets = [{ label: "Repair", prompt_cn: "修复照片", prompt_en: "Restore photo" }];
    assert.deepEqual(parsePresetImport(serializePresetExport(presets)), presets);
});

test("an intentionally empty label survives export and import", () => {
    const presets = [{ label: "", prompt_cn: "清空标签后的提示词", prompt_en: "Prompt with no label" }];
    assert.deepEqual(parsePresetImport(serializePresetExport(presets)), presets);
});

test("plain single-language text keeps its language", () => {
    assert.deepEqual(parsePresetImport("修复老照片", "Imported"), [
        { label: "Imported", prompt_cn: "修复老照片", prompt_en: "" },
    ]);
    assert.deepEqual(parsePresetImport("restore an old photo", "Imported"), [
        { label: "Imported", prompt_cn: "", prompt_en: "restore an old photo" },
    ]);
});

test("numbered bilingual lines pair by order without markdown headings", () => {
    assert.deepEqual(parsePresetImport([
        "1. 修复老照片",
        "Restore old photo",
        "2. 清理污渍",
        "Remove stains",
    ].join("\n")), [
        { label: "Preset 1", prompt_cn: "修复老照片", prompt_en: "Restore old photo" },
        { label: "Preset 2", prompt_cn: "清理污渍", prompt_en: "Remove stains" },
    ]);
});

test("separate Chinese and English lines pair by index", () => {
    assert.deepEqual(parsePresetImport([
        "修复老照片",
        "清理污渍",
        "Restore old photo",
        "Remove stains",
    ].join("\n")), [
        { label: "Preset 1", prompt_cn: "修复老照片", prompt_en: "Restore old photo" },
        { label: "Preset 2", prompt_cn: "清理污渍", prompt_en: "Remove stains" },
    ]);
});

test("imports more than nine records without truncating at nine", () => {
    const source = Array.from({ length: 12 }, (_, index) => `${index + 1}. prompt ${index + 1}`).join("\n");
    const presets = parsePresetImport(source);
    assert.equal(presets.length, 12);
    assert.equal(presets[11].prompt_en, "prompt 12");
    assert.match(presets.meta.warnings.join(" "), /pages of 9/);
});

test("imports JSON preset arrays", () => {
    const presets = parsePresetImport(JSON.stringify([
        { name: "Repair", cn: "修复照片", en: "Restore photo" },
        { label: "Cleanup", prompt_cn: "清理污渍", prompt_en: "Remove stains" },
    ]), "", "presets.json");
    assert.deepEqual(presets, [
        { label: "Repair", prompt_cn: "修复照片", prompt_en: "Restore photo" },
        { label: "Cleanup", prompt_cn: "清理污渍", prompt_en: "Remove stains" },
    ]);
    assert.equal(presets.meta.format, "json");
});

test("imports CSV headers and quoted commas", () => {
    const presets = parsePresetImport([
        "label,prompt_cn,prompt_en",
        'Repair,"修复照片，保留细节","Restore photo, preserve details"',
        'Cleanup,"清理污渍","Remove stains"',
    ].join("\n"), "", "presets.csv");
    assert.deepEqual(presets, [
        { label: "Repair", prompt_cn: "修复照片，保留细节", prompt_en: "Restore photo, preserve details" },
        { label: "Cleanup", prompt_cn: "清理污渍", prompt_en: "Remove stains" },
    ]);
    assert.equal(presets.meta.format, "csv");
});
