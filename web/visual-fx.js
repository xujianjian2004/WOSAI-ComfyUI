// ══ WOSAI 视觉增强套件 —— 子球·画布背景设置 ════════════════════════════
//   自定义背景图 / 固定·跟随 / 填充模式(拉伸·平铺·自定义位置) / 亮度调节 / 恢复默认。
import { app } from "../../../scripts/app.js";
import { retryUntil, getWOSAIVarNum } from "./shared/shared-utils.js";
import { registerHudTab, unregisterHudTab } from "./shared/hud-kit.js";
import { _sec, _row, buildControlPanel } from "./shared/panel-builder.js";
import { dodgeBall } from "./launcher.js";
import { t } from "./shared/i18n.js";
import { calcSnapToNodeSide } from "./shared/canvas-utils.js";
import { getGlassTheme } from "./shared/glass-theme.js";

const SEC_STYLE = "font-size:var(--ws-text-md);font-weight:500;color:var(--ws-accent);margin:var(--ws-gap-lg) 0 var(--ws-gap)";

const LS = "wosai-canvas-bg";
const DEF = { img: "", fixed: false, fill: "stretch", x: 50, y: 50, scale: 100, blur: false, brightness: 100 };
let _cfg = load();
let _img = null;
function load() { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(LS) || "{}")); } catch (_) { return Object.assign({}, DEF); } }
function save() { try { localStorage.setItem(LS, JSON.stringify(_cfg)); } catch (e) { _flash(t('nodes.visualFx.backgroundTooLarge')); } }
function _flash(m) { try { app.extensionManager?.toast?.add?.({ severity: "warn", summary: "WOSAI", detail: m, life: 3000 }); } catch (_) { console.warn("[WOSAI]", m); } }

let _origOnDrawBackground = null;   // 原 canvas.onDrawBackground
let _origDrawGroups = null;         // 原 canvas.drawGroups
let _fxUninstalled = false;         // 标记是否已卸载
const _keyHandler = null;             // Escape 监听
const _offGlassChange = null;         // onGlassChange 退订

// 预处理离屏画布（模糊/亮度一次性烘焙，避免每帧 ctx.filter 重算造成卡顿）
let _imgFiltered = null, _tilePat = null;
function _rebuildFiltered() {
    _tilePat = null;
    _imgFiltered = null;
    if (!_img || !_img.complete || !_img.width) return;
    const filters = [];
    if (_cfg.blur) filters.push(`blur(${getWOSAIVarNum('--ws-fx-blur-radius')}px)`);
    if (_cfg.brightness !== 100) filters.push(`brightness(${_cfg.brightness}%)`);
    if (!filters.length) return;                 // 无滤镜 → 直接用原图，无需离屏
    const cv = document.createElement('canvas');
    cv.width = _img.width; cv.height = _img.height;
    const c = cv.getContext('2d');
    c.filter = filters.join(' ');
    c.drawImage(_img, 0, 0);
    _imgFiltered = cv;
}

// 载入 dataURL 到 Image（用于绘制）
function _loadImg() {
    if (!_cfg.img) { _img = null; _imgFiltered = null; _tilePat = null; app.canvas?.setDirty?.(true, true); return; }
    const im = new Image();
    im.onload = () => { _img = im; _rebuildFiltered(); app.canvas?.setDirty?.(true, true); };
    im.onerror = () => { _img = null; _imgFiltered = null; _tilePat = null; };
    im.src = _cfg.img;
}

// 上传：压缩到最大边限制后转 dataURL
function _onPick(file) {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
        const im = new Image();
        im.onload = () => {
            const max = getWOSAIVarNum('--ws-fx-max-img-size'); let w = im.width, h = im.height;
            if (w > max || h > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
            const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
            cv.getContext("2d").drawImage(im, 0, 0, w, h);
            const isPng = /png/i.test(file.type);
            _cfg.img = cv.toDataURL(isPng ? "image/png" : "image/jpeg", 0.9);
            save(); _loadImg();
        };
        im.src = fr.result;
    };
    fr.readAsDataURL(file);
}

