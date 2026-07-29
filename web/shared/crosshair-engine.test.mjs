// crosshair-engine 纯函数单测（node:test）
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeGuides } from './crosshair-engine.js';

const B = (x, y, w, h) => ({ x, y, w, h });

// 静止参照节点：左缘 x=100，顶 y=100，宽高 80x40 → 左100/中140/右180；上100/中120/下140
const others = [B(100, 100, 80, 40)];

test('v: 左缘对齐线 x=100', () => {
    const g = computeGuides(B(103, 300, 80, 40), others, 8);
    assert.ok(g.vLines.includes(100));
    assert.strictEqual(g.snapDX, -3);
    assert.ok(g.hLines.length === 0 && g.snapDY === 0);
});

test('h: 顶对齐线 y=100', () => {
    const g = computeGuides(B(400, 95, 80, 40), others, 8);
    assert.ok(g.hLines.includes(100));
    assert.strictEqual(g.snapDY, 5);
});

test('v: 中心对齐线 x=140', () => {
    const g = computeGuides(B(101, 300, 80, 40), others, 8);
    assert.ok(g.vLines.includes(140));
    assert.ok(Math.abs(g.snapDX - (-1)) < 1e-9);
});

test('超阈值无吸附', () => {
    const g = computeGuides(B(130, 300, 80, 40), others, 8);
    assert.ok(g.vLines.length === 0 && g.snapDX === 0);
});

test('多锚点取最近(左缘 -6)', () => {
    const g = computeGuides(B(106, 300, 80, 40), others, 8);
    assert.strictEqual(g.snapDX, -6);
});

test('null drag 安全', () => {
    assert.strictEqual(computeGuides(null, others).vLines.length, 0);
});

test('空 others 安全', () => {
    assert.strictEqual(computeGuides(B(0, 0, 10, 10), []).vLines.length, 0);
});
