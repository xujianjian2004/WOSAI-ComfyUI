/* 许可证一致性回归。
 *
 * 目的：让「哪些文件是 GPL-3.0 衍生作品」这件事只能被显式修改，不能被悄悄破坏。
 * 断言四件事：
 *   1. 许可证文件齐备（LICENSE 仍是 MIT 主体、LICENSE-GPL-3.0 是 GPL 全文、署名文件存在）
 *   2. 清单内每个文件都带 SPDX-License-Identifier: GPL-3.0-or-later 文件头
 *   3. 署名文件 THIRD-PARTY-NOTICES.md 逐一列出这些文件
 *   4. 无 MIT 文件静态 import GPL 文件（防止 GPL 反向传染 MIT 代码）
 *
 * 依据与背景见 THIRD-PARTY-NOTICES.md、dev/licensing/PORTING-AUDIT.md。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

/* GPL-3.0-or-later 衍生文件清单——单一事实来源。
   新增/移除条目必须同步 THIRD-PARTY-NOTICES.md 与 LICENSE 的例外章节。 */
const GPL_FILES = [
    "web/auto-connect.js",
    "web/shake-disconnect.js",
    "web/performance-mode.js",
    "web/shared/graph-utils.js",
    "web/ignore-groups.js",
];

const SPDX_GPL = "SPDX-License-Identifier: GPL-3.0-or-later";

test("许可证文件齐备且主体仍为 MIT", () => {
    assert.ok(existsSync(path.join(ROOT, "LICENSE")), "缺少 LICENSE");
    assert.ok(existsSync(path.join(ROOT, "LICENSE-GPL-3.0")), "缺少 LICENSE-GPL-3.0");
    assert.ok(existsSync(path.join(ROOT, "THIRD-PARTY-NOTICES.md")), "缺少 THIRD-PARTY-NOTICES.md");

    const mit = read("LICENSE");
    // check-version.mjs 依赖这一行，改动会同时打断版本门禁
    assert.match(mit, /Copyright \(c\) \d{4} 穿山阅海/, "LICENSE 的 MIT 版权行丢失");
    assert.match(mit, /MIT License/, "LICENSE 不再是 MIT 文本");
    // 例外章节必须存在，否则「主体 MIT + 少数 GPL」的声明不成立
    assert.match(mit, /许可证例外说明/, "LICENSE 缺少例外说明章节");
    for (const f of GPL_FILES) {
        assert.ok(mit.includes(f), `LICENSE 例外章节未列出 ${f}`);
    }

    const gpl = read("LICENSE-GPL-3.0");
    assert.match(gpl, /GNU GENERAL PUBLIC LICENSE/, "LICENSE-GPL-3.0 不是 GPL 全文");
    assert.match(gpl, /Version 3, 29 June 2007/, "LICENSE-GPL-3.0 不是 GPL v3");
});

test("每个 GPL 衍生文件都带正确的 SPDX 标识", () => {
    for (const rel of GPL_FILES) {
        const p = path.join(ROOT, rel);
        assert.ok(existsSync(p), `清单中的文件不存在: ${rel}`);
        const src = read(rel);
        assert.ok(src.includes(SPDX_GPL), `${rel} 缺少 ${SPDX_GPL} 文件头`);
        // 文件头必须落在文件最前面的注释块内（前 400 字符），避免被塞到文件中部
        assert.ok(src.indexOf(SPDX_GPL) < 400, `${rel} 的 SPDX 标识不在文件头部`);
    }
});

test("署名文件逐一列出 GPL 衍生文件及其上游出处", () => {
    const notices = read("THIRD-PARTY-NOTICES.md");
    for (const rel of GPL_FILES) {
        assert.ok(notices.includes(rel), `THIRD-PARTY-NOTICES.md 未列出 ${rel}`);
    }
    // 两个上游项目与许可证必须被点名
    assert.match(notices, /ComfyUI-KJNodes/, "未署名 ComfyUI-KJNodes");
    assert.match(notices, /kijai/, "未署名 KJNodes 作者");
    assert.match(notices, /Goohaitools-comfyui/, "未署名 Goohaitools-comfyui");
    assert.match(notices, /goohai/i, "未署名 Goohaitools 作者");
    assert.match(notices, /LICENSE-GPL-3\.0/, "署名文件未指向许可证全文");
});

test("无 MIT 文件静态 import GPL 文件（反向传染防线）", () => {
    const gplSet = new Set(GPL_FILES.map((f) => path.resolve(ROOT, f)));

    const walk = (dir) => {
        const out = [];
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (e.name === "node_modules" || e.name.startsWith(".")) continue;
            const abs = path.join(dir, e.name);
            if (e.isDirectory()) out.push(...walk(abs));
            else if (e.name.endsWith(".js")) out.push(abs);
        }
        return out;
    };

    const offenders = [];
    for (const abs of walk(path.join(ROOT, "web"))) {
        const rel = path.relative(ROOT, abs).split(path.sep).join("/");
        const src = readFileSync(abs, "utf8");
        const isGpl = gplSet.has(abs) || src.includes(SPDX_GPL);
        if (isGpl) continue;   // GPL 文件引用 GPL 文件是允许的

        for (const m of src.matchAll(/^\s*(?:import|export)\b[\s\S]*?\bfrom\s*["']([^"']+)["']/gm)) {
            const spec = m[1].split("?", 1)[0];
            if (!spec.startsWith(".")) continue;
            const target = path.resolve(path.dirname(abs), spec);
            if (gplSet.has(target)) {
                offenders.push(`${rel} → ${path.relative(ROOT, target).split(path.sep).join("/")}`);
            }
        }
    }
    assert.deepEqual(offenders, [],
        `以下 MIT 文件引用了 GPL 文件，会把 MIT 代码拖入 GPL 传染范围：\n  ${offenders.join("\n  ")}`);
});
