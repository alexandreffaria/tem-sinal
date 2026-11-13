// The session-end trim as it stood before it was made near linear, kept only to show the new one keeps the same samples.
import { greatCircleDistance } from "h3-js";
import { ANCHOR_FIXES, DEPARTURE_FIXES, MAX_SPEED_MPS, STAYS, type StoredSample } from "./aggregate.js";

const metresApart = (a: StoredSample["fix"], b: StoredSample["fix"]) => greatCircleDistance([a.lat, a.lon], [b.lat, b.lon], "m");

type Anchor = { fix: StoredSample["fix"]; radiusM: number };

function beyondEnd(samples: StoredSample[], trimM: number): boolean[] {
  const fixes = samples.map((s) => s.fix);
  const places: { from: number; stay: boolean; anchors: Anchor[] }[] = [];
  const inStay = fixes.map(() => false);
  samples.forEach((s, i) => {
    const before = samples[i - 1];
    const metres = before ? metresApart(before.fix, s.fix) : Infinity;
    if (metres > trimM || metres > (MAX_SPEED_MPS * Math.abs(s.elapsedRealtimeMs - (before?.elapsedRealtimeMs ?? 0))) / 1000) {
      places.push({ from: i, stay: false, anchors: fixes.slice(i, i + ANCHOR_FIXES).map((fix) => ({ fix, radiusM: trimM })) });
    }
  });
  for (const stay of STAYS) {
    let next = 0;
    fixes.forEach((first, i) => {
      if (i < next) return;
      let j = i + 1;
      let spreadM = 0;
      for (let fix = fixes[j]; fix; fix = fixes[++j]) {
        const metres = metresApart(first, fix);
        if (metres > stay.radiusM) break;
        spreadM = Math.max(spreadM, metres);
      }
      if (j - i < stay.fixes) return;
      places.push({ from: i, stay: true, anchors: [{ fix: first, radiusM: trimM + spreadM + stay.radiusM / 2 }] });
      inStay.fill(true, i, j);
      next = j;
    });
  }
  places.sort((a, b) => a.from - b.from);
  const beyond = fixes.map(() => true);
  const moving = fixes.map((_, i) => !inStay[i]);
  let resting = 0;
  let away = 0;
  for (let i = 0; i < fixes.length && away < DEPARTURE_FIXES; i++) {
    for (let place = places[resting]; place && place.from <= i; place = places[++resting]) {
      for (const { fix, radiusM } of place.anchors) {
        fixes.forEach((f, k) => {
          if (metresApart(fix, f) > radiusM) return;
          beyond[k] = false;
          if (!place.stay) moving[k] = false;
        });
      }
    }
    if (moving[i]) away++;
  }
  return beyond;
}
export function referenceTrimSession(session: StoredSample[], startM: number, endM: number): StoredSample[] {
  const samples = session.filter((s) => !s.fix.mock).sort((a, b) => a.elapsedRealtimeMs - b.elapsedRealtimeMs);
  const fromStart = beyondEnd(samples, startM);
  const fromEnd = beyondEnd(samples.toReversed(), endM).toReversed();
  return samples.filter((_, i) => fromStart[i] && fromEnd[i]);
}
