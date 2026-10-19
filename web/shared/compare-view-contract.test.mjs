import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hasCompareMedia, stageAspectRatio } from "./media-preview.js";

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

// 图像对比节点里的图片不再带圆角：用户在深色/暖色调图片上更需要看到完整画幅，
// 且舞台本身的圆角会在分割线走到边缘时裁掉热区。
test("舞台与图片层四角为直角", () => {
    assert.match(CSS, /\.wosai-image-compare-stage \{\n[^}]*border-radius: 0;/s);
    assert.match(CSS, /\.wosai-image-compare-top \{\n[^}]*border-radius: 0;/s);
});

// 橙色品牌色在暖色调图片上融进去，分割线与活跃控件改用主文本色，
// 该颜色在深浅主题下都是最高对比度。
test("分割线与活跃控件颜色使用主文本色而非橙色强调色", () => {
    const lineRule = CSS.match(/\.wosai-image-compare-line \{[^}]*\}/s)?.[0] ?? "";
    assert.match(lineRule, /background:\s*var\(--ws-text\)/, "分割线必须用主文本色");
    const viewRule = CSS.match(/\.wosai-image-compare-view\.is-active \{[^}]*\}/s)?.[0] ?? "";
    assert.match(viewRule, /color:\s*var\(--ws-text\)/, "视图按钮 active 必须用主文本色");
    assert.doesNotMatch(viewRule, /color:\s*var\(--ws-accent\)/, "视图按钮 active 不得再用橙色");
    const swapRule = CSS.match(/\.wosai-image-compare-swap\.is-active \{[^}]*\}/s)?.[0] ?? "";
    assert.match(swapRule, /color:\s*var\(--ws-text\)/, "交换按钮 active 必须用主文本色");
    assert.doesNotMatch(swapRule, /color:\s*var\(--ws-accent\)/, "交换按钮 active 不得再用橙色");
});

test("双拼视图把图层切成半幅并补上主轴尺寸", () => {
    // left/top 偏移必须与主轴尺寸成对出现，否则 100% 尺寸会把面板推出舞台边界
    // 底层（B）占右/下半、上层（A）占左/上半：与滑动视图「左端是 A」同向
    assert.match(CSS, /is-view-side > img \{[^}]*left: 50%;[^}]*width: 50%;/s);
    assert.match(CSS, /is-view-side \.wosai-image-compare-top \{[^}]*right: auto;[^}]*width: 50%;/s);
    assert.match(CSS, /is-view-stack > img \{[^}]*top: 50%;[^}]*height: 50%;/s);
    assert.match(CSS, /is-view-stack \.wosai-image-compare-top \{[^}]*bottom: auto;[^}]*height: 50%;/s);
});

test("双拼视图所有圆角为直角", () => {
    assert.match(CSS, /is-view-side > img \{[^}]*border-radius: 0;/s);
    assert.match(CSS, /is-view-side \.wosai-image-compare-top \{[^}]*border-radius: 0;/s);
    assert.match(CSS, /is-view-stack > img \{[^}]*border-radius: 0;/s);
    assert.match(CSS, /is-view-stack \.wosai-image-compare-top \{[^}]*border-radius: 0;/s);
});

