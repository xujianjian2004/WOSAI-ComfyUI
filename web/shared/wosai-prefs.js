// WOSAI 轻量偏好存储：基于 localStorage，键统一以 "wosai-" 前缀，与 settings.js 一致。

export function wosaiGetBool(key, def = false) {
    try {
        const v = localStorage.getItem(key);
        if (v === null || v === undefined) return def;
        return v === "1" || v === "true";
    } catch (_) {
        return def;
    }
}

export function wosaiSetBool(key, v) {
    try { localStorage.setItem(key, v ? "1" : "0"); } catch (_) {}
}

export function wosaiGetInt(key, def = 0) {
    try {
        const v = parseInt(localStorage.getItem(key), 10);
        return Number.isFinite(v) ? v : def;
    } catch (_) {
        return def;
    }
}

export function wosaiSetInt(key, v) {
    try { localStorage.setItem(key, String(v)); } catch (_) {}
}
