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
import { getWOSAIVarNum } from "./shared/shared-utils.js";

const TYPE = "WOSAI_GetWidget";
const PATCH_KEY = "__wosaiGetWidgetPatch";
const cleanups = new WeakMap();
const patchedNodeTypes = new Set();
let offLanguage = null;
const GET_WIDGET_STYLES = [
    ["wosai-media-tools-style", new URL("./styles/media-tools.css?v=14", import.meta.url).href],
];

function findWidget(node, name) {
    return node.widgets?.find((widget) => (widget._wosaiOrigName || widget.name) === name);
}

function getLink(graph, id) {
    if (id == null) return null;
    if (graph?._links instanceof Map) return graph._links.get(id);
    if (graph?.links instanceof Map) return graph.links.get(id);
    return graph?.links?.[id] || graph?._links?.[id] || null;
}

function targetWidgets(node) {
    const input = node.inputs?.find((item) => item.name === "target_output");
    const link = getLink(node.graph || app.graph, input?.link);
    const target = link ? (node.graph || app.graph)?.getNodeById?.(link.origin_id) : null;
    if (!target?.widgets) return [];
    return target.widgets
        .filter((widget) => widget?.name && widget.type !== "hidden" && !widget.hidden)
        .map((widget) => ({
            name: widget._wosaiOrigName || widget.name,
            label: widget.label || widget.name,
        }));
}

function attach(node) {
    if (node.__wosaiGetWidgetSelect) return;
    const widgetName = findWidget(node, "widget_name");
    const includeName = findWidget(node, "include_name");
    const includeExtension = findWidget(node, "include_extension");
    if (!widgetName || !includeName || !includeExtension) return;
    [widgetName, includeName, includeExtension].forEach(hideSerializableWidget);

    const controller = new AbortController();
    const root = document.createElement("div");
    root.className = "wosai-get-widget";
    const select = document.createElement("select");
    select.setAttribute("aria-label", t("nodes.getWidget.selector", "Target widget"));
    const toggles = document.createElement("div");
    toggles.className = "wosai-get-widget-toggles";
    const createToggle = (widget, key, fallback) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "wosai-get-widget-toggle";
        const render = () => {
            const active = widget.value === true;
            button.textContent = t(key, fallback);
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        };
        button.addEventListener("click", () => {
            widget.value = widget.value !== true;
            widget.callback?.(widget.value);
            render();
            node.graph?.change?.();
            node.setDirtyCanvas?.(true, true);
        }, { signal: controller.signal });
        render();
        return { button, render };
    };
    const nameToggle = createToggle(
        includeName,
        "nodes.getWidget.includeName",
        "Include name",
    );
    const extensionToggle = createToggle(
        includeExtension,
        "nodes.getWidget.includeExtension",
        "Keep extension",
    );
    toggles.append(nameToggle.button, extensionToggle.button);
    root.append(select, toggles);
    const refresh = () => {
        const widgets = targetWidgets(node);
        const current = String(widgetName.value || "");
        select.setAttribute("aria-label", t("nodes.getWidget.selector", "Target widget"));
        select.replaceChildren();
        const all = document.createElement("option");
        all.value = "";
        all.textContent = widgets.length
            ? t("nodes.getWidget.all", "All widgets")
            : t("nodes.getWidget.connect", "Connect a target node");
        select.append(all);
        widgets.forEach((widget) => {
            const option = document.createElement("option");
            option.value = widget.name;
            option.textContent = widget.label;
            select.append(option);
        });
        select.disabled = widgets.length === 0;
        select.value = widgets.some((item) => item.name === current) ? current : "";
        nameToggle.render();
        extensionToggle.render();
    };
    select.addEventListener("change", () => {
        widgetName.value = select.value;
        widgetName.callback?.(select.value);
        node.graph?.change?.();
        node.setDirtyCanvas?.(true, true);
    }, { signal: controller.signal });
    const getHeight = () => getWOSAIVarNum("--ws-get-widget-control-height", 92);
    addSizedDOMWidget(node, "wosai_widget_picker", "wosai_widget_picker", root, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: getHeight,
        getMaxHeight: getHeight,
        getHeight,
    });
    const unmountHidden = mountNode2HiddenWidgets(node, root, {
        widget_name: widgetName,
        include_name: includeName,
        include_extension: includeExtension,
    });
    node.__wosaiGetWidgetSelect = select;
    node.__wosaiRefreshWidgetOptions = refresh;
    refresh();
    ensureNodeMinSize(
        node,
        getWOSAIVarNum("--ws-get-widget-node-min-width", 300),
        getWOSAIVarNum("--ws-get-widget-node-min-height", 132),
    );
    compactNodeToContent(
        node,
        getWOSAIVarNum("--ws-get-widget-node-min-width", 300),
        getWOSAIVarNum("--ws-get-widget-node-min-height", 132),
    );
    cleanups.set(node, () => {
        unmountHidden();
        controller.abort();
        root.remove();
        delete node.__wosaiGetWidgetSelect;
        delete node.__wosaiRefreshWidgetOptions;
    });
}

app.registerExtension({
    name: "wosai.GetWidget",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== TYPE) return;
        ensureWosaiStyles(GET_WIDGET_STYLES);
        applyNodeDefTranslation(nodeData);
        if (nodeType.prototype[PATCH_KEY]) return;
        const originalCreated = nodeType.prototype.onNodeCreated;
        const originalConfigure = nodeType.prototype.onConfigure;
        const originalConnections = nodeType.prototype.onConnectionsChange;
        const originalRemoved = nodeType.prototype.onRemoved;
        const created = function () {
            const result = originalCreated?.apply(this, arguments);
            queueMicrotask(() => {
                attach(this);
                applyNodeInstanceTranslation(this);
            });
            return result;
        };
        const configured = function () {
            const result = originalConfigure?.apply(this, arguments);
            queueMicrotask(() => {
                attach(this);
                this.__wosaiRefreshWidgetOptions?.();
            });
            return result;
        };
        const connections = function () {
            const result = originalConnections?.apply(this, arguments);
            queueMicrotask(() => this.__wosaiRefreshWidgetOptions?.());
            return result;
        };
        const removed = function () {
            cleanups.get(this)?.();
            cleanups.delete(this);
            return originalRemoved?.apply(this, arguments);
        };
        nodeType.prototype.onNodeCreated = created;
        nodeType.prototype.onConfigure = configured;
        nodeType.prototype.onConnectionsChange = connections;
        nodeType.prototype.onRemoved = removed;
        nodeType.prototype[PATCH_KEY] = {
            originalCreated, originalConfigure, originalConnections, originalRemoved,
            created, configured, connections, removed,
        };
        patchedNodeTypes.add(nodeType);
    },
    setup() {
        ensureWosaiStyles(GET_WIDGET_STYLES);
        offLanguage ??= onLangChange(() => {
            app.graph?._nodes?.forEach((node) => node.__wosaiRefreshWidgetOptions?.());
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
            if (proto.onConnectionsChange === patch.connections) proto.onConnectionsChange = patch.originalConnections;
            if (proto.onRemoved === patch.removed) proto.onRemoved = patch.originalRemoved;
            delete proto[PATCH_KEY];
        }
        patchedNodeTypes.clear();
    },
});
