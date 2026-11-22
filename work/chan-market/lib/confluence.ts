import type { Candle, Interval, Market } from './market-types';
import type { AnalysisInput, Confluence, ConfluenceContext, ConfluenceDirection, ConfluenceEvidence, ConfluenceSide, HigherConfluence, VaccConfluence, VolumeConfluence } from './confluence-types';
import type { VaccPoint } from './vacc';
import { candleAvailableAt, eligibleHigherCandles, exchangeClock, higherInterval } from './timeframe-context.ts';

const intraday = (interval: Interval) => !['1d', '1w', '1M'].includes(interval);
const direction = (value: number, tolerance = 0): ConfluenceDirection => value > tolerance ? 'long' : value < -tolerance ? 'short' : 'neutral';

/** VAcc is one evidence family (never separate votes). Direction requires the
 * acceleration-confirmed side AND Vel still on that side of zero; an
 * unconfirmed Vel zero-cross is reported as pending. Momentum reads acc
 * relative to Vel: same sign = strengthening, opposite = weakening. */
export function evaluateVaccConfluence(points: readonly VaccPoint[], price: number): VaccConfluence {
  const valid = points.filter(p => [p.time, p.vel, p.acc].every(Number.isFinite));
  const last = valid.at(-1);
  const empty: VaccConfluence = { status: 'insufficient', direction: 'neutral', pending: last?.pending ?? null, momentum: 'flat', vel: last?.vel ?? null, acc: last?.acc ?? null, samples: valid.length };
  if (valid.length < 21 || !last || !Number.isFinite(price) || price <= 0) return empty;
  const tolerance = Math.max(price * 0.000001, Number.EPSILON);
  const side = direction(last.vel, tolerance);
  const confirmed: ConfluenceDirection = last.state !== null && last.state === side ? last.state : 'neutral';
  const momentum = Math.abs(last.acc) <= tolerance * 0.1 || side === 'neutral' ? 'flat'
    : Math.sign(last.acc) === Math.sign(last.vel) ? 'strengthening' : 'weakening';
  return { ...empty, status: 'ready', direction: confirmed, momentum };
}

/** Stock intraday bars compare only the same exchange-local clock slot on
 * earlier dates. A shortened last session bar is never mixed with full bars.
 * Crypto has continuous sessions; longer bars use a rolling same-series base.
 * These are research defaults, not independently validated trading cutoffs. */
export function evaluateRelativeVolume(candles: Candle[], context?: ConfluenceContext): VolumeConfluence {
  const bars = candles.filter(c => c.closed !== false && [c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite) && c.volume >= 0);
  const last = bars.at(-1), slot = !!context && context.market !== 'crypto' && intraday(context.interval);
  const result: VolumeConfluence = { status: 'insufficient', ratio: null, participation: 'unknown', priceDirection: last ? direction(last.close - last.open) : 'neutral', samples: 0, benchmark: slot ? 'same-session-slot' : 'rolling-bars', reason: context ? 'short-history' : 'no-context' };
  if (!context || !last) return result;
  let history = bars.slice(0, -1).filter(c => c.time < last.time);
  if (slot && context.market !== 'crypto') {
    const market = context.market, current = exchangeClock(last.time, market), dates = new Set<string>();
    history = history.filter(c => {
      const clock = exchangeClock(c.time, market);
      if (clock.date >= current.date || clock.minute !== current.minute || dates.has(clock.date)) return false;
      dates.add(clock.date); return true;
    });
  }
  history = history.slice(-20);
  result.samples = history.length;
  if (history.length < (slot ? 5 : 20)) return result;
  // The feeds may encode unavailable volume as zero. Dropping such rows or
  // averaging them as real turnover would invent a stronger volume expansion.
  if (last.volume <= 0 || history.some(c => c.volume <= 0)) return { ...result, reason: 'zero-volume' };
  const average = history.reduce((sum, c) => sum + c.volume, 0) / history.length;
  if (average <= 0) return { ...result, reason: 'zero-volume' };
  const ratio = last.volume / average;
  return { ...result, status: 'ready', ratio, participation: ratio >= 1.2 ? 'expanded' : ratio < 0.8 ? 'low' : 'normal', reason: 'ready' };
}

