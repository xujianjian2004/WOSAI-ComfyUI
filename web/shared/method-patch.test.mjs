import test from "node:test";
import assert from "node:assert/strict";

import { patchMethod } from "./method-patch.js";

test("method patches compose and can be removed in any order", () => {
    const target = {
        value(number) {
            return number + 1;
        },
    };
    const original = target.value;
    const removeDouble = patchMethod(target, "value", "double", (next) => function (number) {
        return next.call(this, number) * 2;
    });
    const removeOffset = patchMethod(target, "value", "offset", (next) => function (number) {
        return next.call(this, number + 3);
    });

    assert.equal(target.value(1), 10);
    removeDouble();
    assert.equal(target.value(1), 5);
    removeOffset();
    assert.equal(target.value, original);
    assert.equal(target.value(1), 2);
});

test("replacing a stable patch ID does not stack duplicate wrappers", () => {
    const target = { value: (number) => number };
    const removeFirst = patchMethod(target, "value", "same", (next) => (number) => next(number) + 1);
    const removeSecond = patchMethod(target, "value", "same", (next) => (number) => next(number) + 2);

    assert.equal(target.value(1), 3);
    removeFirst();
    assert.equal(target.value(1), 3);
    removeSecond();
    assert.equal(target.value(1), 1);
});
