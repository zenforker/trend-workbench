import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { analyze } from '../lib/chan.ts';
import type { Candle, MarketData, TradePlan, TradePlanSession } from '../lib/market-types';

/** Offline, independent signal-event research. Never submits orders or changes
 * the live plan state. Defaults are fixed before the chronological holdout. */
export interface ResearchCosts { feeBps: number; slippageBps: number }
export interface ResearchInput {
  primary: MarketData;
  higher?: MarketData;
  label?: string;
  holdoutFraction?: number;
  costs?: ResearchCosts;
}
export interface TriggerEvent {
  plan: TradePlan;
  triggerIndex: number;
  shadowAccepted: boolean;
  evidence: unknown;
}
export interface EventOutcome {
  id: string;
  side: 'long' | 'short';
  triggeredAt: number;
  shadowAccepted: boolean;
  status: 'closed' | 'open' | 'no_next_bar' | 'skipped_entry';
  reason: string;
  entryAt?: number;
  entryPrice?: number;
  exitAt?: number;
  exitPrice?: number;
  exitReason?: 'stop' | 'gap_stop' | 'ambiguous_stop_first' | 'target2';
  netReturnPct?: number;
  netR?: number;
  evidence: unknown;
}

const DEFAULT_COSTS: ResearchCosts = { feeBps: 5, slippageBps: 3 };
const positive = (value: number) => Number.isFinite(value) && value > 0;

function validateCosts(costs: ResearchCosts) {
  for (const key of ['feeBps', 'slippageBps'] as const) {
    const value = costs[key];
    if (!Number.isFinite(value) || value < 0 || value >= 1000) throw new Error(`${key} must be between 0 and 1000 basis points.`);
  }
}

export function validateResearchBars(candles: Candle[]): Candle[] {
  const closed: Candle[] = [];
  let lastTime = -Infinity;
  let unfinished = false;
  for (const b of candles) {
    if (!positive(b.time) || b.time <= lastTime) throw new Error('Research bars must have unique, increasing timestamps.');
    lastTime = b.time;
    if (![b.open, b.high, b.low, b.close].every(positive) || b.high < Math.max(b.open, b.close) || b.low > Math.min(b.open, b.close) || !Number.isFinite(b.volume) || b.volume < 0) throw new Error('Invalid OHLCV in research input.');
    if (b.closed === false) { unfinished = true; continue; }
    if (unfinished) throw new Error('An unfinished candle cannot precede a later closed candle.');
    closed.push(b);
  }
  return closed;
}

/** Enter at the following supplied bar's open only if the adverse-slippage fill
 * remains in the original entry band. Gap exits use the worse opening price.
 * An OHLC bar touching both stop and target is resolved stop-first. */
export function simulateEvent(event: TriggerEvent, candles: Candle[], costs: ResearchCosts = DEFAULT_COSTS): EventOutcome {
  validateCosts(costs);
  const p = event.plan, buy = p.side === 'long', direction = buy ? 1 : -1;
  const trigger = candles[event.triggerIndex];
  if (!trigger || p.triggeredAt !== trigger.time || p.generatedAt >= trigger.time) throw new Error('Event must match a first trigger after plan creation.');
  if (!(p.entryLow <= p.entryHigh && (buy ? p.stopLoss < p.entryLow && p.target2 > p.entryHigh : p.stopLoss > p.entryHigh && p.target2 < p.entryLow))) throw new Error('Invalid frozen plan geometry.');
  const result: EventOutcome = { id: p.id, side: p.side, triggeredAt: trigger.time, shadowAccepted: event.shadowAccepted, status: 'no_next_bar', reason: 'No following closed candle is available; no fill is assumed.', evidence: event.evidence };
  const next = candles[event.triggerIndex + 1];
  if (!next || next.closed === false) return result;
  const slip = costs.slippageBps / 10000, fee = costs.feeBps / 10000;
  const entry = next.open * (1 + direction * slip);
  if (entry < p.entryLow || entry > p.entryHigh) return { ...result, status: 'skipped_entry', reason: 'The next opening fill, including adverse slippage, lies outside the frozen entry band; no chase or later fill is assumed.' };
  Object.assign(result, { status: 'open', reason: 'Entered, but neither stop nor T2 has completed before the sample ends; excluded from completed-trade averages.', entryAt: next.time, entryPrice: entry });
  for (let i = event.triggerIndex + 1; i < candles.length; i++) {
    const b = candles[i];
    if (b.closed === false) break;
    const gapStop = buy ? b.open <= p.stopLoss : b.open >= p.stopLoss;
    const stopped = buy ? b.low <= p.stopLoss : b.high >= p.stopLoss;
    const targeted = buy ? b.high >= p.target2 : b.low <= p.target2;
    if (!stopped && !targeted) continue;
    const exitReason: EventOutcome['exitReason'] = gapStop ? 'gap_stop' : stopped && targeted ? 'ambiguous_stop_first' : stopped ? 'stop' : 'target2';
    const rawExit = gapStop ? b.open : stopped ? p.stopLoss : p.target2;
    const exit = rawExit * (1 - direction * slip);
    const netPnl = direction * (exit - entry) - fee * (entry + exit);
    return { ...result, status: 'closed', reason: 'Closed using frozen stop/T2 and explicit adverse costs; this is a model outcome, not a fill record.', exitAt: b.time, exitPrice: exit, exitReason, netReturnPct: netPnl / entry * 100, netR: netPnl / Math.abs(entry - p.stopLoss) };
  }
  return result;
}

