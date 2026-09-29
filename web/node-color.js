import { app } from "../../../scripts/app.js";
// 简化分组取色器已弃用——分组统一走"高级"完整面板（openPickerForGroups）
import {
    hsv2hex, hex2hsv, sharpGradientCSS, cssGradientDir,
    DIRS, getDirTip,
    deriveDarkBg, applyColorState,
    palettesPromise,
} from "./shared/color-core.js";
import { store, initStore, persist } from "./shared/color-store.js";
import { getSelectedNodes, getSelectedGroups, getNodesInGroup } from "./shared/canvas-utils.js";
import { getGlassTheme, onGlassChange } from "./shared/glass-theme.js";
import { hideTip } from "./shared/tooltip.js";
import { onGlobal, offGlobal } from "./shared/event-manager.js";
import { renderBuiltinPresets } from "./shared/color-presets-ui.js";
import { roundRect as canvasRoundRect } from "./shared/canvas-polyfill.js";
import { t } from "./shared/i18n.js";
import { WOSAI_COPYRIGHT } from "./shared/constants.js";
import { getWOSAIVar } from "./shared/shared-utils.js";
import { registerSelectionFollower } from "./shared/selection-follow.js";
import {
    createDefaultGradientSlots,
    gradientSlotCss,
    loadCustomGradientSlots,
    saveCustomGradientSlots,
} from "./shared/node-color-gradients.js";
import { createNodeColorState } from "./shared/node-color-state.js";
import { placeFloatingPanel } from "./shared/viewport-layout.js";
import { patchMethod } from "./shared/method-patch.js";

// Shared gradient state - set by setup() for access from applyColor()
let _refreshDOMGradients = null;
let _refreshDOMSolidColors = null;
let _refreshDOMTitleStyles = null;
let _gradMORef = null;          // MutationObserver 引用（扩展卸载时断开）
let _applyTitleAlignInline = null;
let _onHexChFn = null;
let _nodeColorGeneration = 0;
let _nodeColorActive = false;
const _nodeColorSetupTimers = new Set();
const _canvasPatchDisposers = [];

// 原型 hook 原函数引用（供 remove() 还原，防热重载 --watch 叠套）
const _protoRefs = {};

// ── 取色历史 & 自定义预设 ──
// 数据与持久化迁至 lib/color-store.js（localStorage + 服务端 JSON 双层）
// 预设/方向常量迁至 lib/color-core.js

// 默认渐变槽调色板数据外置到 color-palettes.json，由 palettesPromise 动态加载后填充
let _SLOT_DEFAULTS = [];

function renderRecentPicks() {
    const container = document.getElementById('ncRc');
    if (!container) return;
    container.innerHTML = '';
    if (store.recent.length === 0) { container.style.display = 'none'; return; }
    container.style.display = 'grid';
    for (let i = store.recent.length - 1; i >= 0; i--) {
        const p = store.recent[i];
        const chip = document.createElement('div');
        chip.className = 'nc-rc-chip'; chip.style.background = p.hex;
        chip.dataset.tip = p.hex.toUpperCase();
        chip.onclick = () => _onHexChFn && _onHexChFn(p.hex);
        const del = document.createElement('span');
        del.className = 'nc-rc-del'; del.textContent = '×';
        del.onclick = (e) => { e.stopPropagation(); store.recent.splice(i,1); persist(); renderRecentPicks(); };
        chip.appendChild(del);
        container.appendChild(chip);
    }
}

//     sharpGradientCSS 迁至 lib/color-core.js。

// 分组进入完整面板（高级）：收集组内全部节点 + 联动分组框；空组回退画布第一个节点
function openPickerForGroups(groups, anchorRect) {
    if (!groups?.length) return;
    const set = new Set();
    groups.forEach(g => {
        const inside = getNodesInGroup(g);
        inside.forEach(n => set.add(n));
    });
    let nodes = [...set];
    if (!nodes.length) {
        const first = app.graph?._nodes?.[0];
        if (!first) return;
        nodes = [first];
    }
    openNodeColorPicker(nodes, anchorRect, groups);
}

// 选中节点检测 → lib/canvas-utils.js（统一实现）

