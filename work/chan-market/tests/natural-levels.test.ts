import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNaturalLevel } from '../lib/natural-levels.ts';
import { analyze } from '../lib/chan.ts';
import type { Candle, StructureLine } from '../lib/market-types';

/** Alternating confirmed units through the given pivot prices; pivot k sits at bar 5k. */
const units = (v: number[]): StructureLine[] => v.slice(1).map((price, i) => ({
  from: { index: i * 5, time: 1000 + i * 5, price: v[i] }, to: { index: (i + 1) * 5, time: 1000 + (i + 1) * 5, price },
  direction: price > v[i] ? 'up' : 'down', confirmed: true, confirmedAt: (i + 2) * 5,
}));
const shape = (v: number[]) => buildNaturalLevel(units(v)).map(s => [s.from.index / 5, s.to.index / 5, s.direction, s.confirmed, s.kind]);

test('成立: three alternating units whose first end is broken by a later same-direction unit', () => {
  assert.deepEqual(shape([10, 20, 15, 25]), [[0, 3, 'up', false, 'standard']]);
});

test('not established while no later unit breaks the first unit end', () => {
  assert.deepEqual(shape([10, 20, 15, 19, 12]), []);
});

test('终结: a standard reverse segment ends the segment at the shared extreme', () => {
  assert.deepEqual(shape([10, 20, 15, 25, 18, 23, 14]), [[0, 3, 'up', true, 'standard'], [3, 6, 'down', false, 'standard']]);
});

test('reverse units that do not break their first end are only an internal test; the segment extends', () => {
  assert.deepEqual(shape([10, 20, 15, 25, 18, 23, 19, 30]), [[0, 7, 'up', false, 'standard']]);
});

test('类段 (笔破段型): one reverse unit breaking the segment start becomes a class segment', () => {
  assert.deepEqual(shape([10, 20, 15, 25, 5]), [[0, 3, 'up', true, 'standard'], [3, 4, 'down', false, 'quasi']]);
  // Another single unit breaking the class segment's start (25) ends it with a new class segment.
  assert.deepEqual(shape([10, 20, 15, 25, 5, 30]), [[0, 3, 'up', true, 'standard'], [3, 4, 'down', true, 'quasi'], [4, 5, 'up', false, 'quasi']]);
});

test('a class segment that keeps going in its own direction upgrades to a standard segment', () => {
  assert.deepEqual(shape([10, 20, 15, 25, 5, 12, 3]), [[0, 3, 'up', true, 'standard'], [3, 6, 'down', false, 'standard']]);
});

test('only confirmed lower-level units are used', () => {
  const u = units([10, 20, 15, 25]);
  u[2] = { ...u[2], confirmed: false };
  assert.deepEqual(buildNaturalLevel(u), []);
});

const bar = (i: number, low: number, high: number, close = (low + high) / 2): Candle => ({ time: 1700000000 + i * 3600, open: close, close, low, high, volume: 1000, closed: true });
const series = (n: number) => Array.from({ length: n }, (_, i) => {
  const c = 100 + 12 * Math.sin(i / 23) + 5 * Math.sin(i / 7.3) + 2 * Math.sin(i / 2.1) + i * 0.02;
  return bar(i, c - 0.8, c + 0.8, c);
});

test('analyze: segments and trends alternate, connect, and have extreme endpoints over their members', () => {
  const a = analyze(series(900), { skipCalibration: true, skipTradePlans: true });
  assert.ok(a.segments.length >= 3 && a.trends.length >= 1, `segments ${a.segments.length}, trends ${a.trends.length}`);
  for (const [lines, members] of [[a.segments, a.strokes], [a.trends, a.segments]] as const) {
    lines.forEach((l, k) => {
      if (k) { assert.equal(lines[k - 1].to.index, l.from.index); assert.notEqual(lines[k - 1].direction, l.direction); }
      assert.ok(l.confirmedAt >= l.to.index);
      const inside = members.filter(m => m.from.index >= l.from.index && m.to.index <= l.to.index).flatMap(m => [m.from.price, m.to.price]);
      assert.equal(Math.max(...inside), Math.max(l.from.price, l.to.price));
      assert.equal(Math.min(...inside), Math.min(l.from.price, l.to.price));
    });
  }
});

test('analyze: a confirmed segment or trend is already visible, unchanged, at its confirmation bar', () => {
  const candles = series(700), a = analyze(candles, { skipCalibration: true, skipTradePlans: true });
  for (const key of ['segments', 'trends'] as const) {
    for (const l of a[key].filter(l => l.confirmed).slice(0, -1)) {
      const prefix = analyze(candles.slice(0, l.confirmedAt + 1), { skipCalibration: true, skipTradePlans: true })[key];
      assert.ok(prefix.some(p => p.from.index === l.from.index && p.to.index === l.to.index && p.direction === l.direction), `${key} ${l.from.index}→${l.to.index}`);
    }
  }
});
