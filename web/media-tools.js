import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import {
    applyNodeDefTranslation,
    applyNodeInstanceTranslation,
    onLangChange,
    t,
} from "./shared/i18n.js";
import {
    addSizedDOMWidget,
    compactNodeToContent,
    ensureNodeMinSize,
    ensureWosaiStyles,
    hideSerializableWidget,
    mountNode2HiddenWidgets,
} from "./shared/dom-widget.js";
import {
    COMPARE_VIEW_DEFAULT,
    COMPARE_VIEW_MODES,
    compareDisplayPair,
    mediaSourceRatio,
    normalizeSplitPercent,
    normalizeViewMode,
    stageAspectRatio,
} from "./shared/media-preview.js";
import { getWOSAIVarNum } from "./shared/shared-utils.js";

const PATCH_KEY = "__wosaiMediaToolsPatch";
const POINTS_TYPE = "WOSAI_PointsEditor";
const COMPARE_TYPE = "WOSAI_ImageCompare";
const cleanups = new WeakMap();
const patchedNodeTypes = new Set();
let offLanguage = null;
const MEDIA_STYLES = [
    ["wosai-media-tools-style", new URL("./styles/media-tools.css?v=18", import.meta.url).href],
];

// 视图切换按钮图标（内联 SVG，仅描述几何形状，颜色全部交给 currentColor）。
// 三个图标都基于矩形：滑动 = 一条竖缝，左右 = 两块竖版，上下 = 两块横版。
// 尺寸统一由 CSS 令牌控制。
const VIEW_ICONS = {
    slide: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M12 4v16"/>',
    side: [
        '<rect x="3" y="4" width="7.6" height="16" rx="2"/>',
        '<rect x="13.4" y="4" width="7.6" height="16" rx="2"/>',
    ].join(""),
    stack: [
        '<rect x="4" y="3" width="16" height="7.6" rx="2"/>',
        '<rect x="4" y="13.4" width="16" height="7.6" rx="2"/>',
    ].join(""),
};

// 视图文案走静态字面量 key：i18n 覆盖率测试靠正则扫描 t("...")，动态拼接的 key
// 既查不出缺失也查不出拼写错误
function viewText(mode) {
    switch (mode) {
        case "side":
            return t("nodes.imageCompare.viewSide", "Side by side");
        case "stack":
            return t("nodes.imageCompare.viewStack", "Stacked");
        default:
            return t("nodes.imageCompare.viewSlide", "Slide");
    }
}

function imageUrl(data) {
    if (!data?.filename) return "";
    const query = new URLSearchParams({
        filename: data.filename,
        type: data.type || "temp",
        subfolder: data.subfolder || "",
        rand: String(Date.now()),
    });
    return api.apiURL(`/view?${query.toString()}`);
}

function findWidget(node, name) {
    return node.widgets?.find((widget) => (widget._wosaiOrigName || widget.name) === name);
}

function hideWidget(widget) {
    if (!widget || widget.__wosaiMediaHidden) return;
    widget.__wosaiMediaHidden = true;
    hideSerializableWidget(widget);
}

function parseState(raw) {
    const fallback = { version: 1, frame_index: 0, positive: [], negative: [], boxes: [] };
    try {
        const value = JSON.parse(String(raw || "{}"));
        if (!value || typeof value !== "object") return fallback;
        return {
            version: 1,
            frame_index: Math.max(0, Number(value.frame_index) || 0),
            positive: Array.isArray(value.positive) ? value.positive : [],
            negative: Array.isArray(value.negative) ? value.negative : [],
            boxes: Array.isArray(value.boxes) ? value.boxes : [],
        };
    } catch (_) {
        return fallback;
    }
}

function markChanged(node) {
    node.graph?.change?.();
    node.graph?.setDirtyCanvas?.(true, true);
    node.setDirtyCanvas?.(true, true);
}

function clearNativeImagePreview(node) {
    const hadPreview = Boolean(node?.imgs?.length);
    if (!node) return hadPreview;
    node.imgs = null;
    node.imageIndex = null;
    node.animatedImages = null;
    return hadPreview;
}

function pointsExecutionPayload(message) {
    const customPayload = message?.wosai_points;
    const previews = Array.isArray(customPayload?.[0]?.images)
        ? customPayload[0].images
        : (
            Array.isArray(customPayload)
                ? customPayload
                : (Array.isArray(message?.images) ? message.images : [])
        );
    if (!message || !Object.hasOwn(message, "images")) {
        return { previews, forwardedMessage: message };
    }
    const forwardedMessage = { ...message };
    delete forwardedMessage.images;
    return { previews, forwardedMessage };
}

