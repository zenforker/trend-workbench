import type { Analysis, Candle, Point, StructureLine } from './market-types';
import type { ForecastBasisCode, ForecastContext, ForecastDirection, ForecastLevel, ForecastNoticeCode, ForecastReasonCode, ForecastSide, ForecastSource, MarketForecast, ReadyForecastSide, TimeframeAssessment } from './forecast-types';
import { candleAvailableAt, higherInterval } from './timeframe-context.ts';
import { evaluateMarketRegime } from './market-regime.ts';
import type { AnalysisInput } from './confluence-types';

export const FORECAST_MODEL_VERSION='forecast-2.1';
export const FORECAST_PARAMETER_VERSION='chan-atr14-v1';

type Bar=Candle&{index:number};
const positive=(value:number)=>Number.isFinite(value)&&value>0;
const duration={ '1m':60,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400,'1d':86400,'1w':604800,'1M':2678400 };
const unique=<T,>(values:T[])=>[...new Set(values)];
const blankSide=(side:'long'|'short'):ForecastSide=>({side,status:'insufficient',id:null,kind:side==='long'?'breakout':'breakdown',zoneLow:null,zoneHigh:null,triggerPrice:null,invalidationPrice:null,targets:null,anchor:null,basis:[],triggerRule:side==='long'?'close-above':'close-below'});

type FeedClock = Pick<ForecastContext, 'market'|'interval'|'source'>;
export function marketSnapshotCutoff(capturedAt:string, nowMs=Date.now()):number {
  const instant=Math.min(Date.parse(capturedAt),nowMs);
  return Number.isFinite(instant) ? instant/1000 : 0;
}

function availableAt(bar:Candle,context:FeedClock):number {
  if(!Number.isFinite(bar.time)||!Number.isFinite(new Date(bar.time*1000).getTime()))return Infinity;
  if(bar.closed!==false)return candleAvailableAt(bar,context.market,context.interval,context.source);
  // Provider-labelled minute bars carry an in-progress quote before their end.
  // Aggregated equity 4H bars already carry the session bucket's start time.
  const endLabel=['1m','5m','15m','30m','1h'].includes(context.interval)
    &&(context.market==='cn'||context.market==='us'&&/东方财富|Eastmoney|周期结束/i.test(context.source));
  return endLabel ? bar.time-duration[context.interval] : bar.time;
}

/** Use the same observable bars for chart, structure, auxiliary evidence and monitoring. */
export function availableForecastCandles(candles:Candle[],context:FeedClock,asOf:number):Candle[] {
  return Number.isFinite(asOf) ? candles.filter(bar=>availableAt(bar,context)<=asOf) : [];
}

function validBars(candles:Candle[],context:ForecastContext) {
  const bars:Bar[]=[],notices:ForecastNoticeCode[]=[];
  const cutoff=Number.isFinite(context.asOf)?context.asOf!:null;
  for(let index=0;index<candles.length;index++) {
    const c=candles[index];
    if(![c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)||!Number.isFinite(new Date(c.time*1000).getTime())||c.time<=0||c.low<=0||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.volume<0||(bars.length&&c.time<=bars[bars.length-1].time)) {notices.push('invalid-candles-excluded');continue;}
    // An end-labelled forming minute bar can legitimately carry a quote before
    // its timestamp. A completed bar must have been available by the cutoff.
    if(cutoff!==null&&availableAt(c,context)>cutoff){notices.push('future-candles-excluded');continue;}
    bars.push({...c,index});
  }
  return {bars,notices:unique(notices)};
}

function atr14(bars:Bar[]) {
  const first=Math.max(0,bars.length-14);
  return bars.slice(first).reduce((total,c,i)=>{
    const previous=bars[first+i-1]?.close??c.open;
    return total+Math.max(c.high-c.low,Math.abs(c.high-previous),Math.abs(c.low-previous))/Math.min(14,bars.length);
  },0);
}

