// Modified for the Natural Chan fork: VAcc (velocity/acceleration) replaces MACD.
// Formula follows 《自然缠》第五章 (5-2)–(5-4) and TASC Sep 2023, Scott Cong.

export interface VaccParams { n: number; m: number }
export const VACC_DEFAULTS: Readonly<VaccParams> = Object.freeze({ n: 30, m: 7 });

export type VaccSide = 'long' | 'short';
/** One closed bar. `state` is the confirmed side as of this bar's close;
 * `pending` is an unconfirmed velocity zero-cross awaiting acceleration
 * confirmation. Both use only data at or before this bar. */
export interface VaccPoint {
  time: number;
  vel: number;
  acc: number;
  state: VaccSide | null;
  pending: VaccSide | null;
}

type Bar = { time: number; close: number };

/** Average velocity over n bars: (1/n)·Σ_{i=1..n} (C − C_i)/i.
 * Defined only once n earlier closes exist. */
export function averageVelocity(closes: readonly number[], index: number, n: number): number | null {
  if (index < n) return null;
  const c = closes[index];
  let sum = 0;
  for (let i = 1; i <= n; i++) sum += (c - closes[index - i]) / i;
  return sum / n;
}

/** Vel = EMA_m(V(n)), seeded with the first defined V (pandas ewm adjust=False);
 * acc = Vel − Vel₁. The first point is the first bar with both defined. */
export function computeVacc(bars: readonly Bar[], params: VaccParams = VACC_DEFAULTS): VaccPoint[] {
  const { n, m } = params;
  if (!Number.isInteger(n) || n < 1 || !Number.isFinite(m) || m < 1) throw new Error('Invalid VAcc parameters');
  const closes = bars.map(b => b.close), alpha = 2 / (m + 1);
  const raw: { time: number; vel: number; acc: number }[] = [];
  let vel: number | null = null;
  for (let i = 0; i < bars.length; i++) {
    const v = averageVelocity(closes, i, n);
    if (v === null || !Number.isFinite(v)) continue;
    const previous: number | null = vel;
    vel = previous === null ? v : previous + alpha * (v - previous);
    if (previous !== null) raw.push({ time: bars[i].time, vel, acc: vel - previous });
  }
  return confirmVaccSignals(raw);
}

/** Confirmation filter (VAcc Against MACD, §4): a velocity zero-cross only
 * creates a candidate. A long confirms when acc rises above the most recent
 * acc fractal high that is itself > 0; a short when acc falls below the most
 * recent fractal low that is < 0. A fractal at k needs acc[k+1], so it becomes
 * usable from bar k+1 onward — never earlier. */
export function confirmVaccSignals(raw: readonly { time: number; vel: number; acc: number }[]): VaccPoint[] {
  let state: VaccSide | null = null, pending: VaccSide | null = null;
  let refHigh: number | null = null, refLow: number | null = null;
  return raw.map((p, t) => {
    if (t >= 2) {
      const a = raw[t - 2].acc, b = raw[t - 1].acc, c = p.acc;
      if (b > a && b > c) refHigh = b;
      if (b < a && b < c) refLow = b;
    }
    const prevVel = t ? raw[t - 1].vel : p.vel;
    if (prevVel <= 0 && p.vel > 0) pending = state === 'long' ? null : 'long';
    if (prevVel >= 0 && p.vel < 0) pending = state === 'short' ? null : 'short';
    if (pending === 'long' && p.vel > 0 && refHigh !== null && refHigh > 0 && p.acc > refHigh) { state = 'long'; pending = null; }
    else if (pending === 'short' && p.vel < 0 && refLow !== null && refLow < 0 && p.acc < refLow) { state = 'short'; pending = null; }
    return { ...p, state, pending };
  });
}

/** Sum of same-signed acceleration inside [from, to] (inclusive times).
 * Up structures sum positive bars; down structures sum negative bars. */
export function accelerationArea(points: readonly VaccPoint[], from: number, to: number, direction: 'up' | 'down'): number {
  let sum = 0;
  for (const p of points) {
    if (p.time < from || p.time > to) continue;
    if (direction === 'up' ? p.acc > 0 : p.acc < 0) sum += p.acc;
  }
  return sum;
}

/** Signed velocity peak inside [from, to]: max Vel for up, min Vel for down. */
export function velocityPeak(points: readonly VaccPoint[], from: number, to: number, direction: 'up' | 'down'): number | null {
  let peak: number | null = null;
  for (const p of points) {
    if (p.time < from || p.time > to) continue;
    if (peak === null || (direction === 'up' ? p.vel > peak : p.vel < peak)) peak = p.vel;
  }
  return peak;
}
