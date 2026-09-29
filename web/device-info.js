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
        ["wosai-device-info-css", new URL("./styles/device-info.css?v=13", import.meta.url).href],
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
    // 空数组同样算「没有值」：启动参数为空时 `[].join(" ")` 是空串，会渲染成一片空白。
    if (Array.isArray(item.value)) return item.value.length ? item.value.join(" ") : fallback;
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

function card(title, icon, options = {}) {
    const section = make("section", "ws-di-card");
    // data-section 供真实浏览器验收定位：卡片标题随界面语言变化，不能拿它当选择器。
    if (options.id) section.dataset.section = options.id;
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
    const name = options.label || titleCase(key);
    element.append(make("span", "ws-di-label", name));
    const value = make("span", `ws-di-value${item?.status === "error" ? " is-error" : ""}`, display);
    if (item?.error) value.title = item.error;
    if (options.badge) value.append(make("span", "ws-di-badge", options.badge));
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

/** 概览磁贴：名称 / 大号占用率 + 用量 / 占用条。 */
function tile(name, percent, detail) {
    const element = make("div", "ws-di-metric");
    element.append(make("span", "ws-di-metric-name", name));
    const line = make("div", "ws-di-metric-value");
    line.append(make("strong", "", percent === null ? label("unavailable", "Unavailable") : `${percent}%`));
    line.append(make("span", "ws-di-metric-detail", detail));
    element.append(line);
    element.append(usageBar(percent, { name }));
    return element;
}

/**
 * 无量化指标的信息磁贴：沿用占用率磁贴的外壳，但大号位放型号文本、不画占用条。
 * 处理器没有后端采集的占用率 —— 硬塞一根空条只会被读成「这项数据没加载出来」，
 * 而型号本来就没有百分比可言。空值时走与占用率磁贴一致的「不可用」降级，不画假条。
 */
function textTile(name, value) {
    const element = make("div", "ws-di-metric is-static");
    element.append(make("span", "ws-di-metric-name", name));
    element.append(make("span", "ws-di-metric-text", value));
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

/**
 * 运行环境卡：环境标识（Python / PyTorch / CUDA / cuDNN / ComfyUI / Git）与关键依赖版本同处一卡。
 * 一卡两栏——左栏答「环境是什么」，右栏答「装了哪些包」——同样的信息少占约四成高度。
 * 左栏不列操作系统 / 系统架构 / 解释器路径：装完就不再变的机器指纹，不参与排障决策
 * （数据仍由后端采集，导出报告里照样能读到 `system.os`）。
 * 依赖原先靠小节标签在纵向划界（否则 `Git` 下面紧跟一行 `Torch` 会被读成 `PyTorch` 的重复），
 * 改横向分栏后这个歧义自然消失，标签改为栏标题留在右栏顶部，与左栏首行同高对齐。
 * 窄侧边栏下由栅格 auto-fit 自动塌成单栏；右栏因数据缺失整栏隐藏时，左栏作为唯一栅格项占满整行。
 */
function renderEnvironment(target) {
    const section = card(label("system", "Runtime Environment"), "pi-desktop", { id: "environment" });
    const system = data.static?.system || {};
    const runtime = data.static?.runtime || {};
    const comfyui = data.static?.comfyui || {};

    const columns = make("div", "ws-di-columns");
    const identity = make("div", "ws-di-column");
    identity.dataset.column = "identity";
    row(identity, "python", system.python, { label: label("python", "Python") });
    row(identity, "pytorch", runtime.pytorch, { label: label("pytorch", "PyTorch") });
    row(identity, "cudaRuntime", runtime.cuda_runtime, { label: label("cudaRuntime", "CUDA runtime") });
    row(identity, "cudnn", runtime.cudnn, { label: label("cudnn", "cuDNN") });
    row(identity, "comfyui", comfyui.version, { label: label("comfyui", "ComfyUI") });
    row(identity, "git", comfyui.git, { label: label("git", "Git") });
    columns.append(identity);

    const dependencies = dependencyEntries(runtime);
    if (dependencies.length) {
        const deps = make("div", "ws-di-column");
        deps.dataset.column = "dependencies";
        deps.append(make("h3", "ws-di-group-label", label("dependencies", "Key Dependencies")));
        for (const [name, item] of dependencies) row(deps, name, item, { label: capitalizeInitial(name) });
        columns.append(deps);
    }

    section.append(columns);
    target.append(section);
}

/**
 * 依赖清单里剔除已被上方基础行覆盖的包。`Torch` 与 `PyTorch` 是同一个包被
 * `importlib.metadata.version` 与 `torch.__version__` 各报了一次，同一张卡里并排两行、
 * 版本号逐字相同，读者只会当成渲染重复。
 * 仅当两个版本号一致时才剔除：口径不同意味着它们**可能**不一致（源码构建或可编辑安装时
 * `__version__` 带本地后缀而元数据不带），那时两行并存本身就是值得暴露的信号。
 */
function dependencyEntries(runtime) {
    const runtimeVersion = valueOf(runtime.pytorch, "");
    return Object.entries(data.static?.dependencies || {}).filter(([name, item]) => (
        !(name === "torch" && runtimeVersion && valueOf(item, "") === runtimeVersion)
    ));
}


/**
 * 硬件资源：磁贴行（处理器 / 显存 / 内存 / 各磁盘）→ GPU 体征区块。
 * 磁贴与 GPU 块讲的是同一件事的两层——磁贴答「满了多少」，GPU 块答「这些占用由什么构成」——
 * 所以 GPU 块不再复述百分比，只留磁贴给不出的三层显存构成、图例与温度/功耗/驱动。
 * 处理器也曾是一条朴素行，但它是这台机器的固定配置而非实时指标，与磁贴同列扫读更顺；
 * 具体见 `textTile()` 为何不走占用率磁贴的形状。
 */
function renderHardware(target) {
    const section = card(label("hardware", "Hardware Resources"), "pi-microchip", { id: "hardware" });
    const system = data.static?.system || {};
    const gpus = okGpus();

    const tiles = make("div", "ws-di-tiles");
    // 处理器排在首位：它是这台机器的固定配置而非实时指标，先答「机器是什么」再答「占用多少」
    tiles.append(textTile(label("processor", "Processor"), valueOf(system.cpu, label("unavailable", "Unavailable"))));
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

    if (!gpus.length) section.append(make("p", "ws-di-empty", label("noGpu", "No GPU information available.")));
    gpus.forEach((gpu) => section.append(gpuBlock(gpu, gpus.length > 1)));
    target.append(section);
}

/** 导出报告沿用的三段式用量文本；面板内已改用占用条 + 紧凑用量。 */
function usageText(used, total, available) {
    return `${resourceValue(used)} ${label("used", "Used")} / ${resourceValue(available)} ${label("available", "Available")} / ${label("totalLabel", "Total")} ${resourceValue(total)}`;
}

function renderPaths(target) {
    const section = card(label("paths", "ComfyUI Paths"), "pi-folder", { id: "paths" });
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
                // 只读目录照样能打开，只是写不进去——标出来，免得用户把保存失败归因到别处。
                // 目录不存在时后端同样报 writable=false，那是「缺失」不是「只读」，不标。
                badge: entry.exists && !entry.writable ? label("readonly", "Read-only") : "",
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

/** HTTP 状态 → 可解释的原因。兜底文案与面板其它行一致为英文，本地化由 locale 承担。 */
const OPEN_PATH_REASONS = {
    403: ["openPathBlocked", "The browser blocked this request (cross-site origin)."],
    404: ["openPathMissing", "This directory is missing or has moved."],
};

/**
 * 请后端在系统文件管理器中打开该目录。
 *
 * 这一跳的结果在前端无从验证——浏览器拿不到「资源管理器是否真的弹出来了」，
 * 所以后端没报错就等于成功。反过来，失败原因**全在服务端**，而只弹一句
 * 「无法打开此目录」会把「点了没反应」这个最难排查的形态固化下来：用户既
 * 不知道是目录没了、请求被拒，还是自定义节点压根没加载。故按状态码给出可
 * 读的原因，原始响应写进控制台。
 */
async function openPath(key, index) {
    const generic = () => label("openPathFailed", "Could not open this directory.");
    try {
        const response = await api.fetchApi("/wosai/device_info/open_path", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key, index }),
        });
        if (response.ok) return;
        let detail = null;
        // 反代 / 节点未加载时常回 HTML，解析失败不能盖掉状态码本身
        try { detail = await response.json(); } catch (_) { /* 非 JSON 响应，忽略 */ }
        console.error(`[WOSAI] open_path ${key}[${index}] → HTTP ${response.status}`, detail || response);
        const [reasonKey, reasonFallback] = OPEN_PATH_REASONS[response.status] || [];
        showToast(reasonKey ? label(reasonKey, reasonFallback) : `${generic()} (HTTP ${response.status})`,
            { icon: "exclamation-triangle", duration: 4000 });
    } catch (error) {
        console.error(`[WOSAI] open_path ${key}[${index}] 请求未送达`, error);
        showToast(generic(), { icon: "exclamation-triangle", duration: 4000 });
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
        renderHardware(content);
        renderEnvironment(content);
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
