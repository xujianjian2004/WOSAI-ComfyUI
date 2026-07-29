export const DEFAULT_WOSAI_FAVORITE_TYPES = Object.freeze([
    "WOSAI_PresetPromptSelector",
    "WOSAI_LogicSwitch",
    "WOSAI_Selector",
    "WOSAI_BooleanSelector",
    "WOSAI_CommonColor",
    "WOSAI_NumberSwitch",
    "WOSAI_LazyFallback",
    "WOSAI_PointsEditor",
    "WOSAI_ImageCompare",
    "WOSAI_GetWidget",
    "WOSAI_FirstLastFrame",
    "WOSAI_IgnoreGroups",
    "WOSAI_OmniSlider",
    "WOSAI_SizeSelect",
    "WOSAI_TitleNote",
]);

export const DEFAULT_WOSAI_FAVORITE_NAMES = Object.freeze({
    WOSAI_PresetPromptSelector: "Preset Manager",
    WOSAI_LogicSwitch: "LogicSwitch",
    WOSAI_Selector: "Selector",
    WOSAI_BooleanSelector: "Boolean Selector",
    WOSAI_CommonColor: "Common Color",
    WOSAI_NumberSwitch: "Number Switch",
    WOSAI_LazyFallback: "Lazy Fallback",
    WOSAI_PointsEditor: "Points Editor",
    WOSAI_ImageCompare: "Image Compare",
    WOSAI_GetWidget: "Get Widget",
    WOSAI_FirstLastFrame: "First / Last Frame",
    WOSAI_IgnoreGroups: "IgnoreGroups",
    WOSAI_OmniSlider: "OmniSlider",
    WOSAI_SizeSelect: "SizeSelect",
    WOSAI_TitleNote: "TitleNote",
});

export const SAVE_NODE_PALETTE_TOKENS = Object.freeze([
    ["--ws-sn-palette-green", "colorGreen"],
    ["--ws-sn-palette-blue", "colorBlue"],
    ["--ws-sn-palette-orange", "colorOrange"],
    ["--ws-sn-palette-pink", "colorPink"],
    ["--ws-sn-palette-purple", "colorPurple"],
    ["--ws-sn-palette-cyan", "colorCyan"],
    ["--ws-sn-palette-yellow", "colorYellow"],
    ["--ws-sn-palette-brown", "colorBrown"],
    ["--ws-sn-palette-gray-blue", "colorGrayBlue"],
    ["--ws-sn-palette-coral", "colorCoral"],
    ["--ws-sn-palette-red", "colorRed"],
    ["--ws-sn-palette-indigo", "colorIndigo"],
    ["--ws-sn-palette-light-green", "colorLightGreen"],
    ["--ws-sn-palette-teal", "colorTeal"],
    ["--ws-sn-palette-deep-orange", "colorDeepOrange"],
    ["--ws-sn-palette-deep-purple", "colorDeepPurple"],
]);

export function resolveSaveNodePalette(readToken) {
    return SAVE_NODE_PALETTE_TOKENS
        .map(([token]) => String(readToken(token) || "").trim())
        .filter(Boolean);
}

export function saveNodeColorLabel(hex, colors, translate) {
    const normalized = String(hex || "").toLowerCase();
    const index = colors.findIndex((color) => color.toLowerCase() === normalized);
    const key = SAVE_NODE_PALETTE_TOKENS[index]?.[1];
    return key ? translate(`saveNode.${key}`) : hex;
}

export function favoriteDisplayName(type, { translate, registeredNodeTypes = {} }) {
    const key = `nodeDefs.${type}.display_name`;
    const localized = translate(key);
    if (localized !== key) return localized;
    return registeredNodeTypes[type]?.title || DEFAULT_WOSAI_FAVORITE_NAMES[type] || type;
}

export function seedDefaultWosaiFavorites(data, getDisplayName, now = Date.now()) {
    if (!data || data.defaultFavoritesSeeded) return false;
    if (!Array.isArray(data.nodes)) data.nodes = [];
    if (data.nodes.length === 0) {
        data.nodes.push(...DEFAULT_WOSAI_FAVORITE_TYPES.map((type, index) => ({
            type,
            displayName: getDisplayName(type),
            category: "WOSAI",
            categoryId: "default",
            addedAt: now + index,
            order: index + 1,
        })));
    }
    data.defaultFavoritesSeeded = true;
    return true;
}
