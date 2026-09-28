import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { t, onLangChange } from "./shared/i18n.js";
import { getGlassTheme, onGlassChange } from "./shared/glass-theme.js";
import { showToast } from "./shared/toast.js";
import { WOSAI_COPYRIGHT, WOSAI_GITHUB } from "./shared/constants.js";
import { ensureWosaiStyles } from "./shared/dom-widget.js";

const TAB_ID = "wosai-device-info";

let panel = null;
let data = null;
let loading = false;
let offLangChange = null;
let offGlassChange = null;
let liveRefreshTimer = null;

const label = (key, fallback) => t(`menus.deviceInfo.${key}`, fallback);

// ComfyUI does not consistently load stylesheet entries from extension.json.
// Load the shared tokens and this panel stylesheet explicitly so the sidebar
// never falls back to unstyled native controls.
function ensureCSS() {
    ensureWosaiStyles([
        ["wosai-device-info-css", new URL("./styles/device-info.css?v=5", import.meta.url).href],
    ]);
}

function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function valueOf(item, fallback = "—") {
    if (!item || item.value === null || item.value === undefined || item.value === "") return fallback;
    if (Array.isArray(item.value)) return item.value.join(" ");
    return String(item.value);
}

function resourceValue(item) {
    return valueOf(item).replace(/\s+(?=[KMGTPE]?B\b)/g, "");
}

