const MAX_PRESET_COUNT = 999;
const CN_HEADING_RE = /^(?:prompt[_\s-]*cn|cn|zh|chinese|\u4e2d\u6587(?:\u63d0\u793a\u8bcd)?)$/i;
const EN_HEADING_RE = /^(?:prompt[_\s-]*en|en|english|\u82f1\u6587(?:\u63d0\u793a\u8bcd)?)$/i;
const CN_PREFIX_RE = /^(?:\[?\s*(?:cn|zh|chinese|\u4e2d\u6587(?:\u63d0\u793a\u8bcd)?)\s*\]?)[\s:：-]+(.*)$/i;
const EN_PREFIX_RE = /^(?:\[?\s*(?:en|english|\u82f1\u6587(?:\u63d0\u793a\u8bcd)?)\s*\]?)[\s:：-]+(.*)$/i;
const NUMBERED_LINE_RE = /^\s*(?:\[(\d+)\]|(\d+)\s*[.)、:：-])\s*(.*)$/;

function withMeta(items, meta = {}) {
    Object.defineProperty(items, "meta", { value: meta, enumerable: false, configurable: true });
    return items;
}

function cleanPreset(item, index) {
    if (!item || typeof item !== "object") return null;
    const hasLabel = Object.prototype.hasOwnProperty.call(item, "label");
    const category = String(item.category ?? item.group ?? "").trim();
    return {
        ...(category ? { category } : {}),
        ...(String(item.category_i18n ?? "").trim() ? { category_i18n: String(item.category_i18n).trim() } : {}),
        label: hasLabel ? String(item.label ?? "").trim() : `Preset ${index + 1}`,
        ...(String(item.label_i18n ?? "").trim() ? { label_i18n: String(item.label_i18n).trim() } : {}),
        ...(String(item.thumbnail ?? item.preview ?? "").trim() ? { thumbnail: String(item.thumbnail ?? item.preview).trim() } : {}),
        prompt_cn: String(item.prompt_cn ?? item.cn ?? "").trim(),
        prompt_en: String(item.prompt_en ?? item.en ?? "").trim(),
        ...(item._wosaiLabelCleared ? { _wosaiLabelCleared: true } : {}),
        ...(item._wosaiPromptCnCleared ? { _wosaiPromptCnCleared: true } : {}),
        ...(item._wosaiPromptEnCleared ? { _wosaiPromptEnCleared: true } : {}),
    };
}

function isPresetRecord(item) {
    if (!item || typeof item !== "object") return false;
    return ["label", "name", "title", "category", "group", "prompt_cn", "prompt_en", "cn", "en", "thumbnail", "preview"]
        .some((key) => Object.prototype.hasOwnProperty.call(item, key));
}

function normalizeStructuredPresets(items) {
    return items
        .filter(isPresetRecord)
        .map(cleanPreset)
        .filter(Boolean)
        .slice(0, MAX_PRESET_COUNT);
}

function normalizeImportedPresets(items) {
    return items
        .map(cleanPreset)
        .filter((item) => item && (item.prompt_cn || item.prompt_en))
        .slice(0, MAX_PRESET_COUNT);
}

function detectLanguage(text) {
    const value = String(text ?? "");
    const chineseCount = (value.match(/[\u3400-\u9fff]/g) || []).length;
    const latinCount = (value.match(/[A-Za-z]/g) || []).length;
    if (!chineseCount && latinCount) return "en";
    if (chineseCount && !latinCount) return "cn";
    if (chineseCount && latinCount) return chineseCount >= latinCount ? "cn" : "en";
    return "unknown";
}

function getPlainPreset(text, label) {
    const language = detectLanguage(text);
    return [{
        label: label || "Preset 1",
        prompt_cn: language === "en" ? "" : text,
        prompt_en: language === "cn" ? "" : text,
    }];
}

function appendPrompt(target, field, text) {
    const value = String(text ?? "").trim();
    if (!value) return;
    target[field] = target[field] ? `${target[field]}\n${value}` : value;
}

