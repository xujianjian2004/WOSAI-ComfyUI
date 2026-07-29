import { app } from "../../scripts/app.js";
import { t } from "./shared/i18n.js";

const STORAGE_KEY = "wosai_text_favorites";
const CSS_ID = "wosai-text-favorites-styles";
const PATCH_KEY = "__wosaiTextFavoritesPatch";
const POPUP_VIEWPORT_GAP = 8;
const _timers = new Set();

function later(callback, delay) {
    const timer = setTimeout(() => {
        _timers.delete(timer);
        callback();
    }, delay);
    _timers.add(timer);
    return timer;
}

const TEXT_WIDGET_NAMES = ["text", "text_positive", "text_negative", "text_g", "text_l", "prompt", "string"];

const _li = (inner) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const SVG = {
    use: _li('<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>'),
    rename: _li('<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>'),
    delete: _li('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>'),
};

function _t(key) {
    return t("saveText." + key, key);
}

function isTextWidget(w) {
    if (!w) return false;
    const name = (w.name || w.id || "").toLowerCase();
    if (TEXT_WIDGET_NAMES.includes(name)) return true;
    if (name.includes("prompt")) return true;
    const type = (w.type || "").toLowerCase();
    if (type === "customtext") return true;
    if (type === "string" && w.options?.multiline) return true;
    if (typeof w.resolveDeepest === "function") {
        try {
            const deepest = w.resolveDeepest();
            if (deepest && deepest.widget) return isTextWidget(deepest.widget);
        } catch (e) {
            if (TEXT_WIDGET_NAMES.includes(name) || name.includes("prompt")) return true;
        }
    }
    return false;
}

function findTextWidget(node) {
    if (!node.widgets) return null;
    return node.widgets.find(w => isTextWidget(w));
}

function findMountContainer(node, widget) {
    const inputEl = widget.inputEl || widget.element;
    if (inputEl) {
        const directContainer = inputEl.closest?.('[data-testid^="node-widget"], .lg-node-widget, .dom-widget');
        if (directContainer) return directContainer;
        let parent = inputEl.parentElement;
        while (parent) {
            if (parent.classList && (parent.classList.contains("dom-widget") || parent.classList.contains("lg-node-widget"))) return parent;
            parent = parent.parentElement;
        }
    }
    const localRoot = node.element || node.dom;
    const body = localRoot?.querySelector?.('[data-testid^="node-body"]')
        || document.querySelector(`[data-testid="node-body-${node.id}"]`)
        || document.querySelector(`[data-node-id="${node.id}"] [data-testid^="node-body"]`);
    if (!body) return null;
    const textWidgets = (node.widgets || []).filter(isTextWidget);
    const widgetIndex = textWidgets.indexOf(widget);
    if (widgetIndex < 0) return null;
    const textarea = body.querySelectorAll("textarea")[widgetIndex];
    if (!textarea) return null;
    return textarea.closest('[data-testid^="node-widget"], .lg-node-widget, .dom-widget') || textarea.parentElement;
}

function findTextInputElement(widget, mountContainer) {
    const candidate = widget.inputEl || widget.element;
    if (candidate?.matches?.("textarea, input")) return candidate;
    return mountContainer?.querySelector?.("textarea, input") || null;
}

