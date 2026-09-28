# dev/frontend —— 未接入运行时的前端地基

本目录存放**已经写好、有单测、但尚未接入 ComfyUI 运行时**的前端纯函数模块。

它们不是死代码：每一个都是后续功能的既定地基，只是入口还没接线。
之所以放在 `web/` 之外，是因为 `web/` 是**发布目录**——`scripts/build_release.py`
会把 `web/` 整个打进 `dist/WOSAI-ComfyUI-<版本>.zip`，`scripts/check-frontend-performance.mjs`
也会把 `web/` 下所有 `.js` 计入前端启动体积预算。

放在这里的模块：

| 模块 | 规划用途 | 现状 |
|---|---|---|
| `layout-engine.js` | 数据流自动布局引擎（DAG 拓扑分层 + 强连通分量折叠 + 重叠消解），纯函数、不依赖 DOM | 画布整理套件的「自动排布」尚未接线；`layout-toolkit.js` 目前只做对齐/分布/尺寸 |
| `layout-geometry.js` | 自动布局与对齐共用的节点几何测量（`computeSize` 安全调用、reroute 识别） | 同上 |
| `feature-registry.js` | 功能归类 / 加载审计 / HUB BAR 自定义的单一数据源 | 尚无消费方 |

## 约定

- **不得被 `web/` 下的运行时模块静态 import**——一旦 import，模块就会重新进入启动闭包，
  由 `web/shared/frontend-reachability.test.mjs` 拦截。
- 接入运行时时的正确做法：把模块移回 `web/shared/`，并在 `extension.json`（或其入口的
  import 链）上接线；搬运时同步更新引用点与 `dev/frontend/README.md` 本表。
- 单测与模块同目录，由 `npm test` 一并执行（glob 见 `package.json`）。
- 性能基准 `scripts/benchmark-frontend.mjs` 直接引用本目录的 `layout-engine.js`，
  保证这段地基的性能预算不会在未接线期间无声劣化。
