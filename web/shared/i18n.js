/**
 * WOSAI i18n 辅助模块
 * 统一从 locales 加载语言包，提供 t() 翻译函数。
 *
 * 语言包分层（与规范一致）：
 *   locales/{lang}/common.json  — 公共词条
 *   locales/{lang}/nodes.json   — 节点定义
 *   locales/{lang}/widgets.json — 控件组件
 *   locales/{lang}/menus.json   — 菜单弹窗
 *
 * 键名规范：小驼峰，语义清晰，禁止拼音简写。
 */
// 动态导入 ComfyUI app 对象：在测试环境或旧版 ComfyUI 中可能不存在，回退到全局 app。
let app = (typeof globalThis !== 'undefined' && globalThis.app) ? globalThis.app : null;

import { STORAGE_KEYS } from "./constants.js";
try {
    const mod = await import("../../../../scripts/app.js");
    app = mod.app || mod.default || app;
} catch (e) {
    /* 非浏览器环境或 ComfyUI 旧版本：使用全局 app 或保持 null */
}

const DEFAULT_LANG = "zh";
const SUPPORTED_LANGS = ["zh", "en"];
const LAYERS = ["common", "nodes", "widgets", "menus", "settings", "main", "nodeDefs", "saveNode", "saveText"];

let _currentLang = DEFAULT_LANG;
let _dict = {};
let _loaded = false;
let _loadingPromise = null;
const _langChangeCbs = [];

// 双语展示名缓存：同时加载 zh / en 两份 nodeDefs.json，供搜索别名注入使用。
// 结构：{ [节点类型]: { zh: "中文显示名", en: "English display" } }
// 与当前 UI 语言无关，确保任意语言下都能用中/英两种名称检索到节点。
let _bilingualDisplayNames = {};

/**
 * 将 ComfyUI / 浏览器 / 用户自定义的语言标识统一为 WOSAI 支持的 "zh" 或 "en"。
 * 兼容值：zh / zh-CN / zh-TW / Chinese / 中文 / en / en-US / en-GB / English / English (US) 等
 */
function normalizeLang (lang) {
    if (!lang || typeof lang !== "string") return DEFAULT_LANG;
    const raw = lang.trim();
    const lower = raw.toLowerCase();
    // 直接匹配
    if (SUPPORTED_LANGS.includes(lower)) return lower;
    // 处理区域变体：zh-CN / en-US 等
    if (lower.startsWith("zh") || lower === "chinese" || raw.includes("\u4e2d\u6587") || raw.includes("\u7b80\u4f53") || raw.includes("\u7e41\u4f53")) return "zh";
    if (lower.startsWith("en") || lower === "english") return "en";
    return DEFAULT_LANG;
}

function _getLangFromSettingValues () {
    const sv = app?.ui?.settings?.settingValues;
    if (!sv) return null;
    return sv["Comfy.Locale"] || sv["Comfy.locale"] || sv["language"] || sv["lang"] || null;
}

function _getLangFromSettingsDefs () {
    try {
        const defs = app?.ui?.settings?.settings;
        if (Array.isArray(defs)) {
            const loc = defs.find(s => s.id === 'Comfy.Locale');
            if (loc) return loc.value || loc.defaultValue || null;
        }
    } catch (_) {}
    return null;
}

function _getLangFromLocalStorage () {
    try {
        if (typeof localStorage === "undefined") return null;
        // Check various possible localStorage keys ComfyUI might use
        const keys = ["Comfy.Locale", "Comfy.locale", "comfy_locale", STORAGE_KEYS.lang, "language"];
        for (const key of keys) {
            const v = localStorage.getItem(key);
            if (v) return v;
        }
    } catch (_) {}
    return null;
}

function _getLangFromComfyUI () {
    try {
        // Some ComfyUI builds expose locale directly on the app or API object
        if (app?.locale) return app.locale;
        if (app?.ui?.locale) return app.ui.locale;
        // Check window.comfyAPI
        if (typeof window !== 'undefined' && window.comfyAPI) {
            const api = window.comfyAPI;
            if (api.app?.app?.locale) return api.app.app.locale;
            if (api.settings?.ComfySettingsDialog?.prototype) {
                // Try to get from the settings singleton
                const dlg = app?.ui?.settings;
                if (dlg && typeof dlg.getSettingValue === 'function') {
                    const v = dlg.getSettingValue('Comfy.Locale');
                    if (v) return v;
                }
                if (dlg && typeof dlg.get === 'function') {
                    const v = dlg.get('Comfy.Locale');
                    if (v) return v;
                }
            }
        }
    } catch (_) {}
    return null;
}

