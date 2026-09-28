/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 本文件是 ComfyUI-KJNodes 的衍生作品，按 GNU GPL v3.0 或更新版本授权，
 * 不适用本项目根 LICENSE 的 MIT 条款。
 *   原始项目：ComfyUI-KJNodes
 *   原始作者：kijai
 *   原始文件：web/js/performance.js
 *   原始仓库：https://github.com/kijai/ComfyUI-KJNodes
 * 完整条款见项目根 LICENSE-GPL-3.0；完整署名见 THIRD-PARTY-NOTICES.md。
 */
// WOSAI 性能模式（移植自 ComfyUI-KJNodes performance.js）
// 5 项弱机/无硬件加速优化：
//   - 单画布平移（默认开，纯性能增益不改外观）
//   - 限制信息覆盖层（默认开，纯性能增益不改外观）
//   - 禁用节点阴影（默认关，外观换性能）
//   - 禁用连线边框（默认关，外观换性能）
//   - 禁用圆角（默认关，外观换性能）
import { app } from "../../../scripts/app.js";
import { wosaiGetBool, wosaiSetBool } from "./shared/wosai-prefs.js";

const K_PAN = "wosai-perf-singleCanvasPan";        // 默认开
const K_THROTTLE = "wosai-perf-throttleRenderInfo"; // 默认开
const K_SHADOW = "wosai-perf-disableShadows";       // 默认关
const K_BORDER = "wosai-perf-disableConnectionBorders"; // 默认关
const K_RADIUS = "wosai-perf-disableRoundedCorners"; // 默认关

const _savedRoundRadius = typeof LiteGraph !== "undefined" ? LiteGraph.ROUND_RADIUS : 8;
let _originalVisualSettings = null;

// 供设置面板调用的统一开关
window.__wosaiSetPerf = function (id, on) {
    wosaiSetBool(id, on);
    const canvas = app.canvas;
    if (!canvas) return;
    if (id === K_PAN) { on ? installSingleCanvasPan(canvas) : uninstallSingleCanvasPan(canvas); }
    else if (id === K_SHADOW) { canvas.render_shadows = !on; canvas.setDirty(true, true); }
    else if (id === K_BORDER) { canvas.render_connections_border = !on; canvas.setDirty(true, true); }
    else if (id === K_RADIUS) { if (typeof LiteGraph !== "undefined") { LiteGraph.ROUND_RADIUS = on ? 0 : _savedRoundRadius; canvas.setDirty(true, true); } }
    else if (id === K_THROTTLE) { on ? installThrottleRenderInfo(canvas) : uninstallThrottleRenderInfo(canvas); }
};

// ── 单画布平移 ──
let _origDraw = null;
let _panInstalledOn = null;
function installSingleCanvasPan(canvas) {
    if (_origDraw && _panInstalledOn === canvas) return;
    if (_origDraw && _panInstalledOn !== canvas) _origDraw = null;
    _panInstalledOn = canvas;
    _origDraw = canvas.draw;
    let panning = false, savedBgCanvas = null, savedBgCtx = null;
    canvas.draw = function (force_canvas, force_bgcanvas) {
        if (this.dragging_canvas) {
            if (!panning) {
                if (this.dirty_bgcanvas) _origDraw.call(this, false, true);
                savedBgCanvas = this.bgcanvas;
                savedBgCtx = this.bgctx;
                panning = true;
                this.bgcanvas = this.canvas;
                this.bgctx = this.ctx;
            }
        } else if (panning) {
            panning = false;
            this.bgcanvas = savedBgCanvas;
            this.bgctx = savedBgCtx;
            this.dirty_bgcanvas = true;
            this.dirty_canvas = true;
        }
        _origDraw.call(this, force_canvas, force_bgcanvas);
    };
}
function uninstallSingleCanvasPan(canvas) {
    if (!_origDraw) return;
    if (_panInstalledOn === canvas) canvas.draw = _origDraw;
    _origDraw = null;
    _panInstalledOn = null;
    canvas.dirty_bgcanvas = true;
    canvas.dirty_canvas = true;
}

