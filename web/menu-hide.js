// ══ WOSAI 菜单隐藏══
// 机制：通过 ComfyUI 的 getCanvasMenuItems / getNodeMenuItems 扩展钩子
//       注册 WOSAI 菜单项，并由 MutationObserver 在菜单 DOM 创建后执行
//       收集与隐藏。避免修改 LiteGraph 原型，兼容新版上下文菜单 API。
// 存储：localStorage，键以 "wosai-" 前缀，与 settings.js 一致。
import { t, onLangChange } from "./shared/i18n.js";
import { app } from "../../../scripts/app.js";
import { glassT, getGlassTheme } from "./shared/glass-theme.js";
import { calcSnapToNodeSide } from "./shared/canvas-utils.js";
import { WOSAI_COPYRIGHT } from "./shared/constants.js";
import { registerHubBarButton, unregisterHubBarButton } from "./hub-bar.js";
import { getHudTab } from "./shared/hud-kit.js";

const KEY_ENABLED = "wosai-menu-hide-enabled";
const KEY_CONFIG = "wosai-menu-hide";
// One-time recovery for users who previously hid every native menu item with
// ComfyUI-xiaozhuguang. Keep this isolated from WOSAI's own menu preferences.
const KEY_XZG_MENU_RECOVERY = "wosai-xzg-menu-hide-recovery-v1";
let _xzgMenuRecoveryTimer = null;

function recoverXzgMenuOnce() {
    try {
        if (localStorage.getItem(KEY_XZG_MENU_RECOVERY) === "true") return;
    } catch (e) {
        return;
    }

    let retries = 0;
    const recover = () => {
        const xzgMenuHide = window.XZGMenuHide;
        if (!xzgMenuHide?.resetAll || !xzgMenuHide?.setEnabled) {
            if (retries++ < 40) _xzgMenuRecoveryTimer = setTimeout(recover, 250);
            return;
        }
        try {
            xzgMenuHide.resetAll();
            xzgMenuHide.setEnabled(false);
            localStorage.setItem(KEY_XZG_MENU_RECOVERY, "true");
            console.info("[WOSAI] Restored native canvas and node context menus.");
        } catch (error) {
            console.warn("[WOSAI] Unable to restore XZG menu settings:", error);
        }
    };
    recover();
}

