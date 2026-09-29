// ══ WOSAI 系统设置（子球·设置）：界面语言 / 性能模式 /  ══
import { app } from "../../../scripts/app.js";
import { getGlassTheme, getGlassMode, setGlassMode, onGlassChange, GLASS_MODE_DEFS } from "./shared/glass-theme.js";
import { registerHudTab, unregisterHudTab } from "./shared/hud-kit.js";
import { iconBtn } from "./shared/svg-icons.js";
import { _sec, buildControlPanel } from "./shared/panel-builder.js";
import { dodgeBall, createLauncher, removeLauncher } from "./launcher.js";
import { t, onLangChange } from "./shared/i18n.js";
import { wosaiGetBool, wosaiGetInt, wosaiSetBool, wosaiSetInt } from "./shared/wosai-prefs.js";
import { calcSnapToNodeSide } from "./shared/canvas-utils.js";
import { WOSAI_COPYRIGHT, STORAGE_KEYS } from "./shared/constants.js";
import { retryUntil } from "./shared/shared-utils.js";

const SEC_STYLE = "font-size:var(--ws-text-md);font-weight:500;color:var(--ws-accent);margin:var(--ws-gap-lg) 0 var(--ws-gap)";

// ComfyUI's extension-level `settings: []` compatibility varies between
// frontend generations. Register WOSAI settings through the same stable API
// used by RunHighlight, from one owner, so fields cannot disappear because of
// extension load order or duplicate module instances.
const _nativeSettingIds = new Set();

function _existingNativeSetting(id) {
    const definitions = app.ui?.settings?.settings;
    if (Array.isArray(definitions)) return definitions.find((item) => item?.id === id) || null;
    if (definitions instanceof Map) return definitions.get(id) || null;
    return null;
}

function _addNativeSetting(definition) {
    if (_nativeSettingIds.has(definition.id)) return _existingNativeSetting(definition.id);
    const existing = _existingNativeSetting(definition.id);
    if (existing) {
        _nativeSettingIds.add(definition.id);
        return existing;
    }
    try {
        const setting = app.ui.settings.addSetting(definition);
        _nativeSettingIds.add(definition.id);
        return setting;
    } catch (error) {
        // Some frontend builds throw on duplicate IDs instead of returning the
        // existing definition. Treat a now-visible definition as success.
        const duplicate = _existingNativeSetting(definition.id);
        if (duplicate) {
            _nativeSettingIds.add(definition.id);
            return duplicate;
        }
        console.error(`[WOSAI Settings] Failed to register ${definition.id}`, error);
        return null;
    }
}

function _readonlySetting(text) {
    const element = document.createElement("div");
    element.textContent = text;
    element.style.cssText = "padding:var(--ws-gap-sm) 0;color:var(--ws-text-secondary);font-size:var(--ws-text-base);user-select:text";
    return element;
}

