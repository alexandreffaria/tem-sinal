// Validation of uploaded samples against docs/sample-schema.md, schema version 2. Pure: no I/O.

/** The most samples one upload may carry. */
export const MAX_BATCH = 500;

/** A sample that passed [validateBatch]: exactly the fields docs/sample-schema.md allows. */
export type Sample = { id: string; installId: string } & Record<string, unknown>;

export type BatchResult =
  | { ok: false; error: string }
  | { ok: true; valid: Sample[]; rejected: { index: number; reasons: string[] }[] };

/** Appends a reason to [errors] for each way [value] at [path] breaks the rule. */
type Rule = (value: unknown, path: string, errors: string[]) => void;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const check =
  (test: (v: unknown) => boolean, expected: string): Rule =>
  (v, path, errors) => {
    if (!test(v)) errors.push(`${path}: expected ${expected}`);
  };

/** An integer (a Kotlin Int or Long) in min..max. */
const int = (min: number, max: number) =>
  check((v) => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max, `an integer in ${min}..${max}`);

/** A finite number (a Kotlin Float or Double) in min..max. */
const num = (min = -Infinity, max = Infinity) =>
  check((v) => Number.isFinite(v) && (v as number) >= min && (v as number) <= max, `a number in ${min}..${max}`);

const oneOf = (...values: unknown[]) => check((v) => values.includes(v), `one of ${values.join(", ")}`);
const text = (pattern: RegExp, name: string) => check((v) => typeof v === "string" && pattern.test(v), name);

const uuid = text(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, "a lowercase version 4 UUID");
const plmn = text(/^\d{5,6}$/, "an MCC + MNC of 5 or 6 digits");
const long = int(0, Number.MAX_SAFE_INTEGER);
const absent: Rule = (v, path, errors) => {
  if (v !== undefined && v !== null) errors.push(`${path}: must be null`);
};

/** Missing or null, or else passing [rule]. Every other rule rejects missing and null. */
const opt =
  (rule: Rule): Rule =>
  (v, path, errors) => {
    if (v !== undefined && v !== null) rule(v, path, errors);
  };

/** An object with exactly these fields. */
const object =
  (fields: Record<string, Rule>): Rule =>
  (v, path, errors) => {
    if (!isObject(v)) return void errors.push(`${path}: expected an object`);
    for (const key of Object.keys(v)) {
      if (!Object.hasOwn(fields, key)) errors.push(`${path}.${key}: unknown field`);
    }
    for (const [key, rule] of Object.entries(fields)) rule(v[key], `${path}.${key}`, errors);
  };

const list =
  (item: Rule, minLength: number): Rule =>
  (v, path, errors) => {
    if (!Array.isArray(v) || v.length < minLength) {
      return void errors.push(`${path}: expected a list of at least ${minLength}`);
    }
    v.forEach((element, i) => item(element, `${path}[${i}]`, errors));
  };

type Ranges = { arfcn: number; pci: number; ci: number; tac: number; strengths: Record<string, [number, number]> };

/** The CellReading table: identity maxima (minimum 0) and the strengths each technology reports. */
const RANGES = {
  GSM: { arfcn: 65535, pci: 63, ci: 65535, tac: 65535, strengths: { rssi: [-113, -51] } },
  WCDMA: { arfcn: 65535, pci: 511, ci: 268435455, tac: 65535, strengths: { rscp: [-120, -24], ecno: [-24, 1] } },
  LTE: {
    arfcn: 262143, pci: 503, ci: 268435455, tac: 65535,
    strengths: { rsrp: [-140, -43], rsrq: [-34, 3], sinr: [-20, 30], rssi: [-113, -51] },
  },
  NR: {
    arfcn: 3279165, pci: 1007, ci: 68719476735, tac: 16777215,
    strengths: { rsrp: [-156, -31], rsrq: [-43, 20], sinr: [-23, 40] },
  },
} satisfies Record<string, Ranges>;

type Rat = keyof typeof RANGES;

const STRENGTHS = ["rsrp", "rsrq", "sinr", "rssi", "rscp", "ecno"];

