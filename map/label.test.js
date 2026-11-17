import assert from "node:assert/strict";
import { test } from "node:test";
import { coarseShade, label, level, shade } from "./public/label.js";

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

const levels = {
  LTE: [[-140, 0], [-129, 0], [-128, 1], [-118, 2], [-109, 2], [-108, 3], [-98, 4], [-60, 4]],
  NR: [[-111, 0], [-110, 1], [-91, 1], [-90, 2], [-80, 3], [-66, 3], [-65, 4]],
  WCDMA: [[-116, 0], [-115, 1], [-105, 2], [-95, 3], [-86, 3], [-85, 4]],
  GSM: [[-108, 0], [-107, 1], [-103, 2], [-97, 3], [-90, 3], [-89, 4]],
};

for (const [tech, cases] of Object.entries(levels)) {
  test(`${tech} medians get Android's levels`, () => {
    for (const [median, expected] of cases) assert.equal(level({ median, tech }), expected, `${median} dBm`);
  });
}

test("a median with no known network type, or none, has no level", () => {
  assert.equal(level({ median: -90, tech: null }), null);
  assert.equal(level({ median: -90, tech: "CDMA" }), null);
  assert.equal(level({ median: null, tech: "LTE" }), null);
});

test("a public cell with signal is shaded by its median's level; the other labels keep their own", () => {
  const figures = (serviceN, emergencyN, noServiceN, median, tech) => ({ best: median, median, tech, serviceN, emergencyN, noServiceN });
  assert.equal(shade(figures(10, 0, 0, -95, "LTE")), "signal-4");
  assert.equal(shade(figures(10, 0, 0, -120, "LTE")), "signal-1");
  assert.equal(shade(figures(10, 0, 0, -95, "NR")), "signal-1");
  assert.equal(shade(figures(10, 0, 0, null, null)), "signal-unknown");
  // A strong median among readings mostly in emergency-only service doesn't make it signal.
  assert.equal(shade(figures(1, 200, 0, -70, "LTE")), "emergency");
  assert.equal(shade(figures(34, 33, 33, -70, "LTE")), "none");
});

test("an overview cell is shaded by the best label inside it, and for signal by the best level", () => {
  assert.equal(coarseShade([3, 1, 1, 0, 2, 0, 1, 0]), "signal-3");
  assert.equal(coarseShade([1, 5, 9, 1, 0, 0, 0, 0]), "signal-0");
  assert.equal(coarseShade([2, 0, 0, 0, 0, 0, 0, 0]), "signal-unknown");
  assert.equal(coarseShade([0, 4, 9, 0, 0, 0, 0, 0]), "emergency");
  assert.equal(coarseShade([0, 0, 9, 0, 0, 0, 0, 0]), "none");
});
