import type { Analysis, Factor, Scenario, Signal, TradeDecision, TradePlan, TradeSetup } from './market-types';

export type AnalysisLanguage = 'zh' | 'en';
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: Math.min(12, Math.max(2, 5 - Math.floor(Math.log10(Math.abs(n) || 1)))) });
const statusLabels = { untriggered: 'Not triggered', triggered: 'Triggered', invalidated: 'Invalidated', target_reached: 'Target reached' } as const;

const factorNames: Record<string, string> = {
  '中枢位置': 'Center position', '线段方向': 'Segment direction', '最近笔': 'Latest stroke', 'VAcc速度': 'VAcc velocity',
};
const factorDetails: Record<string, string> = {
  '价格位于最近线段中枢上方': 'Price is above the latest segment center.',
  '价格位于最近线段中枢下方': 'Price is below the latest segment center.',
  '价格仍在最近线段中枢内': 'Price remains inside the latest segment center.',
  '尚无已确认线段中枢': 'No confirmed segment center is available.',
  '最近确认线段向上': 'The latest confirmed segment points up.',
  '最近确认线段向下': 'The latest confirmed segment points down.',
  '确认线段不足': 'Insufficient confirmed segments.',
  '最近确认笔向上；尾笔不纳入': 'The latest confirmed stroke points up; the developing stroke is excluded.',
  '最近确认笔向下；尾笔不纳入': 'The latest confirmed stroke points down; the developing stroke is excluded.',
  '有效笔不足': 'Insufficient valid strokes.',
  '速度在零轴上方，作辅助观察': 'VAcc velocity is above zero; used as supporting evidence.',
  '速度在零轴下方，作辅助观察': 'VAcc velocity is below zero; used as supporting evidence.',
  '速度接近零轴': 'VAcc velocity is near zero.',
};
const warningText: Record<string, string> = {
  '线段为实验性特征序列实现（含有缺口/无缺口及强反向破坏）；复杂包含、古怪线段仍需人工核图，不宣称原典全规则唯一分解。': 'Segments use an experimental feature-sequence implementation, including gap, no-gap and strong reverse-break cases. Complex inclusion and unusual segments require chart review; a unique decomposition under all original rules is not claimed.',
  '中枢为已确认线段构成的最小层结构；尚未实现完整递归级别与跨周期区间套。类三买/卖及背驰均标为候选。': 'Centers are the minimum structures formed by confirmed segments. Full recursive levels and cross-timeframe nesting are not implemented. Third-class-like points and divergence remain algorithmic signals.',
  '多空比例是透明权重形成的结构评分，不是胜率、仓位建议或可执行交易概率；未来虚线仅展示条件情景。': 'Long/short percentages are weighted structure scores, not win rates, position sizing or execution probabilities. Dashed paths illustrate conditional scenarios.',
  '历史频率按未来固定根数收盘收益分类（±0.2%），不含手续费、滑点和实际交易约束；不等于策略收益。': 'Historical outcomes classify close-to-close returns over a fixed bar horizon using ±0.2%. Fees, slippage and trading constraints are excluded; these are not strategy returns.',
  '可用已收盘K线少于60根，结构及统计不充分。': 'Fewer than 60 valid closed bars are available; structure and statistics have limited history.',
  '多空各50为样本不足时的中性占位，不表示已确认结构均衡。': 'A 50/50 score is a neutral placeholder for insufficient history, not a confirmed balanced structure.',
  '图上后续买卖标注是条件观察边界，横向位置只用于排版；不是未来成交价或发生月份。需实际结构完成后重新确认。': 'Forward annotations are conditional reference levels. Horizontal spacing is for layout, not a predicted execution time or month; actual structure must be reviewed as it develops.',
  '交易计划直接给出参考入场区、止损与目标；ATR缓冲及1.5R/2.5R目标是本工具策略规则。状态按已收盘K线更新，不代表实际成交；横向排版不表示发生日期，目标不保证到达。': 'Trade plans provide reference entry bands, stops and targets. ATR buffers and 1.5R/2.5R targets are this tool\'s strategy rules. Closed bars update model status, not actual fills. Horizontal spacing does not predict event dates, and targets are not guaranteed.',
  '当前未收盘K线仅供价格展示，已排除出结构、评分与历史统计。': 'The unfinished bar is displayed for price context and excluded from structure, scoring and historical statistics.',
  '当前窗口有效笔不足；可增加历史范围或切换周期。': 'This window has too few valid strokes. Load more history or select another interval.',
};

