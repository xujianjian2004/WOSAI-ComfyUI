/** Composable method patches with order-independent disposal. */

const PATCHES = new WeakMap();

function targetEntries(target) {
    let entries = PATCHES.get(target);
    if (!entries) {
        entries = new Map();
        PATCHES.set(target, entries);
    }
    return entries;
}

function rebuild(entry) {
    let next = entry.base;
    for (const layer of entry.layers.values()) next = layer.factory(next);
    entry.current = next;
}

/**
 * Add a named wrapper to a method. Removing wrappers in any order leaves all
 * remaining wrappers active and restores the original after the final removal.
 */
export function patchMethod(target, methodName, patchId, wrapperFactory) {
    if (!target || typeof target[methodName] !== "function") {
        throw new TypeError(`Cannot patch non-function ${String(methodName)}`);
    }
    if (!patchId || typeof wrapperFactory !== "function") {
        throw new TypeError("patchMethod requires a stable patch ID and wrapper factory");
    }

    const entries = targetEntries(target);
    let entry = entries.get(methodName);
    if (!entry) {
        entry = {
            base: target[methodName],
            layers: new Map(),
            current: target[methodName],
            dispatcher: null,
        };
        entry.dispatcher = function (...args) {
            return entry.current.apply(this, args);
        };
        entries.set(methodName, entry);
        target[methodName] = entry.dispatcher;
    }

    const token = Symbol(patchId);
    entry.layers.set(patchId, { token, factory: wrapperFactory });
    rebuild(entry);
    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        if (entry.layers.get(patchId)?.token !== token) return;
        entry.layers.delete(patchId);
        rebuild(entry);
        if (entry.layers.size !== 0) return;
        if (target[methodName] === entry.dispatcher) target[methodName] = entry.base;
        entries.delete(methodName);
        if (entries.size === 0) PATCHES.delete(target);
    };
}
