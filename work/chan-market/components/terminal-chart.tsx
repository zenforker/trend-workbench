"use client";

import { useEffect, useId, useRef, useState } from 'react';
import { Minus, Plus, ScanLine } from 'lucide-react';
import type { Analysis, Candle } from '@/lib/market-types';
import { useLanguage } from '@/lib/language';
import { isDirectionUnclear } from '@/lib/plan-presentation';
import type { MarketForecast } from '@/lib/forecast-types';
import { forecastCondition, forecastTargetLabel, forecastTitle } from './forecast-copy';
import ForecastTitleText from './forecast-title-text';
import { centerGeometry } from '@/lib/center-geometry';
import type {StrokeCenter} from '@/lib/center-layers';
import type {CenterLayerMode} from './center-layer-selector';

export interface Layers { strokes: boolean; segments: boolean; trends: boolean; centers: boolean; signals: boolean; scenarios: boolean; fractals: boolean; setups: boolean }
interface Props { candles: Candle[]; analysis: Analysis | null; layers: Layers; symbol: string; interval: string; loading?: boolean; forecast?:MarketForecast; dataFresh?:boolean; strokeCenters?:StrokeCenter[]; centerLayer?:CenterLayerMode }
export function priceText(n: number) { const decimals=n===0?2:Math.min(12,Math.max(2,4-Math.floor(Math.log10(Math.abs(n)))));return Number.isFinite(n) ? n.toLocaleString('en-US', {minimumFractionDigits: Math.min(decimals,n<1?4:2),maximumFractionDigits:decimals}) : '—'; }
function stamp(t: number, full = false, interval = '1h', locale='zh-CN') {
  const date=new Date(t*1000);
  if(interval==='1M')return date.toLocaleDateString(locale,{year:'numeric',month:'2-digit'});
  if(full)return date.toLocaleString(locale,{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  if(['1m','5m','15m','30m'].includes(interval))return date.toLocaleString(locale,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  return date.toLocaleDateString(locale,interval==='1w'?{year:'2-digit',month:'2-digit',day:'2-digit'}:{month:'2-digit',day:'2-digit'});
}

export default function TerminalChart({candles, analysis, layers, symbol, interval, loading,forecast,dataFresh=true,strokeCenters=[],centerLayer='all'}: Props) {
  const {t,locale,language}=useLanguage();
  const centerClipId=useId();
  const [planSelection,setPlanSelection]=useState<{context:string;side:'long'|'short'}|null>(null);
  const planContext=`${symbol}:${interval}`;
  const planSide=planSelection?.context===planContext?planSelection.side:null;
  const [count, setCount] = useState(160);
  const [requestedBack, setBack] = useState(0);
  const [hoverState, setHover] = useState<{index: number; y: number; context: string} | null>(null);
  const drag = useRef<{x: number; back: number} | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportWidth,setViewportWidth]=useState(1120);
  useEffect(()=>{
    const viewport=scrollRef.current;
    if(!viewport)return;
    // Keep chart text in screen pixels instead of shrinking a fixed-width SVG.
    const observer=new ResizeObserver(([entry])=>setViewportWidth(Math.floor(entry.contentRect.width)));
    observer.observe(viewport);
    return ()=>observer.disconnect();
  },[]);
  useEffect(()=>{const viewport=scrollRef.current;if(viewport)viewport.scrollLeft=viewport.scrollWidth;},[symbol,interval,candles.length]);
  const back=Math.min(requestedBack,Math.max(0,candles.length-count));
  const end = Math.max(1,candles.length-back);
  const start = Math.max(0,end-count);
  const visible = candles.slice(start,end);
  const W=Math.max(760,viewportWidth),H=590,LEFT=18,RIGHT=112,TOP=100,PH=320,VOL=445,MID=500,MP=49;
  const unclear=forecast?forecast.direction==='neutral'||forecast.status!=='ready'||!dataFresh:isDirectionUnclear(analysis?.decision);
  const showScenarios=!forecast&&layers.scenarios&&back===0&&!unclear;
  const plans=!forecast&&layers.setups&&back===0&&!unclear ? analysis?.tradePlans||[] : [];
  const plan=plans.find(p=>p.side===planSide)||plans.find(p=>p.priority==='primary')||plans[0];
  const selectedForecast=forecast&&!unclear?forecast[planSide??(forecast.direction==='neutral'?'long':forecast.direction)]:null;
  const forecastSide=layers.setups&&back===0&&selectedForecast?.status==='ready'?selectedForecast:null;
  const neutralForecast=forecast&&dataFresh&&forecast.status==='ready'&&forecast.direction==='neutral'&&layers.setups&&back===0?forecast:null;
  const setupWidth=plan||forecastSide||neutralForecast?272:0;
  const future = showScenarios ? 18 : 3;
  const hoverContext=`${planContext}:${start}:${end}:${W}:${setupWidth}:${future}`;
  const hover=hoverState?.context===hoverContext&&hoverState.index>=start&&hoverState.index<end?hoverState:null;
  const usable = W-LEFT-RIGHT-setupWidth;
  const step = usable / Math.max(visible.length+future,20);
  const x = (index:number) => LEFT+(index-start+.5)*step;
  const scenarioPrices = showScenarios ? analysis?.scenarios.flatMap(s=>s.points.map(p=>p.price))||[] : [];
  const setupPrices=forecastSide?[forecastSide.zoneLow,forecastSide.zoneHigh,forecastSide.invalidationPrice,...forecastSide.targets.map(target=>target.price)]:neutralForecast?[neutralForecast.support?.price,neutralForecast.resistance?.price].filter((price):price is number=>price!==undefined):plan?[plan.entryLow,plan.entryHigh,plan.stopLoss,plan.target1,plan.target2]:[];
  let lo = Math.min(...visible.map(c=>c.low),...scenarioPrices,...setupPrices), hi=Math.max(...visible.map(c=>c.high),...scenarioPrices,...setupPrices);
  if (!Number.isFinite(lo)||!Number.isFinite(hi)){lo=0;hi=100;}
  const pad = Math.max((hi-lo)*.12,hi*.001); lo=Math.max(0,lo-pad);hi+=pad;
  const y = (v:number) => TOP+(hi-v)/(hi-lo)*PH;
  const centerItems=[
    ...(centerLayer==='segment'?[]:strokeCenters.map(center=>({center,number:center.sequence,layer:'stroke' as const}))),
    ...(centerLayer==='stroke'?[]:(analysis?.centers??[]).map((center,index)=>({center,number:index+1,layer:'segment' as const}))),
  ];
  const visibleCenters=layers.centers?centerItems.flatMap(item=>{
    const {center}=item;
    const geometry=centerGeometry(center,{start,end,left:LEFT,right:W-RIGHT-setupWidth,top:TOP,bottom:TOP+PH,step,minPrice:lo,maxPrice:hi});
    return geometry?[{...item,geometry}]:[];
  }):[];
  const centerDrawings=visibleCenters.map(item=>{
    const {center:c,number,layer}=item,code=`${layer==='stroke'?t('笔','B'):t('段','S')}${number}`;
    const name=layer==='stroke'?t('笔中枢（局部）','Stroke centers (local)'):t('线段中枢','Segment center');
    const upper=`${code} · ${t('上沿 ZG','Upper ZG')} ${priceText(c.high)}`,lower=`${t('下沿 ZD','Lower ZD')} ${priceText(c.low)}`;
    const from=candles[c.startIndex],to=candles[c.endIndex];
    const period=`${t('起止','Period')} ${from?stamp(from.time,true,interval,locale):'—'} — ${to?stamp(to.time,true,interval,locale):'—'}`;
    const description=`${name} ${code} · ${t('上沿 ZG','Upper ZG')} ${priceText(c.high)} / ${lower} · ${period}${layer==='stroke'?t(' · 局部已确认笔重叠',' · Local overlap of confirmed strokes'):''}`;
    const textWidth=(value:string)=>Array.from(value).reduce((width,char)=>width+(char.charCodeAt(0)>255?12:7),0);
    return {...item,key:`${layer}-${number}`,code,upper,lower,description,labelWidth:Math.max(textWidth(upper),textWidth(lower)),compactWidth:textWidth(code)};
  });
  const occupiedLabels:{x:number;y:number;width:number;height:number}[]=[],centerLabels=new Map<string,'full'|'compact'>();
  // Keep the larger segment labels readable; local labels use remaining space.
  for(const item of [...centerDrawings].sort((a,b)=>Number(a.layer==='stroke')-Number(b.layer==='stroke'))){
    const g=item.geometry,height=g.visibleBottom-g.visibleTop;
    const candidates=[
      ...(g.width>=item.labelWidth+10&&height>=35?[{mode:'full' as const,width:item.labelWidth,height:32}]:[]),
      ...(g.width>=Math.max(40,item.compactWidth+10)&&height>=18?[{mode:'compact' as const,width:item.compactWidth,height:18}]:[]),
    ];
    for(const candidate of candidates){
      const area={x:g.x+5,y:g.visibleTop,width:candidate.width,height:candidate.height};
      if(occupiedLabels.some(a=>area.x<a.x+a.width+6&&area.x+area.width+6>a.x&&area.y<a.y+a.height+4&&area.y+area.height+4>a.y))continue;
      occupiedLabels.push(area);centerLabels.set(item.key,candidate.mode);break;
    }
  }
  const maxVol = Math.max(...visible.map(c=>c.volume),1);
  const candleIndices=new Map(candles.map((c,i)=>[c.time,i]));
  const vacc = (analysis?.vacc||[]).filter(m=>{const i=candleIndices.get(m.time);return i!==undefined&&i>=start&&i<end;});
  // Vel (line) and acc (bars) have different magnitudes; each is scaled to the pane, sharing the zero axis.
  const maxVel = Math.max(...vacc.map(m=>Math.abs(m.vel)),1e-12), maxAcc = Math.max(...vacc.map(m=>Math.abs(m.acc)),1e-12);
  const vy = (v:number)=>MID-v/maxVel*MP, ay = (v:number)=>MID-v/maxAcc*MP;
  const vaccText = (v:number)=>Number(v.toPrecision(4)).toString();
  const selected = hover ? candles[hover.index] : visible.at(-1);
  const selectedIndex=hover?.index??end-1;
  const last=candles.at(-1);
  const hoverPrice=hover&&selected&&hover.y>=TOP&&hover.y<=TOP+PH
    ?hi-(hover.y-TOP)/PH*(hi-lo):null;
  const hoverPriceLabel=hoverPrice===null?'':priceText(hoverPrice);
  const hoverPriceFontSize=Math.min(13,(RIGHT-16)/Math.max(1,hoverPriceLabel.length*.62));
  const selectedVacc=analysis?.vacc.find(m=>m.time===candles[selectedIndex]?.time);
  const conditionIndex=candles.findLastIndex(c=>c.closed!==false);
  const setupX=W-RIGHT-setupWidth+28;
  const rawLevels=forecastSide?[
    {id:'entry',label:t('入场区间','Entry zone'),price:forecastSide.triggerPrice,text:`${priceText(forecastSide.zoneLow)} – ${priceText(forecastSide.zoneHigh)}`,color:forecastSide.side==='long'?'#42d6ab':'#f4777c'},
    {id:'stop',label:t('止损价','Stop loss'),price:forecastSide.invalidationPrice,text:priceText(forecastSide.invalidationPrice),color:'#ef9599'},
    ...forecastSide.targets.map((target,i)=>({id:`t${i+1}`,label:forecastTargetLabel(i,target.estimated,language),price:target.price,text:priceText(target.price),color:'#79cbb6'})),
  ]:neutralForecast?[
    ...(neutralForecast.support?[{id:'support',label:neutralForecast.support.estimated?t('参考支撑（估算）','Support (estimated)'):t('参考支撑','Reference support'),price:neutralForecast.support.price,text:priceText(neutralForecast.support.price),color:'#9ebdc7'}]:[]),
    ...(neutralForecast.resistance?[{id:'resistance',label:neutralForecast.resistance.estimated?t('参考阻力（估算）','Resistance (estimated)'):t('参考阻力','Reference resistance'),price:neutralForecast.resistance.price,text:priceText(neutralForecast.resistance.price),color:'#cbb98e'}]:[]),
  ]:plan?[
    {id:'entry',label:plan.status==='triggered'?t('原入场区','Original entry'):t('入场区','Entry zone'),price:plan.triggerPrice,text:`${priceText(plan.entryLow)} – ${priceText(plan.entryHigh)}`,color:plan.side==='long'?'#42d6ab':'#f4777c'},
    {id:'stop',label:t('止损','Stop loss'),price:plan.stopLoss,text:priceText(plan.stopLoss),color:'#ef9599'},
    {id:'t1',label:t('第一目标 T1','Target T1'),price:plan.target1,text:priceText(plan.target1),color:'#79cbb6'},
    {id:'t2',label:t('第二目标 T2','Target T2'),price:plan.target2,text:priceText(plan.target2),color:'#79cbb6'},
  ]:[];
  const levels=rawLevels.map(l=>({...l,top:Math.max(TOP+(forecast?77:48),Math.min(TOP+PH-40,y(l.price)-20))})).sort((a,b)=>a.top-b.top);
  for(let i=1;i<levels.length;i++)levels[i].top=Math.max(levels[i].top,levels[i-1].top+48);
  for(let i=levels.length-1;i>=0;i--)levels[i].top=Math.min(levels[i].top,TOP+PH-40-(levels.length-1-i)*48);
  function position(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx=(e.clientX-rect.left)/rect.width*W;
    if(drag.current) {
      const delta=Math.round((e.clientX-drag.current.x)/(rect.width/W*step));
      setBack(Math.max(0,Math.min(candles.length-count,drag.current.back+delta)));
    }
    const index=Math.round((sx-LEFT)/step-.5)+start;
    setHover(index>=start&&index<end?{index,y:(e.clientY-rect.top)/rect.height*H,context:hoverContext}:null);
  }
  const colors = {long:'#42d6ab',short:'#f4777c',range:'#bca677'};
  return <div className="chart-shell">
    <div className="mobile-ohlc">{selected?<><span>{stamp(selected.time,true,interval,locale)}</span><span>{t('开','O')} {priceText(selected.open)} · {t('高','H')} {priceText(selected.high)}</span><span>{t('低','L')} {priceText(selected.low)} · {t('收','C')} {priceText(selected.close)}</span></>:<span>{t('等待行情数据','Waiting for market data')}</span>}<small>{t('图表可左右滑动','Swipe to explore the chart')}</small></div>
    <div className="chart-overlay-tools">
      {!analysis&&!forecast?<span className="chart-neutral-note">{loading?t('正在计算本周期预判','Calculating the current timeframe outlook'):t('等待行情数据','Waiting for market data')}</span>:unclear?<span className="chart-neutral-note" data-testid="chart-no-direction">{forecast?forecastTitle(forecast,language,dataFresh):t('暂不提示新方向','No new direction')}</span>:<div className="plan-direction-toggle" aria-label={forecast?t('查看预判方向','View forecast direction'):t('查看计划方向','View plan direction')}>{(['long','short'] as const).map(side=><button key={side} title={forecast?(side==='long'?t('查看做多方案','View long setup'):t('查看做空方案','View short setup')):side==='long'?t('查看多头方案，不更改计划状态','View the long plan without changing its status'):t('查看空头方案，不更改计划状态','View the short plan without changing its status')} className={(forecastSide?.side??plan?.side)===side?`active ${side}`:''} aria-pressed={(forecastSide?.side??plan?.side)===side} onClick={()=>{setPlanSelection({context:planContext,side});setBack(0);}} disabled={forecast?forecast[side].status!=='ready':!analysis?.tradePlans.length}>{forecast?(side==='long'?t('做多','Long'):t('做空','Short')):side==='long'?t('多头计划','Long plan'):t('空头计划','Short plan')}</button>)}</div>}
      <button aria-label={t('缩小图表','Zoom out')} title={t('缩小','Zoom out')} onClick={()=>setCount(c=>Math.min(600,c+40))}><Minus size={14}/></button><span>{Math.min(count,candles.length)} {t('根','bars')}</span><button aria-label={t('放大图表','Zoom in')} title={t('放大','Zoom in')} onClick={()=>setCount(c=>Math.max(40,c-30))}><Plus size={14}/></button><button title={t('回到最新','Latest')} aria-label={t('图表回到最新','Return chart to latest')} onClick={()=>{setBack(0);setCount(160);}}><ScanLine size={14}/></button>
    </div>
    <div className="chart-scroll" ref={scrollRef} tabIndex={0} role="region" aria-label={t('K线图区域，可横向滚动','Candlestick chart; scroll horizontally')}>
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{width:W,height:H}} role="img" aria-label={`${symbol} ${interval} ${t('K线、缠论结构、后续点位预判及VAcc图，拖动查看历史，滚轮缩放','candlesticks, Chan structures, forward reference levels and VAcc; drag to pan, scroll to zoom')}`} className="terminal-chart" onPointerMove={position} onPointerLeave={()=>{setHover(null);drag.current=null;}} onPointerDown={e=>{drag.current={x:e.clientX,back};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{setHover(null);drag.current=null;}} onWheel={e=>{setCount(c=>Math.max(40,Math.min(600,c+(e.deltaY>0?15:-15))));}}>
      <defs><clipPath id="price-clip"><rect x="0" y={TOP} width={W-RIGHT} height={PH+8}/></clipPath><clipPath id={centerClipId}><rect data-testid="chart-center-clip" x={LEFT} y={TOP} width={usable} height={PH}/></clipPath><linearGradient id="watermark-grad"><stop stopColor="#223039"/><stop offset="1" stopColor="#122129"/></linearGradient></defs>
      <rect width={W} height={H} fill="#0e181e"/>
      {Array.from({length:6},(_,i)=>{const v=hi-(hi-lo)*i/5,py=y(v);return <g key={i}><line x1={LEFT} x2={W-RIGHT} y1={py} y2={py} stroke="#2b3b45" strokeWidth=".7" strokeDasharray="2 4"/><text x={W-RIGHT+10} y={py+4} fill="#afc0c9" fontSize="12" fontFamily="monospace">{priceText(v)}</text></g>;})}
      {Array.from({length:Math.max(3,Math.floor(usable/105))},(_,i)=>{const ticks=Math.max(3,Math.floor(usable/105)),index=start+Math.floor(visible.length*i/ticks);return <g key={i}><line x1={x(index)} x2={x(index)} y1={TOP} y2={H-28} stroke="#25343e" strokeWidth=".7"/><text x={Math.max(48,x(index))} y={H-9} fill="#afc0c9" fontSize="12" textAnchor="middle">{candles[index]?stamp(candles[index].time,false,interval,locale):''}</text></g>;})}
      <text x="18" y="25" fill="#d8e5e9" fontSize="13" fontFamily="monospace">{selected?stamp(selected.time,true,interval,locale):t('正在获取市场数据','Loading market data')}</text>
      {selected&&<text x="18" y="49" fill={selected.close>=selected.open?'#42d6ab':'#f4777c'} fontSize="13" fontFamily="monospace">{t('开','O')} {priceText(selected.open)}  {t('高','H')} {priceText(selected.high)}  {t('低','L')} {priceText(selected.low)}  {t('收','C')} {priceText(selected.close)}</text>}
      <text x={W/2-50} y="230" textAnchor="middle" fill="url(#watermark-grad)" fontSize="52" fontWeight="700" letterSpacing="3">{symbol}</text>
      <text x={W/2-50} y="258" textAnchor="middle" fill="#23343d" fontSize="12" letterSpacing="5">CHAN OBSERVATORY</text>
      {showScenarios&&conditionIndex>=0&&<g><line x1={x(conditionIndex+.5)} x2={x(conditionIndex+.5)} y1={TOP} y2={PH+TOP} stroke="#607781" strokeDasharray="4 5"/><text x={x(conditionIndex+2)} y={TOP+16} fill="#b8cbd2" fontSize="12">{t('推演路径','Projected path')}</text></g>}
      <g clipPath={`url(#${centerClipId})`} data-testid="chart-centers">
        {centerDrawings.map(({center:c,geometry:g,number,layer,key,code,upper,lower,description})=>{
          const color=layer==='stroke'?'#8bbcf6':'#e1c895';
          return <g key={key} data-testid="chart-center" data-start-index={c.startIndex} data-end-index={c.endIndex} data-center-number={number} data-center-layer={layer} role="group" aria-label={description}>
            <title>{description}</title>
            <rect data-testid="chart-center-box" x={g.x} y={g.y} width={g.width} height={g.height} fill={layer==='stroke'?'#8bbcf6':'#cbb077'} fillOpacity={layer==='stroke'?'.07':'.09'} stroke={layer==='stroke'?'#8bbcf6':'#b69b67'} strokeOpacity={layer==='stroke'?'.9':'.65'} strokeWidth={layer==='stroke'?'1.2':'.8'} strokeDasharray={c.status==='broken'?'3 3':undefined}/>
            {centerLabels.get(key)==='full'&&<text data-testid="chart-center-label" x={g.x+5} y={g.visibleTop+14} fill={color} fontSize="12" stroke="#0e181e" strokeWidth="3" paintOrder="stroke"><tspan>{upper}</tspan><tspan x={g.x+5} dy="15">{lower}</tspan></text>}
            {centerLabels.get(key)==='compact'&&<text data-testid="chart-center-compact-label" x={g.x+5} y={g.visibleTop+13} fill={color} fontSize="12" fontWeight="600" stroke="#0e181e" strokeWidth="3" paintOrder="stroke">{code}</text>}
          </g>;
        })}
      </g>
      <g clipPath="url(#price-clip)">
      {visible.map((c,i)=>{const cx=x(i+start),col=c.close>=c.open?'#42d6ab':'#f4777c',bodyW=Math.max(1,Math.min(8,step*.68));return <g key={c.time} opacity={c.closed===false ? .55 : 1}><line x1={cx} x2={cx} y1={y(c.high)} y2={y(c.low)} stroke={col} strokeWidth=".9"/><rect x={cx-bodyW/2} y={y(Math.max(c.open,c.close))} width={bodyW} height={Math.max(1,Math.abs(y(c.open)-y(c.close)))} fill={col}/></g>;})}
      {layers.strokes&&analysis?.strokes.filter(s=>s.to.index>=start&&s.from.index<end).map((s,i)=><line key={i} x1={x(s.from.index)} x2={x(s.to.index)} y1={y(s.from.price)} y2={y(s.to.price)} stroke="#84b7e4" strokeWidth="1.2" opacity=".85" strokeDasharray={s.confirmed?undefined:'4 4'}/>)}
      {layers.segments&&analysis?.segments.filter(s=>s.to.index>=start&&s.from.index<end).map((s,i)=><line key={i} x1={x(s.from.index)} x2={x(s.to.index)} y1={y(s.from.price)} y2={y(s.to.price)} stroke="#dbba76" strokeWidth="2.3" strokeDasharray={s.confirmed?undefined:'5 4'}/>)}
      {layers.trends&&analysis?.trends.filter(s=>s.to.index>=start&&s.from.index<end).map((s,i)=><line key={i} x1={x(s.from.index)} x2={x(s.to.index)} y1={y(s.from.price)} y2={y(s.to.price)} stroke="#c58af0" strokeWidth="3.4" opacity=".9" strokeDasharray={s.confirmed?undefined:'7 5'}/>)}
      {layers.fractals&&analysis?.fractals.filter(f=>f.index>=start&&f.index<end).map((f,i)=><circle key={i} cx={x(f.index)} cy={y(f.price)} r="2.4" fill={f.type==='bottom'?'#42d6ab':'#f4777c'}/>)}
      {layers.signals&&analysis?.signals.filter(s=>s.index>=start&&s.index<end).map((s,i)=>{const yy=y(s.price)+(s.side==='long'?22:-22), labelWidth=Math.max(52,s.label.length*(locale==='zh-CN'?12:6.7)+12);return <g key={i}><line x1={x(s.index)} x2={x(s.index)} y1={y(s.price)} y2={yy} stroke={colors[s.side]} strokeWidth=".7"/><rect x={x(s.index)-labelWidth/2} y={yy-10} width={labelWidth} height="22" rx="3" fill={s.side==='long'?'#154236':'#47272d'} stroke={colors[s.side]} strokeWidth=".5"/><text x={x(s.index)} y={yy+5} textAnchor="middle" fill={colors[s.side]} fontSize="12">{s.label}</text></g>;})}
      {showScenarios&&conditionIndex>=0&&analysis?.scenarios.map((s,i)=><polyline key={i} points={s.points.map(p=>`${x(conditionIndex+p.offset)},${y(p.price)}`).join(' ')} fill="none" stroke={colors[s.side]} strokeWidth="1.5" strokeDasharray="5 5" opacity=".78"/>)}
      {last&&back===0&&<line x1={LEFT} x2={W-RIGHT} y1={y(last.close)} y2={y(last.close)} stroke={last.close>=last.open?'#42d6ab':'#f4777c'} strokeDasharray="2 5" opacity=".5"/>}
      </g>
      {(plan||forecastSide||neutralForecast)&&<g className="chart-trade-plans" aria-label={forecast?t('后续预判参考价位','Forward reference levels'):t('交易计划价位','Trade plan levels')} data-testid={forecast?`chart-forecast-${forecastSide?.side??'neutral'}`:`chart-plan-${plan!.side}`}>
        <rect x={W-RIGHT-setupWidth} y={TOP} width={setupWidth} height={PH+8} fill="#112229" fillOpacity=".96"/>
        <line x1={W-RIGHT-setupWidth} x2={W-RIGHT-setupWidth} y1={TOP} y2={TOP+PH+8} stroke="#48616a" strokeDasharray="3 5"/>
        {forecast?<>
          <text x={setupX-8} y={TOP+21} fill={forecast.direction==='neutral'?'#c2d0d6':colors[forecast.direction]} fontSize="14" fontWeight="600"><ForecastTitleText forecast={forecast} language={language} dataFresh={dataFresh} svg/></text>
          <text x={setupX-8} y={TOP+42} fill={forecastSide?colors[forecastSide.side]:'#c4d3d9'} fontSize="13" fontWeight="600">{forecastSide?(forecastSide.side==='long'?t('做多方案','Long setup'):t('做空方案','Short setup')):`${t('基准价格','Reference')} ${forecast.referencePrice===null?'—':priceText(forecast.referencePrice)}`}{forecastSide&&forecastSide.side!==forecast.direction&&t(' · 反向备选',' · Alternative')}</text>
          <text x={setupX-8} y={TOP+61} fill="#aebfc8" fontSize="12">{t('结构时间','Structure time')} {forecast.structureAsOf?new Date(forecast.structureAsOf*1000).toLocaleString(locale,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'—'}</text>
        </>:plan&&<>
          <text x={setupX-8} y={TOP+21} fill={colors[plan.side]} fontSize="16" fontWeight="600">{plan.side==='long'?t('多头计划','Long plan'):t('空头计划','Short plan')} · {plan.status==='triggered'?t('跟踪中','Tracking'):plan.statusLabel}</text>
          <text x={setupX-8} y={TOP+40} fill="#b8cbd2" fontSize="12">{plan.triggeredAt?`${t('触发K线','Triggered bar')} ${new Date(plan.triggeredAt*1000).toLocaleString(locale,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}`:plan.status!=='untriggered'?t('该方案已结束','This plan has ended'):analysis?.decision.state==='tracking'?t('另一方向已有触发，本方案仍等待','Opposite plan triggered; this plan awaits'):t('等待本周期K线结束确认','Awaiting a qualifying candle close')}</text>
        </>}
        {(plan||forecastSide)&&<rect x={Math.max(LEFT,x(end-Math.min(24,visible.length)))} y={y(forecastSide?.zoneHigh??plan!.entryHigh)} width={Math.max(1,W-RIGHT-setupWidth-Math.max(LEFT,x(end-Math.min(24,visible.length))))} height={Math.max(2,y(forecastSide?.zoneLow??plan!.entryLow)-y(forecastSide?.zoneHigh??plan!.entryHigh))} fill={colors[forecastSide?.side??plan!.side]} fillOpacity=".16"/>}
        {levels.map(l=><g key={l.id} data-testid={`chart-level-${l.id}`}>
          <title>{`${l.label} · ${l.text}${forecastSide&&l.id==='entry'?` · ${forecastCondition(forecastSide,language,priceText)}`:''}`}</title>
          <line x1={Math.max(LEFT,x(end-Math.min(24,visible.length)))} x2={setupX-15} y1={y(l.price)} y2={y(l.price)} stroke={l.color} strokeWidth="1.1" strokeDasharray={l.id==='entry'?'5 3':'2 4'} opacity=".8"/>
          <circle cx={setupX-15} cy={y(l.price)} r="3" fill={l.color}/>
          <path d={`M ${setupX-12} ${y(l.price)} L ${setupX-5} ${l.top+20} L ${setupX} ${l.top+20}`} fill="none" stroke={l.color} strokeWidth=".9"/>
          <rect x={setupX} y={l.top} width={230} height={42} rx="4" fill="#12272c" stroke={l.color} strokeOpacity=".6"/>
          <text x={setupX+9} y={l.top+15} fill={l.color} fontSize="13" fontWeight="600">{l.label}</text>
          <text x={setupX+9} y={l.top+34} fill="#f0f6f7" fontFamily="monospace" fontSize={l.id==='entry'?14:17}>{l.text}</text>
        </g>)}
      </g>}
      {last&&back===0&&(hoverPrice===null||!hover||Math.abs(y(last.close)-hover.y)>26)&&<g><rect x={W-RIGHT} y={y(last.close)-12} width={RIGHT} height="24" rx="2" fill={last.close>=last.open?'#1d7762':'#9b424d'}/><text x={W-RIGHT+8} y={y(last.close)+4} fill="#fff" fontSize="13" fontFamily="monospace">{priceText(last.close)}</text></g>}
      <line x1="0" x2={W} y1="452" y2="452" stroke="#27343c"/>
      {visible.map((c,i)=><rect key={c.time} x={x(i+start)-Math.min(8,step*.68)/2} y={VOL-c.volume/maxVol*25} width={Math.max(1,Math.min(8,step*.68))} height={c.volume/maxVol*25} fill={c.close>=c.open?'#42d6ab':'#f4777c'} fillOpacity=".18"/>)}
      <text x="18" y="474" fill="#bacbd2" fontSize="12">VAcc {analysis?.vaccParams.n??30} / {analysis?.vaccParams.m??7}</text>
      {selectedVacc&&<text x="160" y="474" fill="#e5c78c" fontSize="12" fontFamily="monospace">Vel {vaccText(selectedVacc.vel)}　<tspan fill={selectedVacc.acc>=0?'#42d6ab':'#f4777c'}>Acc {vaccText(selectedVacc.acc)}</tspan>{selectedVacc.state&&<tspan fill="#a5c6ee">　{selectedVacc.state==='long'?t('确认多','Confirmed long'):t('确认空','Confirmed short')}</tspan>}{selectedVacc.pending&&<tspan fill="#8fa3ad">　{selectedVacc.pending==='long'?t('候选多','Long candidate'):t('候选空','Short candidate')}</tspan>}</text>}
      <line x1={LEFT} x2={W-RIGHT} y1={MID} y2={MID} stroke="#293941" strokeDasharray="2 4"/>
      {vacc.map(m=><rect key={m.time} x={x(candleIndices.get(m.time)!)-Math.max(1,step*.55)/2} y={Math.min(ay(m.acc),MID)} width={Math.max(1,step*.55)} height={Math.max(.4,Math.abs(ay(m.acc)-MID))} fill={m.acc>=0?'#42d6ab':'#f4777c'} opacity=".65"/>)}
      <polyline points={vacc.map(m=>`${x(candleIndices.get(m.time)!)},${vy(m.vel)}`).join(' ')} stroke="#d3b77e" fill="none" strokeWidth="1.2"/>
      {hover&&selected&&<g pointerEvents="none">
        <line x1={x(hover.index)} x2={x(hover.index)} y1={TOP} y2={H-28} stroke="#a9bbc2" strokeWidth=".7" strokeDasharray="3 3"/>
        {hoverPrice!==null&&<>
          <line x1={LEFT} x2={W-RIGHT} y1={hover.y} y2={hover.y} stroke="#c8dbe4" strokeWidth=".8" strokeDasharray="3 3"/>
          <g data-testid="chart-crosshair-price" role="group" aria-label={`${t('十字线价格','Crosshair price')} ${hoverPriceLabel}`}>
            <path d={`M ${W-RIGHT} ${hover.y-13} H ${W-2} V ${hover.y+13} H ${W-RIGHT} L ${W-RIGHT-5} ${hover.y} Z`} fill="#d6e5ec"/>
            <text x={W-RIGHT+8} y={hover.y+4.5} fill="#0b1a22" fontSize={hoverPriceFontSize} fontWeight="600" fontFamily="monospace">{hoverPriceLabel}</text>
          </g>
        </>}
        <rect x={Math.max(0,Math.min(W-184,x(hover.index)-92))} y={H-29} width="184" height="26" fill="#2c3e47" rx="3"/>
        <text x={Math.max(92,Math.min(W-92,x(hover.index)))} y={H-12} fill="#f0f6f7" fontSize="12" textAnchor="middle">{stamp(selected.time,true,interval,locale)}</text>
      </g>}
      {!candles.length&&!loading&&<text x={W/2} y="300" textAnchor="middle" fill="#81969e" fontSize="14">{t('行情载入后，将在这里绘制真实走势','Real price history will appear when data loads')}</text>}
    </svg>
    </div>
    {loading&&<div className="chart-loading"><span className="spinner"/><span>{t('正在连接行情源','Connecting to market data')}</span></div>}
    <div className="chart-bottom"><span style={{flexWrap:'wrap',whiteSpace:'normal'}}><i className="legend-dot blue"/>{t('笔','Strokes')} <i className="legend-dot gold"/>{t('线段','Segments')} {layers.trends&&<><i className="legend-dot" style={{background:'#c58af0'}}/>{t('趋势','Trends')} </>}{layers.centers&&<><i style={{width:9,height:9,border:'1px solid #8bbcf6',background:'#8bbcf61a',marginLeft:7}}/>{t('笔中枢（局部）','Stroke centers (local)')}<i style={{width:9,height:9,border:'1px solid #b69b67',background:'#cbb07724',marginLeft:7}}/>{t('线段中枢','Segment centers')}</>}{!unclear&&<><i className="legend-line"/>{forecast?t('预判参考位','Outlook reference levels'):t('推演路径','Projected path')}</>}</span><span>{back>0&&layers.setups&&!unclear?forecast?t('查看历史中 · 回到最新显示预判','Viewing history · return to latest for outlook'):t('查看历史中 · 回到最新显示交易计划','Viewing history · return to latest for trade plans'):t('本地时间','Local time')}</span></div>
    {candles.length>count&&<input className="history-slider" aria-label={t('历史图表位置','Historical chart position')} type="range" min="0" max={Math.max(0,candles.length-count)} value={candles.length-count-back} onChange={e=>setBack(candles.length-count-Number(e.target.value))}/>}
  </div>;
}
