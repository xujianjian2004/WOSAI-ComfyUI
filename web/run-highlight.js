import { t } from "./shared/i18n.js";
import { app } from "../../scripts/app.js";
import { roundRect as canvasRoundRect } from "./shared/canvas-polyfill.js";
import { getWOSAIVar } from "./shared/shared-utils.js";
import { patchMethod } from "./shared/method-patch.js";

function $el(tag, propertiesOrChildren = {}, children = []) {
    const element = document.createElement(tag);
    const properties = Array.isArray(propertiesOrChildren) ? {} : propertiesOrChildren;
    const childItems = Array.isArray(propertiesOrChildren) ? propertiesOrChildren : children;
    for (const [name, value] of Object.entries(properties)) {
        if (name === "style" && value && typeof value === "object") {
            Object.assign(element.style, value);
        } else if (name === "for") {
            element.htmlFor = value;
        } else if (name in element) {
            element[name] = value;
        } else {
            element.setAttribute(name, value);
        }
    }
    for (const child of childItems) {
        if (child !== null && child !== undefined) element.append(child);
    }
    return element;
}

let _removeDrawNodePatch = null;
let _rhUninstalled = false;    // 标记是否已卸载
let _listeners = {};           // 事件监听器引用，供 remove() 清理
let _tickHandle = null;        // tick 定时器引用，供 remove() 清理
let _rhGeneration = 0;

