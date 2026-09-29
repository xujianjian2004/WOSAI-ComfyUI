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
        ["wosai-device-info-css", new URL("./styles/device-info.css?v=7", import.meta.url).href],
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

const BYTE_UNITS = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4, PB: 1024 ** 5 };

/** 把后端已格式化的容量串（如 "20.2 GB"）还原成字节数；格式不符时返回 null。 */
function parseSize(text) {
    const match = /^([\d.]+)\s*([KMGTPE]?B)$/i.exec(String(text ?? "").trim());
    if (!match) return null;
    const bytes = Number(match[1]) * (BYTE_UNITS[match[2].toUpperCase()] ?? 1);
    return Number.isFinite(bytes) ? bytes : null;
}

/** 占用率（0–100，保留一位小数）。任一侧缺失或总量为 0 时返回 null，由调用方退化为纯文本。 */
function percentOf(used, total) {
    const part = parseSize(used);
    const whole = parseSize(total);
    if (part === null || whole === null || whole <= 0) return null;
    return Math.min(100, Math.round((part / whole) * 1000) / 10);
}

/** `Number(null)` 与 `Number("")` 都是 0，必须先挡掉，否则缺失的占用率会渲染成误导性的 0% 空条。 */
function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/** 占用条的三档阈值。90% 与后端 `_health()` 的磁盘告警判据同源，不另造一套标准。 */
function usageTone(percent) {
    if (percent === null) return "unknown";
    if (percent >= 90) return "crit";
    if (percent >= 70) return "warn";
    return "ok";
}

/** 展示用短名：抹掉厂商前缀，"NVIDIA GeForce RTX 5090" → "RTX 5090"。 */
function gpuShortName(gpu) {
    const name = valueOf(gpu.name, "").replace(/^(NVIDIA|AMD|Intel)\s+(GeForce|Radeon|Arc)?\s*/i, "");
    return name || label("gpu", "GPU");
}

/** 紧凑用量："20.2 GB 已用 / 3.7 GB 可用 / 总计 24.0 GB" → "20.2 / 24.0 GB"。 */
function pairText(usedItem, totalItem) {
    const used = valueOf(usedItem, "—").replace(/\s*[KMGTPE]?B\b/, "").trim() || "—";
    return `${used} / ${valueOf(totalItem, "—")}`;
}

const RING_CIRCUMFERENCE = 2 * Math.PI * 18;
// 静态模板，不含任何插值：数值与配色一律在写入后由 JS / CSS 赋予
const HEALTH_RING = "<svg viewBox=\"0 0 46 46\" aria-hidden=\"true\">"
    + "<circle class=\"ws-di-ring-track\" cx=\"23\" cy=\"23\" r=\"18\"></circle>"
    + "<circle class=\"ws-di-ring-value\" cx=\"23\" cy=\"23\" r=\"18\" transform=\"rotate(-90 23 23)\"></circle>"
    + "<text class=\"ws-di-ring-text\" x=\"23\" y=\"23\" text-anchor=\"middle\" dominant-baseline=\"central\"></text>"
    + "</svg>";

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

function okGpus() {
    return (data.dynamic?.gpus || []).filter((gpu) => gpu.status === "ok");
}

/**
 * 一根占用条。percent 为 null 时不画填充（避免渲染成 0% 这种误导性的空条），只留占位以维持行内对齐。
 * 同时写入 role=progressbar 与 aria-valuenow，屏幕阅读器可直接读出占用率。
 */
function usageBar(percent, { large = false, name = "" } = {}) {
    const bar = make("span", `ws-di-bar is-${usageTone(percent)}${large ? " is-large" : ""}`);
    if (percent === null) return bar;
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuenow", String(Math.round(percent)));
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    if (name) bar.setAttribute("aria-label", name);
    const fill = make("i");
    fill.style.width = `${percent}%`;
    bar.append(fill);
    return bar;
}

function percentText(percent) {
    const text = percent === null ? label("unavailable", "Unavailable") : `${percent}%`;
    return make("span", `ws-di-percent is-${usageTone(percent)}`, text);
}

/** 概览磁贴：名称 / 大号占用率 + 用量 / 占用条。 */
function tile(name, percent, detail) {
    const element = make("div", "ws-di-metric");
    element.dataset.search = `${name} ${detail}`.toLowerCase();
    element.append(make("span", "ws-di-metric-name", name));
    const line = make("div", "ws-di-metric-value");
    line.append(make("strong", "", percent === null ? label("unavailable", "Unavailable") : `${percent}%`));
    line.append(make("span", "ws-di-metric-detail", detail));
    element.append(line);
    element.append(usageBar(percent, { name }));
    return element;
}

