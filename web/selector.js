import { app } from "../../../scripts/app.js";
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
    DEFAULT_SELECTOR_LABELS,
    DEFAULT_SELECTOR_SETTINGS,
    MAX_SELECTOR_COLUMNS,
    MAX_SELECTOR_LABELS,
    normalizeSelectorLabels,
    normalizeSelectorSettings,
    serializeSelectorSettings,
} from "./shared/selector-settings.js";

const SELECTOR_TYPES = new Set(["WOSAI_Selector", "WOSAI_BooleanSelector"]);
const PATCH_KEY = "__wosaiSelectorPatch";
const nodeCleanup = new WeakMap();
const patchedNodeTypes = new Set();
let offLanguage = null;
const SELECTOR_STYLES = [
    ["wosai-selector-style", new URL("./styles/selector.css?v=5", import.meta.url).href],
];

function findWidget(node, name) {
    return node.widgets?.find((widget) => (widget._wosaiOrigName || widget.name) === name);
}

function hideBackendWidget(widget) {
    if (!widget || widget.__wosaiSelectorHidden) return;
    widget.__wosaiSelectorHidden = true;
    hideSerializableWidget(widget);
}

function parseLabels(raw) {
    return normalizeSelectorLabels(raw);
}

function markChanged(node) {
    node.graph?.setDirtyCanvas?.(true, true);
    node.setDirtyCanvas?.(true, true);
    node.graph?.change?.();
}

function getSettingsWidget(node) {
    return findWidget(node, "settings_json");
}

function getSelectorSettings(node) {
    return normalizeSelectorSettings(getSettingsWidget(node)?.value);
}

function setSelectorSettings(node, settings) {
    const widget = getSettingsWidget(node);
    if (!widget) return;
    widget.value = serializeSelectorSettings(settings);
    widget.callback?.(widget.value);
}

function applySelectorAppearance(root, settings) {
    const properties = {
        "--wosai-selector-font-size": `${settings.fontSize}px`,
        "--wosai-selector-button-height": `${settings.buttonHeight}px`,
        "--wosai-selector-gap": `${settings.gap}px`,
    };
    for (const [name, value] of Object.entries(properties)) {
        root.style.setProperty(name, value);
    }
}

function selectorMetrics(node) {
    const settings = getSelectorSettings(node);
    return { buttonHeight: settings.buttonHeight, gap: settings.gap };
}

function createButton(label, active, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `wosai-selector-button${active ? " is-active" : ""}`;
    button.textContent = label;
    button.title = label;
    button.addEventListener("click", onClick);
    return button;
}

function buildSelector(node) {
    if (node.__wosaiSelectorRoot) return;
    const indexWidget = findWidget(node, "selected_index");
    const labelsWidget = findWidget(node, "labels_json");
    const columnsWidget = findWidget(node, "columns");
    const settingsWidget = getSettingsWidget(node);
    if (!indexWidget || !labelsWidget || !columnsWidget) return;

    [indexWidget, labelsWidget, columnsWidget, settingsWidget].filter(Boolean).forEach(hideBackendWidget);
    const root = document.createElement("div");
    root.className = "wosai-selector-widget";
    root.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openSelectorSettings(node);
    });
    node.__wosaiSelectorRoot = root;
    let resize = () => {};

    const render = () => {
        const labels = parseLabels(labelsWidget.value);
        const columns = Math.max(
            1,
            Math.min(MAX_SELECTOR_COLUMNS, Number(columnsWidget.value) || 2),
        );
        applySelectorAppearance(root, getSelectorSettings(node));
        indexWidget.value = Math.max(0, Math.min(labels.length - 1, Number(indexWidget.value) || 0));
        root.style.setProperty("--wosai-selector-columns", String(columns));
        root.replaceChildren(...labels.map((label, index) => createButton(
            label,
            index === Number(indexWidget.value),
            () => {
                indexWidget.value = index;
                indexWidget.callback?.(index);
                render();
                markChanged(node);
            },
        )));
        resize();
    };

    const getHeight = () => {
        const labels = parseLabels(labelsWidget.value);
        const columns = Math.max(
            1,
            Math.min(MAX_SELECTOR_COLUMNS, Number(columnsWidget.value) || 2),
        );
        const rows = Math.ceil(labels.length / columns);
        const { buttonHeight, gap } = selectorMetrics(node);
        return rows * buttonHeight + Math.max(0, rows - 1) * gap + gap * 2;
    };
    addSizedDOMWidget(
        node,
        "wosai_selector_ui",
        "wosai_selector",
        root,
        {
            serialize: false,
            hideOnZoom: false,
            getMinHeight: getHeight,
            getMaxHeight: getHeight,
            getHeight,
        },
    );
    // ComfyUI reserves 8px above and below a DOM widget outside the element
    // itself. Include that layout gutter so the grid receives its full height.
    const unmountHidden = mountNode2HiddenWidgets(node, root, {
        selected_index: indexWidget,
        labels_json: labelsWidget,
        columns: columnsWidget,
        settings_json: settingsWidget,
    });
    resize = () => ensureNodeMinSize(node, 240, 44 + getHeight());
    node.__wosaiSelectorRender = render;
    render();
    compactNodeToContent(node, 240, 44 + getHeight());
    nodeCleanup.set(node, () => {
        unmountHidden();
        root.remove();
        delete node.__wosaiSelectorRoot;
        delete node.__wosaiSelectorRender;
    });
}

