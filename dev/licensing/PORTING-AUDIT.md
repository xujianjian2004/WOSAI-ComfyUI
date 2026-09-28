# 第三方来源移植审计（PORTING AUDIT）

> 生成时间：2026-09-28
> 审计范围：WOSAI-ComfyUI 中所有标注「移植自 / 借鉴 / 架构来源」的前端与后端文件
> 判定方法：以「同一行去掉空白后逐字相同」为实质复制指标，辅以「上游专有标识符命中数」（排除 JS 关键字、DOM/Web API、CSS 属性名、ComfyUI/LiteGraph 框架 API 等通用名）

## 一、结论摘要

本项目有 **5 个文件**构成 GPL-3.0 敞口，其中 **4 个来自 ComfyUI-KJNodes**，其复制程度**远高于**先前关注的 `ignore-groups.js`。

| # | 本项目文件 | 上游 | 上游许可 | 逐字相同率 | 上游专有标识符命中 | 严重度 |
|---|---|---|---|---|---|---|
| 1 | `web/auto-connect.js` | `ComfyUI-KJNodes/web/js/fillconnect.js` | GPL-3.0 | **69.6%** (71/102) | 39 | ⛔ 严重 |
| 2 | `web/shake-disconnect.js` | `ComfyUI-KJNodes/web/js/shake_to_disconnect.js` | GPL-3.0 | **67.7%** (88/130) | 58 | ⛔ 严重 |
| 3 | `web/performance-mode.js` | `ComfyUI-KJNodes/web/js/performance.js` | GPL-3.0 | **51.7%** (45/87) | 35 | ⛔ 严重 |
| 4 | `web/shared/graph-utils.js` | `ComfyUI-KJNodes/web/js/utility.js` | GPL-3.0 | 66.7% (4/6) | 6 | ⚠️ 小（文件已被裁剪至 6 行） |
| 5 | `web/ignore-groups.js` | `Goohaitools-comfyui/web/js/nodes pass.js` | GPL-3.0 | 22.7% (248/1094) | ~130 | ⚠️ 中 |

「上游专有标识符命中」指上游作者的独创命名（如 `installSingleCanvasPan`、`_panInstalledOn`、`executeShakeBreak`、`getNodeAnchor`、`traceAndBypass`、`cachedAll`、`cdPanel`、`computeStateSig`）原样出现在本项目代码中。此类命名是「实质性相似」的核心证据。

## 二、已排除的来源（澄清）

| 本项目文件 | 来源 | 许可 | 审计结论 |
|---|---|---|---|
| `web/logic-switch.js`、`nodes/logic_switch.py` | `SpaceWarpStudio/ComfyUI-OverrideSwitch` | **MIT** | ✅ 无敞口。MIT 与本项目 MIT 兼容，仅需保留版权声明 |
| `web/title-note.js` | `ComfyUI-xiaozhuguang`（架构模式参考） | 未声明 | ✅ 低风险。仅为钩子选型（`beforeRegisterNodeDef` + `computeSize` + rainbow）的模式参考，非代码移植 |
| `web/shared/color-theme.js`、`color-core.js` | `ComfyUI_GJJ_Nodes` 的 `node_color_theme` | **Personal Use Only** | ✅ 干净。逐字相同率 **0%**，标识符交集 23 / 4 个、且全部为 `styleId`、`category`、`constructor` 等通用词，与源码注释「数据结构借鉴、颜色与实现均为独立设计」一致 |
| `web/ignore-groups.js` 中提及的 `gjj_group_bypasser` | `ComfyUI_GJJ_Nodes/js/gjj_group_bypasser.js` | Personal Use Only | ✅ 设计层面参照。逐字相同 3 行（全是 `setDirtyCanvas` / `requestAnimationFrame` 通用样板），无代码搬运。**但注释中引用了其内部符号名（`setGroupState`、`controllerNode`），重写时应移除** |

## 三、上游许可详情