export function detectLang () {
    let comfyLang;
    // 1. ComfyUI settingValues（标准存储路径）
    comfyLang = _getLangFromSettingValues();
    if (comfyLang) return normalizeLang(comfyLang);
    // 2. ComfyUI settings definitions（v1.36+ store pattern）
    comfyLang = _getLangFromSettingsDefs();
    if (comfyLang) return normalizeLang(comfyLang);
    // 3. ComfyUI app/locale direct properties or API
    comfyLang = _getLangFromComfyUI();
    if (comfyLang) return normalizeLang(comfyLang);
    // 4. localStorage（多种可能键名）
    comfyLang = _getLangFromLocalStorage();
    if (comfyLang) return normalizeLang(comfyLang);
    // 5. 浏览器语言
    if (typeof navigator !== "undefined") {
        const nav = (navigator.language || navigator.userLanguage || DEFAULT_LANG).toLowerCase();
        return normalizeLang(nav);
    }
    return DEFAULT_LANG;
}

async function loadLayer (lang, layer) {
    try {
        const url = new URL(`../locales/${lang}/${layer}.json`, import.meta.url);
        const res = await fetch(url, { cache: "no-cache" });
        if (!res.ok) return {};
        return await res.json();
    } catch (e) {
        return {};
    }
}

async function _doInit (overrideLang) {
    if (_loaded) return;
    const lang = overrideLang || detectLang();
    _currentLang = SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG;

    // 增量构建新字典，加载完成后再原子替换 _dict。
    // 这样语言切换（setLang）期间 t() 仍返回“上一语言”的译文，而非空字典，
    // 避免 _dict 被清空瞬间调用方拿到原始 key（如 common.menu.save）造成界面闪烁。
    const newDict = {};
    for (const layer of LAYERS) {
        const data = await loadLayer(_currentLang, layer);
        Object.assign(newDict, flatten(data, layer));
    }
    _dict = newDict;
    try { localStorage.setItem(STORAGE_KEYS.lang, _currentLang); } catch (_) {}
    // 预加载双语展示名（与当前语言无关），供搜索别名注入使用
    await _loadBilingualNodeDefs();
    _loaded = true;
    try { _refreshNodeDefs(); } catch (_) {}
    _loadingPromise = null;
}

/**
 * 同时加载 zh / en 两份 nodeDefs.json，提取每个节点类型的 display_name，
 * 缓存到 _bilingualDisplayNames，供 applyNodeDefTranslation 注入搜索别名。
 * 单语言加载失败不影响另一语言。
 */
async function _loadBilingualNodeDefs () {
    const out = {};
    for (const lang of SUPPORTED_LANGS) {
        try {
            const res = await fetch(new URL(`../locales/${lang}/nodeDefs.json`, import.meta.url), { cache: "no-cache" });
            if (!res.ok) continue;
            const data = await res.json();
            for (const [type, def] of Object.entries(data)) {
                if (def && def.display_name) {
                    if (!out[type]) out[type] = {};
                    out[type][lang] = def.display_name;
                }
            }
        } catch (_) { /* 单语言加载失败不影响整体 */ }
    }
    _bilingualDisplayNames = out;
}

export async function initI18N (overrideLang) {
    if (_loaded) return;
    if (_loadingPromise) return _loadingPromise;
    _loadingPromise = _doInit(overrideLang);
    return _loadingPromise;
}

function flatten (obj, prefix) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === "object" && !Array.isArray(v)) {
            Object.assign(out, flatten(v, key));
        } else {
            out[key] = v;
        }
    }
    return out;
}

export function t (key, fallback) {
    const v = _dict[key];
    if (v !== undefined && v !== null) return String(v);
    if (fallback !== undefined) return fallback;
    return key;
}

export function getCurrentLang () {
    return _currentLang;
}