function buildBooleanSelector(node) {
    if (node.__wosaiSelectorRoot) return;
    const valueWidget = findWidget(node, "value");
    const settingsWidget = getSettingsWidget(node);
    if (!valueWidget) return;
    [valueWidget, settingsWidget].filter(Boolean).forEach(hideBackendWidget);

    const root = document.createElement("div");
    root.className = "wosai-selector-widget wosai-boolean-selector";
    root.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openSelectorSettings(node);
    });
    node.__wosaiSelectorRoot = root;
    const render = () => {
        const value = Boolean(valueWidget.value);
        const settings = getSelectorSettings(node);
        applySelectorAppearance(root, settings);
        root.replaceChildren(
            createButton(settings.falseLabel || t("nodes.selector.false", "False"), !value, () => {
                valueWidget.value = false;
                valueWidget.callback?.(false);
                render();
                markChanged(node);
            }),
            createButton(settings.trueLabel || t("nodes.selector.true", "True"), value, () => {
                valueWidget.value = true;
                valueWidget.callback?.(true);
                render();
                markChanged(node);
            }),
        );
    };
    const getHeight = () => {
        const { buttonHeight, gap } = selectorMetrics(node);
        return buttonHeight + gap * 2;
    };
    addSizedDOMWidget(
        node,
        "wosai_boolean_ui",
        "wosai_selector",
        root,
        {
            serialize: false,
            hideOnZoom: false,
            getMinHeight: getHeight,
            getMaxHeight: getHeight,
            getHeight,
        },
    );
    const unmountHidden = mountNode2HiddenWidgets(node, root, {
        value: valueWidget,
        settings_json: settingsWidget,
    });
    node.__wosaiSelectorRender = render;
    render();
    ensureNodeMinSize(node, 180, 44 + getHeight());
    compactNodeToContent(node, 180, 44 + getHeight(), {
        preserveWidth: false,
        maxWidth: 220,
    });
    nodeCleanup.set(node, () => {
        unmountHidden();
        root.remove();
        delete node.__wosaiSelectorRoot;
        delete node.__wosaiSelectorRender;
    });
}

function createDialogSection(titleText) {
    const section = document.createElement("fieldset");
    section.className = "wosai-selector-dialog-section";
    const legend = document.createElement("legend");
    legend.textContent = titleText;
    section.append(legend);
    return section;
}

