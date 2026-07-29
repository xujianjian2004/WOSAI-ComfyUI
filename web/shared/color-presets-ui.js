/**
 * NodeColor 预设管理模块（仅三色渐变）
 * 从 node-color.js 的 openNodeColorPicker 闭包中提取
 * 负责：内置预设渲染、自定义预设渲染/保存/删除
 */

import {
    hsv2hex, hex2hsv,
    GRAD_PRESETS,
    deriveMidStop,
} from './color-core.js';
import { t } from './i18n.js';
import { store, persist } from './color-store.js';
import { showTip, hideTip } from './tooltip.js';

/**
 * 渲染内置预设色块（始终 8 个三色渐变）
 */
export function renderBuiltinPresets(area, S, _grayMode, { saveAndSync, refresh, rebuildPins, updateGradVisibility, paintStopbar, updatePins, updateDirThumbs }) {
    area.innerHTML = '';
    const g = document.createElement('div');
    g.className = 'nc-pg';
    for (let col = 0; col < 8; col++) {
        const p = GRAD_PRESETS[col];
        const el = document.createElement('div');
        el.className = 'nc-ps';
        const m0 = p.s[0], m1 = p.s[1];
        const mid = deriveMidStop(m0, m1);
        el.style.background = `linear-gradient(135deg,${hsv2hex(m0.h, m0.s, m0.v)},${hsv2hex(mid.h, mid.s, mid.v)},${hsv2hex(m1.h, m1.s, m1.v)})`;
        el.onmouseenter = () => showTip(el, t('widgets.colorCore.' + p.key) + ' ' + p.e);
        el.onmouseleave = hideTip;
        el.onclick = () => {
            area.querySelectorAll('.nc-ps').forEach(x => x.classList.remove('on'));
            el.classList.add('on');
            const s0 = { h: p.s[0].h, s: p.s[0].s, v: p.s[0].v }, s1 = { h: p.s[1].h, s: p.s[1].s, v: p.s[1].v };
            const mid2 = deriveMidStop(s0, s1);
            S.stops = [{ p: 0, ...s0 }, { p: 0.5, h: mid2.h, s: mid2.s, v: mid2.v }, { p: 1, ...s1 }];
            S.aStop = 0; S.h = p.s[0].h; S.s = p.s[0].s; S.v = p.s[0].v;
            S.dir = '↓';
            const hs = document.getElementById('ncHs');
            if (hs) hs.value = p.s[0].h;
            rebuildPins(); updateGradVisibility();
            paintStopbar(); updatePins(); updateDirThumbs();
            if (typeof refresh === 'function') refresh();
            if (typeof saveAndSync === 'function') saveAndSync();
        };
        g.appendChild(el);
    }
    area.appendChild(g);
}

/** 生成自定义 chip 背景样式（仅 grad3） */
function _customChipBg(p) {
    const parts = (p.stops || []).map(s => s.hex).join(', ');
    return `linear-gradient(135deg, ${parts})`;
}

/** 生成自定义 chip tooltip 文字（仅 grad3） */
function _customChipTip(p) {
    return (p.stops || []).map(s => s.hex.toUpperCase()).join(' → ');
}

/**
 * 将当前面板状态保存为自定义预设（始终按三色渐变保存）
 */
export function saveCurrentAsCustom(S, renderCustomPresets) {
    const entry = { type: 'grad3', dir: S.dir, stops: S.stops.map(s => ({ hex: hsv2hex(s.h, s.s, s.v).toLowerCase(), p: s.p })) };
    const key = JSON.stringify(entry);
    const filtered = store.customGrad3.filter(p => JSON.stringify(p) !== key);
    filtered.unshift(entry);
    if (filtered.length > 16) filtered.length = 16;
    store.customGrad3 = filtered;
    persist();
    renderCustomPresets();
}

/**
 * 渲染自定义预设区域（始终按三色渐变渲染和应用）
 */
export function renderCustomPresets(S, { saveAndSync, refresh, rebuildPins, updateGradVisibility }) {
    const area = document.getElementById('ncPa');
    if (!area) return;
    const old = area.querySelector('.nc-custom-section');
    if (old) old.remove();

    const list = store.customGrad3 || [];
    if (!list.length) return;

    const section = document.createElement('div');
    section.className = 'nc-custom-section';
    const grid = document.createElement('div');
    grid.className = 'nc-cp';

    list.forEach((p, idx) => {
        const chip = document.createElement('div');
        chip.className = 'nc-cp-chip';
        const hexArr = (p.stops || []).map(s => s.hex);
        chip.style.background = `linear-gradient(135deg, ${hexArr.join(', ')})`;
        const tipText = (p.stops || []).map(s => s.hex.toUpperCase()).join(' → ');
        chip.title = tipText;
        chip.onmouseenter = () => showTip(chip, tipText);
        chip.onmouseleave = hideTip;
        chip.onclick = () => {
            // 始终按三色渐变应用
            S.stops = (p.stops || []).map(s => ({ p: s.p, ...hex2hsv(s.hex) }));
            if (S.stops.length >= 3) { /* ok */ }
            else if (S.stops.length === 2) {
                const mid = deriveMidStop(S.stops[0], S.stops[1]);
                S.stops = [S.stops[0], { p: 0.5, ...mid }, S.stops[1]];
            } else {
                const c = S.stops[0];
                S.stops = [c, { p: 0.5, h: c.h, s: Math.max(c.s - 10, 0), v: Math.min(c.v + 10, 100) }, c];
            }
            S.aStop = 0; S.h = S.stops[0].h; S.s = S.stops[0].s; S.v = S.stops[0].v;
            S.dir = p.dir || '↓';
            const hs = document.getElementById('ncHs');
            if (hs) hs.value = S.h;
            rebuildPins(); updateGradVisibility();
            if (typeof refresh === 'function') refresh();
            if (typeof saveAndSync === 'function') saveAndSync();
            grid.querySelectorAll('.nc-cp-chip').forEach(c => c.classList.remove('on'));
            chip.classList.add('on');
        };
        // 右键删除
        chip.oncontextmenu = (e) => {
            e.preventDefault(); e.stopPropagation();
            store.customGrad3.splice(idx, 1);
            persist();
            renderCustomPresets(S, { saveAndSync, refresh, rebuildPins, updateGradVisibility });
        };
        chip.appendChild(document.createTextNode('×'));  // 删除按钮占位
        grid.appendChild(chip);
    });
    section.appendChild(grid);
    area.appendChild(section);
}