function warningEn(text: string): string {
  if (warningText[text]) return warningText[text];
  const count = text.match(/\d+/)?.[0];
  if (text.startsWith('相似历史样本仅')) return `Only ${count ?? '0'} comparable historical samples are available, fewer than 20. The results are not calibrated probabilities.`;
  if (text.startsWith('已排除')) return `${count ?? '0'} invalid, duplicate or out-of-order bars were excluded. Check the data source.`;
  if (text.includes('交易计划') || text.includes('入场') || text.includes('ATR')) return 'Trade plans map confirmed structure and recent volatility into fixed entry bands, stops and risk-multiple targets. Model triggers do not imply fills; plans are recalculated as new structure becomes available.';
  if (text.includes('背驰') || text.includes('递归')) return 'Structural signals use an experimental implementation. Complete recursive Chan validation still requires review; the labels do not certify exact original-rule buy/sell points.';
  if (text.includes('多空') || text.includes('胜率')) return 'Long/short percentages measure relative structural bias, not the probability of profit or a recommended position size.';
  if (text.includes('横向') || text.includes('未来')) return 'Forward levels and paths are model scenarios. Horizontal spacing is illustrative and does not forecast event dates or guarantee execution.';
  return /[\u3400-\u9fff]/.test(text) ? 'Experimental structure analysis: verify the available history, calculation rules and market conditions before using these references.' : text;
}

function factorEn(f: Factor): Factor {
  return { ...f, name: factorNames[f.name] ?? f.name, detail: factorDetails[f.detail] ?? (f.value > 0 ? 'Positive contribution to the structure score.' : f.value < 0 ? 'Negative contribution to the structure score.' : 'No directional contribution to the structure score.') };
}

function signalEn(s: Signal): Signal {
  const buy = s.side === 'long';
  if (s.type.startsWith('third-')) return {
    ...s, label: buy ? '3B-like' : '3S-like',
    reason: buy
      ? 'After an upward departure, the confirmed return segment remains above the center high. Recursive lower-level completion has not been verified; this is a third-buy-like signal.'
      : 'After a downward departure, the confirmed return segment remains below the center low. Recursive lower-level completion has not been verified; this is a third-sell-like signal.',
  };
  const trending = s.type.startsWith('trend-');
  return {
    ...s, label: trending ? (buy ? 'Bullish divergence' : 'Bearish divergence') : (buy ? 'Downside weakening' : 'Upside weakening'),
    reason: `A same-direction segment makes a new ${buy ? 'low' : 'high'} while the pullback returns VAcc velocity to zero and the later segment's ${s.reason.includes('速度与加速度面积')?'velocity peak and acceleration area are':s.reason.includes('加速度面积')?'acceleration area is':'velocity peak is'} smaller than the prior same-direction segment's. ${trending ? 'Two directionally separated center candidates provide trend context.' : 'Full trend context is absent; this indicates weakening range momentum.'} This is an algorithmic divergence signal; recursive levels and comparison segments still require review.`,
  };
}

