// align-engine 纯函数单测（node:test）
// 覆盖：bbox、6 基础对齐、等间距分布、复合、入参不可变、边界(<2/错误命令)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compute, bbox, resize, stretch } from './align-engine.js';

const A = (x, y, w, h, id) => ({ id, x, y, w, h });

const boxes = [A(0, 0, 100, 40, 1), A(200, 50, 60, 40, 2), A(120, 120, 80, 40, 3)];

test('bbox 边界', () => {
    const b = bbox(boxes);
    assert.ok(b.minX === 0 && b.maxX === 260 && b.minY === 0 && b.maxY === 160);
});

test('left: x=minX', () => {
    const r = compute(boxes, 'left');
    assert.ok(r.every(n => n.x === 0));
});

test('right: 右缘=maxX', () => {
    const r = compute(boxes, 'right');
    assert.ok(r.every(n => n.x + n.w === 260));
});

test('top: y=minY', () => {
    const r = compute(boxes, 'top');
    assert.ok(r.every(n => n.y === 0));
});

test('bottom: 底缘=maxY', () => {
    const r = compute(boxes, 'bottom');
    assert.ok(r.every(n => n.y + n.h === 160));
});

test('h_center: 中心对齐', () => {
    const r = compute(boxes, 'h_center');
    const cx = r.map(n => n.x + n.w / 2);
    assert.ok(cx.every(v => Math.abs(v - cx[0]) < 1e-9));
});

test('v_center: 中心对齐', () => {
    const r = compute(boxes, 'v_center');
    const cy = r.map(n => n.y + n.h / 2);
    assert.ok(cy.every(v => Math.abs(v - cy[0]) < 1e-9));
});

test('dist_h: 起点=minX', () => {
    const r = compute(boxes, 'dist_h').slice().sort((a, c) => a.x - c.x);
    assert.ok(Math.abs(r[0].x) < 1e-9);
});

test('dist_h: 终点右缘=maxX', () => {
    const r = compute(boxes, 'dist_h').slice().sort((a, c) => a.x - c.x);
    assert.ok(Math.abs((r[2].x + r[2].w) - 260) < 1e-9);
});

test('dist_h: 等 gap', () => {
    const r = compute(boxes, 'dist_h').slice().sort((a, c) => a.x - c.x);
    assert.ok(Math.abs((r[1].x - (r[0].x + r[0].w)) - (r[2].x - (r[1].x + r[1].w))) < 1e-9);
});

test('dist_h+top: y=minY', () => {
    const r = compute(boxes, 'dist_h+top');
    assert.ok(r.every(n => n.y === 0));
});

test('dist_h+top: x 已分布', () => {
    const sx = compute(boxes, 'dist_h+top').slice().sort((a, c) => a.x - c.x);
    assert.ok(Math.abs(sx[0].x) < 1e-9 && Math.abs((sx[2].x + sx[2].w) - 260) < 1e-9);
});

test('dist_v+left: x=minX 且 y 已分布', () => {
    const sy = compute(boxes, 'dist_v+left').slice().sort((a, c) => a.y - c.y);
    assert.ok(sy.every(n => n.x === 0));
    assert.ok(Math.abs(sy[0].y) < 1e-9 && Math.abs((sy[2].y + sy[2].h) - 160) < 1e-9);
});

test('入参不可变', () => {
    compute(boxes, 'left');
    assert.ok(boxes[0].x === 0 && boxes[1].x === 200);
});

test('<2 节点返回 []', () => {
    assert.strictEqual(compute([A(0, 0, 1, 1)]).length, 0);
});

test('错误命令返回 []', () => {
    assert.strictEqual(compute(boxes, 'nope').length, 0);
});

// ── 尺寸统一 resize ──（boxes 宽:100/60/80 高:全 40）
test('eq_w(max): 宽都=最大100', () => {
    const z = resize(boxes, 'eq_w'); // base=max → 宽都=100
    assert.ok(z.every(n => n.w === 100));
});

test('eq_w: 高不变', () => {
    const z = resize(boxes, 'eq_w');
    assert.ok(z.every((n, i) => n.h === boxes[i].h));
});

test('eq_h(max): 高统一40 宽不变', () => {
    const z = resize(boxes, 'eq_h', { base: 'max' });
    assert.ok(z.every((n, i) => n.h === 40 && n.w === boxes[i].w));
});

test('eq_both(max): 宽100 高40', () => {
    const z = resize(boxes, 'eq_both');
    assert.ok(z.every(n => n.w === 100 && n.h === 40));
});

// anchor 基准：以索引1(宽60)为准
test('eq_w(anchor=1): 宽都=60', () => {
    const z = resize(boxes, 'eq_w', { base: 'anchor', anchorIndex: 1 });
    assert.ok(z.every(n => n.w === 60));
});

// anchor 缺省=最后一个(索引2 宽80)
test('eq_w(anchor 缺省=末个): 宽都=80', () => {
    const z = resize(boxes, 'eq_w', { base: 'anchor' });
    assert.ok(z.every(n => n.w === 80));
});

test('resize 入参不可变', () => {
    resize(boxes, 'eq_w');
    assert.ok(boxes[0].w === 100 && boxes[1].w === 60);
});

test('resize <2 返回 []', () => {
    assert.strictEqual(resize([A(0, 0, 10, 10)]).length, 0);
});

test('resize 返回副本', () => {
    const z = resize(boxes, 'eq_w');
    assert.notStrictEqual(z[0], boxes[0]);
});

// ── 单侧拉伸 stretch ──
test('stretch_left: 左缘=minX0', () => {
    const s = stretch(boxes, 'stretch_left');
    assert.ok(s.every(n => n.x === 0));
});

test('stretch_left: B 左缘0 宽=200+60', () => {
    const s = stretch(boxes, 'stretch_left');
    assert.ok(s[1].w === 260 && s[1].x === 0);
});

test('stretch_right: 右缘=maxX260', () => {
    const s = stretch(boxes, 'stretch_right');
    assert.ok(s.every(n => n.x + n.w === 260));
});

test('stretch_right: A 右缘260', () => {
    const s = stretch(boxes, 'stretch_right');
    assert.ok(s[0].x === 0 && s[0].w === 260);
});

test('stretch_top: 顶=minY0', () => {
    const s = stretch(boxes, 'stretch_top');
    assert.ok(s.every(n => n.y === 0));
});

test('stretch_top: C 顶0 高=120+40', () => {
    const s = stretch(boxes, 'stretch_top');
    assert.ok(s[2].h === 160 && s[2].y === 0);
});

test('stretch_bottom: 底=maxY160', () => {
    const s = stretch(boxes, 'stretch_bottom');
    assert.ok(s.every(n => n.y + n.h === 160));
});

test('stretch 入参不可变', () => {
    stretch(boxes, 'stretch_left');
    assert.ok(boxes[1].x === 200 && boxes[1].w === 60);
});

test('stretch <2 返回 []', () => {
    assert.strictEqual(stretch([A(0, 0, 10, 10)]).length, 0);
});

test('stretch 错误命令返回 []', () => {
    assert.strictEqual(stretch(boxes, 'nope').length, 0);
});
