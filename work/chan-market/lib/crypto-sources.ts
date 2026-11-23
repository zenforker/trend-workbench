import type { Candle, Instrument, Interval, MarketData } from './market-types';

// Public, independent exchange feeds. Never relabel USD as USDT or blend venues.
export class CryptoDataError extends Error {
  status: number;
  upstreamStatus?: number;
  constructor(message: string, status = 502, upstreamStatus?: number) { super(message); this.name = 'CryptoDataError'; this.status=status; this.upstreamStatus=upstreamStatus; }
}
export type CryptoProvider = 'binance' | 'okx' | 'bitget' | 'bybit' | 'kraken';
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type Pair = { symbol: string; base: string; quote: string; providerId: string; responseId?: string };
const intervals: Interval[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];
const labels: Record<CryptoProvider, string> = {binance: 'Binance', okx: 'OKX', bitget: 'Bitget', bybit: 'Bybit', kraken: 'Kraken'};
const minutes: Record<Interval, number> = {'1m':1,'5m':5,'15m':15,'30m':30,'1h':60,'4h':240,'1d':1440,'1w':10080,'1M':0};
const okxBars: Record<Interval,string> = {'1m':'1m','5m':'5m','15m':'15m','30m':'30m','1h':'1H','4h':'4H','1d':'1Dutc','1w':'1Wutc','1M':'1Mutc'};
const bitgetBars: Record<Interval,string> = {'1m':'1min','5m':'5min','15m':'15min','30m':'30min','1h':'1h','4h':'4h','1d':'1Dutc','1w':'1Wutc','1M':'1Mutc'};
const bybitBars: Record<Interval,string> = {'1m':'1','5m':'5','15m':'15','30m':'30','1h':'60','4h':'240','1d':'D','1w':'W','1M':'M'};
const names: Record<string,string> = {BTC:'比特币 Bitcoin',ETH:'以太坊 Ethereum',SOL:'Solana',BNB:'BNB',DOGE:'狗狗币 Dogecoin',XRP:'XRP',ADA:'Cardano',AVAX:'Avalanche',LINK:'Chainlink',SUI:'Sui'};
const alias = (value: string) => value === 'XBT' ? 'BTC' : value === 'XDG' ? 'DOGE' : value;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
const rows = (value: unknown): unknown[][] => Array.isArray(value) ? value.filter(Array.isArray) : [];
function canonical(input: string): string {
  const value = input.trim().toUpperCase().replace(/[\/-]/g, '');
  if (!/^[A-Z0-9]{4,30}$/.test(value)) throw new CryptoDataError('请输入现货交易对，例如 BTCUSDT。',400);
  return value;
}
function clean(input: Candle[]): Candle[] {
  const valid = input.filter(c => [c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite) && c.time>0 && c.low>0 && c.volume>=0 && c.high>=Math.max(c.open,c.close) && c.low<=Math.min(c.open,c.close));
  return [...new Map(valid.map(c=>[c.time,c])).values()].sort((a,b)=>a.time-b.time);
}
function instrument(pair: Pair, provider: CryptoProvider): Instrument {
  return {id:`crypto:${pair.symbol}`,symbol:pair.symbol,name:names[pair.base]||`${pair.base} / ${pair.quote}`,market:'crypto',exchange:labels[provider],currency:pair.quote};
}

function currentPeriodStart(interval: Interval, at: number): number {
  const date=new Date(at);
  if(interval==='1M')return Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1)/1000;
  if(interval==='1w')return (Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate())-((date.getUTCDay()+6)%7)*86400000)/1000;
  const seconds=minutes[interval]*60;
  return Math.floor(at/1000/seconds)*seconds;
}

type HistoryCandidate = { provider: CryptoProvider; pair: Pair; candles: Candle[] };
function deeperCurrentHistory(a: HistoryCandidate, b: HistoryCandidate): HistoryCandidate {
  // Every crypto feed uses period-open timestamps. Never let a longer but stale
  // history replace a newer quote, and never splice prices from different venues.
  const latest=a.candles.at(-1)!.time-b.candles.at(-1)!.time;
  if(latest!==0)return latest>0?a:b;
  const complete=a.candles.filter(c=>c.closed!==false).length-b.candles.filter(c=>c.closed!==false).length;
  if(complete!==0)return complete>0?a:b;
  return a.candles.length>=b.candles.length?a:b;
}