/** Accept only anchors and confirmation events actually present in the closed prefix. */
function confirmedLevels(bars:Bar[],analysis:Analysis):ForecastLevel[] {
  const byIndex=new Map(bars.map(b=>[b.index,b])),last=bars.at(-1);
  if(!last)return [];
  const levels:ForecastLevel[]=[];
  const pointValid=(p:Point)=>{
    const b=byIndex.get(p.index);
    return !!b&&p.time===b.time&&positive(p.price)&&p.price>=b.low&&p.price<=b.high;
  };
  const add=(p:Point,source:ForecastSource,confirmedAt:number,activityIndex=p.index)=>{
    if(!pointValid(p)||!byIndex.has(confirmedAt)||confirmedAt<p.index||activityIndex<last.index-160)return;
    levels.push({price:p.price,time:p.time,index:p.index,confirmedAt,source,estimated:false});
  };
  for(const f of analysis.fractals)if(f.confirmedAt>f.index)add(f,'confirmed-fractal',f.confirmedAt);
  const rangeValid=(line:StructureLine)=>{
    const r=line.priceRange;
    return !r||positive(r.low)&&positive(r.high)&&r.low<=Math.min(line.from.price,line.to.price)&&r.high>=Math.max(line.from.price,line.to.price)
      &&r.lowPoint?.price===r.low&&r.highPoint?.price===r.high
      &&[r.lowPoint,r.highPoint].every(p=>pointValid(p)&&p.index>=line.from.index&&p.index<=line.to.index&&p.time>=line.from.time&&p.time<=line.to.time);
  };
  const eligibleLine=(line:StructureLine)=>line.confirmed&&byIndex.has(line.confirmedAt)&&line.confirmedAt>=line.to.index&&pointValid(line.from)&&pointValid(line.to)&&rangeValid(line);
  const range=(line:StructureLine)=>line.priceRange??{low:Math.min(line.from.price,line.to.price),high:Math.max(line.from.price,line.to.price)};
  for(const line of analysis.strokes.filter(eligibleLine))for(const p of [line.from,line.to])add(p,'confirmed-stroke',line.confirmedAt);
  const segments=analysis.segments.filter(eligibleLine);
  for(const center of analysis.centers) {
    // Center objects have no confirmation timestamp. Verify their constituent
    // confirmed segments before admitting either boundary to this snapshot.
    if(center.endIndex>last.index||center.endIndex<last.index-160||!(center.low<center.high))continue;
    const group=segments.filter(s=>s.from.index>=center.startIndex&&s.to.index<=center.endIndex);
    if(group.length<3||group[0].from.index!==center.startIndex||group.at(-1)!.to.index!==center.endIndex)continue;
    if(group.some((line,i)=>line.from.index>=line.to.index
      ||(line.direction==='up'?line.from.price>=line.to.price:line.from.price<=line.to.price)
      ||(i>0&&(group[i-1].direction===line.direction||group[i-1].to.index!==line.from.index
        ||group[i-1].to.time!==line.from.time||group[i-1].to.price!==line.from.price))))continue;
    const first=group.slice(0,3),low=Math.max(...first.map(s=>range(s).low)),high=Math.min(...first.map(s=>range(s).high));
    if(low!==center.low||high!==center.high)continue;
    if(group.slice(3).some(s=>range(s).low>high||range(s).high<low))continue;
    const known=Math.max(...group.map(s=>s.confirmedAt));
    for(const price of [low,high]) {
      // Fixed boundaries remain relevant while confirmed segments extend the
      // center. Preserve the actual boundary anchor, preferring its latest touch.
      const p=group.flatMap(s=>s.priceRange?[s.from,s.to,s.priceRange.lowPoint,s.priceRange.highPoint]:[s.from,s.to]).filter(p=>p.price===price).sort((a,b)=>b.index-a.index)[0];
      if(p)add(p,'confirmed-center',known,center.endIndex);
    }
  }
  const preference:Record<ForecastSource,number>={'confirmed-center':0,'confirmed-stroke':1,'confirmed-fractal':2,'atr-reference':3};
  // Keep the strongest source for identical levels, with the most recent anchor.
  return levels.sort((a,b)=>preference[a.source]-preference[b.source]||(b.index??0)-(a.index??0)).filter((level,i,all)=>all.findIndex(p=>p.price===level.price)===i);
}

function estimated(price:number):ForecastLevel {return {price,source:'atr-reference',estimated:true,time:null,index:null,confirmedAt:null};}