const MenuHide = {
    config: { canvas: {}, node: {} },
    _collectedItems: { canvas: [], node: [] },
    _freq: { canvas: {}, node: {} },
    _inited: false,
    _enabled: false,
    _domObserver: null,
    _lastMenuType: "canvas",
    _xzgProtectedLabels: { canvas: new Set(), node: new Set() },

    init() {
        if (this._inited) return;
        this._inited = true;
        this.loadConfig();
        this._clearProtectedMenuItems();
        this.loadEnabled();
        this._seedKnownMenuItems();
        this._startDOMObserver();
    },

    _seedKnownMenuItems() {
        const sharedItems = [
            t("menus.menuHideItems.refreshNode"),
            t("menus.menuHideItems.convertToSubgraph"),
            t("menus.menuHideItems.properties"),
            t("menus.menuHideItems.propertiesPanel"),
        ];
        const knownItems = {
            canvas: sharedItems,
            node: sharedItems,
        };
        for (const [menuType, items] of Object.entries(knownItems)) {
            const list = this._collectedItems[menuType];
            items.forEach((item) => { if (!list.includes(item)) list.push(item); });
            list.sort();
        }
    },

    loadEnabled() {
        try { this._enabled = localStorage.getItem(KEY_ENABLED) === "true"; } catch (e) {}
    },

    setEnabled(enabled) {
        this._enabled = enabled;
        try { localStorage.setItem(KEY_ENABLED, enabled ? "true" : "false"); } catch (e) {}
        this._applyHideToOpenMenus();
    },

    isEnabled() { return this._enabled; },

    loadConfig() {
        try {
            const saved = localStorage.getItem(KEY_CONFIG);
            if (saved) {
                const data = JSON.parse(saved);
                this.config = Object.assign({ canvas: {}, node: {} }, data);
            }
        } catch (e) {}
    },

    saveConfig() {
        try { localStorage.setItem(KEY_CONFIG, JSON.stringify(this.config)); } catch (e) {}
    },

    isHidden(menuType, content) {
        if (!this._enabled) return false;
        const map = this.config[menuType];
        if (!map) return false;
        const key = this._normalizeKey(content);
        return !!map[key];
    },

    setHidden(menuType, content, hidden) {
        if (this.isProtectedMenuItem(content)) return;
        if (!this.config[menuType]) this.config[menuType] = {};
        const key = this._normalizeKey(content);
        if (hidden) this.config[menuType][key] = true;
        else delete this.config[menuType][key];
        this.saveConfig();
        this._applyHideToOpenMenus();
    },

    isProtectedMenuItem(content) {
        return this._protectedMenuItems().has(this._normalizeKey(content));
    },

    _protectedMenuItems() {
        return new Set([
            t("menus.menuHideItems.refreshNode"),
            t("menus.menuHideItems.convertToSubgraph"),
            t("menus.menuHideItems.properties"),
            t("menus.menuHideItems.propertiesPanel"),
        ]);
    },

    _clearProtectedMenuItems() {
        let changed = false;
        for (const hiddenItems of Object.values(this.config)) {
            for (const item of this._protectedMenuItems()) {
                if (hiddenItems[item]) {
                    delete hiddenItems[item];
                    changed = true;
                }
            }
        }
        if (changed) this.saveConfig();
    },

    resetAll() {
        this.config = { canvas: {}, node: {} };
        this._freq = { canvas: {}, node: {} };
        this.saveConfig();
        this._applyHideToOpenMenus();
    },

    _applyHideToOpenMenus() {
        const menus = document.querySelectorAll(".litecontextmenu, .context-menu, .litegraph-contextmenu");
        menus.forEach((menu) => {
            if (this._enabled) this._hideFromDOM(menu);
            else {
                menu.querySelectorAll(".litemenu-entry, .context-menu-item, .menu-item, .lite-menu-item")
                    .forEach((item) => { item.style.display = ""; });
                menu.querySelectorAll(".separator, .litemenu-separator, hr")
                    .forEach((sep) => { sep.style.display = ""; });
            }
        });
    },

    _normalizeKey(content) {
        if (!content) return "";
        if (typeof content === "string") return content.replace(/<[^>]*>/g, "").trim();
        const candidates = ["content", "title", "value", "label", "text", "name"];
        for (const prop of candidates) {
            if (content[prop]) return String(content[prop]).replace(/<[^>]*>/g, "").trim();
        }
        return String(content).replace(/<[^>]*>/g, "").trim();
    },

    _collectItems(options, menuType) {
        if (!options || !Array.isArray(options)) return;
        const list = this._collectedItems[menuType];
        if (!list) return;
        const existing = new Set(list);
        let changed = false;
        const addItem = (opt) => {
            if (!opt || opt === null) return;
            const key = this._normalizeKey(opt);
            if (!key) return;
            // 频率统计：每次出现都累加（独立于去重后的列表）
            if (!this._freq[menuType]) this._freq[menuType] = {};
            this._freq[menuType][key] = (this._freq[menuType][key] || 0) + 1;
            if (existing.has(key)) return;
            existing.add(key);
            list.push(key);
            changed = true;
            let subOptions = null;
            if (opt.submenu) {
                if (opt.submenu.options) subOptions = opt.submenu.options;
                else if (typeof opt.submenu === "function") {
                    try {
                        const result = opt.submenu();
                        if (Array.isArray(result)) subOptions = result;
                        else if (result?.options) subOptions = result.options;
                    } catch (e) {}
                } else if (Array.isArray(opt.submenu)) subOptions = opt.submenu;
            }
            if (opt.options && Array.isArray(opt.options)) subOptions = opt.options;
            if (opt.items && Array.isArray(opt.items)) subOptions = opt.items;
            if (subOptions) subOptions.forEach(sub => addItem(sub));
        };
        options.forEach(o => addItem(o));
        if (changed) list.sort();
    },

    _trimSeparators(options) {
        const result = [];
        for (const option of options) {
            if (option === null || option === undefined) {
                if (result.length && result[result.length - 1] !== null) result.push(null);
            } else result.push(option);
        }
        if (result[result.length - 1] === null) result.pop();
        return result;
    },

    collectCurrentMenu(menuType) {
        this._lastMenuType = menuType === "node" ? "node" : "canvas";
        document.querySelectorAll(".litecontextmenu, .context-menu, .litegraph-contextmenu")
            .forEach((menu) => this._collectFromDOM(menu));
    },

    _getCanvasWosaiOptions() {
        this._protectXzgCanvasMenuItems();
        const options = [
            {
                wosaiCanvasAction: "favorite",
                content: t("menus.canvasMenu.favorite"),
                callback: () => {
                    if (typeof window.__wosaiOpenSaveNodePanel === "function") window.__wosaiOpenSaveNodePanel();
                    else window.__wosaiSaveNodeToggle?.();
                },
            },
            {
                wosaiCanvasAction: "quickAlign",
                content: `🟠 ${t("menus.layoutToolkit.quickAlign")}`,
                callback: () => window.__wosaiOpenAlignPanel?.(),
            },
            {
                wosaiCanvasAction: "manageContextMenu",
                content: t("menus.canvasMenu.manageContextMenu"),
                callback: () => window.__wosaiOpenMenuHideManager?.(),
            },
            {
                wosaiCanvasAction: "desktopWallpaper",
                content: t("menus.canvasMenu.desktopWallpaper"),
                callback: () => getHudTab("bg")?.panel?.(),
            },
        ];
        // Keep WOSAI canvas actions at the root level so a right-click takes
        // one step to reach each action; there is no enclosing WOSAI submenu.
        return [null, ...options];
    },

    _getProtectedCanvasMenuLabels() {
        return new Set([
            t("menus.canvasMenu.favorite"),
            `🟠 ${t("menus.layoutToolkit.quickAlign")}`,
            t("menus.canvasMenu.manageContextMenu"),
            t("menus.canvasMenu.desktopWallpaper"),
            t("menus.canvasMenu.legacyFavoriteZh"),
            t("menus.canvasMenu.legacyManageContextMenuZh"),
            t("menus.canvasMenu.legacyDesktopWallpaperZh"),
            t("menus.canvasMenu.legacyFavoriteEn"),
            t("menus.canvasMenu.legacyManageContextMenuEn"),
            t("menus.canvasMenu.legacyDesktopWallpaperEn"),
        ].map((label) => this._normalizeKey(label)).filter(Boolean));
    },

    _protectXzgCanvasMenuItems() {
        const xzgMenuHide = window.XZGMenuHide;
        const hiddenMap = xzgMenuHide?.config?.canvas;
        if (!hiddenMap || typeof hiddenMap !== "object") return;
        const protectedLabels = this._getProtectedCanvasMenuLabels();
        let changed = false;
        protectedLabels.forEach((label) => {
            if (!Object.prototype.hasOwnProperty.call(hiddenMap, label)) return;
            delete hiddenMap[label];
            changed = true;
        });
        if (changed) xzgMenuHide.saveConfig?.();
    },

    _protectXzgNodeMenuItems(options) {
        const xzgMenuHide = window.XZGMenuHide;
        const hiddenMap = xzgMenuHide?.config?.node;
        if (!hiddenMap || typeof hiddenMap !== "object" || !Array.isArray(options)) return;
        let changed = false;
        const protect = (option) => {
            if (!option || typeof option !== "object") return;
            if (option.wosaiNodeAction) {
                const label = this._normalizeKey(option);
                if (label) {
                    this._xzgProtectedLabels.node.add(label);
                    if (Object.prototype.hasOwnProperty.call(hiddenMap, label)) {
                        delete hiddenMap[label];
                        changed = true;
                    }
                }
            }
            [option.submenu?.options, option.options, option.items].forEach((children) => {
                if (Array.isArray(children)) children.forEach(protect);
            });
        };
        options.forEach(protect);
        if (changed) xzgMenuHide.saveConfig?.();
    },

    _restoreProtectedCanvasDOM(menuEl) {
        if (!menuEl) return;
        const protectedLabels = this._getProtectedCanvasMenuLabels();
        this._xzgProtectedLabels.canvas.forEach((label) => protectedLabels.add(label));
        this._xzgProtectedLabels.node.forEach((label) => protectedLabels.add(label));
        const wosaiHidden = new Set();
        if (this._enabled) {
            Object.values(this.config).forEach((hiddenMap) => {
                Object.keys(hiddenMap || {}).forEach((label) => wosaiHidden.add(label));
            });
        }
        menuEl.querySelectorAll(".litemenu-entry, .context-menu-item, .menu-item, .lite-menu-item, [class*=\"menu-entry\"], [class*=\"menu-item\"]")
            .forEach((item) => {
                const text = item.textContent?.trim() || item.innerText?.trim();
                const key = this._normalizeKey(text);
                if (protectedLabels.has(key) && !wosaiHidden.has(key)) item.style.display = "";
            });
    },

    _startDOMObserver() {
        if (this._domObserver) return;
        const self = this;
        this._domObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    let menuEl = null;
                    const el = node;
                    if (el.classList && (
                        el.classList.contains("litecontextmenu") ||
                        el.classList.contains("context-menu") ||
                        el.classList.contains("litegraph-contextmenu") ||
                        (el.tagName === "DIV" && el.querySelector?.(".litemenu-title"))
                    )) menuEl = el;
                    if (!menuEl) {
                        const inner = el.querySelector?.(".litecontextmenu, .context-menu, .litegraph-contextmenu");
                        if (inner) menuEl = inner;
                    }
                    if (menuEl) {
                        self._collectFromDOM(menuEl);
                        self._hideFromDOM(menuEl);
                        requestAnimationFrame(() => self._hideFromDOM(menuEl));
                    }
                }
            }
        });
        this._domObserver.observe(document.body, { childList: true, subtree: true });
    },

    _collectFromDOM(menuEl) {
        if (!menuEl) return;
        const menuType = this._lastMenuType || "canvas";
        const items = menuEl.querySelectorAll(".litemenu-entry, .context-menu-item, .menu-item, .lite-menu-item");
        const collected = [];
        items.forEach((item) => {
            const text = item.textContent?.trim() || item.innerText?.trim();
            if (text && text.length < 50 && !text.match(/^[\d\s\-.]+$/)) collected.push(text);
        });
        if (collected.length > 0 && this._collectedItems[menuType]) {
            const list = this._collectedItems[menuType];
            const existing = new Set(list);
            let changed = false;
            collected.forEach((text) => {
                const key = text.replace(/<[^>]*>/g, "").trim();
                if (key && !existing.has(key)) { existing.add(key); list.push(key); changed = true; }
            });
            if (changed) list.sort();
            // 频率统计（DOM 来源同样累加）
            if (!this._freq[menuType]) this._freq[menuType] = {};
            collected.forEach((text) => {
                const key = text.replace(/<[^>]*>/g, "").trim();
                if (key) this._freq[menuType][key] = (this._freq[menuType][key] || 0) + 1;
            });
        }
    },

    _hideFromDOM(menuEl) {
        if (!menuEl) return;
        this._protectXzgCanvasMenuItems();
        if (!this._enabled) {
            this._restoreProtectedCanvasDOM(menuEl);
            return;
        }
        const allHiddenKeys = new Set();
        for (const menuType of ["canvas", "node"]) {
            const hiddenMap = this.config[menuType] || {};
            Object.keys(hiddenMap).forEach((k) => allHiddenKeys.add(k));
        }
        if (allHiddenKeys.size === 0) {
            this._restoreProtectedCanvasDOM(menuEl);
            return;
        }
        const hideItem = (item) => {
            const text = item.textContent?.trim() || item.innerText?.trim();
            if (!text) return;
            const key = text.replace(/<[^>]*>/g, "").trim();
            if (!key) return;
            for (const hiddenKey of allHiddenKeys) {
                if (key === hiddenKey || key.includes(hiddenKey) || hiddenKey.includes(key)) {
                    item.style.display = "none";
                    break;
                }
            }
        };
        menuEl.querySelectorAll(".litemenu-entry, .context-menu-item, .menu-item, .lite-menu-item, [class*=\"menu-entry\"], [class*=\"menu-item\"]")
            .forEach((item) => hideItem(item));

        const elements = Array.from(menuEl.querySelectorAll(".litemenu-entry, .context-menu-item, .menu-item, .lite-menu-item, [class*=\"menu-entry\"], [class*=\"menu-item\"], .separator, .litemenu-separator, hr"));
        const isSeparator = (element) => element.matches(".separator, .litemenu-separator, hr") || !element.textContent?.trim();
        elements.forEach((element, index) => {
            if (!isSeparator(element)) return;
            const previous = elements.slice(0, index).reverse().find((item) => !isSeparator(item) && item.style.display !== "none");
            const next = elements.slice(index + 1).find((item) => !isSeparator(item) && item.style.display !== "none");
            element.style.display = previous && next ? "" : "none";
        });
        this._restoreProtectedCanvasDOM(menuEl);
    },
};

