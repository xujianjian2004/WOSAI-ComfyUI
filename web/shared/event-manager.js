/**
 * WOSAI 全局事件管理器 - 单例模式
 * 解决多面板全局事件重复绑定和泄漏问题
 * 支持按命名空间注册/注销，并提供彻底清理 document 监听器的 destroy()
 */

// 统一存储：name -> { type, handler, active, namespace }
const _listeners = new Map();
let _installed = false;
let _keyHandler = null;     // document keydown/keyup 的实际回调引用
let _ptrHandler = null;     // document pointerdown 的实际回调引用

function _install() {
    if (_installed) return;
    _installed = true;
    _keyHandler = (e) => _dispatch(e.type, e);
    _ptrHandler = (e) => _dispatch('pointerdown', e);
    document.addEventListener('keydown', _keyHandler);
    document.addEventListener('keyup', _keyHandler);
    document.addEventListener('pointerdown', _ptrHandler);
}

function _dispatch(eventType, e) {
    for (const [, v] of _listeners) {
        if (v.active && v.type === eventType) {
            try { v.handler(e); } catch (err) { console.warn("[WOSAI EventManager] handler error:", err); }
        }
    }
}

/**
 * 注册键盘/指针事件监听器
 * @param {string} name - 唯一标识（面板名 + 事件类型）
 * @param {string} type - 'keydown' | 'keyup' | 'pointerdown'
 * @param {Function} handler - 事件处理函数
 * @param {string} [namespace] - 可选命名空间，用于批量注销
 */
export function onGlobal(name, type, handler, namespace) {
    _install();
    _listeners.set(name, { type, handler, active: true, namespace });
}

/**
 * 注销指定监听器
 * @param {string} [name] - 唯一标识；若省略且提供 namespace，则注销该命名空间下所有监听器
 * @param {string} [namespace] - 可选命名空间
 */
export function offGlobal(name, namespace) {
    if (name) {
        _listeners.delete(name);
        return;
    }
    if (namespace) {
        for (const [key, v] of _listeners) {
            if (v.namespace === namespace) _listeners.delete(key);
        }
    }
}

/**
 * 暂停/恢复指定监听器（不删除）
 * @param {string} name
 * @param {boolean} active
 */
export function setActive(name, active) {
    const v = _listeners.get(name);
    if (v) v.active = active;
}

/**
 * 注销所有监听器，或按 type + namespace 组合过滤注销
 * @param {string} [type] - 事件类型过滤
 * @param {string} [namespace] - 命名空间过滤
 */
export function offAll(type, namespace) {
    if (!type && !namespace) {
        _listeners.clear();
        return;
    }
    for (const [key, v] of _listeners) {
        const matchType = !type || v.type === type;
        const matchNs = !namespace || v.namespace === namespace;
        if (matchType && matchNs) _listeners.delete(key);
    }
}

/**
 * 彻底销毁事件管理器：清空所有监听器并移除 document 上的全局监听器
 * 销毁后仍可再次调用 onGlobal() 重新安装
 */
export function destroy() {
    offAll();
    if (!_installed) return;
    if (_keyHandler) {
        document.removeEventListener('keydown', _keyHandler);
        document.removeEventListener('keyup', _keyHandler);
        _keyHandler = null;
    }
    if (_ptrHandler) {
        document.removeEventListener('pointerdown', _ptrHandler);
        _ptrHandler = null;
    }
    _installed = false;
}

/**
 * 获取当前活跃监听器数量（调试用）
 * @returns {number}
 */
export function activeCount() {
    let n = 0;
    for (const [, v] of _listeners) if (v.active) n++;
    return n;
}