function reserveIndicatorSpace(inputElement) {
    if (!inputElement) return null;
    const isSingleLine = inputElement.matches("input:not([type='checkbox']):not([type='radio'])");
    const previous = {
        paddingBottom: inputElement.style.getPropertyValue("padding-bottom"),
        paddingPriority: inputElement.style.getPropertyPriority("padding-bottom"),
        paddingLeft: inputElement.style.getPropertyValue("padding-left"),
        paddingLeftPriority: inputElement.style.getPropertyPriority("padding-left"),
        boxSizing: inputElement.style.getPropertyValue("box-sizing"),
        boxSizingPriority: inputElement.style.getPropertyPriority("box-sizing"),
        scrollPaddingBottom: inputElement.style.getPropertyValue("scroll-padding-bottom"),
        scrollPaddingPriority: inputElement.style.getPropertyPriority("scroll-padding-bottom"),
    };
    const computed = window.getComputedStyle(inputElement);
    inputElement.style.setProperty("box-sizing", "border-box", "important");
    if (isSingleLine) {
        inputElement.style.setProperty("padding-left", `calc(${computed.paddingLeft} + var(--ws-tf-indicator-safe-area))`, "important");
    } else {
        inputElement.style.setProperty("padding-bottom", `calc(${computed.paddingBottom} + var(--ws-tf-indicator-safe-area))`, "important");
        inputElement.style.setProperty("scroll-padding-bottom", "var(--ws-tf-indicator-safe-area)", "important");
    }
    return () => {
        inputElement.style.setProperty("padding-bottom", previous.paddingBottom, previous.paddingPriority);
        inputElement.style.setProperty("padding-left", previous.paddingLeft, previous.paddingLeftPriority);
        inputElement.style.setProperty("box-sizing", previous.boxSizing, previous.boxSizingPriority);
        inputElement.style.setProperty("scroll-padding-bottom", previous.scrollPaddingBottom, previous.scrollPaddingPriority);
        if (!previous.paddingBottom) inputElement.style.removeProperty("padding-bottom");
        if (!previous.paddingLeft) inputElement.style.removeProperty("padding-left");
        if (!previous.boxSizing) inputElement.style.removeProperty("box-sizing");
        if (!previous.scrollPaddingBottom) inputElement.style.removeProperty("scroll-padding-bottom");
    };
}

function getFavorites() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : [];
    } catch (e) {
        return [];
    }
}

function saveFavorites(favorites) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
    } catch (e) {
        console.error("[TextFavorites] save error:", e);
    }
}

let currentPopup = null;

function closePopup() {
    if (!currentPopup) return;
    const popup = currentPopup;
    currentPopup = null;
    if (popup._cleanup) popup._cleanup();
    if (popup._escCleanup) popup._escCleanup();
    if (popup.parentNode) popup.remove();
}

function injectIndicator(node) {
    const textWidget = findTextWidget(node);
    injectTextFavoriteIndicator(node, textWidget);
}

export function injectTextFavoriteIndicator(node, textWidget) {
    if (!textWidget || textWidget._tfIndicator?.isConnected || textWidget._tfIndicatorPending) return;
    textWidget._tfIndicatorPending = true;
    const tryInject = () => {
        const mountContainer = findMountContainer(node, textWidget);
        if (!mountContainer) {
            if (!textWidget._tfRetryCount) textWidget._tfRetryCount = 0;
            // Nodes 2.0 may finish mounting Vue widgets well after the node
            // lifecycle callback; keep the retry window long enough for that
            // delayed render without creating a permanent observer.
            if (textWidget._tfRetryCount < 30) {
                textWidget._tfRetryCount++;
                later(tryInject, 150);
            } else {
                textWidget._tfIndicatorPending = false;
            }
            return;
        }
        delete textWidget._tfRetryCount;
        textWidget._tfIndicatorPending = false;
        const indicator = document.createElement("div");
        indicator.className = "ws-tf-indicator";
        indicator.title = _t("indicatorTitle");
        const icon = document.createElement("span");
        icon.className = "ws-tf-indicator-icon";
        icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1L10.06 5.56L15 6.24L11.5 9.72L12.44 14.54L8 12.06L3.56 14.54L4.5 9.72L1 6.24L5.94 5.56L8 1Z" fill="currentColor"/></svg>`;
        indicator.appendChild(icon);
        indicator.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            showFavoritesPopup(indicator, node, textWidget);
        });
        const cs = window.getComputedStyle(mountContainer);
        if (cs.position === "static") mountContainer.style.position = "relative";
        mountContainer.classList.add("ws-tf-input-anchor");
        const releaseInputSpace = reserveIndicatorSpace(findTextInputElement(textWidget, mountContainer));
        mountContainer.appendChild(indicator);
        textWidget._tfIndicator = indicator;
        const origOnRemoved = node.onRemoved;
        node.onRemoved = function () {
            if (indicator.parentNode) indicator.remove();
            releaseInputSpace?.();
            mountContainer.classList.remove("ws-tf-input-anchor");
            if (textWidget._tfIndicator === indicator) textWidget._tfIndicator = null;
            if (origOnRemoved) origOnRemoved.apply(this, arguments);
        };
    };
    later(tryInject, 80);
}

