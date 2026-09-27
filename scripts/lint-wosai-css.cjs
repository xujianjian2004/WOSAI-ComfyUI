#!/usr/bin/env node
/**
 * WOSAI UI Linter
 * 扫描项目中的 CSS/JS 文件，检测硬编码颜色、硬编码尺寸、未使用变量、i18n 硬编码、路径混用。
 *
 * 用法：
 *   node scripts/lint-wosai-css.cjs                  # 棘轮模式：超过基线才失败
 *   node scripts/lint-wosai-css.cjs --summary        # 单行结论
 *   node scripts/lint-wosai-css.cjs --json           # 机器可读
 *   node scripts/lint-wosai-css.cjs --strict         # 忽略基线，任何问题都失败
 *   node scripts/lint-wosai-css.cjs --update-baseline  # 修复后下调基线
 *
 * 棘轮基线（scripts/lint-wosai-css.baseline.json）：
 *   历史欠账（硬编码颜色/尺寸、未使用变量）已被冻结，新增问题才会让门禁转红；
 *   每偿还一批欠账就用 --update-baseline 把基线压下来，保证只降不升。
 */

const fs = require('fs');
const path = require('path');

// 配置
const ROOT = path.resolve(__dirname, '..');
const CSS_DIRS = [path.join(ROOT, 'web', 'styles')];
const JS_DIRS = [path.join(ROOT, 'web')];
const VARIABLES_FILE = path.join(ROOT, 'web', 'styles', 'wosai-variables.css');
const NON_VISUAL_DATA_FILES = new Set([
  path.join(ROOT, 'web', 'shared', 'save-node-data.js'),
]);

// 允许例外
const ALLOWED_COLORS = new Set([
  'transparent',
  'inherit',
  'currentColor',
  'none',
  'auto',
  // CSS 全局关键字与系统颜色关键字
  'unset',
  'initial',
  'revert',
  'revert-layer',
  'canvas',
  'canvastext',
  'buttontext',
  'buttonface',
  'buttonborder',
  'field',
  'fieldtext',
  'highlight',
  'highlighttext',
  'selecteditem',
  'selecteditemtext',
  'mark',
  'marktext',
  'graytext',
  'linktext',
  'visitedtext',
  'activetext',
]);

const ALLOWED_PX_VALUES = new Set(['0', '0px']);

// 预留令牌：已在设计系统中定义，计划供未来/其他组件使用，lint 不视为未使用
const RESERVED_UNUSED_VARS = new Set([
  // 品牌/语义/通用保留 token
  '--ws-accent-active',
  '--ws-bg',
  '--ws-font-display',
  '--ws-surface-2-rgb',
  '--ws-surface-raised-2',
  '--ws-success-bg',
  '--ws-warning',
  '--ws-danger-bg',
  '--ws-text-3xl',
  // 语法高亮预留系列
  '--ws-syntax-code',
  '--ws-syntax-code-bg',
  '--ws-syntax-code-block',
  '--ws-syntax-code-block-bg',
  '--ws-syntax-mark',
  '--ws-syntax-mark-bg',
  '--ws-syntax-fail',
  '--ws-syntax-complete',
  // Color Picker 预留 token
  '--ws-cp-panel-w',
  '--ws-cp-sv-h',
  '--ws-cp-hue-track-h',
  '--ws-cp-hue-thumb-s',
  '--ws-cp-swatch-s',
  // 动效/遮罩预留 token
  '--ws-overlay-bg',
  '--ws-ease-out',
  '--ws-ease-in-out',
]);

const PX_WHITELIST = new Set([
  '1px',
  '2px',
  '3px',
  '4px',
  '5px',
  '6px',
  '7px',
  '8px',
  '9px',
  '10px',
  '11px',
  '12px',
  '13px',
  '14px',
  '15px',
  '16px',
  '18px',
  '20px',
  '22px',
  '24px',
  '26px',
  '28px',
  '30px',
  '32px',
  '34px',
  '36px',
  '38px',
  '40px',
  '44px',
  '48px',
  '52px',
]);

const IGNORE_PATHS = [/node_modules/, /\.trae/];