// ── 管理面板（玻璃风格，与 settings.js 一致）────────────────────
let _mhPanel = null;
let _mhOffLang = null;

// WOSAI 菜单项特征：含 "WOSAI"（大小写不敏感）或以橙色圆点开头
function _isWosaiItem(key) {
    if (!key) return false;
    return /wosai/i.test(key) || key.includes("🟠");
}

function _injectMenuHideStyle() {
    if (document.getElementById("wosai-menu-hide-style")) return;
    const css = `
.wosai-mh-panel { color:var(--ws-text);font-family:var(--ws-font-family);font-size:var(--ws-text-md);user-select:none;gap:var(--ws-gap-md); }
.wosai-mh-header { display:flex;align-items:center;justify-content:space-between;font-size:var(--ws-text-xl);font-weight:500;margin:0;cursor:move; }
.wosai-mh-tabs { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--ws-mh-tabs-gap);margin:0;border-bottom:var(--ws-border-width-thin) solid var(--ws-border);flex-shrink:0; }
.wosai-mh-tab { min-height:var(--ws-set-select-h);padding:0 var(--ws-gap-sm);background:transparent;border:0;border-bottom:var(--ws-focus-ring-width) solid transparent;color:var(--ws-text-secondary);font-size:var(--ws-text-md);font-weight:600;cursor:pointer;border-radius:0;transition:color .15s,border-color .15s; }
.wosai-mh-tab:hover { color:var(--ws-text);background:transparent; }
.wosai-mh-tab.active { background:transparent;color:var(--ws-accent);border-bottom-color:var(--ws-accent); }
.wosai-mh-search { width:100%;height:var(--ws-set-select-h);box-sizing:border-box;padding:var(--ws-mh-search-padding);border-radius:var(--ws-set-select-radius);background:var(--ws-surface-2);color:var(--ws-text);border:var(--ws-border-width-thin) solid var(--ws-border);font-size:var(--ws-text-md);outline:none; }
.wosai-mh-search:focus { border-color:var(--ws-accent); }
.wosai-mh-toolbar { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--ws-gap-sm);margin:0; }
.wosai-mh-tool { min-width:0;height:var(--ws-mh-tool-height);box-sizing:border-box;border:var(--ws-border-width-thin) solid var(--ws-border);border-radius:var(--ws-radius);background:var(--ws-surface-2);color:var(--ws-text);cursor:pointer;font-size:var(--ws-text-sm);transition:all .15s; }
.wosai-mh-tool:hover { background:var(--ws-surface-3);border-color:var(--ws-accent); }
.wosai-mh-filters { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--ws-gap-sm);margin:0; }
.wosai-mh-chip { min-width:0;height:var(--ws-mh-tool-height);box-sizing:border-box;padding:0 var(--ws-gap-sm);border:var(--ws-border-width-thin) solid var(--ws-border);border-radius:var(--ws-radius);background:var(--ws-surface-2);color:var(--ws-text-secondary);cursor:pointer;font-size:var(--ws-text-sm);line-height:1;display:flex;align-items:center;justify-content:center;transition:all .15s;white-space:nowrap; }
.wosai-mh-chip:hover { color:var(--ws-text);background:var(--ws-surface-3); }
.wosai-mh-chip.active { background:var(--ws-accent);color:var(--ws-text-on-accent);border-color:var(--ws-accent); }
.wosai-mh-list { flex:1;min-height:0;overflow-y:auto;border:var(--ws-border-width-thin) solid var(--ws-border);border-radius:var(--ws-radius);background:var(--ws-surface-2);padding:var(--ws-gap-sm); }
.wosai-mh-list::-webkit-scrollbar { width:var(--ws-scrollbar-w); }
.wosai-mh-list::-webkit-scrollbar-thumb { background:var(--ws-border);border-radius:var(--ws-mh-scrollbar-radius); }
.wosai-mh-item { display:flex;align-items:center;gap:var(--ws-gap-md);padding:var(--ws-mh-item-padding);cursor:pointer;border-radius:var(--ws-radius);transition:background .1s;font-size:var(--ws-text-md);color:var(--ws-text);width:100%;box-sizing:border-box; }
.wosai-mh-item:hover { background:var(--ws-surface-3); }
.wosai-mh-item input[type="checkbox"] { width:var(--ws-text-lg);height:var(--ws-text-lg);cursor:pointer;flex-shrink:0;accent-color:var(--ws-accent); }
.wosai-mh-item input[type="checkbox"]:disabled { cursor:not-allowed;opacity:.38; }
.wosai-mh-item:has(input:disabled) { cursor:not-allowed;opacity:.62; }
.wosai-mh-item span { flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.wosai-mh-empty { text-align:center;color:var(--ws-text-secondary);font-size:var(--ws-text-md);padding:var(--ws-mh-empty-padding);line-height:1.6; }
.wosai-mh-footer { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--ws-gap-sm);flex-shrink:0; }
.wosai-mh-reset,.wosai-mh-confirm,.wosai-mh-cancel { min-width:0;width:100%;height:var(--ws-mh-reset-height);margin:0;border:var(--ws-border-width-thin) solid var(--ws-danger-border, var(--ws-border));border-radius:var(--ws-radius);cursor:pointer;font-size:var(--ws-text-md);transition:all .15s; }
.wosai-mh-reset { background:var(--ws-danger-bg, transparent);color:var(--ws-danger, var(--ws-text)); }
.wosai-mh-reset:hover { background:var(--ws-danger-bg-hover, var(--ws-surface-3)); }
.wosai-mh-confirm { border-color:var(--ws-accent);background:var(--ws-accent);color:var(--ws-text-on-accent); }
.wosai-mh-confirm:hover { filter:brightness(1.08); }
.wosai-mh-cancel { border-color:var(--ws-border);background:var(--ws-surface-2);color:var(--ws-text-secondary); }
.wosai-mh-cancel:hover { border-color:var(--ws-text-secondary);color:var(--ws-text); }
.wosai-mh-copyright { margin:0;text-align:center;color:var(--ws-text-muted);font-size:var(--ws-text-xs);letter-spacing:.04em;opacity:.6;flex-shrink:0; }
`;
    const s = document.createElement("style");
    s.id = "wosai-menu-hide-style";
    s.textContent = css;
    document.head.appendChild(s);
}