/** Kraken has daily bars but no calendar-month bars. Only full observed months
 * (and the current forming month) are aggregated; a truncated first month is omitted. */
export function aggregateCryptoMonths(daily: Candle[], now = Date.now()): Candle[] {
  const groups = new Map<number,Candle[]>();
  for (const c of clean(daily)) {
    const d = new Date(c.time*1000), key=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)/1000;
    const group=groups.get(key)||[];group.push(c);groups.set(key,group);
  }
  return [...groups].flatMap(([start, bars]) => {
    if (bars[0].time !== start || bars.some((b,i)=>i>0&&b.time-bars[i-1].time!==86400)) return [];
    const d=new Date(start*1000),end=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)/1000;
    const complete=end*1000<=now&&bars.at(-1)!.time+86400===end&&bars.every(b=>b.closed!==false);
    // An incomplete old calendar month is unavailable data, not a completed bar.
    if (end*1000<=now && !complete) return [];
    return [{time:start,open:bars[0].open,high:Math.max(...bars.map(b=>b.high)),low:Math.min(...bars.map(b=>b.low)),close:bars.at(-1)!.close,volume:bars.reduce((sum,b)=>sum+b.volume,0),closed:complete}];
  });
}

/** Works in a Worker and in a browser: fixed public hosts, credential-free GET,
 * CORS-safe headers, bounded pagination. Fetch injection is for deterministic tests. */
