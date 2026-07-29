// ══ WOSAI 画布整理套件 —— commands / keybindings 注册与注销 ═══════════════
// 由 layout-toolkit.js 聚合调用；本模块负责命令 ID、快捷键及扩展 remove 时的清理。

import { app } from "../../../../scripts/app.js";

export const _LT_COMMAND_IDS = [
    "wosai-align-panel",
    "wosai-select-same", "wosai-link-chain",
    "wosai-link-gather", "wosai-link-broadcast", "wosai-link-clear",
    "wosai-replace-node",
];

function _removeFromArray(arr, predicate) {
    if (!Array.isArray(arr)) return;
    for (let i = arr.length - 1; i >= 0; i--) {
        if (predicate(arr[i])) arr.splice(i, 1);
    }
}

// 注销本扩展注册的 commands / keybindings：优先官方 API，其次从各版本内部数组移除
export function _unregisterLayoutCommands() {
    for (const id of _LT_COMMAND_IDS) {
        try { if (typeof app.unregisterCommand === "function") app.unregisterCommand(id); } catch (_) {}
    }
    // Remove the legacy auto-layout command/keybinding left by older WOSAI builds.
    try { if (typeof app.unregisterCommand === "function") app.unregisterCommand("wosai-auto-layout"); } catch (_) {}
    try { if (typeof app.unregisterKeybinding === "function") app.unregisterKeybinding("wosai-auto-layout"); } catch (_) {}
    // 兼容旧版本曾注册的 Alt+Q 对齐工具栏快捷键。该工具栏现在仅允许通过
    // HUB 按钮进入，D 只用于切换“节点对齐”面板。
    try { if (typeof app.unregisterKeybinding === "function") app.unregisterKeybinding("wosai-align-bar"); } catch (_) {}
    _removeFromArray(app.commands, c => _LT_COMMAND_IDS.includes(c?.id) || c?.id === "wosai-auto-layout");
    _removeFromArray(app.keybindings, k => _LT_COMMAND_IDS.includes(k?.commandId) || k?.commandId === "wosai-auto-layout");
    _removeFromArray(app.extensionManager?.command?.commands, c => _LT_COMMAND_IDS.includes(c?.id) || c?.id === "wosai-auto-layout");
}
