import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

const CSS = read("../styles/media-tools.css");
const JS = read("../media-tools.js");

const VIEW_CLASS_RE = /is-view-[a-z]+/g;
const unique = (values) => [...new Set(values)].sort();

/** 抽出 CSS 中所有提到视图类名的声明行（去掉空行与整行注释）。 */
function cssViewLines() {
    return CSS.split("\n").filter((line) => /is-view-/.test(line) && !line.trim().startsWith("/*"));
}

// 这一组断言对应 2026-09-28 P2 期间踩到的真实缺陷：视图类名一度挂在 root 上，
// 而样式选择器写的是 .wosai-image-compare-stage，导致双拼布局整体不生效，
// 且不跑真实渲染无法察觉。跨文件契约必须由测试兜住。
test("视图类名的生产者（JS）与消费者（CSS）完全一致", () => {
    const produced = unique(JS.match(/stage\.classList\.toggle\("(is-view-[a-z]+)"/g)?.map((entry) => entry.match(/is-view-[a-z]+/)[0]) ?? []);
    const consumed = unique(CSS.match(new RegExp(VIEW_CLASS_RE, "g")) ?? []);
    assert.deepEqual(produced, ["is-view-side", "is-view-slide", "is-view-stack"]);
    assert.deepEqual(consumed, produced, "CSS 引用的视图类名必须与 JS 挂载的一致");
});

test("视图类名挂在 stage 上，而不是 root", () => {
    assert.match(JS, /const stage = document\.createElement\("div"\);\s*\n\s*stage\.className = "wosai-image-compare-stage";/);
    assert.match(JS, /stage\.classList\.toggle\("is-view-side"/);
    assert.match(JS, /stage\.classList\.toggle\("is-view-slide"/);
    assert.match(JS, /stage\.classList\.toggle\("is-view-stack"/);
    // root 只承载 has-first / has-second 这类「有无内容」状态
    assert.doesNotMatch(JS, /root\.classList\.toggle\("is-view-/);
});

test("CSS 里所有视图规则都以 .wosai-image-compare-stage 限定", () => {
    const lines = cssViewLines();
    assert.ok(lines.length >= 10, `视图规则过少，可能被误删（实际 ${lines.length} 行）`);
    for (const line of lines) {
        assert.match(line, /\.wosai-image-compare-stage\.is-view-/, `缺少 stage 限定的视图规则: ${line.trim()}`);
        assert.doesNotMatch(line, /\.wosai-image-compare\.is-view-/, `视图规则挂在 root 上: ${line.trim()}`);
    }
});

test("双拼视图把图层切成半幅并补上主轴尺寸", () => {
    // left/top 偏移必须与主轴尺寸成对出现，否则 100% 尺寸会把面板推出舞台边界
    assert.match(CSS, /is-view-side > img \{[^}]*right: auto;[^}]*width: 50%;/s);
    assert.match(CSS, /is-view-side \.wosai-image-compare-top \{[^}]*left: 50%;[^}]*width: 50%;/s);
    assert.match(CSS, /is-view-stack > img \{[^}]*bottom: auto;[^}]*height: 50%;/s);
    assert.match(CSS, /is-view-stack \.wosai-image-compare-top \{[^}]*top: 50%;[^}]*height: 50%;/s);
});

test("双拼视图补外侧圆角，内缝保持直角", () => {
    assert.match(CSS, /is-view-side > img \{[^}]*border-radius: var\(--ws-radius-lg\) 0 0 var\(--ws-radius-lg\);/s);
    assert.match(CSS, /is-view-side \.wosai-image-compare-top \{[^}]*border-radius: 0 var\(--ws-radius-lg\) var\(--ws-radius-lg\) 0;/s);
    assert.match(CSS, /is-view-stack > img \{[^}]*border-radius: var\(--ws-radius-lg\) var\(--ws-radius-lg\) 0 0;/s);
    assert.match(CSS, /is-view-stack \.wosai-image-compare-top \{[^}]*border-radius: 0 0 var\(--ws-radius-lg\) var\(--ws-radius-lg\);/s);
});

test("双拼视图隐藏分割线 / 热区 / 十字手柄，只留分隔缝", () => {
    for (const view of ["is-view-side", "is-view-stack"]) {
        for (const part of ["-line", "-grab", "-handle"]) {
            assert.ok(
                CSS.includes(`.wosai-image-compare-stage.${view} .wosai-image-compare${part}`),
                `${view} 缺少隐藏 ${part} 的规则`,
            );
        }
        assert.ok(
            CSS.includes(`.wosai-image-compare-stage.${view} .wosai-image-compare-divider`),
            `${view} 缺少分隔缝样式`,
        );
    }
    // 分隔缝默认不显示，只有双拼视图打开
    assert.match(CSS, /\.wosai-image-compare-divider \{[^}]*display: none;/s);
});

test("双拼视图把 A/B 角标归位到各自面板", () => {
    assert.match(CSS, /is-view-side \.wosai-image-compare-label\.is-start,\s*\n[^\n]*is-view-stack \.wosai-image-compare-label\.is-start,/);
    assert.match(CSS, /is-view-stack \.wosai-image-compare-label\.is-end \{[^}]*right: auto;[^}]*left: var\(--ws-gap-sm\);/s);
});

test("滑动视图用左内缩裁剪，保证底层留在分割线左侧", () => {
    // clip-path 的 inset(top right bottom left)：上层从左侧按分割位置裁掉，
    // 剩下的部分落在分割线右边；底层铺满 ⇒ 左侧露出的是底层。
    // 反过来（裁右侧）会把「拖到左端显示 A、右端显示 B」整体掉个方向
    assert.match(JS, /secondWrap\.style\.clipPath = state\.resolvedView === COMPARE_VIEW_DEFAULT\s*\n\s*\? `inset\(0 0 0 \$\{value\}%\)`/);
    assert.doesNotMatch(JS, /inset\(0 \$\{100 - value\}% 0 0\)/);
});

test("拖动方向 = 画面呈现的图：左端 A、右端 B", () => {
    // 底层铺满占左侧、上层只保留右侧。要「拖到左端是 A、右端是 B」，底层必须
    // 放 B、上层放 A —— 照字面按 A/B 顺序分配会让整套方向反转，且双拼视图
    // （底层占左/上半幅）会跟着一起反，切视图时左右对调。
    assert.match(JS, /const firstUrl = imageUrl\(display\.b\);/);
    assert.match(JS, /const secondUrl = imageUrl\(display\.a\);/);
    assert.match(JS, /root\.classList\.toggle\("has-first", Boolean\(display\.b\)\)/);
    // 角标必须标注它所在面板实际显示的那张图，否则左下角标会指向一张被盖住的图
    assert.match(JS, /startLabel\.textContent = formatMediaBadgeLabel\(display\.b/);
    assert.match(JS, /endLabel\.textContent = formatMediaBadgeLabel\(display\.a/);
});

test("拖拽光标只在滑动视图开启", () => {
    assert.match(CSS, /\.wosai-image-compare-stage\.is-view-slide \.wosai-image-compare-grab \{\s*\n\s*cursor: ew-resize;/);
    // 基础态不再自带 ew-resize，避免出现「有拖拽光标但拖不动」；
    // 选择器按行首锚定，防止误匹配上面那条带 .is-view-slide 前缀的规则
    const baseRule = CSS.match(/(?:^|\n)\.wosai-image-compare-grab \{([^}]*)\}/);
    assert.ok(baseRule, "未找到 .wosai-image-compare-grab 基础规则");
    assert.doesNotMatch(baseRule[1], /cursor:/);
});

test("非滑动视图不裁剪 B 图层", () => {
    assert.match(JS, /: "none";/);
});

test("视图状态持久化到 node.properties 并可回读", () => {
    assert.match(JS, /viewMode: normalizeViewMode\(node\.properties\.wosai_compare_view\)/);
    assert.match(JS, /node\.properties\.wosai_compare_view = next;/);
    assert.match(JS, /state\.viewMode = normalizeViewMode\(node\.properties\?\.wosai_compare_view\);/);
});

test("视图按钮由 COMPARE_VIEW_MODES 驱动，且文案走静态 i18n key", () => {
    assert.match(JS, /for \(const mode of COMPARE_VIEW_MODES\)/);
    assert.match(JS, /button\.dataset\.view = mode;/);
    for (const key of ["viewSlide", "viewSide", "viewStack", "viewAuto"]) {
        assert.ok(JS.includes(`nodes.imageCompare.${key}`), `缺少 i18n key nodes.imageCompare.${key}`);
    }
    assert.ok(JS.includes("nodes.imageCompare.views"));
});

test("分割拖拽只在滑动视图生效", () => {
    assert.match(JS, /const isSplittable = \(\) => state\.resolvedView === COMPARE_VIEW_DEFAULT;/);
    const guards = JS.match(/if \(!isSplittable\(\)\) return;/g) ?? [];
    assert.equal(guards.length, 2, "pointerdown 与 pointermove 都要拦截");
});

test("非滑动视图把隐藏滑块移出 tab 序列", () => {
    assert.match(JS, /slider\.disabled = !splittable;/);
    assert.match(JS, /slider\.tabIndex = splittable \? 0 : -1;/);
});

test("控件高度按舞台宽高比换算，且内边距与 CSS 同源", () => {
    assert.match(JS, /const ratio = stageAspectRatio\(state\.resolvedView, state\.aspectRatio\);/);
    // 内边距必须读 --ws-compare-handle-size（与 CSS 的 padding-inline 一致），
    // 读成 --ws-compare-swap-size 会让首帧估算宽度偏差 3px/侧
    assert.match(JS, /getWOSAIVarNum\("--ws-compare-handle-size", 28\) \/ 2/);
    assert.doesNotMatch(JS, /padInline = Math\.max\(gap, getWOSAIVarNum\("--ws-compare-swap-size"/);
});

test("尺寸标注直接取载荷尺寸并走统一的格式化函数", () => {
    assert.match(JS, /formatMediaBadgeLabel\(display\.b, swapped \? "A" : "B"\)/);
    assert.match(JS, /formatMediaBadgeLabel\(display\.a, swapped \? "B" : "A"\)/);
});

// ── 闲置自动淡出（控件遮挡优化）────────────────────────────────────
// 视图条 / A/B 角标 / 交换按钮都是压在图片上的浮层，常驻会遮住主体的构图重心。
// 这一组断言锁住「什么时候隐、隐掉谁、隐了还能不能用」三件事。

test("闲置态类名的生产者（JS）与消费者（CSS）一致", () => {
    const produced = unique(
        JS.match(/classList\.(?:add|remove|toggle)\("(is-idle)"/g)?.map((entry) => "is-idle") ?? [],
    );
    assert.deepEqual(produced, ["is-idle"]);
    assert.ok(CSS.includes(".wosai-image-compare-stage.is-idle"), "CSS 未消费 is-idle");
    // 与视图类名同源挂在 stage 上：挂 root 会让「图像区状态」与「节点内容状态」混淆
    assert.doesNotMatch(CSS, /\.wosai-image-compare\.is-idle/, "闲置态必须挂在 stage 上");
});

test("闲置只隐藏控件，分割线保持可见", () => {
    const rule = CSS.match(/\.wosai-image-compare-stage\.is-idle\s+\.wosai-image-compare-views[\s\S]*?\}/);
    assert.ok(rule, "未找到闲置隐藏规则");
    for (const part of ["-views", "-label", "-swap"]) {
        assert.ok(rule[0].includes(`.wosai-image-compare${part}`), `闲置清单缺少 ${part}`);
    }
    // 分割线 / 热区 / 十字手柄是「这是一张对比图」的语义表达，不是操作项：
    // 把分割线一起隐掉，节点会退化成一张普通图片
    for (const part of ["-line", "-grab", "-handle"]) {
        assert.ok(
            !rule[0].includes(`.wosai-image-compare${part}`),
            `分割线相关元素不应进入闲置清单: ${part}`,
        );
    }
});

test("闲置必须同时关掉命中，否则会点到看不见的按钮", () => {
    const rule = CSS.match(/\.wosai-image-compare-stage\.is-idle\s+\.wosai-image-compare-views[\s\S]*?\}/);
    // 交换按钮正落在拖分割线的常用路径上：只做视觉隐藏 = 拖拽时误触交换
    assert.match(rule[0], /pointer-events:\s*none/);
    assert.ok(!/visibility|display:\s*none/.test(rule[0]), "用 opacity 隐藏以保留 a11y 树里的尺寸文本");
});

test("键盘聚焦时闲置让位，且 disabled 控件保留降级透明度", () => {
    assert.match(CSS, /\.wosai-image-compare-stage\.is-idle:focus-within \.wosai-image-compare-views/);
    // :not(:disabled) 不可省：焦点落在视图按钮上时，会把 disabled 交换按钮的
    // 降级透明度一并覆盖成 1，看起来像可以点
    assert.match(
        CSS,
        /\.wosai-image-compare-stage\.is-idle:focus-within \.wosai-image-compare-swap:not\(:disabled\)/,
    );
});

test("闲置状态机不触碰高度契约，且只用 setTimeout", () => {
    const heightFn = JS.match(/const getWidgetHeight = \(\) => \{[\s\S]*?\n {4}\};/);
    assert.ok(heightFn, "未找到 getWidgetHeight");
    assert.doesNotMatch(heightFn[0], /idle/i, "闲置态不得进入高度计算（控件显隐不该改变节点尺寸）");
    // 定时器不受 AbortController 管辖，节点销毁必须手动清，否则订阅闭包持有 root
    assert.match(JS, /if \(idleTimer\) clearTimeout\(idleTimer\);/);
    // 门禁对 setInterval 有数量预算，闲置逻辑必须用可重置的 setTimeout
    assert.doesNotMatch(JS, /setInterval\(/);
});
