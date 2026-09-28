/**
 * 媒体对比节点的纯函数工具层。
 *
 * 这里只放「无 DOM、无副作用」的判定与换算，便于 node --test 直接覆盖：
 * 分割百分比归一、A/B 显示位互换、视图模式解析、舞台宽高比换算、尺寸标注文本。
 */

/** 对比视图的可选模式。`auto` 会在运行时解析为 `side` 或 `stack`。 */
export const COMPARE_VIEW_MODES = Object.freeze(["slide", "side", "stack", "auto"]);

/** 滑动视图：单一舞台 + 可拖动的分割线。 */
export const COMPARE_VIEW_DEFAULT = "slide";

/**
 * 双拼视图的舞台宽高比夹取区间。
 *
 * 双拼视图会把舞台一分为二，理想比值是 `基础比值 × 2`（左右）或 `÷ 2`（上下），
 * 这样每半幅恰好等于原图比例、零留白。但极端比例的素材会把这个理想值推到失真
 * （例如 1:2 的竖图用上下并排会得到 1:4 的舞台）。夹取到 [0.5, 3] 后：
 * 下限保证舞台高度不超过宽度的 2 倍，上限保证舞台不会扁成一条缝。
 */
export const COMPARE_STAGE_RATIO_BOUNDS = Object.freeze({ min: 0.5, max: 3 });

export function normalizeSplitPercent(value, fallback = 50) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(100, parsed));
}

export function compareDisplayPair(payload, swapped = false) {
    const pair = {
        a: payload?.a ?? null,
        b: payload?.b ?? null,
    };
    return swapped ? { a: pair.b, b: pair.a } : pair;
}

/** 把任意持久化值归一为合法视图模式，非法值回落到滑动视图。 */
export function normalizeViewMode(value, fallback = COMPARE_VIEW_DEFAULT) {
    return COMPARE_VIEW_MODES.includes(value) ? value : fallback;
}

/**
 * 解析实际布局：`auto` 按素材宽高比择向。
 *
 * 横图（比值 ≥ 1）走上下并排：左右并排会把横图压成两条细缝。
 * 竖图（比值 < 1）走左右并排：上下并排会把竖图拉成超高的舞台。
 * 比值缺失或非法时按正方形（1）处理，与「≥ 1 走上下」保持自洽。
 */
export function resolveViewMode(mode, ratio) {
    const normalized = normalizeViewMode(mode);
    if (normalized !== "auto") return normalized;
    const numeric = Number(ratio);
    const usable = Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
    return usable >= 1 ? "stack" : "side";
}

function clampStageRatio(value) {
    return Math.min(
        COMPARE_STAGE_RATIO_BOUNDS.max,
        Math.max(COMPARE_STAGE_RATIO_BOUNDS.min, value),
    );
}

/** 舞台宽高比：滑动视图用原图比例，双拼视图按半幅还原后再夹取。 */
export function stageAspectRatio(view, ratio) {
    const numeric = Number(ratio);
    const safe = Number.isFinite(numeric) && numeric > 0 ? numeric : 16 / 9;
    if (view === "side") return clampStageRatio(safe * 2);
    if (view === "stack") return clampStageRatio(safe / 2);
    return safe;
}

/** 从媒体载荷里取宽高比；尺寸缺失或非法时返回 0，交由调用方兜底。 */
export function mediaSourceRatio(media) {
    const width = Number(media?.width) || 0;
    const height = Number(media?.height) || 0;
    if (width <= 0 || height <= 0) return 0;
    return width / height;
}

/**
 * 尺寸标注文本，例如 `1024×1024`。
 *
 * 用 U+00D7 乘号而不是字母 x：等宽字形对齐更好，也不会被误读成变量名。
 * 尺寸未知时返回空串，调用方据此退化为「只显示 A/B 字母」。
 */
export function formatMediaSize(media) {
    const width = Math.round(Number(media?.width) || 0);
    const height = Math.round(Number(media?.height) || 0);
    if (width <= 0 || height <= 0) return "";
    return `${width}\u00d7${height}`;
}

/** 角标文本：`A 1024×1024`；尺寸未知时退化为 `A`。 */
export function formatMediaBadgeLabel(media, letter) {
    const size = formatMediaSize(media);
    const prefix = String(letter ?? "").trim() || "?";
    return size ? `${prefix} ${size}` : prefix;
}
