import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../lib/chan.ts';
import type { Candle } from '../lib/market-types';

const bar=(i:number,close:number):Candle=>({time:1700000000+i*3600,open:close,close,low:close-1,high:close+1,volume:1000,closed:true});
const waves=(n:number)=>Array.from({length:n},(_,i)=>bar(i,100+i*.015+Math.sin(i/7)*9+Math.sin(i/29)*14));

test('short month-like history exposes two conditional watch levels without inventing Chan point classes',()=>{
  const candles=waves(24),analysis=analyze(candles);
  assert.equal(analysis.centers.length,0);
  assert.equal(analysis.tradeSetups.length,2);
  assert.equal(analysis.bias.label,'样本不足');
  assert.deepEqual(analysis.tradeSetups.map(s=>s.kind),['buy-watch','sell-watch']);
  for(const setup of analysis.tradeSetups) {
    assert.equal(setup.status,'conditional');
    assert.ok(setup.price>0&&Number.isFinite(setup.invalidationPrice));
    assert.equal(setup.anchor.time,candles[setup.anchor.index].time);
    assert.ok([candles[setup.anchor.index].low,candles[setup.anchor.index].high].includes(setup.anchor.price));
    assert.match(setup.basis,/尚无已确认线段中枢/);
    assert.match(setup.trigger,/仅触价不能确认/);
    assert.doesNotMatch(setup.label,/[一二三][买卖]/);
  }
});

test('unclosed extrema cannot change pending watch levels, and closed new lows invalidate old references',()=>{
  const candles=waves(100),before=analyze(candles);
  const newLow={...bar(100,50),low:40,high:60};
  const forming=analyze([...candles,{...newLow,closed:false}]);
  assert.deepEqual(forming.tradeSetups,before.tradeSetups);
  const closed=analyze([...candles,newLow]);
  const buy=closed.tradeSetups.find(s=>s.side==='long')!;
  assert.equal(buy.price,40);
  assert.equal(buy.invalidationPrice,40);
  assert.equal(buy.anchor.index,100);
  assert.match(buy.basis,/尚待底分型确认/);
  assert.equal(buy.kind,'buy-watch');
});

test('active computed center gives boundary observations requiring the first completed lower-level retest',()=>{
  const candles=waves(500),analysis=analyze(candles,{penMode:'old'}),center=analysis.centers.at(-1);
  assert.ok(center&&center.status==='active','fixture must produce a computed active center');
  const buy=analysis.tradeSetups.find(s=>s.side==='long')!,sell=analysis.tradeSetups.find(s=>s.side==='short')!;
  assert.equal(buy.kind,'third-buy-watch');assert.equal(sell.kind,'third-sell-watch');
  assert.equal(buy.price,center.high);assert.equal(sell.price,center.low);
  assert.equal(buy.invalidationPrice,center.high);assert.equal(sell.invalidationPrice,center.low);
  assert.match(buy.trigger,/第一次次级别回试完成且低点不跌破/);
  assert.match(sell.trigger,/第一次次级别反抽完成且高点不升破/);
  for(const setup of [buy,sell]) {
    assert.match(setup.basis,/当前无法预知/);
    assert.equal(setup.status,'conditional');
    assert.equal(setup.anchor.price,setup.price);
    assert.equal(setup.anchor.time,candles[setup.anchor.index].time);
  }
});

test('old center whose first return is completed is not relabeled as another future third buy or sell',()=>{
  const candles=waves(1000);
  for(let i=1000;i<1320;i++)candles.push(bar(i,170+(i-1000)*.01+Math.sin(i/7)*9+Math.sin(i/29)*5));
  const analysis=analyze(candles,{penMode:'old'});
  assert.equal(analysis.centers.at(-1)?.status,'broken');
  assert.deepEqual(analysis.tradeSetups.map(s=>s.kind),['buy-watch','sell-watch']);
  assert.deepEqual(analysis.tradeSetups.map(s=>s.label),['中枢买观察','中枢卖观察']);
  assert.ok(analysis.tradeSetups.every(s=>s.basis.includes('旧中枢已有离开/回试结构')));
});

test('watch anchors retain raw candle indexes across invalid and unfinished records',()=>{
  const candles=waves(100);
  candles[60]={...candles[60],high:NaN};
  candles[80]={...candles[80],closed:false};
  for(const setup of analyze(candles).tradeSetups) {
    assert.equal(candles[setup.anchor.index].time,setup.anchor.time);
    assert.notEqual(candles[setup.anchor.index].closed,false);
    assert.ok([candles[setup.anchor.index].high,candles[setup.anchor.index].low].includes(setup.price));
  }
});

test('no completed history gives no invented pending trade level',()=>{
  assert.deepEqual(analyze([]).tradeSetups,[]);
  assert.deepEqual(analyze([{...bar(0,100),closed:false}]).tradeSetups,[]);
});
