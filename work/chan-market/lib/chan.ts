import type { Analysis, Candle, Center, Factor, Fractal, Point, Scenario, Signal, StructureLine, StructurePriceRange, TradeSetup, TradePlanSession } from './market-types';
import { buildTradePlans, coordinateTradePlans } from './trade-plans.ts';
import { buildConfluence } from './confluence.ts';
import type { ConfluenceContext, ConfluenceDirection } from './confluence-types';
import { accelerationArea, computeVacc, VACC_DEFAULTS, velocityPeak } from './vacc.ts';
import { buildNaturalStrokes } from './natural-strokes.ts';
import { buildNaturalLevel } from './natural-levels.ts';

type Direction = 'up' | 'down';
type IndexedCandle = Candle & { index: number };
export interface MergedBar { high: number; low: number; highPoint: Point; lowPoint: Point; startIndex: number; endIndex: number; direction: Direction }
type InternalFractal = Fractal & { mergedIndex: number };
type Feature = { high: number; low: number; highPoint: Point; lowPoint: Point; startStroke: number; endStroke: number };
const clamp = (x: number, low: number, high: number) => Math.max(low, Math.min(high, x));
const overlap = (a: {high: number;low: number}, b: {high: number;low: number}) => Math.max(a.low, b.low) <= Math.min(a.high, b.high);
const contains = (a: {high: number;low: number}, b: {high: number;low: number}) => (a.high >= b.high && a.low <= b.low) || (b.high >= a.high && b.low <= a.low);
const point = (bar: IndexedCandle, price: number): Point => ({ index: bar.index, time: bar.time, price });
const bounds = (line: StructureLine) => line.priceRange??{high: Math.max(line.from.price, line.to.price), low: Math.min(line.from.price, line.to.price)};
const validRange=(line:StructureLine)=>{
  const r=line.priceRange;
  return !r||Number.isFinite(r.low)&&Number.isFinite(r.high)&&r.low>0&&r.low<=Math.min(line.from.price,line.to.price)&&r.high>=Math.max(line.from.price,line.to.price)
    &&r.lowPoint?.price===r.low&&r.highPoint?.price===r.high
    &&[r.lowPoint,r.highPoint].every(p=>p.index>=line.from.index&&p.index<=line.to.index&&p.time>=line.from.time&&p.time<=line.to.time);
};
/** The range describes the constituent pens, while from/to retain the shared
 * segment connection. Confirmation pens after its endpoint are not members. */
function constituentRange(lines:StructureLine[],start:number,end:number):StructurePriceRange {
  const points=lines.slice(start,end).flatMap(line=>[line.from,line.to]);
  const lowPoint=points.reduce((a,b)=>b.price<=a.price?b:a),highPoint=points.reduce((a,b)=>b.price>=a.price?b:a);
  return {low:lowPoint.price,high:highPoint.price,lowPoint:{...lowPoint},highPoint:{...highPoint}};
}

/** A missing or provisional constituent is a structural boundary, not a row
 * that can be filtered away before joining the remaining confirmed lines. */
function confirmedRuns(lines:StructureLine[]):StructureLine[][] {
  const runs:StructureLine[][]=[];
  let run:StructureLine[]=[];
  for(const line of lines) {
    const valid=line.confirmed&&line.from.index<line.to.index&&line.from.time<line.to.time&&line.confirmedAt>=line.to.index&&validRange(line)
      &&[line.from.price,line.to.price].every(p=>Number.isFinite(p)&&p>0)
      &&(line.direction==='up'?line.to.price>line.from.price:line.to.price<line.from.price);
    if(!valid) {run=[];continue;}
    const prev=run.at(-1);
    if(prev&&(prev.to.index!==line.from.index||prev.to.time!==line.from.time||prev.to.price!==line.from.price||prev.direction===line.direction))run=[];
    if(!run.length)runs.push(run);
    run.push(line);
  }
  return runs;
}

/** Preserve input indices: drawing indices always refer to the caller's raw candles. */
function validClosed(candles: Candle[]) {
  const bars: IndexedCandle[] = [];
  let invalid = 0;
  for (let index = 0; index < candles.length; index++) {
    const b = candles[index];
    if (b.closed === false) continue;
    if (![b.time,b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite) || b.low <= 0 || b.high < Math.max(b.open,b.close) || b.low > Math.min(b.open,b.close) || b.volume < 0 || (bars.length && b.time <= bars[bars.length-1].time)) { invalid++; continue; }
    bars.push({...b,index});
  }
  return {bars,invalid};
}

