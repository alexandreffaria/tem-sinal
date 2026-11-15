import assert from "node:assert/strict";
import { test } from "node:test";
import { label } from "./public/label.js";

const cases = [
  [1, 200, 0, "emergency"],
  [120, 80, 0, "emergency"],
  [199, 0, 1, "signal"],
  [95, 0, 5, "signal"],
  [85, 0, 15, "none"],
  [34, 33, 33, "none"],
  [50, 0, 50, "none"],
  [10, 10, 0, "emergency"],
  [3, 0, 0, "signal"],
  // Exactly 90%.
  [27, 0, 3, "signal"],
  [0, 27, 3, "emergency"],
];

for (const [serviceN, emergencyN, noServiceN, expected] of cases) {
  test(`${serviceN} / ${emergencyN} / ${noServiceN} is ${expected}`, () => {
    assert.equal(label({ serviceN, emergencyN, noServiceN }), expected);
  });
}
