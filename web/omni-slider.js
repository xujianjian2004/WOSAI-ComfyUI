/* WOSAI OmniSlider v1.0 | 作者：穿山阅海 | COPYRIGHT © WOSAI STUDIO */
/**
 * WOSAI OmniSlider — 万能滑条前端 (CSS已提取至 web/styles/os-slider.css)
 */
import { app } from "../../../scripts/app.js";
import { retryUntil } from "./shared/shared-utils.js";
import { getGlassTheme, onGlassChange } from "./shared/glass-theme.js";
import { _osRefreshDOMHide, applyNodeDisplay } from "./shared/omni-hide.js";
import { hideEl, hideWidgetRow, ghostWidget, injectGlobalHideCSS, createHiddenObserver } from "./shared/nodes2-hide.js";
import { t, applyNodeDefTranslation } from "./shared/i18n.js";
import { WOSAI_COPYRIGHT } from "./shared/constants.js";
import { registerSelectionFollower } from "./shared/selection-follow.js";
import {
    defaultOmniSliderConfig as defaultCfg,
    parseOmniSliderConfig as parseCfg,
    serializeOmniSliderConfig as serializeCfg,
} from "./shared/omni-slider-config.js";

// ── I18N ────────────────────────────────────────────────────────────────
function _osT(key) {
    return t('widgets.omniSlider.' + key);
}
// ─────────────────────────────────────────────────────────────────────────────

// 万能滑条已简化为单滑条：通道数恒为 1

// ═══ 节点精简显示控制（三项独立，持久化在 node.properties）══════════════════
//   osHideTitle / osHideBadge / osHidePortLabel —— LiteGraph 自动序列化。
//   画布层隐藏（标题/角标）统一由 node-color.js 的 drawNodeShape wrapper 执行，
//   omni-slider 不再单独 hook 画布方法（避免双钩子冲突）。

// CSS 已迁移至 web/styles/os-slider.css，通过 extension.json 加载

// 主题判定统一走全插件玻璃主题标准（lib/glass-theme.js：auto 跟随画布亮度 / 手动锁定）
function getTheme() { return getGlassTheme(); }

// ── 自动队列已禁用：滑条值仅在收到运行命令后才传递给下游节点 ──────────
// 值的写入通过 syncConfigToWidget / syncWidget 完成，ComfyUI 手动运行时
// IS_CHANGED 会检测到 widget 值变化并正常触发节点执行。

// ═══ 精简模式显示控制（已提取到 lib/omni-hide.js）═══════════════════════════
//   applyNodeDisplay()    — 应用/恢复精简模式（隐藏标题/角标/端口）
//   _osRefreshDOMHide()   — Nodes 2.0 DOM 隐藏 CSS 刷新
//   隐藏三项独立标志持久化在 node.properties，LiteGraph 自动序列化。
//   画布隐藏统一由 node-color.js 的 drawNodeShape wrapper 执行（读取这些标志）。
// ── 预设色中文名（用于悬浮提示：中文名 + #HEX）──
// 即时悬浮提示改用共享 lib/tooltip.js（osShowDotTip/osHideDotTip 为顶部别名导入）

// ── 设置面板全局单例监听（Esc 关闭 / 点击面板外关闭）──
//   ⚠ 必须单例：旧实现每次开面板都 document.addEventListener 且清理在竞态/多路径下不稳，
//     导致 keydown/pointerdown 监听暴涨累积 → 反复开面板后假死。改为「永远只有一对」全局监听，
//     只作用于当前打开的 _osActivePanel，绝不随开关次数增长。
let _osActivePanel = null;
let _osGlobalHandlersInstalled = false;
let _osGlobalKeydownHandler = null;
let _osGlobalPointerdownHandler = null;
function _osInstallGlobalHandlers() {
    if (_osGlobalHandlersInstalled) return;
    _osGlobalHandlersInstalled = true;
    _osGlobalKeydownHandler = (e) => {
        const p = _osActivePanel;
        if (e.key === "Escape" && p && document.body.contains(p)) { e.preventDefault(); p._cleanup?.(); }
    };
    _osGlobalPointerdownHandler = (e) => {
        const p = _osActivePanel;
        if (p && p._armed && document.body.contains(p) && !p.contains(e.target)) p._cleanup?.();
    };
    document.addEventListener("keydown", _osGlobalKeydownHandler);
    document.addEventListener("pointerdown", _osGlobalPointerdownHandler, { capture: true });
}

// 构建隐藏模式分段按钮（面板、角标、端口），抽出为模块级以减小 openSettingsPanel 体积
function _mkHideChip(node, label, propKey, flagKey) {
    const b = document.createElement("button");
    b.className = "os-seg-btn" + (node[flagKey] ? " on" : "");
    b.textContent = label;
    b.onclick = (e) => {
        e.stopPropagation();
        node[flagKey] = !node[flagKey];
        if (!node.properties) node.properties = {};
        node.properties[propKey] = node[flagKey];
        b.classList.toggle("on", node[flagKey]);
        applyNodeDisplay(node, syncOutputPorts, updateOutputLabel);
        app.graph?.change();
        requestAnimationFrame(() => {
            app.graph?.setDirtyCanvas(true, true);
            app.canvas?.setDirty?.(true, true);
        });
    };
    return b;
}

// 通用分段控制按钮组工厂（类型/样式行复用）
function _osSegmentedControl(options, activeValue, onChange) {
    const el = document.createElement("div");
    el.className = "os-seg os-seg-compact";
    const btns = [];
    options.forEach(opt => {
        const btn = document.createElement("button");
        btn.className = "os-seg-btn" + (opt.value === activeValue ? " on" : "");
        btn.textContent = opt.label;
        btn.onclick = (e) => { e.stopPropagation(); onChange(opt.value); };
        btns.push(btn);
        el.appendChild(btn);
    });
    // 暴露 sync 方法供外部更新高亮
    el._sync = (val) => btns.forEach((b, i) => b.classList.toggle("on", options[i].value === val));
    return el;
}




// 最小值/最大值/步长：一行三列均匀分布
function _osBuildNumGroup(typeRangeGroup, drafts, curCh) {
    const group = document.createElement("div");
    group.className = "os-num-group";
    const mkCol = (labelKey, key, step) => {
        const col = document.createElement("div");
        col.className = "os-num-col";
        const subLbl = document.createElement("span");
        subLbl.className = "os-num-sub-label";
        subLbl.textContent = _osT(labelKey);
        const inp = document.createElement("input");
        inp.type = "number";
        inp.className = "os-num-inline";
        inp.step = step;
        inp.oninput = () => { const v = parseFloat(inp.value); if (!isNaN(v)) drafts[curCh][key] = v; };
        col.appendChild(subLbl);
        col.appendChild(inp);
        group.appendChild(col);
        return inp;
    };
    const minInp = mkCol('labelMin', 'min', "0.01");
    const maxInp = mkCol('labelMax', 'max', "0.01");
    const stepInp = mkCol('labelStep', 'step', "0.001");
    typeRangeGroup.appendChild(group);
    return { minInp, maxInp, stepInp };
}

// 数值位置 / 手柄大小：每行 = 标签 + 长滑条 + 数字框 + 颜色块（参考「高级配色」），实时预览
function _osBuildOffsetGroup(parent, node, drafts, curCh) {
    const _applyLabelPos = () => {
        const d = drafts[curCh];
        if (node._osWrap) {
            const row = node._osWrap.querySelectorAll(".os-slider-row")[curCh];
            const el = row && row.querySelector(".os-fill-text");
            if (el) el.style.transform = `translate(${d.labelX || 0}px, ${d.labelY || 0}px)`;
        }
        app.graph?.setDirtyCanvas(true, true);
    };
    // 内嵌颜色块：方形圆角，点击弹系统取色器，改完整 cfg 字段并重建
    const _textColorBoxes = [];
    const mkColorBox = (colorKey, fallback) => {
        const cur = drafts[curCh][colorKey] || fallback;
        const _contrast = (hex) => { const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || ''); if (!m) return 'var(--ws-text-on-accent)'; const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return (0.299 * r + 0.587 * g + 0.114 * b) > 140 ? 'var(--ws-text)' : 'var(--ws-text-on-accent)'; };
        const box = document.createElement("div");
        box.className = "os-color-box";
        box.style.background = cur;
        if (colorKey === "textColor") _textColorBoxes.push(box);
        const ico = document.createElement("span");   // 画板图标，颜色随底色取对比色
        ico.className = "os-color-box__icon";
        ico.style.color = _contrast(cur);
        ico.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 7l6 6"/><path d="M4 16L15.7 4.3a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4L8 20H4v-4z"/></svg>`;
        box.appendChild(ico);
        const inp = document.createElement("input");
        inp.type = "color"; inp.value = /^#[0-9a-fA-F]{6}$/.test(cur) ? cur : "";
        inp.className = "os-color-box__input";
        inp.oninput = () => { drafts[curCh][colorKey] = inp.value; if (node._osConfigs[curCh]) node._osConfigs[curCh][colorKey] = inp.value; if (colorKey === "textColor") _textColorBoxes.forEach(b => { b.style.background = inp.value; const ic = b.querySelector('span'); if (ic) ic.style.color = _contrast(inp.value); }); else { box.style.background = inp.value; ico.style.color = _contrast(inp.value); } rebuildUI(node); };
        box.appendChild(inp);
        return box;
    };
    const mkRow = (labelText, key, min, max, onSet, colorKey, colorFallback) => {
        const row = document.createElement("div"); row.className = "os-scale-row";
        const lbl = document.createElement("label"); lbl.textContent = labelText;
        const rng = document.createElement("input");
        rng.type = "range"; rng.className = "os-scale-range"; rng.min = min; rng.max = max; rng.step = "1";
        rng.value = drafts[curCh][key] || 0;
        rng.style.setProperty("--os-scale-color", drafts[curCh].color);
        const num = document.createElement("input");
        num.type = "number"; num.className = "os-num-inline"; num.min = min; num.max = max; num.step = "1";
        num.value = drafts[curCh][key] || 0;
        const set = (v) => { v = Math.max(min, Math.min(max, parseInt(v) || 0)); drafts[curCh][key] = v; if (node._osConfigs[curCh]) node._osConfigs[curCh][key] = v; rng.value = v; num.value = v; onSet(); };
        rng.oninput = () => set(rng.value);
        num.oninput = () => set(num.value);
        // 顺序：标签 → 滑条 → 拾色器(内侧) → 数字框(最右贴边)，使所有数字框与 min/max/step 对齐成统一右列
        row.appendChild(lbl); row.appendChild(rng); row.appendChild(mkColorBox(colorKey, colorFallback)); row.appendChild(num);
        parent.appendChild(row);
    };
    // 数值位置：横向偏移（配「数字颜色」）；手柄大小：圆点直径（配「手柄颜色」）
    mkRow(t('widgets.omniSlider.labelValuePositionX'), "labelX", -40, 40, _applyLabelPos, "textColor", "var(--ws-text)");
    mkRow(t('widgets.omniSlider.labelThumbSize'), "thumbSize", 18, 25, () => rebuildUI(node), "thumbColor", drafts[curCh].color);
    mkRow(t('widgets.omniSlider.labelTrackHeight'), "trackHeight", 1, 10, () => rebuildUI(node), "trackColor", drafts[curCh].color);
}

