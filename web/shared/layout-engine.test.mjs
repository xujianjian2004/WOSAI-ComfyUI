// layout-engine 纯函数单测（node:test）
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeLayout } from './layout-engine.js';

const N = (id, w = 100, h = 60) => ({ id, w, h });

// ── 线性链 A→B→C：三列，x 递增，单父对齐 → 同 Y ──
test('链:x 列递增 (100+80)', () => {
    const nodes = [N('A'), N('B'), N('C')];
    const links = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }];
    const { positions } = computeLayout(nodes, links, { anchorX: 0, startY: 0, hGap: 80, vGap: 40 });
    assert.ok(positions.A[0] === 0 && positions.B[0] === 180 && positions.C[0] === 360);
});

test('链:单父对齐同 Y', () => {
    const nodes = [N('A'), N('B'), N('C')];
    const links = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }];
    const { positions } = computeLayout(nodes, links, { anchorX: 0, startY: 0, hGap: 80, vGap: 40 });
    assert.ok(positions.A[1] === 0 && positions.B[1] === 0 && positions.C[1] === 0);
});

test('链:总宽 = C.x(360)+C.w(100) = 460', () => {
    const nodes = [N('A'), N('B'), N('C')];
    const links = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }];
    const { width } = computeLayout(nodes, links, { anchorX: 0, startY: 0, hGap: 80, vGap: 40 });
    assert.strictEqual(width, 460);
});

// ── 同列堆叠：两个源 A,B 无连线 → 同列纵向堆叠 ──
test('无连线:各孤岛锚点 x 相同', () => {
    const nodes = [N('A', 100, 60), N('B', 100, 60)];
    const { positions } = computeLayout(nodes, [], { startY: 0, vGap: 40 });
    assert.strictEqual(positions.A[0], positions.B[0]);
});

test('两孤岛纵向堆放 60+islandGap60=120', () => {
    const nodes = [N('A', 100, 60), N('B', 100, 60)];
    const { positions } = computeLayout(nodes, [], { startY: 0, vGap: 40, islandGap: 60 });
    const ys = [positions.A[1], positions.B[1]].sort((a, b) => a - b);
    assert.ok(ys[0] === 0 && ys[1] === 120);
});

// ── 孤岛分组：两条独立链 A→B 与 C→D 应分两块纵向堆放(不混列) ──
test('岛1: A→B 两列', () => {
    const nodes = [N('A'), N('B'), N('C'), N('D')];
    const links = [{ from: 'A', to: 'B' }, { from: 'C', to: 'D' }];
    const { positions } = computeLayout(nodes, links, { hGap: 80, vGap: 40, islandGap: 60 });
    assert.ok(positions.A[0] === 0 && positions.B[0] === 180);
});

test('岛2: C→D 两列(各自从锚点起)', () => {
    const nodes = [N('A'), N('B'), N('C'), N('D')];
    const links = [{ from: 'A', to: 'B' }, { from: 'C', to: 'D' }];
    const { positions } = computeLayout(nodes, links, { hGap: 80, vGap: 40, islandGap: 60 });
    assert.ok(positions.C[0] === 0 && positions.D[0] === 180);
});

test('两岛纵向错开不重叠', () => {
    const nodes = [N('A'), N('B'), N('C'), N('D')];
    const links = [{ from: 'A', to: 'B' }, { from: 'C', to: 'D' }];
    const { positions } = computeLayout(nodes, links, { hGap: 80, vGap: 40, islandGap: 60 });
    const top1 = Math.min(positions.A[1], positions.B[1]);
    const top2 = Math.min(positions.C[1], positions.D[1]);
    assert.ok(top1 !== top2);
});

// ── 逆向 reverse：链 A→B→C 翻转列深，C 在最左、A 在最右 ──
test('reverse: 终点 C 在最左', () => {
    const nodes = [N('A'), N('B'), N('C')];
    const links = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }];
    const { positions } = computeLayout(nodes, links, { reverse: true, hGap: 80 });
    assert.ok(positions.C[0] < positions.B[0] && positions.B[0] < positions.A[0]);
});

