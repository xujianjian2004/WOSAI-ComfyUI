// ══ WOSAI 视觉增强套件 —— 子球 A·特效（动态连线 + 仅高亮选中） ══════════════
//   动态连线：沿连线流动的粒子动画(4 模式 + 速度/大小)。
//   仅高亮选中：包 renderLink，非选中相关连线降透明。
//   连线动画绘制并入 layout-toolkit 的单一 onDrawForeground（经 hud-kit 前景注册表）。
import { t } from "./shared/i18n.js";
import { app } from "../../../scripts/app.js";
import { retryUntil } from "./shared/shared-utils.js";
import { registerHudTab, unregisterHudTab, registerForegroundDraw, unregisterForegroundDraw } from "./shared/hud-kit.js";
import { bezier, ctrlPoints, particleTs, routePoints, polyPointAt, LINK_MODES } from "./shared/link-fx-engine.js";
import { iconBtn, iconEl } from "./shared/svg-icons.js";
import { showTip, hideTip } from "./shared/tooltip.js";
import { STORAGE_KEYS } from "./shared/constants.js";
import { _sec, _row, buildControlPanel } from "./shared/panel-builder.js";
import { dodgeBall } from "./launcher.js";
import { calcSnapToNodeSide } from "./shared/canvas-utils.js";
import { getGlassTheme } from "./shared/glass-theme.js";

const SEC_STYLE = "font-size:var(--ws-text-md);font-weight:500;color:var(--ws-accent);margin:var(--ws-gap-lg) 0 var(--ws-gap-md)";

const LS = "wosai-link-fx";
const DEF = {
    on: false,
    mode: "particle",
    speed: 3,
    size: 1,
    count: 3,
    glow: 5,
    alpha: 80,
    linkAlpha: 100,
    color: _tokenColor('--ws-lf-link-default'),
    hlOn: true,         // 仅选中高亮：默认开启
    hlSolid: true,      // 纯色自定义高亮：默认开
    hlBreath: true,     // 呼吸灯发光：默认开
    hlFlow: false,      // 流动动态连线：默认关
    hlColor: _tokenColor('--ws-lf-link-highlight'),
    route: "round",     // 连线造型：圆角直角（两模式预设一致）
    fxImg: "",          // 自定义贴图(GIF/PNG/JPG dataURL)，mode==='image' 时作为流动素材
    fxText: "WOSAI",    // 自定义文字，mode==='text' 时沿连线流动
    magnet: true,       // 磁性吸附：拖线时高亮最近兼容端口(只读提示)
};

// 两种风格模式的默认参数预设：切换模式时套用（仅覆盖本模式相关字段，不影响另一模式的自定义值）
const PRESETS = {
    global:  { on: true,  hlOn: false, mode: "particle", speed: 3, size: 1, color: _tokenColor('--ws-lf-link-default'), route: "round", magnet: true },
    enhance: { on: false, hlOn: true,  hlSolid: true, hlBreath: true, hlFlow: false, hlColor: _tokenColor('--ws-lf-link-highlight'), route: "round", magnet: true },
};
const _cfg = load();
// 将 CSS var token 解析为实际颜色值（供 Canvas 绘制使用）
function _tokenColor(name) { return _resolveColor(`var(${name})`); }
function _resolveColor(token, fallback) {
    if (!token || !token.startsWith("var(")) return token || fallback;
    const name = token.slice(4, -1).trim();
    const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return val || fallback;
}
function load() {
    try {
        const saved = JSON.parse(localStorage.getItem(LS) || "{}");
        const merged = Object.assign({}, DEF, saved);
        // v2 默认值升级：新增字段或旧默认值 → 强制更新为新默认值
        // 已有的用户自定义值（非旧默认值）保持不变
        if (saved.hlOn === undefined || saved.hlOn === false) merged.hlOn = DEF.hlOn;
        if (saved.hlSolid === undefined || saved.hlSolid === false) merged.hlSolid = DEF.hlSolid;
        if (saved.hlBreath === undefined || saved.hlBreath === false) merged.hlBreath = DEF.hlBreath;
        if (saved.hlFlow === undefined || saved.hlFlow === false) merged.hlFlow = DEF.hlFlow;
        if (saved.hlColor === undefined || saved.hlColor === _tokenColor('--ws-lf-legacy-highlight')) merged.hlColor = DEF.hlColor;
        if (saved.magnet === undefined || saved.magnet === false) merged.magnet = DEF.magnet;
        if (merged.route === "wave") merged.route = "default"; // 移除 UI 选型后，旧配置迁回默认
        return merged;
    } catch (_) { return Object.assign({}, DEF); }
}
function save() { try { localStorage.setItem(LS, JSON.stringify(_cfg)); } catch (_) { console.warn("[WOSAI] 连线特效设置过大(可能是贴图)，本次仅临时生效"); } }