function createPointsEditor(node) {
    if (node.__wosaiPointsRoot) return;
    const stateWidget = findWidget(node, "annotation_json");
    const previewScaleWidget = findWidget(node, "preview_scale");
    if (!stateWidget) return;
    hideWidget(stateWidget);
    hideWidget(previewScaleWidget);

    const controller = new AbortController();
    const { signal } = controller;
    const root = document.createElement("div");
    root.className = "wosai-points-editor";
    const toolbar = document.createElement("div");
    toolbar.className = "wosai-points-toolbar";
    const stage = document.createElement("div");
    stage.className = "wosai-points-stage";
    const image = document.createElement("img");
    image.alt = "";
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const empty = document.createElement("div");
    empty.className = "wosai-media-empty";
    empty.textContent = t("nodes.pointsEditor.empty", "Execute the node to load a preview");
    stage.append(image, canvas, empty);
    const frames = document.createElement("div");
    frames.className = "wosai-points-frames";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "wosai-media-range";
    slider.min = "0";
    slider.max = "0";
    slider.step = "1";
    const frameText = document.createElement("span");
    frames.append(slider, frameText);
    root.append(toolbar, stage, frames);

    const state = {
        mode: "positive",
        data: parseState(stateWidget.value),
        previews: [],
        history: [],
        draggingBox: null,
        aspectRatio: 16 / 9,
        normalizeSizeOnLoad: false,
    };

    const getWidgetHeight = () => {
        const gap = getWOSAIVarNum("--ws-gap-sm", 8);
        const toolbar = getWOSAIVarNum("--ws-media-toolbar-height", 34);
        const frameRow = state.previews.length > 1
            ? getWOSAIVarNum("--ws-media-frame-row-height", 30) + gap
            : 0;
        const contentWidth = Math.max(
            getWOSAIVarNum("--ws-media-preview-min-width", 240),
            (Number(node.size?.[0]) || 420) - gap * 2,
        );
        const stageHeight = contentWidth / Math.max(0.1, state.aspectRatio);
        return toolbar + stageHeight + frameRow + gap * 3;
    };

    const saveState = (remember = true, notify = true) => {
        if (remember) {
            state.history.push(JSON.stringify(state.data));
            if (state.history.length > 30) state.history.shift();
        }
        stateWidget.value = JSON.stringify(state.data);
        stateWidget.callback?.(stateWidget.value);
        if (notify) markChanged(node);
    };

    const resizeCanvas = () => {
        const width = Math.max(1, image.naturalWidth || 640);
        const height = Math.max(1, image.naturalHeight || 360);
        const scale = Math.min(1, 720 / width, 520 / height);
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        state.aspectRatio = canvas.width / canvas.height;
        stage.style.setProperty("--wosai-points-ratio", String(state.aspectRatio));
        draw();
        const minWidth = getWOSAIVarNum("--ws-media-node-min-width", 420);
        const minHeight = getWOSAIVarNum("--ws-points-node-min-height", 320);
        if (state.normalizeSizeOnLoad) {
            state.normalizeSizeOnLoad = false;
            const computed = node.computeSize?.();
            node.setSize?.([
                Math.max(minWidth, Number(node.size?.[0]) || 0),
                Math.max(minHeight, Number(computed?.[1]) || 0),
            ]);
            node.setDirtyCanvas?.(true, true);
        } else {
            ensureNodeMinSize(node, minWidth, minHeight);
        }
    };

    const draw = () => {
        const context = canvas.getContext("2d");
        if (!context) return;
        const styles = getComputedStyle(document.documentElement);
        const positiveColor = styles.getPropertyValue("--ws-hud-icon-green").trim();
        const negativeColor = styles.getPropertyValue("--ws-danger").trim();
        const boxColor = styles.getPropertyValue("--ws-accent-hover").trim();
        context.clearRect(0, 0, canvas.width, canvas.height);
        const point = (item, color) => {
            context.beginPath();
            context.arc(item.x * canvas.width, item.y * canvas.height, 6, 0, Math.PI * 2);
            context.fillStyle = color;
            context.fill();
            context.lineWidth = 2;
            context.strokeStyle = "white";
            context.stroke();
        };
        state.data.positive.forEach((item) => point(item, positiveColor));
        state.data.negative.forEach((item) => point(item, negativeColor));
        context.lineWidth = 2;
        context.strokeStyle = boxColor;
        for (const box of state.data.boxes) {
            context.strokeRect(
                box.x * canvas.width,
                box.y * canvas.height,
                box.w * canvas.width,
                box.h * canvas.height,
            );
        }
        if (state.draggingBox) {
            const box = state.draggingBox;
            context.setLineDash([6, 4]);
            context.strokeRect(
                box.x * canvas.width,
                box.y * canvas.height,
                box.w * canvas.width,
                box.h * canvas.height,
            );
            context.setLineDash([]);
        }
    };

    const updateFrame = (notify = false) => {
        const count = state.previews.length;
        const index = Math.max(0, Math.min(count - 1, Number(state.data.frame_index) || 0));
        state.data.frame_index = index;
        slider.max = String(Math.max(0, count - 1));
        slider.value = String(index);
        frameText.textContent = count ? `${index + 1}/${count}` : "0/0";
        frames.hidden = count <= 1;
        if (count) image.src = imageUrl(state.previews[index]);
        else image.removeAttribute("src");
        empty.hidden = count > 0;
        stage.classList.toggle("is-empty", count === 0);
        saveState(false, notify);
    };

    const modeButton = (mode, key, fallback) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.mode = mode;
        button.textContent = t(key, fallback);
        button.addEventListener("click", () => {
            state.mode = mode;
            toolbar.querySelectorAll("[data-mode]").forEach((item) => {
                item.classList.toggle("is-active", item.dataset.mode === mode);
            });
        }, { signal });
        return button;
    };
    const positive = modeButton("positive", "nodes.pointsEditor.positive", "Positive");
    const negative = modeButton("negative", "nodes.pointsEditor.negative", "Negative");
    const box = modeButton("box", "nodes.pointsEditor.box", "Box");
    positive.classList.add("is-active");
    const undo = document.createElement("button");
    undo.type = "button";
    undo.textContent = t("nodes.pointsEditor.undo", "Undo");
    undo.addEventListener("click", () => {
        const previous = state.history.pop();
        if (!previous) return;
        state.data = parseState(previous);
        saveState(false);
        draw();
    }, { signal });
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = t("nodes.pointsEditor.clear", "Clear");
    clear.addEventListener("click", () => {
        saveState(true);
        state.data.positive = [];
        state.data.negative = [];
        state.data.boxes = [];
        saveState(false);
        draw();
    }, { signal });
    toolbar.append(positive, negative, box, undo, clear);

    const normalizedPoint = (event) => {
        const rect = canvas.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
        };
    };
    canvas.addEventListener("pointerdown", (event) => {
        canvas.setPointerCapture?.(event.pointerId);
        const point = normalizedPoint(event);
        saveState(true);
        if (state.mode === "box") {
            state.draggingBox = { ...point, w: 0, h: 0, startX: point.x, startY: point.y };
        } else {
            state.data[state.mode].push(point);
            saveState(false);
            draw();
        }
    }, { signal });
    canvas.addEventListener("pointermove", (event) => {
        if (!state.draggingBox) return;
        const point = normalizedPoint(event);
        const startX = state.draggingBox.startX;
        const startY = state.draggingBox.startY;
        state.draggingBox.x = Math.min(startX, point.x);
        state.draggingBox.y = Math.min(startY, point.y);
        state.draggingBox.w = Math.abs(point.x - startX);
        state.draggingBox.h = Math.abs(point.y - startY);
        draw();
    }, { signal });
    canvas.addEventListener("pointerup", () => {
        if (!state.draggingBox) return;
        const { x, y, w, h } = state.draggingBox;
        if (w > 0.005 && h > 0.005) state.data.boxes.push({ x, y, w, h });
        state.draggingBox = null;
        saveState(false);
        draw();
    }, { signal });
    slider.addEventListener("input", () => {
        state.data.frame_index = Number(slider.value) || 0;
        updateFrame(true);
    }, { signal });
    image.addEventListener("load", resizeCanvas, { signal });

    addSizedDOMWidget(node, "wosai_points_ui", "wosai_points", root, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: getWidgetHeight,
        getMaxHeight: getWidgetHeight,
        getHeight: getWidgetHeight,
    });
    const hiddenWidgets = { annotation_json: stateWidget };
    if (previewScaleWidget) hiddenWidgets.preview_scale = previewScaleWidget;
    const unmountHidden = mountNode2HiddenWidgets(node, root, hiddenWidgets);
    node.__wosaiPointsRoot = root;
    node.__wosaiPointsSetPreviews = (items, normalizeSize = false) => {
        state.previews = Array.isArray(items) ? items : [];
        state.normalizeSizeOnLoad ||= normalizeSize;
        updateFrame();
    };
    node.__wosaiPointsSync = () => {
        state.data = parseState(stateWidget.value);
        draw();
    };
    node.__wosaiPointsRefreshText = () => {
        positive.textContent = t("nodes.pointsEditor.positive", "Positive");
        negative.textContent = t("nodes.pointsEditor.negative", "Negative");
        box.textContent = t("nodes.pointsEditor.box", "Box");
        undo.textContent = t("nodes.pointsEditor.undo", "Undo");
        clear.textContent = t("nodes.pointsEditor.clear", "Clear");
        empty.textContent = t("nodes.pointsEditor.empty", "Execute the node to load a preview");
    };
    updateFrame();
    ensureNodeMinSize(
        node,
        getWOSAIVarNum("--ws-media-node-min-width", 420),
        getWOSAIVarNum("--ws-points-node-min-height", 320),
    );
    compactNodeToContent(
        node,
        getWOSAIVarNum("--ws-media-node-min-width", 420),
        getWOSAIVarNum("--ws-points-node-min-height", 320),
    );
    cleanups.set(node, () => {
        unmountHidden();
        controller.abort();
        root.remove();
        delete node.__wosaiPointsRoot;
        delete node.__wosaiPointsSetPreviews;
        delete node.__wosaiPointsSync;
        delete node.__wosaiPointsRefreshText;
    });
}

