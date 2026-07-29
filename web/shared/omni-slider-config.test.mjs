import assert from "node:assert/strict";
import test from "node:test";

import {
    defaultOmniSliderConfig,
    parseOmniSliderConfig,
    serializeOmniSliderConfig,
} from "./omni-slider-config.js";

test("OmniSlider default configs do not share mutable snap points", () => {
    const first = defaultOmniSliderConfig(1);
    const second = defaultOmniSliderConfig(2);
    first.snapPoints[0] = 0.5;
    assert.equal(second.snapPoints[0], null);
    assert.notEqual(first.color, second.color);
});

test("OmniSlider migrates legacy generated labels", () => {
    assert.equal(parseOmniSliderConfig('{"label":"滑条 3"}').label, "C3");
    assert.equal(parseOmniSliderConfig('{"label":"滑条"}').label, "");
    assert.equal(parseOmniSliderConfig('{"label":"用户名称"}').label, "用户名称");
});

test("OmniSlider config parser rejects malformed and non-object payloads", () => {
    assert.deepEqual(parseOmniSliderConfig("{"), {});
    assert.deepEqual(parseOmniSliderConfig("[]"), {});
    const config = defaultOmniSliderConfig();
    assert.deepEqual(parseOmniSliderConfig(serializeOmniSliderConfig(config)), config);
});
