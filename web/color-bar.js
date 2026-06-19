// ========== WOSAI ColorBar — 快捷上色 HUD ==========
// 常驻悬浮球（可拖拽，位置记忆）→ 点击滑动展开工具条；支持横版/竖版切换。
// 快捷键 ` 同样可开关（可在 Keybindings 中改键）。

import { app } from "../../../scripts/app.js";
import { SOLID_PRESETS, applySolidHex, randomHSV, hsv2hex } from "./lib/color-core.js";
import { store, initStore, addRecent, persist } from "./lib/color-store.js";
import {
    THEME_STYLES, applyTheme,
    getSelectedStyleId, setSelectedStyleId,
} from "./lib/color-theme.js";
import { openNodeColorPicker, refreshAllVisuals } from "./node-color.js";
import { showTip, hideTip } from "./lib/tooltip.js";
import {
    glassT as barT, getGlassTheme as getBarTheme, getGlassMode as getBarMode,
    cycleGlassMode, onGlassChange, GLASS_MODE_DEFS,
} from "./lib/glass-theme.js";

let _bar = null;          // 工具条
let _launcher = null;     // 常驻悬浮球
let _themeMenu = null;    // 主题子菜单
let _escHandler = null;
let _resizeHandler = null;
let _holdActive = false;  // Hold 模式：` 按住中
let _hoverItem = null;    // 当前悬停的工具条条目（Hold 松开时执行）
let _keyDownHandler = null, _keyUpHandler = null;
let _launcher_skin = null; // 悬浮球内芯换肤回调（深浅切换时调用）
let _offGlassChange = null;   // onGlassChange 退订函数（remove 时清理）
let _canvasReady = false;
let _launcherTimer = null;

// ── ComfyUI 原生 Settings ────────────────────────────────
const SETTING_LAUNCHER = 'WOSAI.ColorBar.ShowLauncher';
const SETTING_HOLD = 'WOSAI.ColorBar.HoldMode';
function getSetting(id, dflt) {
    try {
        const v = app.ui?.settings?.getSettingValue?.(id);
        return (v === undefined || v === null) ? dflt : v;
    } catch (e) { return dflt; }
}

// ── 持久化（悬浮球位置 / 布局方向） ──────────────────────
const LS_POS = 'wosai-colorbar-pos';
const LS_ORIENT = 'wosai-colorbar-orient';
const BALL = 44;    // 悬浮球直径

function getOrient() { return localStorage.getItem(LS_ORIENT) === 'v' ? 'v' : 'h'; }
function setOrient(o) { try { localStorage.setItem(LS_ORIENT, o); } catch (e) {} }

// 玻璃主题（token / 三态 / 画布亮度检测）已提取为全插件标准：lib/glass-theme.js
// 本文件通过顶部 import 以 barT/getBarTheme/getBarMode 等别名使用。

function clampPos(x, y, w, h) {
    return {
        x: Math.max(6, Math.min(x, window.innerWidth - (w || BALL) - 6)),
        y: Math.max(6, Math.min(y, window.innerHeight - (h || BALL) - 6)),
    };
}
function getLauncherPos() {
    try {
        const p = JSON.parse(localStorage.getItem(LS_POS));
        if (p && isFinite(p.x) && isFinite(p.y)) return clampPos(p.x, p.y);
    } catch (e) {}
    return { x: window.innerWidth - BALL - 24, y: Math.round(window.innerHeight * 0.32) };
}
function saveLauncherPos(p) { try { localStorage.setItem(LS_POS, JSON.stringify(p)); } catch (e) {} }

function selectedNodes() {
    const sel = app.canvas?.selected_nodes;
    return sel ? Object.values(sel) : [];
}

// 选中的分组（多路兼容：selectedItems / _groups.selected / selected_group）
function isGroupObj(it) {
    if (!it) return false;
    try { if (typeof LGraphGroup !== 'undefined' && it instanceof LGraphGroup) return true; } catch (e) {}
    if (typeof it.recomputeInsideNodes === 'function') return true;
    return it.constructor?.name === 'LGraphGroup';
}
function selectedGroups() {
    const out = new Set();
    // 路径 1：新版 selectedItems（Set，含节点+分组+reroute）
    const items = app.canvas?.selectedItems;
    if (items && typeof items.forEach === 'function') {
        items.forEach(it => { if (isGroupObj(it)) out.add(it); });
    }
    // 路径 2：分组对象自身的选中标志
    const groups = app.graph?._groups || app.graph?.groups || [];
    for (const g of groups) {
        if (g.selected || g._selected) out.add(g);
    }
    // 路径 3：画布最近交互的分组（部分版本点击分组标题只记录在这里）
    const sg = app.canvas?.selected_group;
    if (out.size === 0 && sg && isGroupObj(sg) && groups.includes(sg)) out.add(sg);
    return [...out];
}

function flash(el, msg) {
    hideTip();   // 先隐藏悬停提示，避免与气泡重叠
    const T = barT();
    const tip = document.createElement('div');
    tip.textContent = msg;
    tip.style.cssText = `position:fixed;padding:4px 10px;background:${T.glass};backdrop-filter:${T.blur};-webkit-backdrop-filter:${T.blur};color:${T.text};font-size:12px;border-radius:6px;z-index:100002;pointer-events:none;white-space:nowrap;transform:translateX(-50%);border:${T.border}`;
    const r = el.getBoundingClientRect();
    tip.style.left = (r.left + r.width / 2) + 'px';
    tip.style.top = (r.top - 30) + 'px';
    document.body.appendChild(tip);
    setTimeout(() => tip.remove(), 1200);
}

// 悬停提示改用共享 lib/tooltip.js（showTip / hideTip 顶部已导入）

function closeThemeMenu() {
    if (_themeMenu) { _themeMenu.remove(); _themeMenu = null; }
}

