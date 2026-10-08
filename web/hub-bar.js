// WOSAI selection-toolbox adapter.
//
// ComfyUI owns selection state, command execution, popovers, and menus. WOSAI
// only skins the native controls in place, so every action remains a real Vue
// button instead of a synthetic click proxy.
import { app } from "../../../scripts/app.js";
import { quickToast } from "./shared/toast.js";
import { t, onLangChange } from "./shared/i18n.js";
import { getSelectedGroups, getSelectedNodes } from "./shared/canvas-utils.js";
import { getGlassTheme, onGlassChange } from "./shared/glass-theme.js";
import { hideTip, showTip } from "./shared/tooltip.js";
import { STORAGE_KEYS } from "./shared/constants.js";

// Keep the adapter owner version separate from the resource query version in
// extension.json.  A new owner version lets a refreshed module replace an
// older cached registration without duplicating commands.
const ADAPTER_VERSION = 63;
const CORE_COMMANDS = Object.freeze({
    color: "wosai.selection.color",
    align: "wosai.selection.align",
    node: "wosai.selection.node",
    replace: "wosai.selection.replace",
    collapse: "wosai.selection.collapse",
    clone: "wosai.selection.clone",
    lock: "wosai.selection.lock",
});
const EXTRA_COMMAND_PREFIX = "wosai.selection.extra.";
const EXTRA_REGISTRY_KEY = "__wosaiSelectionToolboxExtras";
const EXTRA_REGISTERED_KEY = "__wosaiSelectionToolboxExtraCommands";
const CORE_MODULE_URLS = Object.freeze({
    // ComfyUI serves every file in WEB_DIRECTORY with an unversioned URL.
    // Import that exact URL so we reuse the initialized extension instance
    // instead of evaluating a second, lifecycle-less cache-busted copy.
    color: "./color-bar.js",
    node: "./layout-toolkit.js",
    autoConnect: "./auto-connect.js",
});
const _coreModuleLoads = new Map();
const EXTRA_ICONS = Object.freeze({
    autoConnect: "pi pi-share-alt",
    shake: "pi pi-bolt",
    menuHide: "pi pi-bars",
});
const CAPTIONED_COMMANDS = new Set();
const AUTO_HIDE_MINI_ACTIONS = new Set([
    "palette", "node", "align", "autoConnect",
    "replace", "collapse", "expand", "clone", "lock",
]);
const COMMAND_MINI_ACTIONS = Object.freeze({
    [CORE_COMMANDS.color]: "palette",
    [CORE_COMMANDS.align]: "align",
    [CORE_COMMANDS.node]: "node",
    [CORE_COMMANDS.replace]: "replace",
    [CORE_COMMANDS.collapse]: "collapse",
    [CORE_COMMANDS.clone]: "clone",
    [CORE_COMMANDS.lock]: "lock",
    [`${EXTRA_COMMAND_PREFIX}autoConnect`]: "autoConnect",
});
const NATIVE_MINI_ACTIONS = Object.freeze([
    { testId: "delete-button", key: "delete", labelKey: "delete" },
    { testId: "info-button", key: "info", labelKey: "nativeInfo" },
    { testId: "color-picker-button", key: "color", labelKey: "nativeColor" },
    { testId: "convert-to-subgraph-button", key: "subgraph", labelKey: "nativeSubgraph" },
    { testId: "bypass-button", key: "ignore", labelKey: "nativeIgnore" },
    // ComfyUI's mask editor button only ships with an icon class (no data-testid).
    { iconClass: "icon-[comfy--mask]", key: "mask", labelKey: "nativeMask" },
    { testId: "more-options-button", key: "more", labelKey: null },
]);
const MINI_ICON = Object.freeze({
    delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01" stroke-linecap="round"/></svg>',
    color: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>',
    frame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/><path d="M8 12h8M12 8v8"/></svg>',
    subgraph: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5"/><path d="M8 8l8 8M16 8l-8 8"/></svg>',
    ignore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 0 1 13.5-5.8L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-13.5 5.8L4 15"/></svg>',
    mask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M12 7v13"/><path d="M7 14c2.5 1.5 7.5 1.5 10 0"/></svg>',
    palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 0-4H12a1.7 1.7 0 0 1 0-3.4h2a4 4 0 0 0 0-8Z"/><circle cx="7.5" cy="11" r=".8" fill="currentColor"/><circle cx="10" cy="7.5" r=".8" fill="currentColor"/><circle cx="14" cy="7.5" r=".8" fill="currentColor"/></svg>',
    arrange: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>',
    align: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 6h16M7 12h10M5 18h14"/><path d="M12 3v18" stroke-dasharray="1 3"/></svg>',
    node: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>',
    autoConnect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.7 7.6-4.4M8.2 13.3l7.6 4.4"/></svg>',
    replace: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-9a4 4 0 0 0-4 4v1"/><path d="m17 4 3 3-3 3"/><path d="M4 17h9a4 4 0 0 0 4-4v-1"/><path d="m7 20-3-3 3-3"/></svg>',
    collapse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 4 4-4M12 7V2"/><path d="m8 21 4-4 4 4M12 17v5"/><path d="M4 12h16"/></svg>',
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m8 7 4-4 4 4M12 3v5"/><path d="m8 17 4 4 4-4M12 21v-5"/><path d="M4 12h16"/></svg>',
    clone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>',
    compact: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>',
    restoreLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
    restoreRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
});
const TOOLTIP_MARK = "data-wosai-selection-tooltip";
const TOOLBOX_ROOT_SELECTOR = [
    '[data-testid*="selection-toolbox" i]',
    '[class*="selection-toolbox" i]',
    '[class*="selectionToolbox" i]',
].join(",");
const _commandTooltips = new Map();
const _commandIcons = new Map();
let _tooltipObserver = null;
let _tooltipRefreshQueued = false;
let _offHubBarLangChange = null;
let _miniBarGlassListenerInstalled = false;
let _miniBarSelectionRestoreInstalled = false;
let _offMiniBarGlassChange = null;
let _instantPointerOver = null;
let _instantPointerOut = null;
let _instantActiveAnchor = null;
// Compact mode controls the initial presentation.  Once the user explicitly
// opens the bar, preserve that choice across node changes until they collapse
// it again (or an auto-hide action completes).
let _miniBarExpanded = false;
let _miniBarPositionListenerInstalled = false;
let _miniBarPositionListener = null;

function _isMiniBarCompactMode() {
    try {
        return localStorage.getItem(STORAGE_KEYS.miniBarCompact) !== "false";
    } catch (_) {
        return true;
    }
}

