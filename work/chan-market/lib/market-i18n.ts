type Language = 'zh' | 'en';

/** Keep numerical details, venue names and provider error codes in translated notices. */
const phrases: [string,string][] = [
  ['该标的在当前周期暂时没有可用历史行情。','No historical data is currently available for this instrument and timeframe.'],
  ['已使用东方财富美股公开行情源；公开网页接口可能限流或延迟。','Using Eastmoney public US stock data; public endpoints may be rate limited or delayed.'],
  ['已使用独立腾讯K线源；不同来源的历史和复权口径可能不同。','Using independent Tencent candles; history and adjustment conventions may differ between providers.'],
  ['已使用独立新浪OHLC行情源；历史长度取决于来源保留窗口。','Using independent Sina OHLC data; history is limited by the provider retention window.'],
  ['行情源限流，请稍后重试。','The data provider is rate limiting requests. Please retry shortly.'],
  ['行情源暂时无法连接或请求超时，请重试。','The data provider could not be reached or timed out. Please retry.'],
  ['行情源返回格式异常，未使用替代价格。','The provider returned an invalid format. No substitute prices were used.'],
  ['请选择 crypto、us 或 cn 市场。','Select the crypto, US or China market.'],
  ['不支持的K线周期。','This candle interval is not supported.'],
  ['该市场不提供所选K线周期。','This market does not provide the selected candle interval.'],
  ['4小时所需的真实子K线暂不可用，请稍后重试。','The actual lower-interval candles needed for 4-hour aggregation are unavailable. Please retry later.'],
  ['A股4小时按09:30–11:30、13:00–15:00累计4个交易小时，每个交易日一根，午休不计入。','China A-share 4-hour candles cover 09:30–11:30 and 13:00–15:00: four trading hours per day, excluding the lunch break.'],
  ['美股4小时按纽约正常交易时段聚合：09:30–13:30为4小时，13:30–16:00尾段为2.5小时，分别保留；不跨交易日，自动处理夏令时。','US 4-hour candles follow the New York regular session: 09:30–13:30 is four hours and the separate 13:30–16:00 final segment is 2.5 hours. Candles never span trading days; daylight saving time is handled automatically.'],
  ['聚合K线标记周期起点；仅使用同一来源真实子K线，全部子K收盘且覆盖完整后才确认，未完成尾部不参与收盘信号。','Aggregated candles are start-stamped and use actual lower-interval candles from one provider. Confirmation requires complete coverage and all child candles to close. Unfinished tails are excluded from close-based signals.'],
  ['提前收市或子K缺失导致覆盖不足的历史区间会跳过；不会补价或跨日拼成4小时。','Historical intervals with incomplete coverage because of early closes or missing child candles are skipped. Prices are never filled or joined across trading days to make four hours.'],
  ['请输入有效的现货交易对，例如 BTCUSDT。','Enter a valid spot pair, for example BTCUSDT.'],
  ['请输入现货交易对，例如 BTCUSDT。','Enter a spot pair, for example BTCUSDT.'],
  ['请输入美股代码，例如 AAPL、BRK-B。','Enter a US ticker, for example AAPL or BRK-B.'],
  ['请输入六位A股代码，或 600519.SH、000001.SZ、920599.BJ。','Enter a six-digit China A-share code, or 600519.SH, 000001.SZ or 920599.BJ.'],
  ['代码与沪、深、北交易所后缀不匹配。','The code does not match its Shanghai, Shenzhen or Beijing exchange suffix.'],
  ['在线标的搜索暂不可用。','Online symbol search is temporarily unavailable.'],
  ['搜索响应较慢，已显示当前可用结果；可选择该市场重试。','Search is responding slowly. Available results are shown; select this market to retry.'],
  ['跨市场搜索：输入股票名称、拼音、代码或加密货币名称。','Search all markets by company name, pinyin, ticker or cryptocurrency name.'],
  ['常用标的；输入代码或名称搜索更多。','Popular symbols. Enter a ticker or name to search for more.'],
  ['Yahoo搜索暂不可用，已切换腾讯美股搜索；支持范围取决于备用源收录。','Yahoo search is unavailable; Tencent US stock search is being used. Coverage depends on the fallback provider.'],
  ['在线搜索暂时不可用；仅显示匹配的常用标的或待行情核验的代码。','Online search is unavailable. Only matching popular symbols or codes awaiting data verification are shown.'],
  ['未找到有效OHLC行情，请核对标的或更换周期。','No valid OHLC data was found. Check the symbol or select another interval.'],
  ['未找到该美股标的。','This US symbol was not found.'],
  ['未找到该美股标的或该周期暂无数据。','This US symbol was not found, or this interval has no data.'],
  ['该代码不属于美股市场，请重新选择。','This ticker does not belong to the US market. Select another symbol.'],
  ['行情源缺少完整K线。','The provider did not return complete candle data.'],
  ['美股正常交易时段数据，不含盘前盘后；公开网页接口可能限流或延迟。','US regular-session data excludes pre-market and after-hours trading. Public feeds may be rate limited or delayed.'],
  ['最近K线保守延后15分钟确认；提前收市的日/周K可能延后标为完成。','Recent candles are confirmed with a conservative 15-minute delay. Daily or weekly candles on early-close days may be marked complete later.'],
  ['1分钟K线由真实分钟OHLC构成；Yahoo最多请求最近7天，页面仍受返回数量限制。','1-minute candles use actual minute OHLC. Yahoo requests cover at most the last 7 days, subject to the returned row limit.'],
  ['月线按纽约自然月聚合；当前月在进入下月后才标记已收盘。','Monthly candles follow New York calendar months. The current month is marked closed only after the next month begins.'],
  ['已排除行情源追加的日内报价或重复月份，月线仅使用已核验粒度的月首OHLC条目。','Appended intraday quotes and duplicate months were removed. Monthly candles use verified monthly OHLC entries only.'],
  ['已排除行情源追加的当日报价或重复周，周线仅使用已核验周粒度的OHLC条目。','Appended daily quotes and duplicate weeks were removed. Weekly candles use verified weekly OHLC entries only.'],
  ['可能延迟，非交易所直连 · America/New_York正常交易时段 · K线为周期起点','May be delayed; not a direct exchange feed · America/New_York regular session · Candles are start-stamped'],
  ['按调整后收盘价等比例调整OHLC（分红、拆股），成交量未调整','OHLC proportionally adjusted using adjusted close for dividends and splits; volume is unadjusted'],
  ['来源原始OHLC；拆股或其他公司行动可能影响历史比较','Original provider OHLC; splits or other corporate actions may affect historical comparisons'],
  ['Yahoo返回周期与月线不一致，未将季度数据作为月线使用。','Yahoo returned an interval other than monthly. Quarterly data was not used as monthly candles.'],
  ['月份按America/New_York交易日期，当前月进入下月后才标记已收盘。','Months follow America/New_York trading dates. The current month closes only after the next month begins.'],
  ['周按America/New_York交易日期，当前周在周五正常收盘加15分钟后才确认。','Weeks follow America/New_York trading dates. The current week is confirmed 15 minutes after the regular Friday close.'],
  ['Yahoo行情不可用，备用源未收录该美股代码；请核对代码或稍后重试。','Yahoo data is unavailable and the fallback provider does not list this US ticker. Check the code or retry later.'],
  ['备用行情源未返回该美股标的的有效数据。','The fallback provider returned no valid data for this US symbol.'],
  ['Yahoo行情暂不可用，已切换东方财富美股备用源；公开网页接口可能限流或延迟。','Yahoo data is unavailable; the Eastmoney US fallback feed is being used. Public feeds may be rate limited or delayed.'],
  ['备用源采用不复权价格，除权除息和拆股可能影响结构；不同来源结果可能不同。','The fallback feed uses unadjusted prices. Dividends and splits may affect structures, and results may differ between providers.'],
  ['仅正常交易时段；最近K线延后15分钟确认。','Regular session only; recent candles are confirmed after a 15-minute delay.'],
  ['分钟K线保留源时间标记（周期结束），已转换为UTC；纽约时区筛选正常交易时段，免费历史窗口有限。','Minute candles retain provider end timestamps, converted to UTC. Regular sessions are filtered in New York time. Free history is limited.'],
  ['备用源1分钟真实OHLC仅覆盖最近一个交易日；不会把只有收盘价的分时数据伪造成K线。','Fallback 1-minute OHLC covers the latest trading day only. Candles are not fabricated from close-only quotes.'],
  ['延迟行情，非交易所直连 · America/New_York正常交易时段 · 分钟K线为周期结束','Delayed public data; not a direct exchange feed · America/New_York regular session · Minute candles are end-stamped'],
  ['A股主行情源及独立备用源暂不可用，请稍后重试。','The primary and independent fallback China A-share feeds are unavailable. Please retry later.'],
  ['未找到该A股标的或该周期暂无行情。','This China A-share symbol was not found, or this interval has no data.'],
  ['A股展示看多/看空倾向；看空信号不代表该标的可以直接卖空。','China A-share signals indicate bullish or bearish bias. A bearish signal does not mean the stock can be shorted directly.'],
  ['不复权历史包含除权除息跳空，可能影响分型和背驰比较。','Unadjusted history includes ex-dividend and corporate-action gaps, which may affect fractals and divergence comparisons.'],
  ['免费分钟K线历史窗口有限；时间标记为周期结束，成交量已由手换算为股。','Free minute history is limited. Timestamps mark interval end; volume is converted from lots to shares.'],
  ['1分钟真实OHLC仅覆盖最近一个交易日；刚开盘时结构样本较少。','Actual 1-minute OHLC covers the latest trading day only. Early-session structure samples may be small.'],
  ['月线按上海自然月聚合；当前月在进入下月后才标记已收盘。','Monthly candles follow Shanghai calendar months. The current month is marked closed only after the next month begins.'],
  ['可能延迟，非交易所直连 · Asia/Shanghai · 仅交易时段','May be delayed; not a direct exchange feed · Asia/Shanghai · Trading sessions only'],
  ['不复权（原始价格）；成交量单位：股','Unadjusted original prices; volume in shares'],
  ['腾讯备用源暂无该标的K线。','The Tencent fallback feed has no candles for this symbol.'],
  ['东方财富连接失败，已使用独立腾讯K线源；不同来源的历史和复权口径可能不同。','Eastmoney could not be reached; the independent Tencent candle feed is being used. History and adjustment methods may differ by provider.'],
  ['A股看空不代表可以直接卖空。','A bearish China A-share signal does not imply direct short-selling is available.'],
  ['腾讯分钟K线保留源周期结束时间；分钟历史的复权口径未独立核验。','Tencent minute candles retain interval-end timestamps. Historical minute adjustment methods have not been independently verified.'],
  ['当前月在进入上海时区下月后才标记已收盘。','The current month is marked closed only after the next month begins in Shanghai time.'],
  ['公开网页行情可能延迟 · Asia/Shanghai · 分钟K线标记周期结束','Public web data may be delayed · Asia/Shanghai · Minute candles are end-stamped'],
  ['不复权（日/周/月原始价格）；成交量单位：股','Unadjusted daily/weekly/monthly prices; volume in shares'],
  ['来源分钟OHLC（复权口径未独立核验）；成交量单位：股','Provider minute OHLC; adjustment method not independently verified; volume in shares'],
  ['新浪备用源返回格式异常。','The Sina fallback feed returned an invalid format.'],
  ['新浪备用源暂无该标的数据。','The Sina fallback feed has no data for this symbol.'],
  ['东方财富连接失败，已使用独立新浪OHLC行情源；不会从单一分时收盘价伪造蜡烛。','Eastmoney could not be reached; the independent Sina OHLC feed is being used. Candles are not fabricated from close-only quotes.'],
  ['按新浪真实日OHLC聚合，已丢弃起始不完整周期；日线入库可能滞后，最新交易日可能尚未包含。','Aggregated from actual Sina daily OHLC, excluding the first incomplete period. Daily updates may lag and omit the latest trading day.'],
  ['新浪日线可能只更新到上一个已完成交易日，请核对图表末端时间。','Sina daily data may end at the previous completed trading day. Check the last chart timestamp.'],
  ['来源原始OHLC（未请求复权）；成交量单位：股','Original provider OHLC; no adjustment requested; volume in shares'],
  ['该独立备用源仅用于原生月线。','This independent fallback feed is used for native monthly candles only.'],
  ['Bybit 月线响应的现货交易对不匹配。','The Bybit monthly response does not match the requested spot pair.'],
  ['Kraken 行情响应缺少唯一交易对。','The Kraken response did not contain one unique trading pair.'],
  ['不支持该加密货币周期。','This cryptocurrency candle interval is not supported.'],
  ['现货数据来自页面标明的交易所；不同交易所价格、成交量和结构可能不同。','Spot data comes from the exchange shown on the page. Prices, volumes and structures may differ between exchanges.'],
  ['Kraken单周期只提供最近约720根；其最后一根按未收盘处理。','Kraken provides approximately the latest 720 candles per interval. Its last candle is treated as open.'],
  ['月线由Kraken日线按UTC自然月合成，截断首月与缺日历史月已排除，历史长度受日线窗口限制。','Monthly candles are aggregated from Kraken daily OHLC by UTC calendar month. Truncated first months and historical months with missing days are excluded; history is limited by the daily window.'],
  ['使用交易所原生UTC自然月OHLC；当前月未收盘，已排除出已确认结构。历史不与其他交易所拼接。','Uses native exchange OHLC for UTC calendar months. The open current month is excluded from confirmed structures. History is not spliced with other exchanges.'],
  ['交易所公开行情 · 自动刷新取数，非逐笔推送 · 时间为周期开盘时间','Public exchange data · Automatically refreshed, not tick streaming · Timestamps mark interval start'],
  ['原始成交价格，不复权','Original trade prices, unadjusted'],
  ['当前无法连接现货目录，请稍后重试。','Spot symbol directories cannot be reached. Please retry later.'],
  ['搜索内容最多60个字符。','Search queries are limited to 60 characters.'],
  ['缺少标的代码。','The symbol code is missing.'],
  // Composable fragments cover provider prefixes and grouped search/failover warnings.
  ['1小时聚合4小时','4-hour candles aggregated from 1-hour OHLC'],
  ['30分钟聚合4小时','4-hour candles aggregated from 30-minute OHLC'],
  ['聚合K线为周期起点','Aggregated candles are start-stamped'],
  ['可能延迟，非交易所直连','May be delayed; not a direct exchange feed'],
  ['延迟行情，非交易所直连','Delayed public data; not a direct exchange feed'],
  ['公开网页行情可能延迟','Public web data may be delayed'],
  ['腾讯证券 原生美股周K','Tencent Securities native US weekly candles'],
  ['腾讯证券 原生美股月K','Tencent Securities native US monthly candles'],
  ['腾讯证券 K线（独立备用）','Tencent Securities candles (independent fallback)'],
  ['新浪财经 OHLC（独立备用）','Sina Finance OHLC (independent fallback)'],
  ['东方财富 美股网页行情（备用）','Eastmoney US public feed (fallback)'],
  ['东方财富 网页行情','Eastmoney public feed'],
  ['Yahoo Finance 网页行情','Yahoo Finance public feed'],
  ['公共现货行情','public spot feed'],
  ['暂不可用，正在切换独立行情源','is unavailable; switching to an independent feed'],
  ['返回的时间不是UTC月首，未作为月线使用','returned timestamps other than UTC month starts; data was not used as monthly candles'],
  ['连接超时或数据格式异常','connection timed out or response format was invalid'],
  ['现货目录暂不可用','spot directory is unavailable'],
  ['未返回有效现货目录','returned no valid spot directory'],
  ['未返回有效K线','returned no valid candles'],
  ['未收录该交易对','does not list this trading pair'],
  ['已自动切换行情源','Automatically switched data provider'],
  ['现货行情暂不可用','Spot data is unavailable'],
  ['行情源返回 HTTP','The data provider returned HTTP'],
  ['返回 HTTP','returned HTTP'],
  ['请稍后重试','Please retry later'],
  ['搜索暂不可用',' search is unavailable'],
  ['行情暂不可用','Market data is unavailable'],
  ['请求已取消','Request cancelled'],
  ['待行情源确认','Awaiting provider verification'],
  ['代码查询','Code lookup'],
  ['暂不可用','is unavailable'],
  ['加密货币','Cryptocurrency'],
  ['美股','US equities'],
  ['A股','China A-shares'],
  ['上交所','Shanghai Stock Exchange'],
  ['深交所','Shenzhen Stock Exchange'],
  ['北交所','Beijing Stock Exchange'],
  ['东方财富','Eastmoney'],
  ['腾讯','Tencent'],
  ['新浪','Sina'],
].sort((a,b)=>b[0].length-a[0].length) as [string,string][];

