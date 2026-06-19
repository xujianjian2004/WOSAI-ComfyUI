# WOSAI-ComfyUI SizeSelect 项目笔记

## 2025-06-19 语言切换与 UI 对齐修复

### 问题背景
SizeSelect 节点在 ComfyUI v10 下存在两个核心问题：
1. 输出端口名称和 tooltip 无法随 ComfyUI 全局语言切换同步更新
2. UI 自定义按钮组与分辨率按钮组宽度不一致、横向无法对齐

### 根因分析

#### 语言切换问题
- ComfyUI v10 使用 vue-i18n 进行国际化，节点定义翻译通过 `locales/{lang}/nodeDefs.json` 驱动
- 官方规范：输入端口 key 为输入标识名，输出端口 key 为数字索引（0, 1, 2...），字段名为 `name` 和 `tooltip`
- WOSAI 原有 locale 文件错误使用 `display_name` 做输入映射、用中文名称作为输出 key，导致翻译无法匹配
- 更深层原因：WOSAI 自建了独立的语言切换按钮（EN/中），只修改了 `localStorage` 和内部 `lang` 变量，没有触发 ComfyUI 的 vue-i18n locale 更新

#### UI 对齐问题
- 控制按钮行（预设/手动/缩放/剪裁）使用 `display: flex; gap: 3px`
- 分辨率按钮网格（标清/高清/全高清/超清）使用 `display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 6px`
- 布局模型不同（flex vs grid）且 gap 值不一致，导致两行宽度不匹配

### 修复方案

#### 1. locale 翻译文件格式修正
**文件**: `locales/zh/nodeDefs.json`、`locales/en/nodeDefs.json`

修正为 ComfyUI v10 官方规范格式：
- 输入端口：`inputs.{inputName}.name` / `inputs.{inputName}.tooltip`
- 输出端口：`outputs.{index}.name`（索引为数字字符串 "0", "1"...）

示例（zh）：
```json
{
  "WOSAI_SizeSelect": {
    "display_name": "尺寸选择 SizeSelect",
    "inputs": {
      "image": { "name": "图像", "tooltip": "输入图像（可选，将缩放至目标尺寸）" }
    },
    "outputs": {
      "0": { "name": "图像" },
      "1": { "name": "遮罩" }
    }
  }
}
```

#### 2. 删除自建语言切换逻辑
**文件**: `web/size-select.js`

删除内容：
- 语言切换按钮 `langBtn`（创建、事件绑定、悬停效果）
- `_ssSetLang()` — localStorage 写入函数
- `_ssUpdateAllText()` — 全文案刷新函数
- `_ssApplyPortTT()` — 端口 tooltip/label 手动覆盖函数
- `PORT_TT` 常量 — 端口 tooltip 双语映射表
- `getOutputLabel` hook — v10 已废弃的 prototype 覆盖

`_ssGetLang()` 改为从 ComfyUI 全局设置读取：
```javascript
function _ssGetLang() {
  try {
    const comfyLocale = app?.ui?.settings?.getSettingValue?.('Comfy.Locale');
    if (comfyLocale) {
      return comfyLocale.startsWith('zh') ? 'zh' : 'en';
    }
  } catch (_) {}
  try { return navigator.language.startsWith("zh") ? "zh" : "en"; } catch { return "en"; }
}
```

#### 3. UI 按钮组对齐修复
**文件**: `web/css/os-size.css`

- `.ss-control-row`：`gap` 从 `3px` 改为 `6px`
- `.ss-res-grid`：从 `display: grid` 改为 `display: flex; gap: 6px`
- `.ss-res-btn`：添加 `flex: 1`

两行均使用相同的 flex 布局 + 相同 gap 值，4 个按钮等宽分配，左右边缘完全对齐。

#### 4. 删除按钮样式
**文件**: `web/css/os-size.css`

删除 `.ss-lang-btn` 和 `.ss-lang-btn:hover` 样式规则。

### 验证方式
1. 在 ComfyUI Settings 中将全局语言切换为 English
2. 完整重启 ComfyUI 后端服务（或重新加载工作流）
3. 节点标题、输入名称/tooltip、输出名称应全部显示为英文
4. UI 按钮组（预设/手动/缩放/剪裁 与 标清/高清/全高清/超清）宽度一致、左右对齐

### 技术要点
- ComfyUI v10 切换语言时会执行 `reloadCurrentWorkflow()`，重新创建所有节点，`onNodeCreated` → `buildUI` 会重新执行，此时 `_ssGetLang()` 读取到新的 locale 即可自动构建正确语言的 UI
- 端口名称和 tooltip 由 `addOutputs()` / `addInputSocket()` 中的 `st()`（scoped translate）函数自动应用，无需手动干预
- `NodeSlot.renderingLabel` 优先级：`label > localized_name > name`，均为普通属性（非 getter/setter）
- `_setConcreteSlots()` 在每次渲染前从 `node.outputs` 重建 concrete slot 实例，但已有实例会直接复用

---

## 2025-06-19 代码质量审计与性能优化（v1.1）

### 审计范围
对项目全部 JS、Python、CSS、配置文件进行全面审计，覆盖语法规范、代码质量、架构设计、内存管理、UI 样式、兼容性 6 个维度。

### 修复内容

#### 1. 内存泄漏治理
- `size-select.js`：轮询回调添加节点存活检查（`!node || node.is_removed || !node.graph`）
- `size-select.js`：Vue 最小宽度检测从 `setInterval+setTimeout` 组合改为 `requestAnimationFrame` 轮询，更安全且性能更好
- `size-select.js`：合并重复的 `onRemoved` 绑定，避免回调链堆积
- 清理已废弃的模块级变量（`_vueMinWidthInterval`、`_vueMinWidthTimeout`）

#### 2. 代码规范
- 删除过时注释和已废弃代码（`getOutputLabel` hook、PORT_TT 常量）
- 统一 `_ssPollHandle` 清理逻辑命名，避免与主 `onRemoved` 冲突
- 轮询间隔从 250ms 调整为 300ms，降低 CPU 占用

#### 3. 配置文件更新
- `pyproject.toml`：版本号 `1.0` → `1.1`
- `requirements.txt`：版本号注释同步更新
- `LICENSE`：版权年份 2026 已正确

### 遗留问题（后续版本处理）
- `omni-slider.js` 存在约 103KB 的超大函数，需拆分为独立模块
- `canvas-note.js` 多处 setInterval 轮询可改为事件驱动
- `node-color.js` 渐变同步使用 MutationObserver + setInterval 双重机制，可简化为单一机制
- 所有 CSS 文件部分颜色硬编码，未完全继承 `wosai-variables.css`
- Python 文件缺少类型注解和 docstring