export function summarizeOutcomes(outcomes: EventOutcome[]) {
  const completed = outcomes.filter(o => o.status === 'closed');
  const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return {
    triggered: outcomes.length,
    executed: outcomes.filter(o => o.entryPrice !== undefined).length,
    completed: completed.length,
    openAtEnd: outcomes.filter(o => o.status === 'open').length,
    noNextBar: outcomes.filter(o => o.status === 'no_next_bar').length,
    skippedEntry: outcomes.filter(o => o.status === 'skipped_entry').length,
    ambiguousStopFirst: completed.filter(o => o.exitReason === 'ambiguous_stop_first').length,
    wins: completed.filter(o => o.netReturnPct! > 0).length,
    observedWinPct: completed.length ? completed.filter(o => o.netReturnPct! > 0).length / completed.length * 100 : null,
    meanCompletedReturnPct: average(completed.map(o => o.netReturnPct!)),
    meanCompletedR: average(completed.map(o => o.netR!)),
    evidenceSufficient: false,
  };
}

export function compareEvents(candles: Candle[], events: TriggerEvent[], costs: ResearchCosts = DEFAULT_COSTS) {
  const outcomes = events.map(event => simulateEvent(event, candles, costs));
  const shadow = outcomes.filter(o => o.shadowAccepted);
  return {
    baseline: summarizeOutcomes(outcomes),
    shadow: summarizeOutcomes(shadow),
    bySide: Object.fromEntries((['long', 'short'] as const).map(side => [side, { baseline: summarizeOutcomes(outcomes.filter(o => o.side === side)), shadow: summarizeOutcomes(shadow.filter(o => o.side === side)) }])),
    outcomes,
  };
}

/** Re-run each historical prefix. The full higher feed is passed intentionally:
 * the production availability filter must remove all unavailable future bars.
 * Only exact fresh triggers at the current prefix are recorded. */
export function collectHoldoutEvents(input: ResearchInput) {
  const candles = validateResearchBars(input.primary.candles);
  const fraction = input.holdoutFraction ?? .3;
  if (!(fraction > 0 && fraction <= .5)) throw new Error('Holdout fraction must be >0 and <=0.5.');
  if (candles.length < 80) throw new Error('At least 80 closed bars are required for a chronological holdout.');
  if (input.higher && (input.higher.instrument.symbol !== input.primary.instrument.symbol || input.higher.instrument.market !== input.primary.instrument.market)) throw new Error('The higher timeframe must belong to the same instrument and market.');
  const holdoutStart = Math.max(60, Math.floor(candles.length * (1 - fraction)));
  let session: TradePlanSession | undefined;
  const seen = new Set<string>(), events: TriggerEvent[] = [];
  const evidenceCoverage = { snapshots: 0, vaccReady: 0, volumeReady: 0, higherStatuses: {} as Record<string, number> };
  // First prefix establishes state on the warm-up only. Later prefixes advance
  // one candle at a time, so earlier terminal plans cannot hide fresh events.
  for (let index = holdoutStart - 1; index < candles.length; index++) {
    const analysis = analyze(candles.slice(0, index + 1), {
      planSession: session,
      skipCalibration: true,
      context: { market: input.primary.instrument.market, symbol: input.primary.instrument.symbol, interval: input.primary.interval, source: input.primary.source, adjustment: input.primary.adjustment,
        higher: input.higher ? { interval: input.higher.interval, status: 'ready', data: input.higher } : { interval: null, status: 'none' } },
    });
    session = analysis.planSession;
    if (index < holdoutStart) continue;
    evidenceCoverage.snapshots++;
    if (analysis.confluence?.vacc.status === 'ready') evidenceCoverage.vaccReady++;
    if (analysis.confluence?.volume.status === 'ready') evidenceCoverage.volumeReady++;
    const higherStatus = analysis.confluence?.higher.status ?? 'missing-confluence';
    evidenceCoverage.higherStatuses[higherStatus] = (evidenceCoverage.higherStatuses[higherStatus] ?? 0) + 1;
    for (const plan of analysis.tradePlans) {
      if (plan.status !== 'triggered' || plan.triggeredAt !== candles[index].time || seen.has(plan.id)) continue;
      seen.add(plan.id);
      const evidence = analysis.confluence?.[plan.side];
      events.push({ plan: structuredClone(plan), triggerIndex: index, shadowAccepted: evidence?.status === 'aligned', evidence: evidence ? structuredClone(evidence) : { status: 'insufficient' } });
    }
  }
  return { candles, events, holdoutStart, evidenceCoverage };
}

