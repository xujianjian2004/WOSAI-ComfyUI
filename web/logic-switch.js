/**
 * WOSAI LogicSwitch — 逻辑开关节点的端口显示名国际化
 *
 * 移植自 ComfyUI-OverrideSwitch，后端节点重命名为 WOSAI_LogicSwitch
 * （nodes/logic_switch.py）。本文件仅负责前端端口标签的中英文切换，
 * 使其与 WOSAI 其它节点（如 SizeSelect）行为一致。
 *
 * 关键约束（见 _ref/ComfyUI 端口 i18n 方案.md）：
 *   - 正常路径只改 port.label 用于显示，保持 port.name 不变；对旧版已污染的
 *     存量节点，仅恢复其稳定内部名，避免 Vue Nodes 2.0 重复添加端口。
 *   - 翻译 key 格式：
 *       nodeDefs.WOSAI_LogicSwitch.inputs.{origName}.name
 *       nodeDefs.WOSAI_LogicSwitch.outputs.{origName}.name
 */
import { app } from "../../../scripts/app.js";
import { t, applyNodeDefTranslation, onLangChange } from "./shared/i18n.js";

const PATCH_KEY = "__wosaiLogicSwitchPatch";
let _offLangChange = null;
const INPUT_NAMES = new Set(["Default_Input", "condition", "true_input", "false_input"]);
const OUTPUT_NAMES = new Set(["output"]);
// Legacy workflow socket names are serialized data, not translatable UI text.
const LEGACY_DEFAULT_INPUT = "\u9ed8\u8ba4\u8f93\u5165";
const LEGACY_CONDITION = "\u6761\u4ef6";
const LEGACY_TRUE_INPUT = "\u771f\u503c\u8f93\u5165";
const LEGACY_FALSE_INPUT = "\u5047\u503c\u8f93\u5165";
const LEGACY_OUTPUT = "\u8f93\u51fa";
const PORT_ALIASES = new Map([
    [LEGACY_DEFAULT_INPUT, "Default_Input"],
    ["Default Input", "Default_Input"],
    [LEGACY_CONDITION, "condition"],
    [LEGACY_TRUE_INPUT, "true_input"],
    [LEGACY_FALSE_INPUT, "false_input"],
    [LEGACY_OUTPUT, "output"],
]);

function _stablePortName(port) {
    for (const candidate of [port?.name, port?._wosaiOrigName, port?.label]) {
        if (typeof candidate !== "string") continue;
        const stable = PORT_ALIASES.get(candidate) || candidate;
        if (INPUT_NAMES.has(stable) || OUTPUT_NAMES.has(stable)) return stable;
    }
    return port?._wosaiOrigName ?? port?.name;
}

function _hasLink(port) {
    return port?.link != null || (Array.isArray(port?.links) && port.links.some(link => link != null));
}

/**
 * Remove duplicate sockets left by older localized nodes. Vue Nodes 2.0 may
 * append a socket when the serialized name differs from nodeDef.name; keep
 * one canonical socket and prefer the one carrying a connection.
 */
function _dedupePorts(node, ports, names, removeMethod) {
    if (!Array.isArray(ports)) return;
    const firstByName = new Map();
    const remove = new Set();
    ports.forEach((port, index) => {
        const stable = _stablePortName(port);
        if (!names.has(stable)) return;
        port._wosaiOrigName = stable;
        const previousIndex = firstByName.get(stable);
        if (previousIndex == null) {
            firstByName.set(stable, index);
            return;
        }
        const previous = ports[previousIndex];
        if (!_hasLink(previous) && _hasLink(port)) {
            remove.add(previousIndex);
            firstByName.set(stable, index);
        } else {
            remove.add(index);
        }
    });

    [...remove].sort((a, b) => b - a).forEach(index => {
        if (typeof node[removeMethod] === "function") node[removeMethod](index);
        else ports.splice(index, 1);
    });
}

// 仅设 port.label 用于显示，并恢复 port.name 内部名，防止本地化端口污染执行 kwargs。
function _applyPortLabel(node) {
    if (!node?.type) return;
    _dedupePorts(node, node.inputs, INPUT_NAMES, "removeInput");
    _dedupePorts(node, node.outputs, OUTPUT_NAMES, "removeOutput");
    for (const [ports, section] of [[node.inputs, 'inputs'], [node.outputs, 'outputs']]) {
        if (!ports) continue;
        for (const port of ports) {
            port._wosaiOrigName = _stablePortName(port);
            if (port.name !== port._wosaiOrigName) port.name = port._wosaiOrigName;
            const key = `nodeDefs.${node.type}.${section}.${port._wosaiOrigName}.name`;
            const trans = t(key);
            if (trans !== key && trans !== port.label) {
                port.label = trans;
            }
        }
    }
}

app.registerExtension({
    name: "wosai.LogicSwitch",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "WOSAI_LogicSwitch") return;
        // 标题翻译（全局 beforeRegisterNodeDef 已对所有 WOSAI_ 节点处理，此处幂等兜底）
        applyNodeDefTranslation(nodeData);
        // 端口标签逻辑只应在节点类型首次注册时补一次，
        // 避免语言切换 N 次后 onNodeCreated 被叠加 N 份。
        if (!nodeType.prototype[PATCH_KEY]) {
            const original = nodeType.prototype.onNodeCreated;
            const originalConfigure = nodeType.prototype.onConfigure;
            const patched = function () {
                const result = original?.apply(this, arguments);
                _applyPortLabel(this);
                return result;
            };
            const patchedConfigure = function () {
                const result = originalConfigure?.apply(this, arguments);
                _applyPortLabel(this);
                return result;
            };
            nodeType.prototype.onNodeCreated = patched;
            nodeType.prototype.onConfigure = patchedConfigure;
            nodeType.prototype[PATCH_KEY] = { original, patched, originalConfigure, patchedConfigure };
        }
    },

    setup() {
        const normalizeExistingNodes = () => {
            if (!app.graph?._nodes) return;
            for (const n of app.graph._nodes) {
                if (n.type !== "WOSAI_LogicSwitch") continue;
                _applyPortLabel(n);
            }
            app.graph.setDirtyCanvas(true, true);
        };
        normalizeExistingNodes();
        _offLangChange ??= onLangChange(normalizeExistingNodes);
    },

    remove() {
        _offLangChange?.();
        _offLangChange = null;
        const nodeType = window.LiteGraph?.registered_node_types?.WOSAI_LogicSwitch;
        const patch = nodeType?.prototype?.[PATCH_KEY];
        if (patch) {
            if (nodeType.prototype.onNodeCreated === patch.patched) nodeType.prototype.onNodeCreated = patch.original;
            if (nodeType.prototype.onConfigure === patch.patchedConfigure) nodeType.prototype.onConfigure = patch.originalConfigure;
            delete nodeType.prototype[PATCH_KEY];
        }
    },
});
