// ========== WOSAI ColorBar UI 构建器 ==========
// 负责 color tab 的 DOM 构建与配色相关业务逻辑；宿主 color-bar.js 只负责打开/关闭/定位框架。

import { t } from "./i18n.js";
import { app } from "../../../../scripts/app.js";
import { SOLID_PRESETS, applySolidHex, randomHSV, hsv2hex, palettesPromise } from "./color-core.js";

import {
    THEME_STYLES, applyTheme,
    getSelectedStyleId, setSelectedStyleId,
    themesPromise,
} from "./color-theme.js";
import { openNodeColorPicker, refreshAllVisuals, clearNodeColors } from "../node-color.js";
import { showTip, hideTip } from "./tooltip.js";
import { flashToast } from "./toast.js";
import { iconEl } from "./svg-icons.js";
import { WS_ICONS } from "./shared-utils.js";
import { getSelectedNodes, getSelectedGroups } from "./canvas-utils.js";
import {
    glassT as barT, getGlassTheme as getBarTheme,
} from "./glass-theme.js";
import {
    mkItem as hudMkItem, mkBtn as hudMkBtn, mkDivider as hudMkDivider,
} from "./hud-kit.js";

const LS_PRESET_GROUP = "wosai-colorbar-preset-group";

// ── 线性图标（Tabler/Lucide 风格，MIT/ISC 同风格自绘，stroke=currentColor 随主题变色）──
// 默认放大到 27（原 24）；描边 1.6（原 2）更纤细
const _icon = (inner, size = 25) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export const ICONS = {
    // 「换一组预设」单独保留双色（绿/蓝），作为整套单色图标里的视觉焦点；放大到 32（含中心组号数字）
    refresh: _icon('<path d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>'),
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

// 生成随机色相，自动避开红色范围（0°~30° 和 330°~360°）
function randomHueAvoidRed() {
    const safeRanges = [[30, 330]];  // 从 30° 到 330° 的安全区间
    const range = safeRanges[0];
    const h = range[0] + Math.floor(Math.random() * (range[1] - range[0]));
    return { h, s: 60 + Math.floor(Math.random() * 31), v: 45 + Math.floor(Math.random() * 36) };
}

// 对选中节点/分组上纯色（带空选中提示）
function paintSelected(hex, anchorEl) {
    const nodes = getSelectedNodes();
    const groups = getSelectedGroups();
    if (!nodes.length && !groups.length) { flashToast(anchorEl, t('menus.colorBar.selectNodeOrGroup')); return; }
    // 收集所有需要上色的节点（选中节点 + 分组内子节点）
    const nodeSet = new Set(nodes);
    groups.forEach(g => {
        try { g.recomputeInsideNodes?.(); } catch (e) {}
        (g._nodes || g.nodes || []).forEach(n => nodeSet.add(n));
    });
    if (nodeSet.size) applySolidHex([...nodeSet], hex);
    // 分组框自身颜色（跟随预设色，与组内节点一致）
    groups.forEach(g => { g.color = hex; });
    refreshAllVisuals();
}

export async function createColorTabBuilders(holdHooks) {
    // 等待调色板/主题数据加载完成（兼容不支持 import ... with json 的运行时）
    const palettes = await palettesPromise;
    await themesPromise;

    function mkItem(visualEl, label, tip) { return hudMkItem(visualEl, label, tip, holdHooks); }
    function mkBtn(iconSvg, tip, label) {
        const wrap = hudMkBtn(iconSvg, tip, label, holdHooks);
        if (wrap.firstChild) wrap.firstChild.dataset.wsSkin = 'btn';
        return wrap;
    }

    // 圆形色块（颜色 + 中文名）——ColorBar 专有
    function mkChip(hex, tip, label) {
        const c = document.createElement('div');
        c.dataset.wsSkin = 'chip';
        c.style.cssText = `width:var(--ws-cb-chip-size);height:var(--ws-cb-chip-size);border-radius:50%;background:${hex};border:var(--ws-cb-chip-border) solid ${barT().chipRing};transition:transform .12s,filter .15s;pointer-events:none;box-sizing:border-box`;
        return mkItem(c, label, tip);
    }

    // 主题菜单构建；宿主负责定位与状态管理
    function buildThemeMenu(anchorBtn, closeThemeMenu, reopenThemeMenu, getOrient) {
        const T = barT();
        const menu = document.createElement('div');
        menu.setAttribute('data-wosai-panel', '');
        menu.setAttribute('data-theme', getBarTheme());
        menu.style.cssText = `position:fixed;z-index:var(--ws-z-flash);display:flex;flex-direction:column;gap:var(--ws-gap-sm);padding:var(--ws-panel-padding);border-radius:var(--ws-radius-lg);background:${T.glass};backdrop-filter:${T.blur};-webkit-backdrop-filter:${T.blur};border:${T.border};box-shadow:${T.shadow};white-space:nowrap;width:max-content`;

        const curId = getSelectedStyleId();
        const mkStyleRow = ([id, style]) => {
            const row = document.createElement('div');
            row.style.cssText = `display:flex;align-items:center;justify-content:center;gap:var(--ws-gap-md);padding:var(--ws-gap-sm) var(--ws-gap-md);border-radius:var(--ws-radius);font-size:var(--ws-text-md);color:${T.text};background:${id === curId ? T.rowHover : 'transparent'}`;
            row.onmouseenter = () => row.style.background = T.rowHover;
            row.onmouseleave = () => row.style.background = id === getSelectedStyleId() ? T.rowHover : 'transparent';

            const strip = document.createElement('div');
            const colors = ['model', 'sample', 'prompt', 'output'].map(cat => style.colors[cat]);
            strip.style.cssText = `width:var(--ws-cb-strip-w);height:var(--ws-cb-strip-h);border-radius:var(--ws-cb-strip-radius);flex-shrink:0;background:linear-gradient(90deg, ${colors.join(', ')})`;
            row.appendChild(strip);

            const lbl = document.createElement('span');
            lbl.textContent = style.label;
            lbl.style.cssText = `color:${T.textMuted}`;
            row.appendChild(lbl);

            row.onclick = () => {
                // 范围：选中分组 → 分组框+组内节点；选中节点 → 仅这些节点；无选中 → 全图
                const selN = getSelectedNodes();
                const selG = getSelectedGroups();
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
                    const scope = (selN.length || selG.length) ? '' : t('menus.colorBar.wholeGraph');
                    flashToast(anchorBtn, t('menus.colorBar.appliedTheme').replace('{theme}', style.label).replace('{scope}', scope).replace('{count}', total));
                } else {
                    flashToast(anchorBtn, (selN.length || selG.length) ? t('menus.colorBar.groupHasNoNodes') : t('menus.colorBar.noNodesOnCanvas'));
                }
                // 菜单保持打开，方便连续试不同配色；原地重建以更新选中态和撤销行
                closeThemeMenu();
                reopenThemeMenu();
            };
            return row;
        };

        // 标题行：居中标题「按节点类型快速上色」+ 右侧 🎲 随机按钮（自动避开红色）
        const titleRow = document.createElement('div');
        titleRow.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:0 0 var(--ws-gap-2xs);`;
        const leftSpacer = document.createElement('span');
        leftSpacer.style.cssText = 'width:var(--ws-cb-title-spacer);flex-shrink:0';
        const titleText = document.createElement('span');
        titleText.textContent = t('menus.colorBar.quickColorByType');
        titleText.style.cssText = `font-size:var(--ws-text-md);color:${T.text};font-weight:600;letter-spacing:var(--ws-cb-letter-spacing-tight);text-align:center;flex:1`;
        const randBtn = document.createElement('span');
        randBtn.appendChild(iconEl('random', 18));
        randBtn.style.cssText = `width:var(--ws-cb-rand-btn-size);height:var(--ws-cb-rand-btn-size);display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:var(--ws-cb-rand-btn-font);cursor:pointer;flex-shrink:0;transition:background var(--ws-transition, .15s),transform .12s;user-select:none;line-height:1`;
        randBtn.onmouseenter = () => { randBtn.style.background = T.rowHover; randBtn.style.transform = 'scale(1.15)'; showTip(randBtn, t('menus.colorBar.randomColorScheme')); };
        randBtn.onmouseleave = () => { randBtn.style.background = 'transparent'; randBtn.style.transform = ''; hideTip(); };
        randBtn.onclick = () => {
            const selN = getSelectedNodes();
            const selG = getSelectedGroups();
            let targets;
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
            flashToast(randBtn, targets.length ? t('menus.colorBar.randomColorApplied') : t('menus.colorBar.noNodesOnCanvas'));
        };
        titleRow.appendChild(leftSpacer);
        titleRow.appendChild(titleText);
        titleRow.appendChild(randBtn);
        menu.appendChild(titleRow);

        // 两类分组渲染：纯色 / 渐变
        const horizontal = getOrient() !== 'v';
        [{ key: 'solid', label: t('menus.colorBar.solidColor') }, { key: 'grad', label: t('menus.colorBar.gradientColor') }].forEach((grp, gi) => {
            const head = document.createElement('div');
            head.style.cssText = `display:flex;align-items:center;gap:var(--ws-gap-md);padding:${gi ? 'var(--ws-gap-md)' : 'var(--ws-gap-2xs)'} 0 var(--ws-gap-2xs);`;
            const lineL = document.createElement('span');
            lineL.style.cssText = `flex:1;height:var(--ws-border-width-thin);background:linear-gradient(90deg,transparent,${T.divider})`;
            const txt = document.createElement('span');
            txt.textContent = grp.label;
            txt.style.cssText = `font-size:var(--ws-text-sm);color:${T.textMuted};letter-spacing:var(--ws-cb-letter-spacing-wide);white-space:nowrap;font-weight:500`;
            const lineR = document.createElement('span');
            lineR.style.cssText = `flex:1;height:var(--ws-border-width-thin);background:linear-gradient(90deg,${T.divider},transparent)`;
            head.appendChild(lineL);
            head.appendChild(txt);
            head.appendChild(lineR);
            menu.appendChild(head);
            const wrap = document.createElement('div');
            wrap.style.cssText = horizontal
                ? 'display:grid;grid-template-columns:repeat(3,1fr);gap:var(--ws-gap-sm) var(--ws-gap-lg);justify-items:start'
                : 'display:flex;flex-direction:column;gap:var(--ws-gap-sm)';
            Object.entries(THEME_STYLES)
                .filter(([, s]) => (s.group || 'solid') === grp.key)
                .forEach(entry => wrap.appendChild(mkStyleRow(entry)));
            menu.appendChild(wrap);
        });

        const footerRow = document.createElement('div');
        footerRow.style.cssText = 'display:flex;justify-content:center;gap:var(--ws-gap-md);margin-top:var(--ws-gap)';

        const confirmBtn = document.createElement('div');
        confirmBtn.textContent = t('common.confirm');
        confirmBtn.style.cssText = `min-width:var(--ws-cb-confirm-btn-min-w);height:var(--ws-cb-confirm-btn-h);padding:0 var(--ws-gap-lg);display:flex;align-items:center;justify-content:center;border-radius:var(--ws-radius-md);cursor:pointer;font-size:var(--ws-text-sm);background:${T.btnBg};color:${T.text};transition:background .15s,color .15s,transform .12s;user-select:none`;
        confirmBtn.onmouseenter = () => { confirmBtn.style.background = 'var(--ws-accent)'; confirmBtn.style.color = 'var(--ws-text-on-accent)'; confirmBtn.style.transform = 'scale(1.05)'; showTip(confirmBtn, t('menus.colorBar.confirmAndClose')); };
        confirmBtn.onmouseleave = () => { confirmBtn.style.background = T.btnBg; confirmBtn.style.color = T.text; confirmBtn.style.transform = ''; hideTip(); };
        confirmBtn.onclick = () => { closeThemeMenu(); };
        footerRow.appendChild(confirmBtn);

        menu.appendChild(footerRow);
        return menu;
    }

    // color tab 主体构建；返回待挂载到 bar 的子元素数组
    function buildColorTabContent(orient, bar, { openThemeMenu, closeBar }) {
        const elements = [];

        // ── 预设色：4 组 × 6 色，「换组」按钮循环切换（记忆当前组）──
        const PRESET_GROUPS = palettes.colorBarPresetGroups.map(g => ({
            name: t(`menus.colorBar.presetGroup${g.nameKey.charAt(0).toUpperCase() + g.nameKey.slice(1)}`),
            colors: g.colors.map(key => ({
                n: t(`widgets.colorCore.${key}`),
                h: SOLID_PRESETS.find(p => p.key === key)?.h ?? 0,
            })),
        }));
        let presetGroupIdx = parseInt(localStorage.getItem(LS_PRESET_GROUP)) || 0;
        if (presetGroupIdx < 0 || presetGroupIdx >= PRESET_GROUPS.length) presetGroupIdx = 0;

        const presetWrap = document.createElement('div');
        presetWrap.style.cssText = orient === 'v'
            ? 'display:flex;flex-direction:column;gap:var(--ws-gap-md);align-items:center'
            : 'display:flex;flex-direction:row;gap:var(--ws-gap);align-items:center';
        const renderPresetChips = () => {
            presetWrap.innerHTML = '';
            PRESET_GROUPS[presetGroupIdx].colors.forEach(p => {
                const chip = mkChip(p.h, '', p.n);
                chip.onclick = () => paintSelected(p.h, chip);
                presetWrap.appendChild(chip);
            });
        };
        renderPresetChips();

        // 换一组预设色
        const swapBtn = mkBtn(ICONS.refresh, t('menus.colorBar.shufflePresets'), t('menus.colorBar.swapGroup'));
        const swapIcon = swapBtn.firstChild;
        swapIcon.style.position = 'relative';
        const groupNum = document.createElement('div');
        groupNum.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:var(--ws-text-xs);font-weight:400;line-height:1;color:currentColor;pointer-events:none;text-shadow:var(--ws-cb-text-shadow)';
        swapIcon.appendChild(groupNum);
        const updateGroupNum = () => { groupNum.textContent = String(presetGroupIdx + 1); };
        updateGroupNum();
        swapBtn._tip = t('menus.colorBar.presetGroupLabel').replace('{index}', presetGroupIdx + 1).replace('{name}', PRESET_GROUPS[presetGroupIdx].name);
        swapBtn.onclick = () => {
            presetGroupIdx = (presetGroupIdx + 1) % PRESET_GROUPS.length;
            try { localStorage.setItem(LS_PRESET_GROUP, String(presetGroupIdx)); } catch (e) {}
            renderPresetChips();
            updateGroupNum();
            swapBtn._tip = t('menus.colorBar.presetGroupLabel').replace('{index}', presetGroupIdx + 1).replace('{name}', PRESET_GROUPS[presetGroupIdx].name);
            flashToast(swapBtn, t('menus.colorBar.presetGroupLabel').replace('{index}', presetGroupIdx + 1).replace('{name}', PRESET_GROUPS[presetGroupIdx].name));
        };

        // ── 功能按钮（创建后统一按既定顺序挂载）──────────────────
        // 预设（按节点类型一键上色）
        const themeBtn = mkBtn(ICONS.palette, t('menus.colorBar.quickColorByType'), t('menus.colorBar.preset'));
        themeBtn.onclick = () => openThemeMenu(themeBtn);

        // 高级（完整调色板）
        const moreBtn = mkBtn(ICONS.rainbow, t('menus.colorBar.advancedColorF2'), t('menus.colorBar.advanced'));
        moreBtn.onclick = () => {
            let nodes = getSelectedNodes();
            const groups = getSelectedGroups();
            if (!nodes.length && groups.length) {
                const set = new Set();
                groups.forEach(g => {
                    try { g.recomputeInsideNodes?.(); } catch (e) {}
                    (g._nodes || g.nodes || []).forEach(n => set.add(n));
                });
                nodes = [...set];
            }
            if (!nodes.length) {
                const first = app.graph?._nodes?.[0];
                if (!first) { flashToast(moreBtn, t('menus.colorBar.noNodesOnCanvas')); return; }
                nodes = [first];
            }
            const r = bar?.getBoundingClientRect();
            const barRect = r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, orient } : undefined;
            closeBar();
            openNodeColorPicker(nodes, barRect, groups);
        };

        // 随机（Alt = 各节点不同随机色）
        const randBtn = mkBtn(WS_ICONS.dice, t('menus.colorBar.altRandomColorHint'), t('common.random'));
        randBtn.onclick = (e) => {
            const nodes = getSelectedNodes();
            const groups = getSelectedGroups();
            if (!nodes.length && !groups.length) { flashToast(randBtn, t('menus.colorBar.selectNodeOrGroup')); return; }
            const nodeSet = new Set(nodes);
            groups.forEach(g => {
                try { g.recomputeInsideNodes?.(); } catch (e) {}
                (g._nodes || g.nodes || []).forEach(n => nodeSet.add(n));
            });
            const allNodes = [...nodeSet];
            if (e.altKey && allNodes.length > 1) {
                allNodes.forEach(n => { const c = randomHSV(); applySolidHex([n], hsv2hex(c.h, c.s, c.v)); });
            } else if (allNodes.length) {
                const c = randomHSV();
                applySolidHex(allNodes, hsv2hex(c.h, c.s, c.v));
            }
            groups.forEach(g => { const c = randomHSV(); g.color = hsv2hex(c.h, c.s, c.v); });
            refreshAllVisuals();
        };

        // 清除（智能作用域：有选中清选中，无选中清全图）
        const clearBtn = mkBtn(ICONS.eraser, t('menus.colorBar.clearColorHint'), t('common.clear'));
        clearBtn.onclick = () => {
            let nodes = getSelectedNodes();
            let groups = getSelectedGroups();
            let whole = false;
            if (!nodes.length && !groups.length) {
                const g = app.graph;
                nodes = g?._nodes || g?.nodes || [];
                groups = g?._groups || g?.groups || [];
                whole = true;
            }
            clearNodeColors(nodes, groups);
            refreshAllVisuals();
            flashToast(clearBtn, whole ? t('menus.colorBar.clearedWholeGraph') : t('menus.colorBar.clearedSelected'));
        };

        // ── 组装顺序：预设 / 高级 / 随机 / 清除 | 换组 / 预设颜色 ──
        elements.push(themeBtn, moreBtn, randBtn, clearBtn);
        const divider1 = hudMkDivider(orient);
        divider1.dataset.wsSkin = 'divider';
        elements.push(divider1);
        elements.push(swapBtn);
        elements.push(presetWrap);

        return elements;
    }

    return { buildColorTabContent, buildThemeMenu, mkChip, mkItem, mkBtn };
}
