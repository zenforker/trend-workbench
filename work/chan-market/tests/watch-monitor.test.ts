import test from 'node:test';
import assert from 'node:assert/strict';
import {createWatchMonitor,selectWatchInstruments,type WatchRow,type WatchSnapshot} from '../lib/watch-monitor.ts';
import type {Instrument,MarketData} from '../lib/market-types';
const now=Date.parse('2026-11-13T10:00:30Z');
const instrument=(n:number):Instrument=>({id:`crypto:T${n}USDT`,market:'crypto',symbol:`T${n}USDT`,name:`Test ${n}`,exchange:'Binance',currency:'USDT'});
function response(symbol:string,offsetMs=0){
  const value:MarketData={instrument:{...instrument(0),symbol,id:`crypto:${symbol}`},interval:'1m',source:'Binance',asOf:new Date(now).toISOString(),adjustment:'none',delayNotice:'',warnings:[],availableIntervals:['1m'],candles:Array.from({length:40},(_,i)=>({time:(now-30000-(39-i)*60000-offsetMs)/1000,open:100+i,high:102+i,low:99+i,close:101+i,volume:100,closed:i<39}))};
  return new Response(JSON.stringify(value));
}
function clock(){
  const tasks=new Map<ReturnType<typeof setTimeout>,{callback:()=>void;ms:number}>();let id=0;
  return {tasks,setTimer:(callback:()=>void,ms:number)=>{const token=++id as unknown as ReturnType<typeof setTimeout>;tasks.set(token,{callback,ms});return token;},clearTimer:(timer:ReturnType<typeof setTimeout>)=>{tasks.delete(timer);}};
}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('watch list is deduplicated and bounded to twelve symbols',()=>{
  const input=[instrument(0),instrument(0),...Array.from({length:20},(_,i)=>instrument(i+1))];
  const selected=selectWatchInstruments(input);assert.equal(selected.length,12);assert.equal(new Set(selected.map(i=>i.symbol)).size,12);assert.equal(selected[0].symbol,'T0USDT');
});
test('only two requests run concurrently and polling waits at least sixty seconds',async()=>{
  const schedule=clock(),snapshots:WatchSnapshot[]=[],pending:{symbol:string;resolve:(r:Response)=>void}[]=[];let running=0,maxRunning=0,calls=0;
  const monitor=createWatchMonitor({watchlist:Array.from({length:15},(_,i)=>instrument(i)),interval:'1m',pollMs:1,now:()=>now,...schedule,onSnapshot:s=>snapshots.push(s),fetcher:url=>{
    running++;calls++;maxRunning=Math.max(maxRunning,running);const params=new URL(url,'http://local').searchParams;assert.equal(params.get('limit'),'800');const symbol=params.get('symbol')!;
    return new Promise<Response>(resolve=>pending.push({symbol,resolve:r=>{running--;resolve(r);}}));
  }});
  monitor.start();assert.equal(calls,2);
  while(snapshots.length<12){const batch=pending.splice(0);assert.ok(batch.length);for(const item of batch)item.resolve(response(item.symbol));await flush();}
  assert.equal(calls,12);assert.equal(maxRunning,2);assert.equal(snapshots.length,12);
  assert.equal([...schedule.tasks.values()].filter(task=>task.ms>=60000).length,1);
  assert.equal([...schedule.tasks.values()][0].ms,60000);monitor.stop();assert.equal(schedule.tasks.size,0);
});
test('stop aborts every active request and late responses cannot publish snapshots or restart polling',async()=>{
  const schedule=clock(),signals:AbortSignal[]=[],finish:((r:Response)=>void)[]=[],snapshots:WatchSnapshot[]=[],states:WatchRow[]=[];
  const monitor=createWatchMonitor({watchlist:[instrument(0),instrument(1),instrument(2)],interval:'1m',now:()=>now,...schedule,onSnapshot:s=>snapshots.push(s),onStatus:s=>states.push(s),fetcher:(_url,{signal})=>{signals.push(signal);return new Promise(resolve=>finish.push(resolve));}});
  monitor.start();const statesBefore=states.length;monitor.stop();assert.equal(signals.length,2);assert.ok(signals.every(s=>s.aborted));assert.equal(schedule.tasks.size,0);
  finish.forEach((resolve,i)=>resolve(response(instrument(i).symbol)));await flush();
  assert.equal(snapshots.length,0);assert.equal(states.length,statesBefore);assert.equal(signals.length,2);assert.equal(schedule.tasks.size,0);
});
test('mismatched symbols are rejected and stale bars remain non-alertable snapshots',async()=>{
  const schedule=clock(),states:WatchRow[]=[],snapshots:WatchSnapshot[]=[];
  const monitor=createWatchMonitor({watchlist:[instrument(0),instrument(1)],interval:'1m',now:()=>now,...schedule,onSnapshot:s=>snapshots.push(s),onStatus:r=>states.push(r),fetcher:async url=>url.includes('T0USDT')?response('WRONG'):response('T1USDT',600000)});
  monitor.start();await flush();
  assert.equal(states.findLast(r=>r.instrument.symbol==='T0USDT')?.state,'error');
  assert.equal(snapshots.length,1);assert.equal(snapshots[0].health.allowSignals,false);assert.equal(snapshots[0].health.state,'stale');monitor.stop();
});
test('empty watchlist creates neither a timer nor a request',()=>{
  const schedule=clock();let calls=0;
  const monitor=createWatchMonitor({watchlist:[],interval:'1m',...schedule,onSnapshot:()=>{calls++;},fetcher:async()=>{calls++;return response('unused');}});
  monitor.start();assert.equal(calls,0);assert.equal(schedule.tasks.size,0);monitor.stop();
});

