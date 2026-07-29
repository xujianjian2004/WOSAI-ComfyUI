import { expect, test } from "@playwright/test";

import {
    readNodes2Setting,
    waitForWosai,
    writeNodes2Setting,
} from "./comfy-test-helpers.mjs";

const NODE_COUNT = 180;
const BUDGETS = Object.freeze({
    classicCreateAndSettleMs: 5_000,
    // Nodes 2.0 mounts two Vue-managed custom-widget canvases per node. Its
    // cold-start budget includes that host DOM cost without relaxing the
    // steady-state frame or heap budgets below.
    nodes2CreateAndSettleMs: 6_500,
    frameP95Ms: 150,
    heapGrowthBytes: 160 * 1024 * 1024,
});

async function exerciseNodePressure(page) {
    return page.evaluate(async ({ budgets, nodeCount }) => {
        const app = globalThis.app;
        const LiteGraph = globalThis.LiteGraph;
        app.graph.clear();

        const heapBefore = performance.memory?.usedJSHeapSize ?? null;
        const started = performance.now();
        for (let index = 0; index < nodeCount; index += 1) {
            const node = LiteGraph.createNode("WOSAI_CommonColor");
            if (!node) throw new Error("WOSAI_CommonColor could not be created");
            node.pos = [(index % 15) * 380, Math.floor(index / 15) * 240];
            app.graph.add(node);
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const createAndSettleMs = performance.now() - started;

        const frameDurations = [];
        let previous = performance.now();
        for (let index = 0; index < 45; index += 1) {
            const current = await new Promise((resolve) => requestAnimationFrame(resolve));
            frameDurations.push(current - previous);
            previous = current;
        }
        frameDurations.sort((a, b) => a - b);
        const frameP95Ms = frameDurations[Math.ceil(frameDurations.length * 0.95) - 1];
        const heapAfter = performance.memory?.usedJSHeapSize ?? null;

        const result = {
            createAndSettleMs,
            frameP95Ms,
            heapGrowthBytes: heapBefore == null || heapAfter == null
                ? null
                : Math.max(0, heapAfter - heapBefore),
            nodeCount: app.graph._nodes?.length ?? app.graph.nodes?.length ?? 0,
            budgets,
        };
        app.graph.clear();
        return result;
    }, { budgets: BUDGETS, nodeCount: NODE_COUNT });
}

test("CommonColor stays responsive under Classic and Nodes 2.0 node pressure", async ({ page }, testInfo) => {
    await page.goto("/?wosai_ui_test=performance-bootstrap");
    await waitForWosai(page, ["WOSAI_CommonColor"]);
    const originalMode = await readNodes2Setting(page);

    try {
        for (const [mode, enabled] of [["classic", false], ["nodes2", true]]) {
            await writeNodes2Setting(page, enabled);
            await page.goto(`/?wosai_ui_test=performance-${mode}`);
            await waitForWosai(page, ["WOSAI_CommonColor"]);

            const result = await exerciseNodePressure(page);
            await testInfo.attach(`performance-${mode}.json`, {
                body: Buffer.from(JSON.stringify(result, null, 2)),
                contentType: "application/json",
            });

            expect(result.nodeCount).toBe(NODE_COUNT);
            const createBudget = enabled
                ? BUDGETS.nodes2CreateAndSettleMs
                : BUDGETS.classicCreateAndSettleMs;
            expect(result.createAndSettleMs).toBeLessThan(createBudget);
            expect(result.frameP95Ms).toBeLessThan(BUDGETS.frameP95Ms);
            if (result.heapGrowthBytes != null) {
                expect(result.heapGrowthBytes).toBeLessThan(BUDGETS.heapGrowthBytes);
            }
        }
    } finally {
        await writeNodes2Setting(page, originalMode);
        await page.goto("/?wosai_ui_test=performance-restore");
        await waitForWosai(page, ["WOSAI_CommonColor"]);
    }
});