// groups（可选）：联动的分组框数组——面板内所有上色/清除操作同步写分组框颜色
export function openNodeColorPicker(nodes, anchorRect, groups) {
    if (!nodes?.length) return;
    // 传入分组时：转"高级"完整面板（组内节点 + 分组框联动），不再使用简化分组取色器
    if (nodes[0] instanceof LGraphGroup) {
        return openPickerForGroups(nodes.filter(g => g instanceof LGraphGroup), anchorRect);
    }
    const linkedGroups = Array.isArray(groups) ? groups : [];
    // 清理旧面板（防止异常未 close 导致的 DOM/CSS 泄漏）
    // CSS 已通过 extension.json 加载 web/styles/os-color.css
    const oldPanel = document.querySelector('.nc-p');
    if (oldPanel) {
        // 先走 close 路径解绑 document 级监听器，再移除 DOM；
        // 仅 remove() 会让旧面板的 _closeHandler/_pinOnMove 等监听器残留累积
        if (typeof oldPanel._wosaiClose === 'function') oldPanel._wosaiClose();
        oldPanel.remove();
    }

    const canvas = app.canvas;

    const S = createNodeColorState(nodes[0], { hex2hsv, deriveDarkBg });
    // 清除状态标记：清除按钮预览时设为 true，确认时跳过上色；其他操作恢复 false
    let _isCleared = false;

    // CSS 常量已提取至 web/styles/os-color.css，通过 extension.json 加载
    // 动态渐变/标题样式仍由 setup() 中的 _refreshDOMGradients / _refreshDOMTitleStyles 实时生成

    // ── 灰度色卡模式：按住 Shift 时纯色预设切换为 12 级灰度 ──
    let grayMode = false;
    const _onGrayKeyDown = (e) => {
        if (e.key === 'Shift' && !grayMode) { grayMode = true; buildPresets(); }
    };
    const _onGrayKeyUp = (e) => {
        if (e.key === 'Shift' && grayMode) { grayMode = false; buildPresets(); }
    };
    const _onGrayBlur = () => { if (grayMode) { grayMode = false; buildPresets(); } };
    onGlobal('nc-gray-down', 'keydown', _onGrayKeyDown);
    onGlobal('nc-gray-up', 'keyup', _onGrayKeyUp);
    window.addEventListener('blur', _onGrayBlur);

    // hsv2hex / hex2hsv 由 lib/color-core.js 提供（原闭包内重复实现已删除）
    function curHex(){return hsv2hex(S.h,S.s,S.v);}
    function sHex(i){const s=S.stops[i];return hsv2hex(s.h,s.s,s.v);}
    function paintSq(){
        const el=document.getElementById('ncSv');
        if(el) el.style.background =
            `linear-gradient(to top, black, transparent), ` +
            `linear-gradient(to right, white, transparent), ` +
            `hsl(${S.h},100%,50%)`;
    }
    function paintStopbar(){
        const cvs=document.getElementById('ncSbc');
        if(!cvs)return;
        const w=cvs.offsetWidth||220;cvs.width=w;
        const ctx=cvs.getContext('2d');
        const grd=ctx.createLinearGradient(0,0,w,0);
        S.stops.forEach((s,i)=>grd.addColorStop(Math.max(0,Math.min(1,s.p)),sHex(i)));
        ctx.clearRect(0,0,w,14);
        ctx.beginPath(); canvasRoundRect(ctx, 0, 0, w, 14, 7);
        ctx.fillStyle=grd;ctx.fill();
    }
    function updatePins(){S.stops.forEach((s,i)=>{const el=document.getElementById('ncP'+i);if(el){el.style.left=(s.p*100)+'%';el.style.background=sHex(i);}});}
    function updateThumb(){const t=document.getElementById('ncSvt');if(!t)return;t.style.left=S.s+'%';t.style.top=(100-S.v)+'%';t.style.background=curHex();}
    function updateDirThumbs(){document.querySelectorAll('#ncDg .nc-dgi').forEach(el=>{el.style.background='';});}   // 方向按钮只显示箭头，不预览颜色（清除内联底色，回退 .nc-dgi/.on 类底色）
    function refresh(){
        paintSq(); updateThumb();
        paintStopbar(); updatePins(); updateDirThumbs();
        // 颜色1/2/3 圆形按钮跟随拾色器实时变色 + 选中描边
        if (typeof colorsRow !== 'undefined' && colorsRow) {
            [...colorsRow.children].forEach((cell, i) => {
                if (S.stops[i]) { cell.style.background = sHex(i); cell.style.borderColor = (i === S.aStop) ? 'var(--ws-accent)' : 'var(--ws-border)'; }
            });
        }
        // 标题样式控件实时刷新
        if (sizeRange) { sizeRange.value = S.titleStyle.size; }
        if (sizeNum) { sizeNum.value = S.titleStyle.size; }
        if (alignBtns && alignDefs) {
            alignDefs.forEach(d => { if (alignBtns[d.key]) alignBtns[d.key].classList.toggle('on', S.titleStyle.align === d.key); });
        }
        // 色相/饱和度/明度滑块
        const hs = document.getElementById('ncHsTrack');
        const ss = document.getElementById('ncSs');
        const vs = document.getElementById('ncVs');
        if (hs) hs.value = S.h;
        if (ss) ss.value = S.s;
        if (vs) vs.value = S.v;
    }

    // 全量刷新：Canvas 重绘 + Nodes 2.0 DOM 渐变/标题样式注入
    function refreshAllNodeVisuals(){
        canvas.setDirty(true,true);app.graph.setDirtyCanvas(true,true);
        if(typeof _refreshDOMGradients==="function")_refreshDOMGradients();
        if(typeof _refreshDOMSolidColors==="function") _refreshDOMSolidColors();
        if(typeof _refreshDOMTitleStyles==="function") _refreshDOMTitleStyles();
        // 终极方案：JS inline style 打对齐（绕过 CSS 优先级战争）
        if(typeof _applyTitleAlignInline==="function") _applyTitleAlignInline();
    }

    // 上色核心已迁至 lib/color-core.js applyColorState —— 此处只做状态快照与刷新
    function applyToNodes(){
        _isCleared = false;  // 任何主动上色操作取消清除状态
        resetBtn.classList.remove('nc-cleared');
        // 渐变模式：强制标题颜色为白色，确保在任意深色背景上都可见
        const ts = { ...S.titleStyle };
        if (S.stopCount > 1) ts.color = getWOSAIVar('--ws-nc-title-on-gradient');
        applyColorState(nodes, {
            stopCount: 3,
            dir: S.dir,
            stops: S.stops.map(s => ({ p: s.p, h: s.h, s: s.s, v: s.v })),
            titleStyle: ts,
        });
        // 联动分组框：跟随首端色
        if (linkedGroups.length) {
            const mainHex = hsv2hex(S.stops[0].h, S.stops[0].s, S.stops[0].v);
            linkedGroups.forEach(g => { g.color = mainHex; });
        }
        refreshAllNodeVisuals();
    }

    function saveAndSync(){ applyToNodes(); }

    // 控制渐变相关 UI 的显隐（三色渐变始终显示）
    function updateGradVisibility(){
        const sbw = document.getElementById('ncSbw'); if (sbw) sbw.style.display = 'block';
        const dg = document.getElementById('ncDg'); if (dg) dg.style.display = 'flex';   // 渐变方向小条常显（flex 右对齐，置于 5 槽上方）
    }

    // 动态重建取色针脚（清空 + 按 stops 数量重建）
    let _pinOnMove = null, _pinOnUp = null;
    function rebuildPins() {
        const sbArea = document.querySelector('#ncSbw > div');
        if (!sbArea) return;
        // 移除旧针脚（保留 canvas）
        sbArea.querySelectorAll('.nc-sp').forEach(el => el.remove());
        // 移除旧的全局事件监听器，防止累积泄漏
        if (_pinOnMove) document.removeEventListener('pointermove', _pinOnMove);
        if (_pinOnUp) {
            document.removeEventListener('pointerup', _pinOnUp);
            document.removeEventListener('pointercancel', _pinOnUp);
        }
        const cvs = document.getElementById('ncSbc');
        if (!cvs) return;
        S.stops.forEach((st, i) => {
            const pin = document.createElement('div');
            pin.id = 'ncP' + i;
            pin.className = 'nc-sp' + (i === S.aStop ? ' on' : '');
            pin.style.left = (st.p * 100) + '%';
            pin.style.background = sHex(i);
            pin.addEventListener('pointerdown', e => {
                e.stopPropagation(); e.preventDefault(); S.aStop = i;
                sbArea.querySelectorAll('.nc-sp').forEach(p => p.classList.remove('on'));
                pin.classList.add('on');
                const st2 = S.stops[i];
                S.h = st2.h; S.s = st2.s; S.v = st2.v;
                const hsTrack = document.getElementById('ncHsTrack');
                if (hsTrack) hsTrack.value = st2.h;
                refresh();
            });
        });
        // 全局共享的移动/释放监听器（整个 picker 共用，rebuidPins 时替换）
        _pinOnMove = e => {
            const dragIdx = S.aStop;
            if (dragIdx === undefined || dragIdx === null) return;
            const r = sbArea.getBoundingClientRect();
            if (!r.width) return;
            S.stops[dragIdx].p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
            paintStopbar(); updatePins(); updateDirThumbs();
        };
        _pinOnUp = () => { /* drag 状态在各 pin 的 pointerdown 中管理 */ };
        document.addEventListener('pointermove', _pinOnMove);
        document.addEventListener('pointerup', _pinOnUp);
        document.addEventListener('pointercancel', _pinOnUp);
    }

    function onHue(v){S.h=v;S.stops[S.aStop].h=v;saveAndSync();refresh();}   // 同步 S.h，否则 refresh() 里 hs.value=S.h 会把滑块弹回旧值（拖动失效 BUG）
    function onHexCh(v){
        if(!/^#[0-9a-fA-F]{6}$/.test(v))return;
        const h=hex2hsv(v);
        S.stops[S.aStop].h=h.h;S.stops[S.aStop].s=h.s;S.stops[S.aStop].v=h.v;
        S.h=h.h;S.s=h.s;S.v=h.v;
        const hsTrack=document.getElementById('ncHsTrack');
        if(hsTrack)hsTrack.value=h.h;
        saveAndSync();refresh();
    }
    _onHexChFn = onHexCh;

    function buildPresets(){
        const area=document.getElementById('ncPa');
        if(!area) return;
        renderBuiltinPresets(area, S, grayMode, { saveAndSync, refresh, rebuildPins, updateGradVisibility, paintStopbar, updatePins, updateDirThumbs });
    }

    const panel = document.createElement("div");
    panel.className="nc-p";
    panel.setAttribute("data-wosai-panel", "");
    panel.setAttribute("data-theme", getGlassTheme());   // 全插件共享玻璃主题
    panel.onpointerdown = (e) => e.stopPropagation();
    const _closeHandler=e=>{if(!panel.contains(e.target))close();};
    document.addEventListener("pointerdown",_closeHandler,{capture:true});

    // 标题
    const titleRow = document.createElement("div");
    titleRow.className = "nc-title-row";
    const titleEl = document.createElement("div");
    titleEl.className = "nc-title";
    titleEl.textContent = t('nodes.nodeColor.panelTitle');
    titleRow.appendChild(titleEl);
    panel.appendChild(titleRow);

    // 订阅广播：同步 data-theme
    const _offGlass = onGlassChange((t) => { panel.setAttribute("data-theme", t); });

    // presets
    const presetArea=document.createElement("div");presetArea.id="ncPa";



    // stopbar (pins built dynamically by rebuildPins)
    const sbWrap=document.createElement("div");sbWrap.id="ncSbw";sbWrap.className="nc-sbw";sbWrap.style.display="none";
    const sbArea=document.createElement("div");sbArea.className="nc-sba";
    const sbCvs=document.createElement("canvas");sbCvs.id="ncSbc";sbCvs.className="nc-sbc";sbCvs.height=14;
    sbArea.appendChild(sbCvs);
    sbWrap.appendChild(sbArea);
    panel.appendChild(sbWrap);

    // stopbar (pins built dynamically by rebuildPins)
    /* SV 方块：使用多层 background 叠加（而非子元素），根治 WebKit
       border-radius + overflow:hidden 子元素叠加时的 1px 高光间隙 */
    const svSq=document.createElement("div");svSq.id="ncSv";svSq.className="nc-sv";
    const svT=document.createElement("div");svT.id="ncSvt";svT.className="nc-svt";
    svSq.appendChild(svT);
    panel.appendChild(svSq);

    // ── 色相滑条（自定义实现，解决原生 range input 在 ComfyUI/Electron 中拖动失效问题）──
    // 事件模型：与 SV 取色方块一致，使用 document 级别 pointermove/up
    // （不用 setPointerCapture，避免在 Electron 嵌入环境中因 webview 边界/焦点问题导致捕获丢失）
    const hw = document.createElement("div"); hw.className = "nc-hw";   // margin-bottom 由 .nc-hw 控制为 0，改由「颜色」行的上行边距统一控制行距
    // 轨道 + 滑块容器
    const hsTrack = document.createElement("div");
    hsTrack.id = "ncHsTrack";
    hsTrack.className = "nc-hs-track";
    const hsThumb = document.createElement("div");
    hsThumb.id = "ncHsThumb";
    hsThumb.className = "nc-hs-thumb";
    hsTrack.appendChild(hsThumb);
    hw.appendChild(hsTrack);

    // 色相值（0-360）
    let _hueVal = S.h;
    function _updateHueUI() {
        const pct = (_hueVal / 360) * 100;
        hsThumb.style.left = pct + '%';
    }
    _updateHueUI();

    // 拖拽状态 + document 级别事件处理器（close() 中统一移除防泄漏）
    let _hueDragging = false;
    function _setHueFromEvent(e) {
        const r = hsTrack.getBoundingClientRect();
        let x = (e.clientX - r.left) / r.width;
        x = Math.max(0, Math.min(1, x));
        _hueVal = Math.round(x * 360);
        _updateHueUI();
        onHue(_hueVal);
    }
    // 命名处理器：close() 中统一移除
    const _hsMove = (e) => { if (_hueDragging) { e.stopPropagation(); _setHueFromEvent(e); } };
    const _hsUp = () => {
        if (_hueDragging) { _hueDragging = false; hsThumb.style.transition = ''; }
    };

    hsTrack.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault();
        _hueDragging = true;
        hsThumb.style.transition = 'none';
        _setHueFromEvent(e);
    });
    document.addEventListener('pointermove', _hsMove);
    document.addEventListener('pointerup', _hsUp);
    document.addEventListener('pointercancel', _hsUp);

    // 兼容层：外部通过 getElementById('ncHsTrack').value 读取/写入色相值
    hsTrack._hueProxy = { value: _hueVal };
    Object.defineProperty(hsTrack, 'value', {
        get() { return this._hueProxy.value; },
        set(v) { this._hueProxy.value = v; _hueVal = v; _updateHueUI(); }
    });

    // 滚轮调节
    hsTrack.addEventListener('wheel', (e) => {
        e.preventDefault(); e.stopPropagation();
        const v = Math.max(0, Math.min(360, _hueVal + (e.deltaY < 0 ? 1 : -1)));
        if (v !== _hueVal) { _hueVal = v; _updateHueUI(); onHue(v); }
    }, { passive: false });

    panel.appendChild(hw);

    // 色标选择行（三色渐变：颜色1 / 颜色2 / 颜色3）—— 紧贴色相滑条下方
    const colorsRow = document.createElement('div');
    colorsRow.className = 'nc-colors-row';
    function rebuildColorCells(){
        colorsRow.innerHTML = '';
        S.stops.forEach((st, i) => {
            const hex = sHex(i);
            const cell = document.createElement('div');
            cell.className = 'nc-color-cell';
            cell.style.background = hex;
            cell.style.borderColor = i===S.aStop ? 'var(--ws-accent)' : 'var(--ws-border)';
            cell.title = [t('nodes.nodeColor.color1'), t('nodes.nodeColor.color2'), t('nodes.nodeColor.color3')][i];
            cell.onclick = () => {
                S.aStop = i;
                const st2 = S.stops[i];
                S.h = st2.h; S.s = st2.s; S.v = st2.v;
                const hsEl = document.getElementById('ncHsTrack');
                if (hsEl) hsEl.value = st2.h;
                document.querySelectorAll('#ncSbw .nc-sp').forEach((p,j) => p.classList.toggle('on', j===i));
                refresh();
            };
            colorsRow.appendChild(cell);
        });
    }
    rebuildColorCells();
    // 给「颜色 / 方向 / 预设」三排加左侧说明标签（与「字号」风格一致），按钮缩小右移
    function _mkLabeledRow(text, content) {
        const line = document.createElement('div');
        line.className = 'nc-labeled-row';
        const lbl = document.createElement('label');
        lbl.textContent = text;
        line.appendChild(lbl);
        content.classList.add('nc-labeled-row-content');
        line.appendChild(content);
        return line;
    }
    panel.appendChild(_mkLabeledRow(t('nodes.nodeColor.color'), colorsRow));

    // ── 预设：5 个固定默认渐变（参考图1）+ 下方「自定义」行（右键保存当前设置，自动增长）──
    const _gradSlots = createDefaultGradientSlots(_SLOT_DEFAULTS, hex2hsv);
    let _customSlots = loadCustomGradientSlots(localStorage);
    const slotsRow = document.createElement('div');
    slotsRow.className = 'nc-slots-row';
    const customRow = document.createElement('div');
    customRow.className = 'nc-custom-row';
    function applySlot(slot) {
        S.stops = slot.stops.map((s, i) => ({ p: i / 2, h: s.h, s: s.s, v: s.v }));
        S.aStop = 0; S.h = S.stops[0].h; S.s = S.stops[0].s; S.v = S.stops[0].v;
        S.dir = slot.dir || '↓';
        const hs = document.getElementById('ncHsTrack'); if (hs) hs.value = S.h;
        rebuildPins(); updateGradVisibility();
        paintStopbar(); updatePins(); updateDirThumbs();
        saveAndSync(); refresh();
        rebuildColorCells();
    }
    function _mkSlotEl(slot, onClick, onCtx, tip) {
        const b = document.createElement('div');
        b.className = 'nc-slot-chip';
        b.style.background = gradientSlotCss(slot, hsv2hex);
        b.title = tip;
        b.onclick = onClick;
        b.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); onCtx(); };
        return b;
    }
    function _saveCurrentToCustom() {   // 右键默认槽 → 把当前三色+方向存为自定义预设（去重置顶）
        const entry = { dir: S.dir || '↓', stops: S.stops.map(s => ({ p: s.p, h: s.h, s: s.s, v: s.v })) };
        const key = JSON.stringify(entry);
        _customSlots = _customSlots.filter(c => JSON.stringify(c) !== key);
        _customSlots.unshift(entry);
        if (_customSlots.length > 5) _customSlots.length = 5;   // 自定义最多 5 个
        saveCustomGradientSlots(localStorage, _customSlots);
        buildCustom();
    }
    function buildSlots() {
        slotsRow.innerHTML = '';
        _gradSlots.forEach((slot) => slotsRow.appendChild(_mkSlotEl(slot, () => applySlot(slot), _saveCurrentToCustom, t('nodes.nodeColor.slotDefaultTip'))));
    }
    function buildCustom() {
        customRow.innerHTML = '';
        _customSlots.forEach((slot, idx) => customRow.appendChild(_mkSlotEl(slot, () => applySlot(slot), () => { _customSlots.splice(idx, 1); saveCustomGradientSlots(localStorage, _customSlots); buildCustom(); }, t('nodes.nodeColor.slotCustomTip'))));
    }
    buildSlots();
    buildCustom();

    // ── 渐变方向小条（4 箭头一行，置于 5 槽上方；点击即时改当前渐变方向，再右键存入槽）──
    const dirWrap=document.createElement("div");dirWrap.id="ncDg";dirWrap.className="nc-dg";
    DIRS.forEach(d=>{
        const el=document.createElement("div");
        el.className='nc-dgi nc-dgi-nc'+(d.sym===S.dir?' on':'');
        el.dataset.deg=d.deg;  // 直接用数值存储角度，避免 Unicode dataset 字符比对问题
        const dirTip = getDirTip(d.sym);
        el.dataset.tip=dirTip;
        const sym=document.createElement("div");sym.className='nc-dgs';sym.textContent=d.sym;
        el.appendChild(sym);
        const tip=document.createElement("div");tip.className='nc-dgt';tip.textContent=dirTip;
        el.appendChild(tip);
        el.onclick=()=>{
            document.querySelectorAll('#ncDg .nc-dgi').forEach(c=>c.classList.remove('on'));
            el.classList.add('on');S.dir=d.sym;
            saveAndSync();refresh();
        };
        dirWrap.appendChild(el);
    });
    panel.appendChild(_mkLabeledRow(t('nodes.nodeColor.direction'), dirWrap));    // 方向条在上
    panel.appendChild(_mkLabeledRow(t('nodes.nodeColor.presets'), slotsRow));     // 5 个固定默认渐变
    panel.appendChild(_mkLabeledRow(t('nodes.nodeColor.custom'), customRow));  // 自定义保存行（右键默认槽写入，自动增长）

    // ── 标题文字样式控件（始终显示） ──
    const tsWrap = document.createElement('div');
    tsWrap.id = 'ncTsWrap';
    tsWrap.className = 'nc-ts-wrap';

    // ── 标题样式：字号/字重/对齐共用背景容器 ──────────────────────
    const tsGroup = document.createElement('div');
    tsGroup.className = 'nc-ts-row nc-ts-group';

    // ── 第1行：字号（标签 + 滑条 + 数字框） ──
    const sizeRow = document.createElement('div');
    sizeRow.className = 'nc-ts-subrow';
    const sizeLbl = document.createElement('label');
    sizeLbl.textContent = t('nodes.nodeColor.titleSize');
    const sizeRange = document.createElement('input');
    sizeRange.type = 'range'; sizeRange.className = 'nc-ts-range';
    sizeRange.min = 14; sizeRange.max = 24; sizeRange.step = 1;
    sizeRange.value = S.titleStyle.size;
    const sizeNum = document.createElement('input');
    sizeNum.type = 'number'; sizeNum.className = 'nc-ts-num';
    sizeNum.min = 14; sizeNum.max = 24; sizeNum.step = 1;
    sizeNum.value = S.titleStyle.size;
    sizeRange.oninput = () => {
        const v = +sizeRange.value;
        S.titleStyle.size = v; sizeNum.value = v;
        saveAndSync(); canvas.setDirty(true, true); app.graph.setDirtyCanvas(true, true);
    };
    sizeNum.oninput = () => {
        const v = Math.max(14, Math.min(24, +sizeNum.value || 14));
        S.titleStyle.size = v; sizeRange.value = v;
        saveAndSync(); canvas.setDirty(true, true); app.graph.setDirtyCanvas(true, true);
    };
    sizeRow.appendChild(sizeLbl); sizeRow.appendChild(sizeRange); sizeRow.appendChild(sizeNum);
    // 字号行挪到「字色/对齐」之后、「偏移 X」之前（见下方 appendChild 顺序）

    // ── 第2行：标题对齐 ──
    const styleRow = document.createElement('div');
    styleRow.className = 'nc-ts-subrow';

    // 标题对齐（左/中/右）
    const alignLbl = document.createElement('label');
    alignLbl.textContent = t('nodes.nodeColor.titleAlign');
    const alignSeg = document.createElement('div');
    alignSeg.className = 'nc-ts-seg';
    const alignDefs = [
        { key: 'left',   label: t('nodes.nodeColor.alignLeft') },
        { key: 'center', label: t('nodes.nodeColor.alignCenter') },
        { key: 'right',  label: t('nodes.nodeColor.alignRight') },
    ];
    const alignBtns = {};
    alignDefs.forEach((def) => {
        const btn = document.createElement('div');
        btn.className = 'nc-ts-si' + (S.titleStyle.align === def.key ? ' on' : '');
        btn.textContent = def.label;
        btn.onclick = () => {
            S.titleStyle.align = def.key;
            alignDefs.forEach(d => alignBtns[d.key]?.classList.toggle('on', d.key === def.key));
            saveAndSync(); canvas.setDirty(true, true); app.graph.setDirtyCanvas(true, true);
        };
        alignBtns[def.key] = btn;
        alignSeg.appendChild(btn);
    });
    styleRow.appendChild(alignLbl);
    styleRow.appendChild(alignSeg);
    tsGroup.appendChild(styleRow);
    tsGroup.appendChild(sizeRow);   // 字号：字色/对齐 之后、偏移 之前

    // ── 第3/4行：标题 X / Y 轴偏移（各占一整行，长滑条更好操作）──
    function _mkOffRow(label, key, min, max) {
        const row = document.createElement('div');
        row.className = 'nc-ts-subrow';
        const lbl = document.createElement('label'); lbl.textContent = label;
        const rng = document.createElement('input');
        rng.type = 'range'; rng.className = 'nc-ts-range'; rng.min = min; rng.max = max; rng.step = 1;
        rng.value = S.titleStyle[key] || 0;
        const num = document.createElement('input');
        num.type = 'number'; num.className = 'nc-ts-num'; num.min = min; num.max = max; num.step = 1;
        num.value = S.titleStyle[key] || 0;
        const apply = (v) => {
            v = Math.max(min, Math.min(max, parseInt(v) || 0));
            S.titleStyle[key] = v; rng.value = v; num.value = v;
            saveAndSync(); canvas.setDirty(true, true); app.graph.setDirtyCanvas(true, true);
        };
        rng.oninput = () => apply(rng.value);
        num.oninput = () => apply(num.value);
        row.appendChild(lbl); row.appendChild(rng); row.appendChild(num);
        tsGroup.appendChild(row);
    }
    _mkOffRow(t('nodes.nodeColor.titlePositionX'), 'x', -80, 80);
    _mkOffRow(t('nodes.nodeColor.titlePositionY'), 'y', -16, 16);

    tsWrap.appendChild(tsGroup);

    panel.appendChild(tsWrap);



    // footer
    const fRow=document.createElement("div");fRow.className="nc-fb";
    const resetBtn=document.createElement("button");resetBtn.className="nc-cfb";resetBtn.textContent=t('common.reset');
    resetBtn.onclick=()=>{
        _isCleared = true;  // 标记为清除预览状态
        clearNodeColors(nodes, linkedGroups);
        // 重置面板状态到 3 色渐变初始化
        S.dir = '↓';
        S.h = 20; S.s = 82; S.v = 83;
        S.stops = [{p:0,h:20,s:82,v:83},{p:0.5,h:20,s:70,v:55},{p:1,h:20,s:60,v:30}];
        S.aStop = 0;
        S.titleStyle = { size: 14, color: 'var(--ws-text-on-accent)', align: 'left', weight: 'normal', x: 0, y: 0 };
        refreshAllNodeVisuals();
        refresh();
        resetBtn.classList.add('nc-cleared');  // 清除按钮高亮
    };
    const confirmBtn=document.createElement("button");confirmBtn.className="nc-cfb";confirmBtn.textContent=t('common.apply');
    confirmBtn.onclick=()=>{
        if (_isCleared) {
            // 清除状态：保持已清除效果，直接关闭（不再重新上色）
        } else {
            applyToNodes();
        }
        close();
    };
    fRow.appendChild(resetBtn);fRow.appendChild(confirmBtn);
    panel.appendChild(fRow);

    const cr=document.createElement("div");cr.className="nc-cr";
    cr.innerHTML='<span>' + WOSAI_COPYRIGHT + '</span>';
    panel.appendChild(cr);

    document.body.appendChild(panel);

    // 打开面板时隐藏 HUB BAR，关闭后恢复
    const _restoreHubBar = window.__wosaiWithHubBarHidden
        ? window.__wosaiWithHubBarHidden() : null;

    const gap = 12;
    const pR = panel.getBoundingClientRect();
    const n0 = nodes && nodes[0];
    const haveNode = n0 && n0.pos && n0.size && canvas?.canvas && canvas?.ds;
    const canvasRect = haveNode ? canvas.canvas.getBoundingClientRect() : null;
    const position = placeFloatingPanel({
        panelWidth: pR.width,
        panelHeight: pR.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        target: haveNode ? n0 : null,
        canvas: haveNode ? {
            left: canvasRect.left,
            top: canvasRect.top,
            scale: canvas.ds.scale,
            offset: canvas.ds.offset,
        } : null,
        anchor: anchorRect,
        gap,
        gutter: 10,
    });
    panel.style.left = position.left + 'px';
    panel.style.top = position.top + 'px';

    // 固定屏幕尺寸，只跟随目标节点/分组的世界坐标。
    panel.style.transform = '';
    const _followTargets = linkedGroups.length ? linkedGroups : nodes;
    const _followCleanup = registerSelectionFollower(panel, {
        placement: 'side',
        gap,
        targets: _followTargets,
        canvas,
    });

    // store 同步加载 localStorage；服务端预设异步合并后重渲染
    // initStore() 内部已吞掉 fetch 错误，但 then 回调里的 renderRecentPicks() /
    // buildPresets() 抛错仍会产生 unhandledrejection 并让面板停在半初始化状态，
    // 因此必须补 catch（同步那一行已先渲染过一次，这里失败不会白屏）。
    initStore()
        .then(() => { renderRecentPicks(); buildPresets(); })
        .catch(e => console.warn("WOSAI 节点配色: preset merge failed.", e));
    buildPresets();renderRecentPicks();rebuildPins();refresh();
    // 初始化时同步渐变 UI 显隐
    updateGradVisibility();
    // 默认不自动上色：仅刷新 UI，等用户调整或点击「应用」再写入节点

    // --- Drag handlers ---
    // 命名处理器：close() 中统一移除，防止每次开面板都在 document 上累积监听器（内存泄漏）
    const svEl=document.getElementById('ncSv');let svDrag=false;
    const _svMove=e=>{if(svDrag)onSvMove(e);};
    const _svUp=()=>svDrag=false;
    if(svEl){
        svEl.addEventListener('pointerdown',e=>{svDrag=true;onSvMove(e);e.preventDefault();});
        document.addEventListener('pointermove',_svMove);
        document.addEventListener('pointerup',_svUp);
        document.addEventListener('pointercancel',_svUp);
    }
    function onSvMove(e){
        if(!svEl)return;
        const r=svEl.getBoundingClientRect();
        S.s=Math.round(Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*100);
        S.v=Math.round((1-Math.max(0,Math.min(1,(e.clientY-r.top)/r.height)))*100);
        if(S.stopCount>1){const st=S.stops[S.aStop];st.s=S.s;st.v=S.v;}
        saveAndSync();refresh();
    }

    function close(){
        _followCleanup();
        _onHexChFn=null;hideTip();panel.remove();
        _offGlass();   // 退订玻璃主题广播
        if(_restoreHubBar) _restoreHubBar();
        document.removeEventListener("pointerdown",_closeHandler,{capture:true});
        offGlobal('nc-gray-down');
        offGlobal('nc-gray-up');
        window.removeEventListener('blur',_onGrayBlur);
        document.removeEventListener('pointermove',_svMove);
        document.removeEventListener('pointerup',_svUp);
        document.removeEventListener('pointercancel',_svUp);
        // 色相滑条 document 级别事件清理
        if (_hsMove) document.removeEventListener('pointermove', _hsMove);
        if (_hsUp) { document.removeEventListener('pointerup', _hsUp); document.removeEventListener('pointercancel', _hsUp); }
        // 补移除 rebuildPins 注册的 document 级监听器（防面板关闭后残留累积）
        if (_pinOnMove) document.removeEventListener('pointermove', _pinOnMove);
        if (_pinOnUp) {
            document.removeEventListener('pointerup', _pinOnUp);
            document.removeEventListener('pointercancel', _pinOnUp);
        }
        // 最终 DOM 刷新：清除后关闭时确保 Vue 没有把旧色写回
        if (_isCleared) refreshAllNodeVisuals();
    }
    // 暴露 close 路径：旧面板清理(L78-82)可通过 _wosaiClose() 正确解绑监听
    panel._wosaiClose = close;
}

