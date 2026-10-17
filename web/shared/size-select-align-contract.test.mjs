import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

// 契约：尺寸选择节点的**网格对齐**与**面积回显**。
//   借鉴 ComfyUI 原生 `ResolutionSelector`（comfy_extras/nodes_resolution.py）：
//     · 对齐用 round，不用 floor（floor 让尺寸系统性偏小）
//     · 前端预览必须同源复算（同一舍入函数），否则「预览」与「执行结果」不一致
//     · 回显**真实像素总量**：显存 / 耗时正比于面积，同档位换比例开销会翻倍
//   另有一层原生没有的约束：本节点直接产出 latent，像素必须能被压缩率整除，
//   所以对齐粒度取 lcm(align_multiple, latent_ratio)。

function source(relativePath) {
    return fs.readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const sizeSelectJs = source("../size-select.js");
const sizeSelectPy = source("../../nodes/size_select.py");
const css = source("../styles/os-size.css");
const zhMenus = JSON.parse(source("../locales/zh/menus.json")).sizeSelect;
const enMenus = JSON.parse(source("../locales/en/menus.json")).sizeSelect;

test("front-end rounds half to even, matching python round()", () => {
    // Python 的 round() 是银行家舍入；前端若用 Math.round()，.5 处会与后端差 1 个步长。
    const fn = sizeSelectJs.match(/function roundHalfToEven\([\s\S]*?\n\}/);
    assert.ok(fn, "roundHalfToEven not found");
    assert.match(fn[0], /v - f === 0\.5 \? \(f % 2 === 0 \? f : f \+ 1\) : Math\.round\(v\)/);
    assert.match(sizeSelectJs, /Math\.max\(step, roundHalfToEven\(n \/ step\) \* step\)/);
});

test("front-end align multiple defaults to the same value as the backend", () => {
    const jsDefault = sizeSelectJs.match(/const DEFAULT_ALIGN_MULTIPLE = (\d+);/);
    const pyDefault = sizeSelectPy.match(/^DEFAULT_ALIGN_MULTIPLE = (\d+)$/m);
    assert.ok(jsDefault, "DEFAULT_ALIGN_MULTIPLE not found in size-select.js");
    assert.ok(pyDefault, "DEFAULT_ALIGN_MULTIPLE not found in size_select.py");
    assert.equal(jsDefault[1], pyDefault[1], "前后端默认对齐粒度必须一致");
});

test("backend snaps with round and lcm of the grid step and the latent ratio", () => {
    // docstring 里就有空行，不能用 \n\n 截断：匹配到下一个 def 为止
    const align = sizeSelectPy.match(/def _align\(value: float, step: int\) -> int:[\s\S]*?(?=\ndef )/);
    assert.ok(align, "_align not found");
    assert.ok(!/math\.floor/.test(align[0]), "_align must not floor");
    assert.match(align[0], /int\(round\(float\(value\) \/ step\)\) \* step/);

    const lcm = sizeSelectPy.match(/def _lcm\(a: int, b: int\) -> int:[\s\S]*?(?=\ndef )/);
    assert.ok(lcm, "_lcm not found");
    assert.match(lcm[0], /a \* b \/\/ math\.gcd\(a, b\)/);
    assert.match(sizeSelectPy, /return _align\(value, _lcm\(multiple, ratio\)\)/);
});

test("all three size paths go through the same grid helper", () => {
    // 预设 / 自定义 / Scale 三条路径必须共用 _align_grid，
    // 各自一套对齐口径就会出现「预设档位对、Scale 结果不对」这类偏斜
    assert.ok(!/_aligned_dimension/.test(sizeSelectPy), "旧的 _aligned_dimension 必须已退役");
    assert.ok(!/if has_latent or has_vae:\n\s+target_w/.test(sizeSelectPy), "对齐不能再挂在 has_latent 分支里");
    const uses = sizeSelectPy.match(/_align_grid\(/g) ?? [];
    assert.ok(uses.length >= 3, `三条路径都应调用 _align_grid：实际 ${uses.length} 次`);
});

test("align_multiple is declared on both the V1 and the V3 schema", () => {
    const v1 = sizeSelectPy.match(/"align_multiple":\s*\("INT".*?\),/);
    assert.ok(v1, "V1 align_multiple not found");
    assert.match(v1[0], /"default": DEFAULT_ALIGN_MULTIPLE/);

    const v3 = sizeSelectPy.match(/_io\.Int\.Input\("align_multiple"[\s\S]*?\),/);
    assert.ok(v3, "V3 align_multiple not found");
    assert.match(v3[0], /default=DEFAULT_ALIGN_MULTIPLE/);
});

test("front-end echoes the real pixel area and the latent grid", () => {
    // 原生 ResolutionSelector 也有这个回显：对齐后的尺寸通常不等于设定值，
    // 不显示就等于默认「和你想的一样」
    assert.match(sizeSelectJs, /const mp = \(w \* h\) \/ \(1024 \* 1024\);/);
    assert.match(sizeSelectJs, /previewMeta\.textContent = `\$\{mp\.toFixed\(2\)\} MP · \$\{grid\}`;/);
    // 面积超预算分级提示（提示而非硬夹：上限形态留给 megapixels 那样的面积预算）
    assert.match(sizeSelectJs, /const AREA_HINT_MP = 4;/);
    assert.match(sizeSelectJs, /const AREA_WARN_MP = 8;/);
    assert.match(sizeSelectJs, /preview\.classList\.toggle\("is-large", mp > AREA_HINT_MP && mp <= AREA_WARN_MP\)/);
    assert.match(sizeSelectJs, /preview\.classList\.toggle\("is-extreme", mp > AREA_WARN_MP\)/);
    assert.match(css, /\.ss-preview\.is-large \.ss-preview-meta \{/);
    assert.match(css, /\.ss-preview\.is-extreme \.ss-preview-meta \{/);
});

test("the align multiple survives save and load", () => {
    // serialize 漏掉新 widget 会让保存再打开后对齐粒度丢回默认
    assert.match(sizeSelectJs, /const coreWidgets = \[manW, scmW, sclW, resW, aspW, cusW, cusH, almW\]/);
});

test("the preview stays on one line and degrades by truncating, never overflowing", () => {
    // 单行预算：节点最小宽度 220px，左右内边距后约 204px 可用。
    // 「1920 × 1080 · 1.98 MP · latent 240 × 135」约 200px 刚好放下；
    // 节点被拖得更窄时必须截断（省略号），不能把内容挤出节点框。
    // 顺序即优先级：面积比 latent 网格重要，从尾部省略正好先舍掉最不重要的部分。

    // 装饰性标签已去掉：四个字要吃掉约 44px，留着它必然溢出
    assert.ok(!/ss-preview-lbl/.test(sizeSelectJs), "预览不再使用「尺寸预览」标签");
    assert.ok(!/ss-preview-lbl/.test(css), ".ss-preview-lbl 的 CSS 必须一并删除");
    assert.ok(!/menus\.sizeSelect\.imageDimensions/.test(sizeSelectJs), "imageDimensions 已不再消费");
    assert.ok(!/"imageDimensions"/.test(zhMenus), "zh menus 不应保留 imageDimensions");
    assert.ok(!/"imageDimensions"/.test(enMenus), "en menus 不应保留 imageDimensions");

    const box = css.match(/\.ss-preview \{[\s\S]*?\}/);
    assert.ok(box, ".ss-preview rule not found");
    assert.match(box[0], /height: var\(--ws-ss-pill-height\)/, "预览保持单行药丸高度");
    assert.ok(!/flex-direction: column/.test(box[0]), "预览不能拆成两行");
    assert.match(box[0], /overflow: hidden/, "兜底：任何情况下都不撑破药丸");

    // 两个 span 都必须能收缩 + 省略号，否则 flex 项默认 min-width:auto 会顶开容器
    for (const sel of [".ss-preview-val", ".ss-preview-meta"]) {
        // ^ 锚定行首：否则会先匹配到 `.ss-preview.flash .ss-preview-val` 这类状态规则
        const rule = css.match(new RegExp(`^\\${sel} \\{[\\s\\S]*?\\}`, "m"));
        assert.ok(rule, `${sel} rule not found`);
        assert.match(rule[0], /min-width: 0/, `${sel} 必须允许收缩`);
        assert.match(rule[0], /overflow: hidden/);
        assert.match(rule[0], /text-overflow: ellipsis/, `${sel} 必须省略号截断`);
    }
});

test("the full preview text is recoverable when truncated", () => {
    // 截断后仍需拿到完整信息：完整串挂到 title 上
    assert.match(sizeSelectJs, /preview\.title = `\$\{w\} × \$\{h\} · \$\{mp\.toFixed\(2\)\} MP · \$\{grid\}`;/);
});