function createRangeField(section, {
    name,
    labelText,
    min,
    max,
    value,
}) {
    const row = document.createElement("label");
    row.className = "wosai-selector-range-field";
    const text = document.createElement("span");
    text.textContent = labelText;
    const input = document.createElement("input");
    input.type = "range";
    input.id = `wosai-selector-${name}`;
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    input.value = String(value);
    input.dataset.selectorSetting = name;
    const output = document.createElement("output");
    output.htmlFor = input.id;
    const updateOutput = () => {
        output.value = input.value;
        output.textContent = input.value;
    };
    const setValue = (nextValue) => {
        input.value = String(nextValue);
        updateOutput();
    };
    const setMax = (nextMax) => {
        input.max = String(nextMax);
        if (Number(input.value) > Number(nextMax)) setValue(nextMax);
    };
    input.addEventListener("input", updateOutput);
    updateOutput();
    row.append(text, input, output);
    section.append(row);
    return { input, output, setValue, setMax };
}

function createLabelEditor(index, value, placeholder) {
    const row = document.createElement("label");
    row.className = "wosai-selector-label-editor";
    row.dataset.selectorLabelIndex = String(index);
    const text = document.createElement("span");
    text.textContent = t("nodes.selector.labelName", "Label {index}")
        .replace("{index}", String(index));
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 48;
    input.value = String(value);
    input.placeholder = placeholder;
    row.append(text, input);
    return row;
}

function defaultSelectorLabel(index) {
    return t("nodes.selector.defaultLabel", "{index}")
        .replace("{index}", String(index));
}

