import { app } from "../../../scripts/app.js";

const MAX_DIMENSION  = 2048;
const MIN_DIMENSION  = 256;
const DEFAULT_RES    = "FHD 1080P 全高清";
const DEFAULT_RATIO  = "9:16 Mobile 手机竖屏";

const RESOLUTION_DATA = {
    "SD 480P 标清":  { "3:2":[768,512],  "2:3":[512,768],  "4:3":[512,384],  "3:4":[384,512],  "16:9":[640,360],  "9:16":[360,640],  "21:9":[768,328],  "1:1":[512,512]  },
    "HD 720P 高清":  { "3:2":[1152,768], "2:3":[768,1152], "4:3":[1024,768], "3:4":[768,1024], "16:9":[1280,720], "9:16":[720,1280], "21:9":[1280,544], "1:1":[768,768]  },
    "FHD 1080P 全高清": { "3:2":[1536,1024],"2:3":[1024,1536],"4:3":[1280,960], "3:4":[960,1280], "16:9":[1920,1080],"9:16":[1080,1920],"21:9":[2560,1080],"1:1":[1024,1024]},
    "QHD 2K+ 超清": { "3:2":[2304,1536],"2:3":[1536,2304],"4:3":[2048,1536],"3:4":[1536,2048],"16:9":[2560,1440],"9:16":[1440,2560],"21:9":[3440,1440],"1:1":[1536,1536]},
};

const RESOLUTION_SHORT_LABELS = {
    "SD 480P 标清":  "标 清",
    "HD 720P 高清":  "高 清",
    "FHD 1080P 全高清": "全高清",
    "QHD 2K+ 超清": "超 清",
};

