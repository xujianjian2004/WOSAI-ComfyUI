import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../reset-defaults.js", import.meta.url), "utf8");

test("upgrade migration never clears WOSAI user preferences", () => {
    assert.match(source, /wosai-preferences-preserved-v2/);
    assert.doesNotMatch(source, /\blocalStorage\.removeItem\b/);
    assert.doesNotMatch(source, /\bsetSettingValue\b/);
});
