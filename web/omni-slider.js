/* WOSAI OmniSlider v1.0 | 作者：穿山阅海 | COPYRIGHT © WOSAI STUDIO */
/**
 * WOSAI OmniSlider — 万能滑条前端 (CSS已提取至 web/css/os-slider.css)
 */
import { app } from "../../../scripts/app.js";
import { WS_ICONS } from "./lib/shared-utils.js";
import { getGlassTheme, getGlassMode, cycleGlassMode, onGlassChange, GLASS_MODE_DEFS, glassT } from "./lib/glass-theme.js";

const SETTING_MAX_CH = 'WOSAI.OmniSlider.MaxChannels';
function getMaxChannels() {
    try {
        const v = app.ui?.settings?.getSettingValue?.(SETTING_MAX_CH);
        if (v !== undefined && v !== null) return Math.max(1, Math.min(6, parseInt(v) || 5));
    } catch (e) {}
    return 5;
}

// CSS 已迁移至 web/css/os-slider.css，通过 extension.json 加载

// ── 辅助 ────────────────────────────────────────────────────────────────────
const COLORS = ["#3498DB","#27AE60","#9B59B6","#E74C3C","#F39C12","#E91E63","#DD6F4A","#1ABC9C","#3498DB","#F1C40F"];

// 注意：默认值须与 wosai_core/config.py::default_omni_config() 保持一致
function defaultCfg(i) {
    return {
        label: "", type: "FLOAT", min: 0, max: 1, step: 0.01, value: 0.5,   // 标签留空 → 滑条显示占位符"双击设置滑条"；端口名仍兜底为 CN
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

// ── 设置面板 ────────────────────────────────────────────────────────────────
function openSettingsPanel(node, channelIndex, onClose) {
    const old = document.querySelector(".os-panel");
    if (old) old.remove();

    const chCount = node._osChannelCount;
    let curCh = Math.max(0, Math.min(chCount - 1, channelIndex));
    const drafts = [];
    for (let i = 0; i < chCount; i++) {
        drafts.push(Object.assign(defaultCfg(i + 1), node._osConfigs[i] || {}));
    }
    // 快照：取消时恢复用（防止预览改动在取消后残留）
    const _snapshot = node._osConfigs.map(c => ({ ...c }));

    // 6 个预设颜色
    const PRESET_COLORS = ["#3498DB","#27AE60","#9B59B6","#E74C3C","#F39C12","#E91E63","#DD6F4A"];

    const panel = document.createElement("div");
    panel.className = "os-panel";
    panel.setAttribute("data-wosai-panel", "");
    panel.setAttribute("data-theme", getTheme());
    panel.onpointerdown = e => e.stopPropagation();

    // ── 标题行：居中标题 + 深/浅切换 ──
    const titleRow = document.createElement("div");
    titleRow.className = "os-panel-title-row";
    const titleEl = document.createElement("div");
    titleEl.className = "os-panel-title";
    titleEl.textContent = "万能滑条 OmniSlider";
    // 主题按钮：全插件共享三态（自动/浅色/深色），切换广播至所有 WOSAI 面板
    const themeBtn = document.createElement("div");
    themeBtn.className = "os-theme-toggle";
    const MODE_ICONS_OS = { auto: WS_ICONS.auto, light: WS_ICONS.sun, dark: WS_ICONS.moon };
    const refreshThemeBtn = () => {
        const m = getGlassMode();
        themeBtn.innerHTML = MODE_ICONS_OS[m];
        themeBtn.title = GLASS_MODE_DEFS[m].tip;
    };
    refreshThemeBtn();
    themeBtn.onclick = () => cycleGlassMode();
    const _offGlassOS = onGlassChange((t) => { panel.setAttribute("data-theme", t); refreshThemeBtn(); });
    panel._offGlass = _offGlassOS;   // 面板清理时退订
    titleRow.appendChild(titleEl);
    titleRow.appendChild(themeBtn);
    panel.appendChild(titleRow);

    // ── 通道标签（段控件） ──
    if (chCount > 1) {
        const chTabs = document.createElement("div");
        chTabs.className = "os-seg";
        const chBtns = [];
        for (let i = 0; i < chCount; i++) {
            const btn = document.createElement("button");
            btn.className = "os-seg-btn" + (i === curCh ? " on" : "");
            btn.textContent = "C" + (i + 1);
            btn.onclick = () => {
                if (_snapshot[curCh]) {
                    node._osConfigs[curCh] = { ..._snapshot[curCh] };
                }
                curCh = i;
                refreshForm();
                chBtns.forEach((b, bi) => b.classList.toggle("on", bi === i));
                nameInp.focus();
                nameInp.select();
            };
            chBtns.push(btn);
            chTabs.appendChild(btn);
        }
        panel.appendChild(chTabs);
    }

    // ── 显示名称（第一行） ──
    const nameLabel = document.createElement("div");
    nameLabel.className = "os-row-label";
    nameLabel.textContent = "修改滑条名称";
    panel.appendChild(nameLabel);
    const nameInp = document.createElement("input");
    nameInp.type = "text";
    nameInp.className = "os-text-input";
    nameInp.placeholder = "自动识别端口名 / 自定义滑条名";
    nameInp.oninput = () => { drafts[curCh].label = nameInp.value; };
    panel.appendChild(nameInp);

    // ── 类型（段控件） ──
    const typeLabel = document.createElement("div");
    typeLabel.className = "os-row-label";
    typeLabel.textContent = "类型";
    panel.appendChild(typeLabel);
    const typeSeg = document.createElement("div");
    typeSeg.className = "os-seg";
    const btnFloat = document.createElement("button");
    btnFloat.className = "os-seg-btn on";
    btnFloat.textContent = "浮点";
    btnFloat.onclick = () => {
        drafts[curCh].type = "FLOAT";
        node._osConfigs[curCh].type = "FLOAT";
        syncTypeBtns("FLOAT");
        rebuildUI(node);
        updateOutputLabel(node);
        app.graph?.setDirtyCanvas(true, true);
    };
    const btnInt = document.createElement("button");
    btnInt.className = "os-seg-btn";
    btnInt.textContent = "整数";
    btnInt.onclick = () => {
        drafts[curCh].type = "INT";
        node._osConfigs[curCh].type = "INT";
        syncTypeBtns("INT");
        rebuildUI(node);
        updateOutputLabel(node);
        app.graph?.setDirtyCanvas(true, true);
    };
    typeSeg.appendChild(btnFloat);
    typeSeg.appendChild(btnInt);
    function syncTypeBtns(type) {
        btnFloat.classList.toggle("on", type === "FLOAT");
        btnInt.classList.toggle("on", type === "INT");
    }
    panel.appendChild(typeSeg);

    // ── 范围（三数字联排，每列上方有子标签） ──
    const rangeLabel = document.createElement("div");
    rangeLabel.className = "os-row-label";
    rangeLabel.textContent = "范围";
    panel.appendChild(rangeLabel);
    const numGroup = document.createElement("div");
    numGroup.className = "os-num-group";
    // 最小值列
    const minCol = document.createElement("div"); minCol.className = "os-num-col";
    const minSub = document.createElement("div"); minSub.className = "os-num-sub-label"; minSub.textContent = "最小值";
    const minInp = document.createElement("input");
    minInp.type = "number"; minInp.className = "os-num-inline"; minInp.step = "0.01";
    minInp.oninput = () => { const v = parseFloat(minInp.value); if (!isNaN(v)) drafts[curCh].min = v; };
    minCol.appendChild(minSub); minCol.appendChild(minInp);
    // 最大值列
    const maxCol = document.createElement("div"); maxCol.className = "os-num-col";
    const maxSub = document.createElement("div"); maxSub.className = "os-num-sub-label"; maxSub.textContent = "最大值";
    const maxInp = document.createElement("input");
    maxInp.type = "number"; maxInp.className = "os-num-inline"; maxInp.step = "0.01";
    maxInp.oninput = () => { const v = parseFloat(maxInp.value); if (!isNaN(v)) drafts[curCh].max = v; };
    maxCol.appendChild(maxSub); maxCol.appendChild(maxInp);
    // 步长列
    const stepCol = document.createElement("div"); stepCol.className = "os-num-col";
    const stepSub = document.createElement("div"); stepSub.className = "os-num-sub-label"; stepSub.textContent = "步长";
    const stepInp = document.createElement("input");
    stepInp.type = "number"; stepInp.className = "os-num-inline"; stepInp.step = "0.001";
    stepInp.oninput = () => { const v = parseFloat(stepInp.value); if (!isNaN(v)) drafts[curCh].step = v; };
    stepCol.appendChild(stepSub); stepCol.appendChild(stepInp);
    const sep1 = document.createElement("span"); sep1.className = "os-num-sep"; sep1.textContent = "~";
    const sep2 = document.createElement("span"); sep2.className = "os-num-sep"; sep2.textContent = "·";
    numGroup.appendChild(minCol);
    numGroup.appendChild(sep1);
    numGroup.appendChild(maxCol);
    numGroup.appendChild(sep2);
    numGroup.appendChild(stepCol);
    panel.appendChild(numGroup);

    // ── 颜色行 — 圆形取色器 + 6 预设色点（挂载到底部，取消/确认按钮上方）──
    const colorLabel = document.createElement("div");
    colorLabel.className = "os-row-label";
    colorLabel.textContent = "颜色";
    // 不在此处 appendChild，延迟到底部统一挂载
    const colorRow = document.createElement("div");
    colorRow.className = "os-color-row";
    // 圆形取色器（带吸管图标，区别于预设色点）
    const colorDot = document.createElement("div");
    colorDot.className = "os-color-dot";
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none;border:none;padding:0";
    colorDot.appendChild(colorInput);
    const eyeIcon = document.createElement("span");
    // 滴管图标（与全插件线性图标体系一致）；白描边+阴影确保任意彩色圆底上可见
    eyeIcon.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="position:absolute;inset:0;margin:auto;pointer-events:none;color:rgba(255,255,255,0.9);filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6))"><path d="M11 7l6 6"/><path d="M4 16L15.7 4.3a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4L8 20H4v-4z"/></svg>`;
    colorDot.appendChild(eyeIcon);
    colorInput.oninput = () => {
        const hex = colorInput.value;
        // 填充滑条模式：写入当前激活的填充参数标签页
        if (drafts[curCh].style === "fill" && _fillActiveTab) {
            drafts[curCh][_fillActiveTab] = hex;
            node._osConfigs[curCh][_fillActiveTab] = hex;
            colorDot.style.background = hex;
            // 同步到该标签页的隐藏 input
            if (_fillHiddens[_fillActiveTab]) _fillHiddens[_fillActiveTab].value = hex;
            rebuildUI(node);
            presetDots.forEach(d => d.classList.remove("on"));
            return;
        }
        // 默认：写入主通道颜色
        colorDot.style.background = hex;
        drafts[curCh].color = hex;
        node._osConfigs[curCh].color = hex;
        rebuildUI(node);
        presetDots.forEach(d => d.classList.remove("on"));
        scaleRange.style.setProperty("--os-scale-color", hex);
    };
    colorDot.onclick = () => {
        // 填充滑条模式：显示当前激活标签页的颜色
        if (drafts[curCh].style === "fill" && _fillActiveTab) {
            _syncFillColorToPicker();
        } else {
            colorLabel.textContent = "颜色";
            colorInput.value = drafts[curCh].color;
            colorDot.style.background = drafts[curCh].color;
        }
        colorInput.click();
    };
    colorRow.appendChild(colorDot);
    // 6 个预设色点
    const presetDots = [];
    PRESET_COLORS.forEach(hex => {
        const dot = document.createElement("div");
        dot.className = "os-preset-dot";
        dot.style.background = hex;
        dot.title = hex;
        dot.onclick = () => {
            // 填充滑条模式：将预设色写入当前激活的填充参数标签页
            if (drafts[curCh].style === "fill" && _fillActiveTab) {
                drafts[curCh][_fillActiveTab] = hex;
                node._osConfigs[curCh][_fillActiveTab] = hex;
                colorDot.style.background = hex;
                colorInput.value = hex;
                if (_fillHiddens[_fillActiveTab]) _fillHiddens[_fillActiveTab].value = hex;
                presetDots.forEach(d => d.classList.remove("on"));
                dot.classList.add("on");
                rebuildUI(node);
                return;
            }
            // 默认：写入主通道取色器
            colorInput.value = hex;
            colorDot.style.background = hex;
            drafts[curCh].color = hex;
            presetDots.forEach(d => d.classList.remove("on"));
            dot.classList.add("on");
            // 实时更新滑条颜色
            node._osConfigs[curCh].color = hex;
            rebuildUI(node);
            scaleRange.style.setProperty("--os-scale-color", hex);
        };
        presetDots.push(dot);
        colorRow.appendChild(dot);
    });
    // colorRow 延迟挂载到底部，此处不 appendChild

    // ── 样式（段控件） ──
    const styleLabel = document.createElement("div");
    styleLabel.className = "os-row-label";
    styleLabel.textContent = "样式";
    panel.appendChild(styleLabel);
    const styleSeg = document.createElement("div");
    styleSeg.className = "os-seg";
    const btnFloatStyle = document.createElement("button");
    btnFloatStyle.className = "os-seg-btn on";
    btnFloatStyle.textContent = "进度滑条";
    const _applyStylePreview = (style) => {
        // 样式切换对所有通道统一生效
        for (let i = 0; i < chCount; i++) {
            drafts[i].style = style;
            // 从独立记忆恢复当前样式的缩放比例
            const ps = drafts[i][_scaleField(style)] ?? drafts[i].scale ?? 0.5;
            node._osConfigs[i] = Object.assign({}, node._osConfigs[i], { style, scale: ps });
        }
        syncStyleBtns(style);
        rebuildUI(node);
        // rebuildUI 末尾的 updateSize → setSize 已触发 ComfyUI 内部 canvas 重绘，
        // 无需额外调用 setDirtyCanvas，避免同一帧内重复重绘导致卡顿
    };
    btnFloatStyle.onclick = () => _applyStylePreview("float");
    const btnFillStyle = document.createElement("button");
    btnFillStyle.className = "os-seg-btn";
    btnFillStyle.textContent = "温度滑条";
    btnFillStyle.onclick = () => _applyStylePreview("fill");
    styleSeg.appendChild(btnFloatStyle);
    styleSeg.appendChild(btnFillStyle);
    function syncStyleBtns(style) {
        btnFloatStyle.classList.toggle("on", style === "float");
        btnFillStyle.classList.toggle("on", style === "fill");
    }
    panel.appendChild(styleSeg);

    // ── 填充滑条自定义参数（仅 style === "fill" 可见）──
    const fillParams = document.createElement("div");
    fillParams.className = "os-fill-params";
    fillParams.style.display = (drafts[curCh].style === "fill") ? "block" : "none";
    fillParams.style.marginTop = "-4px";

    // 当前激活的填充参数标签页
    let _fillActiveTab = "trackColor";

    const FILL_TAB_KEYS = ["trackColor", "trackBg", "thumbColor", "textColor"];
    const FILL_TAB_LABELS = { trackColor: "左边", trackBg: "右边", thumbColor: "按钮", textColor: "数字" };
    const FILL_TAB_DEFAULTS = { trackColor: "", trackBg: "#2A2A2E", thumbColor: "", textColor: "#E4E4E7" };

    // 4 个隐藏 color input，用于持久化存储
    const _fillHiddens = {};
    FILL_TAB_KEYS.forEach(key => {
        const inp = document.createElement("input");
        inp.type = "color";
        inp.className = "os-fill-color-input";
        inp.value = FILL_TAB_DEFAULTS[key];
        inp.oninput = () => {
            const hex = inp.value;
            drafts[curCh][key] = hex;
            if (key === _fillActiveTab) { colorDot.style.background = hex; }
        };
        _fillHiddens[key] = inp;
        fillParams.appendChild(inp);
    });

    // 将当前激活标签页颜色同步给面板颜色区
    function _syncFillColorToPicker() {
        const key = _fillActiveTab;
        const d = drafts[curCh];
        const hex = d[key] || FILL_TAB_DEFAULTS[key];
        colorInput.value = hex;
        colorDot.style.background = hex;
        colorLabel.textContent = FILL_TAB_LABELS[key];
        colorLabel.style.display = "none"; // 分段标签页已标明，隐藏 colorLabel
        const norm = hex.toLowerCase();
        presetDots.forEach(dot => {
            dot.classList.toggle("on", dot.style.background.toLowerCase() === norm);
        });
    }

    // 分段标签页
    const fillLabel = document.createElement("div");
    fillLabel.className = "os-row-label";
    fillLabel.style.marginBottom = "4px";
    fillLabel.textContent = "颜色";
    fillParams.appendChild(fillLabel);
    const fillSeg = document.createElement("div");
    fillSeg.className = "os-fill-tabs";
    const fillTabBtns = {};
    FILL_TAB_KEYS.forEach(key => {
        const btn = document.createElement("button");
        btn.className = "os-fill-tab" + (key === _fillActiveTab ? " on" : "");
        btn.textContent = FILL_TAB_LABELS[key];
        btn.onclick = () => {
            _fillActiveTab = key;
            Object.values(fillTabBtns).forEach(b => b.classList.remove("on"));
            btn.classList.add("on");
            _syncFillColorToPicker();
        };
        fillSeg.appendChild(btn);
        fillTabBtns[key] = btn;
    });
    fillParams.appendChild(fillSeg);
    panel.appendChild(fillParams);

    // ── 统一缩放比例滑条（浮点/填充滑条共用）──
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

    // 获取当前样式名称（面板内 drafts/curCh 始终存在）
    const _panelStyle = () => drafts[curCh]?.style || "float";

    // scale 调整时重算高度——统一走 updateSize（目标记忆 + Classic/Nodes2.0 口径分流），
    // 旧实现直接 setSize(内容高) 在 Classic 下会被 LiteGraph 撑回形成拉锯卡顿
    let _scaleDebounceTimer = null;
    const _applyScaleResize = () => updateSize(node);
    scaleRange.oninput = () => {
        const v = parseFloat(scaleRange.value);
        scaleVal.textContent = v.toFixed(2);
        node._osWrap?.style.setProperty("--os-scale", v);
        // 写入当前样式对应的独立缩放字段 + 同步 scale 主字段
        const field = _scaleField(_panelStyle());
        node._osConfigs.forEach(d => { d[field] = v; d.scale = v; });
        // debounce: CSS/文字即时更新，重排版延迟执行
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
    scaleSection.appendChild(scaleRow);
    // 插到 fillParams 之前（样式段控件正下方）
    panel.insertBefore(scaleSection, fillParams);

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
            colorDot.style.background = drafts[curCh].color;
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
        colorDot.style.background = d.color;
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

    // ── 滑条总数上限设置 ──
    const maxChSection = document.createElement("div");
    maxChSection.className = "os-maxch-section";
    maxChSection.style.cssText = "display:block;margin-bottom:4px";

    const maxChRow = document.createElement("div");
    maxChRow.className = "os-scale-row";

    const maxChLbl = document.createElement("label");
    maxChLbl.textContent = "选择滑条总数：";
    maxChRow.appendChild(maxChLbl);

    // 悬浮提示（点击后短暂显示，不挤占按钮位置）
    const maxChTip = document.createElement("span");
    maxChTip.className = "os-maxch-tip";
    maxChTip.textContent = "";
    // 不 append 到 maxChRow，改为点击时 append 到 document.body

    // 1~6 数字按钮
    const maxChBtnsWrap = document.createElement("div");
    maxChBtnsWrap.className = "os-maxch-btns";
    const maxChCurrent = getMaxChannels();

    for (let i = 1; i <= 6; i++) {
        const btn = document.createElement("button");
        btn.className = "os-maxch-btn";
        btn.textContent = i;
        btn.dataset.val = i;
        if (i === maxChCurrent) btn.classList.add("active");

        btn.addEventListener("click", () => {
            const v = parseInt(btn.dataset.val);
            if (app.ui?.settings?.setSettingValue) {
                app.ui.settings.setSettingValue(SETTING_MAX_CH, v);
            }
            maxChBtnsWrap.querySelectorAll(".os-maxch-btn").forEach(b => b.classList.toggle("active", parseInt(b.dataset.val) === v));

            // 悬浮提示：append 到 body，定位到按钮行正上方
            maxChTip.textContent = "已保存，重新添加节点后生效！";
            maxChTip.style.opacity = "0";
            maxChTip.style.position = "fixed";
            maxChTip.style.zIndex = "100010";
            maxChTip.style.pointerEvents = "none";

            if (!document.body.contains(maxChTip)) {
                document.body.appendChild(maxChTip);
            }

            // 强制回流获取正确尺寸
            const tipRect = maxChTip.getBoundingClientRect();
            const btnsRect = maxChBtnsWrap.getBoundingClientRect();

            maxChTip.style.left = (btnsRect.left + btnsRect.width / 2 - tipRect.width / 2) + "px";
            maxChTip.style.top  = (btnsRect.top + btnsRect.height / 2 - tipRect.height / 2) + "px";
            maxChTip.style.opacity = "1";

            clearTimeout(maxChTip._t);
            maxChTip._t = setTimeout(() => {
                maxChTip.style.opacity = "0";
                setTimeout(() => {
                    if (document.body.contains(maxChTip)) {
                        document.body.removeChild(maxChTip);
                    }
                }, 350);
            }, 2000);
        });

        maxChBtnsWrap.appendChild(btn);
    }

    maxChRow.appendChild(maxChBtnsWrap);
    maxChSection.appendChild(maxChRow);

    // 位置：通道标签上方（面板顶部全局设置区）
    panel.insertBefore(maxChSection, titleRow.nextSibling);

    // ── 底部按钮 ──
    const footer = document.createElement("div");
    footer.className = "os-footer";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "os-btn os-btn-cancel";
    cancelBtn.textContent = "清除";
    cancelBtn.onclick = () => {
        // 完整还原快照（撤销所有预览改动：样式、缩放等），但不关闭窗口
        for (let i = 0; i < _snapshot.length; i++) {
            node._osConfigs[i] = { ..._snapshot[i] };
        }
        const origScale = _snapshot[0]?.scale ?? 1.0;
        node._osWrap?.style.setProperty("--os-scale", origScale);
        rebuildUI(node);
        app.graph?.setDirtyCanvas(true, true);
    };
    const okBtn = document.createElement("button");
    okBtn.className = "os-btn os-btn-ok";
    okBtn.textContent = "确认";
    okBtn.onclick = () => {
        saveFillParams(); // 保存当前通道的填充滑条参数
        for (let i = 0; i < chCount; i++) {
            node._osConfigs[i] = drafts[i];
            syncConfigToWidget(node, i);
        }
        rebuildUI(node);
        // 全通道激活：active_value 始终取通道0
        const avW = node._osHiddenWidgets?.["active_value"];
        if (avW && node._osConfigs[0]) avW.value = node._osConfigs[0].value;
        app.graph?.setDirtyCanvas(true, true);
        app.graph?.change();
        autoQueue(node);
        cleanupPanel();
        onClose?.();
    };
    footer.appendChild(cancelBtn);
    footer.appendChild(okBtn);
    // 颜色行：取消/确认按钮上方
    panel.appendChild(colorLabel);
    panel.appendChild(colorRow);
    panel.appendChild(footer);

    const cr = document.createElement("div");
    cr.className = "os-cr";
    cr.textContent = "COPYRIGHT © WOSAI STUDIO | 穿山阅海";
    panel.appendChild(cr);

    document.body.appendChild(panel);
    nameInp.focus();
    nameInp.select();

    // 定位面板
    const canvas = app.canvas;
    if (canvas?.canvas && node) {
        const cEl = canvas.canvas;
        const cR = cEl.getBoundingClientRect();
        const sc = canvas.ds.scale;
        const off = canvas.ds.offset;
        const pR = panel.getBoundingClientRect();
        const gap = 14;
        // 智能定位：优先右侧，溢出则尝试左侧，最后兜底 clamp
        const nodeRight = cR.left + (node.pos[0] + node.size[0] + off[0]) * sc;
        const nodeLeft  = cR.left + (node.pos[0] + off[0]) * sc;
        let px = nodeRight + gap;
        if (px + pR.width > window.innerWidth - 10) {
            // 右侧溢出 → 尝试左侧
            px = nodeLeft - pR.width - gap;
        }
        if (px < 10 || px + pR.width > window.innerWidth - 10) {
            // 左侧也不够 → clamp
            px = Math.max(10, Math.min(px, window.innerWidth - pR.width - 10));
        }
        let py = cR.top + (node.pos[1] + node.size[1] / 2 + off[1]) * sc - pR.height / 2;
        py = Math.min(Math.max(py, 10), window.innerHeight - pR.height - 10);
        panel.style.left = px + "px";
        panel.style.top = py + "px";

        // ── 面板随画布缩放同步（0.65~1.5 钳制；origin top-left + 视口钳制防错位）──
        panel.style.transformOrigin = 'top left';
        let _lastZoom = null;
        const _zoomTick = () => {
            if (!panel.isConnected) return;   // 面板关闭即停止
            const zs = canvas?.ds?.scale ?? 1;
            if (zs !== _lastZoom) {
                _lastZoom = zs;
                const ps = Math.max(0.65, Math.min(zs, 1.5));
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

    function closeHandler(e) {
        if (e && panel.contains(e.target)) return;
        cleanupPanel();
    }
    function cleanupPanel() {
        if (panel._offGlass) { panel._offGlass(); panel._offGlass = null; }
        panel.remove();
        document.removeEventListener("pointerdown", closeHandler, { capture: true });
        document.removeEventListener("keydown", _escHandler);
    }
    const _escHandler = (e) => {
        if (e.key === "Escape" && document.body.contains(panel)) {
            e.preventDefault();
            cleanupPanel();
            onClose?.();
        }
    };
    setTimeout(() => {
        document.addEventListener("pointerdown", closeHandler, { capture: true });
        document.addEventListener("keydown", _escHandler);
    }, 0);
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

// ── 通道数弹窗：居中渐变滑条，拖拽实时调整 ────────────────────────
let _chPop = null, _chPopOutside = null;
function closeChannelPop() {
    if (_chPop) { _chPop.remove(); _chPop = null; }
    if (_chPopOutside) { document.removeEventListener('pointerdown', _chPopOutside, true); _chPopOutside = null; }
}
function openChannelCountPopover(node, anchor) {
    closeChannelPop();
    const maxCh = getMaxChannels();
    const T = glassT();
    let liveCount = node._osChannelCount || 1;

    const pop = document.createElement('div');
    pop.className = 'os-ch-pop';
    pop.setAttribute('data-wosai-panel', '');
    pop.setAttribute('data-theme', getGlassTheme());
    pop.style.cssText = `position:fixed;z-index:100003;box-sizing:border-box;pointer-events:auto`;
    pop.onpointerdown = e => e.stopPropagation();

    // 悬浮提示（悬停弹窗时浮现于上方，零高度占用）
    const tip = document.createElement('div');
    tip.className = 'os-ch-pop-tip';
    tip.textContent = `任选 1~${maxCh} 根滑条`;

    // 渐变轨道容器
    const trackWrap = document.createElement('div');
    trackWrap.className = 'os-ch-track-wrap';

    // 温度滑条样式：暗色轨道 + 渐变填充 + 单拇指，拖动时数字气泡淡入淡出
    const track = document.createElement('div');
    track.className = 'os-ch-track';

    // 渐变填充（通道颜色，宽度随当前档位）
    const gradStops = COLORS.slice(0, maxCh).map((c, i) => {
        const pct = maxCh <= 1 ? 50 : (i / (maxCh - 1)) * 100;
        return `${c} ${pct}%`;
    }).join(', ');
    const fill = document.createElement('div');
    fill.className = 'os-ch-fill';
    fill.style.background = `linear-gradient(to right, ${gradStops})`;
    track.appendChild(fill);

    // 单拇指（白圈 + 橙芯）+ 数字气泡（拖动时浮现于拇指上方）
    const thumb = document.createElement('div');
    thumb.className = 'os-ch-thumb';
    const bubble = document.createElement('div');
    bubble.className = 'os-ch-bubble';
    thumb.appendChild(bubble);
    track.appendChild(thumb);

    trackWrap.appendChild(track);

    // 组装
    pop.appendChild(tip);
    pop.appendChild(trackWrap);
    document.body.appendChild(pop);

    // 弹出时立即显示悬浮提示，1.6s 后淡出（之后悬停仍可再现）
    pop.classList.add('tip-show');
    setTimeout(() => pop.classList.remove('tip-show'), 1600);

    // ── 与画布缩放同步 ──
    const sc = app.canvas?.ds?.scale || 1;
    pop.style.transform = `scale(${sc})`;
    pop.style.transformOrigin = 'top left';

    // 数字气泡淡入淡出
    let _bubbleTimer = null;
    function showBubble() {
        clearTimeout(_bubbleTimer);
        bubble.classList.add('show');
    }
    function hideBubbleSoon() {
        clearTimeout(_bubbleTimer);
        _bubbleTimer = setTimeout(() => bubble.classList.remove('show'), 600);
    }

    // 更新显示：拇指位置 + 填充宽度 + 气泡数字（数字变化时弹跳放大）
    function updateDisplay(count) {
        count = Math.max(1, Math.min(maxCh, count));
        const pct = maxCh <= 1 ? 1 : (count - 1) / (maxCh - 1);
        thumb.style.left = (pct * 100) + '%';
        fill.style.width = (pct * 100) + '%';
        if (bubble.textContent !== String(count)) {
            bubble.textContent = count;
            bubble.classList.remove('pop');
            void bubble.offsetWidth;   // 强制重排，重新触发动画
            bubble.classList.add('pop');
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
        showBubble();
        applyCount(countFromX(e.clientX));
    }

    track.addEventListener('pointerdown', onPointerDown);

    const onMove = (e) => {
        if (!dragging) return;
        showBubble();
        applyCount(countFromX(e.clientX));
    };
    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        hideBubbleSoon();
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);

    // 定位：与节点面板等宽、水平居中对齐，出现在节点正上方——
    // 节点增减滑条时高度向下扩展，上方位置天然稳定，透明弹窗不会盖到节点内容；
    // 上方放不下翻到节点下方；取不到节点矩形时退回屏幕居中
    pop.style.minWidth = '0';
    pop.style.width = (node?.size?.[0] || 320) + 'px';   // 未缩放宽度，scale 后与节点屏幕宽度一致
    requestAnimationFrame(() => {
        const gap = 10;
        let nLeft, nTop, nBottom, nWidth;
        // Nodes 2.0 优先：节点 DOM 实际矩形（含标题，宽高已含缩放）
        const vueEl = node ? document.querySelector(`[data-node-id="${node.id}"]`) : null;
        const dr = vueEl?.getBoundingClientRect();
        if (dr && dr.width > 0) {
            nLeft = dr.left; nTop = dr.top; nBottom = dr.bottom; nWidth = dr.width;
        } else if (app.canvas?.canvas && node) {
            const cR  = app.canvas.canvas.getBoundingClientRect();
            const s   = app.canvas.ds?.scale || 1;
            const off = app.canvas.ds?.offset || [0, 0];
            nLeft   = cR.left + (node.pos[0] + off[0]) * s;
            nTop    = cR.top  + (node.pos[1] + off[1] - 30) * s;   // 含标题高度
            nBottom = cR.top  + (node.pos[1] + node.size[1] + off[1]) * s;
            nWidth  = node.size[0] * s;
        }
        const pr = pop.getBoundingClientRect();
        let px, py;
        if (nLeft !== undefined) {
            px = nLeft + nWidth / 2 - pr.width / 2;
            // Nodes 2.0：角标在节点左下角，上方无遮挡，贴近节点顶即可；
            // Classic：角标悬浮在节点顶上方，留 ~8px×scale 让圆钮底部贴近角标而不压住
            const isVue = !!(dr && dr.width > 0);
            const badgeGap = isVue ? gap : gap + Math.round(16 * (app.canvas?.ds?.scale || 1));
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
    });

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

    // 2. 从末端移除多余端口（遇到有连线的端口停止，保护已有连接）
    while (node.outputs.length > target) {
        const last = node.outputs[node.outputs.length - 1];
        if (last.links && last.links.length > 0) break;
        node.removeOutput(node.outputs.length - 1);
    }
}

// ── 更新全部输出端口标签与类型（使用通道配置中的 label/type）──────────────
function updateOutputLabel(node) {
    if (!node.outputs) return;
    for (let i = 0; i < getMaxChannels(); i++) {
        const cfg = node._osConfigs?.[i];
        const chLabel = (cfg?.label) || ("C" + (i + 1));
        const typeLabel = (cfg && cfg.type === "INT") ? "INT" : "FLOAT";
        const name = chLabel + " (" + typeLabel + ")";
        if (node.outputs[i]) {
            if (node.outputs[i].name !== name || node.outputs[i].label !== chLabel) {
                node.outputs[i].name = name;
                node.outputs[i].label = chLabel;
            }
            // 类型保持通配 "*"，标签已通过端口名显示（如 "batch_size (INT)"）
        }
    }
    app.graph?.setDirtyCanvas(true, true);
}

// ── 按样式计算 widget 内容区高度（填充滑条行更高）─────────────────────────
function _calcContentH(node) {
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
        if (h > 10) return h + 8;   // 少量底部呼吸
    }
    // 回退公式（wrap 未挂载时）
    const n = node._osChannelCount || 1;
    const s = node._osConfigs[0]?.scale ?? 1.0;
    const gap = Math.max(28 * s, 20); // 行间间距（与 CSS .os-wrap gap 对齐）
    let h = 0;
    for (let i = 0; i < n; i++) {
        const cfg = node._osConfigs[i];
        const style = cfg?.style || "float";
        if (style === "fill") {
            // 文字行高 = 值字号(16px×scale*1.45) + 上下 padding
            const valFont = 16;
            const textRowH = Math.round(valFont * s * 1.45) + Math.max(4 * s, 3);
            // 文字行 + 间隙(10px) + 细轨道(16px)
            h += textRowH + Math.max(10 * s, 6) + Math.max(16 * s, 12);
        } else {
            // 浮点滑条：轨道高度跟随 scale（CSS --os-scale 驱动）
            h += Math.max(Math.round(24 * s), 18);
        }
        if (i < n - 1) h += gap;
    }
    // 底部控制行（单组 − / +）
    h += 26;
    // 底部留白：基础 12px + 10px/通道。⚠ 按通道数而非 outputs.length——
    // 旧节点可能残留多余端口（如 10 个），按端口算会多出上百像素空白
    const outputCount = node._osChannelCount || n;
    const padding = 12 + Math.round(10 * outputCount);
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

// ── 重建整个 UI（所有通道垂直堆叠，按钮列独立保证对齐）──────────────────
function rebuildUI(node) {
    if (!node._osWrap) return;
    const wrap = node._osWrap;
    // 从配置恢复缩放比例
    const scale = node._osConfigs[0]?.scale ?? 1.0;
    wrap.style.setProperty("--os-scale", scale);
    wrap.classList.remove("locked"); // 移除旧全局锁定 class（向下兼容）
    wrap.innerHTML = "";

    const chCount = node._osChannelCount;

    for (let i = 0; i < chCount; i++) {
        const cfg = node._osConfigs[i] || Object.assign(defaultCfg(i + 1));
        const chIdx = i;
        const chLocked = !!cfg.locked;

        const row = document.createElement("div");
        row.className = "os-slider-row" + (chLocked ? " ch-locked" : "");

        // ── 轨道区域：根据样式分支构建 DOM ────────────────────────────
        // dragEl  = 绑定 pointer 事件的元素
        // posEl   = 计算拖动位置的参考元素
        let dragEl, posEl, updateDisplay;

        if (cfg.style === "fill") {
            row.setAttribute("data-style", "fill");
            // ── 填充滑条：文字行在上 + 细轨道在下 ──────────────────────
            const fillSlot = document.createElement("div");
            fillSlot.className = "os-fill-slot";

            // 文字行
            const fillText = document.createElement("div");
            fillText.className = "os-fill-text";
            const fillLabel = document.createElement("span");
            fillLabel.className = "os-fill-text-label";
            fillLabel.textContent = cfg.label || "双击设置滑条";
            const fillVal = document.createElement("span");
            fillVal.className = "os-fill-text-val";
            fillVal.style.color = cfg.textColor || cfg.color;
            fillText.appendChild(fillLabel);
            fillText.appendChild(fillVal);

            // 细轨道
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
            const tc = cfg.thumbColor || cfg.color;
            thumbEl.style.background = tc;
            rail.appendChild(rf);
            railWrap.appendChild(rail);
            railWrap.appendChild(thumbEl); // thumb 在 rail 外，不受 overflow:hidden 裁剪

            fillSlot.appendChild(fillText);
            fillSlot.appendChild(railWrap);

            // trackWrap 仍用于 refreshActiveState 的 active 样式，但填充模式不显示外圈
            const trackWrap = document.createElement("div");
            trackWrap.className = "os-track-wrap";
            trackWrap.setAttribute("data-style", "fill");
            trackWrap.appendChild(fillSlot);
            row.appendChild(trackWrap);

            dragEl = fillSlot;
            posEl  = railWrap;

            // updateDisplay 对填充样式
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
                fillLabel.textContent = cfg.label || "双击设置滑条";
            };

        } else {
            // ── 浮点滑条（默认）：标签+值嵌入轨道内 ────────────────
            const trackWrap = document.createElement("div");
            trackWrap.className = "os-track-wrap";

            const track = document.createElement("div");
            track.className = "os-track";

            const fill = document.createElement("div");
            fill.className = "os-fill";
            fill.style.background = cfg.color;

            const labelArea = document.createElement("div");
            labelArea.className = "os-label-area";
            labelArea.textContent = cfg.label || "双击设置滑条";
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
                labelArea.textContent = cfg.label || "双击设置滑条";
            };
        }

        // ── 右按钮列：🔓/🔒 锁定 + + 新增，并排 ──
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
            // 原地更新：锁定态只影响样式与交互开关（拖动处理实时读 cfg.locked），
            // 全量 rebuildUI 会造成高度抖动，不再使用
            row.classList.toggle("ch-locked", cfg.locked);
            lockBtn.classList.toggle("locked", cfg.locked);
            lockBtn.innerHTML = cfg.locked ? WS_ICONS.lock : WS_ICONS.lockOpen;
            lockBtn.setAttribute("data-tooltip", cfg.locked ? "点击解锁" : "上锁防误触");
            app.graph?.setDirtyCanvas(true, true);
        };
        // 每行只保留锁按钮（− / + 收拢到底部控制行，减少行宽占用）
        rightCol.appendChild(lockBtn);
        row.appendChild(rightCol);

        wrap.appendChild(row);

        // 初始渲染
        updateDisplay(parseFloat(cfg.value) || parseFloat(cfg.min) || 0);

        // ── 拖动交互（dragEl 绑定事件，posEl 计算位置）──────────────────
        let dragging = false;
        let _dragDirty = false;
        // 双击检测：pointerdown + setPointerCapture 会阻止浏览器生成 click/dblclick
        // 因此手动跟踪双击（两次 pointerdown 间隔 <400ms 且位移 <6px）
        node._osLastClick = node._osLastClick || { time: 0, x: 0, y: 0 };

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

        const syncWidget = () => {
            syncConfigToWidget(node, chIdx); // 同步 cfg + active_value 到后端
        };

        dragEl.addEventListener("pointerdown", e => {
            // ── 通道锁定检查：此条滑条锁定时禁止拖动与双击 ──
            // 必须实时读 cfg.locked，不能依赖 build 时捕获的 chLocked const
            if (cfg.locked) { e.stopPropagation(); return; }
            // ── 双击检测：两次 pointerdown 在 400ms 内、位移<6px 视为双击 ──
            const now = Date.now();
            const prev = node._osLastClick;
            const dt = now - prev.time;
            const dist = Math.hypot(e.clientX - prev.x, e.clientY - prev.y);
            node._osLastClick = { time: now, x: e.clientX, y: e.clientY };
            if (dt < 400 && dist < 6) {
                e.preventDefault();
                e.stopPropagation();
                node._osLastClick.time = 0; // 防止三击连续弹窗
                openSettingsPanel(node, chIdx, () => rebuildUI(node));
                return;
            }
            // ── 正常拖动（全通道激活，无需切换）──
            e.preventDefault();
            dragging = true;
            dragEl.closest(".os-track-wrap")?.classList.add("dragging");
            const newVal = valFromX(e.clientX);
            cfg.value = newVal;
            updateDisplay(newVal);
            const _avW = node._osHiddenWidgets?.["active_value"];
            if (_avW) _avW.value = cfg.type === "INT" ? Math.round(newVal) : newVal;
            dragEl.setPointerCapture(e.pointerId);
            syncWidget();
            app.graph?.change();
        });

        dragEl.addEventListener("pointermove", e => {
            if (!dragging) return;
            const newVal = valFromX(e.clientX);
            if (newVal !== cfg.value) {
                cfg.value = newVal;
                updateDisplay(newVal);
                const _avW = node._osHiddenWidgets?.["active_value"];
                if (_avW)
                    _avW.value = cfg.type === "INT" ? Math.round(newVal) : newVal;
                _dragDirty = true;  // 标记脏，延迟到 pointerup 统一同步
                app.graph?.setDirtyCanvas(true, true);
            }
        });

        dragEl.addEventListener("pointerup", () => {
            dragging = false;
            dragEl.closest(".os-track-wrap")?.classList.remove("dragging");
            if (_dragDirty) { syncWidget(); _dragDirty = false; }
            app.graph?.setDirtyCanvas(true, true);
            app.graph?.change();
            autoQueue(node);
        });
        dragEl.addEventListener("pointercancel", () => {
            dragging = false;
            dragEl.closest(".os-track-wrap")?.classList.remove("dragging");
            if (_dragDirty) { syncWidget(); _dragDirty = false; }
            app.graph?.setDirtyCanvas(true, true);
            app.graph?.change();
            autoQueue(node);
        });

        // 双击检测已集成到 pointerdown 中（Chromium 中 preventDefault+setPointerCapture 会阻止原生 dblclick）

        // ── 键盘无障碍：方向键调节滑条值 ──
        if (cfg.style !== "fill") {
            // 浮点滑条：trackWrap 是直接的轨道容器
            const tw = row.querySelector(".os-track-wrap");
            if (tw) _addKeyboardAccess(tw, node, cfg, chIdx, updateDisplay, syncWidget);
        } else {
            // 填充滑条：trackWrap 在 row 内部
            const tw = row.querySelector(".os-track-wrap[data-style='fill']");
            if (tw) _addKeyboardAccess(tw, node, cfg, chIdx, updateDisplay, syncWidget);
        }
    }

    // ── 底部控制行：单组 − / +（开通道数弹窗），替代每行重复按钮 ──
    const ctrlRow = document.createElement("div");
    ctrlRow.className = "os-ctrl-row";
    const mkCtl = (txt, tip, enabled) => {
        const b = document.createElement("button");
        b.className = "os-ctrl-btn";
        b.textContent = txt;
        b.setAttribute("data-tooltip", tip);
        b.style.opacity = enabled ? "1" : "0.35";
        b.style.cursor = enabled ? "pointer" : "not-allowed";
        b.onclick = (e) => { e.stopPropagation(); openChannelCountPopover(node, b); };
        return b;
    };
    ctrlRow.appendChild(mkCtl("−", chCount > 1 ? "减少滑条" : "至少保留1根", chCount > 1));
    ctrlRow.appendChild(mkCtl("+", chCount < getMaxChannels() ? "新增滑条" : `已达上限${getMaxChannels()}根`, chCount < getMaxChannels()));
    wrap.appendChild(ctrlRow);

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
}

function updateSize(node) {
    if (!node.size) node.size = [340, 100];
    if (node.size[0] < 280) node.size[0] = 280;
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
    const isVue = !!document.querySelector(`[data-node-id="${node.id}"]`);
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
    requestAnimationFrame(() => {
        if (!node.size) return;
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
    // 完整隐藏方式：hidden=true + computeSize=[0,0]
    // 确保 widget 仍在 node.widgets 数组中（ComfyUI 序列化依赖此），但不占 UI 空间
    // 策略：absolute 脱离文档流 + 扔出视口 + pointer-events:none，比 display:none 更彻底
    // 因为 Nodes 2.0 的 flex 布局会对 display:none 的兄弟容器仍分配间隙
    const _hideEl = (el, addClass = false) => {
        if (!el || el.nodeType !== 1) return;
        const s = el.style;
        s.setProperty("position", "absolute", "important");
        s.setProperty("left", "-9999px", "important");
        s.setProperty("top", "-9999px", "important");
        s.setProperty("width", "0", "important");
        s.setProperty("height", "0", "important");
        s.setProperty("min-width", "0", "important");
        s.setProperty("min-height", "0", "important");
        s.setProperty("max-width", "0", "important");
        s.setProperty("max-height", "0", "important");
        s.setProperty("overflow", "hidden", "important");
        s.setProperty("padding", "0", "important");
        s.setProperty("margin", "0", "important");
        s.setProperty("border", "none", "important");
        s.setProperty("pointer-events", "none", "important");
        s.setProperty("opacity", "0", "important");
        s.setProperty("visibility", "hidden", "important");
        if (addClass) el.classList.add("wosai-hidden-widget");
    };
    const _hideWidgetRow = (childEl, root) => {
        // 从子元素向上走 8 层，将所有祖先容器全部扔出文档流
        let p = childEl.parentElement;
        for (let i = 0; i < 8 && p && p !== root && p !== document.body && p !== document.documentElement; i++) {
            _hideEl(p);
            p = p.parentElement;
        }
    };
    function hideWidget(w) {
        // w.type 不变 —— type 变 "hidden" 会导致 Nodes2.0 跳过序列化
        // w.hidden 保留但补充显式序列化标记
        w.hidden = true;
        // GJJ 标准藏参五件套（gjj_utils.js / sigmas_editor.js 实测验证）
        w.computeSize = () => [0, 0];
        w.getHeight = () => 0;
        w.draw = () => {};
        w.label = "";
        // ⭐ 关键布局属性：last_y=0 而非负值（GJJ 代码注释明确警告「必须 0」）
        w.last_y = 0;
        w.computedHeight = 0;
        w.margin_top = 0;
        w.size = [0, 0];
        // ⭐ ComfyUI v10 新版布局引擎使用 computeLayoutSize（而非 computeSize）
        // 计算 widget 行高，未覆盖时每个隐藏 widget 仍占 ~24px → 节点顶部大片空白
        w.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, height: 0, minWidth: 0 });
        // 显式标记可序列化，防止某些 ComfyUI 版本对 hidden widget 自动设 serialize:false
        if (w.options) {
            w.options.serialize = true;
        } else if (w.options !== false) {
            w.options = { serialize: true };
        }
        const el = w.element || w.dom;
        if (el) {
            _hideEl(el, true);
            _hideWidgetRow(el, node.element || node.dom);
        }
    }

    // ═══ 确保 node.widgets 是数组（ComfyUI v10 可能不是数组）══════════
    if (!Array.isArray(node.widgets)) node.widgets = [];

    if (node.widgets) {
        const allNames = node.widgets.map(w => `${w.name}(${w.type})`);
        for (const w of node.widgets) {
            if (w.name === "active_value") {
                node._osHiddenWidgets["active_value"] = w;
                hideWidget(w);
            } else if (w.name === "channel_count") {
                node._osChannelCount = Math.max(1, Math.min(getMaxChannels(), parseInt(w.value) || 1));
                node._osHiddenWidgets["channel_count"] = w;
                hideWidget(w);
            } else if (w.name === "active_channel") {
                // 保留隐藏 widget 用于序列化兼容，全通道激活模式下不再依赖此值
                node._osHiddenWidgets["active_channel"] = w;
                hideWidget(w);
            } else if (w.name && /^ch\d+_cfg$/.test(w.name)) {
                const idx = parseInt(w.name.match(/^ch(\d+)_cfg$/)[1]) - 1;
                node._osConfigs[idx] = Object.assign(defaultCfg(idx + 1), parseCfg(w.value));
                node._osHiddenWidgets[w.name] = w;
                hideWidget(w);
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
    // 注释说明：内部缓存键 — 自动同步滑条值，用于触发工作流重执行，勿手动修改
    const avWidget = node._osHiddenWidgets["active_value"];
    if (avWidget) {
        const newTip = "内部缓存键，自动同步滑条值";
        avWidget.tooltip = newTip;
        const el = avWidget.element || avWidget.dom;
        if (el) {
            // 同时更新 DOM title（经典节点模式悬浮提示的源头）
            el.title = newTip;
            // 如果有内部的 input/textarea，也可能挂了 title
            const inner = el.querySelector("input,textarea,[title]");
            if (inner) inner.title = newTip;
        }
    }

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
    setTimeout(() => updateOutputLabel(node), 80);

    const MIN_WIDTH = 280;
    const dw = node.addDOMWidget("os_ui", "os_panel", wrap, {
        getMinHeight: () => _calcContentH(node),
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
    let _divTries = 0;
    const _tryDivider = () => {
        if (_removeDivider() || ++_divTries >= 6) return;
        requestAnimationFrame(_tryDivider);
    };
    requestAnimationFrame(_tryDivider);

    // ── Nodes 2.0 兼容：多策略隐藏内部 widget ─────────────────────────────────
    // 目标：隐藏 active_value / channel_count / active_channel / ch1_cfg~ch10_cfg
    // ⚠ 名单必须覆盖 Python 端全量定义（10 个 cfg），与前端上限设置无关——
    //   曾硬编码到 ch5 导致 ch6_cfg 原生框在 Nodes 2.0 泄漏显示
    const HIDDEN_WIDGET_NAMES = ["active_value", "channel_count", "active_channel",
        ...Array.from({ length: 10 }, (_, i) => `ch${i + 1}_cfg`)];

    // 策略1: 通过 widget.element 直接隐藏（经典模式有效）
    const _hideByWidgetEl = (root) => {
        for (const name of HIDDEN_WIDGET_NAMES) {
            const w = node._osHiddenWidgets?.[name];
            if (!w) continue;
            const we = w.element || w.dom || w.inputEl;
            if (we && we.parentElement) {
                _hideEl(we, true);
                _hideWidgetRow(we, root);
            }
        }
    };

    // 策略2: 在 node.element DOM 中，隐藏 DOM widget 容器之前的所有原生 widget 行
    // Nodes 2.0 中隐藏字段渲染为 DOM 元素，位于我们的 osWrap 之前
    const _hideByDomPosition = (root) => {
        const wrap = node._osWrap;
        if (!wrap) return false;
        // 找到 wrap 在 root 内的最近祖先
        let ourContainer = wrap;
        while (ourContainer.parentElement && ourContainer.parentElement !== root) {
            ourContainer = ourContainer.parentElement;
        }
        if (!ourContainer || ourContainer === root) return false;
        // 隐藏 osWrap 之前的所有 widget 行。
        // v10/Nodes 2.0 中 FLOAT/INT widget 渲染为 div 行（无 <input>），
        // 旧版只匹配 input 行导致这些行保留高度 → 滑条上方大片空白。
        // 唯一保护对象：含 slot/socket 标记的行（输出端口等）不动。
        const SLOT_GUARD = '[class*="slot"], [class*="socket"], [data-testid*="slot"], .lg-slot, .output, .outputs';
        let found = false;
        let prev = ourContainer.previousElementSibling;
        while (prev) {
            const isSlotRow = prev.matches?.(SLOT_GUARD) || prev.querySelector?.(SLOT_GUARD);
            if (!isSlotRow) {
                prev.style.setProperty("display", "none", "important");
                prev.style.setProperty("height", "0", "important");
                prev.style.setProperty("min-height", "0", "important");
                prev.style.setProperty("margin", "0", "important");
                prev.style.setProperty("padding", "0", "important");
                prev.style.setProperty("overflow", "hidden", "important");
                found = true;
            }
            prev = prev.previousElementSibling;
        }
        return found;
    };

    // 策略3: MutationObserver 监听后续动态渲染的 widget
    const _hiddenElementObserver = new MutationObserver(() => {
        const root = node.element || node.dom;
        if (!root) return;
        _hideByWidgetEl(root);
        _hideByDomPosition(root);
    });
    node._osHiddenObserver = _hiddenElementObserver;

    let _hideTries = 0;
    const _tryHideHiddenWidgets = () => {
        const root = node.element || node.dom;
        if (!root) {
            if (++_hideTries < 20) setTimeout(_tryHideHiddenWidgets, 150);
            return;
        }
        _hiddenElementObserver.observe(root, { childList: true, subtree: true });
        _hideByWidgetEl(root);
        const collapsed = _hideByDomPosition(root);
        // ⭐ 隐藏后必须刷新节点尺寸，否则空白不会消失（SKILL 检查清单）
        if (collapsed) updateSize(node);
        // 延迟二次确认（Nodes 2.0 Vue 渲染可能在下一帧完成）
        if (_hideTries++ < 5) setTimeout(_tryHideHiddenWidgets, 300);
    };
    requestAnimationFrame(_tryHideHiddenWidgets);

    // ── 核武器隐藏所有原生 widget（Nodes 2.0 兼容） ──
    // 策略：全局 CSS 规则（按 name 匹配）+ MutationObserver + rAF 帧同步兜底
    {
        const STYLE_ID = "wosai-os-hide-av-global";
        if (!document.getElementById(STYLE_ID)) {
            const s = document.createElement("style");
            s.id = STYLE_ID;
            const rules = [];
            for (const n of HIDDEN_WIDGET_NAMES) {
                rules.push(
                    `[data-testid="node-widget"]:has([aria-label="${n}"])`,
                    `.lg-node-widget:has([aria-label="${n}"])`,
                    `.lg-node-widget:has([data-path*="${n}"])`,
                    `.lg-node-widget:has(input[name="${n}"])`,
                );
            }
            s.textContent = rules.join(",") + `{display:none!important;visibility:hidden!important;height:0!important;min-height:0!important;max-height:0!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important;padding:0!important;margin:0!important;border:none!important;}`;
            document.head.appendChild(s);
        }

        // 兜底主动隐藏：找 osWrap 之前的原生 widget input 并隐藏
        // 使用 compareDocumentPosition 精准定位（而非 contains 全扫）
        const _nukeHidden = () => {
            if (!node._osWrap) return;
            const root = node.element || node.dom;
            if (!root) return;
            const inputs = root.querySelectorAll("input, textarea");
            for (const inp of inputs) {
                if (!inp.offsetParent) continue;
                // 只隐藏位于 osWrap 之前的元素（文档顺序）
                const pos = inp.compareDocumentPosition(node._osWrap);
                if (pos & Node.DOCUMENT_POSITION_FOLLOWING) continue;
                // 跳过已隐藏的（被全局 CSS 处理）
                if (inp.closest(".wosai-hidden-widget")) continue;
                let el = inp;
                while (el && el !== root) {
                    el.style.setProperty("display", "none", "important");
                    el.style.setProperty("visibility", "hidden", "important");
                    el.style.setProperty("height", "0", "important");
                    el.style.setProperty("overflow", "hidden", "important");
                    el = el.parentElement;
                }
            }
        };

        // 策略1: MutationObserver — 仅在 DOM 变化时被动触发
        let _nukeObserver = null;
        const _startObserver = () => {
            const root = node.element || node.dom;
            if (!root || _nukeObserver) return;
            _nukeObserver = new MutationObserver((mutations) => {
                if (mutations.some(m => m.addedNodes.length > 0)) _nukeHidden();
            });
            _nukeObserver.observe(root, { childList: true, subtree: true });
        };
        // 延迟启动 observer（等待 DOM 就绪）
        let _obsTries = 0;
        const _tryObs = () => {
            const root = node.element || node.dom;
            if (root) { _startObserver(); _nukeHidden(); return; }
            if (++_obsTries < 20) setTimeout(_tryObs, 150);
        };
        requestAnimationFrame(_tryObs);

        // 注：原"策略2 rAF 帧同步兜底"已移除——computeLayoutSize 归零 +
        // MutationObserver 已完整覆盖隐藏需求，常驻 rAF 循环在多节点场景
        // 下白耗 CPU（每节点一个循环），对低配设备不友好。

        // 节点销毁时清理
        node._nukeObserver = _nukeObserver;
        const _origOnRemoved = (() => {
            const f = node.onRemoved;
            return typeof f === 'function' ? f : null;
        })();
        node.onRemoved = function () {
            // nuke 清理
            if (node._nukeObserver) { node._nukeObserver.disconnect(); node._nukeObserver = null; }
            if (node._osHiddenObserver) { node._osHiddenObserver.disconnect(); node._osHiddenObserver = null; }
            if (node._osWidthObserver) { node._osWidthObserver.disconnect(); node._osWidthObserver = null; }
            // 通用清理
            node._osWrap = null;
            if (_origOnRemoved) _origOnRemoved.call(this);
        };
        // 首帧立即执行
        requestAnimationFrame(() => { requestAnimationFrame(_nukeHidden); });
    }

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
    let _calTries = 0;
    const _tryCal = () => {
        if (_calibrate() || ++_calTries >= 10) return;
        requestAnimationFrame(_tryCal);
    };
    requestAnimationFrame(_tryCal);

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
        const _avW2 = this._osHiddenWidgets?.["active_value"];
        if (_avW2) {
            // 注释说明：内部缓存键 — 自动同步滑条值，用于触发工作流重执行，勿手动修改
            const newTip = "内部缓存键，自动同步滑条值";
            _avW2.tooltip = newTip;
            const el2 = _avW2.element || _avW2.dom;
            if (el2) { el2.title = newTip; const inr = el2.querySelector("input,textarea,[title]"); if (inr) inr.title = newTip; }
        }
        // 从 _osHiddenWidgets 读取（proxy widget 已被 _origOnConfigure 写回 workflow 值）
        const ccW = this._osHiddenWidgets?.["channel_count"];
        if (ccW) this._osChannelCount = Math.max(1, Math.min(getMaxChannels(), parseInt(ccW.value) || 1));
        for (let i = 0; i < getMaxChannels(); i++) {
            const cw = this._osHiddenWidgets?.[`ch${i + 1}_cfg`];
            if (cw) this._osConfigs[i] = Object.assign(defaultCfg(i + 1), parseCfg(cw.value));
        }
        rebuildUI(this);
        syncOutputPorts(this); // 兜底：确保端口数与 channel_count 匹配
        syncActiveValue(this); // 恢复 active_value
        setTimeout(() => updateOutputLabel(this), 80);
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
            tooltip: '重新添加节点后生效',
            // 双保险：任何路径写入超限值都立即钳回
            onChange: (v) => {
                const n = parseInt(v);
                if (n > 6) { try { app.ui.settings.setSettingValue(SETTING_MAX_CH, 6); } catch (e) {} }
            },
        },
    ],

    setup() {
        try {
            const v = parseInt(app.ui?.settings?.getSettingValue?.(SETTING_MAX_CH));
            if (v > 6) app.ui.settings.setSettingValue(SETTING_MAX_CH, 6);
        } catch (e) {}
        if (!document.getElementById("wosai-os-slider-css") && !document.querySelector('link[href*="os-slider.css"]')) {
            const link = document.createElement("link");
            link.id = "wosai-os-slider-css";
            link.rel = "stylesheet";
            link.href = "/extensions/WOSAI-ComfyUI/css/os-slider.css";
            document.head.appendChild(link);
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
