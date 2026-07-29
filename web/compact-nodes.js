import { app } from "../../../scripts/app.js";

const TARGET_TYPES = new Set([
    "WOSAI_LogicSwitch",
    "WOSAI_LazyFallback",
    "WOSAI_FirstLastFrame",
]);
const PATCH_KEY = "__wosaiCompactNativeNodePatch";

function compactNode(node) {
    if (!node?.setSize) return false;
    const computed = typeof node.computeSize === "function" ? node.computeSize() : null;
    const height = Number(computed?.[1]) || 0;
    if (!(height > 0)) return false;
    const width = Math.max(Number(computed?.[0]) || 0, Number(node.size?.[0]) || 0);
    if (!(width > 0)) return false;
    node.setSize([width, height]);
    node.__wosaiCompactSizeApplied = true;
    node.setDirtyCanvas?.(true, true);
    return true;
}

function scheduleCompact(node) {
    queueMicrotask(() => compactNode(node));
}

app.registerExtension({
    name: "wosai.CompactNodes",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!TARGET_TYPES.has(nodeData.name)) return;
        if (nodeType.prototype[PATCH_KEY]) return;
        const originalCreated = nodeType.prototype.onNodeCreated;
        const originalConfigured = nodeType.prototype.onConfigure;
        const created = function () {
            const result = originalCreated?.apply(this, arguments);
            scheduleCompact(this);
            return result;
        };
        const configured = function () {
            const result = originalConfigured?.apply(this, arguments);
            scheduleCompact(this);
            return result;
        };
        nodeType.prototype.onNodeCreated = created;
        nodeType.prototype.onConfigure = configured;
        nodeType.prototype[PATCH_KEY] = {
            originalCreated,
            originalConfigured,
            created,
            configured,
        };
    },

    setup() {
        app.graph?._nodes?.forEach((node) => {
            if (TARGET_TYPES.has(node.type)) scheduleCompact(node);
        });
    },

    remove() {
        for (const type of TARGET_TYPES) {
            const nodeType = window.LiteGraph?.registered_node_types?.[type];
            const patch = nodeType?.prototype?.[PATCH_KEY];
            if (!patch) continue;
            if (nodeType.prototype.onNodeCreated === patch.created) {
                nodeType.prototype.onNodeCreated = patch.originalCreated;
            }
            if (nodeType.prototype.onConfigure === patch.configured) {
                nodeType.prototype.onConfigure = patch.originalConfigured;
            }
            delete nodeType.prototype[PATCH_KEY];
        }
    },
});

