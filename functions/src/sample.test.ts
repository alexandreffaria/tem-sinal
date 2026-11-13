import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_BATCH, sampleErrors, validateBatch } from "./sample.js";
import { testSample } from "./test-sample.js";

/** A test sample after [change] edits it; `cells` is SIM 1's cells. */
function sampleWhere(change: (s: any, cells: any[]) => void) {
  const s: any = testSample();
  change(s, s.sims[0].cells);
  return s;
}

test("the schema doc's example is valid", () => {
  assert.deepEqual(sampleErrors(testSample()), []);
});

test("null and missing optional fields are valid", () => {
  const s = sampleWhere((s, cells) => {
    s.fix.accuracyM = null;
    delete s.fix.altitudeM;
    s.sims[1].cells = null;
    cells[0].connection = null;
  });
  assert.deepEqual(sampleErrors(s), []);
});

test("an unknown field is rejected at any depth", () => {
  assert.deepEqual(sampleErrors(sampleWhere((s) => (s.carrier = "VIVO"))), ["sample.carrier: unknown field"]);
  assert.deepEqual(sampleErrors(sampleWhere((_, cells) => (cells[0].ta = 3))), [
    "sample.sims[0].cells[0].ta: unknown field",
  ]);
  assert.deepEqual(sampleErrors(sampleWhere((s) => (s.fix.toString = 1))), ["sample.fix.toString: unknown field"]);
});

test("a bad type is rejected", () => {
  assert.deepEqual(sampleErrors(sampleWhere((s) => (s.timeMs = "1767261600000"))), [
    `sample.timeMs: expected an integer in 0..${Number.MAX_SAFE_INTEGER}`,
  ]);
  assert.deepEqual(sampleErrors(sampleWhere((s) => (s.fix.mock = "false"))), ["sample.fix.mock: expected a boolean"]);
  assert.deepEqual(sampleErrors(sampleWhere((_, cells) => (cells[0].rsrp = -98.5))), [
    "sample.sims[0].cells[0].rsrp: expected an integer in -140..-43",
  ]);
});

test("a value out of its technology's range is rejected", () => {
  assert.deepEqual(sampleErrors(sampleWhere((_, cells) => (cells[0].pci = 504))), [
    "sample.sims[0].cells[0].pci: expected an integer in 0..503",
  ]);
  assert.deepEqual(sampleErrors(sampleWhere((s) => (s.fix.lat = -91))), ["sample.fix.lat: expected a number in -90..90"]);
  assert.deepEqual(sampleErrors(sampleWhere((s) => (s.sims[1].simPlmn = "724"))), [
    "sample.sims[1].simPlmn: expected an MCC + MNC of 5 or 6 digits",
  ]);
});

test("a value a technology doesn't report is rejected", () => {
  const gsm = sampleWhere((_, cells) => (cells[1] = { ...cells[1], rat: "GSM", pci: 20, rsrp: undefined, rsrq: -15 }));
  assert.deepEqual(sampleErrors(gsm), ["sample.sims[0].cells[1].rsrq: must be null"]);
});

test("a SIGNAL_STRENGTH cell is an NR leg with no identity", () => {
  assert.deepEqual(sampleErrors(sampleWhere((_, cells) => (cells[2].pci = 7))), ["sample.sims[0].cells[2].pci: must be null"]);
  assert.equal(sampleErrors(sampleWhere((_, cells) => (cells[2].rat = "LTE"))).length, 1);
});

test("required fields, the schema version and a SIM are required", () => {
  assert.deepEqual(sampleErrors(sampleWhere((s) => delete s.sessionId)), ["sample.sessionId: expected a lowercase version 4 UUID"]);
  assert.deepEqual(sampleErrors(sampleWhere((s) => (s.schemaVersion = 1))), ["sample.schemaVersion: expected one of 2"]);
  assert.deepEqual(sampleErrors(sampleWhere((s) => (s.sims = []))), ["sample.sims: expected a list of at least 1"]);
});

test("a batch over the cap is refused whole", () => {
  const samples = Array.from({ length: MAX_BATCH + 1 }, testSample);
  assert.deepEqual(validateBatch({ samples }), { ok: false, error: "expected 1 to 500 samples, got 501" });
  assert.equal(validateBatch({ samples: samples.slice(1) }).ok, true);
});

test("a batch of the wrong shape, empty, or from two installs is refused whole", () => {
  assert.equal(validateBatch([testSample()]).ok, false);
  assert.equal(validateBatch({ samples: [testSample()], extra: 1 }).ok, false);
  assert.equal(validateBatch({ samples: [] }).ok, false);
  const other = sampleWhere((s) => (s.installId = "9e1f3c2a-5b6d-4e7f-8a9b-0c1d2e3f4a5b"));
  assert.deepEqual(validateBatch({ samples: [testSample(), other] }), { ok: false, error: "samples from more than one install" });
});

