/* WOSAI OmniSlider v1.0 | 作者：穿山阅海 | COPYRIGHT © WOSAI STUDIO */
/**
 * WOSAI OmniSlider — 万能滑条前端 (CSS已提取至 web/css/os-slider.css)
 */
import { app } from "../../../scripts/app.js";
import { WS_ICONS, retryUntil } from "./lib/shared-utils.js";
import { getGlassTheme, getGlassMode, cycleGlassMode, onGlassChange, GLASS_MODE_DEFS } from "./lib/glass-theme.js";
import { showTip as osShowDotTip, hideTip as osHideDotTip } from "./lib/tooltip.js";
import { _osRefreshDOMHide, applyNodeDisplay } from "./lib/omni-hide.js";
import { hideEl, hideWidgetRow, ghostWidget, injectGlobalHideCSS, createHiddenObserver } from "./lib/nodes2-hide.js";

const SETTING_MAX_CH = 'WOSAI.OmniSlider.MaxChannels';
function getMaxChannels() {
    try {
        const v = app.ui?.settings?.getSettingValue?.(SETTING_MAX_CH);
        if (v !== undefined && v !== null) return Math.max(1, Math.min(6, parseInt(v) || 5));
    } catch (e) {}
    return 5;
}

// ═══ 节点精简显示控制（三项独立，持久化在 node.properties）══════════════════
//   osHideTitle / osHideBadge / osHidePortLabel —— LiteGraph 自动序列化。
//   画布层隐藏（标题/角标）统一由 node-color.js 的 drawNodeShape wrapper 执行，
//   omni-slider 不再单独 hook 画布方法（避免双钩子冲突）。

// CSS 已迁移至 web/css/os-slider.css，通过 extension.json 加载

// ── 辅助 ────────────────────────────────────────────────────────────────────
const COLORS = ["#3498DB","#27AE60","#9B59B6","#E74C3C","#F39C12","#E91E63","#DD6F4A","#1ABC9C","#3498DB","#F1C40F"];

// 设置面板预设色板（含 🎲 随机源）
const OS_PRESET_COLORS = ["#3498DB","#27AE60","#9B59B6","#E74C3C","#F39C12","#E91E63","#DD6F4A","#1ABC9C"];

// 填充滑条自定义参数常量（模块级，避免每次 openSettingsPanel 重复分配）
const FILL_TAB_KEYS = ["trackColor", "trackBg", "thumbColor", "textColor"];
const FILL_TAB_LABELS = { trackColor: "左侧颜色", trackBg: "右侧颜色", thumbColor: "按钮颜色", textColor: "数字颜色" };
const FILL_TAB_DEFAULTS = { trackColor: "", trackBg: "#2A2A2E", thumbColor: "", textColor: "#E4E4E7" };

// 注意：默认值须与 wosai_core/config.py::default_omni_config() 保持一致
function defaultCfg(i) {
    return {
        label: "", type: "FLOAT", min: 0, max: 1, step: 0.01, value: 0.5,   // 标签留空 → 滑条显示占位符"右键此处设置滑条"；端口名仍兜底为 CN
        color: COLORS[(i - 1) % COLORS.length], scale: 0.5, style: "float",
        scale_float: 0.5, scale_fill: 0.5,
        // 填充滑条自定义参数
        trackBg: "#2A2A2E", trackColor: "", thumbColor: "", textColor: "#E4E4E7",
    };
}

// 读取/写入当前样式对应的缩放比例（双样式独立记忆）
function _scaleField(style) { return style === "float" ? "scale_float" : "scale_fill"; }
function _getScaleByStyle(cfg) {
    const s = cfg?.style || "float";
    return cfg?.[_scaleField(s)] ?? cfg?.scale ?? 0.5;
}

function parseCfg(str) {
    try {
        const cfg = str ? JSON.parse(str) : {};
        // 旧数据迁移：早期默认标签"滑条N"统一改为"CN"（用户自定义名称不受影响）
        if (typeof cfg.label === "string") {
            const m = cfg.label.match(/^滑条\s*(\d+)$/);
            if (m) cfg.label = "C" + m[1];
            else if (cfg.label === "滑条") cfg.label = "";
        }
        return cfg;
    } catch (e) { return {}; }
}

function serializeCfg(cfg) {
    return JSON.stringify(cfg);
}

// 主题判定统一走全插件玻璃主题标准（lib/glass-theme.js：auto 跟随画布亮度 / 手动锁定）
function getTheme() { return getGlassTheme(); }

// ── 自动队列已禁用：滑条值仅在收到运行命令后才传递给下游节点 ──────────
// 值的写入通过 syncConfigToWidget / syncWidget 完成，ComfyUI 手动运行时
// IS_CHANGED 会检测到 widget 值变化并正常触发节点执行。
// eslint-disable-next-line no-unused-vars
function autoQueue(_node) { /* 已禁用：不再自动触发工作流执行 */ }

// ═══ 精简模式显示控制（已提取到 lib/omni-hide.js）═══════════════════════════
//   applyNodeDisplay()    — 应用/恢复精简模式（隐藏标题/角标/端口）
//   _osRefreshDOMHide()   — Nodes 2.0 DOM 隐藏 CSS 刷新
//   隐藏三项独立标志持久化在 node.properties，LiteGraph 自动序列化。
//   画布隐藏统一由 node-color.js 的 drawNodeShape wrapper 执行（读取这些标志）。

// ── 预设色中文名（用于悬浮提示：中文名 + #HEX）──

// ── 预设色中文名（用于悬浮提示：中文名 + #HEX）──
const OS_COLOR_NAMES = {
    "#3498DB": "蓝色", "#27AE60": "绿色", "#9B59B6": "紫色", "#E74C3C": "红色",
    "#F39C12": "橙色", "#E91E63": "粉红", "#DD6F4A": "橙红", "#1ABC9C": "青色",
};
function osColorTipText(hex) {
    const n = OS_COLOR_NAMES[(hex || "").toUpperCase()];
    return n ? `${n}  ${hex.toUpperCase()}` : (hex || "").toUpperCase();
}

// 即时悬浮提示改用共享 lib/tooltip.js（osShowDotTip/osHideDotTip 为顶部别名导入）