function assignByLanguage(target, text) {
    const value = String(text ?? "").trim();
    if (!value) return;
    const cnMatch = value.match(CN_PREFIX_RE);
    if (cnMatch) {
        appendPrompt(target, "prompt_cn", cnMatch[1]);
        return;
    }
    const enMatch = value.match(EN_PREFIX_RE);
    if (enMatch) {
        appendPrompt(target, "prompt_en", enMatch[1]);
        return;
    }
    appendPrompt(target, detectLanguage(value) === "en" ? "prompt_en" : "prompt_cn", value);
}

function parseDelimitedLine(line, fallbackLabel = "") {
    const separator = line.includes("\t") ? "\t" : /\s+\|\s+/.test(line) ? /\s+\|\s+/ : null;
    if (!separator) return null;
    const cells = line.split(separator).map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 2) return null;
    let label = fallbackLabel;
    const numbered = cells[0].match(/^\d+$/);
    if (numbered) {
        label = `Preset ${cells.shift()}`;
    }
    const result = { label: label || `Preset 1`, prompt_cn: "", prompt_en: "" };
    cells.forEach((cell) => assignByLanguage(result, cell));
    if (!result.prompt_cn && !result.prompt_en && cells.length >= 2) {
        result.prompt_cn = cells[0];
        result.prompt_en = cells[1];
    }
    return result.prompt_cn || result.prompt_en ? result : null;
}

function parsePlainGroup(lines, label) {
    const result = { label: label || "Preset 1", prompt_cn: "", prompt_en: "" };
    for (const line of lines) {
        const delimited = parseDelimitedLine(line, result.label);
        if (delimited) {
            result.prompt_cn = delimited.prompt_cn;
            result.prompt_en = delimited.prompt_en;
            if (delimited.label) result.label = delimited.label;
            continue;
        }
        assignByLanguage(result, line);
    }
    return result;
}