// ── 定位锚点：大小滑条 + 取色器 + 启用/禁用 + 5 个数值输入框 ──
function _osBuildSnapGroup(parent, node, drafts, curCh) {
    const d = drafts[curCh];
    if (!Array.isArray(d.snapPoints)) d.snapPoints = [null, null, null, null, null];
    const _contrast = (hex) => { const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || ''); if (!m) return 'var(--ws-text-on-accent)'; const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return (0.299 * r + 0.587 * g + 0.114 * b) > 140 ? 'var(--ws-text)' : 'var(--ws-text-on-accent)'; };
    const _accent = drafts[curCh].color;

    // 容器：标签 + 中间控件 + 右侧按钮 三列网格
    const row = document.createElement("div");
    row.className = "os-anchor-row";

    const lbl = document.createElement("label");
    lbl.textContent = _osT('labelSnapPoints');

    // 中间区域：滑条 + 取色器
    const mid = document.createElement("div");
    mid.className = "os-anchor-mid";
    mid.style.display = d.snapEnabled ? "flex" : "none";

    const sizeWrap = document.createElement("div");
    sizeWrap.className = "os-anchor-size-wrap";
    sizeWrap.setAttribute("data-tooltip", (d.snapSize || 5) + "px");
    const sizeRng = document.createElement("input");
    sizeRng.type = "range";
    sizeRng.className = "os-scale-range";
    sizeRng.min = "3";
    sizeRng.max = "12";
    sizeRng.step = "1";
    sizeRng.value = d.snapSize || 5;
    // 滑条轨道 / thumb 样式通过动态 style 标签注入，颜色跟随通道色
    const trackCss = "height:var(--ws-os-range-track-h);border-radius:var(--ws-radius-sm);background:linear-gradient(to right,var(--ws-surface-3) 0%," + _accent + " 100%);";
    const thumbCss = "width:var(--ws-os-range-thumb-size);height:var(--ws-os-range-thumb-size);border-radius:50%;background:" + _accent + ";border:none;cursor:pointer;margin-top:calc(var(--ws-os-range-thumb-size) / -3);";
    sizeRng.addEventListener("mouseover", () => {
        sizeRng.style.setProperty("--os-track", trackCss);
        sizeRng.style.setProperty("--os-thumb", thumbCss);
    });
    const styleId = "os-anchor-range-style-" + Math.random().toString(36).slice(2);
    const styleEl = document.createElement("style");
    styleEl.id = styleId;
    styleEl.textContent = `
        #${styleId}-rng::-webkit-slider-runnable-track { ${trackCss} }
        #${styleId}-rng::-webkit-slider-thumb { -webkit-appearance:none; ${thumbCss} }
        #${styleId}-rng::-moz-range-track { ${trackCss} }
        #${styleId}-rng::-moz-range-thumb { ${thumbCss} }
        .os-anchor-input::-webkit-outer-spin-button,
        .os-anchor-input::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
        .os-anchor-input { -moz-appearance:textfield; }
    `;
    sizeRng.id = styleId + "-rng";
    document.head.appendChild(styleEl);
    sizeWrap.appendChild(sizeRng);

    const curColor = d.snapColor || "var(--ws-text-muted)";
    const colorBox = document.createElement("div");
    colorBox.className = "os-color-box";
    colorBox.style.background = curColor;
    const colorIco = document.createElement("span");
    colorIco.className = "os-color-box__icon";
    colorIco.style.color = _contrast(curColor);
    colorIco.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 7l6 6"/><path d="M4 16L15.7 4.3a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4L8 20H4v-4z"/></svg>`;
    colorBox.appendChild(colorIco);
    const colorInp = document.createElement("input");
    colorInp.type = "color";
    colorInp.className = "os-color-box__input";
    colorInp.value = /^#[0-9a-fA-F]{6}$/.test(curColor) ? curColor : "";
    colorInp.oninput = () => {
        d.snapColor = colorInp.value;
        if (node._osConfigs[curCh]) node._osConfigs[curCh].snapColor = colorInp.value;
        colorBox.style.background = colorInp.value;
        colorIco.style.color = _contrast(colorInp.value);
        rebuildUI(node);
    };
    colorBox.appendChild(colorInp);

    mid.appendChild(sizeWrap);
    mid.appendChild(colorBox);

    // 启用/禁用按钮：固定宽度与值输入框同宽，永远在第三列
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "os-anchor-toggle" + (d.snapEnabled ? " on" : "");
    toggleBtn.textContent = d.snapEnabled ? _osT('snapDisable') : _osT('snapEnable');

    row.appendChild(lbl);
    row.appendChild(mid);
    row.appendChild(toggleBtn);
    parent.appendChild(row);

    // 5 个数值输入框：等分 5 列
    const inputsWrap = document.createElement("div");
    inputsWrap.className = "os-anchor-values";
    inputsWrap.style.display = d.snapEnabled ? "grid" : "none";
    for (let i = 0; i < 5; i++) {
        const inp = document.createElement("input");
        inp.type = "number";
        inp.className = "os-anchor-input";
        inp.min = "0";
        inp.step = "0.01";
        inp.placeholder = t('widgets.omniSlider.snapValuePlaceholder').replace('{n}', i + 1);
        inp.value = d.snapPoints[i] != null ? d.snapPoints[i] : "";
        inp.oninput = () => {
            let v = inp.value.trim();
            // 禁止负数
            if (v !== "" && parseFloat(v) < 0) {
                v = "0";
                inp.value = "0";
            }
            d.snapPoints[i] = v === "" ? null : parseFloat(v);
            if (node._osConfigs[curCh]) {
                node._osConfigs[curCh].snapPoints = [...d.snapPoints];
                // 锚点与滑块范围自动联动：若锚点值超出当前 min/max，自动扩展范围
                if (d.snapEnabled) {
                    const validPts = d.snapPoints.filter(p => p != null && !isNaN(p));
                    if (validPts.length > 0) {
                        const minP = Math.min(...validPts);
                        const maxP = Math.max(...validPts);
                        const mn = parseFloat(d.min) || 0;
                        const mx = parseFloat(d.max) || 1;
                        let changed = false;
                        if (minP < mn) { d.min = minP; changed = true; }
                        if (maxP > mx) { d.max = maxP; changed = true; }
                        if (changed) {
                            node._osConfigs[curCh].min = d.min;
                            node._osConfigs[curCh].max = d.max;
                        }
                        // 自动计算步长：若锚点值有规律则使用平均差值，无规律则不干预
                        const newStep = _calcStepFromPoints(validPts);
                        if (newStep != null) {
                            d.step = newStep;
                            node._osConfigs[curCh].step = newStep;
                        }
                    }
                }
            }
            rebuildUI(node);
        };
        inputsWrap.appendChild(inp);
    }
    parent.appendChild(inputsWrap);

    // 根据锚点值自动计算步长：
    //   - 若所有相邻差值在容差范围内一致（有规律），取平均差值作为步长
    //   - 若差值参差不齐（无规律），返回 null，不修改步长，保留用户原始设定
    const _calcStepFromPoints = (points) => {
        const valid = points.filter(p => p != null && !isNaN(p)).sort((a, b) => a - b);
        if (valid.length < 2) return null;
        const diffs = [];
        for (let i = 1; i < valid.length; i++) diffs.push(valid[i] - valid[i - 1]);
        if (diffs.length === 0) return null;

        // 计算平均差值
        const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;

        // 容差判断：每个差值与平均值的偏差不超过均值的 5%（至少 0.001）
        const tolerance = Math.max(avg * 0.05, 0.001);
        const isRegular = diffs.every(d => Math.abs(d - avg) <= tolerance);

        if (!isRegular) return null;  // 无规律，不干预步长

        // 有规律：使用平均差值，保留合理精度（最多 4 位小数）
        return parseFloat(avg.toFixed(4)) || 0.001;
    };

    // 事件
    const setSize = (v) => {
        v = Math.max(3, Math.min(12, parseInt(v) || 5));
        d.snapSize = v;
        if (node._osConfigs[curCh]) node._osConfigs[curCh].snapSize = v;
        sizeRng.value = v;
        sizeWrap.setAttribute("data-tooltip", v + "px");
        rebuildUI(node);
    };
    sizeRng.oninput = () => setSize(sizeRng.value);

    toggleBtn.onclick = (e) => {
        e.stopPropagation();
        d.snapEnabled = !d.snapEnabled;
        toggleBtn.textContent = d.snapEnabled ? _osT('snapDisable') : _osT('snapEnable');
        toggleBtn.classList.toggle("on", d.snapEnabled);
        mid.style.display = d.snapEnabled ? "flex" : "none";
        inputsWrap.style.display = d.snapEnabled ? "grid" : "none";
        if (node._osConfigs[curCh]) node._osConfigs[curCh].snapEnabled = d.snapEnabled;
        rebuildUI(node);
    };
}

