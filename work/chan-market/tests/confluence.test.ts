import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../lib/chan.ts';
import { assessConfluenceSide, evaluateHigherConfluence, evaluateRelativeVolume, evaluateVaccConfluence } from '../lib/confluence.ts';
import type { Candle, Interval, MarketData } from '../lib/market-types';
import type { ConfluenceContext, HigherConfluence, VaccConfluence, VolumeConfluence } from '../lib/confluence-types';

const epoch = (value: string) => Date.parse(value)/1000;
const start = epoch('2026-01-01T00:00:00Z');
const bar = (time: number, close=101, volume=100): Candle => ({time,open:close-1,close,high:close+1,low:close-2,volume,closed:true});
const series = (n: number, step=3600) => Array.from({length:n},(_,i)=>bar(start+i*step,100+i*.02+Math.sin(i/6)*8));
const cryptoContext: ConfluenceContext = {market:'crypto',interval:'1h',symbol:'BTCUSDT',source:'Binance 公共现货行情 · BTCUSDT',adjustment:'原始成交价格，不复权'};
function data(candles:Candle[], interval:Interval='4h'):MarketData {
  return {instrument:{id:'crypto:BTCUSDT',symbol:'BTCUSDT',name:'Bitcoin',market:'crypto',exchange:'Binance',currency:'USDT'},interval,candles,source:cryptoContext.source!,asOf:'2026-03-01T00:00:00Z',delayNotice:'',adjustment:cryptoContext.adjustment!,warnings:[],availableIntervals:['1h','4h']};
}
const readyVacc:VaccConfluence={status:'ready',direction:'long',pending:null,momentum:'strengthening',vel:1,acc:.1,samples:50};
const readyVolume:VolumeConfluence={status:'ready',ratio:1.5,participation:'expanded',priceDirection:'long',samples:20,benchmark:'rolling-bars',reason:'ready'};
const readyHigher:HigherConfluence={interval:'4h',status:'ready',direction:'long',bars:100,asOf:start};

const vaccPoints=(n:number,f:(i:number)=>Partial<{vel:number;acc:number;state:'long'|'short'|null;pending:'long'|'short'|null}>)=>
  Array.from({length:n},(_,i)=>({time:start+i*3600,vel:1,acc:.1,state:null,pending:null,...f(i)}));

test('VAcc remains one evidence group; an unconfirmed zero-cross is pending, not aligned',()=>{
  const vacc=evaluateVaccConfluence(vaccPoints(40,()=>({vel:.5,acc:.2,pending:'long'})),100);
  assert.equal(vacc.status,'ready');assert.equal(vacc.direction,'neutral');assert.equal(vacc.pending,'long');
  const assessment=assessConfluenceSide('long',vacc,readyVolume,readyHigher);
  assert.equal(assessment.status,'mixed');
  assert.equal(assessment.evidence.filter(e=>e.factor==='vacc').length,1);
  assert.equal(assessment.evidence[0].code,'vacc-pending');
});

test('VAcc confirmed direction requires Vel on the same side of zero',()=>{
  const confirmed=evaluateVaccConfluence(vaccPoints(40,()=>({vel:2,acc:.3,state:'long'})),100);
  assert.equal(confirmed.direction,'long');assert.equal(confirmed.momentum,'strengthening');
  assert.equal(assessConfluenceSide('long',confirmed,readyVolume,readyHigher).evidence[0].code,'vacc-aligned');
  assert.equal(assessConfluenceSide('short',confirmed,readyVolume,readyHigher).evidence[0].code,'vacc-opposed');
  const crossedBack=evaluateVaccConfluence(vaccPoints(40,()=>({vel:-.5,acc:-.3,state:'long'})),100);
  assert.equal(crossedBack.direction,'neutral');
});

test('VAcc deceleration and short history cannot claim full alignment',()=>{
  const points=vaccPoints(40,i=>({vel:2,acc:i===39?-.4:.2,state:'long'}));
  const vacc=evaluateVaccConfluence(points,100);
  assert.equal(vacc.direction,'long');assert.equal(vacc.momentum,'weakening');
  assert.equal(assessConfluenceSide('long',vacc,readyVolume,readyHigher).evidence[0].code,'vacc-weakening');
  assert.equal(evaluateVaccConfluence(points.slice(-20),100).status,'insufficient');
});

