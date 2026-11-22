import type { Candle, Interval, Market, MarketData } from './market-types';

export type ConfluenceDirection = 'long' | 'short' | 'neutral';
export type ConfluenceStatus = 'aligned' | 'mixed' | 'opposed' | 'insufficient';
export type HigherConfluenceStatus = 'ready' | 'loading' | 'error' | 'none' | 'imported' | 'insufficient' | 'stale' | 'mismatch';
export interface ConfluenceContext {
  market: Market;
  interval: Interval;
  symbol?: string;
  source?: string;
  adjustment?: string;
  higher?: { interval: Interval | null; status: 'ready' | 'loading' | 'error' | 'none' | 'imported'; data?: MarketData };
}
export interface AnalysisInput {
  market: Market;
  interval: Interval;
  symbol?: string;
  source?: string;
  adjustment?: string;
  count: number;
  firstTime: number | null;
  lastBar: Candle | null;
}
/** VAcc evidence. `direction` is the acceleration-confirmed side while Vel is
 * still on that side of zero; `pending` is an unconfirmed Vel zero-cross. */
export interface VaccConfluence {
  status: 'ready' | 'insufficient';
  direction: ConfluenceDirection;
  pending: 'long' | 'short' | null;
  momentum: 'strengthening' | 'weakening' | 'flat';
  vel: number | null;
  acc: number | null;
  samples: number;
}
export interface VolumeConfluence {
  status: 'ready' | 'insufficient';
  ratio: number | null;
  participation: 'expanded' | 'normal' | 'low' | 'unknown';
  priceDirection: ConfluenceDirection;
  samples: number;
  benchmark: 'same-session-slot' | 'rolling-bars';
  reason: 'ready' | 'short-history' | 'zero-volume' | 'no-context';
}
export interface HigherConfluence {
  interval: Interval | null;
  status: HigherConfluenceStatus;
  direction: ConfluenceDirection;
  bars: number;
  asOf: number | null;
}
export type ConfluenceEvidenceCode =
  | 'vacc-aligned' | 'vacc-weakening' | 'vacc-opposed' | 'vacc-mixed' | 'vacc-pending' | 'vacc-insufficient'
  | 'volume-aligned' | 'volume-opposed' | 'volume-normal' | 'volume-low' | 'volume-insufficient'
  | 'higher-aligned' | 'higher-opposed' | 'higher-neutral' | 'higher-insufficient' | 'higher-loading'
  | 'higher-error' | 'higher-none' | 'higher-imported' | 'higher-stale' | 'higher-mismatch';
export interface ConfluenceEvidence {
  factor: 'vacc' | 'volume' | 'higher';
  status: ConfluenceStatus;
  code: ConfluenceEvidenceCode;
}
export interface ConfluenceSide {
  status: ConfluenceStatus;
  evidence: ConfluenceEvidence[];
}
/** An auxiliary snapshot, never a trigger, probability, or revision of a stored plan. */
export interface Confluence {
  input?: AnalysisInput;
  advisory: true;
  asOf: number;
  vacc: VaccConfluence;
  volume: VolumeConfluence;
  higher: HigherConfluence;
  long: ConfluenceSide;
  short: ConfluenceSide;
}
