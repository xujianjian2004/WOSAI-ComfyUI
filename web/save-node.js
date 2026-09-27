import { app } from "../../scripts/app.js";
import { t, onLangChange, offLangChange } from "./shared/i18n.js";
import { makeDraggable } from "./shared/shared-utils.js";
import { registerHudTab, unregisterHudTab } from "./shared/hud-kit.js";
import { getGlassTheme, onGlassChange } from "./shared/glass-theme.js";
import { quickToast } from "./shared/toast.js";
import { SAVE_NODE_LIMITS, sanitizeSaveNodeData } from "./shared/save-node-data.js";
import {
    favoriteDisplayName,
    resolveSaveNodePalette,
    saveNodeColorLabel,
    seedDefaultWosaiFavorites,
} from "./shared/save-node-catalog.js";
import {
    filterFavoriteNodes,
    formatShortcut as formatSaveNodeShortcut,
    isShortcutMatch,
    matchesFavoriteNode,
    shortcutFromEvent,
} from "./shared/save-node-query.js";

let pinyinConvert = null;
let pinyinLoadPromise = null;

function ensurePinyinLoaded() {
    if (pinyinConvert) return Promise.resolve(pinyinConvert);
    pinyinLoadPromise ??= import("./shared/pinyin-pro.esm.js")
        .then((module) => {
            pinyinConvert = module.pinyin;
            return pinyinConvert;
        })
        .catch((error) => {
            pinyinLoadPromise = null;
            console.warn("[SaveNode] pinyin search unavailable:", error);
            return null;
        });
    return pinyinLoadPromise;
}

/* =========================================================
 * WOSAI SaveNode — 收藏节点
 * 适配 WOSAI 设计标准：glass 面板、统一 i18n、makeDraggable
 * ========================================================= */

const STORAGE_KEY = "wosai_savenode_data";
const CSS_ID      = "wosai-savenode-styles";
const INLINE_STYLE_ID = "wosai-savenode-inline-styles";
const POS_KEY      = "wosai_savenode_pos";
const WIDTH_KEY    = "wosai_savenode_width";
const HEIGHT_KEY   = "wosai_savenode_height";
const RATIO_KEY    = "wosai_savenode_ratio";
const SHORTCUT_KEY = "wosai_savenode_shortcut";
const COLLAPSED_SIZE = 40; // 折叠态橙色星按钮直径（px），与 CSS 保持一致
function _getPresetColors() {
    const root = document.documentElement;
    return resolveSaveNodePalette(
        (token) => getComputedStyle(root).getPropertyValue(token),
    );
}
function _getCategoryColors() { return _getPresetColors().slice(0, 8); }
function _defaultCategoryColor() { return _getCategoryColors()[0]; }
function _colorLabel(hex) {
    return saveNodeColorLabel(hex, _getPresetColors(), t);
}

function _defaultFavoriteDisplayName(type) {
    return favoriteDisplayName(type, {
        translate: t,
        registeredNodeTypes: window.LiteGraph?.registered_node_types,
    });
}

function _seedDefaultWosaiFavorites(data) {
    return seedDefaultWosaiFavorites(data, _defaultFavoriteDisplayName);
}

class WosaiSaveNode {
    constructor() {
        this.data = this.loadData();
        this.panel = null;
        this.categoryListEl = null;
        this.favListEl = null;
        this.searchInput = null;
        this.currentCategory = "all";
        this.currentSearch = "";
        this.currentSort = "order";
        this.draggingType = null;
        this._pendingDrag = null;   // { type, displayName, startX, startY }
        this._dragCleanup = null;
        this._selectedNodes = new Set();
        this._selectedCats = new Set();
        this._batchMode = false;
        this._activeChooseCatDialog = null; // 单例：避免重复打开“收藏到分类”弹窗
        this.init();
    }

