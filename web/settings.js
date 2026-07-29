// ══ WOSAI 系统设置（子球·设置）：界面语言 / 性能模式 /  ══
import { app } from "../../../scripts/app.js";
import { glassT, getGlassTheme, getGlassMode, setGlassMode, onGlassChange, GLASS_MODE_DEFS } from "./shared/glass-theme.js";
import { registerHudTab, unregisterHudTab } from "./shared/hud-kit.js";
import { iconBtn, closeIcon } from "./shared/svg-icons.js";
import { _sec } from "./shared/panel-builder.js";
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
function _buildLegacySystemPanel() {
    const T = glassT();
    const p = document.createElement("div");
    p.className = "wosai-control-panel";
    p.dataset.wsControl = "settings";
    p.setAttribute("data-wosai-panel", ""); p.setAttribute("data-theme", getGlassTheme());
    p.style.cssText = `position:fixed;display:none;z-index:var(--ws-z-hud);width:var(--ws-panel-width-md);box-sizing:border-box;padding:var(--ws-panel-padding-md);border-radius:var(--ws-panel-radius-md);background:${T.glass};backdrop-filter:${T.blur};-webkit-backdrop-filter:${T.blur};border:var(--ws-border-width-thin) solid var(--ws-border);box-shadow:var(--ws-shadow-panel);color:var(--ws-text);font-family:var(--ws-font-family);font-size:var(--ws-text-md);user-select:none;max-height:calc(100vh - 32px);overflow-y:auto;overscroll-behavior:contain`;
    p.onpointerdown = (e) => e.stopPropagation();

    const head = document.createElement("div"); head.className = "wosai-control-header"; head.style.cssText = "display:flex;align-items:center;justify-content:space-between;font-size:var(--ws-text-xl);font-weight:500;margin-bottom:var(--ws-gap-md);position:sticky;top:calc(-1 * var(--ws-panel-padding-md));background:transparent;z-index:2;padding:var(--ws-gap-xs) 0;margin-left:calc(-1 * var(--ws-panel-padding-md));margin-right:calc(-1 * var(--ws-panel-padding-md));padding-left:var(--ws-panel-padding-md);padding-right:var(--ws-panel-padding-md)";
    const ht = document.createElement("span"); ht.textContent = t('common.settings'); head.appendChild(ht);
    const x = closeIcon(); x.onclick = closePanel; head.appendChild(x); p.appendChild(head);

    // 性能模式
    p.appendChild(_sec(t('common.linkAnimation'), SEC_STYLE));
    const fps = localStorage.getItem(STORAGE_KEYS.fps) || "60";
    p.appendChild(_select([["60", t('common.fpsNormal60')], ["45", t('common.fpsEco45')], ["30", t('common.fpsLow30')]], fps, (v) => { localStorage.setItem(STORAGE_KEYS.fps, v); }));

    // 主题切换
    p.appendChild(_sec(t('settings.themeSwitch', 'Theme'), SEC_STYLE));
    const themeTabs = document.createElement("div");
    themeTabs.className = "wosai-theme-mode-tabs";
    const modeButtons = new Map();
    const syncThemeModeTabs = () => {
        const currentMode = getGlassMode();
        modeButtons.forEach((button, mode) => {
            const active = mode === currentMode;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        });
    };
    for (const mode of ["auto", "light", "dark"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "wosai-theme-mode-tab";
        button.textContent = GLASS_MODE_DEFS[mode].label;
        button.title = GLASS_MODE_DEFS[mode].tip;
        button.onclick = () => {
            setGlassMode(mode);
            syncThemeModeTabs();
        };
        modeButtons.set(mode, button);
        themeTabs.appendChild(button);
    }
    syncThemeModeTabs();
    p.appendChild(themeTabs);
    p._syncThemeModeTabs = syncThemeModeTabs;

    // 显示悬浮球
    p.appendChild(_sec(t('settings.showOrb', 'Show Floating Orb'), SEC_STYLE));
    const orbRow = document.createElement("div");
    orbRow.style.cssText = "display:flex;align-items:center;gap:var(--ws-gap-md);margin:var(--ws-gap) 0";
    const orbCb = document.createElement("input");
    orbCb.type = "checkbox";
    // 默认显示；仅保留用户明确关闭时的隐藏状态。
    const orbEnabled = localStorage.getItem(STORAGE_KEYS.showLauncher) !== "false";
    orbCb.checked = orbEnabled;
    orbCb.style.cssText = "width:var(--ws-icon-size);height:var(--ws-icon-size);accent-color:var(--ws-accent)";
    const orbLbl = document.createElement("span");
    orbLbl.textContent = orbEnabled ? t('settings.showOrbOn') : t('settings.showOrbOff');
    orbLbl.style.cssText = "font-size:var(--ws-text-md);flex:1";
    orbCb.onchange = () => {
        const on = orbCb.checked;
        localStorage.setItem(STORAGE_KEYS.showLauncher, on ? "true" : "false");
        orbLbl.textContent = on ? t('settings.showOrbOn') : t('settings.showOrbOff');
        if (on) createLauncher();
        else removeLauncher();
    };
    orbRow.appendChild(orbCb);
    orbRow.appendChild(orbLbl);
    p.appendChild(orbRow);

    // 性能模式（弱机 / 无硬件加速优化）
    p.appendChild(_sec(t('menus.performance.title'), SEC_STYLE));
    const perfDefs = [
        ["wosai-perf-singleCanvasPan", "menus.performance.pan", true],
        ["wosai-perf-throttleRenderInfo", "menus.performance.throttle", true],
        ["wosai-perf-disableShadows", "menus.performance.shadow", false],
        ["wosai-perf-disableConnectionBorders", "menus.performance.border", false],
        ["wosai-perf-disableRoundedCorners", "menus.performance.radius", false],
    ];
    for (const [pid, labelKey, def] of perfDefs) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:var(--ws-gap-md);margin:var(--ws-gap) 0";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = wosaiGetBool(pid, def);
        cb.style.cssText = "width:var(--ws-icon-size);height:var(--ws-icon-size);accent-color:var(--ws-accent)";
        cb.onchange = () => window.__wosaiSetPerf?.(pid, cb.checked);
        const lbl = document.createElement("span");
        lbl.textContent = t(labelKey);
        lbl.style.cssText = "font-size:var(--ws-text-md);flex:1";
        row.appendChild(cb); row.appendChild(lbl);
        p.appendChild(row);
    }

    // 菜单隐藏（提取自 xiaozhuguang 主题功能）
    p.appendChild(_sec(t('settings.menuHide'), SEC_STYLE));
    const mhRow = document.createElement("div");
    mhRow.style.cssText = "display:flex;align-items:center;gap:var(--ws-gap-md);margin:var(--ws-gap) 0";
    const mhCb = document.createElement("input");
    mhCb.type = "checkbox";
    mhCb.checked = !!(window.__wosaiMenuHide && window.__wosaiMenuHide.isEnabled());
    mhCb.style.cssText = "width:var(--ws-icon-size);height:var(--ws-icon-size);accent-color:var(--ws-accent)";
    mhCb.onchange = () => window.__wosaiMenuHide?.setEnabled(mhCb.checked);
    const mhLbl = document.createElement("span");
    mhLbl.textContent = t('settings.menuHideEnable');
    mhLbl.style.cssText = "font-size:var(--ws-text-md);flex:1";
    mhRow.appendChild(mhCb); mhRow.appendChild(mhLbl);
    p.appendChild(mhRow);
    const mhBtn = iconBtn('search', t('settings.menuHideManage'));
    mhBtn.onclick = () => window.__wosaiOpenMenuHideManager?.();
    p.appendChild(mhBtn);

    // 配置管理
    p.appendChild(_sec(t('common.configManagement'), SEC_STYLE));
    const eb = iconBtn('export', t('common.exportConfig')); eb.onclick = exportCfg; p.appendChild(eb);
    const ib = iconBtn('import_', t('common.importConfig'));
    const ifile = document.createElement("input"); ifile.type = "file"; ifile.accept = "application/json,.json"; ifile.style.display = "none";
    ifile.onchange = () => { importCfg(ifile.files[0]); ifile.value = ""; };
    ib.onclick = () => ifile.click(); p.appendChild(ib); p.appendChild(ifile);

    // 画布背景（迁移自壁纸子球）
    // 连线特效（迁移自特效子球）
    // 版权信息
    const cr = document.createElement("div");
    cr.className = "wosai-control-copyright";
    cr.textContent = WOSAI_COPYRIGHT;
    p.appendChild(cr);

    document.body.appendChild(p);
    return p;
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

function _buildManagerShortcut(label, onOpen) {
    const root = document.createElement("div");
    root.className = "wosai-settings-manager-shortcut";
    root.style.cssText = "display:flex;flex-direction:column;gap:var(--ws-gap-md);padding:var(--ws-gap-lg) 0";
    const hint = document.createElement("p");
    hint.textContent = label;
    hint.style.cssText = "margin:0;color:var(--ws-text-secondary);line-height:1.6";
    const button = document.createElement("button");
    button.type = "button"; button.className = "wosai-btn";
    button.textContent = label; button.onclick = onOpen;
    root.append(hint, button);
    return root;
}

function buildPanel() {
    // 统一设置中心是全局配置的唯一归属；启动器、HUD 和 HUB 只负责跳转到这里。
    return buildUnifiedSettingsPanel();
}

// 保留既有构建器，避免影响其它已加载模块；它不再作为 HUB BAR 的设置入口。
function buildUnifiedSettingsPanel() {
    const T = glassT();
    const panel = document.createElement("div");
    panel.className = "wosai-control-panel wosai-global-settings";
    panel.dataset.wsControl = "settings";
    panel.setAttribute("data-wosai-panel", "");
    panel.setAttribute("data-theme", getGlassTheme());
    panel.style.cssText = `position:fixed;display:none;z-index:var(--ws-z-hud);width:min(680px,calc(100vw - 32px));box-sizing:border-box;padding:var(--ws-panel-padding-md);border-radius:var(--ws-panel-radius-md);background:${T.glass};backdrop-filter:${T.blur};-webkit-backdrop-filter:${T.blur};border:var(--ws-border-width-thin) solid var(--ws-border);box-shadow:var(--ws-shadow-panel);color:var(--ws-text);font-family:var(--ws-font-family);font-size:var(--ws-text-md);user-select:none;max-height:calc(100vh - 32px);overflow-y:auto;overscroll-behavior:contain`;
    panel.onpointerdown = (event) => event.stopPropagation();

    const header = document.createElement("div");
    header.className = "wosai-control-header";
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;font-size:var(--ws-text-xl);font-weight:500;margin-bottom:var(--ws-gap-md)";
    const title = document.createElement("span"); title.textContent = t('common.settings');
    const close = closeIcon(); close.onclick = closePanel;
    header.append(title, close);

    const body = document.createElement("div");
    body.className = "wosai-global-settings__body";
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
    const copyright = document.createElement("div");
    copyright.className = "wosai-control-copyright"; copyright.textContent = WOSAI_COPYRIGHT;
    panel.append(header, body, copyright);
    document.body.appendChild(panel);
    return panel;
}

function rebuild() { if (_panel) { const shown = _panel.style.display !== "none"; _panel.remove(); _panel = null; if (shown) openPanel(); } }
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
