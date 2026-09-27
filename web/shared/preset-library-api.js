const LIBRARY_ENDPOINT = "/wosai/preset_library";

export const NODE_CATEGORY_LIMIT = 6;
export const NODE_PRESET_LIMIT = 9;

export async function loadPresetLibrary() {
  const response = await fetch(LIBRARY_ENDPOINT, { cache: "no-store" });
  if (!response.ok) throw new Error(`Preset library request failed: ${response.status}`);
  const library = await response.json();
  if (!library || !Array.isArray(library.categories)) throw new Error("Invalid preset library");
  return library;
}

export async function savePresetLibrary(library) {
  const response = await fetch(LIBRARY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(library),
  });
  if (!response.ok) throw new Error(`Preset library save failed: ${response.status}`);
  return response.json();
}

export function makeLibraryId(prefix = "item") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function selectedSnapshot(library, selectedPresetIds) {
  const output = [];
  for (const category of library.categories ?? []) {
    const selected = (category.presets ?? [])
      .filter((preset) => selectedPresetIds.has(preset.id))
      .slice(0, NODE_PRESET_LIMIT);
    if (!selected.length) continue;
    output.push(...selected.map((preset) => ({
      library_category_id: category.id,
      library_id: preset.id,
      category: category.label,
      category_i18n: category.label_i18n ?? "",
      label: preset.label,
      label_i18n: preset.label_i18n ?? "",
      thumbnail: preset.thumbnail ?? "",
      prompt_cn: preset.prompt_cn ?? "",
      prompt_en: preset.prompt_en ?? "",
    })));
    if (output.filter((item) => item.library_category_id === category.id).length &&
        new Set(output.map((item) => item.library_category_id)).size >= NODE_CATEGORY_LIMIT) break;
  }
  return output;
}