function _setMiniBarCompactMode(enabled) {
    try {
        localStorage.setItem(STORAGE_KEYS.miniBarCompact, enabled ? "true" : "false");
    } catch (_) {}
    _miniBarExpanded = false;
    document.documentElement?.toggleAttribute("data-wosai-mini-compact-mode", !!enabled);
    _syncMiniBarCompactMode();
}

function _miniBarToggle(toolbox) {
    let toggle = toolbox._wosaiMiniBarToggle;
    if (toggle?.isConnected) return toggle;

    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "wosai-mini-compact-toggle";
    const tooltipText = () => _miniBarExpanded
        ? t("menus.hubBar.compactActions", "Collapse action bar")
        : t("menus.hubBar.expandActions", "Expand action bar");
    const togglePresentation = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!_miniBarSelectionSignature()) return;
        _miniBarExpanded = !_miniBarExpanded;
        hideTip();
        _syncMiniBarCompactMode();
    };
    toggle.addEventListener("mouseenter", () => showTip(toggle, tooltipText()));
    toggle.addEventListener("mouseleave", hideTip);
    toggle.addEventListener("focus", () => showTip(toggle, tooltipText()));
    toggle.addEventListener("blur", hideTip);
    toggle.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
    });
    // Handle pointer release directly.  The expanded native toolbox installs
    // its own pointer handlers, so waiting for a synthetic click can let that
    // layer consume the interaction before this compact control sees it.
    toggle.addEventListener("pointerup", (event) => {
        toggle.dataset.wosaiPointerToggle = "1";
        togglePresentation(event);
    });
    toggle.addEventListener("click", (event) => {
        if (toggle.dataset.wosaiPointerToggle === "1") {
            delete toggle.dataset.wosaiPointerToggle;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        togglePresentation(event);
    });
    document.body.appendChild(toggle);
    toolbox._wosaiMiniBarToggle = toggle;
    return toggle;
}

function _removeMiniBarToggle(toolbox) {
    const toggle = toolbox?._wosaiMiniBarToggle;
    toggle?.remove();
    if (toolbox) delete toolbox._wosaiMiniBarToggle;
}

function _positionMiniBarToggle(toolbox, toggle) {
    const applyPosition = () => {
        if (!toolbox.isConnected || !toggle.isConnected || toolbox._wosaiMiniBarToggle !== toggle) return;
        const rect = toolbox.getBoundingClientRect();
        const size = toggle.getBoundingClientRect().width || 30;
        const gap = Number.parseFloat(getComputedStyle(document.documentElement)
            .getPropertyValue("--ws-hk-mini-compact-gap")) || 8;
        const fitsLeft = rect.left - gap >= size;
        const fitsRight = window.innerWidth - rect.right - gap >= size;
        // Prefer the left edge so More and its popup remain clear.  If that
        // would clip at the viewport edge, flip to the right and match the
        // collapse arrow to the actual side.
        const side = fitsLeft || !fitsRight ? "left" : "right";
        const left = side === "left" ? rect.left - size - gap : rect.right + gap;
        const top = rect.top + rect.height / 2 - size / 2;
        const maxLeft = Math.max(gap, window.innerWidth - size - gap);
        const maxTop = Math.max(gap, window.innerHeight - size - gap);
        toggle.style.left = `${Math.round(Math.min(maxLeft, Math.max(gap, left)))}px`;
        toggle.style.top = `${Math.round(Math.min(maxTop, Math.max(gap, top)))}px`;
        toggle.dataset.side = side;
        if (toggle.dataset.state === "expanded") {
            toggle.innerHTML = MINI_ICON[side === "left" ? "restoreLeft" : "restoreRight"];
        }
        toggle.setAttribute("data-wosai-mini-positioned", "");
    };

    if (toggle.hasAttribute("data-wosai-mini-positioned")) {
        applyPosition();
        return;
    }
    if (toggle._wosaiMiniPositionQueued) return;
    toggle._wosaiMiniPositionQueued = true;
    // ComfyUI settles the native selection toolbar's position on the next
    // render pass.  Keep the new trigger invisible until that position is
    // stable, so it never appears at a stale coordinate then slides upward.
    requestAnimationFrame(() => requestAnimationFrame(() => {
        toggle._wosaiMiniPositionQueued = false;
        applyPosition();
    }));
}

function _syncMiniBarCompactMode() {
    if (!document.body) return;
    const compactEnabled = _isMiniBarCompactMode();
    const suppressed = _isTitleNoteMiniBarSelection();
    document.documentElement?.toggleAttribute("data-wosai-mini-compact-mode", compactEnabled);
    const signature = _miniBarSelectionSignature();
    document.querySelectorAll('[data-testid="selection-toolbox"]').forEach((toolbox) => {
        toolbox.toggleAttribute("data-wosai-mini-suppressed", suppressed);
        if (suppressed) {
            toolbox.removeAttribute("data-wosai-mini-compact");
            toolbox.removeAttribute("data-wosai-mini-expanded");
            _removeMiniBarToggle(toolbox);
            return;
        }
        if (!signature || !compactEnabled) {
            toolbox.removeAttribute("data-wosai-mini-compact");
            toolbox.removeAttribute("data-wosai-mini-expanded");
            if (!compactEnabled) {
                toolbox.removeAttribute("data-wosai-mini-hidden");
                toolbox.removeAttribute("data-wosai-mini-hidden-selection");
            }
            _removeMiniBarToggle(toolbox);
            return;
        }

        const expanded = _miniBarExpanded;
        toolbox.toggleAttribute("data-wosai-mini-compact", !expanded);
        toolbox.toggleAttribute("data-wosai-mini-expanded", expanded);
        if (expanded) toolbox.removeAttribute("data-wosai-mini-hidden");
        const toggle = _miniBarToggle(toolbox);
        toggle.dataset.state = expanded ? "expanded" : "compact";
        toggle.setAttribute("data-theme", getGlassTheme());
        toggle.setAttribute("aria-label", expanded ? t("menus.hubBar.compact", "Collapse MiniBar") : t("menus.hubBar.expand", "Expand MiniBar"));
        toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
        toggle.innerHTML = MINI_ICON[expanded ? "restoreLeft" : "compact"];
        _positionMiniBarToggle(toolbox, toggle);
    });

    document.querySelectorAll(".wosai-mini-compact-toggle").forEach((toggle) => {
        const owner = [...document.querySelectorAll('[data-testid="selection-toolbox"]')]
            .find((toolbox) => toolbox._wosaiMiniBarToggle === toggle);
        if (!owner) toggle.remove();
    });
}

function _installMiniBarPositionSync() {
    if (_miniBarPositionListenerInstalled) return;
    _miniBarPositionListenerInstalled = true;
    _miniBarPositionListener = () => requestAnimationFrame(_syncMiniBarCompactMode);
    window.addEventListener("resize", _miniBarPositionListener, { passive: true });
    window.addEventListener("scroll", _miniBarPositionListener, true);
}