// 名称输入行 + 确认按钮
function _osBuildNameRow(topGroup, node, drafts, curCh, cleanupPanel) {
    const nameRow = document.createElement("div");
    nameRow.className = "os-name-row";
    const nameInp = document.createElement("input");
    nameInp.type = "text";
    nameInp.className = "os-text-input os-name-input";
    nameInp.spellcheck = false;
    nameInp.setAttribute("autocomplete", "off");
    nameInp.placeholder = _osT('placeholderName');
    nameInp.oninput = () => {
        const newLabel = nameInp.value;
        drafts[curCh].label = newLabel;
        node._osConfigs[curCh].label = newLabel;
        syncConfigToWidget(node, curCh);
        updateOutputLabel(node);
        if (node._osWrap) {
            const rows = node._osWrap.querySelectorAll(".os-slider-row");
            const row = rows[curCh];
            if (row) {
                const labelEl = row.querySelector(".os-fill-text-label") || row.querySelector(".os-label-area");
                if (labelEl) labelEl.textContent = newLabel || '';
            }
        }
        app.graph?.setDirtyCanvas(true, true);
    };
    nameRow.appendChild(nameInp);
    const nameConfirmBtn = document.createElement("button");
    nameConfirmBtn.className = "os-name-confirm";
    nameConfirmBtn.textContent = _osT('btnConfirm');
    nameConfirmBtn.onclick = (e) => {
        e.stopPropagation();
        node._osConfigs[curCh].label = nameInp.value;
        syncConfigToWidget(node, curCh);
        rebuildUI(node);
        updateOutputLabel(node);
        app.graph?.setDirtyCanvas(true, true);
        cleanupPanel();
    };
    nameRow.appendChild(nameConfirmBtn);
    topGroup.appendChild(nameRow);
    return { nameRow, nameInp };
}

// 设置面板标题行
function _osBuildPanelTitle(panel) {
    const titleRow = document.createElement("div");
    titleRow.className = "os-panel-title-row";
    const titleEl = document.createElement("div");
    titleEl.className = "os-panel-title";
    titleEl.textContent = _osT('panelTitle');
    const _offGlassOS = onGlassChange((t) => { panel.setAttribute("data-theme", t); });
    panel._offGlass = _offGlassOS;
    titleRow.appendChild(titleEl);
    panel.appendChild(titleRow);
}

// 面板定位 + 画布缩放同步 + cleanup
function _osPositionPanel(panel, node, commitPanel) {
    document.body.appendChild(panel);

    // 打开面板时隐藏 HUB BAR，关闭后恢复
    const _restoreHubBar = window.__wosaiWithHubBarHidden
        ? window.__wosaiWithHubBarHidden() : null;
    panel._restoreHubBar = _restoreHubBar;

    const canvas = app.canvas;
    let _followCleanup = () => {};
    if (canvas?.canvas && node) {
        panel.style.transform = '';
        _followCleanup = registerSelectionFollower(panel, {
            placement: 'side',
            gap: 14,
            targets: [node],
            canvas,
        });
    } else {
        panel.style.left = "50%";
        panel.style.top = "50%";
        panel.style.transform = "translate(-50%,-50%)";
    }
    function cleanupPanel() {
        if (panel._cleaned) return;
        panel._cleaned = true;
        _followCleanup();
        try { commitPanel(); } catch (e) { console.warn("[WOSAI OmniSlider] cleanupPanel error:", e); }
        if (panel._offGlass) { panel._offGlass(); panel._offGlass = null; }
        if (panel._restoreHubBar) { panel._restoreHubBar(); panel._restoreHubBar = null; }
        panel.remove();
        if (_osActivePanel === panel) _osActivePanel = null;
        // 清理 _osBuildSnapGroup 创建的动态 range style 元素
        document.querySelectorAll('style[id^="os-anchor-range-style-"]').forEach(el => el.remove());
    }
    panel._cleanup = cleanupPanel;
    _osActivePanel = panel;
    panel._armed = false;
    setTimeout(() => { panel._armed = true; }, 0);
    _osInstallGlobalHandlers();
    return { cleanupPanel };
}

// ── 设置面板 ────────────────────────────────────────────────────────────────
function openSettingsPanel(node, _channelIndex, onClose) {
    const old = document.querySelector(".os-panel");
    if (old) { if (old._cleanup) old._cleanup(); else old.remove(); }

    const drafts = [Object.assign(defaultCfg(1), node._osConfigs[0] || {})];

    const panel = document.createElement("div");
    panel.className = "os-panel";
    panel.setAttribute("data-wosai-panel", "");
    panel.setAttribute("data-theme", getTheme());
    panel.onpointerdown = e => e.stopPropagation();

    _osBuildPanelTitle(panel);

    const topGroup = document.createElement("div");
    topGroup.className = "os-group os-group-top";
    panel.appendChild(topGroup);

    const { nameInp } = _osBuildNameRow(topGroup, node, drafts, 0, () => cleanupPanel());

    // ── 类型（按钮式：浮点 | 整数，点选高亮）──
    const typeRow = document.createElement("div");
    typeRow.className = "os-display-row";
    const typeLbl = document.createElement("div");
    typeLbl.className = "os-display-row-label";
    typeLbl.textContent = _osT('labelType');
    const _setType = (t) => {
        drafts[0].type = t;
        node._osConfigs[0].type = t;
        typeCtl._sync(t);
        rebuildUI(node);
        updateOutputLabel(node);
        app.graph?.setDirtyCanvas(true, true);
    };
    const typeCtl = _osSegmentedControl(
        [{value:"FLOAT", label:_osT('typeFloat')}, {value:"INT", label:_osT('typeInt')}],
        drafts[0].type || "FLOAT", _setType);
    typeRow.appendChild(typeLbl);
    typeRow.appendChild(typeCtl);
    // 类型 + 范围 共用一个背景容器（同属一组设置项）
    const typeRangeGroup = document.createElement("div");
    typeRangeGroup.className = "os-group";
    typeRangeGroup.appendChild(typeRow);
    panel.appendChild(typeRangeGroup);

    // ── 范围（三数字联排，已提取到 _osBuildNumGroup）──
    const { minInp, maxInp, stepInp } = _osBuildNumGroup(typeRangeGroup, drafts, 0);

    // ── 定位锚点：放在数值位置下方 ──
    _osBuildSnapGroup(typeRangeGroup, node, drafts, 0);
    _osBuildOffsetGroup(typeRangeGroup, node, drafts, 0);

    function refreshForm() {
        const d = drafts[0];
        nameInp.value = d.label;
        typeCtl._sync(d.type);
        minInp.value = d.min;
        maxInp.value = d.max;
        stepInp.value = d.step;
    }
    refreshForm();

    const displaySection = document.createElement("div");
    displaySection.className = "os-display-section";

    const hideRow = document.createElement("div");
    hideRow.className = "os-display-row";
    const hideLbl = document.createElement("div");
    hideLbl.className = "os-display-row-label";
    hideLbl.textContent = _osT('labelHideMode');
    const hideCtl = document.createElement("div");
    hideCtl.className = "os-seg os-seg-compact os-seg-hide";
    hideCtl.appendChild(_mkHideChip(node, _osT('hidePanel'), "osHideTitle", "_osHideTitle"));
    hideCtl.appendChild(_mkHideChip(node, _osT('hideBadge'), "osHideBadge", "_osHideBadge"));
    hideCtl.appendChild(_mkHideChip(node, _osT('hidePort'), "osHidePortLabel", "_osHidePortLabel"));
    hideRow.appendChild(hideLbl);
    hideRow.appendChild(hideCtl);
    displaySection.appendChild(hideRow);

    panel.appendChild(displaySection);

    const commitPanel = () => _osCommitPanel(node, drafts[0]);

    const cr = document.createElement("div");
    cr.className = "os-cr";
    cr.textContent = WOSAI_COPYRIGHT;
    panel.appendChild(cr);

    // 面板定位 + 缩放同步 + cleanup（已提取到 _osPositionPanel）
    const { cleanupPanel } = _osPositionPanel(panel, node, commitPanel);

    // ── 重置 / 应用 按钮行（需在 cleanupPanel 之后创建）──
    const btnRow = document.createElement("div");
    btnRow.className = "os-footer";
    const resetBtn = document.createElement("button");
    resetBtn.className = "os-btn os-btn-cancel";
    resetBtn.textContent = t('common.reset');
    resetBtn.onclick = () => {
        // 深拷贝默认配置，避免引用污染；定位锚点默认折叠隐藏
        const resetCfg = JSON.parse(JSON.stringify(defaultCfg(1)));
        node._osConfigs[0] = resetCfg;
        syncConfigToWidget(node, 0);
        rebuildUI(node);
        // 关闭旧面板（cleanup 里的 commitPanel 可能把旧值写回，因此在关闭后强制再覆盖一次）
        const old = document.querySelector(".os-panel");
        if (old && old._cleanup) old._cleanup();
        node._osConfigs[0] = JSON.parse(JSON.stringify(resetCfg));
        syncConfigToWidget(node, 0);
        rebuildUI(node);
        try { openSettingsPanel(node, 0, () => rebuildUI(node)); } catch (_) {}
    };
    const applyBtn = document.createElement("button");
    applyBtn.className = "os-btn os-btn-ok";
    applyBtn.textContent = t('common.apply');
    applyBtn.onclick = () => { commitPanel(); cleanupPanel(); };
    btnRow.appendChild(resetBtn);
    btnRow.appendChild(applyBtn);
    panel.insertBefore(btnRow, cr);

    nameInp.focus();
    nameInp.select();
}

