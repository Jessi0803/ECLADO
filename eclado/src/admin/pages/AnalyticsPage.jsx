import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StatCard } from '../components/DashboardWidgets.jsx';
import { fetchAdminAnalytics } from '../../services/adminAnalytics.js';
import { maximumEndDate, periodBuckets, presetRange, productRanking, rangeError } from '../domain/analyticsPeriod.js';
import './AnalyticsPage.css';

const money = value => `NT$ ${Number(value).toLocaleString('zh-TW')}`;
const periodLabel = row => row.start === row.end ? row.start : `${row.start} ～ ${row.end}`;
const MEMBER_GROUPS = [
  ['guest','訪客','#8a929b'], ['consumer','一般會員','#587994'], ['pro','美容師','#b59151'],
  ['instructor','師資','#577e6b'], ['distributor','經銷商','#87739c'], ['staff','內部人員','#ba7a61'], ['other','其他／未記錄','#77736b'],
];

export default function Analytics() {
  const [draft, setDraft] = useState(() => presetRange('month'));
  const [query, setQuery] = useState(() => ({ ...presetRange('month'), version: 0 }));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [validation, setValidation] = useState('');
  const [interval, setInterval] = useState('day');
  const [showEmptyPeriods, setShowEmptyPeriods] = useState(false);
  const [memberChart, setMemberChart] = useState(() => window.matchMedia('(max-width: 900px)').matches ? 'pie' : 'bar');
  const [mode, setMode] = useState('product');
  const [scope, setScope] = useState('all');
  const request = useRef(0);
  useEffect(() => {
    const id = ++request.current;
    setLoading(true); setError(''); setData(null); setScope('all');
    fetchAdminAnalytics(query.start, query.end).then(result => {
      if (id === request.current) setData(result);
    }).catch(err => {
      if (id === request.current) setError(`無法載入營業分析：${err.message || '請稍後重試'}`);
    }).finally(() => { if (id === request.current) setLoading(false); });
    return () => { request.current += 1; };
  }, [query]);
  const buckets = useMemo(() => periodBuckets(data, interval), [data, interval]);
  const emptyPeriodCount = buckets.filter(row => row.orders === 0).length;
  const detailRows = showEmptyPeriods ? buckets : buckets.filter(row => row.orders > 0);
  const selectedBucket = buckets.find(row => row.key === scope) || null;
  const ranking = useMemo(() => productRanking(data, mode, selectedBucket), [data, mode, selectedBucket]);
  const summary = (data?.daily || []).reduce((sum,row) => ({ revenue: sum.revenue + Number(row.revenue), orders: sum.orders + Number(row.orders) }), { revenue: 0, orders: 0 });
  const quantities = (data?.productSales || []).reduce((sum,row) => ({ quantity: sum.quantity + Number(row.quantity), gifts: sum.gifts + Number(row.gifts) }), { quantity: 0, gifts: 0 });
  const rankedTotal = ranking.reduce((sum,row) => sum + row.quantity, 0);
  const maxRevenue = Math.max(1, ...buckets.map(row => row.revenue));
  const memberRevenue = MEMBER_GROUPS.map(([role,label,color]) => ({ role,label,color,
    ...(data?.memberRevenue || []).find(row => row.role === role),
  })).map(row => ({ ...row,revenue:Number(row.revenue) || 0,orders:Number(row.orders) || 0 }))
    .filter(row => row.role !== 'other' || row.orders > 0);
  const maxMemberRevenue = Math.max(1,...memberRevenue.map(row => row.revenue));
  let pieEnd = 0;
  const pieStops = memberRevenue.filter(row => row.revenue > 0).map(row => {
    const start = pieEnd;
    pieEnd += row.revenue / (summary.revenue || 1) * 100;
    return `${row.color} ${start}% ${pieEnd}%`;
  });
  function submit(event) {
    event.preventDefault();
    const message = rangeError(draft.start, draft.end);
    if (message) { setValidation(message); return; }
    setValidation(''); setQuery({ ...draft, version: query.version + 1 });
  }
  function preset(value) {
    const range = presetRange(value);
    setDraft(range); setValidation(''); setQuery({ ...range, version: query.version + 1 });
  }
  return <div className="analytics-page">
    <h1>營業分析</h1>
    <p className="analytics-note">依下單日期統計，僅計入目前已付款及後續履約狀態；排除未付款、取消與歷史補登。日期以台灣時間計算，包含結束日整天。</p>
    <section className="analytics-panel" aria-label="查詢條件">
      <form onSubmit={submit} className="analytics-controls" noValidate>
        <label>開始日期<input type="date" required value={draft.start} onChange={e => setDraft({ ...draft, start: e.target.value })} /></label>
        <label>結束日期<input type="date" required min={draft.start || undefined} max={maximumEndDate(draft.start) || undefined} value={draft.end} onChange={e => setDraft({ ...draft, end: e.target.value })} /></label>
        <button type="submit">查詢</button>
      </form>
      <p className="analytics-note">每次查詢最多一年，包含開始與結束日期。</p>
      <div className="analytics-presets">{[['month','本月'],['lastMonth','上月'],['30days','近 30 天'],['6months','近半年']].map(([key,label]) => <button type="button" key={key} onClick={() => preset(key)}>{label}</button>)}</div>
      {validation && <p role="alert">{validation}</p>}
    </section>
    {loading && <p role="status">載入營業分析中…</p>}
    {error && <div role="alert"><p>{error}</p><button onClick={() => setQuery({ ...query, version: query.version + 1 })}>重新載入</button></div>}
    {data && !loading && <>
      <p className="analytics-note">查詢期間：{data.startDate} ～ {data.endDate}（依目前付款狀態更新；後續付款可能使數字增加）</p>
      <div className="analytics-stats">
        <StatCard label="期間營業額" value={money(summary.revenue)} sub="沿用訂單總額（含運費）" icon="◐" />
        <StatCard label="有效訂單數" value={summary.orders} sub="已付款及後續履約訂單" icon="◫" />
        <StatCard label="平均客單價" value={money(summary.orders ? Math.round(summary.revenue / summary.orders) : 0)} sub="期間營業額 ÷ 有效訂單數" icon="◈" />
        <StatCard label="商品銷售數量" value={quantities.quantity} sub={`另贈送 ${quantities.gifts} 件，不計入銷售排行`} icon="◧" />
      </div>
      {summary.orders === 0 && <p role="status">此期間沒有符合條件的銷售訂單。</p>}
      <section className="analytics-panel" aria-label="會員身分營收分布">
        <div className="analytics-section-header">
          <h2>會員身分營收分布</h2>
          <div className="analytics-chart-toggle" role="group" aria-label="會員營收圖表類型">
            <button type="button" aria-pressed={memberChart === 'pie'} onClick={() => setMemberChart('pie')}>圓餅圖</button>
            <button type="button" aria-pressed={memberChart === 'bar'} onClick={() => setMemberChart('bar')}>柱狀圖</button>
          </div>
        </div>
        <p className="analytics-note">查看所選期間各會員身分的消費金額與占比。</p>
        {memberChart === 'pie' ? <div className="analytics-member-pie-layout">
          <div className="analytics-member-pie" role="img" aria-label={summary.revenue ? `會員身分營收圓餅圖，總營業額 ${money(summary.revenue)}` : '此期間沒有營收'} style={{background:pieStops.length ? `conic-gradient(${pieStops.join(',')})` : 'var(--light)'}}>
            {!summary.revenue && <span>尚無營收</span>}
          </div>
          <div className="analytics-member-pie-legend">{memberRevenue.map(row => <div key={row.role} aria-label={`${row.label}：${money(row.revenue)}，${row.orders} 筆訂單`}>
            <span><i style={{background:row.color}} />{row.label}</span><strong>{money(row.revenue)}</strong>
            <small>{row.orders} 筆訂單</small><small>{summary.revenue ? (row.revenue/summary.revenue*100).toFixed(1) : '0.0'}%</small>
          </div>)}</div>
        </div> : <div className="analytics-chart-scroll"><div className="analytics-member-chart">
          {memberRevenue.map(row => <div className="analytics-member-column" key={row.role} aria-label={`${row.label}：${money(row.revenue)}，${row.orders} 筆訂單`}>
            <div className="analytics-member-bar-area"><strong>{money(row.revenue)}</strong><div style={{ height:row.revenue > 0 ? Math.max(2,row.revenue/maxMemberRevenue*150) : 0,background:row.color }} /></div>
            <span><i style={{background:row.color}} />{row.label}</span>
            <small>{row.orders} 筆 · {summary.revenue ? (row.revenue/summary.revenue*100).toFixed(1) : '0.0'}%</small>
          </div>)}
        </div></div>}
      </section>
      <section className="analytics-panel">
        <div className="analytics-section-header"><h2>營業額趨勢</h2><label>檢視方式<select value={interval} onChange={e => { setInterval(e.target.value); setScope('all'); }}><option value="day">每日</option><option value="month">每月</option></select></label></div>
        <div className="analytics-chart-scroll"><div className="analytics-chart" style={{ minWidth: Math.max(260,buckets.length * 72) }}>
          {buckets.map(row => <div className="analytics-bar-column" key={row.key} title={`${periodLabel(row)}：${money(row.revenue)}${MEMBER_GROUPS.filter(([role]) => row.byRole[role] > 0).map(([role,label]) => `\n${label}：${money(row.byRole[role])}`).join('')}`}>
            <span>{money(row.revenue)}</span><div className="analytics-bar analytics-stacked-bar" role="img" aria-label={`${periodLabel(row)}，總營業額 ${money(row.revenue)}`} style={{ height: row.revenue ? Math.max(2,row.revenue/maxRevenue*150) : 0 }}>
              {MEMBER_GROUPS.filter(([role]) => row.byRole[role] > 0).map(([role,label,color]) => <div key={role} data-member-role={role} title={`${label}：${money(row.byRole[role])}`} style={{height:`${row.byRole[role]/row.revenue*100}%`,background:color}} />)}
            </div><span>{row.key}</span>
          </div>)}
        </div></div>
        <div className="analytics-chart-legend">{memberRevenue.map(row => <span key={row.role}><i style={{background:row.color}} />{row.label}</span>)}</div>
        <div className="analytics-detail-controls">
          <label><input type="checkbox" checked={showEmptyPeriods} onChange={e => setShowEmptyPeriods(e.target.checked)} />顯示無訂單日期</label>
          {!showEmptyPeriods && emptyPeriodCount > 0 && <span className="analytics-note">已隱藏 {emptyPeriodCount} 個無訂單{interval === 'month' ? '月份' : '日期'}</span>}
        </div>
        <div className="table-scroll"><table aria-label="營業額明細"><thead><tr>{['期間','總營業額','院線營業額','一般消費','訂單數','平均客單'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
          {detailRows.map(row => <tr key={row.key}><td>{periodLabel(row)}</td><td>{money(row.revenue)}</td><td>{money(row.proRevenue)}</td><td>{money(row.revenue-row.proRevenue)}</td><td>{row.orders}</td><td>{money(row.orders ? Math.round(row.revenue/row.orders) : 0)}</td></tr>)}
          {!detailRows.length && <tr><td colSpan={6}>此期間沒有符合條件的訂單，可勾選「顯示無訂單日期」查看完整明細。</td></tr>}
        </tbody></table></div>
      </section>
      <section className="analytics-panel">
        <div className="analytics-section-header"><h2>商品銷售排行</h2><div className="analytics-controls">
          <label>商品統計方式<select value={mode} onChange={e => setMode(e.target.value)}><option value="product">依商品合併</option><option value="variant">依規格拆分</option></select></label>
          <label>排行範圍<select value={scope} onChange={e => setScope(e.target.value)}><option value="all">整段期間</option>{buckets.map(row => <option key={row.key} value={row.key}>{periodLabel(row)}</option>)}</select></label>
        </div></div>
        <p className="analytics-note">{selectedBucket ? periodLabel(selectedBucket) : `${data.startDate} ～ ${data.endDate}`} · 依銷售件數排序；贈品另計。已下架商品保留，缺少規格的舊訂單顯示「未記錄規格」。</p>
        <div className="table-scroll"><table><thead><tr>{['排名','商品名稱','規格','銷售數量','銷售件數占比'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
          {ranking.map((row,index) => <tr key={row.key}><td>{index+1}</td><td>{row.name}</td><td>{row.size}</td><td>{row.quantity}</td><td>{(row.quantity/rankedTotal*100).toFixed(1)}%</td></tr>)}
          {!ranking.length && <tr><td colSpan={5}>此期間沒有商品銷售紀錄。</td></tr>}
        </tbody></table></div>
      </section>
    </>}
  </div>;
}