function scenarioEn(s: Scenario, all: Scenario[]): Scenario {
  const range = all.find(x => x.side === 'range');
  const edges = range?.points.slice(1, 3).map(p => p.price) ?? [];
  const lower = Math.min(...edges), upper = Math.max(...edges);
  const price = s.points[0]?.price ?? 0, above = price > upper, below = price < lower;
  const band = `${fmt(lower)}–${fmt(upper)}`;
  if (s.side === 'range') return {
    ...s, title: above || below ? 'Return to range' : 'Range continuation',
    trigger: above || below ? `A close must first return inside ${band}; then monitor movement between the boundaries.` : `Price remains inside ${band} without a completed departure and a retest that stays outside the range.`,
    invalidation: 'A completed departure and retest switches the analysis to the corresponding directional scenario.',
    target: 'Monitor the range boundaries and formation of new centers. A return to the range or continued ranging is not guaranteed.',
  };
  const buy = s.side === 'long', edge = buy ? upper : lower;
  const alreadyOutside = buy ? above : below;
  return {
    ...s,
    title: alreadyOutside ? `${buy ? 'Support' : 'Resistance'} retest and extension` : (buy ? below : above) ? `Return, then ${buy ? 'break up' : 'break down'}` : `${buy ? 'Upward breakout' : 'Downward break'} and retest`,
    trigger: `${(buy ? below : above) ? `First return inside ${band}. ` : ''}${alreadyOutside ? `Price is already ${buy ? 'above' : 'below'} the range. A retest of ${fmt(edge)} must stay outside it.` : `A close must break ${buy ? 'above' : 'below'} ${fmt(edge)}, followed by a retest that holds this boundary.`} Review the lower-level structure before treating the extension as valid.`,
    invalidation: `The retest returns ${buy ? 'below' : 'above'} ${fmt(edge)}; ${fmt(buy ? lower : upper)} is the further invalidation boundary.`,
    target: `If the conditions hold, monitor ${fmt(s.points.at(-1)?.price ?? 0)}. This range-width projection does not guarantee arrival.`,
  };
}

function setupEn(s: TradeSetup): TradeSetup {
  const buy = s.side === 'long', third = s.kind.startsWith('third-'), center = s.label.includes('中枢') || third;
  return {
    ...s,
    label: third ? (buy ? 'Third-buy reference' : 'Third-sell reference') : center ? (buy ? 'Center buy reference' : 'Center sell reference') : (buy ? 'Buy reference' : 'Sell reference'),
    trigger: center
      ? `After a ${buy ? 'upward' : 'downward'} departure, review a completed lower-level retest at ${fmt(s.price)} that stays ${buy ? 'above' : 'below'} the boundary. ${third ? 'Only the first qualifying retest can establish a third-class point.' : 'This is an older center; a fresh valid structure is required, and another retest is not automatically a new third-class point.'} A single bar crossing the level is insufficient.`
      : `Review a return toward ${fmt(s.price)} without a new ${buy ? 'low' : 'high'}, a confirmed ${buy ? 'bottom' : 'top'} fractal and an ${buy ? 'upward' : 'downward'} stroke. Verify divergence and lower-level completion before assigning a Chan point type. Touching the price alone is insufficient.`,
    invalidation: `A ${buy ? 'low below' : 'high above'} ${fmt(s.invalidationPrice)} invalidates this reference. Re-evaluate the structure; an old first retest cannot be reused.`,
    basis: center
      ? `Reference level ${fmt(s.price)} is the center ${buy ? 'high (ZG)' : 'low (ZD)'}. The actual point depends on a future completed retest; it is not a pre-known execution price.`
      : `Based on the latest ${s.basis.includes('尚待') ? 'closed-bar extreme, still awaiting fractal formation' : 'confirmed fractal or stroke endpoint'}. No confirmed segment center is available. The trend, divergence and recursive conditions for first-, second- or third-class points are incomplete.`,
  };
}