// ── 强制更新 active_value 的 tooltip/DOM title（消除 buildUI 与 onConfigure 重复代码）──
function _forceActiveValueTooltip(node) {
    const avW = node._osHiddenWidgets?.["active_value"];
    if (!avW) return;
    const tip = t('widgets.omniSlider.activeValueTooltip');
    avW.tooltip = tip;
    const el = avW.element || avW.dom;
    if (el) { el.title = tip; const inner = el.querySelector("input,textarea,[title]"); if (inner) inner.title = tip; }
}

// ── 同步 active_value → 后端 execute() 实际读取的 widget（全通道激活，取通道0）─
function syncActiveValue(node) {
    const avW = node._osHiddenWidgets?.["active_value"];
    const cfg = node._osConfigs?.[0];
    if (!cfg) return;
    const newVal = cfg.type === "INT"
        ? Math.round(Number(cfg.value))
        : parseFloat(Number(cfg.value).toFixed(10));
    if (avW) {
        avW.value = newVal;
        if (typeof avW.callback === 'function') {
            try { avW.callback(newVal); } catch (_) { /* ignore */ }
        }
        if (avW.inputEl) avW.inputEl.value = newVal;
    }
    // ═══ ComfyUI v10 兼容：同步 node.inputs ────────────────────────────
    if (node.inputs) {
        for (const inp of node.inputs) {
            if (inp.name === "active_value") {
                if (inp.widget) inp.widget.value = newVal;
                if (Object.defineProperty) {
                    Object.defineProperty(inp, 'value', { value: newVal, writable: true, configurable: true, enumerable: true });
                } else {
                    inp.value = newVal;
                }
                break;
            }
        }
    }
}

// ── 同步配置到隐藏 widget（触发 ComfyUI 序列化）─────────────────────────────
function syncConfigToWidget(node, channelIndex) {
    const wName = "ch" + (channelIndex + 1) + "_cfg";
    const w = node._osHiddenWidgets?.[wName];
    const newVal = serializeCfg(node._osConfigs[channelIndex] || {});
    if (w) {
        // 双重写入：直接赋值 + callback（Nodes 2.0 响应式系统可能需要 callback 触发更新）
        w.value = newVal;
        if (typeof w.callback === 'function') {
            try { w.callback(newVal); } catch (_) { /* ignore */ }
        }
        // 同步 DOM input 防止 beforeQueued 反向重置
        if (w.inputEl) w.inputEl.value = newVal;
    } else {
        console.warn("[OmniSlider] syncConfigToWidget: widget not found:", wName, "available:", Object.keys(node._osHiddenWidgets || {}));
    }
    // ═══ ComfyUI v10 兼容：同步 node.inputs ────────────────────────────
    if (node.inputs) {
        for (const inp of node.inputs) {
            if (inp.name === wName) {
                if (inp.widget) inp.widget.value = newVal;
                // node.inputs[i].value 可能用于序列化
                Object.defineProperty ? (
                    Object.defineProperty(inp, 'value', { value: newVal, writable: true, configurable: true, enumerable: true })
                ) : (inp.value = newVal);
                break;
            }
        }
    }
    // 全通道激活：任意通道变化均同步 active_value（用于 IS_CHANGED 缓存键）
    syncActiveValue(node);
}


// ── 同步输出端口类型（单通道，始终只有1个输出）───────────────────
function syncOutputPorts(node) {
    if (!node.outputs) return;
    if (node.outputs.length > 1) {
        while (node.outputs.length > 1) node.removeOutput(node.outputs.length - 1);
    }
    if (node.outputs.length === 0) node.addOutput("VALUE", "*");
    node.outputs[0].type = "*";
}


// ── 更新输出端口标签与类型（单通道）──────────────────────────
function updateOutputLabel(node) {
    if (!node.outputs || !node.outputs[0]) return;
    const hidePort = !!node._osHidePortLabel;
    const cfg = node._osConfigs?.[0];
    const chLabel = cfg?.label || "VALUE";
    const typeLabel = (cfg?.type === "INT") ? "INT" : "FLOAT";
    node.outputs[0].name = chLabel + " (" + typeLabel + ")";
    node.outputs[0].label = hidePort ? "\u200B" : chLabel;
    app.graph?.setDirtyCanvas(true, true);
}

// ── 按样式计算 widget 内容区高度（单通道）─────────────────────────
function _calcContentH(node, noMeasure) {
    const gen = node._osContentHGen || 0;
    const cacheKey = '1_' + gen;
    if (node._osContentHCache && node._osContentHCache.key === cacheKey) {
        return node._osContentHCache.height;
    }
    if (noMeasure) return _calcContentHFormula(node);

    const wrap = node._osWrap;
    if (wrap && wrap.isConnected) {
        const s = wrap.style;
        const prev = { h: s.height, mh: s.minHeight, flex: s.flex, as: s.alignSelf };
        s.height = 'auto'; s.minHeight = '0'; s.flex = 'none'; s.alignSelf = 'flex-start';
        const h = wrap.scrollHeight;
        s.height = prev.h; s.minHeight = prev.mh; s.flex = prev.flex; s.alignSelf = prev.as;
        if (h > 10) { const result = h + 6; node._osContentHCache = { key: cacheKey, height: result }; return result; }
    }
    const result = _calcContentHFormula(node);
    node._osContentHCache = { key: cacheKey, height: result };
    return result;
}

function _calcContentHFormula(node) {
    const s = node._osConfigs[0]?.scale ?? 1.0;
    const cfg = node._osConfigs[0];
    const style = cfg?.style || "float";
    let h = 0;
    if (style === "fill") {
        const valFont = 16;
        const textRowH = Math.round(valFont * s * 1.45);
        h += textRowH + Math.max(5 * s, 3) + Math.max(16 * s, 12);
    } else {
        h += Math.max(Math.round(24 * s), 14);
    }
    const padding = 6 + Math.round(4 * 1);
    return h + padding;
}

// ── 键盘无障碍辅助 ─────────────────────────────────────────────────────────
function _addKeyboardAccess(trackWrap, node, cfg, updateDisplay, syncWidget) {
    trackWrap.setAttribute("tabindex", "0");
    trackWrap.setAttribute("role", "slider");
    trackWrap.setAttribute("aria-valuemin", cfg.min);
    trackWrap.setAttribute("aria-valuemax", cfg.max);
    trackWrap.setAttribute("aria-valuenow", cfg.value);
    trackWrap.setAttribute("aria-label", cfg.label || _osT("channel"));

    trackWrap.addEventListener("keydown", (e) => {
        const step = parseFloat(cfg.step) || 0.01;
        let newVal = parseFloat(cfg.value);

        if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            newVal = Math.min(cfg.max, newVal + step);
            e.preventDefault();
            e.stopPropagation();
        } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            newVal = Math.max(cfg.min, newVal - step);
            e.preventDefault();
            e.stopPropagation();
        } else if (e.key === "Home") {
            newVal = cfg.min;
            e.preventDefault();
            e.stopPropagation();
        } else if (e.key === "End") {
            newVal = cfg.max;
            e.preventDefault();
            e.stopPropagation();
        } else {
            return;
        }

        newVal = cfg.type === "INT" ? Math.round(newVal) : parseFloat(newVal.toFixed(8));
        // 键盘调节后若开启定格点位，吸附到最近的点位
        if (cfg.snapEnabled && cfg.snapPoints) {
            const mn = parseFloat(cfg.min) || 0;
            const mx = parseFloat(cfg.max) || 1;
            const validPts = cfg.snapPoints.filter(p => p != null && !isNaN(p) && p >= mn && p <= mx);
            if (validPts.length > 0) {
                let closest = null;
                let closestDist = Infinity;
                for (const sp of validPts) {
                    const d = Math.abs(newVal - sp);
                    if (d < closestDist) { closestDist = d; closest = sp; }
                }
                if (closestDist <= Math.abs(step) * 2) newVal = closest;
            }
        }
        cfg.value = newVal;
        updateDisplay(newVal);
        trackWrap.setAttribute("aria-valuenow", newVal);

        syncWidget();
        app.graph?.setDirtyCanvas(true, true);
        app.graph?.change();
    });

    // 聚焦时更新输出标签（全通道激活，无需切换）
    trackWrap.addEventListener("focus", () => {
        updateOutputLabel(node);
    });
}

// ── 设置面板提交：将 drafts 落库到 node._osConfigs（抽出为模块级函数以减小 openSettingsPanel 体积）──
function _osCommitPanel(node, draft) {
    try {
        let needsRebuild = false;
        const c = node._osConfigs[0];
        if (!c) { needsRebuild = true; } else {
            for (const k of Object.keys(draft)) {
                if (draft[k] !== c[k]) { needsRebuild = true; break; }
            }
        }
        node._osConfigs[0] = draft;
        syncConfigToWidget(node, 0);
        if (needsRebuild) {
            rebuildUI(node);
        }
        const avW = node._osHiddenWidgets?.["active_value"];
        if (avW && node._osConfigs[0]) avW.value = node._osConfigs[0].value;
        app.graph?.setDirtyCanvas(true, true);
        app.graph?.change();
    } catch (e) { console.warn("[WOSAI OmniSlider] commitPanel:", e.message); }
}