// ── 设置面板全局单例监听（Esc 关闭 / 点击面板外关闭）──
//   ⚠ 必须单例：旧实现每次开面板都 document.addEventListener 且清理在竞态/多路径下不稳，
//     导致 keydown/pointerdown 监听暴涨累积 → 反复开面板后假死。改为「永远只有一对」全局监听，
//     只作用于当前打开的 _osActivePanel，绝不随开关次数增长。
let _osActivePanel = null;
let _osGlobalHandlersInstalled = false;
function _osInstallGlobalHandlers() {
    if (_osGlobalHandlersInstalled) return;
    _osGlobalHandlersInstalled = true;
    document.addEventListener("keydown", (e) => {
        const p = _osActivePanel;
        if (e.key === "Escape" && p && document.body.contains(p)) { e.preventDefault(); p._cleanup?.(); }
    });
    document.addEventListener("pointerdown", (e) => {
        const p = _osActivePanel;
        if (p && p._armed && document.body.contains(p) && !p.contains(e.target)) p._cleanup?.();
    }, { capture: true });
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

// 通道数选择按钮组（1~6），点击时调用 setChannelCount + onCountChange 回调
function _osBuildMaxChButtons(node, onCountChange) {
    const wrap = document.createElement("div");
    wrap.className = "os-maxch-btns";
    const curCount = node._osChannelCount || 1;
    for (let i = 1; i <= 6; i++) {
        const btn = document.createElement("button");
        btn.className = "os-maxch-btn";
        btn.textContent = i;
        btn.dataset.val = i;
        if (i === curCount) btn.classList.add("active");
        btn.addEventListener("click", () => {
            const v = parseInt(btn.dataset.val);
            setChannelCount(node, v);
            onCountChange(v);
            // 更新按钮高亮
            wrap.querySelectorAll(".os-maxch-btn").forEach(b =>
                b.classList.toggle("active", parseInt(b.dataset.val) === v));
        });
        wrap.appendChild(btn);
    }
    return wrap;
}

// 缩放滑条（浮点/填充共用），返回 { scaleRange, scaleVal, _panelStyle }
function _osBuildScaleSection(styleScaleGroup, fillParams, node, drafts, curCh) {
    const scaleSection = document.createElement("div");
    scaleSection.style.display = "block";
    const scaleRow = document.createElement("div");
    scaleRow.className = "os-scale-row";
    const scaleLbl = document.createElement("label");
    scaleLbl.textContent = "缩放";
    scaleRow.appendChild(scaleLbl);
    const scaleRange = document.createElement("input");
    scaleRange.type = "range";
    scaleRange.className = "os-scale-range";
    scaleRange.min = "0.50";
    scaleRange.max = "1.00";
    scaleRange.step = "0.01";
    scaleRange.value = _getScaleByStyle(drafts[curCh]);
    scaleRange.style.setProperty("--os-scale-color", drafts[curCh].color);
    scaleRow.appendChild(scaleRange);
    const scaleVal = document.createElement("span");
    scaleVal.style.cssText = "font-size:12px;color:var(--ws-text-secondary);min-width:36px;text-align:right;flex-shrink:0";
    scaleVal.textContent = parseFloat(scaleRange.value).toFixed(2);
    scaleRow.appendChild(scaleVal);
    const _panelStyle = () => drafts[curCh]?.style || "float";
    let _scaleDebounceTimer = null;
    const _applyScaleResize = () => updateSize(node);
    scaleRange.oninput = () => {
        const v = parseFloat(scaleRange.value);
        scaleVal.textContent = v.toFixed(2);
        node._osWrap?.style.setProperty("--os-scale", v);
        const field = _scaleField(_panelStyle());
        node._osConfigs.forEach(d => { d[field] = v; d.scale = v; });
        clearTimeout(_scaleDebounceTimer);
        _scaleDebounceTimer = setTimeout(() => _applyScaleResize(v), 100);
    };
    scaleRange.onchange = () => {
        clearTimeout(_scaleDebounceTimer);
        const v = parseFloat(scaleRange.value);
        scaleVal.textContent = v.toFixed(2);
        const field = _scaleField(_panelStyle());
        drafts.forEach(d => { d[field] = v; d.scale = v; });
        _applyScaleResize(v);
        app.graph?.change();
    };
    scaleRange.addEventListener("wheel", (e) => {
        e.preventDefault(); e.stopPropagation();
        const step = parseFloat(scaleRange.step) || 0.01;
        const mn = parseFloat(scaleRange.min), mx = parseFloat(scaleRange.max);
        let v = parseFloat(scaleRange.value) + (e.deltaY < 0 ? step : -step);
        v = Math.max(mn, Math.min(mx, parseFloat(v.toFixed(2))));
        if (v !== parseFloat(scaleRange.value)) { scaleRange.value = v; scaleRange.oninput(); scaleRange.onchange(); }
    }, { passive: false });
    scaleSection.appendChild(scaleRow);
    styleScaleGroup.insertBefore(scaleSection, fillParams);
    return { scaleRange, scaleVal, _panelStyle };
}

// ── 颜色行 + 填充参数（闭包紧密，合并提取为单函数）──────────────────────────
// 返回 { fillParams, _fillHiddens, _syncFillColorToPicker, colorLabel, colorDot, colorInput, colorRow }
// 注：scaleRange 通过 getter 函数传入，因其在调用时尚未创建（由 _osBuildScaleSection 稍后创建）
// 数字输入组（最小值/最大值/步长）
function _osBuildNumGroup(typeRangeGroup, drafts, curCh) {
    const numGroup = document.createElement("div");
    numGroup.className = "os-num-group";
    const minCol = document.createElement("div"); minCol.className = "os-num-col";
    const minSub = document.createElement("div"); minSub.className = "os-num-sub-label"; minSub.textContent = "最小值";
    const minInp = document.createElement("input");
    minInp.type = "number"; minInp.className = "os-num-inline"; minInp.step = "0.01";
    minInp.oninput = () => { const v = parseFloat(minInp.value); if (!isNaN(v)) drafts[curCh].min = v; };
    minCol.appendChild(minSub); minCol.appendChild(minInp);
    const maxCol = document.createElement("div"); maxCol.className = "os-num-col";
    const maxSub = document.createElement("div"); maxSub.className = "os-num-sub-label"; maxSub.textContent = "最大值";
    const maxInp = document.createElement("input");
    maxInp.type = "number"; maxInp.className = "os-num-inline"; maxInp.step = "0.01";
    maxInp.oninput = () => { const v = parseFloat(maxInp.value); if (!isNaN(v)) drafts[curCh].max = v; };
    maxCol.appendChild(maxSub); maxCol.appendChild(maxInp);
    const stepCol = document.createElement("div"); stepCol.className = "os-num-col";
    const stepSub = document.createElement("div"); stepSub.className = "os-num-sub-label"; stepSub.textContent = "步长";
    const stepInp = document.createElement("input");
    stepInp.type = "number"; stepInp.className = "os-num-inline"; stepInp.step = "0.001";
    stepInp.oninput = () => { const v = parseFloat(stepInp.value); if (!isNaN(v)) drafts[curCh].step = v; };
    stepCol.appendChild(stepSub); stepCol.appendChild(stepInp);
    const sep1 = document.createElement("span"); sep1.className = "os-num-sep"; sep1.textContent = "~";
    const sep2 = document.createElement("span"); sep2.className = "os-num-sep"; sep2.textContent = "·";
    numGroup.appendChild(minCol); numGroup.appendChild(sep1);
    numGroup.appendChild(maxCol); numGroup.appendChild(sep2);
    numGroup.appendChild(stepCol);
    typeRangeGroup.appendChild(numGroup);
    return { minInp, maxInp, stepInp };
}

// 名称输入行 + 确认按钮
function _osBuildNameRow(topGroup, node, drafts, curCh, cleanupPanel) {
    const nameRow = document.createElement("div");
    nameRow.style.cssText = "display:flex;align-items:center;gap:6px";
    const nameInp = document.createElement("input");
    nameInp.type = "text";
    nameInp.className = "os-text-input";
    nameInp.spellcheck = false;
    nameInp.setAttribute("autocomplete", "off");
    nameInp.placeholder = "自动识别端口名 / 自定义滑条名";
    nameInp.style.cssText = "flex:1;padding:4px 8px;font-size:11px;height:28px";
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
                if (labelEl) labelEl.textContent = newLabel || "右键此处设置滑条";
            }
        }
        app.graph?.setDirtyCanvas(true, true);
    };
    nameRow.appendChild(nameInp);
    const nameConfirmBtn = document.createElement("button");
    nameConfirmBtn.textContent = "确认";
    nameConfirmBtn.style.cssText = "flex:none;padding:4px 10px;font-size:11px;height:28px;border-radius:6px;cursor:pointer;border:1px solid var(--ws-accent);background:var(--ws-accent);color:var(--ws-text-on-accent,#fff);font-weight:500;line-height:1";
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

// 通道标签：C1~CN 圆形按钮，返回 tabs DOM 元素（由调用者管理挂载位置）
function _osBuildChannelTabs(topGroup, nameRow, chCount, curCh, drafts, _snapshot, node, refreshForm, nameInp, setCurCh) {
    if (chCount <= 1) return null;
    const t = document.createElement("div");
    t.className = "os-seg os-seg-tabs";
    const btns = [];
    for (let i = 0; i < chCount; i++) {
        const btn = document.createElement("button");
        btn.className = "os-seg-btn" + (i === curCh ? " on" : "");
        btn.textContent = "C" + (i + 1);
        btn.onclick = () => {
            _snapshot[curCh] = { ...node._osConfigs[curCh] };
            setCurCh(i);  // 更新外部 curCh（参数 curCh 仅用于初始高亮）
            refreshForm();
            drafts[i].label && (nameInp.value = drafts[i].label);
            btns.forEach((b, bi) => b.classList.toggle("on", bi === i));
            nameInp.focus();
            nameInp.select();
        };
        btns.push(btn);
        t.appendChild(btn);
    }
    topGroup.insertBefore(t, nameRow);
    return t;
}