    /* ---------- 数据持久化 ---------- */
    loadData() {
        const sanitize = (value) => sanitizeSaveNodeData(value, {
            defaultName: t("saveNode.defaultCategoryName"),
            defaultColor: _defaultCategoryColor(),
        });
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = sanitize(JSON.parse(raw));
                if (_seedDefaultWosaiFavorites(parsed)) {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
                }
                return parsed;
            }
        } catch (e) { console.error("[SaveNode] load failed:", e); }
        const data = sanitize({});
        _seedDefaultWosaiFavorites(data);
        return data;
    }

    saveData() {
        try {
            this.data = sanitizeSaveNodeData(this.data, {
                defaultName: t("saveNode.defaultCategoryName"),
                defaultColor: _defaultCategoryColor(),
            });
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        }
        catch (e) { console.error("[SaveNode] save failed:", e); }
    }

    /* ---------- 初始化 ---------- */
    init() {
        this.injectCSS();
        this.setupDragDrop();
        this.setupKeyboardShortcut();
        console.log("[SaveNode] loaded successfully");
    }

    /* ---------- 快捷键呼出/收起面板 ---------- */
    getShortcut() {
        try {
            const stored = localStorage.getItem(SHORTCUT_KEY);
            if (stored) return JSON.parse(stored);
        } catch (e) {}
        return { key: "f", ctrl: false, alt: true, shift: false, meta: false };
    }

    saveShortcut(shortcut) {
        localStorage.setItem(SHORTCUT_KEY, JSON.stringify(shortcut));
    }

    formatShortcut(sc) {
        return formatSaveNodeShortcut(sc);
    }

    setupKeyboardShortcut() {
        this._keydownHandler = (e) => {
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
            const sc = this.getShortcut();
            if (!isShortcutMatch(e, sc)) return;
            e.preventDefault();
            e.stopPropagation();
            this.togglePanel();
        };
        document.addEventListener("keydown", this._keydownHandler, true);
    }

    /* 点击后监听下一次按键，作为新快捷键 */
    startShortcutCapture(btnEl) {
        const original = btnEl.textContent;
        btnEl.textContent = "...";
        const onKey = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
            const sc = shortcutFromEvent(e);
            this.saveShortcut(sc);
            btnEl.textContent = this.formatShortcut(sc);
            document.removeEventListener("keydown", onKey, true);
            this._captureHandler = null;
            if (this._captureTimer) { clearTimeout(this._captureTimer); this._captureTimer = null; }
        };
        this._captureHandler = onKey;
        document.addEventListener("keydown", onKey, true);
        this._captureTimer = setTimeout(() => {
            document.removeEventListener("keydown", onKey, true);
            if (this._captureHandler === onKey) this._captureHandler = null;
            this._captureTimer = null;
            if (btnEl.textContent === "...") btnEl.textContent = original;
        }, 5000);
    }

    injectCSS() {
        const cssHref = new URL("./styles/save-node.css", import.meta.url).href;
        const cssLoaded = [...document.styleSheets].some(sheet => sheet.href === cssHref);
        if (!document.getElementById(CSS_ID) && !cssLoaded) {
            const link = document.createElement("link");
            link.id = CSS_ID;
            link.rel = "stylesheet";
            link.href = cssHref;
            document.head.appendChild(link);
        }
        if (document.getElementById(INLINE_STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = INLINE_STYLE_ID;
        style.textContent = `.ws-collapsed .ws-collapsed-icon svg{fill:var(--ws-text-on-accent)!important}
.ws-fav-index{flex-shrink:0;width:var(--ws-text-2xl);text-align:center;font-size:var(--ws-text-sm);color:var(--ws-text-muted);font-variant-numeric:tabular-nums}
.ws-resize-handle:hover{background:color-mix(in srgb,var(--ws-sn-palette-orange),transparent 65%)}
.ws-collapsed .ws-resize-handle{display:none}`;
        document.head.appendChild(style);
    }

    /* ---------- 面板开关 ---------- */
    togglePanel() {
        if (!this.panel) {
            this.createPanel();
            this.renderAll();
            // 首次创建默认折叠，避免页面加载时直接弹出
            this.collapsePanel();
            return;
        }
        if (this.panel.classList.contains("ws-collapsed")) this.expandPanel();
        else this.collapsePanel();
    }

    /* 折叠为星标：以当前橙色球位置（或折叠按钮位置）为锚点，
       收缩动画从面板当前位置平滑缩小到球心，不再跳到屏幕边缘 */
    collapsePanel() {
        const panel = this.panel;
        if (!panel) return;
        const R = COLLAPSED_SIZE / 2;
        const rect = panel.getBoundingClientRect();

        // 先把当前显式位置固定住，避免 right:auto 切换导致动画起点跳动
        panel.style.transition = "none";
        panel.style.right = "auto";
        panel.style.left = rect.left + "px";
        panel.style.top = rect.top + "px";

        // 优先缩回上次记录的球位置；没有记录时回到「折叠」按钮（减号）中心
        let cx, cy;
        if (this._ballPos) {
            cx = this._ballPos.left + R;
            cy = this._ballPos.top + R;
        } else {
            const toggle = panel.querySelector("#ws-savenode-toggle");
            cx = window.innerWidth - 10 - R;
            cy = rect.top + R;
            if (toggle) {
                const r = toggle.getBoundingClientRect();
                if (r && r.width) {
                    cx = r.left + r.width / 2;
                    cy = r.top + r.height / 2;
                }
            }
        }

        panel.classList.add("ws-collapsed");
        // 恢复过渡动画后再设置目标位置，使 width/height/left/top 同时平滑变化
        panel.style.transition = "";
        panel.style.left = Math.max(8, cx - R) + "px";
        panel.style.top = Math.max(8, cy - R) + "px";
    }

    /* 展开：以橙色球当前位置为锚点，向左侧展开；球挪到哪，面板就从哪打开，
       不再自动吸附到屏幕右侧 */
    expandPanel(instant = false) {
        const panel = this.panel;
        if (!panel) return;
        // 记录球位置，供后续折叠时缩回同一位置
        this._ballPos = { left: panel.offsetLeft, top: panel.offsetTop };

        panel.style.transition = "none";
        panel.classList.remove("ws-collapsed");

        // 恢复保存的宽度/高度
        try {
            const savedW = localStorage.getItem(WIDTH_KEY);
            if (savedW) panel.style.width = savedW + "px";
        } catch (e) {}
        try {
            const savedH = localStorage.getItem(HEIGHT_KEY);
            if (savedH) panel.style.height = savedH + "px";
        } catch (e) {}

        const w = panel.offsetWidth || 640;
        const h = panel.offsetHeight || 400;

        // 以球的右边缘为锚点，向左侧展开；空间不足时贴边
        let left = this._ballPos.left + COLLAPSED_SIZE - w;
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
        const top = Math.max(8, Math.min(this._ballPos.top, window.innerHeight - h - 8));

        panel.style.right = "auto";
        if (instant) {
            // 瞬时展开（无动画）：强制 reflow 让尺寸/位置立即生效，便于弹窗吸附精确对齐
            void panel.offsetWidth;
            panel.style.left = left + "px";
            panel.style.top = top + "px";
            requestAnimationFrame(() => { if (panel.isConnected) panel.style.transition = ""; });
        } else {
            panel.style.transition = "";
            panel.style.left = left + "px";
            panel.style.top = top + "px";
        }
    }

    /** 确保面板已创建并处于展开状态（供弹窗吸附前调用，避免面板未展开导致定位错位） */
    ensurePanelExpanded() {
        if (!this.panel) {
            this.createPanel();
            this.renderAll();
            this.expandPanel(true); // 首次创建直接展开（瞬时）
            return;
        }
        if (this.panel.classList.contains("ws-collapsed")) this.expandPanel(true);
        // 已展开则保持当前位置不变
    }

    destroyPanel() {
        if (!this.panel) return;
        if (this._dragCleanup) { this._dragCleanup(); this._dragCleanup = null; }
        if (this._offGlassChange) { this._offGlassChange(); this._offGlassChange = null; }
        this.panel.remove();
        this.panel = null;
        this.categoryListEl = null;
        this.favListEl = null;
        this.searchInput = null;
    }

    /* 完全销毁：清理全局事件和面板 */
    destroy() {
        this.destroyPanel();
        if (this._keydownHandler) {
            document.removeEventListener("keydown", this._keydownHandler, true);
            this._keydownHandler = null;
        }
        if (this._mousemoveHandler) {
            document.removeEventListener("mousemove", this._mousemoveHandler);
            this._mousemoveHandler = null;
        }
        if (this._mouseupHandler) {
            document.removeEventListener("mouseup", this._mouseupHandler);
            this._mouseupHandler = null;
        }
        if (this._canvasNodeDragHandler) {
            document.removeEventListener("pointermove", this._canvasNodeDragHandler, true);
            this._canvasNodeDragHandler = null;
        }
        if (this._canvasNodeDropHandler) {
            document.removeEventListener("pointerup", this._canvasNodeDropHandler, true);
            this._canvasNodeDropHandler = null;
        }
        if (this._resizeMoveHandler) {
            document.removeEventListener("mousemove", this._resizeMoveHandler);
            this._resizeMoveHandler = null;
        }
        if (this._resizeUpHandler) {
            document.removeEventListener("mouseup", this._resizeUpHandler);
            this._resizeUpHandler = null;
        }
        if (this._dividerCleanup) {
            this._dividerCleanup();
            this._dividerCleanup = null;
        }
        // 快捷键捕获兜底
        if (this._captureHandler) {
            document.removeEventListener("keydown", this._captureHandler, true);
            this._captureHandler = null;
        }
        if (this._captureTimer) {
            clearTimeout(this._captureTimer);
            this._captureTimer = null;
        }
        this.data = { categories: [], nodes: [] };
        document.getElementById(CSS_ID)?.remove();
        document.getElementById(INLINE_STYLE_ID)?.remove();
    }

    /* ---------- 节点有效性 ---------- */
    isNodeTypeValid(nodeType) {
        try {
            if (typeof LiteGraph === "undefined") return true;
            if (LiteGraph.registered_node_types && nodeType in LiteGraph.registered_node_types) return true;
            return false;
        } catch (e) { return true; }
    }

    isFavorited(nodeType) {
        return this.data.nodes.some(n => n.type === nodeType);
    }

    /* ---------- 搜索：中文/英文/拼音全拼/拼音首字母/驼峰下划线拆分/分类/别名 ---------- */
    /* ── 拼音首字母（如"补帧" → "bz"）── */
    _toPinyinInitials(text) {
        if (!pinyinConvert || !text || typeof text !== 'string') return '';
        try {
            return pinyinConvert(text, { pattern: 'first', toneType: 'none', type: 'string' }).replace(/\s/g, '');
        } catch (e) { return ''; }
    }

    /* ── 完整拼音（如"补帧" → "buzhen"）── */
    _toPinyinFull(text) {
        if (!pinyinConvert || !text || typeof text !== 'string') return '';
        try {
            return pinyinConvert(text, { toneType: 'none', type: 'string' }).replace(/\s/g, '');
        } catch (e) { return ''; }
    }

    _matchSearch(n, term) {
        return matchesFavoriteNode(n, term, [
            this._toPinyinInitials(n.displayName || ""),
            this._toPinyinFull(n.displayName || ""),
        ]);
    }

    /* ---------- 收藏 / 取消收藏 ---------- */
    addFavorite(node, categoryId = "default") {
        if (this.isFavorited(node.type)) return;
        const nodeDef = (typeof LiteGraph !== "undefined" && LiteGraph.registered_node_types)
            ? LiteGraph.registered_node_types[node.type] : null;
        const displayName = node.title || nodeDef?.title || node.type;
        const category = nodeDef ? (nodeDef.category || "Unknown") : "Unknown";
        this.data.nodes.push({
            type: node.type,
            displayName,
            category,
            categoryId,
            addedAt: Date.now(),
            order: Date.now(),
        });
        this.saveData();
        this.renderAll();
        // 高亮收藏列表中的新条目
        this._highlightFavItem(node.type);
    }

    _highlightFavItem(nodeType) {
        if (!this.favListEl) return;
        const items = this.favListEl.querySelectorAll(".ws-fav-item");
        for (const item of items) {
            if (item.dataset.type === nodeType) {
                item.classList.add("ws-fav-item--highlight");
                setTimeout(() => item.classList.remove("ws-fav-item--highlight"), 2500);
                break;
            }
        }
    }

    removeFavorite(nodeType) {
        this.data.nodes = this.data.nodes.filter(n => n.type !== nodeType);
        this.saveData();
        this.renderAll();
    }

    /* ---------- 分类管理 ---------- */
    addCategory(name, color) {
        const id = "cat_" + Date.now();
        this.data.categories.push({ id, name, color });
        this.saveData();
        this.renderAll();
        return id;
    }

    editCategory(id, name, color) {
        const cat = this.data.categories.find(c => c.id === id);
        if (!cat) return;
        cat.name = name; cat.color = color;
        this.saveData(); this.renderAll();
    }

    _showConfirmDialog(message) {
        return new Promise(resolve => {
            const dlg = document.createElement("div");
            dlg.className = "ws-dialog wosai-panel wosai-panel--glass ws-confirm-dialog";
            dlg.setAttribute("data-wosai-panel", "");
            dlg.innerHTML = `
                <div class="ws-dialog-body" style="padding:var(--ws-gap-lg);color:var(--ws-text);font-size:var(--ws-text-md)"><p class="ws-confirm-text">${message}</p></div>
                <div class="ws-dialog-footer">
                    <button class="wosai-btn" id="ws-confirm-cancel">${this.escape(t("saveNode.cancel"))}</button>
                    <button class="wosai-btn wosai-btn--primary" id="ws-confirm-ok">${this.escape(t("saveNode.ok"))}</button>
                </div>
            `;
            // 统一吸附到面板【左侧优先、贴顶部】，与导出/分类等弹窗位置一致
            this._snapDialogToPanelLeftTop(dlg);
            const close = (result) => { dlg.remove(); resolve(result); };
            dlg.querySelector("#ws-confirm-ok").addEventListener("click", () => close(true));
            dlg.querySelector("#ws-confirm-cancel").addEventListener("click", () => close(false));
            dlg.addEventListener("mousedown", e => e.stopPropagation());
            // 点击面板外区域关闭
            const onOutside = (e) => { if (!dlg.contains(e.target)) close(false); };
            setTimeout(() => document.addEventListener("pointerdown", onOutside, { once: true, capture: true }), 0);
            dlg.tabIndex = -1;
            dlg.addEventListener("keydown", e => {
                if (e.key === "Escape") close(false);
                else if (e.key === "Enter") close(true);
            });
            setTimeout(() => dlg.querySelector("#ws-confirm-ok").focus(), 0);
        });
    }

    async deleteCategory(id) {
        if (id === "default") return;
        const fallback = this.data.categories.find(c => c.id === "default") || this.data.categories[0];
        const cat = this.data.categories.find(c => c.id === id);
        if (!cat) return;
        if (!await this._showConfirmDialog(t("saveNode.deleteCategoryConfirm"))) return;
        this.data.nodes.forEach(n => { if (n.categoryId === id) n.categoryId = fallback.id; });
        this.data.categories = this.data.categories.filter(c => c.id !== id);
        if (this.currentCategory === id) this.currentCategory = "all";
        this.saveData(); this.renderAll();
    }

    moveCategory(id, direction) {
        const idx = this.data.categories.findIndex(c => c.id === id);
        if (idx < 0) return;
        const swapIdx = direction === "up" ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= this.data.categories.length) return;
        const temp = this.data.categories[idx];
        this.data.categories[idx] = this.data.categories[swapIdx];
        this.data.categories[swapIdx] = temp;
        this.saveData();
        this.renderAll();
    }

    _createCategoryContextMenu(cat) {
        const menu = document.createElement("div");
        menu.className = "ws-ctx-menu";
        const editItem = document.createElement("div");
        editItem.className = "ws-ctx-item";
        editItem.textContent = t("saveNode.editCategoryTitle");
        editItem.addEventListener("click", () => { menu.remove(); this.showEditCategoryDialog(cat); });
        menu.appendChild(editItem);
        if (cat.id !== "default") {
            const delItem = document.createElement("div");
            delItem.className = "ws-ctx-item ws-ctx-danger";
            delItem.textContent = t("saveNode.deleteCategoryTitle");
            delItem.addEventListener("click", () => { menu.remove(); this.deleteCategory(cat.id); });
            menu.appendChild(delItem);
        }
        return menu;
    }

    renameFavorite(nodeType, newName) {
        const fav = this.data.nodes.find(n => n.type === nodeType);
        if (!fav) return;
        fav.displayName = newName;
        this.saveData();
        this.renderFavorites();
    }

    _showMoveCategoryDialog(node) {
        const overlay = document.createElement("div");
        overlay.className = "ws-dialog-overlay";
        const catTags = this.data.categories
            .filter(c => c.id !== node.categoryId)
            .map(c => {
                const label = c.id === "default" ? t("saveNode.defaultCategoryName") : c.name;
                return `<button class="ws-choose-tag" data-cat-id="${this.escape(c.id)}"><span class="ws-choose-tag-dot" style="background:${c.color || _defaultCategoryColor()}"></span>${this.escape(label)}</button>`;
            }).join("");
        overlay.innerHTML = `
            <div class="ws-dialog wosai-panel wosai-panel--glass" data-wosai-panel="">
                <div class="ws-dialog-title">${this.escape(t("saveNode.moveFavoriteTo"))}</div>
                <div class="ws-dialog-body">
                    <div class="ws-choose-tags">${catTags}</div>
                </div>
                <div class="ws-dialog-footer">
                    <button class="wosai-btn" id="ws-dlg-cancel">${this.escape(t("saveNode.cancel"))}</button>
                    <button class="wosai-btn wosai-btn--primary" id="ws-dlg-ok" disabled>${this.escape(t("saveNode.ok"))}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        // 吸附到收藏节点面板左侧、垂直居中
        this._snapDialogToPanelLeftTop(overlay.querySelector(".ws-dialog"));
        const close = () => overlay.remove();
        let selectedCatId = null;
        const okBtn = overlay.querySelector("#ws-dlg-ok");
        overlay.addEventListener("mousedown", e => { if (e.target === overlay) close(); });
        overlay.querySelector("#ws-dlg-cancel").addEventListener("click", close);
        overlay.querySelectorAll(".ws-choose-tag").forEach(tag => {
            tag.addEventListener("click", () => {
                overlay.querySelectorAll(".ws-choose-tag").forEach(t => t.classList.remove("ws-choose-tag--active"));
                tag.classList.add("ws-choose-tag--active");
                selectedCatId = tag.dataset.catId;
                okBtn.disabled = false;
            });
        });
        okBtn.addEventListener("click", () => {
            if (!selectedCatId) return;
            const entry = this.data.nodes.find(n => n.type === node.type);
            if (entry && entry.categoryId !== selectedCatId) {
                entry.categoryId = selectedCatId;
                this.saveData();
                this.renderAll();
            }
            close();
        });
    }

    _createFavContextMenu(n) {
        const menu = document.createElement("div");
        menu.className = "ws-ctx-menu";
        // 重命名
        const renameItem = document.createElement("div");
        renameItem.className = "ws-ctx-item";
        renameItem.textContent = t("saveNode.renameFavorite");
        renameItem.addEventListener("click", () => {
            menu.remove();
            // 行内编辑：将 fav-name 变为 input
            const allItems = this.favListEl.querySelectorAll(".ws-fav-item");
            for (const el of allItems) {
                const nameEl = el.querySelector(".ws-fav-name");
                if (nameEl && nameEl.textContent.replace(this.escape(t("saveNode.invalidTag")), "") === this.escape(n.displayName)) {
                    const input = document.createElement("input");
                    input.type = "text";
                    input.value = n.displayName;
                    input.style.cssText = "width:100%;padding:var(--ws-gap-2xs) var(--ws-gap-xs);background:var(--ws-surface-2);border:var(--ws-border-width-thin) solid var(--ws-accent);border-radius:var(--ws-radius-sm);color:var(--ws-text);font-size:inherit;font-weight:inherit;outline:none";
                    const finish = () => {
                        const val = input.value.trim();
                        if (val && val !== n.displayName) this.renameFavorite(n.type, val);
                        else this.renderFavorites();
                    };
                    input.addEventListener("keydown", e => { if (e.key === "Enter") finish(); if (e.key === "Escape") this.renderFavorites(); });
                    input.addEventListener("blur", finish);
                    nameEl.textContent = "";
                    nameEl.appendChild(input);
                    input.focus();
                    input.select();
                    break;
                }
            }
        });
        menu.appendChild(renameItem);
        // 移动分类
        const moveItem = document.createElement("div");
        moveItem.className = "ws-ctx-item";
        moveItem.textContent = t("saveNode.moveFavorite");
        moveItem.addEventListener("click", () => {
            menu.remove();
            this._showMoveCategoryDialog(n);
        });
        menu.appendChild(moveItem);
        // 删除
        const delItem = document.createElement("div");
        delItem.className = "ws-ctx-item ws-ctx-danger";
        delItem.textContent = t("saveNode.removeFavorite");
        delItem.addEventListener("click", async () => {
            menu.remove();
            if (await this._showConfirmDialog(t("saveNode.deleteFavConfirm"))) this.removeFavorite(n.type);
        });
        menu.appendChild(delItem);
        return menu;
    }

    /* ---------- 拖拽添加到画布 ---------- */
    setupDragDrop() {
        const DRAG_THRESHOLD = 5;
        this._mousemoveHandler = e => {
            if (this.draggingType) {
                this.updateDragPreview(e.clientX, e.clientY);
            } else if (this._pendingDrag) {
                const dx = e.clientX - this._pendingDrag.startX;
                const dy = e.clientY - this._pendingDrag.startY;
                if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
                    this.draggingType = this._pendingDrag.type;
                    this.updateDragPreview(e.clientX, e.clientY, this._pendingDrag.displayName);
                    this._pendingDrag = null;
                }
            }
        };
        document.addEventListener("mousemove", this._mousemoveHandler);

        this._mouseupHandler = e => {
            if (this._pendingDrag) { this._pendingDrag = null; return; }
            if (!this.draggingType) return;
            const canvas = app.canvas;
            if (canvas && canvas.canvas) {
                const rect = canvas.canvas.getBoundingClientRect();
                if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
                    const offsetX = e.clientX - rect.left;
                    const offsetY = e.clientY - rect.top;
                    let pos = null;
                    try { pos = canvas.convertCanvasToOffset([offsetX, offsetY]); } catch (err) {}
                    if (pos) this.addNodeToCanvasAt(this.draggingType, pos[0], pos[1]);
                    else this.addNodeToCanvasAt(this.draggingType, offsetX, offsetY);
                    this._trackUsage(this.draggingType);
                }
            }
            this.removeDragPreview();
            this.draggingType = null;
        };
        document.addEventListener("mouseup", this._mouseupHandler);
    }

    updateDragPreview(x, y, label = "") {
        let preview = document.getElementById("ws-drag-preview");
        if (!preview) {
            preview = document.createElement("div");
            preview.id = "ws-drag-preview";
            preview.className = "ws-drag-preview";
            document.body.appendChild(preview);
        }
        preview.textContent = label || t("saveNode.dragHint");
        preview.style.left = x + "px";
        preview.style.top = y + "px";
    }

    removeDragPreview() {
        document.getElementById("ws-drag-preview")?.remove();
        document.querySelectorAll(".ws-drag-over").forEach(el => el.classList.remove("ws-drag-over"));
        document.querySelectorAll(".ws-drag-hint--show").forEach(el => el.classList.remove("ws-drag-hint--show"));
        this._dragTargetZone = null;
        this._dragOriginalPos = null;
    }

    addNodeToCanvasAt(nodeType, x, y) {
        try {
            const node = LiteGraph.createNode(nodeType);
            if (!node) { console.error(t("saveNode.nodeCreateFailed", nodeType)); return; }
            node.pos = [x, y];
            app.graph.add(node);
            app.canvas.setDirty(true, true);
            node.onAdded?.();
            app.graph.change();
        } catch (e) { console.error(t("saveNode.nodeCreateFailed", nodeType), e); }
    }

    /* ---------- 面板 ---------- */
    createPanel() {
        if (this.panel) return;
        const panel = document.createElement("div");
        panel.id = "wosai-savenode-panel";
        panel.className = "wosai-panel wosai-panel--glass";
        panel.setAttribute("data-wosai-panel", "");
        panel.setAttribute("data-theme", getGlassTheme());
        if (this._offGlassChange) { this._offGlassChange(); this._offGlassChange = null; }
        this._offGlassChange = onGlassChange(() => {
            if (this.panel) this.panel.setAttribute("data-theme", getGlassTheme());
        });
        panel.innerHTML = `
            <div class="ws-header" id="ws-savenode-header">
                <span class="ws-title" id="ws-savenode-title"></span>
                <div class="ws-header-btns">
                    <button class="wosai-btn wosai-btn--sm" id="ws-savenode-shortcut"></button>
                    <button class="wosai-btn wosai-btn--sm" id="ws-savenode-toggle" title="">
                        <svg class="ws-star-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M5 12h14"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="ws-content" id="ws-savenode-content">
                <div class="ws-body">
                    <div class="ws-left">
                        <div class="ws-search-box">
                            <input type="text" id="ws-savenode-search" />
                            <div class="ws-sort-btns">
                                <button class="wosai-btn wosai-btn--sm ws-sort-btn" id="ws-savenode-sort-freq">↕</button>
                                <button class="wosai-btn wosai-btn--sm ws-sort-btn" id="ws-savenode-sort-alpha">A↔</button>
                            </div>
                        </div>
                        <div class="ws-fav-list" id="ws-savenode-fav-list"></div>
                        <div class="ws-left-footer" id="ws-savenode-left-footer">
                            <span class="ws-left-footer-tip" id="ws-savenode-left-footer-tip"></span>
                            <button class="wosai-btn wosai-btn--sm ws-left-batch-btn" id="ws-savenode-batch-toggle" title=""><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h12"/><path d="M3 12h12"/><path d="M3 19h12"/><path d="M19 5l-2 2 2 2"/><path d="M19 12l-2 2 2 2"/><path d="M19 19l-2 2 2 2"/></svg></button>
                        </div>
                    </div>
                    <div class="ws-divider-v"></div>
                    <div class="ws-right-col">
                        <div class="ws-section-header">
                            <span id="ws-savenode-cat-label"></span>
                            <div class="ws-right">
                                <button class="wosai-btn wosai-btn--sm" id="ws-savenode-export" title="">⬇</button>
                                <button class="wosai-btn wosai-btn--sm" id="ws-savenode-import" title="">⬆</button>
                                <button class="wosai-btn wosai-btn--sm" id="ws-savenode-add-cat" title="${this.escape(t("saveNode.addCategoryTitle"))}">+</button>
                            </div>
                        </div>
                        <div class="ws-category-list" id="ws-savenode-category-list"></div>
                        <div class="ws-right-footer">
                            <span class="ws-right-footer-tip" id="ws-savenode-right-footer-tip"></span>
                            <span class="ws-count-badge" id="ws-savenode-fav-count">0</span>
                            <button class="wosai-btn wosai-btn--sm ws-right-clean-btn" id="ws-savenode-clean" title=""><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg></button>
                        </div>
                    </div>
                </div>
                <!-- 批量操作栏 -->
                <div class="ws-batch-bar" id="ws-savenode-batch-bar" style="display:none">
                    <button class="wosai-btn wosai-btn--sm ws-batch-btn" id="ws-savenode-batch-select-all"></button>
                    <button class="wosai-btn wosai-btn--sm ws-batch-btn" id="ws-savenode-batch-deselect"></button>
                    <button class="wosai-btn wosai-btn--sm ws-batch-btn ws-batch-btn--cat" id="ws-savenode-batch-move"></button>
                    <button class="wosai-btn wosai-btn--sm ws-batch-btn ws-batch-btn--danger" id="ws-savenode-batch-delete"></button>
                    <button class="wosai-btn wosai-btn--sm ws-batch-btn" id="ws-savenode-batch-cancel"></button>
                    <span class="ws-batch-count" id="ws-savenode-batch-count"></span>
                </div>
                <!-- 拖拽收藏提示 -->
                <div class="ws-drag-hint" id="ws-savenode-drag-hint"></div>
            </div>
            <div class="ws-collapsed-icon" id="ws-savenode-collapsed-icon" title="">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="var(--ws-accent)" stroke="none">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z"/>
                </svg>
            </div>
        `;
        document.body.appendChild(panel);
        this.panel = panel;
        this.categoryListEl = panel.querySelector("#ws-savenode-category-list");
        this.favListEl = panel.querySelector("#ws-savenode-fav-list");
        this.searchInput = panel.querySelector("#ws-savenode-search");

        // 还原保存的宽度 / 高度 / 位置
        try {
            const savedWidth = localStorage.getItem(WIDTH_KEY);
            if (savedWidth) panel.style.width = savedWidth + "px";
        } catch (e) {}
        try {
            const savedHeight = localStorage.getItem(HEIGHT_KEY);
            if (savedHeight) panel.style.height = savedHeight + "px";
        } catch (e) {}
        this.loadPanelPosition();

        const shortcutBtn = panel.querySelector("#ws-savenode-shortcut");
        shortcutBtn.textContent = this.formatShortcut(this.getShortcut());
        shortcutBtn.addEventListener("click", () => this.startShortcutCapture(shortcutBtn));

        this._dragCleanup = makeDraggable(panel, { handle: panel.querySelector("#ws-savenode-header") });
        // 拖拽后记录面板位置
        panel.querySelector("#ws-savenode-header").addEventListener("mouseup", () => this.savePanelPosition());
        this.setupPanelResize(panel);
        // 内部左右分隔线可拖拽
        this._setupDividerDrag(panel);
        // 折叠态时 header 隐藏，改为通过折叠图标拖拽
        const collapsedIcon = panel.querySelector("#ws-savenode-collapsed-icon");
        collapsedIcon.addEventListener("mousedown", e => {
            e.preventDefault();
            const startX = e.clientX, startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            const origLeft = rect.left, origTop = rect.top;
            const origTransition = panel.style.transition;
            panel.style.transition = "none";
            const onMove = (ev) => {
                const dx = ev.clientX - startX, dy = ev.clientY - startY;
                panel.style.left = (origLeft + dx) + "px";
                panel.style.top = (origTop + dy) + "px";
                panel.style.right = "auto";
            };
            const onUp = () => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                panel.style.transition = origTransition;
                this._ballPos = { left: panel.offsetLeft, top: panel.offsetTop };
                this.savePanelPosition();
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });

        panel.querySelector("#ws-savenode-toggle").addEventListener("click", () => {
            this.collapsePanel();
        });
        panel.querySelector("#ws-savenode-collapsed-icon").addEventListener("click", () => {
            this.expandPanel();
        });
        panel.querySelector("#ws-savenode-add-cat").addEventListener("click", () => this.showChooseCategoryDialog(null));
        panel.querySelector("#ws-savenode-clean").addEventListener("click", () => this.cleanInvalidFavorites());
        panel.querySelector("#ws-savenode-batch-toggle").addEventListener("click", () => this.toggleBatchMode());
        panel.querySelector("#ws-savenode-export").addEventListener("click", () => this.showExportConfirmDialog());
        panel.querySelector("#ws-savenode-import").addEventListener("click", () => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".json,application/json";
            input.addEventListener("change", () => {
                if (input.files && input.files[0]) this._importData(input.files[0]);
            });
            input.click();
        });
        // 批量操作
        panel.querySelector("#ws-savenode-batch-select-all").addEventListener("click", () => this._batchSelectAll());
        panel.querySelector("#ws-savenode-batch-deselect").addEventListener("click", () => this._batchDeselectAll());
        panel.querySelector("#ws-savenode-batch-move").addEventListener("click", () => this._batchMoveToCategory());
        panel.querySelector("#ws-savenode-batch-delete").addEventListener("click", () => this._batchDeleteSelected());
        panel.querySelector("#ws-savenode-batch-cancel").addEventListener("click", () => this.toggleBatchMode(false));
        this.searchInput.addEventListener("input", e => {
            this.currentSearch = e.target.value.trim().toLowerCase();
            this.renderFavorites();
            if (this.currentSearch && !pinyinConvert) {
                const searchAtLoad = this.currentSearch;
                ensurePinyinLoaded().then((loaded) => {
                    if (loaded && this.currentSearch === searchAtLoad) this.renderFavorites();
                });
            }
        });
        panel.querySelector("#ws-savenode-sort-freq").addEventListener("click", () => {
            this.currentSort = this.currentSort === "freq" ? "order" : "freq";
            this._updateSortBtnUI();
            this.renderFavorites();
        });
        panel.querySelector("#ws-savenode-sort-alpha").addEventListener("click", () => {
            this.currentSort = this.currentSort === "alpha" ? "order" : "alpha";
            this._updateSortBtnUI();
            this.renderFavorites();
        });

        this.applyTexts();
        this.renderAll();

        // 画布节点拖拽检测：仅左侧节点列表区
        this._dragTargetZone = null;
        const _getPanelEl = (sel) => this.panel ? this.panel.querySelector(sel) : null;
        this._canvasNodeDragHandler = (e) => {
            if (!e.buttons) {
                this.removeDragPreview();
                return;
            }
            const canvas = app.canvas;
            if (!canvas) return;
            const selected = canvas.selected_nodes || {};
            let nodes = Object.values(selected);
            if (!nodes.length && canvas.node_dragged) nodes = [canvas.node_dragged];
            if (!nodes.length) {
                this._dragTargetZone = null;
                this.removeDragPreview();
                return;
            }
            if (!this.panel) {
                this._dragTargetZone = null;
                this.removeDragPreview();
                return;
            }
            const collapsed = this.panel.classList.contains("ws-collapsed");
            const node = nodes[0];
            if (!this._dragOriginalPos) this._dragOriginalPos = [node.pos[0], node.pos[1]];
            const dropZone = collapsed ? _getPanelEl("#ws-savenode-collapsed-icon") : _getPanelEl(".ws-left");
            let hit = false;
            if (dropZone) {
                const r = dropZone.getBoundingClientRect();
                const pad = collapsed ? 14 : 0;
                hit = e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad;
            }
            if (dropZone) dropZone.classList.toggle("ws-drag-over", hit);
            // 显示/隐藏拖拽收藏提示
            const dragHint = _getPanelEl("#ws-savenode-drag-hint");
            if (dragHint) dragHint.classList.toggle("ws-drag-hint--show", hit);
            if (hit && !this._dragTargetZone) {
                this._dragTargetZone = "favorite";
            } else if (!hit && this._dragTargetZone) {
                this._dragTargetZone = null;
            }
        };
        document.addEventListener("pointermove", this._canvasNodeDragHandler, true);
        this._canvasNodeDropHandler = (e) => {
            if (this._dragTargetZone === "favorite") {
                const canvas = app.canvas;
                const selected = canvas ? (canvas.selected_nodes || {}) : {};
                let nodes = Object.values(selected);
                if (!nodes.length && canvas?.node_dragged) nodes = [canvas.node_dragged];
                if (nodes.length) {
                    const node = nodes[0];
                    // 防止节点被拖到面板背后：还原到拖拽起始位置
                    if (this._dragOriginalPos) {
                        node.pos[0] = this._dragOriginalPos[0];
                        node.pos[1] = this._dragOriginalPos[1];
                        canvas?.setDirty(true, true);
                    }
                    this.showChooseCategoryDialog({ type: node.type, title: node.title || node.type });
                }
            }
            this._dragOriginalPos = null;
            this.removeDragPreview();
        };
        document.addEventListener("pointerup", this._canvasNodeDropHandler, true);
        // 默认收起为星标状态，半隐藏在右侧边缘
        this.collapsePanel();
    }

    savePanelPosition() {
        if (!this.panel) return;
        const rect = this.panel.getBoundingClientRect();
        try { localStorage.setItem(POS_KEY, JSON.stringify({ left: rect.left, top: rect.top })); } catch (e) {}
    }

    loadPanelPosition() {
        try {
            const stored = localStorage.getItem(POS_KEY);
            if (!stored) return;
            const pos = JSON.parse(stored);
            const w = this.panel.offsetWidth || 320;
            const h = this.panel.offsetHeight || 400;
            const left = Math.max(8, Math.min(pos.left, window.innerWidth - w - 8));
            const top = Math.max(8, Math.min(pos.top, window.innerHeight - h - 8));
            this.panel.style.left = left + "px";
            this.panel.style.top = top + "px";
            this.panel.style.right = "auto";
        } catch (e) {}
    }

    /* ---------- 左边缘拖拽调整宽度 ---------- */
    setupPanelResize(panel) {
        const minW = 320, maxW = 800, minH = 200;

        /* ── 创建三个方向的手柄 ── */
        const handles = { left: null, right: null, bottom: null };

        handles.left = document.createElement("div");
        handles.left.className = "ws-resize-handle";
        handles.left.style.cssText = "position:absolute;left:calc(-1 * var(--ws-gap-xs));top:0;bottom:0;width:var(--ws-gap);cursor:ew-resize;z-index:5;";
        panel.appendChild(handles.left);

        handles.right = document.createElement("div");
        handles.right.className = "ws-resize-handle";
        handles.right.style.cssText = "position:absolute;right:calc(-1 * var(--ws-gap-xs));top:0;bottom:0;width:var(--ws-gap);cursor:ew-resize;z-index:5;";
        panel.appendChild(handles.right);

        handles.bottom = document.createElement("div");
        handles.bottom.className = "ws-resize-handle";
        handles.bottom.style.cssText = "position:absolute;left:0;right:0;bottom:calc(-1 * var(--ws-gap-xs));height:var(--ws-gap);cursor:ns-resize;z-index:5;";
        panel.appendChild(handles.bottom);

        panel.style.position = panel.style.position || "fixed";

        let resizingDir = null, startX = 0, startY = 0, startW = 0, startH = 0, startLeft = 0, usesLeft = false;

        const startResize = (dir, e) => {
            if (panel.classList.contains("ws-collapsed")) return;
            panel.style.transition = "none";
            if (dir === "bottom") panel.style.maxHeight = "none";
            resizingDir = dir;
            startX = e.clientX;
            startY = e.clientY;
            startW = panel.offsetWidth;
            startH = panel.offsetHeight;
            const rect = panel.getBoundingClientRect();
            startLeft = rect.left;
            usesLeft = panel.style.right === "auto" || panel.style.left !== "";
            e.preventDefault();
            e.stopPropagation();
        };

        handles.left.addEventListener("mousedown",   (e) => startResize("left", e));
        handles.right.addEventListener("mousedown",  (e) => startResize("right", e));
        handles.bottom.addEventListener("mousedown", (e) => startResize("bottom", e));

        const onMove = (e) => {
            if (!resizingDir) return;
            if (resizingDir === "left") {
                const dx = startX - e.clientX;
                const newW = Math.max(minW, Math.min(maxW, startW + dx));
                panel.style.width = newW + "px";
                if (usesLeft) panel.style.left = (startLeft - (newW - startW)) + "px";
            } else if (resizingDir === "right") {
                const dx = e.clientX - startX;
                const newW = Math.max(minW, Math.min(maxW, startW + dx));
                panel.style.width = newW + "px";
            } else if (resizingDir === "bottom") {
                const dy = e.clientY - startY;
                const vh = window.innerHeight * 0.78;
                const newH = Math.max(minH, Math.min(vh, startH + dy));
                panel.style.height = newH + "px";
            }
        };

        const onUp = () => {
            if (!resizingDir) return;
            resizingDir = null;
            panel.style.transition = "";
            try { localStorage.setItem(WIDTH_KEY, panel.offsetWidth); } catch (e) {}
            try { localStorage.setItem(HEIGHT_KEY, panel.offsetHeight); } catch (e) {}
        };

        this._resizeMoveHandler = onMove;
        this._resizeUpHandler = onUp;
        document.addEventListener("mousemove", this._resizeMoveHandler);
        document.addEventListener("mouseup", this._resizeUpHandler);
    }

    /* ---------- 内部左右分割线拖拽 ---------- */
    _setupDividerDrag(panel) {
        const divider = panel.querySelector(".ws-divider-v");
        if (!divider) return;
        const body = panel.querySelector(".ws-body");
        const rightCol = panel.querySelector(".ws-right-col");
        if (!body || !rightCol) return;

        // 还原保存的右侧列宽度比例
        try {
            const saved = localStorage.getItem(RATIO_KEY);
            if (saved) {
                const pct = parseFloat(saved);
                if (pct > 0 && pct < 1) {
                    const bodyW = body.offsetWidth;
                    rightCol.style.width = Math.round(bodyW * pct) + "px";
                }
            }
        } catch (e) {}

        // 加宽分隔线视觉宽度（覆盖CSS 1px竖线）
        divider.style.cssText = "width:var(--ws-sn-divider-drag-width);cursor:col-resize;flex-shrink:0;background:transparent;position:relative;z-index:6;";
        const line = document.createElement("div");
        line.style.cssText = "position:absolute;left:var(--ws-seg-pad);top:var(--ws-gap-xs);bottom:var(--ws-gap-xs);width:var(--ws-border-width-thin);background:var(--ws-border);pointer-events:none;";
        divider.appendChild(line);

        let dragging = false, startX = 0, startRightW = 0;

        const onDown = (e) => {
            if (panel.classList.contains("ws-collapsed")) return;
            dragging = true;
            startX = e.clientX;
            startRightW = rightCol.offsetWidth;
            body.style.userSelect = "none";
            body.style.pointerEvents = "none";
            e.preventDefault();
            e.stopPropagation();
        };

        const onMove = (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const bodyW = body.offsetWidth;
            const minW = 100, maxW = bodyW * 0.7;
            const newW = Math.max(minW, Math.min(maxW, startRightW - dx));
            rightCol.style.width = newW + "px";
        };

        const onUp = () => {
            if (!dragging) return;
            dragging = false;
            body.style.userSelect = "";
            body.style.pointerEvents = "";
            const bodyW = body.offsetWidth;
            const ratio = rightCol.offsetWidth / bodyW;
            try { localStorage.setItem(RATIO_KEY, String(ratio)); } catch (e) {}
        };

        divider.addEventListener("mousedown", onDown);
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);

        // 清理引用供 remove 时使用
        this._dividerCleanup = () => {
            divider.removeEventListener("mousedown", onDown);
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        };
    }

    _updateSortBtnUI() {
        const freqBtn = this.panel?.querySelector("#ws-savenode-sort-freq");
        const alphaBtn = this.panel?.querySelector("#ws-savenode-sort-alpha");
        if (freqBtn) freqBtn.classList.toggle("ws-sort-btn-active", this.currentSort === "freq");
        if (alphaBtn) alphaBtn.classList.toggle("ws-sort-btn-active", this.currentSort === "alpha");
    }

    _trackUsage(type) {
        const n = this.data.nodes.find(x => x.type === type);
        if (n) {
            n.usageCount = (n.usageCount || 0) + 1;
            this.saveData();
            if (this.currentSort === "freq") this.renderFavorites();
        }
    }

    applyTexts() {
        const p = this.panel;
        if (!p) return;
        p.querySelector("#ws-savenode-title").textContent = "🟠 " + t("saveNode.panelTitle");
        p.querySelector("#ws-savenode-toggle").title = t("saveNode.toggleCollapse");
        p.querySelector("#ws-savenode-collapsed-icon").title = t("saveNode.expandPanel");
        p.querySelector("#ws-savenode-collapsed-icon").style.cursor = "pointer";
        p.querySelector("#ws-savenode-search").placeholder = t("saveNode.searchPlaceholder");
        p.querySelector("#ws-savenode-cat-label").textContent = t("saveNode.categories");
        const rightTip = p.querySelector("#ws-savenode-right-footer-tip");
        if (rightTip) rightTip.textContent = t("saveNode.rightFooterTip");
        p.querySelector("#ws-savenode-clean").title = t("saveNode.cleanInvalid");
        p.querySelector("#ws-savenode-export").title = t("saveNode.exportData");
        p.querySelector("#ws-savenode-import").title = t("saveNode.importData");
        p.querySelector("#ws-savenode-shortcut").title = t("saveNode.shortcutHint");
        const freqBtn = p.querySelector("#ws-savenode-sort-freq");
        const alphaBtn = p.querySelector("#ws-savenode-sort-alpha");
        if (freqBtn) freqBtn.title = t("saveNode.sortByFreq");
        if (alphaBtn) alphaBtn.title = t("saveNode.sortByAlphabet");
        // 拖拽收藏提示文字
        const dragHint = p.querySelector("#ws-savenode-drag-hint");
        if (dragHint) dragHint.textContent = t("saveNode.dragToFavorite");
        // 操作提示
        const footerTip = p.querySelector("#ws-savenode-left-footer-tip");
        if (footerTip) footerTip.textContent = t("saveNode.leftFooterTip");
        p.querySelector("#ws-savenode-batch-toggle").title = t("saveNode.batchToggle");
        const batchLabels = [
            ["#ws-savenode-batch-select-all", "saveNode.batchSelectAll"],
            ["#ws-savenode-batch-deselect", "saveNode.batchDeselect"],
            ["#ws-savenode-batch-move", "saveNode.batchMove"],
            ["#ws-savenode-batch-delete", "saveNode.batchDelete"],
            ["#ws-savenode-batch-cancel", "saveNode.batchCancel"],
        ];
        batchLabels.forEach(([selector, key]) => {
            const button = p.querySelector(selector);
            if (button) button.textContent = t(key);
        });
    }

    renderAll() {
        this.renderCategories();
        this.renderFavorites();
    }

    renderCategories() {
        if (!this.categoryListEl) return;
        const el = this.categoryListEl;
        el.innerHTML = "";

        const allItem = document.createElement("div");
        allItem.className = "ws-category-item" + (this.currentCategory === "all" ? " active" : "");
        allItem.innerHTML = `
            <span class="ws-cat-color" style="background:var(--ws-text-muted)"></span>
            <span class="ws-cat-name">${this.escape(t("saveNode.allCategory"))}</span>
            <span class="ws-cat-count">${this.data.nodes.length}</span>
        `;
        allItem.addEventListener("click", () => {
            this.currentCategory = "all";
            this.renderCategories();
            this.renderFavorites();
        });
        el.appendChild(allItem);

        this.data.categories.forEach(cat => {
            const count = this.data.nodes.filter(n => n.categoryId === cat.id).length;
            const item = document.createElement("div");
            item.className = "ws-category-item" + (this.currentCategory === cat.id ? " active" : "");
            if (this._batchMode && this._selectedCats.has(cat.id)) item.classList.add("ws-category-item--selected");
            item.dataset.catId = cat.id;
            const checkboxHtml = this._batchMode
                ? `<label class="ws-cat-checkbox"><input type="checkbox" ${this._selectedCats.has(cat.id) ? "checked" : ""}/><span class="ws-checkmark"></span></label>`
                : "";
            const catIndex = this.data.categories.indexOf(cat);
            const dir = catIndex === 0 ? "down" : "up";
            const tip = catIndex === 0 ? t("saveNode.moveDown") : t("saveNode.moveUp");
            const arrow = catIndex === 0 ? "⬇" : "⬆";
            item.innerHTML = `
                ${checkboxHtml}
                <span class="ws-cat-color" style="background:${cat.color}"></span>
                <span class="ws-cat-name">${this.escape(cat.id === "default" ? t("saveNode.defaultCategoryName") : cat.name)}</span>
                <span class="ws-cat-count">${count}</span>
                <button class="wosai-btn wosai-btn--sm ws-cat-move-btn" data-dir="${dir}" title="${this.escape(tip)}">${arrow}</button>
            `;
            // 批量选择
            if (this._batchMode) {
                const cb = item.querySelector("input[type=checkbox]");
                cb?.addEventListener("change", (e) => {
                    e.stopPropagation();
                    this._toggleCatSelect(cat.id);
                    item.classList.toggle("ws-category-item--selected", this._selectedCats.has(cat.id));
                });
                item.addEventListener("click", (e) => {
                    if (e.target.closest("input, label")) return;
                    this._toggleCatSelect(cat.id);
                    if (cb) cb.checked = this._selectedCats.has(cat.id);
                    item.classList.toggle("ws-category-item--selected", this._selectedCats.has(cat.id));
                });
            } else {
                item.addEventListener("click", e => {
                    this.currentCategory = cat.id;
                    this.renderCategories();
                    this.renderFavorites();
                });
                // 右键编辑/删除分类
                item.addEventListener("contextmenu", e => {
                    e.preventDefault();
                    e.stopPropagation();
                    const menuEl = this._createCategoryContextMenu(cat);
                    document.body.appendChild(menuEl);
                    const x = e.clientX, y = e.clientY;
                    menuEl.style.left = x + "px"; menuEl.style.top = y + "px";
                    requestAnimationFrame(() => {
                        const r = menuEl.getBoundingClientRect();
                        if (r.right > window.innerWidth) menuEl.style.left = (x - r.width) + "px";
                        if (r.bottom > window.innerHeight) menuEl.style.top = (y - r.height) + "px";
                    });
                    const close = () => { menuEl.remove(); document.removeEventListener("click", close); document.removeEventListener("contextmenu", close); };
                    setTimeout(() => { document.addEventListener("click", close); document.addEventListener("contextmenu", close); }, 0);
                });
                // 上移/下移按钮
                item.querySelectorAll(".ws-cat-move-btn").forEach(btn => {
                    btn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        this.moveCategory(cat.id, btn.dataset.dir);
                    });
                });
            }
            el.appendChild(item);
        });
    }

    renderFavorites() {
        if (!this.favListEl) return;
        const el = this.favListEl;
        el.innerHTML = "";

        const nodes = this._getFilteredNodes();

        this.panel.querySelector("#ws-savenode-fav-count").textContent = this.data.nodes.length;

        if (nodes.length === 0) {
            const tip = document.createElement("div");
            tip.className = "ws-empty-tip";
            tip.textContent = this.data.nodes.length === 0 ? t("saveNode.emptyTip") : t("saveNode.emptyFiltered");
            el.appendChild(tip);
            return;
        }

        nodes.forEach((n, idx) => {
            const cat = this.data.categories.find(c => c.id === n.categoryId) || this.data.categories[0];
            const valid = this.isNodeTypeValid(n.type);
            const item = document.createElement("div");
            item.className = "ws-fav-item" + (this._batchMode ? " ws-fav-item--batch" : "");
            if (this._batchMode && this._selectedNodes.has(n.type)) item.classList.add("ws-fav-item--selected");
            item.dataset.index = idx;
            item.dataset.type = n.type;
            item.draggable = false;
            const rating = n.rating || 0;
            const checkboxHtml = this._batchMode
                ? `<label class="ws-fav-checkbox"><input type="checkbox" ${this._selectedNodes.has(n.type) ? "checked" : ""}/><span class="ws-checkmark"></span></label>`
                : "";
            item.innerHTML = `
                ${checkboxHtml}
                <span class="ws-fav-index">${idx + 1}</span>
                <span class="ws-fav-color" style="background:${cat ? cat.color : "var(--ws-text-muted)"}"></span>
                <div class="ws-fav-info">
                    <div class="ws-fav-name ${valid ? "" : "ws-fav-invalid"}">${this.escape(n.displayName)}${valid ? "" : this.escape(t("saveNode.invalidTag"))}</div>
                    <div class="ws-fav-type">${this.escape(n.type)}</div>
                </div>
                <div class="ws-fav-rating">
                    ${[1,2,3,4,5].map(i => `<span class="ws-star ${i <= rating ? 'ws-star-active' : ''}" data-val="${i}">★</span>`).join("")}
                </div>
                <button class="wosai-btn wosai-btn--sm ws-fav-pin-btn" title="${this.escape(t("saveNode.pinFavorite"))}">⬆</button>
            `;
            // 批量选择
            if (this._batchMode) {
                const cb = item.querySelector("input[type=checkbox]");
                cb?.addEventListener("change", (e) => {
                    e.stopPropagation();
                    this._toggleNodeSelect(n.type);
                    item.classList.toggle("ws-fav-item--selected", this._selectedNodes.has(n.type));
                });
                item.addEventListener("click", (e) => {
                    if (e.target.closest("button, input, label")) return;
                    this._toggleNodeSelect(n.type);
                    if (cb) cb.checked = this._selectedNodes.has(n.type);
                    item.classList.toggle("ws-fav-item--selected", this._selectedNodes.has(n.type));
                });
            }
            item.querySelectorAll(".ws-star").forEach(star => {
                star.addEventListener("click", e => {
                    e.stopPropagation();
                    const v = parseInt(star.dataset.val);
                    n.rating = n.rating === v ? 0 : v;
                    this.saveData();
                    this.renderFavorites();
                });
            });
            item.querySelector(".ws-fav-pin-btn").addEventListener("click", e => {
                e.stopPropagation();
                const allOrders = this.data.nodes.map(x => x.order || 0);
                const minOrder = allOrders.length ? Math.min(...allOrders) : 0;
                n.order = minOrder - 1;
                this.saveData();
                this.renderFavorites();
            });
            // 右键菜单：重命名 + 删除
            item.addEventListener("contextmenu", e => {
                e.preventDefault();
                e.stopPropagation();
                const menuEl = this._createFavContextMenu(n);
                document.body.appendChild(menuEl);
                const x = e.clientX, y = e.clientY;
                menuEl.style.left = x + "px"; menuEl.style.top = y + "px";
                requestAnimationFrame(() => {
                    const r = menuEl.getBoundingClientRect();
                    if (r.right > window.innerWidth) menuEl.style.left = (x - r.width) + "px";
                    if (r.bottom > window.innerHeight) menuEl.style.top = (y - r.height) + "px";
                });
                const close = () => { menuEl.remove(); document.removeEventListener("click", close); document.removeEventListener("contextmenu", close); };
                setTimeout(() => { document.addEventListener("click", close); document.addEventListener("contextmenu", close); }, 0);
            });
            item.addEventListener("mousedown", e => {
                if (e.target.closest("button")) return;
                if (!valid) return;
                this._pendingDrag = { type: n.type, displayName: n.displayName, startX: e.clientX, startY: e.clientY };
            });
            el.appendChild(item);
        });
    }

    async cleanInvalidFavorites() {
        const invalid = this.data.nodes.filter(n => !this.isNodeTypeValid(n.type));
        if (invalid.length === 0) { await this._showConfirmDialog(t("saveNode.cleanInvalidNone")); return; }
        if (!await this._showConfirmDialog(t("saveNode.cleanInvalidConfirm", invalid.length))) return;
        this.data.nodes = this.data.nodes.filter(n => this.isNodeTypeValid(n.type));
        this.saveData(); this.renderAll();
    }

    /* ---------- 批量选择模式 ---------- */
    toggleBatchMode(force) {
        this._batchMode = force !== undefined ? force : !this._batchMode;
        if (!this._batchMode) {
            this._selectedNodes.clear();
            this._selectedCats.clear();
        }
        const bar = this.panel?.querySelector("#ws-savenode-batch-bar");
        if (bar) bar.style.display = this._batchMode ? "flex" : "none";
        const batchBtn = this.panel?.querySelector("#ws-savenode-batch-toggle");
        if (batchBtn) batchBtn.classList.toggle("ws-sort-btn-active", this._batchMode);
        this.renderFavorites();
        this.renderCategories();
        this._updateBatchBar();
    }

    _updateBatchBar() {
        const count = this._selectedNodes.size + this._selectedCats.size;
        const countEl = this.panel?.querySelector("#ws-savenode-batch-count");
        if (countEl) {
            countEl.textContent = count > 0
                ? t("saveNode.batchSelectedCount", "Selected {count}").replace("{count}", String(count))
                : "";
        }
        const moveBtn = this.panel?.querySelector("#ws-savenode-batch-move");
        const delBtn = this.panel?.querySelector("#ws-savenode-batch-delete");
        if (moveBtn) moveBtn.disabled = this._selectedNodes.size === 0;
        if (delBtn) delBtn.disabled = count === 0;
    }

    _toggleNodeSelect(nodeType) {
        if (this._selectedNodes.has(nodeType)) this._selectedNodes.delete(nodeType);
        else this._selectedNodes.add(nodeType);
        this._updateBatchBar();
    }

    _toggleCatSelect(catId) {
        if (catId === "default") return;
        if (this._selectedCats.has(catId)) this._selectedCats.delete(catId);
        else this._selectedCats.add(catId);
        this._updateBatchBar();
    }

    _batchSelectAll() {
        const nodes = this._getFilteredNodes();
        nodes.forEach(n => this._selectedNodes.add(n.type));
        this.data.categories.filter(c => c.id !== "default").forEach(c => this._selectedCats.add(c.id));
        this.renderFavorites();
        this.renderCategories();
        this._updateBatchBar();
    }

    _batchDeselectAll() {
        this._selectedNodes.clear();
        this._selectedCats.clear();
        this.renderFavorites();
        this.renderCategories();
        this._updateBatchBar();
    }

    async _batchDeleteSelected() {
        const nodeCount = this._selectedNodes.size;
        const catCount = this._selectedCats.size;
        const total = nodeCount + catCount;
        if (total === 0) return;
        if (!(await this._showConfirmDialog(t("saveNode.batchDeleteConfirm", total)))) return;
        // 删除选中的收藏节点
        if (nodeCount > 0) {
            this.data.nodes = this.data.nodes.filter(n => !this._selectedNodes.has(n.type));
        }
        // 删除选中的分类（将其中的节点移到默认分类）
        if (catCount > 0) {
            this._selectedCats.delete("default"); // 默认分类不可删除
            const fallback = this.data.categories.find(c => c.id === "default") || this.data.categories[0];
            this.data.nodes.forEach(n => {
                if (this._selectedCats.has(n.categoryId)) n.categoryId = fallback.id;
            });
            this.data.categories = this.data.categories.filter(c => !this._selectedCats.has(c.id));
            if (this._selectedCats.has(this.currentCategory)) this.currentCategory = "all";
        }
        this._selectedNodes.clear();
        this._selectedCats.clear();
        this.saveData();
        this.renderAll();
        this._updateBatchBar();
    }

    _batchMoveToCategory() {
        if (this._selectedNodes.size === 0) return;
        const overlay = document.createElement("div");
        overlay.className = "ws-dialog-overlay";
        const catTags = this.data.categories
            .filter(c => !this._selectedCats.has(c.id))
            .map(c => {
                const label = c.id === "default" ? t("saveNode.defaultCategoryName") : c.name;
                return `<button class="ws-choose-tag" data-cat-id="${this.escape(c.id)}"><span class="ws-choose-tag-dot" style="background:${c.color || _defaultCategoryColor()}"></span>${this.escape(label)}</button>`;
            }).join("");
        overlay.innerHTML = `
            <div class="ws-dialog wosai-panel wosai-panel--glass" data-wosai-panel="">
                <div class="ws-dialog-title">${this.escape(t("saveNode.batchMoveTitle"))}</div>
                <div class="ws-dialog-body">
                    <label>${this.escape(t("saveNode.batchMoveLabel", this._selectedNodes.size))}</label>
                    <div class="ws-choose-tags">${catTags}</div>
                </div>
                <div class="ws-dialog-footer">
                    <button class="wosai-btn" id="ws-dlg-cancel">${this.escape(t("saveNode.cancel"))}</button>
                    <button class="wosai-btn wosai-btn--primary" id="ws-dlg-ok" disabled>${this.escape(t("saveNode.ok"))}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        // 吸附到收藏节点面板左侧、垂直居中
        this._snapDialogToPanelLeftTop(overlay.querySelector(".ws-dialog"));
        const close = () => overlay.remove();
        let selectedCatId = null;
        const okBtn = overlay.querySelector("#ws-dlg-ok");
        overlay.addEventListener("mousedown", e => { if (e.target === overlay) close(); });
        overlay.querySelector("#ws-dlg-cancel").addEventListener("click", close);
        overlay.querySelectorAll(".ws-choose-tag").forEach(tag => {
            tag.addEventListener("click", () => {
                overlay.querySelectorAll(".ws-choose-tag").forEach(t => t.classList.remove("ws-choose-tag--active"));
                tag.classList.add("ws-choose-tag--active");
                selectedCatId = tag.dataset.catId;
                okBtn.disabled = false;
            });
        });
        okBtn.addEventListener("click", () => {
            if (!selectedCatId) return;
            this._selectedNodes.forEach(nodeType => {
                const entry = this.data.nodes.find(n => n.type === nodeType);
                if (entry) entry.categoryId = selectedCatId;
            });
            this._selectedNodes.clear();
            this.saveData();
            this.renderAll();
            this._updateBatchBar();
            close();
        });
    }

    /* ---------- 对话框 ---------- */
    /* ---------- 分类颜色选择器（仅保留 9 个预设色块） ---------- */
    _wireCategoryColorPicker(root, initColor) {
        const swatches = Array.from(root.querySelectorAll(".ws-cat-presetswatch"));
        let current = initColor;

        const setActive = (color) => {
            const normalized = (color || "").toLowerCase();
            swatches.forEach(s => {
                s.classList.toggle("ws-cat-presetswatch--active", s.dataset.color.toLowerCase() === normalized);
            });
        };

        swatches.forEach(sw => {
            sw.addEventListener("click", () => {
                current = sw.dataset.color;
                setActive(current);
            });
        });

        // 若初始颜色不在预设中，回退到第一个预设
        const matched = swatches.find(s => s.dataset.color.toLowerCase() === (current || "").toLowerCase());
        if (!matched && swatches.length) current = swatches[0].dataset.color;
        setActive(current);

        return { getColor: () => current, destroy: () => {} };
    }

    _categoryFormInner(initName, initColor) {
        return `
            <div class="ws-cat-name-group">
                <label>${this.escape(t("saveNode.categoryNameLabel"))}</label>
                <input type="text" id="ws-cat-name" placeholder="${this.escape(t("saveNode.inputCategoryName"))}" value="${this.escape(initName)}" />
            </div>
            <label>${this.escape(t("saveNode.quickColorLabel"))}</label>
            <div class="ws-cat-presets" id="ws-cat-presets">
                ${_getPresetColors().map(c => `<span class="ws-cat-presetswatch" data-color="${c}" style="background:${c}" title="${_colorLabel(c)}"></span>`).join("")}
            </div>
        `;
    }

    /**
     * 将弹窗吸附到收藏节点面板【左侧优先、放不下翻右侧、贴顶部（上方）】。
     * 先挂载测出弹窗真实尺寸，再紧贴面板左边并与面板顶部对齐；
     * 收藏节点面板通常停靠在屏幕右侧，故弹窗默认出现在面板左侧（屏幕靠右区域）；
     * 若面板左侧空间不足则翻到面板右侧；同时夹在视口范围内，避免弹窗超出屏幕。
     */
    _snapDialogToPanelLeftTop(dlg) {
        // 先确保收藏节点面板已展开（瞬时），避免面板未展开/折叠时弹窗定位到 0,0 或星标球位置
        this.ensurePanelExpanded();
        if (!this.panel) return;
        const pr = this.panel.getBoundingClientRect();
        const GAP = 12;
        const viewW = window.innerWidth;
        const viewH = window.innerHeight;

        // 先占位挂载（若尚未挂载）以便测量真实尺寸
        dlg.style.position = "fixed";
        dlg.style.visibility = "hidden";
        dlg.style.left = "0px";
        dlg.style.top = "0px";
        if (!dlg.isConnected) document.body.appendChild(dlg);
        const dw = dlg.offsetWidth || 300;
        const dh = dlg.offsetHeight || 140;

        // 选择空间更大的一侧：面板左侧可用空间 vs 右侧可用空间
        const leftSpace = Math.max(0, pr.left - GAP);
        const rightSpace = Math.max(0, viewW - pr.right - GAP);
        let left;
        if (leftSpace >= dw || leftSpace >= rightSpace) {
            left = pr.left - dw - GAP;
            if (left < 8) left = 8; // 左侧剩余空间不足时贴左视口
        } else {
            left = pr.right + GAP;
            if (left + dw > viewW - 8) left = Math.max(8, viewW - dw - 8);
        }

        // 垂直方向：与面板顶部对齐，并保证不超出视口；优先让弹窗完整可见
        let top = pr.top;
        if (top + dh > viewH - 8) top = Math.max(8, viewH - dh - 8);
        top = Math.max(8, top);

        dlg.style.left = left + "px";
        dlg.style.top = top + "px";
        dlg.style.visibility = "";
    }

    /**
     * 统一收藏/新建分类对话框
     * @param {Object|null} node - 要收藏的节点（null = 仅新建分类）
     */
    showChooseCategoryDialog(node) {
        // 单例：先关闭已有的“收藏到分类”弹窗，避免多次点击产生重叠窗口
        if (this._activeChooseCatDialog) {
            const old = this._activeChooseCatDialog;
            this._activeChooseCatDialog = null;
            old.querySelector("#ws-dlg-cancel")?.click?.();
            if (old.isConnected) old.remove();
        }

        const categoryColors = _getCategoryColors();
        const defaultColor = categoryColors[this.data.categories.length % categoryColors.length] || _defaultCategoryColor();
        const isNewOnly = !node;

        /* ── 标签：展示全部分类 ── */
        const catTagsHtml = this.data.categories.map(c => {
            const label = c.id === "default" ? t("saveNode.defaultCategoryName") : c.name;
            return `<button class="ws-choose-tag" data-cat-id="${this.escape(c.id)}"><span class="ws-choose-tag-dot" style="background:${c.color || _defaultCategoryColor()}"></span>${this.escape(label)}</button>`;
        }).join("");

        const dlg = document.createElement("div");
        dlg.className = "ws-dialog wosai-panel wosai-panel--glass ws-choose-cat-dialog ws-category-dialog";
        dlg.setAttribute("data-wosai-panel", "");
        dlg.innerHTML = `
            <div class="ws-dialog-title">${this.escape(isNewOnly ? t("saveNode.addCategoryTitle") : t("saveNode.chooseCategoryTitle"))}</div>
            <div class="ws-dialog-body">
                <label class="${isNewOnly ? 'ws-hidden' : ''}">${this.escape(t("saveNode.chooseCategoryLabel"))}</label>
                <div class="ws-choose-tags ${isNewOnly ? 'ws-hidden' : ''}">
                    ${catTagsHtml}
                    <button class="ws-choose-tag ws-choose-tag--add" data-cat-id="__new__">+ ${this.escape(t("saveNode.newCategory"))}</button>
                </div>
                <div id="ws-newcat-wrap" ${isNewOnly ? "" : 'style="display:none"'}>
                    ${this._categoryFormInner("", defaultColor)}
                </div>
            </div>
            <div class="ws-dialog-footer">
                <button class="wosai-btn" id="ws-dlg-cancel">${this.escape(t("saveNode.cancel"))}</button>
                <button class="wosai-btn wosai-btn--primary" id="ws-dlg-ok" ${isNewOnly ? "" : 'style="display:none"'}>${this.escape(t("saveNode.ok"))}</button>
            </div>
        `;
        document.body.appendChild(dlg);
        this._activeChooseCatDialog = dlg; // 记录当前弹窗引用
        // 吸附到收藏节点面板空间更大的一侧、保证可见
        this._snapDialogToPanelLeftTop(dlg);
        let picker = null;
        const close = () => {
            if (this._activeChooseCatDialog === dlg) this._activeChooseCatDialog = null;
            picker?.destroy?.(); dlg.remove();
        };

        const wrap = dlg.querySelector("#ws-newcat-wrap");
        const nameInput = dlg.querySelector("#ws-cat-name");
        const okBtn = dlg.querySelector("#ws-dlg-ok");
        picker = this._wireCategoryColorPicker(dlg, defaultColor);

        if (isNewOnly) {
            nameInput?.focus();
        }

        /* ── 标签点击事件 ── */
        dlg.querySelectorAll(".ws-choose-tag").forEach(tag => {
            tag.addEventListener("click", () => {
                const catId = tag.dataset.catId;
                if (catId === "__new__") {
                    wrap.style.display = "";
                    okBtn.style.display = "";
                    nameInput?.focus();
                } else {
                    if (node) this.addFavorite(node, catId);
                    close();
                }
            });
        });

        dlg.querySelector("#ws-dlg-cancel").addEventListener("click", () => {
            close();
            this.collapsePanel();
        });
        okBtn.addEventListener("click", () => {
            const name = nameInput.value.trim();
            if (!name) { nameInput.focus(); nameInput.classList.add("ws-input-error"); return; }
            const color = picker.getColor();
            const catId = this.addCategory(name, color);
            if (node) this.addFavorite(node, catId);
            close();
        });

        dlg.tabIndex = -1;
        dlg.addEventListener("keydown", e => {
            if (e.key === "Escape") close();
            else if (e.key === "Enter" && okBtn.style.display !== "none") okBtn.click();
        });
        setTimeout(() => dlg.focus(), 0);
    }

    showEditCategoryDialog(cat) {
        const isNew = !cat;
        const categoryColors = _getCategoryColors();
        const defaultColor = categoryColors[this.data.categories.length % categoryColors.length] || _defaultCategoryColor();
        const initColor = isNew ? defaultColor : (cat.color || defaultColor);
        const initName = isNew ? t("saveNode.newCategoryName") : cat.name;
        const overlay = document.createElement("div");
        overlay.className = "ws-dialog-overlay";
        overlay.innerHTML = `
            <div class="ws-dialog wosai-panel wosai-panel--glass ws-category-dialog" data-wosai-panel="">
                <div class="ws-dialog-title">${this.escape(isNew ? t("saveNode.addCategoryTitle") : t("saveNode.editCategoryTitle"))}</div>
                <div class="ws-dialog-body">
                    ${this._categoryFormInner(initName, initColor)}
                </div>
                <div class="ws-dialog-footer">
                    <button class="wosai-btn" id="ws-dlg-cancel">${this.escape(t("saveNode.cancel"))}</button>
                    <button class="wosai-btn wosai-btn--primary" id="ws-dlg-ok">${this.escape(isNew ? t("saveNode.ok") : t("saveNode.save"))}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        // 吸附到收藏节点面板左侧、垂直居中
        this._snapDialogToPanelLeftTop(overlay.querySelector(".ws-dialog"));
        const close = () => { state.destroy?.(); overlay.remove(); };
        overlay.addEventListener("mousedown", e => { if (e.target === overlay) close(); });
        const nameInput = overlay.querySelector("#ws-cat-name");
        nameInput.focus(); nameInput.select();
        const state = this._wireCategoryColorPicker(overlay, initColor);
        overlay.querySelector("#ws-dlg-cancel").addEventListener("click", close);
        overlay.querySelector("#ws-dlg-ok").addEventListener("click", () => {
            const name = nameInput.value.trim();
            if (!name) { nameInput.focus(); nameInput.classList.add("ws-input-error"); return; }
            const color = state.getColor();
            if (isNew) this.addCategory(name, color);
            else this.editCategory(cat.id, name, color);
            close();
        });
        overlay.tabIndex = -1;
        overlay.addEventListener("keydown", e => {
            if (e.key === "Escape") close();
            else if (e.key === "Enter") overlay.querySelector("#ws-dlg-ok").click();
        });
        setTimeout(() => overlay.focus(), 0);
    }

    escape(str) {
        const div = document.createElement("div");
        div.textContent = str ?? "";
        return div.innerHTML;
    }

    /** 导出收藏节点前的确认弹窗：吸附到面板右侧上方 */
    showExportConfirmDialog() {
        const overlay = document.createElement("div");
        overlay.className = "ws-dialog-overlay";
        overlay.innerHTML = `
                <div class="ws-dialog wosai-panel wosai-panel--glass ws-export-confirm" data-wosai-panel="">
                    <div class="ws-dialog-title">${this.escape(t("saveNode.exportData"))}</div>
                <div class="ws-dialog-body">
                    <p class="ws-confirm-text">${this.escape(t("saveNode.exportConfirmDesc"))}</p>
                </div>
                <div class="ws-dialog-footer">
                    <button class="wosai-btn" id="ws-dlg-cancel">${this.escape(t("saveNode.cancel"))}</button>
                    <button class="wosai-btn wosai-btn--primary" id="ws-dlg-ok">${this.escape(t("saveNode.exportConfirmBtn"))}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        // 吸附到收藏节点面板【右侧上方】
        this._snapDialogToPanelLeftTop(overlay.querySelector(".ws-dialog"));
        const close = () => overlay.remove();
        overlay.addEventListener("mousedown", e => { if (e.target === overlay) close(); });
        overlay.querySelector("#ws-dlg-cancel").addEventListener("click", close);
        overlay.querySelector("#ws-dlg-ok").addEventListener("click", () => {
            close();
            this._exportData();
        });
        overlay.tabIndex = -1;
        overlay.addEventListener("keydown", e => {
            if (e.key === "Escape") close();
            else if (e.key === "Enter") overlay.querySelector("#ws-dlg-ok").click();
        });
        setTimeout(() => overlay.focus(), 0);
    }

    /* ===== 导出/导入 ===== */
    async _exportData() {
        try {
            const payload = {
                version: 2,
                exportedAt: new Date().toISOString(),
                categories: this.data.categories,
                nodes: this.data.nodes,
            };
            const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `wosai-savenode-backup-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error("[SaveNode] export failed:", e);
            alert(t("saveNode.exportFailed") + e.message);
        }
    }

    async _importData(file) {
        try {
            if (!file || file.size > SAVE_NODE_LIMITS.importBytes) {
                alert(t("saveNode.invalidFileFormat"));
                return;
            }
            const text = await file.text();
            const parsed = JSON.parse(text);
            if (!parsed || !Array.isArray(parsed.nodes)) {
                alert(t("saveNode.invalidFileFormat"));
                return;
            }
            const data = sanitizeSaveNodeData(parsed, {
                defaultName: t("saveNode.defaultCategoryName"),
                defaultColor: _defaultCategoryColor(),
            });
            if (!(await this._showConfirmDialog(t("saveNode.importOverrideConfirm")))) return;

            this.data = data;
            this.currentCategory = "all";
            this.saveData();

            this.renderAll();
            alert(t("saveNode.importSuccess"));
        } catch (e) {
            console.error("[SaveNode] import failed:", e);
            alert(t("saveNode.importFailed") + e.message);
        }
    }

    _getFilteredNodes() {
        return filterFavoriteNodes(this.data.nodes, {
            category: this.currentCategory,
            search: this.currentSearch,
            sort: this.currentSort,
            matches: (node, term) => this._matchSearch(node, term),
        });
    }
}

/* ---------- 注册扩展 ---------- */
let _inst = null;
let _onSaveNodeLangChange = null;

function _saveNodeInstance() {
    if (!_inst) _inst = new WosaiSaveNode();
    return _inst;
}

function _openPanel() { _saveNodeInstance().togglePanel(); }
function _ensurePanelOpen() { _saveNodeInstance().ensurePanelExpanded(); }

// 悬浮球收藏子球：先展开收藏节点面板，再唤起分类弹窗（选中节点则收藏到分类，未选中则弹“新建分类”）
function _openFavoriteDialog() {
    const instance = _saveNodeInstance();
    instance.ensurePanelExpanded();
    const canvas = LGraphCanvas.active_canvas;
    const selected = canvas ? (canvas.selected_nodes || {}) : {};
    const ids = Object.keys(selected);
    const node = ids.length ? selected[ids[0]] : null;
    instance.showChooseCategoryDialog(node);
}

function _showFavoriteDialogForSelection() {
    const canvas = LGraphCanvas.active_canvas;
    const selected = canvas ? (canvas.selected_nodes || {}) : {};
    const ids = Object.keys(selected);
    if (ids.length === 0) { quickToast(t("saveNode.noNodeSelected") || "Select at least one node first"); return; }
    const node = selected[ids[0]];
    _saveNodeInstance().showChooseCategoryDialog(node);
}

function _isFavorited(nodeType) { return _saveNodeInstance().isFavorited(nodeType); }
function _removeFavorite(nodeType) { return _saveNodeInstance().removeFavorite(nodeType); }
function _showChooseCategoryDialog(node) { return _saveNodeInstance().showChooseCategoryDialog(node); }
function _getSaveNodeData() { return _saveNodeInstance().data; }
function _persistSaveNodeData() {
    const instance = _saveNodeInstance();
    instance.saveData();
    instance.renderAll();
}

const SAVE_NODE_GLOBALS = {
    __wosaiSaveNodeToggle: _openPanel,
    __wosaiOpenSaveNodePanel: _ensurePanelOpen,
    __wosaiShowFavoriteDialog: _showFavoriteDialogForSelection,
    __wosaiIsFavorited: _isFavorited,
    __wosaiRemoveFavorite: _removeFavorite,
    __wosaiShowChooseCategoryDialog: _showChooseCategoryDialog,
    __wosaiGetSaveNodeData: _getSaveNodeData,
    __wosaiPersistSaveNodeData: _persistSaveNodeData,
};

function _exposeSaveNodeGlobals() {
    Object.assign(window, SAVE_NODE_GLOBALS);
}

function _removeSaveNodeGlobals() {
    for (const [name, handler] of Object.entries(SAVE_NODE_GLOBALS)) {
        if (window[name] === handler) delete window[name];
    }
}

app.registerExtension({
    name: "WOSAI.SaveNode",
    async setup() {
        const instance = _saveNodeInstance();
        instance.renderAll();
        _onSaveNodeLangChange = () => {
            if (instance.panel) {
                instance.applyTexts();
                instance.renderAll();
            }
        };
        onLangChange(_onSaveNodeLangChange);
        registerHudTab({
            id: "favorite",
            label: t("menus.launcher.orbLabelFavorite"),
            order: 3,
            panel: _openFavoriteDialog,
        });
        _exposeSaveNodeGlobals();
    },
    remove() {
        if (_onSaveNodeLangChange) offLangChange(_onSaveNodeLangChange);
        _onSaveNodeLangChange = null;
        unregisterHudTab("favorite");
        _removeSaveNodeGlobals();
        _inst?.destroy();
        _inst = null;
    },
});