function openMenuHideManager() {
    _injectMenuHideStyle();
    if (_mhPanel) { _closeMenuHideManager(); return; }

    const T = glassT();
    const p = document.createElement("div");
    p.className = "wosai-mh-panel";
    p.setAttribute("data-wosai-panel", "");
    p.style.cssText = `position:fixed;display:flex;flex-direction:column;z-index:var(--ws-z-hud);width:var(--ws-panel-width-md);height:min(520px,calc(100vh - 32px));box-sizing:border-box;padding:var(--ws-panel-padding-md);border-radius:var(--ws-panel-radius-md);background:${T.glass};backdrop-filter:${T.blur};-webkit-backdrop-filter:${T.blur};border:var(--ws-border-width-thin) solid var(--ws-border);box-shadow:var(--ws-shadow-panel);`;
    p.onpointerdown = (e) => e.stopPropagation();

    const head = document.createElement("div");
    head.className = "wosai-mh-header";
    head.setAttribute("data-panel-head", "");
    const ht = document.createElement("span"); ht.textContent = t("settings.menuHide");
    const x = document.createElement("span");
    x.setAttribute("data-no-drag", "");
    x.style.cssText = "cursor:pointer;color:var(--ws-text-secondary);display:inline-flex;";
    x.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    x.onclick = () => _closeMenuHideManager();
    head.appendChild(ht); head.appendChild(x);
    p.appendChild(head);

    const tabs = document.createElement("div");
    tabs.className = "wosai-mh-tabs";
    const tabCanvas = document.createElement("button");
    tabCanvas.type = "button"; tabCanvas.className = "wosai-mh-tab active";
    tabCanvas.textContent = t("settings.menuHideCanvas"); tabCanvas.dataset.menuTab = "canvas";
    const tabNode = document.createElement("button");
    tabNode.type = "button"; tabNode.className = "wosai-mh-tab";
    tabNode.textContent = t("settings.menuHideNode"); tabNode.dataset.menuTab = "node";
    tabs.appendChild(tabCanvas); tabs.appendChild(tabNode);
    p.appendChild(tabs);

    const search = document.createElement("input");
    search.type = "text"; search.className = "wosai-mh-search";
    search.placeholder = t("settings.menuHideSearchPlaceholder");
    p.appendChild(search);

    const filters = document.createElement("div");
    filters.className = "wosai-mh-filters";
    const chipDefault = document.createElement("button"); chipDefault.type = "button"; chipDefault.className = "wosai-mh-chip active"; chipDefault.textContent = t("settings.menuHideSortDefault"); chipDefault.dataset.sort = "default";
    const chipWosai = document.createElement("button"); chipWosai.type = "button"; chipWosai.className = "wosai-mh-chip"; chipWosai.textContent = t("settings.menuHideOnlyWosai"); chipWosai.dataset.filter = "only-wosai";
    const chipExcludeWosai = document.createElement("button"); chipExcludeWosai.type = "button"; chipExcludeWosai.className = "wosai-mh-chip"; chipExcludeWosai.textContent = t("settings.menuHideExcludeWosai"); chipExcludeWosai.dataset.filter = "exclude-wosai";
    filters.appendChild(chipDefault); filters.appendChild(chipWosai); filters.appendChild(chipExcludeWosai);

    const toolbar = document.createElement("div");
    toolbar.className = "wosai-mh-toolbar";
    const btnRefresh = document.createElement("button"); btnRefresh.type = "button"; btnRefresh.className = "wosai-mh-tool"; btnRefresh.textContent = t("settings.menuHideRefresh");
    const btnHideAll = document.createElement("button"); btnHideAll.type = "button"; btnHideAll.className = "wosai-mh-tool"; btnHideAll.textContent = t("settings.menuHideHideAll");
    const btnShowAll = document.createElement("button"); btnShowAll.type = "button"; btnShowAll.className = "wosai-mh-tool"; btnShowAll.textContent = t("settings.menuHideShowAll");
    toolbar.appendChild(btnRefresh); toolbar.appendChild(btnHideAll); toolbar.appendChild(btnShowAll);
    p.appendChild(toolbar);
    p.appendChild(filters);

    const list = document.createElement("div");
    list.className = "wosai-mh-list";
    p.appendChild(list);

    const footer = document.createElement("div");
    footer.className = "wosai-mh-footer";
    const reset = document.createElement("button");
    reset.type = "button"; reset.className = "wosai-mh-reset";
    reset.textContent = t("settings.menuHideReset");
    const confirmHide = document.createElement("button");
    confirmHide.type = "button"; confirmHide.className = "wosai-mh-confirm";
    confirmHide.textContent = t("settings.menuHideConfirmHide");
    const cancelSettings = document.createElement("button");
    cancelSettings.type = "button"; cancelSettings.className = "wosai-mh-cancel";
    cancelSettings.textContent = t("settings.menuHideCancelSettings");
    footer.appendChild(reset); footer.appendChild(confirmHide); footer.appendChild(cancelSettings);
    p.appendChild(footer);
    const copyright = document.createElement("div");
    copyright.className = "wosai-mh-copyright wosai-control-copyright";
    copyright.textContent = WOSAI_COPYRIGHT;
    p.appendChild(copyright);

    document.body.appendChild(p);
    _mhPanel = p;
    p.setAttribute("data-theme", getGlassTheme());

    const r = p.getBoundingClientRect();
    const pos = calcSnapToNodeSide(r.width, r.height);
    p.style.left = Math.round(pos.x) + "px";
    p.style.top = Math.round(pos.y) + "px";

    let currentTab = "canvas";
    let currentSearch = "";
    let wosaiFilter = "all";    // "all" | "only" | "exclude"

    const render = () => {
        const hiddenMap = MenuHide.config[currentTab] || {};
        let items = MenuHide._collectedItems[currentTab] || [];
        if (wosaiFilter === "only") items = items.filter((it) => _isWosaiItem(it));
        if (wosaiFilter === "exclude") items = items.filter((it) => !_isWosaiItem(it));
        // 搜索过滤
        if (currentSearch) {
            const sl = currentSearch.toLowerCase();
            items = items.filter((it) => it.toLowerCase().includes(sl));
        }
        if (items.length === 0) {
            const empty = document.createElement("div");
            empty.className = "wosai-mh-empty";
            empty.textContent = t("settings.menuHideEmptyTip");
            list.replaceChildren(empty);
            return;
        }
        const fragment = document.createDocumentFragment();
        items.forEach((item) => {
            const isHidden = !!hiddenMap[item];
            const isProtected = MenuHide.isProtectedMenuItem(item);
            const display = item.length > 28 ? item.substring(0, 28) + "…" : item;
            const label = document.createElement("label");
            label.className = "wosai-mh-item";
            label.title = item;
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.dataset.item = item;
            checkbox.checked = isHidden;
            checkbox.disabled = isProtected;
            const text = document.createElement("span");
            text.textContent = display;
            label.append(checkbox, text);
            fragment.appendChild(label);
        });
        list.replaceChildren(fragment);
        list.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
            cb.addEventListener("change", () => MenuHide.setHidden(currentTab, cb.dataset.item, cb.checked));
        });
    };

    const selectTab = (tab) => {
        if (currentTab === tab) return;
        currentTab = tab;
        tabCanvas.classList.toggle("active", tab === "canvas");
        tabNode.classList.toggle("active", tab === "node");
        list.scrollTop = 0;
        render();
    };
    tabCanvas.onclick = () => selectTab("canvas");
    tabNode.onclick = () => selectTab("node");
    search.oninput = (e) => { currentSearch = e.target.value; render(); };
    search.onclick = (e) => e.stopPropagation();
    search.onpointerdown = (e) => e.stopPropagation();
    const setWosaiFilter = (mode) => {
        if (wosaiFilter === mode) return;
        wosaiFilter = mode;
        chipDefault.classList.toggle("active", mode === "all");
        chipWosai.classList.toggle("active", mode === "only");
        chipExcludeWosai.classList.toggle("active", mode === "exclude");
        render();
    };
    chipDefault.onclick = () => setWosaiFilter("all");
    chipWosai.onclick = () => setWosaiFilter("only");
    chipExcludeWosai.onclick = () => setWosaiFilter("exclude");
    btnRefresh.onclick = () => { MenuHide.collectCurrentMenu(currentTab); render(); };
    btnHideAll.onclick = () => {
        (MenuHide._collectedItems[currentTab] || []).forEach((it) => {
            if (!MenuHide.isProtectedMenuItem(it)) MenuHide.setHidden(currentTab, it, true);
        });
        render();
    };
    btnShowAll.onclick = () => {
        (MenuHide._collectedItems[currentTab] || []).forEach((it) => MenuHide.setHidden(currentTab, it, false));
        render();
    };
    reset.onclick = () => {
        if (confirm(t("settings.menuHideConfirmReset"))) { MenuHide.resetAll(); render(); }
    };
    confirmHide.onclick = () => MenuHide.setEnabled(true);
    cancelSettings.onclick = () => _closeMenuHideManager();

    // 首次进入：若尚未收集过菜单项，自动触发一次收集提示（用户需先在画布右键）
    if (!(MenuHide._collectedItems[currentTab] || []).length) {
        list.innerHTML = `<div class="wosai-mh-empty">${t("settings.menuHideEmptyTip").replace(/\n/g, "<br>")}</div>`;
    } else {
        render();
    }

    _mhOffLang = onLangChange(() => { if (_mhPanel) openMenuHideManager(); });
}

