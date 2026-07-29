# WOSAI-ComfyUI 发布检查清单

适用于正式版本、候选版本及包含前端兼容性改动的补丁发布。

## 1. 版本与变更

- [ ] `VERSION`、`package.json`、`pyproject.toml`、`extension.json` 与代码版本一致。
- [ ] `CHANGELOG.md` 包含当前版本、日期、兼容性变更及安全变更。
- [ ] 未误提交缓存、临时文件、测试输出、私有路径或密钥。
- [ ] `git diff --check` 无空白字符错误。

## 2. 自动门禁

在仓库根目录执行：

```bash
npm ci
npm run quality
npm run check:integrity
python -m unittest discover -s tests -p "test_*.py" -v
npm run test:comfy
npm run test:ui
npm run release:package
npm run release:check
```

- [ ] ESLint、UI 设计令牌、Node 单元测试、i18n、版本、共享数据、性能和发布静态检查通过。
- [ ] Python 单元测试与 aiohttp 请求级集成测试通过。
- [ ] 已启动 ComfyUI 的入口、递归共享模块与样式资源冒烟测试通过。
- [ ] Playwright 的 Classic / Nodes 2.0、180 节点压力和连续重载用例通过。
- [ ] 布局、搜索、SaveNode 清洗的中位数与 P95 均未超过预算。

## 3. Classic 与 Nodes 2.0

分别在 LiteGraph Classic 和 Nodes 2.0 中载入
`workflows/WOSAI_frontend_compat_test.json`：

- [ ] CommonColor 的“颜色预设”和颜色名称胶囊几何、字体、间距一致。
- [ ] 颜色预设左右三角可切换；中部可打开下拉菜单。
- [ ] 在 50%–200% 页面缩放下，颜色预设的左右三角和中部下拉热区仍与视觉位置一致。
- [ ] 自定义取色器停靠在节点一侧、垂直居中，并可拖动。
- [ ] CommonColor 的 INT 输出可连接 EmptyImage 的 `color` 输入并正常执行。
- [ ] Preset Manager 手动缩窄后操作按钮和标签不越界；单页不显示分页区，多页分页区到节点真实底边不超过 12px。
- [ ] OmniSlider、SizeSelect、TitleNote、IgnoreGroups 可创建、保存、重载。
- [ ] 切换中英文后节点标题、端口、菜单与颜色名称同步。
- [ ] 浏览器控制台无新增 WOSAI error 或 WOSAI deprecated monkey-patch 告警。

## 4. 服务端与安全

- [ ] `/wosai/color_presets` 正常读写，非法 JSON 和超限请求体被拒绝。
- [ ] `/wosai/device_info` 可刷新，敏感环境值保持脱敏。
- [ ] `/wosai/device_info/open_path` 仅能打开设备面板已登记目录。
- [ ] 显式跨站 POST 返回 403，服务端 500 响应不暴露内部异常。

## 5. 打包与交付

- [ ] 源码包包含 `nodes/`、`wosai_core/`、`web/`、`workflows/`、`docs/` 和 `CHANGELOG.md`。
- [ ] 源码包包含运行时 `presets/color_presets.json`，且不含测试、脚本、缓存和 `node_modules`。
- [ ] `dist/*.zip.sha256` 与发布 ZIP 匹配，重复构建得到相同哈希。
- [ ] `npm run verify:release` 的 SHA-256、重复条目、内部 import、隔离安装、JSON、JS 语法和 Python 编译检查通过。
- [ ] 从干净目录按 Manager/源码克隆方式安装并启动一次。
- [ ] 发布说明链接到变更记录和兼容工作流。
- [ ] 保留本次自动测试输出与双模式截图作为发布证据。
