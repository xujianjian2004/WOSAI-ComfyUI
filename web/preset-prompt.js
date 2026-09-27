import { app } from "../../../scripts/app.js";
import { t, applyNodeDefTranslation, onLangChange } from "./shared/i18n.js";
import { getWOSAIVarNum } from "./shared/shared-utils.js";
import { addSizedDOMWidget } from "./shared/dom-widget.js";
import { parsePresetImport, serializePresetExport, serializePresetJson } from "./shared/preset-transfer-engine.js";
import { NODE_CATEGORY_LIMIT, NODE_PRESET_LIMIT, loadPresetLibrary, makeLibraryId, savePresetLibrary, selectedSnapshot } from "./shared/preset-library-api.js";
import { quickToast } from "./shared/toast.js";
import { ghostWidget, hideEl, hideWidgetRow, injectGlobalHideCSS } from "./shared/nodes2-hide.js";

const NODE_TYPE = "WOSAI_PresetPromptSelector";
const PATCH_KEY = "__wosaiPresetPromptPatched";
const STYLE_ID = "wosai-preset-prompt-style";
// Data-only widgets have no user-facing socket and can be fully hidden.
const BACKING_WIDGET_NAMES = new Set(["active_index", "presets_data"]);
const MAX_PRESET_COUNT = 999;
const PRESET_PAGE_SIZE = 9;
const DEFAULT_PRESET_COUNT = 9;
const LAYOUT_SETTLE_PASSES = 1;
let presetNodeType = null;
let offPresetLanguage = null;

const CATEGORY_VISUALS = {
  category_01: { icon: "M4 20 14.5 9.5m1.5-5 2 2m-7.4 5.4 2 2M5 15l4 4", cover: "linear-gradient(135deg, #5e5141, #292622 68%)" },
  category_02: { icon: "M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4", cover: "linear-gradient(135deg, #30535f, #202b30 68%)" },
  category_03: { icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0", cover: "linear-gradient(135deg, #6a4650, #30242a 68%)" },
  category_04: { icon: "m4 16 9.5-9.5 4 4L8 20H4v-4Zm10.5-9.5 2-2 4 4-2 2", cover: "linear-gradient(135deg, #5a4f37, #2e2b22 68%)" },
  category_05: { icon: "M7 7h10m0 0-3-3m3 3-3 3M17 17H7m0 0 3 3m-3-3 3-3", cover: "linear-gradient(135deg, #453d77, #292640 68%)" },
  category_06: { icon: "M12 4a8 8 0 1 0 0 16h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h1a2 2 0 0 0 0-4h-2ZM7.5 10h.01M9 7.5h.01M12 7h.01M7 14h.01", cover: "linear-gradient(135deg, #6c4e70, #30263a 68%)" },
  category_07: { icon: "M5 8h14l-1 12H6L5 8Zm3 0V6a4 4 0 0 1 8 0v2", cover: "linear-gradient(135deg, #585130, #312e20 68%)" },
  category_08: { icon: "m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z", cover: "linear-gradient(135deg, #405d63, #233238 68%)" },
  category_09: { icon: "M12 3v2m0 14v2M3 12h2m14 0h2m-3.6-6.4-1.4 1.4M7.4 17.4 6 18.8m0-13.2 1.4 1.4m10.2 10.4 1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z", cover: "linear-gradient(135deg, #6d5534, #322b22 68%)" },
  category_10: { icon: "M5 5h14M12 5v14M8 19h8", cover: "linear-gradient(135deg, #484f63, #292c38 68%)" },
  category_11: { icon: "M4 5h16v14H4V5Zm3 10 3-3 2.5 2.5 2-2L18 16", cover: "linear-gradient(135deg, #4b6258, #27342e 68%)" },
  default: { icon: "M4 5h16v14H4V5Zm3 10 3-3 2.5 2.5 2-2L18 16", cover: "linear-gradient(135deg, #4a4a4a, #292929 68%)" },
};

const EDIT_ICON_PATH = "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z";
const SEARCH_ICON_PATH = "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16ZM21 21l-4.35-4.35";
const EYE_ICON_PATH = "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z";
const THUMBNAIL_ICON_PATH = "M4 8h3l2-2h6l2 2h3v11H4V8Zm8 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z";
const STAR_ICON_PATH = "m12 3 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.3 6.8 19.2l1-5.9L3.5 9.2l5.9-.8L12 3Z";

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
  const href = new URL("./styles/preset-prompt.css?v=51", import.meta.url).href;
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

function getCategoryVisual(categoryI18n) {
  return CATEGORY_VISUALS[categoryI18n] ?? CATEGORY_VISUALS.default;
}

function getLibraryVisualKey(category, preset = null) {
  const source = `${category?.id ?? category?.label ?? "library"}:${preset?.id ?? preset?.label ?? ""}`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0;
  return `category_${String(Math.abs(hash) % 11 + 1).padStart(2, "0")}`;
}

function createLineIcon(pathData, className) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add(className);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

function isPresetEmpty(preset) {
  return !String(preset?.prompt_cn ?? "").trim() && !String(preset?.prompt_en ?? "").trim();
}

function sortByPinned(entries) {
  return [...entries].sort((a, b) => (b.preset.pinned ? 1 : 0) - (a.preset.pinned ? 1 : 0));
}

function createPresetCover(preset, index) {
  const visual = getCategoryVisual(preset.category_i18n);
  const cover = document.createElement("span");
  cover.className = "wosai-pp__tab-cover";
  cover.style.setProperty("--wosai-pp-cover", visual.cover);
  const thumbnail = String(preset.thumbnail ?? "").trim();
  cover.classList.toggle("has-image", Boolean(thumbnail));
  if (thumbnail) {
    const image = document.createElement("img");
    image.src = thumbnail;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => {
      image.remove();
      cover.classList.remove("has-image");
    }, { once: true });
    cover.append(image);
  }
  const glyph = createLineIcon(visual.icon, "wosai-pp__tab-cover-icon");
  glyph.style.setProperty("--wosai-pp-cover-delay", String(index % 3));
  cover.append(glyph);
  return cover;
}

function resizeNativePromptInputs(node, attempts = 0) {
  const body = document.querySelector(`[data-testid="node-body-${node.id}"]`);
  const textareas = body ? Array.from(body.querySelectorAll("textarea")) : [];
  if (!textareas.length) {
    if (attempts < 20) setTimeout(() => resizeNativePromptInputs(node, attempts + 1), 50);
    return;
  }
  const minHeight = getWOSAIVarNum("--ws-pp-native-prompt-min-height", 64);
  const maxHeight = getWOSAIVarNum("--ws-pp-native-prompt-max-height", 180);
  textareas.forEach((textarea) => {
    textarea.style.setProperty("height", "auto", "important");
    const height = Math.min(maxHeight, Math.max(minHeight, textarea.scrollHeight));
    textarea.style.setProperty("height", `${height}px`, "important");
    textarea.style.setProperty("overflow-y", textarea.scrollHeight > maxHeight ? "auto" : "hidden", "important");
    if (!textarea._wosaiPresetAutoResize) {
      textarea.addEventListener("input", () => resizeNativePromptInputs(node));
      textarea._wosaiPresetAutoResize = true;
    }
  });
  if (node._wosaiPresetRoot) {
    scheduleNodeLayout(node, node._wosaiPresetRoot.querySelectorAll(".wosai-pp__tab").length, node._wosaiPresetRoot);
  }
}

function patchNode2PromptInputs(node, attempts = 0) {
  const body = document.querySelector(`[data-testid="node-body-${node.id}"]`);
  if (body) {
    body.classList.add("wosai-pp-node-body");
    const hostBrandFooter = Array.from(body.children).find((element) => (
      element.textContent?.trim() === "WOSAI"
    ));
    hostBrandFooter?.classList.add("wosai-pp__host-brand-footer");
    resizeNativePromptInputs(node);
  }

  if (attempts < 20 && !body) {
    setTimeout(() => patchNode2PromptInputs(node, attempts + 1), 50);
  }
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
  // Classic uses the zero-height widget suite; Nodes 2.0 gets an immediate
  // DOM hide while the injected CSS below survives Vue re-renders.
  ghostWidget(widget);
  const element = widget.element ?? widget.dom ?? widget.inputEl;
  if (element) {
    hideEl(element, true);
    hideWidgetRow(element, node?.element ?? node?.dom);
  }
}

function getFallbackPreset(index) {
  return {
    category: "通用",
    label: getPlaceholderPresetLabel(index),
    prompt_cn: "",
    prompt_en: "",
  };
}

function getPlaceholderCategoryLabel(index) {
  return t("nodes.presetPrompt.placeholderCategory", "Category {index}")
    .replaceAll("{index}", String(index + 1));
}

function getPlaceholderPresetLabel(index) {
  return t("nodes.presetPrompt.placeholderPreset", "Preset {index}")
    .replaceAll("{index}", String(index + 1));
}

function normalizePresetLabel(item, index, fallback) {
  if (item?._wosaiLabelCleared) return "";
  const label = String(item?.label ?? "").trim();
  if (!label) return fallback.label;
  const definition = getDefaultPresetDefinition(index);
  // Built-in labels are legacy data values; render them in the active locale
  // while preserving any user-defined rename verbatim. Resolve the proper
  // descriptive name here rather than via the (now blank-by-default)
  // getFallbackPreset(), so legacy saved workflows keep their real name.
  if (definition?.legacyLabels?.includes(label)) {
    return t(`nodes.presetPrompt.defaults.${definition.id}`, label);
  }
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
          category: String(item.category ?? "通用").trim() || "通用",
          category_i18n: String(item.category_i18n ?? "").trim(),
          library_category_id: String(item.library_category_id ?? "").trim(),
          library_id: String(item.library_id ?? "").trim(),
          label: normalizePresetLabel(item, index, fallback),
          label_i18n: String(item.label_i18n ?? "").trim(),
          thumbnail: String(item.thumbnail ?? "").trim(),
          pinned: Boolean(item.pinned),
          prompt_cn: restoreLegacyChinesePrompt(item, getDefaultPresetDefinition(index)),
          prompt_en: restoreLegacyEnglishPrompt(item, getDefaultPresetDefinition(index)),
          _wosaiLabelCleared: Boolean(item._wosaiLabelCleared),
          _wosaiPromptCnCleared: Boolean(item._wosaiPromptCnCleared || (item._wosaiPromptEnCleared && !String(item.prompt_cn ?? "").trim())),
          _wosaiPromptEnCleared: Boolean(item._wosaiPromptEnCleared),
        };
      });
    return normalized.length
      ? limitNodeSnapshot(normalized.slice(0, MAX_PRESET_COUNT))
      : Array.from({ length: DEFAULT_PRESET_COUNT }, (_, index) => getFallbackPreset(index));
  } catch {
    return Array.from({ length: DEFAULT_PRESET_COUNT }, (_, index) => getFallbackPreset(index));
  }
}

