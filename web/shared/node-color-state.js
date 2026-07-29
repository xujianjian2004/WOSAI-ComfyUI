const DEFAULT_STOPS = Object.freeze([
    { p: 0, h: 20, s: 82, v: 83 },
    { p: 0.5, h: 20, s: 70, v: 55 },
    { p: 1, h: 20, s: 60, v: 30 },
]);

const DEFAULT_TITLE_STYLE = Object.freeze({
    size: 14,
    color: "var(--ws-text-on-accent)",
    align: "left",
    weight: "normal",
    x: 0,
    y: 0,
});

function cloneStops(stops) {
    return stops.map((stop) => ({ ...stop }));
}

function gradientStops(stops, hex2hsv) {
    const converted = stops
        .filter((stop) => stop && typeof stop.hex === "string")
        .map((stop) => ({ p: stop.p, ...hex2hsv(stop.hex) }));
    if (converted.length === 0) return null;
    if (converted.length >= 3) return converted;

    const first = converted[0];
    const last = converted[converted.length - 1];
    return [
        { p: 0, h: first.h, s: first.s, v: first.v },
        { p: 0.5, h: last.h, s: last.s, v: last.v },
        { p: 1, h: last.h, s: last.s, v: last.v },
    ];
}

function bindActiveHsv(state) {
    const active = state.stops[state.aStop];
    const hsv = { h: active.h, s: active.s, v: active.v };
    for (const key of ["h", "s", "v"]) {
        Object.defineProperty(state, key, {
            configurable: true,
            enumerable: true,
            get() {
                return hsv[key];
            },
            set(value) {
                hsv[key] = value;
                state.stops[state.aStop][key] = value;
            },
        });
    }
    return state;
}

export function createNodeColorState(node, { hex2hsv, deriveDarkBg }) {
    const state = {
        stopCount: 3,
        dir: "↓",
        stops: cloneStops(DEFAULT_STOPS),
        aStop: 0,
        mode: "grad",
        titleStyle: { ...DEFAULT_TITLE_STYLE, ...(node?._titleStyle || {}) },
    };

    const configuredStops = node?._gradient?.stops;
    if (Array.isArray(configuredStops) && configuredStops.length > 0) {
        state.dir = node._gradient.dir || "↓";
        state.stops = gradientStops(configuredStops, hex2hsv) || state.stops;
    } else if (node?.color) {
        const color = hex2hsv(node.color);
        const dark = deriveDarkBg(color.h, color.s, color.v);
        state.stops = [
            { p: 0, h: color.h, s: color.s, v: color.v },
            { p: 0.5, h: color.h, s: Math.max(color.s - 10, 0), v: Math.min(color.v + 10, 100) },
            { p: 1, h: dark.h, s: dark.s, v: dark.v },
        ];
    }

    return bindActiveHsv(state);
}
