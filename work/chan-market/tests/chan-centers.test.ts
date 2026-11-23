import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticDaily } from './synthetic-daily.ts';
import { analyze, buildCenters, buildSegments } from '../lib/chan.ts';
import type { Candle, StructureLine } from '../lib/market-types';

const lines=(values:number[],offset=0):StructureLine[]=>values.slice(1).map((price,i)=>({
  from:{index:offset+i*5,time:1700000000+(offset+i*5)*60,price:values[i]},
  to:{index:offset+(i+1)*5,time:1700000000+(offset+(i+1)*5)*60,price},
  direction:price>values[i]?'up':'down',confirmed:true,confirmedAt:offset+(i+2)*5,
}));
const assertConnected=(segments:StructureLine[])=>{
  for(let i=1;i<segments.length;i++) {
    assert.deepEqual(segments[i].from,segments[i-1].to);
    assert.notEqual(segments[i].direction,segments[i-1].direction);
  }
};

test('an invalid turn cannot skip a shared endpoint and fabricate a center from disconnected segments',()=>{
  const values=[100,120,105,122,118,120,103,121,114,117,105,135,125,142,122,133,123,156];
  for(const points of [values,values.map(p=>300-p)]) {
    const segments=buildSegments(lines(points));
    assertConnected(segments);
    assert.equal(segments.filter(s=>s.confirmed).length,1);
    assert.equal(segments[0].to.index,15);
    assert.equal(segments[1].confirmed,false);
    assert.deepEqual(segments[1].from,segments[0].to);
    assert.equal(segments[1].to.index,30);
    assert.deepEqual(buildCenters(segments),{centers:[],signals:[]});
  }
});

test('a confirmed segment endpoint must be the directional extreme throughout that segment',()=>{
  const values=[100,118,105,110,104,117,108,112,107,129];
  for(const points of [values,values.map(p=>300-p)]) {
    const segments=buildSegments(lines(points));
    assert.equal(segments.filter(s=>s.confirmed).length,0,'the local 117 turn cannot hide the earlier 118');
    assert.equal(segments[0].confirmed,false);
    assert.equal(segments[0].to.price,points.at(-1));
  }
});

test('a pen discontinuity or provisional pen cannot be removed to confirm a segment',()=>{
  const points=lines([10,20,15,25,18,23,14]);
  const unfinished=points.map((p,i)=>i===2?{...p,confirmed:false}:p);
  assert.equal(buildSegments(unfinished).filter(s=>s.confirmed).length,0);
  const gap=points.map((p,i)=>i<3?p:{...p,from:{...p.from,index:p.from.index+50,time:p.from.time+3000},to:{...p.to,index:p.to.index+50,time:p.to.time+3000},confirmedAt:p.confirmedAt+50});
  assert.equal(buildSegments(gap).filter(s=>s.confirmed).length,0);
});

test('a center requires three confirmed connected alternating segments',()=>{
  const two=lines([10,30,20]);
  assert.equal(buildCenters(two).centers.length,0);
  assert.equal(buildCenters([...two,...lines([18,28],50)]).centers.length,0);
  assert.equal(buildCenters(lines([10,30,35,20])).centers.length,0,'same direction is not a completed reversal');
  const provisional=lines([10,30,20,40]).map((s,i)=>i===1?{...s,confirmed:false}:s);
  assert.equal(buildCenters(provisional).centers.length,0,'filtering out an unfinished constituent must not join either side');
});

test('endpoint identity includes time and price as well as raw index',()=>{
  const base=lines([10,30,20,40]);
  for(const change of [{time:base[1].from.time+1},{price:base[1].from.price+1}]) {
    const broken=base.map((s,i)=>i===1?{...s,from:{...s.from,...change}}:s);
    assert.equal(buildCenters(broken).centers.length,0);
  }
});

test('a fresh connected three-segment group can form its own center after a gap',()=>{
  const {centers}=buildCenters([...lines([10,30,20]),...lines([18,28,20,30],50)]);
  assert.deepEqual(centers,[{startIndex:50,endIndex:65,low:20,high:28,level:'线段中枢',status:'active'}]);
});

test('center extension preserves the original ZD and ZG rather than taking the outer price envelope',()=>{
  const {centers,signals}=buildCenters(lines([10,30,20,40,25,35,21,50]));
  assert.deepEqual(centers,[{startIndex:0,endIndex:35,low:20,high:30,level:'线段中枢',status:'active'}]);
  assert.equal(signals.length,0);
});

test('a departure followed by a return inside or exactly on ZG remains an extension',()=>{
  for(const retest of [20,25]) {
    const {centers,signals}=buildCenters(lines([0.1,30,10,25,15,40,retest]));
    assert.equal(centers[0].status,'active');
    assert.deepEqual([centers[0].low,centers[0].high],[10,25]);
    assert.equal(signals.length,0);
  }
});

