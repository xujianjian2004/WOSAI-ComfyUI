// ========== WOSAI NodeColor Store ==========
// 取色历史 + 自定义预设的持久化层。
// 双层策略：localStorage 即时读写（离线兜底）+ 服务端 JSON（跨浏览器共享）。
// 服务端不可用时静默降级为纯 localStorage，不影响功能。

import { api } from "../../../../scripts/api.js";

const LS_RECENT       = 'wosai-nodecolor-recent';
const LS_CUSTOM       = 'wosai-nodecolor-custom';        // 旧版兼容读取用
const LS_CUSTOM_SOLID = 'wosai-nodecolor-custom-solid';
const LS_CUSTOM_GRAD2 = 'wosai-nodecolor-custom-grad2';
const LS_CUSTOM_GRAD3 = 'wosai-nodecolor-custom-grad3';
const API_PATH = '/wosai/color_presets';

// 共享状态：调用方直接读写对应列表，改完调用 persist()
// store.custom 保留为旧版兼容访问入口（读取时返回当前模式列表）
export const store = {
    recent:       [],   // [{hex}]
    customSolid:  [],   // [{type:'solid', title, bg}]
    customGrad2:  [],   // [{type:'grad2', dir, stops}]
    customGrad3:  [],   // [{type:'grad3', dir, stops}]
};

let _serverOk = false;       // 服务端是否可用（首次 GET 成功后置 true）
let _saveTimer = null;       // POST 防抖
let _initPromise = null;

// itemKey 结果缓存：同一对象引用复用已计算的稳定键，避免重复拼接/JSON.stringify
const _keyCache = new WeakMap();

function loadLocal() {
    try { store.recent = JSON.parse(localStorage.getItem(LS_RECENT)) || []; }
    catch (e) { store.recent = []; }

    // 读取三个独立列表
    try { store.customSolid = JSON.parse(localStorage.getItem(LS_CUSTOM_SOLID)) || []; }
    catch (e) { store.customSolid = []; }
    try { store.customGrad2 = JSON.parse(localStorage.getItem(LS_CUSTOM_GRAD2)) || []; }
    catch (e) { store.customGrad2 = []; }
    try { store.customGrad3 = JSON.parse(localStorage.getItem(LS_CUSTOM_GRAD3)) || []; }
    catch (e) { store.customGrad3 = []; }

    // 旧版迁移：将旧 store.custom 中的条目按类型分配到新列表（仅首次）
    if (store.customSolid.length === 0 && store.customGrad2.length === 0 && store.customGrad3.length === 0) {
        try {
            const legacy = JSON.parse(localStorage.getItem(LS_CUSTOM)) || [];
            for (const p of legacy) {
                if (p.type === 'solid')      { if (store.customSolid.length < 16) store.customSolid.push(p); }
                else if (p.type === 'grad3') { if (store.customGrad3.length < 16) store.customGrad3.push(p); }
                else if (p.type === 'grad2') { if (store.customGrad2.length < 16) store.customGrad2.push(p); }
                // 旧格式 {hex} 忽略
            }
        } catch (e) { /* 迁移失败静默忽略 */ }
    }
}

function saveLocal() {
    try {
        localStorage.setItem(LS_RECENT, JSON.stringify(store.recent));
        localStorage.setItem(LS_CUSTOM_SOLID, JSON.stringify(store.customSolid));
        localStorage.setItem(LS_CUSTOM_GRAD2, JSON.stringify(store.customGrad2));
        localStorage.setItem(LS_CUSTOM_GRAD3, JSON.stringify(store.customGrad3));
    } catch (e) { /* 隐私模式等场景忽略 */ }
}

async function fetchServer() {
    const resp = await api.fetchApi(API_PATH);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
}

function pushServer() {
    if (!_serverOk) return;
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
        _saveTimer = null;
        try {
            await api.fetchApi(API_PATH, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    version: 2,
                    recent: store.recent,
                    customSolid: store.customSolid,
                    customGrad2: store.customGrad2,
                    customGrad3: store.customGrad3,
                }),
            });
        } catch (e) {
            console.warn('[WOSAI NodeColor] 预设服务端保存失败（已存 localStorage）:', e);
        }
    }, 400);
}

// 生成条目唯一键（用于去重）
// 使用 WeakMap 缓存同一对象引用的计算结果，避免重复生成临时字符串；
// 对已知类型使用稳定字符串拼接，彻底移除 JSON.stringify 兜底。
function itemKey(item) {
    if (!item) return '';
    const cached = _keyCache.get(item);
    if (cached !== undefined) return cached;

    let key;
    // 旧格式兼容
    if (item.hex && !item.type) {
        key = item.hex.toUpperCase();
    } else if (item.type === 'solid') {
        key = `solid:${(item.title || '').toUpperCase()}:${(item.bg || '').toUpperCase()}`;
    } else if (item.type === 'grad2' || item.type === 'grad3') {
        const stops = (item.stops || []).map(s => `${(s.hex || '').toUpperCase()}:${s.p ?? 0}`).join('|');
        key = `${item.type}:${stops}:${item.dir || ''}`;
    } else {
        // 稳定兜底：按字母序拼接属性，避免 JSON.stringify 的键序不确定性与大字符串开销
        const keys = Object.keys(item).sort();
        const parts = [];
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            parts.push(`${k}=${item[k]}`);
        }
        key = parts.join('&');
    }

    _keyCache.set(item, key);
    return key;
}

// 合并策略：服务端为主，本地独有的条目补在后面（去重）
// 使用 Map 作为键->条目的缓存，O(1) 判定重复，避免临时 Set 与 O(n²) 字符串比较。
function mergeList(serverList, localList, cap) {
    const seen = new Map();
    const out = [];
    for (const list of [serverList, localList]) {
        for (const item of (list || [])) {
            const key = itemKey(item);
            if (!key || seen.has(key)) continue;
            seen.set(key, item);
            out.push(item);
            if (out.length >= cap) break;
        }
        if (out.length >= cap) break;
    }
    return out;
}

// 初始化：本地立即可用，服务端数据异步合并。幂等（重复调用复用同一 Promise）。
export function initStore() {
    if (_initPromise) return _initPromise;
    loadLocal();
    _initPromise = (async () => {
        try {
            const data = await fetchServer();
            _serverOk = true;
            store.recent       = mergeList(data.recent,       store.recent,       12);
            store.customSolid  = mergeList(data.customSolid,  store.customSolid,  16);
            store.customGrad2  = mergeList(data.customGrad2,  store.customGrad2,  16);
            store.customGrad3  = mergeList(data.customGrad3,  store.customGrad3,  16);
            saveLocal();
        } catch (e) {
            // 服务端未部署/未重启时静默降级
            _serverOk = false;
        }
        return store;
    })();
    return _initPromise;
}

// 持久化（localStorage 同步 + 服务端防抖推送）
export function persist() {
    saveLocal();
    pushServer();
}

// 取色历史：去重置顶，最多 12 条
export function addRecent(hex) {
    store.recent = store.recent.filter(p => p.hex !== hex);
    store.recent.unshift({ hex });
    if (store.recent.length > 12) store.recent.pop();
    persist();
}