function readySide(side:'long'|'short',price:number,vol:number,direction:ForecastDirection,support:ForecastLevel,resistance:ForecastLevel,levels:ForecastLevel[],context:ForecastContext):ReadyForecastSide {
  const buy=side==='long';
  const retest=direction===side&&!(buy?support:resistance).estimated&&Math.abs((buy?support:resistance).price-price)<=vol*1.5;
  const anchor=retest?(buy?support:resistance):(buy?resistance:support);
  const kind=buy?(retest?'pullback':'breakout'):(retest?'rebound':'breakdown');
  const zoneLow=retest?anchor.price-vol*.12:buy?anchor.price+vol*.1:anchor.price-vol*.35;
  const zoneHigh=retest?anchor.price+vol*.12:buy?anchor.price+vol*.35:anchor.price-vol*.1;
  // Retests reclaim/reject the actual structural level within the band. Using
  // the far band edge would leave only one exact close eligible for a retest.
  const triggerPrice=retest?anchor.price:(buy?zoneLow:zoneHigh);
  const invalidationPrice=anchor.price+(buy?-1:1)*vol*(retest?.55:.45);
  const conservativeEntry=buy?zoneHigh:zoneLow,risk=Math.abs(conservativeEntry-invalidationPrice);
  const targetLevels=levels.filter(l=>buy?l.price>conservativeEntry+vol*.3:l.price<conservativeEntry-vol*.3).filter(l=>Math.abs(l.price-conservativeEntry)<=vol*8).sort((a,b)=>buy?a.price-b.price:b.price-a.price);
  const first=targetLevels[0]??estimated(conservativeEntry+(buy?1:-1)*Math.max(risk*1.5,vol));
  const second=targetLevels.find(l=>buy?l.price>first.price+vol*.25:l.price<first.price-vol*.25)??estimated(buy?Math.max(conservativeEntry+risk*2.5,first.price+vol):Math.min(conservativeEntry-risk*2.5,first.price-vol));
  const basis:ForecastBasisCode[]=unique([anchor.source,'atr-buffer',...(first.estimated||second.estimated?['estimated-target' as const]:[]),...(!first.estimated||!second.estimated?['structural-target' as const]:[])]);
  return {side,status:'ready',id:[context.market,context.symbol,context.interval,side,kind,anchor.source,anchor.confirmedAt??'atr',triggerPrice.toPrecision(12)].join(':'),kind,zoneLow,zoneHigh,triggerPrice,invalidationPrice,targets:[first,second],anchor,basis,triggerRule:buy?(retest?'touch-then-close-above':'close-above'):(retest?'touch-then-close-below':'close-below')};
}

function validGeometry(s:ReadyForecastSide):boolean {
  if(![s.zoneLow,s.zoneHigh,s.triggerPrice,s.invalidationPrice,...s.targets.map(t=>t.price)].every(positive))return false;
  if(s.zoneLow>s.zoneHigh||s.triggerPrice<s.zoneLow||s.triggerPrice>s.zoneHigh)return false;
  return s.side==='long'?s.invalidationPrice<s.zoneLow&&s.zoneHigh<s.targets[0].price&&s.targets[0].price<s.targets[1].price:s.invalidationPrice>s.zoneHigh&&s.zoneLow>s.targets[0].price&&s.targets[0].price>s.targets[1].price;
}

function matchesInput(input:AnalysisInput|undefined,context:ForecastContext,bars:Bar[]):boolean {
  // Older/context-free structure has no identity metadata. Its analyzed-through timestamp
  // and each structural anchor still undergo the existing historical checks.
  if(!input)return true;
  const last=bars.at(-1),snapshot=input.lastBar;
  return input.market===context.market && input.interval===context.interval
    && (input.symbol===undefined||input.symbol===context.symbol)
    && (input.source===undefined||input.source===context.source)
    && (input.adjustment===undefined||input.adjustment===context.adjustment)
    && input.count===bars.length && input.firstTime===bars[0]?.time
    && !!last && !!snapshot && last.time===snapshot.time && last.open===snapshot.open
    && last.high===snapshot.high && last.low===snapshot.low && last.close===snapshot.close && last.volume===snapshot.volume;
}

/** Describe the existing two snapshots without adding a directional vote. */
function assessTimeframes(analysis:Analysis,context:ForecastContext,asOf:number|null,currentDirection:ForecastDirection,currentReady:boolean):TimeframeAssessment {
  const expected=higherInterval(context.market,context.interval);
  const base:TimeframeAssessment={status:'unavailable',currentDirection,higherDirection:null,higherInterval:expected,asOf,higherAsOf:null,reason:'current-unavailable'};
  if(!currentReady||asOf===null)return base;
  if(expected===null)return {...base,reason:'no-higher-timeframe'};
  const c=analysis.confluence;
  if(!c)return {...base,reason:'higher-unavailable'};
  if(c.asOf!==asOf)return {...base,reason:'snapshot-mismatch'};
  const higher=c.higher;
  if(higher.status!=='ready'||higher.asOf===null||!Number.isFinite(higher.asOf)||higher.asOf<=0||higher.bars<35)return {...base,reason:'higher-unavailable'};
  if(higher.interval!==expected)return {...base,reason:'interval-mismatch'};
  if(higher.asOf>asOf)return {...base,reason:'future-higher'};
  return {...base,status:currentDirection==='neutral'||higher.direction==='neutral'?'mixed':currentDirection===higher.direction?'aligned':'countertrend',higherDirection:higher.direction,higherAsOf:higher.asOf,reason:'ready'};
}

/** Recomputed from the supplied current price and confirmed history only.
 * Deliberately never reads tradePlans, decision, planSession or historical fills. */
