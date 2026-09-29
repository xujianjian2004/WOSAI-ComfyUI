// 拖拽实现的跨文件契约：全项目只允许一份 makeDraggable，且行为保持不变。
// 背景：历史上 web/panel-drag.js 与 web/shared/shared-utils.js 各有一份同名实现，
// 仅靠一个 _wosaiDraggable 标记去重，漏写即双重绑定（两套 handler 同时改写 left/top，
// 基准算法还不同：offsetLeft vs getBoundingClientRect）。合并后用本测试锁死。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function collectSources(dir, out = []) {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`.replace(/^\.\//, "");
        if (entry.isDirectory()) collectSources(dir === "." ? entry.name : rel, out);
        else if (entry.name.endsWith(".js")) out.push({ rel: rel.replace(/^\.\//, ""), code: read(rel) });
    }
    return out;
}

const SOURCES = collectSources(".");
const SHARED = read("shared/shared-utils.js");
const PANEL_DRAG = read("panel-drag.js");

test("makeDraggable 在全仓只有一处实现，且位于 shared-utils.js", () => {
    const defs = SOURCES.filter(({ code }) => /function\s+makeDraggable\s*\(/.test(code));
    assert.deepEqual(defs.map((d) => d.rel), ["shared/shared-utils.js"],
        `发现多处 makeDraggable 实现：${defs.map((d) => d.rel).join(", ")}`);
});

test("shared-utils 实现同时维护去重标记与清理钩子", () => {
    assert.match(SHARED, /panel\._wosaiDraggable = true/);
    assert.match(SHARED, /panel\._wosaiDraggable = false/);
    assert.match(SHARED, /panel\._wosaiDragCleanup = cleanup/);
    // 重复绑定必须复用既有清理函数，而不是叠加第二套 handler
    assert.match(SHARED, /if \(panel\._wosaiDraggable\) return panel\._wosaiDragCleanup \|\|/);
});

test("panel-drag.js 只做自动接管，不再自带拖拽实现", () => {
    assert.doesNotMatch(PANEL_DRAG, /function\s+makeDraggable/);
    assert.match(PANEL_DRAG, /import \{ makeDraggable \} from "\.\/shared\/shared-utils\.js"/);
    // 全局卸载路径依赖共享实现挂上的钩子
    assert.match(PANEL_DRAG, /panel\._wosaiDragCleanup\?\.\(\)/);
});

test("所有调用点都使用选项对象形式（不再传裸 handle）", () => {
    const calls = [];
    for (const { rel, code } of SOURCES) {
        code.split("\n").forEach((line, i) => {
            if (/function\s+makeDraggable/.test(line)) return; // 定义行
            const re = /makeDraggable\(([^\n]*)\)/g;
            let m;
            while ((m = re.exec(line))) {
                const args = m[1].trim();
                if (!args || args.startsWith("{") || /^[\w.]+\s*,\s*\{/.test(args)) continue;
                calls.push(`${rel}:${i + 1}: makeDraggable(${args})`);
            }
        });
    }
    assert.deepEqual(calls, [], `存在旧式调用：\n${calls.join("\n")}`);
});

// ── 行为验证：把 makeDraggable 的函数体抽出来，在最小 DOM stub 上真跑一遍 ──
function loadMakeDraggable() {
    const start = SHARED.indexOf("export function makeDraggable");
    assert.notEqual(start, -1, "未找到 makeDraggable 定义");
    const body = SHARED.slice(start).replace("export function", "function");
    return new Function("document", "window", `${body}; return makeDraggable;`);
}

function makeEnv() {
    const docListeners = new Map();
    const document = {
        body: { style: {} },
        addEventListener: (type, fn) => docListeners.set(type, fn),
        removeEventListener: (type) => docListeners.delete(type),
    };
    const window = { innerWidth: 800, innerHeight: 600 };
    const panel = {
        style: {},
        dataset: {},
        offsetWidth: 100,
        offsetHeight: 80,
        _own: new Map(),
        classList: { add() {}, remove() {} },
        getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 80 }),
        addEventListener(type, fn) { this._own.set(type, fn); },
        removeEventListener(type) { this._own.delete(type); },
    };
    return { document, window, panel, docListeners };
}

const pointerEvent = (x, y, target = { closest: () => null, isContentEditable: false }) =>
    ({ button: 0, clientX: x, clientY: y, target });

test("拖拽行为：阈值、视口夹取、手动定位标记", () => {
    const makeDraggable = loadMakeDraggable();
    const { document, window, panel, docListeners } = makeEnv();
    const draggable = makeDraggable(document, window);

    const cleanup = draggable(panel, { handle: panel, cursor: "move" });
    assert.equal(typeof cleanup, "function");

    const down = panel._own.get("pointerdown");
    assert.equal(typeof down, "function");
    down(pointerEvent(100, 100));
    docListeners.get("pointermove")(pointerEvent(102, 101)); // 未过阈值
    assert.equal(panel.style.left, undefined, "阈值内不得产生位移");

    docListeners.get("pointermove")(pointerEvent(150, 140));
    assert.equal(panel.dataset.wosaiManualPosition, "true");
    assert.equal(panel.style.left, "60px"); // 基准 10 + 50
    assert.equal(panel.style.top, "50px");

    docListeners.get("pointermove")(pointerEvent(9000, 9000)); // 触发视口夹取
    assert.equal(panel.style.left, "700px"); // 800 - 100
    assert.equal(panel.style.top, "520px"); // 600 - 80

    docListeners.get("pointerup")(pointerEvent(9000, 9000));
    assert.equal(docListeners.size, 0, "抬手后必须解绑全部 document 监听");

    cleanup();
    assert.equal(panel._wosaiDraggable, false);
    assert.equal(panel._own.size, 0, "清理后不得残留 handle 监听");
});

test("重复绑定不叠加第二套 handler", () => {
    const makeDraggable = loadMakeDraggable();
    const { document, window, panel } = makeEnv();
    const draggable = makeDraggable(document, window);

    draggable(panel, { handle: panel });
    const before = panel._own.get("pointerdown");
    const second = draggable(panel, { handle: panel }); // 应被去重
    assert.equal(panel._own.get("pointerdown"), before, "二次绑定不得替换/追加 handler");
    assert.equal(typeof second, "function", "重复绑定也要返回可用的清理函数");
});
