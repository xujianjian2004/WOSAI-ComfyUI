// ========== WOSAI ColorBar — 快捷上色 HUD ==========
// 常驻悬浮球（可拖拽，位置记忆）→ 点击滑动展开工具条。
// 快捷键 ` 同样可开关（可在 Keybindings 中改键）。
// color tab 的 DOM 构建已拆分至 ./shared/color-bar-ui.js；本文件仅负责框架状态与生命周期。

import { t, onLangChange } from "./shared/i18n.js";
import { app } from "../../../scripts/app.js";
import { initStore } from "./shared/color-store.js";
import { getSetting, makeDraggable } from "./shared/shared-utils.js";
import { getSelectedGroups } from "./shared/canvas-utils.js";
import {
    glassT as barT, getGlassTheme as getBarTheme, getGlassMode as getBarMode,
    onGlassChange, GLASS_MODE_DEFS,
} from "./shared/glass-theme.js";
import {
    getHudTab, getHudBuilder,
    onHudOpenRequest, offHudOpenRequest,
    registerHudTab, unregisterHudTab,
    applyGlassBar,
} from "./shared/hud-kit.js";
import {
    removeLauncher, showLauncherWhenReady,
    getLauncherEl, setLauncherSkinFn, callLauncherSkin,
    setLauncherContext, clampPos,
    openAvatarPanel,
    getColorOrbPosition, isWingsOpen, getOrbsBoundingBox, orbsFromKeyboard,
} from "./launcher.js";
import { createColorTabBuilders, ICONS } from "./shared/color-bar-ui.js";
import { registerSelectionFollower } from "./shared/selection-follow.js";

let _hubBarMod = null;    // 动态导入的 HUB 栏模块（避免 ES 模块缓存导致旧代码不刷新）
let _bar = null;          // 工具条
let _barDragCleanup = null;
let _barFollowCleanup = null;
let _themeMenu = null;    // 主题子菜单
let _escHandler = null;
let _canvasClickHandler = null;
let _holdActive = false;  // Hold 模式：` 按住中
let _hoverItem = null;    // 当前悬停的工具条条目（Hold 松开时执行）
let _keyDownHandler = null, _keyUpHandler = null;
let _offGlassChange = null;   // onGlassChange 退订函数（remove 时清理）
let _offLangChange = null;    // onLangChange 退订函数（remove 时清理）
let _showTimer = null;        // showLauncherWhenReady 兜底定时器
let _launcherDelayTimer = null;   // 悬浮球延迟加载定时器
let _reopenTimer = null;      // tab/语言切换后的短延时重开
let _hudTab = 'color';    // 融合 HUD 当前 tab：color 配色 / align 对齐
let _openHudHandler = null;   // onHudOpenRequest 回调引用
let _runtimeGeneration = 0;
let _runtimeActive = false;

const HUD_MODULE_THEME = {
    color: { color: 'var(--ws-hub-color)', end: 'var(--ws-hub-color-end)' },
    align: { color: 'var(--ws-hub-align)', end: 'var(--ws-hub-align-end)' },
    node: { color: 'var(--ws-hub-node)', end: 'var(--ws-hub-node-end)' },
};

// Hold 模式钩子：由 color-bar-ui.js 注入到各条目
const _holdHooks = {
    onEnter: (w) => { _hoverItem = w; },
    onLeave: (w) => { if (_hoverItem === w) _hoverItem = null; },
};
let buildColorTabContent = null;
let buildThemeMenu = null;
async function _ensureColorTabBuilders() {
    if (!buildColorTabContent) {
        ({ buildColorTabContent, buildThemeMenu } = await createColorTabBuilders(_holdHooks));
    }
}

