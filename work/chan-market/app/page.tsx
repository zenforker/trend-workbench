"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, ArrowUpRight, ArrowDownRight, ChevronDown, ChevronRight, RefreshCw, Star, X, Activity, Globe2, Layers3, Radio, Download, Upload, StepBack, StepForward, Play, Pause, RotateCcw, AlertTriangle, Check, BarChart3, Crosshair, CheckCircle2, Send } from 'lucide-react';
import {parseCSV,serializeCSV} from '@/lib/csv';
import TerminalChart, {priceText, type Layers} from '@/components/terminal-chart';
import {analyze} from '@/lib/chan';
import {planSessionKey,readPlanSession} from '@/lib/plan-session';
import {LanguageProvider,useLanguage} from '@/lib/language';
import {WORKBENCH_BRAND} from '@/lib/workbench-brand';
import {translateAnalysis} from '@/lib/analysis-i18n';
import {marketDisplayText,marketLoadErrorText,marketVenueSuffix,translateInstrumentName} from '@/lib/market-i18n';
import TradeSetups from '@/components/trade-setups';
import ConfluencePanel from '@/components/confluence-panel';
import {createChartFeedController,type ChartSnapshot} from '@/lib/market-context-loader';
import {higherInterval} from '@/lib/timeframe-context';
import {availableForecastCandles,buildForecast,marketSnapshotCutoff} from '@/lib/forecast';
import {getFeedHealth} from '@/lib/feed-health';
import {useForecastJournal} from '@/hooks/use-forecast-journal';
import type {WatchSnapshot} from '@/lib/watch-monitor';
import FeedStatus from '@/components/feed-status';
import HistoryCoverage from '@/components/history-coverage';
import type {CenterLayerMode} from '@/components/center-layer-selector';
import WatchMonitor from '@/components/watch-monitor';
import ForecastActivity from '@/components/forecast-activity';
import ForecastValidationPanel from '@/components/forecast-validation-panel';
import type {Analysis,Instrument,Interval,Market,MarketData} from '@/lib/market-types';