// 路径检查白名单：允许这些反斜杠场景
const PATH_KEYWORDS_WHITELIST = [
  '\\\\', // 转义反斜杠
  'path',
  '__dirname',
  '__filename',
  '\\n', // 转义换行
  '\\t', // 转义制表
  '\\r', // 转义回车
  '\\r\\n', // 转义 CRLF
  "\\'", // 转义单引号
  '\\"', // 转义双引号
  '\\`',
  '\\x', // hex 转义
  '\\u', // unicode 转义
  '\\0', // null 转义
  '\\v', // 垂直制表
  '\\f', // 换页
  // 模板字符串插值（说明是代码字符串而非路径）
  '${',
  // URL / base64 内联资源
  'data:image',
  'http://',
  'https://',
  // 正则表达式常用转义元字符
  '\\d',
  '\\D',
  '\\s',
  '\\S',
  '\\w',
  '\\W',
  '\\b',
  '\\B',
  // 正则结构符号（说明该字符串是正则片段而非路径）
  '[',
  ']',
  '(',
  ')',
  '|',
  '+',
  '*',
  '?',
  '^',
  '$',
  '{',
  '}',
];

// i18n 文案白名单：这些中文是技术/文件名相关，不视为用户文案
const I18N_TEXT_WHITELIST = [
  'ComfyUI',
  'WOSAI',
  'LiteGraph',
  // WOSAI 组件/模块名
  'TitleNote',
  'NodeColor',
  'OmniSlider',
  'IgnoreGroups',
  'ColorBar',
  'LinkFX',
  'RunHighlight',
  'LayoutToolkit',
  'GlassTheme',
  'HUDKit',
  'PanelBuilder',
  'VisualFX',
  'TagSelector',
  'Launcher',
  // ComfyUI widget 内部标识符（data-name / aria-label 等），非展示文案
  '输出模式',
  '输出类型',
  '输出',
  '数值',
  '布尔',
  '标签',
  // 历史数据迁移标识符
  '滑条',
  // 常见技术中文（属性名/类名/注释中提及，非展示文案）
  '节点',
  '组件',
  '面板',
  '画布',
  '工作流',
  '预设',
  '主题',
  '颜色',
  '图标',
  '按钮',
  '输入',
  '滑块',
  '开关',
  '徽章',
  '提示',
  '工具栏',
  '设置',
  '选择',
  '颜色选择器',
  // 与后端同步的分类标识（`preset_prompt.py` 的默认/兜底分类）。这些是用于
  // 分类匹配的数据常量，界面展示走 category_i18n，翻译它们会破坏分类匹配。
  '通用',
  '未分类',
];

// 正则
const HEX_COLOR_RE = /#[0-9A-Fa-f]{3,8}\b/g;
const RGB_COLOR_RE = /rgba?\s*\([^)]+\)/g;
const HSL_COLOR_RE = /hsla?\s*\([^)]+\)/g;
const PX_VALUE_RE = /\b\d+\.?\d*px\b/g;
const CSS_VAR_DEF_RE = /(--ws-[\w-]+)\s*:/g;
// 使用点匹配刻意不要求紧跟 ")"：`var(--x, 96px)` 这类带 fallback 的引用也必须计为
// 已使用，否则会误报"未使用变量"（原 /var\(\s*(--ws-[\w-]+)\s*\)/ 会漏掉带兜底值的用法）。
const CSS_VAR_USE_RE = /var\(\s*(--ws-[\w-]+)/g;
const CSS_CONTENT_RE = /content\s*:\s*["'][^"']+["']/g;
// i18n 调用的中文兜底参数：t("key", "中文兜底") 里的第二个字面量是设计的一部分，
// 不是待翻译的硬编码文案，需要跳过（否则每个 t(key, fallback) 都会被误报）。
const I18N_FALLBACK_RE = /\b(?:t|i18n\.t)\s*\(\s*(?:"[^"\n]*"|'[^'\n]*')\s*,\s*(["'])/g;

const BASELINE_FILE = path.join(__dirname, 'lint-wosai-css.baseline.json');

function emptyBaseline() {
  return { total: 0, byType: {}, bySeverity: {} };
}

function loadBaseline() {
  try {
    const raw = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));
    return {
      total: Number(raw.total) || 0,
      byType: raw.byType && typeof raw.byType === 'object' ? raw.byType : {},
      bySeverity: raw.bySeverity && typeof raw.bySeverity === 'object' ? raw.bySeverity : {},
    };
  } catch {
    return emptyBaseline();
  }
}