function closeBar() {
    closeThemeMenu();
    if (_bar) {
        const bar = _bar; _bar = null;
        // 滑动收起动画
        bar.style.opacity = '0';
        bar.style.transform = 'scale(.92)';
        setTimeout(() => bar.remove(), 160);
    }
    if (_escHandler) { document.removeEventListener('keydown', _escHandler); _escHandler = null; }
}

function toggleBar() { _bar ? closeBar() : openBar(); }

// ── 线性图标（Tabler/Lucide 风格，MIT/ISC 同风格自绘，stroke=currentColor 随主题变色）──
// 默认放大到 27（原 24）；描边 1.6（原 2）更纤细
const _icon = (inner, size = 27) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
// 统一单色线性：全部图标轮廓 + 填充点均随主题色 currentColor(=--ws-text)，不再内嵌多彩，
//   消除「每个图标各用各色」的杂乱感；强调色仅在 hover/激活态体现（mkItem 的 brightness/scale）。
const ICONS = {
    picker: _icon('<path d="M11 7l6 6"/><path d="M4 16L15.7 4.3a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4L8 20H4v-4z"/>'),
    // 「换一组预设」单独保留双色（绿/蓝），作为整套单色图标里的视觉焦点；放大到 32（含中心组号数字）
    refresh: _icon('<path stroke="#1D9E75" d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4"/><path stroke="#378ADD" d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>', 32),
    dice: _icon('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/>'),
    eraser: _icon('<path d="M19 20H8.5l-4.2-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4L13 18"/><path d="M18 13.3L11.7 7"/>'),
    palette: _icon('<path d="M12 21a9 9 0 1 1 0-18c5 0 9 3.6 9 8 0 1.1-.5 2.1-1.3 2.8-.8.8-2 1.2-3.2 1.2h-2.5a2 2 0 0 0-1 3.75A1.3 1.3 0 0 1 12 21z"/><circle cx="8.5" cy="10.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="7.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10.5" r="1.2" fill="currentColor" stroke="none"/>'),
    rainbow: _icon('<path d="M22 17a10 10 0 0 0-20 0"/><path d="M18 17a6 6 0 0 0-12 0"/><path d="M14 17a2 2 0 0 0-4 0"/>'),
    switchV: _icon('<path d="M3 8l4-4 4 4"/><path d="M7 4v9"/><path d="M13 16l4 4 4-4"/><path d="M17 10v10"/>'),
    switchH: _icon('<path d="M16 3l4 4-4 4"/><path d="M10 7h10"/><path d="M8 13l-4 4 4 4"/><path d="M4 17h10"/>'),
    sun: _icon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>'),
    moon: _icon('<path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/>'),
    // 自动（半填充对比圆：跟随画布亮度）
    auto: _icon('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>'),
};

// ── 条目构件：上视觉元素 + 下中文小字 ─────────────────────
function mkItem(visualEl, label, tip) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;user-select:none;flex-shrink:0';
    wrap.appendChild(visualEl);
    let lblEl = null;
    if (label) {
        lblEl = document.createElement('div');
        lblEl.textContent = label;
        lblEl.style.cssText = `font-size:12px;line-height:1;color:${barT().text};white-space:nowrap;letter-spacing:.5px;transition:color .15s`;
        wrap.appendChild(lblEl);
    }
    wrap.onmousedown = e => e.preventDefault();
    // 悬停提示用自定义 tooltip（条目上方居中），不用原生 title；_tip 可被外部更新
    wrap._tip = tip || '';
    // 图标类条目(含 svg)：悬停点亮品牌橙(方案 A)，文字同步变橙；色块(chip)保持原 brightness 效果
    const _isIcon = () => !!visualEl.querySelector && !!visualEl.querySelector('svg');
    wrap.onmouseenter = () => {
        visualEl.style.transform = 'scale(1.1)';
        if (_isIcon()) {
            visualEl.dataset.baseColor = visualEl.style.color; visualEl.style.color = barT().iconAccent;
            if (lblEl) lblEl.style.color = barT().iconAccent;
        }
        else visualEl.style.filter = 'brightness(1.4)';
        _hoverItem = wrap; if (wrap._tip) showTip(wrap, wrap._tip);
    };
    wrap.onmouseleave = () => {
        visualEl.style.transform = ''; visualEl.style.filter = '';
        if (_isIcon()) { visualEl.style.color = visualEl.dataset.baseColor || barT().iconColor; if (lblEl) lblEl.style.color = barT().text; }
        if (_hoverItem === wrap) _hoverItem = null; hideTip();
    };
    return wrap;
}

// 功能按钮（深色圆底 + 多彩线性 SVG 图标 + 下方中文标签）
function mkBtn(iconSvg, tip, label) {
    const T = barT();
    const b = document.createElement('div');
    b.innerHTML = iconSvg;
    b.style.cssText = `width:38px;height:38px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:${T.btnBg};color:${T.iconColor};transition:color .15s,filter .15s,transform .12s;pointer-events:none`;
    return mkItem(b, label, tip);
}

// 圆形色块（颜色 + 中文名）
function mkChip(hex, tip, label) {
    const c = document.createElement('div');
    c.style.cssText = `width:34px;height:34px;border-radius:50%;background:${hex};border:2px solid ${barT().chipRing};transition:transform .12s,filter .15s;pointer-events:none;box-sizing:border-box`;
    return mkItem(c, label, tip || hex);
}

function mkDivider(orient) {
    const d = document.createElement('div');
    // align-self:center：相对条目（图标+文字）整体居中
    d.style.cssText = orient === 'v'
        ? `height:1px;width:28px;background:${barT().divider};flex-shrink:0;margin:4px 0;align-self:center`
        : `width:1px;height:34px;background:${barT().divider};flex-shrink:0;margin:0 5px;align-self:center`;
    return d;
}

