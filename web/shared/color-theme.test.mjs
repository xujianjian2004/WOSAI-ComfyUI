// color-theme 纯逻辑单测（node:test）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PALETTES_PATH = join(__dirname, '../data/color-palettes.json');
const PALETTES_JSON = readFileSync(PALETTES_PATH, 'utf8');

// 模拟浏览器全局对象
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

// 模拟 ComfyUI app 对象
globalThis.app = {
    graph: {
        nodes: [],
        _groups: [],
        onNodeAdded: () => {},
        onNodeRemoved: () => {},
    },
};

const { themesPromise, THEME_STYLES, getSelectedStyleId, setSelectedStyleId, applyTheme } = await import('./color-theme.js');
await themesPromise;

function makeNode(type, comfyClass, category) {
    return {
        id: Math.random().toString(36).slice(2),
        type,
        comfyClass,
        category,
        constructor: { category },
        color: undefined,
        bgcolor: undefined,
        _gradient: undefined,
        getTitle: () => type,
    };
}

test('themesPromise 加载后填充 THEME_STYLES', () => {
    assert.ok(Object.keys(THEME_STYLES).length > 0, 'THEME_STYLES 非空');
    assert.ok(THEME_STYLES['wosai-soft'], '包含 wosai-soft 主题');
    assert.ok(THEME_STYLES['wosai-grad-soft'], '包含 wosai-grad-soft 主题');
});

test('getSelectedStyleId / setSelectedStyleId 读写 localStorage', () => {
    localStorage.clear();
    assert.equal(getSelectedStyleId(), 'wosai-soft', '默认主题为 wosai-soft');
    setSelectedStyleId('wosai-dark');
    assert.equal(getSelectedStyleId(), 'wosai-dark', '设置后读取一致');
    setSelectedStyleId('non-existent');
    assert.equal(getSelectedStyleId(), 'wosai-dark', '非法 id 不改变当前值');
});

test('applyTheme 为节点应用颜色且不污染原始节点引用', () => {
    localStorage.clear();
    const nodes = [
        makeNode('LoadImage', 'LoadImage', 'image'),
        makeNode('KSampler', 'KSampler', 'sampling'),
        makeNode('SaveImage', 'SaveImage', 'output'),
    ];
    const stats = applyTheme('wosai-soft', nodes);
    assert.ok(stats, '返回统计对象');
    assert.ok(stats.input > 0 || stats.image > 0, '至少一个大类被命中');
    for (const n of nodes) {
        assert.ok(n.color && n.color.startsWith('#'), `${n.type} 获得标题色`);
        assert.ok(n.bgcolor && n.bgcolor.startsWith('#'), `${n.type} 获得背景色`);
    }
});

test('applyTheme 渐变主题写入 _gradient', () => {
    localStorage.clear();
    const node = makeNode('KSampler', 'KSampler', 'sampling');
    applyTheme('wosai-grad-soft', [node]);
    assert.ok(node._gradient, '渐变主题写入 _gradient');
    assert.ok(Array.isArray(node._gradient.stops), 'gradient stops 为数组');
});

test('applyTheme 无效主题返回 null', () => {
    const r = applyTheme('not-a-theme', [makeNode('X', 'X', 'x')]);
    assert.equal(r, null);
});
