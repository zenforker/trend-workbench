import type { AnalysisInput, Confluence } from './confluence-types';
import type { VaccParams, VaccPoint } from './vacc';

export type Market = 'crypto' | 'us' | 'cn';
export type Interval = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1M';
export interface Instrument { id: string; symbol: string; name: string; market: Market; exchange: string; currency: string }
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; closed?: boolean }
export interface MarketData { instrument: Instrument; interval: Interval; candles: Candle[]; source: string; asOf: string; delayNotice: string; adjustment: string; warnings: string[]; availableIntervals: Interval[]; history?: {requested:number;received:number;closed:number;firstTime:number|null;lastTime:number|null;status:'target-met'|'limited'|'insufficient'} }
export interface Point { index: number; time: number; price: number }
export interface StructurePriceRange { low:number; high:number; lowPoint:Point; highPoint:Point }
/** kind (Natural Chan only): 'quasi' = 类笔/类段/类趋势 formed by breaking the previous line's start. */
export interface StructureLine { from: Point; to: Point; direction: 'up' | 'down'; confirmed: boolean; confirmedAt: number; priceRange?:StructurePriceRange; kind?:'standard'|'quasi' }
export interface Fractal extends Point { type: 'top' | 'bottom'; confirmedAt: number }
export interface Center { startIndex: number; endIndex: number; low: number; high: number; level: string; status: 'active' | 'broken' }
export interface Signal extends Point { label: string; side: 'long' | 'short'; type: string; confirmed: boolean; reason: string }
export interface Factor { name: string; value: number; detail: string }
export interface Scenario { side: 'long' | 'short' | 'range'; title: string; trigger: string; invalidation: string; target: string; points: { offset: number; price: number }[] }
/** A conditional observation boundary, never a pre-known future execution price.
 * anchor is an observed historical point; offset is display spacing, not a date. */
export interface TradeSetup { id: string; side: 'long' | 'short'; label: string; kind: 'third-buy-watch' | 'third-sell-watch' | 'buy-watch' | 'sell-watch'; status: 'conditional'; price: number; invalidationPrice: number; trigger: string; invalidation: string; basis: string; anchor: Point; offset: number }
export type TradePlanStatus = 'untriggered' | 'triggered' | 'invalidated' | 'target_reached';
export interface TradePlan {
  id:string; side:'long'|'short'; label:string; strategy:string;
  priority:'primary'|'alternative'|'balanced'; status:TradePlanStatus; statusLabel:string;
  entryLow:number; entryHigh:number; triggerPrice:number; stopLoss:number;
  target1:number; target2:number; rr1:number; rr2:number; anchor:Point;
  generatedAt:number; generatedIndex:number; triggeredAt?:number; statusAt?:number;
  evaluatedThrough?:number; evaluatedBars?:number;
  atr:number; basis:string; trigger:string; invalidation:string; statusReason:string;
  previousOutcome?:{status:'invalidated'|'target_reached';statusAt:number;reason:string};
}
export interface TradePlanSession { version:1; asOf:number; close:number; plans:TradePlan[] }
export interface TradeDecision {
  /** Presentation/tracking focus, never an order instruction. */
  direction:'long'|'short'|'neutral';
  biasDirection:'long'|'short'|'neutral';
  state:'unavailable'|'waiting'|'tracking'|'conflict';
  title:string; summary:string; asOf:number;
}
export interface Analysis { input?: AnalysisInput; fractals: Fractal[]; strokes: StructureLine[]; segments: StructureLine[]; /** 本级别趋势 = segments one level up (Natural Chan); empty for classic pens. */ trends: StructureLine[]; /** Raw candle index of the latest structural event (natural: last stroke established/formed/merged; classic: last bar); -1 if none. */ structureAsOf: number; centers: Center[]; signals: Signal[]; vacc: VaccPoint[]; vaccParams: VaccParams; /** Time of the last closed bar analyzed; 0 when none. */ analyzedThrough: number; scenarios: Scenario[]; tradeSetups: TradeSetup[]; tradePlans:TradePlan[]; planSession?:TradePlanSession; decision:TradeDecision; confluence?:Confluence; bias: {long: number; short: number; label: string; factors: Factor[]}; calibration: {samples: number; up: number; down: number; flat: number; horizon: number; threshold: number; wilsonLow: number; wilsonHigh: number; method: string; asOf: string}; warnings: string[]; ruleVersion: string }