// 将 CSS 长度变量解析为像素数值（用于 JS 定位计算）
function varToPx(name) {
    if (typeof window === 'undefined' || !window.getComputedStyle) return 0;
    const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!val) return 0;
    const parsed = parseFloat(val.replace(/px$/, ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

// ── ComfyUI 原生 Settings ────────────────────────────────
const SETTING_HOLD = 'WOSAI.ColorBar.HoldMode';
const LAUNCHER_DELAY_MS = 1500;   // 悬浮球延迟加载时长，避免页面刚加载时闪现
const HUD_TOOLBAR_NUDGE = 32;     // HUD 工具栏上方定位时下移，完整遮住原生栏
function getOrient() { return 'h'; }   // 仅横版（竖版功能已移除）

function closeThemeMenu() {
    if (_themeMenu) { _themeMenu.remove(); _themeMenu = null; }
}

function closeBar(opts = {}) {
    closeThemeMenu();
    _barDragCleanup?.();
    _barDragCleanup = null;
    _barFollowCleanup?.();
    _barFollowCleanup = null;
    if (_bar) {
        const bar = _bar; _bar = null;
        // 滑动收起动画（透明期间禁止拦截画布事件）
        bar.style.opacity = '0';
        bar.style.transform = 'scale(.92)';
        bar.style.pointerEvents = 'none';
        setTimeout(() => bar.remove(), 160);
    }
    if (_escHandler) { document.removeEventListener('keydown', _escHandler); _escHandler = null; }
    if (_canvasClickHandler) { app.canvas?.canvas?.removeEventListener('pointerdown', _canvasClickHandler, true); _canvasClickHandler = null; }
    // 仅在“真实关闭”时恢复操作栏；切换 tab / 语言时的关闭紧接着重开，
    // 传 keepHidden 以避免操作栏闪现。
    if (!opts.keepHidden) _hubBarMod?.restoreMiniBarsAfterPopup?.();
}
window.__wosaiCloseBar = closeBar;

function scheduleBarOpen(delay = 170) {
    if (_reopenTimer) clearTimeout(_reopenTimer);
    _reopenTimer = setTimeout(() => {
        _reopenTimer = null;
        if (_runtimeActive) openBar();
    }, delay);
}

function applyHudModuleTheme(bar, tab) {
    const theme = HUD_MODULE_THEME[tab];
    if (!theme || !bar) return;
    bar.style.setProperty('--ws-module-color', theme.color);
    bar.style.setProperty('--ws-module-end', theme.end);
    // applyGlassBar 使用内联样式，主题边框与光晕也需在此处写入。
    bar.style.border = `var(--ws-border-width-thin) solid color-mix(in srgb, ${theme.color} 48%, var(--ws-border))`;
    bar.style.boxShadow = `var(--ws-glass-shadow), 0 0 0 var(--ws-border-width-thin) color-mix(in srgb, ${theme.color} 24%, transparent)`;
}

// 主题切换时不重建整个 DOM，仅更新 data-theme 并刷新皮肤
function refreshBarSkin() {
    if (!_bar) return;
    const T = barT();
    _bar.setAttribute('data-theme', getBarTheme());

    // 重新应用玻璃外观，但保留当前 opacity/transform 避免收起展开动画
    const prevOpacity = _bar.style.opacity;
    const prevTransform = _bar.style.transform;
    const prevLeft = _bar.style.left;
    const prevTop = _bar.style.top;
    applyGlassBar(_bar, getOrient());
    _bar.style.opacity = prevOpacity;
    _bar.style.transform = prevTransform;
    _bar.style.left = prevLeft;
    _bar.style.top = prevTop;

    // chip 边框
    _bar.querySelectorAll('[data-ws-skin="chip"]').forEach(el => { el.style.borderColor = T.chipRing; });
    // 历史色块删除按钮
    _bar.querySelectorAll('[data-ws-skin="chip-del"]').forEach(el => {
        el.style.background = T.btnBg; el.style.color = T.text; el.style.borderColor = T.divider;
    });
    // divider
    _bar.querySelectorAll('[data-ws-skin="divider"]').forEach(el => { el.style.background = T.divider; });
    // icon 按钮底色/颜色
    _bar.querySelectorAll('[data-ws-skin="btn"]').forEach(el => {
        el.style.background = T.btnBg; el.style.color = 'var(--ws-text-secondary)'; el.dataset.baseColor = 'var(--ws-text-secondary)';
    });

    // 模式按钮图标随当前模式刷新
    const modeBtn = _bar.querySelector('[data-ws-mode-btn]');
    if (modeBtn) {
        const curMode = getBarMode();
        const md = GLASS_MODE_DEFS[curMode];
        const iconWrap = modeBtn.firstChild;
        // MODE_ICONS 已移入 color-bar-ui.js，这里用同名本地常量刷新
        const MODE_ICONS = { auto: ICONS.auto, light: ICONS.sun, dark: ICONS.moon };
        iconWrap.innerHTML = MODE_ICONS[curMode];
        iconWrap.style.background = T.btnBg;
        iconWrap.style.color = 'var(--ws-text-secondary)';
        modeBtn._tip = md.tip;
    }
}

// 融合 HUD：切换/打开到指定 tab（配色/对齐/节点/检索…）；同 tab 再次触发则关闭
export function openHud(tab) {
    const t = getHudTab(tab);
    // Panel-only tab（fx/bg/settings/avatar 等）：不显示 HUD 栏，直接弹出面板
    if (t && t.panel && !t.build) {
        if (_bar) closeBar();
        t.panel();
        return;
    }
    if (_bar && _hudTab === tab) { closeBar(); return; }
    _hudTab = tab || 'color';
    if (_bar) { closeBar({ keepHidden: true }); scheduleBarOpen(); }   // 切 tab：收起再展开（不恢复操作栏）
    else openBar();
}
// 挂载到 window 供 hub-bar.js 桥接调用
window.__wosaiOpenHud = openHud;

// 工具条定位（悬浮球不被遮挡）
function positionBar() {
    if (!_bar) return;
    if (_bar.dataset.wosaiManualPosition === "true") return;
    const br = _bar.getBoundingClientRect();
    let x, y;

    // 0) HUB 栏可见时 → 工具条对齐到 HUB 栏底部
    if (_hubBarMod) {
        const hub = _hubBarMod.getHubBarRect?.();
        if (hub?.visible && hub.rect) {
            x = hub.rect.left + hub.rect.width / 2 - br.width / 2;
            y = hub.rect.bottom + 8;
            if (y + br.height > window.innerHeight - 8) {
                y = hub.rect.top - br.height - 8;
            }
        }
    }

    // 1) 选中分组 → 定位到分组框正上方居中
    const groups = getSelectedGroups();
    if (x === undefined && groups.length) {
        const c = window.app?.canvas;
        if (c?.ds && c?.canvas) {
            const rect = c.canvas.getBoundingClientRect();
            const sc = c.ds.scale, ox = c.ds.offset[0], oy = c.ds.offset[1];
            let gLeft = Infinity, gTop = Infinity, gRight = -Infinity, gBottom = -Infinity;
            for (const g of groups) {
                const gx = rect.left + (g.pos[0] + ox) * sc;
                const gy = rect.top + (g.pos[1] + oy) * sc;
                const gw = g.size[0] * sc;
                const gh = g.size[1] * sc;
                if (gx < gLeft) gLeft = gx;
                if (gy < gTop) gTop = gy;
                if (gx + gw > gRight) gRight = gx + gw;
                if (gy + gh > gBottom) gBottom = gy + gh;
            }
            x = (gLeft + gRight) / 2 - br.width / 2;
            y = gTop - br.height - 10;
            if (y < 8) y = gBottom + 10;
            else y += HUD_TOOLBAR_NUDGE;
        }
    }

    // 2) 有选中节点 → 在选中节点标题栏上方弹出
    if (x === undefined) {
        const c = window.app?.canvas;
        if (c?.ds && c?.canvas) {
            const sel = [...(c.graph?._nodes || [])].filter(n => n.is_selected && n.pos && n.size);
            if (sel.length > 0) {
                const rect = c.canvas.getBoundingClientRect();
                const sc = c.ds.scale, ox = c.ds.offset[0], oy = c.ds.offset[1];
                const TH = (window.LiteGraph && window.LiteGraph.NODE_TITLE_HEIGHT) || 0;
                let minX = Infinity, minTitleY = Infinity, maxX = -Infinity, maxBottomY = -Infinity;
                for (const n of sel) {
                    const sx = rect.left + (n.pos[0] + ox) * sc;
                    const sy = rect.top + (n.pos[1] + oy) * sc;
                    const sw = n.size[0] * sc, sh = n.size[1] * sc;
                    const titleY = sy - TH * sc;
                    const bottomY = sy + sh;
                    if (sx < minX) minX = sx;
                    if (titleY < minTitleY) minTitleY = titleY;
                    if (sx + sw > maxX) maxX = sx + sw;
                    if (bottomY > maxBottomY) maxBottomY = bottomY;
                }
                x = minX + (maxX - minX) / 2 - br.width / 2;
                y = minTitleY - br.height - varToPx('--ws-cb-node-margin');
                if (y < 8) y = maxBottomY + 10;
                else y += HUD_TOOLBAR_NUDGE;
            }
        }
    }

    // 3) 无选中节点 → 基于子球/悬浮球包围盒定位
    if (x === undefined) {
        const top = getColorOrbPosition();
        if (top && isWingsOpen() && orbsFromKeyboard()) {
            const _el = getLauncherEl();
            const lr = _el ? _el.getBoundingClientRect() : null;
            const bbox = getOrbsBoundingBox();
            const clusterTop = bbox ? bbox.top : (lr ? lr.top : 0);
            if (lr) x = lr.left + lr.width / 2 - br.width / 2;
            else if (bbox) x = (bbox.left + bbox.right) / 2 - br.width / 2;
            y = clusterTop - br.height - varToPx('--ws-cb-cluster-margin');
            if (x === undefined || y < 8) {
                if (bbox) { x = (bbox.left + bbox.right) / 2 - br.width / 2; y = bbox.bottom + 10; }
                else { x = (window.innerWidth - br.width) / 2; y = 8; }
            }
        } else if (top && isWingsOpen()) {
            x = top.cx - br.width / 2;
            y = top.top - br.height - varToPx('--ws-cb-cluster-margin');
            if (y < 8) {
                const bbox = getOrbsBoundingBox();
                if (bbox) { x = (bbox.left + bbox.right) / 2 - br.width / 2; y = bbox.bottom + 10; }
                else y = 8;
            }
        } else {
            const _el = getLauncherEl();
            if (_el) {
                const lr = _el.getBoundingClientRect();
                x = lr.left + lr.width / 2 - br.width / 2;
                y = lr.bottom + 10;
                if (y + br.height > window.innerHeight - 8) y = lr.top - br.height - 10;
            }
        }
    }

    // 4) 兜底：居中靠上
    if (x === undefined) {
        x = (window.innerWidth - br.width) / 2;
        y = 80;
    }

    const p = clampPos(x, y, br.width, br.height);
    _bar.style.left = p.x + 'px';
    _bar.style.top = p.y + 'px';

    // 5) 避免与悬浮球重叠
    const _le = getLauncherEl?.();
    if (_le) {
        const lr = _le.getBoundingClientRect();
        const bRect = _bar.getBoundingClientRect();
        const pad = 8;
        const overlaps = !(bRect.right + pad < lr.left || bRect.left - pad > lr.right || bRect.bottom + pad < lr.top || bRect.top - pad > lr.bottom);
        if (overlaps) {
            const ny = lr.top > bRect.top ? lr.bottom + pad : lr.top - br.height - pad;
            _bar.style.top = clampPos(p.x, ny, br.width, br.height).y + 'px';
        }
    }
}

// 主题子菜单：构建委托给 color-bar-ui.js，本函数负责定位与状态
function openThemeMenu(anchorBtn) {
    if (_themeMenu) { closeThemeMenu(); return; }
    const menu = buildThemeMenu(anchorBtn, closeThemeMenu, () => openThemeMenu(anchorBtn), getOrient);
    document.body.appendChild(menu);

    // 定位：与 ColorBar 主体对齐居中
    const r = (_bar || anchorBtn).getBoundingClientRect();
    const mR = menu.getBoundingClientRect();
    let mx, my;
    if (getOrient() === 'v') {
        mx = r.left - mR.width - 10;
        if (mx < 8) mx = r.right + 10;
        my = r.top + r.height / 2 - mR.height / 2;
    } else {
        mx = r.left + r.width / 2 - mR.width / 2;
        my = r.top - mR.height - 10;
        if (my < 8) my = r.bottom + 10;
    }
    mx = Math.max(8, Math.min(mx, window.innerWidth - mR.width - 8));
    my = Math.max(8, Math.min(my, window.innerHeight - mR.height - 8));
    menu.style.left = mx + 'px';
    menu.style.top = my + 'px';
    _themeMenu = menu;
}

// ── 工具条主体 ────────────────────────────────────────────
async function openBar() {
    if (_bar) return;
    await _ensureColorTabBuilders();
    initStore();
    callLauncherSkin();
    const orient = getOrient();

    const bar = document.createElement('div');
    bar.setAttribute('data-wosai-panel', '');
    bar.setAttribute('data-theme', getBarTheme());
    bar.dataset.wsModule = ['color', 'align', 'node'].includes(_hudTab) ? _hudTab : 'color';
    applyGlassBar(bar, orient);
    bar.onpointerdown = e => e.stopPropagation();

    if (_hudTab === 'color') {
        const children = buildColorTabContent(orient, bar, { openThemeMenu, closeBar });
        children.forEach(el => bar.appendChild(el));
    } else {
        // 非配色 tab（对齐/节点/检索…）：由各模块经 hud-kit 注册表注入内容
        const build = getHudBuilder(_hudTab);
        (build ? build(orient) : []).forEach(el => bar.appendChild(el));
    }

    document.body.appendChild(bar);
    _bar = bar;
    // 弹出 HUD 前先隐藏选中节点上方的操作栏，避免两者互相遮挡。
    _hubBarMod?.hideMiniBarForPopup?.();
    applyHudModuleTheme(bar, _hudTab);
    positionBar();
    _barDragCleanup = makeDraggable(bar, {
        handle: bar,
        onDragStart: () => { bar.dataset.wosaiManualPosition = "true"; },
        onDragEnd: () => { bar.dataset.wosaiManualPosition = "true"; },
    });
    _barFollowCleanup = registerSelectionFollower(bar, {
        placement: "above",
        gap: varToPx('--ws-cb-node-margin') || 10,
        nudgeY: HUD_TOOLBAR_NUDGE,
    });
    requestAnimationFrame(() => { bar.style.opacity = '1'; bar.style.transform = 'scale(1)'; });

    // Esc 关闭
    _escHandler = (e) => { if (e.key === 'Escape') closeBar(); };
    document.addEventListener('keydown', _escHandler);

    // 共享 RAF 跟随器负责选区、缩放和平移；画布空白点击仍关闭工具栏。
    const cv = app.canvas?.canvas;
    if (cv) {
        _canvasClickHandler = (e) => {
            if (e.target.closest?.('[data-node-id]')) return;
            if (e.target.closest?.('[data-wosai-panel]')) return;
            closeBar();
        };
        cv.addEventListener('pointerdown', _canvasClickHandler, true);
    }
}

// 注册 WOSAI ColorBar 配色悬浮条扩展
app.registerExtension({
    name: "WOSAI.ColorBar",
    settings: [],
    afterConfigureGraph() {
        if (!_runtimeActive) return;
        if (_launcherDelayTimer) clearTimeout(_launcherDelayTimer);
        _launcherDelayTimer = setTimeout(() => {
            _launcherDelayTimer = null;
            if (_runtimeActive) showLauncherWhenReady();
        }, LAUNCHER_DELAY_MS);
    },

    async setup() {
        const generation = ++_runtimeGeneration;
        _runtimeActive = true;
        const isCurrent = () => _runtimeActive && generation === _runtimeGeneration;
        window.__wosaiCloseBar = closeBar;
        window.__wosaiOpenHud = openHud;

        // 预加载 ColorBar UI 构建器（内部会 await palettesPromise/themesPromise）
        await _ensureColorTabBuilders();
        if (!isCurrent()) return;

        // 与扩展入口使用同一模块 URL，避免动态导入产生第二个 HUB 实例。
        const hubBarMod = await import("./hub-bar.js");
        if (!isCurrent()) return;
        _hubBarMod = hubBarMod;
        _hubBarMod.createHubBar();

        setLauncherContext({
            openTab: (mode) => { openHud(mode); },
            closeHud: () => { closeBar(); },
            repositionHud: () => { if (_bar) positionBar(); },
        });

        _showTimer = setTimeout(() => {
            _showTimer = null;
            if (isCurrent()) showLauncherWhenReady(0);
        }, 12000);
        initStore();
        _openHudHandler = openHud;
        onHudOpenRequest(_openHudHandler);
        registerHudTab({ id: 'avatar', label: t('menus.colorBar.avatar'), order: 8, panel: openAvatarPanel });

        _offGlassChange = onGlassChange(() => {
            callLauncherSkin();
            refreshBarSkin();
        });

        // 语言切换：若 color bar 已打开，关闭后重新打开以更新文字
        _offLangChange = onLangChange(() => {
            if (_bar) {
                const wasTab = _hudTab;
                closeBar({ keepHidden: true });
                _hudTab = wasTab;
                scheduleBarOpen();
            }
        });

        // Hold 模式
        const isEditable = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
        _keyDownHandler = (e) => {
            if (e.key !== '`' || e.repeat) return;
            if (!getSetting(SETTING_HOLD, false)) return;
            if (isEditable(e.target)) return;
            e.preventDefault(); e.stopPropagation();
            if (!_holdActive) {
                _holdActive = true;
                if (!_bar) { _hudTab = 'color'; openBar(); }
                else if (_hudTab !== 'color') { _hudTab = 'color'; closeBar(); scheduleBarOpen(); }
            }
        };
        _keyUpHandler = (e) => {
            if (e.key !== '`' || !_holdActive) return;
            _holdActive = false;
            const item = _hoverItem;
            _hoverItem = null;
            if (item) item.click();
            if (_bar && !_themeMenu) closeBar();
        };
        window.addEventListener('keydown', _keyDownHandler, true);
        window.addEventListener('keyup', _keyUpHandler, true);
    },

    remove() {
        _runtimeActive = false;
        _runtimeGeneration += 1;
        closeBar();
        removeLauncher();
        if (_hubBarMod) { _hubBarMod.removeHubBar(); _hubBarMod = null; }
        setLauncherSkinFn(null);
        if (window.__wosaiCloseBar === closeBar) delete window.__wosaiCloseBar;
        if (window.__wosaiOpenHud === openHud) delete window.__wosaiOpenHud;
        if (_keyDownHandler) { window.removeEventListener('keydown', _keyDownHandler, true); _keyDownHandler = null; }
        if (_keyUpHandler) { window.removeEventListener('keyup', _keyUpHandler, true); _keyUpHandler = null; }
        if (_offGlassChange) { _offGlassChange(); _offGlassChange = null; }
        if (_offLangChange) { _offLangChange(); _offLangChange = null; }
        if (_showTimer) { clearTimeout(_showTimer); _showTimer = null; }
        if (_launcherDelayTimer) { clearTimeout(_launcherDelayTimer); _launcherDelayTimer = null; }
        if (_reopenTimer) { clearTimeout(_reopenTimer); _reopenTimer = null; }
        if (_openHudHandler) { offHudOpenRequest(_openHudHandler); _openHudHandler = null; }
        unregisterHudTab('avatar');
    },

    commands: [{
        id: "wosai-color-bar",
        label: t('menus.colorBar.title'),
        function: () => { if (getSetting(SETTING_HOLD, false)) return; openHud('color'); },
    }],

    keybindings: [{
        combo: { key: "`" },
        commandId: "wosai-color-bar",
    }],
});