// ── 构建单条滑行 DOM 及交互（从 rebuildUI 提取，减小主循环体积）───────────
function _osBuildSliderRow(node, cfg) {
    const row = document.createElement("div");
    row.className = "os-slider-row";

    // ── 轨道区域：根据样式分支构建 DOM ────────────────────────────
    row.setAttribute("data-style", "fill");
    const fillSlot = document.createElement("div");
    fillSlot.className = "os-fill-slot";
    const fillText = document.createElement("div");
    fillText.className = "os-fill-text";
    const fillLabel = document.createElement("span");
    fillLabel.className = "os-fill-text-label";
    fillLabel.textContent = cfg.label || '';
    fillLabel.style.display = 'none';
    if (cfg.labelX || cfg.labelY) fillText.style.transform = `translate(${cfg.labelX||0}px, ${cfg.labelY}px)`;
    const fillVal = document.createElement("span");
    fillVal.className = "os-fill-text-val";
    fillVal.style.color = cfg.textColor || cfg.color;
    fillText.appendChild(fillLabel);
    fillText.appendChild(fillVal);
    const railWrap = document.createElement("div");
    railWrap.className = "os-fill-rail-wrap";
    // 轨道高度：优先使用用户自定义值，否则回退到 CSS 变量
    railWrap.style.setProperty("--ws-os-fill-rail-h", (cfg.trackHeight || 10) + "px");
    const rail = document.createElement("div");
    rail.className = "os-fill-rail";
    rail.style.background = cfg.trackBg || "var(--ws-surface-3)";
    const rf = document.createElement("div");
    rf.className = "os-fill-rf";
    rf.style.background = cfg.trackColor || cfg.color;
    const thumbEl = document.createElement("div");
    thumbEl.className = "os-fill-thumb-el";
    thumbEl.style.background = cfg.thumbColor || cfg.color;
    thumbEl.style.width = cfg.thumbSize + "px";
    thumbEl.style.height = cfg.thumbSize + "px";
    rail.appendChild(rf);
    railWrap.appendChild(rail);
    railWrap.appendChild(thumbEl);
    // 定格点位刻度标记容器
    const snapWrap = document.createElement("div");
    snapWrap.style.cssText = "position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;z-index:2;";
    const snapDots = [];
    for (let i = 0; i < 5; i++) {
        const dot = document.createElement("div");
        dot.style.cssText = "position:absolute;top:50%;width:var(--ws-os-snap-dot-w);border-radius:var(--ws-os-snap-dot-radius);transform:translate(-50%,-50%);transition:background 0.15s,height 0.15s;display:none;";
        snapWrap.appendChild(dot);
        snapDots.push(dot);
    }
    railWrap.appendChild(snapWrap);
    fillSlot.appendChild(fillText);
    fillSlot.appendChild(railWrap);
    const trackWrap = document.createElement("div");
    trackWrap.className = "os-track-wrap";
    trackWrap.setAttribute("data-style", "fill");
    trackWrap.appendChild(fillSlot);
    row.appendChild(trackWrap);
    const dragEl = fillSlot;
    const posEl = railWrap;
    const stepDecimals = Math.max(0, Math.ceil(-Math.log10(cfg.step || 0.01)));
    const updateDisplay = (val) => {
        const mn = parseFloat(cfg.min) || 0;
        const mx = parseFloat(cfg.max) || 1;
        const pct = mx !== mn ? Math.max(0, Math.min(1, (val - mn) / (mx - mn))) : 0;
        const pct100 = (pct * 100) + "%";
        rf.style.width = pct100;
        rf.setAttribute("data-full", pct >= 0.995 ? "1" : "0");
        thumbEl.style.left = pct100;
        const disp = cfg.type === "INT" ? String(Math.round(val)) : val.toFixed(stepDecimals);
        fillVal.textContent = disp;
        fillLabel.textContent = cfg.label || '';
        // 更新定格刻度线位置、颜色、高度与宽度
        // 刻度线高度与滑条轨道等高，宽度随轨道变细而等比缩小（最细 1px）
        const pts = cfg.snapPoints || [];
        const snapColor = cfg.snapColor || "color-mix(in srgb, var(--ws-text-muted) 30%, transparent)";
        const tickH = cfg.thumbSize || 18;
        const tickW = Math.min(1.5, Math.max(1, tickH * 0.5));
        snapDots.forEach((dot, i) => {
            const sp = pts[i];
            if (cfg.snapEnabled && sp != null && !isNaN(sp) && sp >= mn && sp <= mx) {
                dot.style.display = "block";
                const spPct = mx !== mn ? Math.max(0, Math.min(1, (sp - mn) / (mx - mn))) : 0;
                dot.style.left = (spPct * 100) + "%";
                dot.style.background = snapColor;
                dot.style.height = tickH + "px";
                dot.style.width = tickW + "px";
            } else {
                dot.style.display = "none";
            }
        });
    };

    // 初始渲染
    updateDisplay(parseFloat(cfg.value) || parseFloat(cfg.min) || 0);

    // ── 拖动交互 ──
    let dragging = false;
    let _dragDirty = false;
    let _pressed = false;
    let _pressX = 0;
    const DRAG_THRESH = 4;

    const valFromX = (clientX) => {
        const rect = posEl.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const mn = parseFloat(cfg.min) || 0;
        const mx = parseFloat(cfg.max) || 1;
        const st = parseFloat(cfg.step) || 0.01;
        let raw = mn + pct * (mx - mn);
        // 定格点位吸附：在 10px 范围内吸附到最近的自定义点位
        if (cfg.snapEnabled && cfg.snapPoints) {
            const validPts = cfg.snapPoints.filter(p => p != null && !isNaN(p) && p >= mn && p <= mx);
            if (validPts.length > 0 && rect.width > 0) {
                let closest = null;
                let closestPx = Infinity;
                for (const sp of validPts) {
                    const spPct = mx !== mn ? (sp - mn) / (mx - mn) : 0;
                    const spX = rect.left + spPct * rect.width;
                    const pxDist = Math.abs(clientX - spX);
                    if (pxDist < closestPx) { closestPx = pxDist; closest = sp; }
                }
                if (closestPx <= 10) raw = closest;
            }
        }
        raw = Math.round((raw - mn) / st) * st + mn;
        raw = Math.max(mn, Math.min(mx, raw));
        return cfg.type === "INT" ? Math.round(raw) : parseFloat(raw.toFixed(8));
    };

    const _applyVal = (clientX) => {
        const newVal = valFromX(clientX);
        if (newVal === cfg.value) return;
        cfg.value = newVal;
        updateDisplay(newVal);
        const _avW = node._osHiddenWidgets?.["active_value"];
        if (_avW) _avW.value = cfg.type === "INT" ? Math.round(newVal) : newVal;
    };

    const syncWidget = () => { syncConfigToWidget(node, 0); };

    dragEl.addEventListener("pointerdown", e => {
        if (e.button !== 0) return;
        e.preventDefault();
        _pressed = true;
        _pressX = e.clientX;
        dragEl.setPointerCapture(e.pointerId);
        if (!node._osHideTitle) {
            dragging = true;
            dragEl.closest(".os-track-wrap")?.classList.add("dragging");
            _applyVal(e.clientX);
            _dragDirty = true;
            syncWidget();
            app.graph?.change();
        }
    });

    dragEl.addEventListener("pointermove", e => {
        if (!_pressed) return;
        if (!dragging) {
            if (Math.abs(e.clientX - _pressX) < DRAG_THRESH) return;
            dragging = true;
            dragEl.closest(".os-track-wrap")?.classList.add("dragging");
        }
        const _before = cfg.value;
        _applyVal(e.clientX);
        if (cfg.value !== _before) {
            _dragDirty = true;
            app.graph?.setDirtyCanvas(true, true);
        }
    });

    const _endDrag = () => {
        _pressed = false;
        dragging = false;
        dragEl.closest(".os-track-wrap")?.classList.remove("dragging");
        if (_dragDirty) { syncWidget(); _dragDirty = false; }
        app.graph?.setDirtyCanvas(true, true);
        app.graph?.change();
    };
    dragEl.addEventListener("pointerup", _endDrag);
    dragEl.addEventListener("pointercancel", _endDrag);

    // ── 滚轮调节 ──
    dragEl.addEventListener("wheel", e => {
        e.preventDefault();
        e.stopPropagation();
        const mn = parseFloat(cfg.min) || 0;
        const mx = parseFloat(cfg.max) || 1;
        const st = parseFloat(cfg.step) || (cfg.type === "INT" ? 1 : 0.01);
        const dir = e.deltaY < 0 ? 1 : -1;
        let v = (parseFloat(cfg.value) || 0) + dir * st;
        v = Math.max(mn, Math.min(mx, v));
        v = cfg.type === "INT" ? Math.round(v) : parseFloat(v.toFixed(8));
        // 滚轮后若开启定格点位，吸附到最近的点位
        if (cfg.snapEnabled && cfg.snapPoints) {
            const validPts = cfg.snapPoints.filter(p => p != null && !isNaN(p) && p >= mn && p <= mx);
            if (validPts.length > 0) {
                let closest = null;
                let closestDist = Infinity;
                for (const sp of validPts) {
                    const d = Math.abs(v - sp);
                    if (d < closestDist) { closestDist = d; closest = sp; }
                }
                if (closestDist <= Math.abs(st) * 2) v = closest;
            }
        }
        if (v !== cfg.value) {
            cfg.value = v;
            updateDisplay(v);
            const _avW = node._osHiddenWidgets?.["active_value"];
            if (_avW) _avW.value = cfg.type === "INT" ? Math.round(v) : v;
            syncWidget();
            app.graph?.setDirtyCanvas(true, true);
            app.graph?.change();
        }
    }, { passive: false });

    // ── 键盘无障碍 ──
    if (cfg.style !== "fill") {
        const tw = row.querySelector(".os-track-wrap");
        if (tw) _addKeyboardAccess(tw, node, cfg, updateDisplay, syncWidget);
    } else {
        const tw = row.querySelector(".os-track-wrap[data-style='fill']");
        if (tw) _addKeyboardAccess(tw, node, cfg, updateDisplay, syncWidget);
    }

    // ── 右键打开该通道的设置面板（直接绑在行上，不依赖冒泡到 wrap）──
    row.addEventListener("contextmenu", e => {
        e.preventDefault();
        e.stopPropagation();
        const activeTw = row.querySelector(".os-track-wrap.dragging");
        if (activeTw) activeTw.classList.remove("dragging");
        try {
            openSettingsPanel(node, 0, () => rebuildUI(node));
        } catch (err) {
            console.error("[WOSAI OmniSlider] openSettingsPanel failed:", err.message, err.stack);
        }
    });

    return row;
}