const PRESETS: Instrument[]=[
  {id:'crypto:BTCUSDT',symbol:'BTCUSDT',name:'Bitcoin',market:'crypto',exchange:'Binance',currency:'USDT'},
  {id:'crypto:ETHUSDT',symbol:'ETHUSDT',name:'Ethereum',market:'crypto',exchange:'Binance',currency:'USDT'},
  {id:'crypto:SOLUSDT',symbol:'SOLUSDT',name:'Solana',market:'crypto',exchange:'Binance',currency:'USDT'},
  {id:'crypto:BNBUSDT',symbol:'BNBUSDT',name:'BNB',market:'crypto',exchange:'Binance',currency:'USDT'},
  {id:'crypto:XRPUSDT',symbol:'XRPUSDT',name:'XRP',market:'crypto',exchange:'Binance',currency:'USDT'},
  {id:'crypto:DOGEUSDT',symbol:'DOGEUSDT',name:'Dogecoin',market:'crypto',exchange:'Binance',currency:'USDT'},
  {id:'us:NVDA',symbol:'NVDA',name:'NVIDIA 英伟达',market:'us',exchange:'NASDAQ',currency:'USD'},
  {id:'us:AAPL',symbol:'AAPL',name:'Apple 苹果',market:'us',exchange:'NASDAQ',currency:'USD'},
  {id:'us:TSLA',symbol:'TSLA',name:'Tesla 特斯拉',market:'us',exchange:'NASDAQ',currency:'USD'},
  {id:'us:MSFT',symbol:'MSFT',name:'Microsoft 微软',market:'us',exchange:'NASDAQ',currency:'USD'},
  {id:'us:SPY',symbol:'SPY',name:'标普500 ETF',market:'us',exchange:'NYSE Arca',currency:'USD'},
  {id:'cn:600519.SH',symbol:'600519.SH',name:'贵州茅台',market:'cn',exchange:'上交所',currency:'CNY'},
  {id:'cn:300750.SZ',symbol:'300750.SZ',name:'宁德时代',market:'cn',exchange:'深交所',currency:'CNY'},
  {id:'cn:000001.SZ',symbol:'000001.SZ',name:'平安银行',market:'cn',exchange:'深交所',currency:'CNY'},
  {id:'cn:601318.SH',symbol:'601318.SH',name:'中国平安',market:'cn',exchange:'上交所',currency:'CNY'},
  {id:'cn:002594.SZ',symbol:'002594.SZ',name:'比亚迪',market:'cn',exchange:'深交所',currency:'CNY'},
];
const MARKETS: {id:Market;title:string;en:string}[]=[{id:'crypto',title:'加密货币',en:'CRYPTO'},{id:'us',title:'美股',en:'US EQUITIES'},{id:'cn',title:'A股',en:'CHINA A'}];
const INTERVALS:Interval[]=['1m','5m','15m','30m','1h','4h','1d','1w','1M'];
const TIME_LABEL:Record<Interval,string>={'1m':'1分','5m':'5分','15m':'15分','30m':'30分','1h':'1小时','4h':'4小时','1d':'日线','1w':'周线','1M':'月线'};
const initialLayers:Layers={strokes:true,segments:true,trends:true,centers:false,signals:true,scenarios:false,fractals:false,setups:true};
function displaySymbol(s:string){return s.endsWith('USDT')?s.slice(0,-4)+'/USDT':s;}
function readableTime(t:number,locale:string){return new Date(t*1000).toLocaleString(locale,{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});}
function download(name:string,body:string,type:string){const url=URL.createObjectURL(new Blob([body],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export default function Home(){return <LanguageProvider><HomeContent/></LanguageProvider>;}
function HomeContent(){
  const {language,setLanguage,t,locale}=useLanguage();
  const mt=(text:string)=>marketDisplayText(text,language);
  const instrumentName=(name:string)=>name==='本地导入数据'?t('本地导入数据','Imported local data'):translateInstrumentName(name,language);
  const [market,setMarket]=useState<Market>('crypto'),[selected,setSelected]=useState<Instrument>(PRESETS[0]),[interval,setInterval]=useState<Interval>('1h');
  const [snapshot,setSnapshot]=useState<ChartSnapshot|null>(null),[fetchLoading,setLoading]=useState(true);
  const [feedError,setFeedError]=useState<{key:string;message:string}|null>(null);
  const [chartFeed]=useState(()=>createChartFeedController());
  const [imported,setImported]=useState(false);
  const [healthClock,setHealthClock]=useState(()=>Date.now()),[feedSuccess,setFeedSuccess]=useState<{key:string;at:number}|null>(null);
  const {journal,ready:journalReady,saved:journalSaved,notices,observe}=useForecastJournal();
  const [monitorEnabled,setMonitorEnabled]=useState(false);
  useEffect(()=>{const timer=window.setInterval(()=>setHealthClock(Date.now()),10000);return()=>clearInterval(timer);},[]);
  const storedData=snapshot?.data,receivedAt=snapshot?.receivedAt;
  const cutoff=storedData?marketSnapshotCutoff(storedData.asOf,receivedAt):0;
  // Gate every quote and analysis in the render itself, before selection effects run.
  const isLocalSnapshot=snapshot?.higher.status==='imported';
  const data=useMemo(()=>{
    if(!storedData||storedData.instrument.market!==selected.market||storedData.instrument.symbol!==selected.symbol||storedData.interval!==interval||isLocalSnapshot!==imported)return null;
    if(imported)return storedData;
    const candles=availableForecastCandles(storedData.candles,{market:selected.market,interval,source:storedData.source},cutoff);
    return {...storedData,candles};
  },[storedData,selected.market,selected.symbol,interval,isLocalSnapshot,imported,cutoff]);
  const selectionKey=`${selected.market}:${selected.symbol}:${interval}`;
  const error=!imported&&feedError?.key===selectionKey?feedError.message:'';
  const loading=fetchLoading||(!data&&!error);
  const [watchlist,setWatchlist]=useState<Instrument[]>([PRESETS[0],PRESETS[1],PRESETS[2],PRESETS[6],PRESETS[7],PRESETS[11]]),[watchTab,setWatchTab]=useState<'all'|'favorites'>('all');
  const [searchOpen,setSearchOpen]=useState(false),[searchMarket,setSearchMarket]=useState<Market|'all'>('all'),[query,setQuery]=useState(''),[searchResults,setSearchResults]=useState<Instrument[]>([]),[searching,setSearching]=useState(false),[searchWarning,setSearchWarning]=useState('');
  const [layers,setLayers]=useState<Layers>(initialLayers);
  const [centerLayer,setCenterLayer]=useState<CenterLayerMode>('all');
  const penMode='new' as const;
  const [replay,setReplay]=useState<number|null>(null),[playing,setPlaying]=useState(false),[toast,setToast]=useState('');
  const [signalTab,setSignalTab]=useState<'setups'|'scenarios'|'signals'>('setups');
  const importGeneration=useRef(0),fileInput=useRef<HTMLInputElement>(null),searchInput=useRef<HTMLInputElement>(null);
  const cancelPendingImport=useCallback(()=>{importGeneration.current++;},[]);
  // Hydrate the browser-owned watchlist after SSR; it has no server equivalent.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{try{const stored=JSON.parse(localStorage.getItem('chan-watchlist-v1')||'null');if(Array.isArray(stored)&&stored.every(i=>i&&typeof i.id==='string'&&['crypto','us','cn'].includes(i.market)&&typeof i.symbol==='string'&&typeof i.name==='string'))setWatchlist(stored);}catch{}},[]);
  // UI settings survive reloads (author request 2026-11-23); data refreshes never touch them.
  const uiHydrated=useRef(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{try{const s=JSON.parse(localStorage.getItem('trend-workbench-ui-v1')||'null');if(s&&typeof s==='object'){
    if(s.selected&&typeof s.selected.id==='string'&&['crypto','us','cn'].includes(s.selected.market)&&typeof s.selected.symbol==='string'&&typeof s.selected.name==='string'){setSelected(s.selected);setMarket(s.selected.market);}
    if(INTERVALS.includes(s.interval))setInterval(s.interval);
    if(s.layers&&typeof s.layers==='object')setLayers(l=>{const next={...l};for(const k of Object.keys(l) as (keyof Layers)[])if(typeof s.layers[k]==='boolean')next[k]=s.layers[k];return {...next,centers:false};});
    if(['setups','scenarios','signals'].includes(s.signalTab))setSignalTab(s.signalTab);
  }}catch{}uiHydrated.current=true;},[]);
  useEffect(()=>{if(!uiHydrated.current||imported)return;try{localStorage.setItem('trend-workbench-ui-v1',JSON.stringify({selected,interval,layers,signalTab}));}catch{}},[selected,interval,layers,signalTab,imported]);
  const notify=useCallback((message:string)=>{setToast(message);setTimeout(()=>setToast(''),5500);},[]);
  const lastNotice=useRef<string|null>(null);
  useEffect(()=>{const notice=notices[0];if(!notice||lastNotice.current===notice.id)return;lastNotice.current=notice.id;const event=notice.intrabar?notice.type==='invalidation'?t('收到报价触及止损价','Received quote touched the stop-loss price'):notice.type==='target1'?t('收到报价触及第一止盈价','Received quote touched the take-profit 1 price'):t('收到报价触及第二止盈价','Received quote touched the take-profit 2 price'):notice.type==='condition-met'?t('预判条件满足','Outlook condition met'):notice.type==='invalidated'?t('止损价触及','Stop-loss price touched'):notice.type==='target1'?t('第一止盈价触及','Take-profit 1 price touched'):t('第二止盈价触及','Take-profit 2 price touched');notify(`${notice.symbol} · ${notice.interval} · ${event} ${priceText(notice.price)}`);},[notices,notify,t]);
  const fetchData=useCallback(async(background=false)=>{
    if(!background){
      cancelPendingImport();
      // Keep the last matching candles and any known failure until fresh data arrives.
      // The selection guard above already excludes another instrument, interval or CSV.
      setLoading(true);setReplay(null);setPlaying(false);
    }
    await chartFeed.load({market:selected.market,symbol:selected.symbol,interval,background,
      onSnapshot:result=>{
        setSnapshot(result);setFeedSuccess({key:selectionKey,at:result.receivedAt});setHealthClock(Date.now());setLoading(false);setFeedError(null);
      },
      onPrimaryError:message=>{setFeedError({key:selectionKey,message});setLoading(false);},
    });
  },[chartFeed,cancelPendingImport,selectionKey,selected.market,selected.symbol,interval]);
  // Synchronize the selected market with the remote feed, cancelling obsolete requests.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{if(!imported)void fetchData();return()=>{chartFeed.cancel();cancelPendingImport();};},[chartFeed,cancelPendingImport,fetchData,imported]);
  useEffect(()=>{if(imported||replay!==null||playing)return;const timer=window.setInterval(()=>{if(!document.hidden)void fetchData(true);},30000);return()=>window.clearInterval(timer);},[fetchData,imported,replay,playing]);
  const replayActive=replay!==null,wasReplaying=useRef(false);
  useEffect(()=>{
    if(replayActive&&!wasReplaying.current)chartFeed.cancel();
    if(!replayActive&&wasReplaying.current&&!imported)void fetchData(true);
    wasReplaying.current=replayActive;
  },[chartFeed,fetchData,imported,replayActive]);
  useEffect(()=>{function handler(e:KeyboardEvent){if(e.key==='Escape')setSearchOpen(false);if(e.key==='/'&&!(e.target instanceof HTMLInputElement)&&!(e.target instanceof HTMLTextAreaElement)){e.preventDefault();setSearchOpen(true);}}window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[]);
  useEffect(()=>{if(searchOpen)setTimeout(()=>searchInput.current?.focus(),70);},[searchOpen]);
  useEffect(()=>{
    if(!searchOpen)return;const controller=new AbortController();const q=query.trim();
    // Search results and loading state synchronize with an external directory.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchWarning('');
    if(!q){setSearchResults(PRESETS.filter(i=>searchMarket==='all'||i.market===searchMarket));setSearching(false);return;}
    setSearching(true);const timer=setTimeout(async()=>{try{const res=await fetch(`/api/search?market=${searchMarket}&q=${encodeURIComponent(q)}`,{signal:controller.signal});const result=await res.json() as {results?:Instrument[];warning?:string;error?:string};if(controller.signal.aborted)return;if(!res.ok)throw new Error(result.error||'搜索源暂不可用');setSearchResults(result.results||[]);setSearchWarning(result.warning||'');}catch{if(!controller.signal.aborted){setSearchResults(PRESETS.filter(i=>(searchMarket==='all'||i.market===searchMarket)&&(i.name.toLowerCase().includes(q.toLowerCase())||i.symbol.toLowerCase().includes(q.toLowerCase()))));setSearchWarning('在线搜索暂不可用，当前仅显示常用标的匹配结果。');}}finally{if(!controller.signal.aborted)setSearching(false);}},300);
    return()=>{clearTimeout(timer);controller.abort();};
  },[query,searchMarket,searchOpen]);
  useEffect(()=>{if(!playing||!data)return;const timer=setIntervalFn(()=>{setReplay(r=>{const next=(r??Math.min(80,data.candles.length))+1;if(next>=data.candles.length){setPlaying(false);return null;}return next;});},650);return()=>clearInterval(timer);},[playing,data]);
  const candles=useMemo(()=>data?data.candles.slice(0,replay??data.candles.length):[],[data,replay]);
  const live=replay===null&&!imported;
  const planKey=data&&!imported?planSessionKey({market:data.instrument.market,symbol:data.instrument.symbol,interval:data.interval,source:data.source,penMode}):null;
  const analysisContext=useMemo(()=>{
    if(!data||!snapshot)return undefined;
    let higher=snapshot.higher;
    if((replay!==null||error)&&higher.status==='loading')higher={interval:higher.interval,status:'error'};
    return {market:data.instrument.market,symbol:data.instrument.symbol,interval:data.interval,source:data.source,adjustment:data.adjustment,higher};
  },[data,snapshot,replay,error]);
  const pendingContext=analysisContext?.higher.status==='loading';
  const rawAnalysis=useMemo<Analysis|null>(()=>{
    if(candles.length<3||pendingContext)return null;
    try{return analyze(candles,{penMode,horizon:12,skipTradePlans:true,planSession:live&&planKey?readPlanSession(planKey):undefined,context:analysisContext});}catch{return null;}
  },[candles,penMode,live,planKey,analysisContext,pendingContext]);
  // Legacy plan sessions are read-only archives; forward outlooks have a separate observation journal.
  // Structure clock (author request 2026-11-23): candles, price and VAcc update with every refresh, but
  // structure and everything derived from it (strokes/segments/trends, bias, confluence, outlook, plans)
  // are shown as of the latest structural event — the bar where the last stroke was established.
  const structureCut=rawAnalysis&&rawAnalysis.structureAsOf>=0?Math.min(candles.length,rawAnalysis.structureAsOf+1):candles.length;
  const structureCandles=useMemo(()=>structureCut<candles.length?candles.slice(0,structureCut):candles,[candles,structureCut]);
  const structureAnalysis=useMemo<Analysis|null>(()=>{
    if(!rawAnalysis||structureCandles===candles)return rawAnalysis;
    try{return analyze(structureCandles,{penMode,horizon:12,skipTradePlans:true,planSession:live&&planKey?readPlanSession(planKey):undefined,context:analysisContext});}catch{return rawAnalysis;}
  },[rawAnalysis,structureCandles,candles,penMode,live,planKey,analysisContext]);
  // The VAcc pane is data, not structure: always the live series.
  const analysis=useMemo(()=>structureAnalysis&&rawAnalysis?translateAnalysis({...structureAnalysis,vacc:rawAnalysis.vacc},language):null,[structureAnalysis,rawAnalysis,language]);
  const strokeCenters:never[]=[]; // Natural Chan: no 中枢 layer
  const rawForecast=useMemo(()=>structureAnalysis&&data?buildForecast(structureCandles,structureAnalysis,{market:data.instrument.market,symbol:data.instrument.symbol,interval:data.interval,source:data.source,adjustment:data.adjustment,...(live?{asOf:cutoff}:{})}):null,[structureAnalysis,data,structureCandles,live,cutoff]);
  const health=useMemo(()=>getFeedHealth(data,{nowMs:healthClock,lastSuccessAtMs:feedSuccess?.key===selectionKey?feedSuccess.at:undefined,error}),[data,healthClock,feedSuccess,selectionKey,error]);
  const displayForecast=imported||replay!==null||health.allowSignals||health.state==='closed';
  useEffect(()=>{if(live&&data&&rawForecast&&journalReady&&!loading&&!['error','stale','unknown'].includes(health.state))observe(data,rawForecast,health.allowSignals);},[data,rawForecast,live,journalReady,loading,health.state,health.allowSignals,observe]);
  const onWatchSnapshot=useCallback((snapshot:WatchSnapshot)=>{if(!live||snapshot.data.interval!==interval||snapshot.data.instrument.market===selected.market&&snapshot.data.instrument.symbol===selected.symbol)return;if(!['error','stale','unknown'].includes(snapshot.health.state))observe(snapshot.data,snapshot.forecast,snapshot.health.allowSignals);},[observe,live,selected.market,selected.symbol,interval]);
  const last=candles.at(-1),prior=candles.at(-2),change=last&&prior?(last.close/prior.close-1)*100:0;
  const currentInstrument=data?{
    ...data.instrument,
    name:data.instrument.market==='cn'&&/^\d{6}(?:\.(?:SH|SZ|BJ))?$/i.test(data.instrument.name.trim())?selected.name:data.instrument.name,
  }:selected;
  const available=data?.availableIntervals||INTERVALS;
  const center=analysis?.centers.at(-1),cal=analysis?.calibration;
  const watchRows=watchTab==='favorites'?watchlist:PRESETS.filter(i=>i.market===market);
  function choose(i:Instrument){
    cancelPendingImport();
    if(imported||i.market!==selected.market||i.symbol!==selected.symbol)chartFeed.cancel();
    setImported(false);setSelected(i);setMarket(i.market);setSearchOpen(false);setQuery('');
  }
  function chooseInterval(i:Interval){
    cancelPendingImport();
    if(i!==interval)chartFeed.cancel();
    setInterval(i);
  }
  function switchMarket(m:Market){const p=PRESETS.find(i=>i.market===m)!;choose(p);chooseInterval(m==='crypto'?'1h':'1d');}
  function star(i:Instrument){setWatchlist(prev=>{const next=prev.some(w=>w.id===i.id)?prev.filter(w=>w.id!==i.id):[...prev,i];localStorage.setItem('chan-watchlist-v1',JSON.stringify(next));return next;});}
  function exportCSV(){if(!candles.length)return;download(`${selected.symbol}-${interval}${replay?'_replay':''}.csv`,serializeCSV(candles),'text/csv;charset=utf-8');notify(t('已导出当前回放时点之前的K线，保留K线完成状态。','Exported bars up to the replay cursor, preserving closed status.'));}
  function exportAnalysis(){if(!analysis||!data)return;download(`${selected.symbol}-${interval}-analysis.json`,JSON.stringify({instrument:data.instrument,interval,source:data.source,adjustment:data.adjustment,asOf:data.asOf,delayNotice:data.delayNotice,lastCandle:last?.time,ruleVersion:analysis.ruleVersion,penMode,replay:replay!==null,candles,analysis,forecast:rawForecast,feedHealth:health},null,2),'application/json');}
  async function importFile(file:File){
    const generation=++importGeneration.current;
    try {
      const text=await file.text();
      if(generation!==importGeneration.current)return;
      const parsed=parseCSV(text);
      chartFeed.cancel();
      const symbol=file.name.replace(/\.csv$/i,'').slice(0,40)||'CSV';
      const ins:Instrument={id:`${market}:csv-${symbol}`,symbol,name:'本地导入数据',market,exchange:'CSV',currency:market==='cn'?'CNY':'USD'};
      const data:MarketData={instrument:ins,interval,candles:parsed,source:`本地CSV · ${file.name}`,asOf:new Date().toISOString(),delayNotice:'用户提供的历史数据；保留closed状态，缺少closed列时按已完成处理。',adjustment:'由CSV原始数据决定',warnings:['导入数据未与交易所校验；请确认时区、复权口径和所选周期。'],availableIntervals:[interval]};
      setImported(true);setSelected(ins);setSnapshot({data,receivedAt:Date.now(),higher:{interval:higherInterval(market,interval),status:'imported'}});
      setReplay(null);setPlaying(false);setLoading(false);setFeedError(null);
      notify(t(`已导入 ${parsed.length.toLocaleString(locale)} 根K线`,`Imported ${parsed.length.toLocaleString(locale)} bars`));
    }catch(e){
      if(generation===importGeneration.current)notify(e instanceof Error?mt(e.message):t('文件读取失败','Could not read the file'));
    }
  }
  return <div className="observatory">
    <header className="topbar">
      <div className="topbar-start">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true"><Activity size={23}/></span>
          <b>{WORKBENCH_BRAND.name[language]}</b>
        </a>
        <div className="top-nav"><span className="nav-active">{t('市场工作台','Workspace')}</span></div>
      </div>
      <nav className="official-links" aria-label={t('开发者与社区','Developer and community')}>
        <a href={WORKBENCH_BRAND.developerUrl} target="_blank" rel="noopener noreferrer" title={t('在 X 查看开发者主页','Open the developer profile on X')}>
          <span className="official-x" aria-hidden="true">𝕏</span>
          <span>{t(`开发者（${WORKBENCH_BRAND.developer}）`,`Developer (${WORKBENCH_BRAND.developer})`)}</span>
        </a>
        <a href={WORKBENCH_BRAND.communityUrl} target="_blank" rel="noopener noreferrer" title={t('在 Telegram 打开社区','Open the community on Telegram')}>
          <Send size={16} aria-hidden="true"/>
          <span>{t('社区交流','Community')}</span>
        </a>
      </nav>
      <div className="top-right"><button type="button" className="top-refresh" disabled={loading||imported} aria-busy={loading} aria-label={t('刷新行情','Refresh market data')} title={imported?t('本地导入数据无需在线刷新','Imported data does not need an online refresh'):t('刷新当前标的行情和分析','Refresh this instrument and its analysis')} onClick={()=>void fetchData()}><RefreshCw size={17} className={loading?'spin':''} aria-hidden="true"/><span>{loading?t('刷新中','Refreshing'):t('刷新行情','Refresh')}</span></button><span className={`connection ${error?'warning':''}`}><i/>{loading?t('连接中','Connecting'):error?(data?t('行情未更新','Refresh failed'):t('暂无行情','Data unavailable')):imported?t('本地数据','Local data'):replay!==null?t('历史回放 · 刷新暂停','Replay · refresh paused'):t('公开行情 · 30s刷新','Public feed · 30s refresh')}</span><div className="language-switch" role="group" aria-label={t('界面语言','Interface language')}><button aria-pressed={language==='zh'} className={language==='zh'?'active':''} onClick={()=>setLanguage('zh')}>中文</button><button aria-pressed={language==='en'} className={language==='en'?'active':''} onClick={()=>setLanguage('en')}>EN</button></div><span className="avatar">{t('观','C')}</span></div>
    </header>
    <aside className="sidebar">
      <div className="sidebar-heading"><span>{t("市场导航","Markets")}</span><Globe2 size={14}/></div>
      <div className="market-menu">{MARKETS.map(m=><button key={m.id} className={market===m.id?'active':''} onClick={()=>switchMarket(m.id)}><span className="market-icon">{m.id==='crypto'?'₿':m.id==='us'?'$':'A'}</span><span>{t(m.title,m.en)}<small>{m.en}</small></span>{market===m.id&&<span className="active-marker"/>}</button>)}</div>
      <div className="sidebar-tabs"><button className={watchTab==='all'?'active':''} onClick={()=>setWatchTab('all')}>{t("常用标的","Popular")}</button><button className={watchTab==='favorites'?'active':''} onClick={()=>setWatchTab('favorites')}>{t("我的自选 ","Watchlist ")}<span>{watchlist.length}</span></button></div>
      <div className="watch-list">{watchRows.map(i=><div className={`watch-row ${selected.id===i.id?'selected':''}`} key={i.id}><button onClick={()=>choose(i)}><span className={`asset-symbol ${i.market}`}>{i.symbol==='BTCUSDT'?'₿':i.symbol==='ETHUSDT'?'Ξ':i.symbol.slice(0,1)}</span><span><b>{displaySymbol(i.symbol)}</b><small>{instrumentName(i.name)}</small></span></button><button className="watch-star" onClick={()=>star(i)} title={watchlist.some(w=>w.id===i.id)?t('移出自选','Remove from watchlist'):t('加入自选','Add to watchlist')} aria-label={`${watchlist.some(w=>w.id===i.id)?t('移出自选','Remove from watchlist'):t('加入自选','Add to watchlist')} ${i.symbol}`}><Star size={12} fill={watchlist.some(w=>w.id===i.id)?'currentColor':'none'}/></button></div>)}{!watchRows.length&&<p className="empty-watch">{t("搜索标的后点星号，建立你的观察列表。","Search for an instrument and star it to build your watchlist.")}</p>}</div>
      <button className="add-symbol" onClick={()=>setSearchOpen(true)}><Search size={14}/>{t('搜索更多标的','Find instruments')} <span>/</span></button>
      <div className="sidebar-bottom"><span className="eyebrow">OBSERVE. DEFINE. ACT.</span><p>{t('让每一次判断','Every decision,')}<br/>{t('都有结构可循。','grounded in structure.')}</p><span className="version">{t("研究终端 · v1.3","Research terminal · v1.3")}</span></div>
    </aside>
    <main className="workspace">
      <div className="page-heading"><div><div className="eyebrow">MARKET INTELLIGENCE <span>/ {MARKETS.find(m=>m.id===market)?.en}</span></div><h1>{t('洞察结构，跟随走势','Read structure. Follow price')}<span className="heading-dot">.</span></h1></div><button className="global-search" aria-label={t('搜索标的','Search instruments')} onClick={()=>setSearchOpen(true)}><Search size={16}/><span>{t("搜索代码、币种或公司名称","Search symbol, crypto or company")}</span><kbd>/</kbd></button></div>
      <div className="workspace-grid">
        <section className="chart-panel panel">
          <div className="quote-heading"><div className="instrument-identity"><span className={`asset-big ${market}`}>{selected.symbol==='BTCUSDT'?'₿':selected.symbol==='ETHUSDT'?'Ξ':selected.symbol.slice(0,1)}</span><div><button className="instrument-selector" onClick={()=>setSearchOpen(true)}>{displaySymbol(currentInstrument.symbol)}<ChevronDown size={15}/></button><p>{instrumentName(currentInstrument.name)}<span>{marketVenueSuffix(currentInstrument.exchange,language)}</span></p></div><button className={`favorite-button ${watchlist.some(w=>w.id===selected.id)?'selected':''}`} disabled={imported} onClick={()=>star(selected)} aria-label={t("切换当前标的自选","Toggle watchlist")}><Star size={17} fill={watchlist.some(w=>w.id===selected.id)?'currentColor':'none'}/></button></div><div className="quote-price"><strong>{last?priceText(last.close):'—'}</strong><span className={change>=0?'positive':'negative'}>{last&&prior?`${change>=0?'+':''}${change.toFixed(2)}%`:'—'} <small>{t("较前一根","vs previous bar")}</small></span></div></div>
          <div className="chart-toolbar"><div className="interval-buttons">{INTERVALS.map(i=><button key={i} className={interval===i?'active':''} disabled={!available.includes(i)||imported} onClick={()=>chooseInterval(i)}>{t(TIME_LABEL[i],({'1d':'Day','1w':'Week','1M':'Month'} as Partial<Record<Interval,string>>)[i]||i)}</button>)}</div><div className="chart-actions"><button className="icon-button" disabled={loading||imported} onClick={()=>void fetchData()} title={t("刷新行情","Refresh market data")} aria-label={t("刷新行情","Refresh market data")}><RefreshCw size={14} className={loading?'spin':''}/></button><button className="icon-button" disabled={!data} onClick={exportCSV} title={t("导出历史K线CSV","Export candle history as CSV")} aria-label={t("导出CSV","Export CSV")}><Download size={14}/></button><button className="icon-button" onClick={()=>fileInput.current?.click()} title={t("导入CSV","Import CSV")} aria-label={t("导入CSV","Import CSV")}><Upload size={14}/></button></div></div>
          <div className="layer-toolbar"><span><Layers3 size={12}/>{t('结构图层','Layers')}</span>{([['setups','点位预判','Outlook'],['strokes','笔','Strokes'],['segments','线段','Segments'],['trends','趋势','Trends'],['signals','历史信号','Signals'],['fractals','分型','Fractals']] as const).map(([key,zh,en])=><button type="button" key={key} aria-pressed={layers[key]} className={layers[key]?'active':''} onClick={()=>setLayers(l=>({...l,[key]:!l[key]}))}><span className="layer-state-indicator" aria-hidden="true">{layers[key]&&<Check size={13} strokeWidth={3}/>}</span>{t(zh,en)}</button>)}</div>
          {error&&<div className="data-error" role="alert"><AlertTriangle size={20}/><div>
            <b>{displaySymbol(selected.symbol)} · {t(TIME_LABEL[interval],interval)} · {data?t('行情更新失败','Refresh failed'):t('暂无行情','Data unavailable')}</b>
            <p>{marketLoadErrorText(error,language)} {data&&receivedAt&&t(`图中保留 ${readableTime(receivedAt/1000,locale)} 获取的K线，新信号已暂停。`,`Showing candles fetched at ${readableTime(receivedAt/1000,locale)}. New signals are paused.`)}</p>
            <button disabled={loading} onClick={()=>void fetchData()}>{loading?t('正在重试','Retrying'):t('重新加载','Retry')}</button><button onClick={()=>fileInput.current?.click()}>{t('导入CSV','Import CSV')}</button>
          </div></div>}
          {data&&(!error||replay!==null)&&<FeedStatus data={data} forecast={rawForecast} health={health} replay={replay!==null} imported={imported}/>}
          {(data||!error)&&<>
          <TerminalChart key={`${selected.id}-${interval}-${imported}`} candles={candles} analysis={analysis} layers={layers} symbol={selected.symbol} interval={interval} loading={loading&&!data} forecast={rawForecast??undefined} dataFresh={displayForecast} strokeCenters={strokeCenters} centerLayer={centerLayer}/>
          <div className="replay-toolbar"><span><RotateCcw size={13}/>{replay===null?t('历史回放','Replay'):t('正在回放','Replaying')}</span><button aria-label={t("回退一根K线","Previous bar")} disabled={!data} onClick={()=>{setPlaying(false);setReplay(Math.max(Math.min(3,data!.candles.length),(replay??data!.candles.length)-1));}}><StepBack size={14}/></button><button className={playing?'active':''} aria-label={playing?t('暂停回放','Pause replay'):t('播放历史','Play history')} disabled={!data} onClick={()=>{if(replay===null)setReplay(Math.min(80,data!.candles.length-1));setPlaying(p=>!p);}}>{playing?<Pause size={14}/>:<Play size={14}/>}</button><button aria-label={t("前进一根K线","Next bar")} disabled={!data||replay===null} onClick={()=>setReplay(r=>r!==null&&r+1<data!.candles.length?r+1:null)}><StepForward size={14}/></button><input aria-label={t("历史回放进度","Replay position")} type="range" min={Math.min(3,data?.candles.length||3)} max={data?.candles.length||35} value={replay??data?.candles.length??35} disabled={!data} onChange={e=>{setPlaying(false);const n=Number(e.target.value);setReplay(n===data!.candles.length?null:n);}}/><span className="replay-counter">{candles.length} / {data?.candles.length||0}</span><button className="return-live" disabled={replay===null} onClick={()=>{setReplay(null);setPlaying(false);}}>{t("回到最新","Latest")}</button></div>
          <div className="data-source"><span><Radio size={11}/>{data?mt(data.source):t('等待行情源','Waiting for data')} · {data?mt(data.adjustment):'—'}{replay!==null&&<b> · {t('历史回放','Replay')}</b>}</span>{data&&!imported&&interval==='4h'&&market!=='crypto'&&<span>{market==='cn'?t('4H：每交易日一根','4H: one candle per trading day'):t('4H：首段4小时，尾段2.5小时','4H: first bar 4 hours; closing bar 2.5 hours')}</span>}<span>{candles.length?`${readableTime(candles[0].time,locale)} — ${readableTime(last!.time,locale)}`:t('数据时间 —','Data time —')}</span></div>
          <HistoryCoverage data={data}/>
          </>}
        </section>
        <aside className="analysis-rail">
          <ConfluencePanel analysis={analysis} loading={loading||pendingContext} interval={interval} market={market} forecast={rawForecast??undefined} dataFresh={displayForecast}/>
          <section className="bias-card panel"><div className="card-top"><span><Crosshair size={15}/>{t('多空结构倾向','Long / short bias')}</span></div><div className="bias-label"><span className={`status-dot ${analysis&&analysis.bias.long<50?'bear':''}`}/>{analysis?.bias.label||t('等待结构识别','Waiting for structure')}<small>{replay!==null?t('历史截面','Historical snapshot'):last?.closed===false?t('以已完成K线分析','Closed bars only'):t('当前截面','Current snapshot')}</small></div><div className="bias-numbers"><div><span>{t("多方","Long")}</span><strong className="positive">{analysis?Math.round(analysis.bias.long):'—'}<small>%</small></strong></div><div><span>{market==='cn'?t('看空','Bearish'):t('空方','Short')}</span><strong className="negative">{analysis?Math.round(analysis.bias.short):'—'}<small>%</small></strong></div></div><div className="bias-bar"><span style={{width:`${analysis?.bias.long??50}%`}}/><span style={{width:`${analysis?.bias.short??50}%`}}/></div><p className="bias-note">{rawAnalysis?.bias.label==='样本不足'?t('样本不足，暂按中性显示。','Limited history; showing a neutral bias.'):t('结构倾向 · 非胜率','Structural bias · not win probability')}</p><div className="factor-list">{analysis?.bias.factors.map((f,i)=><div className="factor" key={i} title={f.detail}><span>{f.name}</span><div className="factor-track"><i style={{width:`${Math.min(100,Math.abs(f.value)*4)}%`,background:f.value>=0?'var(--green)':'var(--red)'}}/></div><b className={f.value>=0?'positive':'negative'}>{f.value>0?'+':''}{f.value}</b></div>)||<div className="empty-mini">{t('加载行情后计算结构因子','Factors appear after data loads')}</div>}</div>{market==='cn'&&<p className="market-note">{t('空方表示看空倾向，A股普通账户不能直接裸卖空。','Short expresses bearish bias; ordinary A-share accounts cannot sell naked short.')}</p>}</section>
          <section className="center-card panel"><div className="card-top"><span><Layers3 size={15}/>{t('结构统计','Structure')}</span></div><div className="structure-stats"><div><small>{t("确认笔","Confirmed strokes")}</small><b>{analysis?.strokes.filter(s=>s.confirmed).length??'—'}</b></div><div><small>{t("确认段","Confirmed segments")}</small><b>{analysis?.segments.filter(s=>s.confirmed).length??'—'}</b></div><div><small>{t("趋势","Trends")}</small><b>{analysis?.trends.length??'—'}</b></div></div><p className="micro-copy">{(()=>{const tr=analysis?.trends.at(-1);return tr?t(`最近趋势${tr.direction==='up'?'向上':'向下'}${tr.confirmed?'（已确认）':'（进行中）'}`,`Latest trend ${tr.direction}${tr.confirmed?' (confirmed)':' (in progress)'}`):t('确认段不足，尚未形成趋势。','Not enough confirmed segments for a trend yet.');})()}</p></section>
          <section className="sample-card panel"><div className="card-top"><span><BarChart3 size={15}/>{t('相似样本结果','Similar historical outcomes')}</span><span className="sample-n">n = {cal?.samples??0}</span></div><p className="micro-copy">{t(`相似走势之后 ${cal?.horizon??12} 根K线`,`Next ${cal?.horizon??12} bars after similar structures`)}</p><div className="sample-bar">{cal&&cal.samples>0?<><i style={{width:`${cal.up}%`}}/><i style={{width:`${cal.flat}%`}}/><i style={{width:`${cal.down}%`}}/></>:<i className="no-samples"/>}</div><div className="sample-values"><span><i className="green"/>{t("上涨 ","Up ")}<b>{cal&&cal.samples?`${cal.up.toFixed(0)}%`:'—'}</b></span><span><i className="gray"/>{t("横盘 ","Flat ")}<b>{cal&&cal.samples?`${cal.flat.toFixed(0)}%`:'—'}</b></span><span><i className="red"/>{t("下跌 ","Down ")}<b>{cal&&cal.samples?`${cal.down.toFixed(0)}%`:'—'}</b></span></div><div className="sample-confidence">{cal&&cal.samples>=20?<><CheckCircle2 size={12}/><span>{t('上涨比例95%区间','95% interval for up frequency')} {cal.wilsonLow.toFixed(0)}–{cal.wilsonHigh.toFixed(0)}%</span></>:<><AlertTriangle size={12}/><span>{t("样本不足20个，比例仅供观察","Fewer than 20 samples; descriptive only")}</span></>}</div><p className="micro-copy">{t('历史涨跌分布','Historical price outcomes')}</p></section>
        </aside>
        <section className="outlook-panel panel"><div className="outlook-heading"><div className="outlook-tabs"><button className={signalTab==='setups'?'active':''} onClick={()=>setSignalTab('setups')}>{t("后续点位预判 ","Forward outlook ")}<span>{rawForecast?.status==='ready'?rawForecast.direction==='neutral'?t('支撑 / 阻力','Support / resistance'):t('当前周期','Current timeframe'):'—'}</span></button><button className={signalTab==='signals'?'active':''} onClick={()=>setSignalTab('signals')}>{t("历史信号 ","History ")}<span>{analysis?.signals.length??0}</span></button></div><button className="text-button" onClick={exportAnalysis} disabled={!analysis}>{t("导出分析 ","Export analysis ")}<Download size={12}/></button></div>{signalTab==='setups'?<TradeSetups analysis={analysis} loading={loading||pendingContext} forecast={rawForecast??undefined} dataFresh={displayForecast}/>:signalTab==='scenarios'?<div className="scenario-grid">{(analysis?.scenarios||[{side:'long',title:t('向上延伸','Upward extension'),trigger:t('加载行情后显示触发条件','Trigger rules appear after data loads'),invalidation:'—',target:'—'},{side:'range',title:t('中枢震荡','Center consolidation'),trigger:t('加载行情后显示结构区间','Structure range appears after data loads'),invalidation:'—',target:'—'},{side:'short',title:t('向下演化','Downward extension'),trigger:t('加载行情后显示触发条件','Trigger rules appear after data loads'),invalidation:'—',target:'—'}]).map((s,i)=><article className={`scenario ${s.side}`} key={s.side}><div className="scenario-title"><span className="scenario-icon">{s.side==='long'?<ArrowUpRight size={18}/>:s.side==='short'?<ArrowDownRight size={18}/>:<Activity size={18}/>}</span><h3>{s.title}</h3><span>0{i+1}</span></div><div className="scenario-line"><span>{t("触发","Trigger")}</span><p>{s.trigger}</p></div><div className="scenario-line"><span>{t("观察","Target")}</span><p>{s.target}</p></div><div className="scenario-invalidation">{t('失效','Invalidation')} · {s.invalidation}</div></article>)}</div>:<div className="signals-table">{analysis?.signals.length?<table><thead><tr><th>{t("结构极值时间","Extreme time")}</th><th>{t("结构信号","Structure signal")}</th><th>{t("价格","Price")}</th><th>{t("状态","Status")}</th></tr></thead><tbody>{[...analysis.signals].reverse().slice(0,30).map((s,i)=><tr key={i}><td>{readableTime(s.time,locale)}</td><td className={s.side==='long'?'positive':'negative'}>{s.label}</td><td>{priceText(s.price)}</td><td><span className="signal-status">{s.confirmed?t('结构确认','Confirmed structure'):t('候选信号','Candidate')}</span></td></tr>)}</tbody></table>:<p className="empty-signals">{t("当前历史窗口未发现满足条件的结构信号。","No qualifying structure signals in this history window.")}</p>}</div>}<div className="scenario-footer"><span>{t('预判随当前周期行情更新；历史记录保留发布时点位','Outlooks update with this timeframe; historical records retain published levels')}</span></div></section>
      </div>
      <footer className="workspace-footer"><span>{data?mt(data.delayNotice):t('加密货币 · 美股 · A股，统一结构视角。','Crypto · US equities · China A-shares, one structural view.')}</span></footer>
      <WatchMonitor watchlist={watchlist} interval={interval} enabled={monitorEnabled&&live} onEnabledChange={setMonitorEnabled} onSnapshot={onWatchSnapshot}/>
      <ForecastActivity journal={journal} data={data} notices={notices} saved={journalSaved}/>
      <ForecastValidationPanel/>
    </main>
    <input type="file" accept=".csv,text/csv" ref={fileInput} hidden onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void importFile(f);}}/>
    {toast&&<div className="toast" role="status"><Check size={16}/>{toast}</div>}
    {searchOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSearchOpen(false);}}><div className="search-modal" role="dialog" aria-modal="true" aria-labelledby="search-title"><div className="modal-search-input"><Search size={21}/><input ref={searchInput} id="search-title" value={query} onChange={e=>setQuery(e.target.value)} placeholder={t('搜索洛阳钼业、BTC、AAPL 或证券代码…','Search CMOC / 洛阳钼业, BTC, AAPL or ticker…')}/><button onClick={()=>setSearchOpen(false)} aria-label={t("关闭搜索","Close search")}><X size={20}/></button></div><div className="search-markets"><button className={searchMarket==='all'?'active':''} onClick={()=>setSearchMarket('all')}>{t('全市场','All markets')}</button>{MARKETS.map(m=><button key={m.id} className={searchMarket===m.id?'active':''} onClick={()=>setSearchMarket(m.id)}>{t(m.title,m.en)}</button>)}<span>{query?t('搜索结果','Results'):t('常用标的','Popular')}</span></div>{searchWarning&&<p className="search-warning">{mt(searchWarning)}</p>}<div className="search-results">{searching?<div className="search-empty"><span className="spinner"/>{t('正在搜索行情目录','Searching market directories')}</div>:searchResults.length?searchResults.map(i=><button key={i.id} onClick={()=>choose(i)}><span className="search-result-symbol">{displaySymbol(i.symbol)}</span><span className="search-result-name">{instrumentName(i.name)}</span><small>{t(MARKETS.find(m=>m.id===i.market)!.title,MARKETS.find(m=>m.id===i.market)!.en)}{marketVenueSuffix(i.exchange,language)}</small><ChevronRight size={15}/></button>):<div className="search-empty">{t("未找到匹配标的。请尝试完整代码、英文名或六位股票代码。","No matching instruments. Try the company name, full ticker or six-digit A-share code.")}</div>}</div><div className="search-foot"><span>{t("按市场查找，避免同名代码混淆","Search all markets or filter by exchange group")}</span><kbd>{t("ESC 关闭","ESC Close")}</kbd></div></div></div>}
  </div>;
}
const setIntervalFn = (fn:()=>void,ms:number)=>window.setInterval(fn,ms);

