import { app } from "../../../scripts/app.js";
import { t, applyNodeDefTranslation, onLangChange } from "./shared/i18n.js";
import { getWOSAIVarNum } from "./shared/shared-utils.js";
import { addSizedDOMWidget } from "./shared/dom-widget.js";
import { injectTextFavoriteIndicator } from "./save-text.js";
import { parsePresetImport, serializePresetExport } from "./shared/preset-transfer-engine.js";
import { quickToast } from "./shared/toast.js";
import { ghostWidget, hideEl, hideWidgetRow, injectGlobalHideCSS } from "./shared/nodes2-hide.js";

const NODE_TYPE = "WOSAI_PresetPromptSelector";
const PATCH_KEY = "__wosaiPresetPromptPatched";
const STYLE_ID = "wosai-preset-prompt-style";
const WIDGET_NAMES = new Set(["active_index", "batch_output", "presets_data"]);
const PROMPT_WIDGET_NAMES = ["prompt_cn", "prompt_en"];
const MIN_PRESET_COUNT = 1;
const MAX_PRESET_COUNT = 999;
const MAX_PRESET_SETTING_COUNT = 9;
const PRESET_PAGE_SIZE = 9;
const PROMPT_VISIBLE_ROWS = 4;
const LAYOUT_SETTLE_PASSES = 2;
let presetNodeType = null;
let offPresetLanguage = null;

const DEFAULT_PRESET_IDS = [
  "yellowingCleanup",
  "stainCleanup",
  "creaseRepair",
  "glareRemoval",
  "damageCompletion",
  "colorize",
];

function getDefaultPresetDefinition(index) {
  const id = DEFAULT_PRESET_IDS[index];
  if (!id) return null;
  return {
    id,
    legacyLabels: t(`nodes.presetPrompt.legacyLabels.${id}`, "").split("|").filter(Boolean),
    prompt_cn: t(`nodes.presetPrompt.promptData.${id}.cn`, ""),
    legacy_prompt_en: t(`nodes.presetPrompt.promptData.${id}.legacyEn`, ""),
    prompt_en: t(`nodes.presetPrompt.promptData.${id}.en`, ""),
  };
}

