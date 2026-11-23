import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, mergeInclusions, canFormPen, buildSegments, historicalCalibration } from '../lib/chan.ts';
import type { Candle, StructureLine } from '../lib/market-types';

const bar=(i:number,low:number,high:number,close=(low+high)/2):Candle=>({time:1700000000+i*3600,open:close,close,low,high,volume:1000,closed:true});
const waves=(n:number)=>Array.from({length:n},(_,i)=>{const c=100+i*.015+Math.sin(i/7)*9+Math.sin(i/29)*14;return bar(i,c-1,c+1,c);});
const pens=(v:number[]):StructureLine[]=>v.slice(1).map((price,i)=>({from:{index:i*5,time:1700000000+i*300,price:v[i]},to:{index:(i+1)*5,time:1700000000+(i+1)*300,price},direction:price>v[i]?'up':'down',confirmed:true,confirmedAt:(i+2)*5}));

test('upward inclusion merges high/high and preserves extreme raw indices',()=>{
  const m=mergeInclusions([bar(0,1,3),bar(1,2,4),bar(2,1.5,5),bar(3,3,6)]);
  assert.deepEqual(m.map(x=>[x.low,x.high]),[[1,3],[2,5],[3,6]]);
  assert.equal(m[1].highPoint.index,2);assert.equal(m[1].lowPoint.index,1);
  assert.equal(m[1].endIndex,2);
});
test('downward inclusion merges low/low, not an enclosing envelope',()=>{
  const m=mergeInclusions([bar(0,5,8),bar(1,4,7),bar(2,3,8),bar(3,2,6)]);
  assert.deepEqual(m.map(x=>[x.low,x.high]),[[5,8],[3,7],[2,6]]);
  assert.equal(m[1].highPoint.index,1);assert.equal(m[1].lowPoint.index,2);
});
test('new pen uses both non-sharing processed fractals and raw spacing',()=>{
  const a={type:'bottom' as const,mergedIndex:1,index:1,price:10};
  const b={type:'top' as const,mergedIndex:4,index:5,price:20};
  assert.equal(canFormPen(a,b,'new'),true);
  assert.equal(canFormPen(a,b,'old'),false);
  assert.equal(canFormPen(a,{...b,index:4},'new'),false);
  assert.equal(canFormPen(a,{...b,mergedIndex:3},'new'),false);
  assert.equal(canFormPen(a,{...b,mergedIndex:5,index:6},'old'),true);
  assert.equal(canFormPen(a,{...b,price:9},'new'),false);
});
test('feature sequence case 1 confirms a non-gap turn only after right element',()=>{
  const p=pens([10,20,15,25,18,23,14]);
  const s=buildSegments(p);
  assert.equal(s[0].confirmed,true);assert.equal(s[0].from.price,10);assert.equal(s[0].to.price,25);
  assert.ok(s[0].confirmedAt>s[0].to.index);
  assert.equal(buildSegments(p.slice(0,4)).filter(x=>x.confirmed).length,0);
  assert.equal(s[0].confirmedAt,35);
});
test('feature sequence case 2 waits for reverse feature fractal across gap',()=>{
  const p=pens([10,18,14,25,21,23,19,22,16,20,17,24]);
  const short=buildSegments(p.slice(0,6));
  assert.equal(short.filter(x=>x.confirmed).length,0);
  const s=buildSegments(p);
  assert.equal(s[0].confirmed,true);assert.equal(s[0].to.price,25);
  assert.equal(s[0].confirmedAt,60);
});
test('a reverse one-pen break alone does not close a segment',()=>{
  const s=buildSegments(pens([10,20,15,25,9]));
  assert.equal(s.filter(x=>x.confirmed).length,0);
});
test('feature-sequence confirmation is symmetric for downward segments',()=>{
  const noGap=buildSegments(pens([10,20,15,25,18,23,14].map(x=>40-x)));
  assert.equal(noGap[0].direction,'down');assert.equal(noGap[0].to.price,15);
  assert.equal(noGap[0].confirmedAt,35);
  const gap=buildSegments(pens([10,18,14,25,21,23,19,22,16,20,17,24].map(x=>40-x)));
  assert.equal(gap[0].direction,'down');assert.equal(gap[0].to.price,15);
  assert.equal(gap[0].confirmedAt,60);
});
test('natural strokes: every 3-bar move with two new extremes and separated zones is a stroke; only the last stays provisional',()=>{
  const prices=[20,18,15,12,10,12,14,16,20,18,17,19,22,20,18,16,13,10,8,10,12,14,17,21,24,22,20];
  const a=analyze(prices.map((v,i)=>bar(i,v-.1,v+.1,v)));
  assert.deepEqual(a.strokes.map(x=>[x.from.index,x.to.index,x.confirmed]),[[0,4,true],[4,8,true],[8,10,true],[10,12,true],[12,18,true],[18,24,true],[24,26,false]]);
  assert.equal(a.strokes[0].confirmedAt,6);
  const old=analyze(prices.map((v,i)=>bar(i,v-.1,v+.1,v)),{penMode:'old'});
  assert.ok(old.strokes.length<a.strokes.length,'classic old pens remain available for comparison');
});
test('unfinished latest candle cannot influence structures, bias, or empirical frequencies',()=>{
  const c=waves(220),base=analyze(c);
  const appended=analyze([...c,{...bar(220,1,10000,9999),closed:false}]);
  for(const key of ['fractals','strokes','segments','centers','signals','bias','calibration','vacc','analyzedThrough'] as const)assert.deepEqual(appended[key],base[key]);
});
test('missing and invalid records preserve raw plotting indices',()=>{
  const c=waves(150);c[20]={...c[20],closed:false};c[25]={...c[25],high:NaN};
  const a=analyze(c);
  for(const f of a.fractals) {assert.equal(f.time,c[f.index].time);assert.ok(f.confirmedAt>f.index);}
  for(const s of a.strokes) {assert.equal(s.from.time,c[s.from.index].time);assert.equal(s.to.time,c[s.to.index].time);assert.ok(s.confirmedAt>=s.to.index);}
  assert.ok(a.warnings.some(x=>x.includes('无效')));
});
test('historical samples use prefix features and disjoint completed horizons',()=>{
  const c=waves(400),r=historicalCalibration(c,{horizon:12});
  assert.ok(r.records.length>0);
  for(const record of r.records) {
    assert.deepEqual(record.state,historicalCalibration(c.slice(0,record.index+1),{horizon:12}).currentState);
    assert.equal(record.targetIndex-record.index,12);
    assert.ok(record.targetIndex<c.length);
    assert.equal(record.return,c[record.targetIndex].close/c[record.index].close-1);
  }
  for(let i=1;i<r.records.length;i++)assert.ok(r.records[i].index>=r.records[i-1].targetIndex);
});
test('scores sum to 100; sample percentages sum to 100; zero samples stay unestimated',()=>{
  const a=analyze(waves(400));assert.equal(a.bias.long+a.bias.short,100);
  assert.ok(a.calibration.samples>0);
  assert.ok(Math.abs(a.calibration.up+a.calibration.down+a.calibration.flat-100)<.00001);
  assert.ok(a.calibration.wilsonLow<=a.calibration.up&&a.calibration.wilsonHigh>=a.calibration.up);
  const small=analyze(waves(20));assert.equal(small.calibration.samples,0);
  assert.deepEqual([small.calibration.up,small.calibration.down,small.calibration.flat],[0,0,0]);
  assert.deepEqual([small.calibration.wilsonLow,small.calibration.wilsonHigh],[0,100]);
  assert.equal(small.bias.long,50);
});
test('rounding preserves a zero flat class when directional counts are 1 and 79',()=>{
  let close=100;
  const c=Array.from({length:140},(_,i)=>{
    if(i)close*=i===60?1.003:.997;
    return bar(i,1,200,close);
  });
  const {calibration}=historicalCalibration(c,{horizon:1});
  assert.equal(calibration.samples,80);
  assert.deepEqual([calibration.up,calibration.down,calibration.flat],[1.3,98.7,0]);
});
test('conditional scenarios retest the stated center boundary both inside and outside the range',()=>{
  const c=waves(1000),base=analyze(c,{penMode:'old'}),center=base.centers.at(-1);
  assert.ok(center,'fixture must contain a real computed segment center');
  const readable=(n:number)=>Number(n.toPrecision(6)).toLocaleString('en-US',{maximumFractionDigits:8});
  for(const position of ['below','inside','above'] as const) {
    const price:number=position==='below'?center.low*.75:position==='above'?center.high*1.25:(center.low+center.high)/2;
    const a=analyze([...c,bar(c.length,price-1,price+1,price)],{penMode:'old'});
    const actual=a.centers.at(-1);assert.ok(actual);
    const long=a.scenarios.find(s=>s.side==='long')!,short=a.scenarios.find(s=>s.side==='short')!,range=a.scenarios.find(s=>s.side==='range')!;
    assert.equal(long.points.find(p=>p.offset===(position==='above'?4:8))?.price,actual.high);
    assert.equal(short.points.find(p=>p.offset===(position==='below'?4:8))?.price,actual.low);
    assert.ok(long.trigger.includes(`回试${position==='above'?'上沿':''} ${readable(actual.high)}`));
    assert.ok(short.trigger.includes(`反抽${position==='below'?'下沿':''} ${readable(actual.low)}`));
    assert.equal(range.title,position==='inside'?'继续区间震荡':'重返区间后震荡');
    assert.equal(range.points[1].price,position==='below'?actual.low:actual.high);
    if(position==='below')assert.match(short.title,/反抽不重返中枢后延伸/);
    if(position==='above')assert.match(long.title,/回试不重返中枢后延伸/);
    for(const s of a.scenarios) {assert.equal(s.points[0].price,price);assert.match(s.target,/不保证/);}
  }
});
test('empty data is finite, safe, and gives no invented scenario or signal',()=>{
  const a=analyze([]);assert.deepEqual(a.scenarios,[]);assert.deepEqual(a.signals,[]);
  assert.equal(a.bias.long,50);assert.equal(a.calibration.samples,0);
  assert.equal(JSON.stringify(a).includes('null'),false);
});

test('Natural Chan mode has no classic centers, no 类三买/卖 candidates and no 中枢位置 factor',()=>{
  const a=analyze(waves(1000));
  assert.deepEqual(a.centers,[]);
  assert.ok(a.signals.every(s=>!s.type.startsWith('third-')));
  assert.ok(a.bias.factors.every(f=>f.name!=='中枢位置'));
  assert.ok(analyze(waves(1000),{penMode:'old'}).centers.length>0,'classic mode keeps its centers for comparison');
});

test('structure clock: analysing up to structureAsOf reproduces the same structure as the full series',()=>{
  const c=waves(600),full=analyze(c);
  assert.ok(full.structureAsOf>0&&full.structureAsOf<c.length);
  const cut=analyze(c.slice(0,full.structureAsOf+1));
  assert.equal(cut.structureAsOf,full.structureAsOf);
  assert.deepEqual(cut.strokes.slice(0,-1),full.strokes.slice(0,-1));
  assert.deepEqual(cut.segments.filter(s=>s.confirmed),full.segments.filter(s=>s.confirmed));
});