function _closeMenuHideManager() {
    if (_mhPanel) { _mhPanel.remove(); _mhPanel = null; }
    if (_mhOffLang) { _mhOffLang(); _mhOffLang = null; }
}

// ── 暴露接口 ──
window.__wosaiMenuHide = MenuHide;
window.__wosaiOpenMenuHideManager = openMenuHideManager;
window.__wosaiProtectNodeMenuItems = (options) => MenuHide._protectXzgNodeMenuItems(options);
window.__wosaiGetCanvasWosaiOptions = () => MenuHide._getCanvasWosaiOptions();

registerHubBarButton({
    id: "menuHide",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h6"/><path d="m18 15 3 3-3 3"/></svg>',
    labelKey: "menus.hubBar.manageContextMenuShort",
    hubLabelKey: "menus.hubBar.manageContextMenuShort",
    tipKey: "menus.hubBar.tips.menuHide",
    selectionToolbox: false,
    onClick: openMenuHideManager,
});

app.registerExtension({
    name: "WOSAI.MenuHide",
    setup() {
        MenuHide.init();
        recoverXzgMenuOnce();
    },
    getCanvasMenuItems() {
        MenuHide._lastMenuType = "canvas";
        const items = MenuHide._getCanvasWosaiOptions();
        MenuHide._collectItems(items, "canvas");
        return items;
    },
    getNodeMenuItems() {
        MenuHide._lastMenuType = "node";
        return [];
    },
    remove() {
        unregisterHubBarButton("menuHide");
        _closeMenuHideManager();
        delete window.__wosaiProtectNodeMenuItems;
        delete window.__wosaiGetCanvasWosaiOptions;
        if (MenuHide._domObserver) { MenuHide._domObserver.disconnect(); MenuHide._domObserver = null; }
        if (_xzgMenuRecoveryTimer) { clearTimeout(_xzgMenuRecoveryTimer); _xzgMenuRecoveryTimer = null; }
    },
});
