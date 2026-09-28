// 前端资源可达性守卫。
//
// 背景：前端体积预算按「`web/` 下所有 `.js` 的磁盘字节」统计，但用户真正付出的是
// 「启动时被解析执行的字节」。两者一旦脱节，就会积累出「随包发布、永不加载」的模块——
// 既占预算余量，又是无声的架构腐化。
//
// 本测试把两者对齐，断言 `web/` 下每个 `.js` 都能从 `extension.json` 出发被解释：
//   · 启动闭包：入口 + 其**静态** import 的传递闭包（页面加载即解析）
//   · 按需闭包：启动闭包中出现的**动态** import(`…`) 及其静态传递闭包（首次使用时才取）
// 两者都到不了的模块即为死重，必须删除或移出 `web/`（见 dev/frontend/README.md）。
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB_ROOT = join(ROOT, "web");

function walk(directory) {
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...walk(absolute));
        else if (entry.name.endsWith(".js")) files.push(absolute);
    }
    return files;
}

const sources = new Map(walk(WEB_ROOT).map((file) => [file, readFileSync(file, "utf8")]));
const rel = (file) => relative(ROOT, file).split("\\").join("/");

/** 静态 import / export-from 的相对目标（排除动态 `import()`）。 */
function staticDependencies(file) {
    const source = sources.get(file) ?? "";
    const specs = [
        ...source.matchAll(/^\s*(?:import|export)\b[\s\S]*?\bfrom\s*["']([^"']+)["']/gm),
        ...source.matchAll(/^\s*import\s*["']([^"']+)["']/gm),
    ];
    return specs
        .map((match) => match[1].split("?", 1)[0])
        .filter((spec) => spec.startsWith("."))
        .map((spec) => resolve(dirname(file), spec))
        .filter((target) => sources.has(target));
}

/** 动态 `import("…")` 的相对目标。 */
function dynamicDependencies(file) {
    const source = sources.get(file) ?? "";
    return [...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)]
        .map((match) => match[1].split("?", 1)[0])
        .filter((spec) => spec.startsWith("."))
        .map((spec) => resolve(dirname(file), spec))
        .filter((target) => sources.has(target));
}

function closure(seeds, blocked = new Set()) {
    const seen = new Set();
    const queue = [...seeds];
    while (queue.length) {
        const file = queue.pop();
        if (seen.has(file) || blocked.has(file)) continue;
        seen.add(file);
        queue.push(...staticDependencies(file));
    }
    return seen;
}

const manifest = JSON.parse(readFileSync(join(ROOT, "extension.json"), "utf8"));
const entries = (manifest.js ?? [])
    .map((entry) => resolve(ROOT, entry.split("?", 1)[0]))
    .filter((file) => sources.has(file));

const startup = closure(entries);
const onDemand = closure(
    [...startup].flatMap((file) => dynamicDependencies(file)),
    startup,
);

test("web/ 下每个 .js 都能从 extension.json 可达（启动闭包或按需闭包）", () => {
    const unreachable = [...sources.keys()]
        .filter((file) => !startup.has(file) && !onDemand.has(file))
        .map(rel)
        .sort();
    assert.deepEqual(
        unreachable,
        [],
        "以下模块随包发布但永不加载，应删除或移出 web/（未接线的地基放 dev/frontend/）:\n"
        + unreachable.map((file) => `  - ${file}`).join("\n"),
    );
});

test("extension.json 声明的 JS 入口全部存在于 web/ 且非空", () => {
    assert.ok(entries.length >= 20, `期望至少 20 个入口，实际 ${entries.length}`);
    for (const entry of manifest.js ?? []) {
        const target = resolve(ROOT, entry.split("?", 1)[0]);
        assert.ok(sources.has(target), `extension.json 入口缺少文件: ${entry}`);
        assert.ok((sources.get(target) ?? "").trim().length > 0, `${entry} 是空文件`);
    }
});

test("按需闭包保持最小：仅第三方大库可豁免启动解析", () => {
    // pinyin-pro 是唯一被接受的「按需」第三方面板依赖；其余模块都应在启动时接线，
    // 否则会出现「能连但功能未就绪」的中间态。
    const allowed = new Set(["web/shared/pinyin-pro.esm.js"]);
    const unexpected = [...onDemand].map(rel).filter((file) => !allowed.has(file)).sort();
    assert.deepEqual(unexpected, [], `以下模块被按需加载但未登记豁免: ${unexpected.join(", ")}`);
});

test("未接线的前端地基不得被运行时模块 import", () => {
    const devOnly = ["layout-engine.js", "layout-geometry.js", "feature-registry.js"];
    const offenders = [];
    for (const [file, source] of sources) {
        for (const name of devOnly) {
            // 只关心 `./…name` 形式的真实导入，忽略注释里提到的名字
            const pattern = new RegExp(`^\\s*(?:import|export)[^\\n]*from\\s*["'][^"']*${name.replace(".", "\\.")}["']`, "m");
            if (pattern.test(source)) offenders.push(`${rel(file)} → ${name}`);
        }
    }
    assert.deepEqual(
        offenders,
        [],
        `运行时模块引用了 dev/frontend/ 的未接线地基，应把该模块移回 web/shared/ 后再接线:\n`
        + offenders.map((line) => `  - ${line}`).join("\n"),
    );
});