// ── 绘制：钩 onDrawBackground（实例自有属性，链式包裹）──
function _paint(ctx, x, y, w, h) {
    const src = _imgFiltered || _img;            // 优先用已烘焙滤镜的离屏图；无滤镜则原图
    if (!src) return;
    if (_cfg.fill === "tile") {
        if (!_tilePat) _tilePat = ctx.createPattern(src, "repeat");   // 平铺图案缓存，不每帧重建
        if (!_tilePat) return;
        ctx.save(); ctx.fillStyle = _tilePat; ctx.translate(x, y); ctx.fillRect(0, 0, w, h); ctx.restore();
    } else if (_cfg.fill === "custom") {
        const iw = src.width * _cfg.scale / 100, ih = src.height * _cfg.scale / 100;
        const px = x + (w - iw) * (_cfg.x / 100), py = y + (h - ih) * (1 - _cfg.y / 100);   // y:1=底,100=顶
        ctx.drawImage(src, px, py, iw, ih);
    } else {                                   // stretch 拉伸铺满
        ctx.drawImage(src, x, y, w, h);
    }
}
function _drawBg(canvas, ctx, area) {
    if (!_img || !_img.complete || !_img.width) return;
    if (_cfg.fixed) {                          // 固定：屏幕空间，铺满画布
        const el = canvas.canvas;
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
        _paint(ctx, 0, 0, el.width, el.height);
        ctx.restore();
    } else {                                   // 跟随：图坐标，铺满可见区(随平移缩放)
        _paint(ctx, area[0], area[1], area[2], area[3]);
    }
}
function _installBg() {
    if (_fxUninstalled) return true;   // 已卸载则停止 retry
    const cv = app.canvas; if (!cv) return false;
    if (cv._wosaiBgWrapped) return true;

    // LiteGraph drawBackCanvas 顺序：网格 → drawGroups(分组框) → onDrawBackground(钩子)。
    // 背景图须画在分组框「之前」，否则会盖住分组框。
    // 有分组时：在 drawGroups 开头绘制（图在分组框下）；无分组时 drawGroups 不被调用，
    // 退回到 onDrawBackground 绘制。用 _wosaiBgDrawn 标记每帧协调，避免重复。
    _origOnDrawBackground = cv.onDrawBackground;
    const _wrapOnDrawBackground = function (ctx, area) {
        if (_origOnDrawBackground) _origOnDrawBackground.call(this, ctx, area);
        if (!this._wosaiBgDrawn) { try { _drawBg(this, ctx, area); } catch (_) {} }
        this._wosaiBgDrawn = false;
    };
    cv.onDrawBackground = _wrapOnDrawBackground;
    cv._wosaiOnDrawBackgroundFn = _wrapOnDrawBackground;

    _origDrawGroups = cv.drawGroups;
    if (typeof _origDrawGroups === "function") {
        const _wrapDrawGroups = function (canvas, ctx) {
            try { _drawBg(this, ctx, this.visible_area); } catch (_) {}
            this._wosaiBgDrawn = true;
            return _origDrawGroups.call(this, canvas, ctx);
        };
        cv.drawGroups = _wrapDrawGroups;
        cv._wosaiDrawGroupsFn = _wrapDrawGroups;
    }

    cv._wosaiBgWrapped = true;
    return true;
}

function _uninstallBg() {
    const cv = app.canvas;
    if (!cv) return;
    if (cv.onDrawBackground === cv._wosaiOnDrawBackgroundFn && _origOnDrawBackground !== null) {
        cv.onDrawBackground = _origOnDrawBackground;
    }
    if (cv.drawGroups === cv._wosaiDrawGroupsFn && _origDrawGroups !== null) {
        cv.drawGroups = _origDrawGroups;
    }
    delete cv._wosaiBgWrapped;
    delete cv._wosaiOnDrawBackgroundFn;
    delete cv._wosaiDrawGroupsFn;
}