| 上游项目 | 许可 | 依据 |
|---|---|---|
| ComfyUI-KJNodes | GPL-3.0 | 仓库根 `LICENSE`（GNU GPL v3） |
| Goohaitools-comfyui | GPL-3.0 | 仓库根 `LICENSE`（GNU GPL v3） |
| ComfyUI_GJJ_Nodes | **Personal Use Only** | `README.md` 徽章声明；仓库未附 LICENSE 文件 |
| ComfyUI-OverrideSwitch | MIT | 仓库 README「This project is licensed under the MIT License」 |

> 参考：ComfyUI 本体亦为 GPL-3.0，但自定义节点与宿主属「聚合」关系，不构成传染。

## 四、法律定性

- GPL-3.0 的 copyleft 要求**衍生作品整体按 GPL 授权**。将 GPL-3.0 代码并入 MIT 项目并以 MIT 条款分发，构成许可证违规。
- **仅补充署名不足以合规**——署名是 GPL 的必要条件而非充分条件。只要这些衍生文件仍以 MIT 条款分发，违规状态持续存在。
- 上述 5 个文件与上游的逐字相同率（22.7% ~ 69.6%）与独创标识符命中，已远超「独立创作巧合」的范围，构成衍生作品。

## 五、技术可行性：局部双许可

经核查 import 引用边界，这 5 个文件构成**自闭合闭包**：

- `web/shared/graph-utils.js` 仅被 `web/auto-connect.js` 引用（同源）
- `web/auto-connect.js`、`web/performance-mode.js`、`web/shake-disconnect.js`、`web/ignore-groups.js` 仅由 `extension.json` 作为入口加载；`hub-bar.js` 中以字符串形式持有 `autoConnect: "./auto-connect.js"` 的模块路径（运行时动态 import）
- **没有任何 MIT 文件 `import` 这 5 个文件** → 不存在 GPL 反向传染

因此「这 5 个文件标为 GPL-3.0、项目主体保持 MIT」在技术上是可行的。方向正确性：MIT 代码可被 GPL 文件引用（MIT → GPL 兼容），反之不可。

## 六、处置选项

| 方案 | 内容 | 合规性 | 功能损失 | 工作量 |
|---|---|---|---|---|
| A | 5 个文件标 GPL-3.0-or-later + 完整署名，项目主体仍 MIT | 100% | 无 | 小 |
| B | 5 个文件全部 clean-room 重写，项目保持纯 MIT | 高（非零残留） | 无 | 极大（数千行，含复杂图遍历与画布渲染 hook） |
| C | 混合：KJNodes 4 个走 GPL，`ignore-groups.js` 走 clean-room 重写 | 100% | 无 | 中 |
| D | 全项目改为 GPL-3.0 | 100% | 无 | 小 |
| E | 移除这 5 项功能 | 100% | 5 项功能 | 中 |

## 七、回归防线

新增 `web/shared/licensing-consistency.test.mjs`（随 `npm test` 运行），把上表结论固化为可执行的断言，
使「哪些文件是 GPL 衍生作品」只能被显式修改、不能被悄悄破坏：

1. `LICENSE` 仍为 MIT 主体且含例外章节，逐条列出 GPL 文件；
2. `LICENSE-GPL-3.0` 确为 GPL v3 全文；
3. 清单内每个文件都带 `SPDX-License-Identifier: GPL-3.0-or-later` 文件头；
4. `THIRD-PARTY-NOTICES.md` 逐一列出这些文件及其上游署名；
5. **无 MIT 文件静态 `import` GPL 文件**——防止 GPL 反向传染 MIT 代码。

> 该测试已做阴性验证：临时放入一个 `import` GPL 文件的 MIT 模块后，第 5 条断言按预期失败并指名违规路径。

## 八、审计方法

- **实质复制指标**：同一行去除空白后逐字相同，仅统计长度 ≥ 25 字符的行（短行易因语法必然性重合，无判别力）。
- **独创性指标**：统计上游标识符中排除「JS 关键字 / DOM-Web API / CSS 属性名 / ComfyUI-LiteGraph 框架 API」后的剩余项，检查在本项目代码中的出现情况。
- 所有判定均以文本语料机械比对为准，辅以人工复核 diff。
