export function formatShortcut(shortcut) {
    const parts = [];
    if (shortcut?.ctrl) parts.push("Ctrl");
    if (shortcut?.alt) parts.push("Alt");
    if (shortcut?.shift) parts.push("Shift");
    if (shortcut?.meta) parts.push("Meta");
    parts.push((shortcut?.key || "?").toUpperCase());
    return parts.join("+");
}

export function shortcutFromEvent(event) {
    return {
        key: String(event?.key || "").toLowerCase(),
        ctrl: Boolean(event?.ctrlKey),
        alt: Boolean(event?.altKey),
        shift: Boolean(event?.shiftKey),
        meta: Boolean(event?.metaKey),
    };
}

export function isShortcutMatch(event, shortcut) {
    if (!shortcut?.key) return false;
    return String(event?.key || "").toLowerCase() === shortcut.key.toLowerCase()
        && Boolean(event?.ctrlKey) === Boolean(shortcut.ctrl)
        && Boolean(event?.altKey) === Boolean(shortcut.alt)
        && Boolean(event?.shiftKey) === Boolean(shortcut.shift)
        && Boolean(event?.metaKey) === Boolean(shortcut.meta);
}

export function fuzzyMatch(text, query) {
    if (!query) return true;
    const source = String(text || "").toLowerCase();
    const needle = String(query).toLowerCase();
    if (source.includes(needle)) return true;

    let sourceIndex = 0;
    let queryIndex = 0;
    while (sourceIndex < source.length && queryIndex < needle.length) {
        if (source[sourceIndex] === needle[queryIndex]) queryIndex += 1;
        sourceIndex += 1;
    }
    return queryIndex === needle.length;
}

export function matchesFavoriteNode(node, term, pinyinForms = []) {
    return [
        node?.displayName,
        node?.type,
        node?.category,
        ...pinyinForms,
    ].some((value) => fuzzyMatch(value, term));
}

export function filterFavoriteNodes(nodes, {
    category = "all",
    search = "",
    sort = "order",
    matches = (node, term) => matchesFavoriteNode(node, term),
} = {}) {
    let result = Array.isArray(nodes) ? nodes.slice() : [];
    if (sort === "alpha") {
        result.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "", "zh"));
    } else if (sort === "freq") {
        result.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
    } else {
        result.sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    if (category !== "all") result = result.filter((node) => node.categoryId === category);
    const terms = String(search).split(/\s+/).filter(Boolean);
    if (terms.length > 0) {
        result = result.filter((node) => terms.every((term) => matches(node, term)));
    }
    return result;
}
