import { Activity } from 'lucide-react';
import type { Analysis, Interval, Market, TradePlan } from '@/lib/market-types';
import { useLanguage, type Language } from '@/lib/language';
import { isDirectionUnclear } from '@/lib/plan-presentation';
import type { MarketForecast } from '@/lib/forecast-types';
import { forecastSummary, forecastHigherText, forecastPeriod, forecastRegimeText } from './forecast-copy';
import ForecastTitleText from './forecast-title-text';

type Confluence = NonNullable<Analysis['confluence']>;
type Assessment = Confluence['long'];
type EvidenceCode = Assessment['evidence'][number]['code'];
const pick = (language:Language, zh:string, en:string) => language==='zh'?zh:en;
const intervalNames:Record<Interval,[string,string]> = {
  '1m':['1分钟','1 min'],'5m':['5分钟','5 min'],'15m':['15分钟','15 min'],
  '30m':['30分钟','30 min'],'1h':['1小时','1 hour'],'4h':['4小时','4 hours'],
  '1d':['日线','Daily'],'1w':['周线','Weekly'],'1M':['月线','Monthly'],
};
const assessmentNames:Record<Assessment['status'],[string,string]> = {
  aligned:['指标配合','Evidence aligned'],mixed:['支持不足','Insufficient support'],
  opposed:['存在反向证据','Opposing evidence'],insufficient:['数据不全','Incomplete data'],
};
const evidenceNames:Record<EvidenceCode,[string,string]> = {
  'vacc-aligned':['VAcc同向确认','VAcc confirmed in this direction'],
  'vacc-weakening':['VAcc加速度转弱','VAcc acceleration weakening'],
  'vacc-opposed':['VAcc反向确认','VAcc confirmed in the opposite direction'],
  'vacc-mixed':['VAcc方向未确认','VAcc direction unconfirmed'],
  'vacc-pending':['VAcc速度已穿零轴，待加速度确认','VAcc velocity crossed zero; awaiting acceleration confirmation'],
  'vacc-insufficient':['VAcc历史不足','Insufficient VAcc history'],
  'volume-aligned':['同向放量','Volume expands with price'],
  'volume-opposed':['反向放量','Volume expands against this side'],
  'volume-normal':['量能正常','Normal volume'],
  'volume-low':['量能偏低','Low volume'],
  'volume-insufficient':['量能数据不足','Insufficient volume data'],
  'higher-aligned':['更大周期同向','Higher timeframe aligned'],
  'higher-opposed':['更大周期反向','Higher timeframe opposed'],
  'higher-neutral':['更大周期无明确方向','Higher timeframe has no clear direction'],
  'higher-insufficient':['更大周期历史不足','Insufficient higher-timeframe history'],
  'higher-loading':['更大周期加载中','Loading higher timeframe'],
  'higher-error':['更大周期暂不可用','Higher timeframe unavailable'],
  'higher-none':['没有更大周期数据','No higher timeframe available'],
  'higher-imported':['导入数据没有更大周期','No higher timeframe for imported data'],
  'higher-stale':['更大周期数据过旧','Higher-timeframe data is stale'],
  'higher-mismatch':['更大周期来源或复权口径不一致','Higher-timeframe source or adjustment basis differs'],
};
const higherNames:Record<Confluence['higher']['status'],[string,string]> = {
  ready:['',''],loading:['正在加载','Loading'],error:['暂未取得数据','Data unavailable'],
  none:['没有更大周期数据','No higher timeframe available'],
  imported:['导入数据未提供','Not supplied with imported data'],
  insufficient:['已完成K线历史不足','Insufficient closed-bar history'],
  stale:['数据过旧，未参与判断','Stale data; excluded from assessment'],
  mismatch:['来源或复权口径不一致，未参与判断','Source or adjustment basis differs; excluded from assessment'],
};
const directionText = (direction:'long'|'short'|'neutral',language:Language) =>
  direction==='long'?pick(language,'偏多','Bullish'):direction==='short'?pick(language,'偏空','Bearish'):pick(language,'方向不明确','No clear direction');