function ensureStyle() {
  const href = new URL("./styles/preset-prompt.css?v=11", import.meta.url).href;
  const existing = document.getElementById(STYLE_ID);
  if (existing) {
    if (existing.href !== href) existing.href = href;
    return;
  }
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function getWidget(node, name) {
  return node.widgets?.find((widget) => widget.name === name);
}

function patchNode2PromptInputs(node, attempts = 0) {
  const body = document.querySelector(`[data-testid="node-body-${node.id}"]`);
  if (body) {
    body.classList.add("wosai-pp-node-body");
    const hostBrandFooter = Array.from(body.children).find((element) => (
      element.textContent?.trim() === "WOSAI"
    ));
    hostBrandFooter?.classList.add("wosai-pp__host-brand-footer");
    return;
  }
  if (attempts < PROMPT_VISIBLE_ROWS) {
    requestAnimationFrame(() => patchNode2PromptInputs(node, attempts + 1));
  }
}

function applyPromptInputHeight(node) {
  const minHeight = getWOSAIVarNum("--ws-pp-prompt-min-height", 0);
  for (const name of PROMPT_WIDGET_NAMES) {
    const widget = getWidget(node, name);
    if (!widget) continue;
    if (!widget._wosaiPresetHeightPatched) {
      const originalComputeSize = widget.computeSize;
      widget.computeSize = function computePromptSize(...args) {
        const [width = 0, height = 0] = originalComputeSize?.apply(this, args) ?? [];
        return [width, Math.max(height, minHeight)];
      };
      widget._wosaiPresetHeightPatched = true;
    }
    const roots = [widget.element, widget.inputEl];
    for (const root of roots) {
      const textareas = root?.tagName === "TEXTAREA"
        ? [root]
        : Array.from(root?.querySelectorAll?.("textarea") ?? []);
      for (const textarea of textareas) {
        textarea.rows = PROMPT_VISIBLE_ROWS;
        textarea.style.setProperty("min-height", "var(--ws-pp-prompt-min-height)", "important");
        textarea.style.setProperty("height", "var(--ws-pp-prompt-min-height)", "important");
        textarea.style.setProperty("max-height", "none", "important");
      }
    }
  }
  patchNode2PromptInputs(node);
}

function injectPromptFavorites(node) {
  PROMPT_WIDGET_NAMES.forEach((name) => injectTextFavoriteIndicator(node, getWidget(node, name)));
}

function applyOutputPortLabels(node) {
  if (!node?.outputs) return;
  for (const port of node.outputs) {
    if (port._wosaiOrigName == null) port._wosaiOrigName = port.name;
    const key = `nodeDefs.${NODE_TYPE}.outputs.${port._wosaiOrigName}.name`;
    const translated = t(key);
    if (translated !== key && translated !== port.label) port.label = translated;
  }
}

function applyNativeOutputPortShape(node) {
  const circleShape = window.LiteGraph?.CIRCLE_SHAPE;
  if (circleShape == null || !node?.outputs) return;
  for (const port of node.outputs) {
    if (port) port.shape = circleShape;
  }
  node.setDirtyCanvas?.(true, true);
}

function hideNativeWidget(widget, node) {
  if (!widget) return;
  // Classic：GJJ 藏参五件套（ghostWidget 含 last_y=0 + computeLayoutSize，避免空白行 / 残留高度）
  // Nodes 2.0：直接 hideEl 做一次即时隐藏；真正的持续隐藏由 injectGlobalHideCSS 注入的
  //           全局 CSS 兜底（按 widget 名匹配，Vue 重渲后 CSS 自动重新生效，不会像
  //           element.style.display 那样被重置而让原始 widget 重新冒出）。
  ghostWidget(widget);
  const el = widget.element ?? widget.dom ?? widget.inputEl;
  if (el) {
    hideEl(el, true);
    hideWidgetRow(el, node?.element ?? node?.dom);
  }
}

function getFallbackPreset(index) {
  const fallback = getDefaultPresetDefinition(index);
  return {
    label: fallback
      ? t(`nodes.presetPrompt.defaults.${fallback.id}`, `Preset ${index + 1}`)
      : t("nodes.presetPrompt.defaultLabel", `Preset ${index + 1}`).replace("{index}", String(index + 1)),
    prompt_cn: fallback?.prompt_cn ?? "",
    prompt_en: fallback?.prompt_en ?? "",
  };
}

function getAutoPresetLabel(index) {
  const template = t("nodes.presetPrompt.defaultLabel", "Preset {index}");
  return String(template).replaceAll("{index}", String(index + 1));
}

function normalizePresetLabel(item, index, fallback) {
  if (item?._wosaiLabelCleared) return "";
  const label = String(item?.label ?? "").trim();
  if (!label) return fallback.label;
  const definition = getDefaultPresetDefinition(index);
  // Built-in labels are legacy data values; render them in the active locale
  // while preserving any user-defined rename verbatim.
  if (definition?.legacyLabels?.includes(label)) return fallback.label;
  return label;
}

function restoreLegacyChinesePrompt(item, fallback) {
  const promptCn = String(item.prompt_cn ?? "");
  if (promptCn.trim() || !fallback?.prompt_cn) return promptCn;
  if (item.prompt_cn == null) return fallback.prompt_cn;
  const label = String(item.label ?? "").trim();
  const wasPreviouslyCleared = Boolean(item._wosaiPromptEnCleared);
  return fallback.legacyLabels?.includes(label) && !item._wosaiPromptCnCleared && !wasPreviouslyCleared
    ? fallback.prompt_cn
    : promptCn;
}

function restoreLegacyEnglishPrompt(item, fallback) {
  const promptEn = String(item.prompt_en ?? "");
  if (!fallback?.prompt_en) return promptEn;
  const label = String(item.label ?? "").trim();
  const isBuiltInPreset = fallback.legacyLabels?.includes(label);
  if (item.prompt_en == null || (!promptEn.trim() && isBuiltInPreset && !item._wosaiPromptEnCleared)) return fallback.prompt_en;
  return isBuiltInPreset && promptEn === fallback.legacy_prompt_en && !item._wosaiPromptEnCleared
    ? fallback.prompt_en
    : promptEn;
}

function normalizePresets(rawValue) {
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) throw new Error("Preset data must be an array");
    const normalized = parsed
      .filter((item) => item && typeof item === "object")
      .map((item, index) => {
        const fallback = getFallbackPreset(index);
        return {
          label: normalizePresetLabel(item, index, fallback),
          prompt_cn: restoreLegacyChinesePrompt(item, getDefaultPresetDefinition(index)),
          prompt_en: restoreLegacyEnglishPrompt(item, getDefaultPresetDefinition(index)),
          _wosaiLabelCleared: Boolean(item._wosaiLabelCleared),
          _wosaiPromptCnCleared: Boolean(item._wosaiPromptCnCleared || (item._wosaiPromptEnCleared && !String(item.prompt_cn ?? "").trim())),
          _wosaiPromptEnCleared: Boolean(item._wosaiPromptEnCleared),
        };
      });
    return normalized.length ? normalized.slice(0, MAX_PRESET_COUNT) : DEFAULT_PRESET_IDS.map((_, index) => getFallbackPreset(index));
  } catch {
    return DEFAULT_PRESET_IDS.map((_, index) => getFallbackPreset(index));
  }
}

function migrateLegacyPresetPrompts(node) {
  const presetsWidget = getWidget(node, "presets_data");
  const rawValue = presetsWidget?.value;
  const presets = normalizePresets(rawValue);
  try {
    const parsed = JSON.parse(rawValue);
    const needsMigration = Array.isArray(parsed) && parsed.some((item, index) => (
      item
      && typeof item === "object"
      && (
        String(item.prompt_cn ?? "") !== (presets[index]?.prompt_cn ?? "")
        || String(item.prompt_en ?? "") !== (presets[index]?.prompt_en ?? "")
      )
    ));
    if (needsMigration) setWidgetValue(node, presetsWidget, JSON.stringify(presets), false);
  } catch {
    // New nodes receive valid backend defaults; invalid legacy data is shown from the safe fallback.
  }
  return presets;
}