const reasons: Record<string, string> = {
  '尚无生成时点之后的已收盘K线满足入场条件。': 'No closed bar after plan creation has met the entry conditions.',
  '同根K线同时覆盖止损与目标，无法确定先后；按失效处理，不记作盈利。': 'The same bar covers both the stop and a target. Intrabar order is unknown; the plan is invalidated and no profit is recorded.',
  '已收盘K线覆盖止损价，模型计划失效。': 'A closed bar covers the stop price; the model plan is invalidated.',
  '已收盘K线覆盖第二目标；这是价格事件，不代表实际成交或收益。': 'A closed bar covers the second target. This is a price event, not evidence of a fill or return.',
  '已触发，第一目标价格已覆盖；剩余方案仍按原止损与第二目标跟踪。': 'Triggered; the first target has been covered. The remaining plan tracks the original stop and second target.',
  '此前收盘已触发；当前收盘已离开入场区，不应按现价追入。': 'An earlier close triggered the plan. The current close is outside the entry band; do not chase at the current price.',
  '此前收盘已触发；最近收盘已离开原入场区，继续跟踪原止损与目标。': 'An earlier close triggered the plan. The latest closed candle is outside the original entry band; keep tracking the original stop and targets.',
  '此前收盘已触发；最近收盘位于原入场区，继续跟踪原止损与目标。': 'An earlier close triggered the plan. The latest closed candle is within the original entry band; keep tracking the original stop and targets.',
  '同根K线同时出现触发与止损，顺序不明；跳过该计划。': 'The same bar contains both the trigger and stop. Their order is unknown; skip this plan.',
  '入场前参考结构已被止损边界破坏，计划失效。': 'The stop boundary was breached before entry; the reference structure and plan are invalidated.',
  '收盘跳过参考入场区，已放弃该次追价计划。': 'The close skipped the entry band. This plan is invalidated to avoid chasing.',
  '触发收盘形成前，同根K线已覆盖目标，无法确定顺序；跳过该计划。': 'The trigger bar also covers a target before its close can establish entry. Skip the plan because the intrabar sequence is not established.',
  '入场触发前目标价格已经覆盖，原计划已错过；不再按原入场区提示进入。': 'A target was covered before entry. This opportunity has passed; do not enter using the original entry band.',
  '已收盘K线满足突破及入场区规则；仅表示模型触发，不代表实盘成交。': 'A closed bar met the crossing and entry-band rules. This is a model trigger, not evidence of a live fill.',
  '生成后12根已收盘K线未触发，计划到期。': 'No entry occurred within 12 closed bars after creation; the plan expired.',
};
function reasonEn(reason: string): string {
  if (reasons[reason]) return reasons[reason];
  if (reason.includes('入场前') && reason.includes('目标')) return 'A target was covered before entry. This opportunity has passed; the plan is invalidated.';
  if (reason.includes('顺序')) return 'The bar covers conflicting trigger, stop or target events. Their intrabar sequence is unknown; the plan is invalidated.';
  return /[\u3400-\u9fff]/.test(reason) ? 'The model status follows closed-bar entry, stop, target and expiry rules; it is not an execution record.' : reason;
}

function planEn(p: TradePlan): TradePlan {
  const buy = p.side === 'long';
  const source = p.basis.includes('近端结构不在有效价格带') ? 'Recent eight closed bars and volatility-derived boundaries (no nearby structural level fits the effective price band)' : p.basis.includes('最近确认顶分型') ? 'The nearest confirmed top fractal' : p.basis.includes('最近确认底分型') ? 'The nearest confirmed bottom fractal' : p.basis.includes('近端中枢') ? 'A nearby center boundary' : 'The nearest confirmed stroke endpoint';
  const buffer = p.basis.match(/执行缓冲基准=([^（]+)/)?.[1];
  return {
    ...p, label: buy ? 'Long plan' : 'Short plan', strategy: buy ? 'Local structure breakout' : 'Local structure breakdown', statusLabel: statusLabels[p.status],
    trigger: `A later closed bar must cross ${buy ? 'up through' : 'down through'} ${fmt(p.triggerPrice)} and close inside ${fmt(p.entryLow)}–${fmt(p.entryHigh)}. A close beyond the band is skipped; do not chase.`,
    invalidation: `A ${buy ? 'low at or below' : 'high at or above'} ${fmt(p.stopLoss)} invalidates the plan. An untriggered plan expires after 12 closed bars. A trigger and stop/target in the same bar is treated as an ambiguous, invalidated plan.`,
    basis: `${source}. ${p.basis.includes('旧中枢距现价较远') ? 'The old center is far from current price and provides directional context only. ' : ''}ATR14=${fmt(p.atr)}${buffer ? `; execution buffer=${buffer}` : ''}, bounded to 0.2%–10% of the creation price; entry-band width is 0.25 buffers. Stops use nearby opposing structure with bounded risk distance. T1/T2 project 1.5R/2.5R from the conservative entry-band edge. These are this tool's strategy mappings, not original Chan rules for fixed targets or calibrated profit probabilities.`,
    statusReason: reasonEn(p.statusReason),
    ...(p.previousOutcome ? { previousOutcome: { ...p.previousOutcome, reason: reasonEn(p.previousOutcome.reason) } } : {}),
  };
}

