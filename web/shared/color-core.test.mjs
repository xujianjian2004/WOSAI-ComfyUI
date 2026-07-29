// color-core 纯逻辑单测（node:test）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PALETTES_PATH = join(__dirname, '../data/color-palettes.json');
const PALETTES_JSON = readFileSync(PALETTES_PATH, 'utf8');

// 模拟浏览器全局对象，使 i18n.js / color-core.js 在非浏览器环境可加载
globalThis.localStorage = {
    _store: new Map(),
    getItem(k) { return this._store.get(k) ?? null; },
    setItem(k, v) { this._store.set(k, String(v)); },
    removeItem(k) { this._store.delete(k); },
    clear() { this._store.clear(); },
};
try {
    globalThis.navigator = { language: 'zh-CN' };
} catch (_) {
    Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true, writable: true });
}

// 拦截 fetch：color-palettes.json 直接返回本地文件；语言包返回空对象。
const _origFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('color-palettes.json')) {
        return { ok: true, json: async () => JSON.parse(PALETTES_JSON) };
    }
    if (u.includes('/locales/')) {
        return { ok: true, json: async () => ({}) };
    }
    if (_origFetch) return _origFetch(url);
    return { ok: false, status: 404, json: async () => ({}) };
};

const {
    hsv2hex, hex2hsv, deriveDarkBg, deriveMidStop, randomHSV,
    cssGradientDir, sharpGradientCSS, palettesPromise, SOLID_PRESETS,
} = await import('./color-core.js');

await palettesPromise;

function assertSimilar(a, b, msg, eps = 1) {
    assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
}

test('hsv2hex / hex2hsv 互逆', () => {
    const cases = [
        { h: 0, s: 100, v: 100 },   // 红
        { h: 120, s: 100, v: 100 }, // 绿
        { h: 240, s: 100, v: 100 }, // 蓝
        { h: 0, s: 0, v: 50 },      // 灰
        { h: 30, s: 80, v: 70 },    // 棕橙
    ];
    for (const c of cases) {
        const hex = hsv2hex(c.h, c.s, c.v);
        assert.ok(/^#[0-9A-Fa-f]{6}$/.test(hex), `hsv2hex 输出合法 HEX: ${hex}`);
        const hsv = hex2hsv(hex);
        assertSimilar(hsv.h, c.h, `色相回逆 ${JSON.stringify(c)}`, 2);
        assertSimilar(hsv.s, c.s, `饱和度回逆 ${JSON.stringify(c)}`, 2);
        assertSimilar(hsv.v, c.v, `明度回逆 ${JSON.stringify(c)}`, 2);
    }
});

test('deriveDarkBg 降低明度并提升饱和度', () => {
    const d = deriveDarkBg(200, 60, 80);
    assert.equal(d.h, 200);
    assert.ok(d.s >= 60 && d.s <= 100, '饱和度提升或封顶');
    assert.ok(d.v < 80 && d.v >= 8, '明度降低且不小于下限 8');
});

test('deriveMidStop 产生中间 stop', () => {
    const s0 = { h: 0, s: 80, v: 80 };
    const s1 = { h: 60, s: 60, v: 60 };
    const m = deriveMidStop(s0, s1);
    assert.equal(typeof m.h, 'number');
    assert.equal(typeof m.s, 'number');
    assert.equal(typeof m.v, 'number');
    assert.ok(m.h >= 0 && m.h < 360, '色相在 0~360 内');
    assert.ok(m.s <= 100 && m.v <= 100, 'S/V 不越界');
});

test('randomHSV 默认范围约束', () => {
    for (let i = 0; i < 20; i++) {
        const c = randomHSV();
        assert.ok(c.h >= 0 && c.h < 360, `h 在范围: ${c.h}`);
        assert.ok(c.s >= 45 && c.s <= 90, `s 在默认范围: ${c.s}`);
        assert.ok(c.v >= 35 && c.v <= 80, `v 在默认范围: ${c.v}`);
    }
});

test('cssGradientDir 方向映射', () => {
    assert.equal(cssGradientDir('↓'), 'to bottom');
    assert.equal(cssGradientDir('→'), 'to right');
    assert.equal(cssGradientDir('↘'), 'to bottom right');
    assert.equal(cssGradientDir('?'), 'to bottom');
});

test('sharpGradientCSS 生成硬边渐变', () => {
    const css = sharpGradientCSS('to right', [{ hex: '#ff0000', p: 0 }, { hex: '#00ff00', p: 1 }]);
    assert.ok(css.startsWith('linear-gradient(to right,'), '包含方向前缀');
    assert.ok(css.includes('#ff0000'), '包含起始色');
    assert.ok(css.includes('#00ff00'), '包含终止色');
});

test('palettesPromise 加载后填充 SOLID_PRESETS', () => {
    assert.ok(SOLID_PRESETS.length > 0, 'SOLID_PRESETS 已被填充');
    assert.ok(SOLID_PRESETS.some(p => p.key === 'red'), '包含 red 预设');
});