function showFavoritesPopup(anchorEl, node, textWidget = findTextWidget(node)) {
    if (currentPopup) {
        closePopup();
        later(() => showFavoritesPopup(anchorEl, node, textWidget), 220);
        return;
    }
    if (!textWidget) return;
    const popup = document.createElement("div");
    popup.className = "ws-tf-popup wosai-panel--glass";
    popup.setAttribute("data-wosai-panel", "");
    const titleBar = document.createElement("div");
    titleBar.className = "ws-tf-titlebar";
    const titleSpan = document.createElement("span");
    titleSpan.className = "ws-tf-title";
    titleSpan.textContent = _t("panelTitle");
    titleBar.appendChild(titleSpan);
    const closeBtn = document.createElement("button");
    closeBtn.className = "ws-tf-close";
    closeBtn.textContent = "✕";
    closeBtn.onclick = closePopup;
    titleBar.appendChild(closeBtn);
    popup.appendChild(titleBar);
    const listEl = document.createElement("div");
    listEl.className = "ws-tf-list";
    buildFavoritesList(listEl, node, anchorEl, textWidget);
    popup.appendChild(listEl);
    const footer = document.createElement("div");
    footer.className = "ws-tf-footer";
    const addBtn = document.createElement("button");
    addBtn.className = "ws-tf-btn-save";
    addBtn.textContent = _t("saveBtn");
    addBtn.onclick = () => {
        const currentText = getNodeText(node, textWidget);
        if (!currentText.trim()) return;
        const favorites = getFavorites();
        favorites.push({
            id: Date.now().toString(),
            name: currentText.trim().slice(0, 40),
            text: currentText,
            createdAt: Date.now(),
        });
        saveFavorites(favorites);
        buildFavoritesList(listEl, node, anchorEl, textWidget);
    };
    footer.appendChild(addBtn);
    popup.appendChild(footer);
    positionPopup(popup, anchorEl);
    document.body.appendChild(popup);
    const clickHandler = (e) => {
        if (!popup.contains(e.target) && e.target !== anchorEl && !anchorEl.contains(e.target)) closePopup();
    };
    later(() => document.addEventListener("mousedown", clickHandler), 0);
    popup._cleanup = () => document.removeEventListener("mousedown", clickHandler);
    const escHandler = (e) => { if (e.key === "Escape") closePopup(); };
    document.addEventListener("keydown", escHandler);
    popup._escCleanup = () => document.removeEventListener("keydown", escHandler);
    currentPopup = popup;
}

function buildFavoritesList(listEl, node, anchorEl, textWidget) {
    listEl.innerHTML = "";
    const favorites = getFavorites();
    if (favorites.length === 0) {
        const empty = document.createElement("div");
        empty.className = "ws-tf-empty";
        empty.textContent = _t("emptyTip");
        listEl.appendChild(empty);
        return;
    }
    favorites.forEach((fav, index) => {
        const item = document.createElement("div");
        item.className = "ws-tf-item";
        const info = document.createElement("div");
        info.className = "ws-tf-item-info";
        const nameEl = document.createElement("div");
        nameEl.className = "ws-tf-item-name";
        nameEl.textContent = fav.name;
        info.appendChild(nameEl);
        const previewEl = document.createElement("div");
        previewEl.className = "ws-tf-item-preview";
        previewEl.textContent = fav.text.slice(0, 60);
        info.appendChild(previewEl);
        item.appendChild(info);
        const actions = document.createElement("div");
        actions.className = "ws-tf-item-actions";
        const useBtn = document.createElement("button");
        useBtn.className = "ws-tf-item-btn ws-tf-use";
        useBtn.title = _t("useBtn");
        useBtn.innerHTML = SVG.use;
        useBtn.onclick = () => { applyFavoriteToNode(node, textWidget, fav.text); closePopup(); };
        const renameBtn = document.createElement("button");
        renameBtn.className = "ws-tf-item-btn ws-tf-rename";
        renameBtn.title = _t("renameBtn");
        renameBtn.innerHTML = SVG.rename;
        renameBtn.onclick = () => { startRename(nameEl, fav, index, () => buildFavoritesList(listEl, node, anchorEl, textWidget)); };
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "ws-tf-item-btn ws-tf-delete";
        deleteBtn.title = _t("deleteBtn");
        deleteBtn.innerHTML = SVG.delete;
        deleteBtn.onclick = () => { const u = getFavorites(); u.splice(index, 1); saveFavorites(u); buildFavoritesList(listEl, node, anchorEl, textWidget); };
        actions.appendChild(useBtn);
        actions.appendChild(renameBtn);
        actions.appendChild(deleteBtn);
        item.appendChild(actions);
        listEl.appendChild(item);
    });
}

