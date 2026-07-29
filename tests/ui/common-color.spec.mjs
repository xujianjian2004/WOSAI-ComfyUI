import { expect, test } from "@playwright/test";
import {
    readNodes2Setting,
    waitForWosai,
    writeNodes2Setting,
} from "./comfy-test-helpers.mjs";

const I18N_MODULE_URL = "/extensions/WOSAI-ComfyUI/shared/i18n.js";

async function readWosaiLanguage(page) {
    return page.evaluate(async (url) => (await import(url)).getCurrentLang(), I18N_MODULE_URL);
}

async function writeWosaiLanguage(page, language) {
    await page.evaluate(async ({ url, language: nextLanguage }) => {
        await (await import(url)).setLang(nextLanguage);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, { url: I18N_MODULE_URL, language });
}

async function exerciseCommonColor(page) {
    return page.evaluate(async () => {
        const app = globalThis.app;
        const LiteGraph = globalThis.LiteGraph;
        app.graph.clear();

        const colorNode = LiteGraph.createNode("WOSAI_CommonColor");
        const emptyImage = LiteGraph.createNode("EmptyImage");
        if (!colorNode || !emptyImage) throw new Error("Required node type is unavailable");
        colorNode.pos = [120, 140];
        emptyImage.pos = [620, 140];
        app.graph.add(colorNode);
        app.graph.add(emptyImage);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const preset = colorNode.widgets?.find((widget) => (
            (widget._wosaiOrigName || widget.name) === "color_name"
        ));
        const preview = colorNode.widgets?.find((widget) => (
            (widget._wosaiOrigName || widget.name) === "custom_color"
        ));
        if (!preset || !preview) throw new Error("CommonColor widgets were not created");

        const capture = (widget) => {
            const texts = [];
            const context = {
                beginPath() {},
                moveTo() {},
                arcTo() {},
                closePath() {},
                fill() {},
                stroke() {},
                lineTo() {},
                fillText(text, x, y) { texts.push({ text, x, y }); },
                set fillStyle(_value) {},
                set strokeStyle(_value) {},
                set lineWidth(_value) {},
                set font(_value) {},
                set textBaseline(_value) {},
                set textAlign(_value) {},
            };
            widget.draw(context, colorNode, 360, 0);
            return texts;
        };

        const presetSize = preset.computeSize(360);
        const previewSize = preview.computeSize(360);
        const presetText = capture(preset);
        const previewText = capture(preview);

        // Nodes 2.0 may expose a zoom-scaled node.size even though widget
        // pointer positions remain in draw coordinates. The visible arrow
        // must use the latter coordinate system.
        colorNode.size[0] = 640;
        preset.mouse(
            { type: "pointerdown", clientX: 450, clientY: 260 },
            [350, 10],
            colorNode,
        );
        const steppedValue = preset.value;
        const steppedColor = preview.value;

        preset.mouse(
            { type: "pointerdown", clientX: 450, clientY: 260 },
            [preset._wosaiDrawWidth / 2, 10],
            colorNode,
        );
        const menu = document.querySelector(".wosai-color-preset-menu");
        const menuLabels = [...(menu?.querySelectorAll("button") || [])].map(
            (button) => button.textContent.trim(),
        );
        const hubOption = menu?.querySelector('[data-preset-value="HUB紫"]');
        hubOption?.click();
        const selectedValue = preset.value;
        const selectedColor = preview.value;

        preview.mouse(
            { type: "pointerdown", clientX: 450, clientY: 310 },
            [colorNode.size[0] / 2, 10],
            colorNode,
        );
        const picker = document.querySelector("input.wosai-color-picker-trigger");
        if (picker) {
            picker.value = "#123456";
            picker.dispatchEvent(new Event("input", { bubbles: true }));
            picker.dispatchEvent(new Event("change", { bubbles: true }));
        }

        colorNode.connect(0, emptyImage, 3);
        const outputLinkId = colorNode.outputs?.[0]?.links?.[0];
        const inputLinkId = emptyImage.inputs?.[3]?.link;
        const graphLinks = app.graph.links;
        const link = graphLinks instanceof Map
            ? graphLinks.get(outputLinkId)
            : graphLinks?.[outputLinkId];

        // Restore a normal visible width before the real DOM-pointer check.
        // The synthetic zoom regression above deliberately widens the logical
        // node and would otherwise place its right arrow below EmptyImage.
        colorNode.size[0] = 360;
        emptyImage.pos[0] = 820;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        return {
            colorNodeId: colorNode.id,
            nodeType: colorNode.type,
            presetType: preset.type,
            previewType: preview.type,
            presetSize,
            previewSize,
            presetText,
            previewText,
            menuLabels,
            steppedValue,
            steppedColor,
            selectedValue,
            selectedColor,
            customPreset: preset.value,
            customColor: preview.value,
            pickerCreated: Boolean(picker),
            link: link && {
                originId: link.origin_id,
                originSlot: link.origin_slot,
                targetId: link.target_id,
                targetSlot: link.target_slot,
                type: link.type,
            },
            linkIdsMatch: outputLinkId != null && outputLinkId === inputLinkId,
        };
    });
}

test("CommonColor keeps one interaction contract in Classic and Nodes 2.0", async ({ page }, testInfo) => {
    await page.goto("/?wosai_ui_test=bootstrap");
    await waitForWosai(page, ["WOSAI_CommonColor", "EmptyImage"]);
    const originalMode = await readNodes2Setting(page);
    const originalLanguage = await readWosaiLanguage(page);
    const results = {};

    try {
        for (const [name, enabled] of [["classic", false], ["nodes2", true]]) {
            await writeNodes2Setting(page, enabled);
            await page.goto(`/?wosai_ui_test=${name}`);
            await waitForWosai(page, ["WOSAI_CommonColor", "EmptyImage"]);
            expect(await readNodes2Setting(page)).toBe(enabled);
            await writeWosaiLanguage(page, "en");

            const result = await exerciseCommonColor(page);
            results[name] = result;
            expect(result.presetSize).toEqual([360, 30]);
            expect(result.previewSize).toEqual([360, 30]);
            expect(result.presetText.map(({ x, y }) => [x, y])).toEqual(
                result.previewText.map(({ x, y }) => [x, y]),
            );
            expect(result.presetText.map(({ text }) => text)).toEqual(["Color Preset", "Custom"]);
            expect(result.previewText.map(({ text }) => text)).toEqual(["Custom", "#242730"]);
            expect(result.menuLabels).toContain("Custom");
            expect(result.menuLabels).toContain("Brand Orange  #DD6F4A");
            expect(result.menuLabels).toContain("HUB Violet  #A78BFA");
            expect(result.menuLabels.some((label) => /[\u3400-\u9fff]/u.test(label))).toBe(false);
            expect(result.steppedValue).toBe("品牌橙");
            expect(result.steppedColor).toBe("#DD6F4A");
            expect(result.selectedValue).toBe("HUB紫");
            expect(result.selectedColor).toBe("#A78BFA");
            expect(result.pickerCreated).toBe(true);
            expect(result.customPreset).toBe("自定义");
            expect(result.customColor).toBe("#123456");
            expect(result.linkIdsMatch).toBe(true);
            expect(result.link).toMatchObject({
                originSlot: 0,
                targetSlot: 3,
                type: "INT",
            });

            if (enabled) {
                await page.evaluate(async () => {
                    globalThis.app.canvas.setZoom?.(1.76);
                    globalThis.app.canvas.setDirty(true, true);
                    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                });
                const presetCanvas = page.locator(
                    `[data-node-id="${result.colorNodeId}"] canvas.cursor-crosshair`,
                ).first();
                await expect(presetCanvas).toBeVisible();
                const box = await presetCanvas.boundingBox();
                const drawWidth = await page.evaluate(() => {
                    const node = globalThis.app.graph._nodes.find(
                        (item) => item.type === "WOSAI_CommonColor",
                    );
                    return node.widgets.find(
                        (widget) => (widget._wosaiOrigName || widget.name) === "color_name",
                    )._wosaiDrawWidth;
                });
                expect(box).not.toBeNull();
                expect(drawWidth).toBeGreaterThan(0);
                await presetCanvas.click({
                    force: true,
                    position: {
                        x: ((drawWidth - 39) / drawWidth) * box.width,
                        y: box.height / 2,
                    },
                    timeout: 5_000,
                });
                const pointerResult = await page.evaluate(() => {
                    const node = globalThis.app.graph._nodes.find(
                        (item) => item.type === "WOSAI_CommonColor",
                    );
                    const preset = node.widgets.find(
                        (widget) => (widget._wosaiOrigName || widget.name) === "color_name",
                    );
                    const preview = node.widgets.find(
                        (widget) => (widget._wosaiOrigName || widget.name) === "custom_color",
                    );
                    return {
                        preset: preset.value,
                        preview: preview.value,
                        menuOpen: Boolean(document.querySelector(".wosai-color-preset-menu")),
                    };
                });
                expect(pointerResult).toEqual({
                    preset: "品牌橙",
                    preview: "#DD6F4A",
                    menuOpen: false,
                });
            }

            await testInfo.attach(`common-color-${name}`, {
                body: await page.screenshot({ fullPage: true }),
                contentType: "image/png",
            });
        }

        expect(results.nodes2.presetSize).toEqual(results.classic.presetSize);
        expect(results.nodes2.previewSize).toEqual(results.classic.previewSize);
        expect(results.nodes2.presetText).toEqual(results.classic.presetText);
        expect(results.nodes2.previewText).toEqual(results.classic.previewText);
    } finally {
        await writeNodes2Setting(page, originalMode);
        await page.goto("/?wosai_ui_test=restore");
        await waitForWosai(page, ["WOSAI_CommonColor", "EmptyImage"]);
        await writeWosaiLanguage(page, originalLanguage);
    }
});
