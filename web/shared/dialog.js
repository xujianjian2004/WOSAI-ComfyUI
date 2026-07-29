// web/shared/dialog.js
// 共享对话框工厂：统一 overlay / footer / 关闭 / ESC / Enter / 点击外部 行为，
// 消除各扩展中近似重复的弹窗骨架（原先散落在 save-node / menu-hide / settings /
// visual-fx 等文件）。新增弹窗请优先使用本模块，逐步替换历史实现。
//
// confirmDialog 返回 Promise<boolean>；promptDialog 返回
// Promise<{ confirmed: boolean, el: HTMLElement }>，业务事件由 onMount 自行绑定。

let _dialogDepth = 0;

function _teardown(overlay, resolve, result) {
    overlay.remove();
    _dialogDepth = Math.max(0, _dialogDepth - 1);
    document.body.classList.toggle("wosai-dialog-open", _dialogDepth > 0);
    resolve(result);
}

function _mount(overlay, dlg) {
    document.body.appendChild(overlay);
    overlay.appendChild(dlg);
    _dialogDepth += 1;
    document.body.classList.toggle("wosai-dialog-open", _dialogDepth > 0);
}

/**
 * 简单确认对话框。
 * @param {Object} [opts]
 * @param {string} [opts.message] 提示文本（已信任内容；含用户输入请先转义）
 * @param {string} [opts.okText]
 * @param {string} [opts.cancelText]
 * @param {(dlg: HTMLElement) => void} [opts.onMount] 挂载后的定位/额外绑定钩子
 * @returns {Promise<boolean>}
 */
export function confirmDialog(opts = {}) {
    const { message = "", okText = "确定", cancelText = "取消", onMount } = opts;
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "ws-dialog-overlay";
        const dlg = document.createElement("div");
        dlg.className = "ws-dialog wosai-panel wosai-panel--glass ws-confirm-dialog";
        dlg.setAttribute("data-wosai-panel", "");
        dlg.innerHTML = `
            <div class="ws-dialog-body" style="padding:var(--ws-gap-lg);color:var(--ws-text);font-size:var(--ws-text-md)"><p class="ws-confirm-text">${message}</p></div>
            <div class="ws-dialog-footer">
                <button class="wosai-btn" id="ws-confirm-cancel">${cancelText}</button>
                <button class="wosai-btn wosai-btn--primary" id="ws-confirm-ok">${okText}</button>
            </div>`;
        _mount(overlay, dlg);
        const close = (result) => _teardown(overlay, resolve, result);
        dlg.querySelector("#ws-confirm-ok").addEventListener("click", () => close(true));
        dlg.querySelector("#ws-confirm-cancel").addEventListener("click", () => close(false));
        dlg.addEventListener("mousedown", (e) => e.stopPropagation());
        const onOutside = (e) => { if (!dlg.contains(e.target)) close(false); };
        setTimeout(() => document.addEventListener("pointerdown", onOutside, { once: true, capture: true }), 0);
        dlg.tabIndex = -1;
        dlg.addEventListener("keydown", (e) => {
            if (e.key === "Escape") close(false);
            else if (e.key === "Enter") close(true);
        });
        if (typeof onMount === "function") onMount(dlg);
        setTimeout(() => dlg.querySelector("#ws-confirm-ok").focus(), 0);
    });
}

/**
 * 带自定义内容的对话框（输入 / 选择等）。
 * @param {Object} [opts]
 * @param {string} [opts.title]
 * @param {string} [opts.bodyHTML] 自定义内容 HTML（含用户输入请先转义）
 * @param {string} [opts.okText]
 * @param {string} [opts.cancelText]
 * @param {(dlg: HTMLElement, close: (confirmed: boolean) => void) => void} [opts.onMount]
 *   必填：自行绑定业务事件与「确定」按钮（如「校验通过才可关闭」）。
 *   不传 onMount 时「确定」按钮直接关闭并返回 confirmed=true。
 * @returns {Promise<{ confirmed: boolean, el: HTMLElement }>}
 */
export function promptDialog(opts = {}) {
    const { title = "", bodyHTML = "", okText = "确定", cancelText = "取消", onMount } = opts;
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "ws-dialog-overlay";
        const dlg = document.createElement("div");
        dlg.className = "ws-dialog wosai-panel wosai-panel--glass";
        dlg.setAttribute("data-wosai-panel", "");
        dlg.innerHTML = `
            <div class="ws-dialog-title">${title}</div>
            <div class="ws-dialog-body">${bodyHTML}</div>
            <div class="ws-dialog-footer">
                <button class="wosai-btn" id="ws-dlg-cancel">${cancelText}</button>
                <button class="wosai-btn wosai-btn--primary" id="ws-dlg-ok">${okText}</button>
            </div>`;
        _mount(overlay, dlg);
        const close = (confirmed) => _teardown(overlay, resolve, { confirmed, el: dlg });
        dlg.querySelector("#ws-dlg-cancel").addEventListener("click", () => close(false));
        overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(false); });
        if (typeof onMount === "function") {
            onMount(dlg, close);
        } else {
            dlg.querySelector("#ws-dlg-ok").addEventListener("click", () => close(true));
        }
        setTimeout(() => dlg.querySelector("#ws-dlg-ok")?.focus(), 0);
    });
}
