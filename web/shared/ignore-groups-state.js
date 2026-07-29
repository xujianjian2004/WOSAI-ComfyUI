const MODES = new Set(["default", "at_most_one", "always_one"]);
const SORT_ORDERS = new Set(["position", "alphabet"]);

function stringOr(value, fallback) {
    return typeof value === "string" ? value : fallback;
}

export function normalizeIgnoreGroupsScale(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 1;
    return Math.max(1, Math.min(5, Math.round(number * 2) / 2));
}

export function readIgnoreGroupsState(properties = {}) {
    const mode = stringOr(properties.wosai_ig_mode, "default");
    const sortOrder = stringOr(properties.wosai_ig_sort_order, "position");
    return {
        filter: stringOr(properties.wosai_ig_filter, ""),
        mode: MODES.has(mode) ? mode : "default",
        active: typeof properties.wosai_ig_active === "string"
            ? properties.wosai_ig_active
            : null,
        activeSet: Array.isArray(properties.wosai_ig_active_set)
            ? properties.wosai_ig_active_set.filter((item) => typeof item === "string")
            : null,
        nameColor: typeof properties.wosai_ig_name_color === "string"
            ? properties.wosai_ig_name_color
            : null,
        disabled: Boolean(properties.wosai_ig_disable),
        sortOrder: SORT_ORDERS.has(sortOrder) ? sortOrder : "position",
        colorFilter: stringOr(properties.wosai_ig_color_filter, "none"),
        scale: normalizeIgnoreGroupsScale(properties.wosai_ig_scale),
    };
}

export function writeIgnoreGroupsState(properties = {}, state) {
    const normalized = readIgnoreGroupsState({
        wosai_ig_filter: state.filter,
        wosai_ig_mode: state.mode,
        wosai_ig_active: state.active,
        wosai_ig_active_set: state.activeSet,
        wosai_ig_name_color: state.nameColor,
        wosai_ig_disable: state.disabled,
        wosai_ig_sort_order: state.sortOrder,
        wosai_ig_color_filter: state.colorFilter,
        wosai_ig_scale: state.scale,
    });
    properties.wosai_ig_filter = normalized.filter;
    properties.wosai_ig_mode = normalized.mode;
    properties.wosai_ig_active = normalized.active;
    properties.wosai_ig_active_set = normalized.activeSet;
    properties.wosai_ig_name_color = normalized.nameColor;
    properties.wosai_ig_disable = normalized.disabled;
    properties.wosai_ig_sort_order = normalized.sortOrder;
    properties.wosai_ig_color_filter = normalized.colorFilter;
    properties.wosai_ig_scale = normalized.scale;
    return properties;
}