async function registerNativeWosaiSettings() {
    try {
        await retryUntil(() => typeof app.ui?.settings?.addSetting === "function", 50, 100);
    } catch (error) {
        console.error("[WOSAI Settings] ComfyUI settings API unavailable", error);
        return;
    }

    const root = t("common.wosaiCustomize");
    const system = t("common.settings");
    const assistant = t("common.wosaiAssistant");
    const canvasTools = t("common.wosaiCanvasTools");
    const linkTools = t("common.wosaiLinkTools");
    const performance = t("menus.performance.title");

    const definitions = [
        {
            id: "wosai-glass-theme",
            name: t("settings.themeSwitch", "Theme"),
            category: [root, system, t("settings.themeSwitch", "Theme")],
            type: "combo",
            options: ["auto", "light", "dark"],
            defaultValue: getGlassMode(),
            onChange: (value) => setGlassMode(value),
        },
        {
            id: STORAGE_KEYS.fps,
            name: t("common.linkAnimation"),
            category: [root, system, t("common.linkAnimation")],
            type: "combo",
            options: ["60", "45", "30"],
            defaultValue: localStorage.getItem(STORAGE_KEYS.fps) || "60",
            onChange: (value) => localStorage.setItem(STORAGE_KEYS.fps, String(value)),
        },
        {
            id: STORAGE_KEYS.showLauncher,
            name: t("settings.WOSAI.ColorBar.ShowLauncher.name", t("menus.colorBar.showLauncher")),
            category: [root, assistant, t("menus.colorBar.showLauncher")],
            type: "boolean",
            defaultValue: localStorage.getItem(STORAGE_KEYS.showLauncher) !== "false",
            onChange: (value) => {
                const enabled = !!value;
                localStorage.setItem(STORAGE_KEYS.showLauncher, enabled ? "true" : "false");
                if (enabled) createLauncher(); else removeLauncher();
            },
        },
        {
            id: "WOSAI.ColorBar.HoldMode",
            name: t("settings.WOSAI.ColorBar.HoldMode.name", t("menus.colorBar.holdMode")),
            category: [root, assistant, t("menus.colorBar.holdMode")],
            type: "boolean",
            defaultValue: false,
        },
        {
            id: "WOSAI.LayoutToolkit.Crosshair",
            name: t("settings.WOSAI.LayoutToolkit.Crosshair.name", t("menus.layoutToolkit.crosshairSetting")),
            category: [root, canvasTools, t("menus.layoutToolkit.crosshairCategory")],
            type: "boolean",
            defaultValue: true,
            onChange: (value) => window.__wosaiSetCrosshairEnabled?.(!!value),
        },
        {
            id: STORAGE_KEYS.miniBarCompact,
            name: t("menus.hubBar.compactMode", "Compact MiniBar"),
            category: [root, canvasTools, t("menus.hubBar.compactMode", "Compact MiniBar")],
            type: "boolean",
            defaultValue: localStorage.getItem(STORAGE_KEYS.miniBarCompact) !== "false",
            onChange: (value) => {
                const enabled = !!value;
                localStorage.setItem(STORAGE_KEYS.miniBarCompact, enabled ? "true" : "false");
                window.__wosaiSetMiniBarCompactMode?.(enabled);
            },
        },
        {
            id: "wosai-autoConnect",
            name: t("menus.hubBar.autoConnect"),
            category: [root, linkTools, t("menus.hubBar.autoConnect")],
            type: "boolean",
            defaultValue: wosaiGetBool("wosai-autoConnect", true),
            onChange: (value) => wosaiSetBool("wosai-autoConnect", !!value),
        },
        {
            id: "wosai-shakeEnabled",
            name: t("menus.hubBar.shake"),
            category: [root, linkTools, t("menus.hubBar.shake")],
            type: "boolean",
            defaultValue: wosaiGetBool("wosai-shakeEnabled", true),
            onChange: (value) => wosaiSetBool("wosai-shakeEnabled", !!value),
        },
        {
            id: "wosai-shakeReversals",
            name: t("settings.shakeReversals", "Shake reversals"),
            category: [root, linkTools, t("menus.hubBar.shake")],
            type: "slider",
            defaultValue: wosaiGetInt("wosai-shakeReversals", 3),
            attrs: { min: 2, max: 6, step: 1 },
            min: 2,
            max: 6,
            step: 1,
            onChange: (value) => wosaiSetInt("wosai-shakeReversals", Math.max(2, Math.min(6, Number(value) || 3))),
        },
        ...[
            ["wosai-perf-singleCanvasPan", "menus.performance.pan", true],
            ["wosai-perf-throttleRenderInfo", "menus.performance.throttle", true],
            ["wosai-perf-disableShadows", "menus.performance.shadow", false],
            ["wosai-perf-disableConnectionBorders", "menus.performance.border", false],
            ["wosai-perf-disableRoundedCorners", "menus.performance.radius", false],
        ].map(([id, labelKey, defaultValue]) => ({
            id,
            name: t(labelKey),
            category: [root, performance, t(labelKey)],
            type: "boolean",
            defaultValue: wosaiGetBool(id, defaultValue),
            onChange: (value) => {
                wosaiSetBool(id, !!value);
                window.__wosaiSetPerf?.(id, !!value);
            },
        })),
        {
            id: STORAGE_KEYS.menuHideEnabled,
            name: t("settings.menuHideEnable"),
            category: [root, system, t("settings.menuHide")],
            type: "boolean",
            defaultValue: localStorage.getItem(STORAGE_KEYS.menuHideEnabled) === "true",
            onChange: (value) => {
                localStorage.setItem(STORAGE_KEYS.menuHideEnabled, value ? "true" : "false");
                window.__wosaiMenuHide?.setEnabled?.(!!value);
            },
        },
        {
            id: "WOSAI.About.Copyright",
            name: t("settings.WOSAI.About.Copyright.name", t("menus.colorBar.aboutDescription")),
            category: [root, t("common.wosaiAbout"), t("menus.colorBar.copyright")],
            defaultValue: "",
            type: () => _readonlySetting(WOSAI_COPYRIGHT),
        },
    ];

    for (const definition of definitions) {
        const setting = _addNativeSetting(definition);
        if (setting?.value !== undefined && typeof definition.onChange === "function") {
            try {
                definition.onChange(setting.value);
            } catch (error) {
                console.error(`[WOSAI Settings] Failed to apply ${definition.id}`, error);
            }
        }
    }
}

