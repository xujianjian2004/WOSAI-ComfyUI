import { app } from "../../scripts/app.js";
import { ensureWosaiStyles } from "./shared/dom-widget.js";
import { applyNodeDefTranslation, applyNodeInstanceTranslation, getCurrentLang, t } from "./shared/i18n.js";
import {
    normalizePillPointerX,
    resolvePillHitAction,
} from "./shared/pill-hit-test.js";

ensureWosaiStyles();

async function loadColorData() {
    const response = await fetch(new URL("./data/common-colors.json", import.meta.url));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.colors) || data.colors.length === 0) {
        throw new Error("common-colors.json has no colors");
    }
    return data;
}

const COLOR_DATA = await loadColorData();
const NODE_TYPE = "WOSAI_CommonColor";
const PATCH_KEY = "__wosaiCommonColorPatch";
const PREVIEW_WIDGET_TYPE = "WOSAI_COLOR_PREVIEW";
const PRESET_WIDGET_TYPE = "WOSAI_COLOR_PRESET";
const DEFAULT_COLOR = COLOR_DATA.default_custom_color;
const CUSTOM_COLOR_OPTION = COLOR_DATA.custom.zh;
const PILL_HEIGHT = 22;
const CONTROL_HEIGHT = 30;
const PILL_TOP_OFFSET = 5;
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

const PRESET_COLORS = Object.freeze(Object.fromEntries(
    COLOR_DATA.colors.map((item) => [item.name, item.hex]),
));
const PRESET_OPTIONS = Object.freeze([CUSTOM_COLOR_OPTION, ...Object.keys(PRESET_COLORS)]);
const PRESET_NAMES_EN = Object.freeze({
    [CUSTOM_COLOR_OPTION]: COLOR_DATA.custom.en,
    ...Object.fromEntries(COLOR_DATA.colors.map((item) => [item.name, item.en])),
});

const widgetCallbacks = new WeakMap();
const patches = new Map();
let activePresetMenu = null;
let activeColorPicker = null;

function cssToken(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}

function contrastTextColor(color) {
    if (!HEX_COLOR_PATTERN.test(color)) return cssToken("--ws-text", "CanvasText");
    const red = Number.parseInt(color.slice(1, 3), 16);
    const green = Number.parseInt(color.slice(3, 5), 16);
    const blue = Number.parseInt(color.slice(5, 7), 16);
    const token = (red * 0.299 + green * 0.587 + blue * 0.114) > 150
        ? "--ws-cc-text-on-light"
        : "--ws-cc-text-on-dark";
    return cssToken(token, "CanvasText");
}

function localizedColorName(name) {
    const colorName = PRESET_OPTIONS.includes(name) ? name : CUSTOM_COLOR_OPTION;
    return getCurrentLang() === "en" ? PRESET_NAMES_EN[colorName] || colorName : colorName;
}

function roundedRect(ctx, x, y, width, height, radius) {
    const corner = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + corner, y);
    ctx.arcTo(x + width, y, x + width, y + height, corner);
    ctx.arcTo(x + width, y + height, x, y + height, corner);
    ctx.arcTo(x, y + height, x, y, corner);
    ctx.arcTo(x, y, x + width, y, corner);
    ctx.closePath();
}

