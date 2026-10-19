import test from "node:test";
import assert from "node:assert/strict";

import {
    COMPARE_STAGE_RATIO_BOUNDS,
    COMPARE_VIEW_MODES,
    collectDownstreamTargets,
    compareDisplayPair,
    hasCompareMedia,
    mediaFromNodeOutput,
    mediaSourceRatio,
    nodeOutputLocatorKeys,
    normalizeSplitPercent,
    normalizeViewMode,
    stageAspectRatio,
} from "./media-preview.js";

test("normalizeSplitPercent preserves both comparison endpoints", () => {
    assert.equal(normalizeSplitPercent("0"), 0);
    assert.equal(normalizeSplitPercent("100"), 100);
});

test("normalizeSplitPercent clamps range and falls back for invalid values", () => {
    assert.equal(normalizeSplitPercent(-10), 0);
    assert.equal(normalizeSplitPercent(130), 100);
    assert.equal(normalizeSplitPercent("invalid"), 50);
});

test("compareDisplayPair swaps display roles without mutating the payload", () => {
    const payload = { a: { filename: "a.png" }, b: { filename: "b.png" } };
    assert.deepEqual(compareDisplayPair(payload, false), payload);
    assert.deepEqual(compareDisplayPair(payload, true), {
        a: payload.b,
        b: payload.a,
    });
    assert.equal(payload.a.filename, "a.png");
    assert.equal(payload.b.filename, "b.png");
});

test("COMPARE_VIEW_MODES keeps slide as the first and default mode", () => {
    assert.deepEqual([...COMPARE_VIEW_MODES], ["slide", "side", "stack"]);
});

test("normalizeViewMode accepts known modes and falls back for anything else", () => {
    for (const mode of COMPARE_VIEW_MODES) {
        assert.equal(normalizeViewMode(mode), mode);
    }
    // 老工作流没有这个属性，或手工改坏了持久化数据
    assert.equal(normalizeViewMode(undefined), "slide");
    assert.equal(normalizeViewMode(null), "slide");
    assert.equal(normalizeViewMode(""), "slide");
    assert.equal(normalizeViewMode("SLIDE"), "slide");
    assert.equal(normalizeViewMode(0), "slide");
    assert.equal(normalizeViewMode({ mode: "side" }), "slide");
    assert.equal(normalizeViewMode("bogus", "stack"), "stack");
    // 自动排布已移除：旧工作流里存下的 auto 必须回落到滑动视图，而不是变成
    // 「没有视图类名」的裸状态（那样双拼 CSS 与分割线会同时失效）
    assert.equal(normalizeViewMode("auto"), "slide");
    assert.equal(normalizeViewMode("auto", "side"), "side");
    assert.ok(!COMPARE_VIEW_MODES.includes("auto"));
});

test("stageAspectRatio keeps the source ratio for the slide view", () => {
    assert.equal(stageAspectRatio("slide", 16 / 9), 16 / 9);
    assert.equal(stageAspectRatio("slide", 0.5), 0.5);
    assert.equal(stageAspectRatio("slide", 3), 3);
    // 滑动视图不夹取：竖图的舞台本来就该是高的
    assert.equal(stageAspectRatio("slide", 0.2), 0.2);
});

test("stageAspectRatio doubles / halves the stage so each panel matches the source", () => {
    // 用正方形：2 与 0.5 都落在夹取区间内，能直接验证「半幅 == 原图比例」
    const ratio = 1;
    assert.equal(stageAspectRatio("side", ratio), ratio * 2);
    assert.equal(stageAspectRatio("stack", ratio), ratio / 2);

    // 校验「面板比例 == 原图比例」这一不变量：仅在夹取区间内成立
    // （左右要求 source×2 ≤ 3，上下要求 source÷2 ≥ 0.5，两者交集是 source ∈ [1, 1.5]）
    for (const source of [1, 1.25, 1.5]) {
        const sidePanels = stageAspectRatio("side", source) / 2;
        const stackPanels = stageAspectRatio("stack", source) * 2;
        assert.ok(Math.abs(sidePanels - source) < 1e-9, `side panels for ${source}`);
        assert.ok(Math.abs(stackPanels - source) < 1e-9, `stack panels for ${source}`);
    }

    // 超出区间时宁可留白也不让节点失真：面板比例被夹到边界
    assert.equal(stageAspectRatio("side", 2) / 2, COMPARE_STAGE_RATIO_BOUNDS.max / 2);
    assert.equal(stageAspectRatio("stack", 0.5) * 2, COMPARE_STAGE_RATIO_BOUNDS.min * 2);
});