function saveBaseline(summary) {
  const payload = {
    note: 'CSS/JS 规范欠账棘轮基线：仅当问题数超过此基线时 lint 才失败。修复后运行 node scripts/lint-wosai-css.cjs --update-baseline 下调。',
    total: summary.totalIssues,
    bySeverity: summary.severity,
    byType: summary.byType,
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  return payload;
}

function computeRegressions(summary, baseline) {
  const regressions = [];
  if (summary.totalIssues > baseline.total) {
    regressions.push(`问题总数 ${summary.totalIssues} > 基线 ${baseline.total}`);
  }
  for (const [type, count] of Object.entries(summary.byType)) {
    const allowed = Number(baseline.byType[type]) || 0;
    if (count > allowed) regressions.push(`${type} ${count} > 基线 ${allowed}`);
  }
  return regressions;
}

function walk(dir, callback) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (IGNORE_PATHS.some((p) => p.test(full))) continue;
    if (entry.isDirectory()) {
      walk(full, callback);
    } else if (entry.isFile()) {
      callback(full);
    }
  }
}

function collectFiles(dirs, exts) {
  const files = [];
  for (const dir of dirs) {
    walk(dir, (file) => {
      if (exts.some((ext) => file.endsWith(ext))) files.push(file);
    });
  }
  return files;
}

