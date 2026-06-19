import { app } from "../../../scripts/app.js";
// 简化分组取色器已弃用——分组统一走"高级"完整面板（openPickerForGroups）
import {
    hsv2hex, hex2hsv, sharpGradientCSS, cssGradientDir,
    SOLID_PRESETS, GRAY_PRESETS, GRAD_PRESETS, DIRS, DIR_TIPS,
    deriveDarkBg, deriveMidStop, randomHSV, applyColorState, applySolidHex,
} from "./lib/color-core.js";
import { store, initStore, persist, addRecent } from "./lib/color-store.js";
import { WS_ICONS } from "./lib/shared-utils.js";
import { getGlassTheme, getGlassMode, cycleGlassMode, onGlassChange, GLASS_MODE_DEFS } from "./lib/glass-theme.js";
import { showTip, hideTip } from "./lib/tooltip.js";

// Shared gradient state - set by setup() for access from applyColor()
let _refreshDOMGradients = null;
let _refreshDOMTitleStyles = null;
let _gradMORef = null;          // MutationObserver 引用（扩展卸载时断开）
let _applyTitleAlignInline = null;
let _onHexChFn = null;

// 原型 hook 原函数引用（供 remove() 还原，防热重载 --watch 叠套）
const _protoRefs = {};

// ── 取色历史 & 自定义预设 ──
// 数据与持久化迁至 lib/color-store.js（localStorage + 服务端 JSON 双层）
// 预设/方向常量迁至 lib/color-core.js

function addRecentPick(hex) {
    addRecent(hex);
    renderRecentPicks();
}

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
        try { g.recomputeInsideNodes?.(); } catch (e) {}
        (g._nodes || g.nodes || []).forEach(n => set.add(n));
    });
    let nodes = [...set];
    if (!nodes.length) {
        const first = app.graph?._nodes?.[0];
        if (!first) return;
        nodes = [first];
    }
    openNodeColorPicker(nodes, anchorRect, groups);
}

