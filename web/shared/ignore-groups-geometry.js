export function groupBounds(group) {
    if (group?._bounding) return [...group._bounding];
    if (group?.bounding) return [...group.bounding];
    const position = group?.pos || [0, 0];
    const size = group?.size || [0, 0];
    return [position[0], position[1], size[0], size[1]];
}

export function groupColor(group) {
    const color = group?.color;
    if (typeof color === "number") return `#${color.toString(16).padStart(6, "0")}`;
    if (typeof color !== "string" || !/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color)) return "";
    if (color.length === 7) return color;
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
}

export function nodeBounds(node, { titleHeight = 30 } = {}) {
    const position = node?.pos || [0, 0];
    const size = node?.size || [100, 60];
    if (!node?.collapsed && !node?._collapsed) {
        return [position[0], position[1], size[0], size[1]];
    }

    const title = (typeof node.getTitle === "function" ? node.getTitle() : node.title) || "";
    const width = node._collapsed_width > 0
        ? node._collapsed_width
        : Math.max(80, title.length * 7 + 50);
    return [position[0], position[1], width, titleHeight];
}

export function rectanglesOverlap(first, second) {
    return !(first[0] + first[2] <= second[0]
        || first[0] >= second[0] + second[2]
        || first[1] + first[3] <= second[1]
        || first[1] >= second[1] + second[3]);
}

export function rectangleInside(inner, outer) {
    return inner[0] >= outer[0]
        && inner[1] >= outer[1]
        && inner[0] + inner[2] <= outer[0] + outer[2]
        && inner[1] + inner[3] <= outer[1] + outer[3];
}