/** 带占用条的行：名称 / 条 / 占用率 / 紧凑用量。 */
function usageRow(parent, name, percent, detail) {
    const element = make("div", "ws-di-row ws-di-usage-row");
    element.dataset.search = `${name} ${detail}`.toLowerCase();
    element.append(make("span", "ws-di-label", name));
    element.append(usageBar(percent, { name }));
    element.append(percentText(percent));
    element.append(make("span", "ws-di-value", detail));
    parent.append(element);
    return element;
}

function legendItem(kind, text) {
    const item = make("span");
    item.append(make("i", `ws-di-swatch${kind ? ` is-${kind}` : ""}`));
    item.append(document.createTextNode(text));
    return item;
}

/**
 * 显存的四层口径：`allocated ⊆ reserved ⊆ 驱动已用 ⊆ 总量` 是**包含**关系而非相加。
 * 拆成段宽展示后，"驱动占了 20 G、PyTorch 只认领 1 G" 这类碎片问题一眼可见。
 * 任一层缺失时返回 null，退回单段总占用条。
 */
function vramSegments(gpu) {
    const total = parseSize(valueOf(gpu.total, ""));
    if (!total) return null;
    const allocated = Math.max(parseSize(valueOf(gpu.pytorch_allocated, "")) ?? 0, 0);
    const reserved = Math.max(parseSize(valueOf(gpu.pytorch_reserved, "")) ?? allocated, allocated);
    const used = Math.max(parseSize(valueOf(gpu.smi_used, "")) ?? reserved, reserved);
    const occupied = Math.min(used, total);
    return {
        total,
        allocated,
        reserved: Math.min(reserved, occupied),
        used: occupied,
        free: Math.max(total - occupied, 0),
        percent: Math.round((occupied / total) * 1000) / 10,
    };
}

function vramBar(segments) {
    const bar = make("span", "ws-di-bar is-large is-stacked");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuenow", String(Math.round(segments.percent)));
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-label", label("vram", "VRAM"));
    const parts = [
        ["allocated", segments.allocated],
        ["reserved", segments.reserved - segments.allocated],
        ["other", segments.used - segments.reserved],
    ];
    for (const [kind, bytes] of parts) {
        const fill = make("i", `is-${kind}`);
        fill.style.width = `${(bytes / segments.total) * 100}%`;
        bar.append(fill);
    }
    return bar;
}

function gpuBlock(gpu, indexed) {
    const block = make("div", "ws-di-gpu");
    const head = make("div", "ws-di-gpu-head");
    head.append(make("h3", "", indexed ? `${label("gpu", "GPU")} ${gpu.id}` : label("gpu", "GPU")));
    head.append(make("span", "ws-di-gpu-name", valueOf(gpu.name, label("unavailable", "Unavailable"))));
    block.append(head);

    const segments = vramSegments(gpu);
    const percent = segments?.percent ?? percentOf(valueOf(gpu.smi_used, ""), valueOf(gpu.total, ""));
    const usage = make("div", "ws-di-gpu-usage");
    usage.append(segments ? vramBar(segments) : usageBar(percent, { large: true, name: label("vram", "VRAM") }));
    usage.append(percentText(percent));
    block.append(usage);

    // 只有四层口径齐备时才画图例，否则色块的语义会对不上
    if (segments && valueOf(gpu.smi_used, "")) {
        const legend = make("div", "ws-di-legend");
        [
            ["", "pytorchAllocated", gpu.pytorch_allocated],
            ["reserved", "pytorchReserved", gpu.pytorch_reserved],
            ["other", "smiUsed", gpu.smi_used],
            ["free", "free", gpu.smi_free],
        ].forEach(([kind, key, item]) => legend.append(legendItem(kind, `${label(key, titleCase(key))} ${resourceValue(item)}`)));
        block.append(legend);
    }

    const chips = make("div", "ws-di-chips");
    [
        ["vramTotal", gpu.total],
        ["temperature", gpu.temperature],
        ["power", gpu.power],
        ["driver", gpu.driver],
    ].forEach(([key, item]) => {
        if (valueOf(item, "")) chips.append(pill(`${label(key, titleCase(key))}: ${valueOf(item)}`));
    });
    if (chips.childElementCount) block.append(chips);
    return block;
}