app.registerExtension({
    name: "WOSAI.NodeColor",

    async setup() {
        const generation = ++_nodeColorGeneration;
        _nodeColorActive = true;
        const isCurrent = () => _nodeColorActive && generation === _nodeColorGeneration;
        const scheduleSetup = (callback, delay) => {
            const timer = setTimeout(() => {
                _nodeColorSetupTimers.delete(timer);
                if (isCurrent()) callback();
            }, delay);
            _nodeColorSetupTimers.add(timer);
            return timer;
        };

        // 等待 color-core.js 的 palettes 加载完成（兼容不支持 import ... with json 的运行时）
        const palettes = await palettesPromise;
        if (!isCurrent()) return;
        _SLOT_DEFAULTS = (palettes && palettes.nodeColorGradSlots) || [];

        // 动态加载静态面板 CSS（由 os-color.css 提供）
        if (!document.getElementById("wosai-os-color-css") && !document.querySelector('link[href*="os-color.css"]')) {
            const link = document.createElement("link");
            link.id = "wosai-os-color-css";
            link.rel = "stylesheet";
            link.href = new URL("./styles/os-color.css", import.meta.url).href;
            document.head.appendChild(link);
        }

        // ── F2 快捷键 → 打开「高级配色」（选中节点 / 分组）──
        // F2 是 LiteGraph 原生重命名键：用捕获阶段拦截，有选中目标时打开面板并阻止默认；无选中则放行
        if (window._wosaiF2Handler) window.removeEventListener('keydown', window._wosaiF2Handler, true);
        window._wosaiF2Handler = (e) => {
            if (e.key !== 'F2' || e.repeat) return;
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;   // 输入中不触发
            const sel = getSelectedNodes().filter(n => n.type !== "WOSAI_CanvasNote");
            const selGroups = getSelectedGroups();
            if (sel.length > 0) { e.preventDefault(); e.stopPropagation(); openNodeColorPicker(sel, undefined, selGroups); return; }
            if (selGroups.length) { e.preventDefault(); e.stopPropagation(); openPickerForGroups(selGroups); }
        };
        window.addEventListener('keydown', window._wosaiF2Handler, true);

        // cssGradientDir（箭头 → CSS 渐变方向）由 lib/color-core.js 提供

        // Convert hex to rgb string for style comparison
        const hexToRgbStr = (hex) => {
            if (!hex || hex.length < 7) return null;
            const r = parseInt(hex.slice(1,3), 16);
            const g = parseInt(hex.slice(3,5), 16);
            const b = parseInt(hex.slice(5,7), 16);
            if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
            return `rgb(${r}, ${g}, ${b})`;
        }

        // Find the DOM element that visually represents a node's background
        const _bgElCache = new Map();  // key: node.id:bgColor → element|null
        const _appliedGrad = new Set();  // 已应用 inline 渐变的 node.id（用于精确清理，避免每次刷新遍历全部节点 querySelector → 卡顿）

        function findNodeBgElement(node) {
            const bgColor = node.bgcolor;
            if (!bgColor || bgColor.length < 7) return null;
            const cacheKey = `${node.id}:${bgColor}`;
            if (_bgElCache.has(cacheKey)) return _bgElCache.get(cacheKey);

            const rgbTarget = hexToRgbStr(bgColor);
            const hexUpper = bgColor.toUpperCase();

            // Strategy 1: try known container selectors (cheap)
            const sel = `[data-node-id="${node.id}"], [data-id="${node.id}"], #node-${node.id}`;
            const containers = document.querySelectorAll(sel);
            for (const c of containers) {
                const cs = getComputedStyle(c);
                if (cs.backgroundColor === rgbTarget || cs.backgroundColor === getWOSAIVar('--ws-nc-transparent')) {
                    _bgElCache.set(cacheKey, c);
                    return c;
                }
                // Search children for the element that actually has the bg
                const children = c.querySelectorAll('*');
                for (const child of children) {
                    const ccs = getComputedStyle(child);
                    if (ccs.backgroundColor === rgbTarget) { _bgElCache.set(cacheKey, child); return child; }
                    if (child.getAttribute('style')?.toUpperCase().includes(hexUpper)) { _bgElCache.set(cacheKey, child); return child; }
                }
            }

            // Strategy 2: scan canvas-container subtree (原为全 document 扫描，已收敛)
            const _scanRoot = document.getElementById('graph-canvas-container')
                || document.querySelector('.graph-canvas-container, .graph-canvas, #graph-canvas')
                || document.body;
            const all = _scanRoot.querySelectorAll('*');
            for (const el of all) {
                const cs = getComputedStyle(el);
                if (cs.backgroundColor === rgbTarget) {
                    _bgElCache.set(cacheKey, el);
                    return el;
                }
            }

            // Strategy 3: scan inline style attributes for the hex value
            for (const el of all) {
                const s = el.getAttribute('style');
                if (s && s.toUpperCase().includes(hexUpper)) {
                    _bgElCache.set(cacheKey, el);
                    return el;
                }
            }

            _bgElCache.set(cacheKey, null);
            return null;
        }

        // 在节点 DOM 元素上应用渐变背景（一次性 inline style 写入，不使用 MutationObserver ）
        // 参考单色模式的机制：
        //   Vue 把颜色写入节点 DOM（通过 CSS 变量 --component-node-background / --component-node-header）
        //   渐变模式：在 inner-wrapper / header / body 上用 background: linear-gradient(...) !important 覆盖
        function _applyGradientInline(node) {
            const g = node._gradient;
            if (!g) return;
            const isSplit = g.mode === 'split' && g.title && g.body;

            const container = document.querySelector(`[data-node-id="${node.id}"]`);
            if (!container) return;

            const inner = container.querySelector('[data-testid="node-inner-wrapper"]');
            const header = container.querySelector(`[data-testid="node-header-${node.id}"]`);
            const body = container.querySelector(`[data-testid="node-body-${node.id}"]`);

            // 清除旧值（先清，再设），避免不同属性互相干扰
            const _clearBg = (el) => {
                if (!el) return;
                el.style.removeProperty('background');
                el.style.removeProperty('background-image');
                el.style.removeProperty('background-color');
                el.style.removeProperty('--component-node-background');
                el.style.removeProperty('--component-node-header');
            };
            _clearBg(inner); _clearBg(header); _clearBg(body);

            if (isSplit) {
                // 分区域渐变：inner 透明，header 独立渐变，body 独立渐变
                const titleGrad = sharpGradientCSS(cssGradientDir(g.title.dir), g.title.stops);
                const bodyGrad  = sharpGradientCSS(cssGradientDir(g.body.dir), g.body.stops);

                if (inner) {
                    inner.style.setProperty('background', 'transparent', 'important');
                    inner.style.setProperty('--component-node-background', 'transparent', 'important');
                    inner.style.setProperty('--component-node-header',     'transparent', 'important');
                }
                if (header) {
                    header.style.setProperty('background', titleGrad, 'important');
                    header.style.setProperty('--component-node-header', 'transparent', 'important');
                }
                if (body) {
                    body.style.setProperty('background', bodyGrad, 'important');
                    body.style.setProperty('--component-node-background', 'transparent', 'important');
                } else if (inner) {
                    inner.style.setProperty('background', bodyGrad, 'important');
                    if (header) header.style.setProperty('background', titleGrad, 'important');
                }
            } else {
                // 整体渐变（sync 模式）：渐变设在 inner-wrapper 上，覆盖 header+body 整个区域
                let gradCSS;
                if (g.stops) gradCSS = sharpGradientCSS(cssGradientDir(g.dir), g.stops);
                else         gradCSS = `linear-gradient(${cssGradientDir(g.dir)}, ${g.from} 0%, ${g.from} 30%, ${g.to} 70%, ${g.to} 100%)`;
                const target = inner || container;
                target.style.setProperty('background', gradCSS, 'important');
                if (body) body.style.setProperty('background-color', 'transparent', 'important');
                if (inner) {
                    inner.style.setProperty('--component-node-background', 'transparent', 'important');
                    inner.style.setProperty('--component-node-header',     'transparent', 'important');
                }
            }
        }

        function applyGradientToNode(node, retries = 5) {
            const g = node._gradient;
            if (!g) return;

            // Nodes 2.0 (Vue DOM)：一次性写入 inline style
            const container2 = document.querySelector(`[data-node-id="${node.id}"]`);
            if (container2) { _applyGradientInline(node); return; }

            // Classic 模式：data-wgrad 标记（降级使用标题 / 整体渐变）
            const markerId = `wgrad-${node.id}`;
            let el = document.querySelector(`[data-wgrad="${markerId}"]`);
            if (!el) el = findNodeBgElement(node);
            if (!el) { if (retries > 0) setTimeout(() => applyGradientToNode(node, retries - 1), 80); return; }
            el.setAttribute('data-wgrad', markerId);
            const isSplit = g.mode === 'split' && g.title && g.body;
            let gradCSS;
            if (isSplit) gradCSS = sharpGradientCSS(cssGradientDir(g.title.dir), g.title.stops);
            else if (g.stops) gradCSS = sharpGradientCSS(cssGradientDir(g.dir), g.stops);
            else gradCSS = `linear-gradient(${cssGradientDir(g.dir)}, ${g.from} 0%, ${g.from} 30%, ${g.to} 70%, ${g.to} 100%)`;
            el.style.setProperty('background', gradCSS, 'important');
        }

        // 清除节点渐变（恢复 Vue 原生背景）
        function clearGradientFromNode(node) {
            const container2 = document.querySelector(`[data-node-id="${node.id}"]`);
            if (container2) {
                const inner = container2.querySelector('[data-testid="node-inner-wrapper"]');
                const header = container2.querySelector(`[data-testid="node-header-${node.id}"]`);
                const body = container2.querySelector(`[data-testid="node-body-${node.id}"]`);
                const _clearBg = (el) => {
                    if (!el) return;
                    el.style.removeProperty('background');
                    el.style.removeProperty('background-image');
                    el.style.removeProperty('background-color');
                    el.style.removeProperty('--component-node-background');
                    el.style.removeProperty('--component-node-header');
                };
                _clearBg(inner); _clearBg(header); _clearBg(body);
                container2.style.removeProperty('background-image');
                container2.style.removeProperty('background');
            }
            const markerId = `wgrad-${node.id}`;
            document.querySelectorAll(`[data-wgrad="${markerId}"]`).forEach(el => {
                el.removeAttribute('data-wgrad');
                el.style.removeProperty('background');
                el.style.removeProperty('background-image');
            });
        }

        // Rebuild all gradient CSS rules
        function refreshDOMGradients() {
            _bgElCache.clear();  // 每次重建时清空缓存，防止 Vue DOM 替换后缓存过期
            const graph = app.graph;
            if (!graph?.nodes) return;

            // 只清除不再有渐变的节点的 data-wgrad 标记
            const markerIds = new Set(
                graph.nodes.filter(n => n._gradient).map(n => `wgrad-${n.id}`)
            );
            document.querySelectorAll('[data-wgrad]').forEach(el => {
                if (!markerIds.has(el.getAttribute('data-wgrad'))) el.removeAttribute('data-wgrad');
            });

            // ── 重建 CSS 规则（background !important 覆盖 Vue 颜色） ──
            //   CSS 规则优先级：带 !important 的属性 > 元素内联 style 中对应属性
            //   所以 [data-node-id="N"] [data-testid="..."] { background: linear-gradient(...) !important }
            //   会覆盖 Vue 在该元素内联设置的 background-color / --component-node-background。
            //   注：CSS 变量(--component-node-*) 不受 !important 影响，主要靠 background 简写的 !important 覆盖视觉。
            let css = '';
            for (const node of graph.nodes) {
                const g = node._gradient;
                if (!g) continue;
                if (node._osHideTitle) continue;   // 被 OmniSlider 隐藏的节点不生成渐变规则，让隐藏生效
                const isSplit = g.mode === 'split' && g.title && g.body;

                let titleGrad, bodyGrad, unifiedGrad;
                if (isSplit) {
                    titleGrad = sharpGradientCSS(cssGradientDir(g.title.dir), g.title.stops);
                    bodyGrad  = sharpGradientCSS(cssGradientDir(g.body.dir),  g.body.stops);
                } else {
                    const dir = cssGradientDir(g.dir);
                    if (g.stops) unifiedGrad = sharpGradientCSS(dir, g.stops);
                    else         unifiedGrad = `linear-gradient(${dir}, ${g.from} 0%, ${g.from} 30%, ${g.to} 70%, ${g.to} 100%)`;
                }

                const markerId = `wgrad-${node.id}`;
                const sel = `[data-node-id="${node.id}"]`;
                // Classic 模式：data-wgrad 标记（降级使用标题 / 整体渐变）
                css += `[data-wgrad="${markerId}"] { background: ${isSplit ? titleGrad : unifiedGrad} !important; }\n`;

                if (isSplit) {
                    // 分区域渐变：inner 透明，header / body 各自独立渐变
                    css += `${sel} [data-testid="node-inner-wrapper"]    { background: transparent !important; }\n`;
                    css += `${sel} [data-testid="node-header-${node.id}"] { background: ${titleGrad} !important; }\n`;
                    css += `${sel} [data-testid="node-body-${node.id}"]   { background: ${bodyGrad} !important; }\n`;
                } else {
                    // 整体渐变：渐变设在 inner-wrapper，body 不透明色块清除
                    css += `${sel} [data-testid="node-inner-wrapper"]    { background: ${unifiedGrad} !important; }\n`;
                    css += `${sel} [data-testid="node-body-${node.id}"]   { background-color: transparent !important; }\n`;
                }
            }
            const styleEl = document.getElementById('wosai-gradient-styles');
            if (styleEl) styleEl.textContent = css;

            // 一次性 inline style 写入（辅助覆盖 Vue 内联 style，尤其对启动时已渲染的节点立即生效）
            for (const node of graph.nodes) {
                if (node._gradient && !node._osHideTitle) {
                    applyGradientToNode(node);
                    _appliedGrad.add(node.id);
                } else if (_appliedGrad.has(node.id)) {
                    clearGradientFromNode(node);
                    _appliedGrad.delete(node.id);
                }
            }

            // 兜底：Vue 异步渲染后可能替换 DOM，RAF 后重试
            requestAnimationFrame(() => {
                for (const node of graph.nodes) {
                    if (node._gradient && !node._osHideTitle) applyGradientToNode(node, 2);
                }
            });
        }
        _refreshDOMGradients = refreshDOMGradients;
        _refreshDOMTitleStyles = refreshDOMTitleStyles;
        // 暴露给 OmniSlider：隐藏/显示切换后调用，使 node-color 重新评估渐变
        //   （隐藏时清渐变让隐藏生效，显示时恢复渐变）。
        try { window.__wosaiColorRefresh = refreshDOMGradients; } catch (_) {}

                // 单色模式 DOM 写入（Nodes 2.0 下渐变/单色必须都走 inline style）──
        //   Nodes 2.0 Vue 组件通过 --component-node-header / --component-node-background CSS 变量渲染颜色。
        //   setColorOption() 理论上触发 Vue 响应式更新这些变量，但实际在部分场景下不可靠，
        //   因此单色模式也直接写 DOM inline style（与渐变 _applyGradientInline 同一策略）。
        //   ⚠ 节点无色无渐变时也需清理 DOM 残留（防止「清除后确认」不生效）。
        function refreshDOMSolidColors() {
            const graph = app.graph;
            if (!graph?.nodes) return;

            for (const node of graph.nodes) {
                // 渐变节点由 refreshDOMGradients 负责，此处不重复处理
                if (node._gradient) continue;
                if (node._osHideTitle) continue;

                const container = document.querySelector(`[data-node-id="${node.id}"]`);
                if (!container) continue;

                const header = container.querySelector(`[data-testid="node-header-${node.id}"]`);
                const body   = container.querySelector(`[data-testid="node-body-${node.id}"]`);
                const inner  = container.querySelector('[data-testid="node-inner-wrapper"]');

                // 清除背景图残留（从渐变切换过来时的过渡态）
                const _clearImg = (el) => { if (el) el.style.removeProperty('background-image'); };
                _clearImg(inner); _clearImg(header); _clearImg(body);

                // 节点无色 OR 被 clearNodeColors 标记为待清除：
                //   强制走清理分支（防御 Vue getter 不可靠导致 node.color/node.bgcolor 仍保留旧值）
                if (!node.color && !node.bgcolor || node._wosaiForceClear) {
                    // ⚠ 不消费 _wosaiForceClear：保持标记直到重新上色，确保后续每次 Vue 重渲都走清理分支
                    //    （消费掉会导致选中节点触发的重渲再次按残留 node.color 上色 → 颜色复活）
                    const touched = [container, header, body, inner].filter(Boolean);
                    // 递归收集 container 内所有含 CSS 变量的后代元素
                    const allEls = container.querySelectorAll('*');
                    for (const el of allEls) {
                        if (el.style.getPropertyValue('--component-node-header') || el.style.getPropertyValue('--component-node-background')) {
                            touched.push(el);
                        }
                    }
                    const seen = new Set();
                    for (const el of touched) {
                        if (!el || seen.has(el)) continue;
                        seen.add(el);
                        el.style.removeProperty('background');
                        el.style.removeProperty('background-image');
                        el.style.removeProperty('background-color');
                        el.style.removeProperty('--component-node-header');
                        el.style.removeProperty('--component-node-background');
                    }
                    // 二段清理：防御 Vue nextTick 异步渲染在清理后又写入 CSS 变量
                    requestAnimationFrame(() => {
                        const tgt = document.querySelector(`[data-node-id="${node.id}"]`);
                        if (!tgt) return;
                        const all2 = tgt.querySelectorAll('*');
                        for (const el2 of [tgt, ...all2]) {
                            if (el2.style.getPropertyValue('--component-node-header') || el2.style.getPropertyValue('--component-node-background')) {
                                el2.style.removeProperty('background');
                                el2.style.removeProperty('background-image');
                                el2.style.removeProperty('background-color');
                                el2.style.removeProperty('--component-node-header');
                                el2.style.removeProperty('--component-node-background');
                            }
                        }
                    });
                    continue;
                }

                // Header 颜色（n.color）
                if (header) {
                    if (node.color) {
                        header.style.setProperty('background', node.color, 'important');
                        header.style.setProperty('--component-node-header', node.color, 'important');
                    } else {
                        header.style.removeProperty('background');
                        header.style.removeProperty('--component-node-header');
                    }
                }

                // Body 颜色（n.bgcolor）
                const bodyTarget = body || inner;
                if (bodyTarget) {
                    if (node.bgcolor) {
                        bodyTarget.style.setProperty('background', node.bgcolor, 'important');
                        bodyTarget.style.setProperty('--component-node-background', node.bgcolor, 'important');
                    } else {
                        bodyTarget.style.removeProperty('background');
                        bodyTarget.style.removeProperty('--component-node-background');
                    }
                }
            }
        }
        _refreshDOMSolidColors = refreshDOMSolidColors;

        // ── 模式检测：Nodes 2.0 (Vue DOM) vs Classic (Canvas) ──
        // Nodes 2.0 特征：[data-node-id] 属性存在于外层容器
        // Classic 特征：纯 Canvas 渲染，无 [data-node-id] DOM 元素
        function isNodes20Mode() {
            return !!document.querySelector('[data-node-id]');
        }

        // ── Nodes 2.0 DOM 标题样式注入 ──
        // Classic 模式走 Canvas redrawTitleText，Nodes 2.0 走 DOM 注入 + JS inline style
        //
        // 完整 DOM（从编译后 GraphView.js + NodeHeader.vue 确认）：
        //   [data-node-id="N"] (tabindex=0, position:absolute)
        //     └── [data-testid="node-inner-wrapper"] (flex flex-col)
        //           ├── [data-testid="node-header-N"] (lg-node-header)
        //           │     └── .flex .items-center .justify-between
        //           │           └── .relative .mr-auto .flex ...
        //           │                 └── [data-testid="node-title"] (flex items-center flex-1)
        //           │                       └── div.flex-1.truncate    ← overflow:hidden
        //           │                             └── .editable-text.inline
        //           │                                 非编辑: <span>
        //           │                                 编辑: <input data-testid="node-title-input">
        //           └── [data-testid="node-body-N"]
        //
        // 关键：.editable-text 在 EditableText 组件内部，Vue v-if 切换时销毁重建 DOM。
        //       但 CSS stylesheet 规则不依赖 DOM 实例，新元素自动匹配。
        //
        // 策略（字体/颜色）：CSS stylesheet 注入 → 已证实在 Nodes 2.0 生效
        // 策略（对齐）：放弃 text-align / justify-content / align-items
        //   — 这三者在 ComfyUI 编译 CSS 中全部被针对性覆盖（已验证 v5-v12）
        //   — 改用 margin auto：flex 容器内 margin auto 会吸收剩余空间
        //     左对齐: margin-right: auto; margin-left: 0
        //     居中:   margin-left: auto; margin-right: auto
        //     右对齐: margin-left: auto; margin-right: 0
        //   — margin 是 box-model 属性，不对应任何"对齐"CSS 属性，不可能被覆盖
        function refreshDOMTitleStyles() {
            // Classic 模式退出：标题由 Canvas redrawTitleText 绘制
            if (!isNodes20Mode()) return;
            const graph = app.graph;
            if (!graph?.nodes) return;

            let css = '';
            for (const node of graph.nodes) {
                const ts = node._titleStyle;
                if (!ts) continue;

                const fontSize = Math.max(8, Math.min(32, ts.size || 14));
                const color = ts.color || 'var(--ws-text-on-accent)';
                const align = ts.align || 'left';
                const weight = ts.weight || 'normal';
                const tx = ts.x || 0, ty = ts.y || 0;   // 标题 X/Y 偏移
                // margin auto 值
                const ml = align === 'right' ? 'auto' : (align === 'center' ? 'auto' : '0');
                const mr = align === 'left' ? 'auto' : (align === 'center' ? 'auto' : '0');

                const sel = `[data-node-id="${node.id}"]`;

                // 规则 0：撑满标题包裹链——margin auto 只有在父容器有剩余空间时才生效。
                // 默认 .relative.mr-auto 会收缩到内容宽并被 mr-auto 挤到左侧，
                // node-title / .truncate 也不主动 grow，导致无剩余空间 → margin auto 无效。
                // 因此强制 wrapper → node-title → .truncate 全部撑满标题栏宽度。
                // ⚠ 不设 width:100%——否则外层占满整个标题栏，把原生图钉(📌固定)挤到 0 宽消失。
                //   flex:1 1 auto 已能让标题增长填充"除图钉外"的剩余空间，margin auto 仍有效。
                css +=
                    `${sel} [data-testid="node-header-${node.id}"] .mr-auto {\n` +
                    `  flex: 1 1 auto !important;\n` +
                    `  min-width: 0 !important;\n` +
                    `  margin-right: 0 !important;\n` +
                    `}\n`;
                css +=
                    `${sel} [data-testid="node-title"] {\n` +
                    `  flex: 1 1 auto !important;\n` +
                    `  width: 100% !important;\n` +
                    `  min-width: 0 !important;\n` +
                    `}\n`;

                // 规则 1：.truncate → flex 容器（提供 margin auto 的环境，并撑满宽度）
                css +=
                    `${sel} [data-testid="node-title"] > .truncate {\n` +
                    `  display: flex !important;\n` +
                    `  align-items: center !important;\n` +
                    `  overflow: visible !important;\n` +
                    `  flex: 1 1 auto !important;\n` +
                    `  width: 100% !important;\n` +
                    `  min-width: 0 !important;\n` +
                    `}\n`;

                // 规则 2：.editable-text — margin auto 控制水平位置，同时转 flex 填满
                css +=
                    `${sel} [data-testid="node-title"] .editable-text {\n` +
                    `  flex: 1 1 auto !important;\n` +
                    `  width: 100% !important;\n` +
                    `  min-width: 0 !important;\n` +
                    `  display: flex !important;\n` +
                    `  align-items: center !important;\n` +
                    `}\n`;

                // 规则 3：span — flex item + margin auto 实现对齐（核心！）
                // 关键：span 是 .editable-text（flex 容器）的子元素
                // flex 子元素上 margin auto 会吸收剩余空间：
                //   mr=auto  → 推左   ml=auto  → 推右   双 auto → 居中
                css +=
                    `${sel} [data-testid="node-title"] .editable-text span {\n` +
                    `  font-size: ${fontSize}px !important;\n` +
                    `  color: ${color} !important;\n` +
                    `  font-weight: ${weight} !important;\n` +
                    `  margin-left: ${ml} !important;\n` +
                    `  margin-right: ${mr} !important;\n` +
                    `  transform: translate(${tx}px, ${ty}px) !important;\n` +
                    `}\n`;

                // 规则 4：编辑模式 <input> — margin auto + 字体颜色
                css +=
                    `${sel} [data-testid="node-title"] [data-testid="node-title-input"] {\n` +
                    `  font-size: ${fontSize}px !important;\n` +
                    `  color: ${color} !important;\n` +
                    `  font-weight: ${weight} !important;\n` +
                    `  margin-left: ${ml} !important;\n` +
                    `  margin-right: ${mr} !important;\n` +
                    `  transform: translate(${tx}px, ${ty}px) !important;\n` +
                    `}\n`;
            }

            let styleEl = document.getElementById('wosai-title-styles');
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = 'wosai-title-styles';
                document.head.appendChild(styleEl);
            }
            styleEl.textContent = css;
        }

        // ═══════════════════════════════════════════════════════════════
        // JS inline style 兜底：margin auto 控制水平位置（仅 Nodes 2.0）
        // margin 是 box-model 属性，不会被 ComfyUI 对齐相关 CSS 覆盖
        // 在 Vue DOM 重建后由 MutationObserver 重新执行
        // ═══════════════════════════════════════════════════════════════
        function applyTitleAlignInline() {
            // Classic 模式退出：对齐由 Canvas ctx.textAlign 处理
            if (!isNodes20Mode()) return;
            const graph = app.graph;
            if (!graph?.nodes) return;

            for (const node of graph.nodes) {
                const ts = node._titleStyle;
                if (!ts) continue;
                const align = ts.align || 'left';
                const ml = align === 'right' ? 'auto' : (align === 'center' ? 'auto' : '0');
                const mr = align === 'left' ? 'auto' : (align === 'center' ? 'auto' : '0');

                const container = document.querySelector(`[data-node-id="${node.id}"]`);
                if (!container) continue;

                // node-title 及其外层 wrapper（.relative.mr-auto）→ 撑满标题栏宽度
                // 否则下游 margin auto 没有可吸收的剩余空间
                const nodeTitle = container.querySelector('[data-testid="node-title"]');
                if (nodeTitle) {
                    nodeTitle.style.setProperty('flex', '1 1 auto', 'important');
                    nodeTitle.style.setProperty('width', '100%', 'important');
                    nodeTitle.style.setProperty('min-width', '0', 'important');
                    const wrap = nodeTitle.parentElement;
                    if (wrap) {
                        wrap.style.setProperty('flex', '1 1 auto', 'important');
                        wrap.style.setProperty('width', '100%', 'important');
                        wrap.style.setProperty('min-width', '0', 'important');
                        wrap.style.setProperty('margin-right', '0', 'important');
                    }
                }

                // .editable-text → flex 容器（撑满）
                const et = container.querySelector('[data-testid="node-title"] .editable-text');
                if (et) {
                    et.style.setProperty('display', 'flex', 'important');
                    et.style.setProperty('align-items', 'center', 'important');
                    et.style.setProperty('flex', '1 1 auto', 'important');
                    et.style.setProperty('width', '100%', 'important');
                    et.style.setProperty('min-width', '0', 'important');
                }

                // .truncate → flex 容器（撑满）
                const trunc = container.querySelector('[data-testid="node-title"] > .truncate');
                if (trunc) {
                    trunc.style.setProperty('display', 'flex', 'important');
                    trunc.style.setProperty('align-items', 'center', 'important');
                    trunc.style.setProperty('overflow', 'visible', 'important');
                    trunc.style.setProperty('flex', '1 1 auto', 'important');
                    trunc.style.setProperty('width', '100%', 'important');
                    trunc.style.setProperty('min-width', '0', 'important');
                }

                // span — flex item, margin auto 吸收剩余空间
                const span = container.querySelector('[data-testid="node-title"] .editable-text span');
                if (span) {
                    span.style.setProperty('margin-left', ml, 'important');
                    span.style.setProperty('margin-right', mr, 'important');
                }

                // input — margin auto 对齐
                const input = container.querySelector('[data-testid="node-title"] [data-testid="node-title-input"]');
                if (input) {
                    input.style.setProperty('margin-left', ml, 'important');
                    input.style.setProperty('margin-right', mr, 'important');
                }
            }
        }
        _applyTitleAlignInline = applyTitleAlignInline;

        // ── 在标题栏右侧绘制节点角标（📌固定 + ⊘禁用）──
        //  由下面三个渲染路径统一调用，避免重复代码和遗漏：
        //  ① makeDrawShapeWrapper 渐变路径（origFn 前，globalAlpha=0 之前）
        //  ② makeDrawShapeWrapper 经典路径（origFn 后，仅无 _titleStyle 时）
        //  ③ redrawTitleText（有 _titleStyle 时统一重绘标题+角标）
        //  坐标系：原点在节点内容区左上角，标题栏 y ∈ [-th, 0]
        function _drawNodeBadges(ctx, node, w, th, needPin = true) {
            const pinned = !!(node.flags && node.flags.pinned);
            // 📌 固定角标（仅当 WOSAI 渲染覆盖了 ComfyUI 原生图钉时才补画）
            //   needPin=false → 经典模式，原生完整保留 → 跳过
            if (pinned && needPin) {
                ctx.save();
                ctx.font = `${Math.round(th * 0.6)}px Arial, sans-serif`;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = 'var(--ws-nc-badge-pinned)';
                ctx.fillText('📌', w - 4, -th / 2 + 1);
                ctx.restore();
            }
            // ⊘ 禁用角标（mode=2）
            if (node.mode === 2) _drawDisabledBadge(ctx, w, th, pinned);
        }

        // ── 在标题栏右侧绘制禁用角标（mode=2 时显示，圆圈+斜杠）──
        // 坐标系：原点在节点内容区左上角，标题栏 y ∈ [-th, 0]
        //   pinned=true 时自动左移避开 📌 图钉（参考图钉实现方案）
        function _drawDisabledBadge(ctx, w, th, pinned) {
            const r = Math.max(3, th * 0.22);          // 外圈半径
            // 有 📌 时左移一个图钉宽度（≈ th*0.58），否则紧贴右边缘
            const cx = w - (pinned ? th * 1.1 : th * 0.55);
            const cy = -th * 0.5;                       // 垂直居中于标题栏
            ctx.save();
            ctx.strokeStyle = 'var(--ws-nc-badge-disabled)'; // 柔和红
            ctx.lineWidth = Math.max(1.2, r * 0.18);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();
            // 斜杠
            const d = r * 0.62;
            ctx.beginPath();
            ctx.moveTo(cx - d * 0.707, cy - d * 0.707);
            ctx.lineTo(cx + d * 0.707, cy + d *0.707);
            ctx.stroke();
            ctx.restore();
        }

        // 在 Canvas 上重绘节点标题文字（覆盖原来的标题渲染）
        // 调用时坐标系原点在节点内容区左上角（标题栏顶部 y = -th）
        function redrawTitleText(node, ctx) {
            const ts = node._titleStyle;
            if (!ts) return;
            if (node.flags?.collapsed) return;   // 折叠态用原生胶囊，避免整宽标题条溢出
            const LG = typeof LiteGraph !== 'undefined' ? LiteGraph : null;
            const th = LG?.NODE_TITLE_HEIGHT || 30;
            const w = node.size[0];
            const title = node.getTitle ? node.getTitle() : (node.title || '');
            if (!title) return;

            const fontSize = Math.max(8, Math.min(32, ts.size || 14));
            const color = ts.color || 'var(--ws-text-on-accent)';
            const align = ts.align || 'left';
            const pad = 10;

            // 取标题栏背景色：优先用节点自定义色，否则用 LiteGraph 默认值
            const titleBg = (node.color && node.color !== getWOSAIVar('--ws-nc-transparent'))
                ? node.color
                : (LG?.NODE_DEFAULT_COLOR || 'var(--ws-surface-3)');

            const r = LG?.NODE_CORNER_RADIUS ?? 8;

            ctx.save();
            // 用标题背景色重绘标题区域（清除原来的文字），再写入新样式的文字
            ctx.beginPath();
            canvasRoundRect(ctx, 0, -th, w, th, [r, r, 0, 0]);
            ctx.fillStyle = titleBg;
            ctx.fill();

            // 写新样式文字（含标题 X 轴偏移）
            let x;
            if (align === 'left') x = pad;
            else if (align === 'right') x = w - pad;
            else x = w / 2;
            x += (ts.x || 0);

            ctx.font = `${ts.weight || "bold"} ${fontSize}px Arial, sans-serif`;
            ctx.fillStyle = color;
            ctx.textAlign = align;
            ctx.textBaseline = 'middle';
            // 自适应阴影，确保在亮色背景（金黄、沙橙等）上文字也清晰
            _applyTitleShadow(ctx, color);
            ctx.fillText(title, x, -th / 2 + (ts.y || 0));
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            // 统一绘制角标（📌固定 + ⊘禁用）
            _drawNodeBadges(ctx, node, w, th);
            ctx.restore();
        }

        // ── 公共：OmniSlider 精简模式画布层隐藏（drawNodeShape/drawNode 共用）──
        //   还原上一帧清空的角标 → 按需清空 badges → 隐藏标题时设透明色。
        //   返回 true 表示调用方应跳过原生绘制（return）。
        function _applyOmniHide(node) {
            if (!node || node.type !== "WOSAI_OmniSlider") return false;
            // 每帧先还原上一帧清空的角标，再按需清空 → 关闭开关后角标自动恢复
            if (node._osOrigBadges !== undefined) {
                node.badges = node._osOrigBadges;
                node._osOrigBadges = undefined;
            }
            if (node._osHideBadge && Array.isArray(node.badges) && node.badges.length) {
                node._osOrigBadges = node.badges;
                node.badges = [];   // 本帧清空，后续就画不出 WOSAI 角标
            }
            if (node._osHideTitle) {
                node.bgcolor = getWOSAIVar('--ws-nc-transparent');
                node.color = getWOSAIVar('--ws-nc-transparent-white');
                return true;   // 调用方跳过标题栏+节点体背景；端口由父级 drawNode 后续绘制
            }
            return false;
        }

        // ── 公共：8 方向线性渐变端点（drawNodeShape/drawNode 共用，消除 pts 字典重复）──
        function _gradPts(w, h, th) {
            return {
                '↖': [w, h, 0, -th], '↑': [0, h, 0, -th], '↗': [0, h, w, -th],
                '←': [w, 0, 0,  0],  '→': [0, 0, w,  0],
                '↙': [w, -th, 0, h], '↓': [0, -th, 0, h], '↘': [0, -th, w, h],
            };
        }

        // ── 公共：按标题色亮度设置自适应阴影（亮色→黑影，暗色→白影），确保任意背景可读 ──
        function _applyTitleShadow(ctx, color) {
            const cc = (typeof color === 'string' && color.startsWith('#')) ? color : getWOSAIVar('--ws-nc-title-on-gradient');
            const cr = parseInt(cc.slice(1, 3), 16), cg = parseInt(cc.slice(3, 5), 16), cb = parseInt(cc.slice(5, 7), 16);
            const clum = 0.299 * cr + 0.587 * cg + 0.114 * cb;
            ctx.shadowColor = clum > 128 ? getWOSAIVar('--ws-nc-shadow-dark') : getWOSAIVar('--ws-nc-shadow-light');
            ctx.shadowBlur = 3;
        }

        // ── drawNodeShape wrapper（经典模式渐变，CYBERPUNK 同款技术）──
        // drawNodeShape 只负责背景+标题区，slots/widgets 由父函数 drawNode 在之后绘制
        // 因此 globalAlpha=0 trick 可安全地让原始 drawNodeShape 绘制透明，不影响 slots/widgets
        function makeDrawShapeWrapper(origFn) {
            return function(node, ctx, size, fgcolor, bgcolor, selected, mouseOver) {
                // ── WOSAI OmniSlider 精简模式：隐藏标题 / 画布角标 ────────────────
                //   统一在此唯一的 drawNodeShape wrapper 处理，避免与 omni 双钩子冲突。
                if (_applyOmniHide(node)) return;
                // ── 折叠态：交还原生绘制（折叠胶囊宽度 = _collapsed_width），避免自绘渐变/标题用整宽导致右侧颜色溢出不缩 ──
                if (node.flags?.collapsed) { origFn.call(this, node, ctx, size, fgcolor, bgcolor, selected, mouseOver); return; }
                // ── 无渐变：正常绘制纯色背景，如有自定义标题样式则事后重绘文字 ──
                //  经典模式（无 _titleStyle）原生渲染后需补画角标（⊘禁用 / 📌固定），
                //  有 _titleStyle 时 redrawTitleText 已包含角标，不需要重复画。
                if (!node._gradient) {
                    origFn.call(this, node, ctx, size, fgcolor, bgcolor, selected, mouseOver);
                    if (node._titleStyle) {
                        redrawTitleText(node, ctx);
                    } else {
                        // 经典模式：原生渲染后统一补画角标
                        const LG = typeof LiteGraph !== 'undefined' ? LiteGraph : null;
                        _drawNodeBadges(ctx, node, size[0], LG?.NODE_TITLE_HEIGHT || 30, false);
                    }
                    return;
                }
                // ── 有渐变：CYBERPUNK globalAlpha=0 技术 ──
                // 先画渐变+标题文字，再以 alpha=0 调 origFn（背景绘制透明，渐变保留）
                // slots/widgets 由父函数 drawNode 在 drawNodeShape 返回后绘制，不受影响
                const LG = typeof LiteGraph !== 'undefined' ? LiteGraph : null;
                const th = LG?.NODE_TITLE_HEIGHT || 30;
                const w = size[0], h = size[1];
                const r = node.borderRadius || LG?.NODE_CORNER_RADIUS || 8;
                const cfg = node._gradient;
                const pts = _gradPts(w, h, th);
                const [x1, y1, x2, y2] = pts[cfg.dir] || pts['↓'];
                ctx.save();
                try {
                    // 步骤1：绘制渐变背景
                    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
                    if (cfg.stops) {
                        cfg.stops.forEach(s => grad.addColorStop(s.p, s.hex));
                    } else {
                        grad.addColorStop(0, cfg.from);
                        grad.addColorStop(1, cfg.to);
                    }
                    ctx.beginPath();
                    canvasRoundRect(ctx, 0, -th, w, h + th, r);
                    ctx.fillStyle = grad;
                    ctx.fill();
                    // 步骤2：在渐变上绘制标题文字
                    const title = node.getTitle ? node.getTitle() : (node.title || '');
                    if (title) {
                        const ts = node._titleStyle;
                        const fontSize = ts?.size ? Math.max(8, Math.min(32, ts.size)) : (LG?.NODE_TEXT_SIZE || 14);
                        const color = ts?.color || node.constructor?.title_text_color || fgcolor || 'var(--ws-text-on-accent)';
                        const align = ts?.align || 'left';
                        ctx.save();
                        // 注意：ts 可能为 undefined（主题/ColorBar 只写 _gradient 不写 _titleStyle）
                        // 此处必须用可选链——否则每帧抛异常导致 ctx save/restore 失衡，
                        // 画布变换矩阵被污染，节点界面与 DOM 浮层全部错位（已踩坑）
                        ctx.font = `${ts?.weight || "bold"} ${fontSize}px Arial, sans-serif`;
                        ctx.fillStyle = color;
                        // 标题横跨渐变亮暗区，加阴影确保任何背景下都可见
                        _applyTitleShadow(ctx, color);
                        ctx.shadowBlur = 3;
                        ctx.textAlign = align === 'center' ? 'center' : (align === 'right' ? 'right' : 'left');
                        ctx.textBaseline = 'middle';
                        const tx = (align === 'center' ? w/2 : (align === 'right' ? w-10 : 10)) + (ts?.x ?? 0);
                        ctx.fillText(title, tx, -th/2 + (ts?.y ?? 0));
                        ctx.shadowColor = 'transparent';
                        ctx.shadowBlur = 0;
                        ctx.restore();
                    }
                    // 统一绘制角标（📌固定 + ⊘禁用）
                    _drawNodeBadges(ctx, node, w, th);
                    // 步骤3：globalAlpha=0 → origFn 透明（保留渐变）
                    ctx.globalAlpha = 0;
                    origFn.call(this, node, ctx, size, fgcolor, bgcolor, selected, mouseOver);
                } catch(e) {
                    origFn.call(this, node, ctx, size, fgcolor, bgcolor, selected, mouseOver);
                } finally {
                    ctx.restore();
                }
            };
        }

        // drawNode wrapper（兜底：drawNodeShape 不存在时使用）
        function makeDrawNodeWrapper(origDrawNode) {
            return function(node, ctx) {
                // WOSAI OmniSlider 精简模式兜底（旧版无 drawNodeShape）：复用公共隐藏逻辑
                if (node && node.type === "WOSAI_OmniSlider" && _applyOmniHide(node)) {
                    try { node.onDrawBackground?.(ctx); } catch (_) {}
                    return;
                }
                if (node._wgradDrawing) return origDrawNode.call(this, node, ctx);
                // 折叠态：交还原生绘制（避免自绘渐变用整宽，折叠后右侧颜色不缩）
                if (node.flags?.collapsed) return origDrawNode.call(this, node, ctx);
                node._wgradDrawing = true;
                const origColor = node.color, origBg = node.bgcolor;
                try {
                    if (!node._gradient) {
                        origDrawNode.call(this, node, ctx);
                    } else {
                        const cfg = node._gradient;
                        const w = node.size[0], h = node.size[1];
                        const LG = typeof LiteGraph !== 'undefined' ? LiteGraph : null;
                        const th = LG?.NODE_TITLE_HEIGHT || 30;
                        const pts = _gradPts(w, h, th);
                        const [x1, y1, x2, y2] = pts[cfg.dir] || pts['↓'];
                        const r = LG?.NODE_CORNER_RADIUS ?? 8;
                        ctx.save();
                        ctx.clearRect(0, -th - 1, w + 1, h + th + 2);
                        ctx.restore();
                        node.color   = getWOSAIVar('--ws-nc-transparent');
                        node.bgcolor = getWOSAIVar('--ws-nc-transparent');
                        origDrawNode.call(this, node, ctx);
                        ctx.save();
                        ctx.globalCompositeOperation = 'destination-over';
                        const grad = ctx.createLinearGradient(x1, y1, x2, y2);
                        if (cfg.stops) {
                            if(cfg.stops.length===2){
                                grad.addColorStop(0,      cfg.stops[0].hex);
                                grad.addColorStop(0.30,   cfg.stops[0].hex);
                                grad.addColorStop(0.70,   cfg.stops[1].hex);
                                grad.addColorStop(1,      cfg.stops[1].hex);
                            } else {
                                // 3+ stops：使用压缩过渡带
                                const n=cfg.stops.length;
                                for(let i=0;i<n;i++){
                                    const band=.25/n, lo=Math.max(0, cfg.stops[i].p-band), hi=Math.min(1, cfg.stops[i].p+band);
                                    grad.addColorStop(lo, cfg.stops[i].hex);
                                    grad.addColorStop(hi, cfg.stops[i].hex);
                                }
                            }
                        } else {
                            grad.addColorStop(0,    cfg.from);
                            grad.addColorStop(0.30, cfg.from);
                            grad.addColorStop(0.70, cfg.to);
                            grad.addColorStop(1,    cfg.to);
                        }
                        ctx.beginPath();
                        canvasRoundRect(ctx, 0, -th, w, h + th, r);
                        ctx.fillStyle = grad;
                        ctx.fill();
                        ctx.globalCompositeOperation = 'source-over';
                        ctx.restore();
                    }
                    if (node._titleStyle) {
                        redrawTitleText(node, ctx);
                    } else if (!node._gradient) {
                        // 经典模式兜底：原生渲染后补画角标（makeDrawNodeWrapper 路径）
                        const LG = typeof LiteGraph !== 'undefined' ? LiteGraph : null;
                        _drawNodeBadges(ctx, node, node.size[0], LG?.NODE_TITLE_HEIGHT || 30, false);
                    }
                } catch(e) {
                    node.color = origColor; node.bgcolor = origBg;
                    origDrawNode.call(this, node, ctx);
                } finally {
                    node.color = origColor; node.bgcolor = origBg;
                    node._wgradDrawing = false;
                }
            };
        }

        function setupCanvasOverride() {
            const canvas = app.canvas;
            if (!canvas) { scheduleSetup(setupCanvasOverride, 100); return false; }

            // 优先 hook drawNodeShape（仅处理背景+标题，CYBERPUNK 同款方案）
            // drawNodeShape 不存在时降级到 drawNode
            function hookMethod(methodName, makeWrapper) {
                const targets = new Set();
                if (typeof canvas[methodName] === 'function' &&
                    Object.prototype.hasOwnProperty.call(canvas, methodName)) {
                    targets.add(canvas);
                }
                let proto = Object.getPrototypeOf(canvas);
                while (proto && proto !== Object.prototype) {
                    if (Object.prototype.hasOwnProperty.call(proto, methodName) &&
                        typeof proto[methodName] === 'function') {
                        targets.add(proto);
                    }
                    proto = Object.getPrototypeOf(proto);
                }
                if (targets.size === 0 && typeof canvas[methodName] === 'function') targets.add(canvas);
                for (const target of targets) {
                    _canvasPatchDisposers.push(patchMethod(
                        target,
                        methodName,
                        `WOSAI.NodeColor.${methodName}`,
                        makeWrapper,
                    ));
                }
                return targets.size > 0;
            }

            // 先尝试 drawNodeShape，失败再尝试 drawNode
            const ok = hookMethod('drawNodeShape', makeDrawShapeWrapper)
                    || hookMethod('drawNode', makeDrawNodeWrapper);
            return ok;
        }

        function setupGradientSupport() {
            const canvas = app.canvas;
            if (!canvas) { scheduleSetup(setupGradientSupport, 100); return; }

            // Try canvas override for classic mode
            const canvasActive = setupCanvasOverride();

            // Create style elements for DOM gradient & title injection
            if (!document.getElementById('wosai-gradient-styles')) {
                const cssGrad = document.createElement('style');
                cssGrad.id = 'wosai-gradient-styles';
                document.head.appendChild(cssGrad);
            }
            if (!document.getElementById('wosai-title-styles')) {
                const cssTitle = document.createElement('style');
                cssTitle.id = 'wosai-title-styles';
                document.head.appendChild(cssTitle);
            }

            // Initial refresh
            requestAnimationFrame(() => {
                if (!isCurrent()) return;
                refreshDOMGradients();
                refreshDOMSolidColors();
                scheduleSetup(() => { refreshDOMTitleStyles(); applyTitleAlignInline(); }, 200);
            });

            // MutationObserver：监听 Nodes 2.0 Vue DOM 变更
            // Vue 每次响应式重渲后：
            // - 可能替换/更新节点 DOM 子树（childList 事件）→ 需要重新打标记
            // - 可能更新元素 style/class 属性 → 可能覆盖我们的注入样式 → 需要刷新
            if (typeof MutationObserver === 'undefined') {
                console.warn('[WOSAI NodeColor] MutationObserver not available, gradient DOM sync disabled.');
                return;
            }
            let _moTimer = null;
            // 监听目标 + 选项提取出来，便于刷新时断开/重连
            const graphContainer = document.getElementById('graph-canvas-container')
                || document.getElementById('graph-canvas')
                || document.querySelector('.graph-canvas-container, .graph-canvas, .litegraph, #litegraph');
            const _moTarget = graphContainer || document.body;   // 兜底监听 body（稍重但可靠）
            if (!_moTarget || !_moTarget.nodeType) return;
            // ⚠ 绝不监听 'style'：refreshDOMGradients 给每个渐变节点写 inline style，
            //   监听 style 会被自身写入(及 Vue 对其的异步反应)反复触发 → 16ms 死循环 → 右键假死。
            //   只监听 childList(Vue 重建节点子树需重新注入) + class；其余情况由 500ms 轮询兜底。
            const _moOpts = { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] };
            // 判断 DOM 节点是否属于本插件自身 UI（面板/提示），用于过滤无关变更
            const _SELF_SEL = '[data-wosai-panel],.ws-tip,.os-panel,#wosai-panel';
            const _isSelfUI = (n) => n && n.nodeType === 1 &&
                ((n.matches && n.matches(_SELF_SEL)) || (n.closest && n.closest(_SELF_SEL)));
            const _gradMO = new MutationObserver((muts) => {
                if (!isCurrent()) return;
                // 防抖 120ms：开面板/画布重渲会在多帧内持续产生 childList 变更，
                //   小窗口(16ms)会触发多次全量刷新→卡顿；加大窗口把整段突发合并成一次刷新。
                //   期间渐变由 <style> 规则维持显示，inline 延迟重注入无副作用。
                if (_moTimer) return;
                // 过滤：仅由本插件面板/提示引发的变更(右键开面板、悬浮提示等)直接忽略，避免无谓刷新→卡顿
                const relevant = muts.some(m => {
                    if (_isSelfUI(m.target)) return false;
                    const ns = [...(m.addedNodes || []), ...(m.removedNodes || [])];
                    if (ns.length && ns.every(_isSelfUI)) return false;
                    return true;
                });
                if (!relevant) return;
                _moTimer = scheduleSetup(() => {
                    _moTimer = null;
                    const hasGrad = app.graph?.nodes?.some(n => n._gradient);
                    const hasTitleStyle = app.graph?.nodes?.some(n => n._titleStyle);
                    const hasSolidColor = app.graph?.nodes?.some(n => !n._gradient && (n.color || n.bgcolor));
                    const hasForceClear = app.graph?.nodes?.some(n => n._wosaiForceClear);   // 待清除节点也需重跑清理
                    if (!hasGrad && !hasTitleStyle && !hasSolidColor && !hasForceClear) return;
                    // ⚠ 关键防死循环：refreshDOMGradients 会写节点 style(background-image)，
                    //   而本观察器正监听 style/class → 自身写入会再次触发回调，形成永不停的 16ms 循环
                    //   （CPU 持续占用 → 右键弹窗迟迟不出现；画布旁 DOM 不停变 → 输入法悬浮栏闪烁抖动）。
                    //   故刷新期间先断开，刷新后再重连（disconnect 清空待处理队列，自身写入不入队）。
                    _gradMO.disconnect();
                    try {
                        if (hasGrad) refreshDOMGradients();
                        if (hasSolidColor || hasForceClear) refreshDOMSolidColors();
                        if (hasTitleStyle) { refreshDOMTitleStyles(); applyTitleAlignInline(); }
                    } finally {
                        if (isCurrent()) {
                            // 重连前确认目标仍在 DOM 中；若 graph container 被 Vue 整体替换则重新查找
                            let target = _moTarget;
                            if (!document.body.contains(target)) {
                                target = document.getElementById('graph-canvas-container')
                                    || document.getElementById('graph-canvas')
                                    || document.querySelector('.graph-canvas-container, .graph-canvas, .litegraph, #litegraph')
                                    || document.body;
                            }
                            try { _gradMO.observe(target, _moOpts); } catch (e) { /* target 可能已失效 */ }
                        }
                    }
                }, 120);
            });
            _gradMO.observe(_moTarget, _moOpts);

            // 事件驱动兜底：使用 graph.onNodeAdded/onNodeRemoved 替代 setInterval 轮询
            // 处理节点增删、工作流加载等 MO 无法捕获的场景
            let _prevNodeCount = app.graph?.nodes?.length || 0;
            const _refreshIfChanged = () => {
                if (!isCurrent() || !app.graph) return;
                const curr = app.graph.nodes?.length || 0;
                const gradCount = app.graph.nodes?.filter(n => n._gradient)?.length || 0;
                const tsCount = app.graph.nodes?.filter(n => n._titleStyle)?.length || 0;
                const solidCount = app.graph.nodes?.filter(n => !n._gradient && (n.color || n.bgcolor))?.length || 0;
                if (curr !== _prevNodeCount || gradCount > 0 || tsCount > 0 || solidCount > 0) {
                    _prevNodeCount = curr;
                    refreshDOMGradients();
                    refreshDOMSolidColors();
                    refreshDOMTitleStyles();
                    applyTitleAlignInline();
                    if (canvasActive) {
                        canvas.setDirty(true, true);
                        app.graph.setDirtyCanvas(true, true);
                    }
                }
            };
            const _origOnNodeAdded = app.graph.onNodeAdded;
            const _origOnNodeRemoved = app.graph.onNodeRemoved;
            const _wrappedOnNodeAdded = (n) => { _origOnNodeAdded?.(n); _refreshIfChanged(); };
            const _wrappedOnNodeRemoved = (n) => { _origOnNodeRemoved?.(n); _refreshIfChanged(); };
            _wrappedOnNodeAdded._wosaiWrapped = true;
            _wrappedOnNodeAdded._wosaiOrig = _origOnNodeAdded;
            _wrappedOnNodeRemoved._wosaiWrapped = true;
            _wrappedOnNodeRemoved._wosaiOrig = _origOnNodeRemoved;
            app.graph.onNodeAdded = _wrappedOnNodeAdded;
            app.graph.onNodeRemoved = _wrappedOnNodeRemoved;

            _gradMORef = _gradMO;
        }
        setupGradientSupport();

        // ── 原型 hook 幂等安装：防热重载/重复 setup 叠套 ──
        //   若当前方法已是本插件包装(_wosaiWrapped)，直接复用已保存的原函数；
        //   否则首次记录真实原函数到 _protoRefs，供 remove() 还原。
        function hookProto(obj, name, makeWrapper) {
            const cur = obj[name];
            if (cur && cur._wosaiWrapped) { _protoRefs[name] = cur._wosaiOrig; return; }
            const w = makeWrapper(cur);
            w._wosaiWrapped = true; w._wosaiOrig = cur;
            obj[name] = w;
            _protoRefs[name] = cur;
        }

        // Serialize _gradient so it survives workflow save/load
        hookProto(LGraphNode.prototype, 'serialize', (origSerialize) => function() {
            const data = origSerialize ? origSerialize.call(this) : {};
            if (this._gradient) data._gradient = JSON.parse(JSON.stringify(this._gradient));
            if (this._titleStyle) data._titleStyle = JSON.parse(JSON.stringify(this._titleStyle));
            return data;
        });
        hookProto(LGraphNode.prototype, 'configure', (origConfigure) => function(data) {
            if (origConfigure) origConfigure.call(this, data);
            if (data && data._gradient) this._gradient = JSON.parse(JSON.stringify(data._gradient));
            else delete this._gradient;
            if (data && data._titleStyle) this._titleStyle = JSON.parse(JSON.stringify(data._titleStyle));
            else delete this._titleStyle;
        });
        hookProto(LGraphNode.prototype, 'onAdded', (origOnAdded) => function(graph) {
            if (origOnAdded) origOnAdded.call(this, graph);
            if (!this._gradient) delete this._gradient;
        });

        // 分组框标题文字强制白色：LiteGraph 原生 LGraphGroup.draw() 中标题文字
        // 与分组底色/描边共用同一个 fillStyle（group.color），从未单独设置，
        // 导致上色后分组框标题文字与背景同色、难以辨认。
        // 这里在原生绘制完成后，用白色在同样位置重绘一次标题文字。
        // 注：曾尝试按背景亮度自动选择黑/白对比色，但"高级配色"/随机/预设等入口
        // 写入 group.color 时都不会像 applyTheme 那样调用 deriveDarkBg 变暗，
        // 用户选中的颜色亮度不受控，自动对比色经常判定为黑字，不符合预期——
        // 因此改为统一强制白色，与其它上色入口的预期保持一致。
        if (typeof LGraphGroup !== "undefined") {
            hookProto(LGraphGroup.prototype, 'draw', (origDraw) => function(canvas, ctx) {
                const result = origDraw ? origDraw.call(this, canvas, ctx) : undefined;
                const GROUP_TEXT_SIZE   = LiteGraph.GROUP_TEXT_SIZE   || 20;
                const GROUP_FONT        = LiteGraph.GROUP_FONT        || 'Inter';
                const NODE_TITLE_HEIGHT = LiteGraph.NODE_TITLE_HEIGHT || 30;
                const [ox, oy] = this._pos || this.pos || [0, 0];
                ctx.save();
                ctx.globalAlpha = canvas.editor_alpha ?? 1;
                ctx.fillStyle = getWOSAIVar('--ws-nc-group-title-color');
                ctx.font = `${GROUP_TEXT_SIZE}px ${GROUP_FONT}`;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(this.title + (this.pinned ? '📌' : ''), ox + GROUP_TEXT_SIZE / 2, oy + NODE_TITLE_HEIGHT / 2 + 1);
                ctx.restore();
                return result;
            });
        }
    },

    remove() {
        _nodeColorActive = false;
        _nodeColorGeneration += 1;
        for (const timer of _nodeColorSetupTimers) clearTimeout(timer);
        _nodeColorSetupTimers.clear();
        _canvasPatchDisposers.splice(0).forEach(dispose => dispose());

        // 关闭当前打开的颜色面板（走完整 close 路径解绑 document 级监听器）
        const oldPanel = document.querySelector('.nc-p');
        if (oldPanel && typeof oldPanel._wosaiClose === 'function') {
            try { oldPanel._wosaiClose(); } catch (e) { console.warn("[WOSAI NodeColor] remove close panel:", e); }
        }

        // 断开 MutationObserver
        if (_gradMORef) { try { _gradMORef.disconnect(); } catch (_) {} _gradMORef = null; }

        // 移除 F2 快捷键
        if (window._wosaiF2Handler) {
            window.removeEventListener('keydown', window._wosaiF2Handler, true);
            window._wosaiF2Handler = null;
        }

        // 移除取色器灰度模式全局监听
        offGlobal('nc-gray-down');
        offGlobal('nc-gray-up');

        // 隐藏可能残留的 tooltip
        try { hideTip(); } catch (_) {}

        // 恢复 graph 的原始 onNodeAdded/onNodeRemoved 回调
        if (app.graph) {
            const _curAdd = app.graph.onNodeAdded;
            const _curRem = app.graph.onNodeRemoved;
            if (_curAdd && _curAdd._wosaiWrapped) app.graph.onNodeAdded = _curAdd._wosaiOrig;
            if (_curRem && _curRem._wosaiWrapped) app.graph.onNodeRemoved = _curRem._wosaiOrig;
        }

        // 还原原型 hook（防热重载后残留包装）
        for (const [name, orig] of Object.entries(_protoRefs)) {
            if (orig !== undefined) {
                if (LGraphNode.prototype[name] && LGraphNode.prototype[name]._wosaiWrapped) LGraphNode.prototype[name] = orig;
                if (LGraphGroup.prototype[name] && LGraphGroup.prototype[name]._wosaiWrapped) LGraphGroup.prototype[name] = orig;
            }
        }

        // 移除本扩展加载的 CSS / style 标签
        const link = document.getElementById("wosai-os-color-css");
        if (link) link.remove();
        const gradStyle = document.getElementById('wosai-gradient-styles');
        if (gradStyle) gradStyle.remove();
        const titleStyle = document.getElementById('wosai-title-styles');
        if (titleStyle) titleStyle.remove();

        // 清理暴露给 OmniSlider 的全局刷新入口
        try { delete window.__wosaiColorRefresh; } catch (_) {}

        // 重置模块级刷新引用
        _refreshDOMGradients = null;
        _refreshDOMSolidColors = null;
        _refreshDOMTitleStyles = null;
        _applyTitleAlignInline = null;
        _onHexChFn = null;
    },

    // 🟠 菜单项已统一迁移至 layout-toolkit.js（单一 hook，确保全部连续排列）。
    // 此处保留空返回以防 ComfyUI 扩展 API 仍调用 getNodeMenuItems 时重复追加菜单项。
    getNodeMenuItems(node) {
        return [];
    },

    commands: [{
        id: "wosai-node-color",
        label: t('nodes.nodeColor.commandLabel'),
        function: () => {
            // 画布注释自绘背景，配色无效——各入口统一过滤（Classic↔Nodes 2.0 选区兼容）
            const sel = getSelectedNodes().filter(n => n.type !== "WOSAI_CanvasNote");
            const selGroups = getSelectedGroups();
            if (sel.length > 0) {
                openNodeColorPicker(sel, undefined, selGroups);
                return;
            }
            // 无选中节点时尝试选中分组（高级面板：组内节点 + 分组框联动）
            if (selGroups.length) openPickerForGroups(selGroups);
        },
    }],
});

