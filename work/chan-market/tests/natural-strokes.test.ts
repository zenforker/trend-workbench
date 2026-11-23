import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNaturalStrokes, isStandardStroke, type StrokeBar } from '../lib/natural-strokes.ts';

/** [low, high] per bar. */
const bars = (rows: [number, number][]): StrokeBar[] => rows.map(([low, high], i) => ({ index: i, time: 1000 + i * 60, low, high }));
const shape = (b: StrokeBar[]) => buildNaturalStrokes(b).strokes.map(s => [s.from.index, s.to.index, s.direction, s.confirmed]);

test('condition a: fewer than 3 bars is never a standard stroke', () => {
  assert.equal(isStandardStroke(bars([[10, 11], [12, 14]]), 0, 1, 'up'), false);
});

test('condition b: needs two cumulative new highs (10→12→11→13 yes, 10→12→11 no)', () => {
  assert.equal(isStandardStroke(bars([[9, 10], [11, 12], [10.5, 11], [12.5, 13]]), 0, 3, 'up'), true);
  assert.equal(isStandardStroke(bars([[9, 10], [11.5, 12], [10.5, 11]]), 0, 2, 'up'), false);
});

test('condition c: overlapping top/bottom zones (Ltop ≤ Hbot) is consolidation, not a stroke', () => {
  assert.equal(isStandardStroke(bars([[10, 12], [10.5, 12.5], [11, 13]]), 0, 2, 'up'), false);
  assert.equal(isStandardStroke(bars([[10, 11], [10.8, 12], [11.5, 13]]), 0, 2, 'up'), true);
});

test('condition c is mirrored for down strokes', () => {
  assert.equal(isStandardStroke(bars([[12, 13], [11, 12.2], [9, 10.5]]), 0, 2, 'down'), true);
  assert.equal(isStandardStroke(bars([[12, 13], [11, 12.5], [10.8, 12.2]]), 0, 2, 'down'), false);
});

test('a small overlapping rebound inside a decline is noise: the down stroke keeps extending', () => {
  const b = bars([
    [19, 20], [17, 18.5], [15, 16.5],             // down 0→2
    [14.6, 15.4], [14.8, 15.6], [14.9, 15.8],     // drifting rebound: new highs but zones overlap
    [14.7, 15.5], [13, 14.5], [11, 12.5],         // decline resumes
  ]);
  assert.deepEqual(shape(b), [[0, 8, 'down', false]]);
});

test('a standard reverse stroke ends the current stroke at its extreme', () => {
  const b = bars([[19, 20], [17, 18.5], [15, 16.5], [16.8, 17.5], [18, 19], [16, 17], [14, 15], [12, 13.5]]);
  assert.deepEqual(shape(b), [[0, 2, 'down', true], [2, 4, 'up', true], [4, 7, 'down', false]]);
});

test('类笔 新生: breaking the start of a standard stroke B makes the non-standard reverse move a stroke', () => {
  const b = bars([
    [19, 20], [17, 18.5], [15, 16.5],   // A down 0→2
    [16.8, 17.5], [16.9, 19],           // B up 2→4 (standard)
    [16.5, 17.5], [14, 17.2],             // C: below A's low 15 but zones overlap → not standard
  ]);
  assert.equal(isStandardStroke(b, 4, 6, 'down'), false);
  assert.deepEqual(shape(b), [[0, 2, 'down', true], [2, 4, 'up', true], [4, 6, 'down', false]]);
});

test('类笔 合并: when the broken stroke is itself a 类笔, it is dropped and the prior stroke extends', () => {
  const m = bars([
    [19, 20], [17, 18.5], [15, 16.5],
    [16.8, 17.5], [16.9, 19],
    [16.5, 17.5], [14, 17.2],             // C: 类笔 down
    [14.5, 19.5],                       // breaks C's start (19) without a standard stroke
  ]);
  assert.deepEqual(shape(m).map(s => s.slice(0, 3)), [[0, 2, 'down'], [2, 7, 'up']]);
});

test('no look-ahead: every stroke of a prefix uses only bars inside that prefix', () => {
  const rows: [number, number][] = Array.from({ length: 240 }, (_, i) => {
    const c = 100 + 8 * Math.sin(i / 9) + 3 * Math.sin(i / 2.3) + i * 0.03;
    return [c - 0.6, c + 0.6];
  });
  const full = buildNaturalStrokes(bars(rows)).strokes;
  for (const cut of [60, 120, 180]) {
    const prefix = buildNaturalStrokes(bars(rows.slice(0, cut))).strokes;
    for (const s of prefix) assert.ok(s.confirmedAt < cut && s.to.index < cut);
    // Confirmed strokes (other than the last two, which a 类笔 merge may still revise) persist.
    for (const s of prefix.filter(s => s.confirmed).slice(0, -2))
      assert.ok(full.some(f => f.from.index === s.from.index && f.to.index === s.to.index), `stroke ${s.from.index}→${s.to.index} changed`);
  }
});

test('eventAt moves only when a stroke is established, not when the current stroke merely extends', () => {
  const base: [number, number][] = [[19, 20], [17, 18.5], [15, 16.5]];          // down stroke established at bar 2
  assert.equal(buildNaturalStrokes(bars(base)).eventAt, 2);
  const extended = [...base, [14, 15.2], [12, 13.5]] as [number, number][];   // extension only
  assert.equal(buildNaturalStrokes(bars(extended)).eventAt, 2);
  const reversed = [...extended, [13.6, 14.5], [15, 16]] as [number, number][]; // up stroke established at bar 6
  assert.equal(buildNaturalStrokes(bars(reversed)).eventAt, 6);
});