/** Sequential inclusion processing, not an equivalence-class union. */
export function mergeInclusions(candles: Candle[]): MergedBar[] {
  return mergeIndexed(validClosed(candles).bars);
}
function mergeIndexed(bars: IndexedCandle[]): MergedBar[] {
  const out: MergedBar[] = [];
  for (const bar of bars) {
    const fresh: MergedBar = {high:bar.high,low:bar.low,highPoint:point(bar,bar.high),lowPoint:point(bar,bar.low),startIndex:bar.index,endIndex:bar.index,direction:'up'};
    const prev=out[out.length-1];
    if (!prev) { out.push(fresh); continue; }
    let direction = prev.direction;
    if (out.length > 1) direction = prev.high > out[out.length-2].high ? 'up' : 'down';
    else if (!contains(prev,fresh)) direction = fresh.high > prev.high ? 'up' : 'down';
    // The left edge is an arbitrary observation boundary. Use the available close
    // relation only while a preceding non-containing pair does not yet exist.
    else direction = bar.close >= bars[0].close ? 'up' : 'down';
    if (contains(prev,fresh)) {
      const up=direction==='up';
      const takeHigh=up ? fresh.high>=prev.high : fresh.high<=prev.high;
      const takeLow=up ? fresh.low>=prev.low : fresh.low<=prev.low;
      out[out.length-1]={high:takeHigh?fresh.high:prev.high,low:takeLow?fresh.low:prev.low,
        highPoint:takeHigh?fresh.highPoint:prev.highPoint,lowPoint:takeLow?fresh.lowPoint:prev.lowPoint,
        startIndex:prev.startIndex,endIndex:bar.index,direction};
    } else {
      fresh.direction=fresh.high>prev.high?'up':'down'; out.push(fresh);
    }
  }
  return out;
}

function findFractals(merged: MergedBar[]): InternalFractal[] {
  const out: InternalFractal[]=[];
  for (let i=1;i<merged.length-1;i++) {
    const [a,b,c]=[merged[i-1],merged[i],merged[i+1]];
    const top=b.high>a.high&&b.high>c.high&&b.low>a.low&&b.low>c.low;
    const bottom=b.high<a.high&&b.high<c.high&&b.low<a.low&&b.low<c.low;
    if(top||bottom) out.push({...(top?b.highPoint:b.lowPoint),type:top?'top':'bottom',mergedIndex:i,confirmedAt:c.endIndex});
  }
  return out;
}

export function canFormPen(a: {type:'top'|'bottom';mergedIndex:number;index:number;price:number}, b: {type:'top'|'bottom';mergedIndex:number;index:number;price:number}, mode:'new'|'old'='new'): boolean {
  if(a.type===b.type||b.index<=a.index) return false;
  if(mode==='old' ? b.mergedIndex-a.mergedIndex<4 : b.mergedIndex-a.mergedIndex<3||b.index-a.index<4) return false;
  return a.type==='bottom'? b.price>a.price : b.price<a.price;
}

function buildPens(fractals: InternalFractal[], mode:'new'|'old') {
  const pivots: InternalFractal[]=[];
  for(const f of fractals) {
    const last=pivots[pivots.length-1];
    if(!last) {pivots.push(f);continue;}
    if(f.type===last.type) {
      if(f.type==='top'?f.price>=last.price:f.price<=last.price) pivots[pivots.length-1]=f;
    } else if(canFormPen(last,f,mode)) pivots.push(f);
  }
  const strokes: StructureLine[]=[];
  for(let i=1;i<pivots.length;i++) {
    const a=pivots[i-1],b=pivots[i];
    const confirmed=i<pivots.length-1;
    strokes.push({from:{index:a.index,time:a.time,price:a.price},to:{index:b.index,time:b.time,price:b.price},direction:b.price>a.price?'up':'down',confirmed,confirmedAt:confirmed?pivots[i+1].confirmedAt:b.confirmedAt});
  }
  return strokes;
}

function asFeature(line: StructureLine, i:number):Feature {
  const up=line.to.price>line.from.price;
  return { ...bounds(line), highPoint:up?line.to:line.from,lowPoint:up?line.from:line.to,startStroke:i,endStroke:i };
}
function pushFeature(out: Feature[], next:Feature, initial:Direction) {
  const last=out[out.length-1];
  if(!last||!contains(last,next)) {out.push(next);return;}
  const before=out[out.length-2];
  const direction=before?(last.high>before.high?'up':'down'):initial;
  const up=direction==='up';
  const takeHigh=up?next.high>=last.high:next.high<=last.high;
  const takeLow=up?next.low>=last.low:next.low<=last.low;
  out[out.length-1]={high:takeHigh?next.high:last.high,low:takeLow?next.low:last.low,
    highPoint:takeHigh?next.highPoint:last.highPoint,lowPoint:takeLow?next.lowPoint:last.lowPoint,
    startStroke:last.startStroke,endStroke:next.endStroke};
}
function isFeatureTurn(a:Feature,b:Feature,c:Feature,dir:Direction) {
  return dir==='up'? b.high>a.high&&b.high>c.high&&b.low>a.low&&b.low>c.low : b.high<a.high&&b.high<c.high&&b.low<a.low&&b.low<c.low;
}
function reverseFeatureConfirm(lines:StructureLine[],start:number,dir:Direction) {
  const fs:Feature[]=[];
  for(let j=start+1;j<lines.length;j+=2) {
    pushFeature(fs,asFeature(lines[j],j),dir);
    if(fs.length>=3&&isFeatureTurn(fs[fs.length-3],fs[fs.length-2],fs[fs.length-1],dir))return j;
  }
  return -1;
}

/** Experimental implementation of the two feature-sequence cases. The working
 * segment uses complete pens only. Three pens alone never close a segment. */