function _syncMiniBarGlassTheme(theme = getGlassTheme()) {
    document.querySelectorAll('[data-wosai-mini-surface]').forEach((surface) => {
        surface.setAttribute("data-theme", theme);
    });
    document.querySelectorAll(".wosai-mini-compact-toggle").forEach((toggle) => {
        toggle.setAttribute("data-theme", theme);
    });
}

function _installMiniBarGlassTheme() {
    if (_miniBarGlassListenerInstalled) return;
    _miniBarGlassListenerInstalled = true;
    _offMiniBarGlassChange = onGlassChange((theme) => _syncMiniBarGlassTheme(theme));
}

function _selectedMiniBarItems() {
    const canvas = app.canvas;
    const selectedItems = canvas?.selectedItems;
    if (selectedItems && typeof selectedItems[Symbol.iterator] === "function") {
        const items = [...selectedItems];
        if (items.length) return items;
    }
    return Object.values(canvas?.selected_nodes || {});
}

function _miniBarSelectionSignature() {
    return _selectedMiniBarItems()
        .map((item, index) => `${item?.constructor?.name || "item"}:${item?.id ?? index}`)
        .sort()
        .join("|");
}

function _isTitleNoteMiniBarSelection() {
    return _selectedMiniBarItems().some((item) => item?.type === "WOSAI_TitleNote");
}

function _restoreMiniBarsForSelectionChange() {
    const current = _miniBarSelectionSignature();
    document.querySelectorAll('[data-wosai-mini-hidden]').forEach((toolbox) => {
        if (toolbox.getAttribute("data-wosai-mini-hidden-selection") === current) return;
        toolbox.removeAttribute("data-wosai-mini-hidden");
        toolbox.removeAttribute("data-wosai-mini-hidden-selection");
    });
    _syncMiniBarCompactMode();
}

function _queueMiniBarSelectionRestore() {
    requestAnimationFrame(() => requestAnimationFrame(_restoreMiniBarsForSelectionChange));
}

function _installMiniBarSelectionRestore() {
    if (_miniBarSelectionRestoreInstalled) return;
    _miniBarSelectionRestoreInstalled = true;
    document.addEventListener("pointerup", _queueMiniBarSelectionRestore, true);
    document.addEventListener("keyup", _queueMiniBarSelectionRestore, true);
}

function _hideMiniBarAfterAction(button) {
    const toolbox = button.closest?.('[data-testid="selection-toolbox"]');
    if (!toolbox) return;
    toolbox.setAttribute("data-wosai-mini-hidden-selection", _miniBarSelectionSignature());
    toolbox.setAttribute("data-wosai-mini-hidden", "");
    // Actions such as Color may need the current native bar out of the way,
    // but they must not discard the user's explicit "keep MiniBar expanded"
    // choice.  A later node selection restores the bar in that same session.
    if (!_isMiniBarCompactMode() || !_miniBarExpanded) {
        requestAnimationFrame(_syncMiniBarCompactMode);
    }
}