// groups（可选）：联动的分组框数组——面板内所有上色/清除操作同步写分组框颜色
function openNodeColorPicker(nodes, anchorRect, groups) {
    if (!nodes?.length) return;
    // 传入分组时：转"高级"完整面板（组内节点 + 分组框联动），不再使用简化分组取色器
    if (nodes[0] instanceof LGraphGroup) {
        return openPickerForGroups(nodes.filter(g => g instanceof LGraphGroup), anchorRect);
    }
    const linkedGroups = Array.isArray(groups) ? groups : [];
    // 清理旧面板（防止异常未 close 导致的 DOM/CSS 泄漏）
    // CSS 已通过 extension.json 加载 web/css/os-color.css
    const oldPanel = document.querySelector('.nc-p');
    if (oldPanel) {
        // 先走 close 路径解绑 document 级监听器，再移除 DOM；
        // 仅 remove() 会让旧面板的 _closeHandler/_pinOnMove 等监听器残留累积
        if (typeof oldPanel._wosaiClose === 'function') oldPanel._wosaiClose();
        oldPanel.remove();
    }

    const canvas = app.canvas;

    const S = {
        stopCount: 2,
        h: 20, s: 82, v: 83,
        dir: '↓',
        stops: [{p:0,h:20,s:82,v:83},{p:1,h:20,s:60,v:30}],
        aStop: 0,
        editTarget: 'hdr',  // stopCount===1 时，'hdr'=标题  'bg'=面板  'sync'=整体
        titleH: 20, titleS: 82, titleV: 83,  // 标题栏独立颜色（stopCount===1 时使用）
        bgH: 20, bgS: 90, bgV: 35,            // 面板背景独立颜色（stopCount===1 时使用）
        get mode(){ return this.stopCount === 1 ? 'solid' : 'grad'; },
        // 标题文字样式（始终生效）
        titleStyle: { size: 14, color: '#ffffff', align: 'left', weight: 'normal' },
    };
    // 清除状态标记：清除按钮预览时设为 true，确认时跳过上色；其他操作恢复 false
    let _isCleared = false;

    // 从已有节点读取 titleStyle 初始值（多节点时取第一个）
    if (nodes[0]?._titleStyle) {
        S.titleStyle = { ...S.titleStyle, ...nodes[0]._titleStyle };
    }
    // 从已有节点读取颜色状态
    if (nodes[0]) {
        const n0 = nodes[0];
        if (n0._gradient && n0._gradient.stops) {
            S.stopCount = n0._gradient.stops.length;
            S.dir = n0._gradient.dir || '↓';
            S.stops = n0._gradient.stops.map(s => ({ p: s.p, h: hex2hsv(s.hex).h, s: hex2hsv(s.hex).s, v: hex2hsv(s.hex).v }));
        } else {
            S.stopCount = 1;
            if (n0.color) { const c = hex2hsv(n0.color); S.titleH = c.h; S.titleS = c.s; S.titleV = c.v; }
            if (n0.bgcolor) { const c = hex2hsv(n0.bgcolor); S.bgH = c.h; S.bgS = c.s; S.bgV = c.v; }
            S.stops = [{ p: 0, h: S.titleH, s: S.titleS, v: S.titleV }];
        }
    }
    // h/s/v 代理：stopCount===1 时分发到 title* 或 bg*，sync 模式同步写入两端
    const _hsvState = { _h: S.h, _s: S.s, _v: S.v };
    Object.defineProperty(S, 'h', {
        get() { return this.stopCount === 1 ? (this.editTarget === 'bg' ? this.bgH : this.titleH) : _hsvState._h; },
        set(v) { if (this.stopCount === 1) { if (this.editTarget === 'bg') this.bgH = v; else if (this.editTarget === 'sync') { this.titleH = v; this.bgH = v; } else this.titleH = v; } else _hsvState._h = v; }
    });
    Object.defineProperty(S, 's', {
        get() { return this.stopCount === 1 ? (this.editTarget === 'bg' ? this.bgS : this.titleS) : _hsvState._s; },
        set(v) { if (this.stopCount === 1) { if (this.editTarget === 'bg') this.bgS = v; else if (this.editTarget === 'sync') { this.titleS = v; this.bgS = v; } else this.titleS = v; } else _hsvState._s = v; }
    });
    Object.defineProperty(S, 'v', {
        get() { return this.stopCount === 1 ? (this.editTarget === 'bg' ? this.bgV : this.titleV) : _hsvState._v; },
        set(v) { if (this.stopCount === 1) { if (this.editTarget === 'bg') this.bgV = v; else if (this.editTarget === 'sync') { this.titleV = v; this.bgV = v; } else this.titleV = v; } else _hsvState._v = v; }
    });

    // CSS 常量已提取至 web/css/os-color.css，通过 extension.json 加载
    // 动态渐变/标题样式仍由 setup() 中的 _refreshDOMGradients / _refreshDOMTitleStyles 实时生成

    // ── 灰度色卡模式：按住 Shift 时纯色预设切换为 12 级灰度 ──
    let grayMode = false;
    const _onGrayKeyDown = (e) => {
        if (e.key === 'Shift' && !grayMode && S.stopCount === 1) { grayMode = true; buildPresets(); }
    };
    const _onGrayKeyUp = (e) => {
        if (e.key === 'Shift' && grayMode) { grayMode = false; buildPresets(); }
    };
    const _onGrayBlur = () => { if (grayMode) { grayMode = false; buildPresets(); } };
    document.addEventListener('keydown', _onGrayKeyDown);
    document.addEventListener('keyup', _onGrayKeyUp);
    window.addEventListener('blur', _onGrayBlur);

    // hsv2hex / hex2hsv 由 lib/color-core.js 提供（原闭包内重复实现已删除）
    function curHex(){return hsv2hex(S.h,S.s,S.v);}
    function sHex(i){const s=S.stops[i];return hsv2hex(s.h,s.s,s.v);}
    function paintSq(){document.getElementById('ncSv').style.background=`hsl(${S.h},100%,50%)`;}
    function paintStopbar(){
        const cvs=document.getElementById('ncSbc');
        const w=cvs.offsetWidth||220;cvs.width=w;
        const ctx=cvs.getContext('2d');
        const grd=ctx.createLinearGradient(0,0,w,0);
        S.stops.forEach((s,i)=>grd.addColorStop(Math.max(0,Math.min(1,s.p)),sHex(i)));
        ctx.clearRect(0,0,w,14);
        ctx.beginPath();ctx.roundRect?ctx.roundRect(0,0,w,14,7):ctx.rect(0,0,w,14);
        ctx.fillStyle=grd;ctx.fill();
    }
    function updatePins(){S.stops.forEach((s,i)=>{const el=document.getElementById('ncP'+i);if(el){el.style.left=(s.p*100)+'%';el.style.background=sHex(i);}});}
    function updateThumb(){const t=document.getElementById('ncSvt');t.style.left=S.s+'%';t.style.top=(100-S.v)+'%';t.style.background=curHex();}
    function updateDirThumbs(){document.querySelectorAll('#ncDg .nc-dgi').forEach(el=>{const d=parseInt(el.dataset.deg)||180;const dir=d+'deg';const s0=sHex(0),sLast=sHex(S.stops.length-1);if(S.stopCount===3){el.style.background=`linear-gradient(${dir}, ${s0} 0%, ${s0} 18%, ${sHex(1)} 42%, ${sHex(1)} 58%, ${sLast} 82%, ${sLast} 100%)`;}else{el.style.background=`linear-gradient(${dir}, ${s0} 0%, ${s0} 30%, ${sLast} 70%, ${sLast} 100%)`;}});}
    function refresh(){
        paintSq(); updateThumb();
        if(S.stopCount>1){paintStopbar();updatePins();updateDirThumbs();}
        renderStopIndicators();
        // 标题样式控件实时刷新
        if (sizeRange) { sizeRange.value = S.titleStyle.size; }
        if (sizeNum) { sizeNum.value = S.titleStyle.size; }
        if (weightBtns && weightDefs) {
            weightDefs.forEach(d => { if (weightBtns[d.key]) weightBtns[d.key].classList.toggle('on', S.titleStyle.weight === d.key); });
        }
        if (alignBtns && alignDefs) {
            alignDefs.forEach(d => { if (alignBtns[d.key]) alignBtns[d.key].classList.toggle('on', S.titleStyle.align === d.key); });
        }
        // 色相/饱和度/明度滑块
        const hs = document.getElementById('ncHs');
        const ss = document.getElementById('ncSs');
        const vs = document.getElementById('ncVs');
        if (hs) hs.value = S.h;
        if (ss) ss.value = S.s;
        if (vs) vs.value = S.v;
        // HEX 输入框（编辑中不打断）
        const hx = document.getElementById('ncHex');
        if (hx && document.activeElement !== hx) hx.value = curHex().toUpperCase();
    }

    // 全量刷新：Canvas 重绘 + Nodes 2.0 DOM 渐变/标题样式注入
    function refreshAllNodeVisuals(){
        canvas.setDirty(true,true);app.graph.setDirtyCanvas(true,true);
        if(typeof _refreshDOMGradients==="function")_refreshDOMGradients();
        if(typeof _refreshDOMTitleStyles==="function") _refreshDOMTitleStyles();
        // 终极方案：JS inline style 打对齐（绕过 CSS 优先级战争）
        if(typeof _applyTitleAlignInline==="function") _applyTitleAlignInline();
    }

    // 上色核心已迁至 lib/color-core.js applyColorState —— 此处只做状态快照与刷新
    function applyToNodes(){
        _isCleared = false;  // 任何主动上色操作取消清除状态
        resetBtn.classList.remove('nc-cleared');
        applyColorState(nodes, {
            stopCount: S.stopCount,
            editTarget: S.editTarget,
            title: { h: S.titleH, s: S.titleS, v: S.titleV },
            bg: { h: S.bgH, s: S.bgS, v: S.bgV },
            dir: S.dir,
            stops: S.stops.map(s => ({ p: s.p, h: s.h, s: s.s, v: s.v })),
            titleStyle: { ...S.titleStyle },
        });
        // 联动分组框：跟随当前主色（单色=标题色，渐变=首端色）
        if (linkedGroups.length) {
            const mainHex = S.stopCount === 1
                ? hsv2hex(S.titleH, S.titleS, S.titleV)
                : hsv2hex(S.stops[0].h, S.stops[0].s, S.stops[0].v);
            linkedGroups.forEach(g => { g.color = mainHex; });
        }
        refreshAllNodeVisuals();
    }

    function saveAndSync(){ applyToNodes(); }

    // 控制渐变相关 UI 的显隐
    function updateGradVisibility(){
        const isMulti = S.stopCount > 1;
        document.getElementById('ncSbw').style.display = isMulti ? 'block' : 'none';
        document.getElementById('ncDg').style.display = isMulti ? 'grid' : 'none';
    }

    function setStopCount(n) {
        n = Math.max(1, Math.min(3, n));
        if (n === S.stopCount) return;
        S.stopCount = n;
        if (n === 1) {
            // 从渐变切换到纯色：用当前编辑的颜色初始化标题色，面板自动衍生暗版
            S.titleH = S.h; S.titleS = S.s; S.titleV = S.v;
            const d = deriveDarkBg(S.h, S.s, S.v);
            S.bgH = d.h; S.bgS = d.s; S.bgV = d.v;
            S.editTarget = 'hdr';
            S.stops = [{p:0, h: S.titleH, s: S.titleS, v: S.titleV}];
            S.aStop = 0;
            document.getElementById('ncHs').value = S.titleH;
        } else if (n === 2) {
            const s0 = S.stops[0], s1 = S.stops[S.stops.length-1];
            // 若两端色标相同（如从单色切来），第二端自动衍生成暗版，确保渐变有视觉区分度
            const sameColor = s0.h === s1.h && s0.s === s1.s && s0.v === s1.v;
            const dk = sameColor ? deriveDarkBg(s1.h, s1.s, s1.v) : s1;
            S.stops = [{p:0, h:s0.h, s:s0.s, v:s0.v}, {p:1, h:dk.h, s:dk.s, v:dk.v}];
            S.aStop = Math.min(S.aStop, 1);
            S.h = S.stops[S.aStop].h; S.s = S.stops[S.aStop].s; S.v = S.stops[S.aStop].v;
            document.getElementById('ncHs').value = S.h;
        } else {
            const s0 = S.stops[0], s1 = S.stops[S.stops.length-1];
            // 中间色：色相偏移+30°（脱离两端点直线），饱和度和亮度取两端较高者，确保视觉差异
            const mid = deriveMidStop(s0, s1);
            S.stops = [
                {p:0, h:s0.h, s:s0.s, v:s0.v},
                {p:0.5, h:mid.h, s:mid.s, v:mid.v},
                {p:1, h:s1.h, s:s1.s, v:s1.v},
            ];
            S.aStop = Math.min(S.aStop, 2);
            S.h = S.stops[S.aStop].h; S.s = S.stops[S.aStop].s; S.v = S.stops[S.aStop].v;
            document.getElementById('ncHs').value = S.h;
        }
        rebuildPins();
        updateGradVisibility();
        buildPresets();
        saveAndSync();
        refresh();
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
        S.stops.forEach((st, i) => {
            const pin = document.createElement('div');
            pin.id = 'ncP' + i;
            pin.className = 'nc-sp' + (i === S.aStop ? ' on' : '');
            pin.style.left = (st.p * 100) + '%';
            pin.style.background = sHex(i);
            let drag = false;
            pin.addEventListener('pointerdown', e => {
                e.stopPropagation(); e.preventDefault(); drag = true; S.aStop = i;
                sbArea.querySelectorAll('.nc-sp').forEach(p => p.classList.remove('on'));
                pin.classList.add('on');
                const st2 = S.stops[i];
                S.h = st2.h; S.s = st2.s; S.v = st2.v;
                document.getElementById('ncHs').value = st2.h;
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
            paintStopbar(); updatePins(); updateDirThumbs(); renderStopIndicators();
        };
        _pinOnUp = () => { /* drag 状态在各 pin 的 pointerdown 中管理 */ };
        document.addEventListener('pointermove', _pinOnMove);
        document.addEventListener('pointerup', _pinOnUp);
        document.addEventListener('pointercancel', _pinOnUp);
        renderStopIndicators();
    }
    // 渲染颜色站指示区域：模式按钮（单色/双色/三色）+ 上下文子芯片，各自独立背景
    function renderStopIndicators() {
        const sti = document.getElementById('ncSti');
        if (!sti) return;
        sti.innerHTML = '';

        // ── 模式按钮行：单色 / 双色 / 三色（始终显示） ──
        const modeRow = document.createElement('div');
        modeRow.style.cssText = 'display:flex;gap:2px;width:100%;padding:4px;border-radius:8px;background:var(--ws-surface-2);border:1px solid transparent;box-sizing:border-box;overflow:visible;margin-bottom:4px';
        const modes = ['单色', '双色', '三色'];
        modes.forEach((label, i) => {
            const cnt = i + 1;
            const btn = document.createElement('div');
            btn.className = 'nc-sti-chip' + (S.stopCount === cnt ? ' on' : '');
            btn.textContent = label;
            btn.onclick = () => {
                if (S.stopCount === cnt) return;
                setStopCount(cnt);
            };
            modeRow.appendChild(btn);
        });
        sti.appendChild(modeRow);

        // ── 子芯片行：单色模式时显示编辑目标切换 ──
        if (S.stopCount === 1) {
            const subRow = document.createElement('div');
            subRow.style.cssText = 'display:flex;gap:2px;width:100%;padding:4px 4px 8px 4px;border-radius:8px;background:var(--ws-surface-2);border:1px solid transparent;box-sizing:border-box;overflow:visible';
            const targets = [
                { key: 'bg',  label: '面板上色', hex: hsv2hex(S.bgH, S.bgS, S.bgV) },
                { key: 'hdr', label: '标题上色', hex: hsv2hex(S.titleH, S.titleS, S.titleV) },
                { key: 'sync', label: '整体上色', hex: hsv2hex(S.titleH, S.titleS, S.titleV), dual: true },
            ];
            targets.forEach(t => {
                const chip = document.createElement('div');
                chip.className = 'nc-sti-chip nc-sti-no-tri' + (S.editTarget === t.key ? ' on' : '');
                chip.style.fontSize = '11px';
                chip.style.whiteSpace = 'nowrap';
                // icon removed, label only
                const label = document.createElement('span');
                label.textContent = t.label;
                label.style.whiteSpace = 'nowrap';
                chip.appendChild(label);
                chip.onclick = () => {
                    S.editTarget = t.key;
                    document.getElementById('ncHs').value = S.h;
                    saveAndSync();
                    refresh();
                };
                subRow.appendChild(chip);
            });
            sti.appendChild(subRow);
        } else {
            // ── 多色模式：每个色标一块常显色块（同时可见，点击即选中编辑），借鉴 CYBERPUNK「每色一行」──
            //   复用现有 aStop/HSV 编辑链；refresh() 会重建本区，故色块/高亮自动随编辑同步。
            const colorsRow = document.createElement('div');
            // 横向 0 内边距 + 满宽 + 标准 gap → 左右边与预设圆点/方向格对齐；行距由 .nc-sti 的 gap/margin 统一
            colorsRow.style.cssText = 'display:flex;gap:var(--ws-gap);width:100%;box-sizing:border-box';
            S.stops.forEach((st, i) => {
                const hex = sHex(i);
                // 块内编号对比色：按色块亮度取深/浅，保证数字在任意颜色上可见
                const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
                const numColor = (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#1A1A1A' : '#FFFFFF';
                const cell = document.createElement('div');
                cell.style.cssText = `flex:1;height:22px;display:flex;align-items:center;justify-content:center;border-radius:5px;background:${hex};cursor:pointer;box-sizing:border-box;font-size:11px;font-weight:500;color:${numColor};border:1.5px solid ${i === S.aStop ? 'var(--ws-accent)' : 'var(--ws-border)'};transition:border-color .12s`;
                cell.textContent = String(i + 1);
                cell.onclick = () => {
                    S.aStop = i;
                    const st2 = S.stops[i];
                    S.h = st2.h; S.s = st2.s; S.v = st2.v;
                    const hs = document.getElementById('ncHs');
                    if (hs) hs.value = st2.h;
                    document.querySelectorAll('#ncSbw .nc-sp').forEach((p, j) => p.classList.toggle('on', j === i));
                    refresh();
                };
                colorsRow.appendChild(cell);
            });
            sti.appendChild(colorsRow);
        }
    }
    function onHue(v){S.h=v;if(S.stopCount>1)S.stops[S.aStop].h=v;saveAndSync();refresh();}
    function onHexCh(v){
        if(!/^#[0-9a-fA-F]{6}$/.test(v))return;
        const h=hex2hsv(v);S.h=h.h;S.s=h.s;S.v=h.v;
        document.getElementById('ncHs').value=h.h;
        if(S.stopCount>1){const st=S.stops[S.aStop];st.h=h.h;st.s=h.s;st.v=h.v;}
        saveAndSync();refresh();
    }
    _onHexChFn = onHexCh;

    function buildPresets(){
        const area=document.getElementById('ncPa');
        if(!area) return;  // 面板已关闭（store 异步合并回调场景）
        area.innerHTML='';
        if(S.stopCount===1){
            // Shift 按住 → 灰度色卡（参考 NodeAlignPro 交互）
            const pal = grayMode ? GRAY_PRESETS : SOLID_PRESETS;
            for(let row=0;row<2;row++){
                const g=document.createElement('div');g.className='nc-pg';
                for(let col=0;col<6;col++){
                    const p=pal[row*6+col];
                    const el=document.createElement('div');
                    el.className='nc-ps';el.style.background=p.h;
                    el.onmouseenter=()=>showTip(el,p.n+' '+p.e);
                    el.onmouseleave=hideTip;
                    el.onclick=()=>{
                        area.querySelectorAll('.nc-ps').forEach(x=>x.classList.remove('on'));
                        el.classList.add('on');
                        const hv=hex2hsv(S.editTarget==='bg' ? p.b : p.h);S.h=hv.h;S.s=hv.s;S.v=hv.v;
                        document.getElementById('ncHs').value=hv.h;
                        saveAndSync();refresh();
                    };
                    g.appendChild(el);
                }
                area.appendChild(g);
            }
        } else {
            for(let row=0;row<2;row++){
                const g=document.createElement('div');g.className='nc-pg';
                for(let col=0;col<6;col++){
                    const p=GRAD_PRESETS[row*6+col];
                    const el=document.createElement('div');
                    el.className='nc-ps';
                    if(S.stopCount===3){
                        const m0=p.s[0],m1=p.s[1];
                        const mid=deriveMidStop(m0,m1);
                        el.style.background=`linear-gradient(135deg,${hsv2hex(m0.h,m0.s,m0.v)},${hsv2hex(mid.h,mid.s,mid.v)},${hsv2hex(m1.h,m1.s,m1.v)})`;
                    } else {
                        el.style.background=`linear-gradient(135deg,${hsv2hex(p.s[0].h,p.s[0].s,p.s[0].v)},${hsv2hex(p.s[1].h,p.s[1].s,p.s[1].v)})`;
                    }
                    el.onmouseenter=()=>showTip(el,p.n+' '+p.e);
                    el.onmouseleave=hideTip;
                    el.onclick=()=>{
                        area.querySelectorAll('.nc-ps').forEach(x=>x.classList.remove('on'));
                        el.classList.add('on');
                        const s0={h:p.s[0].h,s:p.s[0].s,v:p.s[0].v},s1={h:p.s[1].h,s:p.s[1].s,v:p.s[1].v};
                        if(S.stopCount===3) {
                            const mid=deriveMidStop(s0,s1);
                            S.stops=[{p:0,...s0},{p:0.5,h:mid.h,s:mid.s,v:mid.v},{p:1,...s1}];
                        } else {
                            S.stops=[{p:0,...s0},{p:1,...s1}];
                            S.stopCount=2;
                        }
                        S.aStop=0;S.h=p.s[0].h;S.s=p.s[0].s;S.v=p.s[0].v;
                        document.getElementById('ncHs').value=p.s[0].h;
                        rebuildPins();updateGradVisibility();
                        paintStopbar();updatePins();updateDirThumbs();
                        saveAndSync();refresh();
                    };
                    g.appendChild(el);
                }
                area.appendChild(g);
            }
        }
    }

    const panel = document.createElement("div");
    panel.className="nc-p";
    panel.setAttribute("data-wosai-panel", "");
    panel.setAttribute("data-theme", getGlassTheme());   // 全插件共享玻璃主题
    panel.onpointerdown = (e) => e.stopPropagation();
    const _closeHandler=e=>{if(!panel.contains(e.target))close();};
    document.addEventListener("pointerdown",_closeHandler,{capture:true});

    // 标题行：标题 + 主题切换按钮同一行
    const titleRow = document.createElement("div");
    titleRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:10px";
    const titleEl = document.createElement("div");
    titleEl.textContent = "高级配色 NodeColor";
    titleEl.style.cssText = "font-size:14px;color:var(--ws-text);letter-spacing:.5px;flex:1;text-align:center";
    titleRow.appendChild(titleEl);

    // 主题按钮：全插件共享三态（自动/浅色/深色），切换广播至所有 WOSAI 面板
    const themeBtn = document.createElement("div");
    themeBtn.style.cssText = "cursor:pointer;transition:.2s;line-height:1;flex-shrink:0;color:var(--ws-text)";
    const MODE_ICONS_NC = { auto: WS_ICONS.auto, light: WS_ICONS.sun, dark: WS_ICONS.moon };
    const refreshThemeBtn = () => {
        const m = getGlassMode();
        themeBtn.innerHTML = MODE_ICONS_NC[m];
        themeBtn.title = GLASS_MODE_DEFS[m].tip;
    };
    refreshThemeBtn();
    themeBtn.onclick = () => cycleGlassMode();
    // 订阅广播：本面板或其他面板切换时同步 data-theme 与按钮
    const _offGlass = onGlassChange((t) => { panel.setAttribute("data-theme", t); refreshThemeBtn(); });
    titleRow.appendChild(themeBtn);
    panel.appendChild(titleRow);

    // presets
    const presetArea=document.createElement("div");presetArea.id="ncPa";



    // stopbar (pins built dynamically by rebuildPins)
    const sbWrap=document.createElement("div");sbWrap.id="ncSbw";sbWrap.className="nc-sbw";sbWrap.style.display="none";
    const sbArea=document.createElement("div");sbArea.style.cssText="position:relative;height:22px";
    const sbCvs=document.createElement("canvas");sbCvs.id="ncSbc";sbCvs.className="nc-sbc";sbCvs.height=14;
    sbArea.appendChild(sbCvs);
    sbWrap.appendChild(sbArea);
    panel.appendChild(sbWrap);

    // 颜色站指示芯片（始终显示模式按钮：纯色/双色/三色）
    const stiWrap = document.createElement("div");
    stiWrap.id = "ncSti";
    stiWrap.className = "nc-sti";

    // SV square
    const svSq=document.createElement("div");svSq.id="ncSv";svSq.className="nc-sv";
    const svW=document.createElement("div");svW.className="nc-svw";
    const svB=document.createElement("div");svB.className="nc-svb";
    const svT=document.createElement("div");svT.id="ncSvt";svT.className="nc-svt";
    svSq.appendChild(svW);svSq.appendChild(svB);svSq.appendChild(svT);
    panel.appendChild(svSq);

    // hue slider
    const hw=document.createElement("div");hw.className="nc-hw";
    const hs=document.createElement("input");hs.id="ncHs";hs.className="nc-hs";hs.type="range";hs.min=0;hs.max=360;hs.value=20;
    hs.oninput=function(){onHue(+this.value);};
    // 滚轮调节色相（上滚 +1 / 下滚 -1）
    hs.addEventListener('wheel',(e)=>{
        e.preventDefault();e.stopPropagation();
        let v=Math.max(0,Math.min(360,(+hs.value)+(e.deltaY<0?1:-1)));
        if(v!==+hs.value){hs.value=v;onHue(v);}
    },{passive:false});
    hw.appendChild(hs);
    panel.appendChild(hw);

    // ── 工具行：HEX 输入 + 屏幕吸管 + 随机色 ──
    const toolRow = document.createElement('div');
    toolRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin:8px 0 4px';
    const mkToolBtn = (iconSvg, tip) => {
        const b = document.createElement('div');
        b.innerHTML = iconSvg;
        // A+B：静止软蓝灰(--ws-icon)，悬停点亮品牌橙(--ws-accent) + 放大
        b.style.cssText = 'width:30px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:6px;background:var(--ws-surface-2);cursor:pointer;color:var(--ws-icon);user-select:none;flex-shrink:0;transition:color .12s,transform .12s';
        b.onmousedown = e => e.preventDefault();
        b._tip = tip;
        // 共享即时提示(mouseenter 立刻显示，无原生 title 的 ~0.5s 延迟)
        b.onmouseenter = () => {
            b.style.color = 'var(--ws-accent)'; b.style.transform = 'scale(1.12)';
            if (b._tip) showTip(b, b._tip);
        };
        b.onmouseleave = () => { b.style.color = 'var(--ws-icon)'; b.style.transform = ''; hideTip(); };
        return b;
    };
    const hexInput = document.createElement('input');
    hexInput.id = 'ncHex'; hexInput.type = 'text';
    hexInput.spellcheck = false; hexInput.maxLength = 7;
    hexInput.placeholder = '#RRGGBB';
    hexInput.style.cssText = 'flex:1;min-width:0;height:26px;box-sizing:border-box;background:var(--ws-surface-2);border:1px solid transparent;border-radius:6px;color:var(--ws-text);font-size:12px;padding:0 8px;text-transform:uppercase;letter-spacing:.5px;outline:none;font-family:monospace';
    const commitHex = () => {
        let v = hexInput.value.trim();
        if (!v) return;
        if (v[0] !== '#') v = '#' + v;
        if (/^#[0-9a-fA-F]{3}$/.test(v)) v = '#' + [...v.slice(1)].map(c => c + c).join('');
        if (!/^#[0-9a-fA-F]{6}$/.test(v)) { hexInput.value = curHex().toUpperCase(); return; }
        onHexCh(v.toLowerCase());
    };
    hexInput.onchange = commitHex;
    hexInput.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { commitHex(); hexInput.blur(); } };
    hexInput.onclick = () => hexInput.select();  // 单击全选便于复制

    // 屏幕吸管（原生 EyeDropper API，Chrome/Edge 95+）
    const eyeBtn = mkToolBtn(WS_ICONS.pipette, '自定义取色');
    if (window.EyeDropper) {
        eyeBtn.onclick = async () => {
            try {
                const r = await new window.EyeDropper().open();
                const hex = r.sRGBHex.toLowerCase();
                addRecentPick(hex);
                onHexCh(hex);
            } catch (e) { /* 用户按 Esc 取消 */ }
        };
    } else {
        eyeBtn.style.opacity = '.35';
        eyeBtn.style.cursor = 'not-allowed';
        eyeBtn._tip = '当前浏览器不支持屏幕取色（需 Chrome/Edge 95+）';
    }

    // 随机色；Alt+点击 = 超级随机（多选节点各配不同随机色）
    const randBtn = mkToolBtn(WS_ICONS.dice, 'Alt + 点击：多节点 / 分组随机配色');
    randBtn.onclick = (e) => {
        if (e.altKey && nodes.length > 1) {
            // 超级随机：绕过面板状态，逐节点独立上色
            nodes.forEach(n => {
                const c = randomHSV();
                applySolidHex([n], hsv2hex(c.h, c.s, c.v), { ...S.titleStyle });
            });
            refreshAllNodeVisuals();
            return;
        }
        const c = randomHSV();
        S.h = c.h; S.s = c.s; S.v = c.v;
        if (S.stopCount > 1) { const st = S.stops[S.aStop]; st.h = c.h; st.s = c.s; st.v = c.v; }
        document.getElementById('ncHs').value = c.h;
        saveAndSync(); refresh();
    };

    toolRow.appendChild(hexInput);
    toolRow.appendChild(eyeBtn);
    toolRow.appendChild(randBtn);
    panel.appendChild(toolRow);

    // 12 颜色预设（色相条下方）
    panel.appendChild(presetArea);

    // 颜色站模式按钮
    panel.appendChild(stiWrap);

    // direction grid
    const dirWrap=document.createElement("div");dirWrap.id="ncDg";dirWrap.className="nc-dg";dirWrap.style.display="none";
    DIRS.forEach(d=>{
        const el=document.createElement("div");
        el.className='nc-dgi'+(d.sym===S.dir?' on':'');
        el.dataset.deg=d.deg;  // 直接用数值存储角度，避免 Unicode dataset 字符比对问题
        el.dataset.tip=DIR_TIPS[d.sym];
        const sym=document.createElement("div");sym.className='nc-dgs';sym.textContent=d.sym;
        el.appendChild(sym);
        const tip=document.createElement("div");tip.className='nc-dgt';tip.textContent=DIR_TIPS[d.sym];
        el.appendChild(tip);
        el.onclick=()=>{
            document.querySelectorAll('#ncDg .nc-dgi').forEach(c=>c.classList.remove('on'));
            el.classList.add('on');S.dir=d.sym;
            saveAndSync();refresh();
        };
        dirWrap.appendChild(el);
    });
    panel.appendChild(dirWrap);

    // ── 标题文字样式控件（始终显示） ──
    const tsWrap = document.createElement('div');
    tsWrap.id = 'ncTsWrap';
    tsWrap.style.display = 'block';

    // ── 标题样式：字号/字重/对齐共用背景容器 ──────────────────────
    const tsGroup = document.createElement('div');
    tsGroup.className = 'nc-ts-row';
    tsGroup.style.flexDirection = 'column';
    tsGroup.style.gap = '8px';
    tsGroup.style.padding = '6px 8px';
    tsGroup.style.overflow = 'visible';
    tsGroup.style.alignItems = 'stretch';

    // ── 第1行：字号（标签 + 滑条 + 数字框） ──
    const sizeRow = document.createElement('div');
    sizeRow.style.display = 'flex';
    sizeRow.style.alignItems = 'center';
    sizeRow.style.gap = 'var(--ws-gap-xs)';
    sizeRow.style.width = '100%';
    const sizeLbl = document.createElement('label');
    sizeLbl.textContent = '字号';
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
    tsGroup.appendChild(sizeRow);

    // ── 第2行：字重（左）+ 对齐（右） ──
    const styleRow = document.createElement('div');
    styleRow.style.display = 'flex';
    styleRow.style.justifyContent = 'space-between';
    styleRow.style.alignItems = 'center';
    styleRow.style.width = '100%';

    // 左侧：字重（L/R/B）
    const weightLbl = document.createElement('label');
    weightLbl.textContent = '字重';
    const weightSeg = document.createElement('div');
    weightSeg.className = 'nc-ts-seg';
    weightSeg.style.marginLeft = '6px';
    weightSeg.style.marginRight = '6px';
    const weightDefs = [
        { key: 'lighter', label: '细', title: '细体' },
        { key: 'normal',  label: '中', title: '正常' },
        { key: 'bold',    label: '粗', title: '粗体' },
    ];
    const weightBtns = {};
    weightDefs.forEach(({key, label}) => {
        const btn = document.createElement('div');
        btn.className = 'nc-ts-si' + (S.titleStyle.weight === key ? ' on' : '');
        btn.textContent = label;
        btn.title = {lighter:'细体',normal:'正常',bold:'粗体'}[key];
        btn.onclick = () => {
            S.titleStyle.weight = key;
            weightDefs.forEach(d => weightBtns[d.key]?.classList.toggle('on', d.key === key));
            saveAndSync();
            canvas.setDirty(true, true); app.graph.setDirtyCanvas(true, true);
        };
        weightBtns[key] = btn;
        weightSeg.appendChild(btn);
    });
    styleRow.appendChild(weightLbl);
    styleRow.appendChild(weightSeg);

    // 右侧：对齐
    const alignWrap = document.createElement('div');
    alignWrap.style.display = 'flex';
    alignWrap.style.alignItems = 'center';
    alignWrap.style.gap = '4px';
    const alignLbl = document.createElement('label');
    alignLbl.textContent = '对齐';
    const alignSeg = document.createElement('div');
    alignSeg.className = 'nc-ts-seg';
    const alignDefs = [
        { key: 'left',   icon: '≡' },
        { key: 'center', icon: '☰' },
        { key: 'right',  icon: '≣' },
    ];
    const alignIcons = {
        left:   '<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="2" width="12" height="2" rx="1"/><rect x="1" y="6" width="8" height="2" rx="1"/><rect x="1" y="10" width="10" height="2" rx="1"/></svg>',
        center: '<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="2" width="12" height="2" rx="1"/><rect x="3" y="6" width="8" height="2" rx="1"/><rect x="2" y="10" width="10" height="2" rx="1"/></svg>',
        right:  '<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="2" width="12" height="2" rx="1"/><rect x="5" y="6" width="8" height="2" rx="1"/><rect x="3" y="10" width="10" height="2" rx="1"/></svg>',
    };
    const alignBtns = {};
    alignDefs.forEach(({key, icon}) => {
        const btn = document.createElement('div');
        btn.className = 'nc-ts-si' + (S.titleStyle.align === key ? ' on' : '');
        btn.innerHTML = alignIcons[key];
        btn.title = {left:'左对齐',center:'居中',right:'右对齐'}[key];
        btn.onclick = () => {
            S.titleStyle.align = key;
            alignDefs.forEach(d => alignBtns[d.key]?.classList.toggle('on', d.key === key));
            saveAndSync(); canvas.setDirty(true, true); app.graph.setDirtyCanvas(true, true);
        };
        alignBtns[key] = btn;
        alignSeg.appendChild(btn);
    });
    alignWrap.appendChild(alignLbl);
    alignWrap.appendChild(alignSeg);
    styleRow.appendChild(alignWrap);
    tsGroup.appendChild(styleRow);

    tsWrap.appendChild(tsGroup);

    panel.appendChild(tsWrap);



    // footer
    const fRow=document.createElement("div");fRow.className="nc-fb";
    const resetBtn=document.createElement("button");resetBtn.className="nc-cfb";resetBtn.textContent="清除";
    resetBtn.onclick=()=>{
        _isCleared = true;  // 标记为清除预览状态
        nodes.forEach(n=>{
            if(typeof n.setColorOption==="function")n.setColorOption(null);
            else{n.color=void 0;n.bgcolor=void 0;}
            delete n.constructor.title_text_color;delete n._gradient;delete n._titleStyle;
        });
        // 联动分组框同步清除
        linkedGroups.forEach(g => { g.color = void 0; });
        // 重置面板状态到初始化，但保留当前模式（单色/双色/三色）
        const cnt = S.stopCount;
        S.dir = '↓';   // 字段名与初始化(L86)/读取(L108)一致；原误写为 S.direction 导致方向归零失效
        S.h = 20; S.s = 82; S.v = 83;
        S.stops = [{p:0,h:20,s:82,v:83},{p:1,h:20,s:60,v:30}];
        S.editTarget = 'hdr';
        S.titleH = 20; S.titleS = 82; S.titleV = 83;
        S.bgH = 20; S.bgS = 90; S.bgV = 35;
        S.titleStyle = { size: 14, color: '#ffffff', align: 'left', weight: 'normal' };
        S.stopCount = cnt;
        canvas.setDirty(true,true);app.graph.setDirtyCanvas(true,true);
        if(typeof _refreshDOMGradients==="function")_refreshDOMGradients();
        refresh();
        resetBtn.classList.add('nc-cleared');  // 清除按钮高亮
    };
    const confirmBtn=document.createElement("button");confirmBtn.className="nc-cfb";confirmBtn.textContent="确认";
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

    const cr=document.createElement("div");cr.style.cssText="padding:12px 0 0;flex-shrink:0;text-align:center";
    cr.innerHTML='<span style="color:var(--ws-text-muted);font-size:10px;letter-spacing:0.5px;white-space:nowrap">COPYRIGHT © WOSAI STUDIO | 穿山阅海</span>';
    panel.appendChild(cr);

    document.body.appendChild(panel);
    const gap = 12;
    if (anchorRect) {
        // 从 color bar 打开：横版在 bar 下方水平居中；竖版在 bar 左/右侧垂直居中
        const pR = panel.getBoundingClientRect();
        let px, py;
        if (anchorRect.orient === 'v') {
            px = anchorRect.left - pR.width - gap;          // 优先左侧
            if (px < 10) px = anchorRect.right + gap;       // 放不下翻右侧
            py = anchorRect.top + anchorRect.height / 2 - pR.height / 2;
        } else {
            px = anchorRect.left + anchorRect.width / 2 - pR.width / 2;
            py = anchorRect.bottom + gap;
        }
        px = Math.max(10, Math.min(px, window.innerWidth - pR.width - 10));
        py = Math.min(Math.max(py, 10), window.innerHeight - pR.height - 10);
        panel.style.left = px + 'px';
        panel.style.top = py + 'px';
    } else {
        // 从节点打开：智能定位（优先右侧，溢出则左侧，最后兜底 clamp）
        const n=nodes[0],cEl=canvas.canvas,cR=cEl.getBoundingClientRect();
        const sc=canvas.ds.scale,off=canvas.ds.offset;
        const pR=panel.getBoundingClientRect();
        const nodeRight=cR.left+(n.pos[0]+n.size[0]+off[0])*sc;
        const nodeLeft =cR.left+(n.pos[0]+off[0])*sc;
        let px=nodeRight+gap;
        if(px+pR.width>window.innerWidth-10){
            px=nodeLeft-pR.width-gap;
        }
        if(px<10||px+pR.width>window.innerWidth-10){
            px=Math.max(10,Math.min(px,window.innerWidth-pR.width-10));
        }
        let py=cR.top+(n.pos[1]+n.size[1]/2+off[1])*sc-pR.height/2;
        py=Math.min(Math.max(py,10),window.innerHeight-pR.height-10);
        panel.style.left=px+'px';panel.style.top=py+'px';
    }

    // ── 面板随画布缩放同步（0.65~1.5 钳制；origin top-left + 视口钳制防错位）──
    panel.style.transformOrigin = 'top left';
    let _lastZoom = null;
    const _zoomTick = () => {
        if (!panel.isConnected) return;   // 面板关闭即停止
        const sc = canvas?.ds?.scale ?? 1;
        if (sc !== _lastZoom) {
            _lastZoom = sc;
            const ps = Math.max(0.65, Math.min(sc, 1.5));
            panel.style.transform = `scale(${ps})`;
            const r = panel.getBoundingClientRect();
            const cx = Math.max(10, Math.min(r.left, window.innerWidth - r.width - 10));
            const cy = Math.max(10, Math.min(r.top, window.innerHeight - r.height - 10));
            if (Math.abs(cx - r.left) > 0.5) panel.style.left = cx + 'px';
            if (Math.abs(cy - r.top) > 0.5) panel.style.top = cy + 'px';
        }
        requestAnimationFrame(_zoomTick);
    };
    requestAnimationFrame(_zoomTick);

    // store 同步加载 localStorage；服务端预设异步合并后重渲染
    initStore().then(() => { renderRecentPicks(); buildPresets(); });
    buildPresets();renderRecentPicks();rebuildPins();refresh();
    // 初始化时同步渐变 UI 显隐
    updateGradVisibility();
    // 首次打开时立即把当前状态应用到节点
    saveAndSync();

    // --- Drag handlers ---
    // 命名处理器：close() 中统一移除，防止每次开面板都在 document 上累积监听器（内存泄漏）
    const svEl=document.getElementById('ncSv');let svDrag=false;
    const _svMove=e=>{if(svDrag)onSvMove(e);};
    const _svUp=()=>svDrag=false;
    svEl.addEventListener('pointerdown',e=>{svDrag=true;onSvMove(e);e.preventDefault();});
    document.addEventListener('pointermove',_svMove);
    document.addEventListener('pointerup',_svUp);
    document.addEventListener('pointercancel',_svUp);
    function onSvMove(e){
        const r=svEl.getBoundingClientRect();
        S.s=Math.round(Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*100);
        S.v=Math.round((1-Math.max(0,Math.min(1,(e.clientY-r.top)/r.height)))*100);
        if(S.stopCount>1){const st=S.stops[S.aStop];st.s=S.s;st.v=S.v;}
        saveAndSync();refresh();
    }

    function close(){
        _onHexChFn=null;hideTip();panel.remove();
        _offGlass();   // 退订玻璃主题广播
        document.removeEventListener("pointerdown",_closeHandler,{capture:true});
        document.removeEventListener('keydown',_onGrayKeyDown);
        document.removeEventListener('keyup',_onGrayKeyUp);
        window.removeEventListener('blur',_onGrayBlur);
        document.removeEventListener('pointermove',_svMove);
        document.removeEventListener('pointerup',_svUp);
        document.removeEventListener('pointercancel',_svUp);
        // 补移除 rebuildPins 注册的 document 级监听器（防面板关闭后残留累积）
        if (_pinOnMove) document.removeEventListener('pointermove', _pinOnMove);
        if (_pinOnUp) {
            document.removeEventListener('pointerup', _pinOnUp);
            document.removeEventListener('pointercancel', _pinOnUp);
        }
    }
    // 暴露 close 路径：旧面板清理(L78-82)可通过 _wosaiClose() 正确解绑监听
    panel._wosaiClose = close;
}

app.registerExtension({
    name: "WOSAI.NodeColor",

    setup() {
        // 动态加载静态面板 CSS（由 os-color.css 提供）
        if (!document.getElementById("wosai-os-color-css") && !document.querySelector('link[href*="os-color.css"]')) {
            const link = document.createElement("link");
            link.id = "wosai-os-color-css";
            link.rel = "stylesheet";
            link.href = "/extensions/WOSAI-ComfyUI/css/os-color.css";
            document.head.appendChild(link);
        }

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
                if (cs.backgroundColor === rgbTarget || cs.backgroundColor === `rgba(0, 0, 0, 0)`) {
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
                const color = ts.color || '#ffffff';
                const align = ts.align || 'left';
                const weight = ts.weight || 'normal';
                // margin auto 值
                const ml = align === 'right' ? 'auto' : (align === 'center' ? 'auto' : '0');
                const mr = align === 'left' ? 'auto' : (align === 'center' ? 'auto' : '0');

                const sel = `[data-node-id="${node.id}"]`;

                // 规则 0：撑满标题包裹链——margin auto 只有在父容器有剩余空间时才生效。
                // 默认 .relative.mr-auto 会收缩到内容宽并被 mr-auto 挤到左侧，
                // node-title / .truncate 也不主动 grow，导致无剩余空间 → margin auto 无效。
                // 因此强制 wrapper → node-title → .truncate 全部撑满标题栏宽度。
                css +=
                    `${sel} [data-testid="node-header-${node.id}"] .mr-auto {\n` +
                    `  flex: 1 1 auto !important;\n` +
                    `  width: 100% !important;\n` +
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
                    `}\n`;

                // 规则 4：编辑模式 <input> — margin auto + 字体颜色
                css +=
                    `${sel} [data-testid="node-title"] [data-testid="node-title-input"] {\n` +
                    `  font-size: ${fontSize}px !important;\n` +
                    `  color: ${color} !important;\n` +
                    `  font-weight: ${weight} !important;\n` +
                    `  margin-left: ${ml} !important;\n` +
                    `  margin-right: ${mr} !important;\n` +
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

        // 在 Canvas 上重绘节点标题文字（覆盖原来的标题渲染）
        // 调用时坐标系原点在节点内容区左上角（标题栏顶部 y = -th）
        function redrawTitleText(node, ctx) {
            const ts = node._titleStyle;
            if (!ts) return;
            const LG = typeof LiteGraph !== 'undefined' ? LiteGraph : null;
            const th = LG?.NODE_TITLE_HEIGHT || 30;
            const w = node.size[0];
            const title = node.getTitle ? node.getTitle() : (node.title || '');
            if (!title) return;

            const fontSize = Math.max(8, Math.min(32, ts.size || 14));
            const color = ts.color || '#ffffff';
            const align = ts.align || 'left';
            const pad = 10;

            // 取标题栏背景色：优先用节点自定义色，否则用 LiteGraph 默认值
            const titleBg = (node.color && node.color !== 'rgba(0,0,0,0)')
                ? node.color
                : (LG?.NODE_DEFAULT_COLOR || '#333');

            const r = LG?.NODE_CORNER_RADIUS ?? 8;

            ctx.save();
            // 用标题背景色重绘标题区域（清除原来的文字），再写入新样式的文字
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(0, -th, w, th, [r, r, 0, 0]);
            } else {
                ctx.rect(0, -th, w, th);
            }
            ctx.fillStyle = titleBg;
            ctx.fill();

            // 写新样式文字
            let x;
            if (align === 'left') x = pad;
            else if (align === 'right') x = w - pad;
            else x = w / 2;

            ctx.font = `${ts.weight || "bold"} ${fontSize}px Arial, sans-serif`;
            ctx.fillStyle = color;
            ctx.textAlign = align;
            ctx.textBaseline = 'middle';
            // 自适应阴影，确保在亮色背景（金黄、沙橙等）上文字也清晰
            _applyTitleShadow(ctx, color);
            ctx.fillText(title, x, -th / 2);
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
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
                node.bgcolor = "transparent";
                node.color = "#fff0";
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
            const cc = (typeof color === 'string' && color.startsWith('#')) ? color : '#ffffff';
            const cr = parseInt(cc.slice(1, 3), 16), cg = parseInt(cc.slice(3, 5), 16), cb = parseInt(cc.slice(5, 7), 16);
            const clum = 0.299 * cr + 0.587 * cg + 0.114 * cb;
            ctx.shadowColor = clum > 128 ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.55)';
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
                // ── 无渐变：正常绘制纯色背景，如有自定义标题样式则事后重绘文字 ──
                if (!node._gradient) {
                    origFn.call(this, node, ctx, size, fgcolor, bgcolor, selected, mouseOver);
                    if (node._titleStyle) redrawTitleText(node, ctx);
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
                    if (ctx.roundRect) ctx.roundRect(0, -th, w, h + th, r);
                    else ctx.rect(0, -th, w, h + th);
                    ctx.fillStyle = grad;
                    ctx.fill();
                    // 步骤2：在渐变上绘制标题文字
                    const title = node.getTitle ? node.getTitle() : (node.title || '');
                    if (title) {
                        const ts = node._titleStyle;
                        const fontSize = ts?.size ? Math.max(8, Math.min(32, ts.size)) : (LG?.NODE_TEXT_SIZE || 14);
                        const color = ts?.color || node.constructor?.title_text_color || fgcolor || '#ffffff';
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
                        const tx = align === 'center' ? w/2 : (align === 'right' ? w-10 : 10);
                        ctx.fillText(title, tx, -th/2 + (ts?.y ?? 0));
                        ctx.shadowColor = 'transparent';
                        ctx.shadowBlur = 0;
                        ctx.restore();
                    }
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
                        node.color   = 'rgba(0,0,0,0)';
                        node.bgcolor = 'rgba(0,0,0,0)';
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
                        if (ctx.roundRect) ctx.roundRect(0, -th, w, h + th, r);
                        else ctx.rect(0, -th, w, h + th);
                        ctx.fillStyle = grad;
                        ctx.fill();
                        ctx.globalCompositeOperation = 'source-over';
                        ctx.restore();
                    }
                    if (node._titleStyle) redrawTitleText(node, ctx);
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
            if (!canvas) { setTimeout(setupCanvasOverride, 100); return false; }

            // 优先 hook drawNodeShape（仅处理背景+标题，CYBERPUNK 同款方案）
            // drawNodeShape 不存在时降级到 drawNode
            function hookMethod(methodName, makeWrapper) {
                const targets = [];
                if (typeof canvas[methodName] === 'function' &&
                    Object.prototype.hasOwnProperty.call(canvas, methodName)) {
                    targets.push({ obj: canvas, orig: canvas[methodName] });
                }
                let proto = Object.getPrototypeOf(canvas);
                while (proto && proto !== Object.prototype) {
                    if (Object.prototype.hasOwnProperty.call(proto, methodName) &&
                        typeof proto[methodName] === 'function') {
                        targets.push({ obj: proto, orig: proto[methodName] });
                    }
                    proto = Object.getPrototypeOf(proto);
                }
                if (targets.length === 0) {
                    const fn = canvas[methodName];
                    if (typeof fn === 'function') targets.push({ obj: canvas, orig: fn });
                    else return false;
                }
                for (const t of targets) {
                    if (t.orig._wosaiWrapped) continue;
                    const w = makeWrapper(t.orig);
                    w._wosaiWrapped = true;
                    t.obj[methodName] = w;
                }
                const first = targets.find(t => !t.orig._wosaiWrapped);
                if (first) {
                    const inst = makeWrapper(first.orig);
                    inst._wosaiWrapped = true;
                    canvas[methodName] = inst;
                } else if (!Object.prototype.hasOwnProperty.call(canvas, methodName) ||
                           !canvas[methodName]._wosaiWrapped) {
                    if (targets[0]) canvas[methodName] = targets[0].obj[methodName];
                }
                return true;
            }

            // 先尝试 drawNodeShape，失败再尝试 drawNode
            const ok = hookMethod('drawNodeShape', makeDrawShapeWrapper)
                    || hookMethod('drawNode', makeDrawNodeWrapper);
            return ok;
        }

        function setupGradientSupport() {
            const canvas = app.canvas;
            if (!canvas) { setTimeout(setupGradientSupport, 100); return; }

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
                refreshDOMGradients();
                setTimeout(() => { refreshDOMTitleStyles(); applyTitleAlignInline(); }, 200);
            });

            // MutationObserver：监听 Nodes 2.0 Vue DOM 变更
            // Vue 每次响应式重渲后：
            // - 可能替换/更新节点 DOM 子树（childList 事件）→ 需要重新打标记
            // - 可能更新元素 style/class 属性 → 可能覆盖我们的注入样式 → 需要刷新
            let _moTimer = null;
            // 监听目标 + 选项提取出来，便于刷新时断开/重连
            const graphContainer = document.getElementById('graph-canvas-container')
                || document.getElementById('graph-canvas')
                || document.querySelector('.graph-canvas-container, .graph-canvas, .litegraph, #litegraph');
            const _moTarget = graphContainer || document.body;   // 兜底监听 body（稍重但可靠）
            // ⚠ 绝不监听 'style'：refreshDOMGradients 给每个渐变节点写 inline style，
            //   监听 style 会被自身写入(及 Vue 对其的异步反应)反复触发 → 16ms 死循环 → 右键假死。
            //   只监听 childList(Vue 重建节点子树需重新注入) + class；其余情况由 500ms 轮询兜底。
            const _moOpts = { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] };
            // 判断 DOM 节点是否属于本插件自身 UI（面板/提示），用于过滤无关变更
            const _SELF_SEL = '[data-wosai-panel],.ws-tip,.os-panel,#wosai-panel';
            const _isSelfUI = (n) => n && n.nodeType === 1 &&
                ((n.matches && n.matches(_SELF_SEL)) || (n.closest && n.closest(_SELF_SEL)));
            const _gradMO = new MutationObserver((muts) => {
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
                _moTimer = setTimeout(() => {
                    _moTimer = null;
                    const hasGrad = app.graph?.nodes?.some(n => n._gradient);
                    const hasTitleStyle = app.graph?.nodes?.some(n => n._titleStyle);
                    if (!hasGrad && !hasTitleStyle) return;
                    // ⚠ 关键防死循环：refreshDOMGradients 会写节点 style(background-image)，
                    //   而本观察器正监听 style/class → 自身写入会再次触发回调，形成永不停的 16ms 循环
                    //   （CPU 持续占用 → 右键弹窗迟迟不出现；画布旁 DOM 不停变 → 输入法悬浮栏闪烁抖动）。
                    //   故刷新期间先断开，刷新后再重连（disconnect 清空待处理队列，自身写入不入队）。
                    _gradMO.disconnect();
                    try {
                        if (hasGrad) refreshDOMGradients();
                        if (hasTitleStyle) { refreshDOMTitleStyles(); applyTitleAlignInline(); }
                    } finally {
                        _gradMO.observe(_moTarget, _moOpts);   // 重连
                    }
                }, 120);
            });
            _gradMO.observe(_moTarget, _moOpts);

            // 事件驱动兜底：使用 graph.onNodeAdded/onNodeRemoved 替代 setInterval 轮询
            // 处理节点增删、工作流加载等 MO 无法捕获的场景
            let _prevNodeCount = app.graph?.nodes?.length || 0;
            const _refreshIfChanged = () => {
                if (!app.graph) return;
                const curr = app.graph.nodes?.length || 0;
                const gradCount = app.graph.nodes?.filter(n => n._gradient)?.length || 0;
                const tsCount = app.graph.nodes?.filter(n => n._titleStyle)?.length || 0;
                if (curr !== _prevNodeCount || gradCount > 0 || tsCount > 0) {
                    _prevNodeCount = curr;
                    refreshDOMGradients();
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

        // 分组右键菜单 — 复用 openNodeColorPicker 完整面板
        hookProto(LGraphGroup.prototype, 'getMenuOptions', (origGroupOpts) => function (gc) {
            const opts = origGroupOpts?.apply(this, arguments) || [];
            const group = this;
            opts.push(null);
            opts.push({
                content: "🟠 高级配色 NodeColor",
                callback: () => openNodeColorPicker([group]),
            });
            return opts;
        });
    },

    remove() {
        if (_gradMORef) { _gradMORef.disconnect(); _gradMORef = null; }
        // 恢复 graph 的原始 onNodeAdded/onNodeRemoved 回调
        if (app.graph) {
            const _curAdd = app.graph.onNodeAdded;
            const _curRem = app.graph.onNodeRemoved;
            // 简单判断：如果当前回调是包装后的，恢复原始
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
    },

    getNodeMenuItems(node) {
        // 画布注释自绘背景（color/bgcolor 被强制透明），配色对其无效——屏蔽菜单防误解
        if (node.type === "WOSAI_CanvasNote") return [];
        const canvas = app.canvas;
        let nodes = (canvas.selected_nodes?.[node.id])
            ? Object.values(canvas.selected_nodes)
            : [node];
        // 多选中混入的画布注释一并过滤
        nodes = nodes.filter(n => n.type !== "WOSAI_CanvasNote");
        if (!nodes.length) return [];
        return [
            null,
            {
                content: nodes.length > 1 ? `🟠 高级配色 NodeColor (${nodes.length})` : "🟠 高级配色 NodeColor",
                callback: () => openNodeColorPicker(nodes),
            },
        ];
    },

    commands: [{
        id: "wosai-node-color",
        label: "🟠 高级配色 NodeColor",
        function: () => {
            const canvas = app.canvas;
            const graph = app.graph;
            // 画布注释自绘背景，配色无效——各入口统一过滤
            const sel = (canvas.selected_nodes ? Object.values(canvas.selected_nodes) : [])
                .filter(n => n.type !== "WOSAI_CanvasNote");
            if (sel.length > 0) {
                openNodeColorPicker(sel);
                return;
            }
            // 无选中节点时尝试选中分组（高级面板：组内节点 + 分组框联动）
            const selGroups = (graph._groups || []).filter(g => g._selected || g.selected);
            if (selGroups.length) openPickerForGroups(selGroups);
        },
    }],
});

// ── 对外导出（供 color-bar.js 等复用）──────────────────────
// 打开完整调色面板
export { openNodeColorPicker };

// 全量刷新节点视觉：Canvas 重绘 + Nodes 2.0 DOM 渐变/标题样式注入
// （依赖 setup() 已执行并填充模块级 hook 引用）
export function refreshAllVisuals() {
    const canvas = app.canvas;
    canvas?.setDirty(true, true);
    app.graph?.setDirtyCanvas(true, true);
    if (typeof _refreshDOMGradients === "function") _refreshDOMGradients();
    if (typeof _refreshDOMTitleStyles === "function") _refreshDOMTitleStyles();
    if (typeof _applyTitleAlignInline === "function") _applyTitleAlignInline();
}
// v1.0: 模块化重构（core/store 拆分）+ 取色工具链（拾色器/HEX/随机/灰度）+ ColorBar/配色主题