export function buildForecast(candles:Candle[],analysis:Analysis,context:ForecastContext):MarketForecast {
  const {bars,notices}=validBars(candles,context),reference=bars.at(-1),closed=bars.filter(c=>c.closed!==false),last=closed.at(-1);
  const structureAsOf=last?candleAvailableAt(last,context.market,context.interval,context.source):null;
  const result:MarketForecast={status:'insufficient',mode:'insufficient',context:{...context},referencePrice:reference?.close??null,referenceTime:reference?.time??null,referenceClosed:reference?.closed!==false,lastClosedPrice:last?.close??null,lastClosedTime:last?.time??null,structureAsOf,asOf:Number.isFinite(context.asOf)?context.asOf!:reference?(reference.closed===false?reference.time:structureAsOf??reference.time):0,atr:null,buffer:null,direction:'neutral',reasonCodes:['history-insufficient'],noticeCodes:notices,support:null,resistance:null,long:blankSide('long'),short:blankSide('short')};
  result.modelVersion=FORECAST_MODEL_VERSION;result.parameterVersion=FORECAST_PARAMETER_VERSION;result.analysisVersion=analysis.ruleVersion;
  result.regime=evaluateMarketRegime(closed,{asOf:result.asOf});
  result.timeframeAssessment=assessTimeframes(analysis,context,structureAsOf,'neutral',false);
  if(reference?.closed===false)result.noticeCodes.push('live-reference');
  if(context.market==='cn')result.noticeCodes.push('cn-short-restricted');
  if(!reference||closed.length<14){result.noticeCodes.push('short-history');return result;}
  const price=reference.close,atr=atr14(closed),vol=Math.max(price*.002,Math.min(atr,price*.08));
  if(!positive(vol)||!Number.isFinite(atr))return result;
  result.atr=atr;result.buffer=vol;
  if(vol!==atr)result.noticeCodes.push('bounded-volatility');
  const analysisMatches=analysis.analyzedThrough===last!.time && matchesInput(analysis.input,context,closed);
  if(!analysisMatches)result.noticeCodes.push('analysis-prefix-mismatch');
  const levels=analysisMatches ? confirmedLevels(closed,analysis) : [];
  const near=levels.filter(l=>Math.abs(l.price-price)>=vol*.15&&Math.abs(l.price-price)<=vol*3);
  const support=near.filter(l=>l.price<price).sort((a,b)=>b.price-a.price)[0]??estimated(price-vol);
  const resistance=near.filter(l=>l.price>price).sort((a,b)=>a.price-b.price)[0]??estimated(price+vol);
  result.support=support;result.resistance=resistance;
  result.mode=support.estimated&&resistance.estimated?'volatility':'structure';
  if(result.mode==='volatility')result.noticeCodes.push('volatility-reference');
  const validBias=[analysis.bias.long,analysis.bias.short].every(n=>Number.isFinite(n)&&n>=0&&n<=100)&&Math.abs(analysis.bias.long+analysis.bias.short-100)<.001;
  let direction:ForecastDirection='neutral';
  const reasonCodes:ForecastReasonCode[]=[];
  if(result.mode!=='structure')reasonCodes.push('structure-insufficient');
  else if(closed.length<35||!analysisMatches||!validBias)reasonCodes.push('direction-unavailable');
  else if(analysis.bias.long>=60){direction='long';reasonCodes.push('bias-long');}
  else if(analysis.bias.short>=60){direction='short';reasonCodes.push('bias-short');}
  else reasonCodes.push('balanced');
  result.timeframeAssessment=assessTimeframes(analysis,context,structureAsOf,direction,result.mode==='structure'&&closed.length>=35&&analysisMatches&&validBias);
  const confluence=analysis.confluence;
  if(confluence?.input&&result.timeframeAssessment.status!=='unavailable'&&!matchesInput(confluence.input,context,closed)){
    result.timeframeAssessment={...result.timeframeAssessment,status:'unavailable',higherDirection:null,higherAsOf:null,reason:'snapshot-mismatch'};
  }
  // Auxiliary agreement can strengthen an existing structural direction; it
  // cannot promote a neutral bias or import evidence from a later snapshot.
  if(direction!=='neutral'&&confluence&&result.timeframeAssessment.status!=='unavailable') {
    const assessment=confluence[direction];
    if(assessment.status==='opposed'&&result.timeframeAssessment.status==='countertrend'){direction='neutral';reasonCodes.push('confluence-opposed');}
    else if(assessment.status==='aligned'&&result.timeframeAssessment.status==='aligned')reasonCodes.push('confluence-aligned');
  }
  const long=readySide('long',price,vol,direction,support,resistance,levels,context),short=readySide('short',price,vol,direction,support,resistance,levels,context);
  if(!validGeometry(long)||!validGeometry(short))return {...result,mode:'insufficient',reasonCodes:['history-insufficient']};
  if([...long.targets,...short.targets].some(t=>t.estimated))result.noticeCodes.push('estimated-targets');
  return {...result,status:'ready',direction,reasonCodes,long,short,noticeCodes:unique(result.noticeCodes)};
}
