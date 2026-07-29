import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../save-node.js", import.meta.url), "utf8");

test("SaveNode loads the large pinyin search library only when search needs it", () => {
    assert.doesNotMatch(source, /^import\s+.*pinyin-pro\.esm\.js/m);
    assert.match(source, /import\("\.\/shared\/pinyin-pro\.esm\.js"\)/);
    assert.match(source, /ensurePinyinLoaded\(\)/);
});