test("双拼视图隐藏分割线 / 热区，只留分隔缝", () => {
    for (const view of ["is-view-side", "is-view-stack"]) {
        for (const part of ["-line", "-grab"]) {
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

test("rgthree 式悬停对比：pointermove 无需按下即可移动分割线", () => {
    // 旧的拖拽实现要求 event.buttons（按住）才算移动，现在改为悬停即跟随，
    // 反映 rgthree「鼠标在图像区滑动即可对比，无需点击」的交互
    assert.doesNotMatch(JS, /if \(event\.buttons\) setSplitFromPointer/, "不得再要求按住鼠标");
    // pointermove 处理器里：① 仅在滑动视图生效，② 悬停在控件上时不跟手，
    // ③ 其余情况调用 setSplitFromPointer 实时更新分割线
    assert.match(JS, /if \(!isSplittable\(\)\) return;/, "pointermove 仍只在滑动视图生效");
    assert.match(JS, /if \(isOverControl\(event\.clientX, event\.clientY\)\) return;/, "悬停在控件上时不跟手");
    assert.match(JS, /setSplitFromPointer\(event\);/, "悬停移动时实时更新分割线");
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
    // 分割线 / 热区是「这是一张对比图」的语义表达，不是操作项：
    // 把分割线一起隐掉，节点会退化成一张普通图片
    for (const part of ["-line", "-grab"]) {
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
const SYNC_SRC = pickSource(/const syncBaseWidth = \(\) => \{[\s\S]*?\n {4}\};/g, "state.baseWidth");
const FIT_SRC = pickSource(/const (fitNodeToStage|syncNodeSize)\s*=\s*\([\s\S]*?\n {4}\};/g, "node.setSize");

// 从载荷推算舞台宽高比：单边有图时按该图比例（不退回 16:9 兜底），
// 双边取平均，两侧皆空回落 16/9。仅服务于尺寸契约测试，与真实渲染的取比逻辑无关。
function comparePayloadAspect(payload) {
    const a = payload?.a, b = payload?.b;
    const ratioOf = (m) => (m && m.width > 0 && m.height > 0 ? m.width / m.height : 0);
    const ra = ratioOf(a), rb = ratioOf(b);
    if (ra > 0 && rb <= 0) return ra;
    if (rb > 0 && ra <= 0) return rb;
    if (ra > 0 && rb > 0) return (ra + rb) / 2;
    return 16 / 9;
}

function loadCompareSizing(viewMode = "slide", payload = { a: { width: 1024, height: 576 }, b: null }) {
    assert.ok(HEIGHT_SRC, "未找到 getWidgetHeight");
    assert.ok(SYNC_SRC, "未找到 syncBaseWidth");
    assert.ok(FIT_SRC, "未找到 fitNodeToStage");
    const factory = new Function(
        "getWOSAIVarNum", "stage", "state", "stageAspectRatio", "root", "requestAnimationFrame",
        "payload", "hasCompareMedia",
        `${HEIGHT_SRC}\n${SYNC_SRC}\n${FIT_SRC}\n`
        // node.computeSize 要用到 widget 高度，故在同源作用域里造这个 stub
        + "const node = {\n"
        + "  size: [420, 520], dirty: false,\n"
        + "  computeSize: () => [node.size[0], getWidgetHeight() + 60],\n"
        + "  setSize(v) { node.size = v.slice(); },\n"
        + "  setDirtyCanvas() { node.dirty = true; },\n"
        + "};\n"
        + "return { getWidgetHeight, fitNodeToStage, syncBaseWidth, node, state };\n",
    );
    const vars = {
        "--ws-gap-sm": 6,
        "--ws-compare-handle-size": 28,
        "--ws-media-preview-min-width": 240,
        "--ws-media-node-min-width": 420,
        "--ws-compare-node-min-height": 280,
    };
    const state = { aspectRatio: comparePayloadAspect(payload), viewMode, baseWidth: 0, appliedWidth: 0 };
    return factory(
        (name, fallback) => vars[name] ?? fallback,
        { clientWidth: 400 },
        state,
        stageAspectRatio,
        { isConnected: true },
        (fn) => fn(), // 同步执行，测试里不引入真实帧延迟
        payload,
        hasCompareMedia,
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

// 左右并排时每半幅只占节点宽的一半，沿用单幅宽度会把两张图都挤成缩略图。
test("左右并排把单幅基准宽度翻倍", () => {
    const sizing = loadCompareSizing("slide");
    sizing.fitNodeToStage();
    assert.equal(sizing.node.size[0], 420, "单幅视图先确立基准宽度");
    sizing.state.viewMode = "side";
    sizing.fitNodeToStage();
    assert.equal(sizing.node.size[0], 840, `左右并排应把宽度翻倍：${sizing.node.size[0]}`);
});

// 宽度是相对「单幅基准」展开的，不是相对节点当前宽度——否则
// slide → side → slide → side 每次都会再翻一倍。
test("来回切换视图不会逐级翻倍", () => {
    const sizing = loadCompareSizing("slide");
    sizing.fitNodeToStage(); // 先确立单幅基准
    const widthAfter = (mode) => {
        sizing.syncBaseWidth(); // 真实 setView() 在改视图前先折回基准
        sizing.state.viewMode = mode;
        sizing.fitNodeToStage();
        return sizing.node.size[0];
    };
    assert.equal(widthAfter("side"), 840);
    assert.equal(widthAfter("slide"), 420);
    assert.equal(widthAfter("side"), 840);
    assert.equal(widthAfter("slide"), 420);
});

// 用户在左右并排下拖宽过节点 ⇒ 折回单幅基准后再展开，不覆盖手动调整
test("手动拖宽后切换：按当前视图折回单幅基准再展开", () => {
    const sizing = loadCompareSizing("slide");
    sizing.fitNodeToStage();          // 420
    sizing.syncBaseWidth();
    sizing.state.viewMode = "side";
    sizing.fitNodeToStage();          // 840
    sizing.node.size[0] = 1200;       // 用户在左右并排下拖宽
    sizing.syncBaseWidth();           // 仍在左右视图 ⇒ 基准 600
    sizing.state.viewMode = "slide";
    sizing.fitNodeToStage();
    assert.equal(sizing.node.size[0], 600, "左右视图下拖宽后切回单幅应取一半");
});

// 顺序反了（先改视图再折基准）会把双幅宽度当成单幅基准，切回去节点不收窄
test("setView 必须在改视图前折回基准宽度", () => {
    const setView = JS.match(/const setView = \(mode\) => \{[\s\S]*?\n {4}\};/);
    assert.ok(setView, "未找到 setView");
    const atSync = setView[0].indexOf("syncBaseWidth()");
    const atAssign = setView[0].indexOf("state.viewMode = next");
    assert.ok(atSync !== -1, "setView 必须调用 syncBaseWidth()");
    assert.ok(atSync < atAssign, "syncBaseWidth() 必须排在 state.viewMode = next 之前");
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

// ── 紧凑初始态（对照 rgthree 图像对比节点的形态）────────────────────────
// 旧实现无论有没有图都垫着一块 16:9 的空白舞台，节点初始高度恒被夹到 280px；
// 现在两侧都没有素材时控件高度为 0，节点只剩标题 + 两行输入端口，一旦有素材
// 就整块展开（尺寸仍由舞台宽高比换算接管）。

test("两侧都没有素材时控件高度为 0（紧凑初始态）", () => {
    for (const empty of [{ a: null, b: null }, {}]) {
        const sizing = loadCompareSizing("slide", empty);
        assert.equal(sizing.getWidgetHeight(), 0, "紧凑态必须不占高度");
    }
});

test("任一侧有素材即整块展开", () => {
    const onlyA = loadCompareSizing("slide", { a: { width: 1024, height: 576 }, b: null });
    const onlyB = loadCompareSizing("slide", { a: null, b: { width: 800, height: 800 } });
    assert.ok(onlyA.getWidgetHeight() > 0, "只有 A 也要出图");
    assert.ok(onlyB.getWidgetHeight() > 0, "只有 B 也要出图");
    // 单边有图时舞台仍按该图比例换算，不退回 16:9 兜底
    const square = loadCompareSizing("slide", { a: null, b: { width: 800, height: 800 } });
    assert.equal(square.getWidgetHeight(), 400 / 1 + 6 * 2);
});

test("紧凑判定读的是载荷本身，与闲置态 / 视图态无关", () => {
    // 紧凑「收起」的判定只看载荷本身，不受闲置态 / 视图态影响：
    // 高度换算本身仍要读 viewMode（左右/上下并排的宽高比不同），这是合理的，
    // 但「是否收起控件」这一决策不能夹带 is-idle 或 viewMode。
    const compactLine = HEIGHT_SRC.match(/if \(!hasCompareMedia\(payload\)\) return 0;/)[0];
    assert.ok(compactLine, "紧凑收起判定必须存在");
    assert.doesNotMatch(compactLine, /is-idle|viewMode/);
});

test("紧凑态整块舞台收起，不再漏出舞台切片", () => {
    // 舞台自带背景与一像素轮廓，内部还挂着分割线（主文本色）。只把「高度算作 0」
    // 而元素照旧渲染，紧凑态会在端口下方漏出一条「黑条 + 中间一根白竖线」的切片
    // （用户实测报的缺陷）——高度对、观感不对。stage 是 root 的唯一子节点，收起它
    // 之后紧凑态不再画任何东西。
    assert.match(
        CSS,
        /\.wosai-image-compare:not\(\.has-first\):not\(\.has-second\) \.wosai-image-compare-stage \{\s*display: none;/,
    );
});

test("紧凑态不夹初始最小高度，有图后才夹回", () => {
    assert.match(JS, /const nodeMinHeight = \(\) => \(hasCompareMedia\(payload\)/);
    // 创建期的两条尺寸路径都必须走这个 getter，直写 280 会让紧凑态又被撑高
    const uses = JS.match(/\bnodeMinHeight\b/g) ?? [];
    assert.ok(uses.length >= 3, `nodeMinHeight 应被声明并复用到两条路径：实际 ${uses.length} 次`);
    assert.doesNotMatch(
        JS,
        /compactNodeToContent\(\s*\n\s*node,\s*\n\s*getWOSAIVarNum\("--ws-media-node-min-width", 420\),\s*\n\s*getWOSAIVarNum\("--ws-compare-node-min-height", 280\),/,
    );
});

// ── 上游直读：连线即出图，无需重跑工作流 ───────────────────────────────
// ComfyUI 前端已经把「每个节点最近一次产出」缓存在 app.nodeOutputs 上，
// 因此「上游有图」时不必等执行：接线 / 打开工作流 / 上游单独执行三条路径
// 都要能拿到素材并立刻预览。

test("自动加载挂在「连线变动」与「图配置完成」两个钩子上", () => {
    assert.match(JS, /nodeType\.prototype\.onConnectionsChange = connectionsChanged;/);
    assert.match(JS, /nodeType\.prototype\.onAfterGraphConfigured = afterGraphConfigured;/);
    // onConfigure 时链接还没建立（LiteGraph 先建节点再连线），不能只挂在那里
    const configured = JS.match(/const configured = function \(\) \{[\s\S]*?\n {4}\};/)[0];
    assert.doesNotMatch(configured, /RefreshUpstream/);
    // 两个钩子都要转调同一个入口，避免两处各自实现一套解析
    const hooks = JS.match(/__wosaiCompareRefreshUpstream\?\.\(\)/g) ?? [];
    assert.equal(hooks.length, 2, "两个钩子都应转调 __wosaiCompareRefreshUpstream");
});

test("上游解析在节点销毁时摘得干净", () => {
    assert.match(JS, /api\.removeEventListener\("executed", onUpstreamExecuted\);/);
    assert.match(JS, /delete node\.__wosaiCompareRefreshUpstream;/);
    assert.match(JS, /api\.addEventListener\("executed", onUpstreamExecuted\);/);
});

test("上游素材取自前端执行缓存的多种定位符键，URL 只算一次", () => {
    assert.match(
        JS,
        /for \(const key of nodeOutputLocatorKeys\(nodeId, app\.graph\?\.rootGraph\?\.id\)\)/,
    );
    // 探针与随后的渲染必须复用同一个 URL：imageUrl 每次都会加时间戳，
    // 分别计算会让同一份文件被请求两次
    assert.match(JS, /const url = imageUrl\(media\);/);
    assert.match(JS, /if \(data\.url\) return opaqueImageUrl\(data\.url\);/);
});

// ── 张量上游的实时预览（2026-10-19）────────────────────────────────────
// VAE 解码、缩放这类纯计算节点不写前端缓存，直读必然落空。三层回退保证
// 「执行过一次就总能看到」：上游自身缓存 → 同源兄弟缓存 → 本节点上次载荷。
test("张量上游的预览走三层回退，且顺序不可乱", () => {
    // 第一层：上游自身缓存（含 imgs 兜底）
    assert.match(JS, /const cached = mediaFromOutputCache\(upstream\.id\);/);
    assert.match(JS, /if \(cached\) return cached;/);
    // 第二层：同源兄弟——沿链接向下找第一个带缓存的节点借用
    assert.match(JS, /const siblingMedia = \(name\) => \{/);
    assert.match(
        JS,
        /for \(const targetId of collectDownstreamTargets\(links, origin\.id, origin\.slot\)\)/,
    );
    // 第三层：本节点自己的 ui.wosai_compare 载荷（undo/任务恢复时 onExecuted 不重放）
    assert.match(JS, /const ownComparePayload = \(\) => \{/);
    assert.match(JS, /Array\.isArray\(entry\?\.wosai_compare\) \? entry\.wosai_compare\[0\] : null/);
    // resolveSide 里直读优先于兄弟，兜底只能补空位
    const resolveSide = JS.match(/const resolveSide = async \(name\) => \{[\s\S]*?\n {4}\};/)[0];
    assert.match(resolveSide, /upstreamMedia\(upstream\) : null\) \?\? siblingMedia\(name\)/);
    const refresh = JS.match(/const refreshFromUpstream = async \(\) => \{[\s\S]*?\n {4}\};/)[0];
    assert.match(refresh, /const own = ownComparePayload\(\);/);
    assert.match(refresh, /next = \{ a: next\.a \?\? own\.a, b: next\.b \?\? own\.b \};/);
    // 纯函数层只认 LiteGraph 的 snake_case 链接字段
    assert.match(
        PREVIEW,
        /nodeSlotKey\(link\?\.origin_id, link\?\.origin_slot\)/,
    );
});

test("同源兄弟执行也会带动预览刷新", () => {
    const listener = JS.match(/const onUpstreamExecuted = \(message\) => \{[\s\S]*?\n {4}\};/)[0];
    // 直上游命中照旧
    assert.match(listener, /String\(upstreamNodeOf\(name\)\?\.id \?\? ""\) === executed\) return true;/);
    // 兄弟判定复用同一条 BFS：执行节点在输入同源的下游集合里即命中
    assert.match(listener, /const origin = inputOriginOf\(name\);/);
    assert.match(listener, /collectDownstreamTargets\(links, origin\.id, origin\.slot\)\.includes\(executed\)/);
});

test("连线被连续改动时只落地最后一次解析结果", () => {
    assert.match(JS, /let upstreamToken = 0;/);
    assert.match(JS, /const token = \+\+upstreamToken;/);
    assert.match(JS, /if \(token !== upstreamToken \|\| !root\.isConnected\) return;/);
});

// ── 预览按 RGB 取图，与执行侧张量同源（2026-10-16）─────────────────────
// 源文件带 alpha 时（Clipspace 涂抹产物的涂抹区 alpha=0，底下 RGB 却仍是原图内容），
// `/view` 默认按 rgba 返回，透明区就透出舞台底色——看着像「节点把原图换成了遮罩」。
// 执行侧 LoadImage 会 convert("RGB") 丢掉 alpha，预览必须跟着丢：否则「看到的」与
// 「正在比对的」不是同一张图（用户报的正是这个现象）。
test("预览图像统一按 RGB 取，透明区不再透出舞台底色", () => {
    assert.match(JS, /function opaqueImageUrl\(/);
    assert.match(JS, /parsed\.searchParams\.set\("channel", "rgb"\)/);
    // 两条取图路径都要过一遍：载荷/缓存拼出来的 URL，与上游预览元素已有的 URL
    assert.match(JS, /if \(data\.url\) return opaqueImageUrl\(data\.url\);/);
    assert.match(JS, /return opaqueImageUrl\(api\.apiURL\(/);
    // 非 /view 出图（blob: / data:）不得改写
    assert.match(JS, /\/\^\(\?:blob:\|data:\)\//);
    // 已算好的 URL 必须原样复用：探针与渲染不能各拼一个字符串
    assert.match(JS, /const url = imageUrl\(media\);/);
});