// ── 区块（嵌入「设置」面板，无浮层 chrome）──
export function buildBackgroundSection() {
    const root = document.createElement("div");
    root.className = "wosai-bg-section wosai-control-section";
    root.style.cssText = "display:flex;flex-direction:column";

    // 选图 / 恢复默认
    const r1 = _row(); r1.className = "wosai-control-actions"; r1.style.cssText = "display:flex;align-items:center;gap:var(--ws-gap-sm)";
    const pickBtn = document.createElement("button"); pickBtn.textContent = t('nodes.visualFx.selectBackgroundImage'); pickBtn.className = "wosai-btn"; pickBtn.style.cssText = "flex:1;padding:var(--ws-fx-action-padding);font-size:var(--ws-text-sm);margin-top:0";
    const file = document.createElement("input"); file.type = "file"; file.accept = "image/*"; file.style.display = "none";
    file.onchange = () => { _onPick(file.files[0]); file.value = ""; };
    pickBtn.onclick = () => file.click();
    const resetBtn = document.createElement("button"); resetBtn.textContent = t('nodes.visualFx.restoreDefault'); resetBtn.className = "wosai-btn"; resetBtn.style.cssText = "flex:1;padding:var(--ws-fx-action-padding);font-size:var(--ws-text-sm);margin-top:0";
    r1.appendChild(pickBtn); r1.appendChild(resetBtn); r1.appendChild(file); root.appendChild(r1);

    // 固定背景
    const r2 = _row(); r2.className = "wosai-row"; r2.style.marginTop = "var(--ws-gap-md)";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!_cfg.fixed; cb.style.cssText = "width:var(--ws-icon-size);height:var(--ws-icon-size);accent-color:var(--ws-accent)";
    cb.onchange = () => { _cfg.fixed = cb.checked; save(); app.canvas?.setDirty?.(true, true); };
    const cl = document.createElement("span"); cl.textContent = t('nodes.visualFx.fixBackground'); cl.style.cssText = "font-size:var(--ws-text-base)";
    r2.appendChild(cb); r2.appendChild(cl); root.appendChild(r2);

    // 自动高斯模糊
    const r3 = _row(); r3.className = "wosai-row"; r3.style.marginTop = "var(--ws-gap)";
    const cb2 = document.createElement("input"); cb2.type = "checkbox"; cb2.checked = !!_cfg.blur; cb2.style.cssText = "width:var(--ws-icon-size);height:var(--ws-icon-size);accent-color:var(--ws-accent)";
    cb2.onchange = () => { _cfg.blur = cb2.checked; save(); _rebuildFiltered(); app.canvas?.setDirty?.(true, true); };
    const cl2 = document.createElement("span"); cl2.textContent = t('nodes.visualFx.gaussianBlur'); cl2.style.cssText = "font-size:var(--ws-text-base)";
    r3.appendChild(cb2); r3.appendChild(cl2); root.appendChild(r3);

    // 亮度调节
    const brRow = _row(); brRow.className = "wosai-row"; brRow.style.marginTop = "var(--ws-gap)";
    const brLab = document.createElement("span"); brLab.textContent = t('nodes.visualFx.brightness'); brLab.style.cssText = "width:70px;font-size:var(--ws-text-sm);color:var(--ws-text-secondary)";
    const brSl = document.createElement("input"); brSl.type = "range"; brSl.className = "wosai-slider"; brSl.min = "10"; brSl.max = "300"; brSl.value = _cfg.brightness ?? 100; brSl.style.cssText = "flex:1;margin-left:var(--ws-gap)";
    const brV = document.createElement("span"); brV.textContent = (_cfg.brightness ?? 100) + "%"; brV.style.cssText = "width:var(--ws-fx-value-width);text-align:right;color:var(--ws-accent);font-size:var(--ws-text-base)";
    brSl.oninput = () => { _cfg.brightness = parseInt(brSl.value); brV.textContent = brSl.value + "%"; save(); _rebuildFiltered(); app.canvas?.setDirty?.(true, true); };
    brRow.appendChild(brLab); brRow.appendChild(brSl); brRow.appendChild(brV);
    root.appendChild(brRow);

    // 填充模式
    root.appendChild(_sec(t('nodes.visualFx.fillMode'), SEC_STYLE));
    const modes = [["stretch", t('nodes.visualFx.stretch')], ["tile", t('nodes.visualFx.tile')], ["custom", t('nodes.visualFx.customPosition')]];
    const radios = [];
    modes.forEach(([k, lb]) => {
        const row = _row(); row.className = "wosai-row"; row.style.cssText = "display:flex;align-items:center;gap:var(--ws-gap);margin:var(--ws-gap-xs) 0;cursor:pointer";
        const rd = document.createElement("input"); rd.type = "radio"; rd.name = "wsbgfill"; rd.checked = _cfg.fill === k; rd.style.accentColor = "var(--ws-accent)";
        rd.onchange = () => { _cfg.fill = k; save(); custom.style.display = k === "custom" ? "block" : "none"; app.canvas?.setDirty?.(true, true); };
        radios.push([rd, k]);
        const tspan = document.createElement("span"); tspan.textContent = lb; tspan.style.fontSize = "var(--ws-text-base)";
        row.onclick = (e) => { if (e.target !== rd) rd.click(); };
        row.appendChild(rd); row.appendChild(tspan); root.appendChild(row);
    });

    // 自定义位置（仅 custom）
    const custom = document.createElement("div"); custom.style.display = _cfg.fill === "custom" ? "block" : "none";
    const slRow = (label, key, min, max) => {
        const row = _row(); row.className = "wosai-row"; row.style.marginTop = "var(--ws-gap-sm)";
        const lab = document.createElement("span"); lab.textContent = label; lab.style.cssText = "width:var(--ws-fx-label-width);font-size:var(--ws-text-sm);color:var(--ws-text-secondary)";
        const sl = document.createElement("input"); sl.type = "range"; sl.className = "wosai-slider"; sl.min = min; sl.max = max; sl.value = _cfg[key];
        const v = document.createElement("span"); v.textContent = _cfg[key]; v.style.cssText = "width:var(--ws-fx-value-width-sm);text-align:right;color:var(--ws-accent)";
        sl.oninput = () => { _cfg[key] = parseInt(sl.value); v.textContent = sl.value; save(); app.canvas?.setDirty?.(true, true); };
        row.appendChild(lab); row.appendChild(sl); row.appendChild(v); return row;
    };
    custom.appendChild(slRow("X", "x", 0, 100));
    custom.appendChild(slRow("Y", "y", 0, 100));
    custom.appendChild(slRow(t('nodes.visualFx.scale'), "scale", 10, 300));
    root.appendChild(custom);

    root._sync = () => {
        cb.checked = !!_cfg.fixed;
        cb2.checked = !!_cfg.blur;
        brSl.value = _cfg.brightness ?? 100; brV.textContent = (brSl.value) + "%";
        radios.forEach(([rd, k]) => rd.checked = _cfg.fill === k);
        custom.style.display = _cfg.fill === "custom" ? "block" : "none";
    };
    resetBtn.onclick = () => { _cfg = Object.assign({}, DEF); save(); _loadImg(); root._sync(); };
    return root;
}

