import test from "node:test";
import assert from "node:assert/strict";

import {
    clampLauncherPosition,
    enclosingRect,
    launcherDodgePosition,
    smartFanAngle,
} from "./launcher-geometry.js";

const viewport = {
    defaultSize: 60,
    viewportWidth: 1000,
    viewportHeight: 700,
};

test("launcher position stays inside the viewport gutter", () => {
    assert.deepEqual(clampLauncherPosition(-100, 900, viewport), { x: 6, y: 634 });
});

test("launcher dodges a narrow panel horizontally and a wide panel vertically", () => {
    const ball = { left: 450, top: 200, right: 510, bottom: 260 };
    assert.deepEqual(launcherDodgePosition(
        ball,
        { left: 400, top: 150, right: 600, bottom: 300, width: 200, height: 150 },
        { ...viewport, ballSize: 60 },
    ), { x: 320, y: 200 });
    assert.deepEqual(launcherDodgePosition(
        ball,
        { left: 200, top: 150, right: 800, bottom: 300, width: 600, height: 150 },
        { ...viewport, ballSize: 60 },
    ), { x: 450, y: 320 });
});

test("fan angle points away from each viewport edge", () => {
    assert.equal(smartFanAngle(20, 20, 1000, 700), Math.PI / 4);
    assert.equal(smartFanAngle(980, 680, 1000, 700), -3 * Math.PI / 4);
    assert.equal(smartFanAngle(200, 350, 1000, 700), 0);
});

test("enclosing rectangle covers launcher and visible orbs", () => {
    assert.deepEqual(enclosingRect([
        { left: 10, top: 20, right: 50, bottom: 60 },
        { left: 40, top: 5, right: 90, bottom: 80 },
    ]), { left: 10, top: 5, right: 90, bottom: 80, width: 80, height: 75 });
    assert.equal(enclosingRect([]), null);
});