// ── 应用层 ──
function exportCfg() {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.toLowerCase().startsWith("wosai")) o[k] = localStorage.getItem(k);
    }
    const blob = new Blob([JSON.stringify(o, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "wosai-config.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importCfg(file) {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => { try { const o = JSON.parse(fr.result); Object.keys(o).forEach(k => { if (k.toLowerCase().startsWith("wosai")) localStorage.setItem(k, o[k]); }); location.reload(); } catch (_) { console.warn("[WOSAI]", t('common.invalidConfig')); } };
    fr.readAsText(file);
}

// ── 面板 ──
let _panel = null;
function _select(opts, val, onChange) {
    const s = document.createElement("select"); s.style.cssText = "width:100%;height:var(--ws-set-select-h);border-radius:var(--ws-set-select-radius);background:var(--ws-surface-2);color:var(--ws-text);border:var(--ws-border-width-thin) solid var(--ws-border);font-size:var(--ws-text-md);padding:var(--ws-set-select-padding)";
    opts.forEach(([k, lb]) => { const o = document.createElement("option"); o.value = k; o.textContent = lb; if (k === val) o.selected = true; s.appendChild(o); });
    s.onchange = () => onChange(s.value); return s;
}
function _buildSystemSettingsSection() {
    const root = document.createElement("div");
    root.className = "wosai-system-settings-section wosai-control-section";
    root.style.cssText = "display:flex;flex-direction:column";

    root.appendChild(_sec(t('common.linkAnimation'), SEC_STYLE));
    const fps = localStorage.getItem(STORAGE_KEYS.fps) || "60";
    root.appendChild(_select([["60", t('common.fpsNormal60')], ["45", t('common.fpsEco45')], ["30", t('common.fpsLow30')]], fps, (value) => localStorage.setItem(STORAGE_KEYS.fps, value)));

    root.appendChild(_sec(t('settings.themeSwitch', 'Theme'), SEC_STYLE));
    const themeTabs = document.createElement("div");
    themeTabs.className = "wosai-theme-mode-tabs";
    const modeButtons = new Map();
    const syncThemeModeTabs = () => {
        const activeMode = getGlassMode();
        modeButtons.forEach((button, mode) => button.classList.toggle("is-active", mode === activeMode));
    };
    for (const mode of ["auto", "light", "dark"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "wosai-theme-mode-tab";
        button.textContent = GLASS_MODE_DEFS[mode].label;
        button.title = GLASS_MODE_DEFS[mode].tip;
        button.onclick = () => { setGlassMode(mode); syncThemeModeTabs(); };
        modeButtons.set(mode, button);
        themeTabs.appendChild(button);
    }
    syncThemeModeTabs();
    root.appendChild(themeTabs);

    root.appendChild(_sec(t('settings.showOrb', 'Show Floating Orb'), SEC_STYLE));
    const orbRow = document.createElement("label");
    orbRow.style.cssText = "display:flex;align-items:center;gap:var(--ws-gap-md);margin:var(--ws-gap) 0;cursor:pointer";
    const orb = document.createElement("input");
    orb.type = "checkbox"; orb.checked = localStorage.getItem(STORAGE_KEYS.showLauncher) !== "false";
    orb.style.cssText = "width:var(--ws-icon-size);height:var(--ws-icon-size);accent-color:var(--ws-accent)";
    const orbLabel = document.createElement("span");
    const syncOrbLabel = () => { orbLabel.textContent = orb.checked ? t('settings.showOrbOn') : t('settings.showOrbOff'); };
    syncOrbLabel();
    orb.onchange = () => {
        localStorage.setItem(STORAGE_KEYS.showLauncher, orb.checked ? "true" : "false");
        syncOrbLabel();
        if (orb.checked) createLauncher(); else removeLauncher();
    };
    orbRow.append(orb, orbLabel); root.appendChild(orbRow);

    root.appendChild(_sec(t('menus.performance.title'), SEC_STYLE));
    for (const [id, labelKey, defaultValue] of [
        ["wosai-perf-singleCanvasPan", "menus.performance.pan", true],
        ["wosai-perf-throttleRenderInfo", "menus.performance.throttle", true],
        ["wosai-perf-disableShadows", "menus.performance.shadow", false],
        ["wosai-perf-disableConnectionBorders", "menus.performance.border", false],
        ["wosai-perf-disableRoundedCorners", "menus.performance.radius", false],
    ]) {
        const row = document.createElement("label");
        row.style.cssText = "display:flex;align-items:center;gap:var(--ws-gap-md);margin:var(--ws-gap) 0;cursor:pointer";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox"; checkbox.checked = wosaiGetBool(id, defaultValue);
        checkbox.style.cssText = "width:var(--ws-icon-size);height:var(--ws-icon-size);accent-color:var(--ws-accent)";
        checkbox.onchange = () => window.__wosaiSetPerf?.(id, checkbox.checked);
        const label = document.createElement("span"); label.textContent = t(labelKey);
        row.append(checkbox, label); root.appendChild(row);
    }

    root.appendChild(_sec(t('common.configManagement'), SEC_STYLE));
    const actions = document.createElement("div");
    actions.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--ws-gap-sm)";
    const exportButton = iconBtn('export', t('common.exportConfig'));
    exportButton.onclick = exportCfg;
    const importButton = iconBtn('import_', t('common.importConfig'));
    const file = document.createElement("input");
    file.type = "file"; file.accept = "application/json,.json"; file.style.display = "none";
    file.onchange = () => { importCfg(file.files[0]); file.value = ""; };
    importButton.onclick = () => file.click();
    actions.append(exportButton, importButton, file); root.appendChild(actions);
    root._syncThemeModeTabs = syncThemeModeTabs;
    return root;
}

function buildPanel() {
    // 统一设置中心是全局配置的唯一归属；启动器、HUD 和 HUB 只负责跳转到这里。
    return buildUnifiedSettingsPanel();
}

// 保留既有构建器，避免影响其它已加载模块；它不再作为 HUB BAR 的设置入口。
function buildUnifiedSettingsPanel() {
    const body = document.createElement("div");
    body.className = "wosai-global-settings__body";
    const { panel } = buildControlPanel({
        wsControl: "settings",
        extraClass: "wosai-global-settings",
        width: "min(680px,calc(100vw - 32px))",
        title: t('common.settings'),
        onClose: closePanel,
        content: body,
        stickyHeader: false,
    });
    // The launcher context menu intentionally exposes one concise settings
    // destination. Feature-specific panels stay registered elsewhere.
    const definitions = [["system", 'menus.launcher.settingsSystem', () => _buildSystemSettingsSection()]];
    const content = new Map();
    const selectTab = (id) => {
        let section = content.get(id);
        if (!section) {
            const definition = definitions.find(([tabId]) => tabId === id);
            section = definition?.[2]();
            if (!section) return;
            content.set(id, section);
        }
        body.replaceChildren(section);
        section._sync?.();
        panel._syncThemeModeTabs = section._syncThemeModeTabs || (() => {});
    };
    selectTab("system");
    panel.addEventListener("wosai:close-settings", closePanel);
    return panel;
}

function rebuild() {
    if (!_panel) return;
    const shown = _panel.style.display !== "none";
    _panel._wosaiDragCleanup?.(); // 面板销毁时一并解绑拖拽监听
    _panel.remove();
    _panel = null;
    if (shown) openPanel();
}
function openPanel() {
    if (!_panel) _panel = buildPanel();
    _panel.setAttribute("data-theme", getGlassTheme()); _panel.style.display = "block";
    const r = _panel.getBoundingClientRect();
    const pos = calcSnapToNodeSide(r.width, r.height);
    _panel.style.left = Math.round(pos.x) + "px";
    _panel.style.top = Math.round(pos.y) + "px";
    requestAnimationFrame(() => dodgeBall(_panel));
}
function closePanel() { if (_panel) _panel.style.display = "none"; }

// ── 生命周期清理 ──
let _stgKeyHandler = null;
let _stgPtrHandler = null;
let _stgOffGlass = null;
let _stgOffLang = null;

app.registerExtension({
    name: "WOSAI.Settings",
    settings: [],
    async setup() {
        await registerNativeWosaiSettings();
        // 暴露给「背景/连线」HUD 栏与悬浮球：点击即打开/关闭设置面板
        window.__wosaiOpenSettings = openPanel;
        window.__wosaiCloseSettings = closePanel;
        registerHudTab({ id: "settings", label: t('menus.hudSettings'), order: 9, panel: () => { (_panel && _panel.style.display !== "none") ? closePanel() : openPanel(); } });
        _stgKeyHandler = (e) => { if (e.key === "Escape" && _panel && _panel.style.display !== "none") closePanel(); };
        _stgPtrHandler = (e) => { if (_panel && _panel.style.display !== "none" && !_panel.contains(e.target)) closePanel(); };
        document.addEventListener("keydown", _stgKeyHandler);
        document.addEventListener("pointerdown", _stgPtrHandler, { capture: true });
        _stgOffGlass = onGlassChange(() => {
            if (_panel) {
                _panel.setAttribute("data-theme", getGlassTheme());
                _panel._syncThemeModeTabs?.();
            }
        });
        // 语言切换：重建设置面板以更新文字
        _stgOffLang = onLangChange(() => rebuild());
    },
    remove() {
        closePanel();
        delete window.__wosaiOpenSettings;
        delete window.__wosaiCloseSettings;
        if (_panel) { _panel.remove(); _panel = null; }
        if (_stgKeyHandler) { document.removeEventListener("keydown", _stgKeyHandler); _stgKeyHandler = null; }
        if (_stgPtrHandler) { document.removeEventListener("pointerdown", _stgPtrHandler, { capture: true }); _stgPtrHandler = null; }
        if (_stgOffGlass) { _stgOffGlass(); _stgOffGlass = null; }
        if (_stgOffLang) { _stgOffLang(); _stgOffLang = null; }
        unregisterHudTab("settings");
    },
});
