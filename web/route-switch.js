import { app } from "../../../scripts/app.js";
import { applyNodeDefTranslation } from "./shared/i18n.js";

const PATCH_KEY = "__wosaiNumberSwitchPatch";
const MAX_INPUTS = 32;
const patchedNodeTypes = new Set();

function isValueInput(input) {
    return /^value\d+$/.test(input?.name || "");
}

function adjustClassicInputs(node) {
    if (!Array.isArray(node.inputs)) return;
    const values = node.inputs.filter(isValueInput);
    let lastConnected = -1;
    values.forEach((input, index) => {
        if (input.link != null) lastConnected = index;
    });
    const desired = Math.min(MAX_INPUTS, Math.max(1, lastConnected + 2));

    if (values.length < desired) {
        for (let index = values.length; index < desired; index += 1) {
            node.addInput?.(`value${index}`, "*");
        }
    } else if (values.length > desired) {
        for (let index = node.inputs.length - 1; index >= 0 && node.inputs.filter(isValueInput).length > desired; index -= 1) {
            const input = node.inputs[index];
            if (isValueInput(input) && input.link == null) node.removeInput?.(index);
        }
    }
    node.setSize?.(node.computeSize?.() || node.size);
    node.setDirtyCanvas?.(true, true);
}

app.registerExtension({
    name: "wosai.NumberSwitch",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "WOSAI_NumberSwitch") return;
        applyNodeDefTranslation(nodeData);
        // Native Autogrow schemas expose a dynamic "values" input and need no
        // frontend slot mutation.
        if (nodeData.input?.required?.values || nodeData.input?.optional?.values) return;
        if (nodeType.prototype[PATCH_KEY]) return;

        const originalCreated = nodeType.prototype.onNodeCreated;
        const originalConfigured = nodeType.prototype.onConfigure;
        const originalConnections = nodeType.prototype.onConnectionsChange;
        const created = function () {
            const result = originalCreated?.apply(this, arguments);
            queueMicrotask(() => adjustClassicInputs(this));
            return result;
        };
        const configured = function () {
            const result = originalConfigured?.apply(this, arguments);
            queueMicrotask(() => adjustClassicInputs(this));
            return result;
        };
        const connections = function (type) {
            const result = originalConnections?.apply(this, arguments);
            if (type === window.LiteGraph?.INPUT) queueMicrotask(() => adjustClassicInputs(this));
            return result;
        };
        nodeType.prototype.onNodeCreated = created;
        nodeType.prototype.onConfigure = configured;
        nodeType.prototype.onConnectionsChange = connections;
        nodeType.prototype[PATCH_KEY] = {
            originalCreated, originalConfigured, originalConnections,
            created, configured, connections,
        };
        patchedNodeTypes.add(nodeType);
    },
    remove() {
        for (const nodeType of patchedNodeTypes) {
            const proto = nodeType.prototype;
            const patch = proto[PATCH_KEY];
            if (!patch) continue;
            if (proto.onNodeCreated === patch.created) proto.onNodeCreated = patch.originalCreated;
            if (proto.onConfigure === patch.configured) proto.onConfigure = patch.originalConfigured;
            if (proto.onConnectionsChange === patch.connections) proto.onConnectionsChange = patch.originalConnections;
            delete proto[PATCH_KEY];
        }
        patchedNodeTypes.clear();
    },
});