function createImageCompare(node) {
    if (node.__wosaiCompareRoot) return;
    const controller = new AbortController();
    const { signal } = controller;
    const root = document.createElement("div");
    root.className = "wosai-image-compare";
    const stage = document.createElement("div");
    stage.className = "wosai-image-compare-stage";
    const first = document.createElement("img");
    first.draggable = false;
    const secondWrap = document.createElement("div");
    secondWrap.className = "wosai-image-compare-top";
    const second = document.createElement("img");
    second.draggable = false;
    // 双拼视图的面板分隔缝：滑动视图不需要（那里由分割线承担）
    const divider = document.createElement("div");
    divider.className = "wosai-image-compare-divider";
    divider.setAttribute("aria-hidden", "true");
    const line = document.createElement("div");
    line.className = "wosai-image-compare-line";
    // 分割线悬停热区：把 2px 细线的可命中范围加宽，便于抓住分割线拖动
    const grab = document.createElement("div");
    grab.className = "wosai-image-compare-grab";
    grab.setAttribute("aria-hidden", "true");
    // 十字准心手柄：默认隐藏，悬停分割线或拖动时淡入
    const handle = document.createElement("div");
    handle.className = "wosai-image-compare-handle";
    handle.setAttribute("aria-hidden", "true");
    handle.innerHTML = [
        '<svg viewBox="0 0 24 24" focusable="false">',
        '<circle cx="12" cy="12" r="6.4"/>',
        '<path d="M12 1.6v3.8M12 18.6v3.8M1.6 12h3.8M18.6 12h3.8"/>',
        '<circle class="wosai-image-compare-handle-dot" cx="12" cy="12" r="1.5"/>',
        "</svg>",
    ].join("");
    const empty = document.createElement("div");
    empty.className = "wosai-media-empty";
    empty.textContent = t("nodes.imageCompare.empty", "Connect two images and execute");
    secondWrap.append(second);
    // 底部工具栏：视图切换 + 交换按钮合并为一行，交换按钮在最右侧。
    // 仍是浮层（绝对定位），不进入 getWidgetHeight() 的高度计算。
    const bottomBar = document.createElement("div");
    bottomBar.className = "wosai-image-compare-bottom";
    const viewBar = document.createElement("div");
    viewBar.className = "wosai-image-compare-views";
    const viewButtons = new Map();
    for (const mode of COMPARE_VIEW_MODES) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "wosai-image-compare-view";
        button.dataset.view = mode;
        button.innerHTML = [
            '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">',
            VIEW_ICONS[mode],
            "</svg>",
        ].join("");
        viewButtons.set(mode, button);
        viewBar.append(button);
    }
    // 图像区按顺序挂：图层 → 面板分隔缝 → 分割线交互层 → 底部工具栏
    // → 隐藏的原生滑块
    stage.append(first, secondWrap, divider, line, grab, handle);
    // 原生滑块不再单独占一行（视觉隐藏，1px）：只承担键盘操作与无障碍语义，
    // 分割位置完全由图像区内的拖拽 / 十字准心手柄控制
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "wosai-image-compare-range";
    slider.min = "0";
    slider.max = "100";
    slider.value = "50";
    slider.setAttribute("aria-label", t("nodes.imageCompare.position", "Comparison position"));
    const swap = document.createElement("button");
    swap.type = "button";
    swap.className = "wosai-image-compare-swap";
    swap.innerHTML = [
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">',
        '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/>',
        '<path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
        "</svg>",
    ].join("");
    bottomBar.append(viewBar, swap);
    stage.append(bottomBar, slider, empty);
    root.append(stage);

    // ── 闲置自动淡出 ──────────────────────────────────────────────
    // 底部工具栏（视图切换 + 交换按钮）压在图片下边缘居中，常驻会打断观看。
    // 这里让它在「指针离开」或「在图内静止」后整体隐去，回到纯净画面；任何操作
    // 意图都会立刻唤回。契约：只切 stage 上的类名，完全不碰高度——getWidgetHeight()
    // 与既有的高度断言不受影响，控件的新增 / 删除也不会改变节点尺寸。
    const IDLE_STILL_DELAY = 1800;  // 图内无动作多久算闲置
    const IDLE_LEAVE_DELAY = 400;   // 离开 / 解锁后多久收起（容错掠过节点）
    const IDLE_REVEAL_HOLD = 1500;  // 动作触发后的强制可见期
    const IDLE_MOVE_THROTTLE = 200; // pointermove 节流窗口
    let idleTimer = 0;
    let holdUntil = 0;              // 强制可见期的截止时间戳
    let idleLocked = false;         // 指针停在控件上 / 拖拽分割线期间不收起
    let lastRevealStamp = 0;

    const cancelIdle = () => {
        if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = 0;
        }
        stage.classList.remove("is-idle");
    };
    // 排闲置时把延迟推到强制可见期之后：否则「点完视图按钮 → 指针移开控件」
    // 这条路径会用 400ms 的离开延迟把刚触发的 1.5s 强制可见期直接吞掉
    const scheduleIdle = (delay) => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            idleTimer = 0;
            if (!idleLocked) stage.classList.add("is-idle");
        }, Math.max(delay, holdUntil - Date.now()));
    };
    /** 唤回控件；hold > 0 时开启强制可见期（用于刚刚发生的动作）。 */
    const revealControls = (hold = 0) => {
        if (hold > 0) holdUntil = Date.now() + hold;
        cancelIdle();
        scheduleIdle(IDLE_STILL_DELAY);
    };
    /** 锁定 / 解锁闲置：悬停在控件上或拖拽期间收起会把按钮从指针下抽走。 */
    const lockIdle = (locked) => {
        idleLocked = locked;
        if (locked) cancelIdle();
        else scheduleIdle(IDLE_LEAVE_DELAY);
    };
    stage.addEventListener("pointerenter", () => revealControls(), { signal });
    // 闲置期控件是 pointer-events:none，指针移进它原来的矩形不会补发 pointerenter，
    // 会陷入「唤回 → 1.8s 后又被收起 → 按钮点不到」的循环（重复点同一个视图按钮、
    // 指针几乎不动时最容易踩到）。唤回是同步移掉 is-idle 的，所以这里 elementFromPoint
    // 拿到的是恢复命中后的结果，可以据此补一次锁定。
    const isOverControl = (x, y) => {
        const el = document.elementFromPoint(x, y);
        return Boolean(el && bottomBar.contains(el));
    };
    stage.addEventListener("pointermove", (event) => {
        if (idleLocked) return;
        // pointermove 可达 60Hz，不节流会持续重建定时器
        if (event.timeStamp - lastRevealStamp < IDLE_MOVE_THROTTLE) return;
        lastRevealStamp = event.timeStamp;
        revealControls();
        if (isOverControl(event.clientX, event.clientY)) lockIdle(true);
    }, { signal });
    stage.addEventListener("pointerleave", () => {
        if (!idleLocked) scheduleIdle(IDLE_LEAVE_DELAY);
    }, { signal });
    // 指针停在控件上时收起会同时抽掉命中区（idle 会关 pointer-events），必须先锁住
    bottomBar.addEventListener("pointerenter", () => lockIdle(true), { signal });
    bottomBar.addEventListener("pointerleave", () => lockIdle(false), { signal });

    node.properties ??= {};
    let payload = { a: null, b: null };
    let swapped = Boolean(node.properties.wosai_compare_swapped);
    const state = {
        aspectRatio: 16 / 9,
        normalizeSizeOnLoad: false,
        // 视图模式即实际布局：三种模式各自对应一套 CSS 切分，不存在「运行时解析」
        viewMode: normalizeViewMode(node.properties.wosai_compare_view),
    };

    const applyLayout = () => {
        // 视图类名挂在 stage 上（与 is-dragging / is-swapping / is-switching 一致），
        // CSS 里的面板切分、分隔缝全部以 .wosai-image-compare-stage.is-view-* 选择
        stage.classList.toggle("is-view-slide", state.viewMode === "slide");
        stage.classList.toggle("is-view-side", state.viewMode === "side");
        stage.classList.toggle("is-view-stack", state.viewMode === "stack");
        for (const [mode, button] of viewButtons) {
            const active = mode === state.viewMode;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        }
        // 只有滑动视图存在分割线；其余视图把隐藏滑块移出 tab 序列，避免键盘
        // 焦点落到一个已失效、而且看不见的控件上
        const splittable = state.viewMode === COMPARE_VIEW_DEFAULT;
        slider.disabled = !splittable;
        slider.tabIndex = splittable ? 0 : -1;
    };

    const applyStageRatio = () => {
        // 双拼视图下舞台比例随视图变化（半幅还原原图比例），滑动视图保持原图比例
        stage.style.setProperty(
            "--wosai-compare-ratio",
            `${stageAspectRatio(state.viewMode, state.aspectRatio)} / 1`,
        );
    };

    // 把节点尺寸重算到「当前视图 + 当前比例」所需的大小。
    // node.size 是持久化值，ComfyUI 不会因为 DOM widget 的高度契约变了就自动
    // 调整节点：切换视图改变的是舞台宽高比（左右 ×2 → 变矮、上下 ÷2 → 变高），
    // 不重算就会出现「图像区被压扁」或「节点下方留一大块空白」。
    // 宽度沿用节点当前宽度（用户拖出来的宽度是有意的），只重算高度。
    // clampMinHeight：只有「首次载入」才夹到 --ws-compare-node-min-height。
    // 切换视图时不夹——左右并排的舞台本来就矮，夹到初始最小高度会在图像区
    // 下方留出一块空白，看起来就像「没跟着模式调整」。
    const fitNodeToStage = ({ clampMinHeight = false } = {}) => {
        const nodeMinWidth = getWOSAIVarNum("--ws-media-node-min-width", 420);
        // 左右并排时每半幅只占节点宽的一半：沿用滑动视图的宽度会把两张图都
        // 挤成缩略图，故该模式下把最小宽度抬到「两幅最小预览宽」
        const minWidth = state.viewMode === "side"
            ? Math.max(
                nodeMinWidth,
                getWOSAIVarNum("--ws-media-preview-min-width", 240) * 2,
            )
            : nodeMinWidth;
        const targetWidth = Math.max(minWidth, Number(node.size?.[0]) || 0);
        // 宽度变了必须先落下去：DOM widget 的高度契约读的是 stage 实测宽度，
        // 同一帧里取到的还是旧宽度，据此算出的高度会差一截。故分两步。
        if (targetWidth !== Number(node.size?.[0])) {
            node.setSize?.([targetWidth, Number(node.size?.[1]) || 0]);
        }
        const applyHeight = () => {
            // 节点可能在这一帧之间被删除，回调里必须再确认一次
            if (!root.isConnected) return;
            const computed = node.computeSize?.();
            // 算不出内容高度时保持原高度，绝不把节点压成 0
            const next = Number(computed?.[1]) || Number(node.size?.[1]) || 0;
            const minHeight = clampMinHeight
                ? getWOSAIVarNum("--ws-compare-node-min-height", 280)
                : 0;
            node.setSize?.([targetWidth, Math.max(minHeight, next)]);
            node.setDirtyCanvas?.(true, true);
        };
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(applyHeight);
        else applyHeight();
    };

    const commitLayout = (ratio) => {
        const numeric = Number(ratio);
        const next = Number.isFinite(numeric) && numeric > 0 ? numeric : state.aspectRatio;
        const changed = Math.abs(state.aspectRatio - next) > 0.001;
        state.aspectRatio = next;
        applyLayout();
        applyStageRatio();
        if (state.normalizeSizeOnLoad) {
            state.normalizeSizeOnLoad = false;
            fitNodeToStage({ clampMinHeight: true });
        } else if (changed) {
            markChanged(node);
        }
    };

    const updateAspectRatio = () => {
        const baseRatio = first.naturalWidth && first.naturalHeight
            ? first.naturalWidth / first.naturalHeight
            : 0;
        const topRatio = second.naturalWidth && second.naturalHeight
            ? second.naturalWidth / second.naturalHeight
            : 0;
        commitLayout(baseRatio || topRatio || state.aspectRatio);
    };

    const updateSplit = () => {
        const value = normalizeSplitPercent(slider.value);
        // 上层从分割线起向右侧裁剪出来，底层铺满、留在左侧：
        // 分割线越靠左 → 上层（A）露出越多，画面偏 A；越靠右 → 底层（B）露出越多，
        // 画面偏 B。拖动方向与画面呈现的图一致（拖到左端整张 A、右端整张 B）。
        // 双拼视图不裁剪图层：底层直接占左/上半幅，分割位置只对滑动视图有意义
        secondWrap.style.clipPath = state.viewMode === COMPARE_VIEW_DEFAULT
            ? `inset(0 0 0 ${value}%)`
            : "none";
        line.style.left = `${value}%`;
        // 写在 root 上：分割线、拖拽热区、十字手柄读同一个百分比，保证严格共线
        root.style.setProperty("--wosai-compare-split", `${value}%`);
    };
    const renderImages = () => {
        const display = compareDisplayPair(payload, swapped);
        // 底层铺满 ⇒ 它占据分割线左侧；上层只保留分割线右侧。要让「拖到左端是 A、
        // 拖到右端是 B」，底层必须放 B、上层放 A（与字面直觉相反，勿照字面调换）
        const firstUrl = imageUrl(display.b);
        const secondUrl = imageUrl(display.a);
        if (firstUrl) first.src = firstUrl;
        else first.removeAttribute("src");
        if (secondUrl) second.src = secondUrl;
        else second.removeAttribute("src");
        root.classList.toggle("has-first", Boolean(display.b));
        root.classList.toggle("has-second", Boolean(display.a));
        swap.disabled = !(payload.a && payload.b);
        swap.classList.toggle("is-active", swapped);
        swap.setAttribute("aria-pressed", String(swapped));
        const complete = Boolean(payload.a && payload.b);
        empty.hidden = complete;
        empty.textContent = payload.a || payload.b
            ? t("nodes.imageCompare.incomplete", "Execute with both images connected")
            : t("nodes.imageCompare.empty", "Connect two images and execute");
        // 载荷尺寸可以先于图片解码给出宽高比，避免首帧先按 16:9 兜底再跳一次
        const sourceRatio = mediaSourceRatio(display.a) || mediaSourceRatio(display.b);
        if (sourceRatio > 0) commitLayout(sourceRatio);
        // 换图是「刚发生的动作」：控件先露出来，让新图的尺寸与当前视图状态可见
        revealControls(IDLE_REVEAL_HOLD);
    };
    slider.addEventListener("input", updateSplit, { signal });
    // 交换按钮与视图按钮都浮在图像区上，需拦住 pointerdown，
    // 否则会被 stage 当成分割线拖拽的起点
    swap.addEventListener("pointerdown", (event) => event.stopPropagation(), { signal });
    swap.addEventListener("click", () => {
        if (swap.disabled) return;
        stage.classList.add("is-swapping");
        swapped = !swapped;
        node.properties.wosai_compare_swapped = swapped;
        renderImages();
        requestAnimationFrame(() => stage.classList.remove("is-swapping"));
        markChanged(node);
    }, { signal });
    const setView = (mode) => {
        const next = normalizeViewMode(mode);
        if (next === state.viewMode) return;
        state.viewMode = next;
        node.properties.wosai_compare_view = next;
        stage.classList.add("is-switching");
        commitLayout(state.aspectRatio);
        updateSplit();
        // 视图换了 ⇒ 舞台宽高比换了 ⇒ 节点高度必须跟着重算，否则节点尺寸
        // 还停在上一个视图的大小上（左右视图会留出空白、上下视图会被压扁）
        fitNodeToStage();
        markChanged(node);
        // 键盘触发时指针不在控件上，这里补上强制可见期，保证切换结果可被确认
        revealControls(IDLE_REVEAL_HOLD);
        requestAnimationFrame(() => stage.classList.remove("is-switching"));
    };
    for (const [mode, button] of viewButtons) {
        button.addEventListener("pointerdown", (event) => event.stopPropagation(), { signal });
        button.addEventListener("click", () => setView(mode), { signal });
    }
    first.addEventListener("load", updateAspectRatio, { signal });
    second.addEventListener("load", updateAspectRatio, { signal });
    const setSplitFromPointer = (event) => {
        const rect = stage.getBoundingClientRect();
        const value = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
        slider.value = String(value);
        updateSplit();
    };
    // 分割拖拽只在滑动视图生效：双拼视图没有分割线，任意拖动都会变成「误触滑块」
    const isSplittable = () => state.viewMode === COMPARE_VIEW_DEFAULT;
    stage.addEventListener("pointerdown", (event) => {
        if (!isSplittable()) return;
        // 拖拽期间锁住闲置：分辨率低时拖到一半控件消失会让人以为操作中断了
        lockIdle(true);
        stage.setPointerCapture?.(event.pointerId);
        stage.classList.add("is-dragging");
        event.preventDefault();
        setSplitFromPointer(event);
    }, { signal });
    stage.addEventListener("pointermove", (event) => {
        if (!isSplittable()) return;
        if (event.buttons) setSplitFromPointer(event);
    }, { signal });
    const endSplitDrag = () => {
        stage.classList.remove("is-dragging");
        lockIdle(false);
    };
    stage.addEventListener("pointerup", endSplitDrag, { signal });
    stage.addEventListener("pointercancel", endSplitDrag, { signal });
    stage.addEventListener("lostpointercapture", endSplitDrag, { signal });
    updateSplit();

    const getWidgetHeight = () => {
        const gap = getWOSAIVarNum("--ws-gap-sm", 6);
        // 控件高度 = 上下内边距 + 图像区高度；图像区高度严格等于 宽度 / 舞台宽高比，
        // 所以宽度优先取舞台实测值（首帧未挂载时按节点宽度扣除左右内边距估算）
        // 这里必须与 CSS 的 padding-inline 完全同源（max(gap-sm, 手柄半径)），
        // 否则首帧的估算宽度与实测宽度对不上，高度契约会差出几像素
        const padInline = Math.max(
            gap,
            getWOSAIVarNum("--ws-compare-handle-size", 28) / 2,
        );
        const contentWidth = Math.max(
            getWOSAIVarNum("--ws-media-preview-min-width", 240),
            stage.clientWidth || (Number(node.size?.[0]) || 420) - padInline * 2,
        );
        const ratio = stageAspectRatio(state.viewMode, state.aspectRatio);
        return contentWidth / Math.max(0.1, ratio) + gap * 2;
    };
    addSizedDOMWidget(node, "wosai_compare_ui", "wosai_compare", root, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: getWidgetHeight,
        getMaxHeight: getWidgetHeight,
        getHeight: getWidgetHeight,
    });
    node.__wosaiCompareRoot = root;
    node.__wosaiCompareSetImages = (nextPayload, normalizeSize = false) => {
        payload = {
            a: nextPayload?.a ?? null,
            b: nextPayload?.b ?? null,
        };
        state.normalizeSizeOnLoad ||= normalizeSize;
        renderImages();
    };
    node.__wosaiCompareSyncState = () => {
        swapped = Boolean(node.properties?.wosai_compare_swapped);
        state.viewMode = normalizeViewMode(node.properties?.wosai_compare_view);
        commitLayout(state.aspectRatio);
        updateSplit();
        renderImages();
    };
    const refreshViewText = () => {
        viewBar.setAttribute("aria-label", t("nodes.imageCompare.views", "Comparison view"));
        for (const [mode, button] of viewButtons) {
            const text = viewText(mode);
            button.title = text;
            button.setAttribute("aria-label", text);
        }
    };
    node.__wosaiCompareRefreshText = () => {
        slider.setAttribute("aria-label", t(
            "nodes.imageCompare.position",
            "Comparison position",
        ));
        const swapText = t("nodes.imageCompare.swap", "Swap A/B");
        swap.title = swapText;
        swap.setAttribute("aria-label", swapText);
        refreshViewText();
        if (!empty.hidden) {
            empty.textContent = root.classList.contains("has-first") || root.classList.contains("has-second")
                ? t("nodes.imageCompare.incomplete", "Execute with both images connected")
                : t("nodes.imageCompare.empty", "Connect two images and execute");
        }
    };
    node.__wosaiCompareRefreshText();
    applyLayout();
    applyStageRatio();
    renderImages();
    ensureNodeMinSize(
        node,
        getWOSAIVarNum("--ws-media-node-min-width", 420),
        getWOSAIVarNum("--ws-compare-node-min-height", 280),
    );
    compactNodeToContent(
        node,
        getWOSAIVarNum("--ws-media-node-min-width", 420),
        getWOSAIVarNum("--ws-compare-node-min-height", 280),
    );
    cleanups.set(node, () => {
        controller.abort();
        // 定时器不受 AbortController 管辖，节点销毁时必须手动清：
        // 订阅闭包持有 stage / root，不清会阻止整棵子树被回收
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = 0;
        root.remove();
        delete node.__wosaiCompareRoot;
        delete node.__wosaiCompareSetImages;
        delete node.__wosaiCompareSyncState;
        delete node.__wosaiCompareRefreshText;
    });
}