function drawTriangle(ctx, centerX, centerY, size, direction, color) {
    const half = size / 2;
    ctx.beginPath();
    if (direction === "left") {
        ctx.moveTo(centerX - half, centerY);
        ctx.lineTo(centerX + half, centerY - half);
        ctx.lineTo(centerX + half, centerY + half);
    } else {
        ctx.moveTo(centerX + half, centerY);
        ctx.lineTo(centerX - half, centerY - half);
        ctx.lineTo(centerX - half, centerY + half);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
}

function closeColorPicker() {
    activeColorPicker?.remove();
    activeColorPicker = null;
}

function colorPickerPosition(event, position, node) {
    const scale = app.canvas?.ds?.scale || 1;
    const localX = Number(position?.[0]) || 0;
    const localY = Number(position?.[1]) || 0;
    const nodeLeft = (event.clientX || 0) - localX * scale;
    const nodeTop = (event.clientY || 0) - localY * scale;
    const nodeWidth = (node.size?.[0] || 0) * scale;
    const nodeHeight = (node.size?.[1] || 0) * scale;
    const pickerSize = 1;
    const preferredLeft = nodeLeft + nodeWidth + 12;
    const left = preferredLeft + pickerSize <= window.innerWidth
        ? preferredLeft
        : nodeLeft - pickerSize - 12;
    return {
        left: Math.max(8, Math.min(left, window.innerWidth - pickerSize - 8)),
        top: Math.max(8, Math.min(nodeTop + nodeHeight / 2, window.innerHeight - pickerSize - 8)),
    };
}

function openColorPicker(widget, node, event, position) {
    closeColorPicker();
    const { left, top } = colorPickerPosition(event, position, node);
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = HEX_COLOR_PATTERN.test(widget.value) ? widget.value : DEFAULT_COLOR;
    picker.className = "wosai-color-picker-trigger";
    picker.style.left = `${left}px`;
    picker.style.top = `${top}px`;
    const applyColor = (value) => {
        const color = String(value || "").trim().toUpperCase();
        if (!HEX_COLOR_PATTERN.test(color)) return;
        widget.value = color;
        widget.callback?.(color);
        const preset = findWidget(node, "color_name");
        if (preset && preset.value !== CUSTOM_COLOR_OPTION) selectPreset(preset, node, CUSTOM_COLOR_OPTION);
        markChanged(node);
    };
    picker.addEventListener("input", () => applyColor(picker.value));
    picker.addEventListener("change", () => {
        applyColor(picker.value);
        closeColorPicker();
    }, { once: true });
    picker.addEventListener("cancel", closeColorPicker, { once: true });
    document.body.append(picker);
    activeColorPicker = picker;
    try {
        if (typeof picker.showPicker === "function") picker.showPicker();
        else picker.click();
    } catch {
        picker.click();
    }
}

function closePresetMenu() {
    if (!activePresetMenu) return;
    clearTimeout(activePresetMenu.timer);
    document.removeEventListener("pointerdown", activePresetMenu.dismiss, true);
    activePresetMenu.menu.remove();
    activePresetMenu = null;
}

function selectPreset(widget, node, value) {
    widget.value = PRESET_OPTIONS.includes(value) ? value : CUSTOM_COLOR_OPTION;
    widget.callback?.(widget.value);
    syncPresetPreview(node);
    markChanged(node);
}

function stepPreset(widget, node, offset) {
    const current = PRESET_OPTIONS.indexOf(widget.value);
    const start = current < 0 ? 0 : current;
    const next = (start + offset + PRESET_OPTIONS.length) % PRESET_OPTIONS.length;
    selectPreset(widget, node, PRESET_OPTIONS[next]);
}

function openPresetMenu(widget, node, event) {
    closePresetMenu();
    const menu = document.createElement("div");
    menu.setAttribute("role", "listbox");
    menu.className = "wosai-color-preset-menu";
    const left = Math.min(Math.max(event.clientX || 8, 8), window.innerWidth - 228);
    const top = Math.min(Math.max((event.clientY || 8) + 6, 8), window.innerHeight - 328);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    for (const name of PRESET_OPTIONS) {
        const button = document.createElement("button");
        const swatch = PRESET_COLORS[name] || DEFAULT_COLOR;
        const selected = name === widget.value;
        const displayName = localizedColorName(name);
        button.type = "button";
        button.className = "wosai-color-preset-option";
        button.dataset.presetValue = name;
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", String(selected));
        const dot = document.createElement("span");
        dot.className = "wosai-color-preset-swatch";
        dot.style.backgroundColor = swatch;
        const text = document.createElement("span");
        text.textContent = name === CUSTOM_COLOR_OPTION
            ? displayName
            : `${displayName}  ${PRESET_COLORS[name]}`;
        button.setAttribute("aria-label", text.textContent);
        button.append(dot, text);
        button.addEventListener("click", () => {
            selectPreset(widget, node, name);
            closePresetMenu();
        });
        menu.append(button);
    }
    document.body.append(menu);
    const dismiss = (dismissEvent) => {
        if (!menu.contains(dismissEvent.target)) closePresetMenu();
    };
    const timer = setTimeout(() => document.addEventListener("pointerdown", dismiss, true), 0);
    activePresetMenu = { menu, dismiss, timer };
}

function drawColorPill(ctx, width, widgetY, color, label, value, showArrows = true) {
    const x = 15;
    const drawHeight = PILL_HEIGHT;
    const y = widgetY + PILL_TOP_OFFSET;
    const drawWidth = Math.max(0, width - x * 2);
    const textColor = contrastTextColor(color);
    const centerY = y + drawHeight / 2;
    const labelX = Math.round(x + 45);
    const valueX = Math.round(x + drawWidth - 45);
    // Canvas `middle` text positioning can land Chinese glyphs between device
    // pixels.  Use an integer alphabetic baseline for sharp text in both the
    // LiteGraph canvas and Nodes 2.0 custom-widget renderer.
    const textBaselineY = Math.round(centerY + 4);
    roundedRect(ctx, x, y, drawWidth, drawHeight, drawHeight / 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = cssToken("--ws-cc-border", "GrayText");
    ctx.lineWidth = 1;
    ctx.stroke();
    if (showArrows) {
        drawTriangle(ctx, x + 24, centerY, 12, "left", textColor);
        drawTriangle(ctx, x + drawWidth - 24, centerY, 12, "right", textColor);
    }
    ctx.fillStyle = textColor;
    ctx.font = `${cssToken("--ws-text-base", "medium")} ${cssToken("--ws-font-family", "sans-serif")}`;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillText(label, labelX, textBaselineY);
    ctx.textAlign = "right";
    ctx.fillText(value, valueX, textBaselineY);
}

function createColorPreviewWidget(inputName, inputData) {
    const initialValue = inputData?.[1]?.default;
    const widget = {
        name: inputName,
        type: PREVIEW_WIDGET_TYPE,
        options: { default: DEFAULT_COLOR },
        value: HEX_COLOR_PATTERN.test(initialValue) ? initialValue.toUpperCase() : DEFAULT_COLOR,
        draw(ctx, node, width, widgetY) {
            const color = HEX_COLOR_PATTERN.test(this.value) ? this.value : DEFAULT_COLOR;
            const selectedPreset = findWidget(node, "color_name")?.value;
            drawColorPill(ctx, width, widgetY, color, localizedColorName(selectedPreset), color, false);
        },
        mouse(event, position, node) {
            if (event.type !== "pointerdown") return false;
            openColorPicker(this, node, event, position);
            return true;
        },
        computeSize(width) {
            return [width, CONTROL_HEIGHT];
        },
    };
    return widget;
}

function createColorPresetWidget(inputName, inputData) {
    const initialValue = inputData?.[1]?.default;
    const widget = {
        name: inputName,
        type: PRESET_WIDGET_TYPE,
        options: { default: CUSTOM_COLOR_OPTION },
        value: PRESET_OPTIONS.includes(initialValue) ? initialValue : CUSTOM_COLOR_OPTION,
        draw(ctx, _node, width, widgetY) {
            // Nodes 2.0 reports pointer positions in the custom widget's
            // drawing coordinate system, while node.size may already reflect
            // a DOM/zoom-scaled width. Keep the exact draw width so visible
            // arrow hit targets stay aligned at every canvas zoom.
            this._wosaiDrawWidth = width;
            const controlColor = cssToken("--ws-cc-control-bg", "ButtonFace");
            drawColorPill(
                ctx,
                width,
                widgetY,
                controlColor,
                t("nodeDefs.WOSAI_CommonColor.inputs.color_name.name", "Color Preset"),
                localizedColorName(this.value),
            );
        },
        mouse(event, position, node) {
            if (event.type !== "pointerdown") return false;
            const target = event.currentTarget || event.target;
            const isDedicatedWidgetCanvas = (
                target instanceof HTMLCanvasElement
                && target !== app.canvas?.canvas
                && target.classList?.contains("cursor-crosshair")
            );
            const rect = isDedicatedWidgetCanvas ? target.getBoundingClientRect() : null;
            const pointerX = rect
                ? normalizePillPointerX(
                    event.clientX,
                    rect.left,
                    rect.width,
                    this._wosaiDrawWidth,
                    position?.[0],
                )
                : position?.[0];
            const action = resolvePillHitAction(
                pointerX,
                [this._wosaiDrawWidth, node.size?.[0]],
            );
            if (action === "previous") stepPreset(this, node, -1);
            else if (action === "next") stepPreset(this, node, 1);
            else openPresetMenu(this, node, event);
            return true;
        },
        computeSize(width) {
            return [width, CONTROL_HEIGHT];
        },
    };
    return widget;
}

function findWidget(node, name) {
    return node.widgets?.find((widget) => (widget._wosaiOrigName || widget.name) === name);
}

function markChanged(node) {
    node.graph?.setDirtyCanvas?.(true, true);
    node.setDirtyCanvas?.(true, true);
    node.graph?.change?.();
}

function syncPresetPreview(node) {
    const colorName = findWidget(node, "color_name")?.value;
    const presetColor = PRESET_COLORS[colorName];
    const customColor = findWidget(node, "custom_color");
    if (!presetColor || !customColor || customColor.value === presetColor) return;

    customColor.value = presetColor;
    customColor.callback?.(presetColor);
    markChanged(node);
}

function attach(node) {
    const colorName = findWidget(node, "color_name");
    if (!colorName) return;

    if (!widgetCallbacks.has(colorName)) {
        const original = colorName.callback;
        const patched = function (...args) {
            const result = original?.apply(this, args);
            queueMicrotask(() => syncPresetPreview(node));
            return result;
        };
        colorName.callback = patched;
        widgetCallbacks.set(colorName, { original, patched });
    }
    syncPresetPreview(node);
    applyNodeInstanceTranslation(node);
}

function detach(node) {
    const colorName = findWidget(node, "color_name");
    const state = colorName && widgetCallbacks.get(colorName);
    if (state && colorName.callback === state.patched) colorName.callback = state.original;
    if (colorName) widgetCallbacks.delete(colorName);
}

function patchNodeType(nodeType) {
    if (nodeType.prototype[PATCH_KEY]) return;
    const originalCreated = nodeType.prototype.onNodeCreated;
    const originalConfigure = nodeType.prototype.onConfigure;
    const originalRemoved = nodeType.prototype.onRemoved;

    const scheduleAttach = function () {
        queueMicrotask(() => attach(this));
    };
    const created = function (...args) {
        const result = originalCreated?.apply(this, args);
        scheduleAttach.call(this);
        return result;
    };
    const configured = function (...args) {
        const result = originalConfigure?.apply(this, args);
        scheduleAttach.call(this);
        return result;
    };
    const removed = function (...args) {
        detach(this);
        return originalRemoved?.apply(this, args);
    };

    nodeType.prototype.onNodeCreated = created;
    nodeType.prototype.onConfigure = configured;
    nodeType.prototype.onRemoved = removed;
    const patch = { originalCreated, originalConfigure, originalRemoved, created, configured, removed };
    nodeType.prototype[PATCH_KEY] = patch;
    patches.set(nodeType, patch);
}

app.registerExtension({
    name: "WOSAI.CommonColorPreview",
    getCustomWidgets() {
        return {
            [PRESET_WIDGET_TYPE]: (node, inputName, inputData) => ({
                widget: node.addCustomWidget(createColorPresetWidget(inputName, inputData)),
                minWidth: 150,
                minHeight: CONTROL_HEIGHT,
            }),
            [PREVIEW_WIDGET_TYPE]: (node, inputName, inputData) => ({
                widget: node.addCustomWidget(createColorPreviewWidget(inputName, inputData)),
                minWidth: 150,
                minHeight: CONTROL_HEIGHT,
            }),
        };
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;
        applyNodeDefTranslation(nodeData);
        patchNodeType(nodeType);
    },
    remove() {
        closeColorPicker();
        closePresetMenu();
        app.graph?._nodes?.filter((node) => node.type === NODE_TYPE).forEach(detach);
        for (const [nodeType, patch] of patches) {
            if (nodeType.prototype[PATCH_KEY] !== patch) continue;
            nodeType.prototype.onNodeCreated = patch.originalCreated;
            nodeType.prototype.onConfigure = patch.originalConfigure;
            nodeType.prototype.onRemoved = patch.originalRemoved;
            delete nodeType.prototype[PATCH_KEY];
        }
        patches.clear();
    },
});
