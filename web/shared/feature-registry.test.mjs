import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    FEATURE_CATEGORIES,
    FEATURE_REGISTRY,
    FEATURE_STATUSES,
    getFeature,
    getFeatureLoadAudit,
    getFeaturesByCategory,
    getHubCandidates,
    getPlannedFeatures,
} from "./feature-registry.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function getProjectFiles(directory = root) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) return getProjectFiles(fullPath);
        return [relative(root, fullPath).replaceAll("\\", "/")];
    });
}

function matchesEntry(file, entry) {
    const pattern = entry.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
    return new RegExp(`^${pattern}$`).test(file);
}

test("功能注册清单的 ID、类别和状态均有效", () => {
    const ids = FEATURE_REGISTRY.map((feature) => feature.id);
    assert.equal(new Set(ids).size, ids.length);
    const categories = new Set(Object.values(FEATURE_CATEGORIES));
    for (const feature of FEATURE_REGISTRY) {
        assert.ok(feature.id);
        assert.ok(feature.name);
        assert.ok(categories.has(feature.category));
        assert.ok(FEATURE_STATUSES.includes(feature.status));
        assert.ok(Array.isArray(feature.entry) && feature.entry.length > 0);
        assert.ok(Array.isArray(feature.surfaces));
    }
});

test("HUB 候选项与加载审计可按注册状态筛选", () => {
    assert.ok(getHubCandidates().some((feature) => feature.id === "node-color"));
    assert.equal(getFeature("selection-toolbox")?.status, "active");
    assert.ok(getFeaturesByCategory(FEATURE_CATEGORIES.workflowNodes).length >= 6);
    assert.deepEqual(
        getFeatureLoadAudit().map((feature) => feature.id).sort(),
        [],
    );
    assert.deepEqual(
        getPlannedFeatures().map((feature) => feature.id),
        [],
    );
});

test("功能注册清单中的源码入口均真实存在", () => {
    const projectFiles = getProjectFiles();
    for (const feature of FEATURE_REGISTRY) {
        for (const entry of feature.entry) {
            assert.ok(
                projectFiles.some((file) => matchesEntry(file, entry)),
                `${feature.id} 缺少已注册源码入口: ${entry}`,
            );
        }
    }
});

test("已启用前端功能至少有一个直接入口写入扩展清单", async () => {
    const manifestUrl = new URL("../../extension.json", import.meta.url);
    const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
    const entries = new Set(manifest.js.map((entry) => entry.replace(/\?.*$/, "")));
    for (const feature of FEATURE_REGISTRY) {
        if (feature.status !== "active") continue;
        const directEntrypoints = feature.entry.filter((entry) => entry.startsWith("web/") && entry.endsWith(".js"));
        if (!directEntrypoints.length) continue;
        assert.ok(
            directEntrypoints.some((entry) => entries.has(entry)),
            `${feature.id} 缺少 extension.json 直接入口`,
        );
    }
});