// 自定义贴图：保留原始 dataURL(不经 canvas 重编码，以保 GIF 动画)，挂到隐藏 DOM 让 GIF 动起来
let _fxImg = null;
let _fxPanel = null;
let _removeFxPanelDrag = null;
let _origRenderLink = null;      // 原 canvas.renderLink
let _lfUninstalled = false;      // 标记是否已卸载
function _loadFxImg() {
    if (_fxImg) { _fxImg.remove(); _fxImg = null; }
    if (!_cfg.fxImg) { app.canvas && app.canvas.setDirty(true, true); return; }
    const im = new Image();
    im.style.cssText = "position:fixed;left:var(--ws-lf-hidden-offset);top:var(--ws-lf-hidden-offset);width:var(--ws-lf-hidden-size);height:var(--ws-lf-hidden-size);opacity:0.01;pointer-events:none";
    im.onload = () => { app.canvas && app.canvas.setDirty(true, true); };
    im.src = _cfg.fxImg;
    document.body.appendChild(im);
    _fxImg = im;
}
function _pickFx(file) { if (!file) return; const fr = new FileReader(); fr.onload = () => { _cfg.fxImg = fr.result; save(); _loadFxImg(); }; fr.readAsDataURL(file); }

// ── 粒子绘制（图坐标）──
function _drawParticleAt(ctx, p, pNext, col) {     // 仅服务 image/text 叠加型：素材沿实线表层流动
    col = col || _cfg.color;
    ctx.save();
    ctx.globalAlpha = _cfg.alpha / 100;
    ctx.fillStyle = col; ctx.strokeStyle = col;
    if (_cfg.glow > 0) { ctx.shadowColor = col; ctx.shadowBlur = _cfg.glow * 2; }
    if (_cfg.mode === "image") {                      // 自定义贴图(GIF/PNG/JPG) 叠加于实线表层
        if (_fxImg && _fxImg.complete && _fxImg.naturalWidth) {
            const h = _cfg.size * 6, w = h * (_fxImg.naturalWidth / (_fxImg.naturalHeight || 1));
            ctx.drawImage(_fxImg, p[0] - w / 2, p[1] - h / 2, w, h);
        }
        ctx.restore(); return;
    }
    if (_cfg.mode === "text") {                       // 自定义文字 叠加于实线表层
        const txt = _cfg.fxText || "";
        if (txt) { ctx.font = "600 " + (_cfg.size * 4) + "px 'Microsoft YaHei', system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(txt, p[0], p[1]); }
        ctx.restore(); return;
    }
    ctx.restore();
}
// 磁性吸附：拖线时高亮最近兼容端口（只读提示，兼容新旧 litegraph 拖线状态）
function _magnetDraw(ctx, canvas) {
    if (!_cfg.magnet) return;
    let dragType = null, wantInput = false;
    if (canvas.connecting_node) {
        if (canvas.connecting_output) { dragType = canvas.connecting_output.type; wantInput = true; }
        else if (canvas.connecting_input) { dragType = canvas.connecting_input.type; wantInput = false; }
    } else if (canvas.connecting_links && canvas.connecting_links.length) {
        const cl = canvas.connecting_links[0];
        if (cl.output) { dragType = cl.output.type; wantInput = true; }
        else if (cl.input) { dragType = cl.input.type; wantInput = false; }
    }
    if (dragType == null) return;
    const m = canvas.graph_mouse; if (!m) return;
    const nodes = (canvas.graph && (canvas.graph._nodes || canvas.graph.nodes)) || [];
    const compat = (t) => dragType === "*" || t === "*" || t === dragType;
    let best = null, bestD = 1e9; const TH = 60;
    for (const n of nodes) {
        const ports = wantInput ? (n.inputs || []) : (n.outputs || []);
        for (let i = 0; i < ports.length; i++) {
            if (!compat(ports[i].type)) continue;
            let pp; try { pp = n.getConnectionPos(wantInput, i); } catch (_) { continue; }
            const d = Math.hypot(pp[0] - m[0], pp[1] - m[1]);
            if (d < TH && d < bestD) { bestD = d; best = pp; }
        }
    }
    if (!best) return;
    const r = 10 + 3 * Math.sin(performance.now() / 200);
    ctx.save(); ctx.strokeStyle = _cfg.hlColor || DEF.hlColor; ctx.lineWidth = 2;  // 保留 lineWidth：Canvas 绘制常量
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 10; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(best[0], best[1], r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
}
// 前景绘制：遍历连线画粒子（注册到单一 onDrawForeground）
function _fgDraw(ctx, canvas) {
    // 本体化后，particle/flow/breath/dashed 的流动已由连线本体(流动虚线)承担；
    // 仅 image/text 素材模式仍需前景叠加层沿连线绘制。
    if (_cfg.mode !== "image" && _cfg.mode !== "text") return;
    const flowAll = _cfg.on;                          // 全局流动
    const flowSel = _cfg.hlOn && _cfg.hlFlow;         // 仅选中连线流动
    if (!flowAll && !flowSel) return;
    const graph = canvas.graph, lk = graph && graph.links; if (!lk) return;
    const sel = canvas.selected_nodes || {};
    const iter = lk instanceof Map ? lk.values() : Object.values(lk);
    const phase = (performance.now() * 0.00006 * _cfg.speed) % 1;
    // 性能护栏：仅画可见区内连线 + 绘制数封顶（保留硬编码：运行时计算常量）
    const va = canvas.visible_area, MAR = 80, CAP = 500;
    const inView = (p) => !va || (p[0] >= va[0] - MAR && p[0] <= va[0] + va[2] + MAR && p[1] >= va[1] - MAR && p[1] <= va[1] + va[3] + MAR);
    let drawn = 0;
    for (const l of iter) {
        if (!l) continue;
        if (drawn >= CAP) break;                     // 封顶
        const hot = !!(sel[l.origin_id] || sel[l.target_id]);
        const selFlow = flowSel && hot;
        if (!flowAll && !selFlow) continue;          // 只画该流动的连线
        const o = graph.getNodeById && graph.getNodeById(l.origin_id);
        const t = graph.getNodeById && graph.getNodeById(l.target_id);
        if (!o || !t || !o.getConnectionPos || !t.getConnectionPos) continue;
        let a, b;
        try { a = o.getConnectionPos(false, l.origin_slot); b = t.getConnectionPos(true, l.target_slot); } catch (_) { continue; }
        if (!a || !b) continue;
        if (!inView(a) && !inView(b)) continue;      // 视口裁剪
        drawn++;
        const col = selFlow ? _cfg.hlColor : _cfg.color;
        // 粒子沿当前连线造型走：非默认用折线点，默认用贝塞尔
        const poly = (_cfg.route && _cfg.route !== "default") ? routePoints(a, b, _cfg.route) : null;
        const cps = poly ? null : ctrlPoints(a, b);
        const at = (t) => poly ? polyPointAt(poly, t) : bezier(a, cps[0], cps[1], b, t);
        for (const tt of particleTs(_cfg.count, phase)) _drawParticleAt(ctx, at(tt), at(Math.min(1, tt + 0.03)), col);
    }
}

// ── rAF：开启动画时持续重绘 ──
let _raf = 0, _lastT = 0;
function _animActive() { return _cfg.on || (_cfg.hlOn && (_cfg.hlBreath || _cfg.hlFlow)); }
function _tick() {
    if (!_animActive()) { _raf = 0; return; }
    const fps = parseInt(localStorage.getItem(STORAGE_KEYS.fps)) || 60;   // 性能模式：节流到目标 FPS
    const now = performance.now();
    if (now - _lastT >= 1000 / fps - 1) { _lastT = now; app.canvas && app.canvas.setDirty(true, true); }
    _raf = requestAnimationFrame(_tick);
}
function _ensureTick() { if (!_raf && _animActive()) _raf = requestAnimationFrame(_tick); }

// 自绘连线造型（替代贝塞尔）：直线 / 直角 / 圆角直角
function _drawRoute(ctx, a, b, color, alpha, glow, route) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.lineCap = "round";
    if (glow > 0) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
    const x0 = a[0], y0 = a[1], x1 = b[0], y1 = b[1], mx = (x0 + x1) / 2;
    ctx.beginPath(); ctx.moveTo(x0, y0);
    if (route === "straight") {
        ctx.lineTo(x1, y1);
    } else if (route === "round") {                 // 圆角直角
        const r = Math.min(20, Math.abs(y1 - y0) / 2, Math.abs(mx - x0));
        ctx.arcTo(mx, y0, mx, y1, r); ctx.arcTo(mx, y1, x1, y1, r); ctx.lineTo(x1, y1);
    } else {                                        // ortho 直角(Z 形)
        ctx.lineTo(mx, y0); ctx.lineTo(mx, y1); ctx.lineTo(x1, y1);
    }
    ctx.stroke();
    // 末端箭头（自绘造型无原生箭头）
    let adx, ady;
    if (route === "straight") { adx = x1 - x0; ady = y1 - y0; } else { adx = (x1 - mx) || 1; ady = 0; }
    const al = Math.hypot(adx, ady) || 1, ux = adx / al, uy = ady / al, hs = 7;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ux * hs - uy * hs * 0.55, y1 - uy * hs + ux * hs * 0.55);
    ctx.lineTo(x1 - ux * hs + uy * hs * 0.55, y1 - uy * hs - ux * hs * 0.55);
    ctx.closePath(); ctx.fill();
    ctx.restore();
}
// 自绘连线末端箭头（与 _drawRoute 一致，供动态本体复用）
function _drawArrow(ctx, a, b, route, color) {
    let adx, ady;
    if (route === "straight") { adx = b[0] - a[0]; ady = b[1] - a[1]; }
    else { const mx = (a[0] + b[0]) / 2; adx = (b[0] - mx) || 1; ady = 0; }
    const al = Math.hypot(adx, ady) || 1, ux = adx / al, uy = ady / al, hs = 7;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(b[0], b[1]);
    ctx.lineTo(b[0] - ux * hs - uy * hs * 0.55, b[1] - uy * hs + ux * hs * 0.55);
    ctx.lineTo(b[0] - ux * hs + uy * hs * 0.55, b[1] - uy * hs - ux * hs * 0.55);
    ctx.closePath(); ctx.fill();
}
// 动态本体连线：particle=实线底+流动圆点(圆点在实线上层)；dashed=流动虚线(药丸)。本体真实
function _drawDynamicLink(ctx, a, b, o) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, o.alpha));
    ctx.strokeStyle = o.color;
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1.5, o.lineWidth);
    if (o.glow > 0) { ctx.shadowColor = o.color; ctx.shadowBlur = o.glow * 2; }
    const poly = (o.route && o.route !== "default") ? routePoints(a, b, o.route) : null;
    const cps = poly ? null : ctrlPoints(a, b);
    // 一次性构建路径(Path2D)：「实线底」与「流动圆点」复用同一路径分层描边
    const path = new Path2D();
    if (poly) { path.moveTo(poly[0][0], poly[0][1]); for (let i = 1; i < poly.length; i++) path.lineTo(poly[i][0], poly[i][1]); }
    else { path.moveTo(a[0], a[1]); path.bezierCurveTo(cps[0][0], cps[0][1], cps[1][0], cps[1][1], b[0], b[1]); }

    if (o.mode === "particle") {
        // 1) 实线底（静态轨道，压暗以凸显上层圆点）
        ctx.setLineDash([]);
        ctx.lineCap = "round";
        ctx.lineWidth = Math.max(1.2, o.size * 0.8);
        ctx.globalAlpha = Math.max(0, Math.min(1, o.alpha * 0.45));
        ctx.stroke(path);
        // 2) 圆点（流动：圆头零长 dash 形成一串实心圆，绘制于实线之上）
        ctx.globalAlpha = Math.max(0, Math.min(1, o.alpha));
        ctx.lineWidth = Math.max(2, o.size * 2);       // 圆点直径
        const d = ctx.lineWidth;
        ctx.setLineDash([0.01, Math.max(d * 1.4, 16 - (o.count || 3) * 1.5)]); // 间隙控制圆点疏密
        ctx.lineDashOffset = -performance.now() * 0.01 * o.speed;
        ctx.stroke(path);
    } else {                                          // 虚线流光 → 胶囊效果：圆头短线段（药丸沿连线流动）
        ctx.lineCap = "round";
        ctx.lineWidth = Math.max(1.5, o.size);          // 胶囊粗细
        ctx.setLineDash([Math.max(2, o.size * 2.2), Math.max(5, o.size * 6 - (o.count || 3) * o.size)]); // 胶囊长 + 间隙
        ctx.lineDashOffset = -performance.now() * 0.01 * o.speed;
        ctx.stroke(path);
    }
    _drawArrow(ctx, a, b, o.route, o.color);
    ctx.restore();
}
// image/text 本体由原生 renderLink 绘制（实线底），素材叠加于其上，无需独立底色函数
// ── 包 renderLink：连线显隐 + 选中增强 + 电路板布线 ──
function _installLinkRender() {
    if (_lfUninstalled) return true;   // 已卸载则停止 retry
    const cv = app.canvas; if (!cv) return false;
    if (cv._wosaiLinkWrapped) return true;
    const orig = cv.renderLink; if (typeof orig !== "function") return false;
    _origRenderLink = orig;
    const _wrapRenderLink = function (ctx, a, b, link, skip_border, flow, color) {
        const la = _cfg.linkAlpha / 100;
        if (la <= 0) return;                          // 连线隐藏：不画本体
        const sel = this.selected_nodes || {};
        const anySel = Object.keys(sel).length;
        const hot = link && (sel[link.origin_id] || sel[link.target_id]);
        const isImageText = (_cfg.mode === "image" || _cfg.mode === "text");
        const globalFlow = _cfg.on;
        const selFlow = _cfg.hlOn && _cfg.hlFlow;
        // image/text 为叠加型：本体始终保持实线；其余模式在动态时本体即流动虚线
        const dynamic = !isImageText && (globalFlow || (selFlow && hot));

        let col = color || _cfg.color;
        let aMul = la, glow = 0;
        if (_cfg.hlOn && anySel) {
            if (!hot) { aMul = la * 0.13; }            // 非选中相关 → 弱化
            else {                                     // 选中相关 → 纯色 / 呼吸灯(可叠加)
                if (_cfg.hlSolid) col = _cfg.hlColor;
                if (_cfg.hlBreath) { const bb = 0.5 + 0.5 * Math.sin(performance.now() / 420); aMul = la * (0.4 + 0.6 * bb); glow = 4 + 12 * bb; }
            }
        }

        // 非动态本体（含 image/text 叠加型的实线底）：回退原生
        if (!dynamic) {
            if (_cfg.route && _cfg.route !== "default" && a && b) { _drawRoute(ctx, a, b, col || _tokenColor('--ws-lf-link-fallback'), (ctx.globalAlpha || 1) * Math.min(1, aMul), glow, _cfg.route); return; }
            let args = arguments; if (col !== color) { args = [...arguments]; args[6] = col; }
            if (aMul >= 1 && glow <= 0) return orig.apply(this, args);
            const sa = ctx.globalAlpha; ctx.globalAlpha = sa * Math.min(1, aMul);
            if (glow > 0) { ctx.save(); ctx.shadowColor = col || _cfg.hlColor; ctx.shadowBlur = glow; const r = orig.apply(this, args); ctx.restore(); ctx.globalAlpha = sa; return r; }
            const r = orig.apply(this, args); ctx.globalAlpha = sa; return r;
        }

        // ── 动态本体：圆点粒子 / 虚线流光 以流动虚线替代实线 ──
        _drawDynamicLink(ctx, a, b, {
            color: col,
            alpha: aMul * (_cfg.alpha / 100),
            glow: glow,
            lineWidth: _cfg.size,
            route: _cfg.route,
            mode: _cfg.mode,
            speed: _cfg.speed,
            size: _cfg.size,
            count: _cfg.count,
        });
    };
    cv.renderLink = _wrapRenderLink;
    cv._wosaiRenderLinkFn = _wrapRenderLink;
    cv._wosaiLinkWrapped = true;
    return true;
}