test('watch price, VAcc, confluence and forecast share the provider snapshot cutoff',async()=>{
  const schedule=clock(),states:WatchRow[]=[],snapshots:WatchSnapshot[]=[];
  const feed=await response('T0USDT').json() as MarketData;
  const last=feed.candles.at(-1)!;
  // Captured halfway through a minute. A finalized bar that closes later,
  // and a quote from a minute that has not begun, are both unavailable.
  last.closed=true;
  feed.candles.push({...last,time:last.time+60,close:999,high:1000,closed:false});
  const monitor=createWatchMonitor({watchlist:[instrument(0)],interval:'1m',now:()=>now+300000,...schedule,onStatus:r=>states.push(r),onSnapshot:s=>snapshots.push(s),fetcher:async()=>new Response(JSON.stringify(feed))});
  monitor.start();await flush();monitor.stop();
  assert.equal(snapshots.length,1);
  const {data,analysis,forecast}=snapshots[0],eligible=feed.candles.at(-3)!;
  assert.equal(data.candles.at(-1)?.time,eligible.time);
  assert.equal(analysis.vacc.at(-1)?.time,eligible.time);
  assert.equal(analysis.analyzedThrough,eligible.time);
  assert.equal(forecast.asOf,now/1000);assert.equal(forecast.referencePrice,eligible.close);
  assert.equal(analysis.confluence?.asOf,forecast.structureAsOf);
  assert.equal(states.at(-1)?.price,eligible.close);
});
test('complete 800-bar watch history supplies real same-source higher evidence without an extra fetch or old plan simulation',async()=>{
  const schedule=clock(),snapshots:WatchSnapshot[]=[];let calls=0;
  const monitor=createWatchMonitor({watchlist:[instrument(0)],interval:'1m',now:()=>now,...schedule,onSnapshot:s=>snapshots.push(s),fetcher:async()=>{
    calls++;const data=await response('T0USDT').json() as MarketData;
    data.adjustment='原始成交价格，不复权';
    data.candles=Array.from({length:800},(_,i)=>({time:(now-30000-(799-i)*60000)/1000,open:100+i,high:102+i,low:99+i,close:101+i,volume:100,closed:i<799}));
    return new Response(JSON.stringify(data));
  }});
  monitor.start();await flush();monitor.stop();
  assert.equal(calls,1);assert.equal(snapshots.length,1);
  assert.equal(snapshots[0].analysis.confluence?.higher.interval,'5m');
  assert.equal(snapshots[0].analysis.confluence?.higher.status,'ready');
  assert.ok((snapshots[0].analysis.confluence?.higher.bars??0)>=35);
  assert.deepEqual(snapshots[0].analysis.tradePlans,[]);
});
