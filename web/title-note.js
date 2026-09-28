/* WOSAI TitleNote v2.0 | 作者：穿山阅海 | COPYRIGHT © WOSAI STUDIO */
/**
 * TitleNote — 标题注释节点（融合 XiaozhuguangTitle 基座架构）
 * 架构来源：ComfyUI-xiaozhuguang (beforeRegisterNodeDef + computeSize + rainbow)
 * 功能来源：WOSAI (CJK 智能换行、链接解析、Nodes 2.0 DOM 兼容、描边、颜色预设、Pinned、语言切换)
 */
import { app } from "../../../scripts/app.js";
import { hsv2hex, hex2hsv } from "./shared/color-core.js";
import { roundRect as canvasRoundRect } from "./shared/canvas-polyfill.js";
import { t, localizedProp, registerLocalizedNode, onLangChange } from "./shared/i18n.js";
import { getWOSAIVar, getWOSAIVarNum } from "./shared/shared-utils.js";
import { bindTip } from "./shared/tooltip.js";
import { patchMethod } from "./shared/method-patch.js";
import { ensureWosaiStyles } from "./shared/dom-widget.js";

// 共享离屏 2D 上下文：文本测量处于按键/每帧热点路径上，
// 复用同一个 canvas context 可避免反复创建临时 canvas 对象。
let _measureContext = null;
function getMeasureContext() {
    if (!_measureContext) _measureContext = document.createElement("canvas").getContext("2d");
    return _measureContext;
}

/* ════════════════════════════════════════════════════════════════
   CSS 注入（确保样式表加载）
   ════════════════════════════════════════════════════════════════ */
(function ensureTitleNoteCSS() {
    ensureWosaiStyles([
        ["wosai-title-note-css", new URL("./styles/title-note.css?v=6", import.meta.url).href]
    ]);
})();

/* ════════════════════════════════════════════════════════════════
   常量 & 工具函数
   ════════════════════════════════════════════════════════════════ */

const _TN_TYPE = "WOSAI_TitleNote";
const _URL_CHARS  = "a-zA-Z0-9._~:/?#\\[\\]@!$&'()*+,;=%\\-";

const LINK_REGEX = new RegExp(
    "(\\[\\[(.+?)\\]\\])" +
    "|(https?:\\/\\/[" + _URL_CHARS + "]+)" +
    "|(www\\.[" + _URL_CHARS + "]+)",
    "g"
);

const isChinese   = (ch) => /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(ch);
const isBreakPoint = (ch) => /[\s\p{P}\p{S}]/u.test(ch);
const isPunct     = (ch) => /\p{P}|\p{S}/u.test(ch);

const CJK_PUNCT_SET = new Set(
    '，。、！？：；「」『』【】《》（）\u201C\u201D\u2018\u2019—…～．'.split('')
);
const isCJKPunct        = (ch) => CJK_PUNCT_SET.has(ch);
const isCJKLike         = (ch) => isChinese(ch) || isCJKPunct(ch);

const LINE_START_FORBIDDEN = new Set(
    ',，.;；!！\u201D\u2019」』'.split('')
);
const isLineStartForbidden = (ch) => LINE_START_FORBIDDEN.has(ch);

const _FIXED_FONT = 'Inter, Arial, sans-serif';

let   _cachedComfyFont = null;
let   _cachedFontTime  = 0;
const FONT_CACHE_TTL   = 3000;

/* Canvas 绘制时使用的语义 token 缓存 */
let _cachedLinkColor   = null;
let _cachedStrokeColor = null;
function getLinkColor () {
    if (!_cachedLinkColor)
        _cachedLinkColor = getWOSAIVar('--ws-syntax-link');
    return _cachedLinkColor;
}
function getEditStrokeColor () {
    if (!_cachedStrokeColor)
        _cachedStrokeColor = getWOSAIVar('--ws-accent');
    return _cachedStrokeColor;
}

function getComfyUIFont () {
    const now = Date.now();
    if (_cachedComfyFont && (now - _cachedFontTime) < FONT_CACHE_TTL)
        return _cachedComfyFont;
    _cachedComfyFont = _FIXED_FONT;
    _cachedFontTime  = now;
    return _cachedComfyFont;
}

/* ── 颜色辅助 ── */
function _hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 255, g: 255, b: 255 };
}

function _contrastTextColor(bgHex) {
    const { r, g, b } = _hexToRgb(bgHex);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return getWOSAIVar(luminance > 0.5 ? '--ws-tn-contrast-dark' : '--ws-tn-default-text');
}