let _panel = null;
let _removePanelDrag = null;

function closePanel() {
    if (_panel) _panel.style.display = "none";
}

function buildPanel() {
    const { panel, cleanup } = buildControlPanel({
        wsControl: "background",
        title: t("nodes.visualFx.panelTitle"),
        onClose: closePanel,
        content: buildBackgroundSection(),
    });
    _removePanelDrag = cleanup;
    return panel;
}

function openPanel() {
    if (!_panel) _panel = buildPanel();
    if (_panel.style.display !== "none") {
        closePanel();
        return;
    }
    _panel.setAttribute("data-theme", getGlassTheme());
    _panel.style.display = "block";
    const rect = _panel.getBoundingClientRect();
    const pos = calcSnapToNodeSide(rect.width, rect.height);
    _panel.style.left = Math.round(pos.x) + "px";
    _panel.style.top = Math.round(pos.y) + "px";
    requestAnimationFrame(() => dodgeBall(_panel));
}

app.registerExtension({
    name: "WOSAI.CanvasBackground",
    setup() {
        // 壁纸功能已并入「设置」面板：HUB 栏/悬浮球点击此项时直接打开设置面板
        registerHudTab({ id: "bg", label: t('menus.hudBackground'), order: 7, panel: openPanel });
        _loadImg();
        if (!_installBg()) { retryUntil(() => _installBg(), 40, 250); }
    },
    remove() {
        _fxUninstalled = true;
        _uninstallBg();
        closePanel();
        _removePanelDrag?.();
        _removePanelDrag = null;
        if (_panel) { _panel.remove(); _panel = null; }
        unregisterHudTab("bg");
    }
});
