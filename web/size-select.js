import { app } from "../../../scripts/app.js";

const MAX_DIMENSION  = 2048;
const MIN_DIMENSION  = 256;
const DEFAULT_RES    = "FHD 1080P";
const DEFAULT_RATIO  = "9:16 Mobile";

// ═══ 分辨率数据 ═══════════════════════════════════════════════════════════════════
// ⚠ 与 nodes/size_select.py 的 RESOLUTION_DATA 必须保持同步（前端用于 UI 渲染与即时预览，
//   后端是真正的计算源）。修改任一端时须同步另一端。
const RESOLUTION_DATA = {
    "SD 480P":  { "3:2":[768,512],  "2:3":[512,768],  "4:3":[512,384],  "3:4":[384,512],  "16:9":[640,360],  "9:16":[360,640],  "21:9":[768,328],  "1:1":[512,512]  },
    "HD 720P":  { "3:2":[1152,768], "2:3":[768,1152], "4:3":[1024,768], "3:4":[768,1024], "16:9":[1280,720], "9:16":[720,1280], "21:9":[1280,544], "1:1":[768,768]  },
    "FHD 1080P": { "3:2":[1536,1024],"2:3":[1024,1536],"4:3":[1280,960], "3:4":[960,1280], "16:9":[1920,1080],"9:16":[1080,1920],"21:9":[2560,1080],"1:1":[1024,1024]},
    "QHD 2K+": { "3:2":[2304,1536],"2:3":[1536,2304],"4:3":[2048,1536],"3:4":[1536,2048],"16:9":[2560,1440],"9:16":[1440,2560],"21:9":[3440,1440],"1:1":[1536,1536]},
};

const RESOLUTION_SHORT_LABELS = {
    "SD 480P":  "SD<br>480P",
    "HD 720P":  "HD<br>720P",
    "FHD 1080P": "FHD<br>1080P",
    "QHD 2K+": "QHD<br>2K+",
};

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

// ═══ 国际化 I18N ═══════════════════════════════════════════════════════════════════
const I18N = {
  "en": {
    preset:          "Preset",
    manual:          "Manual",
    scale:           "Scale",
    crop:            "Crop",
    scalingFactor:   "Scaling Factor",
    imageDimensions: "Image Dimensions",
    swap:            "Swap Width/Height",
    manualMode:      "Manual Mode",
    resolution:      "Resolution",
    aspectRatio:     "Aspect Ratio",
    customWidth:     "Custom Width",
    customHeight:    "Custom Height",
    res480P:         "SD<br>480P",
    res720P:         "HD<br>720P",
    res1080P:        "FHD<br>1080P",
    res2K:           "QHD<br>2K+",
  },
  "zh": {
    preset:          "预设",
    manual:          "手动",
    scale:           "缩放",
    crop:            "剪裁",
    scalingFactor:   "缩放倍数",
    imageDimensions: "尺寸预览",
    swap:            "一键互换宽高",
    manualMode:      "自定义模式",
    resolution:      "分辨率",
    aspectRatio:     "宽高比",
    customWidth:     "自定义宽度",
    customHeight:    "自定义高度",
    res480P:         "标清",
    res720P:         "高清",
    res1080P:        "全高清",
    res2K:           "超清",
  },
};

const _RES_LABEL_MAP = {
  "SD 480P":  "res480P",
  "HD 720P":  "res720P",
  "FHD 1080P": "res1080P",
  "QHD 2K+": "res2K",
};

function _ssGetLang() {
  // 优先从 ComfyUI 全局 locale 设置读取，fallback 到浏览器语言
  try {
    const comfyLocale = app?.ui?.settings?.getSettingValue?.('Comfy.Locale');
    if (comfyLocale) {
      return comfyLocale.startsWith('zh') ? 'zh' : 'en';
    }
  } catch (_) {}
  try { return navigator.language.startsWith("zh") ? "zh" : "en"; } catch { return "en"; }
}
function _ssT(lang, key) {
  return (I18N[lang] && I18N[lang][key]) || key;
}
function _ssResLabel(lv, l) {
  const k = _RES_LABEL_MAP[lv];
  return k ? _ssT(l || _ssGetLang(), k) : (RESOLUTION_SHORT_LABELS[lv] || lv);
}
// CSS 已提取至 web/css/os-size.css，通过 extension.json 加载

