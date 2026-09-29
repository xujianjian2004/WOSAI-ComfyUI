/**
 * 滚轮转发：让节点内 DOM widget 不吞掉画布缩放。
 *
 * 节点内的 DOM widget 是覆盖在画布之上的兄弟元素，滚轮事件落在它身上不会
 * 冒泡到 canvas——LiteGraph 的缩放监听（`_mousewheel_callback`）绑在 canvas
 * 元素自身。于是鼠标一进节点区域就缩放失效，图像对比节点即为此症状。
 *
 * 这里把无法被内部滚动消费的滚轮原样派发给画布，指针位置与增量都保留，
 * 缩放中心因此与指针一致（ComfyUI 自己对多行输入框做的就是同一件事）。
 *
 * 本模块刻意不 import `app`：它要能被纯 DOM 环境（单测）直接加载。
 */

/**
 * 找到 graph canvas：优先 LiteGraph 画布，其次页面里第一个 canvas。
 * 每次重新查询——画布元素会在前端切换（Classic ↔ Nodes 2.0）时被替换。
 * @returns {HTMLCanvasElement | null}
 */
function resolveGraphCanvas() {
    if (typeof document === "undefined") return null;
    try {
        if (typeof app !== "undefined" && app?.canvas?.canvas) return app.canvas.canvas;
    } catch (e) { /* app 未就绪时回落到 DOM 查询 */ }
    return document.querySelector("canvas.lgraphcanvas")
        || document.querySelector("canvas");
}

/**
 * 事件路径上（含 boundary 自身）是否存在还能纵向滚动的容器。
 * 有 ⇒ 滚轮应留给内部滚动条，不能拿去缩放画布。
 */
function hasScrollableAncestor(target, boundary) {
    // nodeType 判定而非 instanceof Element：本模块要能在无 DOM 全局的环境
    // （单测）里加载；文本节点等目标则从它的父元素开始找
    let node = target?.nodeType === 1 ? target : target?.parentElement;
    while (node && node.nodeType === 1) {
        const overflowY = window.getComputedStyle?.(node)?.overflowY;
        if ((overflowY === "auto" || overflowY === "scroll")
            && node.scrollHeight > node.clientHeight + 1) return true;
        if (node === boundary) break;
        node = node.parentElement;
    }
    return false;
}

/**
 * 把元素上的滚轮事件转发给画布。
 *
 * @param {HTMLElement} element - 需要转发滚轮的 DOM 控件根元素
 * @param {{ signal?: AbortSignal, respectInnerScroll?: boolean }} [opts]
 *        respectInnerScroll 默认 true（内部能滚就让位）；ignore-groups 传
 *        false 保持其「一律转发」的既有语义。
 * @returns {() => void} 解绑函数
 */
export function forwardWheelToCanvas(element, opts = {}) {
    if (!element || typeof element.addEventListener !== "function") return () => {};
    const respectInnerScroll = opts.respectInnerScroll !== false;
    const handler = (event) => {
        if (respectInnerScroll && hasScrollableAncestor(event.target, element)) return;
        const canvas = resolveGraphCanvas();
        if (!canvas) return;
        event.preventDefault();
        // 已由下面手动派发：截断冒泡，避免祖先再处理同一次滚轮（嵌套绑定时
        // 也只有最内层的那个 handler 会转发，不会重复缩放）
        event.stopPropagation();
        try {
            canvas.dispatchEvent(new WheelEvent("wheel", {
                clientX: event.clientX,
                clientY: event.clientY,
                deltaX: event.deltaX,
                deltaY: event.deltaY,
                deltaZ: event.deltaZ,
                deltaMode: event.deltaMode,
                // 修饰键必须一起透传：ComfyUI 的 processMouseWheel 靠
                // ctrl/meta 区分「滚轮缩放」与「滚轮平移」，丢了就走错分支
                ctrlKey: event.ctrlKey,
                shiftKey: event.shiftKey,
                altKey: event.altKey,
                metaKey: event.metaKey,
                bubbles: true,
                cancelable: true,
            }));
        } catch (e) { /* 画布已卸载：丢掉这一次滚轮即可 */ }
    };
    element.addEventListener("wheel", handler, { passive: false, signal: opts.signal });
    return () => element.removeEventListener("wheel", handler);
}
