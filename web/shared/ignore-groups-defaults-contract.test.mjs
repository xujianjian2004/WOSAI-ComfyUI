// 忽略编组默认排序契约：新建节点与「一键恢复默认」都必须落在「按字母」。
// 背景：位置排序会随画布布局变化而跳动，编组一多就难以预期；默认值因此
// 由 position 改为 alphabet。已持久化了显式取值的旧存档不受影响。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readIgnoreGroupsState } from "./ignore-groups-state.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE = fs.readFileSync(path.join(ROOT, "ignore-groups.js"), "utf8");

function extractFunctionBody(code, name) {
    const start = code.indexOf(`function ${name}`);
    if (start === -1) return null;
    const brace = code.indexOf("{", start);
    if (brace === -1) return null;
    let depth = 0;
    let end = -1;
    for (let i = brace; i < code.length; i += 1) {
        if (code[i] === "{") depth += 1;
        else if (code[i] === "}") {
            depth -= 1;
            if (depth === 0) { end = i + 1; break; }
        }
    }
    return code.slice(brace, end);
}

const RESET_BODY = extractFunctionBody(SOURCE, "resetAll");

test("新节点的排序默认为按字母", () => {
    assert.equal(readIgnoreGroupsState({}).sortOrder, "alphabet");
});

test("非法排序值回落到按字母而不是按位置", () => {
    assert.equal(readIgnoreGroupsState({ wosai_ig_sort_order: "unknown" }).sortOrder, "alphabet");
});

test("一键恢复默认把排序复位为按字母", () => {
    assert.ok(RESET_BODY, "必须能抽取出 resetAll 函数体");
    assert.match(RESET_BODY, /sortOrder\s*=\s*"alphabet"/,
        "resetAll 必须把 sortOrder 复位为 alphabet");
    assert.match(RESET_BODY, /uiSort\s*=\s*"alphabet"/,
        "resetAll 必须把面板临时态 uiSort 同步复位为 alphabet");
});

test("一键恢复默认把分段控件显示同步到按字母", () => {
    assert.match(RESET_BODY, /sSeg\.setActive\("alphabet"\)/,
        "resetAll 必须把排序分段控件切到按字母，否则显示与状态不一致");
});

test("排序分段控件仍同时提供按位置与按字母两个选项", () => {
    assert.match(SOURCE, /\{ value: "position", label: t\('nodes\.ignoreGroups\.sortByPosition'\) \}/);
    assert.match(SOURCE, /\{ value: "alphabet", label: t\('nodes\.ignoreGroups\.sortByAlphabet'\) \}/);
});
