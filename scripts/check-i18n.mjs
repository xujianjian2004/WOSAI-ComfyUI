#!/usr/bin/env node
/**
 * Validate the WOSAI bilingual i18n contract.
 *
 * Checks:
 *  - every locale JSON layer parses and zh/en key trees stay identical;
 *  - every static t("...") key used by web code exists in both locales;
 *  - every WOSAI node has display_name/description/category metadata in both
 *    nodeDefs files;
 *  - visible English labels stay short enough for compact buttons and menus.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["zh", "en"];
// Keys that are defined in both locales but have no consumer anywhere in the repo
// yet. They are historical leftovers from removed UI; the reverse check below
// fails on any *new* dead key, so this list can only shrink. Entries that stop
// being unused must be deleted from here in the same change.
const UNUSED_KEY_BASELINE = new Set([
  "main.settingsCategories.About WOSAI",
  "main.settingsCategories.Alignment Guides",
  "main.settingsCategories.Auto Breathing",
  "main.settingsCategories.Breathing Brightness",
  "main.settingsCategories.Breathing Period",
  "main.settingsCategories.Breathing Size",
  "main.settingsCategories.Breathing Strength",
  "main.settingsCategories.Breathing on Mouse Move",
  "main.settingsCategories.Canvas Layout",
  "main.settingsCategories.Color Assistant",
  "main.settingsCategories.Copyright",
  "main.settingsCategories.Glow Color",
  "main.settingsCategories.Highlight Border",
  "main.settingsCategories.Hold Mode",
  "main.settingsCategories.Max Slider Count",
  "main.settingsCategories.OmniSlider",
  "main.settingsCategories.Run Highlight",
  "main.settingsCategories.Runtime Display",
  "main.settingsCategories.Show Floating Ball",
  "main.settingsCategories.Time Background Opacity",
  "main.settingsCategories.Time Color",
  "main.settingsCategories.Time Shadow Opacity",
  "main.settingsCategories.WOSAI Custom",
  "menus.colorBar.browserNoEyeDropper",
  "menus.colorBar.colorPicked",
  "menus.colorBar.deleteColorRecord",
  "menus.colorBar.holdModeHint",
  "menus.colorBar.pickColor",
  "menus.colorBar.presetGroupBright",
  "menus.colorBar.presetGroupClassic",
  "menus.colorBar.presetGroupRich",
  "menus.colorBar.presetGroupSoft",
  "menus.colorBar.screenPickColorAndApply",
  "menus.colorBar.showLauncherOff",
  "menus.colorBar.showLauncherOn",
  "menus.colorBar.showLauncherWosaiAssistant",
  "menus.colorBar.themeBright",
  "menus.colorBar.themeClassic",
  "menus.colorBar.themeRich",
  "menus.colorBar.themeSoft",
  "menus.hubBar.bgNotLoaded",
  "menus.hubBar.bypassUnbypass",
  "menus.hubBar.cloneNotLoaded",
  "menus.hubBar.collapseExpand",
  "menus.hubBar.collapsed",
  "menus.hubBar.deleteNotLoaded",
  "menus.hubBar.deleted",
  "menus.hubBar.distributeNotLoaded",
  "menus.hubBar.equalGap",
  "menus.hubBar.expanded",
  "menus.hubBar.favNotLoaded",
  "menus.hubBar.favorite",
  "menus.hubBar.followZoom",
  "menus.hubBar.fxNotLoaded",
  "menus.hubBar.hubSettings",
  "menus.hubBar.jumpNotLoaded",
  "menus.hubBar.launcherNotLoaded",
  "menus.hubBar.lockUnlock",
  "menus.hubBar.manageContextMenu",
  "menus.hubBar.minimize",
  "menus.hubBar.minimizeTooltip",
  "menus.hubBar.more",
  "menus.hubBar.muteUnmute",
  "menus.hubBar.resizeNotLoaded",
  "menus.hubBar.restore",
  "menus.hubBar.restoreTooltip",
  "menus.hubBar.searchNotLoaded",
  "menus.hubBar.settingsNotLoaded",
  "menus.hubBar.tips.align",
  "menus.hubBar.tips.avatar",
  "menus.hubBar.tips.background",
  "menus.hubBar.tips.color",
  "menus.hubBar.tips.favorite",
  "menus.hubBar.tips.followZoom",
  "menus.hubBar.tips.hubConfig",
  "menus.hubBar.tips.link",
  "menus.hubBar.tips.node",
  "menus.hubBar.tips.quickLink",
  "menus.hubBar.tips.settings",
  "menus.hubConfig.actions",
  "menus.hubConfig.actionsHint",
  "menus.hubConfig.behavior",
  "menus.hubConfig.cancel",
  "menus.hubConfig.invert",
  "menus.hubConfig.openSystem",
  "menus.hubConfig.selectAll",
  "menus.hubConfig.system",
  "menus.hubConfig.systemHint",
  "menus.hubConfig.title",
  "menus.launcher.fixedIndicator",
  "menus.launcher.orbTipAlign",
  "menus.launcher.orbTipAvatar",
  "menus.launcher.orbTipBg",
  "menus.launcher.orbTipColor",
  "menus.launcher.orbTipFavorite",
  "menus.launcher.orbTipFx",
  "menus.launcher.orbTipNode",
  "menus.launcher.orbTipSettings",
  "nodes.ignoreGroups.contextMenuSettings",
  "nodes.linkFx.animation",
  "nodes.linkFx.enable",
  "nodes.linkFx.enhanceMode",
  "nodes.linkFx.hlAll",
  "nodes.linkFx.hlNone",
  "nodes.linkFx.linkInteraction",
  "nodes.linkFx.linkZeroHint",
  "nodes.linkFx.onlySelectedLinks",
  "nodes.linkFx.panelTitle",
  "nodes.linkFx.selectedLinkEnhance",
  "nodes.linkFx.style",
  "nodes.presetPrompt.clear",
  "nodes.presetPrompt.clearAll",
  "nodes.presetPrompt.clearConfirmAction",
  "nodes.presetPrompt.clearConfirmMessage",
  "nodes.presetPrompt.clearCurrent",
  "nodes.presetPrompt.clearDone",
  "nodes.presetPrompt.clearMenuHint",
  "nodes.presetPrompt.defaultLabel",
  "nodes.presetPrompt.deselectAll",
  "nodes.presetPrompt.editTitle",
  "nodes.presetPrompt.export",
  "nodes.presetPrompt.exportDone",
  "nodes.presetPrompt.exportHint",
  "nodes.presetPrompt.exportMarkdown",
  "nodes.presetPrompt.import",
  "nodes.presetPrompt.importHint",
  "nodes.presetPrompt.importPaged",
  "nodes.presetPrompt.label",
  "nodes.presetPrompt.nextPage",
  "nodes.presetPrompt.outputAll",
  "nodes.presetPrompt.outputAllDone",
  "nodes.presetPrompt.outputAllHint",
  "nodes.presetPrompt.outputSingle",
  "nodes.presetPrompt.outputSingleDone",
  "nodes.presetPrompt.outputSingleHint",
  "nodes.presetPrompt.presetCount",
  "nodes.presetPrompt.presetCountHint",
  "nodes.presetPrompt.presetCountHintWrapped",
  "nodes.presetPrompt.previousPage",
  "nodes.presetPrompt.renameAction",
  "nodes.presetPrompt.selectAll",
  "nodes.presetPrompt.settings",
  "nodes.presetPrompt.settingsHint",
  "nodes.presetPrompt.settingsTitle",
  "nodes.presetPrompt.syncToNodeWarning",
  "nodes.presetPrompt.tabHint",
  "nodes.presetPrompt.tabHintRename",
  "nodes.selector.activeColor",
  "nodes.selector.appearance",
  "nodes.selector.basic",
  "nodes.selector.buttonHeight",
  "nodes.selector.columns",
  "nodes.selector.custom",
  "nodes.selector.editMenu",
  "nodes.selector.editTitle",
  "nodes.selector.falseLabel",
  "nodes.selector.followTheme",
  "nodes.selector.gap",
  "nodes.selector.inactiveColor",
  "nodes.selector.options",
  "nodes.selector.styleMode",
  "nodes.selector.textColor",
  "nodes.selector.trueLabel",
  "nodes.titleNote.presetRed",
  "nodes.titleNote.rainbowStyle",
  "nodes.titleNote.rainbowToggleTooltip",
  "nodes.titleNote.textColor",
  "nodes.titleNote.transparency",
  "nodes.visualFx.imageBrightness",
  "settings.WOSAI.RunHighlight.Breathing.Auto.name",
  "settings.WOSAI.RunHighlight.Breathing.Brightness.name",
  "settings.WOSAI.RunHighlight.Breathing.Color.name",
  "settings.WOSAI.RunHighlight.Breathing.Enabled.name",
  "settings.WOSAI.RunHighlight.Breathing.PeriodMs.name",
  "settings.WOSAI.RunHighlight.Breathing.Size.name",
  "settings.WOSAI.RunHighlight.Breathing.Strength.name",
  "settings.WOSAI.RunHighlight.Enabled.name",
  "settings.WOSAI.RunHighlight.Time.BgOpacity.name",
  "settings.WOSAI.RunHighlight.Time.Color.name",
  "settings.WOSAI.RunHighlight.Time.Enabled.name",
  "settings.WOSAI.RunHighlight.Time.ShadowOpacity.name",
  "settings.autoTheme",
  "settings.menuHideManage",
  "settings.menuHideNoMatch",
  "widgets.colorTheme.categoryAudio",
  "widgets.colorTheme.categoryDecode",
  "widgets.colorTheme.categoryEncode",
  "widgets.colorTheme.categoryGuide",
  "widgets.colorTheme.categoryImage",
  "widgets.colorTheme.categoryInput",
  "widgets.colorTheme.categoryModel",
  "widgets.colorTheme.categoryOutput",
  "widgets.colorTheme.categoryPrompt",
  "widgets.colorTheme.categorySample",
  "widgets.colorTheme.categoryTool",
  "widgets.colorTheme.categoryVideo",
  "widgets.glassTheme.cycleTip",
  "widgets.settings.about",
  "widgets.settings.auto",
  "widgets.settings.cancel",
  "widgets.settings.category",
  "widgets.settings.copyright",
  "widgets.settings.customize",
  "widgets.settings.dark",
  "widgets.settings.display",
  "widgets.settings.enableExperimental",
  "widgets.settings.experimental",
  "widgets.settings.experimentalTip",
  "widgets.settings.interaction",
  "widgets.settings.language",
  "widgets.settings.light",
  "widgets.settings.panelTitle",
  "widgets.settings.requiresRefresh",
  "widgets.settings.restoreDefaults",
  "widgets.settings.save",
  "widgets.settings.theme",
  "widgets.settings.version",
  "widgets.settings.workflow",
]);

const SHORT_LABEL_MAX = 24;
const CHINESE_CHARACTER = /[\u3400-\u9fff]/u;
const LATIN_LETTER = /[A-Za-z]/u;

// These keys are rendered as labels, menu items, command names, or compact
// settings controls. Descriptions, hints, prompts, confirmations, and toasts
// are intentionally excluded so useful guidance is not truncated.
const SHORT_LABEL_PATTERNS = [
  /^common\.wosai/,
  /^main\.settingsCategories\./,
  /^nodeDefs\.[^.]+\.(category|display_name)$/,
  /^settings\..+\.name$/,
  /^settings\.(autoTheme|showOrb)$/,
  /^menus\.colorBar\.showLauncherWosaiAssistant$/,
  /^menus\.launcher\.(enableAnimation|cycleExpression)$/,
  /^menus\.hubBar\.(minimize|restore|manageContextMenu|manageContextMenuShort|shake|shakeOn|shakeOff)$/,
  /^menus\.hubConfig\.(title|selectAll|openSystem)$/,
  /^menus\.performance\.(title|pan|throttle|shadow|border|radius)$/,
  /^menus\.layoutToolkit\.(resizeAnchor|resizeMax|switchToBar|quickAdvanced|quickCollapse|sectionResize|sectionStretch|contextMenuJump|command[A-Z].*|groupAdvancedColor|distHorizontal|distVertical|quickDist[A-Z].*|dist[HV]Align[A-Z].*)$/,
  /^nodes\.presetPrompt\.(settings|clearCurrent|clearAll|import|export|outputSingle|outputAll)$/,
  /^nodes\.(visualFx\.fixBackground|linkFx\.(chooseTexture|enableSelected))$/,
  /^widgets\.settings\.enableExperimental$/,
  /^saveNode\.batch(SelectAll|Deselect|Move|Delete|Cancel|SelectedCount)$/,
];

function flatten(value, prefix = "") {
  const result = {};
  for (const [key, child] of Object.entries(value ?? {})) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      Object.assign(result, flatten(child, fullKey));
    } else {
      result[fullKey] = child;
    }
  }
  return result;
}

async function listFiles(dir, extension) {
  const result = [];
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (!extension || entry.name.endsWith(extension)) result.push(full);
    }
  }
  await walk(dir);
  return result;
}

async function loadLocale(lang) {
  const dir = path.join(ROOT, "web", "locales", lang);
  const files = (await listFiles(dir, ".json")).sort();
  const flat = {};
  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    let data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      throw new Error(`${path.relative(ROOT, file)}: invalid JSON (${error.message})`, { cause: error });
    }
    Object.assign(flat, flatten(data, path.basename(file, ".json")));
  }
  return flat;
}

function collectStaticTranslationKeys(source) {
  const keys = new Set();
  const pattern = /(?<![\w$.])t\s*\(\s*(["'])([^"']+)\1/g;
  for (const match of source.matchAll(pattern)) keys.add(match[2]);
  return [...keys].filter((key) => !key.endsWith("."));
}

function collectNodeTypes(source) {
  const types = new Set();
  for (const match of source.matchAll(/NODE_CLASS_MAPPINGS\s*=\s*{([\s\S]*?)}/g)) {
    for (const type of match[1].matchAll(/["'](WOSAI_[A-Za-z0-9_]+)["']/g)) types.add(type[1]);
  }
  return [...types].sort();
}

function reportList(title, values) {
  if (!values.length) return;
  console.error(`${title} (${values.length})`);
  for (const value of values) console.error(`  - ${value}`);
}

function isShortLabelKey(key) {
  return SHORT_LABEL_PATTERNS.some((pattern) => pattern.test(key));
}

const errors = [];
const locales = Object.fromEntries(await Promise.all(LOCALES.map(async (lang) => [lang, await loadLocale(lang)])));

const localeKeys = new Set(Object.keys(locales.zh));
const localeParityMissingZh = Object.keys(locales.en).filter((key) => !localeKeys.has(key));
const localeParityMissingEn = [...localeKeys].filter((key) => !(key in locales.en));
if (localeParityMissingZh.length || localeParityMissingEn.length) {
  reportList("Keys missing from zh", localeParityMissingZh);
  reportList("Keys missing from en", localeParityMissingEn);
  errors.push("locale key trees are not identical");
}

const webFiles = await listFiles(path.join(ROOT, "web"), ".js");
const webSource = (await Promise.all(webFiles.map((file) => fs.readFile(file, "utf8")))).join("\n");
const usedKeys = collectStaticTranslationKeys(webSource);
for (const lang of LOCALES) {
  const missing = usedKeys.filter((key) => !(key in locales[lang]));
  if (missing.length) {
    reportList(`Static t() keys missing from ${lang}`, missing);
    errors.push(`static translation keys missing from ${lang}`);
  }
}

const longEnglishLabels = Object.entries(locales.en)
  .filter(([key, value]) => isShortLabelKey(key) && String(value).length > SHORT_LABEL_MAX)
  .map(([key, value]) => `${key} (${String(value).length}): ${value}`);
if (longEnglishLabels.length) {
  reportList(`English labels longer than ${SHORT_LABEL_MAX} characters`, longEnglishLabels);
  errors.push("English compact labels are too long");
}

const nodeFiles = await listFiles(path.join(ROOT, "nodes"), ".py");
const nodeSource = (await Promise.all(nodeFiles.map((file) => fs.readFile(file, "utf8")))).join("\n");
const nodeTypes = collectNodeTypes(nodeSource);
for (const lang of LOCALES) {
  const nodeDefs = Object.fromEntries(
    Object.entries(locales[lang])
      .filter(([key]) => key.startsWith("nodeDefs."))
      .map(([key, value]) => [key.slice("nodeDefs.".length), value]),
  );
  for (const type of nodeTypes) {
    for (const field of ["display_name", "description", "category"]) {
      const key = `${type}.${field}`;
      if (!(key in nodeDefs) || String(nodeDefs[key]).trim() === "") {
        console.error(`nodeDefs.${key} missing from ${lang}`);
        errors.push(`node metadata missing: ${lang}/${key}`);
      }
    }

    const titleKey = `${type}.display_name`;
    const title = String(nodeDefs[titleKey] ?? "").trim();
    if (lang === "zh" && (!CHINESE_CHARACTER.test(title) || LATIN_LETTER.test(title))) {
      console.error(`nodeDefs.${titleKey} must be a pure Chinese title: ${title}`);
      errors.push(`mixed-language Chinese node title: ${type}`);
    }
    if (lang === "en" && (!LATIN_LETTER.test(title) || CHINESE_CHARACTER.test(title))) {
      console.error(`nodeDefs.${titleKey} must be a pure English title: ${title}`);
      errors.push(`mixed-language English node title: ${type}`);
    }
  }
}

// ── Reverse check: keys that nothing consumes ──────────────────────────────
// The正向 check above proves every *used* key exists; this one keeps the locale
// files from accumulating dead weight. Because many keys are assembled at
// runtime (t(`menus.deviceInfo.${k}`), key-name arrays, _t("saveText." + key)),
// a key counts as consumed when either
//   1) its full name appears as a quoted string in web/**/*.{js,mjs,json} or in
//      the Python sources (wosai_core, nodes); or
//   2) a literal prefix of it is concatenated at runtime ("saveText." + key,
//      `nodeDefs.${type}.display_name`).
const consumerFiles = [
  ...(await listFiles(path.join(ROOT, "web"), ".js")),
  ...(await listFiles(path.join(ROOT, "web"), ".mjs")),
  ...(await listFiles(path.join(ROOT, "web"), ".json")).filter((file) => !file.includes(`${path.sep}locales${path.sep}`)),
  ...(await listFiles(path.join(ROOT, "wosai_core"), ".py")),
  ...(await listFiles(path.join(ROOT, "nodes"), ".py")),
];
const consumerSource = (await Promise.all(consumerFiles.map((file) => fs.readFile(file, "utf8")))).join("\n");
const quotedKeys = new Set();
for (const match of consumerSource.matchAll(/["'`]([A-Za-z][\w]*(?:\.[\w]+)+)["'`]/g)) quotedKeys.add(match[1]);
const dynamicPrefixes = new Set();
for (const match of consumerSource.matchAll(/["'`]([A-Za-z][\w]*(?:\.[\w]+)*\.)\$\{/g)) dynamicPrefixes.add(match[1]);
for (const match of consumerSource.matchAll(/["'`]([A-Za-z][\w]*(?:\.[\w]+)*\.)["'`]\s*\+/g)) dynamicPrefixes.add(match[1]);
const prefixList = [...dynamicPrefixes];
const unusedKeys = [...localeKeys]
  .filter((key) => !quotedKeys.has(key) && !prefixList.some((prefix) => key.startsWith(prefix)))
  .sort();
const newDeadKeys = unusedKeys.filter((key) => !UNUSED_KEY_BASELINE.has(key));
if (newDeadKeys.length) {
  reportList("Unused i18n keys not covered by the baseline", newDeadKeys);
  errors.push("new unused i18n keys detected");
}
const staleBaseline = [...UNUSED_KEY_BASELINE].filter((key) => !unusedKeys.includes(key));
if (staleBaseline.length) {
  reportList("Baseline entries that are used again (drop them from the baseline)", staleBaseline);
  errors.push("i18n unused-key baseline is stale");
}

if (errors.length) {
  console.error(`i18n check failed with ${errors.length} issue(s).`);
  process.exitCode = 1;
} else {
  const shortLabelCount = Object.keys(locales.en).filter(isShortLabelKey).length;
  console.log(`i18n check passed: ${Object.keys(locales.zh).length} locale keys, ${usedKeys.length} static t() keys, ${nodeTypes.length} WOSAI node types, ${shortLabelCount} compact labels <=${SHORT_LABEL_MAX}, ${unusedKeys.length} unused keys (${newDeadKeys.length} new).`);
}