export function buildSegments(strokes: StructureLine[]): StructureLine[] {
  // The first uninterrupted pen run anchors this segment chain. Later runs
  // cannot establish how a missing constituent connected to an earlier turn.
  const lines=confirmedRuns(strokes)[0]??[];
  const out:StructureLine[]=[];
  let start=0;
  let bootstrapping=true;
  let first:{start:number;confirmedAt:number}|undefined;
  const developing=()=>{
    const dir=lines[start].direction,remaining=lines.slice(start).filter(x=>x.direction===dir);
    if(!remaining.length)return;
    const extreme=remaining.reduce((a,b)=>dir==='up'?(a.to.price>=b.to.price?a:b):(a.to.price<=b.to.price?a:b));
    const from=lines[start].from;
    if(dir==='up'?extreme.to.price<=from.price:extreme.to.price>=from.price)return;
    out.push({from,to:extreme.to,direction:dir,confirmed:false,confirmedAt:lines[lines.length-1].confirmedAt,priceRange:constituentRange(lines,start,lines.indexOf(extreme)+1)});
  };
  while(bootstrapping||start+2<lines.length) {
    if(start+2>=lines.length) {
      bootstrapping=false;
      if(!first) {
        // With no confirmed turn, the left edge is still arbitrary. Retain a
        // provisional range only where its starting extreme is consistent.
        for(start=0;start+2<lines.length;start++) {
          const initial=lines.slice(start,start+3).map(bounds);
          if(Math.max(...initial.map(x=>x.low))>Math.min(...initial.map(x=>x.high)))continue;
          const dir=lines[start].direction,from=lines[start].from.price;
          const remaining=lines.slice(start).filter(x=>x.direction===dir);
          const extreme=remaining.reduce((a,b)=>dir==='up'?(a.to.price>=b.to.price?a:b):(a.to.price<=b.to.price?a:b));
          const extent=lines.slice(start).filter(x=>x.to.index<=extreme.to.index);
          if(!extent.every(x=>dir==='up'?bounds(x).low>=from:bounds(x).high<=from))continue;
          developing();break;
        }
        break;
      }
      start=first.start;
    }
    const initial3=lines.slice(start,start+3).map(bounds);
    if(Math.max(...initial3.map(x=>x.low))>Math.min(...initial3.map(x=>x.high))) {
      if(out.length) {developing();break;}
      start++;continue;
    }
    const dir=lines[start].direction;
    const candidates:{end:number;known:number}[]=[];
    const fs:Feature[]=[];
    for(let j=start+1;j<lines.length;j+=2) {
      pushFeature(fs,asFeature(lines[j],j),dir);
      if(fs.length<3)continue;
      const [a,b,c]=fs.slice(-3);
      if(!isFeatureTurn(a,b,c,dir))continue;
      const pivot=dir==='up'?b.highPoint:b.lowPoint;
      const end=lines.findIndex((line,k)=>k>start&&line.from.index===pivot.index);
      if(end<start+3||(end-start)%2!==1)continue;
      if(overlap(a,b))candidates.push({end,known:j});
      else {
        const reverseDir=dir==='up'?'down':'up';
        const known=reverseFeatureConfirm(lines,end,reverseDir);
        if(known<0)continue;
        const breached=lines.slice(end,known+1).some(x=>dir==='up'?Math.max(x.from.price,x.to.price)>pivot.price:Math.min(x.from.price,x.to.price)<pivot.price);
        if(!breached)candidates.push({end,known});
      }
    }
    // Lesson 71: a very large first reverse pen is not merged across the
    // proposed turning boundary. Require a complete reverse three-pen break.
    for(let end=start+3;end+2<lines.length;end+=2) {
      const first=lines[end],third=lines[end+2],prior=lines[end-2];
      if(first.direction===dir)continue;
      const earlier=lines.slice(start,end).flatMap(x=>[x.from.price,x.to.price]);
      if(dir==='up'?first.from.price<Math.max(...earlier):first.from.price>Math.min(...earlier))continue;
      const strong=dir==='up'?first.to.price<bounds(prior).low&&third.to.price<first.to.price:first.to.price>bounds(prior).high&&third.to.price>first.to.price;
      const reverse=lines.slice(end,end+3).map(bounds);
      if(strong&&Math.max(...reverse.map(x=>x.low))<=Math.min(...reverse.map(x=>x.high)))candidates.push({end,known:end+2});
    }
    candidates.sort((a,b)=>a.known-b.known||a.end-b.end);
    // A turn on the wrong side of the established start cannot close this
    // segment. Keep its anchor instead of skipping a pen and creating a gap.
    const next=candidates.find(candidate=>{
      const from=lines[start].from.price,to=lines[candidate.end].from.price;
      if(dir==='up'?to<=from:to>=from)return false;
      // A local feature turn cannot replace an earlier, more extreme endpoint
      // inside the same proposed segment (for example 118 with a later 117).
      return lines.slice(start,candidate.end).every(line=>dir==='up'
        ?bounds(line).high<=to&&(out.length>0||bounds(line).low>=from)
        :bounds(line).low>=to&&(out.length>0||bounds(line).high<=from));
    });
    if(bootstrapping) {
      // No preceding segment establishes the observation window's first
      // anchor. Compare when each valid turn became knowable, not merely its
      // leftmost start: a later large turn must not replace an earlier chain.
      if(next) {
        const confirmedAt=Math.max(...lines.slice(start,next.known+1).map(x=>x.confirmedAt));
        if(!first||confirmedAt<first.confirmedAt)first={start,confirmedAt};
      }
      start++;continue;
    }
    if(next) {
      const from=lines[start].from,to=lines[next.end].from;
      // This segment's start is a turn established by the preceding segment.
      // A later gap-confirmation may establish several turns together; the
      // new segment cannot be known before that shared anchor was knowable.
      const confirmedAt=Math.max(out.at(-1)?.confirmedAt??0,...lines.slice(start,next.known+1).map(x=>x.confirmedAt));
      out.push({from,to,direction:dir,confirmed:true,confirmedAt,priceRange:constituentRange(lines,start,next.end)});
      start=next.end;
    } else {
      developing();
      break;
    }
  }
  return out;
}

