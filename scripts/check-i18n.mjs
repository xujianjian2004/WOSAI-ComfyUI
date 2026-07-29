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

if (errors.length) {
  console.error(`i18n check failed with ${errors.length} issue(s).`);
  process.exitCode = 1;
} else {
  const shortLabelCount = Object.keys(locales.en).filter(isShortLabelKey).length;
  console.log(`i18n check passed: ${Object.keys(locales.zh).length} locale keys, ${usedKeys.length} static t() keys, ${nodeTypes.length} WOSAI node types, ${shortLabelCount} compact labels <=${SHORT_LABEL_MAX}.`);
}