function openSelectorSettings(node) {
    const booleanMode = node.type === "WOSAI_BooleanSelector";
    const labelsWidget = findWidget(node, "labels_json");
    const columnsWidget = findWidget(node, "columns");
    const settingsWidget = getSettingsWidget(node);
    if (!settingsWidget || (!booleanMode && (!labelsWidget || !columnsWidget))) return;

    document.querySelector(".wosai-selector-dialog-overlay")?.remove();
    const original = {
        settings: settingsWidget.value,
        labels: labelsWidget?.value,
        columns: columnsWidget?.value,
        index: findWidget(node, "selected_index")?.value,
    };
    const initialSettings = getSelectorSettings(node);
    let draftLabels = booleanMode
        ? [initialSettings.falseLabel, initialSettings.trueLabel]
        : parseLabels(labelsWidget.value);
    const overlay = document.createElement("div");
    overlay.className = "wosai-selector-dialog-overlay";
    const dialog = document.createElement("section");
    dialog.className = "wosai-selector-dialog wosai-panel wosai-panel--glass";

    const title = document.createElement("h3");
    title.textContent = t("nodes.selector.settingsTitle", "Label settings");
    const controlsSection = createDialogSection(t("nodes.selector.layout", "Layout"));
    const countField = booleanMode
        ? null
        : createRangeField(controlsSection, {
            name: "labelCount",
            labelText: t("nodes.selector.labelCount", "Label count"),
            min: 2,
            max: MAX_SELECTOR_LABELS,
            value: draftLabels.length,
        });
    const columnsField = booleanMode
        ? null
        : createRangeField(controlsSection, {
            name: "columns",
            labelText: t("nodes.selector.columnsPerRow", "Columns per row"),
            min: 1,
            max: Math.min(MAX_SELECTOR_COLUMNS, draftLabels.length),
            value: Math.max(
                1,
                Math.min(MAX_SELECTOR_COLUMNS, Number(columnsWidget.value) || 2),
            ),
        });
    const buttonHeightField = createRangeField(controlsSection, {
        name: "buttonHeight",
        labelText: t("nodes.selector.labelHeight", "Label height"),
        min: 30,
        max: 80,
        value: initialSettings.buttonHeight,
    });
    const fontSizeField = createRangeField(controlsSection, {
        name: "fontSize",
        labelText: t("nodes.selector.fontSize", "Font size"),
        min: 10,
        max: 24,
        value: initialSettings.fontSize,
    });
    const gapField = createRangeField(controlsSection, {
        name: "gap",
        labelText: t("nodes.selector.labelGap", "Label gap"),
        min: 0,
        max: 20,
        value: initialSettings.gap,
    });
    const renameSection = createDialogSection(t("nodes.selector.renameLabels", "Rename labels"));
    renameSection.classList.add("wosai-selector-labels-section");
    const labelsContainer = document.createElement("div");
    labelsContainer.className = "wosai-selector-labels-list";
    renameSection.append(labelsContainer);

    const actions = document.createElement("div");
    actions.className = "wosai-selector-dialog-actions";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = t("common.reset", "Reset");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = t("common.cancel", "Cancel");
    const save = document.createElement("button");
    save.type = "button";
    save.className = "is-primary";
    save.textContent = t("common.save", "Save");
    actions.append(reset, cancel, save);
    dialog.append(title, controlsSection, renameSection, actions);
    overlay.append(dialog);
    document.body.append(overlay);

    const currentCount = () => (
        booleanMode
            ? 2
            : Math.max(2, Math.min(MAX_SELECTOR_LABELS, Number(countField.input.value) || 2))
    );
    const captureDraftLabels = () => {
        labelsContainer.querySelectorAll("[data-selector-label-index]").forEach((row) => {
            const index = Number(row.dataset.selectorLabelIndex);
            draftLabels[index] = row.querySelector("input")?.value ?? "";
        });
    };
    const renderLabelEditors = () => {
        const count = currentCount();
        const rows = [];
        for (let index = 0; index < count; index += 1) {
            const placeholder = booleanMode
                ? t(
                    index === 0 ? "nodes.selector.false" : "nodes.selector.true",
                    index === 0 ? "False" : "True",
                )
                : defaultSelectorLabel(index);
            rows.push(createLabelEditor(index, draftLabels[index] || "", placeholder));
        }
        labelsContainer.replaceChildren(...rows);
    };
    const readLabels = () => {
        captureDraftLabels();
        return Array.from({ length: currentCount() }, (_, index) => {
            const label = String(draftLabels[index] || "").trim().slice(0, 48);
            return booleanMode ? label : (label || defaultSelectorLabel(index));
        });
    };
    const readSettings = () => ({
        fontSize: fontSizeField.input.value,
        buttonHeight: buttonHeightField.input.value,
        gap: gapField.input.value,
        falseLabel: booleanMode ? readLabels()[0] : "",
        trueLabel: booleanMode ? readLabels()[1] : "",
    });
    const syncColumns = () => {
        if (!columnsField) return;
        columnsField.setMax(Math.min(MAX_SELECTOR_COLUMNS, currentCount()));
    };
    const applyPreview = () => {
        setSelectorSettings(node, readSettings());
        if (!booleanMode) {
            const labels = readLabels();
            labelsWidget.value = JSON.stringify(labels);
            columnsWidget.value = Math.max(
                1,
                Math.min(
                    labels.length,
                    MAX_SELECTOR_COLUMNS,
                    Number(columnsField.input.value) || 2,
                ),
            );
            const indexWidget = findWidget(node, "selected_index");
            if (indexWidget) {
                indexWidget.value = Math.min(Number(indexWidget.value) || 0, labels.length - 1);
            }
        }
        node.__wosaiSelectorRender?.();
        markChanged(node);
    };
    const close = () => {
        document.removeEventListener("keydown", onKeyDown);
        overlay.remove();
    };
    const restore = () => {
        settingsWidget.value = original.settings;
        if (labelsWidget) labelsWidget.value = original.labels;
        if (columnsWidget) columnsWidget.value = original.columns;
        const indexWidget = findWidget(node, "selected_index");
        if (indexWidget) indexWidget.value = original.index;
        node.__wosaiSelectorRender?.();
        markChanged(node);
        close();
    };
    const onKeyDown = (event) => {
        if (event.key === "Escape") restore();
    };

    if (countField) {
        countField.input.addEventListener("input", () => {
            captureDraftLabels();
            draftLabels.length = currentCount();
            syncColumns();
            renderLabelEditors();
            applyPreview();
        });
    }
    columnsField?.input.addEventListener("input", applyPreview);
    for (const field of [buttonHeightField, fontSizeField, gapField]) {
        field.input.addEventListener("input", applyPreview);
    }
    labelsContainer.addEventListener("input", applyPreview);
    reset.addEventListener("click", () => {
        const defaults = DEFAULT_SELECTOR_SETTINGS;
        fontSizeField.setValue(defaults.fontSize);
        buttonHeightField.setValue(defaults.buttonHeight);
        gapField.setValue(defaults.gap);
        draftLabels = booleanMode ? ["", ""] : [...DEFAULT_SELECTOR_LABELS];
        if (countField) countField.setValue(DEFAULT_SELECTOR_LABELS.length);
        if (columnsField) columnsField.setValue(MAX_SELECTOR_COLUMNS);
        syncColumns();
        renderLabelEditors();
        applyPreview();
    });
    cancel.addEventListener("click", restore);
    save.addEventListener("click", () => {
        applyPreview();
        close();
    });
    overlay.addEventListener("mousedown", (event) => {
        if (event.target === overlay) restore();
    });
    document.addEventListener("keydown", onKeyDown);
    syncColumns();
    renderLabelEditors();
    labelsContainer.querySelector("input")?.focus();
}

