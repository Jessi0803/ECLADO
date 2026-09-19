import React, { useState } from 'react';
import {
  formatMoney,
  formatQuarterPeriod,
  formatTaiwanDate,
  PROFESSIONAL_ROLE_LABELS,
  quarterTitle,
} from '../../domain/professionalSales.js';

const smallButton = { background: 'none', border: '1px solid var(--border)', padding: '4px 10px', fontSize: 11, cursor: 'pointer', color: 'var(--dark)', whiteSpace: 'nowrap' };
const primaryButton = { background: 'var(--dark)', color: '#fff', border: 'none', padding: '6px 14px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' };
const fieldStyle = { border: '1px solid var(--border)', padding: '6px 8px', fontSize: 12, background: '#fff', minWidth: 0 };

function taipeiToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
}

const quarterKey = quarter => `${quarter.membership_id}-${quarter.quarter_number}`;

export default function ProfessionalQuarterSection({ sales, onChangeStart, onSaveAdjustment }) {
  const [editingStart, setEditingStart] = useState(false);
  const [startDraft, setStartDraft] = useState('');
  const [editingKey, setEditingKey] = useState('');
  const [amountDraft, setAmountDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  const current = sales.currentQuarter;
  const membership = sales.currentMembership || sales.memberships[0] || null;

  function openStartEditor() {
    setStartDraft(membership?.started_on || '');
    setNotice(null);
    setEditingStart(true);
  }

  async function saveStart(event) {
    event.preventDefault();
    if (!startDraft) return setNotice({ ok: false, text: '請選擇資格起始日' });
    if (startDraft > taipeiToday()) return setNotice({ ok: false, text: '起始日不可晚於今天' });
    setSaving(true);
    const result = await onChangeStart?.(membership.id, startDraft);
    setSaving(false);
    setNotice(result?.message ? { ok: result.ok, text: result.message } : null);
    if (result?.ok) setEditingStart(false);
  }

  function openAdjustment(quarter) {
    setEditingKey(quarterKey(quarter));
    setAmountDraft(quarter.offline_sales_amount ? String(quarter.offline_sales_amount) : '');
    setNoteDraft(quarter.offline_note || '');
    setNotice(null);
  }

  async function saveAdjustment(event, quarter) {
    event.preventDefault();
    const amount = amountDraft.trim() === '' ? 0 : Number(amountDraft);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(amount)) {
      return setNotice({ ok: false, text: '請輸入 0 以上的整數金額' });
    }
    setSaving(true);
    const result = await onSaveAdjustment?.(quarter.membership_id, quarter.quarter_number, amount, noteDraft.trim());
    setSaving(false);
    setNotice(result?.message ? { ok: result.ok, text: result.message } : null);
    if (result?.ok) setEditingKey('');
  }

  return (
    <div style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 12, letterSpacing: '0.08em' }}>專業資格季度</div>

      {membership && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12, fontSize: 12 }}>
          {editingStart ? (
            <form onSubmit={saveStart} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 11, color: 'var(--mid)' }} htmlFor="membership-start">資格起始日</label>
              <input id="membership-start" type="date" value={startDraft} max={taipeiToday()} onChange={event => setStartDraft(event.target.value)} style={fieldStyle} />
              <button type="submit" disabled={saving} style={primaryButton}>{saving ? '儲存中…' : '儲存'}</button>
              <button type="button" disabled={saving} onClick={() => setEditingStart(false)} style={smallButton}>取消</button>
            </form>
          ) : (
            <>
              <span><span style={{ color: 'var(--mid)', fontSize: 11 }}>資格起始日</span>　{formatTaiwanDate(membership.started_on)}</span>
              {onChangeStart && <button type="button" onClick={openStartEditor} style={smallButton}>修改起始日</button>}
            </>
          )}
        </div>
      )}

      {notice && (
        <div role={notice.ok ? 'status' : 'alert'} style={{ fontSize: 11, marginBottom: 12, color: notice.ok ? '#2e7d32' : 'var(--red)' }}>{notice.text}</div>
      )}

      {current && (
        <div style={{ padding: '14px', background: 'var(--off)', borderLeft: '3px solid var(--gold)', marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 7 }}>
            <strong style={{ fontSize: 12, fontWeight: 500 }}>{quarterTitle(current)}</strong>
            <span style={{ fontSize: 11, color: 'var(--mid)' }}>{PROFESSIONAL_ROLE_LABELS[current.role] || current.role}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 10 }}>{formatQuarterPeriod(current)}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <span style={{ fontSize: 11, color: 'var(--mid)' }}>
              {current.order_count} 筆有效訂單
              {current.offline_sales_amount > 0 && `，含線下補登 ${formatMoney(current.offline_sales_amount)}`}
            </span>
            <span style={{ fontSize: 18, fontWeight: 500 }}>{formatMoney(current.sales_amount)}</span>
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
        <table aria-label="資格季度採購" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['季度', '期間', '官網', '線下補登', '合計'].map(label => (
                <th key={label} style={{ padding: '8px 6px', textAlign: ['官網', '線下補登', '合計'].includes(label) ? 'right' : 'left', fontSize: 10, color: 'var(--mid)', fontWeight: 400, position: 'sticky', top: 0, background: '#fff' }}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sales.quarters.map(quarter => {
              const key = quarterKey(quarter);
              const editing = editingKey === key;
              return (
                <React.Fragment key={key}>
                  <tr style={{ borderBottom: editing ? 'none' : '1px solid var(--border)' }}>
                    <td style={{ padding: '9px 6px', fontSize: 11, whiteSpace: 'nowrap' }}>{quarterTitle(quarter)}{quarter.is_partial ? ' *' : ''}</td>
                    <td style={{ padding: '9px 6px', fontSize: 10, color: 'var(--mid)', whiteSpace: 'nowrap' }}>{formatQuarterPeriod(quarter)}</td>
                    <td style={{ padding: '9px 6px', fontSize: 11, textAlign: 'right', whiteSpace: 'nowrap' }}>{formatMoney(quarter.online_sales_amount)}<span style={{ color: 'var(--mid)', fontSize: 10 }}>（{quarter.order_count} 筆）</span></td>
                    <td style={{ padding: '9px 6px', fontSize: 11, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {quarter.offline_sales_amount > 0 ? formatMoney(quarter.offline_sales_amount) : <span style={{ color: 'var(--mid)' }}>—</span>}
                      {onSaveAdjustment && !editing && (
                        <button type="button" aria-label={`${quarterTitle(quarter)}補登線下採購`} onClick={() => openAdjustment(quarter)} style={{ ...smallButton, marginLeft: 8, padding: '2px 8px', fontSize: 10 }}>
                          {quarter.offline_sales_amount > 0 || quarter.offline_note ? '編輯' : '補登'}
                        </button>
                      )}
                    </td>
                    <td style={{ padding: '9px 6px', fontSize: 11, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 500 }}>{formatMoney(quarter.sales_amount)}</td>
                  </tr>
                  {quarter.offline_note && !editing && (
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <td colSpan={5} style={{ padding: '0 6px 9px', fontSize: 10, color: 'var(--mid)' }}>補登備註：{quarter.offline_note}</td>
                    </tr>
                  )}
                  {editing && (
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <td colSpan={5} style={{ padding: '4px 6px 12px' }}>
                        <form onSubmit={event => saveAdjustment(event, quarter)} style={{ display: 'grid', gridTemplateColumns: '140px minmax(0,1fr) auto auto', gap: 8, alignItems: 'center' }}>
                          <input aria-label="線下採購金額" inputMode="numeric" value={amountDraft} onChange={event => setAmountDraft(event.target.value.replace(/[^\d]/g, ''))} placeholder="季度總額 NT$" style={fieldStyle} autoFocus />
                          <input aria-label="補登備註" value={noteDraft} onChange={event => setNoteDraft(event.target.value)} placeholder="備註（例：官網上線前線下採購）" maxLength={200} style={fieldStyle} />
                          <button type="submit" disabled={saving} style={primaryButton}>{saving ? '儲存中…' : '儲存'}</button>
                          <button type="button" disabled={saving} onClick={() => setEditingKey('')} style={smallButton}>取消</button>
                        </form>
                        <div style={{ fontSize: 10, color: 'var(--mid)', marginTop: 6 }}>金額清空並儲存即可刪除這筆補登。</div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 14, fontSize: 10, color: 'var(--mid)', lineHeight: 1.7 }}>
        資格歷程：{sales.memberships.map(item => `${PROFESSIONAL_ROLE_LABELS[item.role] || item.role} ${formatTaiwanDate(item.started_on)} 起${item.ended_on ? `，${formatTaiwanDate(item.ended_on)} 結束` : ''}`).join('；')}
      </div>
      <div style={{ marginTop: 4, fontSize: 10, color: 'var(--mid)', lineHeight: 1.7 }}>
        先確認資格起始日再補登：線下補登跟著「第幾季」走，修改起始日後季度期間會重新切分。
      </div>
    </div>
  );
}