function getCatalogText(kind, key, fallback) {
  if (!key) return fallback;
  const i18nKey = `nodes.presetPrompt.catalog.${kind}.${key}`;
  const translated = t(i18nKey, fallback);
  return translated === i18nKey ? fallback : translated;
}

function migrateLegacyPresetPrompts(node) {
  const presetsWidget = getWidget(node, "presets_data");
  const rawValue = presetsWidget?.value;
  const presets = normalizePresets(rawValue);
  try {
    const parsed = JSON.parse(rawValue);
    const needsMigration = Array.isArray(parsed) && (
      parsed.length !== presets.length
      || parsed.some((item, index) => (
        item
        && typeof item === "object"
        && (
          String(item.prompt_cn ?? "") !== (presets[index]?.prompt_cn ?? "")
          || String(item.prompt_en ?? "") !== (presets[index]?.prompt_en ?? "")
        )
      ))
    );
    if (needsMigration) setWidgetValue(node, presetsWidget, JSON.stringify(presets), false);
  } catch {
    // New nodes receive valid backend defaults; invalid legacy data is shown from the safe fallback.
  }
  return presets;
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
  // scrollHeight is measured in the DOM widget's unscaled CSS pixels and
  // includes overflow from the grid's second row. getBoundingClientRect()
  // is canvas-zoomed, which can make the second card row appear too short.
  return Math.ceil(root.scrollHeight);
}

function scheduleNodeLayout(node, count, root) {
  const minimumHeight = getTabWidgetHeight(count);
  node._wosaiPresetRequestedHeight = minimumHeight;
  if (node._wosaiPresetLayoutFrame) return;
  let remainingPasses = LAYOUT_SETTLE_PASSES;
  const applyLayout = () => {
    node._wosaiPresetLayoutFrame = null;
    const measuredHeight = measurePresetContentHeight(root);
    const targetHeight = Math.max(node._wosaiPresetRequestedHeight ?? minimumHeight, measuredHeight);
    // Avoid a size write for sub-pixel changes. In Nodes 2.0 these writes
    // re-mount the DOM widget and previously made the manager visibly blink.
    if (Math.abs((node._wosaiPresetWidgetHeight ?? 0) - targetHeight) >= 1) {
      node._wosaiPresetWidgetHeight = targetHeight;
    }
    const [computedWidth = 0, computedHeight = 0] = node.computeSize?.() ?? [];
    // Respect a manual width while keeping the control usable at its supported
    // minimum. Responsive rows must reflow instead of widening past the node.
    const width = Math.max(
      node.size?.[0] ?? computedWidth,
      getWOSAIVarNum("--ws-pp-node-min-width", 0),
    );
    // Preset Manager owns its content height. Nodes 2.0 can transiently grow
    // the host node while DOM rows reflow; preserving that intermediate value
    // leaves a large blank strip below the card grid after a width-only resize.
    const height = Math.max(computedHeight, getWOSAIVarNum("--ws-pp-node-height", 0));
    const sizeChanged = Math.abs((node.size?.[0] ?? 0) - width) >= 1
      || Math.abs((node.size?.[1] ?? 0) - height) >= 1;
    if (sizeChanged) {
      node._wosaiPresetApplyingSize = true;
      try {
        node.setSize?.([width, height]);
      } finally {
        node._wosaiPresetApplyingSize = false;
      }
    }
    node._wosaiPresetManagedHeight = height;
    if (sizeChanged) node.setDirtyCanvas?.(true, true);
    remainingPasses -= 1;
    if (remainingPasses > 0 && root?.isConnected) {
      node._wosaiPresetLayoutFrame = requestAnimationFrame(applyLayout);
    }
  };
  node._wosaiPresetLayoutFrame = requestAnimationFrame(applyLayout);
}

function observePresetLayout(node, root, content) {
  if (node._wosaiPresetLayoutObserver || typeof ResizeObserver === "undefined") return;
  node._wosaiPresetLayoutObserver = new ResizeObserver(() => {
    const narrowBreakpoint = getWOSAIVarNum("--ws-pp-narrow-breakpoint", 340);
    root.classList.toggle("wosai-pp--narrow", (root.offsetWidth || 0) < narrowBreakpoint);
    if (!root.isConnected || node._wosaiPresetLayoutFrame) return;
    scheduleNodeLayout(node, root.querySelectorAll(".wosai-pp__tab").length, root);
  });
  // The content column's height changes after a narrow node reflows.  Observe
  // that column rather than the host node so an automatic height correction
  // does not recursively trigger itself.
  node._wosaiPresetLayoutObserver.observe(content);
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
  requestAnimationFrame(() => resizeNativePromptInputs(node));
}

