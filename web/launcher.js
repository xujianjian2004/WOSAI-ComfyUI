// ========== WOSAI Launcher — 常驻悬浮球 +子球 + 形象面板 ==========
// 独立模块：悬浮球渲染、拖拽、侧边吸附、子球弹出/收起、形象面板
// 不依赖 color-bar.js；通过 setLauncherContext() 接收回调桥接到 ColorBar HUD

import { t, onLangChange } from "./shared/i18n.js";
import { STORAGE_KEYS } from "./shared/constants.js";
import { showTip, hideTip } from "./shared/tooltip.js";
import {
    glassT as barT, getGlassTheme as getBarTheme,
} from "./shared/glass-theme.js";
import { getHudTab } from "./shared/hud-kit.js";
import {
    BALL_EXPRESSIONS as BALL_EXPS,
    readBallAnimation,
    readBallExpression,
    readBallExpressionMode,
    readBallSize,
    writeBallAnimation,
    writeBallExpression,
    writeBallExpressionMode,
    writeBallSize,
} from "./shared/launcher-avatar-state.js";
import {
    clampLauncherPosition,
    enclosingRect,
    launcherDodgePosition,
    smartFanAngle,
} from "./shared/launcher-geometry.js";

// ── 上下文注入（由 color-bar.js 初始化时设置） ──────────
const _ctx = {};
export function setLauncherContext(ctx) { Object.assign(_ctx, ctx); }
// _ctx 期望字段：{ openTab(mode), closeHud(), repositionHud() }

// ── 常量 ────────────────────────────────────────────────
export let BALL = 60;       // 悬浮球直径（可在形象面板运行时调整 44–96）
// 子球直径从主球派生，锁定比例（主球缩放时层级稳定，不喧宾夺主）
const ORB_BIG_RATIO = 0.70, ORB_SM_RATIO = 0.56;
let ORB = Math.round(BALL * ORB_BIG_RATIO);     // 大子球（彩色）≈ 主球 0.70×
let ORB_SM = Math.round(BALL * ORB_SM_RATIO);   // 小子球（灰色系）≈ 主球 0.56×
function _recalcOrbSizes() { ORB = Math.round(BALL * ORB_BIG_RATIO); ORB_SM = Math.round(BALL * ORB_SM_RATIO); }
const SNAP_THRESHOLD = 70;  // 球心距视口边缘 < 此值触发侧边吸附
const LS_POS = 'wosai-colorbar-pos';
const LS_SNAP = 'wosai-launcher-snap';

let _expCycleTimer = null;

// ── 表情 / 尺寸 存取 ────────────────────────────────────
export function getBallExpMode() { return readBallExpressionMode(localStorage); }
function _stopExpCycle() { if (_expCycleTimer) { clearInterval(_expCycleTimer); _expCycleTimer = null; } }
function _startExpCycle() {
    _stopExpCycle();
    let i = BALL_EXPS.findIndex(e => e.id === getBallExp()); if (i < 0) i = 0;
    _expCycleTimer = setInterval(() => {
        const r = _ballRoot(); if (!r) return;
        i = (i + 1) % BALL_EXPS.length;
        r.dataset.exp = BALL_EXPS[i].id;
    }, 6000);
}
export function setBallExpMode(mode) {
    mode = writeBallExpressionMode(localStorage, mode);
    if (mode === 'cycle') _startExpCycle();
    else { _stopExpCycle(); const r = _ballRoot(); if (r) r.dataset.exp = getBallExp(); }
}
export function getBallExp() { return readBallExpression(localStorage); }
export function getBallAnim() { return readBallAnimation(localStorage); }
export function getBallSize() { return readBallSize(localStorage); }
function _ballRoot() { return _launcher ? _launcher.querySelector('.wso-root') : null; }
export function setExpression(name) {
    name = writeBallExpression(localStorage, name);
    const r = _ballRoot(); if (r) r.dataset.exp = name;
}
export function setBallAnim(on) {
    writeBallAnimation(localStorage, on);
    const r = _ballRoot(); if (r) r.classList.toggle('wso-static', !on);
}
export function applyBallSize(px) {
    px = Math.max(44, Math.min(96, px | 0));
    BALL = writeBallSize(localStorage, px); _recalcOrbSizes();
    if (_launcher) {
        const eff = _effectiveBall();
        _launcher.style.width = eff + 'px'; _launcher.style.height = eff + 'px';
        const x = parseInt(_launcher.style.left, 10) || 0, y = parseInt(_launcher.style.top, 10) || 0;
        const p = clampPos(x, y, eff, eff); _launcher.style.left = p.x + 'px'; _launcher.style.top = p.y + 'px';
        if (_wingsOpen) _hideOrbs();
        // 强制清除子球缓存，确保下次展开时按新尺寸重建 DOM
        // 若不清除：_showOrbs 检测到 sameSet===true 会复用旧 size/DOM，
        // 导致子球 width/height 仍是旧尺寸但位置按新尺寸计算 → 命中区错位 → 无法点击
        _orbs.forEach(o => o.el.remove());
        _orbs = [];
    }
}

// ── 位置 / 钳位 ────────────────────────────────────────
export function clampPos(x, y, w, h) {
    return clampLauncherPosition(x, y, {
        width: w,
        height: h,
        defaultSize: _effectiveBall(),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
    });
}
function getLauncherPos() {
    try {
        const p = JSON.parse(localStorage.getItem(LS_POS));
        if (p && isFinite(p.x) && isFinite(p.y)) return clampPos(p.x, p.y);
    } catch (e) {}
    return { x: window.innerWidth - BALL - 24, y: Math.round(window.innerHeight * 0.32) };
}
function saveLauncherPos(p) { try { localStorage.setItem(LS_POS, JSON.stringify(p)); } catch (e) {} }

// ── 面板弹出时自动躲避 ──────────────────────────────────
export function dodgeBall(panelEl) {
    if (!_launcher || !panelEl) return;
    const br = _launcher.getBoundingClientRect();
    const pr = panelEl.getBoundingClientRect();
    const position = launcherDodgePosition(br, pr, {
        ballSize: _effectiveBall(),
        defaultSize: _effectiveBall(),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
    });
    if (!position) return;

    // 从吸附状态脱离
    if (_isSideSnapped) { _unsnap(); }
    _launcher.style.left = position.x + 'px';
    _launcher.style.top = position.y + 'px';
    saveLauncherPos(position);
}

// ── 侧边吸附持久化 ─────────────────────────────────────
function _saveSnapState() { try { localStorage.setItem(LS_SNAP, JSON.stringify({ snapped: _isSideSnapped, side: _snapSide })); } catch (e) {} }
function _loadSnapState() { try { const s = JSON.parse(localStorage.getItem(LS_SNAP)); if (s?.snapped && (s.side === 'left' || s.side === 'right')) return s; } catch (e) {} return null; }
function _clearSnapState() { try { localStorage.removeItem(LS_SNAP); } catch (e) {} }

function _snapToSide(side) {
    if (!_launcher) return;
    _isSideSnapped = true;
    _snapSide = side;
    const half = _effectiveBall() / 2;
    const W = window.innerWidth;
    // 布局位置固定不动（left 不改动），吸附偏移通过 transform 实现
    const stableLeft = side === 'left' ? 0 : W - half;
    _launcher.style.left = stableLeft + 'px';
    _snapTransform = side === 'left' ? `translateX(${-half}px)` : '';
    _launcher.style.transition = 'transform .32s cubic-bezier(.34,1.56,.64,1), opacity .35s ease';
    _launcher.style.transform = _snapTransform;
    _launcher.style.opacity = '0.55';
    _launcher.style.cursor = 'pointer';
    if (_wingsOpen) _hideOrbs();
    _ctx.closeHud?.();
    _saveSnapState();
    // 动画结束后恢复默认 transition（不含 transform 缓动）
    const _tId = setTimeout(() => {
        if (_launcher && !_isSideSnapped) return;   // 已被拖拽唤醒则不再恢复
        _launcher.style.transition = 'transform .18s,filter .18s,opacity .5s ease';
    }, 370);
}

function _unsnap() {
    if (!_launcher || !_isSideSnapped) return;
    const wasLeft = _snapSide === 'left';
    _isSideSnapped = false;
    _snapSide = null;
    _snapTransform = '';
    if (_launcher) _launcher.style.transform = '';
    const half = _effectiveBall() / 2;
    const margin = half + 14;
    _launcher.style.left = (wasLeft ? margin : window.innerWidth - margin) + 'px';
    _launcher.style.opacity = '1';
    _launcher.style.cursor = 'grab';
    _clearSnapState();
}

