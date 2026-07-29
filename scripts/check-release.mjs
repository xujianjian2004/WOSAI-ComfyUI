import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const requiredFiles = [
    "CHANGELOG.md",
    "docs/RELEASE_CHECKLIST.md",
    "workflows/WOSAI_frontend_compat_test.json",
    "MANIFEST.in",
    "scripts/build_release.py",
    "scripts/verify_release.py",
    "presets/color_presets.json",
];
const issues = [];

for (const file of requiredFiles) {
    try {
        await access(path.join(ROOT, file));
    } catch {
        issues.push(`missing release artifact: ${file}`);
    }
}

const packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
const extension = JSON.parse(await readFile(path.join(ROOT, "extension.json"), "utf8"));
const changelog = await readFile(path.join(ROOT, "CHANGELOG.md"), "utf8");
const checklist = await readFile(
    path.join(ROOT, "docs", "RELEASE_CHECKLIST.md"),
    "utf8",
);
const manifest = await readFile(path.join(ROOT, "MANIFEST.in"), "utf8");
const workflow = JSON.parse(
    await readFile(
        path.join(ROOT, "workflows", "WOSAI_frontend_compat_test.json"),
        "utf8",
    ),
);

if (extension.version !== packageJson.version) {
    issues.push(
        `extension/package version mismatch: ${extension.version} / ${packageJson.version}`,
    );
}
if (!changelog.includes(`## [${packageJson.version}]`)) {
    issues.push(`CHANGELOG.md has no ${packageJson.version} release section`);
}
if (!/Classic/.test(checklist) || !/Nodes 2\.0/.test(checklist)) {
    issues.push("release checklist must cover both Classic and Nodes 2.0");
}
if (!manifest.includes("CHANGELOG.md")) {
    issues.push("MANIFEST.in does not include CHANGELOG.md");
}
if (!manifest.includes("recursive-include presets *.json")) {
    issues.push("MANIFEST.in does not include runtime color presets");
}

const nodes = new Map(workflow.nodes?.map((node) => [node.id, node]) ?? []);
const commonColor = [...nodes.values()].find(
    (node) => node.type === "WOSAI_CommonColor",
);
const emptyImage = [...nodes.values()].find((node) => node.type === "EmptyImage");
const colorLink = workflow.links?.find(
    (link) => (
        link[1] === commonColor?.id
        && link[2] === 0
        && link[3] === emptyImage?.id
        && link[4] === 3
        && link[5] === "INT"
    ),
);
if (!commonColor || !emptyImage || !colorLink) {
    issues.push("compatibility workflow does not connect CommonColor INT to EmptyImage color");
}

for (const resource of [...(extension.js ?? []), ...(extension.css ?? [])]) {
    const localPath = resource.split("?", 1)[0];
    try {
        await access(path.join(ROOT, localPath));
    } catch {
        issues.push(`extension resource does not exist: ${localPath}`);
    }
}

if (issues.length) {
    for (const issue of issues) console.error(`- ${issue}`);
    process.exitCode = 1;
} else {
    console.log(
        `Release checks passed for ${packageJson.version}: `
        + `${workflow.nodes.length} compatibility nodes, `
        + `${extension.js.length} scripts, ${extension.css.length} styles.`,
    );
}
