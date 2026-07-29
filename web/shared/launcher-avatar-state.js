const STORAGE_KEYS = Object.freeze({
    expression: "wosai-ball-exp",
    animation: "wosai-ball-anim",
    size: "wosai-ball-size",
    mode: "wosai-ball-expmode",
});

const expressionIcon = (inner) => (
    `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" `
    + `stroke="currentColor" stroke-width="1.6" stroke-linecap="round" `
    + `stroke-linejoin="round">${inner}</svg>`
);

export const BALL_EXPRESSIONS = Object.freeze([
    { id: "idle", labelKey: "menus.launcher.expressionDefault", emoji: "🙂", ico: expressionIcon('<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10.6" r="1.05" fill="currentColor" stroke="none"/><circle cx="15" cy="10.6" r="1.05" fill="currentColor" stroke="none"/><path d="M9 14.6c1 .9 5 .9 6 0"/>') },
    { id: "smile", labelKey: "menus.launcher.expressionSmile", emoji: "😊", ico: expressionIcon('<circle cx="12" cy="12" r="9"/><path d="M8.4 10.8c.4-.7 1.4-.7 1.8 0"/><path d="M13.8 10.8c.4-.7 1.4-.7 1.8 0"/><path d="M8.3 14c1.3 1.7 6.1 1.7 7.4 0"/>') },
    { id: "cry", labelKey: "menus.launcher.expressionCool", emoji: "😎", ico: expressionIcon('<circle cx="12" cy="12" r="9"/><path d="M5.4 9.6 H18.6"/><rect x="6" y="9" width="5" height="3.6" rx="1.6" fill="currentColor" stroke="none"/><rect x="13" y="9" width="5" height="3.6" rx="1.6" fill="currentColor" stroke="none"/><path d="M9.2 15.4c1.4 1 3.4 .4 4.6-.6"/>') },
    { id: "yawn", labelKey: "menus.launcher.expressionYawn", emoji: "🥱", ico: expressionIcon('<circle cx="12" cy="12" r="9"/><path d="M8.4 10.6c.4-.7 1.4-.7 1.8 0"/><path d="M13.8 10.6c.4-.7 1.4-.7 1.8 0"/><ellipse cx="12" cy="15" rx="2" ry="2.5"/>') },
    { id: "angry", labelKey: "menus.launcher.expressionMask", emoji: "😷", ico: expressionIcon('<circle cx="12" cy="12" r="9"/><circle cx="9.2" cy="10.2" r="1" fill="currentColor" stroke="none"/><circle cx="14.8" cy="10.2" r="1" fill="currentColor" stroke="none"/><path d="M7 12.8 H17 L16.4 16 Q12 18 7.6 16 Z" fill="currentColor" stroke="none"/><path d="M7 12.8l-2-1"/><path d="M17 12.8l2-1"/>') },
    { id: "sleep", labelKey: "menus.launcher.expressionSleep", emoji: "😴", ico: expressionIcon('<circle cx="12" cy="12" r="9"/><path d="M7.8 11.4c.6.8 1.8.8 2.4 0"/><path d="M13.8 11.4c.6.8 1.8.8 2.4 0"/><path d="M9.2 15c.9.6 4.7.6 5.6 0"/><path d="M14.6 6.2h2.4l-2.4 2.8h2.4"/>') },
]);

export function normalizeBallExpression(value) {
    return BALL_EXPRESSIONS.some(({ id }) => id === value) ? value : "idle";
}

export function readBallExpression(storage) {
    return normalizeBallExpression(storage?.getItem(STORAGE_KEYS.expression));
}

export function writeBallExpression(storage, value) {
    const normalized = normalizeBallExpression(value);
    storage?.setItem(STORAGE_KEYS.expression, normalized);
    return normalized;
}

export function readBallAnimation(storage) {
    return storage?.getItem(STORAGE_KEYS.animation) !== "0";
}

export function writeBallAnimation(storage, enabled) {
    storage?.setItem(STORAGE_KEYS.animation, enabled ? "1" : "0");
}

export function normalizeBallSize(value) {
    const parsed = Number.parseInt(value, 10);
    return parsed >= 44 && parsed <= 96 ? parsed : 60;
}

export function readBallSize(storage) {
    return normalizeBallSize(storage?.getItem(STORAGE_KEYS.size));
}

export function writeBallSize(storage, value) {
    const normalized = normalizeBallSize(value);
    storage?.setItem(STORAGE_KEYS.size, String(normalized));
    return normalized;
}

export function readBallExpressionMode(storage) {
    return storage?.getItem(STORAGE_KEYS.mode) === "cycle" ? "cycle" : "fixed";
}

export function writeBallExpressionMode(storage, mode) {
    const normalized = mode === "cycle" ? "cycle" : "fixed";
    storage?.setItem(STORAGE_KEYS.mode, normalized);
    return normalized;
}
