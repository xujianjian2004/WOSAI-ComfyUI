// canvas-polyfill 单测（node:test）
// 验证无原生 roundRect 的 2D context 上 polyfill 能正确绘制路径。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundRect, supportsRoundRect } from './canvas-polyfill.js';

function makeFakeCtx() {
    return {
        _calls: [],
        beginPath() { this._calls.push('beginPath'); },
        moveTo(x, y) { this._calls.push({ op: 'moveTo', x, y }); },
        lineTo(x, y) { this._calls.push({ op: 'lineTo', x, y }); },
        arcTo(x1, y1, x2, y2, r) { this._calls.push({ op: 'arcTo', x1, y1, x2, y2, r }); },
        closePath() { this._calls.push('closePath'); },
        roundRect: undefined, // 模拟旧浏览器
    };
}

test('polyfill 在缺失 roundRect 时走 arcTo 路径', () => {
    const ctx = makeFakeCtx();
    roundRect(ctx, 0, 0, 100, 50, 8);
    assert.ok(ctx._calls.some(c => c.op === 'arcTo'), '使用了 arcTo');
    assert.ok(ctx._calls.some(c => c.op === 'lineTo'), '使用了 lineTo');
    assert.ok(ctx._calls.some(c => c === 'closePath'), '闭合路径');
});

test('polyfill 支持数组半径 [左上,右上,右下,左下]', () => {
    const ctx = makeFakeCtx();
    roundRect(ctx, 0, 0, 100, 50, [10, 0, 0, 10]);
    const arcs = ctx._calls.filter(c => c.op === 'arcTo');
    assert.equal(arcs.length, 2, '仅两个角有圆弧');
});

test('polyfill 半径不超过宽高一半', () => {
    const ctx = makeFakeCtx();
    roundRect(ctx, 0, 0, 20, 10, 100);
    const arcs = ctx._calls.filter(c => c.op === 'arcTo');
    for (const a of arcs) {
        assert.ok(a.r <= 5, `半径被限制在 5 以内: ${a.r}`);
    }
});

test('supportsRoundRect 返回 true', () => {
    assert.equal(supportsRoundRect(makeFakeCtx()), true);
});
