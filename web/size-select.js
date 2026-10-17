import { app } from "../../scripts/app.js";
import { t, applyNodeDefTranslation, onLangChange } from "./shared/i18n.js";
import { WOSAI_COPYRIGHT } from "./shared/constants.js";
import { getWOSAIVar } from "./shared/shared-utils.js";

async function loadResolutionData() {
    const response = await fetch(new URL("./data/resolutions.json", import.meta.url));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

const RESOLUTION_CONFIG = await loadResolutionData();
const PATCH_KEY = "__wosaiSizeSelectPatch";
let _offLangChange = null;
let _injectedCss = null;

// 自定义模式**不设上限**（与 Scale 模式一致）：该键只作为「自定义高度」的初始值，不是上限。
const DEFAULT_CUSTOM_HEIGHT = RESOLUTION_CONFIG.default_custom_height;
const MIN_DIMENSION = RESOLUTION_CONFIG.min_dimension;
// 与 nodes/size_select.py::DEFAULT_ALIGN_MULTIPLE 同值：默认 8（SD / SDXL / Flux 的
// latent 空间压缩率）。节点上的 align_multiple（advanced）可覆盖。
const DEFAULT_ALIGN_MULTIPLE = 8;
const DEFAULT_RES = RESOLUTION_CONFIG.default_resolution;
const DEFAULT_RATIO = RESOLUTION_CONFIG.default_ratio;

const HIDDEN_PORTS = new Set([
    "Manual_Mode", "Resolution", "Aspect_Ratio",
    "Custom_Width", "Custom_Height",
    "scale_method", "scale_multiplier",
]);

/* 语言切换时 ComfyUI 会用后端最新 nodeDef 按 name 逐一比对端口是否已存在。
   旧方案通过 applyNodePortTranslation 改写 port.name（"image"→"图像"），
   导致 Vue 层找不到匹配，直接 push 新端口到 node.inputs 造成重复。

   第一性原理修复：不碰 port.name（始终保留原始英文名用于匹配），
   只设 port.label（LiteGraph 显示用字段）。这样 Vue 的 name 比对
   永远能找到匹配，从根本上杜绝重复端口产生，不再需要轮询猜时机。*/
function _normalizeInputs(node) {
    if (!node.inputs) return;
    const byKey = new Map();
    for (const port of node.inputs) {
        const key = port._wosaiOrigName ?? port.name;
        const existing = byKey.get(key);
        if (!existing || (existing.link == null && port.link != null)) {
            byKey.set(key, port);
        }
    }
    const kept = [...byKey.values()].filter(i => !HIDDEN_PORTS.has(i._wosaiOrigName ?? i.name));
    const changed = kept.length !== node.inputs.length || kept.some((p, idx) => p !== node.inputs[idx]);
    if (changed) node.inputs.splice(0, node.inputs.length, ...kept);
}

// 仅设 port.label 用于显示，不改 port.name（保持与 nodeDef 一致，防止 Vue 误判端口缺失）
function _applyPortLabel(node) {
    if (!node?.type) return;
    for (const [ports, section] of [[node.inputs, 'inputs'], [node.outputs, 'outputs']]) {
        if (!ports) continue;
        for (const port of ports) {
            if (port._wosaiOrigName == null) port._wosaiOrigName = port.name;
            const key = `nodeDefs.${node.type}.${section}.${port._wosaiOrigName}.name`;
            const trans = t(key);
            if (trans !== key && trans !== port.label) {
                port.label = trans;
            }
        }
    }
}

const RESOLUTION_DATA = RESOLUTION_CONFIG.resolutions;

const ASPECT_RATIO_LABELS = {
    "3:2":   "3:2 Classic",
    "2:3":   "2:3 Photo",
    "4:3":   "4:3 Standard",
    "3:4":   "3:4 Portrait",
    "16:9":  "16:9 Widescreen",
    "9:16":  "9:16 Mobile",
    "21:9":  "21:9 Ultrawide",
    "1:1":   "1:1 Square",
};

const ASPECT_ROWS = [
    ["9:16", "16:9", "21:9", "1:1"],
    ["3:2",  "2:3",  "4:3",  "3:4"],
];

const RATIO_ICON = {
    "3:2":  [33, 22], "2:3":  [22, 33],
    "4:3":  [28, 22], "3:4":  [22, 28],
    "16:9": [36, 20], "9:16": [20, 36],
    "21:9": [42, 18],
    "1:1":  [22, 22],
};

const _RES_LABEL_MAP = {
  "SD 480P":  "res480P",
  "HD 720P":  "res720P",
  "FHD 1080P": "res1080P",
  "QHD 2K+": "res2K",
};

// 预览行不再带「尺寸预览」标签：节点最小宽度 220px，四个字要吃掉约 44px，
//   留着它必然把后面的尺寸 / 面积挤出节点框，而「宽 × 高」本身已自解释。
function getFixedHeight(manual) {
    // 5 输出端口(INT×2 + LATENT + IMAGE + MASK) + 缩放区两行(按钮+滑条)
    return manual ? 375 : 455;
}

// 紧致 viewBox：SVG 恰好包住线框（无内边空隙），icon 与文字间距即真实 gap，
// 组团在按钮内真正居中（旧版固定方形画布导致 icon 两侧有幽灵空白、视觉偏移）
function _buildIcon(ratio, H) {
    const [rw, rh] = RATIO_ICON[ratio] || [24, 24];
    const sc = H / Math.max(rw, rh);          // 长边贴齐目标高度
    const w  = Math.max(6, Math.round(rw * sc));
    const h  = Math.max(6, Math.round(rh * sc));
    const lw = 1.0, pad = 1.5;                 // 线宽 1.0（细线版），pad 保持 1.5 留足抗锯齿空间
    const vw = w + pad * 2, vh = H + pad * 2;  // 高度盒统一为 H（垂直居中）
    const y  = pad + Math.round((H - h) / 2);
    return `<svg width="${vw}" height="${vh}" viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg">`
         + `<rect x="${pad}" y="${y}" width="${w}" height="${h}" rx="2" ry="2" `
         + `fill="none" stroke="currentColor" stroke-width="${lw}"/></svg>`;
}

const ICON_CACHE_SM = Object.fromEntries(Object.keys(RATIO_ICON).map(r => [r, _buildIcon(r, 13)]));

function waitForWidgets(node, names, cb, timeout = 3000) {
    let cancelled = false;
    const deadline = performance.now() + timeout;
    const check = () => {
        if (cancelled || node?.is_removed) return;
        if (node.widgets && names.every(n => node.widgets.some(w => w.name === n))) {
            cb();
            return;
        }
        if (performance.now() >= deadline) {
            console.warn("[SizeSelect] Waiting for widgets timed out:", names);
            return;
        }
        requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
    return () => { cancelled = true; };
}

function _shortAsp(label) {
    if (!label) return DEFAULT_RATIO.split(" ")[0];
    const i = label.indexOf(" ");
    return i > 0 ? label.slice(0, i) : label;
}

// 对齐粒度：与后端 `_align()` 同源 —— **四舍五入**（不是向下取整），
//   且 .5 取偶（roundHalfToEven），这样前端预览与后端算出的尺寸逐像素一致。
//   后端还要再叠一层 latent 压缩率（lcm），前端拿不到真实压缩率，故只按粒度换算。
function roundHalfToEven(v) {
    const f = Math.floor(v);
    return v - f === 0.5 ? (f % 2 === 0 ? f : f + 1) : Math.round(v);
}

function gridStep(multiple) {
    return Math.max(1, Math.floor(Number(multiple)) || DEFAULT_ALIGN_MULTIPLE);
}

function alignTo(v, multiple = DEFAULT_ALIGN_MULTIPLE) {
    const step = gridStep(multiple);
    const n = Math.max(MIN_DIMENSION, Number(v) || MIN_DIMENSION);
    return Math.max(step, roundHalfToEven(n / step) * step);
}

function scaleAlign(v, multiple = DEFAULT_ALIGN_MULTIPLE) {
    const step = gridStep(multiple);
    return Math.max(step, roundHalfToEven((Number(v) || 0) / step) * step);
}

// 面积预算提示阈值（MP）：显存 / 耗时正比于像素总量，而不是单边长度。
//   参考口径：SDXL / Flux 常用 1 MP，2K 档约 3.5 MP。
const AREA_HINT_MP = 4;
const AREA_WARN_MP = 8;

const _mqlReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
const _prefersReducedMotion = () => _mqlReducedMotion?.matches ?? false;

function buildUI(node) {
    try {
    // CSS 已通过 extension.json 加载

    // 注入节点元信息（cnr_id + ver），对齐 ComfyUI 内置节点属性面板格式
    node.properties = node.properties || {};
    if (!node.properties.cnr_id) node.properties.cnr_id = "custom-nodes/WOSAI-ComfyUI";
    if (!node.properties.ver) node.properties.ver = "1.0";
    delete node.properties.aux_id;

    _normalizeInputs(node);

    let _cancelWidgetWait = null;
    let _resizeObserver = null;
    let _widgetObserver = null;
    const _ac = new AbortController();

    const _origOnRemoved = node.onRemoved;
    node.onRemoved = () => {
        _cancelWidgetWait?.();
        _resizeObserver?.disconnect();
        _widgetObserver?.disconnect();
        _ac.abort();
        _origOnRemoved?.();
    };

    if (node.widgets) {
        for (const w of node.widgets) {
            w.hidden = true;
            w.computeSize = () => [0, -4];
        }
    }

    const _origOnConfigure = node.onConfigure;
    node.onConfigure = function (info) {
        _origOnConfigure?.apply(this, arguments);
        if (Array.isArray(info?.widgets_values) && info.widgets_values.length > 0 && node.size) {
            const isMan = info.widgets_values[0] === "on";
            node.size[1] = getFixedHeight(isMan);
        }
    };

    _cancelWidgetWait = waitForWidgets(node, ["Resolution", "Aspect_Ratio", "Manual_Mode", "scale_method", "scale_multiplier", "fit_edge"], () => {
        const resW = node.widgets.find(w => w.name === "Resolution");
        const aspW = node.widgets.find(w => w.name === "Aspect_Ratio");
        const manW = node.widgets.find(w => w.name === "Manual_Mode");
        const cusW = node.widgets.find(w => w.name === "Custom_Width");
        const cusH = node.widgets.find(w => w.name === "Custom_Height");
        const scmW = node.widgets.find(w => w.name === "scale_method");
        const sclW = node.widgets.find(w => w.name === "scale_multiplier");
        const fedW = node.widgets.find(w => w.name === "fit_edge");
        const almW = node.widgets.find(w => w.name === "align_multiple");

        if (manW) manW.label = t('menus.sizeSelect.manualMode');
        if (resW) resW.label = t('menus.sizeSelect.resolution');
        if (aspW) aspW.label = t('menus.sizeSelect.aspectRatio');
        if (cusW) cusW.label = t('menus.sizeSelect.customWidth');
        if (cusH) cusH.label = t('menus.sizeSelect.customHeight');
        if (scmW) scmW.label = t('menus.sizeSelect.scaleMethod');
        if (sclW) sclW.label = t('menus.sizeSelect.scaleMultiplier');
        if (fedW) fedW.label = t('menus.sizeSelect.fitEdge');
        if (almW) almW.label = t('menus.sizeSelect.alignMultiple');
        for (const _hw of [scmW, sclW, fedW]) {
            if (!_hw) continue;
            _hw.hidden = true;
            _hw.computeSize = () => [0, 0];
            _hw.getHeight = () => 0;
            _hw.draw = () => {};
            _hw.last_y = 0;
            _hw.computedHeight = 0;
            _hw.margin_top = 0;
            _hw.size = [0, 0];
            _hw.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, height: 0, minWidth: 0 });
            if (_hw.options) _hw.options.serialize = true; else _hw.options = { serialize: true };
            const _el = _hw.element || _hw.dom;
            if (_el) {
                _el.style.setProperty('display', 'none', 'important');
                _el.style.setProperty('height', '0', 'important');
                _el.style.setProperty('margin', '0', 'important');
                _el.style.setProperty('padding', '0', 'important');
            }
        }

        if (cusW) cusW.value = alignTo(cusW.value, gridStep(almW?.value));
        if (cusH) cusH.value = alignTo(cusH.value, gridStep(almW?.value));

        let currentRes = (resW?.value && RESOLUTION_DATA[resW.value]) ? resW.value : DEFAULT_RES;
        if (resW && resW.value !== currentRes) resW.value = currentRes;
        const _aspShort = _shortAsp(aspW?.value);
        let currentAsp = (aspW?.value && RESOLUTION_DATA[currentRes]?.[_aspShort]) ? _aspShort : DEFAULT_RATIO.split(" ")[0];
        const _aspLabel = ASPECT_RATIO_LABELS[currentAsp] || currentAsp;
        if (aspW && aspW.value !== _aspLabel) aspW.value = _aspLabel;

        let isManual         = manW?.value === "on";
        let baseWidth        = cusW?.value || MIN_DIMENSION;
        let baseHeight       = cusH?.value || DEFAULT_CUSTOM_HEIGHT;
        let _updatingDisplay = false;
        let _applyingMode    = false;
        let _targetHeight    = getFixedHeight(isManual);

        const _origOrder = new Map();
        node.widgets.forEach((w, i) => _origOrder.set(w, i));

        const _origSerialize = node.serialize?.bind(node);
        node.serialize = function () {
            const data = _origSerialize ? _origSerialize() : {};
            const coreWidgets = [manW, scmW, sclW, resW, aspW, cusW, cusH, almW, fedW].filter(Boolean);
            data.widgets_values = coreWidgets
                .filter(w => w.options?.serialize !== false)
                .map(w => w.value);
            return data;
        };

        function setWidgetVis(widget, vis) {
            if (!widget || !node.widgets) return;
            widget.hidden = !vis;
            widget.computeSize = vis ? undefined : () => [0, -4];
            if (widget.element) widget.element.style.display = vis ? "" : "none";
            if (widget.inputEl)  widget.inputEl.style.display  = vis ? "" : "none";
            const inArray = node.widgets.includes(widget);
            if (!vis && inArray) {
                node.widgets.splice(node.widgets.indexOf(widget), 1);
            } else if (vis && !inArray) {
                const targetOrig = _origOrder.get(widget) ?? Infinity;
                let insertAt = 0;
                for (let i = 0; i < node.widgets.length; i++) {
                    if ((_origOrder.get(node.widgets[i]) ?? Infinity) < targetOrig) insertAt = i + 1;
                }
                node.widgets.splice(insertAt, 0, widget);
            }
        }

        // 默认宽度 250px（下拉框文字完整显示），最小硬限 220px
        node.minSize = [220, 150];
        if (node.size && node.size[0] < 220) node.size[0] = 250;

        const wrap = document.createElement("div");
        wrap.className = "ss-wrap" + (isManual ? " ss-mode-manual" : " ss-mode-preset");
        wrap.setAttribute("translate", "no");
        wrap.style.width = (node.size?.[0] || 250) + "px";

        const contentDiv = document.createElement("div");
        contentDiv.className = "ss-content";
        wrap.appendChild(contentDiv);

        // ── 5按钮控制行（预设｜自定义｜裁剪｜适配｜缩放） ──
        const controlRow = document.createElement("div");
        controlRow.className = "ss-control-row";

        const btnAuto = document.createElement("button");
        btnAuto.className = `ss-control-btn${!isManual ? " active" : ""}`;
        btnAuto.textContent = t('menus.sizeSelect.preset');

        const btnMan = document.createElement("button");
        btnMan.className = `ss-control-btn${isManual ? " active" : ""}`;
        btnMan.textContent = t('menus.sizeSelect.manual');

        // 缩放方式三选一：Crop=裁到目标比例 / Fit=等比装入目标框 / Scale=按倍数缩放
        const _ssMethod = () => (scmW?.value === "Scale" || scmW?.value === "Fit") ? scmW.value : "Crop";

        const btnCrop = document.createElement("button");
        btnCrop.className = "ss-control-btn" + (_ssMethod() === "Crop" ? " active" : "");
        btnCrop.textContent = t('menus.sizeSelect.crop');
        btnCrop.title = t('menus.sizeSelect.tipCrop');

        const btnFit = document.createElement("button");
        btnFit.className = "ss-control-btn" + (_ssMethod() === "Fit" ? " active" : "");
        btnFit.textContent = t('menus.sizeSelect.fit');
        btnFit.title = t('menus.sizeSelect.tipFit');

        const btnScale = document.createElement("button");
        btnScale.className = "ss-control-btn" + (_ssMethod() === "Scale" ? " active" : "");
        btnScale.textContent = t('menus.sizeSelect.scale');
        btnScale.title = t('menus.sizeSelect.tipScale');

        node._ss_btnAuto = btnAuto;
        node._ss_btnMan = btnMan;
        node._ss_btnCrop = btnCrop;
        node._ss_btnFit = btnFit;
        node._ss_btnScale = btnScale;

        controlRow.append(btnAuto, btnMan, btnCrop, btnFit, btnScale);
        contentDiv.appendChild(controlRow);

        // 第二行：缩放倍数一体式轨道（复用 OmniSlider os-track 样式，无圆点）
        const sliderRow = document.createElement("div");
        sliderRow.className = "ss-scale-slider-row";
        const track = document.createElement("div");
        track.className = "ss-scale-track";
        const fill = document.createElement("div");
        fill.className = "ss-scale-fill";
        const labelArea = document.createElement("div");
        labelArea.className = "ss-scale-label";
        const initVal = parseFloat(sclW?.value) || 1.0;
        const _initPrefix = scmW?.value === "Scale" ? t('menus.sizeSelect.originalImage') : t('menus.sizeSelect.scalingFactor');
        labelArea.textContent = _initPrefix + "  ×" + initVal.toFixed(1);
        node._ss_labelArea = labelArea;

        track.append(fill, labelArea);
        sliderRow.appendChild(track);
        node._ss_sliderRow = sliderRow;
        // 稍后追加到 wrap，位置在尺寸预览上方

        // ── Fit 模式的长边 / 短边适配（复用滑条同一行，不新增行高）──
        //   与「缩放倍数」互斥出现：Scale 显示滑条，Fit 显示这两个按钮，Crop 两者都不激活。
        const fitEdgeGroup = document.createElement("div");
        fitEdgeGroup.className = "ss-fit-edge-group";
        const _ssFitEdge = () => (fedW?.value === "Short") ? "Short" : "Long";
        const mkEdgeBtn = (key, edge) => {
            const b = document.createElement("button");
            b.className = "ss-control-btn" + (_ssFitEdge() === edge ? " active" : "");
            b.dataset.edge = edge;
            b.textContent = t('menus.sizeSelect.' + key);
            b.title = t('menus.sizeSelect.' + (edge === "Short" ? 'tipFitShort' : 'tipFitLong'));
            b.onclick = () => {
                if (fedW) { fedW.value = edge; fedW.callback?.(edge); }
                _ssSyncFitEdgeBtns();
                syncPreview();
                app.graph?.setDirtyCanvas(true, true);
            };
            return b;
        };
        const btnEdgeLong  = mkEdgeBtn('fitLong', "Long");
        const btnEdgeShort = mkEdgeBtn('fitShort', "Short");
        function _ssSyncFitEdgeBtns() {
            const cur = _ssFitEdge();
            btnEdgeLong.classList.toggle("active", cur === "Long");
            btnEdgeShort.classList.toggle("active", cur === "Short");
            fitEdgeGroup.title = t('menus.sizeSelect.tipFitEdge');
        }
        fitEdgeGroup.append(btnEdgeLong, btnEdgeShort);
        track.appendChild(fitEdgeGroup);

        // ── 一体式轨道显示更新 ──
        const _ssMn = 0.1, _ssMx = 4.0, _ssSt = 0.1;

        const _ssUpdateTrack = (val) => {
            const pct = _ssMx !== _ssMn ? Math.max(0, Math.min(1, (val - _ssMn) / (_ssMx - _ssMn))) : 0;
            fill.style.width = (pct * 100) + "%";
            const prefix = scmW?.value === "Scale" ? t('menus.sizeSelect.originalImage') : t('menus.sizeSelect.scalingFactor');
            labelArea.textContent = prefix + "  ×" + val.toFixed(1);
            // 填充覆盖文字区域时改为白色
            labelArea.style.color = pct > 0.5 ? getWOSAIVar('--ws-text-on-accent') : "";
        };
        _ssUpdateTrack(initVal);

        // ── 缩放方式按钮事件 ──
        // ── 缩放倍数滑条锁定/解锁（仅 Scale 模式可拖动） ──
        //   同一行还承载 Fit 模式的「长边 / 短边」切换：三者互斥，行高不变。
        const _ssSetSliderLock = (val) => {
            if (!sliderRow) return;
            const isScale = val === "Scale";
            const isFit = val === "Fit";
            sliderRow.classList.toggle("ss-disabled", !isScale);
            // Crop 保持旧语义：整行不可点（滑条对它没有意义）；Fit 要留给适配边按钮
            sliderRow.style.pointerEvents = (isScale || isFit) ? "" : "none";
            sliderRow.title = isScale ? t('menus.sizeSelect.tipScaleMul')
                : (isFit ? t('menus.sizeSelect.tipFitEdge') : t('menus.sizeSelect.scaleOnly'));
            track.style.cursor = isScale ? "ew-resize" : "default";
            fill.style.display = isScale ? "" : "none";
            labelArea.style.display = isScale ? "" : "none";
            fitEdgeGroup.style.display = isFit ? "flex" : "none";
        };

        const _ssSyncMethodBtns = (val) => {
            const m = _ssMethod();
            btnCrop.classList.toggle("active", m === "Crop");
            btnFit.classList.toggle("active", m === "Fit");
            btnScale.classList.toggle("active", m === "Scale");
            _ssSetSliderLock(m);
            if (m === "Fit") _ssSyncFitEdgeBtns();
            const cur = parseFloat(sclW?.value) || 1.0;
            const prefix = m === "Scale" ? t('menus.sizeSelect.originalImage') : t('menus.sizeSelect.scalingFactor');
            if (labelArea) labelArea.textContent = prefix + "  ×" + cur.toFixed(1);
        };
        btnCrop.onclick = () => {
            _ssSyncMethodBtns("Crop");
            if (scmW) { scmW.value = "Crop"; scmW.callback?.("Crop"); }
            app.graph?.setDirtyCanvas(true, true);
        };
        btnFit.onclick = () => {
            _ssSyncMethodBtns("Fit");
            if (scmW) { scmW.value = "Fit"; scmW.callback?.("Fit"); }
            app.graph?.setDirtyCanvas(true, true);
        };
        btnScale.onclick = () => {
            _ssSyncMethodBtns("Scale");
            if (scmW) { scmW.value = "Scale"; scmW.callback?.("Scale"); }
            app.graph?.setDirtyCanvas(true, true);
        };

        // 监听外部 widget 值变化（Nodes 2.0 下拉菜单等）
        if (scmW) {
            const _scmOrigCb = scmW.callback?.bind(scmW);
            scmW.callback = function(v) {
                _ssSyncMethodBtns(v);
                const dimAspect = v === "Scale";
                const _aspEl = aspW?.element?.parentElement;
                if (_aspEl) {
                    _aspEl.classList.toggle("ss-dimmed", dimAspect);
                    _aspEl.title = dimAspect
                        ? t('menus.sizeSelect.tipAspectDimmed') : "";
                }
                if (resGrid) {
                    resGrid.classList.toggle("ss-dimmed", dimAspect);
                    resGrid.title = dimAspect ? t('menus.sizeSelect.tipResDimmed') : "";
                }
                if (arGrid) {
                    arGrid.classList.toggle("ss-dimmed", dimAspect);
                    arGrid.title = dimAspect ? t('menus.sizeSelect.tipAspectDimmed') : "";
                }
                syncPreview();
                return _scmOrigCb?.(v);
            };
        }
        if (sclW) {
            const _sclOrigCb = sclW.callback?.bind(sclW);
            sclW.callback = function(v) {
                _ssUpdateTrack(parseFloat(v));
                // 拖拽中不 flash，避免每次 pointermove 都触发 flashPreview() 里的强制 reflow
                syncPreview({ flash: !_ssDragging });
                return _sclOrigCb?.(v);
            };
        }

        // ── 一体式轨道拖拽交互（无 thumb，点按即拖动）──
        let _ssDragging = false, _ssPressed = false, _ssPressX = 0, _ssDirty = false;
        const _ssValFromX = (clientX) => {
            const rect = track.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            let raw = _ssMn + pct * (_ssMx - _ssMn);
            raw = Math.round((raw - _ssMn) / _ssSt) * _ssSt + _ssMn;
            return Math.max(_ssMn, Math.min(_ssMx, parseFloat(raw.toFixed(8))));
        };
        const _ssApply = (clientX) => {
            const v = _ssValFromX(clientX);
            if (sclW) { sclW.value = v; sclW.callback?.(v); }
            _ssUpdateTrack(v);
        };
        track.addEventListener("pointerdown", e => {
            if (e.button !== 0) return;
            if (_ssMethod() === "Fit") return;   // Fit 模式这一行是适配边按钮，不是滑条
            e.preventDefault();
            _ssPressed = true;
            _ssPressX = e.clientX;
            track.setPointerCapture(e.pointerId);
            if (!node._osHideTitle) {
                _ssDragging = true;
                _ssApply(e.clientX);
                _ssDirty = true;
                app.graph?.change();
            }
        });
        track.addEventListener("pointermove", e => {
            if (!_ssPressed) return;
            if (!_ssDragging) {
                if (Math.abs(e.clientX - _ssPressX) < 4) return;
                _ssDragging = true;
            }
            _ssApply(e.clientX);
            _ssDirty = true;
            app.graph?.setDirtyCanvas(true, true);
        });
        const _ssEndDrag = () => {
            _ssPressed = false;
            _ssDragging = false;
            if (_ssDirty) { _ssDirty = false; }
            app.graph?.setDirtyCanvas(true, true);
            app.graph?.change();
        };
        track.addEventListener("pointerup", _ssEndDrag);
        track.addEventListener("pointercancel", _ssEndDrag);

        // ── 滚轮调节 ──
        track.addEventListener("wheel", e => {
            if (_ssMethod() === "Fit") return;   // Fit 模式滚轮不该改缩放倍数
            e.preventDefault();
            const cur = parseFloat(sclW?.value) || 1.0;
            const delta = e.deltaY > 0 ? -_ssSt : _ssSt;
            const v = Math.max(_ssMn, Math.min(_ssMx, parseFloat((cur + delta).toFixed(8))));
            if (sclW) { sclW.value = v; sclW.callback?.(v); }
            _ssUpdateTrack(v);
            app.graph?.setDirtyCanvas(true, true);
            app.graph?.change();
        }, { passive: false });

        const autoPanel = document.createElement("div");
        autoPanel.className = isManual ? "ss-hidden" : "";

        const resGrid = document.createElement("div");
        resGrid.className = "ss-res-grid";
        autoPanel.appendChild(resGrid);

        const resBtns = {};
        node._ss_resBtns = resBtns;
        for (const lv of Object.keys(RESOLUTION_DATA)) {
            const b = document.createElement("button");
            b.className = `ss-res-btn${lv === currentRes ? " active" : ""}`;
            b.innerHTML = t('menus.sizeSelect.' + (_RES_LABEL_MAP[lv] || lv));
            node._ss_resBtns[lv] = b;
            b.onclick = () => {
                currentRes = lv;
                resW.value = lv;
                resW.callback?.(lv);
                Object.entries(resBtns).forEach(([k, btn]) => btn.classList.toggle("active", k === lv));
                syncPreview();
                app.graph?.setDirtyCanvas(true, true);
            };
            resGrid.appendChild(b);
            resBtns[lv] = b;
        }

        const arGrid = document.createElement("div");
        arGrid.className = "ss-ar-grid";
        autoPanel.appendChild(arGrid);

        const aspBtns = {};

        function makeArBtn(r) {
            const b = document.createElement("button");
            b.className = `ss-ar-btn${r === currentAsp ? " active" : ""}`;
            b.innerHTML = `<span class="ar-icon">${ICON_CACHE_SM[r]}</span>`
                        + `<span class="ar-ratio">${r}</span>`;
            return b;
        }

        function onAspClick(r) {
            currentAsp = r;
            aspW.value = ASPECT_RATIO_LABELS[r] || r;
            aspW.callback?.(aspW.value);
            Object.entries(aspBtns).forEach(([k, btn]) => btn.classList.toggle("active", k === r));
            syncPreview();
            app.graph?.setDirtyCanvas(true, true);
        }

        for (const row of ASPECT_ROWS) {
            for (const ratio of row) {
                const b = makeArBtn(ratio);
                b.onclick = () => onAspClick(ratio);
                arGrid.appendChild(b);
                aspBtns[ratio] = b;
            }
        }

        contentDiv.appendChild(autoPanel);

        const manPanel = document.createElement("div");
        manPanel.className = isManual ? "" : "ss-hidden";

        // 两枚等宽按钮：取上游原图尺寸 / 互换宽高。
        //   前者复用 Scale 模式已经解析好的 _ss_srcW/_ss_srcH（见 _ssTrackSourceImage），
        //   不额外发请求也不依赖后端执行结果。
        const manRow = document.createElement("div");
        manRow.className = "ss-man-row";

        const useSrcBtn = document.createElement("button");
        useSrcBtn.className = "ss-swap-btn";
        useSrcBtn.textContent = t('menus.sizeSelect.useSourceSize');
        useSrcBtn.title = t('menus.sizeSelect.tipUseSourceSize');
        node._ss_useSrcBtn = useSrcBtn;
        useSrcBtn.onclick = () => {
            const srcW = node._ss_srcW, srcH = node._ss_srcH;
            if (!(srcW > 0) || !(srcH > 0)) return;
            const step = gridStep(almW?.value);
            baseWidth  = alignTo(srcW, step);
            baseHeight = alignTo(srcH, step);
            updateWidgetValue(cusW, baseWidth);
            updateWidgetValue(cusH, baseHeight);
            syncPreview();
            app.graph?.change();
            app.graph?.setDirtyCanvas(true, true);
        };

        const swapBtn = document.createElement("button");
        swapBtn.className = "ss-swap-btn";
        swapBtn.textContent = t('menus.sizeSelect.swap');
        node._ss_swapBtn = swapBtn;
        swapBtn.onclick = () => {
            [baseWidth, baseHeight] = [baseHeight, baseWidth];
            updateWidgetValue(cusW, baseWidth);
            updateWidgetValue(cusH, baseHeight);
            syncPreview();
            app.graph?.setDirtyCanvas(true, true);
        };
        manRow.append(useSrcBtn, swapBtn);
        manPanel.appendChild(manRow);
        contentDiv.appendChild(manPanel);

        const preview = document.createElement("div");
        preview.className = "ss-preview";
        preview.innerHTML = `<span class="ss-preview-val">-</span>`;
        const previewVal = preview.querySelector(".ss-preview-val");
        // 面积回显：像素总量（MP）与 latent 网格。
        //   原生 ResolutionSelector 也回显真实 MP —— 对齐后的尺寸往往不等于设定值，
        //   不显示就等于默认「和你想的一样」。显存 / 耗时正比于像素总量而非单边长度，
        //   所以「同一个档位换个比例，开销翻倍」这件事必须让用户看见。
        const previewMeta = document.createElement("span");
        previewMeta.className = "ss-preview-meta";
        preview.appendChild(previewMeta);
        node._ss_previewMeta = previewMeta;

        // ── Scale 模式原图尺寸解析（不依赖后端执行/缓存）──────────────────────────
        //   image 输入：读上游节点本地已加载的预览图（LoadImage 等，选图那一刻就有，无需 Queue Prompt）
        //   latent 输入：读上游节点的静态 width/height widget（EmptyLatentImage 等，同样无需执行）
        //   两者都拿不到时回退为 null，syncPreview 显示占位符
        function _ssResolveUpstream(portName) {
            const port = node.inputs?.find(i => (i._wosaiOrigName ?? i.name) === portName);
            const link = port?.link != null ? app.graph.links[port.link] : null;
            return link ? app.graph.getNodeById(link.origin_id) : null;
        }
        function _ssReadStaticWH(srcNode) {
            const w = parseInt(srcNode?.widgets?.find(x => x.name === "width")?.value);
            const h = parseInt(srcNode?.widgets?.find(x => x.name === "height")?.value);
            return (w > 0 && h > 0) ? [w, h] : null;
        }
        function _ssTrackSourceImage() {
            const img = _ssResolveUpstream("image")?.imgs?.[0];
            if (img) {
                const apply = () => {
                    node._ss_srcW = img.naturalWidth;
                    node._ss_srcH = img.naturalHeight;
                    syncPreview();
                };
                if (img.complete && img.naturalWidth) apply();
                else img.addEventListener("load", apply, { once: true, signal: _ac.signal });
                return;
            }
            const wh = _ssReadStaticWH(_ssResolveUpstream("latent"));
            if (wh) { [node._ss_srcW, node._ss_srcH] = wh; syncPreview(); return; }
            node._ss_srcW = node._ss_srcH = null;
            syncPreview();
        }
        node._ss_trackSourceImage = _ssTrackSourceImage;
        const _origOnConnChange = node.onConnectionsChange;
        node.onConnectionsChange = function (type) {
            _origOnConnChange?.apply(this, arguments);
            if (type === (window.LiteGraph ? LiteGraph.INPUT : 1)) _ssTrackSourceImage();
        };
        _ssTrackSourceImage(); // 首次挂载时补一次（覆盖从已保存工作流加载、连线早已存在的情况）

        const copyright = document.createElement("div");
        copyright.className = "ss-copyright";
        copyright.textContent = WOSAI_COPYRIGHT;

        wrap.appendChild(sliderRow);
        _ssSyncMethodBtns(scmW?.value);
        wrap.appendChild(preview);
        wrap.appendChild(copyright);

        function flashPreview() {
            if (_prefersReducedMotion() || document.hidden) return;
            preview.classList.remove("flash");
            void preview.offsetWidth;
            preview.classList.add("flash");
        }

        // 取尺寸数值：优先读 widget 关联的真实 DOM input（Nodes 2.0/Vue 下打字时 widget.value 会滞后），
        //   回退 widget.value，再回退 fallback。这样手动输入能实时反映到预览。
        function _dimVal(widget, fallback) {
            const el = widget?.element || widget?.inputEl;
            const input = (el && el.tagName === "INPUT") ? el
                        : (el?.querySelector?.("input,textarea") || widget?.inputEl || null);
            const domV = input ? parseInt(input.value) : NaN;
            if (!isNaN(domV) && domV > 0) return domV;
            const wv = parseInt(widget?.value);
            return (!isNaN(wv) && wv > 0) ? wv : fallback;
        }

        function syncPreview(opts = {}) {
            const step = gridStep(almW?.value);
            const method = _ssMethod();
            // 目标框：预设档位或自定义宽高（Scale 模式下尺寸完全由原图 × 倍数决定，不看目标框）
            let tw = 0, th = 0;
            if (!isManual) {
                const d = RESOLUTION_DATA[currentRes]?.[currentAsp];
                if (d) { tw = alignTo(d[0], step); th = alignTo(d[1], step); }
            } else {
                tw = alignTo(_dimVal(cusW, baseWidth), step);
                th = alignTo(_dimVal(cusH, baseHeight), step);
            }
            const src = (node._ss_srcW > 0 && node._ss_srcH > 0) ? [node._ss_srcW, node._ss_srcH] : null;
            let w = 0, h = 0;
            let text;
            if (method === "Scale") {
                if (src) {
                    // 对齐 size_select.py：Scale 模式不限制上限，但必须落在 latent 网格上。
                    const mul = parseFloat(sclW?.value) || 1.0;
                    w = scaleAlign(src[0] * mul, step);
                    h = scaleAlign(src[1] * mul, step);
                    text = `${w} × ${h}`;
                } else {
                    text = "-";
                }
            } else if (method === "Fit" && src) {
                // 等比适配：不变形、不裁剪。与后端 _fit_scale 同口径，否则预览会骗人。
                const s = _ssFitScale(src[0], src[1], tw, th, _ssFitEdge());
                w = scaleAlign(src[0] * s, step);
                h = scaleAlign(src[1] * s, step);
                text = `${w} × ${h}`;
            } else {
                // Crop；或 Fit 但没有上游可适配（后端同样退化为直接用目标尺寸）
                w = tw; h = th;
                text = (tw > 0 && th > 0) ? `${tw} × ${th}` : "N/A";
            }
            previewVal.textContent = text;
            renderAreaMeta(w, h, step);
            syncUseSourceBtn();
            if (opts.flash !== false) flashPreview();
        }

        /** 与 nodes/size_select.py::_fit_scale 同口径的等比适配系数。
         *  Long = contain（整图装进目标框，任何一边都不超出）
         *  Short = 短边贴齐目标框，长边按比例超出（cover 但不裁剪） */
        function _ssFitScale(sw, sh, tw, th, edge) {
            if (!(sw > 0) || !(sh > 0) || !(tw > 0) || !(th > 0)) return 1;
            return edge === "Short"
                ? Math.min(tw, th) / Math.min(sw, sh)
                : Math.min(tw / sw, th / sh);
        }

        /** 没接上游时「取原图尺寸」无源可取，置灰而不是点了没反应。 */
        function syncUseSourceBtn() {
            if (!useSrcBtn) return;
            const has = node._ss_srcW > 0 && node._ss_srcH > 0;
            useSrcBtn.disabled = !has;
            useSrcBtn.title = has
                ? t('menus.sizeSelect.tipUseSourceSize')
                : t('menus.sizeSelect.tipNoSourceSize');
        }

        /** 回显真实像素总量与 latent 网格；面积超预算时按级别变色提示。 */
        function renderAreaMeta(w, h, step) {
            if (!previewMeta) return;
            if (!(w > 0) || !(h > 0)) {
                previewMeta.textContent = "";
                previewMeta.title = "";
                preview.title = "";
                preview.classList.remove("is-large", "is-extreme");
                return;
            }
            const mp = (w * h) / (1024 * 1024);
            const grid = `latent ${w / step} × ${h / step}`;
            previewMeta.textContent = `${mp.toFixed(2)} MP · ${grid}`;
            // 节点被拖窄时 meta 会被省略号截断，完整信息挂 title 兜底
            preview.title = `${w} × ${h} · ${mp.toFixed(2)} MP · ${grid}`;
            preview.classList.toggle("is-large", mp > AREA_HINT_MP && mp <= AREA_WARN_MP);
            preview.classList.toggle("is-extreme", mp > AREA_WARN_MP);
            previewMeta.title = mp > AREA_WARN_MP
                ? t('menus.sizeSelect.tipAreaExtreme', 'Large area: high VRAM and slow sampling')
                : (mp > AREA_HINT_MP
                    ? t('menus.sizeSelect.tipAreaLarge', 'Area above 4 MP: watch your VRAM')
                    : t('menus.sizeSelect.tipAreaGrid', 'Latent grid is derived from the align multiple'));
        }

        function updateWidgetValue(widget, value) {
            if (!widget) return;
            _updatingDisplay = true;
            try {
                const maxV = widget.options?.max;
                const minV = widget.options?.min;
                const inBounds = (maxV === undefined || value <= maxV) &&
                                 (minV === undefined || value >= minV);
                if (inBounds) widget.value = value;
                if (widget.inputEl) {
                    widget.inputEl.value = value;
                } else if (widget.element) {
                    const input = widget.element.querySelector("input[type='number']")
                               || widget.element.querySelector("input")
                               || widget.element.querySelector("textarea");
                    if (input) {
                        input.value = value;
                    } else if (typeof widget.element.value !== "undefined") {
                        widget.element.value = value;
                    }
                }
            } finally {
                _updatingDisplay = false;
            }
            app.graph?.setDirtyCanvas(true, true);
        }

        function applyMode(manual) {
            _applyingMode = true;
            isManual = manual;
            manW.value = manual ? "on" : "off";
            manW.callback?.(manW.value);

            btnAuto.classList.toggle("active", !manual);
            btnMan.classList.toggle("active",   manual);

            wrap.classList.toggle("ss-mode-manual",  manual);
            wrap.classList.toggle("ss-mode-preset", !manual);

            autoPanel.classList.toggle("ss-hidden",  manual);
            manPanel.classList.toggle("ss-hidden",  !manual);
            copyright.classList.toggle("ss-hidden", !manual);

            setWidgetVis(resW, !manual);
            setWidgetVis(aspW, !manual);
            setWidgetVis(cusW,  manual);
            setWidgetVis(cusH,  manual);

            syncPreview();
            updateNodeHeight();
            _applyingMode = false;
        }

        function updateNodeHeight() {
            const h = getFixedHeight(isManual);
            _targetHeight = h;
            const curW = node.size?.[0] || 220;
            node.size = [curW, h];
            wrap.style.width = curW + "px";
            if (node.element?.style) {
                node.element.style.removeProperty("height");
                node.element.style.removeProperty("min-height");
                node.element.style.removeProperty("max-height");
                delete node.height;
                delete node._minHeight;
                delete node._maxHeight;
            }
            app.graph?.setDirtyCanvas(true, true);
        }

        btnAuto.onclick = () => applyMode(false);
        btnMan.onclick  = () => applyMode(true);

        const origMan = manW.callback;
        manW.callback = function (v) {
            origMan?.apply(this, arguments);
            if (!_applyingMode) applyMode(v === "on");
        };

        const origRes = resW.callback;
        resW.callback = function (v) {
            if (!RESOLUTION_DATA[v]) return;
            currentRes = v;
            Object.entries(resBtns).forEach(([k, btn]) => btn.classList.toggle("active", k === v));
            syncPreview();
            origRes?.apply(this, arguments);
        };

        const origAsp = aspW.callback;
        aspW.callback = function (v) {
            const short = _shortAsp(v);
            if (!RESOLUTION_DATA[currentRes]?.[short]) return;
            currentAsp = short;
            Object.entries(aspBtns).forEach(([k, btn]) => btn.classList.toggle("active", k === short));
            syncPreview();
            origAsp?.apply(this, arguments);
        };

        function bindCustomDimWidget(widget, setBase) {
            if (!widget) return;
            const origCb = widget.callback;
            widget.callback = function (v) {
                if (!_updatingDisplay) setBase(v);
                origCb?.apply(this, arguments);
                if (isManual) syncPreview();
            };
            const container = widget.element || widget.inputEl;
            if (!container) return;
            const handleDimEvent = (e, skipZero) => {
                if (!isManual) return;
                const input  = e.target.querySelector("input") || e.target;
                const rawVal = parseInt(input.value) || 0;
                if (rawVal <= 0) { if (skipZero) return; syncPreview(); return; }
                const r = alignTo(rawVal, gridStep(almW?.value));
                input.value  = r;
                widget.value = r;
                setBase(r);
                syncPreview();
            };
            container.addEventListener("input",  (e) => handleDimEvent(e, false), { signal: _ac.signal });
            container.addEventListener("change", (e) => handleDimEvent(e, true),  { signal: _ac.signal });
        }

        bindCustomDimWidget(cusW, (v) => { baseWidth  = v; });
        bindCustomDimWidget(cusH, (v) => { baseHeight = v; });

        // ── 事件委托兜底：在 wrap 级监听所有 input 事件（覆盖 Vue 渲染的任何子控件） ──
        //   Nodes 2.0 下 widget 结构可能与 v1 不同，内部 input 元素可能不在 widget.element 上，
        //   所以在最外层容器上做事件委托，确保任何用户对尺寸数值的操作都能同步到预览。
        //   注意：这里只触发 syncPreview，不覆盖 widget 值（Vue 已经更新了 widget.value）。
        const _handleWrapInput = (e) => {
            if (!isManual) return;
            const target = e.target;
            if (!target || !target.tagName) return;
            const tag = target.tagName.toLowerCase();
            if (tag !== "input" && tag !== "textarea" && tag !== "select") return;
            const rawVal = parseInt(target.value) || 0;
            if (rawVal <= 0) { syncPreview(); return; }
            // 同步 baseWidth / baseHeight 以保持内部状态一致
            baseWidth = cusW?.value || baseWidth;
            baseHeight = cusH?.value || baseHeight;
            syncPreview();
        };
        wrap.addEventListener("input",  _handleWrapInput, { signal: _ac.signal });
        wrap.addEventListener("change", _handleWrapInput, { signal: _ac.signal });

        // Nodes 2.0 的响应式重建通过 DOM 变更触发同步；不再对每个节点常驻轮询。
        let _observedW = _dimVal(cusW, baseWidth), _observedH = _dimVal(cusH, baseHeight), _observedManual = manW?.value;
        let _externalSyncRAF = 0;
        const syncExternalState = () => {
            _externalSyncRAF = 0;
            if (document.hidden || !node || node.is_removed || !node.graph) return;
            try {
                const newW = _dimVal(cusW, baseWidth), newH = _dimVal(cusH, baseHeight), newManual = manW?.value;
                let changed = false;
                if (newW !== _observedW) { _observedW = newW; if (isManual) { baseWidth = newW; changed = true; } }
                if (newH !== _observedH) { _observedH = newH; if (isManual) { baseHeight = newH; changed = true; } }
                if (newManual !== undefined && newManual !== _observedManual) {
                    _observedManual = newManual;
                    if (!_applyingMode) applyMode(newManual === "on");
                }
                if (changed) syncPreview();
            } catch (e) { /* 静默 */ }
        };
        const scheduleExternalSync = () => {
            if (!_externalSyncRAF) _externalSyncRAF = requestAnimationFrame(syncExternalState);
        };
        wrap.addEventListener("input", scheduleExternalSync, { signal: _ac.signal, capture: true });
        wrap.addEventListener("change", scheduleExternalSync, { signal: _ac.signal, capture: true });
        wrap.addEventListener("load", () => { node._ss_trackSourceImage?.(); scheduleExternalSync(); }, { signal: _ac.signal, capture: true });
        if (typeof MutationObserver !== "undefined") {
            _widgetObserver = new MutationObserver(scheduleExternalSync);
            _widgetObserver.observe(node.element || wrap, { childList: true, subtree: true, attributes: true, attributeFilter: ["value", "class"] });
        }
        const _origOnRemovedObserver = node.onRemoved;
        node.onRemoved = () => {
            if (_externalSyncRAF) cancelAnimationFrame(_externalSyncRAF);
            _widgetObserver?.disconnect();
            _origOnRemovedObserver?.();
        };

        const _origComputeSize = node.computeSize?.bind(node);
        node.computeSize = function (out) {
            const s = _origComputeSize
                ? _origComputeSize(out)
                : [node.size?.[0] || 220, getFixedHeight(isManual)];
            const w = Math.max(node.minSize?.[0] || 220, s[0]);
            wrap.style.width = w + "px";
            return [w, getFixedHeight(isManual)];
        };

        node.addDOMWidget("ss_ui", "ss_panel", wrap, { getMinHeight: function () { return 0; } });

        applyMode(isManual);

        requestAnimationFrame(() => {
            const textW = copyright.scrollWidth > 0
                ? copyright.scrollWidth
                : 220;
            const minW  = Math.max(textW + 16, 220);
            const minH  = 45 + 12 + (copyright.offsetHeight || 44);
            node.minSize = [minW, minH];

            const applyVueMinWidth = () => {
                if (node.element?.style) {
                    node.element.style.minWidth  = minW + "px";
                    node.element.style.minHeight = minH + "px";
                    return;
                }
                // 使用单一 rAF 轮询替代 setInterval+setTimeout 组合，更安全且性能更好
                let attempts = 0;
                const tryApply = () => {
                    if (!node || node.is_removed || !node.graph) return;
                    if (node.element?.style) {
                        node.element.style.minWidth  = minW + "px";
                        node.element.style.minHeight = minH + "px";
                        return;
                    }
                    if (++attempts < 30) {
                        requestAnimationFrame(tryApply);
                    }
                };
                requestAnimationFrame(tryApply);
            };
            applyVueMinWidth();
        });

        let _lastHeight   = node.size?.[1] ?? 375;
        let _resizePaused = document.hidden;

        document.addEventListener(
            "visibilitychange",
            () => { _resizePaused = document.hidden; },
            { signal: _ac.signal }
        );

        let _lastWidth = node.size?.[0] ?? 220;
        // ResizeObserver 替代 setInterval：事件驱动，页面不可见时自动暂停，更高效
        _resizeObserver = new ResizeObserver(() => {
            if (_resizePaused || !node.size) return;
            const curH = node.size[1];
            const curW = node.size[0];
            if (curW !== _lastWidth) {
                _lastWidth = curW;
                wrap.style.width = curW + "px";
            }
            if (curH === _lastHeight) return;
            _lastHeight = curH;
            if (curH !== _targetHeight) updateNodeHeight();
        });
        _resizeObserver.observe(wrap);

        node._ss_widgets = { manW, resW, aspW, cusW, cusH, scmW, sclW, almW, fedW };
        node._ss_refreshLang = () => {
            if (manW) manW.label = t('menus.sizeSelect.manualMode');
            if (resW) resW.label = t('menus.sizeSelect.resolution');
            if (aspW) aspW.label = t('menus.sizeSelect.aspectRatio');
            if (cusW) cusW.label = t('menus.sizeSelect.customWidth');
            if (cusH) cusH.label = t('menus.sizeSelect.customHeight');
            if (scmW) scmW.label = t('menus.sizeSelect.scaleMethod');
            if (sclW) sclW.label = t('menus.sizeSelect.scaleMultiplier');
            if (fedW) fedW.label = t('menus.sizeSelect.fitEdge');
        if (almW) almW.label = t('menus.sizeSelect.alignMultiple');
            if (node._ss_btnAuto) node._ss_btnAuto.textContent = t('menus.sizeSelect.preset');
            if (node._ss_btnMan) node._ss_btnMan.textContent = t('menus.sizeSelect.manual');
            if (node._ss_btnCrop) {
                node._ss_btnCrop.textContent = t('menus.sizeSelect.crop');
                node._ss_btnCrop.title = t('menus.sizeSelect.tipCrop');
            }
            if (node._ss_btnFit) {
                node._ss_btnFit.textContent = t('menus.sizeSelect.fit');
                node._ss_btnFit.title = t('menus.sizeSelect.tipFit');
            }
            if (node._ss_btnScale) {
                node._ss_btnScale.textContent = t('menus.sizeSelect.scale');
                node._ss_btnScale.title = t('menus.sizeSelect.tipScale');
            }
            if (btnEdgeLong) {
                btnEdgeLong.textContent = t('menus.sizeSelect.fitLong');
                btnEdgeLong.title = t('menus.sizeSelect.tipFitLong');
            }
            if (btnEdgeShort) {
                btnEdgeShort.textContent = t('menus.sizeSelect.fitShort');
                btnEdgeShort.title = t('menus.sizeSelect.tipFitShort');
            }
            if (node._ss_labelArea) {
                const _lPrefix = scmW?.value === "Scale" ? t('menus.sizeSelect.originalImage') : t('menus.sizeSelect.scalingFactor');
                node._ss_labelArea.textContent = _lPrefix + "  ×" + (parseFloat(sclW?.value) || 1.0).toFixed(1);
            }
            if (node._ss_sliderRow) {
                const _lm = _ssMethod();
                node._ss_sliderRow.title = _lm === "Scale" ? t('menus.sizeSelect.tipScaleMul')
                    : (_lm === "Fit" ? t('menus.sizeSelect.tipFitEdge') : t('menus.sizeSelect.scaleOnly'));
            }
            if (node._ss_resBtns) Object.entries(node._ss_resBtns).forEach(([lv, b]) => { b.innerHTML = t('menus.sizeSelect.' + (_RES_LABEL_MAP[lv] || lv)); });
            if (node._ss_swapBtn) node._ss_swapBtn.textContent = t('menus.sizeSelect.swap');
            if (node._ss_useSrcBtn) {
                node._ss_useSrcBtn.textContent = t('menus.sizeSelect.useSourceSize');
                syncUseSourceBtn();
            }
            const _dimAsp = scmW?.value === "Scale";
            const _aspEl2 = aspW?.element?.parentElement;
            if (_aspEl2) {
                _aspEl2.classList.toggle("ss-dimmed", _dimAsp);
                _aspEl2.title = _dimAsp
                    ? t('menus.sizeSelect.tipAspectDimmed') : "";
            }
            if (resGrid) {
                resGrid.classList.toggle("ss-dimmed", _dimAsp);
                resGrid.title = _dimAsp ? t('menus.sizeSelect.tipResDimmed') : "";
            }
            if (arGrid) {
                arGrid.classList.toggle("ss-dimmed", _dimAsp);
                arGrid.title = _dimAsp ? t('menus.sizeSelect.tipAspectDimmed') : "";
            }
        };
    });
    } catch(e) {
        console.error("[SizeSelect] buildUI error:", e);
        node.size = node.size || [250, 150];
    }
}