function _uninstallLinkRender() {
    const cv = app.canvas; if (!cv) return;
    if (cv.renderLink === cv._wosaiRenderLinkFn && typeof _origRenderLink === "function") {
        cv.renderLink = _origRenderLink;
    }
    delete cv._wosaiLinkWrapped;
    delete cv._wosaiRenderLinkFn;
}

export function buildFxSection() {
    const root = document.createElement("div");
    root.className = "wosai-fx-section wosai-control-section";
    root.style.cssText = "display:flex;flex-direction:column";
    _rebuildFxContent(root);
    return root;
}

function closeFxPanel() {
    if (_fxPanel) _fxPanel.style.display = "none";
}

function buildFxPanel() {
    const { panel, cleanup } = buildControlPanel({
        wsControl: "link-fx",
        wsModule: "fx",
        title: t("nodes.linkFx.link"),
        onClose: closeFxPanel,
        content: buildFxSection(),
    });
    _removeFxPanelDrag = cleanup;
    return panel;
}

function openFxPanel() {
    if (!_fxPanel) _fxPanel = buildFxPanel();
    if (_fxPanel.style.display !== "none") {
        closeFxPanel();
        return;
    }
    _fxPanel.setAttribute("data-theme", getGlassTheme());
    _fxPanel.style.display = "block";
    const rect = _fxPanel.getBoundingClientRect();
    const pos = calcSnapToNodeSide(rect.width, rect.height);
    _fxPanel.style.left = Math.round(pos.x) + "px";
    _fxPanel.style.top = Math.round(pos.y) + "px";
    requestAnimationFrame(() => dodgeBall(_fxPanel));
}

