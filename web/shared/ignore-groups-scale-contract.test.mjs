// 忽略编组缩放契约：操作缩放比滑块后，node.size 必须严格跟随档位变化。
// 背景：_applyScale() 原先只调用 _igEnsureMinimumSize()，该函数会保留当前
// 较大的 node.size，导致缩小档位时节点尺寸不跟随收缩。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

const APPLY_SCALE_BODY = extractFunctionBody(SOURCE, "_applyScale");
const ENSURE_MIN_BODY = extractFunctionBody(SOURCE, "_igEnsureMinimumSize");

test("_applyScale 存在且包含缩放样式更新", () => {
    assert.ok(APPLY_SCALE_BODY, "必须能抽取出 _applyScale 函数体");
    assert.match(APPLY_SCALE_BODY, /contentEl\.style\.zoom\s*=\s*.*String\(s\)/,
        "必须设置 contentEl.style.zoom 为当前档位");
    assert.match(APPLY_SCALE_BODY, /rootEl\.style\.height\s*=\s*\(bh\s*\*\s*s\)\s*\+\s*"px"/,
        "必须按缩放后的高度更新 rootEl");
});

test("_applyScale 必须直接按 scaledSize() 设置 node.size（不只是保证最小尺寸）", () => {
    assert.match(APPLY_SCALE_BODY, /_igSetNodeSize\(\s*scaledSize\(\)\s*\)/,
        "缩放后必须直接把 node.size 设为 scaledSize()，否则缩小档位不会收缩");
});

test("_applyScale 仍应先设置 minSize / DOM 最小约束，再写精确尺寸", () => {
    const ensureIndex = APPLY_SCALE_BODY.indexOf("_igEnsureMinimumSize()");
    const setIndex = APPLY_SCALE_BODY.indexOf("_igSetNodeSize(scaledSize())");
    assert.ok(ensureIndex !== -1, "_applyScale 必须调用 _igEnsureMinimumSize 以设置 minSize");
    assert.ok(setIndex !== -1, "_applyScale 必须调用 _igSetNodeSize(scaledSize())");
    assert.ok(ensureIndex < setIndex,
        "必须先设 minSize/DOM 约束，再写精确尺寸，保证 Nodes 2.0 外框尊重下限");
});

test("_igEnsureMinimumSize 保持「只抬升、不收缩」的语义不变", () => {
    assert.ok(ENSURE_MIN_BODY, "必须能抽取出 _igEnsureMinimumSize 函数体");
    assert.match(ENSURE_MIN_BODY, /Math\.max\(current\[0\]\s*\|\|\s*0,\s*minWidth\)/,
        "宽度必须取 max(current, min)，即只抬升");
    assert.match(ENSURE_MIN_BODY, /Math\.max\(current\[1\]\s*\|\|\s*0,\s*minHeight\)/,
        "高度必须取 max(current, min)，即只抬升");
});