app.registerExtension({
    name: "wosai.SizeSelect",

    // 注入 CSS（extension.json 声明 + JS 手动双保险——其他 WOSAI 扩展同模式）
    setup() {
        if (!document.getElementById("wosai-os-size-css") && !document.querySelector('link[href*="os-size.css"]')) {
            const link = document.createElement("link");
            link.id = "wosai-os-size-css";
            link.rel = "stylesheet";
            link.href = new URL("./styles/os-size.css?v=3", import.meta.url).href;
            document.head.appendChild(link);
            _injectedCss = link;
        }
        _offLangChange ??= onLangChange(() => {
            if (!app.graph?._nodes) return;
            for (const n of app.graph._nodes) {
                if (n.type !== "WOSAI_SizeSelect") continue;
                _normalizeInputs(n);
                _applyPortLabel(n);
                if (typeof n._ss_refreshLang === "function") {
                    n._ss_refreshLang();
                }
            }
            app.graph.setDirtyCanvas(true, true);
        });
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "WOSAI_SizeSelect") return;
        applyNodeDefTranslation(nodeData);

        /* 不碰 port.name（始终保留原始英文名用于匹配），只设 port.label 供显示。
           Vue 层的 name 比对永远能找到匹配，从根本上杜绝重复端口产生。
           详见 _applyPortLabel 的注释。

           beforeRegisterNodeDef 每次语言切换可能被 ComfyUI 用新 locale 的
           object_info 重新调用一次；applyNodeDefTranslation 需要每次都跑，
           但下面这段 prototype patch 只应生效一次——否则每次切换语言都会在
           onNodeCreated 上再叠一层，新建节点时 buildUI 就会被调用 N 次
           （N=已发生的语言切换次数），出现多份 DOM 面板等新的重复问题。*/
        if (!nodeType.prototype[PATCH_KEY]) {
            const originalAddInput = nodeType.prototype.addInput;
            const patchedAddInput = function (name, type, extra_info) {
                if (this.inputs && this.inputs.some(i => (i._wosaiOrigName ?? i.name) === name)) {
                    return undefined;
                }
                return originalAddInput.call(this, name, type, extra_info);
            };

            const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
            const patchedOnNodeCreated = function () {
                originalOnNodeCreated?.apply(this, arguments);
                _normalizeInputs(this);
                _applyPortLabel(this);
                buildUI(this);
            };
            nodeType.prototype.addInput = patchedAddInput;
            nodeType.prototype.onNodeCreated = patchedOnNodeCreated;
            nodeType.prototype[PATCH_KEY] = {
                originalAddInput, patchedAddInput, originalOnNodeCreated, patchedOnNodeCreated,
            };
        }
    },

    remove() {
        _offLangChange?.();
        _offLangChange = null;
        _injectedCss?.remove();
        _injectedCss = null;
        const nodeType = window.LiteGraph?.registered_node_types?.WOSAI_SizeSelect;
        const patch = nodeType?.prototype?.[PATCH_KEY];
        if (patch) {
            if (nodeType.prototype.addInput === patch.patchedAddInput) nodeType.prototype.addInput = patch.originalAddInput;
            if (nodeType.prototype.onNodeCreated === patch.patchedOnNodeCreated) nodeType.prototype.onNodeCreated = patch.originalOnNodeCreated;
            delete nodeType.prototype[PATCH_KEY];
        }
    },
});
