// ========== WOSAI 上下文菜单收拢 ==========
// 把散落在宿主菜单里的 WOSAI 条目，在 DOM 层重新聚成连续一块。
// 画布菜单（menu-hide.js）与节点菜单（layout-toolkit.js）共用本模块：两者此前各有一份
// 功能等价的实现，同一处缺陷要改两遍，2026-09-29 合并为单一实现，仅以 anchor 区分策略。
//
// 为什么需要这一层：ComfyUI 的菜单数组是「内置项 + 各扩展项」拼出来的，而第三方扩展
// 常用 splice(idx, 0, …) 把自己的条目插进这个数组。其中存在一类很典型的索引缺陷：
//
//     let idx = list.findIndex(o => o?.content?.startsWith?.("Queue Group")) + 1;  // 未命中 → 0
//     idx = idx || list.findIndex(o => o?.content?.startsWith?.("Convert to Group")); // 未命中 → -1
//     ...
//     list.splice(idx, 0, ...items);                                              // idx === -1
//
// 前两行带 `+1`，未命中得 0（假值）会继续往下找；后两行没有 `+1`，未命中得 -1，
// 而 `-1` 在 JS 里是**真值**，于是被 `||` 链锁死。`splice(-1, 0, …)` 等价于
// 「插到倒数第一项之前」——数组末项就这样被顶开了。WOSAI 的画布条目恰好排在数组尾部，
// 所以最后一项会被隔到另一边，与其余条目分离。
//
// 数组层没有稳定的规避办法（谁最后包装 getCanvasMenuOptions / getNodeMenuOptions，
// 谁才说了算，而扩展之间的包装次序不受我们控制），因此改在 DOM 层、渲染完成之后收拢。
// 本模块只搬动节点本身，不读写条目的属性、文案与显隐状态，因此与「菜单隐藏」等功能
// 互不干扰。

/** 上下文菜单根节点的选择器：兼容 LiteGraph 经典菜单与新版 context-menu 实现。 */
export const MENU_ROOT_SELECTOR = ".litecontextmenu, .context-menu, .litegraph-contextmenu";

/** 菜单条目的通用选择器：兼容 LiteGraph 经典菜单与新版 context-menu 实现。 */
const DEFAULT_ENTRY_SELECTOR =
    ".litemenu-entry, .context-menu-item, .menu-item, .lite-menu-item, [class*=\"menu-entry\"], [class*=\"menu-item\"]";

/** 菜单分隔符的通用选择器。 */
const DEFAULT_SEPARATOR_SELECTOR = ".separator, .litemenu-separator, hr";

/**
 * 归一化条目文案：去 HTML 标签、把连续空白压成一个空格，用于与声明顺序比对。
 * @param {*} value 原始文本或带标签的 content
 * @returns {string}
 */
