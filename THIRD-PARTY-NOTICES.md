# 第三方来源与许可证声明（Third-Party Notices）

本文件列出 WOSAI-ComfyUI 中来源于第三方项目的代码，以及相应的许可证与署名。

本项目**主体**按 MIT 许可证授权（见根目录 `LICENSE`）。但下列「一、衍生文件」一节的
文件是 GPL-3.0 许可作品的衍生作品，按 **GNU GPL v3.0 或更新版本（GPL-3.0-or-later）**
授权，**不适用** MIT 条款。完整许可证文本见根目录 [`LICENSE-GPL-3.0`](./LICENSE-GPL-3.0)。

---

## 一、衍生文件（GPL-3.0-or-later）

### 1. 源自 ComfyUI-KJNodes

| 项目 | 内容 |
| --- | --- |
| 原始项目 | ComfyUI-KJNodes |
| 原始作者 | kijai |
| 原始仓库 | https://github.com/kijai/ComfyUI-KJNodes |
| 原始许可证 | GNU General Public License v3.0 |

| 本项目文件 | 对应的原始文件 |
| --- | --- |
| `web/auto-connect.js` | `web/js/fillconnect.js` |
| `web/shake-disconnect.js` | `web/js/shake_to_disconnect.js` |
| `web/performance-mode.js` | `web/js/performance.js` |
| `web/shared/graph-utils.js` | `web/js/utility.js` |

### 2. 源自 Goohaitools-comfyui（孤海工具箱）

| 项目 | 内容 |
| --- | --- |
| 原始项目 | Goohaitools-comfyui |
| 原始作者 | goohai（B 站：孤海FOTO） |
| 原始仓库 | https://github.com/goohai/Goohaitools-comfyui |
| 原始许可证 | GNU General Public License v3.0 |

| 本项目文件 | 对应的原始文件 |
| --- | --- |
| `web/ignore-groups.js` | `web/js/nodes pass.js` |

> 配套的后端节点 `nodes/ignore_groups.py` 由本项目独立编写（经比对不含上述项目的
> 受保护表达），按 MIT 授权；但其前端实现依赖上表 GPL 文件，故整条功能链的实际
> 分发许可以 GPL-3.0 为准。

---

## 二、MIT 许可来源（保留版权声明）

### ComfyUI-OverrideSwitch

| 项目 | 内容 |
| --- | --- |
| 原始项目 | ComfyUI-OverrideSwitch |
| 原始作者 | SpaceWarp Studio |
| 原始仓库 | https://github.com/SpaceWarpStudio/ComfyUI-OverrideSwitch |
| 原始许可证 | MIT License |

```
MIT License

Copyright (c) SpaceWarp Studio

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

| 本项目文件 | 说明 |
| --- | --- |
| `nodes/logic_switch.py` | 后端切换逻辑 |
| `web/logic-switch.js` | 前端端口标签国际化 |

---

## 三、设计与架构参考（经核查无代码使用）

以下项目的**设计思路或数据结构**在实现过程中被参考，但未复制其代码。经逐行比对，
本项目对应文件的逐字相同率为 0%（仅有 `setDirtyCanvas`、`document.createElement`、
`requestAnimationFrame` 等 Web / ComfyUI 通用 API 样板行重合）。

| 项目 | 许可证 | 参考内容 | 本项目文件 |
| --- | --- | --- | --- |
| ComfyUI_GJJ_Nodes | Personal Use Only | 分组旁路节点的交互设计；节点配色的大类划分思路 | `web/ignore-groups.js`（交互设计参考）、`web/shared/color-theme.js` / `color-core.js`（数据结构参考） |
| ComfyUI-xiaozhuguang | — | 标题注释节点的注册钩子选型 | `web/title-note.js` |

> 本项目在实现上述功能时，颜色取值、算法与代码组织均为独立设计。

---

## 四、完整审计记录

来源、复制程度与判定依据的完整审计见 [`dev/licensing/PORTING-AUDIT.md`](./dev/licensing/PORTING-AUDIT.md)
（该目录不随发布包分发）。

## 五、许可证文件索引

| 文件 | 内容 |
| --- | --- |
| [`LICENSE`](./LICENSE) | MIT 许可证（本项目主体） |
| [`LICENSE-GPL-3.0`](./LICENSE-GPL-3.0) | GNU General Public License v3.0 全文 |