/**
 * 注册语言切换回调。
 * @param {Function} cb — 回调函数，参数 { lang }
 * @returns {Function} 注销函数
 */
export function onLangChange (cb) {
    if (!_langChangeCbs.includes(cb)) _langChangeCbs.push(cb);
    return () => offLangChange(cb);
}

export function offLangChange (cb) {
    const i = _langChangeCbs.indexOf(cb);
    if (i >= 0) _langChangeCbs.splice(i, 1);
}

function _refreshNodeDefs () {
    const defs = _dict;
    if (!defs || typeof window === "undefined") return;

    // 收集 nodeDefs 节点标题翻译
    const nodeTitles = {};
    const nodeDescriptions = {};
    const nodeCategories = {};
    for (const key of Object.keys(defs)) {
        if (!key.startsWith("nodeDefs.")) continue;
        const parts = key.split(".");
        if (parts.length < 3) continue;
        const type = parts[1];
        const field = parts[2];
        if (field === "display_name" && defs[key]) {
            nodeTitles[type] = defs[key];
        }
        if (field === "description" && defs[key]) {
            nodeDescriptions[type] = defs[key];
        }
        if (field === "category" && defs[key]) {
            nodeCategories[type] = defs[key];
        }
    }

    // 1) 更新 LiteGraph 节点类型标题（影响新创建的节点）
    if (window.LiteGraph) {
        for (const [type, title] of Object.entries(nodeTitles)) {
            const nodeType = window.LiteGraph.registered_node_types[type];
            if (nodeType) nodeType.title = title;
        }
    }

    // 2) 更新已创建的节点实例标题（影响画布上已放置的节点）
    //    端口翻译由 applyNodePortTranslation() 负责（名称直接查找，不受过滤影响）
    if (app && app.graph && app.graph._nodes) {
        for (const node of app.graph._nodes) {
            const title = nodeTitles[node.type];
            if (title) node.title = title;
            const category = nodeCategories[node.type];
            if (category) node.category = category;
            applyNodeInstanceTranslation(node);
        }
    }

    // 3) 更新搜索节点定义描述。ComfyUI 的节点搜索从 nodeDefs.description 读取摘要，
    //    因此语言切换时也必须同步该字段，而不只更新画布标题。
    if (app?.nodeDefs) {
        for (const [type, description] of Object.entries(nodeDescriptions)) {
            if (app.nodeDefs[type]) app.nodeDefs[type].description = description;
        }
        for (const [type, category] of Object.entries(nodeCategories)) {
            if (app.nodeDefs[type]) app.nodeDefs[type].category = category;
        }
    }
}

// ── 纯前端 LiteGraph 节点类的语言刷新注册表 ──────────────────────
// 部分自定义节点（如 TitleNote）通过 LiteGraph.registerNodeType 直接注册，
// 其 .title 与属性面板 "@xxx".title 在模块顶层用 t() 一次性求值后固化为静态
// 字符串，语言切换（setLang）时 _dict 虽已更新，但这些静态字符串不会自动
// 重新翻译。此处提供统一注册机制，在语言切换时批量重新求值刷新。
const _localizedNodeClasses = new Set();

/**
 * 注册一个纯前端 LiteGraph 节点类，使其 .title 能在语言切换时自动重新翻译。
 * @param {Function} NodeClass — 节点类（构造函数），需已设置 .type
 * @param {string} [titleKey] — 节点标题对应的 i18n key
 */
export function registerLocalizedNode (NodeClass, titleKey) {
    if (!NodeClass) return;
    if (titleKey) NodeClass._i18nTitleKey = titleKey;
    _localizedNodeClasses.add(NodeClass);
}

/**
 * 包装一个节点属性面板定义对象（如 TitleNoteNode["@fontSize"]），
 * 记录其 title 字段对应的 i18n key，供语言切换时重新翻译刷新。
 * @param {Object} def — 属性定义对象（如 { type, title, default, ... }），直接修改并返回
 * @param {string} key — i18n key
 * @returns {Object} 传入的 def（便于链式赋值）
 */
export function localizedProp (def, key) {
    if (def) { def.title = t(key, def.title); def._i18nKey = key; }
    return def;
}