test("invalid samples and repeated ids are rejected one by one", () => {
  const first = testSample();
  const bad = sampleWhere((s) => (s.timeMs = -1));
  const result = validateBatch({ samples: [first, bad, { ...first }] });
  assert.deepEqual(result, {
    ok: true,
    valid: [first],
    rejected: [
      { index: 1, reasons: [`sample.timeMs: expected an integer in 0..${Number.MAX_SAFE_INTEGER}`] },
      { index: 2, reasons: ["sample.id: repeats an earlier sample in this batch"] },
    ],
  });
});

test("a session id that isn't a lowercase version 4 UUID is rejected", () => {
  const expected = ["sample.sessionId: expected a lowercase version 4 UUID"];
  assert.deepEqual(sampleErrors(sampleWhere((s) => (s.sessionId = "C3A7E915-2D4B-4F8A-9E6C-1B0D5A7F3E28"))), expected);
  assert.deepEqual(sampleErrors(sampleWhere((s) => (s.sessionId = "c3a7e915-2d4b-1f8a-9e6c-1b0d5a7f3e28"))), expected);
});

test("each technology's identity and strength ranges hold at their edges", () => {
  const neighbour = { source: "CELL_INFO", registered: false, connection: "NONE", timestampMs: 86399500 };
  const nr = { ...neighbour, rat: "NR", arfcn: 3279165, pci: 1007, ci: 68719476735, tac: 16777215, rsrp: -110 };
  assert.deepEqual(sampleErrors(sampleWhere((_, cells) => cells.push(nr))), []);
  assert.deepEqual(sampleErrors(sampleWhere((_, cells) => cells.push({ ...nr, arfcn: 3279166, pci: 1008, ci: 68719476736, tac: 16777216 }))), [
    "sample.sims[0].cells[3].arfcn: expected an integer in 0..3279165",
    "sample.sims[0].cells[3].pci: expected an integer in 0..1007",
    "sample.sims[0].cells[3].ci: expected an integer in 0..68719476735",
    "sample.sims[0].cells[3].tac: expected an integer in 0..16777215",
  ]);

  const wcdma = { ...neighbour, rat: "WCDMA", pci: 511, rscp: -24, ecno: 1 };
  assert.deepEqual(sampleErrors(sampleWhere((_, cells) => cells.push(wcdma))), []);
  assert.deepEqual(sampleErrors(sampleWhere((_, cells) => cells.push({ ...wcdma, pci: 512, rscp: -23, ecno: 2 }))), [
    "sample.sims[0].cells[3].pci: expected an integer in 0..511",
    "sample.sims[0].cells[3].rscp: expected an integer in -120..-24",
    "sample.sims[0].cells[3].ecno: expected an integer in -24..1",
  ]);
  assert.deepEqual(sampleErrors(sampleWhere((_, cells) => cells.push({ ...wcdma, rsrp: -100 }))), [
    "sample.sims[0].cells[3].rsrp: must be null",
  ]);

  const gsm = { ...neighbour, rat: "GSM", pci: 63, ci: 65535, rssi: -80 };
  assert.deepEqual(sampleErrors(sampleWhere((_, cells) => cells.push(gsm))), []);
  assert.deepEqual(sampleErrors(sampleWhere((_, cells) => cells.push({ ...gsm, pci: 64, ci: 65536 }))), [
    "sample.sims[0].cells[3].pci: expected an integer in 0..63",
    "sample.sims[0].cells[3].ci: expected an integer in 0..65535",
  ]);
});

test("a CELL_INFO cell without a timestamp is rejected", () => {
  assert.deepEqual(sampleErrors(sampleWhere((_, cells) => delete cells[0].timestampMs)), [
    `sample.sims[0].cells[0].timestampMs: expected an integer in 0..${Number.MAX_SAFE_INTEGER}`,
  ]);
});

test("a PLMN has 5 or 6 digits and nothing else", () => {
  assert.deepEqual(sampleErrors(sampleWhere((s) => (s.sims[1].simPlmn = "724060"))), []);
  assert.deepEqual(sampleErrors(sampleWhere((s) => (s.sims[1].simPlmn = "72A06"))), [
    "sample.sims[1].simPlmn: expected an MCC + MNC of 5 or 6 digits",
  ]);
});

test("a __proto__ key from JSON.parse is an unknown field", () => {
  const s = JSON.parse(JSON.stringify(testSample()).replace(/^\{/, '{"__proto__":{"x":1},'));
  assert.deepEqual(sampleErrors(s), ["sample.__proto__: unknown field"]);
});