function _ensureSelectionToolboxCaptions() {
    _installMiniBarGlassTheme();
    _installMiniBarSelectionRestore();
    _installMiniBarPositionSync();
    if (document.getElementById("wosai-selection-toolbox-captions")) return;
    const style = document.createElement("style");
    style.id = "wosai-selection-toolbox-captions";
    style.textContent = `
        button[data-wosai-mini-skinned] {
            position:relative!important;
            overflow:visible!important;
            width:var(--ws-hk-mini-button-width)!important;
            min-width:var(--ws-hk-mini-button-width)!important;
            height:var(--ws-hk-mini-button-height)!important;
            padding:0!important;
            border:0!important;
            background:transparent!important;
            color:var(--ws-text-secondary)!important;
            border-radius:var(--ws-hk-mini-button-radius)!important;
            transition:color .15s!important;
        }
        button[data-wosai-mini-skinned]:hover {
            background:transparent!important;
            color:var(--ws-accent)!important;
        }
        button[data-wosai-mini-skinned]::before {
            content:"";
            position:absolute;
            left:50%;
            top:var(--ws-hk-mini-icon-bg-top);
            width:var(--ws-hk-btn-size);
            height:var(--ws-hk-btn-size);
            transform:translateX(-50%);
            border-radius:var(--ws-radius-full);
            background:var(--ws-gt-btn-bg-dark);
            transition:background .15s,transform .12s;
            pointer-events:none;
        }
        button[data-wosai-mini-skinned]:hover::before {
            background:var(--ws-hk-btn-hover-bg-dark);
            transform:translateX(-50%) scale(1.1);
        }
        button[data-wosai-mini-skinned]:active::before {
            transform:translateX(-50%) scale(.94);
        }
        [data-wosai-mini-bar] {
            height:var(--ws-hk-mini-bar-height)!important;
            min-height:var(--ws-hk-mini-bar-height)!important;
            max-height:var(--ws-hk-mini-bar-height)!important;
            padding-left:var(--ws-hk-mini-bar-padding-x)!important;
            padding-right:var(--ws-hk-mini-bar-padding-x)!important;
            box-sizing:border-box!important;
            align-items:center!important;
            border-radius:var(--ws-hk-bar-radius)!important;
            transform-origin:left center;
            transition:none!important;
        }
        [data-testid="selection-toolbox"][data-wosai-mini-compact] [data-wosai-mini-bar],
        html[data-wosai-mini-compact-mode] [data-testid="selection-toolbox"]:not([data-wosai-mini-expanded]) [data-wosai-mini-bar] {
            opacity:0;
            transform:none;
        }
        [data-testid="selection-toolbox"][data-wosai-mini-expanded] [data-wosai-mini-bar] {
            opacity:1;
            transform:none;
        }
        [data-testid="selection-toolbox"][data-wosai-mini-surface] {
            overflow:visible!important;
            border-radius:var(--ws-hk-bar-radius)!important;
            background:var(--ws-gt-glass-dark)!important;
            border:var(--ws-gt-border-dark)!important;
            box-shadow:var(--ws-gt-shadow-dark)!important;
            backdrop-filter:var(--ws-gt-blur)!important;
            -webkit-backdrop-filter:var(--ws-gt-blur)!important;
            color-scheme:dark;
            transition:background .18s ease,border-color .18s ease,box-shadow .18s ease;
        }
        [data-testid="selection-toolbox"][data-wosai-mini-hidden] {
            opacity:0!important;
            pointer-events:none!important;
        }
        [data-testid="selection-toolbox"][data-wosai-mini-suppressed] {
            display:none!important;
        }
        [data-testid="selection-toolbox"][data-wosai-mini-compact] {
            opacity:0!important;
            pointer-events:none!important;
        }
        html[data-wosai-mini-compact-mode] [data-testid="selection-toolbox"]:not([data-wosai-mini-expanded]) {
            opacity:0!important;
            pointer-events:none!important;
        }
        .wosai-mini-compact-toggle {
            position:fixed;
            z-index:var(--ws-z-hud);
            display:grid;
            place-items:center;
            width:var(--ws-hk-mini-compact-size);
            min-width:var(--ws-hk-mini-compact-size);
            height:var(--ws-hk-mini-compact-size);
            padding:0;
            border:var(--ws-gt-border-dark);
            border-radius:var(--ws-radius-full);
            background:var(--ws-gt-glass-dark);
            box-shadow:var(--ws-gt-shadow-dark);
            backdrop-filter:var(--ws-gt-blur);
            -webkit-backdrop-filter:var(--ws-gt-blur);
            color:var(--ws-text-secondary);
            cursor:pointer;
            pointer-events:auto!important;
            visibility:hidden;
            transition:none!important;
        }
        .wosai-mini-compact-toggle[data-wosai-mini-positioned] {
            visibility:visible;
        }
        .wosai-mini-compact-toggle:hover {
            color:var(--ws-accent);
            background:var(--ws-hk-btn-hover-bg-dark);
        }
        .wosai-mini-compact-toggle svg {
            width:var(--ws-hk-mini-compact-icon-size);
            height:var(--ws-hk-mini-compact-icon-size);
            display:block;
        }
        [data-theme="light"] ~ .wosai-mini-compact-toggle,
        .wosai-mini-compact-toggle[data-theme="light"] {
            background:var(--ws-gt-glass-light);
            border:var(--ws-gt-border-light);
            box-shadow:var(--ws-gt-shadow-light);
        }
        [data-testid="selection-toolbox"][data-wosai-mini-surface][data-theme="light"] {
            background:var(--ws-gt-glass-light)!important;
            border:var(--ws-gt-border-light)!important;
            box-shadow:var(--ws-gt-shadow-light)!important;
            color-scheme:light;
        }
        [data-testid="selection-toolbox"][data-wosai-mini-surface][data-theme="light"] button[data-wosai-mini-skinned]:hover {
            background:transparent!important;
        }
        [data-testid="selection-toolbox"][data-wosai-mini-surface][data-theme="light"] button[data-wosai-mini-skinned]::before {
            background:var(--ws-gt-btn-bg-light);
        }
        [data-testid="selection-toolbox"][data-wosai-mini-surface][data-theme="light"] button[data-wosai-mini-skinned]:hover::before {
            background:var(--ws-hk-btn-hover-bg-light);
        }
        button[data-wosai-mini-skinned] > .wosai-mini-original-visual {
            opacity:0!important;
            pointer-events:none!important;
        }
        .wosai-mini-native-icon {
            position:absolute;
            left:50%;
            top:var(--ws-hk-mini-icon-top);
            width:var(--ws-hk-icon-size);
            height:var(--ws-hk-icon-size);
            transform:translateX(-50%);
            z-index:1;
            transition:transform .12s,color .15s;
            pointer-events:none;
        }
        button[data-wosai-mini-skinned]:hover .wosai-mini-native-icon {
            transform:translateX(-50%) scale(1.1);
        }
        button[data-wosai-mini-skinned]:active .wosai-mini-native-icon {
            transform:translateX(-50%) scale(.94);
        }
        .wosai-mini-native-icon svg { width:100%;height:100%;display:block; }
        button[data-wosai-mini-action="color"] .wosai-mini-native-icon { width:var(--ws-hk-icon-size);height:var(--ws-hk-icon-size); }
        button[data-wosai-mini-action="more"] { width:var(--ws-hk-mini-more-width)!important;min-width:var(--ws-hk-mini-more-width)!important; }
        button[data-wosai-mini-action="more"]::before {
            top:50%;transform:translate(-50%,-50%);
        }
        button[data-wosai-mini-action="more"]:hover::before {
            transform:translate(-50%,-50%) scale(1.1);
        }
        button[data-wosai-mini-action="more"]:active::before {
            transform:translate(-50%,-50%) scale(.94);
        }
        button[data-wosai-mini-action="more"] .wosai-mini-native-icon {
            top:50%;width:var(--ws-hk-mini-more-icon-size);height:var(--ws-hk-mini-more-icon-size);transform:translate(-50%,-50%);
        }
        button[data-wosai-mini-action="more"]:hover .wosai-mini-native-icon {
            transform:translate(-50%,-50%) scale(1.1);
        }
        button[data-wosai-mini-action="more"]:active .wosai-mini-native-icon {
            transform:translate(-50%,-50%) scale(.94);
        }
        button[data-wosai-mini-caption]::after {
            content:attr(data-wosai-mini-caption);
            position:absolute;
            left:50%;
            bottom:var(--ws-hk-mini-caption-bottom);
            transform:translateX(-50%);
            color:var(--ws-text-secondary);
            font:var(--ws-hk-caption-weight) var(--ws-hk-caption-size)/1 var(--ws-font-family);
            white-space:nowrap;
            pointer-events:none;
        }
        /* The native Arrange split-button owns its icon geometry and click
           targets. Keep its layout intact; only align its visual treatment. */
        button[data-wosai-mini-captioned] {
            position:relative!important;
            overflow:visible!important;
            width:var(--ws-hk-mini-button-width)!important;
            min-width:var(--ws-hk-mini-button-width)!important;
            height:var(--ws-hk-mini-button-height)!important;
            padding:0!important;
            border:0!important;
            background:transparent!important;
            color:var(--ws-text-secondary)!important;
            border-radius:var(--ws-hk-mini-button-radius)!important;
            box-shadow:none!important;
            transform:none!important;
            transition:color .15s!important;
        }
        button[data-wosai-mini-captioned]:hover {
            background:transparent!important;
            color:var(--ws-accent)!important;
        }
        button[data-wosai-mini-captioned]::before {
            content:"";
            position:absolute;
            left:50%;
            top:var(--ws-hk-mini-icon-bg-top);
            width:var(--ws-hk-btn-size);
            height:var(--ws-hk-btn-size);
            transform:translateX(-50%);
            border-radius:var(--ws-radius-full);
            background:var(--ws-gt-btn-bg-dark);
            pointer-events:none;
        }
        button[data-wosai-mini-captioned] > .wosai-mini-arrange-original {
            opacity:0!important;
        }
        .wosai-mini-arrange-icon {
            position:absolute;
            left:50%;
            top:var(--ws-hk-mini-icon-top);
            width:var(--ws-hk-icon-size);
            height:var(--ws-hk-icon-size);
            transform:translateX(-50%);
            z-index:1;
            pointer-events:none;
        }
        .wosai-mini-arrange-icon svg {
            width:100%;
            height:100%;
            display:block;
        }
        [data-testid="selection-toolbox"][data-wosai-mini-surface][data-theme="light"] button[data-wosai-mini-captioned]::before {
            background:var(--ws-gt-btn-bg-light);
        }
        button[data-wosai-mini-captioned]::after {
            bottom:var(--ws-hk-mini-caption-bottom)!important;
            transform:translateX(-50%);
        }
        button[data-wosai-mini-captioned]:hover::before {
            background:var(--ws-hk-btn-hover-bg-dark);
        }
        [data-testid="selection-toolbox"][data-wosai-mini-surface][data-theme="light"] button[data-wosai-mini-captioned]:hover::before {
            background:var(--ws-hk-btn-hover-bg-light);
        }
        @media (prefers-reduced-motion:reduce) {
            [data-wosai-mini-bar],
            .wosai-mini-compact-toggle { transition:none!important; }
        }
        [data-wosai-mini-arrange-surface] {
            background:transparent!important;
            border:0!important;
            box-shadow:none!important;
        }
    `;
    document.head.appendChild(style);
}