// 对选中节点/分组上纯色（带空选中提示）
function paintSelected(hex, anchorEl) {
    const nodes = selectedNodes();
    const groups = selectedGroups();
    if (!nodes.length && !groups.length) { flash(anchorEl, '请先选中节点或分组'); return; }
    if (nodes.length) applySolidHex(nodes, hex);
    groups.forEach(g => { g.color = hex; });
    refreshAllVisuals();
}

// ── 主题子菜单 ────────────────────────────────────────────
function randomHueAvoidRed() {
    // 生成随机色相，自动避开红色范围（0°~30° 和 330°~360°）
    const safeRanges = [[30, 330]];  // 从 30° 到 330° 的安全区间
    const range = safeRanges[0];
    const h = range[0] + Math.floor(Math.random() * (range[1] - range[0]));
    return { h, s: 60 + Math.floor(Math.random() * 31), v: 45 + Math.floor(Math.random() * 36) };
}

function openThemeMenu(anchorBtn) {
    if (_themeMenu) { closeThemeMenu(); return; }
    const T = barT();
    const menu = document.createElement('div');
    menu.setAttribute('data-wosai-panel', '');
    menu.setAttribute('data-theme', getBarTheme());
    menu.style.cssText = `position:fixed;z-index:100002;display:flex;flex-direction:column;gap:6px;padding:12px;border-radius:12px;background:${T.glass};backdrop-filter:${T.blur};-webkit-backdrop-filter:${T.blur};border:${T.border};box-shadow:${T.shadow};white-space:nowrap;width:max-content`;

    const curId = getSelectedStyleId();
    const mkStyleRow = ([id, style]) => {
        const row = document.createElement('div');
        row.style.cssText = `display:flex;align-items:center;justify-content:center;gap:10px;padding:7px 10px;border-radius:10px;cursor:pointer;font-size:13px;color:${T.text};background:${id === curId ? T.rowHover : 'transparent'}`;
        row.onmouseenter = () => row.style.background = T.rowHover;
        row.onmouseleave = () => row.style.background = id === getSelectedStyleId() ? T.rowHover : 'transparent';

        const strip = document.createElement('div');
        const colors = ['model', 'sample', 'prompt', 'output'].map(cat => style.colors[cat]);
        strip.style.cssText = `width:40px;height:12px;border-radius:6px;flex-shrink:0;background:linear-gradient(90deg, ${colors.join(', ')})`;
        row.appendChild(strip);

        const lbl = document.createElement('span');
        lbl.textContent = style.label;
        lbl.style.cssText = `color:${T.textMuted}`;
        row.appendChild(lbl);

        row.onclick = () => {
            // 范围：选中分组 → 分组框+组内节点；选中节点 → 仅这些节点；无选中 → 全图
            const selN = selectedNodes();
            const selG = selectedGroups();
            let stats;
            if (selN.length || selG.length) {
                const nodeSet = new Set(selN);
                selG.forEach(g => {
                    try { g.recomputeInsideNodes?.(); } catch (e) {}
                    (g._nodes || g.nodes || []).forEach(n => nodeSet.add(n));
                });
                stats = applyTheme(id, [...nodeSet], selG);
            } else {
                stats = applyTheme(id);
            }
            setSelectedStyleId(id);
            refreshAllVisuals();
            if (stats) {
                const total = Object.values(stats).reduce((a, b) => a + b, 0);
                const scope = (selN.length || selG.length) ? '' : '全图';
                flash(anchorBtn, `已应用「${style.label}」${scope}：${total} 个节点（可撤销）`);
            } else {
                flash(anchorBtn, (selN.length || selG.length) ? '所选分组内没有节点' : '画布上还没有节点');
            }
            // 菜单保持打开，方便连续试不同配色；原地重建以更新选中态和撤销行
            closeThemeMenu();
            openThemeMenu(anchorBtn);
        };
        return row;
    };

    // ── 标题行：居中标题「按节点类型快速上色」+ 右侧 🎲 随机按钮（自动避开红色）──
    const titleRow = document.createElement('div');
    titleRow.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:0 0 4px;`;
    // 左侧占位，使标题居中
    const leftSpacer = document.createElement('span');
    leftSpacer.style.cssText = 'width:28px;flex-shrink:0';
    const titleText = document.createElement('span');
    titleText.textContent = '按节点类型快速上色';
    titleText.style.cssText = `font-size:13px;color:${T.text};font-weight:600;letter-spacing:.3px;text-align:center;flex:1`;
    const randBtn = document.createElement('span');
    randBtn.textContent = '🎲';
    randBtn.style.cssText = `width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:16px;cursor:pointer;flex-shrink:0;transition:background var(--ws-transition, .15s),transform .12s;user-select:none;line-height:1`;
    // 即时提示（替代原生 title，无 ~0.5s 延迟）
    randBtn.onmouseenter = () => { randBtn.style.background = T.rowHover; randBtn.style.transform = 'scale(1.15)'; showTip(randBtn, '随机配色'); };
    randBtn.onmouseleave = () => { randBtn.style.background = 'transparent'; randBtn.style.transform = ''; hideTip(); };
    randBtn.onclick = () => {
        const selN = selectedNodes();
        const selG = selectedGroups();
        let targets = [];
        if (selN.length || selG.length) {
            const nodeSet = new Set(selN);
            selG.forEach(g => {
                try { g.recomputeInsideNodes?.(); } catch (e) {}
                (g._nodes || g.nodes || []).forEach(n => nodeSet.add(n));
            });
            targets = [...nodeSet];
            selG.forEach(g => { const rc = randomHueAvoidRed(); g.color = hsv2hex(rc.h, rc.s, rc.v); });
        } else {
            targets = app.graph?._nodes || [];
        }
        targets.forEach(n => { const rc = randomHueAvoidRed(); applySolidHex([n], hsv2hex(rc.h, rc.s, rc.v)); });
        refreshAllVisuals();
        flash(randBtn, targets.length ? `随机色已应用（避开红色）` : '画布上还没有节点');
    };
    titleRow.appendChild(leftSpacer);
    titleRow.appendChild(titleText);
    titleRow.appendChild(randBtn);
    menu.appendChild(titleRow);

    // 两类分组渲染：纯色 / 渐变
    const horizontal = getOrient() !== 'v';
    [{ key: 'solid', label: '纯色 Solid' }, { key: 'grad', label: '渐变 Gradient' }].forEach((grp, gi) => {
        const head = document.createElement('div');
        head.style.cssText = `display:flex;align-items:center;gap:10px;padding:${gi ? '10px' : '4px'} 0 4px;`;
        const lineL = document.createElement('span');
        lineL.style.cssText = `flex:1;height:1px;background:linear-gradient(90deg,transparent,${T.divider})`;
        const txt = document.createElement('span');
        txt.textContent = grp.label;
        txt.style.cssText = `font-size:12px;color:${T.textMuted};letter-spacing:1px;white-space:nowrap;font-weight:500`;
        const lineR = document.createElement('span');
        lineR.style.cssText = `flex:1;height:1px;background:linear-gradient(90deg,${T.divider},transparent)`;
        head.appendChild(lineL);
        head.appendChild(txt);
        head.appendChild(lineR);
        menu.appendChild(head);
        const wrap = document.createElement('div');
        wrap.style.cssText = horizontal
            ? 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px 14px;justify-items:start'
            : 'display:flex;flex-direction:column;gap:6px';
        Object.entries(THEME_STYLES)
            .filter(([, s]) => (s.group || 'solid') === grp.key)
            .forEach(entry => wrap.appendChild(mkStyleRow(entry)));
        menu.appendChild(wrap);
    });

    const footerRow = document.createElement('div');
    footerRow.style.cssText = 'display:flex;justify-content:center;gap:10px;margin-top:8px';

    const clearBtn = document.createElement('div');
    clearBtn.textContent = '清除';
    clearBtn.style.cssText = `min-width:56px;height:30px;padding:0 14px;display:flex;align-items:center;justify-content:center;border-radius:15px;cursor:pointer;font-size:12px;background:${T.btnBg};color:${T.text};transition:filter .15s,transform .12s;user-select:none`;
    clearBtn.onmouseenter = () => { clearBtn.style.filter = 'brightness(1.4)'; clearBtn.style.transform = 'scale(1.1)'; showTip(clearBtn, '清除全图节点与分组框颜色'); };
    clearBtn.onmouseleave = () => { clearBtn.style.filter = ''; clearBtn.style.transform = ''; hideTip(); };
    clearBtn.onclick = () => {
        const g = app.graph;
        if (g?._nodes) {
            g._nodes.forEach(n => {
                n.color = void 0;
                n.bgcolor = void 0;
                delete n._gradient;
                delete n._titleStyle;
                delete n.constructor.title_text_color;
            });
        }
        // 分组框同步清除（节点与分组始终同步生效）
        (g?._groups || g?.groups || []).forEach(grp => { grp.color = void 0; });
        refreshAllVisuals();
        flash(anchorBtn, '已清除');
        closeThemeMenu();
        openThemeMenu(anchorBtn);
    };
    footerRow.appendChild(clearBtn);

    const confirmBtn = document.createElement('div');
    confirmBtn.textContent = '确认';
    confirmBtn.style.cssText = `min-width:56px;height:30px;padding:0 14px;display:flex;align-items:center;justify-content:center;border-radius:15px;cursor:pointer;font-size:12px;background:${T.btnBg};color:${T.text};transition:background .15s,color .15s,transform .12s;user-select:none`;
    // 默认不高亮，悬停时才显示主题色
    confirmBtn.onmouseenter = () => { confirmBtn.style.background = 'var(--ws-accent,#DD6F4A)'; confirmBtn.style.color = '#fff'; confirmBtn.style.transform = 'scale(1.05)'; showTip(confirmBtn, '确认并关闭'); };
    confirmBtn.onmouseleave = () => { confirmBtn.style.background = T.btnBg; confirmBtn.style.color = T.text; confirmBtn.style.transform = ''; hideTip(); };
    confirmBtn.onclick = () => { closeThemeMenu(); };
    footerRow.appendChild(confirmBtn);

    menu.appendChild(footerRow);

    document.body.appendChild(menu);
    // 定位：与 ColorBar 主体对齐居中
    //   竖版：菜单在工具条左/右侧，垂直中心对齐工具条
    //   横版：菜单在工具条上/下方，水平中心对齐工具条
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

// ── 工具条定位（悬浮球不被遮挡）──────────────────────────
// 横版：工具条在球正下方水平居中 → 球显示在工具条上方居中
// 竖版：工具条在球左/右侧垂直居中 → 球显示在工具条左/右侧居中
function positionBar() {
    if (!_bar || !_launcher) return;
    const lr = _launcher.getBoundingClientRect();
    const br = _bar.getBoundingClientRect();
    let x, y;
    if (getOrient() === 'v') {
        // 竖版：优先放球左侧（球常在右缘），放不下放右侧；垂直居中对齐球
        x = lr.left - br.width - 10;
        if (x < 8) x = lr.right + 10;
        y = lr.top + lr.height / 2 - br.height / 2;
    } else {
        // 横版：水平居中对齐球；优先放球下方，底部放不下放上方
        x = lr.left + lr.width / 2 - br.width / 2;
        y = lr.bottom + 10;
        if (y + br.height > window.innerHeight - 8) y = lr.top - br.height - 10;
    }
    const p = clampPos(x, y, br.width, br.height);
    _bar.style.left = p.x + 'px';
    _bar.style.top = p.y + 'px';
}

// ── 工具条主体 ────────────────────────────────────────────
function openBar() {
    if (_bar) return;
    initStore();
    if (_launcher_skin) _launcher_skin();   // auto 模式下画布亮度可能已变，球芯随开随刷
    const orient = getOrient();

    const T = barT();
    const bar = document.createElement('div');
    bar.setAttribute('data-wosai-panel', '');
    bar.setAttribute('data-theme', getBarTheme());
    bar.style.cssText = `position:fixed;z-index:100001;display:flex;flex-direction:${orient === 'v' ? 'column' : 'row'};align-items:center;gap:${orient === 'v' ? '10px' : '8px'};padding:${orient === 'v' ? '10px 10px' : '8px 14px'};border-radius:999px;background:${T.glass};backdrop-filter:${T.blur};-webkit-backdrop-filter:${T.blur};border:${T.border};box-shadow:${T.shadow};opacity:0;transform:scale(.92);transition:opacity .18s ease,transform .18s ease;max-height:${window.innerHeight - 20}px;overflow:auto`;
    bar.onpointerdown = e => e.stopPropagation();

    // ── 预设色：4 组 × 6 色，「换组」按钮循环切换（记忆当前组）──
    const PRESET_GROUPS = [
        { name: '经典', colors: [
            { n: '橙色', h: '#D35400' }, { n: '金色', h: '#D4AC0D' }, { n: '绿色', h: '#1E8449' },
            { n: '蓝色', h: '#2471A3' }, { n: '紫色', h: '#6C3483' }, { n: '炭黑', h: '#2C3E50' },
        ]},
        { name: '浓郁', colors: [
            { n: '红色', h: '#C0392B' }, { n: '棕色', h: '#A0522D' }, { n: '深青', h: '#117A65' },
            { n: '深蓝', h: '#1A5276' }, { n: '粉红', h: '#E91E63' }, { n: '灰色', h: '#4A4A4A' },
        ]},
        { name: '柔和', colors: [
            { n: '雾蓝', h: '#587E9C' }, { n: '紫灰', h: '#7B6FA8' }, { n: '沙金', h: '#A8824E' },
            { n: '灰绿', h: '#5E9A72' }, { n: '青灰', h: '#5E8B84' }, { n: '蓝灰', h: '#6F76A8' },
        ]},
        { name: '鲜亮', colors: [
            { n: '宝蓝', h: '#2D6FD0' }, { n: '亮紫', h: '#9D4EDD' }, { n: '橙黄', h: '#E8920A' },
            { n: '翠绿', h: '#23A85E' }, { n: '青蓝', h: '#0FB5C9' }, { n: '柠黄', h: '#D4B012' },
        ]},
    ];
    const LS_PRESET_GROUP = 'wosai-colorbar-preset-group';
    let presetGroupIdx = parseInt(localStorage.getItem(LS_PRESET_GROUP)) || 0;
    if (presetGroupIdx < 0 || presetGroupIdx >= PRESET_GROUPS.length) presetGroupIdx = 0;

    const presetWrap = document.createElement('div');
    presetWrap.style.cssText = orient === 'v'
        ? 'display:flex;flex-direction:column;gap:10px;align-items:center'
        : 'display:flex;flex-direction:row;gap:8px;align-items:center';
    const renderPresetChips = () => {
        presetWrap.innerHTML = '';
        PRESET_GROUPS[presetGroupIdx].colors.forEach(p => {
            const chip = mkChip(p.h, `${p.n} ${p.h.toUpperCase()}`);
            chip.onclick = () => paintSelected(p.h, chip);
            presetWrap.appendChild(chip);
        });
    };
    renderPresetChips();
    bar.appendChild(presetWrap);

    // 换一组预设色
    const swapBtn = mkBtn(ICONS.refresh, '换一组预设', '');
    // 在刷新图标中心叠加「当前第几组」数字（1-based，共 PRESET_GROUPS.length 组）
    const swapIcon = swapBtn.firstChild;            // mkBtn 的 38px 圆底
    swapIcon.style.position = 'relative';
    const groupNum = document.createElement('div');
    groupNum.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:10px;font-weight:400;line-height:1;color:currentColor;pointer-events:none;text-shadow:0 0 2px rgba(0,0,0,.6)';
    swapIcon.appendChild(groupNum);
    const updateGroupNum = () => { groupNum.textContent = String(presetGroupIdx + 1); };
    updateGroupNum();
    swapBtn._tip = `当前组：${PRESET_GROUPS[presetGroupIdx].name}配色`;
    swapBtn.onclick = () => {
        presetGroupIdx = (presetGroupIdx + 1) % PRESET_GROUPS.length;
        try { localStorage.setItem(LS_PRESET_GROUP, String(presetGroupIdx)); } catch (e) {}
        renderPresetChips();
        updateGroupNum();
        swapBtn._tip = `当前组：${PRESET_GROUPS[presetGroupIdx].name}配色`;
        flash(swapBtn, `当前组：${PRESET_GROUPS[presetGroupIdx].name}配色`);
    };
    bar.appendChild(swapBtn);

    // 预设色 与 取色区 之间的分隔
    bar.appendChild(mkDivider(orient));

    // ── 拾色器 + 最近取色（最多 3 个，最新在前）──
    const recentWrap = document.createElement('div');
    recentWrap.style.cssText = orient === 'v'
        ? 'display:flex;flex-direction:column;gap:12px;align-items:center'
        : 'display:flex;flex-direction:row;gap:10px;align-items:center';
    const renderRecentChips = () => {
        recentWrap.innerHTML = '';
        store.recent.slice(0, 3).forEach((p, idx) => {
            const chip = mkChip(p.hex, p.hex.toUpperCase());
            chip.style.position = 'relative';
            chip.onclick = () => paintSelected(p.hex, chip);
            // 悬停显示 ×，可删除该条历史
            const del = document.createElement('span');
            del.textContent = '×';
            del.title = '删除此取色记录';
            del.style.cssText = `position:absolute;top:-7px;right:-7px;width:15px;height:15px;line-height:13px;text-align:center;border-radius:50%;background:${getBarTheme()==='light'?'#E8E8EC':'#2a2a2e'};color:${T.text};font-size:11px;cursor:pointer;display:none;border:1px solid ${T.divider};box-sizing:border-box;z-index:1`;
            del.onclick = (e) => {
                e.stopPropagation();
                store.recent.splice(idx, 1);
                persist();
                renderRecentChips();
            };
            const origEnter = chip.onmouseenter, origLeave = chip.onmouseleave;
            chip.onmouseenter = () => { origEnter && origEnter(); del.style.display = 'block'; };
            chip.onmouseleave = () => { origLeave && origLeave(); del.style.display = 'none'; };
            chip.appendChild(del);
            recentWrap.appendChild(chip);
        });
        recentWrap.style.display = store.recent.length ? 'flex' : 'none';
    };
    renderRecentChips();
    bar.appendChild(recentWrap);

    // ── 功能按钮（创建后统一按既定顺序挂载）──────────────────
    // 取色
    const pickBtn = mkBtn(ICONS.picker, '屏幕取色并应用', '取色');
    if (window.EyeDropper) {
        pickBtn.onclick = async () => {
            try {
                const r = await new window.EyeDropper().open();
                const hex = r.sRGBHex.toLowerCase();
                addRecent(hex);          // 写入取色历史（完整面板仍可见最近 12 条）
                renderRecentChips();
                const nodes = selectedNodes();
                if (nodes.length) { applySolidHex(nodes, hex); refreshAllVisuals(); }
                else flash(pickBtn, `已取色 ${hex.toUpperCase()}`);
            } catch (e) { /* 用户按 Esc 取消 */ }
        };
    } else {
        pickBtn.style.opacity = '.35';
        pickBtn._tip = '浏览器不支持屏幕取色';
    }

    // 预设（按节点类型一键上色）
    const themeBtn = mkBtn(ICONS.palette, '按节点类型快速上色', '预设');
    themeBtn.onclick = () => openThemeMenu(themeBtn);

    // 高级（完整调色板）
    const moreBtn = mkBtn(ICONS.rainbow, '高级配色 NodeColor', '高级');
    moreBtn.onclick = () => {
        let nodes = selectedNodes();
        const groups = selectedGroups();
        if (!nodes.length && groups.length) {
            // 选中分组时：完整面板作用于分组内全部节点 + 联动分组框
            const set = new Set();
            groups.forEach(g => {
                try { g.recomputeInsideNodes?.(); } catch (e) {}
                (g._nodes || g.nodes || []).forEach(n => set.add(n));
            });
            nodes = [...set];
        }
        if (!nodes.length) {
            // 仍为空：回退用画布第一个节点；空画布给出提示（不关工具条）
            const first = app.graph?._nodes?.[0];
            if (!first) { flash(moreBtn, '画布上还没有节点'); return; }
            nodes = [first];
        }
        // 附带布局方向：竖版时面板显示在工具条左/右侧垂直居中
        const r = _bar?.getBoundingClientRect();
        const barRect = r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, orient: getOrient() } : undefined;
        closeBar();
        // 第三参：联动分组框（面板内上色/清除同步生效）
        openNodeColorPicker(nodes, barRect, groups);
    };

    // 随机（Alt = 各节点不同随机色）
    const randBtn = mkBtn(ICONS.dice, 'Alt + 点击：多节点 / 分组随机配色', '随机');
    randBtn.onclick = (e) => {
        const nodes = selectedNodes();
        const groups = selectedGroups();
        if (!nodes.length && !groups.length) { flash(randBtn, '请先选中节点或分组'); return; }
        if (e.altKey && nodes.length > 1) {
            nodes.forEach(n => { const c = randomHSV(); applySolidHex([n], hsv2hex(c.h, c.s, c.v)); });
        } else if (nodes.length) {
            const c = randomHSV();
            applySolidHex(nodes, hsv2hex(c.h, c.s, c.v));
        }
        groups.forEach(g => { const c = randomHSV(); g.color = hsv2hex(c.h, c.s, c.v); });
        refreshAllVisuals();
    };

    // 清除
    const clearBtn = mkBtn(ICONS.eraser, '清除颜色', '清除');
    clearBtn.onclick = () => {
        const nodes = selectedNodes();
        const groups = selectedGroups();
        if (!nodes.length && !groups.length) { flash(clearBtn, '请先选中节点或分组'); return; }
        nodes.forEach(n => {
            if (typeof n.setColorOption === "function") n.setColorOption(null);
            else { n.color = void 0; n.bgcolor = void 0; }
            delete n.constructor.title_text_color;
            delete n._gradient; delete n._titleStyle;
        });
        groups.forEach(g => { g.color = void 0; });
        refreshAllVisuals();
    };

    // 横版/竖版切换
    const orientBtn = mkBtn(orient === 'v' ? ICONS.switchH : ICONS.switchV, '切换横竖版', orient === 'v' ? '横版' : '竖版');
    orientBtn.onclick = () => {
        setOrient(getOrient() === 'v' ? 'h' : 'v');
        closeBar();
        // 等收起动画结束再展开，避免视觉跳变
        setTimeout(openBar, 170);
    };

    // 玻璃主题三态循环（全插件共享标准，见 lib/glass-theme.js；标签显示当前模式）
    const MODE_ICONS = { auto: ICONS.auto, light: ICONS.sun, dark: ICONS.moon };
    const curMode = getBarMode();
    const md = GLASS_MODE_DEFS[curMode];
    const modeBtn = mkBtn(MODE_ICONS[curMode], md.tip, md.label);
    // 只负责切换；重建由 setup() 中的 onGlassChange 订阅统一处理（与外部切换同路径）
    modeBtn.onclick = () => { cycleGlassMode(); };

    // 既定顺序：取色 / 预设 / 高级 / 随机 / 清除 / 横竖版 / 深浅
    [pickBtn, themeBtn, moreBtn, randBtn, clearBtn, modeBtn, orientBtn].forEach(b => bar.appendChild(b));

    document.body.appendChild(bar);
    _bar = bar;
    positionBar();
    // 展开动画
    requestAnimationFrame(() => { bar.style.opacity = '1'; bar.style.transform = 'scale(1)'; });

    // Esc 关闭
    _escHandler = (e) => { if (e.key === 'Escape') closeBar(); };
    document.addEventListener('keydown', _escHandler);
}

// ── 常驻悬浮球（拖拽移动 / 点击展开） ─────────────────────
function createLauncher() {
    if (_launcher) return;
    const b = document.createElement('div');
    b.setAttribute('data-wosai-panel', '');
    // 提示走自定义 tooltip（上方居中），不用原生 title
    // 结构：彩虹锥形渐变描边环（外）+ 液态玻璃内芯（内）+ 多彩调色板图标
    b.style.cssText = `position:fixed;width:${BALL}px;height:${BALL}px;border-radius:50%;padding:2.5px;box-sizing:border-box;background:conic-gradient(from 210deg,#E24B4A,#EF9F27,#1D9E75,#378ADD,#7F77DD,#D4537E,#E24B4A);box-shadow:0 4px 16px rgba(0,0,0,.4);z-index:100002;cursor:grab;user-select:none;transition:transform .18s,box-shadow .18s,opacity .5s ease;touch-action:none;opacity:0`;
    const inner = document.createElement('div');
    const skinLauncher = () => {
        const light = getBarTheme() === 'light';
        inner.style.cssText = `width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${light ? 'rgba(255,255,255,.78)' : 'rgba(22,23,26,.82)'};backdrop-filter:blur(20px) saturate(1.6);-webkit-backdrop-filter:blur(20px) saturate(1.6);color:${light ? '#1D1D1F' : '#E4E4E7'};pointer-events:none`;
    };
    skinLauncher();
    _launcher_skin = skinLauncher;   // 深浅切换时同步球芯
    inner.innerHTML = _icon('<path d="M12 21a9 9 0 1 1 0-18c5 0 9 3.6 9 8 0 1.1-.5 2.1-1.3 2.8-.8.8-2 1.2-3.2 1.2h-2.5a2 2 0 0 0-1 3.75A1.3 1.3 0 0 1 12 21z"/><circle cx="8.5" cy="10.5" r="1.3" fill="#E24B4A" stroke="none"/><circle cx="12" cy="7.5" r="1.3" fill="#EF9F27" stroke="none"/><circle cx="15.5" cy="10.5" r="1.3" fill="#378ADD" stroke="none"/>', 20);
    b.appendChild(inner);
    b.onmouseenter = () => { b.style.transform = 'scale(1.12) rotate(8deg)'; b.style.boxShadow = '0 6px 24px rgba(221,111,74,.45)'; showTip(b, 'WOSAI 配色助手'); };
    b.onmouseleave = () => { b.style.transform = ''; b.style.boxShadow = '0 4px 16px rgba(0,0,0,.4)'; hideTip(); };

    const cur = getLauncherPos();
    b.style.left = cur.x + 'px';
    b.style.top = cur.y + 'px';

    // 拖拽（位移 >4px 判定为拖动，否则视为点击 toggle）
    let drag = null, moved = false;
    b.addEventListener('pointerdown', (e) => {
        hideTip();
        drag = { ox: e.clientX - cur.x, oy: e.clientY - cur.y };
        moved = false;
        b.setPointerCapture(e.pointerId);
        b.style.cursor = 'grabbing';
        e.preventDefault(); e.stopPropagation();
    });
    b.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const nx = e.clientX - drag.ox, ny = e.clientY - drag.oy;
        if (!moved && Math.hypot(nx - cur.x, ny - cur.y) < 4) return;
        moved = true;
        const p = clampPos(nx, ny);
        cur.x = p.x; cur.y = p.y;
        b.style.left = p.x + 'px';
        b.style.top = p.y + 'px';
        positionBar();   // 工具条跟随
    });
    const endDrag = (e) => {
        if (!drag) return;
        try { b.releasePointerCapture(e.pointerId); } catch (err) {}
        b.style.cursor = 'grab';
        if (moved) saveLauncherPos(cur);
        else toggleBar();
        drag = null; moved = false;
    };
    b.addEventListener('pointerup', endDrag);
    b.addEventListener('pointercancel', endDrag);

    document.body.appendChild(b);
    _launcher = b;
    // 淡入出现，避免突兀
    requestAnimationFrame(() => requestAnimationFrame(() => { b.style.opacity = '1'; }));

    // 窗口缩放时钳回视口（先移除旧监听器：设置开关反复切换时避免累积泄漏）
    if (_resizeHandler) { window.removeEventListener('resize', _resizeHandler); }
    _resizeHandler = () => {
        const p = clampPos(cur.x, cur.y);
        cur.x = p.x; cur.y = p.y;
        b.style.left = p.x + 'px';
        b.style.top = p.y + 'px';
        positionBar();
    };
    window.addEventListener('resize', _resizeHandler);
}