function decisionEn(d: TradeDecision, plans: TradePlan[]): TradeDecision {
  if (!plans.length) return { ...d, title: 'Insufficient history', summary: 'At least three valid completed candles are needed to build a structure-based trade plan.' };
  const structureLabel=d.biasDirection==='long'?'Bullish structure':d.biasDirection==='short'?'Bearish structure':'No clear structural bias';
  if(d.state==='unavailable')return {...d,title:'Current plans ended',summary:'No plan remains waiting or under tracking. Later completed candles must establish a new plan.'};
  if(d.state==='conflict')return {...d,title:'No new direction',summary:'Direction is unclear. Previous plans remain available for review.'};
  if(d.state==='tracking') {
    const opposite=plans.find(p=>p.side!==d.direction);
    return {...d,title:`${d.direction==='long'?'Long':'Short'} plan triggered · tracking`,summary:`The ${d.direction} plan triggered earlier; continue tracking its original stop and targets. ${opposite?.status==='untriggered'?`The ${opposite.side} plan has not triggered and is waiting for its candle-close conditions.`:opposite?`The ${opposite.side} plan ended; there is no new opposite trigger.`:''}`.trim()};
  }
  if(d.state==='waiting'&&d.direction==='neutral')return {...d,title:'No new direction',summary:'Direction is unclear. Wait for later candles to finish and establish a clear signal.'};
  const waiting=plans.filter(p=>p.status==='untriggered');
  return {...d,title:`Waiting for candle-close confirmation · ${structureLabel}`,summary:`${waiting.length===2?'Neither plan has triggered':`The ${waiting[0]?.side??d.direction} plan has not triggered`}. A candle at the selected interval must finish with a closing price that crosses its trigger price and remains within the entry band before its status changes to triggered.`};
}

/** Localize display text without changing any prices, timestamps, IDs or model states. */
export function translateAnalysis(analysis: Analysis, language: AnalysisLanguage): Analysis {
  if (language === 'zh') return analysis;
  const extended = analysis as Analysis & { tradePlans?: TradePlan[]; decision?: TradeDecision };
  const tradePlans = extended.tradePlans?.map(planEn);
  const biasLabels: Record<string, string> = { '样本不足': 'Insufficient history', '结构偏多': 'Bullish structure', '结构偏空': 'Bearish structure', '结构均衡': 'Balanced structure' };
  const c = analysis.calibration;
  return {
    ...analysis,
    centers: analysis.centers.map(center => ({ ...center, level: center.level === '线段中枢' ? 'Segment center' : center.level })),
    signals: analysis.signals.map(signalEn),
    scenarios: analysis.scenarios.map(s => scenarioEn(s, analysis.scenarios)),
    tradeSetups: analysis.tradeSetups.map(setupEn),
    bias: { ...analysis.bias, label: biasLabels[analysis.bias.label] ?? analysis.bias.label, factors: analysis.bias.factors.map(factorEn) },
    calibration: { ...c, method: `Rolling prefixes; three-factor distance ≤1 across center position, confirmed stroke direction and VAcc velocity sign. Non-overlapping samples every ${c.horizon} bars. ${c.samples < 20 ? 'Fewer than 20 samples: descriptive only, with no future probability estimate.' : 'Historical frequencies without independent out-of-sample calibration.'} The interval is the 95% Wilson interval for the upward frequency.` },
    warnings: analysis.warnings.map(warningEn),
    ruleVersion: analysis.ruleVersion.replace('2007-09-18新笔', '2007-09-18 new-stroke rules').replace('第62课旧笔', 'lesson 62 old-stroke rules').replace('仅已收盘K线', 'closed bars only'),
    ...(tradePlans ? { tradePlans } : {}),
    ...(extended.decision ? { decision: decisionEn(extended.decision, tradePlans ?? []) } : {}),
  };
}