// ── 「形象」面板：动态效果开关 / 默认表情 / 悬浮球尺寸 ──
let _avatarPanel = null, _avatarOutside = null, _avatarEscHandler = null;
function _avSec(txt) { const d = document.createElement('div'); d.textContent = txt; d.style.cssText = 'font-size:var(--ws-text-md);font-weight:500;color:var(--ws-accent);margin:var(--ws-ln-section-title-margin);'; return d; }
function buildAvatarPanel() {
    const T = barT();
    const p = document.createElement('div');
    p.dataset.wsControl = 'avatar';
    p.setAttribute('data-wosai-panel', '');
    p.setAttribute('data-theme', getBarTheme());
    p.style.cssText = `position:fixed;display:none;z-index:var(--ws-z-hud);width:var(--ws-ln-avatar-panel-width);box-sizing:border-box;padding:var(--ws-panel-padding-md);border-radius:var(--ws-ln-panel-radius);background:${T.glass};backdrop-filter:${T.blur};-webkit-backdrop-filter:${T.blur};border:${T.border};box-shadow:${T.shadow};color:var(--ws-text);font-family:var(--ws-font-family);user-select:none;`;
    p.onpointerdown = (e) => e.stopPropagation();

    const head = document.createElement('div'); head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;font-size:var(--ws-text-xl);font-weight:500;margin-bottom:var(--ws-gap-xs);';
    head.innerHTML = `<span>${t('menus.launcher.avatarPanelTitle')}</span>`;
    const x = document.createElement('div'); x.textContent = '×'; x.style.cssText = 'cursor:pointer;font-size:var(--ws-ln-close-font);line-height:1;color:var(--ws-text-secondary);padding:0 var(--ws-gap-xs);';
    x.onclick = closeAvatarPanel; head.appendChild(x); p.appendChild(head);

    const r1 = document.createElement('label'); r1.style.cssText = 'display:flex;align-items:center;gap:var(--ws-gap-md);margin-top:var(--ws-gap-lg);cursor:pointer;';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = getBallAnim(); cb.style.cssText = 'width:var(--ws-ln-checkbox-size);height:var(--ws-ln-checkbox-size);accent-color:var(--ws-accent);';
    cb.onchange = () => setBallAnim(cb.checked);
    const cl = document.createElement('span'); cl.textContent = t('menus.launcher.enableAnimation'); cl.style.fontSize = 'var(--ws-text-md)';
    r1.appendChild(cb); r1.appendChild(cl); p.appendChild(r1);

    p.appendChild(_avSec(t('menus.launcher.defaultExpression')));
    const grid = document.createElement('div'); grid.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:var(--ws-gap);';
    const expBtns = {};
    BALL_EXPS.forEach(e => {
        const b = document.createElement('div');
        b.style.cssText = 'display:flex;flex-direction:row;align-items:center;gap:var(--ws-gap-md);padding:var(--ws-ln-exp-btn-padding);border-radius:var(--ws-ln-exp-btn-radius);cursor:pointer;border:var(--ws-ln-exp-btn-border-width) solid transparent;background:var(--ws-surface-2);transition:border-color .15s,background .15s;';
        b.innerHTML = `<span class="_exp-ico" style="line-height:0;flex:none;color:var(--ws-text-secondary)">${e.ico}</span><span class="_exp-lbl" style="font-size:var(--ws-text-md);color:var(--ws-text)">${t(e.labelKey)}</span>`;
        b.onclick = () => { setExpression(e.id); _syncAvatar(); };
        expBtns[e.id] = b; grid.appendChild(b);
    });
    p.appendChild(grid);

    const r3 = document.createElement('label'); r3.style.cssText = 'display:flex;align-items:center;gap:var(--ws-gap-md);margin-top:var(--ws-gap-md);cursor:pointer;';
    const cbCycle = document.createElement('input'); cbCycle.type = 'checkbox'; cbCycle.checked = getBallExpMode() === 'cycle'; cbCycle.style.cssText = 'width:var(--ws-ln-checkbox-size);height:var(--ws-ln-checkbox-size);accent-color:var(--ws-accent);';
    cbCycle.onchange = () => setBallExpMode(cbCycle.checked ? 'cycle' : 'fixed');
    const clCycle = document.createElement('span'); clCycle.textContent = t('menus.launcher.cycleExpression'); clCycle.style.fontSize = 'var(--ws-text-md)';
    r3.appendChild(cbCycle); r3.appendChild(clCycle); p.appendChild(r3);

    p.appendChild(_avSec(t('menus.launcher.ballSize')));
    const sizeRow = document.createElement('div'); sizeRow.style.cssText = 'display:flex;align-items:center;gap:var(--ws-gap-md);';
    const sl = document.createElement('input'); sl.type = 'range'; sl.min = '44'; sl.max = '96'; sl.step = '2'; sl.value = String(getBallSize());
    sl.style.cssText = 'flex:1;accent-color:var(--ws-accent);';
    const sv = document.createElement('span'); sv.textContent = getBallSize() + 'px'; sv.style.cssText = 'width:var(--ws-ln-size-value-width);text-align:right;color:var(--ws-accent);font-size:var(--ws-text-base);';
    sl.oninput = () => { applyBallSize(+sl.value); sv.textContent = sl.value + 'px'; };
    sizeRow.appendChild(sl); sizeRow.appendChild(sv); p.appendChild(sizeRow);

    // 按钮容器：确认关闭 + 恢复默认
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:var(--ws-gap);margin-top:var(--ws-panel-padding-md);';

    const confirm = document.createElement('button');
    confirm.textContent = t('menus.launcher.confirmClose');
    confirm.style.cssText = 'flex:1;height:var(--ws-btn-h-sm);border-radius:var(--ws-ln-confirm-radius);border:var(--ws-border-width-thin) solid var(--ws-accent);background:var(--ws-accent);color:var(--ws-text-on-accent);font-size:var(--ws-text-md);cursor:pointer;font-weight:500;';
    confirm.onclick = () => { closeAvatarPanel(); };

    const reset = document.createElement('button');
    reset.textContent = t('menus.launcher.restoreDefault');
    reset.style.cssText = 'flex:1;height:var(--ws-btn-h-sm);border-radius:var(--ws-ln-confirm-radius);border:var(--ws-border-width-thin) solid var(--ws-border);background:var(--ws-surface-2);color:var(--ws-text);font-size:var(--ws-text-md);cursor:pointer;';
    reset.onclick = () => {
        setExpression('idle'); setBallAnim(true); applyBallSize(60); setBallExpMode('fixed');
        cb.checked = true; cbCycle.checked = false; sl.value = String(BALL); sv.textContent = `${BALL}px`; _syncAvatar();
    };

    btnRow.appendChild(confirm);
    btnRow.appendChild(reset);
    p.appendChild(btnRow);

    p._sync = () => {
        BALL_EXPS.forEach(e => {
            const on = getBallExp() === e.id;
            expBtns[e.id].style.borderColor = on ? 'var(--ws-accent)' : 'transparent';
            expBtns[e.id].style.background = on ? 'var(--ws-surface-raised)' : 'var(--ws-surface-2)';
            const ico = expBtns[e.id].querySelector('._exp-ico');
            if (ico) ico.style.color = on ? 'var(--ws-accent)' : 'var(--ws-text-secondary)';
        });
    };
    document.body.appendChild(p);
    return p;
}
function _syncAvatar() { if (_avatarPanel && _avatarPanel._sync) _avatarPanel._sync(); }

// 供统一设置面板复用：只提供参数区，不再创建第二层悬浮窗。
export function buildAvatarSection() {
    const root = document.createElement('div');
    root.className = 'wosai-avatar-section wosai-control-section';
    root.style.cssText = 'display:flex;flex-direction:column;gap:var(--ws-gap-md);';

    const animRow = document.createElement('label');
    animRow.style.cssText = 'display:flex;align-items:center;gap:var(--ws-gap-md);cursor:pointer;';
    const anim = document.createElement('input');
    anim.type = 'checkbox'; anim.checked = getBallAnim();
    anim.style.cssText = 'width:var(--ws-ln-checkbox-size);height:var(--ws-ln-checkbox-size);accent-color:var(--ws-accent);';
    anim.onchange = () => setBallAnim(anim.checked);
    const animLabel = document.createElement('span');
    animLabel.textContent = t('menus.launcher.enableAnimation');
    animRow.append(anim, animLabel); root.appendChild(animRow);

    root.appendChild(_avSec(t('menus.launcher.defaultExpression')));
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--ws-gap);';
    const buttons = new Map();
    const sync = () => {
        buttons.forEach((button, id) => {
            const active = getBallExp() === id;
            button.style.borderColor = active ? 'var(--ws-accent)' : 'transparent';
            button.style.background = active ? 'var(--ws-surface-raised)' : 'var(--ws-surface-2)';
            button.style.color = active ? 'var(--ws-accent)' : 'var(--ws-text)';
        });
    };
    BALL_EXPS.forEach((expression) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.style.cssText = 'display:flex;align-items:center;gap:var(--ws-gap-sm);padding:var(--ws-ln-exp-btn-padding);border-radius:var(--ws-ln-exp-btn-radius);border:var(--ws-ln-exp-btn-border-width) solid transparent;background:var(--ws-surface-2);color:var(--ws-text);cursor:pointer;';
        button.innerHTML = `<span style="line-height:0;flex:none">${expression.ico}</span><span>${t(expression.labelKey)}</span>`;
        button.onclick = () => { setExpression(expression.id); sync(); _syncAvatar(); };
        buttons.set(expression.id, button);
        grid.appendChild(button);
    });
    root.appendChild(grid);

    const cycleRow = document.createElement('label');
    cycleRow.style.cssText = 'display:flex;align-items:center;gap:var(--ws-gap-md);cursor:pointer;';
    const cycle = document.createElement('input');
    cycle.type = 'checkbox'; cycle.checked = getBallExpMode() === 'cycle';
    cycle.style.cssText = 'width:var(--ws-ln-checkbox-size);height:var(--ws-ln-checkbox-size);accent-color:var(--ws-accent);';
    cycle.onchange = () => setBallExpMode(cycle.checked ? 'cycle' : 'fixed');
    const cycleLabel = document.createElement('span');
    cycleLabel.textContent = t('menus.launcher.cycleExpression');
    cycleRow.append(cycle, cycleLabel); root.appendChild(cycleRow);

    root.appendChild(_avSec(t('menus.launcher.ballSize')));
    const sizeRow = document.createElement('div');
    sizeRow.style.cssText = 'display:flex;align-items:center;gap:var(--ws-gap-md);';
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = '44'; slider.max = '96'; slider.step = '2'; slider.value = String(getBallSize());
    slider.style.cssText = 'flex:1;accent-color:var(--ws-accent);';
    const value = document.createElement('span');
    value.textContent = `${getBallSize()}px`; value.style.cssText = 'min-width:var(--ws-ln-size-value-width);text-align:right;color:var(--ws-accent);';
    slider.oninput = () => { applyBallSize(+slider.value); value.textContent = `${slider.value}px`; };
    sizeRow.append(slider, value); root.appendChild(sizeRow);
    root._sync = sync;
    sync();
    return root;
}
export function closeAvatarPanel() {
    if (_avatarPanel) _avatarPanel.style.display = 'none';
    if (_launcher) _launcher.style.pointerEvents = '';
    // Closing settings is the beginning of the silent state. Keep cycling
    // there when the user opted in; only fixed mode must stop the timer.
    if (getBallExpMode() === 'cycle') _startExpCycle();
    else _stopExpCycle();
}
	export function openAvatarPanel() {
	    _startZoomTick();
	    if (_avatarPanel && _avatarPanel.style.display !== 'none') { closeAvatarPanel(); return; }
    if (!_avatarPanel) {
        _avatarPanel = buildAvatarPanel();
        _avatarOutside = (e) => { if (_avatarPanel && _avatarPanel.style.display !== 'none' && !_avatarPanel.contains(e.target) && e.target !== _launcher && !(_launcher && _launcher.contains(e.target))) closeAvatarPanel(); };
        document.addEventListener('pointerdown', _avatarOutside, { capture: true });
        _avatarEscHandler = (e) => { if (e.key === 'Escape') closeAvatarPanel(); };
        document.addEventListener('keydown', _avatarEscHandler);
    }
    _avatarPanel.setAttribute('data-theme', getBarTheme());
    _avatarPanel.style.display = 'block'; _syncAvatar();
    const r = _avatarPanel.getBoundingClientRect();
    _avatarPanel.style.left = Math.round((window.innerWidth - r.width) / 2) + 'px';
    _avatarPanel.style.top = Math.round((window.innerHeight - r.height) / 2) + 'px';
    requestAnimationFrame(() => dodgeBall(_avatarPanel));
}

// ── 设置中心（右键打开）：四项低频配置归口 ──────────────
let _scPanel = null, _scOutside = null, _scEscHandler = null;
const _scIcon = (color, inner) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
// hex(#rrggbb) → rgba 字符串，用于图标淡色底/选中态描边
const _hexA = (hex, a) => {
  // 运行时根据用户数据/皮肤色动态计算带透明度的颜色，无法静态 token 化
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
};
let _scActiveId = null;   // 当前打开的子面板 id（用于设置中心选中态高亮）
let _scLauncherAligned = false;  // 悬浮球是否已与设置中心对齐（本次会话只需对齐一次）
const _settingsShortcutLabel = (key, shortcut) => `${t(key)}（${shortcut}）`;
const _SC_ITEMS = [
    { id: 'avatar', label: _settingsShortcutLabel('menus.launcher.settingsAvatar', 'X'), desc: t('menus.launcher.settingsAvatarDesc'),   color: 'var(--ws-ln-settings-cat-avatar)',
      icon: '<circle cx="12" cy="12" r="9"/><path d="M9 14.5c1 1.2 5 1.2 6 0"/><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1" fill="currentColor" stroke="none"/>',
      open: () => openAvatarPanel() },
    { id: 'bg', label: _settingsShortcutLabel('menus.launcher.settingsBackground', 'B'), desc: t('menus.launcher.settingsBackgroundDesc'), color: 'var(--ws-ln-settings-cat-bg)',
      icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.6"/><path d="M21 15l-5-4L5 20"/>',
      open: () => getHudTab('bg')?.panel?.() },
    { id: 'fx', label: _settingsShortcutLabel('menus.launcher.settingsLinkFx', 'L'), desc: t('menus.launcher.settingsLinkFxDesc'),   color: 'var(--ws-ln-settings-cat-fx)',
      icon: '<path d="M9.5 14.5l5-5"/><path d="M12 7l1-1a3.2 3.2 0 0 1 4.5 4.5l-1 1"/><path d="M12 17l-1 1a3.2 3.2 0 0 1-4.5-4.5l1-1"/>',
      open: () => getHudTab('fx')?.panel?.() },
    { id: 'settings', label: _settingsShortcutLabel('menus.launcher.settingsSystem', 'S'), desc: t('menus.launcher.settingsSystemDesc'),  color: 'var(--ws-ln-settings-cat-system)',
      icon: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
      open: () => getHudTab('settings')?.panel?.() },
];