export function researchComparison(input: ResearchInput) {
  const costs = input.costs ?? DEFAULT_COSTS;
  validateCosts(costs);
  const { candles, events, holdoutStart, evidenceCoverage } = collectHoldoutEvents(input);
  const comparison = compareEvents(candles, events, costs);
  const filterExclusions: Record<string, number> = {};
  for (const event of events) {
    const evidence = event.evidence as { evidence?: { status: string; code: string }[] };
    for (const item of evidence.evidence ?? []) if (item.status !== 'aligned') filterExclusions[item.code] = (filterExclusions[item.code] ?? 0) + 1;
  }
  return {
    label: input.label ?? `${input.primary.instrument.symbol} ${input.primary.interval}`,
    generatedAt: new Date().toISOString(),
    method: 'Chronological holdout; frozen production plans; first-trigger events; strict three-group aligned shadow filter; next-bar open within original entry band; fixed stop/T2; adverse fees and slippage on both sides.',
    data: { symbol: input.primary.instrument.symbol, market: input.primary.instrument.market, interval: input.primary.interval, source: input.primary.source, adjustment: input.primary.adjustment, capturedAt: input.primary.asOf, higherInterval: input.higher?.interval ?? null, higherSource: input.higher?.source ?? null, firstBar: candles[0].time, lastBar: candles.at(-1)!.time, totalClosedBars: candles.length, warmupBars: holdoutStart, holdoutBars: candles.length - holdoutStart, holdoutFirstBar: candles[holdoutStart].time },
    costs,
    evidenceCoverage,
    filterExclusions,
    limitations: [
      'Fixed thresholds were not tuned on the holdout. This small one-window comparison cannot establish improvement or justify enabling a live entry filter.',
      'Independent overlapping signal events, not a portfolio backtest. No compounded return or portfolio maximum drawdown is claimed.',
      'Next-bar fills assume timely knowledge of the prior close. Public-feed latency, exchange outages, partial fills and order-book liquidity are not simulated.',
      'Borrowing availability/cost, funding, taxes, corporate-action point-in-time revisions and exchange-specific trading restrictions are not modeled.',
      ...(input.primary.instrument.market === 'cn' ? ['A-share short events are directional research only; ordinary accounts cannot execute them. T+1 and price-limit constraints are not modeled, so these results are not executable A-share strategy performance.'] : []),
      'Open and no-next-bar events are censored and excluded from completed-trade averages. Skipped opening entries never receive a later favorable fill.',
      'Higher-timeframe absence or insufficient history rejects shadow inclusion. No missing evidence is substituted with neutral confirmation.',
    ],
    activationRecommendation: 'Keep the new evidence advisory; do not activate the shadow filter from this report.',
    ...comparison,
  };
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error('Usage: node --experimental-strip-types scripts/compare-confluence.ts input.json output.json');
  const input = JSON.parse(await readFile(resolve(inputPath), 'utf8')) as ResearchInput;
  const report = researchComparison(input);
  await writeFile(resolve(outputPath), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ label: report.label, baseline: report.baseline, shadow: report.shadow, output: resolve(outputPath) }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
