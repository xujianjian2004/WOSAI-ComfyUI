const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SAFE_ID = /^[a-z0-9_-]+$/i;

export const SAVE_NODE_LIMITS = Object.freeze({
    categories: 100,
    nodes: 2000,
    importBytes: 2 * 1024 * 1024,
});

function cleanText(value, maxLength, fallback = "") {
    if (typeof value !== "string") return fallback;
    const text = [...value]
        .filter((character) => {
            const code = character.charCodeAt(0);
            return code > 31 && code !== 127;
        })
        .join("")
        .trim();
    return text.slice(0, maxLength) || fallback;
}

function cleanColor(value, fallback) {
    const color = typeof value === "string" ? value.trim() : "";
    return HEX_COLOR.test(color) ? color.toUpperCase() : fallback;
}

function cleanNumber(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(number)));
}

/**
 * Convert imported or persisted SaveNode data into a bounded plain-data schema.
 * Unknown fields are intentionally discarded.
 */
export function sanitizeSaveNodeData(raw, options = {}) {
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const defaultName = cleanText(options.defaultName, 80, "Default");
    const defaultColor = cleanColor(options.defaultColor, "#607D8B");
    const categories = [];
    const categoryIds = new Set();

    const addCategory = (category) => {
        if (!category || typeof category !== "object" || categories.length >= SAVE_NODE_LIMITS.categories) return;
        const id = cleanText(category.id, 96);
        if (!SAFE_ID.test(id) || categoryIds.has(id)) return;
        categories.push({
            id,
            name: cleanText(category.name, 80, id === "default" ? defaultName : id),
            color: cleanColor(category.color, defaultColor),
        });
        categoryIds.add(id);
    };

    if (Array.isArray(source.categories)) source.categories.forEach(addCategory);
    if (!categoryIds.has("default")) {
        categories.unshift({ id: "default", name: defaultName, color: defaultColor });
        categoryIds.add("default");
        if (categories.length > SAVE_NODE_LIMITS.categories) categories.pop();
    }

    const nodes = [];
    const nodeTypes = new Set();
    if (Array.isArray(source.nodes)) {
        for (const node of source.nodes) {
            if (!node || typeof node !== "object" || nodes.length >= SAVE_NODE_LIMITS.nodes) continue;
            const type = cleanText(node.type, 256);
            if (!type || nodeTypes.has(type)) continue;
            const categoryId = cleanText(node.categoryId, 96);
            nodes.push({
                type,
                displayName: cleanText(node.displayName, 160, type),
                category: cleanText(node.category, 160, "Unknown"),
                categoryId: categoryIds.has(categoryId) ? categoryId : "default",
                addedAt: cleanNumber(node.addedAt, Date.now()),
                order: cleanNumber(node.order, nodes.length + 1),
                usageCount: cleanNumber(node.usageCount, 0),
                rating: cleanNumber(node.rating, 0, 0, 5),
            });
            nodeTypes.add(type);
        }
    }

    return {
        schemaVersion: 2,
        categories,
        nodes,
        defaultFavoritesSeeded: source.defaultFavoritesSeeded === true,
    };
}