/** 概览：把最该一眼看到的数字提到最前，细节仍留在下方各卡里。 */
function renderOverview(target) {
    const section = card(label("summary", "Overview"), "pi-chart-bar");
    const tiles = make("div", "ws-di-tiles");
    const gpus = okGpus();
    if (gpus.length) {
        const gpu = gpus[0];
        const name = gpus.length > 1 ? `${label("gpu", "GPU")} ${gpu.id}` : label("vram", "VRAM");
        tiles.append(tile(`${name} · ${gpuShortName(gpu)}`, percentOf(valueOf(gpu.smi_used, ""), valueOf(gpu.total, "")), pairText(gpu.smi_used, gpu.total)));
    }
    const memory = data.dynamic?.memory || {};
    tiles.append(tile(label("memory", "RAM"), numberOrNull(memory.percent?.value) ?? percentOf(valueOf(memory.used, ""), valueOf(memory.total, "")), pairText(memory.used, memory.total)));
    (data.dynamic?.disks || []).forEach((disk) => {
        tiles.append(tile(`${label("storage", "Disk")} ${disk.path}`, numberOrNull(disk.percent?.value) ?? percentOf(valueOf(disk.used, ""), valueOf(disk.total, "")), pairText(disk.used, disk.total)));
    });
    section.append(tiles);
    target.append(section);
}

function renderHealth(target) {
    const section = card(label("health", "Environment Health"), "pi-heart");
    const health = data.health || { score: 0, issues: [] };
    const body = make("div", "ws-di-health");
    body.append(healthRing(Number(health.score) || 0));
    const text = make("div", "ws-di-health-text");
    text.append(make("span", "", `${label("healthScore", "Health score")} / 100`));
    const issues = make("div", "ws-di-issues");
    if (!health.issues?.length) issues.append(pill(label("healthy", "No issues detected"), "good"));
    else health.issues.forEach((issue) => issues.append(pill(label(`issues.${issue}`, titleCase(issue)), issue === "cuda_unavailable" ? "warning" : "danger")));
    text.append(issues);
    body.append(text);
    section.append(body);
    target.append(section);
}

function healthRing(score) {
    const tone = score >= 80 ? "good" : score >= 60 ? "warning" : "danger";
    const ring = make("div", `ws-di-ring is-${tone}`);
    ring.setAttribute("role", "img");
    ring.setAttribute("aria-label", `${label("healthScore", "Health score")} ${score}/100`);
    ring.innerHTML = HEALTH_RING;
    const clamped = Math.max(0, Math.min(100, score));
    const value = ring.querySelector(".ws-di-ring-value");
    value.setAttribute("stroke-dasharray", RING_CIRCUMFERENCE.toFixed(2));
    value.setAttribute("stroke-dashoffset", (RING_CIRCUMFERENCE * (1 - clamped / 100)).toFixed(2));
    ring.querySelector(".ws-di-ring-text").textContent = String(score);
    return ring;
}

/**
 * 运行环境卡：环境标识（系统 / Python / PyTorch / Git）与关键依赖版本同处一卡。
 * 依赖作为卡内分节，用小节标签把「环境本身」与「装了哪些包」分开——否则 `Git` 下面紧跟
 * 一行 `Torch`，会被读成 `PyTorch` 那一行的重复。
 */
function renderEnvironment(target) {
    const section = card(label("system", "Runtime Environment"), "pi-desktop");
    const system = data.static?.system || {};
    const runtime = data.static?.runtime || {};
    row(section, "os", system.os, { label: label("os", "OS") });
    row(section, "python", system.python, { label: label("python", "Python") });
    row(section, "pytorch", runtime.pytorch, { label: label("pytorch", "PyTorch") });
    row(section, "git", data.static?.comfyui?.git, { label: label("git", "Git") });
    section.append(make("h3", "ws-di-group-label", label("dependencies", "Key Dependencies")));
    for (const [name, item] of Object.entries(data.static?.dependencies || {})) row(section, name, item, { label: capitalizeInitial(name) });
    target.append(section);
}

function renderHardware(target) {
    const section = card(label("hardware", "Hardware Resources"), "pi-microchip");
    const system = data.static?.system || {};
    const gpus = okGpus();
    if (!gpus.length) section.append(make("p", "ws-di-empty", label("noGpu", "No GPU information available.")));
    gpus.forEach((gpu) => section.append(gpuBlock(gpu, gpus.length > 1)));
    const memory = data.dynamic?.memory || {};
    usageRow(section, label("memory", "RAM"), numberOrNull(memory.percent?.value) ?? percentOf(valueOf(memory.used, ""), valueOf(memory.total, "")), pairText(memory.used, memory.total));
    (data.dynamic?.disks || []).forEach((disk) => {
        usageRow(section, `${label("storage", "Disk")} ${disk.path}`, numberOrNull(disk.percent?.value) ?? percentOf(valueOf(disk.used, ""), valueOf(disk.total, "")), pairText(disk.used, disk.total));
    });
    row(section, "processor", system.cpu, { label: label("processor", "Processor") });
    target.append(section);
}

/** 导出报告沿用的三段式用量文本；面板内已改用占用条 + 紧凑用量。 */
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
        renderEnvironment(content);
        renderOverview(content);
        renderHealth(content);
        renderHardware(content);
        renderPaths(content);
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