export function buildCenters(segments:StructureLine[]) {
  const centers:Center[]=[],signals:Signal[]=[];
  for(const lines of confirmedRuns(segments)) {
  let i=0;
  while(i+2<lines.length) {
    const group=lines.slice(i,i+3).map(bounds);
    const low=Math.max(...group.map(x=>x.low)),high=Math.min(...group.map(x=>x.high));
    if(low>=high) {i++;continue;}
    let j=i+3;
    while(j<lines.length&&overlap({low,high},bounds(lines[j]))) j++;
    const broken=j<lines.length;
    centers.push({startIndex:lines[i].from.index,endIndex:lines[j-1].to.index,low,high,level:'线段中枢',status:broken?'broken':'active'});
    if(broken) {
      const retest=lines[j],b=bounds(retest);
      if(b.low>high&&retest.direction==='down')signals.push({...retest.to,label:'类三买',side:'long',type:'third-buy-candidate',confirmed:false,reason:'已确认线段向上离开后，反向线段整体高于中枢上沿；尚未核实递归次级别走势，标为类三买候选。'});
      if(b.high<low&&retest.direction==='up')signals.push({...retest.to,label:'类三卖',side:'short',type:'third-sell-candidate',confirmed:false,reason:'已确认线段向下离开后，反向线段整体低于中枢下沿；尚未核实递归次级别走势，标为类三卖候选。'});
      i=j;
    } else break;
  }
  }
  return {centers,signals};
}

function atr(bars:IndexedCandle[]) {
  if(!bars.length)return 0;
  const last=bars.slice(-15);
  return last.reduce((sum,b,i)=>sum+Math.max(b.high-b.low,Math.abs(b.high-(i?last[i-1].close:b.open)),Math.abs(b.low-(i?last[i-1].close:b.open))),0)/last.length;
}
function core(bars:IndexedCandle[], mode:'new'|'old') {
  // 'new' = 自然笔 (Natural Chan); 'old' keeps the classic lesson-62 pen for comparison.
  const pens=mode==='new'?buildNaturalStrokes(bars):(()=>{const fractals=findFractals(mergeIndexed(bars));return {fractals,strokes:buildPens(fractals,mode),eventAt:bars.at(-1)?.index??-1};})();
  // 自然笔 → 自然段 → 本级别趋势 (= higher-level segments); classic pens keep the feature-sequence segments.
  const fractals=pens.fractals,strokes=pens.strokes,segments=mode==='new'?buildNaturalLevel(strokes):buildSegments(strokes),trends=mode==='new'?buildNaturalLevel(segments):[];
  // Natural Chan drops classic 中枢 and the 类三买/卖 derived from them (author ruling 2026-11-23).
  const {centers,signals}=mode==='new'?{centers:[] as Center[],signals:[] as Signal[]}:buildCenters(segments),vacc=computeVacc(bars,VACC_DEFAULTS);
  const current=bars[bars.length-1],last=vacc[vacc.length-1];
  const recent=strokes.filter(x=>x.confirmed).slice(-1)[0];
  const segment=segments.filter(x=>x.confirmed).slice(-1)[0];
  const center=centers[centers.length-1];
  const price=current?.close||0;
  const position=center?(price>center.high?1:price<center.low?-1:0):0;
  // Vel is a per-bar price velocity; scale by price so the factor is comparable across instruments.
  const momentum=last&&price?last.vel/price:0;
  const momentumBucket=Math.abs(momentum)<0.0001?0:momentum>0?1:-1;
  const strokeDirection=recent?(recent.direction==='up'?1:-1):0;
  const factors:Factor[]=[
    ...(mode==='new'?[]:[{name:'中枢位置',value:position*18,detail:center?(position>0?'价格位于最近线段中枢上方':position<0?'价格位于最近线段中枢下方':'价格仍在最近线段中枢内'):'尚无已确认线段中枢'}]),
    {name:'线段方向',value:segment?(segment.direction==='up'?12:-12):0,detail:segment?`最近确认线段${segment.direction==='up'?'向上':'向下'}`:'确认线段不足'},
    {name:'最近笔',value:strokeDirection*7,detail:recent?`最近确认笔${recent.direction==='up'?'向上':'向下'}；尾笔不纳入`:'有效笔不足'},
    {name:'VAcc速度',value:Math.round(clamp(momentum*5000,-10,10)),detail:momentumBucket>0?'速度在零轴上方，作辅助观察':momentumBucket<0?'速度在零轴下方，作辅助观察':'速度接近零轴'}
  ];
  const long=bars.length<35?50:Math.round(clamp(50+factors.reduce((s,f)=>s+f.value,0),10,90));
  return {structureAsOf:pens.eventAt,fractals,strokes,segments,trends,centers,signals,vacc,bias:{long,short:100-long,label:bars.length<35?'样本不足':long>=60?'结构偏多':long<=40?'结构偏空':'结构均衡',factors},state:[position,strokeDirection,momentumBucket]};
}

