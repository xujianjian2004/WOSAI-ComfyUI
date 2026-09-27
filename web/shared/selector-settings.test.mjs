import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SELECTOR_LABELS,
  DEFAULT_SELECTOR_SETTINGS,
  MAX_SELECTOR_COLUMNS,
  MAX_SELECTOR_LABELS,
  normalizeSelectorLabels,
  normalizeSelectorSettings,
  serializeSelectorSettings,
} from "./selector-settings.js";

test("selector settings recover safely from invalid workflow data", () => {
  assert.deepEqual(normalizeSelectorSettings("{invalid"), DEFAULT_SELECTOR_SETTINGS);
  assert.deepEqual(normalizeSelectorSettings(null), DEFAULT_SELECTOR_SETTINGS);
});

test("selector settings retain only the supported dimensions and labels", () => {
  const settings = normalizeSelectorSettings({
    mode: "custom",
    fontSize: 99,
    buttonHeight: 1,
    gap: -5,
    activeColor: "red",
    inactiveColor: "#ABCDEF",
    textColor: "#010203",
    falseLabel: "  No  ",
  });

  assert.equal(settings.fontSize, 24);
  assert.equal(settings.buttonHeight, 30);
  assert.equal(settings.gap, 5);
  assert.equal(settings.falseLabel, "No");
  assert.deepEqual(Object.keys(settings), [
    "fontSize",
    "buttonHeight",
    "gap",
    "falseLabel",
    "trueLabel",
  ]);
});

test("selector settings serialize renamed labels with stable bounds", () => {
  const serialized = serializeSelectorSettings({
    falseLabel: `  ${"F".repeat(60)}  `,
    trueLabel: "Enabled",
  });
  const settings = JSON.parse(serialized);

  assert.equal(settings.falseLabel.length, 48);
  assert.equal(settings.trueLabel, "Enabled");
  assert.equal(settings.fontSize, DEFAULT_SELECTOR_SETTINGS.fontSize);
});

test("selector labels use zero-based defaults and stop at ten items", () => {
  assert.equal(MAX_SELECTOR_LABELS, 10);
  assert.equal(MAX_SELECTOR_COLUMNS, 5);
  assert.deepEqual(
    DEFAULT_SELECTOR_LABELS,
    Array.from({ length: 10 }, (_, index) => String(index)),
  );
  assert.deepEqual(normalizeSelectorLabels("invalid"), DEFAULT_SELECTOR_LABELS);
  assert.deepEqual(
    normalizeSelectorLabels(JSON.stringify(Array.from({ length: 14 }, (_, index) => index))),
    Array.from({ length: 10 }, (_, index) => String(index)),
  );
});