// ── 菱形 A→B,A→C,B→D,C→D：B/C 同列堆叠；D 在第2列(双父→游标) ──
test('菱形:三列布局', () => {
    const nodes = [N('A'), N('B'), N('C'), N('D')];
    const links = [
        { from: 'A', to: 'B' }, { from: 'A', to: 'C' },
        { from: 'B', to: 'D' }, { from: 'C', to: 'D' },
    ];
    const { positions } = computeLayout(nodes, links, { hGap: 80, vGap: 40, startY: 0 });
    assert.ok(positions.A[0] < positions.B[0] && positions.B[0] === positions.C[0] && positions.C[0] < positions.D[0]);
});

test('菱形:B/C 同列不重叠', () => {
    const nodes = [N('A'), N('B'), N('C'), N('D')];
    const links = [
        { from: 'A', to: 'B' }, { from: 'A', to: 'C' },
        { from: 'B', to: 'D' }, { from: 'C', to: 'D' },
    ];
    const { positions } = computeLayout(nodes, links, { hGap: 80, vGap: 40, startY: 0 });
    assert.ok(positions.B[1] !== positions.C[1]);
});

// D 双父，y=游标=startY=0（D 是该列唯一节点）
test('菱形:D 双父落在列首', () => {
    const nodes = [N('A'), N('B'), N('C'), N('D')];
    const links = [
        { from: 'A', to: 'B' }, { from: 'A', to: 'C' },
        { from: 'B', to: 'D' }, { from: 'C', to: 'D' },
    ];
    const { positions } = computeLayout(nodes, links, { hGap: 80, vGap: 40, startY: 0 });
    assert.strictEqual(positions.D[1], 0);
});

// ── 环 A→B→A：不死循环，深度有界，全部有坐标 ──
test('环:正常返回坐标(不死循环)', () => {
    const nodes = [N('A'), N('B')];
    const links = [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }];
    const { positions } = computeLayout(nodes, links);
    assert.ok(positions.A && positions.B);
});

// ── 自环/无效连线被忽略 ──
test('自环/悬空连线被忽略', () => {
    const nodes = [N('A')];
    const links = [{ from: 'A', to: 'A' }, { from: 'A', to: 'X' }, null];
    const { positions } = computeLayout(nodes, links);
    assert.ok(positions.A[0] === 0 && positions.A[1] === 0);
});

// ── anchorX/startY 偏移生效 ──
test('锚点偏移生效', () => {
    const nodes = [N('A')];
    const { positions } = computeLayout(nodes, [], { anchorX: 500, startY: 300 });
    assert.ok(positions.A[0] === 500 && positions.A[1] === 300);
});

// ── 列宽取该列最大宽度 ──
test('列宽取最大(200)+gap80=280', () => {
    const nodes = [N('A', 200, 60), N('B', 50, 60), N('C', 100, 60)];
    const links = [{ from: 'A', to: 'C' }, { from: 'B', to: 'C' }]; // A,B 同列(都源)，C 第2列
    const { positions } = computeLayout(nodes, links, { hGap: 80 });
    assert.strictEqual(positions.C[0], 280); // A 宽200 决定列宽
});

// ── 边界 ──
test('空节点返回空', () => {
    assert.strictEqual(Object.keys(computeLayout([], []).positions).length, 0);
});

test('null 安全', () => {
    assert.strictEqual(computeLayout(null).width, 0);
});

// ── 入参不可变 ──
test('入参不可变', () => {
    const nodes = [N('A'), N('B')];
    const links = [{ from: 'A', to: 'B' }];
    const snap = JSON.stringify({ nodes, links });
    computeLayout(nodes, links);
    assert.strictEqual(JSON.stringify({ nodes, links }), snap);
});
