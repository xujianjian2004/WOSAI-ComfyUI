export const NODES2_SETTING = "Comfy.VueNodes.Enabled";

export async function waitForWosai(page, nodeTypes = []) {
    await page.waitForFunction((requiredTypes) => (
        globalThis.app?.graph
        && globalThis.LiteGraph?.registered_node_types
        && requiredTypes.every((type) => globalThis.LiteGraph.registered_node_types[type])
    ), nodeTypes);
}

export async function readNodes2Setting(page) {
    return page.evaluate(async (settingId) => {
        const modern = globalThis.app?.extensionManager?.setting;
        if (modern?.get) return Boolean(await modern.get(settingId));
        return Boolean(globalThis.app?.ui?.settings?.getSettingValue?.(settingId));
    }, NODES2_SETTING);
}

export async function writeNodes2Setting(page, enabled) {
    await page.evaluate(async ({ settingId, value }) => {
        const app = globalThis.app;
        const modern = app?.extensionManager?.setting;
        if (modern?.set) await modern.set(settingId, value);
        else if (app?.ui?.settings?.setSettingValue) {
            await app.ui.settings.setSettingValue(settingId, value);
        } else {
            throw new Error(`ComfyUI setting API is unavailable for ${settingId}`);
        }
    }, { settingId: NODES2_SETTING, value: enabled });
}

export async function settleFrames(page, count = 2) {
    await page.evaluate(async (frameCount) => {
        for (let index = 0; index < frameCount; index += 1) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
        }
    }, count);
}