const _SC_CONTROL_BY_ID = Object.freeze({
    avatar: 'avatar',
    bg: 'background',
    fx: 'link-fx',
    settings: 'settings',
});

function _closeSettingsCenterTargetPanels() {
    const controls = new Set(Object.values(_SC_CONTROL_BY_ID));
    document.querySelectorAll('[data-ws-control]').forEach((panel) => {
        if (!controls.has(panel.dataset.wsControl)) return;
        panel.style.display = 'none';
        panel.style.opacity = '';
        panel.style.pointerEvents = '';
    });
}
function buildSettingsCenter() {
    const T = barT();
    const p = document.createElement('div');
    p.setAttribute('data-wosai-panel', '');
    p.setAttribute('data-theme', getBarTheme());
    p.style.cssText = `position:fixed;display:none;z-index:var(--ws-z-hud);width:var(--ws-ln-settings-panel-width);box-sizing:border-box;padding:var(--ws-gap);border-radius:var(--ws-ln-panel-radius);background:${T.glass};backdrop-filter:${T.blur};-webkit-backdrop-filter:${T.blur};border:${T.border};box-shadow:${T.shadow};color:var(--ws-text);font-family:var(--ws-font-family);user-select:none;`;
    p.onpointerdown = (e) => e.stopPropagation();
    const head = document.createElement('div'); head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:var(--ws-ln-settings-head-padding);margin-bottom:var(--ws-gap-sm);';
    head.innerHTML = `<span style="font-size:var(--ws-ln-settings-title-font);font-weight:500;color:var(--ws-text)">${t('menus.launcher.settingsCenter')}</span>`;
    const x = document.createElement('div'); x.textContent = '×'; x.style.cssText = 'cursor:pointer;width:var(--ws-ln-close-size);height:var(--ws-ln-close-size);display:flex;align-items:center;justify-content:center;border-radius:var(--ws-ln-close-radius);font-size:var(--ws-text-xl);line-height:1;color:var(--ws-text-secondary);background:var(--ws-surface-2);transition:background .15s;';
    x.onmouseenter = () => x.style.background = 'var(--ws-ln-hover-bg)';
    x.onmouseleave = () => x.style.background = 'var(--ws-surface-2)';
    x.onclick = closeSettingsCenter; head.appendChild(x); p.appendChild(head);
    _scRows = [];
    _SC_ITEMS.forEach(it => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:var(--ws-gap-lg);padding:var(--ws-ln-settings-row-padding);border-radius:var(--ws-radius-lg);cursor:pointer;background:transparent;border:var(--ws-ln-settings-row-border-width) solid transparent;margin-top:var(--ws-gap-xs);transition:background .15s,border-color .15s;';
        row.innerHTML = `<span class="_sc-ico" style="width:var(--ws-ln-settings-icon-size);flex:none;display:flex;align-items:center;justify-content:center;color:var(--ws-text-secondary)">${_scIcon('currentColor', it.icon)}</span><span style="flex:1;min-width:0"><span style="display:block;font-size:var(--ws-text-md);color:var(--ws-text);margin-bottom:var(--ws-gap-xs)">${it.label}</span><span style="display:block;font-size:var(--ws-text-sm);color:var(--ws-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${it.desc}</span></span><span class="_sc-chev" style="flex:none;color:var(--ws-text-muted);display:flex">${_scIcon('currentColor', '<polyline points="9 6 15 12 9 18"/>')}</span>`;
        row.onmouseenter = () => { if (_scActiveId !== it.id) row.style.background = 'var(--ws-ln-settings-row-hover-bg)'; };
        row.onmouseleave = () => { if (_scActiveId !== it.id) row.style.background = 'transparent'; };
        row.onclick = () => {
            _scActiveId = it.id;
            _scSyncActive();
            // 先真正关闭四类目标面板，再打开当前项：避免 toggle 逻辑将旧的透明面板误判为已打开。
            _closeSettingsCenterTargetPanels();
            it.open();
            const control = _SC_CONTROL_BY_ID[it.id];
            requestAnimationFrame(() => requestAnimationFrame(() => {
                _placeSubPanelBesideSC(document.querySelector(`[data-ws-control="${control}"]`));
            }));
        };   // 记录选中态；不关设置中心；子面板贴外侧弹出
        _scRows.push({ id: it.id, color: it.color, row });
        p.appendChild(row);
    });
    document.body.appendChild(p);
    _scSyncActive();
    return p;
}
let _scRows = [];
// 同步设置中心选中态：当前项 = 同色淡底 + 同色细描边 + 彩色箭头；其余项还原透明
function _scSyncActive() {
    _scRows.forEach(({ id, color, row }) => {
        const chev = row.querySelector('._sc-chev');
        const ico = row.querySelector('._sc-ico');
        if (id === _scActiveId) {
            row.style.background = _hexA(color, .12);
            row.style.borderColor = _hexA(color, .38);
            if (chev) chev.style.color = color;
            if (ico) ico.style.color = 'var(--ws-text)';   // 选中：图标提亮（仍单色）
        } else {
            row.style.background = 'transparent';
            row.style.borderColor = 'transparent';
            if (chev) chev.style.color = 'var(--ws-text-muted)';
            if (ico) ico.style.color = 'var(--ws-text-secondary)';
        }
    });
}
// 把刚打开的子面板（形象/背景/连线/系统，均带 data-wosai-panel）重定位到设置中心外侧，
// 使「悬浮球 → 设置中心 → 子面板」三者保持均匀的 14px 边距（链式排开）。
const SC_GAP = 14;
function _placeSubPanelBesideSC(sub) {
    if (!_scPanel || _scPanel.style.display === 'none' || !sub || getComputedStyle(sub).display === 'none') return;
    const scR = _scPanel.getBoundingClientRect();
    const sr = sub.getBoundingClientRect();
    // 默认从设置中心「右侧」展开（与行尾 › 箭头方向一致）；右侧放不下才翻到左侧
    let side = 'right';
    let left = scR.right + SC_GAP;
    if (left + sr.width > window.innerWidth - 8) { side = 'left'; left = scR.left - sr.width - SC_GAP; }
    let top = scR.top + scR.height / 2 - sr.height / 2; // 与设置中心垂直居中对齐
    left = Math.max(8, Math.min(left, window.innerWidth - sr.width - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - sr.height - 8));
    // 入场动效：从设置中心一侧轻微滑入 + 淡入（用 left 而非 transform，避免与面板自身 transform 居中冲突）
    const off = side === 'right' ? -14 : 14;
    sub.style.transition = 'none';
    sub.style.opacity = '0';
    sub.style.top = Math.round(top) + 'px';
    sub.style.left = Math.round(left + off) + 'px';
    void sub.offsetWidth;                              // 强制回流，锁定起点
    sub.style.transition = 'left .28s cubic-bezier(.22,1,.36,1), opacity .22s ease';
    sub.style.left = Math.round(left) + 'px';
    sub.style.opacity = '1';
    sub.style.pointerEvents = '';   // 恢复交互（onclick 时设为 none 防闪烁）
    // 悬浮球移到子面板对侧 →「悬浮球 | 设置中心 | 子面板」链式，球不再遮挡面板
    //   仅首次打开时对齐一次；后续切换选项不再移动（避免跳动）
    if (_launcher && !_scLauncherAligned) {
        _scLauncherAligned = true;
        const br = _launcher.getBoundingClientRect();
        let bx = side === 'right' ? (scR.left - br.width - SC_GAP) : (scR.right + SC_GAP);
        let by = scR.top + scR.height / 2 - br.height / 2;
        bx = Math.max(8, Math.min(bx, window.innerWidth - br.width - 8));
        by = Math.max(8, Math.min(by, window.innerHeight - br.height - 8));
        _launcher.style.transition = 'left .28s cubic-bezier(.22,1,.36,1), top .28s cubic-bezier(.22,1,.36,1)';
        _launcher.style.left = Math.round(bx) + 'px';
        _launcher.style.top = Math.round(by) + 'px';
        setTimeout(() => { if (_launcher) _launcher.style.transition = 'transform .18s,filter .18s,opacity .5s ease'; }, 320);
    }
}
export function closeSettingsCenter() { if (_scPanel) _scPanel.style.display = 'none'; _scActiveId = null; _scLauncherAligned = false; _scSyncActive(); if (_launcher) _launcher.style.pointerEvents = ''; }
export function openSettingsCenter() {
    if (_scPanel && _scPanel.style.display !== 'none') { closeSettingsCenter(); return; }
    if (!_scPanel) {
        _scPanel = buildSettingsCenter();
        // 点击设置中心外才关闭；但点进任一 WOSAI 面板（形象/背景/连线/系统 子面板，均带 data-wosai-panel）时保持常驻
        _scOutside = (e) => { if (_scPanel && _scPanel.style.display !== 'none' && !_scPanel.contains(e.target) && e.target !== _launcher && !(_launcher && _launcher.contains(e.target)) && !e.target.closest?.('[data-wosai-panel]')) closeSettingsCenter(); };
        document.addEventListener('pointerdown', _scOutside, { capture: true });
        _scEscHandler = (e) => { if (e.key === 'Escape') closeSettingsCenter(); };
        document.addEventListener('keydown', _scEscHandler);
    }
    _scPanel.setAttribute('data-theme', getBarTheme());
    _scPanel.style.display = 'block';
    const r = _scPanel.getBoundingClientRect();
    // 贴着悬浮球的左/右侧弹出：球在右半屏→放左侧，球在左半屏→放右侧；放不下则翻到另一侧；垂直与球居中对齐
    const lr = _launcher ? _launcher.getBoundingClientRect() : null;
    const gap = 14;
    let left, top;
    if (lr && lr.width) {
        const ballCx = lr.left + lr.width / 2;
        if (ballCx > window.innerWidth / 2) {
            left = lr.left - r.width - gap;                                   // 球偏右 → 面板放左侧
            if (left < 8) left = lr.right + gap;                             // 左侧放不下 → 翻右侧
        } else {
            left = lr.right + gap;                                           // 球偏左 → 面板放右侧
            if (left + r.width > window.innerWidth - 8) left = lr.left - r.width - gap;
        }
        top = lr.top + lr.height / 2 - r.height / 2;                         // 与球垂直居中
    } else {
        left = (window.innerWidth - r.width) / 2;
        top = (window.innerHeight - r.height) / 2;
    }
    _scPanel.style.left = Math.round(Math.max(8, Math.min(left, window.innerWidth - r.width - 8))) + 'px';
    _scPanel.style.top = Math.round(Math.max(8, Math.min(top, window.innerHeight - r.height - 8))) + 'px';
}