test("stageAspectRatio clamps only the split views", () => {
    const { min, max } = COMPARE_STAGE_RATIO_BOUNDS;
    // 竖图上下并排 → 理想值 0.25，夹到下限
    assert.equal(stageAspectRatio("stack", 0.5), min);
    // 横图左右并排 → 理想值 3.56，夹到上限
    assert.equal(max, 3);
    assert.equal(stageAspectRatio("side", 16 / 9), max);
    // 夹取区间内的值原样保留
    assert.equal(stageAspectRatio("stack", 16 / 9), 8 / 9);
    assert.equal(stageAspectRatio("side", 1), 2);
});

test("stageAspectRatio falls back to 16:9 for unusable ratios", () => {
    const { min, max } = COMPARE_STAGE_RATIO_BOUNDS;
    const clamp = (value) => Math.min(max, Math.max(min, value));
    for (const ratio of [undefined, null, "abc", 0, -1, NaN]) {
        assert.equal(stageAspectRatio("slide", ratio), 16 / 9);
        assert.equal(stageAspectRatio("side", ratio), clamp((16 / 9) * 2));
        assert.equal(stageAspectRatio("stack", ratio), clamp((16 / 9) / 2));
    }
});

test("mediaSourceRatio reads payload dimensions and rejects unusable ones", () => {
    assert.equal(mediaSourceRatio({ width: 1024, height: 512 }), 2);
    assert.equal(mediaSourceRatio({ width: 512, height: 1024 }), 0.5);
    assert.equal(mediaSourceRatio({ width: "800", height: "600" }), 800 / 600);
    for (const media of [undefined, null, {}, { width: 800 }, { width: 0, height: 600 }]) {
        assert.equal(mediaSourceRatio(media), 0);
    }
});

test("hasCompareMedia reports the compact state only when both sides are empty", () => {
    assert.equal(hasCompareMedia({ a: { filename: "a.png" }, b: null }), true);
    assert.equal(hasCompareMedia({ a: null, b: { filename: "b.png" } }), true);
    assert.equal(hasCompareMedia({ a: { filename: "a.png" }, b: { filename: "b.png" } }), true);
    // 初始 / 清空态：两侧都没有 ⇒ 紧凑
    assert.equal(hasCompareMedia({ a: null, b: null }), false);
    assert.equal(hasCompareMedia({}), false);
    assert.equal(hasCompareMedia(undefined), false);
    assert.equal(hasCompareMedia(null), false);
});

test("nodeOutputLocatorKeys lists locator forms newest first", () => {
    // rootGraphId 已知时先试 <graphId>:<id>，再试当前版本的 ~root:<id>，最后裸 id
    assert.deepEqual(nodeOutputLocatorKeys(4, "root"), ["root:4", "~root:4", "4"]);
    // 拿不到 rootGraph.id（旧版前端 / 子图）时不能产出 "undefined:4" 这类废键
    assert.deepEqual(nodeOutputLocatorKeys(4), ["~root:4", "4"]);
    assert.deepEqual(nodeOutputLocatorKeys("4", null), ["~root:4", "4"]);
    // 数字与字符串 id 归一成同一个键，避免「画布上是 4、事件里是 "4"」重复试探
    assert.deepEqual(nodeOutputLocatorKeys("4", "root"), nodeOutputLocatorKeys(4, "root"));
    for (const empty of [undefined, null, ""]) {
        assert.deepEqual(nodeOutputLocatorKeys(empty, "root"), []);
    }
});

