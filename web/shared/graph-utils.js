/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 本文件是 ComfyUI-KJNodes 的衍生作品，按 GNU GPL v3.0 或更新版本授权，
 * 不适用本项目根 LICENSE 的 MIT 条款。
 *   原始项目：ComfyUI-KJNodes
 *   原始作者：kijai
 *   原始文件：web/js/utility.js
 *   原始仓库：https://github.com/kijai/ComfyUI-KJNodes
 * 完整条款见项目根 LICENSE-GPL-3.0；完整署名见 THIRD-PARTY-NOTICES.md。
 */
// WOSAI 画布端口坐标辅助。
// 移植自 ComfyUI-KJNodes web/js/utility.js 中的纯函数部分，重写为 WOSAI 风格，
// 供自动连点等多个画布扩展复用。

// 取端口画布坐标（Vue 模式走 DOM 注册位置，经典画布走 getConnectionPos 兜底）
export function getSlotPos(node, isInput, slotIdx) {
    if (isInput && node.getInputPos) return node.getInputPos(slotIdx);
    if (!isInput && node.getOutputPos) return node.getOutputPos(slotIdx);
    const out = [0, 0];
    node.getConnectionPos(isInput, slotIdx, out);
    return out;
}
