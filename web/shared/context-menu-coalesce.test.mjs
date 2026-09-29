import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MENU_ROOT_SELECTOR, coalesceMenuItems, isMenuSeparator, normalizeMenuLabel } from "./context-menu-coalesce.js";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

const SHARED = read("./context-menu-coalesce.js");
const CANVAS = read("../menu-hide.js");
const NODE = read("../layout-toolkit.js");

const ROOT_SELECTOR = ".litecontextmenu, .context-menu, .litegraph-contextmenu";

// 画布菜单与节点菜单各自维护过一份功能等价的 DOM 收拢实现（2026-09-29 合并）。
// 分叉的代价是同一处缺陷要改两遍，且只有一份被测试覆盖 —— 由这组断言锁死单一来源。
test("两处菜单收拢共用同一实现，不再各持一份", () => {
    for (const [name, source] of [["画布菜单", CANVAS], ["节点菜单", NODE]]) {
        assert.match(
            source,
            /import \{[^}]*coalesceMenuItems[^}]*\} from "\.\/shared\/context-menu-coalesce\.js";/,
            `${name} 未从共享模块导入 coalesceMenuItems`,
        );
    }
    // 合并前的私有实现若残留，等于又分叉回去
    for (const legacy of ["_WOSAI_NODE_MENU_ENTRY_SELECTOR", "_WOSAI_NODE_MENU_SEPARATOR_SELECTOR", "_menuEntryLabel", "_createNodeMenuSeparator"]) {
        assert.ok(!NODE.includes(legacy), `layout-toolkit.js 仍残留私有实现 ${legacy}`);
    }
});

test("菜单根选择器只有一个定义处", () => {
    assert.equal(MENU_ROOT_SELECTOR, ROOT_SELECTOR);
    assert.ok(SHARED.includes(`export const MENU_ROOT_SELECTOR = "${ROOT_SELECTOR}"`), "共享模块未导出菜单根选择器常量");
    for (const [name, source] of [["画布菜单", CANVAS], ["节点菜单", NODE]]) {
        assert.ok(!source.includes(ROOT_SELECTOR), `${name} 仍在硬编码菜单根选择器`);
        assert.match(source, /MENU_ROOT_SELECTOR/, `${name} 未引用 MENU_ROOT_SELECTOR`);
    }
});

test("锚点策略：节点菜单收到最前，画布菜单保持原层级", () => {
    assert.match(NODE, /coalesceMenuItems\(menu, \{ labels, anchor: "top" \}\)/);
    assert.match(CANVAS, /anchor: "group"/);
});

// anchor:"top" 的幂等判据若只看「组内是否连续」，会在「组已连续但位置靠后」时直接返回 false，
// 「一律收到最前」就永远不生效。这个分支此前不存在，是合并时才发现并补上的。
test("anchor:\"top\" 的幂等判据必须额外校验组的位置", () => {
    assert.match(SHARED, /const alreadyAtTop = anchor !== "top"/);
    assert.match(SHARED, /if \(innerOrdered && alreadyAtTop\) return false;/);
    assert.match(SHARED, /children\.slice\(0, firstIndex\)\.some\(\(child\) => !isMenuSeparator\(child, separatorSelector\)\)/);
});

// 节点菜单可能只注册一条 WOSAI 项（只选中一个普通节点、且收藏功能不可用时就是如此），
// 早期实现用 labels.length / hits.size 的下限把它们挡在门外，等于静默失效。
test("条目数不设下限", () => {
    assert.doesNotMatch(SHARED, /labels\.length < 2/, "labels 数量门槛会让单条节点菜单被跳过");
    assert.doesNotMatch(SHARED, /hits\.size < 2/, "命中数门槛与 ordered 判据等价，且会挡住单条场景");
});

test("分隔符标记属性单一来源", () => {
    assert.match(SHARED, /separatorAttribute = "data-wosai-menu-separator"/);
    assert.ok(!NODE.includes("data-wosai-node-menu-separator"), "节点菜单仍在写旧的分隔符标记");
    // 收拢只搬节点、不重建：条目自身的属性与显隐状态必须随之保留
    assert.match(SHARED, /block\.appendChild\(entry\)/);
    assert.doesNotMatch(SHARED, /entry\.cloneNode/, "收拢不得克隆条目（会丢失事件与显隐状态）");
});

test("normalizeMenuLabel 去掉标签、压缩空白并 trim", () => {
    assert.equal(normalizeMenuLabel("  🟠   快捷对齐  "), "🟠 快捷对齐");
    assert.equal(normalizeMenuLabel("<b>收藏</b>节点"), "收藏节点");
    assert.equal(normalizeMenuLabel(null), "");
    assert.equal(normalizeMenuLabel(undefined), "");
});

test("isMenuSeparator 对缺少 matches 的节点安全", () => {
    const seen = [];
    assert.equal(isMenuSeparator({ matches: (selector) => { seen.push(selector); return true; } }), true);
    assert.deepEqual(seen, [".separator, .litemenu-separator, hr"], "默认分隔符选择器不得漂移");
    assert.equal(isMenuSeparator({ matches: () => false }), false);
    assert.equal(isMenuSeparator(null), false);
    assert.equal(isMenuSeparator({}), false);
});

test("coalesceMenuItems 对非法入参与空菜单安全返回", () => {
    assert.equal(coalesceMenuItems(null, { labels: ["a", "b"] }), false);
    assert.equal(coalesceMenuItems({}, { labels: ["a"] }), false);
    assert.equal(coalesceMenuItems({ querySelectorAll: () => [] }, { labels: [] }), false);
    assert.equal(coalesceMenuItems({ querySelectorAll: () => [] }, { labels: "收藏节点" }), false);
    // 命中文案但节点游离（无父容器可搬）时同样返回 false，不得抛错
    const orphan = { querySelectorAll: () => [{ textContent: "收藏节点", parentElement: null }] };
    assert.equal(coalesceMenuItems(orphan, { labels: ["收藏节点"] }), false);
});