/** Each sample's features are computed on its own prefix. Targets are read only
 * after the feature match; horizons do not overlap, and the current tail is
 * never included in historical outcomes. These are descriptive frequencies. */
export function historicalCalibration(candles:Candle[], options:{penMode?:'new'|'old';horizon?:number}={}) {
  const {bars}=validClosed(candles),mode=options.penMode||'new',horizon=clamp(Math.round(Number.isFinite(options.horizon)?options.horizon!:12),1,48),threshold=0.002;
  const current=core(bars,mode),target=current.state;
  let up=0,down=0,flat=0;
  const records:{index:number;targetIndex:number;state:number[];return:number}[]=[];
  for(let i=59;i+horizon<bars.length;i+=horizon) {
    const snapshot=core(bars.slice(0,i+1),mode);
    const distance=snapshot.state.reduce((s,v,k)=>s+Math.abs(v-target[k]),0);
    if(distance>1)continue;
    const ret=bars[i+horizon].close/bars[i].close-1;
    if(ret>threshold)up++;else if(ret< -threshold)down++;else flat++;
    records.push({index:bars[i].index,targetIndex:bars[i+horizon].index,state:snapshot.state,return:ret});
  }
  const n=up+down+flat,p=n?up/n:0,z=1.96;
  const den=1+z*z/Math.max(n,1),center=(p+z*z/(2*Math.max(n,1)))/den;
  const margin=z*Math.sqrt(p*(1-p)/Math.max(n,1)+z*z/(4*Math.max(n,1)**2))/den;
  // Allocate the final tenths by largest remainder. Independent rounding can
  // otherwise turn a genuinely zero flat count into a negative percentage.
  const exact=n?[up,down,flat].map(x=>x/n*1000):[0,0,0];
  const tenths=exact.map(Math.floor);
  const order=[0,1,2].sort((a,b)=>(exact[b]-tenths[b])-(exact[a]-tenths[a]));
  for(let i=0,remaining=n?1000-tenths.reduce((a,b)=>a+b,0):0;i<remaining;i++)tenths[order[i%3]]++;
  return {calibration:{samples:n,up:tenths[0]/10,down:tenths[1]/10,flat:tenths[2]/10,horizon,threshold,
    wilsonLow:n?Math.round(Math.max(0,center-margin)*1000)/10:0,wilsonHigh:n?Math.round(Math.min(1,center+margin)*1000)/10:100,
    method:`滚动前缀；${mode==='new'?'':'中枢位置/'}确认笔方向/VAcc速度符号${mode==='new'?'二':'三'}维距离≤1；每${horizon}根取一次不重叠样本；${n<20?'样本不足20，仅作描述，不估计未来概率':'历史频率，未完成独立样本外校准'}；区间为上涨频率的95% Wilson区间`,
    asOf:bars.length?new Date(bars[bars.length-1].time*1000).toISOString():''},records,currentState:target};
}

/** 《自然缠》5.3: same-direction confirmed segments a and c around a reverse
 * segment b. c must make a new extreme; b must pull Vel back to (or through)
 * zero; a and c velocity peaks must share a sign. Divergence = c's Vel peak
 * and/or c's same-direction acceleration area is smaller than a's. */
function addDivergenceSignals(bars:IndexedCandle[], structure:ReturnType<typeof core>) {
  const lines=structure.segments.filter(x=>x.confirmed),points=structure.vacc;
  for(let i=2;i<lines.length;i++) {
    const prev=lines[i-2],pullback=lines[i-1],now=lines[i],dir=now.direction;
    if(prev.direction!==dir)continue;
    const extreme=dir==='up'?now.to.price>prev.to.price:now.to.price<prev.to.price;
    if(!extreme)continue;
    const sign=dir==='up'?1:-1;
    const peakA=velocityPeak(points,prev.from.time,prev.to.time,dir),peakC=velocityPeak(points,now.from.time,now.to.time,dir);
    const pull=velocityPeak(points,pullback.from.time,pullback.to.time,pullback.direction);
    if(peakA===null||peakC===null||pull===null)continue;
    if(peakA*sign<=0||peakC*sign<=0||pull*sign>0)continue;
    const speed=Math.abs(peakC)<Math.abs(peakA);
    const areaA=Math.abs(accelerationArea(points,prev.from.time,prev.to.time,dir)),areaC=Math.abs(accelerationArea(points,now.from.time,now.to.time,dir));
    const area=areaA>0&&areaC<areaA;
    if(!speed&&!area)continue;
    const kinds=[speed?'速度':'',area?'加速度面积':''].filter(Boolean).join('与');
    const related=structure.centers.filter(x=>x.startIndex>=prev.from.index&&x.endIndex<=now.to.index);
    const trending=related.length>=2&&related.slice(1).every((c,j)=>dir==='up'?c.low>related[j].high:c.high<related[j].low);
    structure.signals.push({...now.to,label:trending?(dir==='up'?'顶背驰信号':'底背驰信号'):(dir==='up'?'顶部力度减弱':'底部力度减弱'),side:dir==='up'?'short':'long',type:trending?'trend-divergence-candidate':'range-divergence-candidate',confirmed:false,
      reason:`同向线段创新${dir==='up'?'高':'低'}，回调段使VAcc速度回到零轴，后段${kinds}弱于前同向段；${trending?'有两个同向中枢候选背景':'未满足完整趋势背景，按盘整力度减弱观察'}。仅为背驰候选，需核对递归级别和实际比较段。`});
  }
}
const format=(n:number)=>Number(n.toPrecision(6)).toLocaleString('en-US',{maximumFractionDigits:8});
/** Two future observation boundaries. They are derived from the visible prefix,
 * not predicted future extrema. A calendar bar is not a recursive Chan level. */