function parseTextBlocks(text) {
    const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
    const presets = [];
    let category = "";
    let current = null;
    let field = null;
    const append = (line) => {
        if (!current || !field) return;
        current[field] += `${current[field] ? "\n" : ""}${line}`;
    };

    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        const categoryHeading = line.match(/^#(?!#)(?:\s+(.*))?$/);
        if (categoryHeading) {
            category = (categoryHeading[1] ?? "").trim();
            current = null;
            field = null;
            continue;
        }
        const presetHeading = line.match(/^##(?:\s+(.*))?$/);
        if (presetHeading) {
            current = { ...(category ? { category } : {}), label: (presetHeading[1] ?? "").trim(), prompt_cn: "", prompt_en: "" };
            presets.push(current);
            field = null;
            continue;
        }
        const fieldHeading = line.match(/^###\s+(.+)$/);
        if (fieldHeading && current) {
            const heading = fieldHeading[1].trim();
            field = CN_HEADING_RE.test(heading) ? "prompt_cn" : EN_HEADING_RE.test(heading) ? "prompt_en" : null;
            continue;
        }
        append(rawLine);
    }
    return normalizeStructuredPresets(presets.map((preset) => ({
        ...preset,
        prompt_cn: preset.prompt_cn.replace(/\n+$/, ""),
        prompt_en: preset.prompt_en.replace(/\n+$/, ""),
    })));
}

function parseNumberedLines(lines) {
    const groups = [];
    let current = null;
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        const numbered = line.match(NUMBERED_LINE_RE);
        if (numbered) {
            current = { number: numbered[1] || numbered[2], lines: [] };
            groups.push(current);
            if (numbered[3]) current.lines.push(numbered[3]);
        } else if (current) {
            current.lines.push(line);
        }
    }
    return groups.map((group) => parsePlainGroup(group.lines, `Preset ${group.number}`));
}

function parsePlainText(text, fallbackLabel) {
    const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
    const meaningfulLines = lines.map((line) => line.trim()).filter(Boolean)
        .filter((line) => !/^#\s*WOSAI\s+Preset\s+Manager$/i.test(line));
    if (!meaningfulLines.length) return [];

    const numbered = parseNumberedLines(meaningfulLines);
    if (numbered.length) return numbered;

    const blocks = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
        .split(/\n\s*\n+/).map((block) => block.split("\n").map((line) => line.trim()).filter(Boolean)).filter(Boolean);
    if (blocks.length > 1) {
        const parsedBlocks = blocks.map((block, index) => parsePlainGroup(block, `Preset ${index + 1}`));
        if (parsedBlocks.some((item) => item.prompt_cn && item.prompt_en)) return parsedBlocks;
    }

    if (meaningfulLines.length === 1) return getPlainPreset(meaningfulLines[0], fallbackLabel);

    const parsedLines = meaningfulLines.map((line, index) => parseDelimitedLine(line, `Preset ${index + 1}`) || {
        label: `Preset ${index + 1}`,
        prompt_cn: detectLanguage(line) === "en" ? "" : line,
        prompt_en: detectLanguage(line) === "en" ? line : "",
    });
    const cnLines = parsedLines.filter((item) => item.prompt_cn && !item.prompt_en);
    const enLines = parsedLines.filter((item) => item.prompt_en && !item.prompt_cn);
    if (cnLines.length && enLines.length) {
        const count = Math.max(cnLines.length, enLines.length);
        return Array.from({ length: count }, (_, index) => ({
            label: `Preset ${index + 1}`,
            prompt_cn: cnLines[index]?.prompt_cn || "",
            prompt_en: enLines[index]?.prompt_en || "",
        }));
    }
    return parsedLines;
}

function getFileExtension(fileName) {
    const match = String(fileName ?? "").toLowerCase().match(/\.([a-z0-9]+)$/);
    return match?.[1] || "";
}

function parseJsonPresets(source, fallbackLabel) {
    const parsed = JSON.parse(source);
    const items = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.presets)
            ? parsed.presets
            : [parsed];
    return normalizeStructuredPresets(items.map((item, index) => {
        if (typeof item === "string") {
            const language = detectLanguage(item);
            return {
                label: index === 0 && fallbackLabel ? fallbackLabel : `Preset ${index + 1}`,
                prompt_cn: language === "en" ? "" : item,
                prompt_en: language === "cn" ? "" : item,
            };
        }
        if (!item || typeof item !== "object") return null;
        return {
            ...((item.category ?? item.group) ? { category: item.category ?? item.group } : {}),
            ...(item.category_i18n ? { category_i18n: item.category_i18n } : {}),
            label: item.label ?? item.name ?? `Preset ${index + 1}`,
            ...(item.label_i18n ? { label_i18n: item.label_i18n } : {}),
            ...(item.thumbnail ?? item.preview ? { thumbnail: item.thumbnail ?? item.preview } : {}),
            prompt_cn: item.prompt_cn ?? item.promptCn ?? item.cn ?? item.zh ?? item.chinese ?? "",
            prompt_en: item.prompt_en ?? item.promptEn ?? item.en ?? item.english ?? "",
            ...(item._wosaiLabelCleared ? { _wosaiLabelCleared: true } : {}),
            ...(item._wosaiPromptCnCleared ? { _wosaiPromptCnCleared: true } : {}),
            ...(item._wosaiPromptEnCleared ? { _wosaiPromptEnCleared: true } : {}),
        };
    }));
}

function parseCsvRows(source) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    const text = String(source ?? "").replace(/^\uFEFF/, "");
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (character === '"') {
            if (quoted && text[index + 1] === '"') {
                cell += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if (character === "," && !quoted) {
            row.push(cell.trim());
            cell = "";
        } else if ((character === "\n" || character === "\r") && !quoted) {
            if (character === "\r" && text[index + 1] === "\n") index += 1;
            row.push(cell.trim());
            if (row.some((value) => value)) rows.push(row);
            row = [];
            cell = "";
        } else {
            cell += character;
        }
    }
    row.push(cell.trim());
    if (row.some((value) => value)) rows.push(row);
    return rows;
}

function normalizeHeader(value) {
    return String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function csvFieldType(value) {
    const header = normalizeHeader(value);
    if (["label", "name", "title", "\u6807\u7b7e", "\u6807\u7b7e\u540d\u79f0", "\u9884\u8bbe", "\u9884\u8bbe\u540d\u79f0"].includes(header)) return "label";
    if (["cn", "zh", "chinese", "promptcn", "\u4e2d\u6587", "\u4e2d\u6587\u63d0\u793a\u8bcd"].includes(header)) return "prompt_cn";
    if (["en", "english", "prompten", "\u82f1\u6587", "\u82f1\u6587\u63d0\u793a\u8bcd"].includes(header)) return "prompt_en";
    return "";
}

function parseCsvPresets(source, fallbackLabel) {
    const rows = parseCsvRows(source);
    if (!rows.length) return [];
    const headerTypes = rows[0].map(csvFieldType);
    const hasHeader = headerTypes.some(Boolean);
    const dataRows = hasHeader ? rows.slice(1) : rows;
    return normalizeImportedPresets(dataRows.map((row, index) => {
        if (hasHeader) {
            const item = { label: "", prompt_cn: "", prompt_en: "" };
            row.forEach((value, column) => {
                const type = headerTypes[column];
                if (type) item[type] = value;
            });
            if (!item.label) item.label = index === 0 && fallbackLabel ? fallbackLabel : `Preset ${index + 1}`;
            return item;
        }
        if (row.length >= 3) return {
            label: row[0] || `Preset ${index + 1}`,
            prompt_cn: row[1] || "",
            prompt_en: row[2] || "",
        };
        if (row.length === 2) {
            const item = { label: `Preset ${index + 1}`, prompt_cn: "", prompt_en: "" };
            assignByLanguage(item, row[0]);
            assignByLanguage(item, row[1]);
            return item;
        }
        const language = detectLanguage(row[0]);
        return {
            label: index === 0 && fallbackLabel ? fallbackLabel : `Preset ${index + 1}`,
            prompt_cn: language === "en" ? "" : row[0],
            prompt_en: language === "cn" ? "" : row[0],
        };
    }));
}

function parseImportByFormat(source, fallbackLabel, fileName) {
    const extension = getFileExtension(fileName);
    if (extension === "json") return { presets: parseJsonPresets(source, fallbackLabel), format: "json" };
    if (extension === "csv") return { presets: parseCsvPresets(source, fallbackLabel), format: "csv" };

    const trimmedSource = String(source ?? "").trimStart();
    if (!extension && (trimmedSource.startsWith("[") || trimmedSource.startsWith("{"))) {
        try { return { presets: parseJsonPresets(source, fallbackLabel), format: "json" }; } catch (_) { /* treat as plain text */ }
    }
    const blocks = parseTextBlocks(source);
    if (blocks.length) return { presets: blocks, format: "markdown" };
    return { presets: normalizeImportedPresets(parsePlainText(source, fallbackLabel)), format: extension === "md" ? "markdown" : "text" };
}

export function parsePresetImport(text, fallbackLabel = "", fileName = "") {
    const source = String(text ?? "").trim();
    if (!source) return withMeta([], { format: "empty", warnings: [] });
    let parsed;
    try {
        parsed = parseImportByFormat(source, fallbackLabel, fileName);
    } catch (error) {
        return withMeta([], { format: getFileExtension(fileName) || "text", warnings: [error.message || "Unable to parse file"] });
    }
    const presets = parsed.presets;
    const warnings = [];
    if (presets.length >= MAX_PRESET_COUNT) warnings.push(`Only the first ${MAX_PRESET_COUNT} presets are kept.`);
    if (presets.length > 9) warnings.push(`${presets.length} presets will be shown in pages of 9.`);
    return withMeta(presets, { format: parsed.format, warnings });
}

export function serializePresetExport(presets) {
    const normalized = normalizeStructuredPresets(Array.isArray(presets) ? presets : []);
    const rows = [];
    const includeCategories = normalized.some((preset) => preset.category);
    let category = null;
    normalized.forEach((preset) => {
        const presetCategory = preset.category || "通用";
        if (includeCategories && presetCategory !== category) {
            category = presetCategory;
            rows.push(rows.length ? "" : "", `# ${category}`);
        }
        rows.push("", preset.label ? `## ${preset.label}` : "##", "", "### prompt_cn", preset.prompt_cn, "", "### prompt_en", preset.prompt_en);
    });
    return rows.join("\n").trimEnd() + "\n";
}

export function serializePresetJson(presets) {
    const normalized = normalizeStructuredPresets(Array.isArray(presets) ? presets : []);
    return `${JSON.stringify(normalized, null, 2)}\n`;
}
