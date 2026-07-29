import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const chineseCharacter = /[\u3400-\u9fff]/u;
const latinLetter = /[A-Za-z]/u;

function getRegisteredNodeTypes() {
  const nodesDir = join(root, "nodes");
  const types = new Set();
  for (const file of readdirSync(nodesDir)) {
    if (!file.endsWith(".py")) continue;
    const source = readFileSync(join(nodesDir, file), "utf8");
    for (const mapping of source.matchAll(/NODE_CLASS_MAPPINGS\s*=\s*\{([\s\S]*?)\}/g)) {
      for (const nodeType of mapping[1].matchAll(/"([A-Za-z][A-Za-z0-9_]*)"\s*:/g)) {
        types.add(nodeType[1]);
      }
    }
  }
  return types;
}

test("all registered node titles follow the active locale without mixed languages", () => {
  const zh = JSON.parse(readFileSync(join(root, "web", "locales", "zh", "nodeDefs.json"), "utf8"));
  const en = JSON.parse(readFileSync(join(root, "web", "locales", "en", "nodeDefs.json"), "utf8"));
  const nodeTypes = getRegisteredNodeTypes();

  assert.ok(nodeTypes.size > 0);
  for (const nodeType of nodeTypes) {
    const zhTitle = zh[nodeType]?.display_name;
    const enTitle = en[nodeType]?.display_name;

    assert.equal(typeof zhTitle, "string", `${nodeType} is missing a Chinese display_name`);
    assert.ok(zhTitle.trim(), `${nodeType} Chinese display_name cannot be empty`);
    assert.match(zhTitle, chineseCharacter, `${nodeType} Chinese title must contain Chinese characters`);
    assert.doesNotMatch(zhTitle, latinLetter, `${nodeType} Chinese title must not contain Latin letters`);

    assert.equal(typeof enTitle, "string", `${nodeType} is missing an English display_name`);
    assert.ok(enTitle.trim(), `${nodeType} English display_name cannot be empty`);
    assert.match(enTitle, latinLetter, `${nodeType} English title must contain Latin letters`);
    assert.doesNotMatch(enTitle, chineseCharacter, `${nodeType} English title must not contain Chinese characters`);
  }
});