export function normalizeMenuLabel(value) {
    return String(value ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/**
 * 判断节点是否为菜单分隔符。
 * @param {Element} element
 * @param {string} [selector]
 * @returns {boolean}
 */
export function isMenuSeparator(element, selector = DEFAULT_SEPARATOR_SELECTOR) {
    return !!element?.matches?.(selector);
}

/**
 * 把 `labels` 指定的条目在 `menuRoot` 内收拢成一个连续块，顺序与 `labels` 一致。
 *
 * 已收拢时返回 false（组内连续且次序一致；`anchor:"top"` 还要求组前只剩分隔符），
 * 因此可重复调用。同名文案若同时出现在子菜单里，取命中数最多的那一层作为目标层级。
 *
 * 条目数不设下限：单条时 `anchor:"group"` 天然「已收拢」而直接返回，
 * `anchor:"top"` 仍会把它移到最前 —— 节点菜单可能只注册了一条 WOSAI 项。
 *
 * @param {Element} menuRoot 菜单根节点
 * @param {object} options
 * @param {string[]} options.labels 需要收拢的条目文案（与渲染后的文本一致）
 * @param {"group"|"top"} [options.anchor] "group" 保留本组当前的层级位置（默认）；
 *        "top" 则一律移到菜单最前
 * @param {string} [options.entrySelector]
 * @param {string} [options.separatorSelector]
 * @param {string} [options.separatorAttribute] 自建分隔符的标记属性，便于回滚清理
 * @returns {boolean} 是否真的搬动了节点
 */
export function coalesceMenuItems(menuRoot, options = {}) {
    const {
        labels,
        anchor = "group",
        entrySelector = DEFAULT_ENTRY_SELECTOR,
        separatorSelector = DEFAULT_SEPARATOR_SELECTOR,
        separatorAttribute = "data-wosai-menu-separator",
    } = options || {};

    if (!menuRoot?.querySelectorAll || !Array.isArray(labels) || !labels.length) return false;

    const wanted = new Set(labels);
    const byParent = new Map();
    menuRoot.querySelectorAll(entrySelector).forEach((entry) => {
        const label = normalizeMenuLabel(entry.textContent ?? entry.innerText ?? "");
        if (!label || !wanted.has(label) || !entry.parentElement) return;
        const hits = byParent.get(entry.parentElement) ?? new Map();
        if (!hits.has(label)) hits.set(label, entry);
        byParent.set(entry.parentElement, hits);
    });

    // 命中数最多的容器才是目标层级：子菜单里可能出现同名条目
    const [parent, hits] = [...byParent.entries()].sort((a, b) => b[1].size - a[1].size)[0] ?? [];
    if (!parent) return false;

    const ordered = labels.map((label) => hits.get(label)).filter(Boolean);
    if (!ordered.length) return false;

    const group = new Set(ordered);
    const children = [...parent.children];
    const firstIndex = children.findIndex((child) => group.has(child));
    const lastIndex = children.length - 1 - [...children].reverse().findIndex((child) => group.has(child));

    // 幂等判据：组内已经连续且次序与 labels 一致就认为「已收拢」。
    // anchor:"top" 还需额外确认组前面只剩分隔符 —— 组内连续 ≠ 位置已在最前，
    // 少了这一条，anchor:"top" 在「组已连续但位置靠后」时会直接返回 false，永远搬不动。
    const between = children.slice(firstIndex, lastIndex + 1);
    const innerOrdered = between.length === ordered.length && between.every((child, index) => child === ordered[index]);
    const alreadyAtTop = anchor !== "top"
        || !children.slice(0, firstIndex).some((child) => !isMenuSeparator(child, separatorSelector));
    if (innerOrdered && alreadyAtTop) return false;

    const candidates = anchor === "top" ? children : children.slice(firstIndex + 1);
    const anchorEl = candidates.find((child) => !group.has(child) && !isMenuSeparator(child, separatorSelector)) ?? null;

    parent.querySelectorAll(`[${separatorAttribute}]`).forEach((node) => node.remove());

    const doc = menuRoot.ownerDocument ?? globalThis.document;
    const block = doc.createDocumentFragment();
    ordered.forEach((entry) => block.appendChild(entry));
    if (anchorEl) parent.insertBefore(block, anchorEl);
    else parent.appendChild(block);

    // 本组与被顶到后面的条目之间补一道分隔符，沿用宿主自己的分隔符节点以继承样式
    if (anchorEl) {
        const template = [...parent.children].find((child) => child !== anchorEl && isMenuSeparator(child, separatorSelector));
        const separator = template ? template.cloneNode(false) : doc.createElement("div");
        if (!template) separator.className = "litemenu-separator";
        separator.removeAttribute?.("id");
        separator.setAttribute(separatorAttribute, "");
        parent.insertBefore(separator, anchorEl);
    }

    // 本组搬走后，原位置遗留的分隔符可能与新补的相邻 —— 两条线叠在一起视觉上是双线，合并掉
    let previous = null;
    for (const child of [...parent.children]) {
        if (isMenuSeparator(child, separatorSelector) && previous && isMenuSeparator(previous, separatorSelector)) {
            child.remove();
            continue;
        }
        previous = child;
    }

    // 原先位于末项之前的分隔符会变成悬在末尾的分隔线，顺手清掉
    while (parent.lastElementChild && isMenuSeparator(parent.lastElementChild, separatorSelector)) {
        parent.lastElementChild.remove();
    }

    return true;
}
