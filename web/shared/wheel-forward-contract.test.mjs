// 滚轮转发的跨文件契约：节点内 DOM widget 不得吞掉画布缩放。
// 背景：DOM widget 是覆盖在画布之上的兄弟元素，滚轮不会冒泡到 canvas
// （LiteGraph 的缩放监听绑在 canvas 自身），鼠标一进节点区域就缩放失效。
// 图像对比节点即因此无法缩放；ignore-groups 曾自带一份，现统一到
// shared/wheel-forward.js，并由 addSizedDOMWidget 默认挂载。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { forwardWheelToCanvas } from "./wheel-forward.js";

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
const DOM_WIDGET = read("shared/dom-widget.js");
const IGNORE_GROUPS = read("ignore-groups.js");

test("forwardWheelToCanvas 在全仓只有一处实现，且位于 shared/wheel-forward.js", () => {
    const defs = SOURCES.filter(({ code }) => /function\s+forwardWheelToCanvas\s*\(/.test(code));
    assert.deepEqual(defs.map((d) => d.rel), ["shared/wheel-forward.js"],
        `发现多处滚轮转发实现：${defs.map((d) => d.rel).join(", ")}`);
});

test("ignore-groups.js 不再自带转发实现，改为引用共享实现", () => {
    assert.doesNotMatch(IGNORE_GROUPS, /function\s+forwardWheelToCanvas/);
    assert.match(IGNORE_GROUPS, /import \{ forwardWheelToCanvas \} from "\.\/shared\/wheel-forward\.js"/);
    assert.doesNotMatch(IGNORE_GROUPS, /addEventListener\("wheel"/);
});

test("节点内 DOM widget 默认挂载滚轮转发（可显式关闭）", () => {
    assert.match(DOM_WIDGET, /import \{ forwardWheelToCanvas \} from "\.\/wheel-forward\.js"/);
    assert.match(DOM_WIDGET, /if \(options\.forwardWheel !== false\)/);
    assert.match(DOM_WIDGET, /forwardWheelToCanvas\(element, \{ signal: options\.signal \}\)/);
});

// ── 行为验证：直接加载真模块，用 stub 顶掉 document / window ──
function stubNode(over = {}) {
    return Object.assign({
        nodeType: 1,
        scrollHeight: 0,
        clientHeight: 0,
        parentElement: null,
    }, over);
}

function makeEnv({ withCanvas = true, scroller = null } = {}) {
    const received = [];
    const canvas = { dispatchEvent: (event) => received.push(event) };
    const document = { querySelector: () => (withCanvas ? canvas : null) };
    const window = {
        getComputedStyle: (node) => ({ overflowY: node === scroller ? "auto" : "visible" }),
    };
    const element = stubNode({ name: "root" });
    element.addEventListener = function (type, fn) { this._handler = fn; };
    element.removeEventListener = function () { this._handler = null; };
    return { document, window, element, received };
}

// Node 无 DOM 全局：补一个最小 WheelEvent，够记录派发参数即可
class WheelEventStub {
    constructor(type, init = {}) {
        this.type = type;
        Object.assign(this, init);
    }
}

// 模块内部直接引用全局 document / window / WheelEvent，测试期临时顶替
function withDom(env, fn) {
    const prev = {
        document: globalThis.document,
        window: globalThis.window,
        WheelEvent: globalThis.WheelEvent,
    };
    globalThis.document = env.document;
    globalThis.window = env.window;
    globalThis.WheelEvent = WheelEventStub;
    try { return fn(); } finally {
        globalThis.document = prev.document;
        globalThis.window = prev.window;
        globalThis.WheelEvent = prev.WheelEvent;
    }
}

const wheel = (over = {}) => ({
    clientX: 10, clientY: 20, deltaX: 0, deltaY: -120, deltaMode: 0,
    ctrlKey: true, shiftKey: false, altKey: false, metaKey: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    ...over,
});

test("无可滚动容器时：滚轮转发给画布并阻止默认行为", () => {
    const env = makeEnv();
    withDom(env, () => forwardWheelToCanvas(env.element, {}));
    assert.equal(typeof env.element._handler, "function", "必须挂上 wheel 监听");

    const event = wheel({ target: env.element });
    withDom(env, () => env.element._handler(event));
    assert.equal(event.prevented, true, "转发时必须 preventDefault，否则页面会跟着滚");
    assert.equal(env.received.length, 1, "必须向画布派发一次 wheel");
    assert.equal(env.received[0].deltaY, -120, "滚轮增量必须原样传递");
    assert.equal(env.received[0].clientX, 10, "指针位置必须保留，缩放中心才与指针一致");
    assert.equal(env.received[0].ctrlKey, true, "修饰键必须透传，否则 ctrl+滚轮会走错分支");
});

test("内部存在可滚动容器时：让位给滚动，不抢事件", () => {
    const env = makeEnv();
    const scroller = stubNode({ scrollHeight: 200, clientHeight: 100, parentElement: env.element });
    env.window.getComputedStyle = (node) => ({ overflowY: node === scroller ? "auto" : "visible" });
    withDom(env, () => forwardWheelToCanvas(env.element, {}));

    const event = wheel({ target: scroller });
    withDom(env, () => env.element._handler(event));
    assert.equal(env.received.length, 0, "内部还能滚动时不得转发");
    assert.equal(event.prevented, undefined, "不得阻止原生滚动");
});

test("respectInnerScroll: false 时一律转发（ignore-groups 的既有语义）", () => {
    const env = makeEnv();
    const scroller = stubNode({ scrollHeight: 200, clientHeight: 100, parentElement: env.element });
    env.window.getComputedStyle = (node) => ({ overflowY: node === scroller ? "auto" : "visible" });
    withDom(env, () => forwardWheelToCanvas(env.element, { respectInnerScroll: false }));

    withDom(env, () => env.element._handler(wheel({ target: scroller })));
    assert.equal(env.received.length, 1);
});

test("找不到画布时静默放弃，不抛错", () => {
    const env = makeEnv({ withCanvas: false });
    withDom(env, () => forwardWheelToCanvas(env.element, {}));
    withDom(env, () => env.element._handler(wheel({ target: env.element })));
    assert.equal(env.received.length, 0);
});