function _applySelectionToolboxCaptions() {
    _ensureSelectionToolboxCaptions();
    for (const commandId of CAPTIONED_COMMANDS) {
        const icon = _commandIcons.get(commandId);
        const label = _commandTooltips.get(commandId);
        const iconToken = String(icon || "").split(/\s+/).find((token) => token.startsWith("pi-"));
        if (!iconToken || !label) continue;
        document.querySelectorAll(`.${iconToken}`).forEach((iconEl) => {
            const button = _buttonAnchor(iconEl);
            if (!button || !_isSelectionToolboxElement(button)) return;
            let actionKey = COMMAND_MINI_ACTIONS[commandId];
            let actionLabel = label;
            if (actionKey === "collapse" && window.__wosaiCollapseAction?.() === "expand") {
                actionKey = "expand";
                actionLabel = t("menus.layoutToolkit.expandLabel");
            }
            if (actionKey) _skinMiniButton(button, actionKey, actionLabel);
            else button.setAttribute("data-wosai-mini-caption", label);
        });
    }
    _applyNativeSelectionToolboxCaptions();
}

function _skinMiniButton(button, key, label) {
    if (!button || !MINI_ICON[key]) return;
    button.setAttribute("data-wosai-mini-skinned", "");
    button.setAttribute("data-wosai-mini-action", key);
    if (label) button.setAttribute("data-wosai-mini-caption", label);
    else button.removeAttribute("data-wosai-mini-caption");
    if (label && !button.getAttribute("aria-label")) button.setAttribute("aria-label", label);

    let icon = button.querySelector(":scope > .wosai-mini-native-icon");
    if (!icon) {
        [...button.children].forEach((child) => child.classList.add("wosai-mini-original-visual"));
        icon = document.createElement("span");
        icon.className = "wosai-mini-native-icon";
        icon.setAttribute("aria-hidden", "true");
        button.appendChild(icon);
    }
    if (icon.dataset.wosaiMiniIcon !== key) {
        icon.dataset.wosaiMiniIcon = key;
        icon.innerHTML = MINI_ICON[key];
    }
    if (AUTO_HIDE_MINI_ACTIONS.has(key) && !button.hasAttribute("data-wosai-mini-auto-hide")) {
        button.setAttribute("data-wosai-mini-auto-hide", "");
        button.addEventListener("click", () => requestAnimationFrame(() => _hideMiniBarAfterAction(button)));
    }
}

function _captionNativeMiniButton(button, label) {
    if (!button || !label) return;
    button.setAttribute("data-wosai-mini-captioned", "");
    button.setAttribute("data-wosai-mini-caption", label);
    if (!button.getAttribute("aria-label")) button.setAttribute("aria-label", label);
    const splitSurface = button.closest?.('[class*="splitbutton" i],[data-pc-name="splitbutton" i]');
    splitSurface?.setAttribute("data-wosai-mini-arrange-surface", "");

    let icon = button.querySelector(":scope > .wosai-mini-arrange-icon");
    if (!icon) {
        [...button.children].forEach((child) => child.classList.add("wosai-mini-arrange-original"));
        icon = document.createElement("span");
        icon.className = "wosai-mini-arrange-icon";
        icon.setAttribute("aria-hidden", "true");
        button.appendChild(icon);
    }
    icon.innerHTML = MINI_ICON.arrange;
}

function _nativeMiniButtonLabel(button) {
    return [
        button?.getAttribute?.("aria-label"),
        button?.getAttribute?.("data-tooltip"),
        button?.getAttribute?.("data-p-tooltip"),
        button?.getAttribute?.("title"),
    ].find((label) => String(label || "").trim())?.trim() || "";
}

function _selectionToolboxContent(toolbox) {
    return toolbox.querySelector('[data-pc-section="content"],.p-panel-content') || toolbox;
}

function _applyNativeSelectionToolboxCaptions() {
    _restoreMiniBarsForSelectionChange();
    document.querySelectorAll('[data-testid="selection-toolbox"]').forEach((toolbox) => {
        toolbox.setAttribute("data-wosai-mini-surface", "");
        toolbox.setAttribute("data-theme", getGlassTheme());
        _selectionToolboxContent(toolbox).setAttribute("data-wosai-mini-bar", "");
        for (const action of NATIVE_MINI_ACTIONS) {
            let button = null;
            if (action.testId) {
                button = toolbox.querySelector(`button[data-testid="${action.testId}"]`);
            } else if (action.iconClass) {
                const icon = [...toolbox.querySelectorAll("i")]
                    .find((el) => el.classList.contains(action.iconClass));
                button = _buttonAnchor(icon);
            }
            if (button) {
                const label = action.labelKey
                    ? t(`menus.layoutToolkit.${action.labelKey}`)
                    : "";
                _skinMiniButton(button, action.key, label);
            }
        }
        const frameIcon = [...toolbox.querySelectorAll("i")]
            .find((icon) => icon.classList.contains("icon-[lucide--frame]"));
        const frameButton = _buttonAnchor(frameIcon);
        if (frameButton) _skinMiniButton(frameButton, "frame", t("menus.layoutToolkit.nativeFrame"));

        // ComfyUI adds this native split-button only for multi-selection. It
        // is not registered through our command bridge, so caption it by its
        // accessible label while preserving its own icon and dropdown action.
        const arrangeButton = [...toolbox.querySelectorAll("button")].find((button) => {
            const marker = [
                button.getAttribute("data-testid"),
                button.getAttribute("aria-label"),
                button.getAttribute("data-tooltip"),
                button.getAttribute("title"),
            ].filter(Boolean).join(" ");
            return /\barrange\b|\u6392\u5217/i.test(marker);
        });
        if (arrangeButton) {
            _captionNativeMiniButton(
                arrangeButton,
                _nativeMiniButtonLabel(arrangeButton) || t("menus.layoutToolkit.nativeArrange")
            );
        }
    });
}