function positionPopup(popup, anchorEl) {
    if (!anchorEl) {
        popup.style.left = `${Math.round(window.innerWidth / 2 - 150)}px`;
        popup.style.top = `${Math.round(window.innerHeight / 2 - 200)}px`;
        return;
    }
    const buttonRect = anchorEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    popup.style.visibility = "hidden";
    popup.style.display = "flex";
    popup.style.flexDirection = "column";
    document.body.appendChild(popup);
    void popup.offsetWidth;
    const popupRect = popup.getBoundingClientRect();
    document.body.removeChild(popup);
    popup.style.visibility = "visible";
    const spaceAbove = buttonRect.top;
    const spaceBelow = vh - buttonRect.bottom;
    const showBelow = spaceBelow >= popupRect.height || spaceBelow > spaceAbove;
    if (showBelow) {
        popup.style.top = `${buttonRect.bottom}px`;
        popup.classList.add("ws-tf-popup-down");
    } else {
        popup.style.top = `${buttonRect.top - popupRect.height}px`;
        popup.classList.add("ws-tf-popup-up");
    }
    if (showBelow) {
        const cx = buttonRect.left + buttonRect.width / 2;
        const cl = cx - popupRect.width / 2;
        if (cl >= 0 && cl + popupRect.width <= vw) {
            popup.style.left = `${cl}px`;
        } else if (cl < 0) {
            popup.style.left = `${POPUP_VIEWPORT_GAP}px`;
        } else {
            popup.style.left = `${vw - popupRect.width - POPUP_VIEWPORT_GAP}px`;
        }
    } else {
        let left = buttonRect.left;
        if (left + popupRect.width > vw - POPUP_VIEWPORT_GAP) left = vw - popupRect.width - POPUP_VIEWPORT_GAP;
        if (left < POPUP_VIEWPORT_GAP) left = POPUP_VIEWPORT_GAP;
        popup.style.left = `${left}px`;
    }
}

function getNodeText(node, textWidget = findTextWidget(node)) {
    return textWidget ? (textWidget.value || "") : "";
}

function applyFavoriteToNode(node, textWidget, text) {
    if (!textWidget) return;
    textWidget.value = text;
    if (textWidget.callback) textWidget.callback(text, app.graph, node, textWidget);
    node.setDirtyCanvas(true, true);
}

function startRename(nameEl, fav, index, onDone) {
    const currentName = fav.name;
    nameEl.style.display = "none";
    const input = document.createElement("input");
    input.className = "ws-tf-rename-input";
    input.value = currentName;
    input.type = "text";
    const finish = () => {
        const newName = input.value.trim() || fav.text.slice(0, 40);
        const f = getFavorites();
        if (f[index]) { f[index].name = newName; saveFavorites(f); nameEl.textContent = newName; }
        nameEl.style.display = "";
        input.remove();
    };
    input.onblur = finish;
    input.onkeydown = (e) => {
        if (e.key === "Enter") input.blur();
        if (e.key === "Escape") { input.value = currentName; input.blur(); }
    };
    nameEl.parentNode.insertBefore(input, nameEl);
    input.focus();
    input.select();
}