// ── 子球系统 ────────────────────────────────────────────
let _orbs = [], _wingsOpen = false;
let _orbsFromKeyboard = false;   // 子球是否由快捷键呼出（决定 HUD 栏定位：true→悬浮球上方居中）
let _hoveredOrb = null;   // 当前悬停的子球，避免跨球闪烁
export function orbsFromKeyboard() { return _orbsFromKeyboard; }
let _dashLine = null;     // 悬浮球到子球的虚线连接
const _ORB_DESC = {
    color: t('menus.launcher.orbTipColor'),
    align: t('menus.launcher.orbTipAlign'),
    node: t('menus.launcher.orbTipNode'),
    fx: t('menus.launcher.orbTipFx'),
    bg: t('menus.launcher.orbTipBg'),
    settings: t('menus.launcher.orbTipSettings'),
    avatar: t('menus.launcher.orbTipAvatar'),
};
const _ORB_DEFBG = 'conic-gradient(from 210deg,var(--ws-ln-orb-def-c1),var(--ws-ln-orb-def-c2),var(--ws-ln-orb-def-c3),var(--ws-ln-orb-def-c4),var(--ws-ln-orb-def-c5),var(--ws-ln-orb-def-c6),var(--ws-ln-orb-def-c1))';
const _ORB_SKIN = {
    color:    { bg: 'radial-gradient(circle at 40% 36%,var(--ws-ln-orb-color-start) 0%,var(--ws-ln-orb-color-mid1) 42%,var(--ws-ln-orb-color-mid2) 74%,var(--ws-ln-orb-color-end) 100%)', glow: 'var(--ws-ln-orb-color-glow)', halo: 'var(--ws-ln-orb-color-halo)', tip: 'var(--ws-ln-orb-color-tip)' },   // 配色 → 鲜明品红
    align:    { bg: 'radial-gradient(circle at 40% 36%,var(--ws-ln-orb-align-start) 0%,var(--ws-ln-orb-align-mid1) 42%,var(--ws-ln-orb-align-mid2) 74%,var(--ws-ln-orb-align-end) 100%)', glow: 'var(--ws-ln-orb-align-glow)', halo: 'var(--ws-ln-orb-align-halo)', tip: 'var(--ws-ln-orb-align-tip)' },   // 对齐 → 鲜明亮蓝
    node:     { bg: 'radial-gradient(circle at 40% 36%,var(--ws-ln-orb-node-start) 0%,var(--ws-ln-orb-node-mid1) 42%,var(--ws-ln-orb-node-mid2) 74%,var(--ws-ln-orb-node-end) 100%)', glow: 'var(--ws-ln-orb-node-glow)', halo: 'var(--ws-ln-orb-node-halo)', tip: 'var(--ws-ln-orb-node-tip)' },   // 节点 → 鲜明暖橙
    search:   { bg: 'linear-gradient(135deg,var(--ws-ln-orb-search-start),var(--ws-ln-orb-search-end))', glow: 'var(--ws-ln-orb-search-glow)', tip: 'var(--ws-ln-orb-search-tip)' },
    settings: { bg: 'linear-gradient(135deg,var(--ws-ln-orb-purple-start),var(--ws-ln-orb-purple-mid))', glow: 'var(--ws-ln-orb-purple-glow)', tip: 'var(--ws-ln-orb-purple-tip)' },
    bg:       { bg: 'linear-gradient(135deg,var(--ws-ln-orb-purple-light-start),var(--ws-ln-orb-purple-light-mid))', glow: 'var(--ws-ln-orb-purple-light-glow)', tip: 'var(--ws-ln-orb-purple-tip)' },
    fx:       { bg: 'linear-gradient(135deg,var(--ws-ln-orb-purple-deep-start),var(--ws-ln-orb-purple-deep-mid))', glow: 'var(--ws-ln-orb-purple-deep-glow)', tip: 'var(--ws-ln-orb-purple-tip)' },
    avatar:   { bg: 'linear-gradient(135deg,var(--ws-ln-orb-purple-pale-start),var(--ws-ln-orb-purple-pale-mid))', glow: 'var(--ws-ln-orb-purple-pale-glow)', tip: 'var(--ws-ln-orb-purple-tip)' },
    favorite: { bg: 'radial-gradient(circle at 40% 36%,var(--ws-ln-orb-fav-start) 0%,var(--ws-ln-orb-fav-mid1) 42%,var(--ws-ln-orb-fav-mid2) 74%,var(--ws-ln-orb-fav-end) 100%)', glow: 'var(--ws-ln-orb-fav-glow)', halo: 'var(--ws-ln-orb-fav-halo)', tip: 'var(--ws-ln-orb-fav-tip)' },   // 收藏 → 鲜明翠绿
};

// ── 8 子球定义（交替排布：彩色 / 灰色）────────────────
const _ORB_TABS = [
    { id: 'color',    label: t('menus.launcher.orbLabelColor'), en: 'Color',   shortcut: 'P', small: false },
    { id: 'fx',       label: t('menus.launcher.orbLabelLink'), en: 'FX',      shortcut: 'L', small: true },
    { id: 'align',    label: t('menus.launcher.orbLabelAlign'), en: 'Align',   shortcut: 'D', small: false },
    { id: 'settings', label: t('menus.launcher.orbLabelSettings'), en: 'Setting', shortcut: 'S', small: true },
    { id: 'node',     label: t('menus.launcher.orbLabelNode'), en: 'Node',    shortcut: 'J', small: false },
    { id: 'bg',       label: t('menus.launcher.orbLabelBg'), en: 'BG',      shortcut: 'B', small: true },
    { id: 'avatar',   label: t('menus.launcher.orbLabelAvatar'), en: 'Avatar',  shortcut: 'X', small: true },
    { id: 'favorite', label: t('menus.launcher.orbLabelFavorite'), en: 'Fav',     shortcut: 'C', small: false },
];
// 左键扇形菜单：仅高频四项（从上到下：收藏 / 配色 / 对齐 / 节点）
const _FAN_IDS = ['favorite', 'color', 'align', 'node'];
export function getOrbTabs() { return _ORB_TABS; }
const _ORB_SHORTCUT = Object.fromEntries(_ORB_TABS.map(t => [t.id, t.shortcut]));

// ── 8 方向智能扇面方向（根据悬浮球在视口中的位置自动选择最优展开方向） ──
function _smartBaseAng(cx, cy) {
    return smartFanAngle(cx, cy, window.innerWidth, window.innerHeight);
}
const _ORB_EN     = Object.fromEntries(_ORB_TABS.map(t => [t.id, t.en]));
const _ORB_SMALL  = new Set(_ORB_TABS.filter(t => t.small).map(t => t.id));

function _ensureDashLine() {
    if (_dashLine) return;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('id', 'wosai-dash-line');
    svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:var(--ws-z-flash);pointer-events:none;display:none;';
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('stroke', 'var(--ws-ln-dash-line-color)');
    line.setAttribute('stroke-dasharray', '5,5');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);
    document.body.appendChild(svg);
    _dashLine = svg;
}
function _showDashLine(x1, y1, x2, y2) {
    _ensureDashLine();
    const line = _dashLine.firstChild;
    line.setAttribute('x1', String(Math.round(x1)));
    line.setAttribute('y1', String(Math.round(y1)));
    line.setAttribute('x2', String(Math.round(x2)));
    line.setAttribute('y2', String(Math.round(y2)));
    _dashLine.style.display = 'block';
}
function _hideDashLine() {
    if (_dashLine) _dashLine.style.display = 'none';
}

