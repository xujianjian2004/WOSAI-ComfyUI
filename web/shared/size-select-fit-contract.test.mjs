import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

// 契约：尺寸选择节点的**第三种缩放方式 Fit（等比适配）**。
//   三选一口径：Crop=先裁到目标比例再拉伸 / Fit=不变形不裁剪地等比装入目标框 / Scale=按倍数线性缩放。
//   前端预览必须与后端 _fit_scale 同源复算，否则「预览」与「执行结果」会不一致——
//   这正是本节点之前踩过的坑（舍入口径、网格口径都曾前后端分叉）。

function source(relativePath) {
    return fs.readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const sizeSelectJs = source("../size-select.js");
const sizeSelectPy = source("../../nodes/size_select.py");
const css = source("../styles/os-size.css");
const zhMenus = JSON.parse(source("../locales/zh/menus.json")).sizeSelect;
const enMenus = JSON.parse(source("../locales/en/menus.json")).sizeSelect;

test("scale_method offers exactly Crop, Fit and Scale", () => {
    const v1 = sizeSelectPy.match(/"scale_method":\s*\(\[([^\]]+)\]/);
    assert.ok(v1, "V1 scale_method not found");
    assert.equal(v1[1].replace(/["'\s]/g, ""), "Crop,Fit,Scale");

    const v3 = sizeSelectPy.match(/_io\.Combo\.Input\("scale_method",\s*options=\[([^\]]+)\]/);
    assert.ok(v3, "V3 scale_method not found");
    assert.equal(v3[1].replace(/["'\s]/g, ""), "Crop,Fit,Scale");
});

test("fit_edge is declared on both schemas and defaults to Long", () => {
    const v1 = sizeSelectPy.match(/"fit_edge":\s*\(\[([^\]]+)\][^)]*"advanced":\s*True[^)]*\),/);
    assert.ok(v1, "V1 fit_edge must be advanced (Fit 专属，不该占默认视野)");
    assert.equal(v1[1].replace(/["'\s]/g, ""), "Long,Short");
    assert.match(v1[0], /"default":\s*"Long"/);

    const v3 = sizeSelectPy.match(/_io\.Combo\.Input\("fit_edge",\s*options=\[([^\]]+)\][\s\S]*?\),/);
    assert.ok(v3, "V3 fit_edge not found");
    assert.equal(v3[1].replace(/["'\s]/g, ""), "Long,Short");
    assert.match(v3[0], /default="Long"/);
});

test("fit_edge participates in caching and execution fingerprints", () => {
    // 换长边/短边必须让节点重新执行：IS_CHANGED / V3 fingerprint 都要带上它
    // （IS_CHANGED 是类里最后一个方法，终止条件取模块级的 NODE_CLASS_MAPPINGS）
    const isChanged = sizeSelectPy.match(/def IS_CHANGED\([\s\S]*?\nNODE_CLASS_MAPPINGS/);
    assert.ok(isChanged, "IS_CHANGED not found");
    assert.match(isChanged[0], /fit_edge/);

    const fingerprint = sizeSelectPy.match(/def fingerprint_inputs\([\s\S]*?(?=\n {8}def )/);
    assert.ok(fingerprint, "fingerprint_inputs not found");
    assert.match(fingerprint[0], /fit_edge/);
});

test("the fit scale keeps the aspect ratio: contain vs cover", () => {
    const fn = sizeSelectPy.match(/def _fit_scale\([\s\S]*?(?=\ndef )/);
    assert.ok(fn, "_fit_scale not found");
    // Long = contain：整图装进目标框，取两个方向里更小的系数
    assert.match(fn[0], /return min\(target_w \/ src_w, target_h \/ src_h\)/);
    // Short = 短边贴齐：短边填满目标，长边按比例超出（不裁剪）
    assert.match(fn[0], /return min\(target_w, target_h\) \/ min\(src_w, src_h\)/);
    // 除零 / 负数保护：没有基准时退化为 1.0，而不是抛异常或产出 0 尺寸
    assert.match(fn[0], /return 1\.0/);
});

test("fit only applies when there is a source to fit", () => {
    // 没有 image / latent 就没有基准，退化为直接用目标尺寸（与 Crop 同结果）
    assert.match(sizeSelectPy, /elif scale_method == "Fit" and \(has_image or has_latent\):/);
    // 装了目标框之后仍然要走同一个网格：Fit 出来的尺寸同样必须能被压缩率整除
    const branch = sizeSelectPy.match(/elif scale_method == "Fit" and \(has_image or has_latent\):[\s\S]*?(?=\n {8}else:)/);
    assert.ok(branch, "Fit branch body not found");
    const uses = branch[0].match(/_align_grid\(/g) ?? [];
    assert.ok(uses.length >= 2, `Fit 的宽高都要过 _align_grid：实际 ${uses.length} 次`);
});

test("fit never crops the source image", () => {
    // Crop 才需要裁剪；Fit 是等比缩放，倍率由目标框算出来而已
    const resize = sizeSelectPy.match(/def _resize_image_and_mask\([\s\S]*?(?=\n {4}def )/);
    assert.ok(resize, "_resize_image_and_mask not found");
    assert.match(resize[0], /use_crop = scale_method == "Crop"/);
    assert.match(resize[0], /# Fit 也是等比缩放/);
});

test("the front end solves fit with the same formula as the backend", () => {
    const fn = sizeSelectJs.match(/function _ssFitScale\([\s\S]*?\n {8}\}/);
    assert.ok(fn, "_ssFitScale not found");
    assert.match(fn[0], /Math\.min\(tw \/ sw, th \/ sh\)/);
    assert.match(fn[0], /Math\.min\(tw, th\) \/ Math\.min\(sw, sh\)/);
    // 预览也要过同一套 round + 网格，否则对齐后的显示值会和执行结果差一个步长
    assert.match(sizeSelectJs, /const s = _ssFitScale\(src\[0\], src\[1\], tw, th, _ssFitEdge\(\)\);/);
    assert.match(sizeSelectJs, /w = scaleAlign\(src\[0\] \* s, step\);/);
    assert.match(sizeSelectJs, /h = scaleAlign\(src\[1\] \* s, step\);/);
});

test("the method row exposes three mutually exclusive buttons", () => {
    // 三枚按钮互斥：同一时刻只有一枚 active，否则用户看不出当前是哪种方式
    assert.match(sizeSelectJs, /const _ssMethod = \(\) => \(scmW\?\.value === "Scale" \|\| scmW\?\.value === "Fit"\) \? scmW\.value : "Crop";/);
    assert.match(sizeSelectJs, /btnCrop\.classList\.toggle\("active", m === "Crop"\);/);
    assert.match(sizeSelectJs, /btnFit\.classList\.toggle\("active", m === "Fit"\);/);
    assert.match(sizeSelectJs, /btnScale\.classList\.toggle\("active", m === "Scale"\);/);
    assert.match(sizeSelectJs, /controlRow\.append\(btnAuto, btnMan, btnCrop, btnFit, btnScale\);/);
});

test("the fit edge switch reuses the slider row instead of adding a row", () => {
    // 复用同一行：高度是 getFixedHeight() 的分档定值（Fit/Scale 比 Crop 高一档，
    // 因为那一行 32px），但绝不新增一行——为适配边单开一行就得改高度签名与 onConfigure。
    assert.match(sizeSelectJs, /fitEdgeGroup\.style\.display = isFit \? "flex" : "none";/);
    // 滑条与适配边按钮互斥：Fit 下既不能拖滑条也不能被滚轮改倍数
    assert.match(sizeSelectJs, /if \(_ssMethod\(\) === "Fit"\) return;\s+\/\/ Fit 模式这一行是适配边按钮，不是滑条/);
    assert.match(sizeSelectJs, /if \(_ssMethod\(\) === "Fit"\) return;\s+\/\/ Fit 模式滚轮不该改缩放倍数/);
    // CSS 默认收起，只由 JS 在 Fit 模式下显示
    const rule = css.match(/\.ss-fit-edge-group \{[\s\S]*?\}/);
    assert.ok(rule, ".ss-fit-edge-group rule not found");
    assert.match(rule[0], /display: none/);
    assert.match(rule[0], /gap: var\(--ws-ss-control-gap\)/);
});

test("the node height drops a tier when the second row folds away", () => {
    // 用户反馈「节点底部始终多余一行空白」：ComfyUI 把 DOM widget 拉伸占满节点扣除
    // 标题/端口/组合控件后的全部剩余空间（实测该固定占用恒为 174px），wrap 又是
    // height:100% 的弹性列 ⇒ 定高一旦高于内容自然高度，底部就空出一条。
    // 内容自然高度实测：预设 239（第二行收起）/ 271（显示）；自定义 163 / 195，
    // 第二行本身高 24px + 8px 上间距 = 32px。故高度必须分四档，档差恰为 32。
    const fn = sizeSelectJs.match(/function _ssSecondRowShown\(method\) \{[\s\S]*?\n\}/);
    assert.ok(fn, "_ssSecondRowShown not found");
    assert.match(fn[0], /return method === "Scale" \|\| method === "Fit";/);

    const tiers = sizeSelectJs.match(
        /return manual \? \(secondRow \? (\d+) : (\d+)\) : \(secondRow \? (\d+) : (\d+)\);/
    );
    assert.ok(tiers, "getFixedHeight 必须按 (manual, secondRow) 分四档");
    const [manShown, manHidden, preShown, preHidden] = tiers.slice(1).map(Number);
    // 各档 = 174（固定占用）+ 内容自然高 + 4px 余量
    assert.equal(preHidden, 174 + 239 + 4, "预设·收起档应贴内容自然高");
    assert.equal(preShown, 174 + 271 + 4, "预设·显示档应贴内容自然高");
    assert.equal(manHidden, 174 + 163 + 4, "自定义·收起档应贴内容自然高");
    assert.equal(manShown, 174 + 195 + 4, "自定义·显示档应贴内容自然高");
    // 两档之差必须正好是第二行的高度，否则要么留空白要么裁内容
    assert.equal(preShown - preHidden, 32, "第二行 24px + 8px 上间距");
    assert.equal(manShown - manHidden, 32, "第二行 24px + 8px 上间距");

    // 切缩放方式会改变第二行的有无 ⇒ 必须立刻重算节点高度，不能等下一次模式切换
    assert.match(sizeSelectJs, /_ssSetSliderLock\(m\);\s*\n\s*\/\/ 第二行的出现\/收起直接改变内容自然高度 ⇒ 节点高度跟着换档，底部不留空行\s*\n\s*updateNodeHeight\(\);/);
    // 读档时也要按存盘里的 scale_method 选档（serialize 顺序里它是第 2 个值）
    assert.match(sizeSelectJs, /node\.size\[1\] = getFixedHeight\(isMan, _ssSecondRowShown\(info\.widgets_values\[1\]\)\);/);
});

test("the second row only shows up in the modes that use it", () => {
    // Crop 下既没有滑条也没有适配边 ⇒ 整行收起，不留一个压灰的空药丸白占地方；
    // Fit 下行是活的（按钮可点），更不能被 .4 压成禁用相。
    assert.match(sizeSelectJs, /sliderRow\.classList\.toggle\("ss-hidden", !isScale && !isFit\);/);
    // 折叠后 ss-disabled 已不可达：JS 切换与 CSS 规则都必须删掉，不许留死样式
    assert.ok(!/ss-disabled/.test(sizeSelectJs), "ss-disabled 已不可达，JS 不应再切换它");
    assert.ok(!/ss-disabled/.test(css), ".ss-disabled 的 CSS 规则必须一并删除");
});

test("fit_edge is serialized so the choice survives save and load", () => {
    // V1 签名顺序：Manual_Mode, scale_method, scale_multiplier, Resolution,
    // Aspect_Ratio, Custom_Width, Custom_Height, align_multiple, fit_edge
    const tuple = sizeSelectPy.match(/return \(Manual_Mode, scale_method, scale_multiplier, Resolution,\s+Aspect_Ratio,\s*\n\s*Custom_Width, Custom_Height, align_multiple, fit_edge\)/);
    assert.ok(tuple, "V1 calculate_size 返回值必须以 fit_edge 结尾");
    // 前端 serialize 的顺序必须与之一一对应，错位会让所有 widget 的值串味
    assert.match(sizeSelectJs, /const coreWidgets = \[manW, scmW, sclW, resW, aspW, cusW, cusH, almW, fedW\]/);
});

test("fit has its own i18n keys in both languages", () => {
    for (const [name, menus] of [["zh", zhMenus], ["en", enMenus]]) {
        for (const key of ["fit", "tipFit", "fitEdge", "fitLong", "fitShort", "tipFitLong", "tipFitShort", "tipFitEdge"]) {
            assert.ok(menus[key], `${name} menus 缺少 sizeSelect.${key}`);
        }
    }
    // 每个新增键都必须被代码消费，否则 i18n 反向检查会判死键
    for (const key of ["fit", "tipFit", "fitEdge", "fitLong", "fitShort", "tipFitLong", "tipFitShort", "tipFitEdge"]) {
        assert.match(sizeSelectJs, new RegExp(`sizeSelect\\.${key}\\b`), `sizeSelect.${key} 在前端没有被引用`);
    }
});
