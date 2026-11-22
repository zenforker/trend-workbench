// Modified for the Natural Chan fork: 自然缠 段 / 趋势 replace the classic
// feature-sequence segments. One builder serves every level (author ruling 4:
// 本级别趋势 = 高一级别的段): strokes → segments, segments → trends.
//
// Rules (《自然缠》第三、四章), applied to alternating units (strokes or segments):
//   成立  ≥3 units, odd, alternating; the first unit's end is broken by a later
//         same-direction unit. With extremes tracked, a reverse segment from the
//         current end e to the most extreme reverse pivot r is established
//         exactly when r lies ≥3 units after e.
//   存续  d₁ the start is not broken by reverse price; d₂ no reverse segment.
//   终结  a reverse segment is established; the old end = the new start.
//   类段  (笔破段型) a single reverse unit breaks the current segment's start:
//         it becomes a one-unit segment (class segment). Later units in its
//         direction extend it and upgrade it to standard; a reverse segment or
//         another class segment ends it. The same holds one level up (类趋势).
//   Drawing: pending (end follows the newest extreme) until the next segment is
//         established, then confirmed (end fixed).
// Only confirmed, contiguous lower-level units are used, so a level never
// reads a unit whose end may still move.
import type { StructureLine } from './market-types';

type Direction = 'up' | 'down';
interface Pivot { index: number; time: number; price: number; high: boolean; knownAt: number }
interface Working { s: number; e: number; dir: Direction; validAt: number }

function confirmedChain(units: readonly StructureLine[]): StructureLine[] {
  const chain: StructureLine[] = [];
  for (const u of units) {
    if (!u.confirmed) break;
    const prev = chain.at(-1);
    if (prev && (prev.to.index !== u.from.index || prev.to.price !== u.from.price || prev.direction === u.direction)) break;
    chain.push(u);
  }
  return chain;
}

export function buildNaturalLevel(units: readonly StructureLine[]): StructureLine[] {
  const chain = confirmedChain(units);
  if (!chain.length) return [];
  const piv: Pivot[] = [{ ...chain[0].from, high: chain[0].direction === 'down', knownAt: chain[0].confirmedAt }];
  for (const u of chain) piv.push({ ...u.to, high: u.direction === 'up', knownAt: u.confirmedAt });
  const list: Working[] = [];
  let q = 0;
  // Bootstrap: first segment between the running extreme pivots, ≥3 units apart.
  for (let hi = -1, lo = -1; q < piv.length && !list.length; q++) {
    const p = piv[q];
    if (p.high) {
      if (hi < 0 || p.price > piv[hi].price) { hi = q; if (lo >= 0 && hi - lo >= 3) list.push({ s: lo, e: hi, dir: 'up', validAt: p.knownAt }); }
    } else if (lo < 0 || p.price < piv[lo].price) { lo = q; if (hi >= 0 && lo - hi >= 3) list.push({ s: hi, e: lo, dir: 'down', validAt: p.knownAt }); }
  }
  let r = -1; // most extreme reverse pivot since the current end
  for (; q < piv.length; q++) {
    const cur = list[list.length - 1], p = piv[q], up = cur.dir === 'up';
    if (p.high === up) { // same-direction end: extension only when beyond the current end
      if (up ? p.price > piv[cur.e].price : p.price < piv[cur.e].price) { cur.e = q; r = -1; }
      continue;
    }
    if (r < 0 || (up ? p.price < piv[r].price : p.price > piv[r].price)) r = q; else continue;
    const standard = r >= cur.e + 3;
    const breaksStart = up ? piv[r].price < piv[cur.s].price : piv[r].price > piv[cur.s].price;
    if (standard || breaksStart) { list.push({ s: cur.e, e: r, dir: up ? 'down' : 'up', validAt: p.knownAt }); r = -1; }
  }
  const at = (p: Pivot) => ({ index: p.index, time: p.time, price: p.price });
  return list.map((w, k) => {
    const confirmed = k < list.length - 1, from = at(piv[w.s]), to = at(piv[w.e]);
    const [lowPoint, highPoint] = w.dir === 'up' ? [from, to] : [to, from]; // endpoints are the extremes
    return {
      from, to, direction: w.dir, confirmed,
      priceRange: { low: lowPoint.price, high: highPoint.price, lowPoint: { ...lowPoint }, highPoint: { ...highPoint } },
      confirmedAt: confirmed ? list[k + 1].validAt : Math.max(w.validAt, piv[w.e].knownAt),
      kind: w.e - w.s >= 3 ? 'standard' : 'quasi',
    } satisfies StructureLine;
  });
}