function _refreshLocalizedNodeClasses () {
    if (typeof window === "undefined") return;
    for (const NodeClass of _localizedNodeClasses) {
        try {
            // 1) 节点标题：同步 LiteGraph 注册表 / ComfyUI nodeDefs
            if (NodeClass._i18nTitleKey) {
                const newTitle = t(NodeClass._i18nTitleKey, NodeClass.title);
                NodeClass.title = newTitle;

                // title_mode === NO_TITLE 的节点（如 TitleNote）本就不显示标题栏。
                // Nodes 2.0（Vue 驱动的 DOM 覆盖层）会监听 app.nodeDefs[type].display_name，
                // 一旦变化就重建该节点类型所有实例的 DOM 卡片，导致自定义 DOM 覆盖层
                // （如 _domTextEl）引用失效、界面渲染错乱，需刷新页面才恢复。因此对
                // 这类节点，运行时只更新类静态 title（供新建节点使用），不动
                // registered_node_types.title / nodeDefs.display_name / 已有实例 .title。
                const hasVisibleTitle = NodeClass.title_mode !== window.LiteGraph?.NO_TITLE;
                if (hasVisibleTitle) {
                    const regType = window.LiteGraph?.registered_node_types?.[NodeClass.type];
                    if (regType) regType.title = newTitle;
                    if (app?.nodeDefs?.[NodeClass.type]) app.nodeDefs[NodeClass.type].display_name = newTitle;

                    if (app?.graph?._nodes) {
                        for (const node of app.graph._nodes) {
                            if (node.constructor === NodeClass) node.title = newTitle;
                        }
                    }
                }
            }
            // 2) 属性面板 "@xxx".title：仅刷新带 _i18nKey 标记的定义
            for (const key of Object.keys(NodeClass)) {
                if (key.charCodeAt(0) !== 64 /* '@' */) continue;
                const prop = NodeClass[key];
                if (prop && prop._i18nKey) prop.title = t(prop._i18nKey, prop.title);
            }
        } catch (_) {
            // 单个节点类刷新失败不应影响其它节点类 / 后续语言切换广播流程
        }
    }
    try { app?.graph?.setDirtyCanvas?.(true, true); } catch (_) {}
}

/**
 * 在 beforeRegisterNodeDef 中注入节点 display_name 翻译，并写入双语搜索别名。
 * @param {Object} nodeData — ComfyUI 节点定义对象（会被修改）
 */
export function applyNodeDefTranslation (nodeData) {
    if (!nodeData?.name) return;
    const type = nodeData.name;
    const key = `nodeDefs.${type}.display_name`;
    const title = _dict[key];
    if (title) {
        nodeData.display_name = title;
        // 同步更新 ComfyUI 内部缓存（如果已存在）
        if (app && app.nodeDefs && app.nodeDefs[type]) {
            app.nodeDefs[type].display_name = title;
        }
    }

    const descriptionKey = `nodeDefs.${type}.description`;
    const description = _dict[descriptionKey];
    if (description) {
        nodeData.description = description;
        if (app && app.nodeDefs && app.nodeDefs[type]) {
            app.nodeDefs[type].description = description;
        }
    }

    const categoryKey = `nodeDefs.${type}.category`;
    const category = _dict[categoryKey];
    if (category) {
        nodeData.category = category;
        if (app && app.nodeDefs && app.nodeDefs[type]) {
            app.nodeDefs[type].category = category;
        }
    }

    // ── i18n 搜索别名（语言无关）──────────────────────────────────
    // 前端节点搜索 Fuse 索引字段为 name / display_name / search_aliases，
    // 数据源是前端 nodeDefs 内存对象。display_name 随 UI 语言切换（中文包含双语、
    // 英文包仅英文），若只靠 display_name，切到英文后中文名将不可检索。
    // 因此此处注入中英文双语别名：无论当前 UI 是什么语言，中文或英文都能搜到该节点。
    const bi = _bilingualDisplayNames[type];
    if (bi) {
        const aliases = new Set();
        if (bi.zh) aliases.add(bi.zh);
        if (bi.en) aliases.add(bi.en);
        aliases.add(type); // 内部类型名，如 WOSAI_OmniSlider
        const aliasArr = Array.from(aliases);
        nodeData.search_aliases = aliasArr;
        if (app && app.nodeDefs && app.nodeDefs[type]) {
            app.nodeDefs[type].search_aliases = aliasArr;
        }
    }
}

