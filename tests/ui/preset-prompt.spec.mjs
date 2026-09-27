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
        dataWidget.value = JSON.stringify(presets);
        dataWidget.callback?.(dataWidget.value);
        node._wosaiPresetRefresh?.();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        node.setSize([narrowWidth, node.size?.[1] ?? 0]);
        node.onResize?.(node.size);
        await new Promise((resolve) => requestAnimationFrame(
            () => requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ));
        await new Promise((resolve) => setTimeout(resolve, 250));

        const root = node._wosaiPresetRoot;
        const constrained = [
            root.querySelector(".wosai-pp__actions"),
            root.querySelector(".wosai-pp__tabs"),
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
        const tabsRect = rect(root.querySelector(".wosai-pp__tabs"));
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
            rootClientWidth: root.clientWidth,
            rootScrollWidth: root.scrollWidth,
            rootRect,
            nodeBottomGap: nodeContainerRect
                ? nodeContainerRect.bottom - tabsRect.bottom
                : classicBottomGap,
            hostBrandFooterDisplay: hostBrandFooter
                ? getComputedStyle(hostBrandFooter).display
                : null,
            constrainedRects,
            bottomGap: rootRect.bottom - tabsRect.bottom,
            pagerExists: Boolean(root.querySelector(".wosai-pp__pager")),
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
            expect(result.pagerExists).toBe(false);
            expect(result.tabCount).toBe(9);
            expect(result.rootScrollWidth).toBeLessThanOrEqual(result.rootClientWidth + 1);
            expect(result.bottomGap).toBeGreaterThanOrEqual(-1);
            expect(result.bottomGap).toBeLessThanOrEqual(12);
            expect(result.nodeBottomGap).toBeGreaterThanOrEqual(0);
            expect(result.nodeBottomGap).toBeLessThanOrEqual(12);
            if (enabled) expect(result.hostBrandFooterDisplay).toBe("none");
            expect(result.layout?.minHeight).toBe(result.layout?.height);
            expect(result.layout?.maxHeight).toBe(result.layout?.height);
            expect(result.styleHref).toContain("preset-prompt.css?v=46");
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

test("Preset Manager hides backend-only controls and blocks the canvas menu in Nodes 2.0", async ({ page }) => {
    await page.goto("/?wosai_ui_test=preset-prompt-native-hide-bootstrap");
    await waitForWosai(page, [NODE_TYPE]);
    const originalMode = await readNodes2Setting(page);

    try {
        await writeNodes2Setting(page, true);
        await page.goto("/?wosai_ui_test=preset-prompt-native-hide-nodes2");
        await waitForWosai(page, [NODE_TYPE]);

        const result = await page.evaluate(async (nodeType) => {
            const node = globalThis.LiteGraph.createNode(nodeType);
            globalThis.app.graph.add(node);
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            await new Promise((resolve) => setTimeout(resolve, 250));

            const container = Array.from(document.querySelectorAll("[data-node-id]")).find((element) => (
                element.dataset.nodeId === String(node.id)
            ));
            if (!container) throw new Error("Nodes 2.0 container was not rendered");
            const manager = container.querySelector(".wosai-pp");
            const managerBounds = manager?.getBoundingClientRect();
            const exportButton = manager?.querySelector("[data-wosai-export]");
            exportButton?.click();
            const exportMenu = document.querySelector("[data-wosai-export-menu]");
            const clearButton = manager?.querySelector("[data-wosai-clear]");
            clearButton?.click();
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const categoriesPanel = manager?.querySelector(".wosai-pp__categories");
            const tabsPanel = manager?.querySelector(".wosai-pp__tabs");
            const hiddenNativeNames = ["active_index", "presets_data"];
            const nativeControls = hiddenNativeNames.flatMap((name) => Array.from(container.querySelectorAll([
                `[aria-label="${name}"]`,
                `[name="${name}"]`,
                `[data-path*="${name}"]`,
                `[data-testid*="${name}"]`,
            ].join(", "))));
            const visibleNativeControlCount = nativeControls.filter((element) => {
                const bounds = element.getBoundingClientRect();
                return !element.closest(".wosai-pp")
                    && getComputedStyle(element).display !== "none"
                    && bounds.width > 0
                    && bounds.height > 0;
            }).length;
            const nativePromptRows = Array.from(container.querySelectorAll("textarea"))
                .map((textarea) => textarea.closest('[data-testid="node-widget"]'))
                .filter((row, index, rows) => row && rows.indexOf(row) === index);
            const visibleNativePromptEditors = nativePromptRows.filter((row) => {
                const bounds = row.getBoundingClientRect();
                return getComputedStyle(row).display !== "none" && bounds.width > 0 && bounds.height > 0;
            }).length;
            const visiblePromptInputSlots = nativePromptRows.filter((row) => {
                const slot = row.querySelector(".lg-slot--input");
                const bounds = slot?.getBoundingClientRect();
                return Boolean(slot)
                    && getComputedStyle(slot).display !== "none"
                    && (bounds?.width ?? 0) > 0
                    && (bounds?.height ?? 0) > 0;
            }).length;
            const contextMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
            const dispatched = manager?.dispatchEvent(contextMenu);
            return {
                managerDisplay: manager ? getComputedStyle(manager).display : null,
                managerHeight: managerBounds?.height ?? 0,
                tabCount: manager?.querySelectorAll(".wosai-pp__tab").length ?? 0,
                categoryCount: manager?.querySelectorAll(".wosai-pp__category").length ?? 0,
                tabHeights: Array.from(manager?.querySelectorAll(".wosai-pp__tab") ?? [])
                    .map((tab) => Number.parseFloat(getComputedStyle(tab).height)),
                categoryTabsBottomDifference: Math.abs(
                    (categoriesPanel?.getBoundingClientRect().bottom ?? 0)
                    - (tabsPanel?.getBoundingClientRect().bottom ?? 0),
                ),
                actionCount: manager?.querySelectorAll(".wosai-pp__actions > button").length ?? 0,
                outputToggleExists: Boolean(manager?.querySelector(".wosai-pp__mode")),
                exportFormats: Array.from(exportMenu?.querySelectorAll("[data-wosai-export-format]") ?? [])
                    .map((button) => button.dataset.wosaiExportFormat),
                clearIsDirect: !clearButton?.hasAttribute("aria-haspopup"),
                placeholderCategories: Array.from(manager?.querySelectorAll(".wosai-pp__category-label") ?? [])
                    .map((label) => label.textContent),
                placeholderPresets: Array.from(manager?.querySelectorAll(".wosai-pp__tab-label") ?? [])
                    .map((label) => label.textContent),
                backendWidgetsHidden: hiddenNativeNames.every((name) => node.widgets.find((widget) => widget.name === name)?.hidden),
                visibleNativeControlCount,
                visibleNativePromptEditors,
                visiblePromptInputSlots,
                contextMenuBlocked: dispatched === false && contextMenu.defaultPrevented,
            };
        }, NODE_TYPE);

        expect(result.managerDisplay).not.toBe("none");
        expect(result.managerHeight).toBeGreaterThan(0);
        expect(result.tabCount).toBe(9);
        expect(result.categoryCount).toBeGreaterThan(1);
        expect(Math.min(...result.tabHeights)).toBeGreaterThanOrEqual(44);
        expect(result.actionCount).toBe(4);
        expect(result.outputToggleExists).toBe(false);
        expect(result.exportFormats).toEqual(["json", "md"]);
        expect(result.clearIsDirect).toBe(true);
        expect(result.placeholderCategories[0]).toBe("分类1");
        expect(result.placeholderCategories).toHaveLength(6);
        expect(result.placeholderPresets).toEqual(["预设1", "预设2", "预设3", "预设4", "预设5", "预设6", "预设7", "预设8", "预设9"]);
        expect(result.backendWidgetsHidden).toBe(true);
        expect(result.visibleNativeControlCount).toBe(0);
        expect(result.visibleNativePromptEditors).toBe(2);
        expect(result.visiblePromptInputSlots).toBe(2);
        expect(result.contextMenuBlocked).toBe(true);
    } finally {
        await writeNodes2Setting(page, originalMode);
        await page.goto("/?wosai_ui_test=preset-prompt-native-hide-restore");
        await waitForWosai(page, [NODE_TYPE]);
    }
});