/** Compare provider/adjustment identity, not presentation-only interval suffixes. */
function provider(source: string): string {
  const value = source.replace(/\s*·\s*真实同源聚合\s*$/i, '').replace(/\s*·\s*(?:30分(?:钟)?|1小时)聚合4小时\s*$/i, '').trim().toLowerCase();
  if (/^yahoo finance/.test(value)) return 'yahoo-finance';
  if (/^腾讯证券/.test(value)) return 'tencent';
  if (/^东方财富/.test(value)) return 'eastmoney';
  if (/^新浪财经/.test(value)) return 'sina';
  return value;
}
function adjustmentKind(value: string): string | null {
  if (/未独立核验|未知|unknown/i.test(value)) return null;
  if (/不复权|unadjusted|no adjustment/i.test(value)) return 'unadjusted';
  if (/后复权|backward adjusted/i.test(value)) return 'backward';
  if (/前复权|forward adjusted/i.test(value)) return 'forward';
  if (/按调整后收盘价等比例调整OHLC/i.test(value)) return 'adjusted-close-ratio';
  if (/来源原始OHLC|未请求复权/i.test(value)) return 'unadjusted';
  return null;
}

// Missing exchange holidays can conservatively withhold an old observation;
// they must never make a future completed candle available in a replay.
function elapsedTradingMinutes(from: number, to: number, market: 'cn' | 'us'): number {
  const start = exchangeClock(from, market), end = exchangeClock(to, market);
  const a = Date.parse(`${start.date}T00:00:00Z`), b = Date.parse(`${end.date}T00:00:00Z`);
  if (b < a || b - a > 370 * 86400000) return Infinity;
  const sessions = market === 'cn' ? [[570,690],[780,900]] : [[570,960]];
  let total = 0;
  for (let d = a; d <= b; d += 86400000) {
    const weekday = new Date(d).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const low = d === a ? start.minute : 0, high = d === b ? end.minute : 1440;
    for (const [open,close] of sessions) total += Math.max(0, Math.min(high,close) - Math.max(low,open));
  }
  return total;
}
function stale(lastAvailable: number, asOf: number, market: Market, interval: Interval): boolean {
  const duration: Record<Interval, number> = { '1m':60,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400,'1d':86400,'1w':604800,'1M':2678400 };
  if (market === 'crypto' || !intraday(interval)) return asOf - lastAvailable > duration[interval] * (interval === '1d' && market !== 'crypto' ? 5 : 2);
  return elapsedTradingMinutes(lastAvailable, asOf, market) > duration[interval] / 60 * 2;
}

/** The callback receives only eligible, completed historical higher bars.
 * Its Chan structure calculation stays in chan.ts; no higher price levels or
 * existing plan fields are spliced into the current timeframe. */
export function evaluateHigherConfluence(context: ConfluenceContext, asOf: number, deriveDirection: (candles: Candle[]) => ConfluenceDirection): HigherConfluence {
  const expected = higherInterval(context.market, context.interval), supplied = context.higher;
  const base: HigherConfluence = { interval: expected, status: 'insufficient', direction: 'neutral', bars: 0, asOf: null };
  if (supplied?.status === 'imported') return { ...base, status: 'imported' };
  if (expected === null) return { ...base, status: 'none' };
  if (!supplied) return base;
  if (supplied.status !== 'ready') return { ...base, status: supplied.status };
  const data = supplied.data;
  if (!data || !context.symbol || !Number.isFinite(asOf) || asOf <= 0) return base;
  if (supplied.interval !== expected || data.interval !== expected || data.instrument.market !== context.market || data.instrument.symbol.toUpperCase() !== context.symbol.toUpperCase()) return { ...base, status: 'mismatch' };
  if (!context.source || !context.adjustment) return base;
  const currentAdjustment = adjustmentKind(context.adjustment), higherAdjustment = adjustmentKind(data.adjustment);
  if (provider(context.source) !== provider(data.source) || !currentAdjustment || !higherAdjustment || currentAdjustment !== higherAdjustment) return { ...base, status: 'mismatch' };
  // Validate order without sorting malformed data into apparently valid history.
  const capturedAt = Date.parse(data.asOf) / 1000;
  const eligible = eligibleHigherCandles(data, Math.min(asOf, capturedAt)), bars: Candle[] = [];
  for (const c of eligible) {
    if (![c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite) || c.low <= 0 || c.high < Math.max(c.open,c.close) || c.low > Math.min(c.open,c.close) || c.volume < 0 || (bars.length && c.time <= bars[bars.length-1].time)) continue;
    bars.push(c);
  }
  const last = bars.at(-1), latest = last ? candleAvailableAt(last, context.market, expected, data.source) : null;
  const result = { ...base, bars: bars.length, asOf: latest };
  if (bars.length < 35 || latest === null) return result;
  if (stale(latest, asOf, context.market, expected)) return { ...result, status: 'stale' };
  return { ...result, status: 'ready', direction: deriveDirection(bars) };
}