function patchNodeType(nodeType, nodeData) {
    if (nodeType.prototype[PATCH_KEY]) return;
    const originalCreated = nodeType.prototype.onNodeCreated;
    const originalConfigure = nodeType.prototype.onConfigure;
    const originalRemoved = nodeType.prototype.onRemoved;
    const originalMenu = nodeType.prototype.getExtraMenuOptions;

    const attach = function () {
        queueMicrotask(() => {
            if (nodeData.name === "WOSAI_Selector") buildSelector(this);
            else buildBooleanSelector(this);
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
        queueMicrotask(() => this.__wosaiSelectorRender?.());
        return result;
    };
    const removed = function () {
        nodeCleanup.get(this)?.();
        nodeCleanup.delete(this);
        return originalRemoved?.apply(this, arguments);
    };
    const menu = function (_, options) {
        const result = originalMenu?.apply(this, arguments);
        options.push({
            content: t("nodes.selector.settingsMenu", "Selector settings"),
            callback: () => openSelectorSettings(this),
        });
        return result;
    };
    nodeType.prototype.onNodeCreated = created;
    nodeType.prototype.onConfigure = configured;
    nodeType.prototype.onRemoved = removed;
    nodeType.prototype.getExtraMenuOptions = menu;
    nodeType.prototype[PATCH_KEY] = {
        originalCreated, originalConfigure, originalRemoved, originalMenu,
        created, configured, removed, menu,
    };
    patchedNodeTypes.add(nodeType);
}

app.registerExtension({
    name: "wosai.Selectors",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!SELECTOR_TYPES.has(nodeData.name)) return;
        ensureWosaiStyles(SELECTOR_STYLES);
        applyNodeDefTranslation(nodeData);
        patchNodeType(nodeType, nodeData);
    },
    setup() {
        ensureWosaiStyles(SELECTOR_STYLES);
        offLanguage ??= onLangChange(() => {
            app.graph?._nodes?.forEach((node) => {
                if (SELECTOR_TYPES.has(node.type)) node.__wosaiSelectorRender?.();
            });
        });
    },
    remove() {
        offLanguage?.();
        offLanguage = null;
        document.querySelector(".wosai-selector-dialog-overlay")?.remove();
        app.graph?._nodes?.forEach((node) => {
            nodeCleanup.get(node)?.();
            nodeCleanup.delete(node);
        });
        for (const nodeType of patchedNodeTypes) {
            const proto = nodeType.prototype;
            const patch = proto[PATCH_KEY];
            if (!patch) continue;
            if (proto.onNodeCreated === patch.created) proto.onNodeCreated = patch.originalCreated;
            if (proto.onConfigure === patch.configured) proto.onConfigure = patch.originalConfigure;
            if (proto.onRemoved === patch.removed) proto.onRemoved = patch.originalRemoved;
            if (proto.getExtraMenuOptions === patch.menu) proto.getExtraMenuOptions = patch.originalMenu;
            delete proto[PATCH_KEY];
        }
        patchedNodeTypes.clear();
    },
});
