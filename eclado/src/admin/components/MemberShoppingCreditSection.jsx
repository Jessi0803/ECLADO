import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  adjustMemberShoppingCredit,
  getMemberShoppingCredit,
} from '../../services/shoppingCredit.js';

const REASONS = Object.freeze({
  grant: [
    ['customer_service_compensation', '客服補償'],
    ['campaign_grant', '活動贈送'],
    ['order_return_adjustment', '訂單／退貨調整'],
    ['wrong_account_correction', '錯帳更正'],
    ['other', '其他'],
  ],
  debit: [
    ['wrong_account_correction', '錯帳更正'],
    ['eligibility_revocation', '資格撤回'],
    ['order_return_adjustment', '訂單／退貨調整'],
    ['other', '其他'],
  ],
});

const EVENT_LABELS = Object.freeze({
  grant: '人工發放',
  debit: '人工扣除',
  reserve: '訂單保留',
  consume: '訂單使用',
  release: '解除保留',
  refund: '訂單取消返還',
});

const REASON_LABELS = Object.freeze({
  customer_service_compensation: '客服補償',
  campaign_grant: '活動贈送',
  order_return_adjustment: '訂單／退貨調整',
  wrong_account_correction: '錯帳更正',
  eligibility_revocation: '資格撤回',
  other: '其他',
  order_checkout: '訂單結帳',
  payment_success: '付款完成',
  order_cancelled: '訂單取消',
  order_expired: '訂單逾期',
  payment_failed: '付款失敗',
  paid_order_cancelled: '已付款訂單取消',
});

function formatMoney(value) {
  return `NT$ ${Number(value || 0).toLocaleString('zh-TW')}`;
}

function describeEntryAmount(entry) {
  const amount = formatMoney(entry.amount);
  if (entry.event_type === 'consume') return `轉為使用 ${amount}`;
  if (Number(entry.available_delta) > 0) return `+${amount}`;
  if (Number(entry.available_delta) < 0) return `-${amount}`;
  return amount;
}

function errorMessage(error) {
  const message = String(error?.message || '購物金操作失敗，請稍後再試。');
  if (message.includes('Insufficient available')) return '可用購物金不足，無法扣除這筆金額。';
  if (message.includes('permission')) return '目前帳號沒有管理購物金的權限。';
  if (message.includes('locked for deletion')) return '此會員正在刪除流程中，購物金帳戶已鎖定。';
  if (message.includes('reused with different data')) return '此操作識別碼已被其他資料使用，請關閉視窗後重新操作。';
  return message;
}

function newRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function MemberShoppingCreditSection({ memberId, canManage }) {
  const [credit, setCredit] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [visibleEntryCount, setVisibleEntryCount] = useState(10);
  const loadRequestRef = useRef(0);

  async function loadCredit() {
    if (!memberId || !canManage) return;
    const requestNumber = ++loadRequestRef.current;
    setLoading(true);
    setLoadError('');
    const { data, error } = await getMemberShoppingCredit(memberId);
    if (requestNumber !== loadRequestRef.current) return;
    setLoading(false);
    if (error) {
      setLoadError(errorMessage(error));
      return;
    }
    setCredit({
      available_balance: Number(data?.available_balance || 0),
      reserved_balance: Number(data?.reserved_balance || 0),
      entries: Array.isArray(data?.entries) ? data.entries : [],
    });
  }

  useEffect(() => {
    loadRequestRef.current += 1;
    setCredit(null);
    setDialog(null);
    setHistoryExpanded(false);
    setVisibleEntryCount(10);
    loadCredit();
  }, [memberId, canManage]);

  function openDialog(direction) {
    setDialog({
      direction,
      amount: '',
      reasonCode: REASONS[direction][0][0],
      note: '',
      step: 'form',
      saving: false,
      error: '',
      requestId: '',
    });
  }

  const parsedAmount = Number(dialog?.amount || 0);
  const projectedBalance = dialog?.direction === 'grant'
    ? Number(credit?.available_balance || 0) + parsedAmount
    : Number(credit?.available_balance || 0) - parsedAmount;
  const formError = useMemo(() => {
    if (!dialog) return '';
    if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) return '請輸入大於 0 的整數金額。';
    if (dialog.direction === 'debit' && parsedAmount > Number(credit?.available_balance || 0)) return '扣除金額不可超過目前可用購物金。';
    if (dialog.reasonCode === 'other' && !dialog.note.trim()) return '選擇「其他」時必須填寫內部說明。';
    if (dialog.note.length > 500) return '內部說明不可超過 500 字。';
    return '';
  }, [credit?.available_balance, dialog, parsedAmount]);

  function updateDialog(patch) {
    setDialog(current => current ? {
      ...current,
      ...patch,
      error: '',
      requestId: patch.step === 'confirm' ? current.requestId : '',
    } : current);
  }

  function enterConfirmation() {
    if (formError) {
      setDialog(current => ({ ...current, error: formError }));
      return;
    }
    setDialog(current => ({
      ...current,
      step: 'confirm',
      error: '',
      requestId: current.requestId || newRequestId(),
    }));
  }

  async function submitAdjustment() {
    if (!dialog || formError || dialog.saving) return;
    setDialog(current => ({ ...current, saving: true, error: '' }));
    const { data, error } = await adjustMemberShoppingCredit({
      memberId,
      direction: dialog.direction,
      amount: parsedAmount,
      reasonCode: dialog.reasonCode,
      internalNote: dialog.note.trim(),
      requestId: dialog.requestId,
    });
    if (error) {
      setDialog(current => ({ ...current, saving: false, error: errorMessage(error) }));
      return;
    }
    await loadCredit();
    setDialog(null);
    if (data?.already_processed) {
      setLoadError('這筆操作先前已完成，畫面已同步為最新餘額。');
    }
  }

  const selectedReasonLabel = dialog
    ? REASONS[dialog.direction].find(([value]) => value === dialog.reasonCode)?.[1]
    : '';

  if (!canManage) return null;

  return (
    <section className="member-credit-section" aria-label="購物金管理">
      <div className="member-credit-heading">
        <div>
          <div className="member-credit-eyebrow">購物金管理</div>
          <div className="member-credit-balances">
            <span><small>可用</small>{loading && !credit ? '載入中…' : formatMoney(credit?.available_balance)}</span>
            <span><small>訂單保留</small>{loading && !credit ? '—' : formatMoney(credit?.reserved_balance)}</span>
          </div>
        </div>
        <div className="member-credit-actions">
          <button type="button" onClick={() => openDialog('grant')} disabled={loading || !credit}>發放</button>
          <button type="button" onClick={() => openDialog('debit')} disabled={loading || !credit}>扣除</button>
        </div>
      </div>

      {loadError && <p className="member-credit-notice" role="status">{loadError}</p>}
      {!loading && credit && (
        <div className="member-credit-history">
          <button
            type="button"
            className="member-credit-history-toggle"
            aria-expanded={historyExpanded}
            onClick={() => setHistoryExpanded(value => !value)}
          >
            <span>異動明細</span>
            <span>{historyExpanded ? '收合' : `展開（最近 ${Math.min(10, credit.entries.length)} 筆）`} {historyExpanded ? '⌃' : '⌄'}</span>
          </button>
          {historyExpanded && (
            <div className="member-credit-history-content">
              {credit.entries.length === 0 ? (
                <p className="member-credit-empty">尚無購物金異動。</p>
              ) : credit.entries.slice(0, visibleEntryCount).map(entry => (
                <div className="member-credit-entry" key={entry.id || entry.request_id}>
                  <div>
                    <strong>{EVENT_LABELS[entry.event_type] || entry.event_type}</strong>
                    <span>{REASON_LABELS[entry.reason_code] || entry.reason_code || '—'}</span>
                    {entry.order_id && <span>訂單 {entry.order_id}</span>}
                    {entry.internal_note && <span>內部說明：{entry.internal_note}</span>}
                    {entry.actor_email && <span>操作人：{entry.actor_email}</span>}
                  </div>
                  <div className="member-credit-entry-value">
                    <strong>{describeEntryAmount(entry)}</strong>
                    <span>餘額 {formatMoney(entry.available_balance_after)}</span>
                    <time>{entry.created_at ? new Date(entry.created_at).toLocaleString('zh-TW') : '—'}</time>
                  </div>
                </div>
              ))}
              {visibleEntryCount < credit.entries.length && (
                <button
                  type="button"
                  className="member-credit-load-more"
                  onClick={() => setVisibleEntryCount(count => Math.min(count + 10, credit.entries.length))}
                >
                  載入更多（尚有 {credit.entries.length - visibleEntryCount} 筆）
                </button>
              )}
              {credit.entries.length > 0 && (
                <p className="member-credit-history-count">
                  已顯示 {Math.min(visibleEntryCount, credit.entries.length)}／{credit.entries.length} 筆
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {dialog && (
        <div className="member-credit-modal-backdrop" onMouseDown={event => {
          if (event.target === event.currentTarget && !dialog.saving) setDialog(null);
        }}>
          <div className="member-credit-modal" role="dialog" aria-modal="true" aria-labelledby="member-credit-dialog-title">
            <div className="member-credit-modal-header">
              <h3 id="member-credit-dialog-title">{dialog.direction === 'grant' ? '發放購物金' : '扣除購物金'}</h3>
              <button type="button" aria-label="關閉購物金操作" disabled={dialog.saving} onClick={() => setDialog(null)}>×</button>
            </div>

            {dialog.step === 'form' ? (
              <>
                <label className="member-credit-field">
                  <span>金額</span>
                  <input type="number" inputMode="numeric" min="1" step="1" value={dialog.amount} onChange={event => updateDialog({ amount: event.target.value })} placeholder="請輸入整數金額" />
                </label>
                <label className="member-credit-field">
                  <span>原因</span>
                  <select value={dialog.reasonCode} onChange={event => updateDialog({ reasonCode: event.target.value })}>
                    {REASONS[dialog.direction].map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                </label>
                <label className="member-credit-field">
                  <span>內部說明{dialog.reasonCode === 'other' ? '（必填）' : '（選填）'}</span>
                  <textarea maxLength="500" rows="3" value={dialog.note} onChange={event => updateDialog({ note: event.target.value })} placeholder="僅供後台稽核，不會顯示給會員" />
                </label>
                <div className="member-credit-balance-preview">
                  <span>調整前 {formatMoney(credit?.available_balance)}</span>
                  <span>調整後 {formatMoney(Math.max(0, projectedBalance))}</span>
                </div>
                {dialog.error && <p className="member-credit-error" role="alert">{dialog.error}</p>}
                <div className="member-credit-modal-actions">
                  <button type="button" className="secondary" onClick={() => setDialog(null)}>取消</button>
                  <button type="button" onClick={enterConfirmation}>下一步確認</button>
                </div>
              </>
            ) : (
              <>
                <div className="member-credit-confirmation">
                  <p>請確認這筆不可刪除的購物金異動紀錄。</p>
                  <dl>
                    <div><dt>操作</dt><dd>{dialog.direction === 'grant' ? '發放' : '扣除'}</dd></div>
                    <div><dt>金額</dt><dd>{formatMoney(parsedAmount)}</dd></div>
                    <div><dt>原因</dt><dd>{selectedReasonLabel}</dd></div>
                    {dialog.note.trim() && <div><dt>內部說明</dt><dd>{dialog.note.trim()}</dd></div>}
                    <div><dt>調整後餘額</dt><dd>{formatMoney(projectedBalance)}</dd></div>
                  </dl>
                </div>
                {dialog.error && <p className="member-credit-error" role="alert">{dialog.error}</p>}
                <div className="member-credit-modal-actions">
                  <button type="button" className="secondary" disabled={dialog.saving} onClick={() => updateDialog({ step: 'form' })}>返回修改</button>
                  <button type="button" disabled={dialog.saving} onClick={submitAdjustment}>{dialog.saving ? '處理中…' : `確認${dialog.direction === 'grant' ? '發放' : '扣除'}`}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
