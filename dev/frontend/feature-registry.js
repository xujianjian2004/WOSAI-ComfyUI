/**
 * WOSAI 用户功能注册清单。
 *
 * 这是功能归类、加载审计与后续 HUB BAR 自定义的唯一数据源；它不负责加载模块。
 * status 含义：
 * - active: 已由 extension.json 或 Python 初始化入口加载。
 * - indirect: 由已加载入口通过 import 提供。
 * - partial: 主功能已加载，但配套前端模块尚未接入入口清单。
 * - unwired: 源文件存在，当前未发现入口或模块导入路径。
 * - planned: 已完成设计归类，但需要用户选择数据模型后才能实现。
 */

export const FEATURE_CATEGORIES = Object.freeze({
    workflowNodes: "workflow-nodes",
    canvasVisual: "canvas-visual",
    productivity: "productivity",
    controlSurface: "control-surface",
    system: "system",
    service: "service",
});

export const FEATURE_STATUSES = Object.freeze(["active", "indirect", "partial", "unwired", "planned"]);

export const FEATURE_REGISTRY = Object.freeze([
    {
        id: "size-select", name: "SizeSelect", category: FEATURE_CATEGORIES.workflowNodes,
        kind: "node", entry: ["nodes/size_select.py", "web/size-select.js"], surfaces: ["node"],
        persistence: ["workflow"], compatibility: ["classic", "nodes2"], status: "active",
    },
    {
        id: "omni-slider", name: "OmniSlider", category: FEATURE_CATEGORIES.workflowNodes,
        kind: "node", entry: ["nodes/omni_slider.py", "web/omni-slider.js"], surfaces: ["node"],
        persistence: ["workflow"], compatibility: ["classic", "nodes2"], status: "active",
    },
    {
        id: "title-note", name: "TitleNote", category: FEATURE_CATEGORIES.workflowNodes,
        kind: "node", entry: ["nodes/title_note.py", "web/title-note.js"], surfaces: ["node", "canvas"],
        persistence: ["workflow"], compatibility: ["classic", "nodes2"], status: "active",
    },
    {
        id: "ignore-groups", name: "IgnoreGroups", category: FEATURE_CATEGORIES.workflowNodes,
        kind: "node", entry: ["nodes/ignore_groups.py", "web/ignore-groups.js"], surfaces: ["node", "canvas"],
        persistence: ["workflow"], compatibility: ["classic", "nodes2"], status: "active",
    },
    {
        id: "preset-prompt", name: "PresetPrompt", category: FEATURE_CATEGORIES.workflowNodes,
        kind: "node", entry: ["nodes/preset_prompt.py", "web/preset-prompt.js"], surfaces: ["node"],
        persistence: ["workflow"], compatibility: ["classic", "nodes2"], status: "active",
    },
    {
        id: "logic-switch", name: "LogicSwitch", category: FEATURE_CATEGORIES.workflowNodes,
        kind: "node", entry: ["nodes/logic_switch.py", "web/logic-switch.js"], surfaces: ["node"],
        persistence: ["workflow"], compatibility: ["classic", "nodes2"], status: "active",
    },
    {
        id: "node-color", name: "NodeColor", category: FEATURE_CATEGORIES.canvasVisual,
        kind: "canvas-tool", entry: ["web/node-color.js"], surfaces: ["canvas", "context-menu", "hud"],
        persistence: ["localStorage", "server"], compatibility: ["classic", "nodes2"], status: "active",
        hub: "optional",
    },
    {
        id: "color-bar", name: "ColorBar", category: FEATURE_CATEGORIES.canvasVisual,
        kind: "hud-host", entry: ["web/color-bar.js", "web/shared/color-bar-ui.js"], surfaces: ["launcher", "hud", "hub"],
        persistence: ["localStorage"], compatibility: ["classic", "nodes2"], status: "active",
        hub: "optional",
    },
    {
        id: "visual-fx", name: "VisualFX", category: FEATURE_CATEGORIES.canvasVisual,
        kind: "canvas-tool", entry: ["web/visual-fx.js"], surfaces: ["settings", "hud"],
        persistence: ["localStorage"], compatibility: ["classic", "nodes2"], status: "active",
        hub: "not-recommended",
    },
    {
        id: "link-fx", name: "LinkFX", category: FEATURE_CATEGORIES.canvasVisual,
        kind: "canvas-tool", entry: ["web/link-fx.js"], surfaces: ["settings", "hud", "canvas"],
        persistence: ["localStorage"], compatibility: ["classic", "nodes2"], status: "active",
        hub: "not-recommended",
    },
    {
        id: "run-highlight", name: "RunHighlight", category: FEATURE_CATEGORIES.canvasVisual,
        kind: "canvas-tool", entry: ["web/run-highlight.js"], surfaces: ["canvas", "comfy-settings"],
        persistence: ["comfy-settings"], compatibility: ["classic", "nodes2"], status: "active",
    },
    {
        id: "layout-toolkit", name: "LayoutToolkit", category: FEATURE_CATEGORIES.productivity,
        kind: "workflow-tool", entry: ["web/layout-toolkit.js", "web/shared/layout-*.js"],
        surfaces: ["hud", "context-menu", "commands", "keybindings"], persistence: ["comfy-settings", "localStorage"],
        compatibility: ["classic", "nodes2"], status: "active", hub: "source-actions",
    },
    {
        id: "save-node", name: "SaveNode", category: FEATURE_CATEGORIES.productivity,
        kind: "workflow-tool", entry: ["web/save-node.js"], surfaces: ["hud", "hub", "context-menu"],
        persistence: ["localStorage"], compatibility: ["classic", "nodes2"], status: "active", hub: "optional",
    },
    {
        id: "save-text", name: "SaveText", category: FEATURE_CATEGORIES.productivity,
        kind: "workflow-tool", entry: ["web/save-text.js"], surfaces: ["canvas", "panel"],
        persistence: ["localStorage"], compatibility: ["classic", "nodes2"], status: "active",
    },
    {
        id: "auto-connect", name: "AutoConnect", category: FEATURE_CATEGORIES.productivity,
        kind: "workflow-tool", entry: ["web/auto-connect.js"], surfaces: ["hub"],
        persistence: [], compatibility: ["classic", "nodes2"], status: "active", hub: "optional",
    },
    {
        id: "shake-disconnect", name: "ShakeDisconnect", category: FEATURE_CATEGORIES.productivity,
        kind: "workflow-tool", entry: ["web/shake-disconnect.js"], surfaces: ["hub", "canvas"],
        persistence: ["localStorage"], compatibility: ["classic", "nodes2"], status: "active", hub: "optional",
    },
    {
        id: "selection-toolbox", name: "SelectionToolbox", category: FEATURE_CATEGORIES.controlSurface,
        kind: "native-control-adapter", entry: ["web/hub-bar.js"], surfaces: ["selection-toolbox", "node"],
        persistence: [], compatibility: ["classic", "nodes2"], status: "active",
    },
    {
        id: "launcher", name: "Launcher", category: FEATURE_CATEGORIES.controlSurface,
        kind: "control-surface", entry: ["web/launcher.js"], surfaces: ["launcher", "settings-center"],
        persistence: ["localStorage"], compatibility: ["classic", "nodes2"], status: "indirect",
    },
    {
        id: "settings", name: "Settings", category: FEATURE_CATEGORIES.system,
        kind: "control-surface", entry: ["web/settings.js"], surfaces: ["settings", "hud", "hub"],
        persistence: ["localStorage"], compatibility: ["classic", "nodes2"], status: "active",
    },
    {
        id: "menu-hide", name: "MenuHide", category: FEATURE_CATEGORIES.system,
        kind: "system-tool", entry: ["web/menu-hide.js"], surfaces: ["settings", "manager", "hub"],
        persistence: ["localStorage"], compatibility: ["classic", "nodes2"], status: "active", hub: "optional",
    },
    {
        id: "performance-mode", name: "PerformanceMode", category: FEATURE_CATEGORIES.system,
        kind: "system-tool", entry: ["web/performance-mode.js"], surfaces: ["settings", "canvas"],
        persistence: ["localStorage"], compatibility: ["classic", "nodes2"], status: "active",
    },
    {
        id: "panel-drag", name: "PanelDrag", category: FEATURE_CATEGORIES.system,
        kind: "system-tool", entry: ["web/panel-drag.js"], surfaces: ["panel"],
        persistence: ["localStorage"], compatibility: ["classic", "nodes2"], status: "active",
    },
    {
        id: "color-presets-api", name: "Color Presets API", category: FEATURE_CATEGORIES.service,
        kind: "service", entry: ["wosai_core/color_presets.py"], surfaces: ["server"],
        persistence: ["server", "localStorage-fallback"], compatibility: [], status: "active",
    },
    {
        id: "image-size-probe-api", name: "Image Size Probe API", category: FEATURE_CATEGORIES.service,
        kind: "service", entry: ["wosai_core/wosai_size_probe.py"], surfaces: ["server"],
        persistence: [], compatibility: [], status: "active",
    },
]);

export function getFeature(id) {
    return FEATURE_REGISTRY.find((feature) => feature.id === id) || null;
}

export function getFeaturesByCategory(category) {
    return FEATURE_REGISTRY.filter((feature) => feature.category === category);
}

export function getHubCandidates() {
    return FEATURE_REGISTRY.filter((feature) => feature.hub === "optional" || feature.hub === "source-actions");
}

export function getFeatureLoadAudit() {
    return FEATURE_REGISTRY.filter((feature) => feature.status === "partial" || feature.status === "unwired");
}

export function getPlannedFeatures() {
    return FEATURE_REGISTRY.filter((feature) => feature.status === "planned");
}