// ── 重建整个 UI（所有通道垂直堆叠，按钮列独立保证对齐）──────────────────
function rebuildUI(node) {
    if (!node._osWrap) return;
    // 防重入：commitPanel→rebuildUI 链中，若用户连续快速右键，上一个 rebuildUI 未完成时
    // 下一个 commitPanel 又触发 rebuildUI → wrap.innerHTML="" 清空正在构建的 DOM → 崩溃。
    if (node._osRebuilding) { console.warn("[OmniSlider] rebuildUI re-entered, skipping"); return; }
    node._osRebuilding = true;
    try {
        const wrap = node._osWrap;
    // 从配置恢复缩放比例
    const scale = node._osConfigs[0]?.scale ?? 1.0;
    wrap.style.setProperty("--os-scale", scale);
    wrap.innerHTML = "";

    const cfg = node._osConfigs[0] || Object.assign(defaultCfg(1));
    wrap.appendChild(_osBuildSliderRow(node, cfg));

    // ⚡ 增量内容高世代号，下次 _calcContentH 会重新测量（不命中旧缓存）
    node._osContentHGen = (node._osContentHGen || 0) + 1;
    try {
        syncOutputPorts(node);   // 先收紧端口数，再算高度
        updateSize(node);
        updateOutputLabel(node);
        refreshActiveState(node);
    } catch (e) {
        console.error("[WOSAI OmniSlider] rebuildUI post-render error:", e.message, e.stack);
    }
    // 强制下一帧重绘 canvas，消除高度变化视觉延迟
    requestAnimationFrame(() => app.graph?.setDirtyCanvas(true, true));
    } finally {
        node._osRebuilding = false;  // 防重入锁释放（无论 try 中是否抛异常）
    }
}

function updateSize(node) {
    if (!node.size) node.size = [340, 100];
    if (node.flags?.collapsed) return;   // 折叠时不调整尺寸，避免覆盖 LiteGraph 折叠高度
    if (node.size[0] < 220) node.size[0] = 220;
    // 直接用 _calcContentH，不走 computeSize：
    // computeSize 在 Nodes 2.0 里依赖 DOM 实测高度，
    // 而 rebuildUI 刚重建完 DOM、浏览器尚未 reflow，测量结果为旧值或 0。
    const newH = _calcContentH(node);
    // ⚠ 禁止直接写 Vue 容器的 style.height —— Nodes 2.0 由 Vue 自行管理布局，
    // 强写会与 Vue 布局冲突导致整体 UI 错乱（已踩坑）。高度只走 node.setSize。
    //
    // 目标内容高未变：什么都不做（锁定/配色/类型等操作高度不变）。
    // 不能直接拿 node.size[1] 与 newH 比——Classic 模式下 node.size[1] 是
    // 节点总高（含输出槽区），与内容高口径不同，会导致跳过判定永远失效。
    if (node._osLastH !== undefined && Math.abs(node._osLastH - newH) < 0.5) return;
    node._osLastH = newH;
    // 口径分流：Nodes 2.0 直接用内容高；Classic 用 computeSize 得到正确总高
    // （computeSize 会经由 DOM widget 的 getMinHeight 取到 _calcContentH，
    //  直接 setSize(内容高) 会把节点压扁再被 LiteGraph 撑回，形成拉锯抖动）
    // ⚡ Vue 检测懒缓存：首次调用后缓存，后续不再 querySelector
    if (node._osIsVue === undefined) node._osIsVue = !!document.querySelector(`[data-node-id="${node.id}"]`);
    const isVue = node._osIsVue;
    const targetH = (!isVue && typeof node.computeSize === "function") ? node.computeSize()[1] : newH;
    if (Math.abs(node.size[1] - targetH) >= 0.5) {
        node.size[1] = targetH;
        if (typeof node.setSize === "function") {
            node.setSize([node.size[0], targetH]);
            node.onResize?.(node.size);
        }
        app.graph?.setDirtyCanvas(true, true);
    }
    // 下一帧复确认（Vue 异步重渲可能覆盖 size）
    // ⚡ 取消上一帧未执行的 RAF，防止快速重建时堆积
    if (node._osSizeRAF) cancelAnimationFrame(node._osSizeRAF);
    node._osSizeRAF = requestAnimationFrame(() => {
        node._osSizeRAF = null;
        if (!node.size || !node._osWrap?.isConnected) return;
        if (Math.abs(node.size[1] - targetH) < 0.5) return;
        node.size[1] = targetH;
        if (typeof node.setSize === "function") node.setSize([node.size[0], targetH]);
        app.graph?.setDirtyCanvas(true, true);
        if (typeof app.graph?.onNodeResized === "function") app.graph.onNodeResized(node);
    });
}

// ── 刷新激活通道视觉指示（全通道同时激活，各自使用独立颜色）───────────
function refreshActiveState(node) {
    if (!node._osWrap) return;
    const wraps = node._osWrap.querySelectorAll(".os-track-wrap");
    wraps.forEach((wrap, i) => {
        wrap.classList.add("active");
        wrap.classList.remove("dim");
        if (node._osConfigs[i]) {
            wrap.style.setProperty("--os-active-color", node._osConfigs[i].color || "var(--ws-accent)");
        }
    });
}