const period = (label: string) => label === '周' ? 'weekly' : 'monthly';

const hiddenVenue = /^(?:binance|okx|币安|欧易)$/i;

/** Append the separator only when there is a venue to show. */
export function marketVenueSuffix(venue: string | undefined, language: Language): string {
  const name = typeof venue === 'string' ? venue.trim() : '';
  return name && !hiddenVenue.test(name) ? ` · ${translateMarketText(name, language)}` : '';
}

/** Format UI copy without changing the provider identity used by data and analysis. */
export function marketDisplayText(text: string, language: Language): string {
  const value = translateMarketText(text, language);
  return value
    .replace(/(?:\b(?:binance|okx)\b|币安|欧易)\s+(?=公共现货行情|public spot feed)/gi, '')
    .replace(/(?:https?:\/\/)?(?:[\w-]+\.)*(?:binance\.(?:vision|com|us)|okx\.com)\b(?:\/[\w./?&=%-]*)?|\b(?:binance|okx)\b|币安|欧易/gi,
      language === 'zh' ? '行情源' : 'data provider')
    .replace('现货数据来自页面标明的交易所；', '')
    .replace('Spot data comes from the exchange shown on the page. ', '');
}

/** After all attempts settle, describe the result once, including distinct HTTP codes if available. */
export function marketLoadErrorText(message: string, language: Language): string {
  const zh = language === 'zh';
  if (message.startsWith('现货行情暂不可用')) {
    const reasons = message.replace(/^现货行情暂不可用[：:]\s*/, '').split('；');
    if (reasons.every(reason => reason.includes('未收录该交易对'))) {
      return zh ? '所查询的行情源均未收录这个交易对。' : 'None of the queried providers lists this trading pair.';
    }
    const codes = [...new Set(message.match(/HTTP\s+\d{3}/gi) ?? [])].join(', ');
    if (codes) {
      return zh ? `暂未取得该周期的现货K线。行情源返回 ${codes}。` : `Spot candles are unavailable for this timeframe. Provider response: ${codes}.`;
    }
    return zh ? '行情源暂未提供这个周期的现货K线。' : 'Spot candles are temporarily unavailable for this timeframe.';
  }
  if (/^(failed to fetch|fetch failed|load failed|networkerror|network request failed)/i.test(message)) {
    return zh ? '未能连接行情服务。' : 'Could not connect to the market data service.';
  }
  if (/^(timeout(error)?\b|the operation (was aborted due to timeout|timed out))|signal timed out/i.test(message)) {
    return zh ? '行情请求超时。' : 'The market data request timed out.';
  }
  return marketDisplayText(message, language);
}