function getCSS() {
    return `
.ws-tf-input-anchor{isolation:isolate;}
.ws-tf-indicator{position:absolute;bottom:var(--ws-gap);left:var(--ws-gap);width:var(--ws-btn-h-xs);height:var(--ws-btn-h-xs);z-index:50;display:flex;align-items:center;justify-content:center;border-radius:var(--ws-gap-sm);background:transparent;border:var(--ws-border-width-thin) solid transparent;transition:transform var(--ws-transition-fast),color var(--ws-transition-fast);cursor:pointer;}
.ws-tf-indicator:hover,.ws-tf-indicator:focus-visible{transform:scale(1.1);outline:none;}
.ws-tf-indicator-icon{display:flex;align-items:center;justify-content:center;width:var(--ws-text-lg);height:var(--ws-text-lg);pointer-events:none;user-select:none;color:var(--ws-tf-indicator-default);transition:color var(--ws-transition-fast);}
.ws-tf-indicator:hover .ws-tf-indicator-icon,.ws-tf-indicator:focus-visible .ws-tf-indicator-icon{color:var(--ws-tf-indicator-hover);}
.ws-tf-popup{position:fixed;z-index:10185;background:var(--ws-surface);border:var(--ws-border-width-thin) solid var(--ws-border);border-radius:var(--ws-radius);box-shadow:var(--ws-tf-popup-shadow);min-width:var(--ws-tf-popup-min-width);max-width:var(--ws-tf-popup-max-width);max-height:var(--ws-tf-popup-max-height);overflow:hidden;display:flex;flex-direction:column;font-size:var(--ws-text-md);color:var(--ws-text);transform-origin:top center;}
.ws-tf-popup-up{animation:wsTfFadeInDown .2s ease;}
.ws-tf-popup-down{animation:wsTfFadeInUp .2s ease;}
@keyframes wsTfFadeInUp{from{opacity:0;transform:translateY(calc(-1 * var(--ws-gap)))}to{opacity:1;transform:translateY(0)}}
@keyframes wsTfFadeInDown{from{opacity:0;transform:translateY(var(--ws-gap))}to{opacity:1;transform:translateY(0)}}
.ws-tf-titlebar{display:flex;align-items:center;justify-content:space-between;padding:var(--ws-gap) var(--ws-gap-lg);border-bottom:var(--ws-border-width-thin) solid var(--ws-border);flex-shrink:0;}
.ws-tf-title{font-weight:600;font-size:var(--ws-text-md);user-select:none;}
.ws-tf-close{width:var(--ws-sn-move-btn-size);height:var(--ws-sn-move-btn-size);border:none;background:transparent;color:var(--ws-text-muted);cursor:pointer;border-radius:var(--ws-gap-xs);display:flex;align-items:center;justify-content:center;font-size:var(--ws-text-lg);transition:all .15s;}
.ws-tf-close:hover{color:var(--ws-text);background:var(--ws-surface-raised);}
.ws-tf-list{flex:1;overflow-y:auto;padding:var(--ws-gap-sm);display:flex;flex-direction:column;gap:var(--ws-gap-xs);}
.ws-tf-empty{text-align:center;color:var(--ws-text-muted);padding:var(--ws-sn-collapsed-icon-size) 0;font-size:var(--ws-text-base);}
.ws-tf-item{display:flex;align-items:center;gap:var(--ws-gap-sm);padding:var(--ws-gap-sm) var(--ws-gap);border-radius:var(--ws-gap-sm);background:var(--ws-surface-2);border:var(--ws-border-width-thin) solid transparent;transition:all .15s;}
.ws-tf-item:hover{border-color:var(--ws-border);background:var(--ws-surface-raised);}
.ws-tf-item-info{flex:1;min-width:0;}
.ws-tf-item-name{font-size:var(--ws-text-base);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ws-tf-item-preview{font-size:var(--ws-text-sm);color:var(--ws-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:var(--ws-border-width-thin);}
.ws-tf-item-actions{display:flex;gap:var(--ws-gap-2xs);flex-shrink:0;}
.ws-tf-item-btn{width:var(--ws-sn-collapsed-icon-size);height:var(--ws-sn-collapsed-icon-size);border:none;background:transparent;color:var(--ws-text-muted);cursor:pointer;border-radius:var(--ws-gap-xs);display:flex;align-items:center;justify-content:center;font-size:var(--ws-text-md);transition:all .15s;}
.ws-tf-item-btn:hover{color:var(--ws-text);background:var(--ws-surface-raised-2);}
.ws-tf-item-btn.ws-tf-use:hover{color:var(--ws-accent);}
.ws-tf-item-btn.ws-tf-rename:hover{color:var(--ws-tf-rename);}
.ws-tf-item-btn.ws-tf-delete:hover{color:var(--ws-tf-delete);}
.ws-tf-footer{padding:var(--ws-gap-sm) var(--ws-gap-lg);border-top:var(--ws-border-width-thin) solid var(--ws-border);flex-shrink:0;}
.ws-tf-btn-save{width:100%;padding:var(--ws-gap-sm) 0;border:var(--ws-border-width-thin) solid var(--ws-accent);border-radius:var(--ws-gap-sm);background:color-mix(in srgb,var(--ws-accent),transparent 20%);color:var(--ws-text-on-accent);cursor:pointer;font-size:var(--ws-text-base);font-weight:500;transition:all .15s;text-align:center;}
.ws-tf-btn-save:hover{background:var(--ws-accent);}
.ws-tf-btn-save:active{opacity:.85;}
.ws-tf-rename-input{width:100%;padding:var(--ws-seg-pad) var(--ws-gap-sm);border:var(--ws-border-width-thin) solid var(--ws-border);border-radius:var(--ws-gap-xs);background:var(--ws-surface-3);color:var(--ws-text);font-size:var(--ws-text-base);outline:none;box-sizing:border-box;}
.ws-tf-rename-input:focus{border-color:var(--ws-accent);}
.ws-tf-list::-webkit-scrollbar{width:var(--ws-gap-sm);}
.ws-tf-list::-webkit-scrollbar-track{background:transparent;}
.ws-tf-list::-webkit-scrollbar-thumb{background:var(--ws-border);border-radius:var(--ws-seg-pad);}
.ws-tf-list::-webkit-scrollbar-thumb:hover{background:var(--ws-text-muted);}
`;
}

