import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function source(relativePath) {
    return fs.readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

test("applyGlassBar uses opaque surface background and no backdrop blur", () => {
    const code = source("../shared/hud-kit.js");
    const match = code.match(/export function applyGlassBar\(el, orient = 'h'\) \{[\s\S]*?el\.style\.cssText = `([^`]+)`;/);
    assert.ok(match, "applyGlassBar inline style template not found");
    const style = match[1];

    assert.match(style, /background:\s*var\(--ws-surface\)/);
    assert.doesNotMatch(style, /backdrop-filter:\s*var\(--/);
    assert.doesNotMatch(style, /-webkit-backdrop-filter:\s*var\(--/);
    assert.match(style, /backdrop-filter:\s*none/);
    assert.match(style, /-webkit-backdrop-filter:\s*none/);
});