function vaccDirectionText(analysis:Analysis,language:Language):string {
  const vacc=analysis.confluence!.vacc;
  if(vacc.direction==='neutral'&&vacc.pending)return vacc.pending==='long'
    ?pick(language,'速度上穿零轴，待确认','Velocity above zero, unconfirmed')
    :pick(language,'速度下穿零轴，待确认','Velocity below zero, unconfirmed');
  if(vacc.direction==='neutral'&&vacc.vel!==null&&vacc.acc!==null&&Number.isFinite(vacc.vel)&&Number.isFinite(vacc.acc)) {
    if(vacc.vel<0&&vacc.acc>0)return pick(language,'零轴下减速','Decelerating below zero');
    if(vacc.vel>0&&vacc.acc<0)return pick(language,'零轴上减速','Decelerating above zero');
  }
  return directionText(vacc.direction,language);
}

export function assessmentText(assessment:Assessment,language:Language):string {
  return pick(language,...assessmentNames[assessment.status]);
}
export function evidenceText(assessment:Assessment,language:Language):string {
  return assessment.evidence.map(e=>pick(language,...evidenceNames[e.code])).join(language==='zh'?'；':'; ');
}

/** Shares the same tracking focus as the chart and plan banner; this never
 * changes an old trigger into a new entry instruction. */
export function confluenceSummary(analysis:Analysis,language:Language):string {
  const c=analysis.confluence,d=analysis.decision;
  if(!c)return '';
  if(isDirectionUnclear(d))return pick(language,'等待后续K线结束后形成清晰信号。','Waiting for a clear signal from subsequent closed bars.');
  if(d.state==='tracking'&&d.direction!=='neutral') {
    const side=pick(language,d.direction==='long'?'多头':'空头',d.direction==='long'?'Long':'Short');
    return pick(language,`${side}当前${assessmentText(c[d.direction],language)}，继续跟踪原止损与目标。`,`${side}: ${assessmentText(c[d.direction],language).toLowerCase()}. Continue tracking the original stop and targets.`);
  }
  if(d.state==='unavailable')return pick(language,'当前没有有效交易计划；指标仅供查看。','There is no active trade plan; indicators are shown for context.');
  return pick(language,`多头：${assessmentText(c.long,language)}；空头：${assessmentText(c.short,language)}。仍需等待K线结束确认。`,`Long: ${assessmentText(c.long,language).toLowerCase()}; short: ${assessmentText(c.short,language).toLowerCase()}. A candle-close confirmation is still required.`);
}

export function PlanConfluence({analysis,plan,language}:{analysis:Analysis;plan:TradePlan;language:Language}) {
  const c=analysis.confluence;
  if(!c||plan.status==='invalidated'||plan.status==='target_reached')return null;
  const assessment=c[plan.side];
  return <div className="plan-confluence" data-testid={`plan-confluence-${plan.side}`}>
    <div><span>{pick(language,'当前指标支持','Current indicator support')}</span><span className={`confluence-grade ${assessment.status}`}>{assessmentText(assessment,language)}</span></div>
    <p>{evidenceText(assessment,language)}</p>
    {plan.status==='triggered'&&<small>{pick(language,'这是最新指标状态，不是新的入场信号。','This is the latest indicator state, not a new entry signal.')}</small>}
  </div>;
}