const ASPECT_RATIO_LABELS = {
    "3:2":   "3:2 Classic 经典胶片",
    "2:3":   "2:3 Photo 人像照片",
    "4:3":   "4:3 Standard 标准画幅",
    "3:4":   "3:4 Portrait 竖幅人像",
    "16:9":  "16:9 Widescreen 标准宽屏",
    "9:16":  "9:16 Mobile 手机竖屏",
    "21:9":  "21:9 Ultrawide 超宽银幕",
    "1:1":   "1:1 Square 正方形",
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

// CSS 已提取至 web/css/os-size.css，通过 extension.json 加载

function getFixedHeight(manual) {
    return manual ? 282 : 360;   // 与独立版同步：竖排宽高比按钮(44px×2行) + 版权钉底
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
        ]);
        node.inputs = node.inputs.filter(i => !hiddenPorts.has(i.name));
    }

    let _waitIntv            = null;
    let _vueMinWidthInterval = null;
    let _vueMinWidthTimeout  = null;
    let _resizeObserver      = null;
    const _ac = new AbortController();

    const _origOnRemoved = node.onRemoved;
    node.onRemoved = () => {
        clearInterval(_waitIntv);
        _resizeObserver?.disconnect();
        clearInterval(_vueMinWidthInterval);
        clearTimeout(_vueMinWidthTimeout);
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

    _waitIntv = waitForWidgets(node, ["Resolution", "Aspect_Ratio", "Manual_Mode"], () => {
        const resW = node.widgets.find(w => w.name === "Resolution");
        const aspW = node.widgets.find(w => w.name === "Aspect_Ratio");
        const manW = node.widgets.find(w => w.name === "Manual_Mode");
        const cusW = node.widgets.find(w => w.name === "Custom_Width");
        const cusH = node.widgets.find(w => w.name === "Custom_Height");

        if (manW) manW.label = "自定义模式";
        if (resW) resW.label = "分辨率";
        if (aspW) aspW.label = "宽高比";
        if (cusW) cusW.label = "自定义宽度";
        if (cusH) cusH.label = "自定义高度";

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
            const coreWidgets = [manW, resW, aspW, cusW, cusH].filter(Boolean);
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
        if (node.size[0] < 220) node.size[0] = 250;

        const wrap = document.createElement("div");
        wrap.className = "ss-wrap" + (isManual ? " ss-mode-manual" : " ss-mode-preset");
        wrap.setAttribute("translate", "no");
        wrap.style.width = (node.size?.[0] || 250) + "px";

        const contentDiv = document.createElement("div");
        contentDiv.className = "ss-content";
        wrap.appendChild(contentDiv);

        const modeRow = document.createElement("div");
        modeRow.className = "ss-mode-row";

        const btnAuto = document.createElement("button");
        btnAuto.className = `ss-mode-btn${!isManual ? " active" : ""}`;
        btnAuto.textContent = "预设模式";

        const btnMan = document.createElement("button");
        btnMan.className = `ss-mode-btn${isManual ? " active" : ""}`;
        btnMan.textContent = "自定义模式";

        modeRow.append(btnAuto, btnMan);
        contentDiv.appendChild(modeRow);

        const autoPanel = document.createElement("div");
        autoPanel.className = isManual ? "ss-hidden" : "";

        const resGrid = document.createElement("div");
        resGrid.className = "ss-res-grid";
        autoPanel.appendChild(resGrid);

        const resBtns = {};
        for (const lv of Object.keys(RESOLUTION_DATA)) {
            const b = document.createElement("button");
            b.className = `ss-res-btn${lv === currentRes ? " active" : ""}`;
            b.textContent = RESOLUTION_SHORT_LABELS[lv] || lv;
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
            const label     = ASPECT_RATIO_LABELS[r] || r;
            const ratioPart = label.split(" ")[0];
            const b = document.createElement("button");
            b.className = `ss-ar-btn${r === currentAsp ? " active" : ""}`;
            b.innerHTML = `<span class="ar-icon">${ICON_CACHE_SM[r]}</span>`
                        + `<span class="ar-ratio">${ratioPart}</span>`;
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

        // 预览尺寸单独占一行（底部）
        const previewCell = document.createElement("div");
        previewCell.className = "ss-preview-cell";
        const previewCellLbl = document.createElement("span");
        previewCellLbl.className = "ss-preview-cell-lbl";
        previewCellLbl.textContent = "尺寸预览：";
        const previewCellVal = document.createElement("span");
        previewCellVal.className = "ss-preview-cell-val";
        previewCellVal.textContent = "-";
        previewCell.append(previewCellLbl, previewCellVal);
        autoPanel.appendChild(previewCell);

        contentDiv.appendChild(autoPanel);

        const manPanel = document.createElement("div");
        manPanel.className = isManual ? "" : "ss-hidden";

        const swapBtn = document.createElement("button");
        swapBtn.className = "ss-swap-btn";
        swapBtn.textContent = "一键互换宽高";
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
        preview.className = "ss-preview" + (isManual ? "" : " ss-hidden");
        preview.innerHTML = `<span class="ss-preview-lbl">尺寸预览：</span><span class="ss-preview-val">-</span>`;
        const previewVal = preview.querySelector(".ss-preview-val");

        const copyright = document.createElement("div");
        copyright.className = "ss-copyright" + (isManual ? "" : " ss-hidden");
        copyright.textContent = "COPYRIGHT © WOSAI STUDIO | 穿山阅海";

        wrap.appendChild(preview);
        wrap.appendChild(copyright);

        function flashPreview() {
            if (_prefersReducedMotion() || document.hidden) return;
            if (!isManual) {
                previewCell.classList.remove("flash");
                void previewCell.offsetWidth;
                previewCell.classList.add("flash");
            } else {
                preview.classList.remove("flash");
                void preview.offsetWidth;
                preview.classList.add("flash");
            }
        }

        function syncPreview() {
            if (!isManual) {
                const d = RESOLUTION_DATA[currentRes]?.[currentAsp];
                previewCellVal.textContent = d ? `${d[0]}×${d[1]}` : "N/A";
                if (previewVal) previewVal.textContent = d ? `${d[0]} × ${d[1]}` : "N/A";
            } else {
                const w = roundTo8(parseInt(cusW?.value) || baseWidth,  MAX_DIMENSION);
                const h = roundTo8(parseInt(cusH?.value) || baseHeight, MAX_DIMENSION);
                if (previewVal) previewVal.textContent = `${w} × ${h}`;
                previewCellVal.textContent = `${w}×${h}`;
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
            preview.classList.toggle("ss-hidden", !manual);
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
            if (!widget.element) return;
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
            widget.element.addEventListener("input",  (e) => handleDimEvent(e, false), { signal: _ac.signal });
            widget.element.addEventListener("change", (e) => handleDimEvent(e, true),  { signal: _ac.signal });
        }

        bindCustomDimWidget(cusW, (v) => { baseWidth  = v; });
        bindCustomDimWidget(cusH, (v) => { baseHeight = v; });

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
                _vueMinWidthInterval = setInterval(() => {
                    if (node.element?.style) {
                        node.element.style.minWidth  = minW + "px";
                        node.element.style.minHeight = minH + "px";
                        clearInterval(_vueMinWidthInterval);
                        _vueMinWidthInterval = null;
                        clearTimeout(_vueMinWidthTimeout);
                        _vueMinWidthTimeout = null;
                    }
                }, 100);
                _vueMinWidthTimeout = setTimeout(() => {
                    clearInterval(_vueMinWidthInterval);
                    _vueMinWidthInterval = null;
                    _vueMinWidthTimeout  = null;
                }, 3000);
            };
            applyVueMinWidth();
        });

        let _lastHeight   = node.size[1];
        let _resizePaused = document.hidden;

        document.addEventListener(
            "visibilitychange",
            () => { _resizePaused = document.hidden; },
            { signal: _ac.signal }
        );

        let _lastWidth = node.size[0];
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
}

app.registerExtension({
    name: "WOSAI_SizeSelect",

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