function resizePresets(presets, count) {
  const parsedCount = Number.parseInt(String(count), 10);
  const targetCount = Math.max(MIN_PRESET_COUNT, Math.min(MAX_PRESET_COUNT, Number.isFinite(parsedCount) ? parsedCount : presets.length));
  return Array.from({ length: targetCount }, (_, index) => presets[index] ?? getFallbackPreset(index));
}

function getTabWidgetHeight(count) {
  const columns = 3;
  const rows = Math.ceil(Math.min(count, PRESET_PAGE_SIZE) / columns);
  const baseHeight = getWOSAIVarNum("--ws-pp-widget-base-height", 0);
  const tabHeight = getWOSAIVarNum("--ws-pp-tab-min-height", 0);
  const gap = getWOSAIVarNum("--ws-pp-gap", 0);
  return baseHeight + rows * tabHeight + Math.max(0, rows - 1) * gap;
}

function measurePresetContentHeight(root) {
  if (!root?.isConnected) return 0;
  const style = getComputedStyle(root);
  const padding = (Number.parseFloat(style.paddingTop) || 0)
    + (Number.parseFloat(style.paddingBottom) || 0);
  const gap = Number.parseFloat(style.rowGap || style.gap) || 0;
  const visibleRows = Array.from(root.children).filter((element) => (
    !element.hidden
    && getComputedStyle(element).display !== "none"
  ));
  const rowHeight = visibleRows.reduce(
    (total, element) => total + Math.max(element.offsetHeight, element.scrollHeight),
    0,
  );
  return Math.ceil(padding + rowHeight + Math.max(0, visibleRows.length - 1) * gap);
}

function scheduleNodeLayout(node, count, root) {
  node._wosaiPresetWidgetHeight = getTabWidgetHeight(count);
  if (node._wosaiPresetLayoutFrame) return;
  let remainingPasses = LAYOUT_SETTLE_PASSES;
  const applyLayout = () => {
    node._wosaiPresetLayoutFrame = null;
    node._wosaiPresetWidgetHeight = Math.max(
      node._wosaiPresetWidgetHeight,
      measurePresetContentHeight(root),
    );
    const [computedWidth = 0, computedHeight = 0] = node.computeSize?.() ?? [];
    // Respect a manual width while keeping the control usable at its supported
    // minimum. Responsive rows must reflow instead of widening past the node.
    const width = Math.max(
      node.size?.[0] ?? computedWidth,
      getWOSAIVarNum("--ws-pp-node-min-width", 0),
    );
    // Content-driven height: prefer measured DOM over computeSize(), which may
    // under-report in Nodes 2.0 (Vue layout vs LiteGraph widget sum mismatch).
    // Include prompt widget heights explicitly since they live outside root.
    const promptAreaHeight = PROMPT_WIDGET_NAMES.length * getWOSAIVarNum("--ws-pp-prompt-min-height", 0);
    const contentHeight = node._wosaiPresetWidgetHeight + promptAreaHeight;
    // Upper-bound to what ComfyUI thinks (prevents overflow); small safety floor
    // prevents degenerate empty states. The old --ws-pp-node-height (380 px) hard
    // floor caused persistent bottom whitespace when content was shorter.
    const safetyFloor = getWOSAIVarNum("--ws-pp-widget-base-height", 0) * 4;
    const height = Math.max(
      Math.min(contentHeight, computedHeight),
      safetyFloor,
    );
    if (node.size?.[0] !== width || node.size?.[1] !== height) {
      node._wosaiPresetApplyingSize = true;
      try {
        node.setSize?.([width, height]);
      } finally {
        node._wosaiPresetApplyingSize = false;
      }
    }
    node._wosaiPresetManagedHeight = height;
    node.setDirtyCanvas?.(true, true);
    remainingPasses -= 1;
    if (remainingPasses > 0 && root?.isConnected) {
      node._wosaiPresetLayoutFrame = requestAnimationFrame(applyLayout);
    }
  };
  node._wosaiPresetLayoutFrame = requestAnimationFrame(applyLayout);
}

function setWidgetValue(node, widget, value, notify = true) {
  if (!widget) return;
  widget.value = value;
  if (!notify) return;
  widget.callback?.(value);
  node.graph?.change?.();
  node.graph?.setDirtyCanvas?.(true, true);
  node.setDirtyCanvas?.(true, true);
}

function syncPromptInputs(node, preset, notify = true) {
  node._wosaiPresetSyncing = true;
  try {
    setWidgetValue(node, getWidget(node, "prompt_cn"), preset.prompt_cn, notify);
    setWidgetValue(node, getWidget(node, "prompt_en"), preset.prompt_en, notify);
  } finally {
    node._wosaiPresetSyncing = false;
  }
}

function downloadPresetFile(presets) {
  const content = serializePresetExport(presets);
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const anchor = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `wosai-preset-manager-${stamp}.md`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
}

function exportPresets(node) {
  const presets = normalizePresets(getWidget(node, "presets_data")?.value);
  downloadPresetFile(presets);
  quickToast(t("nodes.presetPrompt.exportDone", "Exported Markdown file"));
}

function getImportLabel(file) {
  return String(file?.name ?? "")
    .replace(/\.[^.]+$/, "")
    .trim() || t("nodes.presetPrompt.importedLabel", "Imported preset");
}

