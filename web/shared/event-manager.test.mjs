// event-manager 生命周期单测（node:test）
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let eventLog = [];
let documentHandlers = {};

function makeDocument() {
    documentHandlers = {};
    return {
        addEventListener(type, handler) {
            (documentHandlers[type] ||= []).push(handler);
        },
        removeEventListener(type, handler) {
            const arr = documentHandlers[type] || [];
            const idx = arr.indexOf(handler);
            if (idx !== -1) arr.splice(idx, 1);
        },
    };
}

beforeEach(() => {
    eventLog = [];
    globalThis.document = makeDocument();
});

afterEach(async () => {
    const { destroy } = await import('./event-manager.js');
    destroy();
});

test('onGlobal / offGlobal 按名称注册与注销', async () => {
    const { onGlobal, offGlobal, activeCount } = await import('./event-manager.js');
    onGlobal('a', 'keydown', () => eventLog.push('a'));
    onGlobal('b', 'keydown', () => eventLog.push('b'));
    assert.equal(activeCount(), 2);
    offGlobal('a');
    assert.equal(activeCount(), 1);
});

test('命名空间批量注销', async () => {
    const { onGlobal, offGlobal, activeCount } = await import('./event-manager.js');
    onGlobal('p1', 'keydown', () => {}, 'panelA');
    onGlobal('p2', 'keyup', () => {}, 'panelA');
    onGlobal('o1', 'keydown', () => {}, 'panelB');
    offGlobal(null, 'panelA');
    assert.equal(activeCount(), 1);
});

test('destroy 清空监听器并移除 document 监听', async () => {
    const { onGlobal, destroy, activeCount } = await import('./event-manager.js');
    onGlobal('x', 'keydown', () => eventLog.push('x'));
    assert.equal(activeCount(), 1);
    assert.ok((documentHandlers.keydown || []).length > 0, 'document 上注册 keydown');
    destroy();
    assert.equal(activeCount(), 0);
    assert.equal((documentHandlers.keydown || []).length, 0, 'keydown 已从 document 移除');
    assert.equal((documentHandlers.pointerdown || []).length, 0, 'pointerdown 已从 document 移除');
});