function _relativeLuminance(hex) {
    const { r, g, b } = _hexToRgb(hex);
    const channel = (value) => {
        const normalized = value / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function _darkenHex(hex, factor = 0.42) {
    const { r, g, b } = _hexToRgb(hex);
    const channel = (value) => Math.max(0, Math.min(255, Math.round(value * factor)));
    return `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`;
}

function getAutoTitleBorderColor(properties) {
    const alpha = Number(properties?.backgroundAlpha);
    if (Number.isFinite(alpha) && alpha > 0.01) {
        const background = properties?.backgroundColor || getWOSAIVar('--ws-tn-default-bg');
        // A color-derived darker edge keeps the border coherent with colored
        // TitleNote backgrounds instead of turning every note into a black box.
        if (_relativeLuminance(background) > 0.035) return _darkenHex(background);
    }
    const themeBackground = getWOSAIVar('--ws-bg');
    return _relativeLuminance(themeBackground) > 0.5
        ? getWOSAIVar('--ws-tn-contrast-dark')
        : getWOSAIVar('--ws-tn-default-text');
}

function _hslToRgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

/* ════════════════════════════════════════════════════════════════
   文本分段 & CJK 智能换行引擎（WOSAI 核心）
   ════════════════════════════════════════════════════════════════ */

function parseSegments (text) {
    LINK_REGEX.lastIndex = 0;
    const segments = [];
    let   match, last = 0;
    while ((match = LINK_REGEX.exec(text)) !== null) {
        if (match.index > last)
            segments.push({ type: 'text', content: text.substring(last, match.index), url: null });
        if      (match[1]  !== undefined) segments.push({ type: 'link', content: match[2], url: match[2] });
        else if (match[3]  !== undefined) segments.push({ type: 'link', content: match[3], url: match[3] });
        else if (match[4]  !== undefined) segments.push({ type: 'link', content: match[4], url: match[4] });
        last = match.index + match[0].length;
    }
    if (last < text.length)
        segments.push({ type: 'text', content: text.substring(last), url: null });
    return segments;
}

function buildCharList (segments) {
    const list = [];
    for (const seg of segments)
        for (const ch of seg.content)
            list.push({ ch, type: seg.type, url: seg.url });
    return list;
}

function wrapCharList (ctx, charList, maxWidth) {
    if (!charList || charList.length === 0) return [[]];
    const lines = [];
    let   line   = [];
    let   lineStr = '';

    const rebuild = () => { lineStr = line.map(c => c.ch).join(''); };

    for (let i = 0; i < charList.length; i++) {
        const c = charList[i];
        if (c.ch === '\n') {
            lines.push(line);
            line = []; lineStr = '';
            continue;
        }
        const test = lineStr + c.ch;
        if (ctx.measureText(test).width > maxWidth && line.length > 0) {
            if (isCJKLike(c.ch)) {
                lines.push(line);
                line = [c]; lineStr = c.ch;
            } else {
                let lastCJK = -1;
                for (let k = line.length - 1; k >= 0; k--)
                    if (isCJKLike(line[k].ch)) { lastCJK = k; break; }
                if (lastCJK >= 0) {
                    lines.push(line.slice(0, lastCJK + 1));
                    line = [...line.slice(lastCJK + 1), c];
                    rebuild();
                } else {
                    const limit = Math.min(20, line.length);
                    let bp = -1;
                    for (let j = line.length - 1; j >= line.length - limit; j--)
                        if (isBreakPoint(line[j].ch)) { bp = j; break; }
                    if (bp >= 0) {
                        lines.push(line.slice(0, bp + 1));
                        line = [...line.slice(bp + 1), c];
                        rebuild();
                        if (line.length > 0 && isPunct(line[0].ch)) {
                            let pEnd = 0;
                            while (pEnd < line.length && isPunct(line[pEnd].ch)) pEnd++;
                            lines[lines.length - 1] = [...lines[lines.length - 1], ...line.slice(0, pEnd)];
                            line = line.slice(pEnd);
                            rebuild();
                        }
                    } else if (isPunct(c.ch)) {
                        lines.push([...line, c]);
                        line = []; lineStr = '';
                    } else {
                        lines.push(line);
                        line = [c]; lineStr = c.ch;
                    }
                }
            }
            let fix = 0;
            while (fix++ < 20 && line.length > 0 && isLineStartForbidden(line[0].ch) && lines.length > 0) {
                const prev = lines[lines.length - 1];
                if (!prev || prev.length <= 1) break;
                const last = prev[prev.length - 1];
                if (isCJKLike(last.ch)) {
                    line = [last, ...line];
                    lines[lines.length - 1] = prev.slice(0, -1);
                } else if (!isBreakPoint(last.ch)) {
                    let ws = prev.length - 1;
                    while (ws > 0 && !isBreakPoint(prev[ws - 1].ch)) ws--;
                    if (ws === 0) {
                        line = [last, ...line];
                        lines[lines.length - 1] = prev.slice(0, -1);
                    } else {
                        line = [...prev.slice(ws), ...line];
                        lines[lines.length - 1] = prev.slice(0, ws);
                    }
                } else break;
                rebuild();
            }
        } else {
            line.push(c);
            lineStr = test;
        }
    }
    if (line.length > 0) lines.push(line);
    return lines.length > 0 ? lines : [[]];
}

let _tnUninstalled = false;
const _titleNoteSetupTimers = new Set();
function _tnSchedule (callback, delay) {
    const timer = setTimeout(() => {
        _titleNoteSetupTimers.delete(timer);
        if (!_tnUninstalled) callback();
    }, delay);
    _titleNoteSetupTimers.add(timer);
    return timer;
}
function getTitleNoteTitle () { return t('nodes.titleNote.nodeTitle'); }

/* ════════════════════════════════════════════════════════════════
   TitleNoteNode 类（纯 Canvas 渲染，无 DOM 覆盖层）
   ════════════════════════════════════════════════════════════════ */

class TitleNoteBaseNode extends LGraphNode {
    constructor (title) {
        super(title);
        this.serialize_widgets = true;
        this.isVirtualNode     = true;
        this.class_type        = this.constructor.type;
        this.type              = this.constructor.type;
        this.pos               = [0, 0];
    }

    static setUp () {
        if (!this.registered) {
            LiteGraph.registerNodeType(this.type, this);
            this.registered = true;
        }
    }

    configure (info) {
        if (info.properties) Object.assign(this.properties, info.properties);
        if (info.pos)     this.pos  = info.pos;
        if (info.size)    this.size = info.size;
        if (info.flags)   this.flags = { ...info.flags };
    }

    serialize () {
        const data = super.serialize();
        if (!data.id    && this.id)           data.id = this.id;
        if (!data.order && this.order !== undefined) data.order = this.order;
        if (!data.mode  && this.mode  !== undefined) data.mode  = this.mode;
        data.properties = { ...this.properties };
        if (!data.pos  && this.pos)  data.pos  = [...this.pos];
        if (!data.size && this.size) data.size = [...this.size];
        if (!data.flags && this.flags) data.flags = { ...this.flags };
        return data;
    }
}

class TitleNoteNode extends TitleNoteBaseNode {

    constructor (title) {
        super(title);
        this.flags = this.flags || {};
        this.flags.allow_interaction = !this.flags.pinned;
        this.properties = {
            text:             t('nodes.titleNote.defaultText'),
            fontSize:         50,
            fontColor:        getWOSAIVar('--ws-tn-default-text'),
            strokeEnabled:    false,
            backgroundColor:  getWOSAIVar('--ws-tn-default-bg'),
            backgroundAlpha:  0,
            borderRadius:     55,
            padding:          20,
            lineHeight:       1.4,
            letterSpacing:    0,
            textAlign:       "center",
            rainbowEnabled:   false,
            rainbowSpeed:     30,
            rainbowStyle:     "wave",
        };
        this.resizable  = true;
        this.size        = [400, 120];
        this.color       = "transparent";
        this.bgcolor     = "transparent";
        this.isEditing   = false;
        this.editTextarea = null;
        this.linkAreas   = [];
        this._freezeEditorPosition = false;
        this._freezeEditorTimeout = null;
    }

    _freezeEditors (ms = 300) {
        this._freezeEditorPosition = true;
        if (this._freezeEditorTimeout) clearTimeout(this._freezeEditorTimeout);
        this._freezeEditorTimeout = setTimeout(() => {
            this._freezeEditorPosition = false;
            this._freezeEditorTimeout = null;
            if (this.updateEditorsPosition) this.updateEditorsPosition();
        }, ms);
    }

    /* ════════════════════════════════════════════════════════════════
       computeSize（精确测量 + WOSAI padding）
       ════════════════════════════════════════════════════════════════ */
    computeSize () {
        const p = this.properties;
        const fontSize = p.fontSize || 50;
        const text = p.text || "";
        const lineHeight = fontSize * (p.lineHeight || 1.4);
        const lines = text.split("\n");
        const cv = (window.app?.canvas || LGraphCanvas.active_canvas)?.canvas;
        const ctx = cv ? cv.getContext("2d") : null;
        let maxWidth = 0;
        let firstAscent = fontSize, lastDescent = fontSize * 0.15;
        if (ctx) {
            ctx.save();
            ctx.font = `normal ${fontSize}px ${getComfyUIFont()}`;
            ctx.letterSpacing = `${p.letterSpacing || 0}px`;
            lines.forEach((line, i) => {
                const m = ctx.measureText(line);
                if (m.width > maxWidth) maxWidth = m.width;
                if (i === 0) firstAscent = m.actualBoundingBoxAscent || fontSize;
                if (i === lines.length - 1) lastDescent = m.actualBoundingBoxDescent || fontSize * 0.15;
            });
            ctx.restore();
        } else {
            lines.forEach(line => {
                const w = fontSize * line.length * 0.6 + (line.length - 1) * (p.letterSpacing || 0);
                if (w > maxWidth) maxWidth = w;
            });
        }
        const trailing = Math.abs(p.letterSpacing || 0);
        const adjustedMax = maxWidth > trailing ? maxWidth - trailing : 0;
        const totalBlockH = lines.length > 1
            ? firstAscent + (lines.length - 1) * lineHeight + lastDescent
            : firstAscent + lastDescent;
        const pad = p.padding || 20;
        const w = Math.max(80, adjustedMax + pad * 2 + 10);
        const h = Math.max(40, totalBlockH + pad * 2);
        return [w, h];
    }

    /* ── 多行文本绘制（CJK 换行 + 链接 + 炫彩）── */
    drawMultilineText (ctx, text, maxWidth, lineHeight) {
        this.linkAreas = [];
        const processed = text.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const segments  = parseSegments(processed);
        const chars     = buildCharList(segments);
        const lines     = wrapCharList(ctx, chars, maxWidth);
        if (lines.length === 0) return;

        const totalHeight = (lines.length - 1) * lineHeight + this.properties.fontSize;
        const startY     = (this.size[1] - totalHeight) / 2 + this.properties.fontSize / 10;
        ctx.textBaseline = "top";
        if (typeof ctx.letterSpacing === "string") {
            ctx.letterSpacing = this.properties.letterSpacing + "px";
        }

        for (let idx = 0; idx < lines.length; idx++) {
            const lineChars = lines[idx];
            if (lineChars.length === 0) continue;
            const y = startY + idx * lineHeight;

            const groups = [];
            let gi = 0;
            while (gi < lineChars.length) {
                const { type, url } = lineChars[gi];
                let gj = gi;
                while (gj < lineChars.length && lineChars[gj].type === type && lineChars[gj].url === url) gj++;
                groups.push({ type, url, text: lineChars.slice(gi, gj).map(c => c.ch).join('') });
                gi = gj;
            }

            const totalW = groups.reduce((s, g) => s + ctx.measureText(g.text).width, 0);
            let startX;
            if      (this.properties.textAlign === "left")   startX = this.properties.padding;
            else if (this.properties.textAlign === "right")  startX = this.size[0] - this.properties.padding - totalW;
            else                                               startX = (this.size[0] - totalW) / 2;

            ctx.textAlign = "left";
            let dx = startX;
            const linkColor = getLinkColor();

            /* ── 炫彩：计算整行 fillStyle ── */
            let lineFillStyle = this.properties.fontColor;
            if (this.properties.rainbowEnabled) {
                const style = this.properties.rainbowStyle || "wave";
                const speed = this.properties.rainbowSpeed ?? 30;
                const time = Date.now() * 0.002 * (speed / 30);
                if (style === "breathe") {
                    const hue = ((Math.sin(time) + 1) / 2 * 360) % 360;
                    const rgb = _hslToRgb(hue, 100, 60);
                    lineFillStyle = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
                } else if (style === "fade") {
                    const rgb = _hexToRgb(this.properties.fontColor);
                    const alpha = ((Math.sin(time) + 1) / 2);
                    lineFillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha.toFixed(2)})`;
                } else if (style === "alpha") {
                    const rgb = _hexToRgb(this.properties.fontColor);
                    const grad = ctx.createLinearGradient(startX, 0, startX + totalW, 0);
                    for (let s = 0; s <= 1; s += 0.02) {
                        const alpha = ((Math.sin(time + idx * 0.5 + s * 3) + 1) / 2);
                        grad.addColorStop(s, `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha.toFixed(2)})`);
                    }
                    lineFillStyle = grad;
                } else { /* wave */
                    const grad = ctx.createLinearGradient(startX, 0, startX + totalW, 0);
                    for (let s = 0; s <= 1; s += 0.02) {
                        const hue = (time * 60 + idx * 30 + s * 360) % 360;
                        const rgb = _hslToRgb(hue, 100, 60);
                        grad.addColorStop(s, `rgb(${rgb.r},${rgb.g},${rgb.b})`);
                    }
                    lineFillStyle = grad;
                }
            }

            for (const g of groups) {
                const w = ctx.measureText(g.text).width;
                if (g.type === 'link') {
                    this.linkAreas.push({ x: dx, y, width: w, height: lineHeight, url: g.url });
                    ctx.fillStyle = linkColor;
                    ctx.fillText(g.text, dx, y);
                    const uy = y + this.properties.fontSize;
                    ctx.beginPath();
                    ctx.moveTo(dx, uy + 1);
                    ctx.lineTo(dx + w, uy + 1);
                    ctx.strokeStyle = linkColor;
                    ctx.lineWidth   = 1;
                    ctx.stroke();
                } else {
                    ctx.fillStyle = lineFillStyle;
                    ctx.fillText(g.text, dx, y);
                }
                dx += w;
            }
        }
    }

    /* ════════════════════════════════════════════════════════════════
       编辑器（WOSAI 双列布局 + 炫彩控件）
       ════════════════════════════════════════════════════════════════ */

    showSettingsToolbar () {
        if (this.editToolbar) return;
        _cachedFontTime = 0;

        const canvas = LGraphCanvas.active_canvas;
        const rect   = canvas.canvas.getBoundingClientRect();
        const ox     = (this.pos[0] + canvas.ds.offset[0]) * canvas.ds.scale;
        const oy     = (this.pos[1] + canvas.ds.offset[1]) * canvas.ds.scale;
        const TOOLBAR_OFFSET = getWOSAIVarNum('--ws-tn-toolbar-offset', 280);

        this.editToolbar = document.createElement("div");
        this.editToolbar.className = "titlenote-edit-toolbar wosai-panel--glass";
        this.editToolbar.setAttribute("data-wosai-panel", "");
        Object.assign(this.editToolbar.style, {
            position: "absolute",
            left:     rect.left + ox + (this.size[0] * canvas.ds.scale) / 2 + "px",
            top:      rect.top  + oy - TOOLBAR_OFFSET + "px",
            transform: "translateX(-50%)",
        });

        const _rowClass = "titlenote-toolbar-row";
        const _rafUpdate = (fn) => {
            let rafId = null;
            return () => {
                if (rafId) cancelAnimationFrame(rafId);
                rafId = requestAnimationFrame(() => { rafId = null; fn(); });
            };
        };

        const ctrlCol = document.createElement("div");
        ctrlCol.className = "titlenote-toolbar-col";

        /* ── 第1行：字号 ── */
        const row1 = document.createElement("div");
        row1.className = _rowClass;
        const sizeLbl = document.createElement("span");
        sizeLbl.className = "titlenote-toolbar-label";
        sizeLbl.textContent = t('nodes.titleNote.fontSizeProperty');
        row1.appendChild(sizeLbl);

        this.fontSizeSlider = document.createElement("input");
        this.fontSizeSlider.type = "range";
        this.fontSizeSlider.className = "wosai-slider";
        this.fontSizeSlider.min  = "8";
        this.fontSizeSlider.max  = "200";
        this.fontSizeSlider.value = this.properties.fontSize;
        Object.assign(this.fontSizeSlider.style, { flex:"1" });
        this.fontSizeSlider.addEventListener("input", _rafUpdate(() => {
            const v = Math.max(8, Math.min(200, parseInt(this.fontSizeSlider.value) || this.properties.fontSize));
            this.properties.fontSize = v;
            this.fontSizeValue.textContent = v;
            this._freezeEditors();
            this.updateTextareaStyle();
            app.graph.setDirtyCanvas(true);
        }));
        row1.appendChild(this.fontSizeSlider);

        this.fontSizeValue = document.createElement("span");
        this.fontSizeValue.className = "titlenote-toolbar-value";
        this.fontSizeValue.textContent = this.properties.fontSize;
        row1.appendChild(this.fontSizeValue);
        ctrlCol.appendChild(row1);

        /* ── 第2行：行距 ── */
        const row2 = document.createElement("div");
        row2.className = _rowClass;
        const lhLbl = document.createElement("span");
        lhLbl.className = "titlenote-toolbar-label";
        lhLbl.textContent = t('nodes.titleNote.lineHeight');
        row2.appendChild(lhLbl);

        this.lineHeightSlider = document.createElement("input");
        this.lineHeightSlider.type   = "range";
        this.lineHeightSlider.className = "wosai-slider";
        this.lineHeightSlider.min   = "0.8";
        this.lineHeightSlider.max   = "3.0";
        this.lineHeightSlider.step  = "0.1";
        this.lineHeightSlider.value = this.properties.lineHeight;
        Object.assign(this.lineHeightSlider.style, { flex:"1" });
        this.lineHeightSlider.addEventListener("input", _rafUpdate(() => {
            const v = parseFloat(this.lineHeightSlider.value);
            this.properties.lineHeight = isNaN(v) ? this.properties.lineHeight : Math.max(0.8, Math.min(3.0, v));
            this.lineHeightValue.textContent = this.properties.lineHeight.toFixed(1);
            app.graph.setDirtyCanvas(true);
        }));
        row2.appendChild(this.lineHeightSlider);

        this.lineHeightValue = document.createElement("span");
        this.lineHeightValue.className = "titlenote-toolbar-value";
        this.lineHeightValue.textContent = this.properties.lineHeight.toFixed(1);
        row2.appendChild(this.lineHeightValue);
        ctrlCol.appendChild(row2);

        /* ── 第3行：圆角 ── */
        const row3 = document.createElement("div");
        row3.className = _rowClass;
        const brLbl = document.createElement("span");
        brLbl.className = "titlenote-toolbar-label";
        brLbl.textContent = t('nodes.titleNote.borderRadius');
        row3.appendChild(brLbl);

        this.borderRadiusSlider = document.createElement("input");
        this.borderRadiusSlider.type = "range";
        this.borderRadiusSlider.className = "wosai-slider";
        this.borderRadiusSlider.min = "0";
        this.borderRadiusSlider.max = "100";
        this.borderRadiusSlider.step = "1";
        this.borderRadiusSlider.value = this.properties.borderRadius;
        Object.assign(this.borderRadiusSlider.style, { flex: "1" });
        this.borderRadiusSlider.addEventListener("input", _rafUpdate(() => {
            const v = parseInt(this.borderRadiusSlider.value);
            this.properties.borderRadius = isNaN(v) ? this.properties.borderRadius : Math.max(0, Math.min(100, v));
            this.borderRadiusValue.textContent = this.properties.borderRadius;
            this.setDirtyCanvas(true, true);
            app.graph.setDirtyCanvas(true);
        }));
        row3.appendChild(this.borderRadiusSlider);

        this.borderRadiusValue = document.createElement("span");
        this.borderRadiusValue.className = "titlenote-toolbar-value";
        this.borderRadiusValue.textContent = this.properties.borderRadius;
        row3.appendChild(this.borderRadiusValue);
        ctrlCol.appendChild(row3);

        /* ── 第4行：透明 ── */
        const row4 = document.createElement("div");
        row4.className = _rowClass;
        const alphaLbl = document.createElement("span");
        alphaLbl.className = "titlenote-toolbar-label";
        alphaLbl.textContent = t('nodes.titleNote.backgroundAlphaProperty');
        row4.appendChild(alphaLbl);

        this.alphaSlider = document.createElement("input");
        this.alphaSlider.type = "range";
        this.alphaSlider.className = "wosai-slider";
        this.alphaSlider.min = "0";
        this.alphaSlider.max = "100";
        this.alphaSlider.step = "1";
        this.alphaSlider.value = Math.round(this.properties.backgroundAlpha * 100);
        Object.assign(this.alphaSlider.style, { flex: "1" });
        this.alphaSlider.addEventListener("input", _rafUpdate(() => {
            const v = parseInt(this.alphaSlider.value);
            this.properties.backgroundAlpha = isNaN(v) ? 0 : Math.max(0, Math.min(100, v)) / 100;
            this.alphaValue.textContent = Math.round(this.properties.backgroundAlpha * 100) + "%";
            this.updateTextareaStyle();
            app.graph.setDirtyCanvas(true);
        }));
        row4.appendChild(this.alphaSlider);

        this.alphaValue = document.createElement("span");
        this.alphaValue.className = "titlenote-toolbar-value";
        this.alphaValue.textContent = Math.round(this.properties.backgroundAlpha * 100) + "%";
        row4.appendChild(this.alphaValue);
        ctrlCol.appendChild(row4);

        /* ── 第5行：动效（炫彩）── */
        const row5 = document.createElement("div");
        row5.className = _rowClass;
        const rainbowLbl = document.createElement("span");
        rainbowLbl.className = "titlenote-toolbar-label";
        rainbowLbl.textContent = t('nodes.titleNote.rainbow');
        row5.appendChild(rainbowLbl);

        const btnGroup5 = document.createElement("div");
        Object.assign(btnGroup5.style, { display: "flex", gap: "var(--ws-gap)", flex: "1", alignItems: "center" });

        this.rainbowStyleBtns = [];
        const _styleOpts = [
            { key:"wave",   label:t('nodes.titleNote.rainbowWave') },
            { key:"breathe",label:t('nodes.titleNote.rainbowBreathe') },
            { key:"alpha",  label:t('nodes.titleNote.rainbowAlpha') },
            { key:"fade",   label:t('nodes.titleNote.rainbowFade') },
        ];
        _styleOpts.forEach(o => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "wosai-btn wosai-btn--sm";
            btn.textContent = o.label;
            Object.assign(btn.style, { fontSize:"var(--ws-text-sm)", padding:"var(--ws-tn-style-btn-padding)", minWidth:"0", boxSizing:"border-box" });
            const _active = this.properties.rainbowEnabled && this.properties.rainbowStyle === o.key;
            btn.style.background = _active ? "var(--ws-accent)" : "var(--ws-surface-3)";
            btn.style.color = _active ? "var(--ws-text-on-accent)" : "var(--ws-text-secondary)";
            btn.addEventListener("click", () => {
                this.properties.rainbowStyle = o.key;
                if (!this.properties.rainbowEnabled) {
                    this.properties.rainbowEnabled = true;
                }
                this.rainbowStyleBtns.forEach(b => {
                    b.style.background = "var(--ws-surface-3)";
                    b.style.color = "var(--ws-text-secondary)";
                });
                btn.style.background = "var(--ws-accent)";
                btn.style.color = "var(--ws-text-on-accent)";
                this.updateTextareaStyle();
                app.graph.setDirtyCanvas(true);
                this._flashPreview();
            });
            this.rainbowStyleBtns.push(btn);
            btnGroup5.appendChild(btn);
        });

        const speedLbl = document.createElement("span");
        speedLbl.className = "titlenote-toolbar-label";
        speedLbl.textContent = t('nodes.titleNote.speed');
        speedLbl.style.minWidth = "0";
        btnGroup5.appendChild(speedLbl);

        this.rainbowSpeedSlider = document.createElement("input");
        this.rainbowSpeedSlider.type = "range";
        this.rainbowSpeedSlider.className = "wosai-slider";
        this.rainbowSpeedSlider.min = "1";
        this.rainbowSpeedSlider.max = "60";
        this.rainbowSpeedSlider.step = "1";
        this.rainbowSpeedSlider.value = this.properties.rainbowSpeed;
        Object.assign(this.rainbowSpeedSlider.style, { flex: "1" });

        this.rainbowSpeedValue = document.createElement("span");
        this.rainbowSpeedValue.className = "titlenote-toolbar-value";
        this.rainbowSpeedValue.textContent = this.properties.rainbowSpeed;
        btnGroup5.appendChild(this.rainbowSpeedSlider);
        btnGroup5.appendChild(this.rainbowSpeedValue);

        this.rainbowSpeedSlider.addEventListener("input", _rafUpdate(() => {
            const v = parseInt(this.rainbowSpeedSlider.value);
            this.properties.rainbowSpeed = isNaN(v) ? 30 : Math.max(1, Math.min(60, v));
            this.rainbowSpeedValue.textContent = this.properties.rainbowSpeed;
            app.graph.setDirtyCanvas(true);
        }));
        row5.appendChild(btnGroup5);
        ctrlCol.appendChild(row5);

        /* ── 第6行：颜色（文本 → 背景 → 预设 → 重置）── */
        const row6 = document.createElement("div");
        row6.className = _rowClass;

        const btnGroup6 = document.createElement("div");
        Object.assign(btnGroup6.style, { display: "flex", gap: "var(--ws-gap)", flex: "1", alignItems: "center" });

        const _pairedPresets = [
            { text: getWOSAIVar('--ws-tn-default-text'), bg: getWOSAIVar('--ws-tn-preset-blue'), label: t("nodes.titleNote.presetBlue") },
            { text: getWOSAIVar('--ws-tn-default-text'), bg: getWOSAIVar('--ws-tn-preset-green'), label: t("nodes.titleNote.presetGreen") },
            { text: getWOSAIVar('--ws-tn-default-text'), bg: getWOSAIVar('--ws-tn-preset-brown'), label: t("nodes.titleNote.presetBrown") },
            { text: getWOSAIVar('--ws-tn-default-text'), bg: getWOSAIVar('--ws-tn-preset-purple'), label: t("nodes.titleNote.presetPurple") },
            { text: getWOSAIVar('--ws-tn-default-text'), bg: getWOSAIVar('--ws-tn-preset-orange'), label: t("nodes.titleNote.presetOrange") },
            { text: getWOSAIVar('--ws-tn-default-text'), bg: getWOSAIVar('--ws-tn-preset-pink'), label: t("nodes.titleNote.presetPink") },
            { text: getWOSAIVar('--ws-tn-default-text'), bg: getWOSAIVar('--ws-tn-preset-sky-blue'), label: t("nodes.titleNote.presetSkyBlue") },
        ];
        const _presetBtnGroup = document.createElement("div");
        Object.assign(_presetBtnGroup.style, { display: "flex", gap: "var(--ws-gap-sm)", flex: "1", alignItems: "center" });
        _pairedPresets.forEach(p => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.title = p.label;
            bindTip(btn, () => p.label);
            Object.assign(btn.style, {
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: "var(--ws-btn-h-xs)", height: "var(--ws-btn-h-xs)", boxSizing: "border-box",
                background: p.bg, border: "none", borderRadius: "50%",
                cursor: "pointer", padding: "0", position: "relative",
            });
            const dot = document.createElement("span");
            Object.assign(dot.style, {
                width: "var(--ws-gap)", height: "var(--ws-gap)", borderRadius: "50%",
                background: p.text, display: "block",
            });
            btn.appendChild(dot);
            btn.addEventListener("mousedown", (e) => e.preventDefault());
            btn.addEventListener("click", () => {
                this.properties.fontColor = p.text;
                this.properties.backgroundColor = p.bg;
                this.properties.backgroundAlpha = 1;
                if (this.properties.rainbowEnabled) {
                    this.properties.rainbowEnabled = false;
                }
                if (this._colorPicker) {
                    const c = this._colorTarget === "text" ? p.text : p.bg;
                    this._colorPicker.setColor(c);
                }
                this.updateTextareaStyle();
                this.setDirtyCanvas(true, true);
                app.graph.setDirtyCanvas(true);
                this._flashPreview();
            });
            _presetBtnGroup.appendChild(btn);
        });

        this._colorTarget = "text";
        const _mkTargetBtn = (label, target) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "wosai-btn wosai-btn--sm";
            btn.textContent = label;
            Object.assign(btn.style, { fontSize: "var(--ws-text-sm)", padding: "var(--ws-tn-target-btn-padding)", minWidth: "0", boxSizing: "border-box" });
            const _syncTargetBtn = () => {
                const active = this._colorTarget === target;
                btn.style.background = active ? "var(--ws-accent)" : "var(--ws-surface-3)";
                btn.style.color = active ? "var(--ws-text-on-accent)" : "var(--ws-text-secondary)";
            };
            btn.addEventListener("mousedown", (e) => e.preventDefault());
            btn.addEventListener("click", () => {
                this._colorTarget = target;
                _syncTargetBtn();
                _syncTargetBtnBg();
                if (this._colorPicker) {
                    const c = target === "text" ? this.properties.fontColor : this.properties.backgroundColor;
                    this._colorPicker.setColor(c);
                }
            });
            return { btn, sync: _syncTargetBtn };
        };
        const textTarget = _mkTargetBtn(t('nodes.titleNote.textColorBtn'), "text");
        textTarget.btn.title = t('nodes.titleNote.textColorBtnTooltip');
        bindTip(textTarget.btn, () => t('nodes.titleNote.textColorBtnTooltip'));
        const bgTarget = _mkTargetBtn(t('nodes.titleNote.backgroundColorBtn'), "bg");
        bgTarget.btn.title = t('nodes.titleNote.backgroundColorBtnTooltip');
        bindTip(bgTarget.btn, () => t('nodes.titleNote.backgroundColorBtnTooltip'));
        const _syncTargetBtnBg = () => { textTarget.sync(); bgTarget.sync(); };

        const strokeBtn = document.createElement("button");
        strokeBtn.type = "button";
        strokeBtn.className = "wosai-btn wosai-btn--sm";
        strokeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block"><rect x="3.5" y="5" width="17" height="14" rx="4"/><path d="M7 9h10M7 15h10" opacity=".55"/></svg>`;
        strokeBtn.title = t("nodes.titleNote.strokeToggleTooltip");
        bindTip(strokeBtn, () => t("nodes.titleNote.strokeToggleTooltip"));
        Object.assign(strokeBtn.style, { padding: "var(--ws-tn-reset-btn-padding)", minWidth: "0", boxSizing: "border-box" });
        const syncStrokeBtn = () => {
            const enabled = !!this.properties.strokeEnabled;
            strokeBtn.style.background = enabled ? "var(--ws-accent)" : "var(--ws-surface-3)";
            strokeBtn.style.color = enabled ? "var(--ws-text-on-accent)" : "var(--ws-text-secondary)";
        };
        syncStrokeBtn();
        strokeBtn.addEventListener("mousedown", (e) => e.preventDefault());
        strokeBtn.addEventListener("click", () => {
            this.properties.strokeEnabled = !this.properties.strokeEnabled;
            syncStrokeBtn();
            this.updateTextareaStyle();
            this.setDirtyCanvas(true, true);
            app.graph.setDirtyCanvas(true);
        });

        const resetBtn = document.createElement("button");
        resetBtn.type = "button";
        resetBtn.className = "wosai-btn wosai-btn--sm";
        resetBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
        resetBtn.title = t("nodes.titleNote.resetDefault");
        bindTip(resetBtn, () => t("nodes.titleNote.resetDefault"));
        Object.assign(resetBtn.style, { padding: "var(--ws-tn-reset-btn-padding)", minWidth: "0", boxSizing: "border-box" });
        resetBtn.addEventListener("mousedown", (e) => e.preventDefault());
        resetBtn.addEventListener("click", () => {
            this.properties.fontColor = getWOSAIVar('--ws-tn-default-text');
            this.properties.backgroundColor = getWOSAIVar('--ws-tn-default-bg');
            this.properties.backgroundAlpha = 0;
            this.properties.strokeEnabled = false;
            this.properties.rainbowEnabled = false;
            syncStrokeBtn();
            if (this._colorPicker) this._colorPicker.setColor(this._colorTarget === "text" ? this.properties.fontColor : this.properties.backgroundColor);
            this.updateTextareaStyle();
            this.setDirtyCanvas(true, true);
            app.graph.setDirtyCanvas(true);
            this._flashPreview();
        });

        const colorLbl = document.createElement("span");
        colorLbl.className = "titlenote-toolbar-label";
        colorLbl.textContent = t('common.color');

        btnGroup6.appendChild(colorLbl);
        btnGroup6.appendChild(textTarget.btn);
        btnGroup6.appendChild(bgTarget.btn);
        btnGroup6.appendChild(_presetBtnGroup);
        btnGroup6.appendChild(strokeBtn);
        btnGroup6.appendChild(resetBtn);
        row6.appendChild(btnGroup6);
        ctrlCol.appendChild(row6);

        /* 左侧常驻取色器列 + 右侧控件列 */
        const pickerCol = this._buildColorPicker();
        this.editToolbar.appendChild(pickerCol);
        this.editToolbar.appendChild(ctrlCol);

        this._setColorTarget("text");
        document.body.appendChild(this.editToolbar);

        this._restoreHubBar = window.__wosaiWithHubBarHidden
            ? window.__wosaiWithHubBarHidden() : null;

        this.editToolbar.addEventListener("mousedown", (e) => {
            if (!e.target.closest("button, input, textarea")) e.preventDefault();
        }, true);

        this.updateEditorsPosition = () => {
            if (!this.editToolbar) return;
            if (this._freezeEditorPosition) return;
            const c  = LGraphCanvas.active_canvas;
            const r  = c.canvas.getBoundingClientRect();
            const s  = c.ds.scale;
            const ox2 = (this.pos[0] + c.ds.offset[0]) * s;
            const oy2 = (this.pos[1] + c.ds.offset[1]) * s;

            Object.assign(this.editToolbar.style, {
                left: r.left + ox2 + (this.size[0] * s) / 2 + "px",
                top:  r.top  + oy2 - TOOLBAR_OFFSET + "px",
                transform: "translateX(-50%)",
            });

            if (this.editTextarea) {
                const pad = this.properties.padding;
                Object.assign(this.editTextarea.style, {
                    left:   r.left + ox2 + pad * s + "px",
                    top:    r.top  + oy2 + 10 * s + "px",
                    width:  (this.size[0] - 2 * pad) * s + "px",
                    height: (this.size[1] - 20) * s + "px",
                });
                this.updateTextareaStyle();
            }
        };

        const scheduleEditorPosition = () => {
            if (this._editorPositionRAF) return;
            this._editorPositionRAF = requestAnimationFrame(() => {
                this._editorPositionRAF = null;
                this.updateEditorsPosition();
            });
        };
        // 多节点共享同一画布：用可组合补丁叠加 onCanvasChanged。
        // 旧实现直接赋值 + 按引用还原，节点 A 关闭时会顶掉节点 B 已安装的包装，
        // 最终在画布上残留持有已删除节点闭包的包装函数。
        this._canvasChangedDispose = _patchTitleNoteMethod(
            canvas,
            "onCanvasChanged",
            `WOSAI.TitleNote.canvasChanged.${this.id}`,
            (next) => (evt) => {
                next?.call(canvas, evt);
                scheduleEditorPosition();
            },
        );
        this._editorViewportHandler = scheduleEditorPosition;
        window.addEventListener("resize", this._editorViewportHandler, { passive: true });
        scheduleEditorPosition();

        const followEditorViewport = () => {
            if (!this.editToolbar) return;
            const active = LGraphCanvas.active_canvas;
            const ds = active?.ds;
            const key = ds
                ? [ds.scale, ds.offset?.[0], ds.offset?.[1], this.pos[0], this.pos[1], this.size[0], this.size[1]].join("|")
                : "";
            if (key !== this._editorViewportKey) {
                this._editorViewportKey = key;
                this.updateEditorsPosition();
            }
            this._editorViewportRAF = requestAnimationFrame(followEditorViewport);
        };
        this._editorViewportRAF = requestAnimationFrame(followEditorViewport);

        this._setupToolbarCloseHandler();
    }

    _setupToolbarCloseHandler () {
        this._toolbarClickCount = 0;
        this._toolbarDocClickHandler = (e) => {
            this._toolbarClickCount++;
            setTimeout(() => {
                this._toolbarClickCount--;
                if (this._toolbarClickCount === 0 && this.editToolbar &&
                    !this.editToolbar.contains(e.target) && !this.isEditing) {
                    this.removeTextEditor();
                }
            }, 300);
        };
        setTimeout(() => {
            if (this.editToolbar && !this.isEditing) {
                document.addEventListener("click", this._toolbarDocClickHandler, true);
            }
        }, 200);
    }

    _appendTextarea (dblClickEvent) {
        if (this.editTextarea) return;
        if (!this.editToolbar) this.showSettingsToolbar();
        _cachedFontTime = 0;

        const canvas = LGraphCanvas.active_canvas;
        const rect   = canvas.canvas.getBoundingClientRect();
        const ox     = (this.pos[0] + canvas.ds.offset[0]) * canvas.ds.scale;
        const oy     = (this.pos[1] + canvas.ds.offset[1]) * canvas.ds.scale;

        this.editTextarea = document.createElement("textarea");
        this.editTextarea.className = "titlenote-textarea";
        this.editTextarea.setAttribute("data-wosai-panel", "");
        // The node grows to its pasted content; do not let the browser insert
        // visual soft wraps before that measurement has completed.
        this.editTextarea.wrap = "off";
        this.editTextarea.value = this.properties.text;
        Object.assign(this.editTextarea.style, {
            position: "absolute",
            left:     rect.left + ox + this.properties.padding * canvas.ds.scale + "px",
            top:      rect.top  + oy + 10 * canvas.ds.scale + "px",
            width:    (this.size[0] - 2 * this.properties.padding) * canvas.ds.scale + "px",
            height:   (this.size[1] - 20) * canvas.ds.scale + "px",
            textAlign: this.properties.textAlign,
            zIndex:   "1000",
        });
        this.updateTextareaStyle();
        document.body.appendChild(this.editTextarea);
        this.editTextarea.focus();

        /* 双击定位光标：根据点击位置计算字符索引，定点插入而非全选 */
        const lines = this.properties.text.split("\n");
        const _placeCursor = (dblClickEvent) => {
            const ta = this.editTextarea;
            if (!ta) return;
            if (!dblClickEvent) { ta.setSelectionRange(ta.value.length, ta.value.length); return; }
            const rect = ta.getBoundingClientRect();
            const x = dblClickEvent.clientX - rect.left;
            const y = dblClickEvent.clientY - rect.top;
            const style = getComputedStyle(ta);
            const padL = parseFloat(style.paddingLeft) || 0;
            const padT = parseFloat(style.paddingTop) || 0;
            const lineH = ta.scrollHeight / Math.max(1, lines.length || 1);
            const relX = Math.max(0, x - padL);
            const relY = Math.max(0, y - padT);
            const lineIdx = Math.max(0, Math.min(lines.length - 1, Math.floor(relY / lineH)));
            const lineText = lines[lineIdx] || "";
            let charIdx = 0;
            const measure = getMeasureContext();
            measure.font = style.font;
            for (let i = 1; i <= lineText.length; i++) {
                if (measure.measureText(lineText.substring(0, i)).width >= relX) { charIdx = i; break; }
                charIdx = i;
            }
            let offset = 0;
            for (let i = 0; i < lineIdx; i++) offset += lines[i].length + 1;
            offset += charIdx;
            ta.setSelectionRange(offset, offset);
        };
        _placeCursor(dblClickEvent);

        const saveAndClose = () => {
            this.properties.text = this.editTextarea.value;
            this.fitToContent();
            this.removeTextEditor();
            this.setDirtyCanvas(true, true);
            app.graph.setDirtyCanvas(true);
        };

        let textFitRAF = null;
        const syncTextSize = () => {
            if (!this.editTextarea) return;
            this.properties.text = this.editTextarea.value;
            if (textFitRAF) return;
            textFitRAF = requestAnimationFrame(() => {
                textFitRAF = null;
                if (!this.editTextarea) return;
                this.fitToContent();
                this.setDirtyCanvas(true, true);
                app.graph.setDirtyCanvas(true);
            });
        };
        this.editTextarea.addEventListener("input", syncTextSize);

        this.editTextarea.addEventListener("keydown", (e) => {
            if ("Escape" === e.key) {
                this.removeTextEditor();
            } else if ("Enter" === e.key && (e.ctrlKey || e.metaKey)) {
                saveAndClose();
            }
            e.stopPropagation();
        });

        this.editTextarea.addEventListener("wheel", (e) => {
            e.preventDefault();
            const step = (e.ctrlKey || e.metaKey) ? 5 : 2;
            const delta = e.deltaY < 0 ? step : -step;
            let newVal = this.properties.fontSize + delta;
            newVal = Math.max(8, Math.min(200, newVal));
            if (newVal !== this.properties.fontSize) {
                this.properties.fontSize = newVal;
                this.fontSizeSlider.value = newVal;
                this.fontSizeValue.textContent = newVal;
                this._freezeEditors();
                this.updateTextareaStyle();
                this.fitToContent();
                app.graph.setDirtyCanvas(true);
            }
        }, { passive: false });

        this._editClickCount = 0;
        this._editDocClickHandler = (e) => {
            this._editClickCount++;
            setTimeout(() => {
                this._editClickCount--;
                if (this._editClickCount === 0 && this.editTextarea && this.editToolbar &&
                    !this.editTextarea.contains(e.target) &&
                    !this.editToolbar.contains(e.target) && this.isEditing) {
                    saveAndClose();
                }
            }, 300);
        };
        setTimeout(() => {
            if (this.isEditing) document.addEventListener("click", this._editDocClickHandler, true);
        }, 200);

        this.editTextarea.addEventListener("blur", () => {
            setTimeout(() => {
                if (this.editToolbar && this.editTextarea &&
                    !this.editToolbar.contains(document.activeElement) &&
                    document.activeElement !== this.editTextarea) {
                    saveAndClose();
                }
            }, 100);
        });

        this.isEditing = true;
    }

    createTextEditor (e) {
        this.showSettingsToolbar();
        this._appendTextarea(e);
    }

    updateTextareaStyle () {
        if (!this.editTextarea) return;

        const rawAlpha = Number(this.properties.backgroundAlpha);
        const alpha = Number.isFinite(rawAlpha) ? Math.max(0, Math.min(1, rawAlpha)) : 0;
        const editorBackground = alpha > 0
            ? this.hexToRGBA(this.properties.backgroundColor, alpha)
            : "transparent";

        Object.assign(this.editTextarea.style, {
            fontSize:   this.properties.fontSize * (LGraphCanvas.active_canvas?.ds?.scale || 1) + "px",
            fontFamily:  getComfyUIFont(),
            color:       this.properties.fontColor,
            textAlign:   this.properties.textAlign,
            lineHeight:   this.properties.lineHeight,
            letterSpacing: this.properties.letterSpacing * (LGraphCanvas.active_canvas?.ds?.scale || 1) + "px",
            whiteSpace:    "pre",
            overflowX:     "auto",
            overflowY:     "hidden",
            textShadow:    "none",
        });
        this.editTextarea.style.setProperty("background", editorBackground, "important");
        this.editTextarea.style.setProperty("border", "none", "important");
        this.editTextarea.style.setProperty("outline", "none", "important");
        this.editTextarea.style.setProperty("box-shadow", "none", "important");
        this.editTextarea.style.webkitTextStroke = "";
        this.editTextarea.style.removeProperty("paint-order");
        this._updateRainbowPreview();
        this.fitToContent();
    }

    _updateRainbowPreview () {
        if (this._rainbowPreviewRAF) { cancelAnimationFrame(this._rainbowPreviewRAF); this._rainbowPreviewRAF = null; }
        if (!this.editTextarea) return;

        // textarea 是替换元素，background-clip:text 在不同浏览器中并不稳定，
        // 可能把渐隐渐变铺满整个编辑框。编辑态改用统一文字透明度预览，
        // Canvas 渲染仍保留逐字 alpha 动效；每次切换时先清理旧的渐变样式。
        this.editTextarea.style.webkitBackgroundClip = "";
        this.editTextarea.style.backgroundClip = "";
        this.editTextarea.style.webkitTextFillColor = "";
        this.editTextarea.style.removeProperty("background-image");
        if (!this.properties.rainbowEnabled || !this.isEditing) return;

        const _tick = () => {
            if (!this.editTextarea || !this.isEditing || !this.properties.rainbowEnabled) return;
            const style = this.properties.rainbowStyle || "wave";
            const speed = this.properties.rainbowSpeed ?? 30;
            const time = Date.now() * 0.002 * (speed / 30);
            let color = this.properties.fontColor;

            if (style === "breathe") {
                const hue = ((Math.sin(time) + 1) / 2 * 360) % 360;
                const rgb = _hslToRgb(hue, 100, 60);
                color = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
            } else if (style === "fade") {
                const rgb = _hexToRgb(this.properties.fontColor);
                const alpha = ((Math.sin(time) + 1) / 2);
                color = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha.toFixed(2)})`;
            } else if (style === "alpha") {
                const rgb = _hexToRgb(this.properties.fontColor);
                // 不在 textarea 背景上绘制渐变，避免生成独立的灰色矩形预览。
                const alpha = ((Math.sin(time) + 1) / 2);
                color = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha.toFixed(2)})`;
            } else if (style === "wave") {
                const hue = (time * 60) % 360;
                const rgb = _hslToRgb(hue, 100, 60);
                color = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
            }
            this.editTextarea.style.color = color;
            this._rainbowPreviewRAF = requestAnimationFrame(_tick);
        };
        this._rainbowPreviewRAF = requestAnimationFrame(_tick);
    }

    _stopRainbowPreview () {
        if (this._rainbowPreviewRAF) { cancelAnimationFrame(this._rainbowPreviewRAF); this._rainbowPreviewRAF = null; }
    }

    _buildColorPicker () {
        const W   = getWOSAIVarNum('--ws-tn-picker-width', 168);
        const HUE = getWOSAIVarNum('--ws-tn-picker-hue-height', 14);
        const col = document.createElement("div");
        col.className = "titlenote-picker-col";
        Object.assign(col.style, { width: W + "px", flexShrink: "0" });

        const sv = document.createElement("div");
        sv.className = "titlenote-sv";
        bindTip(sv, () => this._colorTarget === "bg"
            ? t('nodes.titleNote.backgroundColorTooltip')
            : t('nodes.titleNote.textColorTooltip'));
        Object.assign(sv.style, { width: W + "px" });
        const svThumb = document.createElement("div");
        svThumb.className = "titlenote-sv-thumb";
        sv.appendChild(svThumb);

        const hue = document.createElement("div");
        hue.className = "titlenote-hue";
        bindTip(hue, () => this._colorTarget === "bg"
            ? t('nodes.titleNote.backgroundColorTooltip')
            : t('nodes.titleNote.textColorTooltip'));
        Object.assign(hue.style, { width: W + "px", height: HUE + "px" });
        const hueThumb = document.createElement("div");
        hueThumb.className = "titlenote-hue-thumb";
        Object.assign(hueThumb.style, { height: getWOSAIVarNum('--ws-tn-hue-thumb-height', 20) + "px" });
        hue.appendChild(hueThumb);

        col.appendChild(sv);
        col.appendChild(hue);

        this._pickerSyncUI = () => {
            sv.style.background =
                "linear-gradient(to top,black,transparent),"
              + "linear-gradient(to right,white,transparent),"
              + "hsl(" + this._pickH + ",100%,50%)";
            svThumb.style.left = (this._pickS / 100 * W) + "px";
            svThumb.style.top  = ((1 - this._pickV / 100) * sv.offsetHeight) + "px";
            hueThumb.style.left = (this._pickH / 360 * W) + "px";
        };

        let _pickerClosedEditor = false;
        const applyFromPick = () => {
            const hex = hsv2hex(this._pickH, this._pickS, this._pickV);
            if (this._colorTarget === "bg") {
                this.properties.backgroundColor = hex;
                this.properties.backgroundAlpha = 1;
                this.properties.fontColor = _contrastTextColor(hex);
                this.updateTextareaStyle();
                this.setDirtyCanvas(true, true);
            } else {
                this.properties.fontColor = hex;
                this.updateTextareaStyle();
            }
            app.graph.setDirtyCanvas(true);
            if (this.isEditing && !_pickerClosedEditor) {
                _pickerClosedEditor = true;
                this._flashPreview(800);
            }
        };

        const svFromEvent = (e) => {
            const r = sv.getBoundingClientRect();
            let x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
            x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y));
            this._pickS = Math.round(x * 100); this._pickV = Math.round((1 - y) * 100);
            this._pickerSyncUI(); applyFromPick();
        };
        const hueFromEvent = (e) => {
            const r = hue.getBoundingClientRect();
            let x = (e.clientX - r.left) / r.width; x = Math.max(0, Math.min(1, x));
            this._pickH = Math.round(x * 360);
            this._pickerSyncUI(); applyFromPick();
        };
        const mkDrag = (el, fromEvent) => {
            const move = (e) => { e.preventDefault(); e.stopPropagation(); fromEvent(e); };
            const up   = (e) => { e.stopPropagation();
                document.removeEventListener("mousemove", move, true);
                document.removeEventListener("mouseup", up, true); };
            el.addEventListener("mousedown", (e) => {
                e.preventDefault(); e.stopPropagation();
                fromEvent(e);
                document.addEventListener("mousemove", move, true);
                document.addEventListener("mouseup", up, true);
            });
        };
        mkDrag(sv, svFromEvent);
        mkDrag(hue, hueFromEvent);

        return col;
    }

    _setColorTarget (target) {
        this._colorTarget = target;
        const hex = target === "text" ? this.properties.fontColor : this.properties.backgroundColor;
        const { h, s, v } = hex2hsv(hex);
        this._pickH = h; this._pickS = s; this._pickV = v;
        if (this._pickerSyncUI) this._pickerSyncUI();
    }

    fitToContent () {
        const text = this.properties.text || "";
        const lines = text.split('\n');
        const pad  = this.properties.padding;
        const lh   = this.properties.fontSize * this.properties.lineHeight;

        const neededH = Math.max(lh, lines.length * lh + 20);

        const measureCtx = getMeasureContext();
        measureCtx.font = this.properties.fontSize + "px " + getComfyUIFont();
        let maxW = 0;
        for (const ln of lines) {
            const w = measureCtx.measureText(ln).width;
            if (w > maxW) maxW = w;
        }
        const neededW = Math.max(80, maxW + pad * 2 + 10);

        let changed = false;
        if (Math.abs(this.size[0] - neededW) > 2) { this.size[0] = neededW; changed = true; }
        if (Math.abs(this.size[1] - neededH) > 2) { this.size[1] = neededH; changed = true; }

        if (changed) {
            this.setDirtyCanvas(true, true);
            app.graph.setDirtyCanvas(true);
            if (typeof this.onResize === "function") this.onResize(this.size);
        }

        if (this.editTextarea) {
            const c = LGraphCanvas.active_canvas;
            const s = c.ds.scale;
            Object.assign(this.editTextarea.style, {
                width:  (this.size[0] - 2 * pad) * s + "px",
                height: (this.size[1] - 20) * s + "px",
            });
        }
    }

    _flashPreview (ms = 600) {
        // editTextarea 仅在编辑态存在，因此这里必须在 isEditing 为真时执行；
        // 原条件 `if (this.isEditing) return` 使整段逻辑永远不可达。
        if (!this.isEditing) return;
        if (!this.editTextarea) return;
        if (this._flashRAF) { cancelAnimationFrame(this._flashRAF); this._flashRAF = null; }
        if (this._flashTimer) { clearTimeout(this._flashTimer); this._flashTimer = null; }
        this.editTextarea.style.opacity = "0";
        void this.editTextarea.offsetHeight;
        this._flashTimer = setTimeout(() => {
            this._flashTimer = null;
            this.editTextarea.style.opacity = "";
        }, ms);
    }

    removeTextEditor () {
        if (this.editTextarea) { document.body.removeChild(this.editTextarea); this.editTextarea = null; }
        if (this.editToolbar)  { document.body.removeChild(this.editToolbar);  this.editToolbar  = null; }
        if (this._restoreHubBar) { this._restoreHubBar(); this._restoreHubBar = null; }
        if (this._editorPositionRAF) { cancelAnimationFrame(this._editorPositionRAF); this._editorPositionRAF = null; }
        if (this._editorViewportRAF) { cancelAnimationFrame(this._editorViewportRAF); this._editorViewportRAF = null; }
        this._editorViewportKey = null;
        if (this._editorViewportHandler) { window.removeEventListener("resize", this._editorViewportHandler); this._editorViewportHandler = null; }
        if (this._toolbarDocClickHandler) { document.removeEventListener("click", this._toolbarDocClickHandler, true); this._toolbarDocClickHandler = null; }
        if (this._editDocClickHandler)    { document.removeEventListener("click", this._editDocClickHandler, true);    this._editDocClickHandler    = null; }
        if (this._freezeEditorTimeout) { clearTimeout(this._freezeEditorTimeout); this._freezeEditorTimeout = null; }
        this._freezeEditorPosition = false;
        this._stopRainbowPreview();
        this._canvasChangedDispose?.();
        this._canvasChangedDispose = null;
        this.isEditing = false;
    }

    /* ── 背景绘制 ── */
    onDrawBackground (ctx) {
        ctx.save();
        ctx.imageSmoothingEnabled = true;

        const r = this.properties.borderRadius;
        ctx.beginPath();
        canvasRoundRect(ctx, 0, 0, this.size[0], this.size[1], r);
        ctx.fillStyle = this.hexToRGBA(this.properties.backgroundColor, this.properties.backgroundAlpha);
        ctx.fill();

        if (this.properties.strokeEnabled) {
            ctx.beginPath();
            canvasRoundRect(ctx, 0, 0, this.size[0], this.size[1], r);
            ctx.strokeStyle = getAutoTitleBorderColor(this.properties);
            ctx.lineWidth = getWOSAIVarNum('--ws-tn-border-stroke-width', 2);
            ctx.stroke();
        }

        if (this.isEditing) {
            ctx.beginPath();
            canvasRoundRect(ctx, 0, 0, this.size[0], this.size[1], r);
            ctx.strokeStyle = getEditStrokeColor();
            ctx.lineWidth   = getWOSAIVarNum('--ws-tn-edit-ring-width', 2);
            ctx.setLineDash([5, 3]);
            ctx.stroke();
        }

        if (!this.isEditing) {
            ctx.fillStyle = this.properties.fontColor;
            ctx.font      = this.properties.fontSize + "px " + getComfyUIFont();
            const lh = this.properties.fontSize * this.properties.lineHeight;
            const mw = this.size[0] - 2 * this.properties.padding;
            this.drawMultilineText(ctx, this.properties.text, mw, lh);
        }

        if (this.properties.rainbowEnabled) {
            if (!this._rainbowAnimFrame) {
                this._rainbowAnimFrame = requestAnimationFrame(() => {
                    this._rainbowAnimFrame = null;
                    if (this.graph && !this.isEditing) this.graph.change();
                });
            }
        } else if (this._rainbowAnimFrame) {
            cancelAnimationFrame(this._rainbowAnimFrame);
            this._rainbowAnimFrame = null;
        }

        ctx.restore();
    }

    hexToRGBA (hex, alpha) {
        const requested = String(hex);
        const tokenFallback = getWOSAIVar("--ws-text", "");
        const safeHex = /^#[0-9a-f]{6}$/i.test(requested)
            ? requested
            : (/^#[0-9a-f]{6}$/i.test(tokenFallback) ? tokenFallback : "");
        const numericAlpha = Number(alpha);
        const safeAlpha = Number.isFinite(numericAlpha) ? Math.max(0, Math.min(1, numericAlpha)) : 0;
        const channel = (start) => safeHex ? parseInt(safeHex.slice(start, start + 2), 16) : 0;
        return "rgba(" +
            channel(1) + ", " +
            channel(3) + ", " +
            channel(5) + ", " +
            safeAlpha + ")";
    }

    setColorOption (option) {
        if (option.color || option.bgcolor) {
            this.properties.fontColor = getWOSAIVar('--ws-tn-default-text');
            this.properties.backgroundColor = option.bgcolor || option.color;
        }
        if (this.isEditing) this.updateTextareaStyle();
        this.setDirtyCanvas(true, true);
    }

    draw (ctx) {
        this.flags = this.flags || {};
        this.flags.allow_interaction = !this.flags.pinned;
        this.onDrawBackground(ctx);
    }

    onPropertyChanged (name, value) {
        if (this.isEditing) {
            if      (name === "fontSize"       && this.fontSizeSlider)  { this.fontSizeSlider.value  = value; this.fontSizeValue.textContent        = value; }
            else if (name === "backgroundAlpha" && this.alphaSlider)   { this.alphaSlider.value = Math.round(value * 100); this.alphaValue.textContent = Math.round(value * 100) + "%"; }
            else if (name === "borderRadius"   && this.borderRadiusSlider) { this.borderRadiusSlider.value = value; this.borderRadiusValue.textContent = value; }
            else if (name === "lineHeight"     && this.lineHeightSlider){ this.lineHeightSlider.value = value; this.lineHeightValue.textContent      = value.toFixed(1); }
            this.updateTextareaStyle();
        }
        this.setDirtyCanvas(true, true);
        app.graph.setDirtyCanvas(true);
    }

    onMouseDown (evt, pos) {
        if (!this.isEditing && this.linkAreas && this.linkAreas.length > 0) {
            const lp = [pos[0] - this.pos[0], pos[1] - this.pos[1]];
            for (const a of this.linkAreas) {
                if (lp[0] >= a.x && lp[0] <= a.x + a.width && lp[1] >= a.y && lp[1] <= a.y + a.height) {
                    this.openLink(a.url);
                    return true;
                }
            }
        }
        return false;
    }

    openLink (url) {
        try {
            if (!url.match(/^https?:\/\//) && !url.match(/^www\./)) url = "https://" + url;
            window.open(url, "_blank");
        } catch (err) { console.error(t('nodes.titleNote.openLinkFailed'), err); }
    }

    onDblClick (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        if (this.isEditing) return;
        if (this.editToolbar) {
            this._appendTextarea(e);
        } else {
            this.createTextEditor(e);
        }
    }

    onResize (size) {
        if (size && Array.isArray(size) && size.length >= 2) {
            this.size[0] = Math.max(size[0], 5);
            this.size[1] = Math.max(size[1], 5);
            app.graph.setDirtyCanvas(true);
        }
    }

    getExtraMenuOptions (node, options) {
        options.unshift({ content: t('nodes.titleNote.editText'), callback:() => this.createTextEditor(null) });
        options.push({
            content: this.flags.pinned ? t('nodes.titleNote.unpinNode') : t('nodes.titleNote.pinNode'),
            callback:() => {
                this.flags.pinned = !this.flags.pinned;
                this.flags.allow_interaction = !this.flags.pinned;
            }
        });
    }

    onShowCustomPanelInfo (panel) {
        panel.querySelector('div.property[data-property="Mode"]')?.remove();
        panel.querySelector('div.property[data-property="Color"]')?.remove();
    }

    onRemoved () {
        this.removeTextEditor();
        _tnCleanupNodeStyle(this);
    }
}

/* ════════════════════════════════════════════════════════════════
   Vue DOM 卡片透明化（避免 Vue 覆盖 Canvas 渲染）
   ════════════════════════════════════════════════════════════════ */

const _VUE_PREFIX = "wosai-tn-vue";

function _vueSels (id) {
    return [
        /* Nodes 2.0 HTML/Vue 覆盖层的真实选择器（与 title-note.css 的
           [data-testid^="node-body-"] 及 _onDocDblClick 中的匹配规则保持一致）。
           这是本函数此前缺失的选择器 —— 缺失导致下方的透明化规则在 Nodes 2.0
           下完全匹配不到真实 DOM，节点原生背景/边框未被隐藏，从而在画布绘制的
           虚线框之外，又露出了一个矩形框。 */
        `[data-testid="node-body-${id}"]`,
        `[data-testid="node-header-${id}"]`,
        `[data-node-id="${id}"]`,
        `[data-id="${id}"]`,
        `#node-${id}`,
        `.litegraph-node[data-node-id="${id}"]`,
        `.comfy-node[data-node-id="${id}"]`,
        `.litegraph-node[data-id="${id}"]`,
        `.comfy-node[data-id="${id}"]`
    ];
}

function _tnApplyNodeStyle (node) {
    if (!node?.id) return;
    const tid = `${_VUE_PREFIX}-${node.id}`;
    let el = document.getElementById(tid);
    if (!el) {
        el = document.createElement("style");
        el.id = tid;
        document.head.appendChild(el);
    }
    const sels = _vueSels(node.id).join(",");
    el.textContent =
        `${sels}{background:transparent!important;background-color:transparent!important;border:none!important;box-shadow:none!important;border-radius:0!important;overflow:visible!important;}` +
        `${sels} *{background:transparent!important;background-color:transparent!important;border:none!important;box-shadow:none!important;}` +
        `${sels} .node-body,${sels} .litegraph-node-body,${sels} [class*='node-body'],${sels} .litegraph-node,${sels} .node-container{background:transparent!important;background-color:transparent!important;border:none!important;box-shadow:none!important;overflow:visible!important;}` +
        `${sels} .node-title,${sels} .litegraph-node-title,${sels} .comfy-node-title,${sels} .node-header,${sels} .litegraph-node-header,${sels} .comfy-node-header,${sels} .node-type,${sels} .comfy-node-type,${sels} .node-badge,${sels} .comfy-badge,${sels} .comfy-menu-button,${sels} .comfy-node-menu,${sels} .litegraph-node-type,${sels} .node-category,${sels} .node-label{display:none!important;opacity:0!important;height:0!important;width:0!important;overflow:hidden!important;margin:0!important;padding:0!important;}`;
    for (const sel of _vueSels(node.id)) {
        const dom = document.querySelector(sel);
        if (!dom) continue;
        dom.style.setProperty("background", "transparent", "important");
        dom.style.setProperty("background-color", "transparent", "important");
        dom.style.setProperty("border", "none", "important");
        dom.style.setProperty("box-shadow", "none", "important");
        dom.style.setProperty("border-radius", "0", "important");
        dom.style.setProperty("overflow", "visible", "important");
        dom.querySelectorAll(".node-body,.litegraph-node-body,[class*='node-body'],.litegraph-node,.node-container").forEach(c => {
            c.style.setProperty("background", "transparent", "important");
            c.style.setProperty("background-color", "transparent", "important");
            c.style.setProperty("border", "none", "important");
            c.style.setProperty("box-shadow", "none", "important");
            c.style.setProperty("overflow", "visible", "important");
        });
        dom.querySelectorAll(".node-title,.litegraph-node-title,.comfy-node-title,.node-header,.litegraph-node-header,.comfy-node-header,.node-type,.comfy-node-type,.litegraph-node-type,.node-badge,.comfy-badge,.comfy-menu-button,.comfy-node-menu,.node-category,.node-label").forEach(c => {
            c.style.display = "none";
            c.style.opacity = "0";
            c.style.height = "0";
            c.style.width = "0";
            c.style.overflow = "hidden";
        });
    }
}

function _tnApplyNodeStylesForAll () {
    if (!app?.graph?._nodes) return;
    for (const node of app.graph._nodes) {
        if (node.constructor === TitleNoteNode) _tnApplyNodeStyle(node);
    }
}

function _tnCleanupNodeStyle (node) {
    if (!node?.id) return;
    const el = document.getElementById(`${_VUE_PREFIX}-${node.id}`);
    if (el) el.remove();
}

function _tnVueTick (node, maxTries) {
    if (_tnUninstalled) return;
    _tnApplyNodeStyle(node);
    if (--maxTries > 0) setTimeout(() => _tnVueTick(node, maxTries), 100);
}

/* ════════════════════════════════════════════════════════════════
   节点注册 & LiteGraph 注入
   ════════════════════════════════════════════════════════════════ */

TitleNoteNode.type            = _TN_TYPE;
TitleNoteNode.title           = getTitleNoteTitle();
TitleNoteNode.title_mode      = LiteGraph.NO_TITLE;
TitleNoteNode.collapsable     = false;

TitleNoteNode["@text"]             = localizedProp({ type:"string", default: t('nodes.titleNote.defaultText'), multiline:true }, 'nodes.titleNote.textProperty');
TitleNoteNode["@fontSize"]         = localizedProp({ type:"number", default:50,  min:8,   max:200, step:1 }, 'nodes.titleNote.fontSizeProperty');
TitleNoteNode["@fontColor"]        = localizedProp({ type:"color",  default:getWOSAIVar('--ws-tn-default-text') }, 'nodes.titleNote.textColorProperty');
TitleNoteNode["@strokeEnabled"]    = localizedProp({ type:"boolean", default:false }, 'nodes.titleNote.strokeProperty');
TitleNoteNode["@backgroundColor"]  = localizedProp({ type:"color",  default:getWOSAIVar('--ws-tn-default-bg') }, 'nodes.titleNote.backgroundColorProperty');
TitleNoteNode["@backgroundAlpha"]  = localizedProp({ type:"number", default:0,   min:0, max:1,   step:0.05 }, 'nodes.titleNote.backgroundAlphaProperty');
TitleNoteNode["@borderRadius"]     = localizedProp({ type:"number", default:55, min:0, max:100, step:1 }, 'nodes.titleNote.borderRadius');
TitleNoteNode["@letterSpacing"]    = localizedProp({ type:"number", default:0, min:-5, max:20, step:0.5 }, 'nodes.titleNote.letterSpacing');
TitleNoteNode["@padding"]          = localizedProp({ type:"number", default:20,  min:0,   max:50,  step:1 }, 'nodes.titleNote.paddingProperty');
TitleNoteNode["@lineHeight"]       = localizedProp({ type:"number", default:1.4, min:0.8, max:3,   step:0.1 }, 'nodes.titleNote.lineHeightProperty');
TitleNoteNode["@textAlign"]        = localizedProp({ type:"combo",  values:["left","center","right"], default:"center" }, 'nodes.titleNote.textAlignProperty');

registerLocalizedNode(TitleNoteNode, 'nodes.titleNote.nodeTitle');

/* ════════════════════════════════════════════════════════════════
   全局资源 & 清理管理
   ════════════════════════════════════════════════════════════════ */

/* ── 防线 1: drawNodeTitle 拦截 ── */
const _drawNodeTitleLayer = (next) => function (node) {
    if (node.type === _TN_TYPE) return;
    return next.apply(this, arguments);
};

/* ── 防线 2: drawNode 注入 ── */
const _drawNodeLayer = (next) => function (node, ctx) {
    if (node.constructor === TitleNoteNode) {
        node.bgcolor = "transparent";
        node.color   = "transparent";
        node.flags.allow_interaction = !node.flags.pinned;
        node.onDrawBackground(ctx);
        return;
    }
    return next.apply(this, arguments);
};

/* ── processMouseDown 注入：链接点击 ── */
const _processMouseDownLayer = (next) => function (e) {
    if (!this.graph) return next.call(this, e);
    const canvasPos = this.convertEventToCanvasOffset(e);
    const node = this.graph.getNodeOnPos(canvasPos[0], canvasPos[1], this.graph._nodes);
    if (node && node.constructor === TitleNoteNode && !node.isEditing) {
        const lp = [canvasPos[0] - node.pos[0], canvasPos[1] - node.pos[1]];
        if (node.linkAreas && node.linkAreas.length > 0) {
            for (const a of node.linkAreas) {
                if (lp[0] >= a.x && lp[0] <= a.x + a.width && lp[1] >= a.y && lp[1] <= a.y + a.height) {
                    node.openLink(a.url);
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                }
            }
        }
    }
    return next.call(this, e);
};

/* ── getNodeOnPos 注入：固定节点穿透 ── */
const mouseState = { processingMouseDown: false, lastMouseEvent: null };

function _onDocMouseDown (e) {
    mouseState.processingMouseDown = true;
    mouseState.lastMouseEvent      = e;
}
function _onDocMouseUp () {
    mouseState.processingMouseDown = false;
}

const _getNodeOnPosLayer = (next) => function (x, y, nodes, margin) {
    if (nodes) {
        const recent = LiteGraph.getTime() -
            (LGraphCanvas.active_canvas && LGraphCanvas.active_canvas.last_mouseclick
                ? LGraphCanvas.active_canvas.last_mouseclick : 0) < 300;
        if (mouseState.processingMouseDown && mouseState.lastMouseEvent &&
            mouseState.lastMouseEvent.type.includes("down") &&
            mouseState.lastMouseEvent.which === 1 && !recent) {
            nodes = [...nodes].filter(n => !(n instanceof TitleNoteNode && n.flags.pinned));
        }
    }
    return next.apply(this, [x, y, nodes, margin]);
};

/* ── 双击穿透（Nodes 2.0 HTML VUE 覆盖层）── */
function _onDocDblClick (e) {
    if (_tnUninstalled) return;
    const nodeBody = e.target.closest('[data-testid^="node-body-"]');
    if (nodeBody) {
        if (e.target.closest("input, textarea, select, [contenteditable], button, a, [role='button'], [role='slider'], [role='combobox'], .comfy-multiline-input, .comfy-input"))
            return;
        const testId = nodeBody.getAttribute("data-testid") || nodeBody.getAttribute("data-testId") || "";
        const match  = testId.match(/node-body-(\d+)/);
        if (!match) return;
        const node = app.graph?.getNodeById(parseInt(match[1]));
        if (node && typeof node.onDblClick === "function") { node.onDblClick(e); return; }
    }
    if (!app.graph || !LGraphCanvas.active_canvas) return;
    const canvasPos = LGraphCanvas.active_canvas.convertEventToCanvasOffset(e);
    const hit = app.graph.getNodeOnPos(canvasPos[0], canvasPos[1], app.graph._nodes);
    if (hit && typeof hit.onDblClick === "function") hit.onDblClick(e);
}

let _titleNotePatchDisposers = [];
let _offTitleNoteLangChange = null;

function _patchTitleNoteMethod(target, methodName, patchId, layer) {
    if (!target || typeof target[methodName] !== "function") return () => {};
    return patchMethod(target, methodName, patchId, layer);
}

function _installTitleNote () {
    _tnUninstalled = false;
    _titleNotePatchDisposers = [
        _patchTitleNoteMethod(LGraphCanvas?.prototype, "drawNodeTitle", "WOSAI.TitleNote.title", _drawNodeTitleLayer),
        _patchTitleNoteMethod(LGraphCanvas?.prototype, "drawNode", "WOSAI.TitleNote.node", _drawNodeLayer),
        _patchTitleNoteMethod(LGraphCanvas?.prototype, "processMouseDown", "WOSAI.TitleNote.mouse", _processMouseDownLayer),
        _patchTitleNoteMethod(LGraph?.prototype, "getNodeOnPos", "WOSAI.TitleNote.hitTest", _getNodeOnPosLayer),
    ];
    document.addEventListener("mousedown", _onDocMouseDown, true);
    document.addEventListener("mouseup", _onDocMouseUp, true);
    document.addEventListener("dblclick", _onDocDblClick, true);
}

function _uninstallTitleNote () {
    _tnUninstalled = true;
    for (const timer of _titleNoteSetupTimers) clearTimeout(timer);
    _titleNoteSetupTimers.clear();
    _titleNotePatchDisposers.splice(0).forEach(dispose => dispose());
    _offTitleNoteLangChange?.();
    _offTitleNoteLangChange = null;
    document.removeEventListener("mousedown", _onDocMouseDown, true);
    document.removeEventListener("mouseup", _onDocMouseUp, true);
    document.removeEventListener("dblclick", _onDocDblClick, true);
    app.graph?._nodes?.forEach(n => {
        if (!(n instanceof TitleNoteNode)) return;
        n.removeTextEditor();
        // 每个节点注入的 <style id="wosai-tn-vue-{id}"> 也要回收，
        // 否则扩展卸载后 head 中残留样式，节点 id 复用时命中陈旧规则。
        _tnCleanupNodeStyle(n);
    });
}

/* ════════════════════════════════════════════════════════════════
   注册扩展
   ════════════════════════════════════════════════════════════════ */
app.registerExtension({
    name: "WOSAI.TitleNote",

    async setup () {
        TitleNoteNode.setUp();
        _installTitleNote();
        [100, 500, 1500].forEach(delay => _tnSchedule(_tnApplyNodeStylesForAll, delay));
        _offTitleNoteLangChange?.();
        _offTitleNoteLangChange = onLangChange(() => {
            if (_tnUninstalled) return;
            [0, 100, 500, 1500].forEach(delay => _tnSchedule(() => {
                _tnApplyNodeStylesForAll();
                app.graph?.setDirtyCanvas(true, true);
            }, delay));
        });
    },

    nodeCreated (node) {
        if (!_tnUninstalled && node.type === _TN_TYPE) {
            _tnSchedule(() => _tnVueTick(node, 20), 100);
        }
    },

    remove () {
        _uninstallTitleNote();
    }
});
