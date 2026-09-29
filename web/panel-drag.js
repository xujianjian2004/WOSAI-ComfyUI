// ══ WOSAI 弹窗自由拖拽 ─════════════════════════════════════════════════════
//   全局自动接管所有 [data-wosai-panel] 浮层，无需逐个面板改代码：
//   拖拽本身由 `shared/shared-utils.js::makeDraggable` 提供（全项目唯一实现），
//   本模块只负责「发现浮层 → 识别手柄 → 绑定」的自动接管逻辑。
//   - 拖拽手柄 = 头部（显式 data-panel-head / 常见 head class / 面板首个子元素）
//   - 手柄上的交互元素（关闭按钮、滑块、输入、链接等）不触发拖拽
//   - 侧栏( .wosai-sb ) 与显式标记 data-no-drag 的浮层跳过
//   - 拖拽结果写入 left/top，并约束在视口内；清除 right/bottom 避免冲突
import { app } from "../../../scripts/app.js";
import { makeDraggable } from "./shared/shared-utils.js";

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
    // 自动接管的浮层头部沿用 move 光标，与显式调用的面板（grab）区分
    makeDraggable(panel, { handle: _findHandle(panel), cursor: "move" });
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