function importPresets(node, file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const presets = parsePresetImport(reader.result, getImportLabel(file), file.name);
      if (!presets.length) throw new Error("No preset data found.");
      const presetsWidget = getWidget(node, "presets_data");
      const activeWidget = getWidget(node, "active_index");
      setWidgetValue(node, presetsWidget, JSON.stringify(presets));
      setWidgetValue(node, activeWidget, 0);
      syncPromptInputs(node, presets[0]);
      node._wosaiPresetPage = 0;
      node._wosaiPresetRefresh?.();
      const pageHint = presets.length > PRESET_PAGE_SIZE
        ? t("nodes.presetPrompt.importPaged", "(More than 9 presets; pages are shown)")
        : "";
      quickToast(`${t("nodes.presetPrompt.importDone", "Imported {count} presets").replace("{count}", String(presets.length))}${pageHint}`);
    } catch (error) {
      console.warn("[WOSAI] preset import failed", error);
      quickToast(t("nodes.presetPrompt.importFailed", "Unable to read preset file"));
    }
  };
  reader.onerror = () => quickToast(t("nodes.presetPrompt.importFailed", "Unable to read preset file"));
  reader.readAsText(file, "utf-8");
}

function clearActivePresetPrompts(node) {
  const presetsWidget = getWidget(node, "presets_data");
  const presets = normalizePresets(presetsWidget?.value);
  const activeIndex = Math.max(0, Math.min(Number(getWidget(node, "active_index")?.value) || 0, presets.length - 1));
  presets[activeIndex] = {
    ...presets[activeIndex],
    prompt_cn: "",
    prompt_en: "",
    _wosaiPromptCnCleared: true,
    _wosaiPromptEnCleared: true,
  };
  setWidgetValue(node, presetsWidget, JSON.stringify(presets));
  syncPromptInputs(node, presets[activeIndex]);
  node._wosaiPresetRefresh?.();
  quickToast(t("nodes.presetPrompt.clearDone", "Prompt cleared"));
}

function clearAllPresetPrompts(node) {
  const presetsWidget = getWidget(node, "presets_data");
  const presets = normalizePresets(presetsWidget?.value).map((preset, index) => ({
    ...preset,
    label: getAutoPresetLabel(index),
    _wosaiLabelCleared: false,
    prompt_cn: "",
    prompt_en: "",
    _wosaiPromptCnCleared: true,
    _wosaiPromptEnCleared: true,
  }));
  const activeIndex = Math.max(0, Math.min(Number(getWidget(node, "active_index")?.value) || 0, presets.length - 1));
  setWidgetValue(node, presetsWidget, JSON.stringify(presets));
  syncPromptInputs(node, presets[activeIndex]);
  node._wosaiPresetRefresh?.();
  quickToast(t("nodes.presetPrompt.clearAllDone", "All prompts cleared"));
}

function persistPromptInput(node, name, value) {
  if (node._wosaiPresetSyncing) return;
  const presetsWidget = getWidget(node, "presets_data");
  const presets = normalizePresets(presetsWidget?.value);
  const activeIndex = Math.max(0, Math.min(Number(getWidget(node, "active_index")?.value) || 0, presets.length - 1));
  presets[activeIndex] = {
    ...presets[activeIndex],
    [name]: String(value ?? ""),
    ...(name === "prompt_cn" ? { _wosaiPromptCnCleared: !String(value ?? "").trim() } : {}),
    ...(name === "prompt_en" ? { _wosaiPromptEnCleared: !String(value ?? "").trim() } : {}),
  };
  setWidgetValue(node, presetsWidget, JSON.stringify(presets));
}

function bindPromptPersistence(node) {
  if (node._wosaiPresetPromptBindings) return;
  ["prompt_cn", "prompt_en"].forEach((name) => {
    const widget = getWidget(node, name);
    if (!widget) return;
    const originalCallback = widget.callback;
    widget.callback = function onPromptChanged(value, ...args) {
      originalCallback?.call(this, value, ...args);
      persistPromptInput(node, name, value);
    };
  });
  node._wosaiPresetPromptBindings = true;
}

function closeEditor(node) {
  node._wosaiPresetEditor?.remove();
  node._wosaiPresetEditor = null;
  node._wosaiPresetEditorAbort?.abort();
  node._wosaiPresetEditorAbort = null;
}

function closeClearMenu(node) {
  node._wosaiPresetClearMenu?.remove();
  node._wosaiPresetClearMenu = null;
  node._wosaiPresetClearMenuAbort?.abort();
  node._wosaiPresetClearMenuAbort = null;
  node._wosaiPresetClearMenuAnchor?.setAttribute("aria-expanded", "false");
  node._wosaiPresetClearMenuAnchor = null;
}