function downloadPresetFile(presets, format) {
  const isJson = format === "json";
  const content = isJson ? serializePresetJson(presets) : serializePresetExport(presets);
  const blob = new Blob([content], { type: isJson ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8" });
  const anchor = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `wosai-preset-manager-${stamp}.${isJson ? "json" : "md"}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
}

function exportPresets(node, format) {
  const presets = normalizePresets(getWidget(node, "presets_data")?.value);
  downloadPresetFile(presets, format);
  quickToast(t("nodes.presetPrompt.exportFormatDone", "Exported {format} file")
    .replace("{format}", format === "json" ? "JSON" : "Markdown"));
}

function getImportLabel(file) {
  return String(file?.name ?? "")
    .replace(/\.[^.]+$/, "")
    .trim() || t("nodes.presetPrompt.importedLabel", "Imported preset");
}

function limitNodeSnapshot(presets) {
  const result = [];
  const categories = new Set();
  const counts = new Map();
  for (const preset of presets) {
    const category = String(preset.category ?? "通用").trim() || "通用";
    if (!categories.has(category)) {
      if (categories.size >= NODE_CATEGORY_LIMIT) continue;
      categories.add(category);
    }
    const count = counts.get(category) ?? 0;
    if (count >= NODE_PRESET_LIMIT) continue;
    counts.set(category, count + 1);
    result.push(preset);
  }
  return result;
}

function importPresets(node, file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const presets = limitNodeSnapshot(parsePresetImport(reader.result, getImportLabel(file), file.name));
      if (!presets.length) throw new Error("No preset data found.");
      const proceed = window.confirm(
        t("nodes.presetPrompt.importConfirm", "导入将覆盖当前节点已有的全部预设（共 {count} 条），确定继续吗？")
          .replace("{count}", String(presets.length)),
      );
      if (!proceed) return;
      const presetsWidget = getWidget(node, "presets_data");
      const activeWidget = getWidget(node, "active_index");
      setWidgetValue(node, presetsWidget, JSON.stringify(presets));
      setWidgetValue(node, activeWidget, 0);
      syncPromptInputs(node, presets[0]);
      node._wosaiPresetRefresh?.();
      quickToast(t("nodes.presetPrompt.importDone", "Imported {count} presets").replace("{count}", String(presets.length)));
    } catch (error) {
      console.warn("[WOSAI] preset import failed", error);
      quickToast(t("nodes.presetPrompt.importFailed", "Unable to read preset file"));
    }
  };
  reader.onerror = () => quickToast(t("nodes.presetPrompt.importFailed", "Unable to read preset file"));
  reader.readAsText(file, "utf-8");
}

function cleanupEmptyPresetMeta(node) {
  const presetsWidget = getWidget(node, "presets_data");
  const presets = normalizePresets(presetsWidget?.value);
  let changed = false;
  const next = presets.map((preset) => {
    if (!isPresetEmpty(preset)) return preset;
    if (!preset.pinned && !preset.thumbnail) return preset;
    changed = true;
    return { ...preset, pinned: false, thumbnail: "" };
  });
  if (!changed) {
    quickToast(t("nodes.presetPrompt.cleanupNothing", "没有需要清理的空白预设"));
    return;
  }
  setWidgetValue(node, presetsWidget, JSON.stringify(next));
  node._wosaiPresetRefresh?.();
  quickToast(t("nodes.presetPrompt.cleanupDone", "已重置空白预设的封面与置顶状态"));
}

function clearAllPresetPrompts(node) {
  closeClearMenu(node);
  closeExportMenu(node);
  const presetsWidget = getWidget(node, "presets_data");
  const current = normalizePresets(presetsWidget?.value);
  const categories = [...new Set(current.map((preset) => preset.category || "通用"))];
  const placeholderPresets = (categories.length ? categories : ["通用"])
    .flatMap((_, categoryIndex) => Array.from({ length: PRESET_PAGE_SIZE }, (_, presetIndex) => ({
      category: getPlaceholderCategoryLabel(categoryIndex),
      label: getPlaceholderPresetLabel(presetIndex),
      prompt_cn: "",
      prompt_en: "",
      _wosaiLabelCleared: false,
      _wosaiPromptCnCleared: true,
      _wosaiPromptEnCleared: true,
    })));
  setWidgetValue(node, presetsWidget, JSON.stringify(placeholderPresets));
  setWidgetValue(node, getWidget(node, "active_index"), 0);
  node._wosaiPresetCategory = placeholderPresets[0].category;
  syncPromptInputs(node, placeholderPresets[0]);
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
  node._wosaiPresetRefresh?.();
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
      requestAnimationFrame(() => resizeNativePromptInputs(node));
    };
  });
  node._wosaiPresetPromptBindings = true;
}

function closeClearMenu(node) {
  node._wosaiPresetClearMenu?.remove();
  node._wosaiPresetClearMenu = null;
  node._wosaiPresetClearMenuAbort?.abort();
  node._wosaiPresetClearMenuAbort = null;
  node._wosaiPresetClearMenuAnchor?.setAttribute("aria-expanded", "false");
  node._wosaiPresetClearMenuAnchor = null;
}

function closeExportMenu(node) {
  node._wosaiPresetExportMenu?.remove();
  node._wosaiPresetExportMenu = null;
  node._wosaiPresetExportMenuAbort?.abort();
  node._wosaiPresetExportMenuAbort = null;
  node._wosaiPresetExportMenuAnchor?.setAttribute("aria-expanded", "false");
  node._wosaiPresetExportMenuAnchor = null;
}

function openClearMenu(node, anchor) {
  if (node._wosaiPresetClearMenu) {
    closeClearMenu(node);
    return;
  }
  closeExportMenu(node);
  closeMoreMenu(node);
  const menu = document.createElement("div");
  const abort = new AbortController();
  const rect = anchor.getBoundingClientRect();
  const menuWidth = getWOSAIVarNum("--ws-pp-clear-menu-min-width");
  const viewportWidth = document.documentElement.clientWidth;
  menu.className = "wosai-pp-clear-menu";
  menu.dataset.wosaiClearMenu = "true";
  menu.setAttribute("role", "menu");
  menu.style.left = `${Math.max(0, Math.min(rect.left + (rect.width - menuWidth) / 2, viewportWidth - menuWidth))}px`;
  menu.style.top = `${rect.top}px`;

  const hint = document.createElement("p");
  hint.className = "wosai-pp-clear-menu__hint";
  hint.textContent = t("nodes.presetPrompt.clearConfirmHint", "清空该节点下的全部预设？此操作不可撤销。");

  const confirmButton = document.createElement("button");
  confirmButton.className = "wosai-pp-clear-menu__button wosai-pp-clear-menu__button--danger";
  confirmButton.type = "button";
  confirmButton.setAttribute("role", "menuitem");
  confirmButton.textContent = t("nodes.presetPrompt.clearConfirm", "确认清空");
  confirmButton.addEventListener("click", () => {
    closeClearMenu(node);
    clearAllPresetPrompts(node);
  }, { signal: abort.signal });

  const cancelButton = document.createElement("button");
  cancelButton.className = "wosai-pp-clear-menu__button";
  cancelButton.type = "button";
  cancelButton.setAttribute("role", "menuitem");
  cancelButton.textContent = t("nodes.presetPrompt.cancel", "取消");
  cancelButton.addEventListener("click", () => closeClearMenu(node), { signal: abort.signal });

  menu.append(hint, confirmButton, cancelButton);
  document.body.appendChild(menu);
  const actualMenuWidth = menu.getBoundingClientRect().width;
  menu.style.left = `${Math.max(0, Math.min(rect.left + (rect.width - actualMenuWidth) / 2, document.documentElement.clientWidth - actualMenuWidth))}px`;
  node._wosaiPresetClearMenu = menu;
  node._wosaiPresetClearMenuAbort = abort;
  node._wosaiPresetClearMenuAnchor = anchor;
  anchor.setAttribute("aria-expanded", "true");

  document.addEventListener("pointerdown", (event) => {
    if (!menu.contains(event.target) && event.target !== anchor) closeClearMenu(node);
  }, { capture: true, signal: abort.signal });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeClearMenu(node);
  }, { signal: abort.signal });
  cancelButton.focus();
}

function closeMoreMenu(node) {
  node._wosaiPresetMoreMenu?.remove();
  node._wosaiPresetMoreMenu = null;
  node._wosaiPresetMoreMenuAbort?.abort();
  node._wosaiPresetMoreMenuAbort = null;
  node._wosaiPresetMoreMenuAnchor?.setAttribute("aria-expanded", "false");
  node._wosaiPresetMoreMenuAnchor = null;
}

function openMoreMenu(node, anchor, importInput) {
  if (node._wosaiPresetMoreMenu) {
    closeMoreMenu(node);
    return;
  }
  closeClearMenu(node);
  closeExportMenu(node);
  const menu = document.createElement("div");
  const abort = new AbortController();
  const rect = anchor.getBoundingClientRect();
  const menuWidth = getWOSAIVarNum("--ws-pp-clear-menu-min-width");
  const viewportWidth = document.documentElement.clientWidth;
  menu.className = "wosai-pp-clear-menu";
  menu.dataset.wosaiMoreMenu = "true";
  menu.setAttribute("role", "menu");
  menu.style.left = `${Math.max(0, Math.min(rect.right - menuWidth, viewportWidth - menuWidth))}px`;
  menu.style.top = `${rect.bottom + 4}px`;

  const makeItem = (label, onClick, danger = false) => {
    const button = document.createElement("button");
    button.className = danger
      ? "wosai-pp-clear-menu__button wosai-pp-clear-menu__button--danger"
      : "wosai-pp-clear-menu__button";
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    button.addEventListener("click", () => {
      closeMoreMenu(node);
      onClick();
    }, { signal: abort.signal });
    return button;
  };

  const items = [
    makeItem(t("nodes.presetPrompt.moreImport", "导入数据"), () => importInput.click()),
    makeItem(t("nodes.presetPrompt.exportJson", "导出 JSON"), () => exportPresets(node, "json")),
    makeItem(t("nodes.presetPrompt.moreExportMd", "导出 MD"), () => exportPresets(node, "md")),
    makeItem(t("nodes.presetPrompt.cleanupEmpty", "清理空白预设"), () => cleanupEmptyPresetMeta(node)),
    makeItem(t("nodes.presetPrompt.moreClear", "清空全部预设"), () => openClearMenu(node, anchor), true),
  ];
  menu.append(...items);
  document.body.appendChild(menu);
  const actualMenuWidth = menu.getBoundingClientRect().width;
  menu.style.left = `${Math.max(0, Math.min(rect.right - actualMenuWidth, document.documentElement.clientWidth - actualMenuWidth))}px`;
  node._wosaiPresetMoreMenu = menu;
  node._wosaiPresetMoreMenuAbort = abort;
  node._wosaiPresetMoreMenuAnchor = anchor;
  anchor.setAttribute("aria-expanded", "true");

  document.addEventListener("pointerdown", (event) => {
    if (!menu.contains(event.target) && event.target !== anchor) closeMoreMenu(node);
  }, { capture: true, signal: abort.signal });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMoreMenu(node);
  }, { signal: abort.signal });
  items[0].focus();
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

function startInlineThumbnail(node, index, tab) {
  const presetsWidget = getWidget(node, "presets_data");
  const presets = normalizePresets(presetsWidget?.value);
  const preset = presets[index] ?? getFallbackPreset(index);
  const thumbInput = document.createElement("input");
  thumbInput.className = "wosai-pp__tab-input";
  thumbInput.type = "text";
  thumbInput.value = preset.thumbnail ?? "";
  thumbInput.placeholder = t("nodes.presetPrompt.thumbnailPlaceholder", "封面图片 URL，留空恢复默认图标");
  tab.classList.add("is-editing");
  tab.replaceChildren(thumbInput);

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    if (save) {
      const url = thumbInput.value.trim();
      presets[index] = { ...preset, thumbnail: url };
      setWidgetValue(node, presetsWidget, JSON.stringify(presets));
    }
    node._wosaiPresetRefresh?.();
  };

  ["pointerdown", "click", "contextmenu"].forEach((type) => {
    thumbInput.addEventListener(type, (event) => event.stopPropagation());
  });
  thumbInput.addEventListener("keydown", (event) => {
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
  thumbInput.addEventListener("blur", () => finish(true));
  thumbInput.focus();
  thumbInput.select();
}

function startInlineCategoryRename(node, category, button) {
  const presetsWidget = getWidget(node, "presets_data");
  const labelInput = document.createElement("input");
  labelInput.className = "wosai-pp__category-input";
  labelInput.type = "text";
  labelInput.value = category;
  labelInput.required = true;
  button.classList.add("is-editing");
  button.replaceChildren(labelInput);

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    const nextCategory = labelInput.value.trim();
    if (save && nextCategory && nextCategory !== category) {
      const presets = normalizePresets(presetsWidget?.value);
      if (presets.some((preset) => preset.category === nextCategory)) {
        quickToast(t("nodes.presetPrompt.categoryExists", "A category with this name already exists"));
      } else {
        const renamed = presets.map((preset) => (
          preset.category === category
            ? { ...preset, category: nextCategory, category_i18n: "" }
            : preset
        ));
        setWidgetValue(node, presetsWidget, JSON.stringify(renamed));
        node._wosaiPresetCategory = nextCategory;
      }
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

function selectedLibraryIds(library, presets) {
  const savedIds = new Set(presets.map((preset) => preset.library_id).filter(Boolean));
  if (savedIds.size) return savedIds;
  const names = new Set(presets.map((preset) => `${preset.category}\u0000${preset.label}`));
  return new Set((library.categories ?? []).flatMap((category) => (category.presets ?? [])
    .filter((preset) => names.has(`${category.label}\u0000${preset.label}`))
    .map((preset) => preset.id)));
}

function mergeImportedLibraryPresets(library, imported) {
  const categories = library.categories ?? (library.categories = []);
  const byName = new Map(categories.map((category) => [category.label, category]));
  for (const item of imported) {
    const label = String(item.label ?? "").trim();
    if (!label) continue;
    const categoryName = String(item.category ?? "未分类").trim() || "未分类";
    let category = byName.get(categoryName);
    if (!category) {
      category = { id: makeLibraryId("category"), label: categoryName, label_i18n: item.category_i18n ?? "", presets: [] };
      categories.push(category);
      byName.set(categoryName, category);
    }
    const exists = category.presets.some((preset) => (
      preset.label === label && preset.prompt_cn === String(item.prompt_cn ?? "") && preset.prompt_en === String(item.prompt_en ?? "")
    ));
    if (!exists) {
      category.presets.push({
        id: makeLibraryId("preset"), label, label_i18n: item.label_i18n ?? "",
        thumbnail: item.thumbnail ?? "", prompt_cn: item.prompt_cn ?? "", prompt_en: item.prompt_en ?? "",
      });
    }
  }
}

async function openPresetLibrary(node) {
  // Tear down a previously opened instance through its own close path so the
  // old dialog's AbortController (document keydown) is released, not just its DOM.
  node._wosaiPresetLibraryClose?.();
  node._wosaiPresetLibraryModal?.remove();
  let library;
  try {
    library = await loadPresetLibrary();
  } catch (error) {
    console.warn("[WOSAI] preset library unavailable", error);
    quickToast(t("nodes.presetPrompt.libraryUnavailable", "Preset library is unavailable"));
    return;
  }
  const presets = normalizePresets(getWidget(node, "presets_data")?.value);
  const selected = selectedLibraryIds(library, presets);
  let activeCategoryId = library.categories?.find((category) => category.presets?.some((preset) => selected.has(preset.id)))?.id
    ?? library.categories?.[0]?.id;

  const backdrop = document.createElement("div");
  backdrop.className = "wosai-pp-library-backdrop";
  backdrop.setAttribute("role", "presentation");
  const dialog = document.createElement("section");
  dialog.className = "wosai-pp-library";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  const getNodeRect = () => {
    const host = node._wosaiPresetRoot?.closest?.(`[data-node-id="${node.id}"]`);
    return host?.getBoundingClientRect() ?? node._wosaiPresetRoot?.getBoundingClientRect();
  };
  const nodeRoot = node._wosaiPresetRoot;
  const renderedWidth = nodeRoot?.getBoundingClientRect().width ?? 0;
  const unscaledWidth = nodeRoot?.offsetWidth ?? 0;
  // Canvas nodes are transformed by the current zoom but this fixed dialog is
  // not. Carry that visual scale into its typography so both stay comparable.
  const canvasScale = unscaledWidth > 0 ? renderedWidth / unscaledWidth : 1;
  const clampedCanvasScale = Math.max(1, Math.min(canvasScale, 2));
  dialog.style.setProperty("--wosai-pp-library-font-scale", String(clampedCanvasScale));
  dialog.style.setProperty("--wosai-pp-library-control-scale", String(clampedCanvasScale));
  // Keep the library visually tied to the complete rendered node, not the
  // lower custom widget area. Canvas zoom makes node.size unsuitable here.
  const nodeWidth = getNodeRect()?.width ?? 0;
  if (nodeWidth > 0) {
    const viewportWidth = document.documentElement.clientWidth;
    dialog.style.width = `${Math.round(Math.min(viewportWidth - 32, Math.max(520, nodeWidth)))}px`;
  }
  const title = document.createElement("div");
  title.className = "wosai-pp-library__title";
  const titleLabel = document.createElement("span");
  titleLabel.className = "wosai-pp-library__title-label";
  titleLabel.textContent = t("nodes.presetPrompt.library", "Preset library");
  const titleMeta = document.createElement("span");
  titleMeta.className = "wosai-pp-library__title-meta";
  title.append(titleLabel, titleMeta);
  const dock = document.createElement("button");
  dock.className = "wosai-pp-library__dock";
  dock.type = "button";
  dock.textContent = "↺";
  dock.title = t("nodes.presetPrompt.restoreLibraryPosition", "Restore beside node");
  dock.setAttribute("aria-label", dock.title);
  const close = document.createElement("button");
  close.className = "wosai-pp-library__close";
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", t("common.close", "Close"));
  const header = document.createElement("header");
  header.className = "wosai-pp-library__header";
  header.append(title, dock, close);
  const categoryList = document.createElement("div");
  categoryList.className = "wosai-pp-library__categories";
  const presetList = document.createElement("div");
  presetList.className = "wosai-pp-library__presets";
  const body = document.createElement("div");
  body.className = "wosai-pp-library__body";
  body.append(categoryList, presetList);
  const importInput = document.createElement("input");
  importInput.type = "file";
  importInput.accept = ".md,.json,.txt,.csv,text/markdown,application/json,text/plain,text/csv";
  importInput.hidden = true;
  const importButton = document.createElement("button");
  importButton.className = "wosai-pp__settings";
  importButton.type = "button";
  importButton.textContent = t("nodes.presetPrompt.importToLibrary", "Import to library");
  const apply = document.createElement("button");
  apply.className = "wosai-pp__settings wosai-pp-library__apply";
  apply.type = "button";
  apply.textContent = t("nodes.presetPrompt.syncToNode", "Sync to node");
  const footer = document.createElement("footer");
  footer.className = "wosai-pp-library__footer";
  const syncStatus = document.createElement("span");
  syncStatus.className = "wosai-pp-library__sync-status";
  footer.append(importInput, syncStatus, importButton, apply);
  dialog.append(header, body, footer);
  backdrop.append(dialog);
  document.body.append(backdrop);
  node._wosaiPresetLibraryModal = backdrop;
  const dialogEvents = new AbortController();

  const clampDialogPosition = (left, top) => {
    const rect = dialog.getBoundingClientRect();
    const margin = 16;
    return {
      left: Math.round(Math.max(margin, Math.min(left, document.documentElement.clientWidth - rect.width - margin))),
      top: Math.round(Math.max(margin, Math.min(top, document.documentElement.clientHeight - rect.height - margin))),
    };
  };
  const anchorDialogToNode = () => {
    const nodeRect = getNodeRect();
    const dialogRect = dialog.getBoundingClientRect();
    if (!nodeRect || !dialogRect.width) return;
    const gap = 16;
    const fitsRight = nodeRect.right + gap + dialogRect.width <= document.documentElement.clientWidth - gap;
    const left = fitsRight ? nodeRect.right + gap : nodeRect.left - gap - dialogRect.width;
    const top = nodeRect.top + (nodeRect.height - dialogRect.height) / 2;
    const position = clampDialogPosition(left, top);
    dialog.style.left = `${position.left}px`;
    dialog.style.top = `${position.top}px`;
  };
  const snapDialogToNode = () => {
    const nodeRect = getNodeRect();
    const dialogRect = dialog.getBoundingClientRect();
    if (!nodeRect || !dialogRect.width) return;
    const gap = 16;
    const snapDistance = 72;
    const nearRight = Math.abs(dialogRect.left - (nodeRect.right + gap)) <= snapDistance;
    const nearLeft = Math.abs(dialogRect.right - (nodeRect.left - gap)) <= snapDistance;
    if (!nearRight && !nearLeft) return;
    const left = nearRight ? nodeRect.right + gap : nodeRect.left - gap - dialogRect.width;
    const top = nodeRect.top + (nodeRect.height - dialogRect.height) / 2;
    const position = clampDialogPosition(left, top);
    dialog.style.left = `${position.left}px`;
    dialog.style.top = `${position.top}px`;
  };
  requestAnimationFrame(anchorDialogToNode);

  let dragStart = null;
  header.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    const rect = dialog.getBoundingClientRect();
    dragStart = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    header.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }, { signal: dialogEvents.signal });
  header.addEventListener("pointermove", (event) => {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    const position = clampDialogPosition(event.clientX - dragStart.offsetX, event.clientY - dragStart.offsetY);
    dialog.style.left = `${position.left}px`;
    dialog.style.top = `${position.top}px`;
  }, { signal: dialogEvents.signal });
  const stopDragging = (event) => {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    header.releasePointerCapture?.(event.pointerId);
    dragStart = null;
    snapDialogToNode();
  };
  header.addEventListener("pointerup", stopDragging, { signal: dialogEvents.signal });
  header.addEventListener("pointercancel", stopDragging, { signal: dialogEvents.signal });
  dock.addEventListener("click", anchorDialogToNode, { signal: dialogEvents.signal });

  const closeDialog = () => {
    dialogEvents.abort();
    backdrop.remove();
    if (node._wosaiPresetLibraryModal === backdrop) node._wosaiPresetLibraryModal = null;
    if (node._wosaiPresetLibraryClose === closeDialog) node._wosaiPresetLibraryClose = null;
  };
  node._wosaiPresetLibraryClose = closeDialog;
  const categorySelectionCount = () => new Set((library.categories ?? [])
    .filter((category) => category.presets?.some((preset) => selected.has(preset.id)))
    .map((category) => category.id)).size;
  const render = () => {
    const snapshot = selectedSnapshot(library, selected);
    const selectedCategoryCount = new Set(snapshot.map((preset) => preset.library_category_id)).size;
    const libraryPresetCount = (library.categories ?? []).reduce((total, category) => total + (category.presets?.length ?? 0), 0);
    titleMeta.textContent = t("nodes.presetPrompt.libraryOverview", "(Selected {selected}/{total})")
      .replace("{selected}", String(snapshot.length))
      .replace("{total}", String(libraryPresetCount));
    syncStatus.textContent = t("nodes.presetPrompt.librarySyncStatus", "Sync: {categories} categories / {presets} presets")
      .replace("{categories}", String(selectedCategoryCount))
      .replace("{presets}", String(snapshot.length));
    categoryList.replaceChildren();
    const activeCategory = library.categories?.find((category) => category.id === activeCategoryId) ?? library.categories?.[0];
    activeCategoryId = activeCategory?.id;
    for (const category of library.categories ?? []) {
      const button = document.createElement("button");
      button.className = "wosai-pp-library__category";
      button.type = "button";
      const icon = createLineIcon(getCategoryVisual(category.label_i18n || getLibraryVisualKey(category)).icon, "wosai-pp-library__category-icon");
      const label = document.createElement("span");
      label.className = "wosai-pp-library__category-label";
      label.textContent = getCatalogText("categories", category.label_i18n, category.label);
      button.append(icon, label);
      button.classList.toggle("is-active", category.id === activeCategoryId);
      button.addEventListener("click", () => { activeCategoryId = category.id; render(); });
      categoryList.append(button);
    }
    presetList.replaceChildren();
    if (!activeCategory) return;
    const categoryPresets = activeCategory.presets ?? [];
    const heading = document.createElement("div");
    heading.className = "wosai-pp-library__preset-heading";
    const headingInfo = document.createElement("div");
    headingInfo.className = "wosai-pp-library__preset-heading-info";
    const headingLabel = document.createElement("span");
    headingLabel.className = "wosai-pp-library__preset-heading-label";
    headingLabel.textContent = getCatalogText("categories", activeCategory.label_i18n, activeCategory.label);
    const headingMeta = document.createElement("span");
    headingMeta.className = "wosai-pp-library__preset-heading-meta";
    headingMeta.textContent = t("nodes.presetPrompt.libraryCategoryCount", "(Selected {selected}/{total})")
      .replace("{selected}", String(categoryPresets.filter((preset) => selected.has(preset.id)).length))
      .replace("{total}", String(categoryPresets.length));
    const selectAll = document.createElement("button");
    selectAll.className = "wosai-pp__settings wosai-pp-library__select-all";
    selectAll.type = "button";
    const selectablePresets = categoryPresets.slice(0, NODE_PRESET_LIMIT);
    const allSelected = selectablePresets.length > 0 && selectablePresets.every((preset) => selected.has(preset.id));
    selectAll.textContent = allSelected
      ? t("nodes.presetPrompt.deselectCategory", "Deselect category")
      : t("nodes.presetPrompt.selectCategory", "Select category");
    selectAll.addEventListener("click", () => {
      if (allSelected) {
        categoryPresets.forEach((preset) => selected.delete(preset.id));
      } else {
        const hasSelection = categoryPresets.some((preset) => selected.has(preset.id));
        if (!hasSelection && categorySelectionCount() >= NODE_CATEGORY_LIMIT) {
          quickToast(t("nodes.presetPrompt.libraryLimit", "Node display supports up to 6 categories and 9 presets each"));
          return;
        }
        selectablePresets.forEach((preset) => selected.add(preset.id));
        if (categoryPresets.length > NODE_PRESET_LIMIT) {
          quickToast(t("nodes.presetPrompt.selectAllLimited", "Selected the first 9 presets for this category"));
        }
      }
      render();
    });
    headingInfo.append(headingLabel, headingMeta);
    heading.append(headingInfo, selectAll);
    presetList.append(heading);
    const cardGrid = document.createElement("div");
    cardGrid.className = "wosai-pp-library__card-grid";
    for (const preset of categoryPresets) {
      const card = document.createElement("button");
      card.className = "wosai-pp-library__card";
      card.type = "button";
      const isSelected = selected.has(preset.id);
      card.classList.toggle("is-selected", isSelected);
      card.setAttribute("aria-pressed", String(isSelected));
      const label = document.createElement("span");
      label.className = "wosai-pp-library__card-label";
      label.textContent = getCatalogText("labels", preset.label_i18n, preset.label);
      const check = document.createElement("span");
      check.className = "wosai-pp-library__card-check";
      check.textContent = "✓";
      card.append(createPresetCover({
        ...preset,
        category_i18n: activeCategory.label_i18n || getLibraryVisualKey(activeCategory, preset),
      }, 0), label, check);
      card.addEventListener("click", () => {
        if (!isSelected) {
          const selectedInCategory = (activeCategory.presets ?? []).filter((item) => selected.has(item.id)).length;
          const isNewCategory = !(activeCategory.presets ?? []).some((item) => selected.has(item.id));
          if (selectedInCategory >= NODE_PRESET_LIMIT || (isNewCategory && categorySelectionCount() >= NODE_CATEGORY_LIMIT)) {
            quickToast(t("nodes.presetPrompt.libraryLimit", "Node display supports up to 6 categories and 9 presets each"));
            return;
          }
          selected.add(preset.id);
        } else selected.delete(preset.id);
        render();
      });
      cardGrid.append(card);
    }
    presetList.append(cardGrid);
  };
  close.addEventListener("click", closeDialog);
  backdrop.addEventListener("pointerdown", (event) => { if (event.target === backdrop) closeDialog(); });
  importButton.addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", () => {
    const file = importInput.files?.[0];
    importInput.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const imported = parsePresetImport(reader.result, getImportLabel(file), file.name);
        if (!imported.length) throw new Error("No importable presets");
        mergeImportedLibraryPresets(library, imported);
        await savePresetLibrary(library);
        activeCategoryId = library.categories.at(-1)?.id ?? activeCategoryId;
        render();
        quickToast(t("nodes.presetPrompt.libraryImportDone", "Imported into preset library"));
      } catch (error) {
        console.warn("[WOSAI] library import failed", error);
        quickToast(t("nodes.presetPrompt.importFailed", "Unable to read preset file"));
      }
    };
    reader.readAsText(file, "utf-8");
  });
  apply.addEventListener("click", () => {
    const snapshot = selectedSnapshot(library, selected);
    if (!snapshot.length) {
      quickToast(t("nodes.presetPrompt.libraryEmptySelection", "Select at least one preset"));
      return;
    }
    const proceed = window.confirm(
      t("nodes.presetPrompt.syncConfirm", "同步将覆盖当前节点已有的全部预设（共 {count} 条），确定继续吗？")
        .replace("{count}", String(snapshot.length)),
    );
    if (!proceed) return;
    setWidgetValue(node, getWidget(node, "presets_data"), JSON.stringify(snapshot));
    setWidgetValue(node, getWidget(node, "active_index"), 0);
    node._wosaiPresetCategory = snapshot[0].category;
    syncPromptInputs(node, snapshot[0]);
    node._wosaiPresetRefresh?.();
    closeDialog();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDialog(); }, { signal: dialogEvents.signal });
  render();
}

function buildPresetWidget(node) {
  if (node._wosaiPresetRoot) return;
  ensureStyle();
  node.resizable = true;
  node._wosaiPresetWidgetHeight = getTabWidgetHeight(DEFAULT_PRESET_COUNT);
  const root = document.createElement("div");
  root.className = "wosai-pp";
  root.dataset.wosaiPanel = "true";
  const categories = document.createElement("aside");
  categories.className = "wosai-pp__categories";
  const categoryTitle = document.createElement("div");
  categoryTitle.className = "wosai-pp__category-title";
  const categoryList = document.createElement("div");
  categoryList.className = "wosai-pp__category-list";
  categories.append(categoryTitle, categoryList);
  const header = document.createElement("div");
  header.className = "wosai-pp__header";
  const actions = document.createElement("div");
  actions.className = "wosai-pp__actions";
  const searchWrap = document.createElement("label");
  searchWrap.className = "wosai-pp__search";
  const searchIcon = createLineIcon(SEARCH_ICON_PATH, "wosai-pp__search-icon");
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "wosai-pp__search-input";
  searchInput.autocomplete = "off";
  searchWrap.append(searchIcon, searchInput);
  const libraryButton = document.createElement("button");
  libraryButton.className = "wosai-pp__settings";
  libraryButton.type = "button";
  const moreButton = document.createElement("button");
  moreButton.className = "wosai-pp__settings";
  moreButton.type = "button";
  moreButton.dataset.wosaiMore = "true";
  moreButton.setAttribute("aria-haspopup", "menu");
  moreButton.setAttribute("aria-expanded", "false");
  const importInput = document.createElement("input");
  importInput.type = "file";
  importInput.accept = ".md,.json,.txt,.csv,text/markdown,application/json,text/plain,text/csv";
  importInput.hidden = true;
  const preview = document.createElement("div");
  preview.className = "wosai-pp__preview";
  const previewIcon = createLineIcon(EYE_ICON_PATH, "wosai-pp__preview-icon");
  const previewText = document.createElement("span");
  previewText.className = "wosai-pp__preview-text";
  preview.append(previewIcon, previewText);
  const tabs = document.createElement("div");
  tabs.className = "wosai-pp__tabs";
  const content = document.createElement("div");
  content.className = "wosai-pp__content";
  content.append(header, preview, tabs);
  actions.append(libraryButton, moreButton);
  header.append(searchWrap, actions);
  root.append(importInput, categories, content);
  // Keep the custom manager's right-click interactions inside the widget. In
  // particular, this blocks the canvas' native node menu from appearing over
  // the preset tabs and toolbar in both renderer modes.
  root.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  const refresh = () => {
    const presets = normalizePresets(getWidget(node, "presets_data")?.value);
    const activeIndex = Math.max(0, Math.min(Number(getWidget(node, "active_index")?.value) || 0, presets.length - 1));
    const categoryNames = [...new Set(presets.map((preset) => preset.category || "通用"))];
    root.classList.toggle("wosai-pp--six-categories", categoryNames.length <= NODE_CATEGORY_LIMIT);
    const activeCategory = categoryNames.includes(node._wosaiPresetCategory)
      ? node._wosaiPresetCategory
      : (presets[activeIndex]?.category || categoryNames[0] || "通用");
    node._wosaiPresetCategory = activeCategory;
    const query = searchInput.value.trim().toLowerCase();
    const isSearching = Boolean(query);
    const categoryPresetsAll = sortByPinned(
      presets
        .map((preset, index) => ({ preset, index }))
        .filter(({ preset }) => (preset.category || "通用") === activeCategory),
    );
    const categoryPresets = isSearching
      ? sortByPinned(
        presets
          .map((preset, index) => ({ preset, index }))
          .filter(({ preset }) => (
            !isPresetEmpty(preset)
            && getCatalogText("labels", preset.label_i18n, preset.label).toLowerCase().includes(query)
          )),
      )
      : categoryPresetsAll;
    categoryTitle.textContent = t("nodes.presetPrompt.categoryTitle", "Categories");
    searchInput.placeholder = t("nodes.presetPrompt.searchPlaceholder", "搜索预设…");
    searchInput.setAttribute("aria-label", t("nodes.presetPrompt.searchPlaceholder", "搜索预设…"));
    libraryButton.textContent = t("nodes.presetPrompt.library", "Library");
    libraryButton.title = t("nodes.presetPrompt.libraryHint", "Choose presets from the reusable preset library");
    moreButton.textContent = t("nodes.presetPrompt.more", "更多");
    moreButton.title = t("nodes.presetPrompt.moreHint", "导入、导出或清空预设");
    const activePrompt = String(presets[activeIndex]?.prompt_cn ?? "").trim();
    const defaultPreviewText = activePrompt
      ? (activePrompt.length > 60 ? `${activePrompt.slice(0, 60)}…` : activePrompt)
      : t("nodes.presetPrompt.previewPlaceholder", "悬停预设可预览提示词内容…");
    preview.dataset.default = defaultPreviewText;
    previewText.textContent = defaultPreviewText;
    categoryList.replaceChildren();
    categoryNames.forEach((category) => {
      const button = document.createElement("button");
      button.className = "wosai-pp__category";
      button.type = "button";
      const categoryMembers = presets.filter((preset) => (preset.category || "通用") === category);
      const categoryPreset = categoryMembers[0];
      const icon = createLineIcon(getCategoryVisual(categoryPreset?.category_i18n).icon, "wosai-pp__category-icon");
      const label = document.createElement("span");
      label.className = "wosai-pp__category-label";
      label.textContent = getCatalogText("categories", categoryPreset?.category_i18n, category);
      button.title = label.textContent;
      const meta = document.createElement("span");
      meta.className = "wosai-pp__category-meta";
      const count = document.createElement("span");
      count.className = "wosai-pp__category-count";
      count.textContent = String(categoryMembers.length);
      const editButton = document.createElement("span");
      editButton.className = "wosai-pp__category-edit";
      editButton.setAttribute("role", "button");
      editButton.setAttribute("tabindex", "0");
      editButton.setAttribute("aria-label", t("nodes.presetPrompt.renameCategory", "重命名分类"));
      editButton.append(createLineIcon(EDIT_ICON_PATH, "wosai-pp__category-edit-icon"));
      const triggerCategoryRename = (event) => {
        event.stopPropagation();
        event.preventDefault();
        startInlineCategoryRename(node, category, button);
      };
      editButton.addEventListener("click", triggerCategoryRename);
      editButton.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") triggerCategoryRename(event);
      });
      meta.append(count, editButton);
      button.append(icon, label, meta);
      button.classList.toggle("is-active", category === activeCategory);
      button.setAttribute("aria-pressed", String(category === activeCategory));
      button.addEventListener("click", () => {
        node._wosaiPresetCategory = category;
        clearTimeout(node._wosaiPresetSearchTimer);
        searchInput.value = "";
        const first = presets.findIndex((preset) => (preset.category || "通用") === category);
        if (first >= 0) {
          setWidgetValue(node, getWidget(node, "active_index"), first);
          syncPromptInputs(node, presets[first]);
        }
        refresh();
      });
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        startInlineCategoryRename(node, category, button);
      });
      categoryList.appendChild(button);
    });
    tabs.replaceChildren();
    if (query && categoryPresets.length === 0) {
      const empty = document.createElement("div");
      empty.className = "wosai-pp__tabs-empty";
      empty.textContent = t("nodes.presetPrompt.searchNoResults", "没有匹配的预设");
      tabs.appendChild(empty);
    }
    categoryPresets.slice(0, PRESET_PAGE_SIZE).forEach(({ preset, index }) => {
      const button = document.createElement("button");
      button.className = "wosai-pp__tab";
      button.type = "button";
      button.dataset.wosaiIndex = String(index);
      const label = document.createElement("span");
      label.className = "wosai-pp__tab-label";
      label.textContent = getCatalogText("labels", preset.label_i18n, preset.label);

      const pinButton = document.createElement("span");
      pinButton.className = "wosai-pp__tab-pin";
      pinButton.setAttribute("role", "button");
      pinButton.setAttribute("tabindex", "0");
      pinButton.setAttribute("aria-label", t("nodes.presetPrompt.togglePin", "置顶 / 取消置顶"));
      pinButton.classList.toggle("is-pinned", Boolean(preset.pinned));
      pinButton.append(createLineIcon(STAR_ICON_PATH, "wosai-pp__tab-pin-icon"));
      const togglePin = (event) => {
        event.stopPropagation();
        event.preventDefault();
        const latestWidget = getWidget(node, "presets_data");
        const latest = normalizePresets(latestWidget?.value);
        latest[index] = { ...(latest[index] ?? preset), pinned: !latest[index]?.pinned };
        setWidgetValue(node, latestWidget, JSON.stringify(latest));
        refresh();
      };
      pinButton.addEventListener("click", togglePin);
      pinButton.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") togglePin(event);
      });

      const thumbButton = document.createElement("span");
      thumbButton.className = "wosai-pp__tab-thumb";
      thumbButton.setAttribute("role", "button");
      thumbButton.setAttribute("tabindex", "0");
      thumbButton.setAttribute("aria-label", t("nodes.presetPrompt.setThumbnail", "设置封面图"));
      thumbButton.append(createLineIcon(THUMBNAIL_ICON_PATH, "wosai-pp__tab-thumb-icon"));
      const triggerThumb = (event) => {
        event.stopPropagation();
        event.preventDefault();
        startInlineThumbnail(node, index, button);
      };
      thumbButton.addEventListener("click", triggerThumb);
      thumbButton.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") triggerThumb(event);
      });

      const editButton = document.createElement("span");
      editButton.className = "wosai-pp__tab-edit";
      editButton.setAttribute("role", "button");
      editButton.setAttribute("tabindex", "0");
      editButton.setAttribute("aria-label", t("nodes.presetPrompt.rename", "重命名"));
      editButton.append(createLineIcon(EDIT_ICON_PATH, "wosai-pp__tab-edit-icon"));
      const triggerRename = (event) => {
        event.stopPropagation();
        event.preventDefault();
        startInlineRename(node, index, button);
      };
      editButton.addEventListener("click", triggerRename);
      editButton.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") triggerRename(event);
      });

      button.append(createPresetCover(preset, index), label, pinButton, thumbButton, editButton);
      if (isSearching) {
        const tag = document.createElement("span");
        tag.className = "wosai-pp__tab-tag";
        tag.textContent = getCatalogText("categories", preset.category_i18n, preset.category || "通用");
        button.append(tag);
      }
      button.classList.toggle("is-active", index === activeIndex);
      button.classList.toggle("is-empty", isPresetEmpty(preset));
      button.setAttribute("aria-pressed", String(index === activeIndex));
      button.addEventListener("click", () => {
        node._wosaiPresetCategory = preset.category || "通用";
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
    scheduleNodeLayout(node, Math.min(categoryPresets.length, PRESET_PAGE_SIZE), root);
  };

  libraryButton.addEventListener("click", () => openPresetLibrary(node));
  moreButton.addEventListener("click", () => openMoreMenu(node, moreButton, importInput));
  importInput.addEventListener("change", () => {
    importPresets(node, importInput.files?.[0]);
    importInput.value = "";
  });
  searchInput.addEventListener("input", () => {
    clearTimeout(node._wosaiPresetSearchTimer);
    node._wosaiPresetSearchTimer = setTimeout(() => refresh(), 150);
  });
  tabs.addEventListener("keydown", (event) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const focusable = Array.from(tabs.querySelectorAll(".wosai-pp__tab"));
    const currentIndex = focusable.indexOf(document.activeElement);
    if (currentIndex === -1) return;
    event.preventDefault();
    const columns = 3;
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = Math.min(currentIndex + 1, focusable.length - 1);
    if (event.key === "ArrowLeft") nextIndex = Math.max(currentIndex - 1, 0);
    if (event.key === "ArrowDown") nextIndex = Math.min(currentIndex + columns, focusable.length - 1);
    if (event.key === "ArrowUp") nextIndex = Math.max(currentIndex - columns, 0);
    focusable[nextIndex]?.focus();
  });
  tabs.addEventListener("mouseover", (event) => {
    const card = event.target.closest(".wosai-pp__tab");
    if (!card || card.classList.contains("is-editing")) return;
    const index = Number(card.dataset.wosaiIndex);
    if (Number.isNaN(index)) return;
    const presets = normalizePresets(getWidget(node, "presets_data")?.value);
    const preset = presets[index];
    if (!preset) return;
    const promptText = String(preset.prompt_cn ?? "").trim();
    previewText.textContent = promptText
      ? (promptText.length > 60 ? `${promptText.slice(0, 60)}…` : promptText)
      : t("nodes.presetPrompt.previewEmpty", "该预设暂无提示词");
  });
  tabs.addEventListener("mouseout", (event) => {
    const card = event.target.closest(".wosai-pp__tab");
    if (!card) return;
    previewText.textContent = preview.dataset.default || "";
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
  observePresetLayout(node, root, content);
  node.setSize?.([
    Math.max(node.size?.[0] ?? 0, getWOSAIVarNum("--ws-pp-node-min-width")),
    Math.max(node.size?.[1] ?? 0, getWOSAIVarNum("--ws-pp-node-height")),
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
      this.widgets?.forEach((widget) => {
        if (BACKING_WIDGET_NAMES.has(widget.name)) hideNativeWidget(widget, this);
      });
      patchNode2PromptInputs(this);
      buildPresetWidget(this);
      bindPromptPersistence(this);
      const presets = migrateLegacyPresetPrompts(this);
      const activeIndex = Math.max(0, Math.min(Number(getWidget(this, "active_index")?.value) || 0, presets.length - 1));
      syncPromptInputs(this, presets[activeIndex]);
      this._wosaiPresetRefresh?.();
      return result;
    };
    const configured = function onConfigure(...args) {
      const result = originalConfigure?.apply(this, args);
      applyOutputPortLabels(this);
      applyNativeOutputPortShape(this);
      this.widgets?.forEach((widget) => {
        if (BACKING_WIDGET_NAMES.has(widget.name)) hideNativeWidget(widget, this);
      });
      patchNode2PromptInputs(this);
      buildPresetWidget(this);
      bindPromptPersistence(this);
      const presets = migrateLegacyPresetPrompts(this);
      const activeIndex = Math.max(0, Math.min(Number(getWidget(this, "active_index")?.value) || 0, presets.length - 1));
      syncPromptInputs(this, presets[activeIndex]);
      this._wosaiPresetRefresh?.();
      return result;
    };
    const removed = function onRemoved(...args) {
      closeClearMenu(this);
      closeExportMenu(this);
      closeMoreMenu(this);
      this._wosaiPresetLibraryClose?.();
      this._wosaiPresetLibraryModal?.remove();
      this._wosaiPresetLibraryModal = null;
      if (this._wosaiPresetLayoutFrame) cancelAnimationFrame(this._wosaiPresetLayoutFrame);
      this._wosaiPresetLayoutObserver?.disconnect();
      this._wosaiPresetLayoutObserver = null;
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
    injectGlobalHideCSS([...BACKING_WIDGET_NAMES], "wosai-pp-hide-native");
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
      closeClearMenu(node);
      closeExportMenu(node);
      closeMoreMenu(node);
      node._wosaiPresetLibraryClose?.();
      node._wosaiPresetLibraryModal?.remove?.();
      node._wosaiPresetLibraryModal = null;
      if (node._wosaiPresetLayoutFrame) cancelAnimationFrame(node._wosaiPresetLayoutFrame);
      node._wosaiPresetLayoutObserver?.disconnect();
      node._wosaiPresetLayoutObserver = null;
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
    document.getElementById("wosai-pp-hide-native")?.remove();
  },
});