test('US minute volume compares local session slots across DST and excludes opening spikes',()=>{
  const dates=['2026-02-23','2026-02-24','2026-02-25','2026-02-26','2026-02-27'];
  const previous=dates.flatMap(d=>[bar(epoch(`${d}T14:30:00Z`),101,10000),bar(epoch(`${d}T15:30:00Z`),101,100)]);
  const candles=[...previous,bar(epoch('2026-03-09T13:30:00Z'),101,10000),bar(epoch('2026-03-09T14:30:00Z'),101,150)];
  const volume=evaluateRelativeVolume(candles,{market:'us',interval:'1h'});
  assert.equal(volume.samples,5);assert.equal(volume.ratio,1.5);
  assert.equal(volume.participation,'expanded');assert.equal(volume.benchmark,'same-session-slot');
});

test('stock same-day observations and other intraday slots cannot fill missing daily samples',()=>{
  const candles=Array.from({length:40},(_,i)=>bar(epoch('2026-02-24T01:30:00Z')+i*60,101,100));
  const volume=evaluateRelativeVolume(candles,{market:'cn',interval:'1m'});
  assert.equal(volume.status,'insufficient');assert.equal(volume.samples,0);
  assert.equal(volume.ratio,null);
});

test('rolling relative volume excludes its own observation and unfinished bars',()=>{
  const candles=[...series(20),bar(start+20*3600,101,200)];
  const base=evaluateRelativeVolume(candles,cryptoContext);
  assert.equal(base.ratio,2);assert.equal(base.samples,20);
  const extra=evaluateRelativeVolume([...candles,{...bar(start+21*3600,101,100000),closed:false}],cryptoContext);
  assert.deepEqual(extra,base);
  assert.equal(evaluateRelativeVolume(candles.map(c=>({...c,volume:0})),cryptoContext).reason,'zero-volume');
  const partlyMissing=candles.map((c,i)=>i===4?{...c,volume:0}:c);
  assert.equal(evaluateRelativeVolume(partlyMissing,cryptoContext).reason,'zero-volume');
  assert.equal(evaluateRelativeVolume(partlyMissing,cryptoContext).ratio,null);
});

test('higher context passes only bars closed and available at the current historical instant',()=>{
  const candles=series(40,14400),asOf=start+35*14400;
  // The future candles are marked closed by today's data feed, but were not available then.
  const context={...cryptoContext,higher:{interval:'4h' as const,status:'ready' as const,data:data(candles)}};
  let observed:Candle[]=[];
  const result=evaluateHigherConfluence(context,asOf,bars=>{observed=bars;return 'long';});
  assert.equal(result.status,'ready');assert.equal(result.bars,35);
  assert.equal(observed.at(-1)?.time,start+34*14400);assert.equal(result.asOf,asOf);
  const undefinedClosed=candles.map(c=>({...c,closed:undefined}));
  assert.equal(evaluateHigherConfluence({...context,higher:{...context.higher,data:data(undefinedClosed)}},asOf,()=>{throw new Error('must not analyze unknown close state');}).status,'insufficient');
});

test('higher context rejects mismatched symbols, providers, intervals and adjustment bases',()=>{
  const higher=data(series(40,14400)),asOf=start+40*14400;
  const context={...cryptoContext,higher:{interval:'4h' as const,status:'ready' as const,data:higher}};
  for(const modified of [
    {...higher,instrument:{...higher.instrument,symbol:'ETHUSDT'}},
    {...higher,source:'Kraken 公共现货行情 · BTC/USD'},
    {...higher,interval:'1d' as const},
    {...higher,adjustment:'前复权'},
  ]) assert.equal(evaluateHigherConfluence({...context,higher:{...context.higher,data:modified}},asOf,()=>{throw new Error('mismatch callback');}).status,'mismatch');
  const unknown='来源分钟OHLC（复权口径未独立核验）';
  assert.equal(evaluateHigherConfluence({...context,adjustment:unknown,higher:{...context.higher,data:{...higher,adjustment:unknown}}},asOf,()=> 'long').status,'mismatch');
});

test('higher bars reported closed beyond the provider capture time cannot supply evidence',()=>{
  const higher=data(series(40,14400)),asOf=start+40*14400;
  for(const snapshotTime of [new Date((start+34*14400)*1000).toISOString(),'invalid']){
    const context:ConfluenceContext={...cryptoContext,higher:{interval:'4h',status:'ready',data:{...higher,asOf:snapshotTime}}};
    const result=evaluateHigherConfluence(context,asOf,()=>{throw new Error('future parent used');});
    assert.equal(result.status,'insufficient');assert.ok(result.bars<=34);
  }
});