function openClearMenu(node, anchor) {
  if (node._wosaiPresetClearMenu) {
    closeClearMenu(node);
    return;
  }
  closeEditor(node);
  const menu = document.createElement("div");
  const abort = new AbortController();
  const rect = anchor.getBoundingClientRect();
  const menuWidth = getWOSAIVarNum("--ws-pp-clear-menu-min-width");
  const viewportWidth = document.documentElement.clientWidth;
  const centeredLeft = rect.left + (rect.width - menuWidth) / 2;
  menu.className = "wosai-pp-clear-menu";
  menu.setAttribute("role", "menu");
  menu.style.left = `${Math.max(0, Math.min(centeredLeft, viewportWidth - menuWidth))}px`;
  menu.style.top = `${rect.top}px`;

  const currentButton = document.createElement("button");
  currentButton.className = "wosai-pp-clear-menu__button";
  currentButton.type = "button";
  currentButton.setAttribute("role", "menuitem");
  currentButton.textContent = t("nodes.presetPrompt.clearCurrent", "Clear selected preset");
  const allButton = document.createElement("button");
  allButton.className = "wosai-pp-clear-menu__button";
  allButton.type = "button";
  allButton.setAttribute("role", "menuitem");
  allButton.textContent = t("nodes.presetPrompt.clearAll", "Clear all presets");
  menu.append(currentButton, allButton);
  document.body.appendChild(menu);
  const actualMenuWidth = menu.getBoundingClientRect().width;
  const maxMenuLeft = Math.max(0, document.documentElement.clientWidth - actualMenuWidth);
  menu.style.left = `${Math.max(0, Math.min(rect.left + (rect.width - actualMenuWidth) / 2, maxMenuLeft))}px`;
  node._wosaiPresetClearMenu = menu;
  node._wosaiPresetClearMenuAbort = abort;
  node._wosaiPresetClearMenuAnchor = anchor;
  anchor.setAttribute("aria-expanded", "true");

  currentButton.addEventListener("click", () => {
    clearActivePresetPrompts(node);
    closeClearMenu(node);
  }, { signal: abort.signal });
  allButton.addEventListener("click", () => {
    clearAllPresetPrompts(node);
    closeClearMenu(node);
  }, { signal: abort.signal });
  document.addEventListener("pointerdown", (event) => {
    if (!menu.contains(event.target) && event.target !== anchor) closeClearMenu(node);
  }, { capture: true, signal: abort.signal });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeClearMenu(node);
  }, { signal: abort.signal });
  currentButton.focus();
}

function startInlineRename(node, index, tab) {
  const presetsWidget = getWidget(node, "presets_data");
  const presets = normalizePresets(presetsWidget?.value);
  const preset = presets[index] ?? getFallbackPreset(index);
  const labelInput = document.createElement("input");
  labelInput.className = "wosai-pp__tab-input";
  labelInput.type = "text";
  labelInput.value = preset.label;
  labelInput.required = true;
  tab.classList.add("is-editing");
  tab.replaceChildren(labelInput);

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    if (save) {
      const label = labelInput.value.trim();
      presets[index] = {
        ...preset,
        label: label || preset.label,
        _wosaiLabelCleared: !label && !preset.label,
      };
      setWidgetValue(node, presetsWidget, JSON.stringify(presets));
    }
    node._wosaiPresetRefresh?.();
  };

  ["pointerdown", "click", "contextmenu"].forEach((type) => {
    labelInput.addEventListener(type, (event) => event.stopPropagation());
  });
  labelInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    }
  });
  labelInput.addEventListener("blur", () => finish(true));
  labelInput.focus();
  labelInput.select();
}

function openSettings(node, anchor) {
  closeClearMenu(node);
  closeEditor(node);
  const presetsWidget = getWidget(node, "presets_data");
  const presets = normalizePresets(presetsWidget?.value);
  const editor = document.createElement("div");
  const abort = new AbortController();
  const rect = anchor.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const editorWidth = getWOSAIVarNum("--ws-pp-editor-width");
  const left = Math.max(0, Math.min(rect.right - editorWidth, viewportWidth - editorWidth));

  editor.className = "wosai-pp-editor";
  editor.dataset.wosaiPanel = "preset-prompt";
  editor.setAttribute("role", "dialog");
  editor.setAttribute("aria-label", t("nodes.presetPrompt.presetCount", "Preset count"));
  editor.style.left = `${left}px`;
  editor.style.top = `${rect.top}px`;

  const title = document.createElement("h3");
  title.className = "wosai-pp-editor__title";
  title.textContent = t("nodes.presetPrompt.presetCount", "Preset count");
  const hint = document.createElement("span");
  hint.className = "wosai-pp-editor__hint";
  hint.textContent = t("nodes.presetPrompt.presetCountHintWrapped", "({hint})")
    .replace("{hint}", t("nodes.presetPrompt.presetCountHint", "Click a number to apply immediately"));
  const titleRow = document.createElement("div");
  titleRow.className = "wosai-pp-editor__title-row";
  titleRow.append(title, hint);
  const countGrid = document.createElement("div");
  countGrid.className = "wosai-pp-editor__count-grid";
  countGrid.setAttribute("role", "group");
  countGrid.setAttribute("aria-label", t("nodes.presetPrompt.presetCount", "Preset count"));
  let selectedButton = null;
  for (let count = MIN_PRESET_COUNT; count <= MAX_PRESET_SETTING_COUNT; count += 1) {
    const button = document.createElement("button");
    button.className = "wosai-pp-editor__count-button";
    button.type = "button";
    button.textContent = String(count);
    button.classList.toggle("is-active", count === presets.length);
    button.setAttribute("aria-pressed", String(count === presets.length));
    if (count === presets.length) selectedButton = button;
    button.addEventListener("click", () => {
      const nextPresets = resizePresets(presets, count);
      const activeWidget = getWidget(node, "active_index");
      const activeIndex = Math.max(0, Math.min(Number(activeWidget?.value) || 0, nextPresets.length - 1));
      setWidgetValue(node, presetsWidget, JSON.stringify(nextPresets));
      setWidgetValue(node, activeWidget, activeIndex);
      syncPromptInputs(node, nextPresets[activeIndex]);
      node._wosaiPresetPage = 0;
      node._wosaiPresetRefresh?.();
      closeEditor(node);
    }, { signal: abort.signal });
    countGrid.appendChild(button);
  }
  editor.append(titleRow, countGrid);
  document.body.appendChild(editor);
  const actualEditorWidth = editor.getBoundingClientRect().width;
  const maxEditorLeft = Math.max(0, document.documentElement.clientWidth - actualEditorWidth);
  editor.style.left = `${Math.max(0, Math.min(rect.right - actualEditorWidth, maxEditorLeft))}px`;
  node._wosaiPresetEditor = editor;
  node._wosaiPresetEditorAbort = abort;

  document.addEventListener("pointerdown", (event) => {
    if (!editor.contains(event.target) && event.target !== anchor) closeEditor(node);
  }, { capture: true, signal: abort.signal });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeEditor(node);
  }, { signal: abort.signal });
  selectedButton?.focus();
}