function tradeSetups(bars:IndexedCandle[], structure:ReturnType<typeof core>):TradeSetup[] {
  if(!bars.length)return [];
  const current=bars[bars.length-1],center=structure.centers.at(-1);
  const completed=structure.segments.filter(s=>s.confirmed);
  if(center) {
    const centerPoints=completed.flatMap(s=>[s.from,s.to]).filter(p=>p.index>=center.startIndex&&p.index<=center.endIndex);
    const upperAnchor=centerPoints.find(p=>p.price===center.high);
    const lowerAnchor=centerPoints.find(p=>p.price===center.low);
    if(upperAnchor&&lowerAnchor) {
      // A completed, wholly outside return segment means the old center's first
      // retest has already happened. Do not repeatedly relabel it a third point.
      const oldRetest=center.status==='broken'||completed.some(s=>s.from.index>=center.endIndex&&
        (s.direction==='down'&&bounds(s).low>=center.high||s.direction==='up'&&bounds(s).high<=center.low));
      const upper=format(center.high),lower=format(center.low);
      const shared=oldRetest?'旧中枢已有离开/回试结构；以下仅作边界观察，新的第三类点须重新核定中枢与首次回试。':'已形成线段中枢；尚未核实递归次级别走势及首次回试，因此只能标条件观察。';
      return [
        {id:`${oldRetest?'center':'third'}-buy-${upperAnchor.time}`,side:'long',label:oldRetest?'中枢买观察':'三买观察',kind:oldRetest?'buy-watch':'third-buy-watch',status:'conditional',price:center.high,invalidationPrice:center.high,anchor:{...upperAnchor},offset:8,
          trigger:oldRetest?`若重返旧中枢并完成向上离开，再观察上沿 ${upper} 的回试支撑；须形成新的有效结构，不能将旧中枢的再次回踩直接认作三买。`:`${current.close<center.low?`需先重返 ${lower} — ${upper} 中枢；`:''}须次级别走势向上离开中枢，随后第一次次级别回试完成且低点不跌破上沿 ${upper}，再核对三买条件；单根K线站上不足以确认。`,
          invalidation:`回试低点跌破 ${upper}，该买方分支失效；${oldRetest?'旧中枢的再次回踩不得直接标记为新的三买。':'若首次回试早已结束，不能沿用此三买条件。'}`,
          basis:`${shared} ${upper} 是中枢上沿ZG观察边界，实际买点须取未来已完成回试的低点，当前无法预知。`},
        {id:`${oldRetest?'center':'third'}-sell-${lowerAnchor.time}`,side:'short',label:oldRetest?'中枢卖观察':'三卖观察',kind:oldRetest?'sell-watch':'third-sell-watch',status:'conditional',price:center.low,invalidationPrice:center.low,anchor:{...lowerAnchor},offset:12,
          trigger:oldRetest?`若重返旧中枢并完成向下离开，再观察下沿 ${lower} 的反抽压力；须形成新的有效结构，不能将旧中枢的再次反抽直接认作三卖。`:`${current.close>center.high?`需先回到 ${lower} — ${upper} 中枢；`:''}须次级别走势向下离开中枢，随后第一次次级别反抽完成且高点不升破下沿 ${lower}，再核对三卖条件；单根K线跌破不足以确认。`,
          invalidation:`反抽高点升破 ${lower}，该卖方分支失效；${oldRetest?'旧中枢的再次反抽不得直接标记为新的三卖。':'若首次反抽早已结束，不能沿用此三卖条件。'}`,
          basis:`${shared} ${lower} 是中枢下沿ZD观察边界，实际卖点须取未来已完成反抽的高点，当前无法预知。`}
      ];
    }
  }
  return (['long','short'] as const).map(side=>{
    const isBuy=side==='long',type=isBuy?'bottom':'top';
    const fractal=structure.fractals.filter(f=>f.type===type).at(-1);
    const penPoints=structure.strokes.filter(s=>s.confirmed).map(s=>isBuy?(s.direction==='up'?s.from:s.to):(s.direction==='up'?s.to:s.from));
    const penPoint=penPoints.sort((a,b)=>b.index-a.index)[0];
    const pivot=fractal&&(!penPoint||fractal.index>=penPoint.index)?fractal:penPoint;
    // A lower low/higher high invalidates an earlier pivot as an intact watch
    // boundary. Use the actual new closed-bar extreme, explicitly awaiting a
    // fractal, instead of presenting the broken old level as a pending entry.
    const since=pivot?bars.filter(b=>b.index>=pivot.index):bars.slice(-20);
    const extreme=since.reduce((a,b)=>isBuy?(b.low<=a.low?b:a):(b.high>=a.high?b:a));
    const breached=pivot&&(isBuy?extreme.low<pivot.price:extreme.high>pivot.price);
    const anchor:Point=pivot&&!breached?{index:pivot.index,time:pivot.time,price:pivot.price}:point(extreme,isBuy?extreme.low:extreme.high);
    const level=format(anchor.price),confirmedPivot=!!pivot&&!breached;
    const origin=confirmedPivot?`最近已确认${isBuy?'底':'顶'}分型/笔端`:`最近已收盘K线${isBuy?'低':'高'}点，尚待${isBuy?'底':'顶'}分型确认`;
    return {id:`${isBuy?'buy':'sell'}-watch-${anchor.time}`,side,label:isBuy?'买点观察':'卖点观察',kind:isBuy?'buy-watch':'sell-watch',status:'conditional',price:anchor.price,invalidationPrice:anchor.price,anchor,offset:isBuy?8:12,
      trigger:isBuy?`若后续回落至 ${level} 附近不再创新低，等待底分型确认并形成向上笔；再核对背驰、次级别走势完成与对应买点类型。仅触价不能确认买点。`:`若后续反弹至 ${level} 附近不再创新高，等待顶分型确认并形成向下笔；再核对背驰、次级别走势完成与对应卖点类型。仅触价不能确认卖点。`,
      invalidation:isBuy?`已收盘K线低点跌破 ${level}，当前观察位失效，需用新低重新识别结构。`:`已收盘K线高点突破 ${level}，当前观察位失效，需用新高重新识别结构。`,
      basis:`依据${origin}。尚无已确认线段中枢，不能标为三${isBuy?'买':'卖'}；一、二类点所需趋势、背驰与递归结构也未齐备。标注为待结构形成的观察位，不是已成立买卖点。`};
  });
}
function scenarios(bars:IndexedCandle[], structure:ReturnType<typeof core>):Scenario[] {
  if(!bars.length)return [];
  const price=bars[bars.length-1].close,range=Math.max(atr(bars),price*.005);
  const center=structure.centers[structure.centers.length-1];
  const pen=structure.strokes.filter(x=>x.confirmed).slice(-1)[0];
  const penBounds=pen?bounds(pen):undefined;
  const local=bars.slice(-20),lower=center?.low??penBounds?.low??Math.min(...local.map(x=>x.low)),upper=center?.high??penBounds?.high??Math.max(...local.map(x=>x.high));
  const above=price>upper,below=price<lower,outside=above||below;
  const area=center?'中枢':'参考区间';
  const span=Math.max(upper-lower,range*2);
  const upTarget=Math.max(upper,price)+span,downTarget=Math.max(price*.01,Math.min(lower,price)-span);
  // Every stated retest price is the exact boundary used by the corresponding
  // path. An already departed price must first return to that boundary in this
  // branch; continuation without a retest is not silently assumed.
  const upPoints=above?
    [{offset:0,price},{offset:4,price:upper},{offset:8,price:Math.max(price,upper+range*.6)},{offset:12,price:upTarget}]:
    [{offset:0,price},{offset:4,price:upper+range*.6},{offset:8,price:upper},{offset:12,price:upTarget}];
  const downPoints=below?
    [{offset:0,price},{offset:4,price:lower},{offset:8,price:Math.max(price*.01,Math.min(price,lower-range*.6))},{offset:12,price:downTarget}]:
    [{offset:0,price},{offset:4,price:Math.max(price*.01,lower-range*.6)},{offset:8,price:lower},{offset:12,price:downTarget}];
  return [
    {side:'long',title:above?`回试不重返${area}后延伸`:below?'重返区间后向上突破':'向上突破并回试',
      trigger:above?`当前已在${area}上方；若回试上沿 ${format(upper)} 守住、不重新进入区间，再核对次级别结构与向上延伸条件`:`${below?`需先重返 ${format(lower)} — ${format(upper)} 区间；`:''}若收盘突破上沿 ${format(upper)}，随后回试 ${format(upper)} 守住，再核对次级别结构`,
      invalidation:`回试重新进入 ${format(upper)} 以下；下沿 ${format(lower)} 为进一步失效边界`,target:`仅在条件成立后观察 ${format(upTarget)} 附近；按区间宽度示意，不保证到达`,points:upPoints},
    {side:'short',title:below?`反抽不重返${area}后延伸`:above?'重返区间后向下跌破':'向下跌破并反抽',
      trigger:below?`当前已在${area}下方；若反抽下沿 ${format(lower)} 受阻、不重新进入区间，再核对次级别结构与向下延伸条件`:`${above?`需先重返 ${format(lower)} — ${format(upper)} 区间；`:''}若收盘跌破下沿 ${format(lower)}，随后反抽 ${format(lower)} 受阻，再核对次级别结构`,
      invalidation:`反抽重新进入 ${format(lower)} 以上；上沿 ${format(upper)} 为进一步失效边界`,target:`仅在条件成立后观察 ${format(downTarget)} 附近；按区间宽度示意，不保证到达`,points:downPoints},
    {side:'range',title:outside?'重返区间后震荡':'继续区间震荡',
      trigger:outside?`若收盘${above?'回落至':'重新站回'} ${format(above?upper:lower)} 并进入 ${format(lower)} — ${format(upper)} 区间，再观察区间内往返；未重返前此分支不成立`:`若价格继续在 ${format(lower)} — ${format(upper)} 内来回，且未形成有效离开后的不回区间回试，则观察震荡分支`,
      invalidation:'完成离开及回试结构后，切换到对应方向情景',target:'跟踪区间边界与新中枢形成，不保证重返或持续震荡',
      points:[{offset:0,price},{offset:4,price:below?lower:upper},{offset:8,price:below?upper:lower},{offset:12,price:(upper+lower)/2}]}
  ];
}