export function assessConfluenceSide(side: 'long' | 'short', vacc: VaccConfluence, volume: VolumeConfluence, higher: HigherConfluence): ConfluenceSide {
  const m: ConfluenceEvidence = vacc.status !== 'ready' ? { factor:'vacc',status:'insufficient',code:'vacc-insufficient' }
    : vacc.direction === 'neutral' ? { factor:'vacc',status:'mixed',code:vacc.pending ? 'vacc-pending' : 'vacc-mixed' }
      : vacc.direction !== side ? { factor:'vacc',status:'opposed',code:'vacc-opposed' }
        : vacc.momentum === 'weakening' ? { factor:'vacc',status:'mixed',code:'vacc-weakening' }
          : { factor:'vacc',status:'aligned',code:'vacc-aligned' };
  const v: ConfluenceEvidence = volume.status !== 'ready' ? { factor:'volume',status:'insufficient',code:'volume-insufficient' }
    : volume.participation === 'low' ? { factor:'volume',status:'mixed',code:'volume-low' }
      : volume.participation !== 'expanded' || volume.priceDirection === 'neutral' ? { factor:'volume',status:'mixed',code:'volume-normal' }
        : volume.priceDirection === side ? { factor:'volume',status:'aligned',code:'volume-aligned' }
          : { factor:'volume',status:'opposed',code:'volume-opposed' };
  const h: ConfluenceEvidence = higher.status !== 'ready' ? { factor:'higher',status:'insufficient',code:`higher-${higher.status}` }
    : higher.direction === 'neutral' ? { factor:'higher',status:'mixed',code:'higher-neutral' }
      : higher.direction === side ? { factor:'higher',status:'aligned',code:'higher-aligned' }
        : { factor:'higher',status:'opposed',code:'higher-opposed' };
  const evidence = [m,v,h];
  // Conjunction and explicit disagreement, not a weighted indicator vote.
  const status = evidence.some(e => e.status === 'insufficient') ? 'insufficient'
    : evidence.every(e => e.status === 'aligned') ? 'aligned'
      : m.status === 'opposed' && h.status === 'opposed' ? 'opposed' : 'mixed';
  return { status, evidence };
}

export function buildConfluence(candles: Candle[], vaccPoints: readonly VaccPoint[], context: ConfluenceContext, deriveHigherDirection: (candles: Candle[]) => ConfluenceDirection): Confluence {
  const bars = candles.filter(c => c.closed !== false), last = bars.at(-1);
  const asOf = last ? candleAvailableAt(last, context.market, context.interval, context.source) : 0;
  const vacc = evaluateVaccConfluence(vaccPoints, last?.close ?? 0), volume = evaluateRelativeVolume(bars, context);
  const higher = evaluateHigherConfluence(context, asOf, deriveHigherDirection);
  const { market, interval, symbol, source, adjustment } = context;
  const input: AnalysisInput = { market, interval, symbol, source, adjustment, count:bars.length,
    firstTime:bars[0]?.time ?? null, lastBar:last ? {...last} : null };
  return { advisory:true,input,asOf,vacc,volume,higher,long:assessConfluenceSide('long',vacc,volume,higher),short:assessConfluenceSide('short',vacc,volume,higher) };
}