function _ensureOrbAnim() {
    if (document.getElementById('wosai-orb-anim')) return;
    const s = document.createElement('style');
    s.id = 'wosai-orb-anim';
    s.textContent = '@keyframes wosaiOrbGlint{to{transform:rotate(360deg)}}';
    document.head.appendChild(s);
}
function _orbCore(label, mode) {
    const light = getBarTheme() === 'light';
    const core = document.createElement('div');
    const sk = _ORB_SHORTCUT[mode] || '';
    const isSmall = _ORB_SMALL.has(mode);
    const cnFs = isSmall ? 10 : 12;   // 中文横版字号
    const skFs = isSmall ? 11 : 14;   // 快捷键字号
    // ── 上方快捷键 + 下方中文，均横版，垂直居中 ──
    core.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--ws-gap-2xs)">
        ${sk ? `<span style="font-size:${skFs}px;line-height:1;font-weight:400;opacity:0.72">${sk}</span>` : ''}
        <span style="font-size:${cnFs}px;line-height:1.1;font-weight:400;letter-spacing:var(--ws-ln-orb-label-spacing)">${label}</span>
    </div>`;
    const coreBg = light
        ? 'var(--ws-ln-orb-core-light)'
        : 'var(--ws-ln-orb-core-dark)';
    core.style.cssText = `position:absolute;inset:var(--ws-ln-orb-core-inset);border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--ws-font-family);color:${light ? 'var(--ws-ln-orb-core-text-light)' : 'var(--ws-ln-orb-core-text-dark)'};background:${coreBg};backdrop-filter:var(--ws-ln-orb-core-blur);-webkit-backdrop-filter:var(--ws-ln-orb-core-blur);box-shadow:var(--ws-ln-orb-core-inset-shadow);pointer-events:none;`;
    return core;
}
// 子球过渡：弹出用慢弹性(.52s)更丝滑；悬停/切换用快速(.16s) 纯 transform 不拖沓
const _ORB_POP_TRANS   = 'opacity .18s ease, transform .35s cubic-bezier(.33,1.18,.5,1), box-shadow .12s, filter .15s';
const _ORB_HOVER_TRANS = 'transform .16s ease-out, box-shadow .15s, filter .16s, opacity .16s';

function _makeOrb(label, mode, size) {
    _ensureOrbAnim();
    const baseSz = size || ORB;
    const esz = _effectiveOrb(baseSz);
    const skin = _ORB_SKIN[mode] || {};
    const bg = skin.bg || _ORB_DEFBG;
    const glow = skin.glow || 'var(--ws-ln-orb-default-glow)';
    const o = document.createElement('div');
    o.setAttribute('data-wosai-panel', '');
    // 子球是功能入口而非玻璃面板，避免全局玻璃兜底覆盖专属彩色渐变。
    o.setAttribute('data-wosai-orb', '');
    const baseShadow = (skin.halo ? skin.halo + ',' : '') + 'var(--ws-ln-orb-shadow)';   // 天体常驻光晕 + 落影
    o.style.cssText = `position:fixed;z-index:var(--ws-z-hud);display:none;overflow:hidden;width:${esz}px;height:${esz}px;border-radius:50%;background:${bg};box-shadow:${baseShadow};cursor:pointer;opacity:0;transform:scale(.5);transition:${_ORB_POP_TRANS};`;
    o._baseSize = baseSz;
    o._baseShadow = baseShadow;
    const glint = document.createElement('div');
    glint.style.cssText = 'position:absolute;inset:-20%;border-radius:50%;pointer-events:none;background:conic-gradient(from 0deg,transparent 0 68%,var(--ws-ln-orb-glint) 84%,transparent 98% 100%);mix-blend-mode:screen;animation:wosaiOrbGlint 3.2s linear infinite;';
    o.appendChild(glint);
    o.appendChild(_orbCore(label, mode));
    if (skin.deco) {   // 行星表面特征（地球绿陆 / 月球环形坑）叠在最上层、贴边缘排布，不挡中央文字
        const d = document.createElement('div');
        d.style.cssText = 'position:absolute;inset:0;border-radius:50%;overflow:hidden;pointer-events:none;';
        d.innerHTML = skin.deco;
        o.appendChild(d);
    }
    o.onmouseenter = () => {
        // 切换悬停：仅复位上一颗（纯 transform，无重排）
        if (_hoveredOrb && _hoveredOrb !== o) {
            _hoveredOrb.style.transform = 'translate(0,0) scale(1)';
            _hoveredOrb.style.boxShadow = _hoveredOrb._baseShadow || 'var(--ws-ln-orb-shadow)';
            _hoveredOrb.style.filter = '';
            _hoveredOrb.style.opacity = '1';
            _hoveredOrb.style.zIndex = '100001';
        }
        _hoveredOrb = o;
        // 强制切换到 HOVER 过渡（弹出动画 350ms 仍在进行时也立刻切换），
        // 避免用 POP_TRANS(350ms) 跑 hoverScale，导致 DOM 命中区与视觉位置错位而点空气
        o.style.transition = _ORB_HOVER_TRANS;
        // 悬停放大（视觉尺寸统一），纯 transform → GPU 合成、不触发布局重排，消除卡顿
        const hoverScale = (ORB * 1.2 / (o._baseSize || ORB)).toFixed(3);
        o.style.transform = `translate(0,0) scale(${hoverScale})`;
        o.style.boxShadow = `var(--ws-ln-orb-hover-shadow-offset) ${glow}`;
        o.style.filter = '';
        o.style.opacity = '1';
        o.style.zIndex = '100002';   // 置顶，避免被相邻球边缘压住
        // 其他子球：轻缩 + 灰度 + 降透明，全部走 transform/filter/opacity（不改尺寸/位置）
        _orbs.forEach(r => {
            if (r.el !== o) {
                r.el.style.transition = _ORB_HOVER_TRANS;
                r.el.style.transform = 'translate(0,0) scale(.86)';
                r.el.style.filter = 'grayscale(100%)';
                r.el.style.opacity = '0.45';
                r.el.style.zIndex = '100001';
            }
        });
        // 悬浮球边缘 → 子球边缘 虚线连接
        if (_launcher && _wingsOpen) {
            const br = _launcher.getBoundingClientRect();
            const bcx = br.left + br.width / 2;
            const bcy = br.top + br.height / 2;
            const od = _orbs.find(r => r.el === o);
            if (od) {
                const ballR = _effectiveBall() / 2;
                const orbR  = _effectiveOrb(o._baseSize || ORB) / 2;
                const dx = od.cx - bcx, dy = od.cy - bcy;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const ux = dx / dist, uy = dy / dist;
                _showDashLine(
                    bcx + ux * ballR, bcy + uy * ballR,   // 悬浮球边缘
                    od.cx - ux * orbR, od.cy - uy * orbR   // 子球边缘
                );
            }
        }
    };
    o.onmouseleave = () => {
        if (_hoveredOrb !== o) return;  // 已被其他子球接管，跳过恢复
        _hoveredOrb = null;
        _hideDashLine();
        // 复位所有子球（纯 transform/filter/opacity，无重排）
        _orbs.forEach(r => {
            r.el.style.transform = 'translate(0,0) scale(1)';
            r.el.style.filter = '';
            r.el.style.opacity = '1';
            r.el.style.boxShadow = r.el._baseShadow || 'var(--ws-ln-orb-shadow)';
            r.el.style.zIndex = '100001';
        });
    };
    o.onclick = (e) => {
        e.stopPropagation();
        // 对齐子球直接打开节点对齐面板，不再进入融合 HUD 工具栏。
        if (mode === 'align') {
            window.__wosaiOpenAlignPanel?.();
            return;
        }
        const t = getHudTab(mode);
        if (t && t.panel) t.panel();
        else _ctx.openTab?.(mode);
    };
    document.body.appendChild(o);
    return o;
}
function _orbTabs() { return _ORB_TABS; }
function _hideOrbs() {
    _wingsOpen = false;
    _orbsFromKeyboard = false;
    _hoveredOrb = null; hideTip();
    if (_launcher) _launcher.style.opacity = '1';
    _orbs.forEach(o => { o.el.style.transition = _ORB_POP_TRANS; o.el.style.transitionDelay = '0ms'; o.el.style.opacity = '0'; o.el.style.transform = (o.tx || 'translate(0,0)') + ' scale(.25)'; });
    setTimeout(() => { if (!_wingsOpen) _orbs.forEach(o => { o.el.style.display = 'none'; }); }, 440);
}
function _showOrbs() {
    if (!_launcher) return;
    const tabs = _orbTabs();
    // sameSet：既要 tab 列表相同，也要每个 orb 的 baseSize 与当前 ORB/ORB_SM 一致
    const _orbDef = (t) => t.small ? ORB_SM : ORB;
    const sameSet = _orbs.length === tabs.length
        && _orbs.every((o, i) => o.mode === tabs[i].id && o.baseSize === _orbDef(tabs[i]));
    if (!sameSet) {
        _orbs.forEach(o => o.el.remove());
        _orbs = tabs.map(t => {
            const sz = _orbDef(t);
            const el = _makeOrb(t.label, t.id, sz);
            el._shortcut = t.shortcut;
            return { el, mode: t.id, size: _effectiveOrb(sz), baseSize: sz, shortcut: t.shortcut, _isBig: !t.small };
        });
    }
    _wingsOpen = true;
    _launcher.style.opacity = '1';   // 展开子球时保持球体不透明（不再淡化）
    const r = _launcher.getBoundingClientRect(), gap = 18;
    let cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const maxOrbSz = Math.max(..._orbs.map(o => o.size), 0) || ORB;
    const orbOuterOffset = 14, orbInnerOffset = -10;
    const baseR = _effectiveBall() / 2 + gap + maxOrbSz / 2, N = _orbs.length;
    const outerR = baseR + orbOuterOffset, M = 6 + maxOrbSz / 2 + orbOuterOffset;
    if (cx - outerR < M) cx += M - (cx - outerR);
    else if (cx + outerR > window.innerWidth - M) cx -= (cx + outerR) - (window.innerWidth - M);
    if (cy - outerR < M) cy += M - (cy - outerR);
    else if (cy + outerR > window.innerHeight - M) cy -= (cy + outerR) - (window.innerHeight - M);
    _orbs.forEach((o, i) => {
        const ang = Math.PI + i * (2 * Math.PI / N);
        const dx = Math.cos(ang), dy = Math.sin(ang);
        const orbR = o._isBig ? baseR + orbOuterOffset : baseR + orbInnerOffset;
        const ox = cx + orbR * dx, oy = cy + orbR * dy;
        const sz = o.size;
        o.cx = ox; o.cy = oy;                        // 存储圆心，hover 时直接使用
        o.tx = `translate(${(cx - ox).toFixed(1)}px, ${(cy - oy).toFixed(1)}px)`;   // 起/收点 = 悬浮球中心
        o.el.style.left = Math.round(ox - sz / 2) + 'px'; o.el.style.top = Math.round(oy - sz / 2) + 'px';
        o.el.style.transformOrigin = '50% 50%'; o.el.style.display = 'block';
        o.el.style.opacity = '0'; o.el.style.transform = o.tx + ' scale(.2)';   // 从球心、缩小态起步
    });
    requestAnimationFrame(() => { _orbs.forEach((o, i) => { o.el.style.transition = _ORB_POP_TRANS; o.el.style.transitionDelay = (i * 35) + 'ms'; o.el.style.opacity = '1'; o.el.style.transform = 'translate(0,0) scale(1)'; }); setTimeout(() => _orbs.forEach(o => { o.el.style.transition = _ORB_HOVER_TRANS; o.el.style.transitionDelay = '0ms'; }), 350 + 35 * _orbs.length + 80); });
}
export function hideOrbsIfOpen() { if (_wingsOpen) _hideOrbs(); }

// ── 获取最顶部子球位置（供 HUB 栏定位锚定用） ─────────
export function getTopOrbPosition() {
    if (!_orbs.length || !_orbs[0].el) return null;
    const top = _orbs.reduce((a, b) => (a.cy < b.cy ? a : b));   // cy 最小 = 最上方
    const r = top.el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, cx: top.cx, cy: top.cy };
}
export function getColorOrbPosition() { return getTopOrbPosition(); }   // 兼容别名
export function isWingsOpen() { return _wingsOpen; }

// ── 获取所有可见子球 + 悬浮球的包围盒（供 HUB 栏定位，避免遮挡任何子球） ──
export function getOrbsBoundingBox() {
    const rects = [];
    if (_launcher) rects.push(_launcher.getBoundingClientRect());
    for (const o of _orbs) {
        if (o.el && o.el.style.display !== 'none') rects.push(o.el.getBoundingClientRect());
    }
    return enclosingRect(rects);
}

// ── 获取 orbTip 位置（供 HUB 栏避让用，已废弃：提示文字已移除） ─────────────────

// ── Q 键：悬浮球居中 + 展开子球 ─────────────────────────
export function centerAndShowOrbs() {
    if (!_launcher) return;
    // 脱离侧边吸附
    if (_isSideSnapped) { _isSideSnapped = false; _snapSide = null; _clearSnapState(); _snapTransform = ''; if (_launcher) _launcher.style.transform = ''; }
    const eff = _effectiveBall();
    const cx = (window.innerWidth - eff) / 2;
    const cy = (window.innerHeight - eff) / 2;
    const bcx = cx + eff / 2, bcy = cy + eff / 2;

    // 已居中 → toggle 子球展开/关闭
    const r = _launcher.getBoundingClientRect();
    const curCx = r.left + r.width / 2, curCy = r.top + r.height / 2;
    const dist = Math.hypot(curCx - bcx, curCy - bcy);
    if (dist < 40) {
        if (_wingsOpen) {
            _hideOrbs();
        } else {
            _showLimitedOrbs(_FAN_IDS, bcx, bcy, true);   // 快捷键呼出
        }
        return;
    }

    // 未居中 → 移到中央 + 展开子球
    _launcher.style.transition = 'left .35s cubic-bezier(.34,1.56,.64,1), top .35s cubic-bezier(.34,1.56,.64,1), transform .18s,filter .18s,opacity .5s ease';
    _launcher.style.left = cx + 'px';
    _launcher.style.top = cy + 'px';
    _launcher.style.opacity = '1';
    _launcher.style.cursor = 'grab';
    saveLauncherPos({ x: cx, y: cy });
    if (_wingsOpen) {
        _orbsFromKeyboard = true;   // 快捷键呼出（已展开 → 仅重排）
        requestAnimationFrame(() => _recalcOrbs(bcx, bcy));
    } else {
        _showLimitedOrbs(_FAN_IDS, bcx, bcy, true);   // 快捷键呼出
    }
    // 恢复默认过渡
    setTimeout(() => { if (_launcher) _launcher.style.transition = 'transform .18s,filter .18s,opacity .5s ease'; }, 400);
}

// 按指定 ID 列表弹出子球（等角度环绕主球，动态适配任意数量）
function _showLimitedOrbs(ids, cxOverride, cyOverride, fromKb) {
    if (!_launcher) return;
    _orbsFromKeyboard = !!fromKb;
    const tabs = ids.map(id => _ORB_TABS.find(t => t.id === id)).filter(Boolean);
    if (!tabs.length) return;
    // sameSet：既要 tab 列表相同，也要每个 orb 的 baseSize 与当前 ORB/ORB_SM 一致
    const sameSet = _orbs.length === tabs.length
        && _orbs.every((o, i) => o.mode === tabs[i].id && o.baseSize === (tabs[i].small ? ORB_SM : ORB));
    if (!sameSet) {
        _orbs.forEach(o => o.el.remove());
        _orbs = tabs.map(t => {
            const sz = t.small ? ORB_SM : ORB;
            const el = _makeOrb(t.label, t.id, sz);
            el._shortcut = t.shortcut;
            return { el, mode: t.id, size: _effectiveOrb(sz), baseSize: sz, shortcut: t.shortcut, _isBig: !t.small };
        });
    }
    _wingsOpen = true;
    _launcher.style.opacity = '1';   // 展开子球时保持球体不透明（不再淡化）
    let cx, cy;
    if (cxOverride !== undefined && cyOverride !== undefined) {
        cx = cxOverride; cy = cyOverride;
    } else {
        const r = _launcher.getBoundingClientRect();
        cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    }
    const gap = 18;
    const maxOrbSz = Math.max(..._orbs.map(o => o.size), 0) || ORB;
    const orbOuterOffset = 14, orbInnerOffset = -10;
    let baseR = _effectiveBall() / 2 + gap + maxOrbSz / 2;
    const N = _orbs.length;
    const outerR = baseR + orbOuterOffset, M = 6 + maxOrbSz / 2 + orbOuterOffset;
    if (cx - outerR < M) cx += M - (cx - outerR);
    else if (cx + outerR > window.innerWidth - M) cx -= (cx + outerR) - (window.innerWidth - M);
    if (cy - outerR < M) cy += M - (cy - outerR);
    else if (cy + outerR > window.innerHeight - M) cy -= (cy + outerR) - (window.innerHeight - M);
    // ── 边缘自适应：垂直空间不足时按比例缩短展开半径（避免顶部重叠 / 底部偏离）──
    const safeTop = cy - M;
    const safeBottom = window.innerHeight - cy - M;
    const dirY = Math.sin(_smartBaseAng(cx, cy));
    const primarySpace = (dirY >= 0) ? safeBottom : safeTop;
    if (primarySpace < outerR * 1.1 && primarySpace > 30) {
        const scale = Math.max(0.52, Math.min(1, primarySpace / (outerR * 1.3)));
        baseR *= scale;
    }
    // 扇形展开方向：8 方向智能判定（根据悬浮球在视口位置自动选择最优方向）
    const baseAng = _smartBaseAng(cx, cy);
    // 修正：当扇面指向左侧时（cos < 0），角度递增在屏幕坐标中是「从下到上」，
    // 需要反转数组索引使视觉顺序始终保持「从上到下」。
    const flipVertical = Math.cos(baseAng) < 0;
    const SPREAD = N > 1 ? Math.min((N - 1) * 0.85, 2.6) : 0;
    _orbs.forEach((o, i) => {
        const idx = flipVertical ? (N - 1 - i) : i;
        const ang = N > 1 ? (baseAng - SPREAD / 2 + idx * (SPREAD / (N - 1))) : baseAng;   // 以基准方向为中心对称展开（扇形）
        const dx = Math.cos(ang), dy = Math.sin(ang);
        const orbR = o._isBig ? baseR + orbOuterOffset : baseR + orbInnerOffset;
        const ox = cx + orbR * dx, oy = cy + orbR * dy;
        const sz = o.size;
        o.cx = ox; o.cy = oy;                        // 存储圆心，hover 时直接使用
        o.tx = `translate(${(cx - ox).toFixed(1)}px, ${(cy - oy).toFixed(1)}px)`;   // 起/收点 = 悬浮球中心
        o.el.style.left = Math.round(ox - sz / 2) + 'px'; o.el.style.top = Math.round(oy - sz / 2) + 'px';
        o.el.style.transformOrigin = '50% 50%'; o.el.style.display = 'block';
        o.el.style.opacity = '0'; o.el.style.transform = o.tx + ' scale(.2)';   // 从球心、缩小态起步
    });
    requestAnimationFrame(() => { _orbs.forEach((o, i) => { o.el.style.transition = _ORB_POP_TRANS; o.el.style.transitionDelay = (i * 35) + 'ms'; o.el.style.opacity = '1'; o.el.style.transform = 'translate(0,0) scale(1)'; }); setTimeout(() => _orbs.forEach(o => { o.el.style.transition = _ORB_HOVER_TRANS; o.el.style.transitionDelay = '0ms'; }), 350 + 35 * _orbs.length + 80); });
}
function _orbKey(e) {
    if (e.key === 'Escape') { _hideOrbs(); return; }
    const k = e.key.toUpperCase();
    if (k.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    // 过滤输入框
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
    // 直接查 _ORB_TABS，不依赖 _orbs 是否已展开（子球未展开时 _orbs 为空）
    const tabDef = _ORB_TABS.find(t => t.shortcut.toUpperCase() === k);
    if (!tabDef) return;
    e.preventDefault(); e.stopPropagation();
    if (tabDef.id === 'align' && typeof window.__wosaiOpenAlignPanel === 'function') {
        window.__wosaiOpenAlignPanel();
        return;
    }
    const trigger = () => {
        const t = getHudTab(tabDef.id);
        if (t && t.panel) t.panel();
        else _ctx.openTab?.(tabDef.id);
    };
    if (!_wingsOpen) {
        // 子球未展开 → 先展开（视觉反馈），再触发面板，然后关闭
        _showLimitedOrbs(_FAN_IDS);
        requestAnimationFrame(() => { trigger(); _hideOrbs(); });
    } else {
        trigger();
        _hideOrbs();
    }
}

// ── 动态玻璃脸悬浮球 SVG ─────────────────────────────────
// 以下 _FACE_SVG 为悬浮球静态插画资源，所有颜色均已抽取为 --ws-ln-face-* CSS 变量，
// 统一在 web/styles/wosai-variables.css 中维护，便于后续主题化与一致性管理。
const _FACE_SVG = `<svg class="wso-face" viewBox="0 0 128 128" width="100%" height="100%" style="display:block" xmlns="http://www.w3.org/2000/svg">
<defs>
<linearGradient id="wsoRb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--ws-ln-face-gradient-start)"/><stop offset=".38" stop-color="var(--ws-ln-face-gradient-mid1)"/><stop offset=".68" stop-color="var(--ws-ln-face-gradient-mid2)"/><stop offset="1" stop-color="var(--ws-ln-face-gradient-end)"/><animateTransform attributeName="gradientTransform" type="rotate" from="0 .5 .5" to="360 .5 .5" dur="9s" repeatCount="indefinite"/></linearGradient>
<radialGradient id="wsoSh" cx=".34" cy=".28" r=".9"><stop offset="0" stop-color="var(--ws-ln-face-base)" stop-opacity=".62"/><stop offset=".45" stop-color="var(--ws-ln-face-base)" stop-opacity="0"/><stop offset="1" stop-color="var(--ws-ln-face-shadow)" stop-opacity=".4"/></radialGradient>
<radialGradient id="wsoBot" cx=".62" cy=".82" r=".5"><stop offset="0" stop-color="var(--ws-ln-face-shadow)" stop-opacity=".32"/><stop offset="1" stop-color="var(--ws-ln-face-shadow)" stop-opacity="0"/></radialGradient>
<radialGradient id="wsoHl" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="var(--ws-ln-face-base)" stop-opacity=".95"/><stop offset="1" stop-color="var(--ws-ln-face-base)" stop-opacity="0"/></radialGradient>
<filter id="wsoGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<style>
.wso-breathe{transform-box:fill-box;transform-origin:center;animation:wsoBr 4s ease-in-out infinite}
@keyframes wsoBr{0%,100%{transform:scale(1) translateY(0)}50%{transform:scale(1.03) translateY(var(--ws-ln-breathe-lift))}}
.wso-body{transform-box:fill-box;transform-origin:center;animation:wsoJelly 6s ease-in-out infinite}
@keyframes wsoJelly{0%,68%,100%{transform:scale(1,1)}77%{transform:scale(1.07,.93)}86%{transform:scale(.95,1.06)}94%{transform:scale(1.02,.98)}}
.wso-eyes{animation:wsoDart 5s ease-in-out infinite}
@keyframes wsoDart{0%,70%,100%{transform:translateX(0)}80%{transform:translateX(var(--ws-ln-dart-offset-negative))}90%{transform:translateX(var(--ws-ln-dart-offset))}}
.wso-blinker{transform-box:fill-box;transform-origin:center;animation:wsoBlink 4.6s infinite}
@keyframes wsoBlink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.08)}}
/* 默认态：双眼同步眨（去掉独立 winker 动画，避免右眼与整体眨眼双重 scaleY 打架） */
.wso-cheek{opacity:0;transition:opacity .18s}
.wso-eyes-happy,.wso-eyes-angry,.wso-eyes-sleep,.wso-mouth,.wso-extra{opacity:0;transition:opacity .18s}
.wso-m-yawn{transform-box:fill-box;transform-origin:center}
.wso-anger{transform-box:fill-box;transform-origin:center}
.wso-mask{transform-box:fill-box;transform-origin:center top}
.wso-zzz .wso-z{transform-box:fill-box;transform-origin:center}
.wso-root[data-exp="smile"] .wso-eyes-happy{opacity:1}
.wso-root[data-exp="smile"] .wso-blinker{opacity:0}
.wso-root[data-exp="smile"] .wso-cheek{opacity:.55}
/* cry 槽位 → 戴墨镜装酷：墨镜遮眼 + 嘴角微撇 + 镜片反光扫过 + 慵懒小晃 */
.wso-root[data-exp="cry"] .wso-blinker{opacity:0}
.wso-root[data-exp="cry"] .wso-shades{opacity:1}
.wso-root[data-exp="cry"] .wso-smile{opacity:1}
.wso-root[data-exp="cry"] .wso-glint{animation:wsoGlint 2.6s ease-in-out infinite}
.wso-root[data-exp="cry"] .wso-body{animation:wsoCool 3.4s ease-in-out infinite}
.wso-root[data-exp="yawn"] .wso-blinker{animation:none;transform:scaleY(.32)}
.wso-root[data-exp="yawn"] .wso-m-yawn{opacity:1;animation:wsoYawn 4s ease-in-out infinite}
/* angry 槽位 → 戴口罩：口罩遮住口鼻 + 眼睛照常眨 + 口罩轻微起伏（呼吸） */
.wso-root[data-exp="angry"] .wso-mask{opacity:1;animation:wsoMaskBreathe 3.4s ease-in-out infinite}
.wso-root[data-exp="sleep"] .wso-eyes-sleep{opacity:1}
.wso-root[data-exp="sleep"] .wso-blinker{opacity:0}
.wso-root[data-exp="sleep"] .wso-zzz{opacity:1}
.wso-root[data-exp="sleep"] .wso-z1{animation:wsoZ 2.6s ease-in-out infinite}
.wso-root[data-exp="sleep"] .wso-z2{animation:wsoZ 2.6s ease-in-out 1.3s infinite}
@keyframes wsoTear{0%{transform:translateY(0);opacity:0}18%{opacity:.9}100%{transform:translateY(var(--ws-ln-tear-travel));opacity:0}}
@keyframes wsoYawn{0%,100%{transform:scaleY(.5)}50%{transform:scaleY(1.15)}}
@keyframes wsoAnger{0%,100%{transform:scale(1) rotate(0)}50%{transform:scale(1.28) rotate(8deg)}}
@keyframes wsoZ{0%{transform:translateY(0) scale(.6);opacity:0}28%{opacity:.95}100%{transform:translateY(var(--ws-ln-z-travel));opacity:0}}
@keyframes wsoCool{0%,100%{transform:rotate(-2.5deg)}50%{transform:rotate(2.5deg)}}
@keyframes wsoGlint{0%,55%{transform:translateX(0);opacity:0}64%{opacity:.85}78%{opacity:.85}100%{transform:translateX(var(--ws-ln-glint-travel));opacity:0}}
@keyframes wsoMaskBreathe{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.05)}}
.wso-eye{transition:fill .15s}
.wso-dragging .wso-eye{fill:var(--ws-ln-face-base)}
.wso-pop{animation:wsoPop .6s ease}
@keyframes wsoPop{0%{transform:scale(1)}28%{transform:scale(1.16)}60%{transform:scale(.95)}100%{transform:scale(1)}}
.wso-static *{animation:none!important}
/* 悬停态 = 对称 ^^ 笑眼 + 腮红（圆眼整体淡出，杜绝圆眼/弯眼在同一只眼上叠加冲突） */
.wso-face:hover .wso-blinker{opacity:0;animation:none}
.wso-face:hover .wso-winker{opacity:0}
.wso-face:hover .wso-eyes-happy{opacity:1}
.wso-face:hover .wso-eyes-angry{opacity:0}
.wso-face:hover .wso-eyes-sleep{opacity:0}
.wso-face:hover .wso-mouth{opacity:0}
.wso-face:hover .wso-extra{opacity:0}
.wso-face:hover .wso-cheek{opacity:.55}
</style>
</defs>
<g class="wso-root" style="transform-box:fill-box;transform-origin:center">
<g class="wso-breathe"><g class="wso-body">
<circle cx="64" cy="64" r="51" fill="var(--ws-ln-face-base)" opacity=".85" filter="url(#wsoGlow)"/>
<circle cx="64" cy="64" r="50" fill="url(#wsoRb)"/>
<circle cx="64" cy="64" r="50" fill="url(#wsoSh)"/>
<circle cx="64" cy="64" r="50" fill="url(#wsoBot)"/>
<ellipse cx="43" cy="40" rx="26" ry="17" fill="url(#wsoHl)" opacity=".7" transform="rotate(-22 43 40)"/>
<ellipse cx="40" cy="34" rx="12" ry="8" fill="url(#wsoHl)" opacity=".8" transform="rotate(-22 40 34)"/>
<ellipse class="wso-cheek" cx="38" cy="80" rx="9" ry="5.5" fill="var(--ws-ln-face-cheek)"/>
<ellipse class="wso-cheek" cx="90" cy="80" rx="9" ry="5.5" fill="var(--ws-ln-face-cheek)"/>
<g class="wso-eyes">
<g class="wso-blinker" fill="var(--ws-ln-face-eye)"><ellipse class="wso-eye" cx="48" cy="63" rx="9" ry="13"/><ellipse class="wso-eye wso-winker" cx="82" cy="63" rx="9" ry="13"/></g>
<g class="wso-eyes-happy" fill="none" stroke="var(--ws-ln-face-eye)" stroke-width="4.5" stroke-linecap="round"><path class="wso-happy-l" d="M39 66 Q48 54 57 66"/><path class="wso-happy-r" d="M73 66 Q82 54 91 66"/></g>
<g class="wso-eyes-angry" fill="none" stroke="var(--ws-ln-face-eye)" stroke-width="7" stroke-linecap="round"><path d="M40 58 L56 67"/><path d="M88 58 L72 67"/></g>
<g class="wso-eyes-sleep" fill="none" stroke="var(--ws-ln-face-eye)" stroke-width="4.5" stroke-linecap="round"><path d="M40 62 Q48 69 56 62"/><path d="M72 62 Q80 69 88 62"/></g>
</g>
<ellipse class="wso-mouth wso-m-yawn" cx="64" cy="81" rx="9" ry="10" fill="var(--ws-ln-face-mouth)"/>
<g class="wso-extra wso-tear" fill="var(--ws-ln-face-tear)"><ellipse class="wso-tear-l" cx="48" cy="77" rx="3.2" ry="4.6"/><ellipse class="wso-tear-r" cx="82" cy="77" rx="3.2" ry="4.6"/></g>
<g class="wso-extra wso-anger" stroke="var(--ws-ln-face-anger)" stroke-width="3" stroke-linecap="round"><path d="M96 24 v9"/><path d="M91.5 28.5 h9"/></g>
<g class="wso-extra wso-zzz" fill="var(--ws-ln-face-sleep)" font-family="system-ui,sans-serif" font-weight="700"><text class="wso-z wso-z1" x="84" y="42" font-size="13">z</text><text class="wso-z wso-z2" x="94" y="30" font-size="17">Z</text></g>
<path class="wso-extra wso-smile" d="M54 82 Q64 88 75 83" fill="none" stroke="var(--ws-ln-face-mouth)" stroke-width="4.5" stroke-linecap="round"/>
<g class="wso-extra wso-shades">
<path d="M30 57 H98" fill="none" stroke="var(--ws-ln-face-shades)" stroke-width="4.5" stroke-linecap="round"/>
<rect x="33" y="55" width="26" height="17" rx="7" fill="var(--ws-ln-face-shades)"/>
<rect x="69" y="55" width="26" height="17" rx="7" fill="var(--ws-ln-face-shades)"/>
<path d="M59 60 q5 -1.5 10 0" fill="none" stroke="var(--ws-ln-face-shades)" stroke-width="4" stroke-linecap="round"/>
<path d="M33 60 l-9 -3" fill="none" stroke="var(--ws-ln-face-shades)" stroke-width="4" stroke-linecap="round"/>
<path d="M95 60 l9 -3" fill="none" stroke="var(--ws-ln-face-shades)" stroke-width="4" stroke-linecap="round"/>
<rect class="wso-glint" x="37" y="57" width="4" height="13" rx="2" fill="var(--ws-ln-face-base)" opacity="0"/>
</g>
<g class="wso-extra wso-mask">
<path d="M37 69 Q64 63 91 69 L93 87 Q64 103 35 87 Z" fill="var(--ws-ln-face-mask-fill)" stroke="var(--ws-ln-face-mask-stroke)" stroke-width="1.5"/>
<path d="M39 77 Q64 83 89 77" fill="none" stroke="var(--ws-ln-face-mask-stroke)" stroke-width="1.4"/>
<path d="M40 83 Q64 89 88 83" fill="none" stroke="var(--ws-ln-face-mask-stroke)" stroke-width="1.4"/>
<path d="M37 70 q-13 1 -11 13" fill="none" stroke="var(--ws-ln-face-mask-stroke)" stroke-width="2.6" stroke-linecap="round"/>
<path d="M91 70 q13 1 11 13" fill="none" stroke="var(--ws-ln-face-mask-stroke)" stroke-width="2.6" stroke-linecap="round"/>
</g>
</g></g></g>
</svg>`;

// ── 悬浮球主体 ──────────────────────────────────────────
let _launcher = null;
let _isSideSnapped = false;
let _snapSide = null;
let _snapTransform = '';  // 吸附时的 transform 字符串（translateX 偏移），布局 left 不变
let _wasSnapped = false;   // 标识本次点击来自侧边吸附状态
let _launcher_skin = null;
let _resizeHandler = null;
let _offLangChange = null;
let _launcherPointerDown = null;
let _launcherPointerMove = null;
let _launcherPointerUp = null;
let _launcherPointerCancel = null;
let _launcherContextMenu = null;

// ── 画布缩放同步（已禁用）────────────────────────────────
let _zoomScale = 1;
const _zoomTickId = null;
let _zoomVisHandler = null;
function _effectiveBall() { return BALL; }
function _effectiveOrb(sz) { return sz; }
function _needsZoomTick() { return false; }
function _startZoomTick() {}
function _stopZoomTick() {}
function _ensureZoomVisListener() {}
function _zoomTick() {}
function _applyZoom() {}
// 重新计算子球位置（等角度环绕主球）
function _recalcOrbs(cx, cy) {
    if (!_launcher || !_orbs.length) return;
    if (cx === undefined || cy === undefined) {
        const r = _launcher.getBoundingClientRect();
        cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    }
    const gap = 18;
    const maxOrbSz = Math.max(..._orbs.map(o => o.size), 0) || ORB;
    const orbOuterOffset = 14, orbInnerOffset = -10;
    const baseR = _effectiveBall() / 2 + gap + maxOrbSz / 2;
    const outerR = baseR + orbOuterOffset, N = _orbs.length, M = 6 + maxOrbSz / 2 + orbOuterOffset;
    if (cx - outerR < M) cx += M - (cx - outerR);
    else if (cx + outerR > window.innerWidth - M) cx -= (cx + outerR) - (window.innerWidth - M);
    if (cy - outerR < M) cy += M - (cy - outerR);
    else if (cy + outerR > window.innerHeight - M) cy -= (cy + outerR) - (window.innerHeight - M);
    const baseAng = _smartBaseAng(cx, cy);   // 8 方向智能扇面方向
    const SPREAD = N > 1 ? Math.min((N - 1) * 0.85, 2.6) : 0;
    _orbs.forEach((o, i) => {
        const ang = N > 1 ? (baseAng - SPREAD / 2 + i * (SPREAD / (N - 1))) : baseAng;
        const dx = Math.cos(ang), dy = Math.sin(ang);
        const orbR = o._isBig ? baseR + orbOuterOffset : baseR + orbInnerOffset;
        const ox = cx + orbR * dx, oy = cy + orbR * dy;
        const sz = o.size;
        o.cx = ox; o.cy = oy;
        o.tx = `translate(${(cx - ox).toFixed(1)}px, ${(cy - oy).toFixed(1)}px)`;   // 起/收点 = 悬浮球中心
        o.el.style.left = Math.round(ox - sz / 2) + 'px';
        o.el.style.top = Math.round(oy - sz / 2) + 'px';
        o.el.style.transformOrigin = '50% 50%';
    });
}

export function getLauncherEl() { return _launcher; }
export function setLauncherSkinFn(fn) { _launcher_skin = fn; }
export function callLauncherSkin() { if (_launcher_skin) _launcher_skin(); }
export function isSnapped() { return _isSideSnapped; }

export function createLauncher() {
    if (_launcher) return;
    BALL = getBallSize(); _recalcOrbSizes();
    const b = document.createElement('div');
    b.setAttribute('data-wosai-panel', '');
    Object.assign(b.style, {
        position: 'fixed',
        display: 'none',
        width: `${BALL}px`,
        height: `${BALL}px`,
        borderRadius: '50%',
        boxSizing: 'border-box',
        background: 'transparent',
        filter: 'drop-shadow(var(--ws-ln-ball-shadow))',
        zIndex: '100002',
        cursor: 'grab',
        userSelect: 'none',
        transition: 'transform .18s,filter .18s,opacity .5s ease',
        touchAction: 'none',
        opacity: '0',
    });
    b.innerHTML = _FACE_SVG;
    const eyesEl = b.querySelector('.wso-eyes');
    const rootEl = b.querySelector('.wso-root');
    if (rootEl) {
        rootEl.dataset.exp = getBallExp();
        if (!getBallAnim()) rootEl.classList.add('wso-static');
    }
    if (getBallExpMode() === 'cycle') _startExpCycle();
    const skinLauncher = () => {};
    _launcher_skin = skinLauncher;
    b.onmouseenter = () => {
        if (_isSideSnapped) {
            b.style.opacity = '0.92';
        } else {
            b.style.transform = 'scale(1.12)';
        }
        b.style.filter = 'drop-shadow(var(--ws-ln-ball-hover-glow))';
        if (!_wingsOpen && !_isSideSnapped) showTip(b, t('menus.launcher.ballTitle'));
    };
    b.onmouseleave = () => {
        if (_isSideSnapped) {
            b.style.opacity = '0.55';
        } else {
            b.style.transform = '';
        }
        b.style.filter = 'drop-shadow(var(--ws-ln-ball-shadow))'; hideTip();
    };

    const cur = getLauncherPos();
    const _restoreSnap = _loadSnapState();
    if (_restoreSnap) {
        _isSideSnapped = true;
        _snapSide = _restoreSnap.side;
        const half = _effectiveBall() / 2;
        cur.x = _restoreSnap.side === 'left' ? 0 : window.innerWidth - half;
        _snapTransform = _restoreSnap.side === 'left' ? `translateX(${-half}px)` : '';
    }
    b.style.left = cur.x + 'px';
    b.style.top = cur.y + 'px';

    let drag = null, moved = false;
    _launcherPointerDown = (e) => {
        if (e.button !== 0) return;
        hideTip();
        if (_isSideSnapped) {
            _wasSnapped = true;
            const half = _effectiveBall() / 2;
            cur.x = _snapSide === 'left' ? (half + 12) : (window.innerWidth - half - 12);
            b.style.left = cur.x + 'px';
            _snapTransform = '';
            b.style.transform = '';
            b.style.opacity = '1';
            b.style.cursor = 'grabbing';
            _isSideSnapped = false; _snapSide = null; _clearSnapState();
        } else {
            _wasSnapped = false;
        }
        drag = { ox: e.clientX - cur.x, oy: e.clientY - cur.y, sx: e.clientX };
        moved = false;
        b.setPointerCapture(e.pointerId);
        b.style.cursor = 'grabbing';
        e.preventDefault(); e.stopPropagation();
    };
    _launcherPointerMove = (e) => {
        if (!drag) return;
        const nx = e.clientX - drag.ox, ny = e.clientY - drag.oy;
        if (!moved && Math.hypot(nx - cur.x, ny - cur.y) < 4) return;
        moved = true;
        if (_wingsOpen) _hideOrbs();
        if (rootEl) { rootEl.classList.add('wso-dragging'); rootEl.style.transform = (e.clientX > drag.sx) ? 'rotate(-10deg)' : 'rotate(10deg)'; }
        const p = clampPos(nx, ny);
        const dx = p.x - cur.x, dy = p.y - cur.y;
        cur.x = p.x; cur.y = p.y;
        b.style.left = p.x + 'px';
        b.style.top = p.y + 'px';
        if (eyesEl) {
            const L = Math.hypot(dx, dy);
            if (L > 0.4) { eyesEl.style.animation = 'none'; eyesEl.style.transform = `translate(${(dx / L * 4).toFixed(1)}px,${(dy / L * 4).toFixed(1)}px)`; }
        }
        _ctx.repositionHud?.();
    };
    const endDrag = (e) => {
        if (!drag) return;
        const effB = _effectiveBall();
        try { b.releasePointerCapture(e.pointerId); } catch (err) {}
        b.style.cursor = _isSideSnapped ? 'pointer' : 'grab';
        if (eyesEl) { eyesEl.style.animation = ''; eyesEl.style.transform = ''; }
        if (rootEl) { rootEl.classList.remove('wso-dragging'); rootEl.style.transform = ''; }
        if (moved) {
            _wasSnapped = false;
            if (_isSideSnapped) { _isSideSnapped = false; _snapSide = null; _clearSnapState(); }
            saveLauncherPos(cur);
            const centerX = cur.x + effB / 2;
            if (centerX < SNAP_THRESHOLD) { _snapToSide('left'); }
            else if (centerX > window.innerWidth - SNAP_THRESHOLD) { _snapToSide('right'); }
        } else {
            const rt = b.querySelector('.wso-root');
            if (rt) { rt.classList.remove('wso-pop'); void rt.getBoundingClientRect(); rt.classList.add('wso-pop'); const _bl = rt.querySelector('.wso-blinker'); if (_bl) { _bl.style.animation = 'none'; void _bl.offsetWidth; _bl.style.animation = ''; } }
            if (_isSideSnapped) {
                const wasLeft = _snapSide === 'left';
                _isSideSnapped = false; _snapSide = null; _clearSnapState();
                b.style.transform = ''; b.style.transition = 'none';
                b.offsetHeight;
                b.style.transition = 'transform .18s,filter .18s,opacity .5s ease';
                const R = effB / 2 + 12 + ORB / 2, M = 6 + ORB / 2, pad = R + M;
                const cx = wasLeft ? pad : window.innerWidth - pad;
                let cy = (parseFloat(b.style.top) || window.innerHeight * 0.32) + effB / 2;
                cy = Math.max(pad, Math.min(cy, window.innerHeight - pad));
                const np = clampPos(cx - effB / 2, cy - effB / 2, effB, effB);
                b.style.opacity = '1'; b.style.cursor = 'grab';
                b.style.left = np.x + 'px'; b.style.top = np.y + 'px';
                cur.x = np.x; cur.y = np.y; saveLauncherPos(cur);
                _showLimitedOrbs(_FAN_IDS, np.x + effB / 2, np.y + effB / 2);
            } else if (_wasSnapped) {
                // 侧边吸附点击 → 恢复到画布中心，不弹子球
                _wasSnapped = false;
                const rt = b.querySelector('.wso-root');
                if (rt) { rt.classList.remove('wso-pop'); void rt.getBoundingClientRect(); rt.classList.add('wso-pop'); const _bl = rt.querySelector('.wso-blinker'); if (_bl) { _bl.style.animation = 'none'; void _bl.offsetWidth; _bl.style.animation = ''; } }
                b.style.transform = ''; b.style.transition = 'none';
                b.offsetHeight;
                b.style.transition = 'left .4s cubic-bezier(.34,1.56,.64,1), top .4s cubic-bezier(.34,1.56,.64,1), opacity .5s ease, transform .18s,filter .18s';
                const cx = (window.innerWidth - effB) / 2;
                const cy = (window.innerHeight - effB) / 2;
                b.style.left = cx + 'px'; b.style.top = cy + 'px';
                b.style.opacity = '1'; b.style.cursor = 'grab';
                cur.x = cx; cur.y = cy;
                saveLauncherPos(cur);
                setTimeout(() => { b.style.transition = 'transform .18s,filter .18s,opacity .5s ease'; }, 450);
            } else {
                _ctx.closeHud?.();
                if (_wingsOpen) _hideOrbs();
                else _showLimitedOrbs(_FAN_IDS);
            }
        }
        drag = null; moved = false;
    };
    _launcherPointerUp = endDrag;
    _launcherPointerCancel = endDrag;
    _launcherContextMenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (_wingsOpen) _hideOrbs();
        const rt = b.querySelector('.wso-root');
        if (rt) { rt.classList.remove('wso-pop'); void rt.getBoundingClientRect(); rt.classList.add('wso-pop'); }
        openSettingsCenter();
    };
    b.addEventListener('pointerdown', _launcherPointerDown);
    b.addEventListener('pointermove', _launcherPointerMove);
    b.addEventListener('pointerup', _launcherPointerUp);
    b.addEventListener('pointercancel', _launcherPointerCancel);
    // 右键悬浮球 → 打开「设置中心」（形象/背景/连线/系统）
    b.addEventListener('contextmenu', _launcherContextMenu);

    document.body.appendChild(b);
    _launcher = b;
    requestAnimationFrame(() => requestAnimationFrame(() => {
        b.style.display = 'block';
        b.style.opacity = _isSideSnapped ? '0.45' : '1';
        if (_isSideSnapped) b.style.cursor = 'pointer';
        _startZoomTick();
    }));

    if (_resizeHandler) { window.removeEventListener('resize', _resizeHandler); }
    _resizeHandler = () => {
        if (_isSideSnapped) {
            const half = _effectiveBall() / 2;
            b.style.left = (_snapSide === 'left' ? (-half) : window.innerWidth - half) + 'px';
            return;
        }
        const p = clampPos(cur.x, cur.y, _effectiveBall(), _effectiveBall());
        cur.x = p.x; cur.y = p.y;
        b.style.left = p.x + 'px';
        b.style.top = p.y + 'px';
        _ctx.repositionHud?.();
    };
    window.addEventListener('resize', _resizeHandler);
    _startZoomTick();
    _ensureZoomVisListener();
    window.addEventListener('keydown', _orbKey, true);

    // 语言切换：移除表情面板（下次打开时会使用新语言重新创建）
    _offLangChange = onLangChange(() => {
        if (_avatarPanel) { _avatarPanel.remove(); _avatarPanel = null; }
    });
}

// ── 悬浮球延迟出场 ──────────────────────────────────────
let _canvasReady = false;
let _launcherTimer = null;

export function showLauncherWhenReady(extraDelay = 800) {
    if (_canvasReady) return;
    _canvasReady = true;
    if (_launcherTimer) clearTimeout(_launcherTimer);
    const show = () => {
        const val = localStorage.getItem(STORAGE_KEYS.showLauncher);
        // Show by default. An explicit "false" remains a user's opt-out.
        if (val === 'false') return;
        createLauncher();
    };
    setTimeout(() => {
        if ('requestIdleCallback' in window) requestIdleCallback(show, { timeout: 3000 });
        else setTimeout(show, 600);
    }, extraDelay);
}

// ── 销毁 ────────────────────────────────────────────────
export function removeLauncher() {
    if (_launcher) {
        if (_launcherPointerDown) _launcher.removeEventListener('pointerdown', _launcherPointerDown);
        if (_launcherPointerMove) _launcher.removeEventListener('pointermove', _launcherPointerMove);
        if (_launcherPointerUp) _launcher.removeEventListener('pointerup', _launcherPointerUp);
        if (_launcherPointerCancel) _launcher.removeEventListener('pointercancel', _launcherPointerCancel);
        if (_launcherContextMenu) _launcher.removeEventListener('contextmenu', _launcherContextMenu);
        _launcher.remove(); _launcher = null;
    }
    _launcherPointerDown = null;
    _launcherPointerMove = null;
    _launcherPointerUp = null;
    _launcherPointerCancel = null;
    _launcherContextMenu = null;
    if (_resizeHandler) { window.removeEventListener('resize', _resizeHandler); _resizeHandler = null; }
    _stopZoomTick();
    if (_zoomVisHandler) { document.removeEventListener('visibilitychange', _zoomVisHandler); _zoomVisHandler = null; }
    _zoomScale = 1;
    if (_offLangChange) { _offLangChange(); _offLangChange = null; }
    if (_avatarPanel) { _avatarPanel.remove(); _avatarPanel = null; }
    if (_avatarOutside) { document.removeEventListener('pointerdown', _avatarOutside, true); _avatarOutside = null; }
    if (_avatarEscHandler) { document.removeEventListener('keydown', _avatarEscHandler); _avatarEscHandler = null; }
    if (_scPanel) { _scPanel.remove(); _scPanel = null; }
    if (_scOutside) { document.removeEventListener('pointerdown', _scOutside, true); _scOutside = null; }
    if (_scEscHandler) { document.removeEventListener('keydown', _scEscHandler); _scEscHandler = null; }
    _stopExpCycle();
    if (_launcherTimer) { clearTimeout(_launcherTimer); _launcherTimer = null; }
    window.removeEventListener('keydown', _orbKey, true);
    _hideOrbs();
    _orbs.forEach(o => o.el.remove());
    _orbs = [];
    _launcher_skin = null;
    _canvasReady = false;
    if (_dashLine) { _dashLine.remove(); _dashLine = null; }
}

/** 扩展生命周期：供调用方（如 WOSAI.ColorBar）在 remove() 中统一回收 */
export function remove() { removeLauncher(); }