test('a completed return outside ZG breaks the old center and starts a separate new three-segment group',()=>{
  const values=[1,30,10,25,15,40,30,50,35];
  const result=buildCenters(lines(values));
  assert.deepEqual(result.centers,[
    {startIndex:0,endIndex:25,low:10,high:25,level:'线段中枢',status:'broken'},
    {startIndex:25,endIndex:40,low:35,high:40,level:'线段中枢',status:'active'},
  ]);
  assert.equal(result.signals[0].type,'third-buy-candidate');
  assert.equal(result.signals[0].index,30);
  const mirrored=buildCenters(lines(values.map(p=>100-p)));
  assert.equal(mirrored.signals[0].type,'third-sell-candidate');
  assert.deepEqual(mirrored.centers.map(c=>[c.low,c.high,c.status]),[[75,90,'broken'],[60,65,'active']]);
  const waiting=buildCenters(lines(values.slice(0,7)).map((s,i)=>i===5?{...s,confirmed:false}:s));
  assert.equal(waiting.centers[0].status,'active');
  assert.equal(waiting.signals.length,0);
});

test('BTC weekly wide center retains the true three-segment intersection and ignores the developing fourth segment',()=>{
  const prices=[6075.3,68996.6,14886,126126,57829.4],indices=[1,98,153,302,340],known=[139,195,334,357];
  const segments=lines(prices).map((s,i)=>({...s,
    from:{...s.from,index:indices[i],time:1700000000+indices[i]*604800},
    to:{...s.to,index:indices[i+1],time:1700000000+indices[i+1]*604800},
    confirmedAt:known[i],confirmed:i<3,
  }));
  assert.deepEqual(buildCenters(segments).centers,[{startIndex:1,endIndex:302,low:14886,high:68996.6,level:'线段中枢',status:'active'}]);
});

test('a subsequent segment inherits the actual knowledge time of its shared starting turn',()=>{
  // Actual Moutai weekly pen endpoints at raw indexes 506–669. The local
  // 593→631 reversal needs pens known at 663, but its starting turn is only
  // established by the preceding gap case at 677 (689 in the later snapshot).
  // Include the earlier confirmed chain: starting the window at 550 leaves
  // that anchor unestablished and legitimately changes bootstrap selection.
  const prices=[2627.88,1946.8,2320,1525.5,1949.95,1735,2216.96,1593,2077,1333,1935,1618,1935,1616.25,1794.76,1555.55,1749.1,1634.03,1777.8];
  const indices=[506,511,520,532,540,544,550,561,576,593,604,622,631,641,647,654,661,665,669];
  for(const anchorKnownAt of [677,689]) {
    const known=[522,535,542,545,551,567,577,594,605,625,632,644,648,656,663,667,671,anchorKnownAt];
    const pens=lines(prices).map((s,i)=>({...s,
      from:{...s.from,index:indices[i],time:1700000000+indices[i]*604800},
      to:{...s.to,index:indices[i+1],time:1700000000+indices[i+1]*604800},
      confirmedAt:known[i],
    }));
    const segments=buildSegments(pens),confirmed=segments.filter(s=>s.confirmed);
    assert.deepEqual(confirmed.filter(s=>s.from.index>=550).map(s=>[s.from.index,s.to.index,s.confirmedAt]),[
      [550,593,anchorKnownAt],[593,631,anchorKnownAt],[631,654,anchorKnownAt],
    ]);
    const early=buildSegments(pens.filter(p=>p.confirmedAt<=663));
    assert.ok(!early.some(s=>s.confirmed&&s.from.index===593&&s.to.index===631));
    for(const [i,s] of confirmed.entries()) {
      if(i)assert.ok(s.confirmedAt>=confirmed[i-1].confirmedAt);
      const available=buildSegments(pens.filter(p=>p.confirmedAt<=s.confirmedAt));
      assert.ok(available.some(p=>p.confirmed&&p.from.index===s.from.index&&p.to.index===s.to.index&&p.confirmedAt===s.confirmedAt));
    }
  }
});

test('bootstrap chooses the first knowable turn instead of a later turn with an older starting point',()=>{
  const values=[100,104,90,108,104,106,98,118,116,126,123,134,114,129,127,141,138,155,148,155,142,161,152,159,144,151];
  for(const points of [values,values.map(p=>300-p)]) {
    const pens=lines(points);
    const earliest=buildSegments(pens.slice(0,9)).find(s=>s.confirmed)!;
    assert.ok(earliest);
    assert.deepEqual([earliest.from.index,earliest.to.index,earliest.confirmedAt],[15,30,50]);
    for(let count=10;count<=pens.length;count++)assert.deepEqual(buildSegments(pens.slice(0,count)).find(s=>s.confirmed),earliest);
  }
});