function titleCase(value) {
    return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function addButton(parent, key, fallback, icon, handler, extraClass = "") {
    const button = make("button", `ws-di-button ${extraClass}`.trim());
    button.type = "button";
    button.title = label(`${key}Hint`, fallback);
    button.setAttribute("aria-label", label(key, fallback));
    if (icon) {
        const iconElement = make("i", `pi ${icon}`);
        iconElement.setAttribute("aria-hidden", "true");
        button.append(iconElement);
    }
    button.append(document.createTextNode(label(key, fallback)));
    button.addEventListener("click", handler);
    parent.append(button);
    return button;
}

function card(title, icon) {
    const section = make("section", "ws-di-card");
    const heading = make("div", "ws-di-card-heading");
    if (icon) heading.append(make("i", `pi ${icon}`));
    heading.append(make("h2", "", title));
    section.append(heading);
    return section;
}

function row(parent, key, item, options = {}) {
    const display = valueOf(item, options.fallback);
    const element = make(options.onClick ? "button" : "div", "ws-di-row");
    if (options.onClick) {
        element.type = "button";
        element.title = label("openPathHint", "Open directory");
        element.addEventListener("click", options.onClick);
    }
    element.dataset.search = `${key} ${display}`.toLowerCase();
    element.append(make("span", "ws-di-label", options.label || titleCase(key)));
    const value = make("span", `ws-di-value${item?.status === "error" ? " is-error" : ""}`, display);
    if (item?.error) value.title = item.error;
    if (options.onClick) {
        const icon = make("i", "pi pi-external-link ws-di-open-icon");
        icon.setAttribute("aria-hidden", "true");
        value.append(icon);
    }
    element.append(value);
    parent.append(element);
    return element;
}

function pill(text, type = "neutral") {
    return make("span", `ws-di-pill is-${type}`, text);
}

function renderHealth(target) {
    const section = card(label("health", "Environment Health"), "pi-heart");
    const health = data.health || { score: 0, issues: [] };
    const score = make("div", "ws-di-score");
    const scoreValue = make("strong", "", `${health.score}/100`);
    score.append(scoreValue, make("span", "", label("healthScore", "Health score")));
    const tone = health.score >= 80 ? "good" : health.score >= 60 ? "warning" : "danger";
    score.classList.add(`is-${tone}`);
    const issues = make("div", "ws-di-issues");
    if (!health.issues?.length) issues.append(pill(label("healthy", "No issues detected"), "good"));
    else health.issues.forEach((issue) => issues.append(pill(label(`issues.${issue}`, titleCase(issue)), issue === "cuda_unavailable" ? "warning" : "danger")));
    score.append(make("span", "ws-di-health-separator", "|"), issues);
    section.append(score);
    target.append(section);
}

function renderSummary(target) {
    renderHardware(target);
}

function renderSystem(target) {
    const section = card(label("system", "Runtime Environment"), "pi-desktop");
    const system = data.static?.system || {};
    const runtime = data.static?.runtime || {};
    row(section, "os", system.os, { label: label("os", "OS") });
    row(section, "python", system.python, { label: label("python", "Python") });
    row(section, "pytorch", runtime.pytorch, { label: label("pytorch", "PyTorch") });
    row(section, "git", data.static?.comfyui?.git, { label: label("git", "Git") });
    target.append(section);
}

function renderHardware(target) {
    const section = card(label("hardware", "Hardware Resources"), "pi-microchip");
    const system = data.static?.system || {};
    const gpus = (data.dynamic?.gpus || []).filter((gpu) => gpu.status === "ok");
    if (!gpus.length) section.append(make("p", "ws-di-empty", label("noGpu", "No GPU information available.")));
    for (const gpu of gpus) {
        row(section, `vram-${gpu.id}`, { value: usageText(gpu.smi_used, gpu.total, gpu.smi_free) }, {
            label: gpus.length > 1 ? `${label("vram", "VRAM")} ${gpu.id}` : label("vram", "VRAM"),
        });
    }
    const memory = data.dynamic?.memory || {};
    row(section, "memory", { value: usageText(memory.used, memory.total, memory.available) }, { label: label("memory", "RAM") });
    (data.dynamic?.disks || []).forEach((disk) => {
        row(section, `disk-${disk.path}`, { value: usageText(disk.used, disk.total, disk.free) }, { label: `${label("storage", "Disk")} ${disk.path}` });
    });
    row(section, "processor", system.cpu, { label: label("processor", "Processor") });
    target.append(section);
}

function usageText(used, total, available) {
    return `${resourceValue(used)} ${label("used", "Used")} / ${resourceValue(available)} ${label("available", "Available")} / ${label("totalLabel", "Total")} ${resourceValue(total)}`;
}

function renderPaths(target) {
    const section = card(label("paths", "ComfyUI Paths"), "pi-folder");
    const seenPaths = new Set();
    for (const [name, item] of Object.entries(data.paths || {})) {
        const entries = item?.value || [];
        entries.forEach((entry, index) => {
            const identity = String(entry.path).replaceAll("/", "\\").toLowerCase();
            if (seenPaths.has(identity)) return;
            seenPaths.add(identity);
            const pathRow = row(section, `${name}-${index}`, { value: entry.path, status: entry.exists ? "ok" : "error" }, {
                label: pathLabel(name, entry.path),
                onClick: () => openPath(name, index),
            });
            pathRow.classList.add("ws-di-path-row");
            if (!entry.exists) pathRow.classList.add("is-missing");
        });
    }
    target.append(section);
}

function capitalizeInitial(value) {
    const text = String(value ?? "");
    return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}

function pathLabel(key, path = "") {
    if (key.startsWith("models_") && path) {
        const parts = String(path).split(/[\\/]+/).filter(Boolean);
        return capitalizeInitial(parts.at(-1) || titleCase(key));
    }
    const fallbacks = {
        comfyui: "ComfyUI", user: "User", input: "Input", output: "Output", temp: "Temp",
        models_checkpoints: "Checkpoints", models_loras: "LoRAs", models_vae: "VAE",
        models_unet: "UNet", models_text_encoders: "Text Encoders", models_controlnet: "ControlNet",
    };
    return label(`pathLabels.${key}`, fallbacks[key] || titleCase(key));
}

async function openPath(key, index) {
    try {
        const response = await api.fetchApi("/wosai/device_info/open_path", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key, index }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (_) {
        showToast(label("openPathFailed", "Could not open this directory."), { icon: "exclamation-triangle" });
    }
}

function renderDependencies(target) {
    const section = card(label("dependencies", "Key Dependencies"), "pi-box");
    for (const [name, item] of Object.entries(data.static?.dependencies || {})) row(section, name, item, { label: capitalizeInitial(name) });
    target.append(section);
}

function exportText(format) {
    if (!data) return;
    let text;
    let type;
    let extension;
    if (format === "markdown") {
        text = reportText(true);
        type = "text/markdown";
        extension = "md";
    } else {
        text = reportText(false);
        type = "text/plain";
        extension = "txt";
    }
    const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `comfyui-device-info-${new Date().toISOString().slice(0, 10)}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
}

function compactReport() {
    const system = data.static?.system || {};
    const runtime = data.static?.runtime || {};
    const gpus = (data.dynamic?.gpus || []).filter((gpu) => gpu.status === "ok").map((gpu) => ({
        id: gpu.id,
        vram: { used: valueOf(gpu.smi_used), total: valueOf(gpu.total), available: valueOf(gpu.smi_free) },
    }));
    const memory = data.dynamic?.memory || {};
    const disks = (data.dynamic?.disks || []).map((disk) => ({
        path: disk.path, used: valueOf(disk.used), total: valueOf(disk.total), available: valueOf(disk.free),
    }));
    return {
        timestamp: data.timestamp,
        health: data.health,
        system: {
            os: valueOf(system.os), python: valueOf(system.python),
            pytorch: valueOf(runtime.pytorch), git: valueOf(data.static?.comfyui?.git),
        },
        hardware: {
            processor: valueOf(system.cpu),
            vram: gpus, memory: { used: valueOf(memory.used), total: valueOf(memory.total), available: valueOf(memory.available) }, disks,
        },
    };
}

function reportText(markdown) {
    const report = compactReport();
    const lines = [];
    const blankLine = () => {
        if (lines.length && lines.at(-1) !== "") lines.push("");
    };
    const heading = (text) => {
        blankLine();
        lines.push(markdown ? `### ${text}` : text);
        lines.push("");
    };
    const item = (name, value) => {
        if (!markdown) {
            lines.push(`${name}: ${value}`);
            return;
        }
        // Keep punctuation outside the bold label so drive names such as `H:` remain valid Markdown.
        const hasTrailingColon = /[:：]$/.test(name);
        const labelText = hasTrailingColon ? name.slice(0, -1) : name;
        const punctuation = hasTrailingColon ? name.slice(-1) : ":";
        lines.push(`- **${labelText}**${punctuation} ${value}`);
    };
    lines.push(markdown ? `## ${label("exportTitle", "ComfyUI environment information")}` : label("exportTitle", "ComfyUI environment information"));
    lines.push("");
    item(label("timestamp", "Timestamp"), report.timestamp);
    item(label("copyright", "Copyright"), WOSAI_COPYRIGHT);
    item(label("github", "GitHub"), markdown ? `[${WOSAI_GITHUB}](${WOSAI_GITHUB})` : WOSAI_GITHUB);
    heading(label("hardware", "Hardware Resources"));
    report.hardware.vram.forEach((gpu) => {
        const gpuLabel = report.hardware.vram.length > 1 ? `${label("vram", "VRAM")} ${gpu.id}` : label("vram", "VRAM");
        item(gpuLabel, usageText({ value: gpu.vram.used }, { value: gpu.vram.total }, { value: gpu.vram.available }));
    });
    item(label("memory", "RAM"), usageText({ value: report.hardware.memory.used }, { value: report.hardware.memory.total }, { value: report.hardware.memory.available }));
    report.hardware.disks.forEach((disk) => {
        // Avoid a trailing Windows separator inside Markdown bold text: `H:\\` would escape the closing `**`.
        const diskPath = disk.path.replace(/[\\/]+$/, "") || disk.path;
        item(`${label("storage", "Disk")} ${diskPath}`, usageText({ value: disk.used }, { value: disk.total }, { value: disk.available }));
    });
    item(label("processor", "Processor"), report.hardware.processor);
    heading(label("system", "Runtime Environment"));
    Object.entries(report.system).forEach(([key, value]) => item(label(key, titleCase(key)), value));
    const staticData = data.static || {};
    heading(label("paths", "ComfyUI Paths"));
    Object.entries(data.paths || {}).forEach(([key, entry]) => (entry?.value || []).forEach((path) => item(pathLabel(key, path.path), path.path)));
    heading(label("dependencies", "Key Dependencies"));
    Object.entries(staticData.dependencies || {}).forEach(([key, dependency]) => item(capitalizeInitial(key), valueOf(dependency)));
    return lines.join("\n");
}

async function copyReport() {
    if (!data) return;
    try {
        await navigator.clipboard.writeText(reportText(true));
        showToast(label("copied", "Device information copied."), { icon: "check", iconColor: "var(--ws-accent)" });
    } catch (_) {
        showToast(label("copyFailed", "Could not copy device information."), { icon: "exclamation-triangle" });
    }
}

async function load(force = false, background = false) {
    if (loading) return;
    loading = true;
    if (!background) render();
    try {
        const refresh = force === "dynamic" ? "dynamic" : force ? "all" : "";
        const response = await fetch(`/wosai/device_info${refresh ? `?refresh=${refresh}` : ""}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.json();
    } catch (error) {
        if (!background || !data) data = { error: error.message };
    } finally {
        loading = false;
        render();
    }
}

function panelIsVisible() {
    if (!panel?.isConnected || document.visibilityState === "hidden") return false;
    const style = getComputedStyle(panel);
    return style.display !== "none" && style.visibility !== "hidden";
}

function startLiveRefresh() {
    clearInterval(liveRefreshTimer);
    liveRefreshTimer = setInterval(() => {
        if (panelIsVisible()) load("dynamic", true);
    }, 2000);
}

function render() {
    if (!panel) return;
    panel.replaceChildren();
    panel.setAttribute("data-theme", getGlassTheme());
    panel.setAttribute("data-wosai-panel", "");
    const root = make("div", "ws-device-info");
    const header = make("header", "ws-di-header");
    const identity = make("div", "ws-di-identity");
    identity.append(make("i", "pi pi-microchip"), make("h1", "", label("title", "Device")));
    header.append(identity);
    const actions = make("div", "ws-di-actions");
    addButton(actions, "refresh", "Refresh", "pi-refresh", () => load(true));
    addButton(actions, "copy", "Copy", "pi-copy", copyReport);
    const exportSelect = make("select", "ws-di-export");
    exportSelect.title = label("export", "Export");
    [["", label("export", "Export")], ["txt", "TXT"], ["markdown", "MD"]].forEach(([value, text]) => {
        const option = make("option", "", text);
        option.value = value;
        exportSelect.append(option);
    });
    exportSelect.addEventListener("change", () => { if (exportSelect.value) { exportText(exportSelect.value); exportSelect.value = ""; } });
    actions.append(exportSelect);
    header.append(actions);
    root.append(header);
    if (loading) root.append(make("div", "ws-di-loading", label("loading", "Collecting device information…")));
    else if (data?.error) root.append(make("div", "ws-di-error", `${label("loadFailed", "Could not load device information.")} ${data.error}`));
    else if (data) {
        const content = make("main", "ws-di-content");
        renderHealth(content);
        renderSummary(content);
        renderSystem(content);
        renderPaths(content);
        renderDependencies(content);
        content.append(make("footer", "ws-di-copyright", WOSAI_COPYRIGHT));
        root.append(content);
    } else root.append(make("div", "ws-di-loading", label("loading", "Collecting device information…")));
    panel.append(root);
}

function mount(element) {
    panel = element;
    offLangChange?.();
    offGlassChange?.();
    offLangChange = onLangChange(render);
    offGlassChange = onGlassChange(render);
    startLiveRefresh();
    render();
    load();
}

app.registerExtension({
    name: "WOSAI.DeviceInfo",
    async setup() {
        ensureCSS();
        if (!app.extensionManager?.registerSidebarTab) return;
        app.extensionManager.registerSidebarTab({
            id: TAB_ID,
            icon: "pi pi-microchip",
            title: label("title", "Device"),
            tooltip: label("title", "Device"),
            type: "custom",
            render: mount,
        });
    },
    remove() {
        offLangChange?.();
        offGlassChange?.();
        clearInterval(liveRefreshTimer);
        liveRefreshTimer = null;
        panel = null;
    },
});
