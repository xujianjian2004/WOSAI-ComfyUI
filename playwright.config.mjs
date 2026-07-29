import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const baseURL = (process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/$/, "");

// 插件位于 <ComfyUI>/custom_nodes/WOSAI-ComfyUI，故上级两级即 ComfyUI 根目录。
// 可用 COMFYUI_PATH 覆盖，或用 COMFY_START_CMD 提供自定义启动命令。
const here = path.dirname(fileURLToPath(import.meta.url));
const comfyRoot = process.env.COMFYUI_PATH || path.resolve(here, "..", "..");

export default defineConfig({
    testDir: "./tests/ui",
    fullyParallel: false,
    workers: 1,
    timeout: 90_000,
    expect: { timeout: 8_000 },
    reporter: [["list"], ["html", { outputFolder: ".playwright-report", open: "never" }]],
    outputDir: ".playwright-results",
    use: {
        baseURL,
        channel: process.env.WOSAI_BROWSER_CHANNEL || "chrome",
        headless: process.env.WOSAI_HEADFUL !== "1",
        viewport: { width: 1440, height: 900 },
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
    },
    webServer: {
        command: process.env.COMFY_START_CMD || `python "${path.join(comfyRoot, "main.py")}"`,
        url: baseURL,
        // 本地复用已运行的 ComfyUI；CI 中无服务时才自动拉起。
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
    },
});