function _resolveStablePortName(type, section, port) {
    if (port._wosaiOrigName != null) return port._wosaiOrigName;
    const current = port.name;
    const prefix = `nodeDefs.${type}.${section}.`;
    // 兼容旧版已经把本地化名称写进 port.name 的存量节点。
    for (const key of Object.keys(_dict)) {
        if (!key.startsWith(prefix) || !key.endsWith(".name") || _dict[key] !== current) continue;
        return key.slice(prefix.length, -5);
    }
    return current;
}

/**
 * 翻译已创建节点实例的端口标签，同时保持 port.name 为后端稳定内部名。
 * 使用名称直接查找（而非索引匹配），不受 node.inputs 过滤影响。
 * @param {Object} node — LiteGraph 节点实例
 */
export function applyNodePortTranslation (node) {
    if (!node?.type) return;
    const type = node.type;
    for (const [ports, section] of [[node.inputs, "inputs"], [node.outputs, "outputs"]]) {
        if (!ports) continue;
        for (const port of ports) {
            port._wosaiOrigName = _resolveStablePortName(type, section, port);
            const key = `nodeDefs.${type}.${section}.${port._wosaiOrigName}.name`;
            const trans = _dict[key];
            if (trans) port.label = String(trans);
            if (port.name !== port._wosaiOrigName) port.name = port._wosaiOrigName;
        }
    }
}

/**
 * Apply current-language labels to all visible parts of a WOSAI node instance.
 * Classic and Nodes 2.0 can read from ports, widgets, or both.
 */
export function applyNodeInstanceTranslation (node) {
    if (!node?.type?.startsWith?.("WOSAI_")) return;
    applyNodePortTranslation(node);
    if (!Array.isArray(node.widgets)) return;
    for (const widget of node.widgets) {
        if (!widget || typeof widget.name !== "string") continue;
        if (widget._wosaiOrigName == null) widget._wosaiOrigName = widget.name;
        const key = `nodeDefs.${node.type}.inputs.${widget._wosaiOrigName}.name`;
        const translated = _dict[key];
        if (translated) {
            // Keep widget.name stable: workflow serialization and extension code
            // use the original input key to find widgets across language changes.
            widget.label = String(translated);
        }
    }
}

function _installNodeInstanceTranslation (nodeType) {
    const proto = nodeType?.prototype;
    if (!proto || proto.__wosaiI18nInstanceWrapped) return;
    proto.__wosaiI18nInstanceWrapped = true;
    const originalCreated = proto.onNodeCreated;
    const originalConfigure = proto.onConfigure;
    proto.onNodeCreated = function (...args) {
        const result = originalCreated?.apply(this, args);
        applyNodeInstanceTranslation(this);
        return result;
    };
    proto.onConfigure = function (...args) {
        const result = originalConfigure?.apply(this, args);
        applyNodeInstanceTranslation(this);
        return result;
    };
}

function _syncLangToComfySettings (lang) {
    try {
        const sv = app?.ui?.settings?.settingValues;
        if (sv && sv["Comfy.Locale"] !== lang) {
            sv["Comfy.Locale"] = lang;
        }
        // v1.36+: also update settings array if available
        const defs = app?.ui?.settings?.settings;
        if (Array.isArray(defs)) {
            const entry = defs.find(s => s.id === 'Comfy.Locale');
            if (entry) entry.value = lang;
        }
    } catch (_) {}
}

export async function setLang (lang) {
    const next = normalizeLang(lang);
    if (next === _currentLang && _loaded) return next;
    _currentLang = next;
    if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEYS.lang, _currentLang);
    }
    _loaded = false;
    _loadingPromise = null;
    await initI18N(_currentLang);
    // 同步回 ComfyUI 设置，保持双向一致
    _syncLangToComfySettings(_currentLang);
    // 更新 LiteGraph 节点定义翻译（后端 Python 节点，走 nodeDefs.* 命名空间）
    try { _refreshNodeDefs(); } catch (_) {}
    // 更新纯前端 LiteGraph 节点类的静态 title / 属性面板标题（如 TitleNote）
    // 二者均需兜底 try/catch：任何一处刷新失败都不应阻断下面的语言切换事件广播，
    // 否则依赖 onLangChange 的其它 UI（hub-bar/color-bar/settings 等）也会跟着失效。
    try { _refreshLocalizedNodeClasses(); } catch (_) {}
    // 广播语言切换事件，UI 组件可监听后重新渲染文本
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("wosai-lang-change", { detail: { lang: _currentLang } }));
        // 调用已注册的回调
        for (const cb of _langChangeCbs) {
            try { cb({ lang: _currentLang }); } catch (_) {}
        }
    }
    return _currentLang;
}