function _attributeValue(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function _tooltipAnchor(el) {
    return el?.closest?.("button,[role='button']") || el || null;
}

function _buttonAnchor(el) {
    return el?.closest?.("button,[role='button']") || null;
}

function _isSelectionToolboxElement(el) {
    for (let current = el; current && current !== document.body; current = current.parentElement) {
        const marker = [
            current.id,
            typeof current.className === "string" ? current.className : "",
            current.getAttribute?.("data-testid"),
            current.getAttribute?.("data-pc-name"),
        ].filter(Boolean).join(" ");
        if (/selection.*(?:tool|box)|(?:tool|box).*selection/i.test(marker)) return true;
    }
    return false;
}

function _labelTooltipForElement(anchor) {
    const labels = [
        anchor.getAttribute?.("aria-label"),
        anchor.getAttribute?.("data-tooltip"),
        anchor.getAttribute?.("data-p-tooltip"),
        anchor.getAttribute?.("title"),
        anchor.textContent,
    ].filter(Boolean).map((value) => String(value).trim());
    for (const [commandId, tooltip] of _commandTooltips) {
        if (!labels.includes(tooltip)) continue;
        // The concise WOSAI labels are the final fallback for frontend builds
        // that expose neither an id nor a toolbox container in the DOM.
        anchor.setAttribute(TOOLTIP_MARK, commandId);
        return { anchor, text: tooltip };
    }
    return null;
}

function _iconTooltipForElement(anchor) {
    const classes = new Set();
    [anchor, ...(anchor.querySelectorAll?.("[class]") || [])].forEach((el) => {
        const value = typeof el.className === "string" ? el.className : el.className?.baseVal;
        String(value || "").split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
    });
    for (const [commandId, icon] of _commandIcons) {
        const iconTokens = String(icon).split(/\s+/).filter((token) => token.startsWith("pi-"));
        if (!iconTokens.length || !iconTokens.every((token) => classes.has(token))) continue;
        const tooltip = _commandTooltips.get(commandId);
        if (!tooltip) continue;
        anchor.setAttribute(TOOLTIP_MARK, commandId);
        return { anchor, text: tooltip };
    }
    return null;
}

function _commandTooltipForElement(el) {
    const anchor = _tooltipAnchor(el);
    // Do not climb into the toolbox container. It can contain several native
    // actions and must never donate one WOSAI tooltip to all of its children.
    const markedId = anchor.getAttribute?.(TOOLTIP_MARK);
    if (_commandTooltips.has(markedId)) return { anchor, text: _commandTooltips.get(markedId) };
    const commandId = anchor.getAttribute?.("data-command-id") || anchor.getAttribute?.("data-command");
    if (_commandTooltips.has(commandId)) return { anchor, text: _commandTooltips.get(commandId) };
    return _labelTooltipForElement(anchor) || _iconTooltipForElement(anchor);
}

function _installInstantSelectionToolboxTooltips() {
    if (window.__wosaiSelectionToolboxInstantTipsInstalled) return;
    window.__wosaiSelectionToolboxInstantTipsInstalled = true;
    _instantPointerOver = (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const tip = _commandTooltipForElement(target);
        // Captioned mini-bar actions already expose their name below the
        // icon. Suppress the duplicate floating tip, whose native layout can
        // otherwise anchor it to a neighboring control.
        if (tip?.anchor?.hasAttribute("data-wosai-mini-caption")) {
            hideTip();
            return;
        }
        if (!tip || tip.anchor === _instantActiveAnchor) return;
        _instantActiveAnchor = tip.anchor;
        showTip(tip.anchor, tip.text);
    };
    _instantPointerOut = (event) => {
        if (!_instantActiveAnchor || _instantActiveAnchor.contains(event.relatedTarget)) return;
        _instantActiveAnchor = null;
        hideTip();
    };
    document.addEventListener("pointerover", _instantPointerOver, true);
    document.addEventListener("pointerout", _instantPointerOut, true);
}

function _disposeHubBarRuntime() {
    _tooltipObserver?.disconnect();
    _tooltipObserver = null;
    _tooltipRefreshQueued = false;
    _offHubBarLangChange?.();
    _offHubBarLangChange = null;
    _offMiniBarGlassChange?.();
    _offMiniBarGlassChange = null;
    _miniBarGlassListenerInstalled = false;
    if (_miniBarSelectionRestoreInstalled) {
        document.removeEventListener("pointerup", _queueMiniBarSelectionRestore, true);
        document.removeEventListener("keyup", _queueMiniBarSelectionRestore, true);
        _miniBarSelectionRestoreInstalled = false;
    }
    if (_instantPointerOver) {
        document.removeEventListener("pointerover", _instantPointerOver, true);
        _instantPointerOver = null;
    }
    if (_instantPointerOut) {
        document.removeEventListener("pointerout", _instantPointerOut, true);
        _instantPointerOut = null;
    }
    _instantActiveAnchor = null;
    _miniBarExpanded = false;
    document.querySelectorAll('[data-testid="selection-toolbox"]').forEach((toolbox) => {
        toolbox.removeAttribute("data-wosai-mini-compact");
        toolbox.removeAttribute("data-wosai-mini-expanded");
        toolbox.removeAttribute("data-wosai-mini-suppressed");
        _removeMiniBarToggle(toolbox);
    });
    document.documentElement?.removeAttribute("data-wosai-mini-compact-mode");
    if (_miniBarPositionListenerInstalled) {
        window.removeEventListener("resize", _miniBarPositionListener);
        window.removeEventListener("scroll", _miniBarPositionListener, true);
        _miniBarPositionListener = null;
        _miniBarPositionListenerInstalled = false;
    }
    delete window.__wosaiSelectionToolboxInstantTipsInstalled;
    if (window.__wosaiSetMiniBarCompactMode === _setMiniBarCompactMode) {
        delete window.__wosaiSetMiniBarCompactMode;
    }
    hideTip();
}

function _applySelectionToolboxTooltips() {
    _tooltipRefreshQueued = false;
    if (!document.body || !_commandTooltips.size) return;

    for (const [commandId, tooltip] of _commandTooltips) {
        const value = _attributeValue(commandId);
        const selectors = [
            `[data-command-id="${value}"]`,
            `[data-command="${value}"]`,
            `[data-command-id*="${value}"]`,
            `[data-command*="${value}"]`,
        ].join(",");
        document.querySelectorAll(selectors).forEach((el) => {
            const anchor = _buttonAnchor(el);
            if (!anchor) return;
            anchor.setAttribute(TOOLTIP_MARK, commandId);
            // Do not hand the label back to the native tooltip system: it has
            // a visible delay. The capture-phase WOSAI tooltip is immediate.
            if (anchor.title === tooltip) anchor.removeAttribute("title");
        });
    }

    // ComfyUI releases differ in whether the command id is exposed as a data
    // attribute. If it is not, use the accessible label, but only inside its
    // native selection toolbox so unrelated controls are never annotated.
    document.querySelectorAll(TOOLBOX_ROOT_SELECTOR).forEach((root) => {
        root.querySelectorAll("button,[role='button']").forEach((button) => {
            const label = (button.getAttribute("aria-label") || button.textContent || "").trim();
            for (const [commandId, tooltip] of _commandTooltips) {
                if (label !== tooltip) continue;
                button.setAttribute(TOOLTIP_MARK, commandId);
                if (button.title === tooltip) button.removeAttribute("title");
                break;
            }
        });
    });
    _applySelectionToolboxCaptions();
}

function _queueTooltipRefresh() {
    if (_tooltipRefreshQueued) return;
    _tooltipRefreshQueued = true;
    requestAnimationFrame(_applySelectionToolboxTooltips);
}

function _registerSelectionToolboxTooltip(commandId, tooltip) {
    if (!commandId || !tooltip) return;
    _commandTooltips.set(commandId, tooltip);
    _installInstantSelectionToolboxTooltips();
    _queueTooltipRefresh();
    if (_tooltipObserver || !document.body) return;
    _tooltipObserver = new MutationObserver(_queueTooltipRefresh);
    _tooltipObserver.observe(document.body, { childList: true, subtree: true });
}

function _command(id, label, icon, handler) {
    _registerSelectionToolboxTooltip(id, label);
    _commandIcons.set(id, icon);
    CAPTIONED_COMMANDS.add(id);
    return { id, label, icon, function: handler };
}

/** 核心命令的当前语言文案（注册与语言切换刷新共用的单一来源）。 */
function _coreCommandLabels() {
    return {
        [CORE_COMMANDS.color]: t("menus.hubBar.color"),
        [CORE_COMMANDS.align]: t("menus.layoutToolkit.tabAlign"),
        [CORE_COMMANDS.node]: t("menus.layoutToolkit.tabNode"),
        [CORE_COMMANDS.replace]: t("menus.layoutToolkit.replaceNode"),
        [CORE_COMMANDS.collapse]: t("menus.layoutToolkit.collapseLabel"),
        [CORE_COMMANDS.clone]: t("menus.layoutToolkit.clone"),
        [CORE_COMMANDS.lock]: t("menus.layoutToolkit.lock"),
    };
}

/**
 * 语言切换后刷新命令文案。命令标签在注册时一次性求值并缓存到
 * _commandTooltips，若不刷新则切换语言后原生 MiniBar 的标题与即时
 * tooltip 仍停留在页面加载时的语言。
 */
function _refreshCommandLabels() {
    for (const [id, label] of Object.entries(_coreCommandLabels())) {
        if (label) _commandTooltips.set(id, label);
    }
    for (const entry of _extras().values()) {
        const label = t(entry.hubLabelKey || entry.labelKey || entry.id);
        if (label) _commandTooltips.set(`${EXTRA_COMMAND_PREFIX}${entry.id}`, label);
    }
    _queueTooltipRefresh();
}

function _extras() {
    if (!window[EXTRA_REGISTRY_KEY]) window[EXTRA_REGISTRY_KEY] = new Map();
    return window[EXTRA_REGISTRY_KEY];
}

async function _loadCoreModules(keys, action) {
    const loaded = new Map();
    try {
        for (const key of keys) {
            if (!_coreModuleLoads.has(key)) {
                const load = import(CORE_MODULE_URLS[key]).catch((error) => {
                    _coreModuleLoads.delete(key);
                    throw error;
                });
                _coreModuleLoads.set(key, load);
            }
            loaded.set(key, await _coreModuleLoads.get(key));
        }
        return loaded;
    } catch (error) {
        console.error(`[WOSAI MiniBar] Failed to load ${action} module`, error);
        return null;
    }
}

async function _openCoreAction(action) {
    if (action === "color" || action === "node") {
        let openHud = window.__wosaiOpenHud;
        if (typeof openHud !== "function" || (action === "node" && typeof window.__wosaiOpenAlignPanel !== "function")) {
            const keys = action === "node" ? ["node", "color"] : ["color"];
            const loaded = await _loadCoreModules(keys, action);
            openHud = window.__wosaiOpenHud || loaded?.get("color")?.openHud;
        }
        if (typeof openHud === "function") openHud(action);
        else quickToast(t(action === "color" ? "menus.hubBar.colorNotLoaded" : "menus.hubBar.nodeNotLoaded"));
        return;
    }
    if (action === "align") {
        let openAlign = window.__wosaiOpenAlignPanel;
        if (typeof openAlign !== "function") {
            const loaded = await _loadCoreModules(["node"], action);
            openAlign = window.__wosaiOpenAlignPanel || loaded?.get("node")?.openAlignPanel;
        }
        if (typeof openAlign === "function") openAlign({ anchorSelection: true });
        else quickToast(t("menus.hubBar.alignNotLoaded"));
        return;
    }
    if (action === "replace") {
        const nodes = getSelectedNodes();
        if (nodes.length !== 1) {
            quickToast(t("menus.layoutToolkit.selectSingleNode"));
            return;
        }
        let openReplace = window.__wosaiOpenReplacePicker;
        if (typeof openReplace !== "function") {
            const loaded = await _loadCoreModules(["node"], action);
            openReplace = window.__wosaiOpenReplacePicker || loaded?.get("node")?.openReplacePicker;
        }
        if (typeof openReplace === "function") openReplace(nodes[0]);
        else quickToast(t("menus.hubBar.replaceNotLoaded"));
        return;
    }
    const nodeActions = {
        collapse: ["applyCollapseToggle", "__wosaiApplyCollapseToggle"],
        clone: ["nodeClone", "__wosaiNodeClone"],
        lock: ["nodeLockToggle", "__wosaiNodeLockToggle"],
    };
    const [exportName, globalName] = nodeActions[action] || [];
    let handler = window[globalName];
    if (typeof handler !== "function") {
        const loaded = await _loadCoreModules(["node"], action);
        handler = window[globalName] || loaded?.get("node")?.[exportName];
    }
    if (typeof handler === "function") handler();
    else quickToast(t("menus.hubBar.nodeNotLoaded"));
}

async function _runExtraAction(id, event) {
    let loaded = null;
    if (id === "autoConnect" && typeof window.__wosaiAutoConnect !== "function") {
        loaded = await _loadCoreModules(["autoConnect"], id);
    }
    const direct = window.__wosaiAutoConnect || loaded?.get("autoConnect")?.wosaiAutoConnectSelected;
    if (typeof direct === "function") {
        direct();
        return;
    }
    const entry = _extras().get(id);
    if (typeof entry?.onClick === "function") {
        entry.onClick(event);
        return;
    }
    if (id === "autoConnect" && typeof window.__wosaiAutoConnect === "function") {
        window.__wosaiAutoConnect();
        return;
    }
    if (id === "autoConnect") quickToast(t("menus.hubBar.linkNotLoaded"));
}

function _getSelectionToolboxCommands(selectedItem) {
    if (!selectedItem) return [];
    // TitleNote is a canvas annotation. Hovering it should never surface the
    // selection Mini Bar, even if it is currently selected with other items.
    if (_isTitleNoteMiniBarSelection()) return [];
    const nodes = getSelectedNodes();
    const groups = getSelectedGroups();
    const singleNode = nodes.length === 1 && groups.length === 0;
    const multipleNodes = nodes.length > 1 && groups.length === 0;
    const singleGroup = groups.length === 1;
    const commands = [CORE_COMMANDS.color];
    if (multipleNodes) commands.push(CORE_COMMANDS.align);
    commands.push(CORE_COMMANDS.node);
    if (singleNode) commands.push(CORE_COMMANDS.replace, CORE_COMMANDS.collapse);
    if (multipleNodes) commands.push(CORE_COMMANDS.clone, CORE_COMMANDS.collapse);
    if (singleGroup) commands.push(CORE_COMMANDS.lock);
    for (const extra of _extras().values()) {
        if (extra.selectionToolbox === false) continue;
        if (typeof extra.selectionToolbox === "function" && !extra.selectionToolbox({ selectedItem, nodes: getSelectedNodes() })) continue;
        commands.push(extra.commandId);
    }
    return commands;
}

function _registerCoreCommands() {
    if (window.__wosaiSelectionToolboxCoreRegistered === ADAPTER_VERSION || !app?.registerExtension) return;
    // A numeric owner version lets a fresh adapter replace commands created by
    // an older cached instance on the same page. Older builds stored `true`.
    window.__wosaiSelectionToolboxCoreRegistered = ADAPTER_VERSION;
    const labels = _coreCommandLabels();
    app.registerExtension({
        name: "WOSAI.SelectionToolbox",
        commands: [
            _command(CORE_COMMANDS.color, labels[CORE_COMMANDS.color], "pi pi-palette", () => _openCoreAction("color")),
            _command(CORE_COMMANDS.align, labels[CORE_COMMANDS.align], "pi pi-align-center", () => _openCoreAction("align")),
            _command(CORE_COMMANDS.node, labels[CORE_COMMANDS.node], "pi pi-box", () => _openCoreAction("node")),
            _command(CORE_COMMANDS.replace, labels[CORE_COMMANDS.replace], "pi pi-sync", () => _openCoreAction("replace")),
            _command(CORE_COMMANDS.collapse, labels[CORE_COMMANDS.collapse], "pi pi-window-minimize", () => _openCoreAction("collapse")),
            _command(CORE_COMMANDS.clone, labels[CORE_COMMANDS.clone], "pi pi-clone", () => _openCoreAction("clone")),
            _command(CORE_COMMANDS.lock, labels[CORE_COMMANDS.lock], "pi pi-lock", () => _openCoreAction("lock")),
        ],
        getSelectionToolboxCommands: _getSelectionToolboxCommands,
        remove() {
            _disposeHubBarRuntime();
        },
    });
    // 订阅语言变化：切换语言后刷新 MiniBar 的标题与即时 tooltip。
    _offHubBarLangChange ??= onLangChange(() => _refreshCommandLabels());
}

// Settings owns the persisted preference; this narrow bridge only updates the
// native selection toolbox presentation without replacing its actions.
window.__wosaiSetMiniBarCompactMode = _setMiniBarCompactMode;
document.documentElement?.toggleAttribute("data-wosai-mini-compact-mode", _isMiniBarCompactMode());

function _registerExtraCommand(def) {
    if (!def?.id || !app?.registerExtension) return;
    if (!window[EXTRA_REGISTERED_KEY]) window[EXTRA_REGISTERED_KEY] = new Set();
    if (window[EXTRA_REGISTERED_KEY].has(def.id)) return;
    window[EXTRA_REGISTERED_KEY].add(def.id);
    const commandId = `${EXTRA_COMMAND_PREFIX}${def.id}`;
    const label = t(def.hubLabelKey || def.labelKey || def.id);
    app.registerExtension({
        name: `WOSAI.SelectionToolbox.${def.id}`,
        commands: [_command(
            commandId,
            label,
            EXTRA_ICONS[def.id] || "pi pi-circle",
            (event) => _runExtraAction(def.id, event),
        )],
    });
}

/** Register the native command adapter. Kept for existing module lifecycle calls. */
export function createHubBar() {
    _registerCoreCommands();
}

// hub-bar.js is a first-class extension entry in extension.json.  Register it
// at module load time instead of relying on ColorBar.setup() to dynamically
// import this module.  The latter is asynchronous and can be skipped when
// ColorBar initialization is delayed or fails, which previously left the
// native MiniBar unskinned and without WOSAI commands.  createHubBar() remains
// idempotent for the ColorBar compatibility bridge.
_registerCoreCommands();

/** No DOM is created, so there is nothing to tear down. */
export function removeHubBar() {}

/**
 * Compatibility bridge for optional WOSAI tools. Their former HUB buttons are
 * now commands in ComfyUI's native mini bar.
 */
export function registerHubBarButton(def) {
    if (!def?.id) return;
    _registerCoreCommands();
    const extras = _extras();
    const previous = extras.get(def.id);
    const entry = { ...def, commandId: previous?.commandId || `${EXTRA_COMMAND_PREFIX}${def.id}` };
    extras.set(def.id, entry);
    if (!previous) _registerExtraCommand(entry);
}

export function unregisterHubBarButton(id) {
    _extras().delete(id);
}

// Compatibility exports for panels that previously hid or positioned against
// the standalone HUB. They intentionally have no visual side effects now.
export function showHubBar() {}
export function hideHubBar() {}
export function positionHubBarAboveNode() {}
export function showHubBarForSelection() { return false; }
export function withHubBarHidden() { return () => {}; }
export function getHubBarRect() { return { visible: false, rect: null }; }

window.__wosaiWithHubBarHidden = withHubBarHidden;
window.__wosaiShowSelectionHub = showHubBarForSelection;
