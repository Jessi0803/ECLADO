import React, { useEffect, useState } from 'react';
import { supabase } from '../../services/supabase.js';

const taipeiTime = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short' });
const currency = new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2 });
const unitCurrency = new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD',
  currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 6 });
const PENDING_REASONS = {
  layer_shortage: '成本層不足', unknown_cost: '單位成本未知', unmapped_variant: '商品規格待確認',
  late_event: '異動時間待核對', processing: '背景處理中',
};
const amount = value => currency.format(Number(value ?? 0));

export default function ProductCostReport({ from, to, canApprove }) {
  const [revision, setRevision] = useState(0);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [approval, setApproval] = useState(null);
  const [approvalError, setApprovalError] = useState('');
  const [approving, setApproving] = useState(false);
  const [notice, setNotice] = useState('');

  function openApproval(item) {
    setApproval({ item, cost: String(item.suggested_unit_cost_twd ?? ''), evidence: '' });
    setApprovalError('');
    setNotice('');
  }

  async function approve(event) {
    event.preventDefault();
    if (approving) return;
    setApproving(true);
    setApprovalError('');
    try {
      const { error: failure } = await supabase.rpc('approve_product_cost_estimate', {
        p_entry_id: approval.item.entry_id, p_unit_cost_twd: approval.cost, p_evidence: approval.evidence.trim(),
      });
      if (failure) throw failure;
      setApproval(null);
      setNotice('已採用估列成本。');
      setRevision(current => current + 1);
    } catch (failure) {
      setApprovalError(failure.message || '無法核准估列。');
    } finally {
      setApproving(false);
    }
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    supabase.rpc('get_product_cost_summary', { p_from: from, p_to: to })
      .then(({ data, error: failure }) => {
        if (!active) return;
        setSummary(failure ? null : data);
        setError(failure?.message || '');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, to, revision]);

  return (
    <div className="product-cost-report">
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">載入營運成本中…</p>}
      {!loading && error && <div className="procurement-error" role="alert">{error}</div>}
      {!loading && summary && !summary.started_at && <p className="procurement-form-card">尚未建立期初成本。</p>}
      {!loading && summary?.started_at && (
        <section className="procurement-section-card" aria-label="已售產品成本">
          <div className="analytics-section-header product-cost-report-heading">
            <div className="analytics-section-copy">
              <h2>已售產品成本</h2>
              <p className="analytics-note">出貨與自取按交付日期統計，退貨沖回按回倉日期統計。</p>
              <div className="product-cost-report-times">
                <p>期初起算時間 {taipeiTime.format(new Date(summary.started_at))}</p>
                <p>{summary.processed_through
                  ? `背景已處理至 ${taipeiTime.format(new Date(summary.processed_through))}`
                  : '背景尚未完成第一次計算。'}</p>
              </div>
            </div>
          </div>
          <div className="procurement-detail-financials">
            <div><span>出貨成本</span><strong>{amount(summary.shipment_cost)}</strong></div>
            <div><span>退貨成本沖回</span><strong>{amount(summary.return_cost)}</strong></div>
            <div><span>{summary.pending_quantity > 0 ? '淨額（已知小計）' : '已售產品成本淨額'}</span>
              <strong>{amount(Number(summary.shipment_cost) - Number(summary.return_cost))}</strong></div>
          </div>
          {(Number(summary.estimated_cost) !== 0 || summary.approved_items?.length > 0) && <p className="analytics-note product-cost-estimate-note">淨額含估列成本 {amount(summary.estimated_cost)}。</p>}
          {summary.pending_quantity > 0 && <p role="status">
            {summary.pending_orders} 張訂單、{summary.pending_quantity} 件成本待確認
            {summary.shortage_quantity > 0 && `，其中 ${summary.shortage_quantity} 件成本層不足`}
            {summary.unknown_quantity > 0 && `、${summary.unknown_quantity} 件缺少單位成本`}。
          </p>}
          {summary.pending_items?.length > 0 && (
            <details className="procurement-receiving-progress">
              <summary>查看成本待確認明細（最多 50 筆）</summary>
              <div className="table-scroll">
                <table className="responsive-admin-table procurement-items-table">
                  <thead><tr><th>訂單</th><th>品項</th><th>數量</th><th>原因</th><th>預估單位成本</th>{canApprove && <th>操作</th>}</tr></thead>
                  <tbody>{summary.pending_items.map((item, index) => (
                    <tr key={`${item.order_id}-${item.line_index}-${item.kind}-${item.reason}-${index}`}>
                      <td data-label="訂單">{item.order_id}</td>
                      <td data-label="品項">第 {item.line_index + 1} 項{item.kind === 'return' ? '（退貨）' : ''}</td>
                      <td data-label="數量">{item.quantity} 件</td>
                      <td data-label="原因">{PENDING_REASONS[item.reason] || '待確認'}</td>
                      <td data-label="預估單位成本">
                        {item.suggested_unit_cost_twd != null ? <>
                          {unitCurrency.format(item.suggested_unit_cost_twd)}
                          <small>參考入庫單 #{item.reference_receipt_no} · {item.reference_received_on}</small>
                        </> : '—'}
                      </td>
                      {canApprove && <td data-label="操作">{item.can_estimate && (
                        <button className="admin-secondary-btn" type="button" disabled={approving}
                          onClick={() => openApproval(item)}>核准估列</button>
                      )}</td>}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </details>
          )}
          {approval && (
            <form className="procurement-form-card" aria-label="核准估列成本" onSubmit={approve}>
              <div className="procurement-section-heading">
                <div>
                  <h2>核准估列成本</h2>
                  <p>{approval.item.order_id} · 第 {approval.item.line_index + 1} 項 · {approval.item.quantity} 件</p>
                  {approval.item.reference_receipt_no && <p>參考入庫單 #{approval.item.reference_receipt_no}
                    {' · '}{approval.item.reference_received_on} · 每件 {unitCurrency.format(approval.item.suggested_unit_cost_twd)}</p>}
                </div>
              </div>
              <div className="procurement-form-grid">
                <label>台幣單位成本
                  <input type="number" required min="0" step="0.000001" value={approval.cost} disabled={approving}
                    onChange={event => setApproval({ ...approval, cost: event.target.value })} />
                </label>
                <label>核准依據（選填）
                  <input maxLength={500} value={approval.evidence} disabled={approving}
                    onChange={event => setApproval({ ...approval, evidence: event.target.value })} />
                </label>
              </div>
              {approvalError && <p role="alert" className="procurement-error">{approvalError}</p>}
              <div className="procurement-header-actions" style={{ marginTop: 12 }}>
                <p>本次納入報表 {approval.cost === '' ? '—' : amount(Number(approval.cost) * approval.item.quantity)}</p>
                <button type="button" className="admin-secondary-btn" disabled={approving} onClick={() => setApproval(null)}>取消</button>
                <button className="admin-primary-btn" disabled={approving}>{approving ? '核准中…' : '確認核准估列'}</button>
              </div>
            </form>
          )}
          {summary.approved_items?.length > 0 && (
            <details className="procurement-receiving-progress">
              <summary>已採用估列（最多 50 筆）</summary>
              <div className="table-scroll">
                <table className="responsive-admin-table procurement-items-table">
                  <thead><tr><th>訂單</th><th>估列金額</th><th>核准依據</th><th>參考入庫單</th><th>核准時間</th></tr></thead>
                  <tbody>{summary.approved_items.map(item => (
                    <tr key={item.entry_id}>
                      <td data-label="訂單">{item.order_id} · 第 {item.line_index + 1} 項</td>
                      <td data-label="估列金額">{amount(item.unit_cost_twd * item.quantity)}（{item.quantity} 件）</td>
                      <td data-label="核准依據">{item.evidence || '—'}</td>
                      <td data-label="參考入庫單">{item.reference_receipt_no ? `#${item.reference_receipt_no}` : '—'}</td>
                      <td data-label="核准時間">{taipeiTime.format(new Date(item.approved_at))}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