/** The rule for a cell from [source] on [rat]: a SIGNAL_STRENGTH cell is an NR leg with no identity. */
function cellRule(source: string, rat: Rat): Rule {
  const r: Ranges = RANGES[rat];
  const fromCellInfo = source === "CELL_INFO";
  const identity = (max: number) => (fromCellInfo ? opt(int(0, max)) : absent);
  const fields: Record<string, Rule> = {
    source: oneOf(source),
    rat: oneOf(rat),
    registered: fromCellInfo ? check((v) => typeof v === "boolean", "a boolean") : oneOf(false),
    connection: opt(oneOf("PRIMARY_SERVING", "SECONDARY_SERVING", "NONE")),
    timestampMs: fromCellInfo ? long : absent,
    arfcn: identity(r.arfcn),
    pci: identity(r.pci),
    plmn: fromCellInfo ? opt(plmn) : absent,
    ci: identity(r.ci),
    tac: identity(r.tac),
  };
  for (const name of STRENGTHS) {
    const range = r.strengths[name];
    fields[name] = range ? opt(int(range[0], range[1])) : absent;
  }
  return object(fields);
}

const CELL_RULES = new Map<string, Rule>([
  ...(Object.keys(RANGES) as Rat[]).map((rat): [string, Rule] => [`CELL_INFO ${rat}`, cellRule("CELL_INFO", rat)]),
  ["SIGNAL_STRENGTH NR", cellRule("SIGNAL_STRENGTH", "NR")],
]);

const cell: Rule = (v, path, errors) => {
  const rule = isObject(v) ? CELL_RULES.get(`${String(v.source)} ${String(v.rat)}`) : undefined;
  if (rule) return rule(v, path, errors);
  errors.push(`${path}: expected a cell with source CELL_INFO and rat GSM, WCDMA, LTE or NR, or SIGNAL_STRENGTH and NR`);
};

const sim = object({
  slot: opt(int(0, 2147483647)),
  simPlmn: opt(plmn),
  registeredPlmn: opt(plmn),
  operatorName: opt(text(/./, "a non-empty string")),
  serviceState: opt(oneOf("IN_SERVICE", "EMERGENCY_ONLY", "OUT_OF_SERVICE", "POWER_OFF")),
  overrideNetworkType: opt(oneOf("NONE", "LTE_CA", "LTE_ADVANCED_PRO", "NR_NSA", "NR_ADVANCED")),
  cells: opt(list(cell, 0)),
});

const fix = object({
  lat: num(-90, 90),
  lon: num(-180, 180),
  accuracyM: opt(num(0)),
  altitudeM: opt(num()),
  verticalAccuracyM: opt(num(0)),
  timeMs: long,
  elapsedRealtimeMs: long,
  mock: check((v) => typeof v === "boolean", "a boolean"),
});

const sample = object({
  schemaVersion: oneOf(2),
  id: uuid,
  installId: uuid,
  sessionId: uuid,
  timeMs: long,
  elapsedRealtimeMs: long,
  fix,
  sims: list(sim, 1),
});

/** The reasons [value] is not a valid sample; empty when it is one. */
export function sampleErrors(value: unknown): string[] {
  const errors: string[] = [];
  sample(value, "sample", errors);
  return errors;
}

/**
 * Checks an upload body, `{"samples": [...]}`. The batch as a whole is refused when it isn't that
 * shape, holds no sample or more than [MAX_BATCH], or holds samples of more than one install.
 * Otherwise each sample is valid or rejected with its reasons; a sample repeating an earlier
 * sample's id is rejected.
 */
export function validateBatch(body: unknown): BatchResult {
  if (!isObject(body) || Object.keys(body).some((key) => key !== "samples") || !Array.isArray(body.samples)) {
    return { ok: false, error: 'expected {"samples": [...]}' };
  }
  const samples: unknown[] = body.samples;
  if (samples.length === 0 || samples.length > MAX_BATCH) {
    return { ok: false, error: `expected 1 to ${MAX_BATCH} samples, got ${samples.length}` };
  }
  const installs = new Set(samples.map((s) => (isObject(s) ? s.installId : undefined)));
  if (installs.size > 1) return { ok: false, error: "samples from more than one install" };

  const valid: Sample[] = [];
  const rejected: { index: number; reasons: string[] }[] = [];
  const ids = new Set<string>();
  samples.forEach((s, index) => {
    const reasons = sampleErrors(s);
    if (reasons.length === 0 && ids.has((s as Sample).id)) reasons.push("sample.id: repeats an earlier sample in this batch");
    if (reasons.length > 0) return void rejected.push({ index, reasons });
    ids.add((s as Sample).id);
    valid.push(s as Sample);
  });
  return { ok: true, valid, rejected };
}