function patchNodeType(nodeType, nodeData) {
    if (nodeType.prototype[PATCH_KEY]) return;
    const originalCreated = nodeType.prototype.onNodeCreated;
    const originalConfigure = nodeType.prototype.onConfigure;
    const originalExecuted = nodeType.prototype.onExecuted;
    const originalRemoved = nodeType.prototype.onRemoved;
    const attach = function () {
        queueMicrotask(() => {
            if (nodeData.name === POINTS_TYPE) createPointsEditor(this);
            if (nodeData.name === COMPARE_TYPE) createImageCompare(this);
            applyNodeInstanceTranslation(this);
        });
    };
    const created = function () {
        const result = originalCreated?.apply(this, arguments);
        attach.call(this);
        return result;
    };
    const configured = function () {
        const result = originalConfigure?.apply(this, arguments);
        attach.call(this);
        if (nodeData.name === POINTS_TYPE) {
            queueMicrotask(() => this.__wosaiPointsSync?.());
        }
        if (nodeData.name === COMPARE_TYPE) {
            queueMicrotask(() => this.__wosaiCompareSyncState?.());
        }
        return result;
    };
    const executed = function (message) {
        if (nodeData.name === POINTS_TYPE) {
            const hadNativePreview = clearNativeImagePreview(this);
            const { previews, forwardedMessage } = pointsExecutionPayload(message);
            const result = originalExecuted?.call(this, forwardedMessage);
            clearNativeImagePreview(this);
            this.__wosaiPointsSetPreviews?.(previews, hadNativePreview);
            return result;
        }
        const result = originalExecuted?.apply(this, arguments);
        if (nodeData.name === COMPARE_TYPE) this.__wosaiCompareSetImages?.(message?.wosai_compare?.[0], true);
        return result;
    };
    const removed = function () {
        cleanups.get(this)?.();
        cleanups.delete(this);
        return originalRemoved?.apply(this, arguments);
    };
    nodeType.prototype.onNodeCreated = created;
    nodeType.prototype.onConfigure = configured;
    nodeType.prototype.onExecuted = executed;
    nodeType.prototype.onRemoved = removed;
    nodeType.prototype[PATCH_KEY] = {
        originalCreated, originalConfigure, originalExecuted, originalRemoved,
        created, configured, executed, removed,
    };
    patchedNodeTypes.add(nodeType);
}

