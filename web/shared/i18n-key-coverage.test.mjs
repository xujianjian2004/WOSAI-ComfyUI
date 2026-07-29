import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const layers = ["common", "nodes", "widgets", "menus", "settings", "main", "nodeDefs", "saveNode", "saveText"];

function getJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) return getJavaScriptFiles(fullPath);
    return entry.name.endsWith(".js") ? [fullPath] : [];
  });
}

function flattenKeys(value, prefix = "", output = new Set()) {
  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) flattenKeys(child, fullKey, output);
    else output.add(fullKey);
  }
  return output;
}

function getLocaleKeys(language) {
  const locale = {};
  for (const layer of layers) {
    const file = join(root, "web", "locales", language, `${layer}.json`);
    if (existsSync(file)) locale[layer] = JSON.parse(readFileSync(file, "utf8"));
  }
  return flattenKeys(locale);
}

function getLiteralTranslationKeys() {
  const keys = new Set();
  const callPattern = /\bt\(\s*["']([A-Za-z0-9_.-]+)["']/g;
  for (const file of getJavaScriptFiles(join(root, "web"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(callPattern)) {
      if (!match[1].endsWith(".")) keys.add(match[1]);
    }
  }
  return keys;
}

test("静态 i18n 调用在中英文语言包中均有对应词条", () => {
  const zh = getLocaleKeys("zh");
  const en = getLocaleKeys("en");
  for (const key of getLiteralTranslationKeys()) {
    assert.ok(zh.has(key), `中文语言包缺少 ${key}`);
    assert.ok(en.has(key), `英文语言包缺少 ${key}`);
  }
});

test("中英文语言包的词条结构保持一致", () => {
  const zh = getLocaleKeys("zh");
  const en = getLocaleKeys("en");
  assert.deepEqual([...zh].sort(), [...en].sort());
});
