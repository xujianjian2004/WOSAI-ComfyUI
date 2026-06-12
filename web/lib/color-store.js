// ========== WOSAI NodeColor Store ==========
// 取色历史 + 自定义预设的持久化层。
// 双层策略：localStorage 即时读写（离线兜底）+ 服务端 JSON（跨浏览器共享）。
// 服务端不可用时静默降级为纯 localStorage，不影响功能。

import { api } from "../../../scripts/api.js";

const LS_RECENT = 'wosai-nodecolor-recent';
const LS_CUSTOM = 'wosai-nodecolor-custom';
const API_PATH = '/wosai/color_presets';

// 共享状态：调用方直接读写 store.recent / store.custom，改完调用 persist()
export const store = {
    recent: [],   // [{hex}]
    custom: [],   // [{hex}]
};

let _serverOk = false;       // 服务端是否可用（首次 GET 成功后置 true）
let _saveTimer = null;       // POST 防抖
let _initPromise = null;

function loadLocal() {
    try { store.recent = JSON.parse(localStorage.getItem(LS_RECENT)) || []; }
    catch (e) { store.recent = []; }
    try { store.custom = JSON.parse(localStorage.getItem(LS_CUSTOM)) || []; }
    catch (e) { store.custom = []; }
}

function saveLocal() {
    try {
        localStorage.setItem(LS_RECENT, JSON.stringify(store.recent));
        localStorage.setItem(LS_CUSTOM, JSON.stringify(store.custom));
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
                body: JSON.stringify({ version: 1, recent: store.recent, custom: store.custom }),
            });
        } catch (e) {
            console.warn('[WOSAI NodeColor] 预设服务端保存失败（已存 localStorage）:', e);
        }
    }, 400);
}

// 合并策略：服务端为主，本地独有的条目补在后面（去重，按 hex）
function mergeList(serverList, localList, cap) {
    const seen = new Set();
    const out = [];
    for (const item of [...(serverList || []), ...(localList || [])]) {
        const hex = (item?.hex || '').toUpperCase();
        if (!hex || seen.has(hex)) continue;
        seen.add(hex);
        out.push({ hex: item.hex });
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
            store.recent = mergeList(data.recent, store.recent, 12);
            store.custom = mergeList(data.custom, store.custom, 24);
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
