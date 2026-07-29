// WOSAI selection follower.
//
// Mirrors ComfyUI SelectionToolbox positioning: selected items remain in
// world coordinates while a single RAF loop projects their bounds through the
// current canvas scale/offset. HUD surfaces stay screen-sized and only their
// fixed left/top position changes during pan, zoom, selection, or node moves.
import { app } from "../../../../scripts/app.js";
import { getSelectedGroups, getSelectedNodes, isGroupObj } from "./canvas-utils.js";

const _followers = new Set();
let _followFrame = 0;

function _itemBounds(canvas, options) {
    const titleHeight = window.LiteGraph?.NODE_TITLE_HEIGHT || 0;
    const bounds = [];
    const supplied = typeof options.getTargets === "function" ? options.getTargets() : options.targets;
    const targets = supplied
        ? [...supplied]
        : [...getSelectedNodes(canvas), ...getSelectedGroups(canvas)];
    for (const item of targets) {
        if (isGroupObj(item)) {
            const box = item?._bounding || item?.bounding;
            if (box?.length >= 4) {
                bounds.push({ x: box[0], y: box[1], width: box[2], height: box[3] });
            } else if (item?.pos && item?.size) {
                bounds.push({ x: item.pos[0], y: item.pos[1], width: item.size[0], height: item.size[1] });
            }
            continue;
        }
        if (!item?.pos || !item?.size) continue;
        bounds.push({
            x: item.pos[0],
            y: item.pos[1] - titleHeight,
            width: item.size[0],
            height: item.size[1] + titleHeight,
        });
    }
    return bounds;
}

function _selectionScreenBounds(canvas = app.canvas, options = {}) {
    if (!canvas?.canvas || !canvas?.ds) return null;
    const items = _itemBounds(canvas, options);
    if (!items.length) return null;

    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const item of items) {
        left = Math.min(left, item.x);
        top = Math.min(top, item.y);
        right = Math.max(right, item.x + item.width);
        bottom = Math.max(bottom, item.y + item.height);
    }

    const rect = canvas.canvas.getBoundingClientRect();
    const scale = canvas.ds.scale || 1;
    const offset = canvas.ds.offset || [0, 0];
    return {
        left: rect.left + (left + offset[0]) * scale,
        top: rect.top + (top + offset[1]) * scale,
        right: rect.left + (right + offset[0]) * scale,
        bottom: rect.top + (bottom + offset[1]) * scale,
    };
}

function _clamp(value, min, max) {
    return Math.max(min, Math.min(value, Math.max(min, max)));
}

function _placeFollower(selection, size, options) {
    const inset = options.inset ?? 8;
    const gap = options.gap ?? 10;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let x;
    let y;

    if (options.placement === "side") {
        const spaceRight = viewportWidth - inset - selection.right;
        const spaceLeft = selection.left - inset;
        x = spaceRight >= spaceLeft
            ? selection.right + gap
            : selection.left - size.width - gap;
        y = (selection.top + selection.bottom - size.height) / 2;
    } else {
        x = (selection.left + selection.right - size.width) / 2;
        y = selection.top - size.height - gap + (options.nudgeY || 0);
        if (y < inset) y = selection.bottom + gap;
    }

    return {
        x: _clamp(x, inset, viewportWidth - size.width - inset),
        y: _clamp(y, inset, viewportHeight - size.height - inset),
    };
}

function _isVisible(element) {
    if (!element?.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
}

function _updateFollower(entry) {
    const { element, options } = entry;
    if (!_isVisible(element) || element.dataset.wosaiManualPosition === "true") return;
    if (options.enabled && !options.enabled()) return;
    const selection = _selectionScreenBounds(options.canvas || app.canvas, options);
    if (!selection) return;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const point = _placeFollower(selection, rect, options);
    element.style.left = `${Math.round(point.x)}px`;
    element.style.top = `${Math.round(point.y)}px`;
}

function _followLoop() {
    _followFrame = 0;
    for (const entry of [..._followers]) {
        if (!entry.element?.isConnected) {
            _followers.delete(entry);
            continue;
        }
        _updateFollower(entry);
    }
    if (_followers.size) _followFrame = requestAnimationFrame(_followLoop);
}

function _ensureFollowLoop() {
    if (!_followFrame) _followFrame = requestAnimationFrame(_followLoop);
}

/**
 * Follow the current selection without scaling the HUD itself.
 * @param {HTMLElement} element fixed-position HUD or panel
 * @param {{placement?:"above"|"side",gap?:number,nudgeY?:number,inset?:number,enabled?:()=>boolean,canvas?:object,targets?:Iterable<object>,getTargets?:()=>Iterable<object>}} options
 * @returns {()=>void} cleanup callback
 */
export function registerSelectionFollower(element, options = {}) {
    if (!element) return () => {};
    const entry = { element, options: { placement: "above", ...options } };
    _followers.add(entry);
    _updateFollower(entry);
    _ensureFollowLoop();
    return () => {
        _followers.delete(entry);
        if (!_followers.size && _followFrame) {
            cancelAnimationFrame(_followFrame);
            _followFrame = 0;
        }
    };
}
