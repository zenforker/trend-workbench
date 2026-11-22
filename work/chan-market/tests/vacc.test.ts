import test from 'node:test';
import assert from 'node:assert/strict';
import { accelerationArea, averageVelocity, computeVacc, confirmVaccSignals, velocityPeak, VACC_DEFAULTS } from '../lib/vacc.ts';

const bars = (closes: number[]) => closes.map((close, i) => ({ time: (i + 1) * 60, close }));
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} ≠ ${b}`);

test('average velocity is the book formula (1/n)·Σ(C−C_i)/i and undefined before n prior closes', () => {
  const closes = [10, 11, 13, 12];
  assert.equal(averageVelocity(closes, 1, 2), null);
  near(averageVelocity(closes, 2, 2)!, ((13 - 11) / 1 + (13 - 10) / 2) / 2);
  near(averageVelocity(closes, 3, 2)!, ((12 - 13) / 1 + (12 - 11) / 2) / 2);
});

test('Vel is EMA(m) seeded on the first defined V; acc is Vel − Vel₁; first point needs both', () => {
  const noSmooth = computeVacc(bars([10, 11, 13, 12]), { n: 2, m: 1 });
  assert.equal(noSmooth.length, 1);
  assert.equal(noSmooth[0].time, 240);
  near(noSmooth[0].vel, -0.25); near(noSmooth[0].acc, -2);
  const smoothed = computeVacc(bars([10, 11, 13, 12]), { n: 2, m: 3 });
  near(smoothed[0].vel, 1.75 + 0.5 * (-0.25 - 1.75)); near(smoothed[0].acc, -1);
});

test('defaults follow the book (n=30, m=7) and invalid parameters are rejected', () => {
  assert.deepEqual({ ...VACC_DEFAULTS }, { n: 30, m: 7 });
  assert.throws(() => computeVacc(bars([1, 2, 3]), { n: 0, m: 7 }));
  assert.throws(() => computeVacc(bars([1, 2, 3]), { n: 2.5, m: 7 }));
});

test('every point depends only on bars at or before it (prefix invariance, no look-ahead)', () => {
  const closes = Array.from({ length: 160 }, (_, i) => 100 + 8 * Math.sin(i / 9) + 3 * Math.sin(i / 2.3) + i * 0.05);
  const full = computeVacc(bars(closes));
  for (const cut of [45, 70, 101, 159]) {
    const prefix = computeVacc(bars(closes.slice(0, cut)));
    assert.deepEqual(prefix, full.slice(0, prefix.length), `prefix ${cut}`);
  }
});

test('a velocity zero-cross is only a candidate until acc breaks a positive fractal high', () => {
  const raw = [
    { time: 1, vel: -1, acc: 0.1 },
    { time: 2, vel: -0.5, acc: 0.6 }, // fractal high (0.6) confirmed at t=3
    { time: 3, vel: 0.2, acc: 0.3 },  // crosses zero → pending long; 0.3 < 0.6
    { time: 4, vel: 0.4, acc: 0.5 },  // still below reference
    { time: 5, vel: 0.9, acc: 0.7 },  // breaks 0.6 → confirmed long
  ];
  const out = confirmVaccSignals(raw);
  assert.deepEqual(out.map(p => [p.state, p.pending]), [[null, null], [null, null], [null, 'long'], [null, 'long'], ['long', null]]);
});

test('a fractal high that is not positive cannot confirm a long', () => {
  const raw = [
    { time: 1, vel: -1, acc: -0.5 },
    { time: 2, vel: -0.4, acc: -0.1 }, // fractal high below zero
    { time: 3, vel: 0.1, acc: -0.3 },
    { time: 4, vel: 0.3, acc: 0.2 },   // above the reference but reference ≤ 0
  ];
  assert.deepEqual(confirmVaccSignals(raw).map(p => p.state), [null, null, null, null]);
});

test('short confirmation mirrors long; a fractal on the current bar is never used early', () => {
  const raw = [
    { time: 1, vel: 1, acc: -0.1 },
    { time: 2, vel: 0.5, acc: -0.6 }, // fractal low (−0.6) only known at t=3
    { time: 3, vel: -0.2, acc: -0.3 },
    { time: 4, vel: -0.6, acc: -0.7 },
  ];
  assert.deepEqual(confirmVaccSignals(raw).map(p => [p.state, p.pending]), [[null, null], [null, null], [null, 'short'], ['short', null]]);
});

test('acceleration area sums only same-direction bars; velocity peak is signed by direction', () => {
  const points = confirmVaccSignals([
    { time: 1, vel: 0.2, acc: 0.2 }, { time: 2, vel: 0.5, acc: 0.3 },
    { time: 3, vel: 0.4, acc: -0.1 }, { time: 4, vel: 0.6, acc: 0.2 },
  ]);
  near(accelerationArea(points, 1, 4, 'up'), 0.7);
  near(accelerationArea(points, 1, 4, 'down'), -0.1);
  assert.equal(velocityPeak(points, 1, 4, 'up'), 0.6);
  assert.equal(velocityPeak(points, 1, 4, 'down'), 0.2);
  assert.equal(velocityPeak(points, 9, 10, 'up'), null);
});
