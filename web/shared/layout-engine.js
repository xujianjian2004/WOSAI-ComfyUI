// Pure data-flow layout engine. It accepts normalized nodes/links and never
// mutates its inputs, so strategies can be tested without ComfyUI or a DOM.

function compareIds(a, b) {
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b));
}

function linkKey(link) {
    return `${String(link.from)}\u0000${String(link.to)}\u0000${link.fromSlot ?? ""}\u0000${link.toSlot ?? ""}`;
}

function normalizeLinks(nodes, links) {
    const ids = new Set(nodes.map((node) => node.id));
    const seen = new Set();
    return (Array.isArray(links) ? links : []).filter((link) => {
        if (!link || link.from === link.to || !ids.has(link.from) || !ids.has(link.to)) return false;
        const key = linkKey(link);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// Tarjan SCC. Collapsing cycles before assigning levels avoids arbitrary
// depth inflation and makes cyclic/custom workflows terminate deterministically.
function stronglyConnectedComponents(nodes, links) {
    const outgoing = new Map(nodes.map((node) => [node.id, []]));
    for (const link of links) outgoing.get(link.from).push(link.to);

    let index = 0;
    const indices = new Map();
    const low = new Map();
    const stack = [];
    const onStack = new Set();
    const components = [];

    function visit(id) {
        indices.set(id, index);
        low.set(id, index);
        index += 1;
        stack.push(id);
        onStack.add(id);
        for (const next of outgoing.get(id) || []) {
            if (!indices.has(next)) {
                visit(next);
                low.set(id, Math.min(low.get(id), low.get(next)));
            } else if (onStack.has(next)) {
                low.set(id, Math.min(low.get(id), indices.get(next)));
            }
        }
        if (low.get(id) !== indices.get(id)) return;
        const members = [];
        let next;
        do {
            next = stack.pop();
            onStack.delete(next);
            members.push(next);
        } while (next !== id);
        components.push(members);
    }

    for (const node of nodes) if (!indices.has(node.id)) visit(node.id);
    return components;
}

function componentGraph(nodes, links, vGap) {
    const components = stronglyConnectedComponents(nodes, links);
    const componentOf = new Map();
    components.forEach((members, index) => members.forEach((id) => componentOf.set(id, index)));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const metaNodes = components.map((members, index) => {
        const memberNodes = members.map((id) => byId.get(id)).filter(Boolean);
        const width = Math.max(0, ...memberNodes.map((node) => Number(node.w) || 0));
        const height = memberNodes.reduce((sum, node) => sum + (Number(node.h) || 0), 0)
            + Math.max(0, memberNodes.length - 1) * vGap;
        return { id: index, w: width, h: height, members };
    });
    const metaLinks = [];
    const seen = new Set();
    for (const link of links) {
        const from = componentOf.get(link.from);
        const to = componentOf.get(link.to);
        if (from === to) continue;
        const key = `${from}\u0000${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        metaLinks.push({ ...link, from, to });
    }
    return { components, componentOf, metaNodes, metaLinks };
}

function topoDepth(nodes, links) {
    const indegree = new Map(nodes.map((node) => [node.id, 0]));
    const children = new Map(nodes.map((node) => [node.id, []]));
    for (const link of links) {
        indegree.set(link.to, indegree.get(link.to) + 1);
        children.get(link.from).push(link.to);
    }
    const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
    const depth = new Map(nodes.map((node) => [node.id, 0]));
    let visited = 0;
    while (queue.length) {
        const id = queue.shift();
        visited += 1;
        for (const child of children.get(id) || []) {
            depth.set(child, Math.max(depth.get(child), depth.get(id) + 1));
            indegree.set(child, indegree.get(child) - 1);
            if (indegree.get(child) === 0) queue.push(child);
        }
    }
    // This is only a defensive fallback; SCC compression should make the
    // graph acyclic. Keeping all nodes at depth 0 is safer than a bad loop.
    if (visited !== nodes.length) return new Map(nodes.map((node) => [node.id, 0]));
    return depth;
}

function slotOrder(id, links, reverse) {
    let order = Number.POSITIVE_INFINITY;
    for (const link of links) {
        const isNeighbor = reverse ? link.from === id : link.to === id;
        if (!isNeighbor) continue;
        const slot = reverse ? link.toSlot : link.fromSlot;
        if (Number.isFinite(Number(slot))) order = Math.min(order, Number(slot));
    }
    return order;
}

function layoutDag(nodes, links, opts) {
    const { anchorX, startY, hGap, vGap, reverse } = opts;
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const parents = new Map(nodes.map((node) => [node.id, []]));
    const children = new Map(nodes.map((node) => [node.id, []]));
    for (const link of links) {
        children.get(link.from).push(link);
        parents.get(link.to).push(link);
    }
    const depth = topoDepth(nodes, links);
    const maxDepth = Math.max(0, ...depth.values());
    if (reverse) {
        for (const id of depth.keys()) depth.set(id, maxDepth - depth.get(id));
    }

    const columns = new Map();
    for (const node of nodes) {
        const level = depth.get(node.id) ?? 0;
        if (!columns.has(level)) columns.set(level, []);
        columns.get(level).push(node.id);
    }
    const colWidth = new Map();
    for (const [level, ids] of columns) colWidth.set(level, Math.max(...ids.map((id) => byId.get(id)?.w || 0)));
    const positions = {};
    const depthList = [...columns.keys()].sort((a, b) => a - b);
    let x = anchorX;
    let maxBottom = startY;

    const neighborLinks = (id) => (reverse ? children.get(id) : parents.get(id))
        .filter((link) => positions[reverse ? link.to : link.from]);
    const baryY = (id) => {
        const linksForNode = neighborLinks(id);
        if (!linksForNode.length) return Number.POSITIVE_INFINITY;
        return linksForNode.reduce((sum, link) => {
            const neighbor = reverse ? link.to : link.from;
            return sum + positions[neighbor][1];
        }, 0) / linksForNode.length;
    };

    for (const level of depthList) {
        const ids = columns.get(level);
        ids.sort((a, b) => {
            const slotA = slotOrder(a, links, reverse);
            const slotB = slotOrder(b, links, reverse);
            if (slotA !== slotB) return slotA - slotB;
            const y = baryY(a) - baryY(b);
            return y || compareIds(a, b);
        });
        let cursorY = startY;
        for (const id of ids) {
            const node = byId.get(id);
            const linked = neighborLinks(id);
            let y = cursorY;
            if (linked.length === 1) {
                const neighbor = reverse ? linked[0].to : linked[0].from;
                y = Math.max(cursorY, positions[neighbor][1]);
            }
            positions[id] = [x, y];
            const bottom = y + (node?.h || 0);
            cursorY = bottom + vGap;
            maxBottom = Math.max(maxBottom, bottom);
        }
        x += (colWidth.get(level) || 0) + hGap;
    }
    return { positions, width: Math.max(0, x - anchorX - hGap), height: Math.max(0, maxBottom - startY) };
}

function layoutComponent(nodes, links, opts) {
    const { vGap } = opts;
    const { metaNodes, metaLinks } = componentGraph(nodes, links, vGap);
    const meta = layoutDag(metaNodes, metaLinks, opts);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const positions = {};
    for (const metaNode of metaNodes) {
        const base = meta.positions[metaNode.id] || [opts.anchorX, opts.startY];
        const members = metaNode.members.map((id) => byId.get(id)).filter(Boolean)
            .sort((a, b) => (Number(a.y) || 0) - (Number(b.y) || 0) || compareIds(a.id, b.id));
        let y = base[1];
        for (const member of members) {
            positions[member.id] = [base[0], y];
            y += (Number(member.h) || 0) + vGap;
        }
    }
    return { positions, width: meta.width, height: meta.height };
}

function connectedGroups(nodes, links) {
    const parent = new Map(nodes.map((node) => [node.id, node.id]));
    const find = (id) => {
        let root = id;
        while (parent.get(root) !== root) root = parent.get(root);
        while (parent.get(id) !== id) {
            const next = parent.get(id);
            parent.set(id, root);
            id = next;
        }
        return root;
    };
    for (const link of links) {
        const a = find(link.from), b = find(link.to);
        if (a !== b) parent.set(a, b);
    }
    const groups = new Map();
    for (const node of nodes) {
        const root = find(node.id);
        if (!groups.has(root)) groups.set(root, { nodes: [], links: [] });
        groups.get(root).nodes.push(node);
    }
    for (const link of links) groups.get(find(link.from)).links.push(link);
    return [...groups.values()];
}

export function computeLayout(nodes, links, opts = {}) {
    const options = {
        anchorX: 0,
        startY: 0,
        hGap: 80,
        vGap: 40,
        islandGap: 60,
        reverse: false,
        ...opts,
    };
    const empty = { positions: {}, width: 0, height: 0 };
    if (!Array.isArray(nodes) || !nodes.length) return empty;
    const cleanNodes = nodes.filter((node) => node && node.id != null);
    const cleanLinks = normalizeLinks(cleanNodes, links);
    const groups = connectedGroups(cleanNodes, cleanLinks).sort((a, b) =>
        b.nodes.length - a.nodes.length || b.links.length - a.links.length,
    );
    const positions = {};
    let y = options.startY;
    let width = 0;
    for (const group of groups) {
        const result = layoutComponent(group.nodes, group.links, { ...options, startY: y });
        Object.assign(positions, result.positions);
        y += result.height + options.islandGap;
        width = Math.max(width, result.width);
    }
    return {
        positions,
        width,
        height: Math.max(0, y - options.startY - options.islandGap),
    };
}

/**
 * Push overlapping layout boxes downward without changing their computed
 * column (x coordinate). This is a final safety pass for custom strategies
 * and for nodes whose DOM-backed size settles after the initial measurement.
 * `fixedNodes` are treated as obstacles and are never moved.
 */
export function resolveLayoutOverlaps(nodes, positions, opts = {}) {
    if (!Array.isArray(nodes) || !positions || typeof positions !== "object") return positions || {};
    const vGap = Math.max(0, Number(opts.vGap ?? 40));
    const fixedNodes = Array.isArray(opts.fixedNodes) ? opts.fixedNodes : [];
    const result = {};
    for (const [id, pos] of Object.entries(positions)) {
        if (Array.isArray(pos) && Number.isFinite(Number(pos[0])) && Number.isFinite(Number(pos[1]))) {
            result[id] = [Number(pos[0]), Number(pos[1])];
        }
    }
    const byId = new Map(nodes.map((node) => [String(node?.id), node]));
    const moving = nodes
        .filter((node) => node && result[String(node.id)])
        .slice()
        .sort((a, b) => {
            const pa = result[String(a.id)], pb = result[String(b.id)];
            return pa[1] - pb[1] || pa[0] - pb[0] || compareIds(a.id, b.id);
        });
    const fixed = fixedNodes
        .map((node) => {
            const pos = Array.isArray(node?.pos) ? node.pos : [node?.x, node?.y];
            return { node, pos: [Number(pos?.[0]) || 0, Number(pos?.[1]) || 0] };
        })
        .filter(({ node }) => node && Number.isFinite(Number(node.x ?? node.pos?.[0])) && Number.isFinite(Number(node.y ?? node.pos?.[1])))
        .sort((a, b) => a.pos[1] - b.pos[1] || a.pos[0] - b.pos[0] || compareIds(a.node.id, b.node.id));
    const blockers = fixed.slice();
    const overlapsX = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w;
    for (const node of moving) {
        const key = String(node.id);
        const pos = result[key];
        const w = Math.max(0, Number(node.w) || 0);
        const h = Math.max(0, Number(node.h) || 0);
        let y = pos[1];
        for (const blocker of blockers) {
            const blockerPos = blocker.pos || result[String(blocker.node.id)];
            if (!blockerPos) continue;
            const blockerW = Math.max(0, Number(blocker.node.w) || 0);
            const blockerH = Math.max(0, Number(blocker.node.h) || 0);
            const a = { x: pos[0], y, w, h };
            const b = { x: blockerPos[0], y: blockerPos[1], w: blockerW, h: blockerH };
            if (!overlapsX(a, b)) continue;
            if (a.y + a.h > b.y - vGap && a.y < b.y + b.h + vGap) {
                y = Math.max(y, b.y + b.h + vGap);
            }
        }
        pos[1] = y;
        blockers.push({ node: byId.get(key) || node, pos: [pos[0], pos[1]] });
    }
    return result;
}