app.registerExtension({
    name: "WOSAI.RunHighlight",
    setup() {
        const generation = ++_rhGeneration;
        _rhUninstalled = false;
        const isCurrent = () => !_rhUninstalled && generation === _rhGeneration;
        console.log("%c WOSAI 运行高亮 已加载 ", "background: CanvasText; color: Canvas");

        const coerceBool = (value, fallback) => {
            if (value === true || value === "true" || value === 1 || value === "1") return true;
            if (value === false || value === "false" || value === 0 || value === "0") return false;
            return fallback;
        };
        const coerceNumber = (value, fallback) => {
            const n = Number(value);
            return Number.isFinite(n) ? n : fallback;
        };
        const normalizeHex = (value, fallback) => {
            if (typeof value !== "string") return fallback;
            const v = value.trim();
            return /^#([0-9a-fA-F]{6})$/.test(v) ? v : fallback;
        };
        const normalizeColor = (value, fallback) => {
            if (typeof value !== "string") return fallback;
            const parts = value.split(",").map(s => s.trim()).filter(Boolean);
            if (parts.length === 0) return fallback;
            const valid = parts.every(p => /^#([0-9a-fA-F]{6})$/.test(p));
            return valid ? parts.join(",") : fallback;
        };
        const clamp01 = (value, fallback) => {
            const n = coerceNumber(value, fallback);
            if (n < 0) return 0;
            if (n > 1) return 1;
            return n;
        };
        const formatElapsed = (ms) => {
            const totalSeconds = Math.max(0, ms / 1000);
            if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = (totalSeconds % 60).toFixed(1).padStart(4, "0");
            return `${minutes}:${seconds}s`;
        };

        let highlightEnabled = true;
        let breathingEnabled = false;
        let autoBreathingEnabled = false;
        const breathingPeriodMs = 500;
        const breathingStrength = 100;
        const rhToken = (name) => getWOSAIVar(name);
        let breathingColor = rhToken('--ws-rh-breathing-color');
        const breathingSizeScale = 2;
        const breathingBrightness = 2;
        let timeEnabled = true;
        let timeColor = rhToken('--ws-rh-time-color');
        const timeBgOpacity = 1.0;
        const timeShadowOpacity = 0.5;

        let runningNodeId = null;
        let runningStartTime = 0;
        let lastRunningNodeId = null;
        let lastMouseMoveTime = 0;
        let mouseBreathPeriodMs = 0;
        let mouseBreathPhaseStart = 0;
        let mouseListenerAttached = false;
        let lastMouseMoveHandleTime = 0;

        // New State Variables
        let missingInputColor = rhToken('--ws-rh-missing-input-color');
        let errorColor = rhToken('--ws-rh-error-color');
        let missingInputEnabled = true;
        let errorHighlightEnabled = true;
        let lastErrorNodeId = null;
        // ⚠ 报错高亮限时自动熄灭：原版 app.lastNodeErrors / lastErrorNodeId 会持续到下次运行，
        //   且每帧 error 绘制都刷新 lastHighlightTime → 边框常驻 + 重绘循环永不停（卡死）。
        //   记录报错时刻，超过 ERROR_DURATION_MS 后不再绘制 error 高亮，循环随之自然停止。
        let errorStartTime = 0;
        const ERROR_DURATION_MS = 6000;

        _listeners = {}; // 统一管理事件监听器，供 remove() 清理
        let highlightSetting;

        const applyDefaults = (defaults) => {
            if (!defaults) return;
            if (defaults.highlight_enabled !== undefined) highlightEnabled = coerceBool(defaults.highlight_enabled, true);
            if (defaults.breathing_enabled !== undefined) { breathingEnabled = coerceBool(defaults.breathing_enabled, false); autoBreathingEnabled = breathingEnabled; }
            // 以下参数已固化为默认值、不再暴露 UI：breathing_period_ms=500、breathing_strength=100、
            // breathing_size_scale=2、breathing_brightness=2、time_bg_opacity=1.0、time_shadow_opacity=0.5
            if (defaults.breathing_color !== undefined) breathingColor = normalizeColor(defaults.breathing_color, rhToken('--ws-rh-breathing-color'));
            if (defaults.time_enabled !== undefined) timeEnabled = coerceBool(defaults.time_enabled, true);
            if (defaults.time_color !== undefined) timeColor = normalizeHex(defaults.time_color, rhToken('--ws-rh-time-color'));
        };

        const registerSettings = () => {
            if (!isCurrent()) return;
            if (app.ui?.settings?.addSetting) {
                highlightSetting = app.ui.settings.addSetting({
                    id: "WOSAI.RunHighlight.Enabled",
                    category: [t('common.wosaiCustomize'), t('common.wosaiRunHighlight'), t('nodes.runHighlight.groupHighlight')],
                    name: t('nodes.runHighlight.groupHighlight'),
                    type: "boolean",
                    defaultValue: highlightEnabled,
                    onChange(value) {
                        highlightEnabled = coerceBool(value, true);
                        app.graph?.setDirtyCanvas?.(true, true);
                    },
                });
                highlightEnabled = coerceBool(highlightSetting?.value, highlightEnabled);

                const breathEffectSetting = app.ui.settings.addSetting({
                    id: "WOSAI.RunHighlight.Breathing.Effect",
                    category: [t('common.wosaiCustomize'), t('common.wosaiRunHighlight'), t('nodes.runHighlight.breathEffect')],
                    name: t('nodes.runHighlight.breathEffect'),
                    type: "boolean",
                    defaultValue: breathingEnabled,
                    onChange(value) {
                        const v = coerceBool(value, false);
                        breathingEnabled = v;
                        autoBreathingEnabled = v;
                        app.graph?.setDirtyCanvas?.(true, true);
                    },
                });
                breathingEnabled = coerceBool(breathEffectSetting?.value, breathingEnabled);
                autoBreathingEnabled = breathingEnabled;

                const colorSettingId = "WOSAI.RunHighlight.Breathing.Color";
                const colorSetting = app.ui.settings.addSetting({
                    id: colorSettingId,
                    category: [t('common.wosaiCustomize'), t('common.wosaiRunHighlight'), t('nodes.runHighlight.glowColor')],
                    name: t('nodes.runHighlight.glowColor'),
                    defaultValue: breathingColor,
                    type: () => {
                        const id = "WOSAI-RunHighlight-Breathing-Color";
                        const updateColor = (val, save) => {
                            const hex = normalizeHex(val, rhToken('--ws-rh-breathing-color'));
                            breathingColor = hex;
                            if (textInput) textInput.value = hex;
                            if (pickerEl) pickerEl.value = hex;
                            app.graph?.setDirtyCanvas?.(true, true);
                            if (save) {
                                colorSetting.value = hex;
                                app.ui?.settings?.setSettingValue?.(colorSettingId, hex);
                            }
                        };

                        // Hex text input
                        const current = normalizeHex(colorSetting?.value || breathingColor, rhToken('--ws-rh-breathing-color'));
                        const textInput = $el("input", {
                            id,
                            type: "text",
                            value: current,
                            placeholder: rhToken('--ws-rh-breathing-color'),
                            style: {
                                width: "var(--ws-rh-color-input-width)",
                                padding: "var(--ws-gap-xs)",
                                borderRadius: "var(--ws-radius-sm)",
                                border: "var(--ws-border-width-thin) solid var(--border-color, var(--ws-border))",
                                backgroundColor: "var(--comfy-input-bg, var(--ws-input-bg))",
                                color: "var(--input-text, var(--ws-text))",
                                fontFamily: "monospace"
                            },
                            onchange: (e) => updateColor(e.target.value, true),
                            onkeydown: (e) => e.stopPropagation()
                        });

                        // Native color picker
                        const pickerEl = $el("input", {
                            type: "color",
                            value: current,
                            title: t('nodes.runHighlight.chooseGlowColor'),
                            style: {
                                width: "var(--ws-icon-btn-size)", height: "var(--ws-icon-btn-size)", padding: 0,
                                border: "var(--ws-border-width-thin) solid var(--ws-rh-picker-border)", cursor: "pointer",
                                backgroundColor: "transparent", borderRadius: "var(--ws-radius-sm)"
                            },
                            oninput: (e) => updateColor(e.target.value, false),
                            onchange: (e) => updateColor(e.target.value, true)
                        });

                        const presetColors = [
                            { c: rhToken('--ws-rh-preset-purple'), n: t('widgets.colorCore.purple') }, { c: rhToken('--ws-rh-preset-blue'), n: t('widgets.colorCore.blue') },
                            { c: rhToken('--ws-rh-preset-green'), n: t('widgets.colorCore.green') }, { c: rhToken('--ws-rh-preset-red'), n: t('widgets.colorCore.red') },
                            { c: rhToken('--ws-rh-preset-orange'), n: t('widgets.colorCore.orange') }, { c: rhToken('--ws-rh-preset-pink'), n: t('widgets.colorCore.pink') },
                        ];
                        const presetSwatches = presetColors.map(p => $el("div", {
                            title: p.n,
                            style: {
                                width: "var(--ws-rh-swatch-size)", height: "var(--ws-rh-swatch-size)", borderRadius: "50%",
                                background: p.c, cursor: "pointer",
                                border: breathingColor === p.c ? "var(--ws-focus-ring-width) solid var(--ws-text-on-accent)" : "var(--ws-border-width-thin) solid var(--ws-rh-swatch-border)",
                                boxSizing: "border-box"
                            },
                            onclick: () => updateColor(p.c, true)
                        }));

                        const controls = $el("div", { style: { display: "flex", flexDirection: "column", gap: "var(--ws-gap-sm)" } }, [
                            $el("div", { style: { display: "flex", gap: "var(--ws-gap)", alignItems: "center" } }, [
                                textInput, pickerEl
                            ]),
                            $el("div", { style: { display: "flex", gap: "var(--ws-gap-sm)", alignItems: "center" } }, [
                                $el("span", { textContent: t('nodes.runHighlight.preset') + ':', style: { fontSize: "var(--ws-text-base)", color: "var(--input-text, var(--ws-text-secondary))", flexShrink: 0 } }),
                                ...presetSwatches
                            ])
                        ]);

                        return $el("tr", [
                            $el("td", [$el("label", { for: id, textContent: t('nodes.runHighlight.glowColor') + ':' })]),
                            $el("td", [controls]),
                        ]);
                    },
                    onChange(value) {
                        breathingColor = normalizeHex(value, rhToken('--ws-rh-breathing-color'));
                        app.graph?.setDirtyCanvas?.(true, true);
                    },
                });
                breathingColor = normalizeHex(colorSetting?.value, breathingColor);

                const timeEnabledSetting = app.ui.settings.addSetting({
                    id: "WOSAI.RunHighlight.Time.Enabled",
                    category: [t('common.wosaiCustomize'), t('common.wosaiRunHighlight'), t('nodes.runHighlight.timeDisplay')],
                    name: t('nodes.runHighlight.timeDisplay'),
                    type: "boolean",
                    defaultValue: timeEnabled,
                    onChange(value) {
                        timeEnabled = coerceBool(value, true);
                        app.graph?.setDirtyCanvas?.(true, true);
                    },
                });
                timeEnabled = coerceBool(timeEnabledSetting?.value, timeEnabled);

                const timeColorSettingId = "WOSAI.RunHighlight.Time.Color";
                const timeColorSetting = app.ui.settings.addSetting({
                    id: timeColorSettingId,
                    category: [t('common.wosaiCustomize'), t('common.wosaiRunHighlight'), t('nodes.runHighlight.timeColor')],
                    name: t('nodes.runHighlight.timeColor'),
                    defaultValue: timeColor,
                    type: () => {
                        const id = "WOSAI-RunHighlight-Time-Color";
                        const updateTimeColor = (val, save) => {
                            const nextColor = normalizeHex(val, timeColor || rhToken('--ws-rh-time-fallback'));
                            timeColor = nextColor;
                            if (textInput) textInput.value = nextColor;
                            if (colorInput) colorInput.value = nextColor;
                            app.graph?.setDirtyCanvas?.(true, true);
                            if (save) {
                                timeColorSetting.value = nextColor;
                                app.ui?.settings?.setSettingValue?.(timeColorSettingId, nextColor);
                            }
                        };
                        const current = normalizeHex(timeColorSetting?.value || timeColor || rhToken('--ws-rh-time-fallback'), rhToken('--ws-rh-time-fallback'));
                        const textInput = $el("input", {
                            id,
                            type: "text",
                            value: current,
                            placeholder: rhToken('--ws-rh-time-fallback'),
                            style: {
                                width: "100%",
                                padding: "var(--ws-gap-xs)",
                                borderRadius: "var(--ws-radius-sm)",
                                border: "var(--ws-border-width-thin) solid var(--border-color, var(--ws-border))",
                                backgroundColor: "var(--comfy-input-bg, var(--ws-input-bg))",
                                color: "var(--input-text, var(--ws-text))",
                                fontFamily: "monospace"
                            },
                            oninput: (e) => updateTimeColor(e.target.value, false),
                            onchange: (e) => updateTimeColor(e.target.value, true),
                            onkeydown: (e) => e.stopPropagation()
                        });
                        const colorInput = $el("input", {
                            type: "color",
                            value: current,
                            style: {
                                width: "var(--ws-rh-time-picker-size)",
                                height: "var(--ws-rh-time-picker-size)",
                                padding: 0,
                                border: "var(--ws-border-width-thin) solid var(--ws-rh-picker-border)",
                                cursor: "pointer",
                                backgroundColor: "transparent",
                                borderRadius: "var(--ws-radius-sm)"
                            },
                            oninput: (e) => updateTimeColor(e.target.value, false),
                            onchange: (e) => updateTimeColor(e.target.value, true)
                        });
                        return $el("tr", [
                            $el("td", [$el("label", { for: id, textContent: t('nodes.runHighlight.timeColor') + ':' })]),
                            $el("td", [
                                $el("div", { style: { display: "flex", alignItems: "center", gap: "var(--ws-gap)" } }, [
                                    colorInput,
                                    textInput
                                ])
                            ]),
                        ]);
                    },
                    onChange(value) {
                        timeColor = normalizeHex(value, timeColor || rhToken('--ws-rh-time-fallback'));
                        app.graph?.setDirtyCanvas?.(true, true);
                    },
                });
                timeColor = normalizeHex(timeColorSetting?.value || timeColor, rhToken('--ws-rh-time-fallback'));

            }
        };

        const scriptUrl = import.meta.url;
        const presetsUrl = new URL("./run-highlight-presets.json", scriptUrl).href;

        fetch(presetsUrl)
            .then(r => r.json())
            .then(data => {
                if (!isCurrent()) return;
                if (data.styles) {
                    const missingStyle = data.styles.missing_input;
                    const errorStyle = data.styles.error;
                    if (missingStyle?.color) missingInputColor = normalizeColor(missingStyle.color, rhToken('--ws-rh-legacy-error-color'));
                    if (errorStyle?.color) errorColor = normalizeColor(errorStyle.color, rhToken('--ws-rh-legacy-error-color'));
                    if (missingStyle?.enabled !== undefined) missingInputEnabled = coerceBool(missingStyle.enabled, true);
                    if (errorStyle?.enabled !== undefined) errorHighlightEnabled = coerceBool(errorStyle.enabled, true);
                }
                if (data.defaults) {
                    applyDefaults(data.defaults);
                }
                registerSettings();
            })
            .catch(e => {
                if (!isCurrent()) return;
                console.warn("WOSAI 运行高亮: Failed to load presets.json, using built-in defaults.", e);
                registerSettings();
            });

        _removeDrawNodePatch?.();
        _removeDrawNodePatch = patchMethod(
            LGraphCanvas.prototype,
            "drawNode",
            "WOSAI.RunHighlight",
            (next) => function(node, ctx) {
            next.call(this, node, ctx);

            const currentRunningId = app.runningNodeId || runningNodeId;
            if (currentRunningId && currentRunningId.toString() !== lastRunningNodeId) {
                lastRunningNodeId = currentRunningId.toString();
                runningStartTime = performance.now();
            }
            const isRunning = (
                (currentRunningId && currentRunningId.toString() === node.id.toString())
            );

            // Determine State & Color
            let targetColor = breathingColor;
            let isError = false;
            let isMissingInput = false;

            // Error Check（运行期报错限时熄灭；node.bgcolor 手动红保持常驻不受限时影响）
            const errorActive = (performance.now() - errorStartTime) < ERROR_DURATION_MS;
            const runtimeError = errorHighlightEnabled && errorActive && (
                (app.lastNodeErrors && app.lastNodeErrors[node.id]) ||
                (lastErrorNodeId && lastErrorNodeId === node.id.toString())
            );
            if (errorHighlightEnabled && (
                node.bgcolor === rhToken('--ws-rh-legacy-error-color') ||
                node.bgcolor === "red" ||
                runtimeError
            )) {
                isError = true;
                targetColor = errorColor;
            }

            // Missing Node Check (Class Definition Missing)
            if (errorHighlightEnabled && !isError && node.type && typeof LiteGraph !== 'undefined' && LiteGraph.registered_node_types && !LiteGraph.registered_node_types[node.type]) {
                 isError = true;
                 targetColor = errorColor;
            }
            // Missing Input Check
            // Only check if not already error and not running
            if (missingInputEnabled && !isRunning && !isError) {
                 if (node.inputs) {
                     // Try to identify required inputs from ComfyUI node definition
                     const nodeData = node.constructor ? node.constructor.nodeData : null;
                     const requiredInputs = (nodeData && nodeData.input && nodeData.input.required)
                                            ? Object.keys(nodeData.input.required)
                                            : null;

                     // Critical types that usually MUST be connected if present
                     const CRITICAL_TYPES = new Set([
                         "MODEL", "VAE", "CLIP", "LATENT", "IMAGE", "CONDITIONING",
                         "MASK", "STYLE_MODEL", "CLIP_VISION", "CONTROL_NET", "AUDIO"
                     ]);

                     for (const inp of node.inputs) {
                         if (inp.link !== null) continue; // Already connected

                         // Skip implicit optional types
                         if (inp.type === "OPTIONAL" || (typeof inp.type === 'string' && inp.type.toLowerCase() === "optional")) continue;
                         if (inp.name === "is_changed") continue;
                         if (inp.name === "mask") continue; // 'mask' is often optional even if not marked

                         let isRequired = false;

                         // Special handling for Reroute and PrimitiveNode (always required if unconnected)
                         if (node.type === "Reroute" || node.type === "PrimitiveNode") {
                             isRequired = true;
                         } else if (requiredInputs && requiredInputs.includes(inp.name)) {
                             // It is marked as required.
                             // We further filter to avoid false positives (e.g. widgets that are not converted to inputs).

                             const typeStr = (typeof inp.type === 'string') ? inp.type.toUpperCase() : "";
                             const isCritical = CRITICAL_TYPES.has(typeStr);

                             // Check if there is a corresponding widget.
                             // If a widget exists with the same name, we assume the user might provide value via widget.
                             // (Converted widgets are usually removed from node.widgets)
                             const hasWidget = node.widgets && node.widgets.some(w => w.name === inp.name);

                             if (isCritical) {
                                 // Critical types usually don't have widgets and must be connected
                                 isRequired = true;
                             } else if (!hasWidget) {
                                 // If it's not critical but has NO widget, it must be connected
                                 isRequired = true;
                             }
                         }

                         if (isRequired) {
                             targetColor = missingInputColor;
                             isMissingInput = true;
                             break;
                         }
                     }
                 }
            }

            if (!highlightEnabled || (!isRunning && !isError && !isMissingInput)) return;

            try {
                ctx.save();
                const r = window.devicePixelRatio || 1;

                // Reset transform? No, drawNode is in node-local space.
                // So (0,0) is top-left of node.

                const shape = node._shape || LiteGraph.BOX_SHAPE;

                const createPath = (pad) => {
                    ctx.beginPath();
                    const isCollapsed = !!(node.flags && node.flags.collapsed) || !!node.collapsed;
                    const titleHeight = LiteGraph.NODE_TITLE_HEIGHT || 30;
                    const width = isCollapsed
                        ? (node._collapsed_width || LiteGraph.NODE_COLLAPSED_WIDTH || (node.size && node.size[0]) || 140)
                        : ((node.size && node.size[0]) || 140);
                    const height = isCollapsed
                        ? titleHeight
                        : ((node.size && node.size[1]) || 60);
                    const bounds = isCollapsed
                        ? { x: 0, y: -titleHeight, w: width, h: titleHeight }
                        : { x: 0, y: -titleHeight, w: width, h: height + titleHeight };
                    const padOuter = pad;
                    if (shape === LiteGraph.CIRCLE_SHAPE) {
                        const radius = Math.max(2, Math.max(bounds.w, bounds.h) * 0.5 + padOuter);
                        ctx.arc(bounds.x + bounds.w * 0.5, bounds.y + bounds.h * 0.5, radius, 0, Math.PI * 2);
                    } else {
                        const x = bounds.x - padOuter;
                        const y = bounds.y - padOuter;
                        const w = bounds.w + padOuter * 2;
                        const h = bounds.h + padOuter * 2;
                        canvasRoundRect(ctx, x, y, w, h, 12);
                    }
                };

                const official_pad = 4;
                const glow_width = 3;

                const glow_pad = official_pad;

                // Animation pulse
                const now = performance.now();
                let breathAlpha = 1.0;
                if (isRunning && breathingEnabled) {
                    const period = Math.max(50, breathingPeriodMs);
                    const strength = Math.min(100, Math.max(0, breathingStrength)) / 100;
                    const minAlpha = 1 - strength * 0.5;
                    const recentMouse = lastMouseMoveTime && (now - lastMouseMoveTime < 300);
                    if (recentMouse) {
                        // 鼠标触发呼吸：跟随最近一次鼠标移动的节奏脉动
                        const mousePeriod = Math.max(50, mouseBreathPeriodMs || period);
                        const elapsed = now - (mouseBreathPhaseStart || now);
                        const pulse = (Math.sin((elapsed / mousePeriod) * Math.PI * 2) + 1) / 2;
                        breathAlpha = minAlpha + pulse * (1 - minAlpha);
                    } else if (autoBreathingEnabled) {
                        // 自动呼吸（萤火虫式）：exp(sin(t)) 经典曲线，峰值更锐、谷底更暗
                        const t = (now / period) * Math.PI * 2;
                        const sineVal = Math.sin(t);
                        const expVal = Math.exp(sineVal);
                        const maxVal = Math.E; // approx 2.718
                        const minVal = 1 / Math.E; // approx 0.368
                        const pulse = (expVal - minVal) / (maxVal - minVal);
                        breathAlpha = minAlpha + pulse * (1 - minAlpha);
                    }
                }

                const parseGradient = (str) => {
                    const colors = (typeof str === "string" ? str : "").split(",").map(s => s.trim()).filter(Boolean);
                    if (colors.length === 0) return [rhToken('--ws-rh-time-fallback')];
                    return colors;
                };

                const gradientColors = parseGradient(targetColor);

                // Helper to create gradient fill/stroke
                const setGradientStyle = (colors, alphaMultiplier = 1.0) => {
                    if (colors.length === 1) {
                         // Single color
                         const c = colors[0];
                         // Apply alpha if needed? Canvas colors are usually hex.
                         // Convert to rgba if alpha < 1
                         // canvas 动态 rgba，运行时计算，保留硬编码
                        if (alphaMultiplier < 1) {
                            // Simple hex to rgba
                            const hex = c.replace("#", "");
                             const r = parseInt(hex.substring(0,2), 16);
                             const g = parseInt(hex.substring(2,4), 16);
                             const b = parseInt(hex.substring(4,6), 16);
                             ctx.fillStyle = `rgba(${r},${g},${b},${alphaMultiplier})`;
                             ctx.strokeStyle = `rgba(${r},${g},${b},${alphaMultiplier})`;
                         } else {
                             ctx.fillStyle = c;
                             ctx.strokeStyle = c;
                         }
                    } else {
                        // Linear Gradient
                        // For a rect, we can estimate diagonal or horizontal
                        // Use local coords. Node bounds are around (0,0) to (w,h)
                        const width = node.size ? node.size[0] : 140;
                        const height = node.size ? node.size[1] : 60;
                        const grad = ctx.createLinearGradient(0, 0, width, height);
                        colors.forEach((c, i) => {
                             grad.addColorStop(i / (colors.length - 1), c);
                        });
                        // Apply global alpha for gradient?
                        // ctx.globalAlpha affects everything.
                        ctx.fillStyle = grad;
                        ctx.strokeStyle = grad;
                    }
                };

                const currentAlpha = ctx.globalAlpha;
                ctx.globalAlpha = breathingBrightness * breathAlpha;

                createPath(glow_pad);
                setGradientStyle(gradientColors, 1.0);

                // Single glow stroke
                ctx.lineWidth = glow_width * breathingSizeScale;
                ctx.globalAlpha = 0.6 * breathingBrightness * breathAlpha;
                ctx.stroke();

                // Restore Alpha
                ctx.globalAlpha = currentAlpha;

                // 3. Time Display
                if (timeEnabled) {
                    let elapsedText = null;
                    if (isRunning) {
                        // 运行中：实时刷新当前节点耗时（跑完即消失，不留存）
                        elapsedText = formatElapsed(Math.max(0, performance.now() - runningStartTime));
                    }
                    if (elapsedText !== null) {
                        try {
                            ctx.save();
                            ctx.font = `bold ${rhToken('--ws-rh-time-font-size')} monospace`;
                            const tm = ctx.measureText(elapsedText);
                            const txtW = tm.width;
                            const txtH = 20;
                            const pad = 6;

                            // Position: Top-Left of node
                            const textX = pad;
                            const textY = -LiteGraph.NODE_TITLE_HEIGHT - 10;

                            // Background：canvas 动态 rgba，运行时计算，保留硬编码
                            ctx.beginPath();
                            ctx.fillStyle = `rgba(0, 0, 0, ${clamp01(timeBgOpacity, 0.55)})`;
                            canvasRoundRect(ctx, textX - pad, textY - txtH, txtW + pad * 2, txtH + pad, 6);
                            ctx.fill();

                            // Text
                            ctx.fillStyle = timeColor;
                            // canvas 动态 rgba，运行时计算，保留硬编码
                            ctx.shadowColor = `rgba(0, 0, 0, ${clamp01(timeShadowOpacity, 0.98)})`;
                            ctx.shadowBlur = 10 * r;
                            ctx.shadowOffsetX = 0;
                            ctx.shadowOffsetY = 2 * r;
                            ctx.textAlign = "left";
                            ctx.textBaseline = "bottom";
                            ctx.fillText(elapsedText, textX, textY);
                        } finally {
                            ctx.restore();
                        }
                    }
                }

            } catch (e) {
                console.error("Error in ComfyUI WOSAI 运行高亮:", e);
            } finally {
                ctx.restore();
            }
        });

        const ensureMouseListener = () => {
            if (mouseListenerAttached) return;
            const canvasEl = app.canvas?.canvas || app.canvas?.el || app.canvas?.canvasEl;
            if (!canvasEl?.addEventListener) return;
            _listeners.mousemove = () => {
                const now = performance.now();
                if (now - lastMouseMoveHandleTime < 200) return;
                lastMouseMoveHandleTime = now;

                if (lastMouseMoveTime) {
                    const interval = now - lastMouseMoveTime;
                    const newPeriod = Math.min(3000, Math.max(200, interval));
                    if (mouseBreathPeriodMs && mouseBreathPhaseStart) {
                        const elapsed = now - mouseBreathPhaseStart;
                        const phase = ((elapsed / mouseBreathPeriodMs) * Math.PI * 2) % (Math.PI * 2);
                        mouseBreathPhaseStart = now - (phase / (Math.PI * 2)) * newPeriod;
                    } else {
                        mouseBreathPhaseStart = now;
                    }
                    mouseBreathPeriodMs = newPeriod;
                } else {
                    mouseBreathPhaseStart = now;
                }
                lastMouseMoveTime = now;
            };
            _listeners.canvasEl = canvasEl;
            canvasEl.addEventListener("mousemove", _listeners.mousemove);
            mouseListenerAttached = true;
        };

        const stopTick = () => {
            if (_tickHandle !== null) { clearTimeout(_tickHandle); _tickHandle = null; }
        };

        const scheduleTick = (delay) => {
            if (_tickHandle !== null || !isCurrent()) return;
            _tickHandle = setTimeout(() => {
                _tickHandle = null;
                if (!isCurrent()) return;

                const now = performance.now();
                const hasRunning = Boolean(app.canvas && (app.runningNodeId || runningNodeId) && highlightEnabled);
                const hasError = Boolean(
                    app.canvas &&
                    highlightEnabled &&
                    errorHighlightEnabled &&
                    lastErrorNodeId &&
                    errorStartTime > 0 &&
                    now - errorStartTime < ERROR_DURATION_MS
                );
                if (!hasRunning && !hasError) {
                    if (lastErrorNodeId && errorStartTime > 0 && now - errorStartTime >= ERROR_DURATION_MS) {
                        lastErrorNodeId = null;
                        errorStartTime = 0;
                        app.canvas?.setDirty?.(true, true);
                    }
                    return;
                }

                if (hasRunning) ensureMouseListener();
                app.canvas.setDirty(true, true);
                scheduleTick(hasRunning && breathingEnabled ? 100 : 250);
            }, Math.max(0, delay));
        };

        const api = app.api;
        _listeners.executing = (event) => {
            try {
                const detail = event?.detail || {};
                const explicitId = detail.node_id || detail.nodeId || detail.node?.id;
                if (explicitId !== undefined && explicitId !== null) {
                    runningNodeId = explicitId.toString();
                    lastErrorNodeId = null;
                    errorStartTime = 0;
                    runningStartTime = performance.now();
                    lastRunningNodeId = runningNodeId;
                } else {
                    runningNodeId = null;
                    lastRunningNodeId = null;
                    runningStartTime = 0;
                }
            } catch (_) {
                runningNodeId = null;
                lastRunningNodeId = null;
                runningStartTime = 0;
            }
            app.canvas?.setDirty?.(true, true);
            if (runningNodeId) scheduleTick(0);
        };
        api.addEventListener("executing", _listeners.executing);

        _listeners.executed = (event) => {
            try {
                const detail = event?.detail || {};
                const explicitId = detail.node_id || detail.nodeId || detail.node?.id;
                if (explicitId !== undefined && explicitId !== null) {
                    const id = explicitId.toString();
                    if (lastErrorNodeId === id) lastErrorNodeId = null;
                    if (app.lastNodeErrors?.[explicitId]) delete app.lastNodeErrors[explicitId];
                }
            } catch (error) {
                console.error("Error handling executed in WOSAI 运行高亮:", error);
            }
            runningNodeId = null;
            lastRunningNodeId = null;
            runningStartTime = 0;
            stopTick();
            app.canvas?.setDirty?.(true, true);
        };
        api.addEventListener("executed", _listeners.executed);

        _listeners.execution_error = (event) => {
            try {
                const detail = event?.detail || {};
                const explicitId = detail.node_id || detail.nodeId;
                if (explicitId !== undefined && explicitId !== null) {
                    lastErrorNodeId = explicitId.toString();
                    errorStartTime = performance.now();
                    app.canvas?.setDirty?.(true, true);
                }
            } catch (error) {
                console.error("Error handling execution_error in WOSAI 运行高亮:", error);
            }
            runningNodeId = null;
            lastRunningNodeId = null;
            runningStartTime = 0;
            stopTick();
            if (lastErrorNodeId && errorHighlightEnabled) scheduleTick(0);
        };
        api.addEventListener("execution_error", _listeners.execution_error);

        _listeners.execution_start = () => {
            runningNodeId = null;
            lastRunningNodeId = null;
            lastErrorNodeId = null;
            runningStartTime = 0;
            errorStartTime = 0;
            scheduleTick(0);
        };
        api.addEventListener("execution_start", _listeners.execution_start);

        _listeners.execution_interrupted = () => {
            runningNodeId = null;
            lastRunningNodeId = null;
            runningStartTime = 0;
            stopTick();
            app.canvas?.setDirty?.(true, true);
        };
        api.addEventListener("execution_interrupted", _listeners.execution_interrupted);
    },
    remove() {
        _rhUninstalled = true;
        _rhGeneration += 1;
        _removeDrawNodePatch?.();
        _removeDrawNodePatch = null;
        const api = app.api;
        if (_listeners.executing) api.removeEventListener("executing", _listeners.executing);
        if (_listeners.executed) api.removeEventListener("executed", _listeners.executed);
        if (_listeners.execution_error) api.removeEventListener("execution_error", _listeners.execution_error);
        if (_listeners.execution_start) api.removeEventListener("execution_start", _listeners.execution_start);
        if (_listeners.execution_interrupted) api.removeEventListener("execution_interrupted", _listeners.execution_interrupted);
        if (_listeners.canvasEl && _listeners.mousemove) {
            _listeners.canvasEl.removeEventListener("mousemove", _listeners.mousemove);
        }
        if (_tickHandle !== null) { clearTimeout(_tickHandle); _tickHandle = null; }
        _listeners = {};
    }
});
