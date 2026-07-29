import { expect, test } from "@playwright/test";

import {
    readNodes2Setting,
    waitForWosai,
    writeNodes2Setting,
} from "./comfy-test-helpers.mjs";

const NODE_TYPE = "WOSAI_PresetPromptSelector";
const NARROW_WIDTH = 260;

async function exerciseNarrowPresetManager(page) {
    return page.evaluate(async ({ nodeType, narrowWidth }) => {
        const app = globalThis.app;
        const LiteGraph = globalThis.LiteGraph;
        app.graph.clear();

        const node = LiteGraph.createNode(nodeType);
        if (!node) throw new Error(`${nodeType} could not be created`);
        node.pos = [160, 120];
        app.graph.add(node);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const presets = Array.from({ length: 12 }, (_, index) => ({
            label: `Responsive preset ${index + 1}`,
            prompt_cn: `中文提示 ${index + 1}`,
            prompt_en: `English prompt ${index + 1}`,
        }));
        const dataWidget = node.widgets?.find((widget) => widget.name === "presets_data");
        if (!dataWidget || !node._wosaiPresetRoot) {
            throw new Error("Preset Manager DOM widget is unavailable");
        }
        const initialPager = node._wosaiPresetRoot.querySelector(".wosai-pp__pager");
        const singlePagePagerHidden = initialPager?.hidden;
        const singlePagePagerDisplay = initialPager
            ? getComputedStyle(initialPager).display
            : null;
        dataWidget.value = JSON.stringify(presets);
        dataWidget.callback?.(dataWidget.value);
        node._wosaiPresetPage = 0;
        node._wosaiPresetRefresh?.();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        node.setSize([narrowWidth, node.size?.[1] ?? 0]);
        node.onResize?.(node.size);
        await new Promise((resolve) => requestAnimationFrame(
            () => requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ));
        await new Promise((resolve) => setTimeout(resolve, 250));

        const root = node._wosaiPresetRoot;
        const pager = root.querySelector(".wosai-pp__pager");
        const constrained = [
            root.querySelector(".wosai-pp__actions"),
            root.querySelector(".wosai-pp__tabs"),
            pager,
        ].filter(Boolean);
        const rect = (element) => {
            const bounds = element.getBoundingClientRect();
            return {
                left: bounds.left,
                right: bounds.right,
                top: bounds.top,
                bottom: bounds.bottom,
                width: bounds.width,
                height: bounds.height,
            };
        };
        const rootRect = rect(root);
        const constrainedRects = constrained.map(rect);
        const pagerRect = rect(pager);
        const domWidget = node._wosaiPresetDomWidget;
        const layout = domWidget?.computeLayoutSize?.();
        const widgetHeight = domWidget?.getHeight?.() ?? 0;
        const widgetTop = Number(domWidget?.last_y ?? domWidget?.y);
        const nodeContainer = root.closest(`[data-node-id="${node.id}"]`);
        const nodeContainerRect = nodeContainer ? rect(nodeContainer) : null;
        const nodeBody = nodeContainer?.querySelector(`[data-testid="node-body-${node.id}"]`);
        const hostBrandFooter = nodeBody?.querySelector(".wosai-pp__host-brand-footer");
        const classicBottomGap = Number.isFinite(widgetTop)
            ? node.size[1] - widgetTop - widgetHeight
            : null;

        return {
            nodeWidth: node.size?.[0],
            singlePagePagerHidden,
            singlePagePagerDisplay,
            rootClientWidth: root.clientWidth,
            rootScrollWidth: root.scrollWidth,
            rootRect,
            nodeBottomGap: nodeContainerRect
                ? nodeContainerRect.bottom - pagerRect.bottom
                : classicBottomGap,
            hostBrandFooterDisplay: hostBrandFooter
                ? getComputedStyle(hostBrandFooter).display
                : null,
            constrainedRects,
            bottomGap: rootRect.bottom - pagerRect.bottom,
            pagerHidden: pager.hidden,
            pageLabel: root.querySelector(".wosai-pp__pager-label")?.textContent,
            tabCount: root.querySelectorAll(".wosai-pp__tab").length,
            layout,
            styleHref: document.getElementById("wosai-preset-prompt-style")?.href,
        };
    }, { nodeType: NODE_TYPE, narrowWidth: NARROW_WIDTH });
}

test("Preset Manager stays inside a manually narrowed node in Classic and Nodes 2.0", async ({ page }) => {
    await page.goto("/?wosai_ui_test=preset-prompt-bootstrap");
    await waitForWosai(page, [NODE_TYPE]);
    const originalMode = await readNodes2Setting(page);

    try {
        for (const [mode, enabled] of [["classic", false], ["nodes2", true]]) {
            await writeNodes2Setting(page, enabled);
            await page.goto(`/?wosai_ui_test=preset-prompt-${mode}`);
            await waitForWosai(page, [NODE_TYPE]);

            const result = await exerciseNarrowPresetManager(page);
            expect(result.nodeWidth).toBe(NARROW_WIDTH);
            expect(result.singlePagePagerHidden).toBe(true);
            expect(result.singlePagePagerDisplay).toBe("none");
            expect(result.pagerHidden).toBe(false);
            expect(result.pageLabel).toBe("1 / 2");
            expect(result.tabCount).toBe(9);
            expect(result.rootScrollWidth).toBeLessThanOrEqual(result.rootClientWidth + 1);
            expect(result.bottomGap).toBeGreaterThanOrEqual(-1);
            expect(result.bottomGap).toBeLessThanOrEqual(12);
            expect(result.nodeBottomGap).toBeGreaterThanOrEqual(0);
            expect(result.nodeBottomGap).toBeLessThanOrEqual(12);
            if (enabled) expect(result.hostBrandFooterDisplay).toBe("none");
            expect(result.layout?.minHeight).toBe(result.layout?.height);
            expect(result.layout?.maxHeight).toBe(result.layout?.height);
            expect(result.styleHref).toContain("preset-prompt.css?v=10");
            for (const bounds of result.constrainedRects) {
                expect(bounds.left).toBeGreaterThanOrEqual(result.rootRect.left - 1);
                expect(bounds.right).toBeLessThanOrEqual(result.rootRect.right + 1);
            }
        }
    } finally {
        await writeNodes2Setting(page, originalMode);
        await page.goto("/?wosai_ui_test=preset-prompt-restore");
        await waitForWosai(page, [NODE_TYPE]);
    }
});
