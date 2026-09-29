import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { stageAspectRatio } from "./media-preview.js";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

const CSS = read("../styles/media-tools.css");
const JS = read("../media-tools.js");
const PREVIEW = read("./media-preview.js");

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
    // 底层（B）占右/下半、上层（A）占左/上半：与滑动视图「左端是 A」同向
    assert.match(CSS, /is-view-side > img \{[^}]*left: 50%;[^}]*width: 50%;/s);
    assert.match(CSS, /is-view-side \.wosai-image-compare-top \{[^}]*right: auto;[^}]*width: 50%;/s);
    assert.match(CSS, /is-view-stack > img \{[^}]*top: 50%;[^}]*height: 50%;/s);
    assert.match(CSS, /is-view-stack \.wosai-image-compare-top \{[^}]*bottom: auto;[^}]*height: 50%;/s);
});

test("双拼视图补外侧圆角，内缝保持直角", () => {
    assert.match(CSS, /is-view-side > img \{[^}]*border-radius: 0 var\(--ws-radius-lg\) var\(--ws-radius-lg\) 0;/s);
    assert.match(CSS, /is-view-side \.wosai-image-compare-top \{[^}]*border-radius: var\(--ws-radius-lg\) 0 0 var\(--ws-radius-lg\);/s);
    assert.match(CSS, /is-view-stack > img \{[^}]*border-radius: 0 0 var\(--ws-radius-lg\) var\(--ws-radius-lg\);/s);
    assert.match(CSS, /is-view-stack \.wosai-image-compare-top \{[^}]*border-radius: var\(--ws-radius-lg\) var\(--ws-radius-lg\) 0 0;/s);
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

test("滑动视图用左内缩裁剪，保证底层留在分割线左侧", () => {
    // clip-path 的 inset(top right bottom left)：上层从左侧按分割位置裁掉，
    // 剩下的部分落在分割线右边；底层铺满 ⇒ 左侧露出的是底层。
    // 反过来（裁右侧）会把「拖到左端显示 A、右端显示 B」整体掉个方向
    assert.match(JS, /secondWrap\.style\.clipPath = state\.viewMode === COMPARE_VIEW_DEFAULT\s*\n\s*\? `inset\(0 0 0 \$\{value\}%\)`/);
    assert.doesNotMatch(JS, /inset\(0 \$\{100 - value\}% 0 0\)/);
});

test("拖动方向 = 画面呈现的图：左端 A、右端 B", () => {
    // 底层铺满占左侧、上层只保留右侧。要「拖到左端是 A、右端是 B」，底层必须
    // 放 B、上层放 A —— 照字面按 A/B 顺序分配会让整套方向反转，且双拼视图
    // （底层占左/上半幅）会跟着一起反，切视图时左右对调。
    assert.match(JS, /const firstUrl = imageUrl\(display\.b\);/);
    assert.match(JS, /const secondUrl = imageUrl\(display\.a\);/);
    assert.match(JS, /root\.classList\.toggle\("has-first", Boolean\(display\.b\)\)/);
    // 底部已不再渲染 A/B 角标：角标语义（标端点 vs 标所在面板）与拖动方向互相
    // 打架，改为不显示，方向只由「拖到哪端就是哪张图」表达
    assert.doesNotMatch(JS, /wosai-image-compare-label/);
    assert.doesNotMatch(CSS, /wosai-image-compare-label/);
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
    for (const key of ["viewSlide", "viewSide", "viewStack"]) {
        assert.ok(JS.includes(`nodes.imageCompare.${key}`), `缺少 i18n key nodes.imageCompare.${key}`);
    }
    assert.ok(JS.includes("nodes.imageCompare.views"));
    // 自动排布已移除：图标表 / 文案分支 / i18n key 都不得再出现，
    // 否则会渲染出一个点了没反应的按钮（normalizeViewMode 会把 auto 落成 slide）
    assert.doesNotMatch(JS, /viewAuto/);
    // 模式表里不能再有 auto，否则按钮会多渲染一个（且它会被归一成 slide 而永远
    // 处于「选中 slide」的状态）
    assert.doesNotMatch(PREVIEW, /COMPARE_VIEW_MODES = Object\.freeze\(\[[^\]]*"auto"/);
    assert.doesNotMatch(PREVIEW, /export function resolveViewMode/);
});

test("分割拖拽只在滑动视图生效", () => {
    assert.match(JS, /const isSplittable = \(\) => state\.viewMode === COMPARE_VIEW_DEFAULT;/);
    const guards = JS.match(/if \(!isSplittable\(\)\) return;/g) ?? [];
    assert.equal(guards.length, 2, "pointerdown 与 pointermove 都要拦截");
});

test("非滑动视图把隐藏滑块移出 tab 序列", () => {
    assert.match(JS, /slider\.disabled = !splittable;/);
    assert.match(JS, /slider\.tabIndex = splittable \? 0 : -1;/);
});

test("控件高度按舞台宽高比换算，且内边距与 CSS 同源", () => {
    assert.match(JS, /const ratio = stageAspectRatio\(state\.viewMode, state\.aspectRatio\);/);
    // 内边距必须读 --ws-compare-handle-size（与 CSS 的 padding-inline 一致），
    // 读成 --ws-compare-swap-size 会让首帧估算宽度偏差 3px/侧
    assert.match(JS, /getWOSAIVarNum\("--ws-compare-handle-size", 28\) \/ 2/);
    assert.doesNotMatch(JS, /padInline = Math\.max\(gap, getWOSAIVarNum\("--ws-compare-swap-size"/);
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
    const rule = CSS.match(/\.wosai-image-compare-stage\.is-idle\s+\.wosai-image-compare-bottom[\s\S]*?\}/);
    assert.ok(rule, "未找到闲置隐藏规则");
    assert.ok(rule[0].includes(".wosai-image-compare-bottom"), "闲置清单应以底部工具栏为整体");
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
    const rule = CSS.match(/\.wosai-image-compare-stage\.is-idle\s+\.wosai-image-compare-bottom[\s\S]*?\}/);
    // 底部工具栏正落在拖分割线的常用路径上：只做视觉隐藏 = 拖拽时误触按钮
    assert.match(rule[0], /pointer-events:\s*none/);
    assert.ok(!/visibility|display:\s*none/.test(rule[0]), "用 opacity 隐藏以保留 a11y 树里的控件语义");
});

test("键盘聚焦时闲置让位，且 disabled 控件保留降级透明度", () => {
    assert.match(CSS, /\.wosai-image-compare-stage\.is-idle:focus-within \.wosai-image-compare-bottom/);
    // disabled 的交换按钮在键盘唤回时要保留自己的降级透明度，不被容器 opacity:1 盖掉
    assert.match(
        CSS,
        /\.wosai-image-compare-stage\.is-idle:focus-within \.wosai-image-compare-bottom \.wosai-image-compare-swap:disabled/,
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

// 切换视图改变的是舞台宽高比（左右 ×2 → 变矮、上下 ÷2 → 变高），但 node.size
// 是持久化值：ComfyUI 不会因 DOM widget 的高度契约变化而自动调整节点，不重算
// 就会出现「图像区被压扁」或「节点下方留一大块空白」。
test("切换视图会重算节点尺寸", () => {
    const setView = JS.match(/const setView = \(mode\) => \{[\s\S]*?\n {4}\};/);
    assert.ok(setView, "未找到 setView");
    assert.match(setView[0], /fitNodeToStage\(\);/, "切换视图后必须重算节点尺寸");
});

test("节点尺寸重算只有一处实现，且 setSize 与 setDirtyCanvas 成对", () => {
    const fit = FIT_SRC;
    assert.ok(fit, "未找到尺寸重算实现");
    assert.match(fit, /node\.setSize\?\.\(/);
    assert.match(fit, /node\.setDirtyCanvas\?\.\(true, true\)/);
    // 宽度沿用节点当前宽度（用户拖出来的宽度是有意的），只重算高度
    assert.match(fit, /--ws-media-node-min-width/);
    assert.match(fit, /--ws-compare-node-min-height/);
    // 首次载入的尺寸归一必须复用同一实现，否则两处会各自漂移
    const commit = JS.match(/const commitLayout = \(ratio\) => \{[\s\S]*?\n {4}\};/);
    assert.ok(commit, "未找到 commitLayout");
    assert.match(commit[0], /fitNodeToStage\(\{/);
    assert.doesNotMatch(commit[0], /node\.setSize\?\.\(/, "commitLayout 不得再自带一份尺寸计算");
});

// ── 行为验证：抽出高度契约与尺寸重算，在 stub 上真跑一遍 ──
// media-tools.js 里有两份 getWidgetHeight（取点编辑器与图像对比各一份），
// 必须按内容挑出对比节点这一份，否则会抽错函数
function pickSource(re, marker) {
    const candidates = [...JS.matchAll(re)].map((entry) => entry[0]);
    return candidates.find((src) => src.includes(marker));
}

const HEIGHT_SRC = pickSource(/const getWidgetHeight = \(\) => \{[\s\S]*?\n {4}\};/g, "stage.clientWidth");
const FIT_SRC = pickSource(/const (fitNodeToStage|syncNodeSize)\s*=\s*\([\s\S]*?\n {4}\};/g, "node.setSize");

function loadCompareSizing(viewMode = "slide") {
    assert.ok(HEIGHT_SRC, "未找到 getWidgetHeight");
    assert.ok(FIT_SRC, "未找到 fitNodeToStage");
    const factory = new Function(
        "getWOSAIVarNum", "stage", "state", "stageAspectRatio", "root", "requestAnimationFrame",
        `${HEIGHT_SRC}\n${FIT_SRC}\n`
        // node.computeSize 要用到 widget 高度，故在同源作用域里造这个 stub
        + "const node = {\n"
        + "  size: [420, 520], dirty: false,\n"
        + "  computeSize: () => [node.size[0], getWidgetHeight() + 60],\n"
        + "  setSize(v) { node.size = v.slice(); },\n"
        + "  setDirtyCanvas() { node.dirty = true; },\n"
        + "};\n"
        + "return { getWidgetHeight, fitNodeToStage, node };\n",
    );
    const vars = {
        "--ws-gap-sm": 6,
        "--ws-compare-handle-size": 28,
        "--ws-media-preview-min-width": 240,
        "--ws-media-node-min-width": 420,
        "--ws-compare-node-min-height": 280,
    };
    return factory(
        (name, fallback) => vars[name] ?? fallback,
        { clientWidth: 400 },
        { aspectRatio: 16 / 9, viewMode },
        stageAspectRatio,
        { isConnected: true },
        (fn) => fn(), // 同步执行，测试里不引入真实帧延迟
    );
}

test("切换视图确实改变节点高度（左右变矮、上下变高）", () => {
    const heightOf = (mode) => {
        const sizing = loadCompareSizing(mode);
        sizing.fitNodeToStage();
        return sizing.node.size[1];
    };
    const slide = heightOf("slide");
    const side = heightOf("side");
    const stack = heightOf("stack");
    assert.ok(stack > slide, `上下排列必须比滑动高：stack=${stack} slide=${slide}`);
    assert.ok(side < slide, `左右排列必须比滑动矮：side=${side} slide=${slide}`);
});

test("重算只改高度，不动用户拖出来的宽度", () => {
    const sizing = loadCompareSizing("stack");
    sizing.fitNodeToStage();
    assert.equal(sizing.node.size[0], 420, "宽度必须沿用节点当前宽度");
    assert.equal(sizing.node.dirty, true, "改完尺寸必须标脏，否则画布不重绘");
});

test("左右并排会把过窄的节点补宽（半幅不得小于最小预览宽）", () => {
    const sizing = loadCompareSizing("side");
    sizing.node.size[0] = 300; // 用户拖窄过
    sizing.fitNodeToStage();
    assert.ok(sizing.node.size[0] >= 480,
        `左右并排的最小宽度应为两幅预览宽：实际 ${sizing.node.size[0]}`);
    // 已经够宽的节点不该被改动
    const wide = loadCompareSizing("side");
    wide.node.size[0] = 900;
    wide.fitNodeToStage();
    assert.equal(wide.node.size[0], 900);
});

test("切换视图不夹初始最小高度（左右并排的舞台本就矮，夹了会留白）", () => {
    const sizing = loadCompareSizing("side");
    sizing.fitNodeToStage();
    assert.ok(sizing.node.size[1] < 280,
        `左右并排应收到内容高度而非初始最小高度：${sizing.node.size[1]}`);
    // 但首次载入仍要夹，避免节点初始坍缩
    assert.match(JS, /fitNodeToStage\(\{ clampMinHeight: true \}\)/);
});
