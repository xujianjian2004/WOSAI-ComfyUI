import test from "node:test";
import assert from "node:assert/strict";

import {
    BALL_EXPRESSIONS,
    normalizeBallExpression,
    normalizeBallSize,
    readBallAnimation,
    readBallExpression,
    readBallExpressionMode,
    writeBallAnimation,
    writeBallExpression,
    writeBallExpressionMode,
    writeBallSize,
} from "./launcher-avatar-state.js";

function storage() {
    const values = new Map();
    return {
        getItem(key) { return values.get(key) ?? null; },
        setItem(key, value) { values.set(key, value); },
    };
}

test("launcher expression catalogue has unique stable IDs", () => {
    const ids = BALL_EXPRESSIONS.map(({ id }) => id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(normalizeBallExpression("unknown"), "idle");
});

test("launcher avatar state normalizes storage values", () => {
    const memory = storage();
    assert.equal(readBallExpression(memory), "idle");
    assert.equal(readBallAnimation(memory), true);
    assert.equal(readBallExpressionMode(memory), "fixed");

    assert.equal(writeBallExpression(memory, "sleep"), "sleep");
    writeBallAnimation(memory, false);
    assert.equal(writeBallExpressionMode(memory, "cycle"), "cycle");
    assert.equal(readBallExpression(memory), "sleep");
    assert.equal(readBallAnimation(memory), false);
    assert.equal(readBallExpressionMode(memory), "cycle");
});

test("launcher size stays within its persisted UI contract", () => {
    const memory = storage();
    assert.equal(normalizeBallSize(43), 60);
    assert.equal(writeBallSize(memory, 72), 72);
    assert.equal(writeBallSize(memory, 1000), 60);
});