test('bootstrap retains a reasonable developing segment when no turn can yet be confirmed',()=>{
  for(const values of [[10,20,15,25],[30,20,25,15]]) {
    const segments=buildSegments(lines(values));
    assert.equal(segments.length,1);
    assert.equal(segments[0].confirmed,false);
    assert.equal(segments[0].from.price,values[0]);
    assert.equal(segments[0].to.price,values.at(-1));
    assert.deepEqual(buildCenters(segments),{centers:[],signals:[]});
  }
});

const daily = syntheticDaily();
const research=(candles:Candle[],penMode:'new'|'old'='new')=>analyze(candles,{penMode,skipCalibration:true,skipTradePlans:true});

test('segment ranges use only their constituent confirmed pens, excluding later confirmation and future extrema',()=>{
  const pens=lines([10,20,15,25,18,23,9,50,4]);
  const early=buildSegments(pens.slice(0,6))[0],later=buildSegments(pens)[0];
  assert.equal(early.confirmed,true);
  assert.deepEqual(early.priceRange,{low:10,high:25,lowPoint:{...early.from},highPoint:{...early.to}});
  assert.deepEqual(later.priceRange,early.priceRange,'right confirmation pens reach 9 and later pens reach 50/4 outside this segment');
  const analysis=research(daily);
  for(const segment of analysis.segments.filter(s=>s.confirmed)) {
    const visible=research(daily.slice(0,segment.confirmedAt+1)).segments.find(s=>s.confirmed&&s.from.index===segment.from.index&&s.to.index===segment.to.index)!;
    assert.deepEqual(visible.priceRange,segment.priceRange);
    const points=analysis.strokes.filter(s=>s.confirmed&&s.from.index>=segment.from.index&&s.to.index<=segment.to.index&&s.confirmedAt<=segment.confirmedAt).flatMap(s=>[s.from,s.to]);
    assert.equal(segment.priceRange!.low,Math.min(...points.map(p=>p.price)));
    assert.equal(segment.priceRange!.high,Math.max(...points.map(p=>p.price)));
    assert.ok(points.some(p=>p.index===segment.priceRange!.lowPoint.index&&p.price===segment.priceRange!.low));
    assert.ok(points.some(p=>p.index===segment.priceRange!.highPoint.index&&p.price===segment.priceRange!.high));
  }
});

test('invalid range anchors cannot supply a center boundary beyond their own segment',()=>{
  const group=lines([100,80,105,85]);
  group[0].priceRange={low:80,high:110,lowPoint:{...group[0].to},highPoint:{index:30,time:1700000000+30*60,price:110}};
  assert.deepEqual(buildCenters(group),{centers:[],signals:[]});
});

test('new and old pen modes preserve causal, connected centers across left-truncated daily windows',()=>{
  for(const penMode of ['new','old'] as const)for(const offset of [0,20,26,50,230,daily.length-12]) {
    const candles=daily.slice(offset),analysis=research(candles,penMode),confirmed=analysis.segments.filter(s=>s.confirmed);
    assertConnected(analysis.segments);
    for(const [i,segment] of confirmed.entries()) {
      const inside=analysis.strokes.filter(p=>p.from.index>=segment.from.index&&p.to.index<=segment.to.index).flatMap(p=>[p.from.price,p.to.price]);
      assert.equal(segment.to.price,segment.direction==='up'?Math.max(...inside):Math.min(...inside));
      if(i===0)assert.equal(segment.from.price,segment.direction==='up'?Math.min(...inside):Math.max(...inside));
      if(i)assert.ok(segment.confirmedAt>=confirmed[i-1].confirmedAt);
      const visible=research(candles.slice(0,segment.confirmedAt+1),penMode).segments;
      assert.ok(visible.some(s=>s.confirmed&&s.from.index===segment.from.index&&s.to.index===segment.to.index&&s.from.price===segment.from.price&&s.to.price===segment.to.price));
    }
    for(const center of analysis.centers) {
      const start=confirmed.findIndex(s=>s.from.index===center.startIndex);
      assert.ok(start>=0);
      const forming=confirmed.slice(start,start+3);
      assert.equal(forming.length,3);
      assertConnected(forming);
      assert.equal(center.low,Math.max(...forming.map(s=>Math.min(s.from.price,s.to.price))));
      assert.equal(center.high,Math.min(...forming.map(s=>Math.max(s.from.price,s.to.price))));
      const end=confirmed.findIndex(s=>s.to.index===center.endIndex);
      for(const extension of confirmed.slice(start+3,end+1))assert.ok(Math.min(extension.from.price,extension.to.price)<=center.high&&Math.max(extension.from.price,extension.to.price)>=center.low);
    }
    if (candles.length === 12) assert.ok(confirmed.length < 3);
    if (confirmed.length < 3) assert.equal(analysis.centers.length, 0);
    if (penMode === 'new') assert.deepEqual(analysis.centers, [], 'Natural Chan has no classic centers');
    else if (offset === 0) assert.ok(analysis.centers.length > 0);
  }
});
