import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

// 契约：手动模式可以「一键取上游原图尺寸」。
//   节点早已能解析上游原图尺寸（Scale 模式预览用的就是 _ss_srcW / _ss_srcH），
//   但手动模式下没有入口把它填进自定义宽高 —— 用户只能肉眼读了再手打。
//   ⚠ 按钮必须带「无源可点」的置灰态：没有上游时点了没反应比没有按钮更糟。

function source(relativePath) {
    return fs.readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const sizeSelectJs = source("../size-select.js");
const css = source("../styles/os-size.css");
const zh = JSON.parse(source("../locales/zh/menus.json"));
const en = JSON.parse(source("../locales/en/menus.json"));

test("the manual panel has a use-source-size button next to swap", () => {
    assert.match(sizeSelectJs, /useSrcBtn\.className = "ss-swap-btn"/);
    assert.match(sizeSelectJs, /manRow\.append\(useSrcBtn, swapBtn\)/);
    assert.match(sizeSelectJs, /node\._ss_useSrcBtn = useSrcBtn/);
});

test("clicking it re-resolves the upstream, then fills the custom dimensions", () => {
    const handler = sizeSelectJs.match(/useSrcBtn\.onclick = async \(\) => \{[\s\S]*?\n {8}\};/);
    assert.ok(handler, "useSrcBtn.onclick not found");
    // 上游换图不换连线，缓存的 _ss_srcW/_ss_srcH 会停在旧图 ⇒ 点击时必须重新解析，
    // 且新图尚未解码时要 await 解析结果而不是拿旧值硬填
    assert.match(handler[0], /const wh = await _ssTrackSourceImage\(\);/);
    assert.match(handler[0], /if \(!wh\) return;/);
    assert.match(handler[0], /const \[srcW, srcH\] = wh;/);
    assert.match(handler[0], /baseWidth\s+= alignTo\(srcW, step\)/);
    assert.match(handler[0], /baseHeight\s+= alignTo\(srcH, step\)/);
    assert.match(handler[0], /updateWidgetValue\(cusW, baseWidth\)/);
    assert.match(handler[0], /updateWidgetValue\(cusH, baseHeight\)/);
});

test("source size is re-resolved when the upstream changes image", () => {
    const fn = sizeSelectJs.match(/function _ssTrackSourceImage\(\) \{[\s\S]*?\n {8}\}/);
    assert.ok(fn, "_ssTrackSourceImage not found");
    // 返回可 await 的 [w, h]：换完文件立刻点按钮时新图往往还在解码
    assert.match(fn[0], /return Promise\.resolve\(\[node\._ss_srcW, node\._ss_srcH\]\);/);
    assert.match(fn[0], /return new Promise\(\(resolve\) => \{/);
    // 旧 <img> 的 load 晚于新图到达时不得回填，否则旧尺寸会盖掉新图
    assert.match(fn[0], /if \(_ssResolveUpstream\("image"\)\?\.imgs\?\.\[0\] !== img\) return false;/);
    // 上游执行完（新图落盘 / latent 重建）也要重解析：连线没变时 onConnectionsChange 不触发
    assert.match(sizeSelectJs, /api\.addEventListener\("executed", _onUpstreamExecuted\);/);
    assert.match(sizeSelectJs, /api\.removeEventListener\("executed", _onUpstreamExecuted\);/);
});

test("the button is disabled while no upstream size is known", () => {
    const fn = sizeSelectJs.match(/function syncUseSourceBtn\(\) \{[\s\S]*?\n {8}\}/);
    assert.ok(fn, "syncUseSourceBtn not found");
    assert.match(fn[0], /const has = node\._ss_srcW > 0 && node\._ss_srcH > 0;/);
    assert.match(fn[0], /useSrcBtn\.disabled = !has;/);
    // 上游换图 / 断线后状态要跟着变，所以挂在每次预览刷新里
    assert.match(sizeSelectJs, /renderAreaMeta\(w, h, step\);\s*\n\s*syncUseSourceBtn\(\);/);
});

test("both locales carry the new labels", () => {
    for (const [name, dict] of [["zh", zh], ["en", en]]) {
        for (const key of ["useSourceSize", "tipUseSourceSize", "tipNoSourceSize"]) {
            assert.equal(typeof dict.sizeSelect?.[key], "string", `${name}.sizeSelect.${key} missing`);
        }
    }
});

test("the two manual buttons share one row and a disabled state", () => {
    const row = css.match(/\.ss-man-row \{[\s\S]*?\}/);
    assert.ok(row, ".ss-man-row not found");
    assert.match(row[0], /display: flex/);
    const item = css.match(/\.ss-man-row \.ss-swap-btn \{[\s\S]*?\}/);
    assert.ok(item, ".ss-man-row .ss-swap-btn not found");
    assert.match(item[0], /flex: 1/, "两枚按钮等宽，不挤占原有的互换宽高");
    const disabled = css.match(/\.ss-swap-btn:disabled \{[\s\S]*?\}/);
    assert.ok(disabled, ".ss-swap-btn:disabled not found");
    assert.match(disabled[0], /pointer-events: none/, "置灰后连 hover 高亮都不该有");
});
