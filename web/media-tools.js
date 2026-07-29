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
import { compareDisplayPair, normalizeSplitPercent } from "./shared/media-preview.js";
import { getWOSAIVarNum } from "./shared/shared-utils.js";

const PATCH_KEY = "__wosaiMediaToolsPatch";
const POINTS_TYPE = "WOSAI_PointsEditor";
const COMPARE_TYPE = "WOSAI_ImageCompare";
const cleanups = new WeakMap();
const patchedNodeTypes = new Set();
let offLanguage = null;
const MEDIA_STYLES = [
    ["wosai-media-tools-style", new URL("./styles/media-tools.css?v=4", import.meta.url).href],
];

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
    const secondWrap = document.createElement("div");
    secondWrap.className = "wosai-image-compare-top";
    const second = document.createElement("img");
    const line = document.createElement("div");
    line.className = "wosai-image-compare-line";
    const empty = document.createElement("div");
    empty.className = "wosai-media-empty";
    empty.textContent = t("nodes.imageCompare.empty", "Connect two images and execute");
    secondWrap.append(second);
    stage.append(first, secondWrap, line, empty);
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "wosai-media-range";
    slider.min = "0";
    slider.max = "100";
    slider.value = "50";
    slider.setAttribute("aria-label", t("nodes.imageCompare.position", "Comparison position"));
    slider.classList.add("wosai-image-compare-range");
    const controls = document.createElement("div");
    controls.className = "wosai-image-compare-controls";
    const startLabel = document.createElement("span");
    startLabel.className = "wosai-image-compare-label";
    const endLabel = document.createElement("span");
    endLabel.className = "wosai-image-compare-label";
    const swap = document.createElement("button");
    swap.type = "button";
    swap.className = "wosai-image-compare-swap";
    swap.innerHTML = [
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">',
        '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/>',
        '<path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
        "</svg>",
    ].join("");
    controls.append(startLabel, slider, endLabel, swap);
    root.append(stage, controls);

    node.properties ??= {};
    let payload = { a: null, b: null };
    let swapped = Boolean(node.properties.wosai_compare_swapped);

    const updateSplit = () => {
        const value = normalizeSplitPercent(slider.value);
        secondWrap.style.clipPath = `inset(0 ${100 - value}% 0 0)`;
        line.style.left = `${value}%`;
    };
    const renderImages = () => {
        const display = compareDisplayPair(payload, swapped);
        const firstUrl = imageUrl(display.a);
        const secondUrl = imageUrl(display.b);
        if (firstUrl) first.src = firstUrl;
        else first.removeAttribute("src");
        if (secondUrl) second.src = secondUrl;
        else second.removeAttribute("src");
        root.classList.toggle("has-first", Boolean(display.a));
        root.classList.toggle("has-second", Boolean(display.b));
        root.classList.toggle("is-swapped", swapped);
        startLabel.textContent = swapped ? "B" : "A";
        endLabel.textContent = swapped ? "A" : "B";
        swap.disabled = !(payload.a && payload.b);
        swap.classList.toggle("is-active", swapped);
        swap.setAttribute("aria-pressed", String(swapped));
        const complete = Boolean(payload.a && payload.b);
        empty.hidden = complete;
        empty.textContent = payload.a || payload.b
            ? t("nodes.imageCompare.incomplete", "Execute with both images connected")
            : t("nodes.imageCompare.empty", "Connect two images and execute");
    };
    slider.addEventListener("input", updateSplit, { signal });
    swap.addEventListener("click", () => {
        if (swap.disabled) return;
        stage.classList.add("is-swapping");
        swapped = !swapped;
        node.properties.wosai_compare_swapped = swapped;
        renderImages();
        requestAnimationFrame(() => stage.classList.remove("is-swapping"));
        markChanged(node);
    }, { signal });
    const setSplitFromPointer = (event) => {
        const rect = stage.getBoundingClientRect();
        const value = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
        slider.value = String(value);
        updateSplit();
    };
    stage.addEventListener("pointerdown", (event) => {
        stage.setPointerCapture?.(event.pointerId);
        setSplitFromPointer(event);
    }, { signal });
    stage.addEventListener("pointermove", (event) => {
        if (event.buttons) setSplitFromPointer(event);
    }, { signal });
    updateSplit();

    const getWidgetHeight = () => (
        getWOSAIVarNum("--ws-media-preview-min-height", 260)
        + getWOSAIVarNum("--ws-media-slider-row-height", 34)
        + getWOSAIVarNum("--ws-gap-sm", 8) * 3
    );
    addSizedDOMWidget(node, "wosai_compare_ui", "wosai_compare", root, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: getWidgetHeight,
        getMaxHeight: getWidgetHeight,
        getHeight: getWidgetHeight,
    });
    node.__wosaiCompareRoot = root;
    node.__wosaiCompareSetImages = (nextPayload) => {
        payload = {
            a: nextPayload?.a ?? null,
            b: nextPayload?.b ?? null,
        };
        renderImages();
    };
    node.__wosaiCompareSyncState = () => {
        swapped = Boolean(node.properties?.wosai_compare_swapped);
        renderImages();
    };
    node.__wosaiCompareRefreshText = () => {
        slider.setAttribute("aria-label", t(
            "nodes.imageCompare.position",
            "Comparison position",
        ));
        const swapText = t("nodes.imageCompare.swap", "Swap A/B");
        swap.title = swapText;
        swap.setAttribute("aria-label", swapText);
        if (!empty.hidden) {
            empty.textContent = root.classList.contains("has-first") || root.classList.contains("has-second")
                ? t("nodes.imageCompare.incomplete", "Execute with both images connected")
                : t("nodes.imageCompare.empty", "Connect two images and execute");
        }
    };
    node.__wosaiCompareRefreshText();
    renderImages();
    ensureNodeMinSize(
        node,
        getWOSAIVarNum("--ws-media-node-min-width", 420),
        getWOSAIVarNum("--ws-compare-node-min-height", 320),
    );
    compactNodeToContent(
        node,
        getWOSAIVarNum("--ws-media-node-min-width", 420),
        getWOSAIVarNum("--ws-compare-node-min-height", 320),
    );
    cleanups.set(node, () => {
        controller.abort();
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
        if (nodeData.name === COMPARE_TYPE) this.__wosaiCompareSetImages?.(message?.wosai_compare?.[0]);
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