export interface AnalysisOptions { penMode?:'new'|'old'; horizon?:number; planSession?:TradePlanSession; context?:ConfluenceContext; skipCalibration?:boolean; skipTradePlans?:boolean }
export function analyze(candles:Candle[], options:AnalysisOptions={}):Analysis {
  const mode=options.penMode||'new',{bars,invalid}=validClosed(candles),s=core(bars,mode);
  addDivergenceSignals(bars,s);
  // Validation can skip the descriptive histogram without altering any plan.
  const {calibration}=historicalCalibration(options.skipCalibration?[]:candles,options);
  if(options.skipCalibration)calibration.method='已跳过历史频率计算；仅用于逐时评估';
  // Forward-outlook mode retains imported legacy records only. It does not
  // create or advance simulated entries while calculating current structure.
  const {tradePlans,decision,planSession}=options.skipTradePlans
    ?{tradePlans:options.planSession?.plans??[],decision:coordinateTradePlans(options.planSession?.plans??[],s.bias,bars.at(-1)?.time??0).decision,planSession:options.planSession}
    :buildTradePlans(bars,s,prefix=>core(prefix,mode),options.planSession);
  const confluence=options.context?buildConfluence(bars,s.vacc,options.context,higherBars=>{
    const higher=core(validClosed(higherBars).bars,mode);
    // Structural background excludes its VAcc factor: the current VAcc remains
    // one evidence family rather than being counted again through the bias %.
    const structural=higher.bias.factors.slice(0,3).reduce((sum,f)=>sum+f.value,0);
    return (structural>=7?'long':structural<=-7?'short':'neutral') as ConfluenceDirection;
  }):undefined;
  const warnings=[
    '线段为实验性特征序列实现（含有缺口/无缺口及强反向破坏）；复杂包含、古怪线段仍需人工核图，不宣称原典全规则唯一分解。',
    '中枢为已确认线段构成的最小层结构；尚未实现完整递归级别与跨周期区间套。类三买/卖及背驰均标为候选。',
    '多空比例是透明权重形成的结构评分，不是胜率、仓位建议或可执行交易概率；未来虚线仅展示条件情景。',
    '历史频率按未来固定根数收盘收益分类（±0.2%），不含手续费、滑点和实际交易约束；不等于策略收益。'
  ];
  if(bars.length<60)warnings.push('可用已收盘K线少于60根，结构及统计不充分。');
  if(bars.length<35)warnings.push('多空各50为样本不足时的中性占位，不表示已确认结构均衡。');
  if(!options.skipTradePlans)warnings.push('交易计划直接给出参考入场区、止损与目标；ATR缓冲及1.5R/2.5R目标是本工具策略规则。状态按已收盘K线更新，不代表实际成交；横向排版不表示发生日期，目标不保证到达。');
  if(calibration.samples<20)warnings.push(`相似历史样本仅 ${calibration.samples} 个，少于20，不显示为经过校准的概率。`);
  if(candles.some(x=>x.closed===false))warnings.push('当前未收盘K线仅供价格展示，已排除出结构、评分与历史统计。');
  if(invalid)warnings.push(`已排除 ${invalid} 根无效、重复或乱序K线；检查数据来源。`);
  if(s.strokes.length<3)warnings.push('当前窗口有效笔不足；可增加历史范围或切换周期。');
  return {input:confluence?.input,fractals:s.fractals.map(f=>({index:f.index,time:f.time,price:f.price,type:f.type,confirmedAt:f.confirmedAt})),structureAsOf:s.structureAsOf,strokes:s.strokes,segments:s.segments,trends:s.trends,centers:s.centers,signals:s.signals.sort((a,b)=>a.index-b.index),vacc:s.vacc,vaccParams:{...VACC_DEFAULTS},analyzedThrough:bars.at(-1)?.time??0,scenarios:scenarios(bars,s),tradeSetups:tradeSetups(bars,s),tradePlans,planSession,decision,confluence,bias:s.bias,calibration,warnings,ruleVersion:`chan-experimental-1.5 · VAcc ${VACC_DEFAULTS.n}/${VACC_DEFAULTS.m} · ${mode==='new'?'自然笔/段/趋势':'第62课旧笔'} · 仅已收盘K线`};
}