function buildPresetWidget(node) {
  if (node._wosaiPresetRoot) return;
  ensureStyle();
  node._wosaiPresetWidgetHeight = getTabWidgetHeight(DEFAULT_PRESET_IDS.length);
  const root = document.createElement("div");
  root.className = "wosai-pp";
  const hint = document.createElement("div");
  hint.className = "wosai-pp__hint";
  const header = document.createElement("div");
  header.className = "wosai-pp__header";
  const actions = document.createElement("div");
  actions.className = "wosai-pp__actions";
  const clearButton = document.createElement("button");
  clearButton.className = "wosai-pp__settings";
  clearButton.type = "button";
  clearButton.setAttribute("aria-haspopup", "menu");
  clearButton.setAttribute("aria-expanded", "false");
  const importButton = document.createElement("button");
  importButton.className = "wosai-pp__settings";
  importButton.type = "button";
  const exportButton = document.createElement("button");
  exportButton.className = "wosai-pp__settings";
  exportButton.type = "button";
  const settings = document.createElement("button");
  settings.className = "wosai-pp__settings";
  settings.type = "button";
  const batchToggle = document.createElement("button");
  batchToggle.className = "wosai-pp__mode";
  batchToggle.type = "button";
  batchToggle.setAttribute("aria-pressed", "false");
  const importInput = document.createElement("input");
  importInput.type = "file";
  importInput.accept = ".md,.json,.txt,.csv,text/markdown,application/json,text/plain,text/csv";
  importInput.hidden = true;
  const tabs = document.createElement("div");
  tabs.className = "wosai-pp__tabs";
  const pager = document.createElement("div");
  pager.className = "wosai-pp__pager";
  const previousPage = document.createElement("button");
  previousPage.className = "wosai-pp__pager-button";
  previousPage.type = "button";
  previousPage.textContent = "‹";
  previousPage.setAttribute("aria-label", t("nodes.presetPrompt.previousPage", "Previous preset page"));
  const pageLabel = document.createElement("span");
  pageLabel.className = "wosai-pp__pager-label";
  const nextPage = document.createElement("button");
  nextPage.className = "wosai-pp__pager-button";
  nextPage.type = "button";
  nextPage.textContent = "›";
  nextPage.setAttribute("aria-label", t("nodes.presetPrompt.nextPage", "Next preset page"));
  pager.append(previousPage, pageLabel, nextPage);
  actions.append(clearButton, importButton, exportButton, batchToggle, settings);
  header.append(hint, actions);
  root.append(header, importInput, tabs, pager);

  const refresh = () => {
    const presets = normalizePresets(getWidget(node, "presets_data")?.value);
    const activeIndex = Math.max(0, Math.min(Number(getWidget(node, "active_index")?.value) || 0, presets.length - 1));
    const pageCount = Math.max(1, Math.ceil(presets.length / PRESET_PAGE_SIZE));
    const activePage = Math.floor(activeIndex / PRESET_PAGE_SIZE);
    if (node._wosaiPresetPage == null || node._wosaiPresetPage >= pageCount || node._wosaiPresetLastActiveIndex !== activeIndex) {
      node._wosaiPresetPage = Math.min(activePage, pageCount - 1);
    }
    node._wosaiPresetLastActiveIndex = activeIndex;
    const page = Math.max(0, Math.min(node._wosaiPresetPage, pageCount - 1));
    const pageStart = page * PRESET_PAGE_SIZE;
    hint.textContent = t("nodes.presetPrompt.tabHintRename", "↓ Click to select · Right-click to rename");
    previousPage.setAttribute("aria-label", t("nodes.presetPrompt.previousPage", "Previous preset page"));
    nextPage.setAttribute("aria-label", t("nodes.presetPrompt.nextPage", "Next preset page"));
    clearButton.textContent = t("nodes.presetPrompt.clear", "Clear");
    clearButton.title = t("nodes.presetPrompt.clearMenuHint", "Choose which prompts to clear");
    importButton.textContent = t("nodes.presetPrompt.import", "Import");
    importButton.title = t("nodes.presetPrompt.importHint", "Import MD / JSON / TXT / CSV prompt files");
    exportButton.textContent = t("nodes.presetPrompt.export", "Export");
    exportButton.title = t("nodes.presetPrompt.exportHint", "Export Markdown preset document");
    const batchEnabled = Boolean(getWidget(node, "batch_output")?.value);
    batchToggle.textContent = batchEnabled
      ? t("nodes.presetPrompt.outputAll", "All outputs")
      : t("nodes.presetPrompt.outputSingle", "Single output");
    batchToggle.title = batchEnabled
      ? t("nodes.presetPrompt.outputAllHint", "Click to output all presets")
      : t("nodes.presetPrompt.outputSingleHint", "Click to output the selected preset only");
    batchToggle.classList.toggle("is-active", batchEnabled);
    batchToggle.setAttribute("aria-pressed", String(batchEnabled));
    settings.textContent = t("nodes.presetPrompt.settings", "Settings");
    settings.title = t("nodes.presetPrompt.settingsHint", "Modify label count (1–9)");
    tabs.replaceChildren();
    presets.slice(pageStart, pageStart + PRESET_PAGE_SIZE).forEach((preset, pageOffset) => {
      const index = pageStart + pageOffset;
      const button = document.createElement("button");
      button.className = "wosai-pp__tab";
      button.type = "button";
      button.textContent = preset.label;
      button.classList.toggle("is-active", index === activeIndex);
      button.setAttribute("aria-pressed", String(index === activeIndex));
      button.addEventListener("click", () => {
        setWidgetValue(node, getWidget(node, "active_index"), index);
        syncPromptInputs(node, presets[index]);
        refresh();
      });
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        startInlineRename(node, index, button);
      });
      tabs.appendChild(button);
    });
    pager.hidden = pageCount <= 1;
    pageLabel.textContent = `${page + 1} / ${pageCount}`;
    previousPage.disabled = page <= 0;
    nextPage.disabled = page >= pageCount - 1;
    scheduleNodeLayout(node, Math.min(presets.length, PRESET_PAGE_SIZE), root);
  };

  settings.addEventListener("click", () => openSettings(node, settings));
  clearButton.addEventListener("click", () => openClearMenu(node, clearButton));
  importButton.addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", () => {
    importPresets(node, importInput.files?.[0]);
    importInput.value = "";
  });
  exportButton.addEventListener("click", () => exportPresets(node));
  batchToggle.addEventListener("click", () => {
    const widget = getWidget(node, "batch_output");
    if (!widget) return;
    setWidgetValue(node, widget, !widget.value);
    node._wosaiPresetRefresh?.();
    quickToast(widget.value
      ? t("nodes.presetPrompt.outputAllDone", "Switched to all outputs")
      : t("nodes.presetPrompt.outputSingleDone", "Switched to single output"));
  });
  previousPage.addEventListener("click", () => {
    node._wosaiPresetPage = Math.max(0, (node._wosaiPresetPage ?? 0) - 1);
    node._wosaiPresetRefresh?.();
  });
  nextPage.addEventListener("click", () => {
    const count = normalizePresets(getWidget(node, "presets_data")?.value).length;
    const pageCount = Math.max(1, Math.ceil(count / PRESET_PAGE_SIZE));
    node._wosaiPresetPage = Math.min(pageCount - 1, (node._wosaiPresetPage ?? 0) + 1);
    node._wosaiPresetRefresh?.();
  });
  node._wosaiPresetRoot = root;
  node._wosaiPresetRefresh = refresh;
  node._wosaiAfterResetSize = () => node._wosaiPresetRefresh?.();
  node._wosaiPresetDomWidget = addSizedDOMWidget(node, "wosai_preset_tabs", "HTML", root, {
    serialize: false,
    getMinHeight: () => node._wosaiPresetWidgetHeight,
    getMaxHeight: () => node._wosaiPresetWidgetHeight,
    getHeight: () => node._wosaiPresetWidgetHeight,
  });
  // Initial size: use content-driven height (same formula as scheduleNodeLayout)
  // instead of a hardcoded floor that may not match actual content.
  const initPromptHeight = PROMPT_WIDGET_NAMES.length * getWOSAIVarNum("--ws-pp-prompt-min-height", 0);
  const initContentHeight = node._wosaiPresetWidgetHeight + initPromptHeight;
  node.setSize?.([
    Math.max(node.size?.[0] ?? 0, getWOSAIVarNum("--ws-pp-node-min-width")),
    Math.max(node.size?.[1] ?? 0, initContentHeight),
  ]);
  refresh();
}

