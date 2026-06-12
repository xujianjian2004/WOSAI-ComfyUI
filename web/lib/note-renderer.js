// ========== CONSTANTS (inlined for standalone renderer) ==========
import { getUIFont, hexToRGBA } from "./shared-utils.js";

const INLINE_RE = /(\*\*\*(.+?)\*\*\*)|(\*\*(.+?)\*\*)|(\*(.+?)\*)|~~(.+?)~~|==(.+?)==|\^(.+?)\^|~(.+?)~|`([^`]+)`|\[([^\]]*)\]\(([^)]+)\)|(https?:\/\/[^\s]+)|(www\.[^\s]+)/g;
const isChinese     = (c) => /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(c);
const isBreak       = (c) => /[\s\p{P}\p{S}]/u.test(c);
const isPunct       = (c) => /\p{P}|\p{S}/u.test(c);
const _CJK_PUNCT_STR = '，。、！？：；「」『』【】《》（）\u201C\u201D\u2018\u2019—…～．';
const CJK_PUNCT     = new Set(_CJK_PUNCT_STR.split(''));
const isCJKLike     = (c) => isChinese(c) || CJK_PUNCT.has(c);
const _LINE_FORBIDDEN_STR = ',，.。;；!！\u201D\u2019」』';
const LINE_FORBIDDEN= new Set(_LINE_FORBIDDEN_STR.split(''));
const isForbidStart = (c) => LINE_FORBIDDEN.has(c);
const _imageCache = {};
const IMAGE_CACHE_MAX = 50;
function loadImage(url) {
    if (_imageCache[url]) return _imageCache[url];
    const keys = Object.keys(_imageCache);
    if (keys.length >= IMAGE_CACHE_MAX) delete _imageCache[keys[0]];
    const entry = { img: null, loaded: false, error: false, tried: false };
    _imageCache[url] = entry;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { entry.img = img; entry.loaded = true; window.app?.graph?.setDirtyCanvas(true); };
    img.onerror = () => {
        if (!entry.tried) {
            entry.tried = true;
            const img2 = new Image();
            img2.onload = () => { entry.img = img2; entry.loaded = true; window.app?.graph?.setDirtyCanvas(true); };
            img2.onerror = () => { entry.error = true; };
            img2.src = url;
        } else { entry.error = true; }
    };
    img.src = url;
    return entry;
}

// ========== UTILS (inlined for standalone renderer) ==========
function lightenColor(hex, amount) {
    let r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b), l0 = (max+min)/2;
    let h, s;
    if (max === min) { h = 0; s = 0; }
    else {
        const d = max - min;
        s = l0 > 0.5 ? d/(2-max-min) : d/(max+min);
        switch(max) {
            case r: h = ((g-b)/d + (g<b?6:0))/6; break;
            case g: h = ((b-r)/d + 2)/6;          break;
            default: h = ((r-g)/d + 4)/6;
        }
    }
    const l1 = Math.min(1, l0 + amount * (l0 < 0.5 ? 0.4 : 0.25));
    const hue2rgb = (p,q,t) => { if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<0.5)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
    const q = l1 < 0.5 ? l1*(1+s) : l1+s-l1*s, p = 2*l1-q;
    r = Math.round(hue2rgb(p,q,h+1/3)*255);
    g = Math.round(hue2rgb(p,q,h)*255);
    b = Math.round(hue2rgb(p,q,h-1/3)*255);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

// ========== MD-HTML-PARSER ==========
function parseSpanStyle(str) {
    const result = {};
    const parts = str.split(';');
    for (const part of parts) {
        const idx = part.indexOf(':');
        if (idx === -1) continue;
        const key = part.slice(0, idx).trim();
        let val = part.slice(idx + 1).trim();
        if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) val = val.slice(1, -1);
        result[key] = val;
    }
    return result;
}
function extractAttr(attrStr, name) {
    const re = new RegExp('\\b' + name + '\\s*=\\s*([\\\'"])', 'i');
    const m = attrStr.match(re);
    if (!m) return '';
    const q = m[1];
    const start = m.index + m[0].length;
    const end = attrStr.indexOf(q, start);
    return end === -1 ? '' : attrStr.slice(start, end);
}
function applyTagAttrs(tagName, attrStr, baseAttrs) {
    const a = { ...baseAttrs };
    const styleStr = extractAttr(attrStr, 'style');
    const sp = styleStr ? parseSpanStyle(styleStr) : {};
    if (tagName === 'a') { const h = extractAttr(attrStr, 'href'); if (h) { a.link = true; a.url = h; } }
    const tagMods = {
        strong:     () => a.bold = true, b: () => a.bold = true, em: () => a.italic = true, i: () => a.italic = true,
        u: () => a.underline = true, s: () => a.strike = true, strike: () => a.strike = true, del: () => a.strike = true, ins: () => a.underline = true,
        mark: () => a.mark = true, code: () => a.code = true, tt: () => a.code = true, kbd: () => a.code = true, sub: () => a.sub = true, sup: () => a.sup = true,
        small: () => { if (!a._spanSize) a._spanSize = Math.round((baseAttrs._spanSize || 16) * 0.8); },
        big: () => { if (!a._spanSize) a._spanSize = Math.round((baseAttrs._spanSize || 16) * 1.2); },
        h1: () => { a.isHeading = true; a.headingLevel = 1; a.bold = true; },
        h2: () => { a.isHeading = true; a.headingLevel = 2; a.bold = true; },
        h3: () => { a.isHeading = true; a.headingLevel = 3; a.bold = true; },
        h4: () => { a.isHeading = true; a.headingLevel = 4; a.bold = true; },
        h5: () => { a.isHeading = true; a.headingLevel = 5; a.bold = true; },
        h6: () => { a.isHeading = true; a.headingLevel = 6; a.bold = true; },
        center: () => { a.textAlign = 'center'; }, blockquote: () => { a.isQuote = true; a.quoteLevel = 1; },
        pre: () => { a.code = true; }, li: () => { a.isList = true; }, p: () => { a.isParagraph = true; a._blockBreak = true; },
        div: () => { a._blockBreak = true; },
        ul: () => { a.isList = true; a.nestLevel = (a.nestLevel || 0) + 1; delete a._olState; },
        ol: () => { a.isOrderedList = true; a.nestLevel = (a.nestLevel || 0) + 1; a._olState = { counter: 1 }; },
        q: () => { a.isQ = true; }, abbr: () => { a.isAbbr = true; }, font: () => {}, nobr: () => { a.nobr = true; },
    };
    if (tagMods[tagName]) tagMods[tagName]();
    if (sp['font-weight']) { a.bold = sp['font-weight'] === 'bold' || sp['font-weight'] === '700'; if (!a.bold) a._spanWeight = sp['font-weight']; }
    if (sp['font-size']) { const m = sp['font-size'].match(/^(\d+(?:\.\d+)?)/); if (m) a._spanSize = parseFloat(m[1]); }
    if (sp['font-family']) a._spanFamily = sp['font-family'];
    if (sp['color']) { let c = sp['color'].trim(); if (!c.startsWith('#')) c = '#' + c; a._spanColor = c; }
    if (sp['text-align']) a.textAlign = sp['text-align'];
    if (sp['text-decoration'] === 'underline') a.underline = true;
    if (sp['text-decoration'] === 'line-through') a.strike = true;
    if (sp['font-style'] === 'italic') a.italic = true;
    if (sp['line-height']) { const l = parseFloat(sp['line-height']); if (l) a._lineHeight = l; }
    if (tagName === 'font') {
        const fc = extractAttr(attrStr, 'color'); if (fc) { let c = fc.trim(); if (!c.startsWith('#')) c = '#' + c; a._spanColor = c; }
        const fs = extractAttr(attrStr, 'size'); if (fs) { const n = parseInt(fs); if (n) a._spanSize = n * 4 + 12; }
        const ff = extractAttr(attrStr, 'face'); if (ff) a._spanFamily = ff;
    }
    if (tagName === 'abbr') { const t = extractAttr(attrStr, 'title'); if (t) a.abbrTitle = t; }
    return a;
}
function findCloseTag(raw, fromPos, tagName) {
    const openStr = '<' + tagName, closeStr = '</' + tagName + '>';
    let depth = 1, pos = fromPos;
    while (depth > 0 && pos < raw.length) {
        const nextOpen = raw.indexOf(openStr, pos), nextClose = raw.indexOf(closeStr, pos);
        if (nextClose === -1) return -1;
        if (nextOpen !== -1 && nextOpen < nextClose) {
            const after = nextOpen + openStr.length;
            if (after >= raw.length || raw[after] === '>' || raw[after] === ' ' || raw[after] === '/' || raw[after] === '\n' || raw[after] === '\t') depth++;
            else { pos = nextOpen + 1; continue; }
            pos = after + 1; continue;
        }
        depth--; if (depth === 0) return nextClose;
        pos = nextClose + closeStr.length;
    }
    return -1;
}

function pushText(str, attrs, out) { for (const ch of str) out.push({ ch, ...attrs }); }

function parseInline(raw, baseAttrs) {
    const tokens = [];
    let last = 0, i = 0;
    while (i < raw.length) {
        let matched = false;
        if (raw[i] === '\\' && i + 1 < raw.length) {
            const next = raw[i + 1];
            if (/[*`#~\[\]()\\!_]/.test(next)) { if (i > last) pushText(raw.slice(last, i), baseAttrs, tokens); pushText(next, baseAttrs, tokens); i += 2; last = i; matched = true; }
        }
        if (!matched && raw[i] === '\n') { if (i > last) pushText(raw.slice(last, i), baseAttrs, tokens); tokens.push({ ch: '\n' }); last = i + 1; i = last; matched = true; }
        if (!matched && i + 1 < raw.length && raw[i] === '!' && raw[i+1] === '[') {
            const altStart = i + 2, altEnd = raw.indexOf(']', altStart);
            if (altEnd !== -1 && altEnd + 1 < raw.length && raw[altEnd + 1] === '(') {
                const urlStart = altEnd + 2, urlEnd = raw.indexOf(')', urlStart);
                if (urlEnd !== -1) {
                    if (i > last) pushText(raw.slice(last, i), baseAttrs, tokens);
                    const altText = raw.slice(altStart, altEnd), imgRaw = raw.slice(urlStart, urlEnd).trim(), imgUrl = imgRaw.replace(/\s+["'][^"']*["']\s*$/, '').trim();
                    pushText(`[图片: ${altText}]`, { ...baseAttrs, image: true, url: imgUrl, altText }, tokens);
                    last = urlEnd + 1; i = last; matched = true;
                }
            }
        }
        if (!matched && raw[i] === '<') {
            const rest = raw.slice(i);
            if (rest.startsWith('<!--')) {
                const closeIdx = raw.indexOf('-->', i + 4);
                if (closeIdx !== -1) { if (i > last) pushText(raw.slice(last, i), baseAttrs, tokens); last = closeIdx + 3; i = last; matched = true; }
            }
            if (!matched && /^<img\s/i.test(rest)) {
                const closeIdx = raw.indexOf('>', i);
                if (closeIdx !== -1) {
                    if (i > last) pushText(raw.slice(last, i), baseAttrs, tokens);
                    const tag = raw.slice(i, closeIdx + 1), srcM = tag.match(/src=["']([^"']+)["']/i), altM = tag.match(/alt=["']([^"']*)["']/i);
                    const widthM = tag.match(/width=["'](\d+(?:\.\d+)?%?)["']/i), heightM = tag.match(/height=["'](\d+(?:\.\d+)?)["']/i);
                    const styleM = tag.match(/style=["']([^"']*)["']/i);
                    let imgStyleMaxW = null, imgStyleH = null;
                    if (styleM) {
                        const sp = parseSpanStyle(styleM[1]);
                        if (sp['max-width']) { const m = sp['max-width'].match(/^(\d+(?:\.\d+)?)%/); if (m) imgStyleMaxW = parseFloat(m[1]); }
                        if (sp['height']) imgStyleH = sp['height'].trim().toLowerCase();
                    }
                    if (srcM) {
                        const imgUrl = srcM[1], altText = altM ? altM[1] : 'img', imgWidth = widthM ? widthM[1] : null, imgHeight = heightM ? parseFloat(heightM[1]) : null;
                        pushText(`[图片: ${altText}]`, { ...baseAttrs, image: true, url: imgUrl, altText, imgWidth, imgHeight, imgStyleMaxW, imgStyleH }, tokens);
                    }
                    last = closeIdx + 1; i = last; matched = true;
                }
            }
            if (!matched && /^<https?:\/\//i.test(rest)) {
                const closeIdx = raw.indexOf('>', i);
                if (closeIdx !== -1) { if (i > last) pushText(raw.slice(last, i), baseAttrs, tokens); pushText(raw.slice(i + 1, closeIdx), { ...baseAttrs, link: true, url: raw.slice(i + 1, closeIdx) }, tokens); last = closeIdx + 1; i = last; matched = true; }
            }
            if (!matched) {
                const gtIdx = raw.indexOf('>', i);
                if (gtIdx !== -1) {
                    const tagRaw = raw.slice(i + 1, gtIdx), nm = tagRaw.match(/^\s*(\w+)/);
                    if (nm) {
                        const tn = nm[1].toLowerCase();
                        const KNOWN = ['strong','b','em','i','s','strike','del','ins','mark','code','tt','kbd','small','big','sub','sup','h1','h2','h3','h4','h5','h6','div','p','q','abbr','ul','ol','li','blockquote','pre','center','a','font','nobr','br','hr','wbr'];
                        if (KNOWN.includes(tn)) {
                            const attrStr = tagRaw.slice(nm[0].length).trim(), openLen = gtIdx - i + 1, selfClose = /br|hr|wbr/.test(tn) || /\/\s*$/.test(tagRaw);
                            if (selfClose) {
                                if (tn === 'br') { if (i > last) pushText(raw.slice(last, i), baseAttrs, tokens); tokens.push({ ch: '\n', ...baseAttrs }); last = i + openLen; i = last; matched = true; }
                                else if (tn === 'hr') { if (i > last) pushText(raw.slice(last, i), baseAttrs, tokens); tokens.push({ ch: '\u2500', ...baseAttrs, isHr: true }); last = i + openLen; i = last; matched = true; }
                            } else {
                                const closeIdx = findCloseTag(raw, i + openLen, tn);
                                if (closeIdx !== -1) {
                                    if (i > last) pushText(raw.slice(last, i), baseAttrs, tokens);
                                    const inner = raw.slice(i + openLen, closeIdx), na = applyTagAttrs(tn, attrStr, baseAttrs), it = parseInline(inner, na);
                                    if (tn === 'li') {
                                        let bullet;
                                        if (na._olState) { bullet = na._olState.counter + '. '; na._olState.counter++; }
                                        else { const nl = na.nestLevel || 0; bullet = nl === 0 ? '\u2022 ' : nl === 1 ? '\u25e6 ' : '\u25aa '; }
                                        if (tokens.length > 0 && tokens[tokens.length - 1].ch !== '\n') tokens.push({ ch: '\n', _listBreak: true });
                                        const nl = na.nestLevel || 0;
                                        if (nl > 0) { for (let _n = 0; _n < nl * 2; _n++) tokens.push({ ch: ' ', ...na, isList: true }); }
                                        tokens.push(...parseInline(bullet, { ...na, isList: true, isListMarker: true }));
                                        const BLOCK_SPLIT = /(<(?:ul|ol)[\s\S]*?<\/(?:ul|ol)>)/gi, parts = inner.split(BLOCK_SPLIT), liTokens = [];
                                        let firstText = true;
                                        for (const part of parts) {
                                            if (/^\s*$/.test(part)) continue;
                                            const isBlock = /^<(ul|ol)/i.test(part.trim());
                                            if (isBlock) { if (liTokens.length > 0 && liTokens[liTokens.length - 1].ch !== '\n') liTokens.push({ ch: '\n', _listBreak: true }); liTokens.push(...parseInline(part.trim(), na)); }
                                            else {
                                                const cleaned = part.replace(/^\s*\n/, '').replace(/\n\s*$/, '').replace(/\n[ \t]*\n/g, '\n').trim();
                                                if (!cleaned) continue;
                                                if (!firstText && liTokens.length > 0 && liTokens[liTokens.length - 1].ch !== '\n') liTokens.push({ ch: '\n', _listBreak: true });
                                                liTokens.push(...parseInline(cleaned, { ...na, isList: true })); firstText = false;
                                            }
                                        }
                                        tokens.push(...liTokens);
                                    } else if (na.isQ) { tokens.push({ ch: '\u201C', ...baseAttrs }); tokens.push(...it); tokens.push({ ch: '\u201D', ...baseAttrs }); }
                                    else { tokens.push(...it); }
                                    last = closeIdx + (tn.length + 3); i = last; matched = true;
                                }
                            }
                        }
                    }
                }
            }
        }
        if (!matched && raw[i] === '<' && raw.slice(i, i+3) === '<u>') {
            const closeIdx = raw.indexOf('</u>', i + 3);
            if (closeIdx !== -1) { if (i > last) pushText(raw.slice(last, i), baseAttrs, tokens); pushText(raw.slice(i + 3, closeIdx), { ...baseAttrs, underline: true }, tokens); last = closeIdx + 4; i = last; matched = true; }
        }
        if (!matched && raw[i] === '<' && raw.slice(i).toLowerCase().startsWith('<span ')) {
            const spRest = raw.slice(i), qt = spRest.match(/^<span\s+style=(["'])/i);
            if (qt) {
                const q = qt[1], closeQtIdx = raw.indexOf(q, i + qt[0].length);
                if (closeQtIdx !== -1) {
                    const gtIdx = raw.indexOf('>', closeQtIdx);
                    if (gtIdx !== -1) {
                        const styleStr = raw.slice(i + qt[0].length, closeQtIdx), openLen = gtIdx - i + 1, closeTag = '</span>', closeIdx = raw.indexOf(closeTag, gtIdx + 1);
                        if (closeIdx !== -1) {
                            if (i > last) pushText(raw.slice(last, i), baseAttrs, tokens);
                            const innerRaw = raw.slice(i + openLen, closeIdx), styleProps = parseSpanStyle(styleStr), spanAttrs = { ...baseAttrs };
                            if (styleProps['font-weight']) { spanAttrs.bold = styleProps['font-weight'] === 'bold' || styleProps['font-weight'] === '700'; if (!spanAttrs.bold) spanAttrs._spanWeight = styleProps['font-weight']; }
                            if (styleProps['font-size']) { const m = styleProps['font-size'].match(/^(\d+(?:\.\d+)?)/); if (m) spanAttrs._spanSize = parseFloat(m[1]); }
                            if (styleProps['font-family']) spanAttrs._spanFamily = styleProps['font-family'];
                            if (styleProps['color']) { let c = styleProps['color'].trim(); if (!c.startsWith('#')) c = '#' + c; spanAttrs._spanColor = c; }
                            tokens.push(...parseInline(innerRaw, spanAttrs));
                            last = closeIdx + closeTag.length; i = last; matched = true;
                        }
                    }
                }
            }
        }
        if (!matched) {
            INLINE_RE.lastIndex = i;
            const m = INLINE_RE.exec(raw);
            if (m && m.index === i) {
                if (i > last) pushText(raw.slice(last, i), baseAttrs, tokens);
                if (m[1])       pushText(m[2],  { ...baseAttrs, bold: true,  italic: true  }, tokens);
                else if (m[3])  pushText(m[4],  { ...baseAttrs, bold: true                 }, tokens);
                else if (m[5])  pushText(m[6],  { ...baseAttrs, italic: true               }, tokens);
                else if (m[7])  pushText(m[7],  { ...baseAttrs, strike: true               }, tokens);
                else if (m[8])  pushText(m[8],  { ...baseAttrs, mark: true                 }, tokens);
                else if (m[9])  pushText(m[9],  { ...baseAttrs, sup: true                  }, tokens);
                else if (m[10]) pushText(m[10], { ...baseAttrs, sub: true                  }, tokens);
                else if (m[11]) pushText(m[11], { ...baseAttrs, code: true                 }, tokens);
                else if (m[12]) pushText(m[12], { ...baseAttrs, link: true, url: m[13].trim().replace(/\s+["'][^\"']*["']\s*$/, '').trim() }, tokens);
                else if (m[14]) pushText(m[14], { ...baseAttrs, link: true, url: m[14]     }, tokens);
                else if (m[15]) pushText(m[15], { ...baseAttrs, link: true, url:'https://'+m[15] }, tokens);
                last = m.index + m[0].length; i = last; matched = true;
            }
        }
        if (!matched) i++;
    }
    if (last < raw.length) pushText(raw.slice(last), baseAttrs, tokens);
    return tokens;
}

function buildTokenList(text) {
    const base = { bold:false, italic:false, strike:false, code:false, link:false, image:false, altText:null, url:null, mark:false, sup:false, sub:false, underline:false,
                   isHeading:false, headingLevel:0, isList:false, isListMarker:false, isOrderedList:false, isQuote:false, quoteLevel:0, isHr:false, isCodeBlock:false,
                   isTaskList:false, isChecked:false, nestLevel:0 };
    const all = [], rawLines = text.split('\n'), lines = [];
    let si = 0;
    function hasSpanOpen(line) {
        const m = line.match(/<span\s+style=(["'])/i);
        if (!m) return false;
        const q = m[1], afterQ = line.indexOf(q, m.index + m[0].length);
        return afterQ !== -1 && line.indexOf('>', afterQ) !== -1;
    }
    while (si < rawLines.length) {
        const line = rawLines[si];
        if (hasSpanOpen(line) && line.indexOf('</span>') === -1) {
            let merged = line; si++;
            while (si < rawLines.length) { merged += '\n' + rawLines[si]; if (rawLines[si].indexOf('</span>') !== -1) break; si++; }
            lines.push(merged); si++;
        } else { lines.push(line); si++; }
    }
    let inCodeBlock = false, _inQuoteCode = false;
    function countTagOpens(str, tag) {
        const open = '<' + tag; let cnt = 0, pos = 0;
        while ((pos = str.indexOf(open, pos)) !== -1) {
            const after = pos + open.length;
            if (after >= str.length || str[after] === '>' || str[after] === ' ' || str[after] === '/' || str[after] === '\n' || str[after] === '\t') cnt++;
            pos = after;
        }
        return cnt;
    }
    function countTagCloses(str, tag) { const close = '</' + tag + '>'; let cnt = 0, pos = 0; while ((pos = str.indexOf(close, pos)) !== -1) { cnt++; pos += close.length; } return cnt; }
    function findBlockTagEnd(idx) {
        const line = lines[idx], m = line.match(/^\s*<(\w+)/);
        if (!m) return idx;
        const tag = m[1].toLowerCase();
        if (!['div','ul','ol','blockquote','pre','center','p'].includes(tag)) return idx;
        if (line.indexOf('</' + tag + '>') !== -1) return idx;
        let depth = 1;
        for (let e = idx + 1; e < lines.length; e++) { depth += countTagOpens(lines[e], tag); depth -= countTagCloses(lines[e], tag); if (depth <= 0) return e; }
        return idx;
    }
    for (let li = 0; li < lines.length; li++) {
        const raw = lines[li];
        if (li > 0) all.push({ ch:'\n', ...base });
        const blockEnd = findBlockTagEnd(li);
        if (blockEnd > li) {
            const merged = lines.slice(li, blockEnd + 1).join('\n'), m2 = merged.match(/^\s*<(\w+)/);
            if (m2 && m2[1].toLowerCase() === 'pre') {
                const gt = merged.indexOf('>'), closePre = merged.lastIndexOf('</pre>'), inner = merged.slice(gt + 1, closePre);
                for (const ch of inner) all.push({ ch, ...base, isCodeBlock:true, code:true });
            } else { all.push(...parseInline(merged, { ...base })); }
            li = blockEnd; continue;
        }
        if (/^`{3,}/.test(raw)) { inCodeBlock = !inCodeBlock; continue; }
        if (inCodeBlock) { for (const ch of (raw || ' ')) all.push({ ch, ...base, isCodeBlock:true, code:true }); continue; }
        if (/^(\s*[-*_]){3,}\s*$/.test(raw) && raw.trim().length >= 3) { all.push({ ch:'\u2500', ...base, isHr:true }); continue; }
        const hm = raw.match(/^(#{1,6})\s+(.*)/);
        if (hm) { const lvl = hm[1].length; all.push(...parseInline(hm[2], { ...base, isHeading:true, headingLevel:lvl, bold:true })); continue; }
        const qm = raw.match(/^((?:>\s*)+)(.*)/);
        if (qm) {
            const qLevel = (qm[1].match(/>/g) || []).length, inner = qm[2], qBase = { ...base, isQuote:true, quoteLevel:qLevel };
            if (/^`{3,}/.test(inner)) { _inQuoteCode = !_inQuoteCode; continue; }
            if (_inQuoteCode) { for (const ch of (inner || ' ')) all.push({ ch, ...qBase, isCodeBlock:true, code:true }); continue; }
            if (/^(#{1,6})\s/.test(inner)) {
                const hm2 = inner.match(/^(#{1,6})\s+(.*)/);
                if (hm2) { const lvl = hm2[1].length, toks = parseInline(hm2[2], { ...qBase, isHeading:true, headingLevel:lvl, bold:true }); if (toks.length === 0) all.push({ ch:'\u00a0', ...qBase }); else all.push(...toks); }
            } else if (/^\d+\.\s/.test(inner)) {
                const olm2 = inner.match(/^([ \t]*)(\d+)\.\s(.*)/);
                if (olm2) {
                    const nestLevel = Math.floor((olm2[1].length) / 2), marker = `${olm2[2]}. `;
                    for (const ch of marker) all.push({ ch, ...qBase, isOrderedList:true, isListMarker:true, nestLevel });
                    all.push(...parseInline(olm2[3], { ...qBase, isOrderedList:true, nestLevel }));
                }
            } else if (/^([ \t]*([-*])\s)(\[([xX ]?)\])\s/.test(inner)) {
                const lm2 = inner.match(/^([ \t]*([-*])\s)(\[([xX ]?)\])\s(.*)/);
                if (lm2) {
                    const nestLevel = Math.floor((lm2[1].replace(/\t/g, '    ').replace(/[-*]\s$/, '').length) / 2), isChecked = lm2[4].toLowerCase() === 'x';
                    all.push({ ch: '\u2610', ...qBase, isList:true, isListMarker:true, isTaskList:true, isChecked, nestLevel });
                    all.push({ ch: ' ', ...qBase, isList:true, nestLevel });
                    all.push(...parseInline(lm2[5], { ...qBase, isList:true, isTaskList:true, isChecked, nestLevel }));
                }
            } else if (/^([ \t]*[-*])\s/.test(inner)) {
                const simpleLm2 = inner.match(/^([ \t]*([-*])\s)(.*)/);
                if (simpleLm2 && simpleLm2[3]) {
                    const nestLevel = Math.floor((simpleLm2[1].replace(/\t/g, '    ').replace(/[-*]\s$/, '').length) / 2);
                    const bullet = nestLevel === 0 ? '•' : nestLevel === 1 ? '◦' : '▪';
                    all.push({ ch: bullet, ...qBase, isList:true, isListMarker:true, nestLevel }); all.push({ ch: ' ', ...qBase, isList:true, nestLevel });
                    all.push(...parseInline(simpleLm2[3], { ...qBase, isList:true, nestLevel }));
                }
            } else { const toks = parseInline(inner, qBase); if (toks.length === 0) all.push({ ch: '\u00a0', ...qBase }); else all.push(...toks); }
            continue;
        }
        const olm = raw.match(/^([ \t]*)(\d+)\.\s(.*)/);
        if (olm) {
            const nestLevel = Math.floor((olm[1].replace(/\t/g, '    ').length) / 2), marker = `${olm[2]}. `;
            for (const ch of marker) all.push({ ch, ...base, isOrderedList:true, isListMarker:true, nestLevel });
            all.push(...parseInline(olm[3], { ...base, isOrderedList:true, nestLevel })); continue;
        }
        const lm = raw.match(/^([ \t]*([-*])\s)(\[([xX ]?)\])\s(.*)/);
        if (lm) {
            const nestLevel = Math.floor((lm[1].replace(/\t/g, '    ').replace(/[-*]\s$/, '').length) / 2), isChecked = lm[4].toLowerCase() === 'x';
            all.push({ ch: '\u2610', ...base, isList:true, isListMarker:true, isTaskList:true, isChecked, nestLevel }); all.push({ ch: ' ', ...base, isList:true, nestLevel });
            all.push(...parseInline(lm[5], { ...base, isList:true, isTaskList:true, isChecked, nestLevel })); continue;
        }
        const simpleLm = raw.match(/^([ \t]*([-*])\s)(.*)/);
        if (simpleLm && simpleLm[3]) {
            const nestLevel = Math.floor((simpleLm[1].replace(/\t/g, '    ').replace(/[-*]\s$/, '').length) / 2);
            const bullet = nestLevel === 0 ? '•' : nestLevel === 1 ? '◦' : '▪';
            all.push({ ch: bullet, ...base, isList:true, isListMarker:true, nestLevel }); all.push({ ch: ' ', ...base, isList:true, nestLevel });
            all.push(...parseInline(simpleLm[3], { ...base, isList:true, nestLevel })); continue;
        }
        all.push(...parseInline(raw, { ...base }));
    }
    return all;
}

function wrapChars(ctx, chars, maxW, baseFontSize, baseFont) {
    if (!chars.length) return [[]];
    const getFont = (c) => {
        const fs = c._spanSize || (c.isHeading ? Math.round(baseFontSize * (1 + (6 - c.headingLevel) * 0.15 + 0.1)) : baseFontSize);
        const fw = c._spanWeight || (c.bold ? 'bold' : 'normal');
        const fi = c.italic ? 'italic ' : '';
        let ff = c._spanFamily || baseFont;
        if (c._spanFamily && /\s/.test(c._spanFamily) && !/^["']/.test(c._spanFamily)) ff = '"' + c._spanFamily + '"';
        return `${fi}${fw} ${fs}px ${ff}`;
    };
    const _wCache = new Map();
    const measureCh = (tok) => {
        const f = getFont(tok), key = f + tok.ch;
        if (_wCache.has(key)) return _wCache.get(key);
        if (ctx.font !== f) ctx.font = f;
        const w = ctx.measureText(tok.ch).width; _wCache.set(key, w); return w;
    };
    const charWidths = chars.map(measureCh);
    const lines = []; let line = []; let lineW = 0; let lineStart = 0;
    for (let i = 0; i < chars.length; i++) {
        const c = chars[i]; const cw = charWidths[i];
        if (c.ch === '\n') { lines.push(line); line = []; lineW = 0; lineStart = i + 1; continue; }
        if (c.nobr) { line.push(c); lineW += cw; continue; }
        if (lineW + cw > maxW && line.length > 0) {
            if (isCJKLike(c.ch)) { lines.push(line); line = [c]; lineW = cw; lineStart = i; }
            else {
                let cjk = -1;
                for (let k = line.length-1; k >= 0; k--) { if (isCJKLike(line[k].ch)) { cjk=k; break; } }
                if (cjk >= 0) {
                    lines.push(line.slice(0, cjk+1)); line = [...line.slice(cjk+1), c];
                    const newLineStart = lineStart + cjk + 1; lineW = line.reduce((s, _t, idx) => s + (charWidths[newLineStart + idx] ?? measureCh(_t)), 0); lineStart = newLineStart;
                } else {
                    const lim = Math.min(20, line.length); let bp = -1;
                    for (let j = line.length-1; j >= line.length-lim; j--) { if (isBreak(line[j].ch)) { bp=j; break; } }
                    if (bp >= 0) {
                        lines.push(line.slice(0, bp+1)); line = [...line.slice(bp+1), c];
                        if (line.length > 0 && isPunct(line[0].ch)) { let pe = 0; while (pe < line.length && isPunct(line[pe].ch)) pe++; lines[lines.length-1] = [...lines[lines.length-1], ...line.slice(0,pe)]; line = line.slice(pe); }
                        const newLineStart = lineStart + bp + 1; lineW = line.reduce((s, _t, idx) => s + (charWidths[newLineStart + idx] ?? measureCh(_t)), 0); lineStart = newLineStart;
                    } else if (isPunct(c.ch)) { lines.push([...line, c]); line = []; lineW = 0; lineStart = i + 1; }
                    else { lines.push(line); line = [c]; lineW = cw; lineStart = i; }
                }
            }
            for (let fix = 0; fix < 20 && line.length > 0 && isForbidStart(line[0].ch) && lines.length > 0; fix++) {
                const prev = lines[lines.length-1];
                if (!prev || prev.length <= 1) break;
                const last = prev[prev.length-1];
                if (isCJKLike(last.ch)) { line = [last, ...line]; lines[lines.length-1] = prev.slice(0,-1); lineStart--; }
                else if (!isBreak(last.ch)) { let ws = prev.length-1; while (ws > 0 && !isBreak(prev[ws-1].ch)) ws--; if (ws === 0) { line = [last,...line]; lines[lines.length-1] = prev.slice(0,-1); lineStart--; } else { line = [...prev.slice(ws),...line]; lines[lines.length-1] = prev.slice(0,ws); lineStart -= (prev.length - ws); } }
                else break;
            }
        } else { line.push(c); lineW += cw; }
    }
    if (line.length > 0) lines.push(line);
    return lines.length ? lines : [[]];
}

function parseTextBlocks(text) {
    const rawLines = text.split('\n'), blocks = [];
    let i = 0;
    while (i < rawLines.length) {
        if (/^\s*\|.+\|/.test(rawLines[i]) && i + 1 < rawLines.length && /^\s*\|[\s|:\-]+\|/.test(rawLines[i + 1])) {
            const tableLines = [];
            while (i < rawLines.length && /^\s*\|.+\|/.test(rawLines[i])) { tableLines.push(rawLines[i]); i++; }
            const parseRow = (line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
            const headers = parseRow(tableLines[0]), sepRow = tableLines[1] ? parseRow(tableLines[1]) : [];
            const aligns = sepRow.map(s => { if (/^:-+:$/.test(s)) return 'center'; if (/^-+:$/.test(s)) return 'right'; return 'left'; });
            const rows = tableLines.slice(2).map(parseRow);
            blocks.push({ type: 'table', headers, aligns, rows });
        } else {
            const textLines = [];
            while (i < rawLines.length && !(/^\s*\|.+\|/.test(rawLines[i]) && i + 1 < rawLines.length && /^\s*\|[\s|:\-]+\|/.test(rawLines[i + 1]))) { textLines.push(rawLines[i]); i++; }
            const t = textLines.join('\n');
            if (t.trim()) blocks.push({ type: 'text', text: t });
            else if (blocks.length && blocks[blocks.length-1].type !== 'table') blocks.push({ type: 'text', text: t });
        }
    }
    return blocks;
}

function measureTable(ctx, table, availW, fontSize, uiFont) {
    const pad = Math.max(4, fontSize * 0.35), rowH = Math.round(fontSize * 1.55), headH = Math.round(fontSize * 1.7);
    const cols = table.headers.length;
    if (!cols) return { colWidths:[], rowHeight:rowH, headerHeight:headH, totalHeight:headH };
    ctx.font = `bold ${fontSize}px ${uiFont}`;
    const naturalW = table.headers.map(h => ctx.measureText(h).width + pad * 2);
    ctx.font = `${fontSize}px ${uiFont}`;
    for (const row of table.rows) { for (let c = 0; c < cols; c++) { const cell = row[c] || '', w = ctx.measureText(cell).width + pad * 2; if (w > naturalW[c]) naturalW[c] = w; } }
    const totalNat = naturalW.reduce((a, b) => a + b, 0), colWidths = naturalW.map(w => (w / totalNat) * availW);
    return { colWidths, rowHeight: rowH, headerHeight: headH, totalHeight: headH + rowH * table.rows.length, pad };
}

function drawTable(ctx, table, x, y, availW, fontSize, uiFont, fontColor) {
    if (!table.headers.length) return y;
    const { colWidths, rowHeight, headerHeight, totalHeight, pad } = measureTable(ctx, table, availW, fontSize, uiFont);
    const headerBg = hexToRGBA(fontColor, 0.15), rowBg1 = hexToRGBA(fontColor, 0.05), borderC = hexToRGBA(fontColor, 0.35);
    ctx.save(); ctx.textBaseline = 'middle';
    ctx.fillStyle = headerBg; ctx.fillRect(x, y, colWidths.reduce((a,b)=>a+b,0), headerHeight);
    ctx.font = `bold ${fontSize}px ${uiFont}`; ctx.fillStyle = fontColor; ctx.textAlign = 'left';
    let cx = x;
    for (let c = 0; c < table.headers.length; c++) {
        const cw = colWidths[c], align = table.aligns[c] || 'left', textW = ctx.measureText(table.headers[c]).width;
        const tx = align === 'center' ? cx + (cw - textW) / 2 : align === 'right' ? cx + cw - pad - textW : cx + pad;
        ctx.fillText(table.headers[c], tx, y + headerHeight / 2); cx += cw;
    }
    ctx.font = `${fontSize}px ${uiFont}`;
    for (let r = 0; r < table.rows.length; r++) {
        const rowY = y + headerHeight + r * rowHeight;
        if (r % 2 === 0) { ctx.fillStyle = rowBg1; ctx.fillRect(x, rowY, colWidths.reduce((a,b)=>a+b,0), rowHeight); }
        cx = x;
        for (let c = 0; c < table.headers.length; c++) {
            const cw = colWidths[c], cell = table.rows[r][c] || '', align = table.aligns[c] || 'left';
            const cellToks = parseInline(cell, { bold:false, italic:false, strike:false, code:false, link:false, url:null, isHeading:false, headingLevel:0, isList:false, isListMarker:false, isOrderedList:false, isQuote:false, quoteLevel:0, isHr:false, isCodeBlock:false, nestLevel:0 });
            let totalCellW = 0;
            for (const tok of cellToks) { const f = tok.bold ? `bold ${fontSize}px ${uiFont}` : tok.italic ? `italic ${fontSize}px ${uiFont}` : tok.code ? `${fontSize}px "Consolas","Courier New",monospace` : `${fontSize}px ${uiFont}`; ctx.font = f; totalCellW += ctx.measureText(tok.ch).width; }
            let tx = align === 'center' ? cx + (cw - totalCellW) / 2 : align === 'right' ? cx + cw - pad - totalCellW : cx + pad;
            ctx.textAlign = 'left';
            for (const tok of cellToks) {
                const f = tok.bold ? `bold ${fontSize}px ${uiFont}` : tok.italic ? `italic ${fontSize}px ${uiFont}` : tok.code ? `${fontSize}px "Consolas","Courier New",monospace` : `${fontSize}px ${uiFont}`;
                ctx.font = f; const cw2 = ctx.measureText(tok.ch).width;
                ctx.fillStyle = tok.link ? "#4a9eff" : fontColor; ctx.fillText(tok.ch, tx, rowY + rowHeight / 2);
                if (tok.strike) { ctx.beginPath(); ctx.moveTo(tx, rowY + rowHeight / 2 + fontSize * 0.05); ctx.lineTo(tx + cw2, rowY + rowHeight / 2 + fontSize * 0.05); ctx.strokeStyle = fontColor; ctx.lineWidth = 1; ctx.stroke(); }
                tx += cw2;
            }
            cx += cw;
        }
    }
    const tableW = colWidths.reduce((a,b)=>a+b,0), tableH = headerHeight + rowHeight * table.rows.length;
    ctx.strokeStyle = borderC; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, tableW, tableH);
    cx = x;
    for (let c = 0; c < colWidths.length - 1; c++) { cx += colWidths[c]; ctx.beginPath(); ctx.moveTo(cx + 0.5, y); ctx.lineTo(cx + 0.5, y + tableH); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(x, y + headerHeight + 0.5); ctx.lineTo(x + tableW, y + headerHeight + 0.5); ctx.stroke();
    for (let r = 1; r < table.rows.length; r++) { const ry = y + headerHeight + r * rowHeight; ctx.beginPath(); ctx.moveTo(x, ry + 0.5); ctx.lineTo(x + tableW, ry + 0.5); ctx.stroke(); }
    ctx.restore();
    return y + tableH;
}

// ========== RENDERER ==========
function tokFontSize(tok, fontSize) {
    if (tok._spanSize) return tok._spanSize;
    return tok.isHeading ? Math.round(fontSize * (1 + (6 - tok.headingLevel) * 0.15 + 0.1)) : fontSize;
}
function tokFont(tok, fontSize, fontWeight, uiFont) {
    const fs = tokFontSize(tok, fontSize);
    const fw = tok._spanWeight || (tok.bold ? 'bold' : (fontWeight && fontWeight !== 'normal' ? fontWeight : 'normal'));
    const fi = tok.italic ? 'italic ' : '';
    let ff = tok._spanFamily || uiFont;
    if (tok._spanFamily && /\s/.test(tok._spanFamily) && !/^["']/.test(tok._spanFamily)) ff = '"' + tok._spanFamily + '"';
    return `${fi}${fw} ${fs}px ${ff}`;
}
function getLineH(row, fontSize, lineHeight) {
    let maxFs = fontSize, rowLh = lineHeight;
    for (const tok of row) { const fs = tokFontSize(tok, fontSize); if (fs > maxFs) maxFs = fs; if (tok._lineHeight != null) rowLh = tok._lineHeight; }
    return maxFs * (rowLh || 1.4);
}

export function drawNodeText(ctx, node, scrollbarW = 0) {
    const p = node.properties;
    node.linkAreas = [];
    const text = p.text.replace(/\\n/g,"\n").replace(/\r\n/g,"\n").replace(/\r/g,"\n");
    const fontSize = p.fontSize || 24, uiFont = getUIFont();
    ctx.font = `${fontSize}px ${uiFont}`;
    const blocks = parseTextBlocks(text), maxW = node.size[0] - 2 * p.padding - scrollbarW;
    const lineH = fontSize * (p.lineHeight || 1.4); ctx.textBaseline = "top";
    let curY = p.padding;
    for (const block of blocks) {
        if (block.type === 'table') { curY += lineH * 0.3; curY = drawTable(ctx, block, p.padding, curY, maxW, fontSize, uiFont, p.fontColor); curY += lineH * 0.3; continue; }
        const tokens = buildTokenList(block.text), lines = wrapChars(ctx, tokens, maxW, fontSize, uiFont);
        for (let li = 0; li < lines.length; li++) {
            const row = lines[li];
            if (!row.length) { const nextRow = lines[li + 1]; curY += nextRow && nextRow[0] && (nextRow[0].isList || nextRow[0].isOrderedList) ? lineH * 0.15 : lineH; continue; }
            const rh = getLineH(row, fontSize, p.lineHeight);
            for (const tok of row) {
                if (tok._gk === undefined) {
                    const font = tokFont(tok, fontSize, p.fontWeight, uiFont);
                    tok._gk = font + '|' + (tok.link ? tok.url : '') + '|' + tok.strike + '|' + tok.code + '|' + tok.isHr + '|' + tok.isQuote + '|' + tok.quoteLevel + '|' + tok.isCodeBlock + '|' + tok.isOrderedList + '|' + tok.isListMarker + '|' + tok.isTaskList + '|' + tok.isChecked + '|' + (tok.nestLevel||0) + '|' + tok.image + '|' + tok.mark + '|' + tok.sup + '|' + tok.sub + '|' + tok.underline + '|' + (tok._spanSize||'') + '|' + (tok._spanWeight||'') + '|' + (tok._spanFamily||'') + '|' + (tok._spanColor||'') + '|' + (tok.imgStyleMaxW??'') + '|' + (tok.imgStyleH||'');
                }
            }
            const groups = []; let gi = 0;
            while (gi < row.length) {
                const key = row[gi]._gk; let gj = gi + 1;
                while (gj < row.length && row[gj]._gk === key) gj++;
                groups.push({ tok: row[gi], text: row.slice(gi, gj).map(c => c.ch).join(''), font: tokFont(row[gi], fontSize, p.fontWeight, uiFont) });
                gi = gj;
            }
            let rowImgH = 0, rowW = 0;
            for (const g of groups) { ctx.font = g.font; rowW += ctx.measureText(g.text).width; }
            let quoteBarDrawn = false, rowAlign = null;
            for (const tok of row) { if (tok.textAlign) { rowAlign = tok.textAlign; break; } }
            const ta = rowAlign || p.textAlign || 'left';
            let x = ta === "left" ? p.padding : ta === "right" ? node.size[0] - p.padding - rowW : (node.size[0] - rowW) / 2;
            for (const g of groups) {
                ctx.font = g.font; const gw = ctx.measureText(g.text).width, tok = g.tok, gfs = tokFontSize(tok, fontSize);
                if (tok.isHr) { ctx.save(); ctx.strokeStyle = hexToRGBA(p.fontColor, 0.35); ctx.lineWidth = 1; const hrY = curY + rh * 0.5; ctx.beginPath(); ctx.moveTo(p.padding, hrY); ctx.lineTo(node.size[0] - p.padding, hrY); ctx.stroke(); ctx.restore(); continue; }
                if (tok.isQuote && !quoteBarDrawn) {
                    quoteBarDrawn = true; const barW = 3, indent = (tok.quoteLevel - 1) * (barW + 8), textIndent = tok.quoteLevel * (barW + 8), barX = p.padding + indent;
                    ctx.save(); ctx.fillStyle = hexToRGBA(p.fontColor, 0.4); ctx.fillRect(barX, curY, barW, rh); ctx.restore(); x = p.padding + textIndent + barW + 6;
                }
                if ((tok.isList || tok.isOrderedList) && tok.isListMarker && (tok.nestLevel || 0) > 0 && x === p.padding) { x += (tok.nestLevel || 0) * gfs * 1.2; }
                if (tok.isCodeBlock) {
                    const codeFont = `${gfs}px "Consolas","Courier New",monospace`; ctx.font = codeFont; const cw2 = ctx.measureText(g.text).width;
                    ctx.fillStyle = "rgba(0,0,0,0.30)"; ctx.fillRect(p.padding, curY - 1, node.size[0] - 2 * p.padding, gfs + 4);
                    ctx.fillStyle = "#b5e0c8"; ctx.fillText(g.text, x, curY); x += cw2; continue;
                }
                if (tok.image) {
                    const imgEntry = loadImage(tok.url), availableW = node.size[0] - 2 * p.padding, availableH = node.size[1] - curY - p.padding;
                    if (imgEntry.loaded && imgEntry.img) {
                        const imgW = imgEntry.img.width, imgH = imgEntry.img.height;
                        let drawW, drawH, specW = tok.imgWidth, specH = tok.imgHeight;
                        if (specW != null || specH != null) {
                            const userW = specW != null ? (typeof specW === 'string' && specW.endsWith('%') ? availableW * parseFloat(specW) / 100 : parseFloat(specW)) : null;
                            const userH = specH != null ? specH : null;
                            if (userW && userH) { drawW = Math.min(userW, availableW); drawH = Math.min(userH, availableH); }
                            else if (userW) { drawW = Math.min(userW, availableW); drawH = Math.min(imgH * (drawW / imgW), availableH); }
                            else { drawH = Math.min(userH, availableH); drawW = Math.min(imgW * (drawH / imgH), availableW); }
                        } else if (tok.imgStyleH === 'auto') { drawW = Math.min(imgW, availableW); if (tok.imgStyleMaxW != null) drawW = Math.min(drawW, availableW * tok.imgStyleMaxW / 100); drawH = imgH * (drawW / imgW); }
                        else { const scale = Math.min(availableW / imgW, availableH / imgH, 1); drawW = imgW * scale; drawH = imgH * scale; }
                        let drawX = p.textAlign === "left" ? p.padding : p.textAlign === "right" ? node.size[0] - p.padding - drawW : (node.size[0] - drawW) / 2;
                        ctx.drawImage(imgEntry.img, drawX, curY, drawW, drawH); node.linkAreas.push({ x: drawX, y: curY, width: drawW, height: drawH, url: tok.url });
                        rowImgH = Math.max(rowImgH, drawH + 4); x += drawW; continue;
                    } else if (imgEntry.error) { ctx.fillStyle = "#9f7aea"; ctx.fillText(g.text, x, curY); ctx.beginPath(); ctx.moveTo(x, curY + gfs + 1); ctx.lineTo(x + gw, curY + gfs + 1); ctx.strokeStyle = "#9f7aea"; ctx.lineWidth = 1; ctx.stroke(); x += gw; continue; }
                    else { ctx.fillStyle = "#9f7aea"; ctx.fillText(g.text, x, curY); x += gw; continue; }
                } else if (tok.link) { node.linkAreas.push({ x, y: curY, width: gw, height: rh, url: tok.url }); ctx.fillStyle = "#4a9eff"; ctx.fillText(g.text, x, curY); ctx.beginPath(); ctx.moveTo(x, curY + gfs + 1); ctx.lineTo(x + gw, curY + gfs + 1); ctx.strokeStyle = "#4a9eff"; ctx.lineWidth = 1; ctx.stroke(); x += gw; continue; }
                else if (tok.isTaskList && tok.isListMarker) {
                    const boxSize = Math.round(gfs * 0.75), boxX = x, boxY = curY + (rh - boxSize) / 2;
                    ctx.save(); ctx.strokeStyle = hexToRGBA(p.fontColor, 0.7); ctx.lineWidth = Math.max(1, boxSize * 0.1); ctx.beginPath(); ctx.roundRect(boxX, boxY, boxSize, boxSize, boxSize * 0.2); ctx.stroke();
                    if (tok.isChecked) { ctx.fillStyle = "#4ade80"; ctx.beginPath(); ctx.roundRect(boxX, boxY, boxSize, boxSize, boxSize * 0.2); ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = Math.max(1.5, boxSize * 0.12); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath(); ctx.moveTo(boxX + boxSize * 0.2, boxY + boxSize * 0.5); ctx.lineTo(boxX + boxSize * 0.42, boxY + boxSize * 0.72); ctx.lineTo(boxX + boxSize * 0.8, boxY + boxSize * 0.28); ctx.stroke(); }
                    ctx.restore(); x += boxSize + gfs * 0.3; continue;
                } else if (tok.code) {
                    const codeFont = `${gfs}px "Consolas","Courier New",monospace`; ctx.font = codeFont; const cw = ctx.measureText(g.text).width, pad2 = 3;
                    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(x - pad2, curY - 1, cw + pad2*2, gfs + 4); ctx.fillStyle = "#e8c86a"; ctx.fillText(g.text, x, curY); x += cw; continue;
                } else if (tok.underline) { ctx.fillStyle = p.fontColor; ctx.fillText(g.text, x, curY); ctx.beginPath(); ctx.moveTo(x, curY + gfs + 1); ctx.lineTo(x + gw, curY + gfs + 1); ctx.strokeStyle = p.fontColor; ctx.lineWidth = Math.max(1, gfs * 0.06); ctx.stroke(); x += gw; continue; }
                else if (tok.isAbbr) { ctx.fillStyle = p.fontColor; ctx.fillText(g.text, x, curY); ctx.beginPath(); ctx.moveTo(x, curY + gfs + 1); ctx.lineTo(x + gw, curY + gfs + 1); ctx.strokeStyle = hexToRGBA(p.fontColor, 0.45); ctx.lineWidth = Math.max(1, gfs * 0.06); ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]); x += gw; continue; }
                else if (tok.mark) { const pad2 = 2; ctx.fillStyle = 'rgba(255, 220, 0, 0.35)'; ctx.fillRect(x - pad2, curY, gw + pad2 * 2, gfs * 1.15); ctx.fillStyle = '#ffe066'; ctx.fillText(g.text, x, curY); x += gw; continue; }
                else if (tok.sup) { const supFs = Math.round(gfs * 0.65); ctx.font = `${supFs}px ${uiFont}`; const supW = ctx.measureText(g.text).width; ctx.fillStyle = p.fontColor; ctx.fillText(g.text, x, curY); x += supW; continue; }
                else if (tok.sub) { const subFs = Math.round(gfs * 0.65); ctx.font = `${subFs}px ${uiFont}`; const subW = ctx.measureText(g.text).width; ctx.fillStyle = p.fontColor; ctx.fillText(g.text, x, curY + gfs * 0.35); x += subW; continue; }
                else if (tok._spanColor) { ctx.fillStyle = tok._spanColor; ctx.fillText(g.text, x, curY); if (tok.strike) { ctx.beginPath(); ctx.moveTo(x, curY + gfs * 0.55); ctx.lineTo(x + gw, curY + gfs * 0.55); ctx.strokeStyle = tok._spanColor; ctx.lineWidth = Math.max(1, gfs * 0.06); ctx.stroke(); } }
                else { const isHeadingTok = tok.isHeading; ctx.fillStyle = isHeadingTok ? lightenColor(p.fontColor, 0.25) : p.fontColor; ctx.fillText(g.text, x, curY); if (tok.strike) { ctx.beginPath(); ctx.moveTo(x, curY + gfs * 0.55); ctx.lineTo(x + gw, curY + gfs * 0.55); ctx.strokeStyle = isHeadingTok ? lightenColor(p.fontColor, 0.25) : p.fontColor; ctx.lineWidth = Math.max(1, gfs * 0.06); ctx.stroke(); } }
                x += gw;
            }
            curY += Math.max(rh, rowImgH);
        }
    }
}

export { parseTextBlocks, buildTokenList, wrapChars, measureTable };

export function drawResizeHandle(ctx, node) {
    const cv = LGraphCanvas.active_canvas, isSelected = node.selected || !!(cv?.selected_nodes?.[node.id]);
    if (!node.resizable || !isSelected) return;
    const w = node.size[0], h = node.size[1], r = node.properties?.borderRadius || 0;
    const grabSize = 20 + Math.max(0, r - 20) * 0.4, gw = Math.min(grabSize, w * 0.5), gh = Math.min(grabSize, h * 0.5);
    ctx.save(); ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.roundRect(0, 0, w, h, r); ctx.stroke(); ctx.setLineDash([]);
    const triSize = Math.min(14, gw, gh), bx = w - triSize - 2, by = h - triSize - 2;
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath(); ctx.moveTo(bx + triSize, by); ctx.lineTo(bx + triSize, by + triSize); ctx.lineTo(bx, by + triSize); ctx.closePath(); ctx.fill();
    ctx.restore();
}
