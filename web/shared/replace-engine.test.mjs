// Migrated to node:test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchSlots } from './replace-engine.js';

const S = (name, type) => ({ name, type });

// 名称优先（忽略大小写）
{
    const m = matchSlots([S('image', 'IMAGE'), S('mask', 'MASK')], [S('Mask', 'MASK'), S('Image', 'IMAGE')]);
    test('名称匹配(忽略大小写)', () => { assert.ok(m.get(0) === 1 && m.get(1) === 0); });
}
// 名称同但类型不兼容 → 不按名称匹配，落到类型唯一
{
    const m = matchSlots([S('x', 'IMAGE')], [S('x', 'LATENT'), S('y', 'IMAGE')]);
    test('名同类不符 → 退化为类型唯一(IMAGE→槽1)', () => { assert.strictEqual(m.get(0), 1); });
}
// 类型唯一匹配
{
    const m = matchSlots([S('a', 'LATENT')], [S('z', 'LATENT')]);
    test('类型唯一匹配', () => { assert.strictEqual(m.get(0), 0); });
}
// 类型有歧义(2 个同类型) → 不匹配
{
    const m = matchSlots([S('a', 'IMAGE')], [S('p', 'IMAGE'), S('q', 'IMAGE')]);
    test('类型歧义不匹配', () => { assert.ok(!m.has(0)); });
}
// 通配 *
{
    const m = matchSlots([S('in', '*')], [S('in', 'IMAGE')]);
    test('* 通配按名称匹配', () => { assert.strictEqual(m.get(0), 0); });
}
// 不重复占用
{
    const m = matchSlots([S('a', 'IMAGE'), S('b', 'IMAGE')], [S('a', 'IMAGE')]);
    test('新槽不被重复占用', () => {
        assert.strictEqual(m.get(0), 0);
        assert.strictEqual(m.has(1), false);
    });
}
// 边界
test('空', () => { assert.strictEqual(matchSlots([], []).size, 0); });
test('null 安全', () => { assert.strictEqual(matchSlots(null, []).size, 0); });
