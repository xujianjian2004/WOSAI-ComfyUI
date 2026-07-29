// ══ WOSAI 弹窗自由拖拽 ─════════════════════════════════════════════════════
//   全局自动接管所有 [data-wosai-panel] 浮层，无需逐个面板改代码：
//   - 拖拽手柄 = 头部（显式 data-panel-head / 常见 head class / 面板首个子元素）
//   - 手柄上的交互元素（关闭按钮、滑块、输入、链接等）不触发拖拽
//   - 侧栏( .wosai-sb ) 与显式标记 data-no-drag 的浮层跳过
//   - 拖拽结果写入 left/top，并约束在视口内；清除 right/bottom 避免冲突
import { app } from "../../../scripts/app.js";

// 为单个浮层绑定拖拽
export function makeDraggable(panel, handle) {
    if (!panel || panel._wosaiDraggable) return;
    handle = handle || _findHandle(panel);
    if (!handle) return;
    panel._wosaiDraggable = true;
    if (!handle.style.cursor) handle.style.cursor = "move";

    let startX = 0, startY = 0, baseLeft = 0, baseTop = 0, dragging = false;

    const onMove = (e) => {
        if (!dragging) return;
        panel.dataset.wosaiManualPosition = "true";
        let nx = baseLeft + (e.clientX - startX);
        let ny = baseTop + (e.clientY - startY);
        const w = panel.offsetWidth, h = panel.offsetHeight;
        nx = Math.max(0, Math.min(nx, window.innerWidth - w));
        ny = Math.max(0, Math.min(ny, window.innerHeight - h));
        panel.style.left = nx + "px";
        panel.style.top = ny + "px";
    };
    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
    };
    const onDown = (e) => {
        if (e.button !== 0) return;
        // 交互元素不触发拖拽（关闭按钮已带 data-no-drag，这里再兜一层）
        if (e.target.closest("button, input, select, textarea, a, [data-no-drag], .ws-no-drag, svg, [role='button']")) return;
        dragging = true;
        // 若当前使用 right/bottom 定位，先转换为等效的 left/top，避免后续冲突
        const r = panel.getBoundingClientRect();
        if ((panel.style.right !== "" && panel.style.right != null) || (panel.style.bottom !== "" && panel.style.bottom != null)) {
            panel.style.left = r.left + "px";
            panel.style.top = r.top + "px";
            panel.style.right = "auto";
            panel.style.bottom = "auto";
        }
        // 百分比 left/top 不可靠，使用 getBoundingClientRect 作为基准
        const rawLeft = panel.style.left;
        const rawTop = panel.style.top;
        baseLeft = (rawLeft && !rawLeft.includes("%")) ? parseFloat(rawLeft) : r.left;
        baseTop = (rawTop && !rawTop.includes("%")) ? parseFloat(rawTop) : r.top;
        startX = e.clientX; startY = e.clientY;
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        document.body.style.userSelect = "none";
        e.preventDefault();
    };
    handle.addEventListener("mousedown", onDown);
    panel._wosaiDragCleanup = () => {
        handle.removeEventListener("mousedown", onDown);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        panel._wosaiDraggable = false;
        panel._wosaiDragCleanup = null;
    };
}

// 自动识别拖拽手柄：显式标记 > 常见 head class > 首个子元素
function _findHandle(panel) {
    let h = panel.querySelector("[data-panel-head]");
    if (h) return h;
    h = panel.querySelector("header, .ws-panel__head, .wosai-panel__head, .ws-dialog__head, .lf-head, .panel-head");
    if (h) return h;
    return panel.firstElementChild || panel;
}

// 是否跳过该浮层
function _shouldSkip(panel) {
    if (panel._wosaiDraggable) return true;
    if (panel.classList && panel.classList.contains("wosai-sb")) return true; // 侧栏固定栏
    if (panel.hasAttribute && panel.hasAttribute("data-no-drag")) return true;
    return false;
}

function _enableOne(panel) {
    if (!panel || !panel.matches || !panel.matches("[data-wosai-panel]")) return;
    if (_shouldSkip(panel)) return;
    makeDraggable(panel, _findHandle(panel));
}

// 全局启用：处理已存在 + 监听后续新增
let _observer = null;

export function autoEnablePanelDragging(root = document.body) {
    _observer?.disconnect();
    document.querySelectorAll("[data-wosai-panel]").forEach(_enableOne);
    _observer = new MutationObserver((muts) => {
        for (const m of muts) {
            m.addedNodes.forEach((n) => {
                if (n.nodeType !== 1) return;
                // 延迟一帧：确保面板 append 后内部头部/子元素已就位，手柄识别准确
                if (n.matches && n.matches("[data-wosai-panel]")) requestAnimationFrame(() => _enableOne(n));
                if (n.querySelectorAll) n.querySelectorAll("[data-wosai-panel]").forEach((el) => requestAnimationFrame(() => _enableOne(el)));
            });
        }
    });
    _observer.observe(root, { childList: true, subtree: true });
}

export function stopPanelDragging() {
    _observer?.disconnect();
    _observer = null;
    document.querySelectorAll("[data-wosai-panel]").forEach(panel => panel._wosaiDragCleanup?.());
}

app.registerExtension({
    name: "WOSAI.PanelDrag",
    setup() { autoEnablePanelDragging(); },
    remove() { stopPanelDragging(); },
});