export default function ConfluencePanel({analysis,loading,language:override,interval,market,forecast,dataFresh=true}:{analysis:Analysis|null;loading:boolean;language?:Language;interval?:Interval;market?:Market;forecast?:MarketForecast;dataFresh?:boolean}) {
  const languageContext=useLanguage();
  const language=override??languageContext.language;
  const t=(zh:string,en:string)=>pick(language,zh,en);
  const c=analysis?.confluence,d=analysis?.decision;
  const timeframe=forecast?.timeframeAssessment;
  const higherInterval=timeframe?(timeframe.higherInterval?forecastPeriod(timeframe.higherInterval,language):''):(c?.higher.interval?pick(language,...intervalNames[c.higher.interval]):'');
  const higherReady=timeframe?timeframe.status!=='unavailable':c?.higher.status==='ready';
  const evidenceCurrent=!forecast||!timeframe||c?.asOf===forecast.structureAsOf;
  const momentum=c?.vacc.momentum==='strengthening'?t('加速','Accelerating'):c?.vacc.momentum==='weakening'?t('减速','Decelerating'):t('匀速','Steady');
  const volume=c?.volume.participation==='expanded'?t('放量','Expanded volume'):c?.volume.participation==='low'?t('量能偏低','Low volume'):t('量能正常','Normal volume');
  return <section className="confluence-card panel" aria-label={t('综合判断','Combined assessment')} data-testid="confluence-panel">
    <div className="card-top"><span><Activity size={18}/>{t('综合判断','Combined assessment')}</span><span className="confluence-mode">{t('辅助参考','Supporting context')}</span></div>
    {interval&&<p className="confluence-period micro-copy" data-testid="confluence-period">{t('当前周期：','Current period: ')}{pick(language,...intervalNames[interval])} · {t('K线结束后确认','Confirmed after candle close')}{market==='crypto'&&t(' · 全天连续交易',' · Trades 24/7')}</p>}
    {forecast&&<>
      <h2 className={`confluence-decision ${dataFresh&&forecast.status==='ready'&&forecast.direction!=='neutral'?forecast.direction:'quiet'}`}><ForecastTitleText forecast={forecast} language={language} dataFresh={dataFresh}/></h2>
      <p className="confluence-summary" style={{fontSize:16}} data-testid="forecast-confluence-summary">{forecastSummary(forecast,language,dataFresh)}</p>
      {dataFresh&&forecast.regime&&<dl className="confluence-evidence" data-testid="forecast-market-regime">
        <div className={forecast.regime.status==='ready'?'':'unavailable'}>
          <dt>{t('行情状态','Market regime')}</dt><dd style={{fontSize:18}}>{forecastRegimeText(forecast,language)}</dd>
          <small>{t('辅助观察，不单独决定方向','Context only; does not set the outlook direction')}</small>
        </div>
      </dl>}
    </>}
    {c&&analysis&&d&&(!forecast||dataFresh)&&evidenceCurrent?<>
      {!forecast&&<><h2 className={`confluence-decision ${isDirectionUnclear(d)?'quiet':`${d.direction} ${d.state}`}`}>{d.title}</h2>
      <p className="confluence-summary" data-testid="confluence-summary">{confluenceSummary(analysis,language)}</p></>}
      <dl className="confluence-evidence">
        <div className={c.vacc.status==='ready'?'':'unavailable'}>
          <dt>VAcc</dt><dd>{c.vacc.status==='ready'?`${vaccDirectionText(analysis,language)} · ${momentum}`:t('已完成K线历史不足','Insufficient closed-bar history')}</dd>
        </div>
        <div className={c.volume.status==='ready'?'':'unavailable'}>
          <dt>{t('成交量','Volume')}</dt><dd>{c.volume.status==='ready'&&c.volume.ratio!==null?`${volume} · ${c.volume.ratio.toFixed(2)}×`:c.volume.reason==='zero-volume'?t('成交量缺失或为零','Volume is missing or zero'):t('可比较的量能历史不足','Insufficient comparable volume history')}</dd>
          {c.volume.status==='ready'&&<small>{c.volume.benchmark==='same-session-slot'?t('相对历史相同时段','Relative to matching historical session slots'):t('相对近期已完成K线','Relative to recent closed bars')}</small>}
        </div>
        <div className={higherReady?'':'unavailable'}>
          <dt><span>{t('更大周期','Higher timeframe')}</span>{higherInterval&&<span>{higherInterval}</span>}</dt>
          <dd>{timeframe&&forecast?forecastHigherText(forecast,language):c.higher.status==='ready'?directionText(c.higher.direction,language):pick(language,...higherNames[c.higher.status])}</dd>
          {higherReady&&<small>{t('仅使用当时已完成的K线','Uses only data closed at the analysis time')}</small>}
        </div>
      </dl>
      {!forecast&&<p className="confluence-foot">{t('指标配合与价格触发分开显示；已触发计划按原止损跟踪。','Indicator evidence is separate from price triggers. Triggered plans retain their original stops.')}</p>}
    </>:!forecast&&<p className="empty-mini">{loading?t('正在汇总指标','Loading indicator evidence'):t('加载行情后显示综合判断','Load market data to see the combined assessment')}</p>}
  </section>;
}