test('equivalent Yahoo hosts and 4H aggregation labels preserve provider identity',()=>{
  const candles=Array.from({length:40},(_,i)=>bar(epoch('2026-01-05T14:30:00Z')+i*86400));
  const higher={...data(candles),instrument:{id:'us:AAPL',symbol:'AAPL',name:'Apple',market:'us' as const,exchange:'NASDAQ',currency:'USD'},source:'Yahoo Finance 网页行情 · query2.finance.yahoo.com · 1小时聚合4小时',adjustment:'来源原始OHLC；拆股或其他公司行动可能影响历史比较'};
  const context:ConfluenceContext={market:'us',interval:'1h',symbol:'AAPL',source:'Yahoo Finance 网页行情 · query1.finance.yahoo.com',adjustment:'来源原始OHLC；拆股或其他公司行动可能影响历史比较',higher:{interval:'4h',status:'ready',data:higher}};
  const result=evaluateHigherConfluence(context,epoch('2026-02-13T19:00:00Z'),()=> 'long');
  assert.equal(result.status,'ready');
});

test('stale or short higher history cannot provide alignment',()=>{
  const higher=data(series(35,14400));
  const context={...cryptoContext,higher:{interval:'4h' as const,status:'ready' as const,data:higher}};
  assert.equal(evaluateHigherConfluence(context,start+40*14400,()=>{throw new Error('stale callback');}).status,'stale');
  assert.equal(evaluateHigherConfluence(context,start+34*14400,()=>{throw new Error('short history callback');}).status,'insufficient');
});

test('imported CSV and unavailable larger monthly interval retain explicit missing evidence',()=>{
  const imported=evaluateHigherConfluence({...cryptoContext,higher:{interval:'4h',status:'imported'}},start,()=> 'long');
  assert.equal(imported.status,'imported');
  assert.equal(evaluateHigherConfluence({...cryptoContext,interval:'1M'},start,()=> 'long').status,'none');
  assert.equal(assessConfluenceSide('long',readyVacc,readyVolume,imported).status,'insufficient');
});

test('all groups must agree; missing evidence and disagreements cannot be outvoted',()=>{
  assert.equal(assessConfluenceSide('long',readyVacc,readyVolume,readyHigher).status,'aligned');
  assert.equal(assessConfluenceSide('long',readyVacc,{...readyVolume,participation:'normal'},readyHigher).status,'mixed');
  assert.equal(assessConfluenceSide('long',readyVacc,readyVolume,{...readyHigher,direction:'short'}).status,'mixed');
  assert.equal(assessConfluenceSide('long',{...readyVacc,direction:'short'},readyVolume,{...readyHigher,direction:'short'}).status,'opposed');
  assert.equal(assessConfluenceSide('long',readyVacc,readyVolume,{...readyHigher,status:'error'}).status,'insufficient');
});

test('advisory assessment never changes prices, triggered history, bias or decision',()=>{
  const candles=series(220),base=analyze(candles),context:ConfluenceContext={...cryptoContext,higher:{interval:'4h',status:'ready',data:data(series(80,14400))}};
  const evaluated=analyze(candles,{context});
  for(const key of ['tradePlans','planSession','decision','bias','signals','calibration'] as const)assert.deepEqual(evaluated[key],base[key]);
  assert.equal(evaluated.confluence?.advisory,true);
  const withSession=analyze(candles.slice(0,200),{context});
  const continued=analyze(candles,{context,planSession:withSession.planSession});
  const originalContinued=analyze(candles,{planSession:withSession.planSession});
  assert.deepEqual(continued.tradePlans,originalContinued.tradePlans);assert.deepEqual(continued.decision,originalContinued.decision);
});

test('replay confluence is invariant to future higher candles and current unfinished candle',()=>{
  const candles=series(220),pastHigher=series(55,14400),futureHigher=series(90,14400);
  const context:ConfluenceContext={...cryptoContext,higher:{interval:'4h',status:'ready',data:data(pastHigher)}};
  const past=analyze(candles,{context});
  const future=analyze([...candles,{...bar(start+220*3600,999999,999999),closed:false}],{context:{...context,higher:{interval:'4h',status:'ready',data:data(futureHigher)}}});
  assert.deepEqual(future.confluence,past.confluence);assert.deepEqual(future.tradePlans,past.tradePlans);
});

test('lightweight validation option skips only descriptive historical frequency calculation',()=>{
  const candles=series(160),base=analyze(candles,{context:cryptoContext}),light=analyze(candles,{context:cryptoContext,skipCalibration:true});
  assert.deepEqual(light.confluence,base.confluence);assert.deepEqual(light.tradePlans,base.tradePlans);assert.deepEqual(light.bias,base.bias);
  assert.equal(light.calibration.samples,0);assert.match(light.calibration.method,/已跳过/);
});
