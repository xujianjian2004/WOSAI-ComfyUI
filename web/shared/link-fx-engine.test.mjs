// link-fx-engine 纯函数单测（node:test）
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bezier, ctrlPoints, particleTs, routePoints, polyPointAt, LINK_MODES } from './link-fx-engine.js';

// ── bezier ──
test('bezier t=0 返回起点', () => {
    const p = bezier([0, 0], [1, 0], [2, 0], [3, 0], 0);
    assert.strictEqual(p[0], 0);
    assert.strictEqual(p[1], 0);
});

test('bezier t=1 返回终点', () => {
    const p = bezier([0, 0], [1, 0], [2, 0], [3, 0], 1);
    assert.strictEqual(p[0], 3);
    assert.strictEqual(p[1], 0);
});

test('bezier t=0.5 在中间', () => {
    const p = bezier([0, 0], [1, 0], [2, 0], [3, 0], 0.5);
    assert.strictEqual(p[0], 1.5);
    assert.strictEqual(p[1], 0);
});

// ── ctrlPoints ──
test('ctrlPoints 返回两个控制点', () => {
    const cp = ctrlPoints([0, 0], [100, 0]);
    assert.strictEqual(cp.length, 2);
});

test('ctrlPoints 控制点1 x > 起点', () => {
    const cp = ctrlPoints([0, 0], [100, 0]);
    assert.ok(cp[0][0] > 0);
});

test('ctrlPoints 控制点2 x < 终点', () => {
    const cp = ctrlPoints([0, 0], [100, 0]);
    assert.ok(cp[1][0] < 100);
});

// ── particleTs ──
test('particleTs 返回 count 个值', () => {
    const ts = particleTs(3, 0);
    assert.strictEqual(ts.length, 3);
});

test('particleTs 值在 [0,1)', () => {
    const ts = particleTs(3, 0);
    assert.ok(ts.every(t => t >= 0 && t < 1));
});

test('particleTs phase 偏移正确', () => {
    const ts = particleTs(3, 0.5);
    assert.strictEqual(ts[0], 0.5);
});

test('particleTs 环绕推进', () => {
    const ts = particleTs(3, 0.5);
    assert.ok(Math.abs(ts[1] - ((0.5 + 1 / 3) % 1)) < 0.001);
});

test('particleTs count<1 返回1个', () => {
    assert.strictEqual(particleTs(0, 0).length, 1);
});

// ── routePoints ──
test('routePoints default 返回 null', () => {
    assert.strictEqual(routePoints([0, 0], [100, 100]), null);
});

test('routePoints straight 返回2点', () => {
    const pts = routePoints([0, 0], [100, 100], 'straight');
    assert.strictEqual(pts.length, 2);
});

test('routePoints straight 起点正确', () => {
    const pts = routePoints([0, 0], [100, 100], 'straight');
    assert.strictEqual(pts[0][0], 0);
    assert.strictEqual(pts[0][1], 0);
});

test('routePoints ortho 返回4点', () => {
    const pts = routePoints([0, 0], [100, 100], 'ortho');
    assert.strictEqual(pts.length, 4);
});

test('routePoints wave 返回多点', () => {
    const pts = routePoints([0, 0], [100, 100], 'wave');
    assert.ok(pts.length > 2);
});

// ── polyPointAt ──
test('polyPointAt 空路径返回 [0,0]', () => {
    const p = polyPointAt(null, 0.5);
    assert.strictEqual(p[0], 0);
    assert.strictEqual(p[1], 0);
});

test('polyPointAt 短路径返回起点', () => {
    const p = polyPointAt([[5, 5]], 0.5);
    assert.strictEqual(p[0], 5);
});

test('polyPointAt t=0 返回起点', () => {
    const p = polyPointAt([[0, 0], [100, 0], [100, 100]], 0);
    assert.strictEqual(p[0], 0);
});

test('polyPointAt t=1 返回终点', () => {
    const p = polyPointAt([[0, 0], [100, 0], [100, 100]], 1);
    assert.strictEqual(p[0], 100);
    assert.strictEqual(p[1], 100);
});

test('polyPointAt t=0.5 在中间', () => {
    const p = polyPointAt([[0, 0], [100, 0], [100, 100]], 0.5);
    assert.strictEqual(p[0], 100);
    assert.strictEqual(p[1], 0);
});

test('polyPointAt t 越界 clamp', () => {
    const pts = [[0, 0], [100, 0], [100, 100]];
    assert.strictEqual(polyPointAt(pts, -1)[0], 0);
    assert.strictEqual(polyPointAt(pts, 2)[1], 100);
});

// ── LINK_MODES ──
test('LINK_MODES 与当前渲染器支持的四种模式一致', () => {
    assert.deepStrictEqual(LINK_MODES, ['particle', 'dashed', 'image', 'text']);
});
