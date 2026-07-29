/**
 * 真实 ComfyUI 静态资源回归：在已启动的宿主上验证 WOSAI 扩展资源可加载。
 * 用法：npm run test:comfy
 * 可选：COMFY_URL=http://127.0.0.1:8188 COMFY_EXTENSION_BASE=/extensions/WOSAI-ComfyUI/
 */
import { readdir, readFile } from "node:fs/promises";

const baseUrl = (process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
const extensionBase = process.env.COMFY_EXTENSION_BASE || "/extensions/WOSAI-ComfyUI/";
const manifest = JSON.parse(await readFile(new URL("../extension.json", import.meta.url), "utf8"));
const extensionRoot = new URL(
    extensionBase.endsWith("/") ? extensionBase : `${extensionBase}/`,
    `${baseUrl}/`,
);

async function assertFetchUrl(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    const body = await response.text();
    if (!body.trim()) throw new Error(`空响应：${url}`);
    return body;
}

async function assertFetch(path) {
    return assertFetchUrl(new URL(path.replace(/^\//, ""), extensionRoot));
}

const moduleBodies = new Map();
async function fetchExtensionModule(pathOrUrl) {
    const url = pathOrUrl instanceof URL ? pathOrUrl : new URL(pathOrUrl, extensionRoot);
    const key = url.href;
    if (moduleBodies.has(key)) return moduleBodies.get(key);
    const body = await assertFetchUrl(url);
    moduleBodies.set(key, body);

    const importSource = body
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
    const specifiers = new Set();
    for (const pattern of [
        /(?:^|[;\n])\s*import\s+["']([^"']+)["']/gm,
        /\bfrom\s+["']([^"']+)["']/g,
        /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    ]) {
        for (const match of importSource.matchAll(pattern)) specifiers.add(match[1]);
    }
    for (const specifier of specifiers) {
        const child = new URL(specifier, url);
        if (
            child.origin === extensionRoot.origin
            && child.pathname.startsWith(extensionRoot.pathname)
        ) {
            await fetchExtensionModule(child);
        }
    }
    return body;
}

const stats = await fetch(`${baseUrl}/system_stats`);
if (!stats.ok) throw new Error(`ComfyUI 未就绪：${stats.status}`);

for (const entry of manifest.js) {
    const path = entry.replace(/^web\//, "").replace(/\?.*$/, "");
    const body = await fetchExtensionModule(path);
    if (!body.includes("import ") && !body.includes("app.registerExtension") && !body.includes("export ")) {
        throw new Error(`扩展脚本不是有效 ES 模块：${entry}`);
    }
}
for (const style of manifest.css) await assertFetch(style.replace(/^web\//, ""));

// 运行时按需注入的样式不一定出现在扩展清单中，必须同时校验，防止目录迁移后留下 404。
const webDir = new URL("../web/", import.meta.url);
const runtimeStyles = new Set();
for (const dirent of await readdir(webDir, { withFileTypes: true })) {
    if (!dirent.isFile() || !dirent.name.endsWith(".js")) continue;
    const source = await readFile(new URL(dirent.name, webDir), "utf8");
    for (const match of source.matchAll(/\/extensions\/WOSAI-ComfyUI\/(styles\/[^"'`]+\.css(?:\?[^"'`]*)?)/g)) runtimeStyles.add(match[1]);
    for (const match of source.matchAll(/new URL\(\s*["']\.\/(styles\/[^"']+\.css(?:\?[^"']*)?)["']\s*,\s*import\.meta\.url\s*\)/g)) runtimeStyles.add(match[1]);
}
for (const style of runtimeStyles) await assertFetch(style);

console.log(
    `ComfyUI 双前端资源回归通过：${manifest.js.length} 个入口、`
    + `${moduleBodies.size} 个递归模块、${manifest.css.length} 个清单样式、`
    + `${runtimeStyles.size} 个运行时样式。`,
);