// ── 节点初始化 ─────────────────────────────────────────────────────────────
function buildUI(node) {
    // CSS 已通过 extension.json 加载

    // ⚠ 防累积泄漏：buildUI 每次重建都会新建 _hiddenObserver(MutationObserver)/_widthObserver(ResizeObserver)
    //   + _osTimers。原仅在 node.onRemoved 断开 → 每次重建(含每次开设置面板触发的 rebuildUI)都多挂一组观察器，
    //   多次后 N 个 observer 同时监听节点子树、每次 DOM 变动跑 N 份回调 → 渐进卡顿直至假死。
    //   故此处在重建前先断开上一轮的观察器与定时器。
    if (node._osHiddenObserver) { try { node._osHiddenObserver.disconnect(); } catch (_) {} node._osHiddenObserver = null; }
    if (node._osWidthObserver) { try { node._osWidthObserver.disconnect(); } catch (_) {} node._osWidthObserver = null; }
    if (node._osTimers) { node._osTimers.forEach(t => clearTimeout(t)); node._osTimers = []; }

    // 注入节点元信息（cnr_id + ver），对齐 ComfyUI 内置节点属性面板格式
    // ComfyUI-Manager 无法从 python_module ("nodes.slider.omni_slider") 识别本节点所属包
    node.properties = node.properties || {};
    if (!node.properties.cnr_id) node.properties.cnr_id = "custom-nodes/WOSAI-ComfyUI";
    if (!node.properties.ver) node.properties.ver = "1.0";
    delete node.properties.aux_id;

    // 初始化状态
    node._osConfigs = [];
    node._osChannelCount = 1;
    node._osActiveChannel = 0;
    node._osHiddenWidgets = {};

    // ⚡ 关键：不 splice widget，只隐藏 DOM 元素
    // ComfyUI 依赖 node.widgets 数组索引来序列化 widgets_values
    // 如果 splice 掉 hidden widget，索引会错乱，导致后端收不到值
    // ═══ 隐藏工具：使用 nodes2-hide.js 模块（支持 Classic + Nodes 2.0 双模式）═══
    const _doHideWidget = (w) => {
        ghostWidget(w);
        const el = w.element || w.dom;
        if (el) {
            hideEl(el, true);
            hideWidgetRow(el, node.element || node.dom);
        }
    };

    // ═══ 确保 node.widgets 是数组（ComfyUI v10 可能不是数组）══════════
    if (!Array.isArray(node.widgets)) node.widgets = [];

    if (node.widgets) {
        for (const w of node.widgets) {
            if (w.name === "active_value") {
                node._osHiddenWidgets["active_value"] = w;
                _doHideWidget(w);
            } else if (w.name === "channel_count") {
                node._osChannelCount = Math.max(1, Math.min(1, parseInt(w.value) || 1));
                node._osHiddenWidgets["channel_count"] = w;
                _doHideWidget(w);
            } else if (w.name === "active_channel") {
                // 保留隐藏 widget 用于序列化兼容，全通道激活模式下不再依赖此值
                node._osHiddenWidgets["active_channel"] = w;
                _doHideWidget(w);
            } else if (w.name && /^ch\d+_cfg$/.test(w.name)) {
                const idx = parseInt(w.name.match(/^ch(\d+)_cfg$/)[1]) - 1;
                node._osConfigs[idx] = Object.assign(defaultCfg(1), parseCfg(w.value));
                node._osHiddenWidgets[w.name] = w;
                _doHideWidget(w);
            }
        }
    }
    // 确保所有通道都有默认配置
    for (let i = 0; i < 1; i++) {
        if (!node._osConfigs[i]) node._osConfigs[i] = defaultCfg(1);
    }

    // ═══ ComfyUI v10 代理 widget 工厂：主动创建所有缺失的 widget ───────
    // 关键：hidden 输入在 v10 中可能既不在 node.widgets 也不在 node.inputs，
    // 我们必须主动创建并注入到 node.widgets（序列化遍历此数组）。
    const _ensureProxy = (name, value, type) => {
        if (node._osHiddenWidgets[name]) return; // 已有
        const exists = node.widgets.find(w => w.name === name);
        if (exists) {
            node._osHiddenWidgets[name] = exists;
            return;
        }
        const proxy = {
            name, type: type || "STRING", value,
            hidden: true, options: { serialize: true },
            callback: function(v) { if (v !== undefined) this.value = v; },
            // GJJ 标准藏参五件套
            computeSize: () => [0, 0],
            getHeight: () => 0,
            draw: () => {},
            label: "",
            last_y: 0,
            computedHeight: 0,
            margin_top: 0,
            size: [0, 0],
            // v10 布局引擎专用：行高归零，防止代理 widget 占据空白行
            computeLayoutSize: () => ({ minHeight: 0, maxHeight: 0, height: 0, minWidth: 0 }),
            inputEl: null,
        };
        node.widgets.push(proxy);
        node._osHiddenWidgets[name] = proxy;
    };

    // 主动创建所有必须的 hidden widget
    _ensureProxy("channel_count", node._osChannelCount, "INT");
    _ensureProxy("active_channel", 0, "INT");
    for (let i = 0; i < 1; i++) {
        _ensureProxy("ch" + (i + 1) + "_cfg", serializeCfg(node._osConfigs[i]), "STRING");
    }
    // active_value 若已存在则跳过（已在 node.widgets 扫描中捕获）
    if (!node._osHiddenWidgets["active_value"]) {
        _ensureProxy("active_value", 0.0, "FLOAT");
    }
    // 强制覆盖 tooltip（Python 端更新后旧 DOM / 缓存可能仍持旧值）
    _forceActiveValueTooltip(node);

    // ── DOM 容器 ─────────────────────────────────────────────────────────
    const wrap = document.createElement("div");
    wrap.className = "os-wrap";
    wrap.setAttribute("data-theme", getTheme());
    wrap.setAttribute("translate", "no");
    node._osWrap = wrap;

    rebuildUI(node);
    // 确保输出端口数与 channel_count 匹配（rebuildUI 末尾也会调，这里兜底）
    syncOutputPorts(node);
    // 将前端初始配置同步回隐藏 widget（确保拖拽前已有正确 widget.value）
    for (let i = 0; i < node._osChannelCount; i++) syncConfigToWidget(node, i);
    // 初始输出端口标签对齐激活通道类型
    node._osTimers = node._osTimers || [];
    node._osTimers.push(setTimeout(() => {
        if (!node || node.is_removed || !node.graph) return;
        updateOutputLabel(node);
    }, 80));

    const MIN_WIDTH = 220;
    node.addDOMWidget("os_ui", "os_panel", wrap, {
        // ⚡ noMeasure=true：getMinHeight 每帧被调，绝不读 scrollHeight 触发 reflow；
        //   命中缓存(updateSize 已测)返精确值，未命中走公式 —— 消除「重新计算样式」热点。
        getMinHeight: () => _calcContentH(node, true),
        getMinWidth: () => MIN_WIDTH,
        forceWidget: true,
    });
    // 移除 ComfyUI widget 外层容器的默认底部分割线（延迟 + 重试确保 DOM 就绪）
    const _removeDivider = () => {
        let el = wrap.parentElement;
        let removed = false;
        while (el && el !== node.element) {
            const bb = getComputedStyle(el).borderBottomWidth;
            if (bb && bb !== "0px") {
                el.style.setProperty("border-bottom", "none", "important");
                removed = true;
            }
            el = el.parentElement;
        }
        return removed;
    };
    retryUntil(_removeDivider, 6);

    // ── Nodes 2.0 兼容：使用 nodes2-hide.js 模块隐藏内部 widget ────────────
    const HIDDEN_WIDGET_NAMES = ["active_value", "channel_count", "active_channel",
        ...Array.from({ length: 6 }, (_, i) => `ch${i + 1}_cfg`)];

    injectGlobalHideCSS(HIDDEN_WIDGET_NAMES, "wosai-os-hide-av-global");

    const _hideMgr = createHiddenObserver(node, node._osHiddenWidgets, {
        onCollapsed: () => updateSize(node),
        updateSize: () => updateSize(node)
    });
    node._osHiddenObserver = _hideMgr.observer;
    _hideMgr.start();

    // 节点销毁时清理
    const _origOnRemoved = (() => {
        const f = node.onRemoved;
        return typeof f === 'function' ? f : null;
    })();
    node.onRemoved = function () {
        if (node._osHiddenObserver) { try { node._osHiddenObserver.disconnect(); } catch (_) {} node._osHiddenObserver = null; }
        if (node._osWidthObserver) { try { node._osWidthObserver.disconnect(); } catch (_) {} node._osWidthObserver = null; }
        if (node._osTimers) { node._osTimers.forEach(t => clearTimeout(t)); node._osTimers = []; }
        node._osWrap = null;
        if (_origOnRemoved) _origOnRemoved.call(this);
    };

    // ── 动态对齐：测量 wrap 右边缘与节点右边界的实际差值，精确设置 margin ──
    const _calibrate = () => {
        if (!node._osWrap || !node.pos || !node.size) return false;
        const canvas = app.canvas;
        if (!canvas?.canvas) return false;
        const cR = canvas.canvas.getBoundingClientRect();
        const sc = canvas.ds?.scale || 1;
        const off = canvas.ds?.offset || [0, 0];
        // 节点右边界在 CSS 像素中的位置
        const nodeRightCss = cR.left + (node.pos[0] + node.size[0] + off[0]) * sc;
        const wrapRect = node._osWrap.getBoundingClientRect();
        if (wrapRect.width === 0) return false; // 还未渲染
        // 解除父容器可能的 overflow 裁剪
        let p = node._osWrap.parentElement;
        while (p && p !== document.body) {
            const cs = getComputedStyle(p);
            if (cs.overflow === 'hidden' || cs.overflowX === 'hidden') {
                p.style.overflow = 'visible';
            }
            p = p.parentElement;
        }
        // gap = 需要额外向右延伸的 CSS 像素（留 2px 内边距）
        const gap = nodeRightCss - wrapRect.right - 2;
        if (Math.abs(gap) > 1) {
            node._osWrap.style.marginRight = (gap > 0 ? `-${gap}` : `${-gap}`) + 'px';
        }
        return true;
    };
    retryUntil(_calibrate, 10);

    const _origOnResize = node.onResize;
    node.onResize = function(size) {
        if (size[0] < MIN_WIDTH) size[0] = MIN_WIDTH;
        _origOnResize?.apply(this, arguments);
    };

    // 宽度同步
    let _lastW = node.size?.[0];
    // ResizeObserver 替代 setInterval：事件驱动，页面不可见时自动暂停，更高效
    const _widthObserver = (typeof ResizeObserver !== 'undefined')
        ? new ResizeObserver(() => {
              if (!node.size) return;
              const cw = node.size[0];
              if (cw !== _lastW) {
                  _lastW = cw;
                  wrap.style.maxWidth = cw + "px";
              }
          })
        : null;
    if (_widthObserver) _widthObserver.observe(wrap);
    node._osWidthObserver = _widthObserver;

    // ── channel_count callback hook ─────────────────────────────────────
    const ccW = node._osHiddenWidgets?.["channel_count"];
    if (ccW) {
        const _origCb = ccW.callback;
        ccW.callback = function(v) {
            _origCb?.apply(this, arguments);
            node._osChannelCount = Math.max(1, Math.min(1, parseInt(v) || 1));
            rebuildUI(node);
            app.graph?.setDirtyCanvas(true, true);
        };
    }

    // ── 序列化 ───────────────────────────────────────────────────────────
    // 不需要手动写 onSerialize！
    // ComfyUI 会自动序列化 node.widgets 数组中所有 widget 的 .value
    // 我们只需要确保 widget.value 是最新的
    // 在 syncConfigToWidget() 中已经更新了 w.value，所以序列化是正确的

    // ── configure（加载 workflow JSON 时调用）─────────────────────────
    const _origOnConfigure = node.onConfigure;
    node.onConfigure = function(info) {
        _origOnConfigure?.apply(this, arguments);
        // 强制更新 active_value tooltip（旧 workflow 可能携带旧值）
        _forceActiveValueTooltip(this);
        // 从 _osHiddenWidgets 读取（proxy widget 已被 _origOnConfigure 写回 workflow 值）
        const ccW = this._osHiddenWidgets?.["channel_count"];
        if (ccW) this._osChannelCount = Math.max(1, Math.min(1, parseInt(ccW.value) || 1));
        for (let i = 0; i < 1; i++) {
            const cw = this._osHiddenWidgets?.[`ch${i + 1}_cfg`];
            if (cw) this._osConfigs[i] = Object.assign(defaultCfg(1), parseCfg(cw.value));
        }
        // 恢复精简显示三项标志（持久化在 properties）→ 应用
        const p = this.properties || {};
        this._osHideTitle = !!p.osHideTitle;
        this._osHideBadge = !!p.osHideBadge;
        this._osHidePortLabel = !!p.osHidePortLabel;
        rebuildUI(this);
        syncOutputPorts(this); // 兜底：确保端口数与 channel_count 匹配
        syncActiveValue(this); // 恢复 active_value
        if (this._osHideTitle || this._osHideBadge || this._osHidePortLabel) {
            applyNodeDisplay(this, syncOutputPorts, updateOutputLabel);
        }
        node._osTimers = node._osTimers || [];
        node._osTimers.push(setTimeout(() => {
            if (!this || this.is_removed || !this.graph) return;
            updateOutputLabel(this);
        }, 80));
    };

    // ── 清理（已合并到上方 nuke 清理块中，此处不再重复覆写）──────────────
}