// ── 悬浮球延迟出场：等画布完全载入（工作流配置完成 + 浏览器空闲）──
// 插件多时画布载入慢，悬浮球过早出现会干扰用户
function showLauncherWhenReady(extraDelay = 800) {
    if (_canvasReady) return;          // 只走一次
    _canvasReady = true;
    if (_launcherTimer) clearTimeout(_launcherTimer);
    const show = () => { if (getSetting(SETTING_LAUNCHER, true)) createLauncher(); };
    // 等浏览器空闲再显示，确保不与画布渲染抢资源
    setTimeout(() => {
        if ('requestIdleCallback' in window) requestIdleCallback(show, { timeout: 3000 });
        else setTimeout(show, 600);
    }, extraDelay);
}

// 注册 WOSAI ColorBar 配色悬浮条扩展
app.registerExtension({
    name: "WOSAI.ColorBar",

    // 扩展配置项面板设置
    settings: [
        {
            id: SETTING_LAUNCHER,
            name: '🟠 显示悬浮球 - WOSAI 配色助手',
            category: ['WOSAI 自定义', '配色助手', '显示悬浮球'],
            type: 'boolean',
            defaultValue: true,
            // 配置项切换时触发回调
            onChange: (v) => {
                // 画布未初始化完成时，延迟初始化悬浮球，避免DOM创建异常
                if (v) {
                    if (_canvasReady) createLauncher();
                }
                // 关闭悬浮球并销毁DOM实例（同步移除 resize 监听器）
                else if (_launcher) {
                    closeBar();
                    _launcher.remove();
                    _launcher = null;
                    if (_resizeHandler) { window.removeEventListener('resize', _resizeHandler); _resizeHandler = null; }
                }
            },
        },
        {
            id: SETTING_HOLD,
            name: '🟠 先选中节点 / 分组，再长按 ` 键调出悬浮条，将鼠标移到颜色按钮上再松手，可一键上色',
            category: ['WOSAI 自定义', '配色助手', 'Hold 模式'],
            type: 'boolean',
            defaultValue: false,
        },
        {
            // 版权静态展示项：自定义DOM渲染，纯展示无交互、无数据读写
            id: 'WOSAI.About.Copyright',
            name: '🟠 WOSAI 是专业的可视化节点美化与增强工具，好看更强悍！',
            category: ['WOSAI 自定义', '关于 WOSAI', '版权'],
            defaultValue: '',
            // 自定义渲染函数，返回原生DOM元素
            type: () => {
                const el = document.createElement('div');
                // 全局布局、文字、主题色适配、禁止选中文本样式
                el.style.cssText = `
                    width:100%;
                    text-align:center;
                    padding:14px 0 6px;
                    font-size:12px;
                    letter-spacing:.6px;
                    color:var(--ws-text-muted,#8b8b92);
                    user-select:none
                `.replace(/\s+/g, ''); // 压缩换行空格，等价原单行cssText
                el.textContent = 'COPYRIGHT © WOSAI STUDIO | 穿山阅海';
                return el;
            },
        },
    ],
    // 工作流加载/配置完成后触发（页面启动载入上次工作流时也会触发）——主信号
    afterConfigureGraph() {
        showLauncherWhenReady();
    },

    setup() {
        // 兜底：12 秒内 afterConfigureGraph 未触发（如空画布）也照常显示
        _launcherTimer = setTimeout(() => showLauncherWhenReady(0), 12000);
        initStore();

        // 玻璃主题变更（本面板或其他 WOSAI 面板切换）→ 球芯换肤 + 工具条重建
        _offGlassChange = onGlassChange(() => {
            if (_launcher_skin) _launcher_skin();
            if (_bar) { closeBar(); setTimeout(openBar, 170); }
        });

        // ── Hold 模式：按住 ` 显示工具条，悬停某项松开 = 执行该项 ──
        const isEditable = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
        _keyDownHandler = (e) => {
            if (e.key !== '`' || e.repeat) return;
            if (!getSetting(SETTING_HOLD, false)) return;
            if (isEditable(e.target)) return;
            e.preventDefault(); e.stopPropagation();
            if (!_holdActive) { _holdActive = true; if (!_bar) openBar(); }
        };
        _keyUpHandler = (e) => {
            if (e.key !== '`' || !_holdActive) return;
            _holdActive = false;
            const item = _hoverItem;
            _hoverItem = null;
            if (item) item.click();
            // 主题菜单被打开（或条目自行处理了关闭）时保留，否则收起
            if (_bar && !_themeMenu) closeBar();
        };
        window.addEventListener('keydown', _keyDownHandler, true);
        window.addEventListener('keyup', _keyUpHandler, true);
    },

    remove() {
        closeBar();
        if (_launcher) { _launcher.remove(); _launcher = null; }
        if (_resizeHandler) { window.removeEventListener('resize', _resizeHandler); _resizeHandler = null; }
        if (_keyDownHandler) { window.removeEventListener('keydown', _keyDownHandler, true); _keyDownHandler = null; }
        if (_keyUpHandler) { window.removeEventListener('keyup', _keyUpHandler, true); _keyUpHandler = null; }
        if (_offGlassChange) { _offGlassChange(); _offGlassChange = null; }
        if (_launcherTimer) { clearTimeout(_launcherTimer); _launcherTimer = null; }
    },

    commands: [{
        id: "wosai-color-bar",
        label: "🟠快捷上色条 ColorBar",
        // Hold 模式下按键由原生 keydown/keyup 接管，命令空转避免双触发
        function: () => { if (getSetting(SETTING_HOLD, false)) return; toggleBar(); },
    }],

    keybindings: [{
        combo: { key: "`" },
        commandId: "wosai-color-bar",
    }],
});