function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    const s = document.createElement("style");
    s.id = CSS_ID;
    s.textContent = getCSS();
    document.head.appendChild(s);
}

app.registerExtension({
    name: "wosai.TextFavorites",
    async setup() {
        injectCSS();
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeType.prototype[PATCH_KEY]) return;
        const original = nodeType.prototype.onNodeCreated;
        const patched = function () {
            if (original) original.apply(this, arguments);
            injectIndicator(this);
        };
        nodeType.prototype.onNodeCreated = patched;
        nodeType.prototype[PATCH_KEY] = { original, patched };
    },
    remove() {
        closePopup();
        _timers.forEach(clearTimeout);
        _timers.clear();
        document.getElementById(CSS_ID)?.remove();
        const nodeTypes = window.LiteGraph?.registered_node_types || {};
        Object.values(nodeTypes).forEach((nodeType) => {
            const patch = nodeType?.prototype?.[PATCH_KEY];
            if (!patch) return;
            if (nodeType.prototype.onNodeCreated === patch.patched) nodeType.prototype.onNodeCreated = patch.original;
            delete nodeType.prototype[PATCH_KEY];
        });
        const nodes = app.graph?._nodes || app.graph?.nodes || [];
        nodes.forEach((node) => {
            node.widgets?.forEach((widget) => {
                widget._tfIndicatorInjected = false;
                widget._tfIndicatorPending = false;
                widget._tfRetryCount = 0;
            });
        });
        document.querySelectorAll(".ws-tf-indicator").forEach((el) => el.remove());
    },
});