// ── 对外导出（供 color-bar.js 等复用）──────────────────────
// openNodeColorPicker 已在上方用 export function 声明式导出，此处无需重复

// 全量刷新节点视觉：Canvas 重绘 + Nodes 2.0 DOM 渐变/标题样式注入
// （依赖 setup() 已执行并填充模块级 hook 引用）
export function refreshAllVisuals() {
    const canvas = app.canvas;
    canvas?.setDirty(true, true);
    app.graph?.setDirtyCanvas(true, true);
    if (typeof _refreshDOMGradients === "function") _refreshDOMGradients();
    if (typeof _refreshDOMSolidColors === "function") _refreshDOMSolidColors();
    if (typeof _refreshDOMTitleStyles === "function") _refreshDOMTitleStyles();
    if (typeof _applyTitleAlignInline === "function") _applyTitleAlignInline();
}
// 统一清除节点 + 分组颜色（NodeColor 高级面板 & ColorBar 共用）
// 选中分组时递归清空分组自身及内部所有节点颜色，避免仅清分组、子节点颜色残留
export function clearNodeColors(nodes, groups) {
    const nodeSet = new Set(Array.isArray(nodes) ? nodes : []);
    const todoGrp = Array.isArray(groups) ? groups : [];

    // 递归收集分组内所有节点 → 统一清除，杜绝子节点颜色残留
    for (const g of todoGrp) {
        const inside = getNodesInGroup(g);
        for (const n of inside) {
            nodeSet.add(n);
        }
    }

    for (const n of nodeSet) {
        const oldColor = n.color, oldBg = n.bgcolor;
        // 尝试多种方式清除颜色属性（Nodes 2.0 下 Vue 可能拦截 setter 忽略 undefined/falsy 值）
        try { n.color = ''; } catch (_) { n.color = void 0; }
        try { n.bgcolor = ''; } catch (_) { n.bgcolor = void 0; }
        // delete 兜底：若属性定义在原型（getter/setter），可删除实例自有属性
        try { delete n.color; } catch (_) {}
        try { delete n.bgcolor; } catch (_) {}
        if (typeof n.setColorOption === "function") n.setColorOption({ color: '', bgcolor: '' });
        try { delete n.constructor.title_text_color; } catch (_) {}
        try { delete n._gradient; } catch (_) {}
        try { delete n._titleStyle; } catch (_) {}
        // ⚠ 持久标记「待清除」——刷新时不再消费，确保 Vue 每次重渲(尤其选中节点触发 MutationObserver)
        //    都强制走清理分支，根治 Nodes 2.0 下 node.color 被响应式缓存、重新选中颜色复活的问题。
        //    重新上色时由 applySolidHex / applyColorState 删除本标记解除。
        n._wosaiForceClear = true;
        // 与上色同一套 Vue 通知机制：触发 property changed，让 Vue 响应式同步清除（三处清除行为彻底一致）
        if (n.graph?.trigger) {
            try {
                n.graph.trigger('node:property:changed', { nodeId: n.id, property: 'color', oldValue: oldColor, newValue: undefined });
                n.graph.trigger('node:property:changed', { nodeId: n.id, property: 'bgcolor', oldValue: oldBg, newValue: undefined });
            } catch (_) {}
        }
    }
    // 分组框自身颜色清除
    for (const g of todoGrp) {
        try { g.color = ''; } catch (_) { g.color = void 0; }
        try { delete g.color; } catch (_) {}
    }
}
// v1.0: 模块化重构（core/store 拆分）+ 取色工具链（拾色器/HEX/随机/灰度）+ ColorBar/配色主题
