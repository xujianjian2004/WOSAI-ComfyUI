import { expect, test } from "@playwright/test";

import { waitForWosai } from "./comfy-test-helpers.mjs";

test("repeated host reloads keep WOSAI resources and widgets singular", async ({ page }, testInfo) => {
    const failures = [];
    page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
        if (message.type() === "error" && /wosai/i.test(message.text())) {
            failures.push(`console: ${message.text()}`);
        }
    });

    for (let iteration = 0; iteration < 3; iteration += 1) {
        await page.goto(`/?wosai_ui_test=hot-reload-${iteration}`);
        await waitForWosai(page, ["WOSAI_CommonColor"]);

        const state = await page.evaluate(async () => {
            const app = globalThis.app;
            const node = globalThis.LiteGraph.createNode("WOSAI_CommonColor");
            app.graph.clear();
            app.graph.add(node);
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const customWidgets = node.widgets?.filter((widget) => (
                ["color_name", "custom_color"].includes(widget._wosaiOrigName || widget.name)
            )).length ?? 0;
            const result = {
                variablesStyles: document.querySelectorAll("#wosai-vars-link").length,
                themeStyles: document.querySelectorAll("#wosai-theme-css").length,
                selectionStyles: document.querySelectorAll("#wosai-selection-toolbox-captions").length,
                launchers: document.querySelectorAll("[data-wosai-panel] .wso-root").length,
                customWidgets,
            };
            app.graph.clear();
            return result;
        });

        await testInfo.attach(`hot-reload-${iteration}.json`, {
            body: Buffer.from(JSON.stringify(state, null, 2)),
            contentType: "application/json",
        });
        expect(state.variablesStyles).toBe(1);
        expect(state.themeStyles).toBe(1);
        expect(state.selectionStyles).toBeLessThanOrEqual(1);
        expect(state.launchers).toBeLessThanOrEqual(1);
        expect(state.customWidgets).toBe(2);
    }

    expect(failures).toEqual([]);
});
