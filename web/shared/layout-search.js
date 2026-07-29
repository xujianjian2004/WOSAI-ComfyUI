import { t } from "./i18n.js";
import { app } from "../../../../scripts/app.js";
import { quickToast } from "./toast.js";

const FLASH_DUR = 1200;
const FLASH_COLOR = "var(--ws-lt-flash-color)";
let _flashNode = null;
let _flashUntil = 0;
let _jumpHist = [];
let _jumpPos = -1;

function _startFlash(node) {
    _flashNode = node;
    _flashUntil = performance.now() + FLASH_DUR;
    const tick = () => {
        app.canvas?.setDirty?.(true, true);
        if (_flashNode && performance.now() < _flashUntil) requestAnimationFrame(tick);
        else {
            _flashNode = null;
            app.canvas?.setDirty?.(true, true);
        }
    };
    requestAnimationFrame(tick);
}

function _pushHist(node) {
    if (_jumpHist[_jumpPos] === node) return;
    _jumpHist = _jumpHist.slice(0, _jumpPos + 1);
    _jumpHist.push(node);
    if (_jumpHist.length > 50) _jumpHist.shift();
    _jumpPos = _jumpHist.length - 1;
}

export function jumpBack() {
    if (_jumpPos > 0) {
        _jumpPos--;
        jumpToNode(_jumpHist[_jumpPos], true);
    } else quickToast(t("menus.layoutToolkit.historyOldest"));
}

export function jumpForward() {
    if (_jumpPos < _jumpHist.length - 1) {
        _jumpPos++;
        jumpToNode(_jumpHist[_jumpPos], true);
    } else quickToast(t("menus.layoutToolkit.historyNewest"));
}

export function jumpToNode(node, fromHistory) {
    const canvas = app.canvas;
    if (!canvas || !node) return;
    try {
        if (typeof canvas.centerOnNode === "function") canvas.centerOnNode(node);
        else if (canvas.ds && node.pos && node.size) {
            const el = canvas.canvas;
            canvas.ds.offset[0] = -(node.pos[0] + node.size[0] / 2) + (el.width / canvas.ds.scale) / 2;
            canvas.ds.offset[1] = -(node.pos[1] + node.size[1] / 2) + (el.height / canvas.ds.scale) / 2;
        }
        canvas.selectNode?.(node);
        canvas.setDirty?.(true, true);
        canvas.draw?.(true, true);
        if (!fromHistory) _pushHist(node);
        _startFlash(node);
    } catch (_) {}
}

export function connectedNodes(node) {
    const graph = node?.graph || app.canvas?.graph;
    if (!graph || !node) return { ins: [], outs: [] };
    const links = graph.links;
    const linkOf = (id) => links ? (links instanceof Map ? links.get(id) : links[id]) : null;
    const nodeOf = (id) => graph.getNodeById ? graph.getNodeById(id) : (graph._nodes || []).find((candidate) => candidate.id === id);
    const ins = [], outs = [], seenI = new Set(), seenO = new Set();
    (node.inputs || []).forEach((input) => {
        if (input.link == null) return;
        const link = linkOf(input.link);
        const source = link && nodeOf(link.origin_id);
        if (source && !seenI.has(source.id)) { seenI.add(source.id); ins.push(source); }
    });
    (node.outputs || []).forEach((output) => {
        (output.links || []).forEach((id) => {
            const link = linkOf(id);
            const target = link && nodeOf(link.target_id);
            if (target && !seenO.has(target.id)) { seenO.add(target.id); outs.push(target); }
        });
    });
    return { ins, outs };
}

export function _navMenuItem(node) {
    return {
        content: t("menus.layoutToolkit.contextMenuJump"),
        has_submenu: true,
        callback: (_value, _options, event, menu) => {
            const { ins, outs } = connectedNodes(node);
            const items = [];
            if (ins.length) {
                items.push({ content: t("menus.layoutToolkit.inputSide"), disabled: true });
                ins.forEach((item) => items.push({ content: `→ ${item.title || item.type} #${item.id}`, callback: () => jumpToNode(item) }));
            }
            if (outs.length) {
                items.push({ content: t("menus.layoutToolkit.outputSide"), disabled: true });
                outs.forEach((item) => items.push({ content: `→ ${item.title || item.type} #${item.id}`, callback: () => jumpToNode(item) }));
            }
            if (!items.length) items.push({ content: t("menus.layoutToolkit.noConnectedNodes"), disabled: true });
            const LiteGraph = window.LiteGraph;
            if (LiteGraph?.ContextMenu) new LiteGraph.ContextMenu(items, { event, parentMenu: menu, title: t("menus.layoutToolkit.connectedNodesTitle") });
        },
    };
}

export { _flashNode, _flashUntil, FLASH_DUR, FLASH_COLOR };

window.__wosaiConnectedNodes = connectedNodes;
window.__wosaiJumpToNode = jumpToNode;