function _rebuildFxContent(root) {
    root.innerHTML = "";
    const MODE_LB = { particle: t("nodes.linkFx.modeDot"), dashed: t("nodes.linkFx.modeDashed"), image: t("nodes.linkFx.modeImage"), text: t("nodes.linkFx.modeText") };
    const _styleMode = () => _cfg.on ? "global" : "enhance";

    // ── 风格模式分段控件（互斥单选）──
    function _segmented(opts, getCur, onPick) {
        const wrap = document.createElement("div");
        wrap.style.cssText = "display:flex;gap:var(--ws-lf-segment-gap);background:var(--ws-surface-2);border:var(--ws-border-width-thin) solid var(--ws-border);border-radius:var(--ws-radius);padding:var(--ws-lf-segment-padding);margin-bottom:var(--ws-lf-segment-margin-bottom)";
        const items = opts.map(o => {
            const b = document.createElement("div");
            b.textContent = o.label;
            b.style.cssText = "flex:1;text-align:center;padding:var(--ws-lf-segment-item-padding);border-radius:var(--ws-lf-chip-radius);font-size:var(--ws-text-md);cursor:pointer;color:var(--ws-text-secondary);user-select:none";
            b.onclick = () => onPick(o.value);
            wrap.appendChild(b);
            return { value: o.value, el: b };
        });
        const sync = () => { const cur = getCur(); items.forEach(it => { const on = it.value === cur; it.el.style.background = on ? "var(--ws-accent)" : "transparent"; it.el.style.color = on ? "var(--ws-text-on-accent)" : "var(--ws-text-secondary)"; }); };
        sync();
        return { wrap, sync };
    }

    function _chips(opts, getCur, onPick, cols = 0) {
        const wrap = document.createElement("div");
        if (cols > 0) wrap.style.cssText = "display:grid;grid-template-columns:repeat(" + cols + ",minmax(0,1fr));gap:var(--ws-gap-sm);margin-bottom:var(--ws-gap);padding:var(--ws-lf-chips-padding)";
        else wrap.style.cssText = "display:flex;flex-wrap:wrap;gap:var(--ws-gap-sm);margin-bottom:var(--ws-gap);padding:var(--ws-lf-chips-padding);justify-content:center";
        const items = opts.map(o => {
            const b = document.createElement("div");
            b.textContent = o.label;
            b.style.cssText = "min-width:0;padding:var(--ws-lf-chip-padding);border-radius:var(--ws-lf-chip-radius);font-size:var(--ws-text-sm);line-height:var(--ws-line-height-normal);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;border:var(--ws-border-width-thin) solid var(--ws-border);color:var(--ws-text-secondary);user-select:none" + (cols > 0 ? ";text-align:center" : "");
            b.onclick = () => onPick(o.value);
            wrap.appendChild(b);
            return { value: o.value, el: b };
        });
        const sync = () => { const cur = getCur(); items.forEach(it => { const on = it.value === cur; it.el.style.background = on ? "var(--ws-accent)" : "var(--ws-surface-2)"; it.el.style.color = on ? "var(--ws-text-on-accent)" : "var(--ws-text-secondary)"; it.el.style.borderColor = on ? "var(--ws-accent)" : "var(--ws-border)"; }); };
        sync();
        return { wrap, sync };
    }

    function _toggle(checked, onChange) {
        const el = document.createElement("div");
        const paint = (on) => { el.style.background = on ? "var(--ws-accent)" : "var(--ws-surface-2)"; el.style.justifyContent = on ? "flex-end" : "flex-start"; };
        el.style.cssText = "width:var(--ws-lf-toggle-w);height:var(--ws-lf-toggle-h);border-radius:var(--ws-lf-toggle-radius);display:inline-flex;align-items:center;padding:var(--ws-lf-toggle-padding);cursor:pointer;border:var(--ws-border-width-thin) solid var(--ws-border);box-sizing:border-box";
        const knob = document.createElement("span"); knob.style.cssText = "width:var(--ws-lf-toggle-knob-size);height:var(--ws-lf-toggle-knob-size);border-radius:50%;background:var(--ws-text-on-accent)"; el.appendChild(knob);
        el.onclick = () => { checked = !checked; paint(checked); onChange(checked); };
        paint(checked);
        return el;
    }

    function _slider(label, key, min, max, suffix) {
        const cell = document.createElement("div");
        cell.style.cssText = "display:flex;align-items:center;gap:var(--ws-gap-sm);min-width:0";
        const lab = document.createElement("span"); lab.textContent = label; lab.style.cssText = "font-size:var(--ws-text-sm);color:var(--ws-text);width:var(--ws-lf-slider-label-width);flex:none;white-space:nowrap";
        const sliderWrap = document.createElement("div");
        sliderWrap.style.cssText = "position:relative;flex:1;min-width:0;display:flex;align-items:center";
        const sl = document.createElement("input"); sl.type = "range"; sl.min = min; sl.max = max; sl.value = _cfg[key]; sl.style.cssText = "width:100%;min-width:0;accent-color:var(--ws-accent);height:var(--ws-text-lg)";
        const bubble = document.createElement("span");
        bubble.hidden = true;
        bubble.style.cssText = "position:absolute;bottom:calc(100% + var(--ws-gap-xs));transform:translateX(-50%);padding:var(--ws-gap-2xs) var(--ws-gap-xs);border-radius:var(--ws-radius-sm);background:var(--ws-surface-3);color:var(--ws-text);font-size:var(--ws-text-xs);line-height:1;pointer-events:none;white-space:nowrap";
        let dragging = false;
        const syncBubble = () => {
            const value = Number(sl.value);
            const ratio = (value - min) / (max - min);
            bubble.textContent = value + (suffix || "");
            bubble.style.left = `${ratio * 100}%`;
        };
        const hideBubble = () => { dragging = false; bubble.hidden = true; };
        sl.addEventListener("pointerdown", () => { dragging = true; syncBubble(); bubble.hidden = false; });
        sl.addEventListener("pointerup", hideBubble);
        sl.addEventListener("pointercancel", hideBubble);
        sl.addEventListener("change", hideBubble);
        sl.oninput = () => {
            _cfg[key] = parseInt(sl.value);
            if (dragging) { syncBubble(); bubble.hidden = false; }
            save(); app.canvas && app.canvas.setDirty(true, true);
        };
        sliderWrap.append(sl, bubble);
        cell.append(lab, sliderWrap);
        return cell;
    }

    function _colorRow(getColor, setColor) {
        const row = _row(); row.style.cssText = "display:flex;align-items:center;gap:var(--ws-gap-md);margin-top:var(--ws-gap)";
        const lab = document.createElement("span"); lab.textContent = t('nodes.linkFx.highlightColor'); lab.style.cssText = "font-size:var(--ws-text-md);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0";
        const sw = document.createElement("span"); sw.style.cssText = "width:var(--ws-lf-color-swatch-size);height:var(--ws-lf-color-swatch-size);border-radius:50%;background:" + getColor() + ";border:var(--ws-border-width-thin) solid var(--ws-border);cursor:pointer;flex:none";
        const hid = document.createElement("input"); hid.type = "color"; hid.value = getColor(); hid.style.cssText = "position:absolute;opacity:0;width:0;height:0;pointer-events:none";
        hid.oninput = () => { setColor(hid.value); sw.style.background = hid.value; save(); app.canvas && app.canvas.setDirty(true, true); };
        sw.onclick = (e) => { e.stopPropagation(); hid.click(); };
        const rnd = mkToolBtn(iconEl('random', 20), t('nodes.linkFx.randomColor'));
        rnd.onclick = (e) => { e.stopPropagation(); const hex = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'); setColor(hex); hid.value = hex; sw.style.background = hex; save(); app.canvas && app.canvas.setDirty(true, true); };
        const eye = mkToolBtn(iconEl('eyedropper', 20), t('nodes.linkFx.pickColor'));
        eye.onclick = (e) => { e.stopPropagation(); hid.click(); };
        row.appendChild(lab); row.appendChild(sw); row.appendChild(eye); row.appendChild(rnd); row.appendChild(hid);
        return row;
    }

    function mkToolBtn(iconElNode, tip) {
        const b = document.createElement("span");
        b.appendChild(iconElNode);
        b.style.cssText = "width:var(--ws-icon-btn-size);height:var(--ws-lf-tool-btn-height);display:inline-flex;align-items:center;justify-content:center;border-radius:var(--ws-lf-tool-btn-radius);background:var(--ws-surface-2);cursor:pointer;color:var(--ws-icon);user-select:none;flex-shrink:0;transition:color .12s,transform .12s";
        b.onmousedown = e => e.preventDefault();
        b._tip = tip;
        b.onmouseenter = () => { b.style.color = 'var(--ws-accent)'; b.style.transform = 'scale(1.12)'; if (b._tip) showTip(b, b._tip); };
        b.onmouseleave = () => { b.style.color = 'var(--ws-icon)'; b.style.transform = ''; hideTip(); };
        return b;
    }

    // ══ 分段控件：风格模式（互斥）══
    const seg = _segmented(
        [
            { value: "global", label: t('nodes.linkFx.globalDynamic') },
            { value: "enhance", label: t('nodes.linkFx.onlySelected') },
        ],
        _styleMode,
        (v) => {
            Object.assign(_cfg, PRESETS[v] || {});
            save();
            _rebuildFxContent(root);
            _ensureTick(); app.canvas && app.canvas.setDirty(true, true);
        }
    );
    const hint = document.createElement("div"); hint.textContent = t('nodes.linkFx.mutualExclusiveHint'); hint.style.cssText = "font-size:var(--ws-text-base);color:var(--ws-text-secondary);margin-bottom:var(--ws-gap)";
    root.appendChild(seg.wrap); root.appendChild(hint);

    // ══ 区块 A：全局动态效果 ══
    const dynSection = document.createElement("div"); dynSection.className = "wosai-control-section";
    dynSection.appendChild(_sec(t('nodes.linkFx.effectStyle'), SEC_STYLE));

    const modeChips = _chips(
        LINK_MODES.map(m => ({ value: m, label: MODE_LB[m] || m })),
        () => _cfg.mode,
        (v) => { _cfg.mode = v; modeChips.sync(); imgRow.style.display = v === "image" ? "flex" : "none"; txtRow.style.display = v === "text" ? "flex" : "none"; save(); app.canvas && app.canvas.setDirty(true, true); },
        4
    );
    dynSection.appendChild(modeChips.wrap);

    const imgRow = _row(); imgRow.style.cssText = "display:" + (_cfg.mode === "image" ? "flex" : "none") + ";align-items:center;gap:var(--ws-gap-md);margin-bottom:var(--ws-gap)";
    const ibtn = iconBtn('folder', t('nodes.linkFx.chooseTexture')); ibtn.style.cssText = "flex:1;height:var(--ws-lf-btn-height);border-radius:var(--ws-lf-btn-radius);border:var(--ws-border-width-thin) solid var(--ws-border);background:var(--ws-surface-2);color:var(--ws-text);font-size:var(--ws-text-md);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:var(--ws-gap-sm)";
    const ifile = document.createElement("input"); ifile.type = "file"; ifile.accept = "image/gif,image/png,image/jpeg"; ifile.style.display = "none";
    ifile.onchange = () => { _pickFx(ifile.files[0]); ifile.value = ""; };
    ibtn.onclick = () => ifile.click();
    imgRow.appendChild(ibtn); imgRow.appendChild(ifile); dynSection.appendChild(imgRow);

    const txtRow = _row(); txtRow.style.cssText = "display:" + (_cfg.mode === "text" ? "flex" : "none") + ";align-items:center;gap:var(--ws-gap-md);margin-bottom:var(--ws-gap)";
    const tlab = document.createElement("span"); tlab.textContent = t('nodes.linkFx.text'); tlab.style.cssText = "width:var(--ws-lf-slider-label-width);font-size:var(--ws-text-md)";
    const tin = document.createElement("input"); tin.type = "text"; tin.value = _cfg.fxText || ""; tin.placeholder = t('nodes.linkFx.inputTextPlaceholder'); tin.spellcheck = false;
    tin.style.cssText = "flex:1;height:var(--ws-lf-input-height);box-sizing:border-box;padding:0 var(--ws-gap-md);border-radius:var(--ws-radius);background:var(--ws-surface-2);color:var(--ws-text);border:var(--ws-border-width-thin) solid var(--ws-border);font-size:var(--ws-text-md);outline:none";
    tin.oninput = () => { _cfg.fxText = tin.value; save(); app.canvas && app.canvas.setDirty(true, true); };
    tin.onkeydown = (e) => e.stopPropagation();
    txtRow.appendChild(tlab); txtRow.appendChild(tin); dynSection.appendChild(txtRow);

    const grid = document.createElement("div"); grid.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--ws-gap-md);margin-bottom:var(--ws-gap)";
    grid.appendChild(_slider(t('nodes.linkFx.speed'), "speed", 1, 20));
    grid.appendChild(_slider(t('nodes.linkFx.size'), "size", 1, 8));
    dynSection.appendChild(grid);
    dynSection.appendChild(_colorRow(() => _cfg.color, (hex) => { _cfg.color = hex; }));

    // ══ 区块 B：仅选中高亮 ══
    const hlSection = document.createElement("div"); hlSection.className = "wosai-control-section";
    hlSection.appendChild(_sec(t('nodes.linkFx.selectedHighlight'), SEC_STYLE));
    function _hlToggleRow(labelKey, flagKey) {
        const row = _row(); row.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--ws-gap-sm)";
        const lab = document.createElement("span"); lab.textContent = t(labelKey); lab.style.cssText = "font-size:var(--ws-text-md)";
        const tg = _toggle(!!_cfg[flagKey], (on) => { _cfg[flagKey] = on; save(); app.canvas && app.canvas.setDirty(true, true); });
        row.appendChild(lab); row.appendChild(tg);
        return row;
    }
    hlSection.appendChild(_hlToggleRow('nodes.linkFx.enableSelected', 'hlOn'));
    hlSection.appendChild(_hlToggleRow('nodes.linkFx.effectSolidHighlight', 'hlSolid'));
    hlSection.appendChild(_hlToggleRow('nodes.linkFx.effectBreathingGlow', 'hlBreath'));
    hlSection.appendChild(_hlToggleRow('nodes.linkFx.effectFlowingLink', 'hlFlow'));
    hlSection.appendChild(_colorRow(() => _cfg.hlColor, (hex) => { _cfg.hlColor = hex; }));

    // ══ 恒作用：连线造型 ══
    root.appendChild(dynSection);
    root.appendChild(hlSection);
    root.appendChild(_sec(t('nodes.linkFx.lineStyle') + "（" + t('nodes.linkFx.alwaysOn') + "）", SEC_STYLE));
    const styleChips = _chips(
        [        ["default", t("nodes.linkFx.styleDefaultCurve")], ["straight", t("nodes.linkFx.styleStraight")], ["ortho", t("nodes.linkFx.styleCircuit")], ["round", t("nodes.linkFx.styleRounded")]].map(([k, l]) => ({ value: k, label: l })),
        () => _cfg.route,
        (v) => { _cfg.route = v; styleChips.sync(); save(); app.canvas && app.canvas.setDirty(true, true); },
        4
    );
    root.appendChild(styleChips.wrap);

    // ══ 辅助：磁吸对齐 ══
    const mgRow = _row(); mgRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-top:var(--ws-gap)";
    const ml = document.createElement("span"); ml.textContent = t('nodes.linkFx.magneticSnap'); ml.style.cssText = "font-size:var(--ws-text-md);font-weight:500;color:var(--ws-accent)";
    const mtg = _toggle(!!_cfg.magnet, (on) => { _cfg.magnet = on; save(); app.canvas && app.canvas.setDirty(true, true); });
    mgRow.appendChild(ml); mgRow.appendChild(mtg);
    root.appendChild(mgRow);

    // ══ 底部操作：重置 / 确认 ══
    function _resetPreset() {
        const m = _styleMode();
        Object.assign(_cfg, PRESETS[m] || {});
        save();
        _rebuildFxContent(root);
        _ensureTick(); app.canvas && app.canvas.setDirty(true, true);
        _flash(t('nodes.linkFx.resetDone'));
    }
    function _flash(msg) {
        const el = document.createElement("div");
        el.textContent = msg;
        el.style.cssText = "position:fixed;left:50%;top:var(--ws-lf-flash-top);transform:translateX(-50%);z-index:var(--ws-lf-flash-z);padding:var(--ws-lf-flash-padding);border-radius:var(--ws-radius);background:var(--ws-accent);color:var(--ws-text-on-accent);font-size:var(--ws-text-sm);box-shadow:var(--ws-shadow-panel);opacity:0;transition:opacity .18s;pointer-events:none";
        document.body.appendChild(el);
        requestAnimationFrame(() => { el.style.opacity = "1"; });
        setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 200); }, 1200);
    }
    function _bindBtnFx(btn, hoverBg, activeFilter) {
        btn.onmouseenter = () => { btn.style.background = hoverBg; };
        btn.onmouseleave = () => { btn.style.background = ""; };
        btn.onmousedown = () => { btn.style.filter = activeFilter; };
        btn.onmouseup = () => { btn.style.filter = ""; };
        btn.onmouseout = () => { btn.style.filter = ""; };
    }
    const footer = document.createElement("div");
    footer.className = "wosai-control-footer";
    footer.style.cssText = "display:flex;gap:var(--ws-gap-md);margin-top:var(--ws-gap-md)";
    const resetBtn = document.createElement("button");
    resetBtn.textContent = t('nodes.linkFx.reset');
    resetBtn.style.cssText = "flex:1;height:var(--ws-lf-btn-height);border-radius:var(--ws-lf-btn-radius);border:var(--ws-border-width-thin) solid var(--ws-border);background:var(--ws-surface-2);color:var(--ws-text);font-size:var(--ws-text-md);cursor:pointer";
    resetBtn.onclick = _resetPreset;
    _bindBtnFx(resetBtn, "var(--ws-surface-3)", "brightness(0.92)");
    const okBtn = document.createElement("button");
    okBtn.textContent = t('nodes.linkFx.confirm');
    okBtn.style.cssText = "flex:1;height:var(--ws-lf-btn-height);border-radius:var(--ws-lf-btn-radius);border:none;background:var(--ws-accent);color:var(--ws-text-on-accent);font-size:var(--ws-text-md);cursor:pointer";
    okBtn.onclick = () => { save(); window.__wosaiCloseLinkFx?.(); };
    _bindBtnFx(okBtn, "var(--ws-accent-hover)", "brightness(0.92)");
    footer.appendChild(resetBtn); footer.appendChild(okBtn);
    root.appendChild(footer);

    function _applySections() {
        const m = _styleMode();
        dynSection.style.display = m === "global" ? "block" : "none";
        hlSection.style.display = m === "enhance" ? "block" : "none";
    }
    _applySections();
}


app.registerExtension({
    name: "WOSAI.LinkFX",
    setup() {
        window.__wosaiOpenLinkFx = openFxPanel;
        window.__wosaiCloseLinkFx = closeFxPanel;
        registerHudTab({ id: "fx", label: t("nodes.linkFx.link"), order: 5, panel: openFxPanel });
        registerForegroundDraw(_fgDraw);
        registerForegroundDraw(_magnetDraw);
        _loadFxImg();
        if (!_installLinkRender()) { retryUntil(() => _installLinkRender(), 40, 250); }
        _ensureTick();
    },
    remove() {
        _lfUninstalled = true;
        delete window.__wosaiOpenLinkFx;
        delete window.__wosaiCloseLinkFx;
        closeFxPanel();
        _removeFxPanelDrag?.();
        _removeFxPanelDrag = null;
        if (_fxPanel) { _fxPanel.remove(); _fxPanel = null; }
        _uninstallLinkRender();
        unregisterForegroundDraw(_fgDraw);
        unregisterForegroundDraw(_magnetDraw);
        if (_raf) { cancelAnimationFrame(_raf); _raf = 0; }
        if (_fxImg) { _fxImg.remove(); _fxImg = null; }
        unregisterHudTab("fx");
    }
});
