import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

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

test("所有已注册节点均提供中英文搜索描述", () => {
  const zh = JSON.parse(readFileSync(join(root, "web", "locales", "zh", "nodeDefs.json"), "utf8"));
  const en = JSON.parse(readFileSync(join(root, "web", "locales", "en", "nodeDefs.json"), "utf8"));
  const nodeTypes = getRegisteredNodeTypes();

  assert.ok(nodeTypes.size > 0);
  for (const nodeType of nodeTypes) {
    for (const definitions of [zh, en]) {
      assert.equal(typeof definitions[nodeType]?.description, "string", `${nodeType} 缺少 description`);
      assert.ok(definitions[nodeType].description.trim(), `${nodeType} description 不能为空`);
    }
  }
});
