// link-engine 纯函数单测（node:test）
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planLinks } from './link-engine.js';

// 节点工厂：outs/ins 为类型数组；linkedIns = 已连输入下标集合
const N = (id, x, outs, ins, linkedIns = []) => ({
    id, x, y: 0,
    outputs: outs.map(t => ({ type: t })),
    inputs: ins.map((t, i) => ({ type: t, linked: linkedIns.includes(i) })),
});

test('chain: 2 条', () => {
    const a = N('A', 0, ['IMAGE'], []);
    const b = N('B', 100, ['LATENT'], ['IMAGE']);
    const c = N('C', 200, [], ['LATENT']);
    const r = planLinks([c, a, b], 'chain');   // 乱序传入，引擎按 x 排序
    assert.strictEqual(r.length, 2);
});

test('chain A→B', () => {
    const a = N('A', 0, ['IMAGE'], []);
    const b = N('B', 100, ['LATENT'], ['IMAGE']);
    const c = N('C', 200, [], ['LATENT']);
    const r = planLinks([c, a, b], 'chain');
    assert.ok(r[0].from === 'A' && r[0].to === 'B' && r[0].toSlot === 0);
});

test('chain B→C', () => {
    const a = N('A', 0, ['IMAGE'], []);
    const b = N('B', 100, ['LATENT'], ['IMAGE']);
    const c = N('C', 200, [], ['LATENT']);
    const r = planLinks([c, a, b], 'chain');
    assert.ok(r[1].from === 'B' && r[1].to === 'C');
});

// 多对一 gather：S1,S2(IMAGE out) → T(两个 IMAGE in)，最右为 T
test('gather: 2 条', () => {
    const s1 = N('S1', 0, ['IMAGE'], []);
    const s2 = N('S2', 50, ['IMAGE'], []);
    const t = N('T', 200, [], ['IMAGE', 'IMAGE']);
    const r = planLinks([s1, s2, t], 'gather');
    assert.strictEqual(r.length, 2);
});

test('gather: 都连到 T', () => {
    const s1 = N('S1', 0, ['IMAGE'], []);
    const s2 = N('S2', 50, ['IMAGE'], []);
    const t = N('T', 200, [], ['IMAGE', 'IMAGE']);
    const r = planLinks([s1, s2, t], 'gather');
    assert.ok(r.every(l => l.to === 'T'));
});

test('gather: 占用不同输入槽', () => {
    const s1 = N('S1', 0, ['IMAGE'], []);
    const s2 = N('S2', 50, ['IMAGE'], []);
    const t = N('T', 200, [], ['IMAGE', 'IMAGE']);
    const r = planLinks([s1, s2, t], 'gather');
    assert.notStrictEqual(r[0].toSlot, r[1].toSlot);
});

// 一对多 broadcast：S(IMAGE out) → T1,T2(IMAGE in)
test('broadcast: S 连两目标', () => {
    const s = N('S', 0, ['IMAGE'], []);
    const t1 = N('T1', 100, [], ['IMAGE']);
    const t2 = N('T2', 200, [], ['IMAGE']);
    const r = planLinks([s, t1, t2], 'broadcast');
    assert.ok(r.length === 2 && r.every(l => l.from === 'S'));
});

// 类型不兼容不连
test('不兼容类型不连', () => {
    const a = N('A', 0, ['IMAGE'], []);
    const b = N('B', 100, [], ['LATENT']);
    assert.strictEqual(planLinks([a, b], 'chain').length, 0);
});

// 通配 *
test('* 通配可连', () => {
    const a = N('A', 0, ['IMAGE'], []);
    const b = N('B', 100, [], ['*']);
    assert.strictEqual(planLinks([a, b], 'chain').length, 1);
});

// 非 force 跳过已连输入；force 可占用
test('非force跳过已连输入', () => {
    const a = N('A', 0, ['IMAGE'], []);
    const b = N('B', 100, [], ['IMAGE'], [0]);   // 输入0 已连
    assert.strictEqual(planLinks([a, b], 'chain').length, 0);
});

test('force可覆盖', () => {
    const a = N('A', 0, ['IMAGE'], []);
    const b = N('B', 100, [], ['IMAGE'], [0]);
    assert.strictEqual(planLinks([a, b], 'chain', { force: true }).length, 1);
});

// 边界
test('<2 返回 []', () => {
    assert.strictEqual(planLinks([N('A', 0, ['IMAGE'], [])]).length, 0);
});

test('未知模式 []', () => {
    assert.strictEqual(planLinks([N('A', 0, ['IMAGE'], []), N('B', 1, [], ['IMAGE'])], 'nope').length, 0);
});