/** Company names are identifiers: never invent English names for arbitrary search results. */
export function translateInstrumentName(name: string, language: Language): string {
  if (language === 'zh') return name;
  const names: Record<string,string> = {
    '比特币 Bitcoin': 'Bitcoin', '以太坊 Ethereum': 'Ethereum', '狗狗币 Dogecoin': 'Dogecoin',
    '苹果 Apple': 'Apple', '微软 Microsoft': 'Microsoft', '英伟达 NVIDIA': 'NVIDIA',
    '特斯拉 Tesla': 'Tesla', '亚马逊 Amazon': 'Amazon', '谷歌 Alphabet': 'Alphabet',
    '标普500 ETF': 'S&P 500 ETF', '纳斯达克100 ETF': 'Nasdaq 100 ETF',
  };
  return names[name] || name;
}

export function translateMarketText(text: string, language: Language): string {
  if (language === 'zh' || !text) return text;
  let value = text
    .replace(/已跳过(\d+)个覆盖不完整的历史区间或缺口区间。/g, 'Skipped $1 historical or gapped intervals with incomplete coverage.')
    .replace(/4小时有效K线仅(\d+)根，受来源分钟历史窗口限制，统计样本可能不足。/g, 'Only $1 valid 4-hour candles are available within the provider\'s intraday history window; the statistical sample may be insufficient.')
    .replace(/历史K线不足(\d+)根，暂不能进行结构分析。/g, 'Fewer than $1 historical candles are available; structure analysis cannot run yet.')
    .replace(/本次仅取得(\d+)根K线，结构与统计样本可能不足。/g, 'Only $1 candles were returned; structure and statistical samples may be insufficient.')
    .replace(/该周期仅有(\d+)根有效K线，统计样本可能不足。/g, 'Only $1 valid candles are available for this interval; the statistical sample may be insufficient.')
    .replace(/行情源本次仅返回(\d+)根K线，历史统计样本可能不足。/g, 'The provider returned only $1 candles; the historical sample may be insufficient.')
    .replace(/备用源返回(\d+)根K线，统计样本可能不足。/g, 'The fallback feed returned $1 candles; the statistical sample may be insufficient.')
    .replace(/Yahoo实际周期([^，]+)与请求的([^，]+)不一致，已拒绝错周期数据。/g, (_all,actual,requested)=>`Yahoo returned ${actual==='未知'?'an unknown interval':actual}, not the requested ${requested}. The mismatched data was rejected.`)
    .replace(/腾讯([周月])线源未收录该美股代码。/g, (_all,label)=>`The Tencent ${period(label)} feed does not list this US ticker.`)
    .replace(/腾讯([周月])线源不支持该交易所。/g, (_all,label)=>`The Tencent ${period(label)} feed does not support this exchange.`)
    .replace(/腾讯([周月])线源未返回完整[周月]OHLC。/g, (_all,label)=>`The Tencent ${period(label)} feed returned incomplete OHLC.`)
    .replace(/腾讯([周月])线源返回重复周期，未用于结构分析。/g, (_all,label)=>`The Tencent ${period(label)} feed returned duplicate periods; it was excluded from structure analysis.`)
    .replace(/美股([周月])线使用腾讯原生[周月]OHLC；不复权历史的拆股和分红可能影响结构，请与其他周期的复权口径对照。/g, (_all,label)=>`US ${period(label)} candles use native Tencent OHLC. Splits and dividends in unadjusted history may affect structures; compare adjustment methods with other intervals.`)
    .replace(/公开网页行情可能延迟，([周月])线时间标记为源最后交易日。/g, (_all,label)=>`Public data may be delayed. ${period(label)} timestamps mark the provider's last trading day of the period.`)
    .replace(/([周月])线源本次返回(\d+)根，历史统计样本可能不足。/g, (_all,label,count)=>`The ${period(label)} feed returned ${count} candles; the historical sample may be insufficient.`)
    .replace(/公开([周月])OHLC行情可能延迟 · America\/New_York · 周期内最后交易日时间标记/g, (_all,label)=>`Public ${period(label)} OHLC may be delayed · America/New_York · Timestamps mark the last trading day of each period`)
    .replace(/不复权（([周月])度原始OHLC）；成交量单位：股/g, (_all,label)=>`Unadjusted original ${period(label)} OHLC; volume in shares`)
    .replace(/当前使用 ([\w]+) 的 ([\w/.-]+) 现货；保留相同报价币，没有使用USD替代USDT。/g, 'Using $1 spot data for $2. The quote currency is preserved; USD is not substituted for USDT.')
    .replace(/(Bitget|OKX|Kraken) 暂无 ([\w/.-]+) 的原生月线。/g, '$1 has no native monthly candles for $2.')
    .replace(/(Bitget|OKX|Kraken) 暂无 ([\w/.-]+) 的该周期数据。/g, '$1 has no data for $2 at this interval.');
  for (const [zh,en] of phrases) value=value.split(zh).join(en);
  value=value.replace(/。/g,'. ').replace(/；/g,'; ').replace(/：/g,': ').replace(/，/g,', ').replace(/（/g,' (').replace(/）/g,')').replace(/、/g,', ').replace(/\s+/g,' ').trim();
  if (/\p{Script=Han}/u.test(value)) {
    // Unexpected upstream text remains explicitly untranslated rather than silently mistranslated.
    const identifiers=value.match(/[A-Za-z0-9][A-Za-z0-9_./:+%-]*/g)?.join(' ');
    return `Provider message could not be translated.${identifiers ? ` Details: ${identifiers}` : ''}`;
  }
  return value;
}
