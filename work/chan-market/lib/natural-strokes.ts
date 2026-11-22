// Modified for the Natural Chan fork: 自然笔 replaces classic inclusion/fractal pens.
// Rules follow 《自然缠》第二章 plus the author's rulings of 2026-11-22:
//   - no inclusion merging, no fractals; tops/bottoms are raw bar highs/lows;
//   - standard stroke: (a) ≥3 bars, (b) ≥2 cumulative new extremes in the
//     stroke direction, (c) top/bottom separation Ltop > Hbot, measured over
//     every bar in the stroke, with the Ltop bar after the Hbot bar for an up
//     stroke (mirrored for a down stroke);
//   - a stroke ends only when a standard reverse stroke appears (its end = the
//     reverse stroke's start); smaller reverse moves are noise;
//   - 类笔: when price breaks the start of the current stroke B without a
//     standard reverse stroke, the reverse move C becomes a 类笔 if B is itself
//     standard (新生), otherwise B is dropped and the previous stroke extends
//     to C's extreme (合并).
// Every decision at bar i uses bars ≤ i only.
import type { Fractal, StructureLine } from './market-types';

type Direction = 'up' | 'down';
export type StrokeBar = { index: number; time: number; high: number; low: number };
interface Working { s: number; e: number; dir: Direction; standard: boolean; validAt: number }

/** Standard-stroke test for bars[a..b] (positions), a = start extreme, b = end extreme. */
export function isStandardStroke(bars: readonly StrokeBar[], a: number, b: number, dir: Direction): boolean {
  if (b - a < 2) return false; // (a) at least 3 bars
  const up = dir === 'up';
  let ext = up ? bars[a].high : bars[a].low, refreshes = 0;
  for (let j = a + 1; j <= b; j++) {
    const v = up ? bars[j].high : bars[j].low;
    if (up ? v > ext : v < ext) { refreshes++; ext = v; }
  }
  if (refreshes < 2) return false; // (b) directionality
  // (c) separation. Ties pick the bar most favourable to the required order.
  let lTop = -Infinity, lTopAt = -1, hBot = Infinity, hBotAt = -1;
  for (let j = a; j <= b; j++) {
    const { low, high } = bars[j];
    if (up ? low >= lTop : low > lTop) { lTop = low; lTopAt = j; }
    if (up ? high < hBot : high <= hBot) { hBot = high; hBotAt = j; }
  }
  return lTop > hBot && (up ? lTopAt > hBotAt : lTopAt < hBotAt);
}

export function buildNaturalStrokes(bars: readonly StrokeBar[]): { strokes: StructureLine[]; fractals: Fractal[] } {
  const n = bars.length, list: Working[] = [];
  let i = 0;
  // Bootstrap: the first standard stroke between the running extremes.
  for (let hi = 0, lo = 0; i < n && !list.length; i++) {
    if (bars[i].high > bars[hi].high) hi = i;
    if (bars[i].low < bars[lo].low) lo = i;
    if (hi === i && lo < hi && isStandardStroke(bars, lo, hi, 'up')) list.push({ s: lo, e: hi, dir: 'up', standard: true, validAt: i });
    else if (lo === i && hi < lo && isStandardStroke(bars, hi, lo, 'down')) list.push({ s: hi, e: lo, dir: 'down', standard: true, validAt: i });
  }
  let r = -1; // most extreme reverse bar since the current stroke's end
  for (; i < n; i++) {
    const cur = list[list.length - 1], bar = bars[i], up = cur.dir === 'up';
    if (up ? bar.high > bars[cur.e].high : bar.low < bars[cur.e].low) { cur.e = i; r = -1; continue; }
    if (r < 0 || (up ? bar.low < bars[r].low : bar.high > bars[r].high)) r = i; else continue;
    const rev: Direction = up ? 'down' : 'up';
    if (isStandardStroke(bars, cur.e, r, rev)) { list.push({ s: cur.e, e: r, dir: rev, standard: true, validAt: i }); r = -1; continue; }
    const brokeStart = up ? bars[r].low < bars[cur.s].low : bars[r].high > bars[cur.s].high;
    if (!brokeStart) continue;
    if (cur.standard || list.length < 2) list.push({ s: cur.e, e: r, dir: rev, standard: false, validAt: i }); // 新生
    else { list.pop(); list[list.length - 1].e = r; } // 合并
    r = -1;
  }
  const at = (pos: number, dir: Direction, end: boolean) => {
    const high = (dir === 'up') === end;
    return { index: bars[pos].index, time: bars[pos].time, price: high ? bars[pos].high : bars[pos].low };
  };
  const strokes: StructureLine[] = list.map((w, k) => {
    const confirmed = k < list.length - 1;
    return {
      from: at(w.s, w.dir, false), to: at(w.e, w.dir, true), direction: w.dir, confirmed,
      confirmedAt: confirmed ? bars[list[k + 1].validAt].index : Math.max(bars[w.validAt].index, bars[w.e].index),
      kind: w.standard ? 'standard' : 'quasi',
    };
  });
  // Turning points: each stroke's start, known once that stroke validated.
  const fractals: Fractal[] = list.map(w => ({
    ...at(w.s, w.dir, false), type: w.dir === 'up' ? 'bottom' : 'top', confirmedAt: bars[w.validAt].index,
  }));
  return { strokes, fractals };
}