export function createCryptoClient(fetcher: Fetcher = (url,init)=>fetch(url,init), now: ()=>number = Date.now) {
  const directories = new Map<string,{expires:number;value:Promise<Pair[]>}>();
  const cooldowns = new Map<CryptoProvider,{until:number;error:CryptoDataError}>();
  let routeVersion=0;
  function resetMarketNetworkFailures(){
    routeVersion++;
    for(const [provider,entry] of cooldowns)if(entry.error.upstreamStatus!==429)cooldowns.delete(provider);
  }
  let lastGood: CryptoProvider | undefined;
  let lastGoodMonthly: CryptoProvider | undefined;
  function order(interval?:Interval): CryptoProvider[] {
    // A healthy minute feed must not pin monthly history to Kraken's 720-day
    // retention window. Exhaust native calendar-month feeds before aggregating.
    if(interval==='1M') {
      const native:CryptoProvider[]=['binance','okx','bitget','bybit'];
      return [...(lastGoodMonthly&&native.includes(lastGoodMonthly)?[lastGoodMonthly,...native.filter(p=>p!==lastGoodMonthly)]:native),'kraken'];
    }
    const all: CryptoProvider[]=['binance','okx','kraken','bitget','bybit'];
    return lastGood ? [lastGood,...all.filter(p=>p!==lastGood)] : all;
  }
  async function get(provider: CryptoProvider, url: string, signal?: AbortSignal): Promise<unknown> {
    const cooldown=cooldowns.get(provider);
    if(cooldown&&cooldown.until>now())throw cooldown.error;
    const requestRoute=routeVersion;
    const controller=new AbortController(),abort=()=>controller.abort();
    if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,6500);
    try {
      const response=await fetcher(url,{signal:controller.signal,credentials:'omit',headers:{Accept:'application/json'}});
      if(!response.ok) {
        if(response.status===400) {
          const body=record(await response.json().catch(()=>null));
          if((provider==='binance'&&body.code===-1121)||(provider==='bitget'&&body.code==='40034')) {
            throw new CryptoDataError(`${labels[provider]} 未收录该交易对`,404,400);
          }
        }
        const error=new CryptoDataError(`${labels[provider]} 返回 HTTP ${response.status}`,response.status===404?404:502,response.status);
        // An explicit rate or access limit applies across requests. A failed
        // connection or 5xx on one endpoint must not suppress a later refresh.
        if(response.status===429||(requestRoute===routeVersion&&[403,451].includes(response.status))) {
          let delay=response.status===429?60000:300000;
          const retry=response.headers.get('retry-after');
          if(retry&&response.status===429){
            const wait=/^\d+$/.test(retry)?Number(retry)*1000:Date.parse(retry)-now();
            if(Number.isFinite(wait)&&wait>=0)delay=wait;
          }
          cooldowns.set(provider,{until:now()+delay,error});
        }
        throw error;
      }
      return await response.json();
    } catch(error) {
      if(signal?.aborted)throw new DOMException('请求已取消','AbortError');
      if(error instanceof CryptoDataError)throw error;
      throw new CryptoDataError(`${labels[provider]} 连接超时或数据格式异常`);
    } finally { clearTimeout(timer);signal?.removeEventListener('abort',abort); }
  }
  async function directory(provider: CryptoProvider, signal?: AbortSignal, symbol?: string, hint?: Pair): Promise<Pair[]> {
    const waitForCaller = (value: Promise<Pair[]>): Promise<Pair[]> => {
      if(!signal)return value;
      if(signal.aborted)return Promise.reject(new DOMException('请求已取消','AbortError'));
      return new Promise((resolve,reject)=>{
        const abort=()=>{signal.removeEventListener('abort',abort);reject(new DOMException('请求已取消','AbortError'));};
        signal.addEventListener('abort',abort,{once:true});
        value.then(result=>{signal.removeEventListener('abort',abort);resolve(result);},error=>{signal.removeEventListener('abort',abort);reject(error);});
      });
    };
    // OKX uses a hyphenated identity. Only narrow that lookup once the two
    // currencies have been verified. Never guess where an unknown symbol splits.
    const lookup=provider==='okx'?(hint?`${hint.base}-${hint.quote}`:undefined):symbol;
    const key=`${provider}:${lookup||'*'}`;
    const cached=directories.get(key);if(cached&&cached.expires>now())return waitForCaller(cached.value);
    const parameter=lookup?encodeURIComponent(lookup):'';
    // A shared directory load has its own bounded timeout. Cancelling the first
    // chart request must not abort a second chart/search waiting on that load.
    const value=(async()=>{
      let result: Pair[]=[];
      if(provider==='binance') {
        const payload=record(await get(provider,'https://data-api.binance.vision/api/v3/exchangeInfo?showPermissionSets=false'+(parameter?'&symbol='+parameter:'')));
        if(!Array.isArray(payload.symbols))throw new CryptoDataError('Binance 现货目录暂不可用。');
        result=(Array.isArray(payload.symbols)?payload.symbols:[]).flatMap(item=>{
          const r=record(item);return r.status==='TRADING'&&r.isSpotTradingAllowed!==false&&typeof r.symbol==='string'&&typeof r.baseAsset==='string'&&typeof r.quoteAsset==='string'&&r.symbol===r.baseAsset+r.quoteAsset?[{symbol:r.symbol,base:r.baseAsset,quote:r.quoteAsset,providerId:r.symbol}]:[];
        });
      } else if(provider==='okx') {
        const payload=record(await get(provider,'https://www.okx.com/api/v5/public/instruments?instType=SPOT'+(parameter?'&instId='+parameter:'')));
        if(lookup&&payload.code==='51001')return [];
        if(payload.code!=='0'||!Array.isArray(payload.data))throw new CryptoDataError('OKX 现货目录暂不可用。');
        result=(Array.isArray(payload.data)?payload.data:[]).flatMap(item=>{
          const r=record(item);return r.state==='live'&&typeof r.baseCcy==='string'&&typeof r.quoteCcy==='string'&&typeof r.instId==='string'&&r.instId===`${r.baseCcy}-${r.quoteCcy}`?[{symbol:r.baseCcy+r.quoteCcy,base:r.baseCcy,quote:r.quoteCcy,providerId:r.instId}]:[];
        });
      } else if(provider==='bitget') {
        const payload=record(await get(provider,'https://api.bitget.com/api/v2/spot/public/symbols'+(parameter?'?symbol='+parameter:'')));
        if(payload.code!=='00000'||!Array.isArray(payload.data))throw new CryptoDataError('Bitget 现货目录暂不可用。');
        result=(Array.isArray(payload.data)?payload.data:[]).flatMap(item=>{
          const r=record(item);return r.status==='online'&&typeof r.symbol==='string'&&typeof r.baseCoin==='string'&&typeof r.quoteCoin==='string'&&r.symbol===r.baseCoin.toUpperCase()+r.quoteCoin.toUpperCase()?[{symbol:r.symbol,base:r.baseCoin.toUpperCase(),quote:r.quoteCoin.toUpperCase(),providerId:r.symbol}]:[];
        });
      } else if(provider==='bybit') {
        const payload=record(await get(provider,'https://api.bybit.com/v5/market/instruments-info?category=spot'+(parameter?'&symbol='+parameter:'')));
        const data=record(payload.result);
        if(payload.retCode!==0||data.category!=='spot'||!Array.isArray(data.list))throw new CryptoDataError('Bybit 现货目录暂不可用。');
        result=(Array.isArray(data.list)?data.list:[]).flatMap(item=>{
          const r=record(item);return r.status==='Trading'&&typeof r.symbol==='string'&&typeof r.baseCoin==='string'&&typeof r.quoteCoin==='string'&&r.symbol===r.baseCoin+r.quoteCoin?[{symbol:r.symbol,base:r.baseCoin,quote:r.quoteCoin,providerId:r.symbol}]:[];
        });
      } else {
        const payload=record(await get(provider,'https://api.kraken.com/0/public/AssetPairs'+(parameter?'?pair='+parameter:'')));
        if(lookup&&Array.isArray(payload.error)&&payload.error.includes('EQuery:Unknown asset pair'))return [];
        if(Array.isArray(payload.error)&&payload.error.length)throw new CryptoDataError('Kraken 现货目录暂不可用。');
        if(!payload.result||Array.isArray(payload.result)||typeof payload.result!=='object')throw new CryptoDataError('Kraken 现货目录暂不可用。');
        result=Object.entries(record(payload.result)).flatMap(([key,item])=>{
          const r=record(item),parts=typeof r.wsname==='string'?r.wsname.split('/'):[];
          if(parts.length!==2||(r.status&&r.status!=='online'))return [];
          const base=alias(parts[0]),quote=alias(parts[1]);return [{symbol:base+quote,base,quote,providerId:typeof r.altname==='string'?r.altname:key,responseId:key}];
        });
      }
      result=result.filter(r=>/^[A-Z0-9]{4,30}$/.test(r.symbol)&&/^[A-Z0-9-]+$/.test(r.providerId));
      if(!lookup&&!result.length)throw new CryptoDataError(`${labels[provider]} 未返回有效现货目录。`);
      return result;
    })().catch(error=>{
      // A generic HTTP 404 can come from a gateway. Only recognized exchange
      // symbol errors count as an absent listing.
      if(lookup&&error instanceof CryptoDataError&&error.status===404&&error.upstreamStatus===400)return [];
      if(directories.get(key)?.value===value)directories.delete(key);
      throw error;
    });
    // Pair-specific lookups keep a cold chart small and search still gets the
    // full directory. Bound memory in a long-running desktop or worker session.
    directories.delete(key);
    if(directories.size>=256)directories.delete(directories.keys().next().value!);
    directories.set(key,{expires:now()+30*60000,value});return waitForCaller(value);
  }
  async function candlesFor(provider:CryptoProvider,pair:Pair,interval:Interval,limit:number,signal:AbortSignal,callerSignal?:AbortSignal):Promise<Candle[]> {
    const observed=(input:Candle[])=>clean(input).filter(c=>c.time*1000<=now());
    if(provider==='bitget'||provider==='bybit') {
      let raw:unknown[][];
      if(provider==='bitget') {
        // 1M uses UTC+8 at Bitget; 1Mutc explicitly requests UTC month boundaries.
        const payload=record(await get(provider,`https://api.bitget.com/api/v2/spot/market/candles?symbol=${encodeURIComponent(pair.providerId)}&granularity=${bitgetBars[interval]}&limit=${limit}`,signal));
        if(payload.code!=='00000')throw new CryptoDataError(`Bitget 暂无 ${pair.providerId} 的该周期数据。`,404);
        raw=rows(payload.data);
      } else {
        const payload=record(await get(provider,`https://api.bybit.com/v5/market/kline?category=spot&symbol=${encodeURIComponent(pair.providerId)}&interval=${bybitBars[interval]}&limit=${limit}`,signal));
        const data=record(payload.result);
        if(payload.retCode!==0||data.category!=='spot'||data.symbol!==pair.providerId)throw new CryptoDataError('Bybit 行情响应的现货交易对不匹配。');
        raw=rows(data.list);
      }
      const parsed=observed(raw.map(r=>{
        const time=Number(r[0])/1000,d=new Date(time*1000);
        const end=interval==='1M'?Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1):(time+minutes[interval]*60)*1000;
        return {time,open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),closed:end<=now()-2000};
      }));
      if(parsed.some(c=>c.time!==currentPeriodStart(interval,c.time*1000)))throw new CryptoDataError(interval==='1M'
        ?`${labels[provider]} 返回的时间不是UTC月首，未作为月线使用。`:`${labels[provider]} 返回的K线时间与所选周期不符。`);
      return parsed.slice(-limit);
    }
    if(provider==='binance') {
      let accumulated:Candle[]=[],cursor:number|undefined;
      // A venue may return fewer rows than requested. Move backwards using its
      // real timestamps, with both a page bound and a strict progress check.
      for(let page=0;page<4&&accumulated.length<limit;page++) {
        const query=new URLSearchParams({symbol:pair.providerId,interval,limit:String(Math.min(1000,limit-accumulated.length))});
        if(cursor!==undefined)query.set('endTime',String(cursor));
        let raw:unknown[][];
        try { raw=rows(await get(provider,`https://data-api.binance.vision/api/v3/klines?${query}`,signal)); }
        catch(error) {
          if(callerSignal?.aborted||!accumulated.length)throw error;
          break; // An unavailable backfill page must not erase the live window.
        }
        if(!raw.length)break;
        const parsed=observed(raw.map(r=>({time:Number(r[0])/1000,open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),closed:Number(r[6])<now()-2000})));
        // Keep the first, newest response for an overlapping candle.
        accumulated=observed([...parsed,...accumulated]);
        const stamps=raw.map(r=>Number(r[0])).filter(t=>Number.isFinite(t)&&t>0);
        const next=stamps.length?Math.min(...stamps)-1:NaN;
        if(!Number.isFinite(next)||(cursor!==undefined&&next>=cursor))break;
        cursor=next;
      }
      return accumulated.slice(-limit);
    }
    if(provider==='okx') {
      let accumulated:Candle[]=[],cursor:number|undefined;
      // Latest endpoint has 1,440 bars: enough for the tool's capped 1,000-bar window.
      for(let page=0;page<4&&accumulated.length<limit;page++) {
        const query=new URLSearchParams({instId:pair.providerId,bar:okxBars[interval],limit:String(Math.min(300,limit-accumulated.length+(cursor===undefined?0:1)))});
        if(cursor!==undefined)query.set('after',String(cursor));
        let pageRows:unknown[][];
        try {
          const payload=record(await get(provider,`https://www.okx.com/api/v5/market/candles?${query}`,signal));
          if(payload.code!=='0')throw new CryptoDataError(`OKX 暂无 ${pair.providerId} 的该周期数据。`,404);
          pageRows=rows(payload.data);
        } catch(error) {
          if(callerSignal?.aborted||!accumulated.length)throw error;
          break;
        }
        if(!pageRows.length)break;
        const parsed=observed(pageRows.map(r=>({time:Number(r[0])/1000,open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),closed:r[8]==='1'})));
        accumulated=observed([...parsed,...accumulated]);
        const stamps=pageRows.map(r=>Number(r[0])).filter(t=>Number.isFinite(t)&&t>0);
        const next=stamps.length?Math.min(...stamps):NaN;
        if(!Number.isFinite(next)||(cursor!==undefined&&next>=cursor))break;
        cursor=next;
      }
      return accumulated.slice(-limit);
    }
    const providerInterval=interval==='1M'?1440:minutes[interval];
    const payload=record(await get(provider,`https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(pair.providerId)}&interval=${providerInterval}`,signal));
    if(Array.isArray(payload.error)&&payload.error.length)throw new CryptoDataError(`Kraken 暂无 ${pair.providerId} 的该周期数据。`,404);
    const data=Object.entries(record(payload.result)).filter(([key,value])=>key!=='last'&&Array.isArray(value));
    if(data.length!==1)throw new CryptoDataError('Kraken 行情响应缺少唯一交易对。');
    if(data[0][0]!==pair.providerId&&data[0][0]!==pair.responseId)throw new CryptoDataError('Kraken 行情响应的现货交易对不匹配。');
    const raw=rows(data[0][1]),lastTime=Math.max(...raw.map(r=>Number(r[0])));
    const parsed=observed(raw.map(r=>({time:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[6]),closed:Number(r[0])<lastTime&&Number(r[0])+providerInterval*60<now()/1000-2})));
    return (interval==='1M'?aggregateCryptoMonths(parsed,now()):parsed).slice(-limit);
  }
  async function getCryptoCandles(rawSymbol:string,interval:Interval,requestedLimit=800,signal?:AbortSignal):Promise<MarketData> {
    const symbol=canonical(rawSymbol);
    if(!intervals.includes(interval))throw new CryptoDataError('不支持该加密货币周期。',400);
    const limit=Math.max(35,Math.min(1000,Math.floor(requestedLimit)||800)),failures:string[]=[];let missing=0;
    const providers=order(interval);
    let identity:Pair|undefined,best:HistoryCandidate|undefined;
    type Outcome={candidate?:HistoryCandidate;failure?:string;missing?:boolean};
    async function attempt(provider:CryptoProvider,establishIdentity:boolean):Promise<Outcome> {
      // Covers listing verification and every pagination request together.
      // Even if all five feeds hang, failover stays within the chart timeout.
      const deadline=AbortSignal.timeout(10000);
      const providerSignal=signal?AbortSignal.any([signal,deadline]):deadline;
      try {
        const pair=(await directory(provider,providerSignal,symbol,identity)).find(r=>r.symbol===symbol);
        if(!pair)return {missing:true,failure:`${labels[provider]} 未收录该交易对`};
        // Concatenated symbols alone are not an identity: AB/CD and A/BCD
        // must not become interchangeable just because both spell ABCD.
        if(identity&&(pair.base!==identity.base||pair.quote!==identity.quote))throw new CryptoDataError(`${labels[provider]} 现货交易对的基础币或报价币不匹配。`);
        // Only the serial discovery phase can establish identity. Concurrent
        // alternative directories can validate it but cannot race to replace it.
        if(!identity) {
          if(!establishIdentity)throw new CryptoDataError('尚未核验现货交易对身份。');
          identity=pair;
        }
        const candles=await candlesFor(provider,pair,interval,limit,providerSignal,signal);
        if(!candles.length)throw new CryptoDataError(`${labels[provider]} 未返回有效K线。`,404);
        if(interval==='1M'&&candles.some(c=>{
          const d=new Date(c.time*1000);
          return c.time*1000!==Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1);
        }))throw new CryptoDataError(`${labels[provider]} 返回的时间不是UTC月首，未作为月线使用。`);
        return {candidate:{provider,pair,candles}};
      } catch(error) {
        if(signal?.aborted)throw new DOMException('请求已取消','AbortError');
        if(deadline.aborted)return {failure:`${labels[provider]} 连接超时`};
        return {failure:error instanceof Error?error.message:`${labels[provider]} 暂不可用`};
      }
    }
    function accept(outcome:Outcome) {
      if(outcome.missing)missing++;
      if(outcome.failure)failures.push(outcome.failure);
      if(outcome.candidate)best=best?deeperCurrentHistory(best,outcome.candidate):outcome.candidate;
    }
    let nextProvider=0;
    // Preserve the preferred source's fast path and establish a fixed identity
    // before any parallel work, including when its first price request fails.
    while(nextProvider<providers.length&&!best)accept(await attempt(providers[nextProvider++],true));
    if(best&&!(best.candles.length>=limit&&best.candles.at(-1)!.time>=currentPeriodStart(interval,now()))) {
      const remaining=providers.slice(nextProvider),outcomes:(Outcome|undefined)[]=new Array(remaining.length);
      let next=0;
      const exceedsKrakenMonths=(candidate:HistoryCandidate|undefined)=>candidate&&candidate.candles.filter(c=>c.closed!==false).length>=26&&candidate.candles.at(-1)!.time>=currentPeriodStart(interval,now());
      async function collect() {
        while(next<remaining.length) {
          if(signal?.aborted)throw new DOMException('请求已取消','AbortError');
          const index=next++,provider=remaining[index];
          // Kraken's ~720 daily bars cannot improve a current native history
          // with 27 months. A completed parallel result may establish that too.
          if(provider==='kraken'&&interval==='1M'&&(exceedsKrakenMonths(best)||outcomes.some(outcome=>exceedsKrakenMonths(outcome?.candidate))))continue;
          outcomes[index]=await attempt(provider,false);
        }
      }
      // At most two independent sources are in flight. Reduce in provider order
      // afterwards so network completion order never changes tie preferences.
      await Promise.all([collect(),collect()]);
      for(const outcome of outcomes)if(outcome)accept(outcome);
    }
    if(!best)throw new CryptoDataError(`现货行情暂不可用：${failures.join('；')}。请稍后重试。`,missing===providers.length?404:502);
    if(signal?.aborted)throw new DOMException('请求已取消','AbortError');
    const {provider,pair,candles}=best;
    if(interval==='1M')lastGoodMonthly=provider;else lastGood=provider;
    const warnings=['现货数据来自页面标明的交易所；不同交易所价格、成交量和结构可能不同。'];
    if(provider!=='binance')warnings.push(`当前使用 ${labels[provider]} 的 ${pair.base}/${pair.quote} 现货；保留相同报价币，没有使用USD替代USDT。`);
    if(provider!==providers[0]&&failures.length)warnings.push(`已自动切换行情源：${failures.join('；')}。`);
    if(provider==='kraken')warnings.push('Kraken单周期只提供最近约720根；其最后一根按未收盘处理。');
    if(provider==='kraken'&&interval==='1M')warnings.push('月线由Kraken日线按UTC自然月合成，截断首月与缺日历史月已排除，历史长度受日线窗口限制。');
    if((provider==='bitget'||provider==='bybit')&&interval==='1M')warnings.push('使用交易所原生UTC自然月OHLC；当前月未收盘，已排除出已确认结构。历史不与其他交易所拼接。');
    if(candles.length<limit||candles.length<200)warnings.push(`本次仅取得${candles.length}根K线，结构与统计样本可能不足。`);
    return {instrument:instrument(pair,provider),interval,candles,source:`${labels[provider]} 公共现货行情 · ${pair.providerId}`,asOf:new Date(now()).toISOString(),delayNotice:'交易所公开行情 · 自动刷新取数，非逐笔推送 · 时间为周期开盘时间',adjustment:'原始成交价格，不复权',warnings,availableIntervals:intervals};
  }
  async function searchCrypto(query:string,signal?:AbortSignal):Promise<Instrument[]> {
    const raw=query.trim().slice(0,60),lower=raw.toLowerCase();
    const nameMatches=Object.entries(names).filter(([,name])=>name.toLowerCase().includes(lower)).map(([base])=>base);
    const key=raw.toUpperCase().replace(/[\s/-]/g,'');let succeeded=false;
    for(const provider of order()) {
      try {
        const all=await directory(provider,signal);succeeded=true;
        const matches=all.filter(p=>!key||p.symbol.includes(key)||nameMatches.includes(p.base));
        matches.sort((a,b)=>Number(b.symbol===key)-Number(a.symbol===key)||Number(b.base===key)-Number(a.base===key)||Number(b.quote==='USDT')-Number(a.quote==='USDT')||a.symbol.localeCompare(b.symbol));
        if(matches.length){lastGood=provider;return matches.slice(0,30).map(p=>instrument(p,provider));}
      }catch(error){if(signal?.aborted)throw error;}
    }
    if(!succeeded)throw new CryptoDataError('当前无法连接现货目录，请稍后重试。');
    return [];
  }
  return {getCryptoCandles,searchCrypto,resetMarketNetworkFailures};
}
const client=createCryptoClient();
export const getCryptoCandles=client.getCryptoCandles;
export const searchCrypto=client.searchCrypto;
export const resetMarketNetworkFailures=client.resetMarketNetworkFailures;