// ── 颜色行 + 填充参数（闭包紧密，合并提取为单函数）──────────────────────────
function _osBuildColorAndFillSection(panel, drafts, curCh, node, getScaleRange, styleScaleGroup) {
    const colorLabel = document.createElement("div");
    colorLabel.className = "os-row-label";
    colorLabel.textContent = "颜色";
    const colorRow = document.createElement("div");
    colorRow.className = "os-color-row";
    const colorDot = document.createElement("div");
    colorDot.className = "os-color-dot";
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none;border:none;padding:0;margin:0;appearance:none;-webkit-appearance:none;-moz-appearance:none;clip-path:inset(50%)";
    colorDot.appendChild(colorInput);
    const eyeIcon = document.createElement("span");
    eyeIcon.style.cssText = "display:flex;align-items:center;justify-content:center;width:100%;height:100%";
    eyeIcon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;display:block"><path d="M11 7l6 6"/><path d="M4 16L15.7 4.3a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4L8 20H4v-4z"/></svg>`;
    colorDot.appendChild(eyeIcon);
    colorDot.addEventListener("mouseenter", () => osShowDotTip(colorDot, "自定义取色"));
    colorDot.addEventListener("mouseleave", osHideDotTip);
    let _colorRebuildRaf = 0;
    const _scheduleRebuild = () => {
        if (_colorRebuildRaf) return;
        _colorRebuildRaf = requestAnimationFrame(() => { _colorRebuildRaf = 0; rebuildUI(node); });
    };
    // 当前激活的填充参数标签页（mutable ref，与 fill params 共享）
    const _fillActiveTab = { value: "trackColor" };

    colorInput.oninput = () => {
        const hex = colorInput.value;
        if (drafts[curCh].style === "fill" && _fillActiveTab.value) {
            drafts[curCh][_fillActiveTab.value] = hex;
            node._osConfigs[curCh][_fillActiveTab.value] = hex;
            colorDot.style.color = hex;
            if (_fillHiddens[_fillActiveTab.value]) _fillHiddens[_fillActiveTab.value].value = hex;
            _scheduleRebuild();
            presetDots.forEach(d => d.classList.remove("on"));
            return;
        }
        colorDot.style.color = hex;
        drafts[curCh].color = hex;
        node._osConfigs[curCh].color = hex;
        _scheduleRebuild();
        presetDots.forEach(d => d.classList.remove("on"));
        getScaleRange()?.style.setProperty("--os-scale-color", hex);
    };
    colorDot.onclick = () => {
        if (drafts[curCh].style === "fill" && _fillActiveTab.value) {
            _syncFillColorToPicker();
        } else {
            colorLabel.textContent = "颜色";
            colorInput.value = drafts[curCh].color;
            colorDot.style.color = drafts[curCh].color;
        }
        colorInput.click();
    };
    colorRow.appendChild(colorDot);

    // 预色色点 + 随机色点
    const presetDots = [];
    OS_PRESET_COLORS.forEach(hex => {
        const dot = document.createElement("div");
        dot.className = "os-preset-dot";
        dot.style.background = hex;
        dot.onmouseenter = () => osShowDotTip(dot, osColorTipText(hex));
        dot.onmouseleave = osHideDotTip;
        dot.onclick = () => {
            if (drafts[curCh].style === "fill" && _fillActiveTab.value) {
                drafts[curCh][_fillActiveTab.value] = hex;
                node._osConfigs[curCh][_fillActiveTab.value] = hex;
                colorDot.style.color = hex;
                colorInput.value = hex;
                if (_fillHiddens[_fillActiveTab.value]) _fillHiddens[_fillActiveTab.value].value = hex;
                presetDots.forEach(d => d.classList.remove("on"));
                dot.classList.add("on");
                rebuildUI(node);
                return;
            }
            colorInput.value = hex;
            colorDot.style.color = hex;
            drafts[curCh].color = hex;
            presetDots.forEach(d => d.classList.remove("on"));
            dot.classList.add("on");
            node._osConfigs[curCh].color = hex;
            rebuildUI(node);
            getScaleRange()?.style.setProperty("--os-scale-color", hex);
        };
        presetDots.push(dot);
        colorRow.appendChild(dot);
    });

    // 随机色点（仅显示 SVG 骰子图标）
    const randomDot = document.createElement("div");
    randomDot.className = "os-random-btn";
    randomDot.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/></svg>`;
    randomDot.onmouseenter = () => { osShowDotTip(randomDot, "随机配色"); };
    randomDot.onmouseleave = () => { osHideDotTip(); };
    randomDot.onclick = () => {
        if (drafts[curCh].style === "fill" && _fillActiveTab.value) {
            let hex = OS_PRESET_COLORS[Math.floor(Math.random() * OS_PRESET_COLORS.length)];
            const cur = drafts[curCh][_fillActiveTab.value];
            if (hex === cur && OS_PRESET_COLORS.length > 1) {
                hex = OS_PRESET_COLORS[(OS_PRESET_COLORS.indexOf(hex) + 1) % OS_PRESET_COLORS.length];
            }
            drafts[curCh][_fillActiveTab.value] = hex;
            node._osConfigs[curCh][_fillActiveTab.value] = hex;
            colorDot.style.color = hex;
            colorInput.value = hex;
            if (_fillHiddens[_fillActiveTab.value]) _fillHiddens[_fillActiveTab.value].value = hex;
            presetDots.forEach(d => d.classList.remove("on"));
            rebuildUI(node);
            return;
        }
        const hue = 30 + Math.floor(Math.random() * 300);
        const sat = 0.65 + Math.random() * 0.25;
        const val = 0.5 + Math.random() * 0.3;
        const f = n => { const k = (n + hue / 60) % 6; return Math.round((val - val * sat * Math.max(0, Math.min(k, 4 - k, 1))) * 255); };
        const rVal = f(5), gVal = f(3), bVal = f(1);
        const hex = '#' + [rVal, gVal, bVal].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
        const darkBg = '#' + [Math.round(rVal * 0.12), Math.round(gVal * 0.12), Math.round(bVal * 0.12)].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
        const lum = rVal * 0.299 + gVal * 0.587 + bVal * 0.114;
        const textHex = lum > 140 ? '#1A1A1A' : '#F0F0F0';
        drafts[curCh].color = hex;
        drafts[curCh].trackColor = hex;
        drafts[curCh].trackBg = darkBg;
        drafts[curCh].thumbColor = hex;
        drafts[curCh].textColor = textHex;
        node._osConfigs[curCh].color = hex;
        node._osConfigs[curCh].trackColor = hex;
        node._osConfigs[curCh].trackBg = darkBg;
        node._osConfigs[curCh].thumbColor = hex;
        node._osConfigs[curCh].textColor = textHex;
        colorInput.value = hex;
        colorDot.style.color = hex;
        if (_fillHiddens) {
            _fillHiddens.trackBg && (_fillHiddens.trackBg.value = darkBg);
            _fillHiddens.trackColor && (_fillHiddens.trackColor.value = hex);
            _fillHiddens.thumbColor && (_fillHiddens.thumbColor.value = hex);
            _fillHiddens.textColor && (_fillHiddens.textColor.value = textHex);
        }
        presetDots.forEach(d => d.classList.remove("on"));
        getScaleRange()?.style.setProperty("--os-scale-color", hex);
        rebuildUI(node);
    };
    colorRow.appendChild(randomDot);

    // ── 填充滑条自定义参数 ──
    const fillParams = document.createElement("div");
    fillParams.className = "os-fill-params";
    fillParams.style.display = (drafts[curCh].style === "fill") ? "block" : "none";
    fillParams.style.marginTop = "0";
    const _fillHiddens = {};
    FILL_TAB_KEYS.forEach(key => {
        const inp = document.createElement("input");
        inp.type = "color";
        inp.className = "os-fill-color-input";
        inp.value = FILL_TAB_DEFAULTS[key];
        inp.oninput = () => {
            const hex = inp.value;
            drafts[curCh][key] = hex;
            if (key === _fillActiveTab.value) { colorDot.style.color = hex; }
        };
        _fillHiddens[key] = inp;
        fillParams.appendChild(inp);
    });
    function _syncFillColorToPicker() {
        const key = _fillActiveTab.value;
        const d = drafts[curCh];
        const hex = d[key] || FILL_TAB_DEFAULTS[key];
        colorInput.value = hex;
        colorDot.style.color = hex;
        colorLabel.textContent = FILL_TAB_LABELS[key];
        colorLabel.style.display = "none";
        const norm = hex.toLowerCase();
        presetDots.forEach(dot => {
            dot.classList.toggle("on", dot.style.background.toLowerCase() === norm);
        });
    }
    const fillSeg = document.createElement("div");
    fillSeg.className = "os-fill-tabs";
    const fillTabBtns = {};
    FILL_TAB_KEYS.forEach(key => {
        const btn = document.createElement("button");
        btn.className = "os-fill-tab" + (key === _fillActiveTab.value ? " on" : "");
        btn.textContent = FILL_TAB_LABELS[key];
        btn.onclick = () => {
            _fillActiveTab.value = key;
            Object.values(fillTabBtns).forEach(b => b.classList.remove("on"));
            btn.classList.add("on");
            _syncFillColorToPicker();
        };
        fillSeg.appendChild(btn);
        fillTabBtns[key] = btn;
    });
    fillParams.appendChild(fillSeg);
    styleScaleGroup.appendChild(fillParams);

    return { fillParams, _fillHiddens, _syncFillColorToPicker, colorLabel, colorDot, colorInput, colorRow, presetDots };
}

// 设置面板标题行：居中标题 + 深/浅主题切换
function _osBuildPanelTitle(panel) {
    const titleRow = document.createElement("div");
    titleRow.className = "os-panel-title-row";
    const titleEl = document.createElement("div");
    titleEl.className = "os-panel-title";
    titleEl.textContent = "万能滑条 OmniSlider";
    const themeBtn = document.createElement("div");
    themeBtn.className = "os-theme-toggle";
    const MODE_ICONS_OS = { auto: WS_ICONS.auto, light: WS_ICONS.sun, dark: WS_ICONS.moon };
    const refreshThemeBtn = () => { const m = getGlassMode(); themeBtn.innerHTML = MODE_ICONS_OS[m]; themeBtn.title = GLASS_MODE_DEFS[m].tip; };
    refreshThemeBtn();
    themeBtn.onclick = () => cycleGlassMode();
    const _offGlassOS = onGlassChange((t) => { panel.setAttribute("data-theme", t); refreshThemeBtn(); });
    panel._offGlass = _offGlassOS;
    titleRow.appendChild(titleEl);
    titleRow.appendChild(themeBtn);
    panel.appendChild(titleRow);
}

// 面板定位 + 画布缩放同步 + cleanup
function _osPositionPanel(panel, node, commitPanel) {
    document.body.appendChild(panel);
    const canvas = app.canvas;
    if (canvas?.canvas && node) {
        const cEl = canvas.canvas;
        const cR = cEl.getBoundingClientRect();
        const sc = canvas.ds.scale;
        const off = canvas.ds.offset;
        const pR = panel.getBoundingClientRect();
        const gap = 14;
        const nodeRight = cR.left + (node.pos[0] + node.size[0] + off[0]) * sc;
        const nodeLeft  = cR.left + (node.pos[0] + off[0]) * sc;
        let px = nodeRight + gap;
        if (px + pR.width > window.innerWidth - 10) px = nodeLeft - pR.width - gap;
        if (px < 10 || px + pR.width > window.innerWidth - 10) px = Math.max(10, Math.min(px, window.innerWidth - pR.width - 10));
        let py = cR.top + (node.pos[1] + node.size[1] / 2 + off[1]) * sc - pR.height / 2;
        py = Math.min(Math.max(py, 10), window.innerHeight - pR.height - 10);
        panel.style.left = px + "px";
        panel.style.top = py + "px";
        panel.style.transformOrigin = 'top left';
        let _lastZoom = null;
        const _zoomTick = () => {
            if (!panel.isConnected || _osActivePanel !== panel) return;
            const zs = canvas?.ds?.scale ?? 1;
            if (zs !== _lastZoom) {
                _lastZoom = zs;
                const ps = Math.max(1.0, Math.min(zs, 1.5));
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
    } else {
        panel.style.left = "50%";
        panel.style.top = "50%";
        panel.style.transform = "translate(-50%,-50%)";
    }
    function cleanupPanel() {
        if (panel._cleaned) return;
        panel._cleaned = true;
        try { commitPanel(); } catch (e) { console.warn("[WOSAI OmniSlider] cleanupPanel error:", e); }
        if (panel._offGlass) { panel._offGlass(); panel._offGlass = null; }
        panel.remove();
        if (_osActivePanel === panel) _osActivePanel = null;
    }
    panel._cleanup = cleanupPanel;
    _osActivePanel = panel;
    panel._armed = false;
    setTimeout(() => { panel._armed = true; }, 0);
    _osInstallGlobalHandlers();
    return { cleanupPanel };
}

// ── 设置面板 ────────────────────────────────────────────────────────────────
function openSettingsPanel(node, channelIndex, onClose) {
    const old = document.querySelector(".os-panel");
    if (old) { if (old._cleanup) old._cleanup(); else old.remove(); }   // 调用旧面板清理(退订/移除监听)，防累积泄漏

    let chCount = node._osChannelCount;
    let curCh = Math.max(0, Math.min(chCount - 1, channelIndex));
    const drafts = [];
    for (let i = 0; i < chCount; i++) {
        drafts.push(Object.assign(defaultCfg(i + 1), node._osConfigs[i] || {}));
    }
    // 快照：取消时恢复用（防止预览改动在取消后残留）
    const _snapshot = node._osConfigs.map(c => ({ ...c }));
    const origChCount = node._osChannelCount;   // 记录关闭时的通道数，commitPanel 据此检测通道数是否已变

    const panel = document.createElement("div");
    panel.className = "os-panel";
    panel.setAttribute("data-wosai-panel", "");
    panel.setAttribute("data-theme", getTheme());
    panel.onpointerdown = e => e.stopPropagation();

    // ── 标题行（已提取到 _osBuildPanelTitle）──
    _osBuildPanelTitle(panel);

    // 顶部组：滑条总数 + 通道标签 + 修改名称 共用一个背景容器
    const topGroup = document.createElement("div");
    topGroup.className = "os-group os-group-top";
    panel.appendChild(topGroup);

    // ── 通道标签：C1~C6 圆形按钮（在输入框上方，已提取到 _osBuildChannelTabs）──
    let chTabs = null;
    const _rebuildTabs = () => {
        if (chTabs) { chTabs.remove(); chTabs = null; }
        chTabs = _osBuildChannelTabs(topGroup, nameRow, chCount, curCh, drafts, _snapshot, node, refreshForm, nameInp, (v) => { curCh = v; });
    };

    // ── 显示名称（已提取到 _osBuildNameRow）──
    const { nameRow, nameInp } = _osBuildNameRow(topGroup, node, drafts, curCh, () => cleanupPanel());
    // 初始化通道标签（在 nameRow 上方；nameRow 已挂载，可用作 insertBefore 锚点）
    _rebuildTabs();

    // ── 类型（按钮式：浮点 | 整数，点选高亮）──
    const typeRow = document.createElement("div");
    typeRow.className = "os-display-row";
    const typeLbl = document.createElement("div");
    typeLbl.className = "os-display-row-label";
    typeLbl.textContent = "参数类型：";
    const syncTypeBtns = (type) => typeCtl._sync(type);
    const _setType = (t) => {
        drafts[curCh].type = t;
        node._osConfigs[curCh].type = t;
        syncTypeBtns(t);
        rebuildUI(node);
        updateOutputLabel(node);
        app.graph?.setDirtyCanvas(true, true);
    };
    const typeCtl = _osSegmentedControl(
        [{value:"FLOAT", label:"浮点"}, {value:"INT", label:"整数"}],
        drafts[curCh].type || "FLOAT", _setType);
    typeRow.appendChild(typeLbl);
    typeRow.appendChild(typeCtl);
    // 类型 + 范围 共用一个背景容器（同属一组设置项）
    const typeRangeGroup = document.createElement("div");
    typeRangeGroup.className = "os-group";
    typeRangeGroup.appendChild(typeRow);
    panel.appendChild(typeRangeGroup);

    // ── 范围（三数字联排，已提取到 _osBuildNumGroup）──
    const { minInp, maxInp, stepInp } = _osBuildNumGroup(typeRangeGroup, drafts, curCh);

    // ── 样式（标签 + 按钮组同一行）──
    const styleRow = document.createElement("div");
    styleRow.className = "os-style-row";
    const styleLbl = document.createElement("div");
    styleLbl.className = "os-style-label";
    styleLbl.textContent = "滑条样式：";
    let syncStyleBtns = (style) => styleCtl._sync(style);
    const _applyStylePreview = (style) => {
        for (let i = 0; i < chCount; i++) {
            drafts[i].style = style;
            const ps = drafts[i][_scaleField(style)] ?? drafts[i].scale ?? 0.5;
            node._osConfigs[i] = Object.assign({}, node._osConfigs[i], { style, scale: ps });
        }
        syncStyleBtns(style);
        rebuildUI(node);
    };
    const styleCtl = _osSegmentedControl(
        [{value:"float", label:"一体式"}, {value:"fill", label:"圆点式"}],
        drafts[curCh]?.style || "float", _applyStylePreview);
    const styleScaleGroup = document.createElement("div");
    styleScaleGroup.className = "os-group";
    styleRow.appendChild(styleLbl);
    styleRow.appendChild(styleCtl);
    styleScaleGroup.appendChild(styleRow);
    panel.appendChild(styleScaleGroup);

    // ── 颜色 + 填充参数（已提取到 _osBuildColorAndFillSection）──
    const { fillParams, _fillHiddens, _syncFillColorToPicker, colorLabel, colorDot, colorInput, colorRow, presetDots }
        = _osBuildColorAndFillSection(panel, drafts, curCh, node, () => scaleRange, styleScaleGroup);

    // 颜色行延迟挂载（等 colorRow 构建完成后 append 到 styleScaleGroup）
    styleScaleGroup.appendChild(colorRow);

    // ── 统一缩放比例滑条（浮点/填充滑条共用）──
    const { scaleRange, scaleVal, _panelStyle } = _osBuildScaleSection(styleScaleGroup, fillParams, node, drafts, curCh);

    // ── 更新 syncStyleBtns：切换填充/浮点滑条时显示/隐藏 fillParams ──
    const _origSyncStyle = syncStyleBtns;
    syncStyleBtns = (style) => {
        _origSyncStyle(style);
        if (style === "fill") {
            // 为所有通道初始化填充参数（首次切换时补齐缺省值）
            for (let i = 0; i < chCount; i++) {
                const d = drafts[i];
                if (!d.trackBg)    d.trackBg    = "#2A2A2E";
                if (!d.trackColor) d.trackColor = d.color;
                if (!d.thumbColor) d.thumbColor = d.color;
                if (!d.textColor)  d.textColor  = "#E4E4E7";
            }
            refreshFillParams();
            fillParams.style.display = "block";
            colorLabel.style.display = "none";
        } else {
            // 切回浮点滑条时，恢复主通道颜色标签
            colorLabel.textContent = "颜色";
            colorLabel.style.display = "";
            colorInput.value = drafts[curCh].color;
            colorDot.style.color = drafts[curCh].color;
            fillParams.style.display = "none";
        }
        // 同步缩放滑条到当前样式的独立记忆值
        const ps = _getScaleByStyle(drafts[curCh]);
        scaleRange.value = ps;
        scaleVal.textContent = ps.toFixed(2);
    };
    function refreshFillParams() {
        const d = drafts[curCh];
        // 同步隐藏 input（仅填充模式有意义）
        if (d.style === "fill") {
            _fillHiddens.trackBg.value = d.trackBg || "#2A2A2E";
            _fillHiddens.trackColor.value = d.trackColor || d.color;
            _fillHiddens.thumbColor.value = d.thumbColor || d.color;
            _fillHiddens.textColor.value = d.textColor || "#E4E4E7";
            // 同步当前激活标签页颜色到拾色器
            _syncFillColorToPicker();
        }
    }
    function saveFillParams() {
        const d = drafts[curCh];
        // 从隐藏 input 同步到 drafts（仅填充模式有意义）
        if (d.style === "fill") {
            d.trackBg = _fillHiddens.trackBg.value;
            d.trackColor = _fillHiddens.trackColor.value;
            d.thumbColor = _fillHiddens.thumbColor.value;
            d.textColor = _fillHiddens.textColor.value;
        }
    }

    // ── 刷新表单 ──
    function refreshForm() {
        // 重置为默认颜色标签（切换通道时清理填充标签页上下文）
        colorLabel.textContent = drafts[curCh].style === "fill" ? "" : "颜色";
        colorLabel.style.display = drafts[curCh].style === "fill" ? "none" : "";

        const d = drafts[curCh];
        nameInp.value = d.label;
        syncTypeBtns(d.type);
        minInp.value = d.min;
        maxInp.value = d.max;
        stepInp.value = d.step;
        colorDot.style.color = d.color;
        colorInput.value = d.color;
        // 高亮匹配的预设
        const norm = d.color.toLowerCase();
        presetDots.forEach(dot => {
            dot.classList.toggle("on", dot.style.background.toLowerCase() === norm);
        });
        // 同步比例滑条
        const s = _getScaleByStyle(d);
        scaleRange.value = s;
        scaleVal.textContent = s.toFixed(2);
        scaleRange.style.setProperty("--os-scale-color", d.color);
        // 同步样式段控件
        syncStyleBtns(d.style || "float");
        // 同步填充滑条参数（若可见）
        if (d.style === "fill") refreshFillParams();
    }
    refreshForm();

    // ── 滑条总数：点击 1~6 直接在当前节点增加/减少滑条（实时生效） ──
    const maxChSection = document.createElement("div");
    maxChSection.className = "os-maxch-section";
    maxChSection.style.cssText = "display:block;margin-bottom:4px";
    const maxChRow = document.createElement("div");
    maxChRow.className = "os-scale-row";
    const maxChLbl = document.createElement("label");
    maxChLbl.textContent = "滑条总数：";
    maxChRow.appendChild(maxChLbl);
    const maxChBtnsWrap = _osBuildMaxChButtons(node, (v) => {
        chCount = node._osChannelCount;
        if (curCh >= chCount) curCh = chCount - 1;
        while (drafts.length < chCount) {
            const i = drafts.length;
            drafts.push(Object.assign(defaultCfg(i + 1), node._osConfigs[i] || {}));
            _snapshot.push({ ...node._osConfigs[i] });
        }
        if (drafts.length > chCount) {
            drafts.length = chCount;
            _snapshot.length = chCount;
        }
        refreshForm();
        nameInp.value = drafts[curCh].label;
        _rebuildTabs();
        const curMax = getMaxChannels();
        if (v > curMax && app.ui?.settings?.setSettingValue) {
            app.ui.settings.setSettingValue(SETTING_MAX_CH, v);
        }
    });
    maxChRow.appendChild(maxChBtnsWrap);
    maxChSection.appendChild(maxChRow);

    // 位置：顶部组最前（滑条总数 → 通道标签 → 名称，共用一个背景容器）
    topGroup.insertBefore(maxChSection, topGroup.firstChild);

    // ── 节点显示控制（隐藏标题 / 隐藏角标，per-node） ──────────────────
    // 状态持久化在 node.properties.osHideTitle / osHideBadge（LiteGraph 自动序列化）
    const displaySection = document.createElement("div");
    displaySection.className = "os-display-section";

    // 精简显示：一行紧凑多选按钮（标题面板 | 右上角标 | 端口名称），各自独立开关
    const hideRow = document.createElement("div");
    hideRow.className = "os-display-row";
    const hideLbl = document.createElement("div");
    hideLbl.className = "os-display-row-label";
    hideLbl.textContent = "隐藏模式：";
    const hideCtl = document.createElement("div");
    hideCtl.className = "os-seg os-seg-compact os-seg-hide";
    // 使用模块级 _mkHideChip（已在 openSettingsPanel 上方定义）
    hideCtl.appendChild(_mkHideChip(node, "面板", "osHideTitle", "_osHideTitle"));
    hideCtl.appendChild(_mkHideChip(node, "角标", "osHideBadge", "_osHideBadge"));
    hideCtl.appendChild(_mkHideChip(node, "端口", "osHidePortLabel", "_osHidePortLabel"));
    hideRow.appendChild(hideLbl);
    hideRow.appendChild(hideCtl);
    displaySection.appendChild(hideRow);

    // 颜色行（取色器 + 预设点）并入容器；去掉"颜色"标签文字（colorLabel 不挂载，
    //   填充模式相关逻辑仍可安全引用该元素，只是不显示）
    styleScaleGroup.appendChild(colorRow);
    // 隐藏节点开关行：直接挂到面板（实时生效，无需确认）
    panel.appendChild(displaySection);

    // 关闭即提交（无"清除/确认"按钮，全程实时预览，关闭面板时落库 drafts→configs）
    // （实际逻辑已提取到模块级 _osCommitPanel）
    const commitPanel = () => _osCommitPanel(node, chCount, drafts, origChCount, saveFillParams);

    const cr = document.createElement("div");
    cr.className = "os-cr";
    cr.textContent = "COPYRIGHT © WOSAI STUDIO | 穿山阅海";
    panel.appendChild(cr);

    // 面板定位 + 缩放同步 + cleanup（已提取到 _osPositionPanel）
    const { cleanupPanel } = _osPositionPanel(panel, node, commitPanel);
    nameInp.focus();
    nameInp.select();
}

// ── 强制更新 active_value 的 tooltip/DOM title（消除 buildUI 与 onConfigure 重复代码）──
const _AV_TIP = "内部缓存键，自动同步滑条值";
function _forceActiveValueTooltip(node) {
    const avW = node._osHiddenWidgets?.["active_value"];
    if (!avW) return;
    avW.tooltip = _AV_TIP;
    const el = avW.element || avW.dom;
    if (el) { el.title = _AV_TIP; const inner = el.querySelector("input,textarea,[title]"); if (inner) inner.title = _AV_TIP; }
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

// ── 高效设置通道数（无弹窗，直接操作 + 单次 rebuild）──────────────
function setChannelCount(node, targetCount) {
    const maxCh = getMaxChannels();
    targetCount = Math.max(1, Math.min(maxCh, targetCount));
    const current = node._osChannelCount || 1;
    if (targetCount === current) return;

    if (targetCount > current) {
        for (let i = current; i < targetCount; i++) addChannelAt(node, i - 1);
    } else {
        for (let i = current; i > targetCount; i--) removeChannelAt(node, i - 1);
    }
}

// ── 将“滑条总数上限”设置实时应用到画布上所有 OmniSlider 节点 ──────────────
//   超过新上限的节点条数 clamp 下来（含端口同步）；未超的也重建以刷新“+”显隐。
function applyMaxChannelsToAllNodes() {
    const maxCh = getMaxChannels();
    const graph = app.graph;
    if (!graph) return;
    const nodes = (graph._nodes || graph.nodes || []).filter(
        n => n && n.type === "WOSAI_OmniSlider" && n._osWrap);
    for (const node of nodes) {
        const cur = node._osChannelCount || 1;
        if (cur > maxCh) {
            setChannelCount(node, maxCh);   // 内部含 rebuildUI + 端口同步
        } else {
            rebuildUI(node);                // 条数未变也重建，刷新“+”按钮显隐
        }
    }
}

// ── 通道数弹窗：居中渐变滑条，拖拽实时调整 ────────────────────────
let _chPop = null, _chPopOutside = null;
function closeChannelPop() {
    if (_chPop) { _chPop.remove(); _chPop = null; }
    if (_chPopOutside) { document.removeEventListener('pointerdown', _chPopOutside, true); _chPopOutside = null; }
}
function openChannelCountPopover(node, anchor) {
    closeChannelPop();
    const maxCh = getMaxChannels();
    let liveCount = node._osChannelCount || 1;

    const pop = document.createElement('div');
    pop.className = 'os-ch-pop';
    pop.setAttribute('data-wosai-panel', '');
    pop.setAttribute('data-theme', getGlassTheme());
    pop.style.cssText = `position:fixed;z-index:100003;box-sizing:border-box;pointer-events:auto`;
    pop.onpointerdown = e => e.stopPropagation();

    // 文字行（温度滑条样式：标签左 / 数值右）
    const textRow = document.createElement('div');
    textRow.className = 'os-ch-textrow';
    const labelEl = document.createElement('span');
    labelEl.className = 'os-ch-label';
    labelEl.textContent = `滑条数量 (1~${maxCh})`;
    const valueEl = document.createElement('span');
    valueEl.className = 'os-ch-value';
    textRow.appendChild(labelEl);
    textRow.appendChild(valueEl);

    // 细轨道（彩虹渐变填充 + 白圈圆把手）
    const trackWrap = document.createElement('div');
    trackWrap.className = 'os-ch-track-wrap';
    const track = document.createElement('div');
    track.className = 'os-ch-track';
    const fill = document.createElement('div');
    fill.className = 'os-ch-fill';
    // 彩虹渐变：各档位一个预设色，宽度随当前档位
    const gradStops = COLORS.slice(0, maxCh).map((c, i) => {
        const p = maxCh <= 1 ? 50 : (i / (maxCh - 1)) * 100;
        return `${c} ${p}%`;
    }).join(', ');
    fill.style.background = `linear-gradient(to right, ${gradStops})`;
    track.appendChild(fill);
    const thumb = document.createElement('div');
    thumb.className = 'os-ch-thumb';
    track.appendChild(thumb);
    trackWrap.appendChild(track);

    // 组装
    pop.appendChild(textRow);
    pop.appendChild(trackWrap);
    document.body.appendChild(pop);

    // 更新显示：拇指位置 + 填充宽度 + 数值（数字变化时弹跳放大）
    function updateDisplay(count) {
        count = Math.max(1, Math.min(maxCh, count));
        const pct = maxCh <= 1 ? 1 : (count - 1) / (maxCh - 1);
        thumb.style.left = (pct * 100) + '%';
        fill.style.width = (pct * 100) + '%';
        if (valueEl.textContent !== String(count)) {
            valueEl.textContent = count;
            valueEl.classList.remove('pop');
            void valueEl.offsetWidth;   // 强制重排，重新触发动画
            valueEl.classList.add('pop');
        }
    }

    // 从点击位置计算目标数量
    function countFromX(clientX) {
        const rect = track.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
        return Math.round(1 + pct * (maxCh - 1));
    }

    // 应用数量（实时，调用 setChannelCount 统一处理）
    let _lastCount = liveCount;
    function applyCount(target) {
        if (target === _lastCount) return;
        setChannelCount(node, target);
        liveCount = node._osChannelCount || 1;
        _lastCount = liveCount;
        updateDisplay(liveCount);
    }

    updateDisplay(liveCount);

    // 拖拽逻辑（轨道/拇指共用：按下即跳转并显示气泡，按住拖动实时换挡）
    let dragging = false;

    function onPointerDown(e) {
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        track.setPointerCapture?.(e.pointerId);
        applyCount(countFromX(e.clientX));
    }

    track.addEventListener('pointerdown', onPointerDown);

    // 滚轮调节滑条数量（上滚 +1 / 下滚 -1）
    trackWrap.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation();
        applyCount((node._osChannelCount || 1) + (e.deltaY < 0 ? 1 : -1));
    }, { passive: false });

    const onMove = (e) => {
        if (!dragging) return;
        applyCount(countFromX(e.clientX));
    };
    const onUp = () => {
        if (!dragging) return;
        dragging = false;
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);

    // 定位 + 缩放：与节点等宽居中、出现在节点正上方；放不下翻到下方；取不到节点矩形退回屏幕居中。
    // place() 每次按当前画布缩放重设 transform 并重新锚定到节点，供初次定位与缩放跟随复用。
    pop.style.minWidth = '0';
    pop.style.width = (node?.size?.[0] || 320) + 'px';   // 未缩放宽度，scale 后与节点屏幕宽度一致
    pop.style.transformOrigin = 'top left';
    function place() {
        const zs = app.canvas?.ds?.scale || 1;
        pop.style.transform = `scale(${zs})`;
        const gap = 10;
        let nLeft, nTop, nBottom, nWidth;
        // Nodes 2.0 优先：节点 DOM 实际矩形（含标题，宽高已含缩放）
        const vueEl = node ? document.querySelector(`[data-node-id="${node.id}"]`) : null;
        const dr = vueEl?.getBoundingClientRect();
        if (dr && dr.width > 0) {
            nLeft = dr.left; nTop = dr.top; nBottom = dr.bottom; nWidth = dr.width;
        } else if (app.canvas?.canvas && node) {
            const cR  = app.canvas.canvas.getBoundingClientRect();
            const off = app.canvas.ds?.offset || [0, 0];
            nLeft   = cR.left + (node.pos[0] + off[0]) * zs;
            nTop    = cR.top  + (node.pos[1] + off[1] - 30) * zs;   // 含标题高度
            nBottom = cR.top  + (node.pos[1] + node.size[1] + off[1]) * zs;
            nWidth  = node.size[0] * zs;
        }
        const pr = pop.getBoundingClientRect();
        let px, py;
        if (nLeft !== undefined) {
            px = nLeft + nWidth / 2 - pr.width / 2;
            // Nodes 2.0：角标在节点左下角，上方无遮挡，贴近节点顶即可；
            // Classic：角标悬浮在节点顶上方，留 ~8px×scale 让圆钮底部贴近角标而不压住
            const isVue = !!(dr && dr.width > 0);
            const badgeGap = isVue ? gap : gap + Math.round(16 * zs);
            py = nTop - pr.height - badgeGap;
            if (py < 8) py = nBottom + gap;
        } else {
            px = (window.innerWidth - pr.width) / 2;
            py = (window.innerHeight - pr.height) / 2;
        }
        px = Math.max(8, Math.min(px, window.innerWidth - pr.width - 8));
        py = Math.max(8, Math.min(py, window.innerHeight - pr.height - 8));
        pop.style.left = px + 'px';
        pop.style.top = py + 'px';
    }
    requestAnimationFrame(place);
    // 实时跟随画布缩放：scale 变化即重设缩放并重新锚定（弹窗关闭即停止；平移会触发外侧 pointerdown 自动关闭）
    let _lastScale = null;
    const _zoomTick = () => {
        if (!pop.isConnected) return;
        const zs = app.canvas?.ds?.scale ?? 1;
        if (zs !== _lastScale) { _lastScale = zs; place(); }
        requestAnimationFrame(_zoomTick);
    };
    requestAnimationFrame(_zoomTick);

    // 点击外侧关闭
    _chPopOutside = (e) => {
        if (!pop.contains(e.target)) closeChannelPop();
    };
    document.addEventListener('pointerdown', _chPopOutside, true);
    _chPop = pop;

    // 清理监听（pop 移除时）
    const origRemove = pop.remove.bind(pop);
    pop.remove = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        origRemove();
    };
}

function addChannelAt(node, channelIndex) {
    const chCount = node._osChannelCount;
    if (chCount >= getMaxChannels()) return;
    const newCfg = defaultCfg(channelIndex + 2);
    // 新增滑条按已有通道总数轮询下一个预设颜色
    newCfg.color = COLORS[chCount % COLORS.length];
    // 继承当前行的样式（及填充滑条自定义色）
    const srcCfg = node._osConfigs[channelIndex];
    if (srcCfg) {
        newCfg.style = srcCfg.style;
        if (srcCfg.style === "fill") {
            newCfg.trackBg    = srcCfg.trackBg;
            newCfg.trackColor = srcCfg.trackColor;
            newCfg.thumbColor = srcCfg.thumbColor;
            newCfg.textColor  = srcCfg.textColor;
        }
    }
    node._osConfigs.splice(channelIndex + 1, 0, newCfg);
    node._osConfigs.pop();
    const newCount = chCount + 1;
    node._osChannelCount = newCount;
    syncOutputPorts(node);  // 同步输出端口数
    // 使用 syncConfigToWidget 统一写入（value + callback + inputEl）
    for (let j = 0; j < node._osChannelCount; j++) {
        syncConfigToWidget(node, j);
    }
    const ccW = node._osHiddenWidgets?.["channel_count"];
    if (ccW) {
        ccW.value = newCount;
        if (typeof ccW.callback === 'function') {
            try { ccW.callback(newCount); } catch (_) {}
        }
        if (ccW.inputEl) ccW.inputEl.value = newCount;
    }
    rebuildUI(node);
    // syncActiveValue 已由 syncConfigToWidget 调用
    app.graph?.setDirtyCanvas(true, true);
    app.graph?.change();
}

// ── 删除通道 ───────────────────────────────────────────────────────────────
function removeChannelAt(node, channelIndex) {
    const chCount = node._osChannelCount;
    if (chCount <= 1) return;
    node._osConfigs.splice(channelIndex, 1);
    node._osConfigs.push(defaultCfg(getMaxChannels()));
    const newCount = chCount - 1;
    node._osChannelCount = newCount;
    syncOutputPorts(node);  // 同步输出端口数
    for (let j = 0; j < node._osChannelCount; j++) {
        syncConfigToWidget(node, j);
    }
    const ccW = node._osHiddenWidgets?.["channel_count"];
    if (ccW) {
        ccW.value = newCount;
        if (typeof ccW.callback === 'function') {
            try { ccW.callback(newCount); } catch (_) {}
        }
        if (ccW.inputEl) ccW.inputEl.value = newCount;
    }
    rebuildUI(node);
    // syncActiveValue 已由 syncConfigToWidget 调用
    app.graph?.setDirtyCanvas(true, true);
    app.graph?.change();
}

// ── 同步输出端口数量与类型（与 channel_count 动态匹配）─────────────────
function syncOutputPorts(node) {
    if (!node.outputs) return;
    const target = node._osChannelCount || 1;

    // 0. 将所有激活范围内的已有端口类型设为通配 "*"
    //    ComfyUI 初始从 Python RETURN_TYPES 创建 FLOAT 端口，必须覆盖为
    //    "*" 才能在 LiteGraph 前端层绕过类型校验（_TS 仅处理后端）。
    for (let i = 0; i < Math.min(node.outputs.length, target); i++) {
        node.outputs[i].type = "*";
    }

    // 1. 补充不足的端口
    while (node.outputs.length < target) {
        const idx = node.outputs.length;
        node.addOutput(`ch${idx + 1}`, "*");
    }

    // 2. 从末端移除多余端口，使端口数严格等于滑条数。
    //    removeOutput 会自动断开该端口上的连线——减少滑条即同步断开对应输出，
    //    这是用户期望的行为（端口数始终与滑条数一致），不再保护残留连线。
    while (node.outputs.length > target) {
        node.removeOutput(node.outputs.length - 1);
    }
}

// ── 更新全部输出端口标签与类型（使用通道配置中的 label/type）──────────────
function updateOutputLabel(node) {
    if (!node.outputs) return;
    const hidePort = !!node._osHidePortLabel;   // 隐藏端口名（保留圆点/连线）
    const count = node._osChannelCount || getMaxChannels();
    for (let i = 0; i < count; i++) {
        const cfg = node._osConfigs?.[i];
        const chLabel = (cfg?.label) || ("C" + (i + 1));
        const typeLabel = (cfg && cfg.type === "INT") ? "INT" : "FLOAT";
        const name = chLabel + " (" + typeLabel + ")";
        if (node.outputs[i]) {
            node.outputs[i].name = name;
            // 隐藏端口名：用零宽空格（非空，绕过 v10 的 label||name 回退；不可见、零宽度）
            //   保留端口圆点与连线，仅文字消失
            node.outputs[i].label = hidePort ? "​" : chLabel;
        }
    }
    app.graph?.setDirtyCanvas(true, true);
}

// ── 按样式计算 widget 内容区高度（填充滑条行更高）─────────────────────────
function _calcContentH(node, noMeasure) {
    // ⚡ 缓存：键 = 通道数 + 全局世代号，世代号在 rebuildUI 末尾递增。
    //   除非通道数或配置变化导致 rebuildUI 触发，否则复用上次计算值，
    //   避免每次 updateSize 都强制回流（scrollHeight 读 DOM 布局）。
    const gen = node._osContentHGen || 0;
    const chCount = node._osChannelCount || 1;
    const cacheKey = chCount + '_' + gen;
    if (node._osContentHCache && node._osContentHCache.key === cacheKey) {
        return node._osContentHCache.height;
    }

    // ⚡ 性能关键：getMinHeight 被 ComfyUI 每次布局调用，缓存失效瞬间若读 scrollHeight 会强制同步
    //   reflow → 反复开面板时「重新计算样式」暴涨假死。故 noMeasure=true 时直接走公式、绝不量 DOM；
    //   精确 scrollHeight 测量只在 updateSize（每次重建后一次）做并写入缓存。
    if (noMeasure) return _calcContentHFormula(node, chCount);

    // 优先 DOM 实测：rebuildUI 后 wrap 已挂载，scrollHeight 强制同步 reflow。
    // ⚠ 测量瞬间必须临时解除高度拉伸（height:auto + flex:none + align-self）——
    // scrollHeight 取"内容高与容器拉伸高的较大者"，减少滑条后 wrap 仍被旧容器
    // 高度撑着，直接量会得到旧值 → 节点永远缩不回去（已踩坑）
    const wrap = node._osWrap;
    if (wrap && wrap.isConnected) {
        const s = wrap.style;
        const prev = { h: s.height, mh: s.minHeight, flex: s.flex, as: s.alignSelf };
        s.height = 'auto'; s.minHeight = '0'; s.flex = 'none'; s.alignSelf = 'flex-start';
        const h = wrap.scrollHeight;   // 纯内容高（scrollHeight 是布局值，不受画布 transform 缩放影响）
        s.height = prev.h; s.minHeight = prev.mh; s.flex = prev.flex; s.alignSelf = prev.as;
        if (h > 10) { const result = h + 6; node._osContentHCache = { key: cacheKey, height: result }; return result; }
    }
    // 回退公式（wrap 未挂载时）：复用 _calcContentHFormula，并写缓存
    const result = _calcContentHFormula(node, chCount);
    node._osContentHCache = { key: cacheKey, height: result };
    return result;
}

// 纯公式估算内容高（不读 DOM、不写缓存）——供 getMinHeight 的零 reflow 快路径与 wrap 未挂载兜底复用
function _calcContentHFormula(node, chCount) {
    const n = chCount;
    const s = node._osConfigs[0]?.scale ?? 1.0;
    const gap = Math.max(12 * s, 6); // 行间间距（与 CSS .os-wrap gap 对齐）
    let h = 0;
    for (let i = 0; i < n; i++) {
        const cfg = node._osConfigs[i];
        const style = cfg?.style || "float";
        if (style === "fill") {
            // 文字行高 = 值字号(16px×scale*1.45)，padding 已归零
            const valFont = 16;
            const textRowH = Math.round(valFont * s * 1.45);
            // 文字行 + 间隙(5px) + 细轨道(16px)
            h += textRowH + Math.max(5 * s, 3) + Math.max(16 * s, 12);
        } else {
            // 浮点滑条：轨道高度跟随 scale（CSS --os-scale 驱动）
            h += Math.max(Math.round(24 * s), 14);
        }
        if (i < n - 1) h += gap;
    }
    // 顶部控制行（胶囊或极小+）+ 其与首行之间的一道 gap —— 仅在会渲染时计入
    if (n >= 2 || getMaxChannels() > 1) h += 20 + gap;
    // 底部留白：基础 6px + 4px/通道。⚠ 按通道数而非 outputs.length——
    // 旧节点可能残留多余端口（如 10 个），按端口算会多出上百像素空白
    const outputCount = node._osChannelCount || n;
    const padding = 6 + Math.round(4 * outputCount);
    return h + padding;
}

// ── 键盘无障碍辅助 ─────────────────────────────────────────────────────────
function _addKeyboardAccess(trackWrap, node, cfg, chIdx, updateDisplay, syncWidget) {
    trackWrap.setAttribute("tabindex", "0");
    trackWrap.setAttribute("role", "slider");
    trackWrap.setAttribute("aria-valuemin", cfg.min);
    trackWrap.setAttribute("aria-valuemax", cfg.max);
    trackWrap.setAttribute("aria-valuenow", cfg.value);
    trackWrap.setAttribute("aria-label", cfg.label || "Channel");

    trackWrap.addEventListener("keydown", (e) => {
        if (cfg.locked) return;
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
function _osCommitPanel(node, chCount, drafts, origChCount, saveFillParams) {
    try {
        saveFillParams();
        // 检测是否有布局影响的变更——跳过无变更时的全量重建（通道数已由 setChannelCount → rebuildUI 处理过）
        let needsRebuild = false;
        const channelsChanged = chCount !== origChCount;
        if (!channelsChanged) {
            for (let i = 0; i < chCount && !needsRebuild; i++) {
                const d = drafts[i];
                const c = node._osConfigs[i];
                if (!c) { needsRebuild = true; break; }
                for (const k of Object.keys(d)) {
                    if (d[k] !== c[k]) { needsRebuild = true; break; }
                }
            }
        }
        for (let i = 0; i < chCount; i++) {
            node._osConfigs[i] = drafts[i];
            syncConfigToWidget(node, i);
        }
        if (needsRebuild || channelsChanged) {
            rebuildUI(node);
        }
        const avW = node._osHiddenWidgets?.["active_value"];
        if (avW && node._osConfigs[0]) avW.value = node._osConfigs[0].value;
        app.graph?.setDirtyCanvas(true, true);
        app.graph?.change();
        autoQueue(node);
    } catch (e) { console.warn("[WOSAI OmniSlider] commitPanel:", e.message); }
}

// ── 构建单条滑行 DOM 及交互（从 rebuildUI 提取，减小主循环体积）───────────
function _osBuildSliderRow(node, cfg, chIdx, chCount) {
    if (chCount <= 1 && cfg.locked) { cfg.locked = false; syncConfigToWidget(node, chIdx); }
    const chLocked = !!cfg.locked;
    const row = document.createElement("div");
    row.className = "os-slider-row" + (chLocked ? " ch-locked" : "");

    // ── 轨道区域：根据样式分支构建 DOM ────────────────────────────
    let dragEl, posEl, updateDisplay;

    if (cfg.style === "fill") {
        row.setAttribute("data-style", "fill");
        const fillSlot = document.createElement("div");
        fillSlot.className = "os-fill-slot";
        const fillText = document.createElement("div");
        fillText.className = "os-fill-text";
        const fillLabel = document.createElement("span");
        fillLabel.className = "os-fill-text-label";
        fillLabel.textContent = cfg.label || "右键此处设置滑条";
        const fillVal = document.createElement("span");
        fillVal.className = "os-fill-text-val";
        fillVal.style.color = cfg.textColor || cfg.color;
        fillText.appendChild(fillLabel);
        fillText.appendChild(fillVal);
        const railWrap = document.createElement("div");
        railWrap.className = "os-fill-rail-wrap";
        const rail = document.createElement("div");
        rail.className = "os-fill-rail";
        rail.style.background = cfg.trackBg || "#1a1a1e";
        const rf = document.createElement("div");
        rf.className = "os-fill-rf";
        rf.style.background = cfg.trackColor || cfg.color;
        const thumbEl = document.createElement("div");
        thumbEl.className = "os-fill-thumb-el";
        thumbEl.style.background = cfg.thumbColor || cfg.color;
        rail.appendChild(rf);
        railWrap.appendChild(rail);
        railWrap.appendChild(thumbEl);
        fillSlot.appendChild(fillText);
        fillSlot.appendChild(railWrap);
        const trackWrap = document.createElement("div");
        trackWrap.className = "os-track-wrap";
        trackWrap.setAttribute("data-style", "fill");
        trackWrap.appendChild(fillSlot);
        row.appendChild(trackWrap);
        dragEl = fillSlot;
        posEl  = railWrap;
        const stepDecimals = Math.max(0, Math.ceil(-Math.log10(cfg.step || 0.01)));
        updateDisplay = (val) => {
            const mn = parseFloat(cfg.min) || 0;
            const mx = parseFloat(cfg.max) || 1;
            const pct = mx !== mn ? Math.max(0, Math.min(1, (val - mn) / (mx - mn))) : 0;
            const pct100 = (pct * 100) + "%";
            rf.style.width = pct100;
            rf.setAttribute("data-full", pct >= 0.995 ? "1" : "0");
            thumbEl.style.left = pct100;
            const disp = cfg.type === "INT" ? String(Math.round(val)) : val.toFixed(stepDecimals);
            fillVal.textContent = disp;
            fillLabel.textContent = cfg.label || "右键此处设置滑条";
        };
    } else {
        const trackWrap = document.createElement("div");
        trackWrap.className = "os-track-wrap";
        const track = document.createElement("div");
        track.className = "os-track";
        const fill = document.createElement("div");
        fill.className = "os-fill";
        fill.style.background = cfg.color;
        const labelArea = document.createElement("div");
        labelArea.className = "os-label-area";
        labelArea.textContent = cfg.label || "右键此处设置滑条";
        const valPill = document.createElement("div");
        valPill.className = "os-val-pill";
        valPill.style.color = cfg.color;
        track.appendChild(fill);
        track.appendChild(labelArea);
        track.appendChild(valPill);
        trackWrap.appendChild(track);
        row.appendChild(trackWrap);
        dragEl = track;
        posEl  = track;
        const stepDecimals = Math.max(0, Math.ceil(-Math.log10(cfg.step || 0.01)));
        updateDisplay = (val) => {
            const mn = parseFloat(cfg.min) || 0;
            const mx = parseFloat(cfg.max) || 1;
            const pct = mx !== mn ? Math.max(0, Math.min(1, (val - mn) / (mx - mn))) : 0;
            fill.style.width = (pct * 100) + "%";
            fill.setAttribute("data-full", pct >= 0.995 ? "1" : "0");
            labelArea.setAttribute("data-on-fill", pct > 0.6 ? "1" : "0");
            valPill.style.color = pct > 0.85 ? "#fff" : cfg.color;
            const disp = cfg.type === "INT" ? String(Math.round(val)) : val.toFixed(stepDecimals);
            valPill.textContent = disp;
            labelArea.textContent = cfg.label || "右键此处设置滑条";
        };
    }

    // ── 右按钮列：锁定图标 ──
    if (chCount > 1 || node._osHideTitle) {
        const rightCol = document.createElement("div");
        rightCol.className = "os-btn-col os-btn-col-right";
        const lockBtn = document.createElement("button");
        lockBtn.className = "os-ch-lock" + (chLocked ? " locked" : "");
        lockBtn.innerHTML = chLocked ? WS_ICONS.lock : WS_ICONS.lockOpen;
        lockBtn.setAttribute("data-tooltip", chLocked ? "点击解锁" : "上锁防误触");
        lockBtn.onclick = (e) => {
            e.stopPropagation();
            cfg.locked = !cfg.locked;
            syncConfigToWidget(node, chIdx);
            row.classList.toggle("ch-locked", cfg.locked);
            lockBtn.classList.toggle("locked", cfg.locked);
            lockBtn.innerHTML = cfg.locked ? WS_ICONS.lock : WS_ICONS.lockOpen;
            lockBtn.setAttribute("data-tooltip", cfg.locked ? "点击解锁" : "上锁防误触");
            app.graph?.setDirtyCanvas(true, true);
        };
        rightCol.appendChild(lockBtn);
        row.appendChild(rightCol);
    }

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

    const syncWidget = () => { syncConfigToWidget(node, chIdx); };

    dragEl.addEventListener("pointerdown", e => {
        if (e.button !== 0) return;
        if (cfg.locked) { e.stopPropagation(); return; }
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
        autoQueue(node);
    };
    dragEl.addEventListener("pointerup", _endDrag);
    dragEl.addEventListener("pointercancel", _endDrag);

    // ── 滚轮调节 ──
    dragEl.addEventListener("wheel", e => {
        if (cfg.locked) return;
        e.preventDefault();
        e.stopPropagation();
        const mn = parseFloat(cfg.min) || 0;
        const mx = parseFloat(cfg.max) || 1;
        const st = parseFloat(cfg.step) || (cfg.type === "INT" ? 1 : 0.01);
        const dir = e.deltaY < 0 ? 1 : -1;
        let v = (parseFloat(cfg.value) || 0) + dir * st;
        v = Math.max(mn, Math.min(mx, v));
        v = cfg.type === "INT" ? Math.round(v) : parseFloat(v.toFixed(8));
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
        if (tw) _addKeyboardAccess(tw, node, cfg, chIdx, updateDisplay, syncWidget);
    } else {
        const tw = row.querySelector(".os-track-wrap[data-style='fill']");
        if (tw) _addKeyboardAccess(tw, node, cfg, chIdx, updateDisplay, syncWidget);
    }

    // ── 右键打开该通道的设置面板（直接绑在行上，不依赖冒泡到 wrap）──
    row.addEventListener("contextmenu", e => {
        e.preventDefault();
        e.stopPropagation();
        const cfgCh = node._osConfigs[chIdx];
        if (cfgCh && cfgCh.locked) return;
        const activeTw = row.querySelector(".os-track-wrap.dragging");
        if (activeTw) activeTw.classList.remove("dragging");
        try {
            openSettingsPanel(node, chIdx, () => rebuildUI(node));
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
    wrap.classList.remove("locked"); // 移除旧全局锁定 class（向下兼容）
    wrap.innerHTML = "";

    const chCount = node._osChannelCount;

    // ⚡ 用 DocumentFragment 批量构建 DOM，减少逐次 appendChild 触发的布局抖动
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < chCount; i++) {
        const cfg = node._osConfigs[i] || Object.assign(defaultCfg(i + 1));
        fragment.appendChild(_osBuildSliderRow(node, cfg, i, chCount));
    }

    // ⚡ 批量写入 DOM（DocumentFragment 零开销，只触发一次布局重算）
    wrap.appendChild(fragment);

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
            wrap.style.setProperty("--os-active-color", node._osConfigs[i].color || "#DD6F4A");
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
        const allNames = node.widgets.map(w => `${w.name}(${w.type})`);
        for (const w of node.widgets) {
            if (w.name === "active_value") {
                node._osHiddenWidgets["active_value"] = w;
                _doHideWidget(w);
            } else if (w.name === "channel_count") {
                node._osChannelCount = Math.max(1, Math.min(getMaxChannels(), parseInt(w.value) || 1));
                node._osHiddenWidgets["channel_count"] = w;
                _doHideWidget(w);
            } else if (w.name === "active_channel") {
                // 保留隐藏 widget 用于序列化兼容，全通道激活模式下不再依赖此值
                node._osHiddenWidgets["active_channel"] = w;
                _doHideWidget(w);
            } else if (w.name && /^ch\d+_cfg$/.test(w.name)) {
                const idx = parseInt(w.name.match(/^ch(\d+)_cfg$/)[1]) - 1;
                node._osConfigs[idx] = Object.assign(defaultCfg(idx + 1), parseCfg(w.value));
                node._osHiddenWidgets[w.name] = w;
                _doHideWidget(w);
            }
        }
    }
    // 确保所有通道都有默认配置
    for (let i = 0; i < getMaxChannels(); i++) {
        if (!node._osConfigs[i]) node._osConfigs[i] = defaultCfg(i + 1);
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
    for (let i = 0; i < getMaxChannels(); i++) {
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
    retryUntil(_removeDivider, { maxTries: 6 });

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
        _hideMgr?.disconnect();
        if (node._osWidthObserver) { node._osWidthObserver.disconnect(); node._osWidthObserver = null; }
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
    retryUntil(_calibrate, { maxTries: 10 });

    const _origOnResize = node.onResize;
    node.onResize = function(size) {
        if (size[0] < MIN_WIDTH) size[0] = MIN_WIDTH;
        _origOnResize?.apply(this, arguments);
    };

    // 宽度同步
    let _lastW = node.size?.[0];
    // ResizeObserver 替代 setInterval：事件驱动，页面不可见时自动暂停，更高效
    const _widthObserver = new ResizeObserver(() => {
        if (!node.size) return;
        const cw = node.size[0];
        if (cw !== _lastW) {
            _lastW = cw;
            wrap.style.maxWidth = cw + "px";
        }
    });
    _widthObserver.observe(wrap);
    node._osWidthObserver = _widthObserver;

    // ── channel_count callback hook ─────────────────────────────────────
    const ccW = node._osHiddenWidgets?.["channel_count"];
    if (ccW) {
        const _origCb = ccW.callback;
        ccW.callback = function(v) {
            _origCb?.apply(this, arguments);
            node._osChannelCount = Math.max(1, Math.min(getMaxChannels(), parseInt(v) || 1));
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
        if (ccW) this._osChannelCount = Math.max(1, Math.min(getMaxChannels(), parseInt(ccW.value) || 1));
        for (let i = 0; i < getMaxChannels(); i++) {
            const cw = this._osHiddenWidgets?.[`ch${i + 1}_cfg`];
            if (cw) this._osConfigs[i] = Object.assign(defaultCfg(i + 1), parseCfg(cw.value));
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

// ── 注册 ──────────────────────────────────────────────────────────────────
app.registerExtension({
    name: "WOSAI.OmniSlider",

    settings: [
        {
            id: SETTING_MAX_CH,
            name: '🟠 选择滑条总数（ 1 ~ 6 ）',
            category: ['WOSAI 自定义', '万能滑条', '滑条总数上限'],
            type: 'slider',
            defaultValue: 5,
            // 新版前端 slider 范围必须放 attrs（顶层 min/max 被忽略 → 曾可拖到 100）
            attrs: { min: 1, max: 6, step: 1 },
            min: 1,
            max: 6,
            step: 1,
            tooltip: '立即对画布上所有万能滑条生效',
            // 双保险：超限值立即钳回；其余变更实时同步到所有节点
            onChange: (v) => {
                const n = parseInt(v);
                if (n > 6) { try { app.ui.settings.setSettingValue(SETTING_MAX_CH, 6); } catch (e) { console.warn('[OmniSlider] clamp setting failed', e); } return; }
                applyMaxChannelsToAllNodes();
            },
        },
    ],

    setup() {
        try {
            const v = parseInt(app.ui?.settings?.getSettingValue?.(SETTING_MAX_CH));
            if (v > 6) app.ui.settings.setSettingValue(SETTING_MAX_CH, 6);
        } catch (e) { /* 设置尚未注册时静默忽略 */ }
        // 动态加载拆分的 CSS 文件（Panel / Hide 共用 os-slider- 前缀，检查唯一 ID 避免冗余）
        const _loadCSS = (id, href) => {
            if (!document.getElementById(id)) {
                const link = document.createElement("link");
                link.id = id;
                link.rel = "stylesheet";
                link.href = href;
                document.head.appendChild(link);
            }
        };
        _loadCSS("wosai-os-slider-css", "/extensions/WOSAI-ComfyUI/css/os-slider.css");
        _loadCSS("wosai-os-slider-panel-css", "/extensions/WOSAI-ComfyUI/css/os-slider-panel.css");
        _loadCSS("wosai-os-slider-hide-css", "/extensions/WOSAI-ComfyUI/css/os-slider-hide.css");

        // ═══ 精简模式的画布隐藏（标题/角标）已统一由 node-color.js 的 drawNodeShape ═══
        //   wrapper 处理（读取 node._osHideTitle / _osHideBadge），此处不再单独 hook，
        //   彻底避免与 node-color 双钩子互相覆盖导致的反复失效。
    },

    // 扩展卸载：恢复所有 OmniSlider 节点的显示状态（画布钩子由 node-color 负责还原）
    async remove() {
        // 恢复所有 OmniSlider 节点的标题显示 + 颜色
        const graph = app.graph;
        if (graph?._nodes || graph?.nodes) {
            const nodes = graph._nodes || graph.nodes;
            for (const node of nodes) {
                if (node?.type === "WOSAI_OmniSlider") {
                    node._osHideTitle = false;
                    node._osHideBadge = false;
                    node._osHidePortLabel = false;
                    // 恢复颜色
                    if (node._osOrigColor !== undefined) {
                        node.color = node._osOrigColor;
                        node.bgcolor = node._osOrigBgColor;
                        delete node._osOrigColor;
                        delete node._osOrigBgColor;
                    }
                    // 恢复 title_mode
                    if (node._osOrigTitleMode !== undefined) {
                        node.title_mode = node._osOrigTitleMode;
                        delete node._osOrigTitleMode;
                    }
                    // 恢复角标
                    if (node._osOrigBadges !== undefined) {
                        node.badges = node._osOrigBadges;
                        delete node._osOrigBadges;
                    }
                    // 恢复端口标签
                    try { updateOutputLabel(node); } catch (_) { /* 节点可能已部分销毁，尽力而为 */ }
                }
            }
            app.graph?.setDirtyCanvas(true, true);
        }
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "WOSAI_OmniSlider") return;

        const _origCreate = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function() {
            _origCreate?.apply(this, arguments);
            this._osConfigs = [];
            this._osChannelCount = 1;
            this._osActiveChannel = 0;
            // ── 输出连接自适应类型 ────────────────────────────────────────
        this.onConnectOutput = function(slotIndex, targetNode, targetSlot) {
            // 只处理匹配的输出 slot
            if (slotIndex < 0 || slotIndex >= getMaxChannels()) return;
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
            if (slotIndex < 0 || slotIndex >= getMaxChannels()) return;
            const cfg = this._osConfigs?.[slotIndex];
            if (!cfg) return;
            // 延迟一帧，等链路完全注册
            requestAnimationFrame(() => {
                const outSlot = this.outputs?.[slotIndex];
                const ourLinkId = outSlot?.links?.[0];
                if (!ourLinkId) return;
                // 通过 linkInfo 或 graph.links 找目标
                let lnk = (typeof linkInfo === "object" && linkInfo?.target_id != null)
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

        try {
            buildUI(this);
        } catch (err) {
            console.error("[WOSAI OmniSlider ERROR]", err.message, err.stack);
            throw err;
        }
        };
    },

    getNodeMenuItems(node) {
        if (node.type !== "WOSAI_OmniSlider") return [];
        return [
            null,
            {
                content: "🟠 万能滑条 OmniSlider",
                callback: () => {
                    openSettingsPanel(node, 0, () => rebuildUI(node));
                },
            },
        ];
    },
});