// 监听 ComfyUI 设置中的语言变化：优先订阅事件，并包装设置写入入口。
let _watcherStarted = false;
let _langStorageHandler = null;
let _langSettingsHandler = null;
let _originalSetSettingValue = null;
let _wrappedSetSettingValue = null;
let _settingsOwner = null;

function _getComfyLang () {
    let lang = _getLangFromSettingValues();
    if (lang) return lang;
    lang = _getLangFromSettingsDefs();
    if (lang) return lang;
    lang = _getLangFromComfyUI();
    if (lang) return lang;
    return undefined;
}

export function startLangWatcher () {
    if (_watcherStarted || typeof window === "undefined") return;
    _watcherStarted = true;
    const refresh = () => {
        const lang = _getComfyLang();
        if (lang) setLang(lang);
    };
    _langStorageHandler = (event) => {
        if (event.key === STORAGE_KEYS.lang || event.key === "Comfy.Locale" || event.key === "Comfy.locale") refresh();
    };
    window.addEventListener("storage", _langStorageHandler);
    _langSettingsHandler = refresh;
    window.addEventListener("comfy:settings-changed", _langSettingsHandler);

    const settings = app?.ui?.settings;
    if (settings?.addEventListener) settings.addEventListener("change", _langSettingsHandler);
    if (settings && typeof settings.setSettingValue === "function") {
        _settingsOwner = settings;
        _originalSetSettingValue = settings.setSettingValue;
        _wrappedSetSettingValue = function (id, value, ...rest) {
            const result = _originalSetSettingValue.call(this, id, value, ...rest);
            if (["Comfy.Locale", "Comfy.locale", "language", "lang"].includes(id)) queueMicrotask(refresh);
            return result;
        };
        settings.setSettingValue = _wrappedSetSettingValue;
    }
    refresh();
}

export function stopLangWatcher () {
    if (_langStorageHandler) window.removeEventListener("storage", _langStorageHandler);
    if (_langSettingsHandler) {
        window.removeEventListener("comfy:settings-changed", _langSettingsHandler);
        _settingsOwner?.removeEventListener?.("change", _langSettingsHandler);
    }
    if (_settingsOwner?.setSettingValue === _wrappedSetSettingValue && _originalSetSettingValue) {
        _settingsOwner.setSettingValue = _originalSetSettingValue;
    }
    _langStorageHandler = null;
    _langSettingsHandler = null;
    _originalSetSettingValue = null;
    _wrappedSetSettingValue = null;
    _settingsOwner = null;
    _watcherStarted = false;
}

// 模块加载时立即完成初始化：依赖本模块的 UI 在调用 t() 时已有完整字典。
try { await initI18N(); } catch (e) { console.warn("[WOSAI i18n] initI18N failed, using default lang:", e); }
try { startLangWatcher(); } catch (e) { console.warn("[WOSAI i18n] startLangWatcher failed:", e); }

// ── 集中式节点搜索别名注入 ─────────────────────────────────────
// 保证所有 WOSAI_ 节点（含未在各自扩展中调用 applyNodeDefTranslation 的节点，
// 如 TitleNote）都能获得中英文双语搜索别名，且对未来新增节点自动生效。
// 与节点各自扩展里已有的 applyNodeDefTranslation 调用幂等共存。
if (app && typeof app.registerExtension === "function") {
    app.registerExtension({
        name: "WOSAI.NodeSearchI18n",
        async beforeRegisterNodeDef (nodeType, nodeData) {
            if (nodeData?.name?.startsWith("WOSAI_")) {
                applyNodeDefTranslation(nodeData);
                _installNodeInstanceTranslation(nodeType);
            }
        },
        remove () {
            stopLangWatcher();
        },
    });
}