test("mediaFromNodeOutput normalizes the frontend cache shape", () => {
    assert.deepEqual(
        mediaFromNodeOutput({
            images: [{ filename: "a.png", subfolder: "sub", type: "output" }],
        }),
        { kind: "image", filename: "a.png", subfolder: "sub", type: "output" },
    );
    // 批次里的 null 占位（前端用它表示「这一帧没有图」）必须跳过，而不是当空引用
    assert.deepEqual(
        mediaFromNodeOutput({ images: [null, { filename: "b.png" }] }),
        { kind: "image", filename: "b.png", subfolder: "", type: "temp" },
    );
    // 视频节点同样会写 images，kind 由载荷给出
    assert.equal(mediaFromNodeOutput({ images: [{ filename: "v.mp4", kind: "video" }] }).kind, "video");
    for (const entry of [undefined, null, {}, { images: [] }, { images: [null] }, { images: [{}] }]) {
        assert.equal(mediaFromNodeOutput(entry), null);
    }
});

/** 构造 LiteGraph 形状的链接表：Map 容器 + snake_case 字段。 */
function linkMap(entries) {
    const map = new Map();
    entries.forEach(([id, originId, originSlot, targetId]) => {
        map.set(id, { id, origin_id: originId, origin_slot: originSlot, target_id: targetId });
    });
    return map;
}

test("collectDownstreamTargets walks the same-source downstream in BFS order", () => {
    // 拓扑：7:0 ─→ 8(保存) 与 9(reroute)；9 ─→ 10(保存)。7:1 ─→ 11 不与 7:0 同源。
    const links = linkMap([
        ["l1", 7, 0, 8],
        ["l2", 7, 0, 9],
        ["l3", 9, 0, 10],
        ["l4", 7, 1, 11],
        ["l5", 5, 0, 12],
    ]);
    assert.deepEqual(collectDownstreamTargets(links, 7, 0), ["8", "9", "10"]);
    // 第一跳精确到输出槽：7:1 的下游只有 11
    assert.deepEqual(collectDownstreamTargets(links, 7, 1), ["11"]);
});

test("collectDownstreamTargets dedupes across paths and caps the depth", () => {
    // 菱形 + 长链：7:0 → 8 / 9，8 → 10，9 → 10（去重），10 → 13 → 14
    const links = linkMap([
        ["l1", 7, 0, 8],
        ["l2", 7, 0, 9],
        ["l3", 8, 0, 10],
        ["l4", 9, 0, 10],
        ["l5", 10, 0, 13],
        ["l6", 13, 0, 14],
    ]);
    // 深度预算 4：0跳=8,9 → 1跳=10 → 2跳=13 → 3跳=14，恰好走完
    assert.deepEqual(collectDownstreamTargets(links, 7, 0), ["8", "9", "10", "13", "14"]);
    // 收紧到 3 层：14 被裁掉；10 只出现一次（两条路径汇聚）
    assert.deepEqual(collectDownstreamTargets(links, 7, 0, 3), ["8", "9", "10", "13"]);
});

test("collectDownstreamTargets accepts object and array link containers", () => {
    const asMap = linkMap([["l1", 3, 0, 4], ["l2", 4, 0, 5]]);
    const asObject = Object.fromEntries([...asMap.entries()]);
    const asArray = [...asMap.values()];
    const expected = ["4", "5"];
    assert.deepEqual(collectDownstreamTargets(asMap, 3, 0), expected);
    assert.deepEqual(collectDownstreamTargets(asObject, 3, 0), expected);
    assert.deepEqual(collectDownstreamTargets(asArray, 3, 0), expected);
});

test("collectDownstreamTargets returns empty for degenerate inputs", () => {
    const links = linkMap([["l1", 1, 0, 2]]);
    for (const [graphLinks, originId] of [
        [null, 1], [undefined, 1], [links, null], [links, ""], [links, undefined],
    ]) {
        assert.deepEqual(collectDownstreamTargets(graphLinks, originId, 0), []);
    }
    // 链接缺 origin_id / target_id 的脏数据不应抛错
    assert.deepEqual(
        collectDownstreamTargets(new Map([["bad", { id: "bad" }]]), 1, 0),
        [],
    );
});

