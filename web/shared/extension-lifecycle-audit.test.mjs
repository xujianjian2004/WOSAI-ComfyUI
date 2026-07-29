import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB_ROOT = path.join(ROOT, "web");

async function walk(directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await walk(absolute));
        else if (entry.name.endsWith(".js")) files.push(absolute);
    }
    return files;
}

test("extension manifest does not register the same resource twice", async () => {
    const manifest = JSON.parse(await readFile(path.join(ROOT, "extension.json"), "utf8"));
    for (const key of ["js", "css"]) {
        const normalized = manifest[key].map((resource) => resource.split("?")[0]);
        assert.equal(new Set(normalized).size, normalized.length, `${key} contains duplicate resources`);
    }
});

test("hard-coded extension names remain unique", async () => {
    const owners = new Map();
    for (const file of await walk(WEB_ROOT)) {
        const source = await readFile(file, "utf8");
        const pattern = /registerExtension\s*\(\s*\{[\s\S]*?\bname:\s*["']([^"']+)["']/g;
        for (const match of source.matchAll(pattern)) {
            const name = match[1];
            if (owners.has(name)) {
                assert.fail(
                    `${name} is registered by both `
                    + `${path.relative(ROOT, owners.get(name))} and ${path.relative(ROOT, file)}`,
                );
            }
            owners.set(name, file);
        }
    }
    assert.ok(owners.size >= 20, "expected the WOSAI extension catalogue to be audited");
});

test("long-lived observers and intervals expose cleanup paths", async () => {
    const problems = [];
    for (const file of await walk(WEB_ROOT)) {
        const source = await readFile(file, "utf8");
        if (/\bnew\s+MutationObserver\s*\(/.test(source) && !/\.disconnect\s*\(/.test(source)) {
            problems.push(`${path.relative(ROOT, file)}: MutationObserver without disconnect`);
        }
        if (/\bsetInterval\s*\(/.test(source) && !/\bclearInterval\s*\(/.test(source)) {
            problems.push(`${path.relative(ROOT, file)}: interval without clearInterval`);
        }
    }
    assert.deepEqual(problems, []);
});

test("extensions use supported registration callbacks and preserve SaveNode shortcuts", async () => {
    const saveNode = await readFile(path.join(WEB_ROOT, "save-node.js"), "utf8");
    assert.match(saveNode, /\bgetShortcut\s*\(\)\s*\{/);
    assert.doesNotMatch(saveNode, /\bpatchNodeMenu\s*\(/);
    assert.doesNotMatch(saveNode, /const\s+_inst\s*=\s*new\s+WosaiSaveNode/);
    assert.match(saveNode, /_inst\?\.destroy\(\);\s*_inst\s*=\s*null/);

    for (const file of await walk(WEB_ROOT)) {
        const source = await readFile(file, "utf8");
        assert.doesNotMatch(
            source,
            /\bappRegistered\s*[:(]/,
            `${path.relative(ROOT, file)} uses unsupported appRegistered callback`,
        );
    }
});

test("run highlight keeps error expiry and non-running diagnostics reachable", async () => {
    const source = await readFile(path.join(WEB_ROOT, "run-highlight.js"), "utf8");
    assert.match(source, /!isRunning\s*&&\s*!isError\s*&&\s*!isMissingInput/);
    assert.match(source, /lastErrorNodeId\s*=\s*null;\s*errorStartTime\s*=\s*0/);
    assert.match(source, /if\s*\(lastErrorNodeId\s*&&\s*errorHighlightEnabled\)\s*scheduleTick\(0\)/);
    assert.match(source, /const\s+isCurrent\s*=\s*\(\)\s*=>/);
});
