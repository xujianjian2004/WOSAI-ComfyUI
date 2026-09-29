// 面板外壳契约：玻璃控制面板的外壳只允许在 panel-builder.js 里生产一份。
// 背景（visual-fx）、连线特效（link-fx）、设置中心（settings）三处原本各复刻一遍
// 「div.wosai-control-panel + 内联玻璃样式 + 头部 + 版权行 + 拖拽绑定」，改一处
// 样式极易漏掉另外两处；重构后由 buildControlPanel() 统一产出，这里锁死该结构。
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
        else if (entry.name.endsWith(".js")) out.push({ rel, code: read(rel) });
    }
    return out;
}

const SOURCES = collectSources(".");
const BUILDER = read("shared/panel-builder.js");

test("面板外壳类名只在 panel-builder.js 里被生产", () => {
    const producers = SOURCES
        .filter(({ code }) => /["'`]wosai-control-panel["'`]/.test(code))
        .map(({ rel }) => rel);
    assert.deepEqual(producers, ["shared/panel-builder.js"],
        `发现复刻的面板外壳：${producers.join(", ")}`);
});

test("三处控制面板都改用 buildControlPanel", () => {
    for (const rel of ["visual-fx.js", "link-fx.js", "settings.js"]) {
        const code = read(rel);
        assert.match(code, /buildControlPanel\(\{/, `${rel} 未使用 buildControlPanel`);
        assert.doesNotMatch(code, /document\.createElement\("div"\);\s*\n\s*\w+\.className = "wosai-control-header"/);
    }
});

test("buildControlPanel 产出与旧外壳一致的关键契约", () => {
    // 自动拖拽接管与样式都依赖这几个标记，缺一个就会静默失效
    assert.match(BUILDER, /setAttribute\("data-wosai-panel", ""\)/);
    assert.match(BUILDER, /setAttribute\("data-theme", getGlassTheme\(\)\)/);
    assert.match(BUILDER, /onpointerdown = \(event\) => event\.stopPropagation\(\)/);
    assert.match(BUILDER, /makeDraggable\(panel, \{ handle: header \}\)/);
    assert.match(BUILDER, /document\.body\.appendChild\(panel\)/);
    // 关闭按钮与版权行保持原有类名（CSS 与面板拖拽的 _findHandle 都依赖它）
    assert.match(BUILDER, /wosai-control-copyright/);
    assert.match(BUILDER, /closeIcon\(\)/);
});