app.registerExtension({
  name: "WOSAI.PresetPrompt",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_TYPE || nodeType.prototype[PATCH_KEY]) return;
    applyNodeDefTranslation(nodeData);
    const originalCreated = nodeType.prototype.onNodeCreated;
    const originalConfigure = nodeType.prototype.onConfigure;
    const originalRemoved = nodeType.prototype.onRemoved;
    const originalResize = nodeType.prototype.onResize;

    const created = function onNodeCreated(...args) {
      const result = originalCreated?.apply(this, args);
      applyOutputPortLabels(this);
      applyNativeOutputPortShape(this);
      this.widgets?.filter((widget) => WIDGET_NAMES.has(widget.name)).forEach((w) => hideNativeWidget(w, this));
      applyPromptInputHeight(this);
      injectPromptFavorites(this);
      buildPresetWidget(this);
      bindPromptPersistence(this);
      const presets = migrateLegacyPresetPrompts(this);
      const activeIndex = Math.max(0, Math.min(Number(getWidget(this, "active_index")?.value) || 0, presets.length - 1));
      syncPromptInputs(this, presets[activeIndex], false);
      this._wosaiPresetRefresh?.();
      return result;
    };
    const configured = function onConfigure(...args) {
      const result = originalConfigure?.apply(this, args);
      applyOutputPortLabels(this);
      applyNativeOutputPortShape(this);
      this.widgets?.filter((widget) => WIDGET_NAMES.has(widget.name)).forEach((w) => hideNativeWidget(w, this));
      applyPromptInputHeight(this);
      injectPromptFavorites(this);
      buildPresetWidget(this);
      bindPromptPersistence(this);
      const presets = migrateLegacyPresetPrompts(this);
      const activeIndex = Math.max(0, Math.min(Number(getWidget(this, "active_index")?.value) || 0, presets.length - 1));
      syncPromptInputs(this, presets[activeIndex], false);
      this._wosaiPresetRefresh?.();
      return result;
    };
    const removed = function onRemoved(...args) {
      closeEditor(this);
      closeClearMenu(this);
      if (this._wosaiPresetLayoutFrame) cancelAnimationFrame(this._wosaiPresetLayoutFrame);
      this._wosaiPresetRoot = null;
      this._wosaiPresetDomWidget = null;
      this._wosaiPresetRefresh = null;
      this._wosaiAfterResetSize = null;
      return originalRemoved?.apply(this, args);
    };
    const resized = function onResize(...args) {
      const result = originalResize?.apply(this, args);
      if (!this._wosaiPresetApplyingSize && this._wosaiPresetRoot) {
        const visibleCount = this._wosaiPresetRoot.querySelectorAll(".wosai-pp__tab").length;
        scheduleNodeLayout(this, visibleCount, this._wosaiPresetRoot);
      }
      return result;
    };
    nodeType.prototype.onNodeCreated = created;
    nodeType.prototype.onConfigure = configured;
    nodeType.prototype.onRemoved = removed;
    nodeType.prototype.onResize = resized;
    nodeType.prototype[PATCH_KEY] = {
      originalCreated, originalConfigure, originalRemoved, originalResize,
      created, configured, removed, resized,
    };
    presetNodeType = nodeType;
  },
  setup() {
    ensureStyle();
    // Nodes 2.0：注入按 widget 名匹配全局 CSS，隐藏原生 Active preset / Preset data / Output mode
    // 行（Vue 重渲后自动重新生效，避免原生 widget 在 Nodes 2.0 下重新冒出）。Classic 由 ghostWidget 处理。
    injectGlobalHideCSS([...WIDGET_NAMES], "wosai-pp-hide-native");
    offPresetLanguage?.();
    offPresetLanguage = onLangChange(() => {
      const nodes = app.graph?._nodes ?? app.graph?.nodes ?? [];
      nodes.forEach((node) => {
        if (node.type !== NODE_TYPE) return;
        applyOutputPortLabels(node);
        applyNativeOutputPortShape(node);
        node._wosaiPresetRefresh?.();
      });
      app.graph?.setDirtyCanvas?.(true, true);
    });
  },
  remove() {
    offPresetLanguage?.();
    offPresetLanguage = null;
    const nodes = app.graph?._nodes ?? app.graph?.nodes ?? [];
    nodes.forEach((node) => {
      if (node.type !== NODE_TYPE) return;
      closeEditor(node);
      closeClearMenu(node);
      if (node._wosaiPresetLayoutFrame) cancelAnimationFrame(node._wosaiPresetLayoutFrame);
      node._wosaiPresetRoot?.remove?.();
      node._wosaiPresetRoot = null;
      node._wosaiPresetDomWidget = null;
      node._wosaiPresetRefresh = null;
      node._wosaiAfterResetSize = null;
    });
    const proto = presetNodeType?.prototype;
    const patch = proto?.[PATCH_KEY];
    if (patch) {
      if (proto.onNodeCreated === patch.created) proto.onNodeCreated = patch.originalCreated;
      if (proto.onConfigure === patch.configured) proto.onConfigure = patch.originalConfigure;
      if (proto.onRemoved === patch.removed) proto.onRemoved = patch.originalRemoved;
      if (proto.onResize === patch.resized) proto.onResize = patch.originalResize;
      delete proto[PATCH_KEY];
    }
    presetNodeType = null;
    document.getElementById(STYLE_ID)?.remove();
  },
});