export { openSettingsPanel, rebuildUI };

// ── 注册 ──────────────────────────────────────────────────────────────────
const OMNISLIDER_NODE_TYPE = "WOSAI_OmniSlider";
const OMNISLIDER_PATCH_KEY = "__wosaiOmniSliderPatch";
let omniSliderNodeType = null;

function _openSliderSettings(node) {
    if (!node || node.is_removed || !node.graph) return;
    try {
        openSettingsPanel(node, 0, () => rebuildUI(node));
    } catch (err) {
        console.error("[WOSAI OmniSlider] openSettingsPanel failed:", err.message, err.stack);
    }
}

app.registerExtension({
    name: "WOSAI.OmniSlider",

    settings: [],

    commands: [{
        id: "wosai-omnislider-open",
        label: t('widgets.omniSlider.commandLabel'),
        function: () => {
            const sel = app.graph?.selected_nodes || app.graph?._nodes?.filter(n => n.selected);
            if (!sel) return;
            // 优先用 selected_nodes（LiteGraph 选中集合）
            const nodes = sel instanceof Map ? [...sel.values()] : sel;
            const osNode = nodes.find(n => n.type === OMNISLIDER_NODE_TYPE);
            if (osNode) _openSliderSettings(osNode);
        },
    }],

    keybindings: [{
        commandId: "wosai-omnislider-open",
        combo: { key: "F4" },
    }],

    setup() {
        const _loadCSS = (id, href) => {
            if (!document.getElementById(id)) {
                const link = document.createElement("link");
                link.id = id;
                link.rel = "stylesheet";
                link.href = href;
                document.head.appendChild(link);
            }
        };
        _loadCSS("wosai-os-slider-css", new URL("./styles/os-slider.css", import.meta.url).href);
        _loadCSS("wosai-os-slider-panel-css", new URL("./styles/os-slider-panel.css", import.meta.url).href);
        _loadCSS("wosai-os-slider-hide-css", new URL("./styles/os-slider-hide.css", import.meta.url).href);
    },

    async remove() {
        // 关闭当前打开的设置面板
        if (_osActivePanel && typeof _osActivePanel._cleanup === 'function') {
            try { _osActivePanel._cleanup(); } catch (e) { console.warn("[WOSAI OmniSlider] remove cleanup panel:", e); }
        }
        _osActivePanel = null;

        // 移除全局 Esc / 面板外点击监听器
        if (_osGlobalHandlersInstalled) {
            if (_osGlobalKeydownHandler) document.removeEventListener("keydown", _osGlobalKeydownHandler);
            if (_osGlobalPointerdownHandler) document.removeEventListener("pointerdown", _osGlobalPointerdownHandler, { capture: true });
            _osGlobalHandlersInstalled = false;
            _osGlobalKeydownHandler = null;
            _osGlobalPointerdownHandler = null;
        }

        // 清理所有 OmniSlider 节点的 observer / timer / wrap 引用
        const graph = app.graph;
        if (graph?._nodes || graph?.nodes) {
            const nodes = graph._nodes || graph.nodes;
            for (const node of nodes) {
                if (node?.type === "WOSAI_OmniSlider") {
                    if (node._osHiddenObserver) { try { node._osHiddenObserver.disconnect(); } catch (_) {} node._osHiddenObserver = null; }
                    if (node._osWidthObserver) { try { node._osWidthObserver.disconnect(); } catch (_) {} node._osWidthObserver = null; }
                    if (node._osTimers) { node._osTimers.forEach(t => clearTimeout(t)); node._osTimers = []; }
                    node._osWrap = null;

                    // 恢复显示 / 颜色 / 角标等
                    node._osHideTitle = false;
                    node._osHideBadge = false;
                    node._osHidePortLabel = false;
                    if (node._osOrigColor !== undefined) {
                        node.color = node._osOrigColor;
                        node.bgcolor = node._osOrigBgColor;
                        delete node._osOrigColor;
                        delete node._osOrigBgColor;
                    }
                    if (node._osOrigTitleMode !== undefined) {
                        node.title_mode = node._osOrigTitleMode;
                        delete node._osOrigTitleMode;
                    }
                    if (node._osOrigBadges !== undefined) {
                        node.badges = node._osOrigBadges;
                        delete node._osOrigBadges;
                    }
                    try { updateOutputLabel(node); } catch (_) { /* 节点可能已部分销毁，尽力而为 */ }
                    const instancePatch = node.__wosaiOmniInstancePatch;
                    if (instancePatch) {
                        if (node.onConnectOutput === instancePatch.connectOutput) {
                            node.onConnectOutput = instancePatch.originalConnectOutput;
                        }
                        if (node.onConnectionsChange === instancePatch.connectionsChange) {
                            node.onConnectionsChange = instancePatch.originalConnectionsChange;
                        }
                        delete node.__wosaiOmniInstancePatch;
                    }
                }
            }
            app.graph?.setDirtyCanvas(true, true);
        }

        // 移除全局隐藏 widget CSS
        const hideStyle = document.getElementById("wosai-os-hide-av-global");
        if (hideStyle) hideStyle.remove();

        // 移除本扩展加载的 CSS link
        ["wosai-os-slider-css", "wosai-os-slider-panel-css", "wosai-os-slider-hide-css"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });

        // 清理可能遗留的动态 range style
        document.querySelectorAll('style[id^="os-anchor-range-style-"]').forEach(el => el.remove());

        const proto = omniSliderNodeType?.prototype;
        const patch = proto?.[OMNISLIDER_PATCH_KEY];
        if (patch) {
            if (proto.onNodeCreated === patch.patchedCreated) proto.onNodeCreated = patch.originalCreated;
            delete proto[OMNISLIDER_PATCH_KEY];
        }
        omniSliderNodeType = null;
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name?.startsWith("WOSAI_")) applyNodeDefTranslation(nodeData);
        if (nodeData.name !== "WOSAI_OmniSlider") return;
        if (nodeType.prototype[OMNISLIDER_PATCH_KEY]) {
            omniSliderNodeType = nodeType;
            return;
        }

        const _origCreate = nodeType.prototype.onNodeCreated;
        const patchedCreated = function() {
            _origCreate?.apply(this, arguments);
            this._osConfigs = [];
            this._osChannelCount = 1;
            this._osActiveChannel = 0;
            const originalConnectOutput = this.onConnectOutput;
            const originalConnectionsChange = this.onConnectionsChange;
            // ── 输出连接自适应类型 ────────────────────────────────────────
        this.onConnectOutput = function(slotIndex, targetNode, targetSlot) {
            // 只处理匹配的输出 slot
            if (slotIndex < 0 || slotIndex >= 1) return;
            const cfg = this._osConfigs?.[slotIndex];
            if (!cfg) return;
            const targetInput = targetNode?.inputs?.[targetSlot];
            if (!targetInput) return;

            const inputName = targetInput.label || targetInput.name || "";
            const inputType = targetInput.type || "";

            cfg.type = (inputType === "INT" || inputType === "INT64") ? "INT" : "FLOAT";
            if (inputName) cfg.label = inputName;

            syncConfigToWidget(this, slotIndex);
            syncOutputPorts(this);
            updateOutputLabel(this);

            if (this._osWrap) {
                const els = this._osWrap.querySelectorAll(".os-label-area, .os-fill-text-label");
                if (els[slotIndex]) els[slotIndex].textContent = cfg.label;
            }
            app.graph?.setDirtyCanvas(true, true);
        };
        // 备用：尝试 onConnectionsChange（Nodes 2.0 可能用此回调）
        this._osOldOnConn = this.onConnectionsChange;
        this.onConnectionsChange = function(type, slotIndex, isConnected, linkInfo) {
            if (typeof this._osOldOnConn === "function") this._osOldOnConn.apply(this, arguments);
            if (type !== 2 || !isConnected) return;
            if (slotIndex < 0 || slotIndex >= 1) return;
            const cfg = this._osConfigs?.[slotIndex];
            if (!cfg) return;
            // 延迟一帧，等链路完全注册
            requestAnimationFrame(() => {
                const outSlot = this.outputs?.[slotIndex];
                const ourLinkId = outSlot?.links?.[0];
                if (!ourLinkId) return;
                // 通过 linkInfo 或 graph.links 找目标
                const lnk = (typeof linkInfo === "object" && linkInfo?.target_id != null)
                    ? linkInfo : app.graph?.links?.[ourLinkId];
                if (lnk) {
                    const tn = app.graph?.getNodeById(lnk.target_id || lnk.targetId);
                    const ti = tn?.inputs?.[lnk.target_slot || lnk.targetSlot];
                    if (ti) {
                        this.onConnectOutput(slotIndex, tn, lnk.target_slot || lnk.targetSlot);
                    }
                }
            });
        };
        this.__wosaiOmniInstancePatch = {
            originalConnectOutput,
            originalConnectionsChange,
            connectOutput: this.onConnectOutput,
            connectionsChange: this.onConnectionsChange,
        };

        try {
            buildUI(this);
        } catch (err) {
            console.error("[WOSAI OmniSlider ERROR]", err.message, err.stack);
            throw err;
        }
        };
        nodeType.prototype.onNodeCreated = patchedCreated;
        nodeType.prototype[OMNISLIDER_PATCH_KEY] = {
            originalCreated: _origCreate,
            patchedCreated,
        };
        omniSliderNodeType = nodeType;
    },

});
