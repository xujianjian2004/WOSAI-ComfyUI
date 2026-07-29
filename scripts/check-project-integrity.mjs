import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const EXCLUDED_DIRECTORIES = new Set([
    ".git",
    "_ref",
    "build",
    "dist",
    "node_modules",
    "playwright-report",
    "playwright-results",
]);
const TEXT_EXTENSIONS = new Set([
    ".css",
    ".in",
    ".js",
    ".json",
    ".mjs",
    ".py",
    ".toml",
    ".txt",
]);
const issues = [];

async function walk(directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await walk(absolute));
        else files.push(absolute);
    }
    return files;
}

function relative(file) {
    return path.relative(ROOT, file).replaceAll("\\", "/");
}

async function exists(file) {
    try {
        await access(file);
        return true;
    } catch {
        return false;
    }
}

const files = await walk(ROOT);
const textFiles = files.filter((file) => TEXT_EXTENSIONS.has(path.extname(file)));
const sources = new Map();
for (const file of textFiles) {
    const source = await readFile(file, "utf8");
    sources.set(file, source);
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
        if (/[ \t]+$/.test(line)) {
            issues.push(`${relative(file)}:${index + 1} has trailing whitespace`);
        }
    });
}

for (const file of files.filter((entry) => entry.endsWith(".json"))) {
    try {
        JSON.parse(sources.get(file) ?? await readFile(file, "utf8"));
    } catch (error) {
        issues.push(`${relative(file)} is invalid JSON: ${error.message}`);
    }
}

for (const file of files.filter((entry) => /\.(?:js|mjs)$/.test(entry))) {
    const source = sources.get(file);
    const importPattern = /^\s*(?:import|export)\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gm;
    for (const match of source.matchAll(importPattern)) {
        const specifier = match[1].split("?", 1)[0];
        if (!specifier.startsWith(".")) continue;
        const target = path.resolve(path.dirname(file), specifier);
        if (!target.startsWith(`${ROOT}${path.sep}`)) continue;
        if (!await exists(target)) {
            issues.push(`${relative(file)} imports missing file ${specifier}`);
        }
    }
}

const packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
const packageLock = JSON.parse(await readFile(path.join(ROOT, "package-lock.json"), "utf8"));
if (packageLock.version !== packageJson.version) {
    issues.push("package-lock.json version does not match package.json");
}
if (packageLock.packages?.[""]?.version !== packageJson.version) {
    issues.push("package-lock.json root package version does not match package.json");
}

const extension = JSON.parse(await readFile(path.join(ROOT, "extension.json"), "utf8"));
for (const key of ["js", "css"]) {
    const resources = extension[key] ?? [];
    const normalized = resources.map((resource) => resource.split("?", 1)[0]);
    if (new Set(normalized).size !== normalized.length) {
        issues.push(`extension.json contains duplicate ${key} resources`);
    }
    for (const resource of normalized) {
        if (!await exists(path.join(ROOT, resource))) {
            issues.push(`extension.json references missing resource ${resource}`);
        }
    }
}

const requirements = await readFile(path.join(ROOT, "requirements.txt"), "utf8");
const activeRequirements = requirements
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
const pyproject = await readFile(path.join(ROOT, "pyproject.toml"), "utf8");
const dependencyBlock = /\bdependencies\s*=\s*\[([\s\S]*?)\]/m.exec(pyproject)?.[1] ?? "";
const activePyprojectDependencies = [...dependencyBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
if (activeRequirements.length !== activePyprojectDependencies.length) {
    issues.push(
        "requirements.txt and pyproject.toml declare different runtime dependency counts",
    );
}

if (issues.length) {
    for (const issue of issues) console.error(`- ${issue}`);
    process.exitCode = 1;
} else {
    console.log(
        `Project integrity passed: ${files.length} files, `
        + `${files.filter((file) => file.endsWith(".json")).length} JSON documents, `
        + `${extension.js.length} scripts, ${extension.css.length} styles.`,
    );
}
