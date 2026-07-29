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

const MAX_DIMENSION = RESOLUTION_CONFIG.max_dimension;
const MIN_DIMENSION = RESOLUTION_CONFIG.min_dimension;
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

function roundTo8(v, maxV = MAX_DIMENSION) {
    const n = Math.max(MIN_DIMENSION, Math.min(maxV, Number(v) || MIN_DIMENSION));
    return Math.floor(n / 8) * 8;
}

function scaleTo8(v) {
    return Math.max(8, Math.floor((Number(v) || 0) / 8) * 8);
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

    _cancelWidgetWait = waitForWidgets(node, ["Resolution", "Aspect_Ratio", "Manual_Mode", "scale_method", "scale_multiplier"], () => {
        const resW = node.widgets.find(w => w.name === "Resolution");
        const aspW = node.widgets.find(w => w.name === "Aspect_Ratio");
        const manW = node.widgets.find(w => w.name === "Manual_Mode");
        const cusW = node.widgets.find(w => w.name === "Custom_Width");
        const cusH = node.widgets.find(w => w.name === "Custom_Height");
        const scmW = node.widgets.find(w => w.name === "scale_method");
        const sclW = node.widgets.find(w => w.name === "scale_multiplier");

        if (manW) manW.label = t('menus.sizeSelect.manualMode');
        if (resW) resW.label = t('menus.sizeSelect.resolution');
        if (aspW) aspW.label = t('menus.sizeSelect.aspectRatio');
        if (cusW) cusW.label = t('menus.sizeSelect.customWidth');
        if (cusH) cusH.label = t('menus.sizeSelect.customHeight');
        if (scmW) scmW.label = t('menus.sizeSelect.scaleMethod');
        if (sclW) sclW.label = t('menus.sizeSelect.scaleMultiplier');
        for (const _hw of [scmW, sclW]) {
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
        btnAuto.textContent = t('menus.sizeSelect.preset');

        const btnMan = document.createElement("button");
        btnMan.className = `ss-control-btn${isManual ? " active" : ""}`;
        btnMan.textContent = t('menus.sizeSelect.manual');

        const isFit = scmW?.value === "Scale";

        const btnFit = document.createElement("button");
        btnFit.className = "ss-control-btn" + (isFit ? " active" : "");
        btnFit.textContent = t('menus.sizeSelect.scale');
        btnFit.title = t('menus.sizeSelect.tipScale');

        const btnCrop = document.createElement("button");
        btnCrop.className = "ss-control-btn" + (isFit ? "" : " active");
        btnCrop.textContent = t('menus.sizeSelect.crop');
        btnCrop.title = t('menus.sizeSelect.tipCrop');

        node._ss_btnAuto = btnAuto;
        node._ss_btnMan = btnMan;
        node._ss_btnFit = btnFit;
        node._ss_btnCrop = btnCrop;

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
        const _initPrefix = scmW?.value === "Scale" ? t('menus.sizeSelect.originalImage') : t('menus.sizeSelect.scalingFactor');
        labelArea.textContent = _initPrefix + "  ×" + initVal.toFixed(1);
        node._ss_labelArea = labelArea;

        track.append(fill, labelArea);
        sliderRow.appendChild(track);
        node._ss_sliderRow = sliderRow;
        // 稍后追加到 wrap，位置在尺寸预览上方

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
        // ── 缩放倍数滑条锁定/解锁（Crop 模式锁定，Scale 模式解锁） ──
        const _ssSetSliderLock = (val) => {
            if (!sliderRow) return;
            const locked = val !== "Scale";
            sliderRow.classList.toggle("ss-disabled", locked);
            sliderRow.style.pointerEvents = locked ? "none" : "";
            sliderRow.title = locked ? t('menus.sizeSelect.scaleOnly') : t('menus.sizeSelect.tipScaleMul');
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
            const cur = parseFloat(sclW?.value) || 1.0;
            const prefix = val === "Scale" ? t('menus.sizeSelect.originalImage') : t('menus.sizeSelect.scalingFactor');
            if (labelArea) labelArea.textContent = prefix + "  ×" + cur.toFixed(1);
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
        manPanel.appendChild(swapBtn);
        contentDiv.appendChild(manPanel);

        const preview = document.createElement("div");
        preview.className = "ss-preview";
        preview.innerHTML = `<span class="ss-preview-lbl">${t('menus.sizeSelect.imageDimensions')} </span><span class="ss-preview-val">-</span>`;
        const previewVal = preview.querySelector(".ss-preview-val");
        const previewLbl = preview.querySelector(".ss-preview-lbl");
        node._ss_previewLbl = previewLbl;

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

        function syncPreview(opts = {}) {
            if (scmW?.value === "Scale") {
                // 对齐 size_select.py：Scale 模式不限制上限，但必须对齐 latent 的 8px 网格。
                const mul = parseFloat(sclW?.value) || 1.0;
                previewVal.textContent = (node._ss_srcW && node._ss_srcH)
                    ? `${scaleTo8(node._ss_srcW * mul)} × ${scaleTo8(node._ss_srcH * mul)}`
                    : "-";
            } else if (!isManual) {
                const d = RESOLUTION_DATA[currentRes]?.[currentAsp];
                previewVal.textContent = d ? `${d[0]} × ${d[1]}` : "N/A";
            } else {
                const w = roundTo8(_dimVal(cusW, baseWidth),  MAX_DIMENSION);
                const h = roundTo8(_dimVal(cusH, baseHeight), MAX_DIMENSION);
                previewVal.textContent = `${w} × ${h}`;
            }
            if (opts.flash !== false) flashPreview();
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

        node._ss_widgets = { manW, resW, aspW, cusW, cusH, scmW, sclW };
        node._ss_refreshLang = () => {
            if (manW) manW.label = t('menus.sizeSelect.manualMode');
            if (resW) resW.label = t('menus.sizeSelect.resolution');
            if (aspW) aspW.label = t('menus.sizeSelect.aspectRatio');
            if (cusW) cusW.label = t('menus.sizeSelect.customWidth');
            if (cusH) cusH.label = t('menus.sizeSelect.customHeight');
            if (scmW) scmW.label = t('menus.sizeSelect.scaleMethod');
            if (sclW) sclW.label = t('menus.sizeSelect.scaleMultiplier');
            if (node._ss_btnAuto) node._ss_btnAuto.textContent = t('menus.sizeSelect.preset');
            if (node._ss_btnMan) node._ss_btnMan.textContent = t('menus.sizeSelect.manual');
            if (node._ss_btnFit) {
                node._ss_btnFit.textContent = t('menus.sizeSelect.scale');
                node._ss_btnFit.title = t('menus.sizeSelect.tipScale');
            }
            if (node._ss_btnCrop) {
                node._ss_btnCrop.textContent = t('menus.sizeSelect.crop');
                node._ss_btnCrop.title = t('menus.sizeSelect.tipCrop');
            }
            if (node._ss_labelArea) {
                const _lPrefix = scmW?.value === "Scale" ? t('menus.sizeSelect.originalImage') : t('menus.sizeSelect.scalingFactor');
                node._ss_labelArea.textContent = _lPrefix + "  ×" + (parseFloat(sclW?.value) || 1.0).toFixed(1);
            }
            if (node._ss_sliderRow) node._ss_sliderRow.title = (scmW?.value !== "Scale") ? t('menus.sizeSelect.scaleOnly') : t('menus.sizeSelect.tipScaleMul');
            if (node._ss_resBtns) Object.entries(node._ss_resBtns).forEach(([lv, b]) => { b.innerHTML = t('menus.sizeSelect.' + (_RES_LABEL_MAP[lv] || lv)); });
            if (node._ss_swapBtn) node._ss_swapBtn.textContent = t('menus.sizeSelect.swap');
            if (node._ss_previewLbl) node._ss_previewLbl.textContent = t('menus.sizeSelect.imageDimensions') + " ";
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
            link.href = new URL("./styles/os-size.css", import.meta.url).href;
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