function relative(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

function addIssue(issues, file, line, col, type, message, suggestion) {
  issues.push({
    file: relative(file),
    line,
    col,
    type,
    message,
    suggestion,
  });
}

function findLineCol(text, index) {
  const lines = text.slice(0, index).split('\n');
  return { line: lines.length, col: lines[lines.length - 1].length + 1 };
}

function isDynamicColorExpression(value) {
  // Canvas renderers legitimately construct colors from runtime hue/RGB/alpha
  // values. These are not theme literals and cannot be replaced by a static
  // CSS token; still report every concrete HEX/RGB/HSL value.
  if (!/^(?:rgba?|hsla?)\s*\(/i.test(value)) return false;
  if (value.includes('${') || value.includes('"') || value.includes("'")) return true;
  return /\b(?:p|q|h|r|g|b|a|alpha|hue|time|Math|parseInt)\b/.test(value);
}

function isInComment(text, index) {
  // 简单判断：向前搜索最近的 /* 和 //
  const before = text.slice(0, index);
  const lastBlockOpen = before.lastIndexOf('/*');
  const lastBlockClose = before.lastIndexOf('*/');
  if (lastBlockOpen !== -1 && lastBlockOpen > lastBlockClose) return true;

  const lineStart = before.lastIndexOf('\n') + 1;
  const lineText = before.slice(lineStart);
  if (lineText.trim().startsWith('//') || lineText.trim().startsWith('*')) return true;

  return false;
}

function isInsideCalc(text, index) {
  // 支持 calc / clamp / min / max 的嵌套调用
  const before = text.slice(0, index);
  const funcs = ['calc(', 'clamp(', 'min(', 'max('];
  let lastStart = -1;
  for (const func of funcs) {
    const pos = before.lastIndexOf(func);
    if (pos > lastStart) lastStart = pos;
  }
  if (lastStart === -1) return false;

  // 从最近函数调用开始计算括号深度，找到匹配的右括号
  let depth = 0;
  for (let i = lastStart; i < text.length; i++) {
    if (text[i] === '(') {
      depth++;
    } else if (text[i] === ')') {
      depth--;
      if (depth === 0) {
        return index > lastStart && index < i;
      }
    }
  }
  // 未找到闭合括号，但 index 确实在调用之后
  return index > lastStart;
}

/** 收集 t("key", "中文兜底") 中兜底字面量的起始下标，供 i18n 规则跳过。 */
function collectI18nFallbackIndices(text) {
  const indices = new Set();
  I18N_FALLBACK_RE.lastIndex = 0;
  let match;
  while ((match = I18N_FALLBACK_RE.exec(text)) !== null) {
    // 正则末尾停在兜底字符串的起始引号之后
    indices.add(I18N_FALLBACK_RE.lastIndex - 1);
  }

  return indices;
}

function lintFile(file, issues) {
  const text = fs.readFileSync(file, 'utf-8');
  const isCSS = file.endsWith('.css');
  const isJS = file.endsWith('.js');
  const checksVisualLiterals = !NON_VISUAL_DATA_FILES.has(file);

  // 1. 硬编码颜色
  const colorRes = [
    [HEX_COLOR_RE, '硬编码 HEX 颜色'],
    [RGB_COLOR_RE, '硬编码 RGB/RGBA 颜色'],
    [HSL_COLOR_RE, '硬编码 HSL/HSLA 颜色'],
  ];
  for (const [re, label] of checksVisualLiterals ? colorRes : []) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = m[0].toLowerCase();
      if (ALLOWED_COLORS.has(value)) continue;
      if (isInComment(text, m.index)) continue;
      if (isDynamicColorExpression(m[0])) continue;
      // 跳过 url(#id) 中的 hash
      const before20 = text.slice(Math.max(0, m.index - 20), m.index);
      if (/url\([^)]*$/.test(before20)) continue;

      const { line, col } = findLineCol(text, m.index);
      addIssue(
        issues,
        file,
        line,
        col,
        '硬编码颜色',
        `${label}: ${m[0]}`,
        `改为 var(--ws-*) token，或在 wosai-variables.css 中定义新 token`
      );
    }
  }

  // 2. 硬编码尺寸
  let pxMatch;
  while (checksVisualLiterals && (pxMatch = PX_VALUE_RE.exec(text)) !== null) {
    const value = pxMatch[0];
    if (ALLOWED_PX_VALUES.has(value)) continue;
    if (isInComment(text, pxMatch.index)) continue;
    if (isInsideCalc(text, pxMatch.index)) continue;

    const { line, col } = findLineCol(text, pxMatch.index);
    const message = PX_WHITELIST.has(value)
      ? `硬编码像素值: ${value}（建议评估是否可 token 化）`
      : `硬编码像素值: ${value}`;
    addIssue(issues, file, line, col, '硬编码尺寸', message, `改为 --ws-gap-* / --ws-radius-* / --ws-text-* 等 token`);
  }

  // 3. 路径混用（仅 JS/CSS）
  const PATH_BACKSLASH_RE = /['"][^'"]*\\[^'"]*['"]/g;
  let pathMatch;
  while ((pathMatch = PATH_BACKSLASH_RE.exec(text)) !== null) {
    const value = pathMatch[0];
    if (PATH_KEYWORDS_WHITELIST.some((kw) => value.includes(kw))) continue;
    if (isInComment(text, pathMatch.index)) continue;

    const { line, col } = findLineCol(text, pathMatch.index);
    addIssue(
      issues,
      file,
      line,
      col,
      '路径规范',
      `路径使用反斜杠: ${value.slice(0, 60)}`,
      `浏览器/ComfyUI 路径统一使用正斜杠 /`
    );
  }

  // 4. i18n 硬编码（JS）
  if (isJS) {
    // 更精确：匹配引号包裹、包含至少 2 个连续汉字或 3 个以上分散汉字的字符串
    const I18N_STRING_RE = /(["'])([^"'\n\r]*[\u4e00-\u9fa5][^"'\n\r]*)\1/g;
    const fallbackIndices = collectI18nFallbackIndices(text);
    let strMatch;
    while ((strMatch = I18N_STRING_RE.exec(text)) !== null) {
      // t("key", "中文兜底") 的兜底参数不算硬编码文案
      if (fallbackIndices.has(strMatch.index)) continue;
      const raw = strMatch[0];
      const inner = strMatch[2];

      // 只包含两个以上汉字
      const chineseChars = inner.match(/[\u4e00-\u9fa5]/g) || [];
      if (chineseChars.length < 2) continue;

      // 过滤：注释中（含跨越注释的字符串匹配）
      if (isInComment(text, strMatch.index)) continue;
      if (/\/\/|\/\*/.test(raw)) continue;

      // 过滤：console / http url / 正则 / 转义序列
      if (/console\./.test(inner) || /^https?:/.test(inner) || /\\[nrt0'"]/.test(inner)) continue;

      // 过滤：包含大量代码符号（说明是代码片段而非文案）
      const codeSymbolRatio = (inner.match(/[{};=<>&|!?+\-*\/\[\]().,:`$]/g) || []).length / inner.length;
      if (codeSymbolRatio > 0.3) continue;

      // 过滤：CSS 选择器中的中文
      if (/^[.#\[\]*a-zA-Z0-9_-]*[\u4e00-\u9fa5]/.test(inner) && /[.#\[\]]/.test(inner)) continue;

      // 过滤：白名单关键词
      if (I18N_TEXT_WHITELIST.some((kw) => inner.includes(kw))) continue;

      // 过滤：纯变量名/属性名含中文（如 node.properties.中文）
      if (/\.[\u4e00-\u9fa5]/.test(inner)) continue;

      const { line, col } = findLineCol(text, strMatch.index);
      addIssue(
        issues,
        file,
        line,
        col,
        'i18n 硬编码',
        `疑似硬编码中文文案: ${raw.slice(0, 50)}`,
        `改为 i18n.t("camelCaseKey") 并从语言包取值`
      );
    }
  }

  // 5. CSS content 文案
  if (isCSS) {
    let contentMatch;
    while ((contentMatch = CSS_CONTENT_RE.exec(text)) !== null) {
      if (isInComment(text, contentMatch.index)) continue;
      const { line, col } = findLineCol(text, contentMatch.index);
      addIssue(
        issues,
        file,
        line,
        col,
        'i18n 硬编码',
        `CSS content 硬编码文案: ${contentMatch[0]}`,
        `避免在 CSS 中写入需要翻译的文案，改用 JS 动态设置`
      );
    }
  }
}

function findUnusedVariables(issues) {
  if (!fs.existsSync(VARIABLES_FILE)) {
    console.warn(`[警告] 未找到 ${VARIABLES_FILE}，跳过未使用变量检查`);
    return;
  }

  const varText = fs.readFileSync(VARIABLES_FILE, 'utf-8');
  const defined = new Map();
  let m;
  while ((m = CSS_VAR_DEF_RE.exec(varText)) !== null) {
    defined.set(m[1], findLineCol(varText, m.index).line);
  }

  const allCSS = collectFiles(CSS_DIRS, ['.css'])
    .map((f) => fs.readFileSync(f, 'utf-8'))
    .join('\n');
  const allJS = collectFiles(JS_DIRS, ['.js'])
    .map((f) => fs.readFileSync(f, 'utf-8'))
    .join('\n');
  const used = new Set();

  while ((m = CSS_VAR_USE_RE.exec(allCSS)) !== null) {
    used.add(m[1]);
  }

  // JS 中可能通过 getComputedStyle、setProperty 或字符串拼接使用变量名
  for (const name of defined.keys()) {
    if (allJS.includes(name)) used.add(name);
  }

  for (const [name, line] of defined) {
    if (used.has(name)) continue;
    if (RESERVED_UNUSED_VARS.has(name)) continue;
    addIssue(
      issues,
      VARIABLES_FILE,
      line,
      1,
      '未使用变量',
      `CSS 变量未在 CSS/JS 中使用: ${name}`,
      `确认是否遗留，考虑删除或补充使用场景`
    );
  }
}

function severity(type) {
  if (['硬编码颜色', 'i18n 硬编码'].includes(type)) return '严重';
  if (['硬编码尺寸', '未使用变量'].includes(type)) return '重要';
  return '优化';
}

function main() {
  const args = process.argv.slice(2);
  const outputJson = args.includes('--json');
  const outputSummary = args.includes('--summary');
  const updateBaseline = args.includes('--update-baseline');
  const strict = args.includes('--strict');

  const issues = [];
  const cssFiles = collectFiles(CSS_DIRS, ['.css']);
  const jsFiles = collectFiles(JS_DIRS, ['.js']);

  for (const file of [...cssFiles, ...jsFiles]) {
    // wosai-variables.css 是令牌定义源文件，不检查硬编码值
    if (file === VARIABLES_FILE) continue;
    lintFile(file, issues);
  }

  findUnusedVariables(issues);

  const summary = {
    totalFiles: cssFiles.length + jsFiles.length,
    cssFiles: cssFiles.length,
    jsFiles: jsFiles.length,
    totalIssues: issues.length,
    severity: {
      严重: issues.filter((i) => severity(i.type) === '严重').length,
      重要: issues.filter((i) => severity(i.type) === '重要').length,
      优化: issues.filter((i) => severity(i.type) === '优化').length,
    },
    byType: {},
    issues,
  };

  for (const issue of issues) {
    summary.byType[issue.type] = (summary.byType[issue.type] || 0) + 1;
  }

  if (updateBaseline) {
    const saved = saveBaseline(summary);
    console.log(
      `lint 基线已更新: ${path.relative(ROOT, BASELINE_FILE)} → ${saved.total} issues ` +
      `(${JSON.stringify(saved.byType)})`
    );
    process.exitCode = 0;
    return;
  }

  const baseline = strict ? emptyBaseline() : loadBaseline();
  const regressions = computeRegressions(summary, baseline);
  summary.baseline = baseline;
  summary.regressions = regressions;

  if (outputJson) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    process.exitCode = regressions.length > 0 ? 1 : 0;
    return;
  }

  if (outputSummary) {
    const verdict = regressions.length > 0 ? 'FAIL' : 'PASS';
    console.log(
      `WOSAI UI lint [${verdict}]: ${summary.totalIssues} issues / 基线 ${baseline.total} ` +
      `(${summary.severity['严重']} critical, ${summary.severity['重要']} important, ${summary.severity['优化']} advisory)`
    );
    if (regressions.length > 0) {
      for (const item of regressions) console.log(`  - 超出基线: ${item}`);
    }
    process.exitCode = regressions.length > 0 ? 1 : 0;
    return;
  }

  console.log('# WOSAI UI Linter 报告\n');
  console.log(`扫描文件: ${summary.totalFiles} 个（CSS ${summary.cssFiles}, JS ${summary.jsFiles}）`);
  console.log(`问题总数: ${summary.totalIssues} 个（棘轮基线 ${baseline.total}）\n`);
  console.log(
    `严重: ${summary.severity['严重']} | 重要: ${summary.severity['重要']} | 优化: ${summary.severity['优化']}\n`
  );

  if (issues.length === 0) {
    console.log('未发现规范违规。');
    process.exit(0);
  }

  // 按文件分组输出前 200 条，避免刷屏
  const byFile = {};
  for (const issue of issues) {
    byFile[issue.file] = byFile[issue.file] || [];
    byFile[issue.file].push(issue);
  }

  let printed = 0;
  const MAX = 200;
  for (const [file, list] of Object.entries(byFile)) {
    if (printed >= MAX) break;
    console.log(`## ${file}`);
    for (const issue of list) {
      if (printed >= MAX) {
        console.log('\n... 问题过多，已截断。使用 --json 查看完整报告。\n');
        break;
      }
      console.log(`- [${severity(issue.type)}] ${issue.type} | L${issue.line}:C${issue.col}`);
      console.log(`  问题: ${issue.message}`);
      console.log(`  建议: ${issue.suggestion}`);
      printed++;
    }
    console.log();
  }

  console.log('## 统计');
  for (const [type, count] of Object.entries(summary.byType)) {
    console.log(`- ${type}: ${count} 处`);
  }
  console.log();

  if (regressions.length === 0) {
    console.log(
      `未超过棘轮基线（当前 ${summary.totalIssues} / 基线 ${baseline.total}），门禁通过；` +
      `仍有历史欠账待偿还，修复后请执行 --update-baseline 下调基线。`
    );
    process.exit(0);
  }

  console.log('## 超出基线（门禁失败）');
  for (const item of regressions) {
    console.log(`- ${item}`);
  }
  process.exit(1);
}

main();
