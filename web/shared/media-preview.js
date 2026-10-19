/**
 * 媒体对比节点的纯函数工具层。
 *
 * 这里只放「无 DOM、无副作用」的判定与换算，便于 node --test 直接覆盖：
 * 分割百分比归一、A/B 显示位互换、视图模式归一、舞台宽高比换算，
 * 以及「从前端执行缓存里取上游素材」所需的键名推导与形状归一。
 */

/** 对比视图的可选模式：滑动对比、左右并排、上下并排。 */
export const COMPARE_VIEW_MODES = Object.freeze(["slide", "side", "stack"]);

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
 * 载荷里是否已有任一侧素材。
 *
 * 两侧皆空 = 节点处于紧凑初始态：控件不占高度，只剩标题与两行输入端口
 * （对照 rgthree 图像对比节点的形态），不再垫一块空白舞台。
 */
export function hasCompareMedia(payload) {
    return Boolean(payload?.a || payload?.b);
}

/**
 * ComfyUI 前端把「每个节点最近一次产出」缓存在 `app.nodeOutputs` 上
 * （LoadImage 换图、预览节点执行完都会写入）。缓存键是节点定位符，近几个版本
 * 换过三种形态：裸 `nodeId` → `<subgraphId>:<nodeId>` → `~root:<nodeId>`。
 * 这里按「最具体 → 最宽松」列出候选键，由调用方逐个试探，避免把扩展绑死在
 * 某一个前端版本上。
 */
export function nodeOutputLocatorKeys(nodeId, rootGraphId) {
    const id = String(nodeId ?? "");
    if (!id) return [];
    const keys = [];
    if (rootGraphId) keys.push(`${rootGraphId}:${id}`);
    keys.push(`~root:${id}`, id);
    return [...new Set(keys)];
}

/**
 * 从 `app.nodeOutputs` 的一条记录里取出第一张图像的 `/view` 引用。
 *
 * 前端缓存里的形状与后端载荷不同（没有 `kind` / 宽高），这里只归一成
 * 「后端载荷的一个子集」，让下游的 `imageUrl()` 与尺寸探针共用一套读法。
 * 无图、元素为 null（批次占位）或没有 filename 一律返回 `null`。
 */
export function mediaFromNodeOutput(entry) {
    const images = Array.isArray(entry?.images) ? entry.images : [];
    const first = images.find((item) => item?.filename);
    if (!first) return null;
    return {
        kind: typeof first.kind === "string" ? first.kind : "image",
        filename: String(first.filename),
        subfolder: String(first.subfolder || ""),
        type: String(first.type || "temp"),
    };
}

/** 节点定位键：`"<id>:<slot>"`；id 为空返回 null。 */
function nodeSlotKey(id, slot) {
    const text = String(id ?? "");
    if (text === "") return null;
    const slotNumber = Number(slot ?? 0);
    return `${text}:${Number.isFinite(slotNumber) ? slotNumber : 0}`;
}

/**
 * 遍历链接容器：LiteGraph 各版本用过 Map、普通对象与数组三种形态，
 * 元素一律按「含 origin_id / target_id 的对象」过滤后交给回调。
 */
function forEachLink(graphLinks, callback) {
    if (!graphLinks) return;
    if (typeof graphLinks.forEach === "function") {
        graphLinks.forEach((value) => {
            if (value && typeof value === "object") callback(value);
        });
        return;
    }
    if (typeof graphLinks === "object") {
        for (const key of Object.keys(graphLinks)) {
            const value = graphLinks[key];
            if (value && typeof value === "object") callback(value);
        }
    }
}

/**
 * 沿链接向下游收集「与 origin 输出同源」的目标节点 id（BFS 层序，去重）。
 *
 * 对比节点的直读只认「上游节点自身有前端缓存」的素材；上游是纯计算节点
 * （VAE 解码、缩放等）时缓存永远为空，但同源下游的保存 / 预览节点往往已把
 * 同一份图像落盘。这里从链接的 origin 输出出发逐层向下：第一跳精确匹配
 * ``(origin_id, origin_slot)``，之后按 origin_id 匹配该节点的全部输出——
 * reroute 之类的直通节点会被自动穿过（它们本就没有缓存可供命中）。
 * 返回按层序排列的节点 id 字符串列表，调用方从中取第一个带媒体缓存的节点。
 */
export function collectDownstreamTargets(graphLinks, originId, originSlot, maxDepth = 4) {
    const originKey = nodeSlotKey(originId, originSlot);
    if (!originKey) return [];
    const visited = new Set();
    const order = [];
    let matchKeys = [originKey];
    for (let depth = 0; depth < maxDepth && matchKeys.length > 0; depth += 1) {
        const nextKeys = new Set();
        forEachLink(graphLinks, (link) => {
            const linkKey = depth === 0
                ? nodeSlotKey(link?.origin_id, link?.origin_slot)
                : String(link?.origin_id ?? "");
            if (linkKey === "" || !matchKeys.includes(linkKey)) return;
            const targetKey = String(link?.target_id ?? "");
            if (targetKey === "" || visited.has(targetKey)) return;
            visited.add(targetKey);
            order.push(targetKey);
            nextKeys.add(targetKey);
        });
        matchKeys = [...nextKeys];
    }
    return order;
}
