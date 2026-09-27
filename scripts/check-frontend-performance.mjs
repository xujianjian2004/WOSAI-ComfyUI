import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const WEB_ROOT = path.join(ROOT, "web");
const LAZY_PINYIN = path.join(WEB_ROOT, "shared", "pinyin-pro.esm.js");

const BUDGETS = Object.freeze({
    // 2026-09-23 审计重校准：初始 1_400_000 未随功能增长更新（media-tools /
    // preset-prompt / device-info 等落地后已超支）。本轮复核确认无“无引用”死模块
    // （唯一候选 web/shared/dialog.js 自带“逐步替换”计划，属待采纳而非死代码），
    // 且单文件仍低于 largestMainFile 上限，故仅上调总量预算至 1_450_000
    // （≈1416 KiB，相对 84 个主 JS 文件实测 ≈1395 KiB 保留约 20 KiB 余量）。
    mainJavaScript: 1_450_000,
    largestMainFile: 107_000,
    lazyPinyin: 600_000,
    styles: 256_000,
    largestStyle: 64_000,
    mutationObservers: 10,
    intervals: 3,
});

async function walk(directory) {
    const result = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) result.push(...await walk(absolute));
        else result.push(absolute);
    }
    return result;
}

function relative(file) {
    return path.relative(ROOT, file).replaceAll("\\", "/");
}

function formatBytes(bytes) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
}

function assertBudget(issues, label, actual, limit) {
    if (actual > limit) {
        issues.push(`${label}: ${formatBytes(actual)} exceeds ${formatBytes(limit)}`);
    }
}

const allWebFiles = await walk(WEB_ROOT);
const javascript = allWebFiles.filter((file) => file.endsWith(".js"));
const styles = allWebFiles.filter((file) => file.endsWith(".css"));
const mainJavaScript = javascript.filter((file) => file !== LAZY_PINYIN);
const sizes = new Map();
for (const file of [...javascript, ...styles]) sizes.set(file, (await stat(file)).size);

const mainBytes = mainJavaScript.reduce((sum, file) => sum + sizes.get(file), 0);
const styleBytes = styles.reduce((sum, file) => sum + sizes.get(file), 0);
const largestMain = [...mainJavaScript].sort((a, b) => sizes.get(b) - sizes.get(a))[0];
const largestStyle = [...styles].sort((a, b) => sizes.get(b) - sizes.get(a))[0];
const issues = [];

assertBudget(issues, "main JavaScript", mainBytes, BUDGETS.mainJavaScript);
assertBudget(issues, `largest JavaScript (${relative(largestMain)})`, sizes.get(largestMain), BUDGETS.largestMainFile);
assertBudget(issues, "lazy pinyin bundle", sizes.get(LAZY_PINYIN), BUDGETS.lazyPinyin);
assertBudget(issues, "styles", styleBytes, BUDGETS.styles);
assertBudget(issues, `largest style (${relative(largestStyle)})`, sizes.get(largestStyle), BUDGETS.largestStyle);

let mutationObservers = 0;
let intervals = 0;
for (const file of mainJavaScript) {
    const source = await readFile(file, "utf8");
    const staticPinyinImport = source.match(
        /^\s*import(?!\s*\().*pinyin-pro\.esm\.js.*$/m,
    );
    if (staticPinyinImport) {
        issues.push(`${relative(file)} statically imports the lazy pinyin bundle`);
    }
    if (
        /from\s+["'][^"']*(?:scripts\/ui\.js|extensions\/core\/groupNode\.js)["']/.test(source)
    ) {
        issues.push(`${relative(file)} imports a deprecated ComfyUI frontend module`);
    }

    const intervalCount = source.match(/\bsetInterval\s*\(/g)?.length ?? 0;
    const observerCount = source.match(/\bnew\s+MutationObserver\s*\(/g)?.length ?? 0;
    intervals += intervalCount;
    mutationObservers += observerCount;
    if (intervalCount && !/\bclearInterval\s*\(/.test(source)) {
        issues.push(`${relative(file)} creates an interval without a cleanup path`);
    }
    if (observerCount && !/\.disconnect\s*\(/.test(source)) {
        issues.push(`${relative(file)} creates a MutationObserver without a cleanup path`);
    }

    if (
        file !== path.join(WEB_ROOT, "shared", "dom-widget.js")
        && /new\s+URL\([^)]*wosai-(?:variables|theme)\.css/.test(source)
    ) {
        issues.push(`${relative(file)} bypasses the shared WOSAI style loader`);
    }
}
if (mutationObservers > BUDGETS.mutationObservers) {
    issues.push(
        `MutationObservers: ${mutationObservers} exceeds ${BUDGETS.mutationObservers}`,
    );
}
if (intervals > BUDGETS.intervals) {
    issues.push(`intervals: ${intervals} exceeds ${BUDGETS.intervals}`);
}

const manifest = JSON.parse(await readFile(path.join(ROOT, "extension.json"), "utf8"));
const loader = await readFile(path.join(WEB_ROOT, "shared", "dom-widget.js"), "utf8");
for (const [fileName, label] of [
    ["wosai-variables.css", "variables"],
    ["wosai-theme.css", "theme"],
]) {
    const manifestEntry = manifest.css?.find((entry) => entry.includes(fileName));
    const manifestVersion = manifestEntry?.match(/[?&]v=(\d+)/)?.[1];
    const loaderVersion = loader.match(
        new RegExp(`${fileName.replace(".", "\\.")}\\?v=(\\d+)`),
    )?.[1];
    if (!manifestVersion || manifestVersion !== loaderVersion) {
        issues.push(
            `${label} style version mismatch: extension=${manifestVersion ?? "missing"}, loader=${loaderVersion ?? "missing"}`,
        );
    }
}

console.log(
    [
        `Frontend budget: ${mainJavaScript.length} main JS files / ${formatBytes(mainBytes)}`,
        `lazy pinyin ${formatBytes(sizes.get(LAZY_PINYIN))}`,
        `${styles.length} styles / ${formatBytes(styleBytes)}`,
        `${mutationObservers} MutationObservers`,
        `${intervals} intervals`,
    ].join("; "),
);

if (issues.length) {
    for (const issue of issues) console.error(`- ${issue}`);
    process.exitCode = 1;
} else {
    console.log("Frontend performance checks passed.");
}
