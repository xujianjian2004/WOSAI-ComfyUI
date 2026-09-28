import { performance } from "node:perf_hooks";
import process from "node:process";

// layout-engine 是尚未接入运行时的纯函数地基（见 dev/frontend/README.md），
// 但它的性能预算仍需持续守住，故基准脚本从 dev/ 侧引用。
import { computeLayout } from "../dev/frontend/layout-engine.js";
import { sanitizeSaveNodeData } from "../web/shared/save-node-data.js";
import { match } from "../web/shared/search-engine.js";

const SAMPLE_COUNT = 9;
const WARMUP_COUNT = 2;
const JSON_OUTPUT = process.argv.includes("--json");

const BUDGETS = Object.freeze({
    layout: { median: 180, p95: 360 },
    search: { median: 160, p95: 320 },
    sanitize: { median: 120, p95: 240 },
});

function percentile(values, ratio) {
    const ordered = [...values].sort((a, b) => a - b);
    return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)];
}

function measure(operation) {
    const samples = [];
    for (let index = 0; index < WARMUP_COUNT + SAMPLE_COUNT; index += 1) {
        const started = performance.now();
        operation();
        const duration = performance.now() - started;
        if (index >= WARMUP_COUNT) samples.push(duration);
    }
    return {
        median: percentile(samples, 0.5),
        p95: percentile(samples, 0.95),
        samples,
    };
}

function createLayoutFixture() {
    const nodes = Array.from({ length: 800 }, (_, index) => ({
        id: index,
        w: 180 + (index % 5) * 12,
        h: 90 + (index % 7) * 8,
    }));
    const links = [];
    for (let index = 0; index < nodes.length; index += 1) {
        if (index + 1 < nodes.length) links.push({ from: index, to: index + 1 });
        if (index + 8 < nodes.length) links.push({ from: index, to: index + 8 });
        if (index % 40 === 0 && index + 20 < nodes.length) {
            links.push({ from: index + 20, to: index });
        }
    }
    return { nodes, links };
}

function createSearchFixture() {
    return Array.from({ length: 5000 }, (_, index) => ({
        id: index,
        title: `WOSAI ${index % 11 === 0 ? "品牌橙" : "图像处理"} ${index}`,
        type: `WOSAI_Type_${index % 173}`,
        widgets: [
            { name: "颜色", value: index % 7 === 0 ? "#DD6F4A" : "#242730" },
            { name: "seed", value: index * 31 },
        ],
        properties: { category: `group-${index % 23}`, enabled: index % 2 === 0 },
    }));
}

function createSaveNodeFixture() {
    const categories = Array.from({ length: 100 }, (_, index) => ({
        id: `category-${index}`,
        name: `分类 ${index}`,
        color: index % 2 === 0 ? "#607D8B" : "#DD6F4A",
    }));
    const nodes = Array.from({ length: 2000 }, (_, index) => ({
        type: `WOSAI_Node_${index}`,
        displayName: `节点 ${index}`,
        category: `分类 ${index % 100}`,
        categoryId: `category-${index % 100}`,
        addedAt: 1_700_000_000_000 + index,
        order: index,
        usageCount: index % 31,
        rating: index % 6,
    }));
    return { categories, nodes, defaultFavoritesSeeded: true };
}

const layoutFixture = createLayoutFixture();
const searchFixture = createSearchFixture();
const saveNodeFixture = createSaveNodeFixture();

const results = {
    layout: measure(() => computeLayout(layoutFixture.nodes, layoutFixture.links, {
        anchorX: 0,
        startY: 0,
        hGap: 80,
        vGap: 40,
        islandGap: 100,
    })),
    search: measure(() => {
        for (const query of ["品牌橙", "WOSAI_Type_42", "group-17", "#DD6F4A", "不存在"]) {
            match(searchFixture, query);
        }
    }),
    sanitize: measure(() => sanitizeSaveNodeData(saveNodeFixture)),
};

const failures = [];
for (const [name, result] of Object.entries(results)) {
    const budget = BUDGETS[name];
    if (result.median > budget.median) {
        failures.push(`${name} median ${result.median.toFixed(1)}ms > ${budget.median}ms`);
    }
    if (result.p95 > budget.p95) {
        failures.push(`${name} p95 ${result.p95.toFixed(1)}ms > ${budget.p95}ms`);
    }
}

const report = Object.fromEntries(Object.entries(results).map(([name, result]) => [
    name,
    {
        medianMs: Number(result.median.toFixed(2)),
        p95Ms: Number(result.p95.toFixed(2)),
        budgetMs: BUDGETS[name],
    },
]));

if (JSON_OUTPUT) {
    console.log(JSON.stringify({ benchmarks: report, failures }, null, 2));
} else {
    for (const [name, result] of Object.entries(report)) {
        console.log(
            `${name}: median ${result.medianMs}ms / p95 ${result.p95Ms}ms `
            + `(budgets ${result.budgetMs.median}/${result.budgetMs.p95}ms)`,
        );
    }
}

if (failures.length) {
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
}
