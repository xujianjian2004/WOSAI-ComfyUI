// search-engine 纯函数单测（node:test）
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { match } from './search-engine.js';

const nodes = [
    { id: 9, title: 'KSampler', type: 'KSampler', widgets: [{ name: 'steps', value: 20 }, { name: 'cfg', value: 8 }] },
    { id: 24, title: '尺寸选择', type: 'WOSAI_SizeSelect', widgets: [{ name: 'Custom_Width', value: 512 }], properties: { ver: '1.0' } },
    { id: 31, title: '万能滑条', type: 'WOSAI_OmniSlider', widgets: [{ name: 'active_value', value: 0.5 }] },
    { id: 27, title: 'Empty Latent', type: 'EmptyLatentImage', widgets: [{ name: 'width', value: 512 }] },
];

// normal: 标题/类型包含
test('normal: 标题不区分大小写', () => {
    const r = match(nodes, 'sampler');
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].id, 9);
});

test('normal: 类型前缀命中 2 个', () => {
    const r = match(nodes, 'WOSAI');
    assert.strictEqual(r.length, 2);
});

// id 搜索
test('id 字段命中', () => {
    const r = match(nodes, '24', { fields: ['id'] });
    assert.strictEqual(r.length, 1);
});

// widget value 搜索(找含 512 的节点)
test('widgetValue: 512 命中两节点', () => {
    const r = match(nodes, '512', { fields: ['widgetValue'] });
    assert.ok(r.length === 2 && r.map(n => n.id).sort((a, b) => a - b).join() === '24,27');
});

// widget name
test('widgetName: cfg', () => {
    const r = match(nodes, 'cfg', { fields: ['widgetName'] });
    assert.strictEqual(r.length, 1);
});

// property
test('property: ver=1.0', () => {
    const r = match(nodes, '1.0', { fields: ['property'] });
    assert.strictEqual(r.length, 1);
});

// 中文标题
test('中文标题命中', () => {
    const r = match(nodes, '滑条');
    assert.ok(r.length === 1 && r[0].id === 31);
});

// wildcard
test('wildcard: Empty*', () => {
    const r = match(nodes, 'Empty*', { mode: 'wildcard' });
    assert.strictEqual(r.length, 1);
});

test('wildcard: 类型通配', () => {
    const r = match(nodes, 'WOSAI_*Slider', { mode: 'wildcard', fields: ['type'] });
    assert.strictEqual(r.length, 1);
});

// regex
test('regex: ^K', () => {
    const r = match(nodes, '^K', { mode: 'regex' });
    assert.strictEqual(r.length, 1);
});

test('regex: 非法表达式返回 []', () => {
    const r = match(nodes, '[', { mode: 'regex' });
    assert.strictEqual(r.length, 0);
});

// 边界
test('空查询返回 []', () => {
    assert.strictEqual(match(nodes, '').length, 0);
});

test('空节点返回 []', () => {
    assert.strictEqual(match([], 'x').length, 0);
});

// 字段限定:仅 title 时,WOSAI(类型前缀) 不命中
test('fields 限定 title 不搜类型', () => {
    assert.strictEqual(match(nodes, 'WOSAI', { fields: ['title'] }).length, 0);
});

// 入参不变
test('入参不可变', () => {
    const before = nodes.length;
    match(nodes, 'a');
    assert.strictEqual(nodes.length, before);
});