app.registerExtension({
    name: "wosai.MediaTools",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== POINTS_TYPE && nodeData.name !== COMPARE_TYPE) return;
        ensureWosaiStyles(MEDIA_STYLES);
        applyNodeDefTranslation(nodeData);
        patchNodeType(nodeType, nodeData);
    },
    setup() {
        ensureWosaiStyles(MEDIA_STYLES);
        offLanguage ??= onLangChange(() => {
            app.graph?._nodes?.forEach((node) => {
                node.__wosaiPointsRefreshText?.();
                node.__wosaiCompareRefreshText?.();
            });
        });
    },
    remove() {
        offLanguage?.();
        offLanguage = null;
        app.graph?._nodes?.forEach((node) => {
            cleanups.get(node)?.();
            cleanups.delete(node);
        });
        for (const nodeType of patchedNodeTypes) {
            const proto = nodeType.prototype;
            const patch = proto[PATCH_KEY];
            if (!patch) continue;
            if (proto.onNodeCreated === patch.created) proto.onNodeCreated = patch.originalCreated;
            if (proto.onConfigure === patch.configured) proto.onConfigure = patch.originalConfigure;
            if (proto.onExecuted === patch.executed) proto.onExecuted = patch.originalExecuted;
            if (proto.onRemoved === patch.removed) proto.onRemoved = patch.originalRemoved;
            delete proto[PATCH_KEY];
        }
        patchedNodeTypes.clear();
    },
});
