import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

// 契约：快捷对齐田字格的四个方向键必须常驻显示中文动作名。
//   四枚按钮的外观只有 ← → ↑ ↓，不标名字就只能靠悬停猜；早期的做法是
//   悬停时用 ::after 把图标换成一行动作名（data-inline-tip），指针一移开
//   名字就消失，等于「图标永远无标签」。现在标签是图标下方的常驻 span。

function source(relativePath) {
    return fs.readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const js = source("../shared/layout-align.js");
const css = source("../styles/layout-toolkit.css");

test("四个方向键各自渲染一枚常驻标签（图标下方）", () => {
    // 标签必须作为真实子元素插入：CSS 伪元素无法被读屏软件朗读，
    // 也无法在打印 / 高对比度模式下稳定保留
    assert.match(js, /cap\.className = className;/);
    assert.match(js, /cap\.textContent = label;/);
    assert.match(js, /addCap\(button, "wosai-al-tian-cap", label\);/);
    assert.match(js, /addCap\(button, "wosai-al-center-cap", label\);/);
    // 四个方向仍各自带标签：左 / 右 / 顶 / 底
    for (const key of ["left", "right", "top", "bottom"]) {
        assert.match(js, new RegExp(`LABELS\\.${key}`), `缺少 ${key} 的动作名`);
    }
});

test("标签常驻可见，不再靠悬停切换", () => {
    // 旧实现的悬停替换必须整套消失：::after 文字 + 悬停隐藏子元素
    assert.doesNotMatch(js, /dataset\.inlineTip/);
    assert.doesNotMatch(css, /data-inline-tip/);
    assert.doesNotMatch(css, /\[data-inline-tip\]:hover > \* \{\s*opacity: 0;/);
    // 常驻标签不允许自己带过渡性隐藏，也不许被 pointer-events 之外的规则藏起来
    const rule = css.match(/\.wosai-al-tian-cap,\s*\n\.wosai-al-center-cap \{[^}]*\}/)?.[0] ?? "";
    assert.ok(rule, "未找到常驻标签样式");
    // 与下方「等宽 / 等高 / 等尺寸」按钮同字号（面板基准 --ws-text-md），
    // 同一面板里不该出现两种正文大小
    assert.match(rule, /font-size: var\(--ws-text-md\);/);
    assert.doesNotMatch(rule, /opacity:\s*0/, "常驻标签不得默认透明");
});

test("按钮改为竖排，图标与标签上下排列", () => {
    const btn = css.match(/\.wosai-al-tian-btn \{[^}]*\}/)?.[0] ?? "";
    assert.match(btn, /flex-direction: column;/, "方向键需要竖排");
    assert.match(btn, /justify-content: center;/);
    const center = css.match(/\.wosai-al-center-action \{[^}]*\}/)?.[0] ?? "";
    assert.match(center, /flex-direction: column;/, "中央上下两键同样竖排");
    // 中央键此前没有图标尺寸规则，加标签后必须与其他键同源
    assert.match(css, /\.wosai-al-center-action svg \{[^}]*var\(--ws-lt-quick-icon-size\)/);
});