// CSS 已提取至 web/css/os-size.css，通过 extension.json 加载

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
    const start = Date.now();
    const intv = setInterval(() => {
        const ready = node.widgets && names.every(n => node.widgets.some(w => w.name === n));
        if (ready) {
            clearInterval(intv);
            cb();
        } else if (Date.now() - start >= timeout) {
            clearInterval(intv);
            console.warn("[SizeSelect] Waiting for widgets timed out:", names);
        }
    }, 50);
    return intv;
}

function _shortAsp(label) {
    if (!label) return DEFAULT_RATIO.split(" ")[0];
    const i = label.indexOf(" ");
    return i > 0 ? label.slice(0, i) : label;
}

function roundTo8(v, maxV = MAX_DIMENSION) {
    const n = Math.max(MIN_DIMENSION, Math.min(maxV, Number(v) || MIN_DIMENSION));
    return Math.floor(n / 8) * 8;
}

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

    if (node.inputs) {
        const hiddenPorts = new Set([
            "Manual_Mode", "Resolution", "Aspect_Ratio",
            "Custom_Width", "Custom_Height",
            "scale_method", "scale_multiplier",
        ]);
        node.inputs = node.inputs.filter(i => !hiddenPorts.has(i.name));
    }

    let _waitIntv       = null;
    let _resizeObserver = null;
    const _ac = new AbortController();

    const _origOnRemoved = node.onRemoved;
    node.onRemoved = () => {
        clearInterval(_waitIntv);
        _resizeObserver?.disconnect();
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

    _waitIntv = waitForWidgets(node, ["Resolution", "Aspect_Ratio", "Manual_Mode", "scale_method", "scale_multiplier"], () => {
        const resW = node.widgets.find(w => w.name === "Resolution");
        const aspW = node.widgets.find(w => w.name === "Aspect_Ratio");
        const manW = node.widgets.find(w => w.name === "Manual_Mode");
        const cusW = node.widgets.find(w => w.name === "Custom_Width");
        const cusH = node.widgets.find(w => w.name === "Custom_Height");
        const scmW = node.widgets.find(w => w.name === "scale_method");
        const sclW = node.widgets.find(w => w.name === "scale_multiplier");

        let lang = _ssGetLang();

        if (manW) manW.label = _ssT(lang, "manualMode");
        if (resW) resW.label = _ssT(lang, "resolution");
        if (aspW) aspW.label = _ssT(lang, "aspectRatio");
        if (cusW) cusW.label = _ssT(lang, "customWidth");
        if (cusH) cusH.label = _ssT(lang, "customHeight");

        if (cusW) cusW.value = Math.max(MIN_DIMENSION, Math.min(MAX_DIMENSION, cusW.value));
        if (cusH) cusH.value = Math.max(MIN_DIMENSION, Math.min(MAX_DIMENSION, cusH.value));

        let currentRes = (resW?.value && RESOLUTION_DATA[resW.value]) ? resW.value : DEFAULT_RES;
        if (resW && resW.value !== currentRes) resW.value = currentRes;
        const _aspShort = _shortAsp(aspW?.value);
        let currentAsp = (aspW?.value && RESOLUTION_DATA[currentRes]?.[_aspShort]) ? _aspShort : DEFAULT_RATIO.split(" ")[0];
        const _aspLabel = ASPECT_RATIO_LABELS[currentAsp] || currentAsp;
        if (aspW && aspW.value !== _aspLabel) aspW.value = _aspLabel;

        let isManual         = manW?.value === "on";
        let baseWidth        = cusW?.value || MIN_DIMENSION;
        let baseHeight       = cusH?.value || MAX_DIMENSION;
        let _updatingDisplay = false;
        let _applyingMode    = false;
        let _targetHeight    = getFixedHeight(isManual);

        const _origOrder = new Map();
        node.widgets.forEach((w, i) => _origOrder.set(w, i));

        const _origSerialize = node.serialize?.bind(node);
        node.serialize = function () {
            const data = _origSerialize ? _origSerialize() : {};
            const coreWidgets = [manW, scmW, sclW, resW, aspW, cusW, cusH].filter(Boolean);
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

        // ── 4按钮控制行（预设｜自定义｜Scale｜Crop） ──
        const controlRow = document.createElement("div");
        controlRow.className = "ss-control-row";

        const btnAuto = document.createElement("button");
        btnAuto.className = `ss-control-btn${!isManual ? " active" : ""}`;
        btnAuto.textContent = _ssT(lang, "preset");

        const btnMan = document.createElement("button");
        btnMan.className = `ss-control-btn${isManual ? " active" : ""}`;
        btnMan.textContent = _ssT(lang, "manual");

        const isFit = scmW?.value === "Scale";

        const btnFit = document.createElement("button");
        btnFit.className = "ss-control-btn" + (isFit ? " active" : "");
        btnFit.textContent = _ssT(lang, "scale");

        const btnCrop = document.createElement("button");
        btnCrop.className = "ss-control-btn" + (isFit ? "" : " active");
        btnCrop.textContent = _ssT(lang, "crop");

        controlRow.append(btnAuto, btnMan, btnFit, btnCrop);
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
        labelArea.textContent = _ssT(lang, "scalingFactor") + "  ×" + initVal.toFixed(1);

        track.append(fill, labelArea);
        sliderRow.appendChild(track);
        // 稍后追加到 wrap，位置在尺寸预览上方

        // ── 一体式轨道显示更新 ──
        const _ssMn = 0.1, _ssMx = 4.0, _ssSt = 0.1;

        const _ssUpdateTrack = (val) => {
            const pct = _ssMx !== _ssMn ? Math.max(0, Math.min(1, (val - _ssMn) / (_ssMx - _ssMn))) : 0;
            fill.style.width = (pct * 100) + "%";
            labelArea.textContent = _ssT(lang, "scalingFactor") + "  ×" + val.toFixed(1);
            // 填充覆盖文字区域时改为白色
            labelArea.style.color = pct > 0.5 ? "#fff" : "";
        };
        _ssUpdateTrack(initVal);

        // ── 缩放方式按钮事件 ──
        // ── 缩放倍数滑条锁定/解锁（Crop 模式锁定，Scale 模式解锁） ──
        const _ssSetSliderLock = (val) => {
            if (!sliderRow) return;
            const locked = val !== "Scale";
            sliderRow.classList.toggle("ss-disabled", locked);
            sliderRow.style.pointerEvents = locked ? "none" : "";
            sliderRow.title = locked ? (lang === "en" ? "Only available in Scale mode" : "仅在等比缩放模式下可用") : "";
        };

        const _ssSyncMethodBtns = (val) => {
            if (val === "Scale") {
                btnFit.classList.add("active");
                btnCrop.classList.remove("active");
            } else {
                btnFit.classList.remove("active");
                btnCrop.classList.add("active");
            }
            _ssSetSliderLock(val);
        };
        btnFit.onclick = () => {
            _ssSyncMethodBtns("Scale");
            if (scmW) { scmW.value = "Scale"; scmW.callback?.("Scale"); }
            app.graph?.setDirtyCanvas(true, true);
        };
        btnCrop.onclick = () => {
            _ssSyncMethodBtns("Crop");
            if (scmW) { scmW.value = "Crop"; scmW.callback?.("Crop"); }
            app.graph?.setDirtyCanvas(true, true);
        };

        // 监听外部 widget 值变化（Nodes 2.0 下拉菜单等）
        if (scmW) {
            const _scmOrigCb = scmW.callback?.bind(scmW);
            scmW.callback = function(v) {
                _ssSyncMethodBtns(v);
                return _scmOrigCb?.(v);
            };
        }
        if (sclW) {
            const _sclOrigCb = sclW.callback?.bind(sclW);
            sclW.callback = function(v) {
                _ssUpdateTrack(parseFloat(v));
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
            e.preventDefault();
            const cur = parseFloat(sclW?.value) || 1.0;
            const delta = e.deltaY > 0 ? -_ssSt : _ssSt;
            let v = Math.max(_ssMn, Math.min(_ssMx, parseFloat((cur + delta).toFixed(8))));
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
        for (const lv of Object.keys(RESOLUTION_DATA)) {
            const b = document.createElement("button");
            b.className = `ss-res-btn${lv === currentRes ? " active" : ""}`;
            b.innerHTML = _ssResLabel(lv);
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

        const swapBtn = document.createElement("button");
        swapBtn.className = "ss-swap-btn";
        swapBtn.textContent = _ssT(lang, "swap");
        swapBtn.onclick = () => {
            [baseWidth, baseHeight] = [baseHeight, baseWidth];
            updateWidgetValue(cusW, baseWidth);
            updateWidgetValue(cusH, baseHeight);
            syncPreview();
            app.graph?.setDirtyCanvas(true, true);
        };
        manPanel.appendChild(swapBtn);
        contentDiv.appendChild(manPanel);

        const preview = document.createElement("div");
        preview.className = "ss-preview";
        preview.innerHTML = `<span class="ss-preview-lbl">${_ssT(lang, "imageDimensions")} </span><span class="ss-preview-val">-</span>`;
        const previewVal = preview.querySelector(".ss-preview-val");

        const copyright = document.createElement("div");
        copyright.className = "ss-copyright";
        copyright.textContent = "COPYRIGHT © WOSAI STUDIO | 穿山阅海";

        wrap.appendChild(sliderRow);
        _ssSetSliderLock(scmW?.value);
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

        function syncPreview() {
            if (!isManual) {
                const d = RESOLUTION_DATA[currentRes]?.[currentAsp];
                previewVal.textContent = d ? `${d[0]} × ${d[1]}` : "N/A";
            } else {
                const w = roundTo8(_dimVal(cusW, baseWidth),  MAX_DIMENSION);
                const h = roundTo8(_dimVal(cusH, baseHeight), MAX_DIMENSION);
                previewVal.textContent = `${w} × ${h}`;
            }
            flashPreview();
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
                const r = roundTo8(rawVal, MAX_DIMENSION);
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

        // ── 轮询兜底：定期比较 cusW/cusH 值，确保预览不会卡住 ──
        //   Nodes 2.0 (Vue) 下，widget.element 的结构与 ComfyUI v1 不同，
        //   input/change 事件监听可能失效；Vue 响应式更新也不会触发 widget.callback。
        //   此处用轻量轮询做最后一道保险：每隔 300ms 比较一次 widget 数值，如果变了则同步。
        // ⚠ 读真实 DOM 值(_dimVal)而非滞后的 widget.value——Vue 下打字只更新 DOM input、
        //   widget.value 不同步，读 widget.value 会导致预览卡在旧值(本次修复点)。
        let _polledW = _dimVal(cusW, baseWidth), _polledH = _dimVal(cusH, baseHeight), _polledManual = manW?.value;
        const _ssPollHandle = setInterval(() => {
            if (document.hidden || !node || node.is_removed || !node.graph) return;
            try {
                const newW = _dimVal(cusW, baseWidth), newH = _dimVal(cusH, baseHeight), newManual = manW?.value;
                let changed = false;
                if (newW !== _polledW) { _polledW = newW; if (isManual) { baseWidth = newW; changed = true; } }
                if (newH !== _polledH) { _polledH = newH; if (isManual) { baseHeight = newH; changed = true; } }
                if (newManual !== undefined && newManual !== _polledManual) {
                    _polledManual = newManual;
                    if (!_applyingMode) applyMode(newManual === "on");
                }
                if (changed) syncPreview();
            } catch (e) { /* 静默 */ }
        }, 300);
        // 组件销毁时停止轮询（合并到主 onRemoved，避免重复绑定）
        const _origOnRemovedPoll = node.onRemoved;
        node.onRemoved = () => { clearInterval(_ssPollHandle); _origOnRemovedPoll?.(); };

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
    });
    } catch(e) {
        console.error("[SizeSelect] buildUI error:", e);
        node.size = node.size || [250, 150];
    }
}

app.registerExtension({
    name: "WOSAI_SizeSelect",

    // 注入 CSS（extension.json 声明 + JS 手动双保险——其他 WOSAI 扩展同模式）
    setup() {
        if (!document.getElementById("wosai-os-size-css") && !document.querySelector('link[href*="os-size.css"]')) {
            const link = document.createElement("link");
            link.id = "wosai-os-size-css";
            link.rel = "stylesheet";
            link.href = "/extensions/WOSAI-ComfyUI/css/os-size.css";
            document.head.appendChild(link);
        }
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "WOSAI_SizeSelect") return;

        const _orig = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            _orig?.apply(this, arguments);
            buildUI(this);
        };
    },
});