// ── 限制信息覆盖层 ──
let _origRenderInfo = null;
let _infoCanvas = null;
let _infoInstalledOn = null;
function installThrottleRenderInfo(canvas) {
    if (_origRenderInfo && _infoInstalledOn === canvas) return;
    if (_origRenderInfo && _infoInstalledOn !== canvas) { _origRenderInfo = null; _infoCanvas = null; }
    _infoInstalledOn = canvas;
    _origRenderInfo = canvas.renderInfo;
    _infoCanvas = document.createElement("canvas");
    let infoCtx = _infoCanvas.getContext("2d");
    let lastInfoTime = 0, cachedDpr = 0, _infoDrawX = 10, _infoDrawY = 0;
    canvas.renderInfo = function (ctx, x, y) {
        const dpr = window.devicePixelRatio || 1;
        if (dpr !== cachedDpr) {
            cachedDpr = dpr;
            _infoCanvas.width = Math.ceil(200 * dpr);
            _infoCanvas.height = Math.ceil(100 * dpr);
            infoCtx = _infoCanvas.getContext("2d");
            infoCtx.scale(dpr, dpr);
            lastInfoTime = 0;
        }
        const now = performance.now();
        if (now - lastInfoTime > 250) {
            lastInfoTime = now;
            infoCtx.clearRect(0, 0, 200, 100);
            const origX = x || 10;
            const lineHeight = 13;
            const lineCount = (this.graph ? 5 : 1) + (this.info_text ? 1 : 0);
            const origY = y || (this.canvas.height / dpr - (lineCount + 1) * lineHeight);
            _infoDrawX = origX; _infoDrawY = origY;
            _origRenderInfo.call(this, infoCtx, 1, 1);
        }
        ctx.drawImage(_infoCanvas, _infoDrawX - 1, _infoDrawY - 1, 200, 100);
    };
}
function uninstallThrottleRenderInfo(canvas) {
    if (!_origRenderInfo) return;
    if (_infoInstalledOn === canvas) canvas.renderInfo = _origRenderInfo;
    _origRenderInfo = null;
    _infoCanvas = null;
    _infoInstalledOn = null;
    canvas.setDirty(true, true);
}

app.registerExtension({
    name: "WOSAI.Performance",
    setup() {
        const canvas = app.canvas;
        if (!canvas) return;
        _originalVisualSettings ??= {
            renderShadows: canvas.render_shadows,
            renderConnectionBorders: canvas.render_connections_border,
            roundRadius: typeof LiteGraph !== "undefined" ? LiteGraph.ROUND_RADIUS : null,
        };
        if (wosaiGetBool(K_PAN, true)) installSingleCanvasPan(canvas);
        if (wosaiGetBool(K_SHADOW, false)) canvas.render_shadows = false;
        if (wosaiGetBool(K_BORDER, false)) canvas.render_connections_border = false;
        if (wosaiGetBool(K_RADIUS, false) && typeof LiteGraph !== "undefined") LiteGraph.ROUND_RADIUS = 0;
        if (wosaiGetBool(K_THROTTLE, true)) installThrottleRenderInfo(canvas);
    },
    remove() {
        const canvas = app.canvas;
        if (canvas) {
            uninstallSingleCanvasPan(canvas);
            uninstallThrottleRenderInfo(canvas);
            if (_originalVisualSettings) {
                canvas.render_shadows = _originalVisualSettings.renderShadows;
                canvas.render_connections_border = _originalVisualSettings.renderConnectionBorders;
            }
            canvas.setDirty(true, true);
        }
        if (typeof LiteGraph !== "undefined" && _originalVisualSettings?.roundRadius != null) {
            LiteGraph.ROUND_RADIUS = _originalVisualSettings.roundRadius;
        }
        _originalVisualSettings = null;
        delete window.__wosaiSetPerf;
    },
});
