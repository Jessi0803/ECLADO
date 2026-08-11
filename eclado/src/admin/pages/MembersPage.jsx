import React, { useEffect, useMemo, useState } from 'react';
import { Badge, TypeBadge } from '../components/StatusIndicators.jsx';

const APP_STATUS_LABEL = { pending: '待審核', approved: '已核准', rejected: '已拒絕' };
const APP_SOURCE_LABEL = { registration: '註冊申請', upgrade: '事後申請', standalone: '表單申請' };
const APP_STATUS_COLOR = { pending: '#b8860b', approved: '#2e7d32', rejected: '#c62828' };
const APP_STATUS_BG = { pending: '#fff8e1', approved: '#e8f5e9', rejected: '#ffebee' };

function appsForMember(applications, memberId) {
  if (!memberId) return [];
  // 虛擬會員（未綁帳號的申請）：id 格式為 'app:<applicationId>'，直接對 application.id
  if (typeof memberId === 'string' && memberId.startsWith('app:')) {
    const appId = memberId.slice(4);
    return applications.filter(a => a.id === appId);
  }
  return applications
    .filter(a => a.user_id === memberId)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

function memberHasPendingApp(applications, memberId) {
  return appsForMember(applications, memberId).some(a => a.status === 'pending');
}

export default function Members({
  members, setMembers, orders = [],
  applications = [], applicationsLoading = false, applicationsError = '',
  onUpdateApplicationStatus, onDeleteMember, defaultFilter = 'all',
}) {
  const [filter, setFilter] = useState(defaultFilter);
  const [selected, setSelected] = useState(null);
  const [typeNotice, setTypeNotice] = useState('');
  const [deleteNotice, setDeleteNotice] = useState('');
  const [deletingId, setDeletingId] = useState('');

  useEffect(() => { setFilter(defaultFilter); }, [defaultFilter]);

  useEffect(() => {
    if (!selected) return;
    const fresh = members.find(m => m.id === selected.id);
    if (fresh) setSelected(fresh);
  }, [members]);

  const pendingAppCount = applications.filter(a => a.status === 'pending').length;

  const filtered = filter === 'all'
    ? members
    : filter === 'app_pending'
      ? members.filter(m => memberHasPendingApp(applications, m.id) || m.type === 'pending')
      : members.filter(m => m.type === filter);

  const memberOrders = selected
    ? orders.filter(o => o.user_id === selected.id || o.email === selected.email)
    : [];

  const selectedApps = selected ? appsForMember(applications, selected.id) : [];
  const latestApp = selectedApps[0] || null;
  const selectedPending = selected ? memberHasPendingApp(applications, selected.id) : false;

  function changeType(id, type) {
    if (typeof id === 'string' && id.startsWith('app:')) {
      setTypeNotice('此申請尚未綁定會員帳號，請在下方「美容師申請」區塊按「核准」或「拒絕」。');
      return;
    }
    if (type === 'pro' && memberHasPendingApp(applications, id)) {
      setTypeNotice('此會員有審核中的美容師申請，請在下方「美容師申請」區塊按「核准」。');
      return;
    }
    setTypeNotice('');
    setMembers(prev => prev.map(m => m.id === id ? { ...m, type } : m));
    if (selected?.id === id) setSelected(s => ({ ...s, type }));
  }

  async function reviewApplication(appId, status) {
    if (!onUpdateApplicationStatus) return;
    setTypeNotice('');
    await onUpdateApplicationStatus(appId, status);
  }

  async function deleteMember(member) {
    if (!onDeleteMember || !member) return;
    if (typeof member.id === 'string' && member.id.startsWith('app:')) {
      setDeleteNotice('此筆是未綁定帳號的申請資料，請在美容師申請區塊核准或拒絕。');
      return;
    }
    const name = member.name || member.email || member.id;
    if (!confirm(`確定要刪除會員「${name}」嗎？\n\n此操作會同步刪除 Supabase Auth 帳號與會員資料，無法還原。歷史訂單會保留。`)) return;
    setDeletingId(member.id);
    setDeleteNotice('');
    const error = await onDeleteMember(member);
    setDeletingId('');
    if (error) {
      setDeleteNotice(error);
      return;
    }
    setSelected(null);
  }

  return (
    <div className={'detail-grid' + (selected ? '' : ' no-panel')}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-d)', fontSize: 28, fontWeight: 400 }}>會員管理</h1>
            {pendingAppCount > 0 && (
              <p style={{ fontSize: 12, color: 'var(--mid)', marginTop: 4 }}>{pendingAppCount} 筆美容師申請待審核</p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', background: 'var(--white)', flexWrap: 'wrap' }}>
            {[['all','全部'], ['app_pending','待審核申請'], ['consumer','一般'], ['pro','美容師'], ['instructor','師資'], ['distributor','經銷商']].map(([val, label]) => (
              <button key={val} onClick={() => setFilter(val)} style={{
                padding: '8px 16px', border: 'none', fontSize: 12,
                background: filter === val ? 'var(--dark)' : 'transparent',
                color: filter === val ? '#fff' : 'var(--mid)',
                cursor: 'pointer', transition: 'all 0.15s',
              }}>{label}{val === 'app_pending' && pendingAppCount > 0 ? ` (${pendingAppCount})` : ''}</button>
            ))}
          </div>
        </div>

        {applicationsError && (
          <div style={{ background: 'oklch(0.60 0.18 25 / 0.08)', border: '1px solid oklch(0.60 0.18 25 / 0.3)', padding: '12px 16px', marginBottom: 16, fontSize: 12, color: 'var(--red)', lineHeight: 1.7 }}>
            ⚠ {applicationsError}
          </div>
        )}

        <div className="table-scroll" style={{ background: 'var(--white)', border: '1px solid var(--border)' }}>
          <table className="responsive-admin-table admin-members-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--off)' }}>
                {['姓名', 'Email', '電話', '類型', '申請', '訂單數', '消費總額', '加入日期', '操作'].map(h => (
                  <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, color: 'var(--mid)', fontWeight: 400, letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(m => (
                <tr key={m.id} onClick={() => { setSelected(m); setTypeNotice(''); setDeleteNotice(''); }} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selected?.id === m.id ? 'var(--off)' : 'transparent', transition: 'background 0.1s' }}
                onMouseEnter={e => { if (selected?.id !== m.id) e.currentTarget.style.background = 'var(--off)'; }}
                onMouseLeave={e => { if (selected?.id !== m.id) e.currentTarget.style.background = 'transparent'; }}>
                  <td data-label="姓名" style={{ padding: '13px 14px', fontSize: 13, fontWeight: 500 }}>{m.name}</td>
                  <td data-label="Email" style={{ padding: '13px 14px', fontSize: 12, color: 'var(--mid)' }}>{m.email}</td>
                  <td data-label="電話" style={{ padding: '13px 14px', fontSize: 12, color: 'var(--mid)' }}>{m.phone}</td>
                  <td data-label="類型" style={{ padding: '13px 14px' }}><TypeBadge type={m.type} /></td>
                  <td data-label="申請" style={{ padding: '13px 14px', fontSize: 11 }}>
                    {(() => {
                      const app = appsForMember(applications, m.id)[0];
                      if (!app) return <span style={{ color: 'var(--light)' }}>—</span>;
                      return (
                        <span style={{ padding: '3px 8px', background: APP_STATUS_BG[app.status] || '#f5f5f5', color: APP_STATUS_COLOR[app.status] || '#555' }}>
                          {APP_STATUS_LABEL[app.status] || app.status}
                        </span>
                      );
                    })()}
                  </td>
                  <td data-label="訂單數" style={{ padding: '13px 14px', fontSize: 13 }}>{m.orders}</td>
                  <td data-label="消費總額" style={{ padding: '13px 14px', fontSize: 13, fontWeight: 500 }}>NT$ {m.total.toLocaleString()}</td>
                  <td data-label="加入日期" style={{ padding: '13px 14px', fontSize: 12, color: 'var(--mid)', whiteSpace: 'nowrap' }}>{m.joined}</td>
                  <td data-label="操作" style={{ padding: '13px 14px' }}>
                    <select value={m.type} onChange={e => { e.stopPropagation(); changeType(m.id, e.target.value); }} onClick={e => e.stopPropagation()} style={{ padding: '5px 8px', fontSize: 11, border: '1px solid var(--border)', background: 'var(--white)', color: 'var(--dark)', cursor: 'pointer', outline: 'none' }}>
                      <option value="consumer">一般會員</option>
                      <option value="pro" disabled={memberHasPendingApp(applications, m.id)}>美容師{memberHasPendingApp(applications, m.id) ? '（請先審核）' : ''}</option>
                      <option value="instructor">師資</option>
                      <option value="distributor">經銷商</option>
                      <option value="pending">審核中</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Member detail */}
      {selected && (
        <>
        <button type="button" className="detail-panel-backdrop" aria-label="關閉會員詳情" onClick={() => setSelected(null)} />
        <div className="detail-panel" role="dialog" aria-modal="true" aria-label="會員詳情" style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <h3 style={{ fontSize: 15, fontWeight: 500 }}>會員詳情</h3>
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--mid)', cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ display: 'flex', align: 'center', gap: 14, marginBottom: 24 }}>
            <div style={{ width: 48, height: 48, background: 'var(--off)', border: '1px solid var(--border)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 400, fontFamily: 'var(--font-d)' }}>
              {selected.name[0]}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>{selected.name}</div>
              <TypeBadge type={selected.type} />
            </div>
          </div>
          {[['Email', selected.email], ['電話', selected.phone], ['加入日期', selected.joined], ['訂單數', `${selected.orders} 筆`], ['消費總額', `NT$ ${selected.total.toLocaleString()}`]].map(([label, val]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <span style={{ color: 'var(--mid)', fontSize: 12 }}>{label}</span>
              <span style={{ fontWeight: 400 }}>{val}</span>
            </div>
          ))}
          {selected.cert && (
            <div style={{ marginTop: 16, padding: '12px', background: 'var(--off)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 4, letterSpacing: '0.08em' }}>證書資料</div>
              <div style={{ fontSize: 13, color: 'var(--dark)' }}>{selected.cert}</div>
            </div>
          )}

          <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 12, letterSpacing: '0.08em' }}>美容師申請</div>
            {applicationsLoading ? (
              <p style={{ fontSize: 12, color: 'var(--mid)' }}>載入申請資料…</p>
            ) : selectedApps.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--mid)', lineHeight: 1.7 }}>尚無美容師申請紀錄。</p>
            ) : latestApp && (
              <div style={{ padding: '14px', background: 'var(--off)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                  <span style={{ fontSize: 11, padding: '3px 10px', background: APP_STATUS_BG[latestApp.status] || '#f5f5f5', color: APP_STATUS_COLOR[latestApp.status] || '#555' }}>
                    {APP_STATUS_LABEL[latestApp.status] || latestApp.status}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--mid)' }}>{APP_SOURCE_LABEL[latestApp.source] || latestApp.source || '—'}</span>
                </div>
                {[
                  ['皮膚管理院', latestApp.studio_name],
                  ['聯絡人', latestApp.contact_name],
                  ['電話', latestApp.phone],
                  ['地址', latestApp.address],
                  ['社群帳號', latestApp.social_media],
                  ['證書說明', latestApp.certificate],
                  ['申請時間', latestApp.created_at ? new Date(latestApp.created_at).toLocaleString('zh-TW') : '—'],
                ].map(([label, val]) => val ? (
                  <div key={label} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: 'var(--mid)', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 12, lineHeight: 1.6, wordBreak: 'break-all' }}>{val}</div>
                  </div>
                ) : null)}
                {latestApp.status === 'pending' && onUpdateApplicationStatus && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <button type="button" onClick={() => reviewApplication(latestApp.id, 'approved')} style={{ flex: 1, padding: '10px 0', fontSize: 12, background: 'var(--dark)', color: '#fff', border: 'none', cursor: 'pointer' }}>核准</button>
                    <button type="button" onClick={() => reviewApplication(latestApp.id, 'rejected')} style={{ flex: 1, padding: '10px 0', fontSize: 12, background: 'var(--white)', color: 'var(--dark)', border: '1px solid var(--border)', cursor: 'pointer' }}>拒絕</button>
                  </div>
                )}
                {selectedApps.length > 1 && (
                  <p style={{ fontSize: 11, color: 'var(--mid)', marginTop: 12 }}>另有 {selectedApps.length - 1} 筆歷史申請</p>
                )}
              </div>
            )}
          </div>

          {typeNotice && (
            <p style={{ marginTop: 12, fontSize: 12, color: 'var(--red)', lineHeight: 1.6 }}>{typeNotice}</p>
          )}
          {deleteNotice && (
            <p style={{ marginTop: 12, fontSize: 12, color: 'var(--red)', lineHeight: 1.6 }}>{deleteNotice}</p>
          )}

          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 10, letterSpacing: '0.08em' }}>變更會員類型（內部調整）</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => changeType(selected.id, 'consumer')} style={{ flex: 1, padding: '9px', fontSize: 11, background: selected.type === 'consumer' ? 'var(--dark)' : 'none', color: selected.type === 'consumer' ? '#fff' : 'var(--dark)', border: '1px solid var(--border)', cursor: 'pointer' }}>一般會員</button>
              <button onClick={() => changeType(selected.id, 'pro')} disabled={selectedPending} title={selectedPending ? '請在上方申請區塊核准' : ''} style={{ flex: 1, padding: '9px', fontSize: 11, background: selected.type === 'pro' ? 'var(--dark)' : 'none', color: selected.type === 'pro' ? '#fff' : 'var(--dark)', border: '1px solid var(--border)', cursor: selectedPending ? 'not-allowed' : 'pointer', opacity: selectedPending ? 0.45 : 1 }}>美容師</button>
              <button onClick={() => changeType(selected.id, 'instructor')} style={{ flex: 1, padding: '9px', fontSize: 11, background: selected.type === 'instructor' ? 'var(--dark)' : 'none', color: selected.type === 'instructor' ? '#fff' : 'var(--dark)', border: '1px solid var(--border)', cursor: 'pointer' }}>師資</button>
              <button onClick={() => changeType(selected.id, 'distributor')} style={{ flex: 1, padding: '9px', fontSize: 11, background: selected.type === 'distributor' ? 'var(--dark)' : 'none', color: selected.type === 'distributor' ? '#fff' : 'var(--dark)', border: '1px solid var(--border)', cursor: 'pointer' }}>經銷商</button>
            </div>
          </div>

          {onDeleteMember && !(typeof selected.id === 'string' && selected.id.startsWith('app:')) && (
            <div style={{ marginTop: 24, padding: '16px', border: '1px solid oklch(0.60 0.18 25 / 0.28)', background: 'oklch(0.60 0.18 25 / 0.06)' }}>
              <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 8, letterSpacing: '0.08em' }}>刪除會員</div>
              <button
                type="button"
                onClick={() => deleteMember(selected)}
                disabled={deletingId === selected.id}
                style={{ width: '100%', padding: '10px 0', fontSize: 12, background: 'var(--white)', color: 'var(--red)', border: '1px solid oklch(0.60 0.18 25 / 0.45)', cursor: deletingId === selected.id ? 'wait' : 'pointer' }}
              >
                {deletingId === selected.id ? '刪除中…' : '刪除會員'}
              </button>
            </div>
          )}

          {/* 歷史訂單 */}
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 12, letterSpacing: '0.08em' }}>
              歷史訂單（{memberOrders.length}）
            </div>
            {memberOrders.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--mid)', padding: '16px 0', textAlign: 'center' }}>尚無訂單</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 280, overflowY: 'auto' }}>
                {memberOrders.map(o => (
                  <div key={o.id} style={{ padding: '10px 12px', border: '1px solid var(--border)', background: 'var(--off)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--dark)' }}>{o.id}</span>
                      <Badge status={o.status} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--mid)' }}>
                      <span>{o.date}</span>
                      <span style={{ color: 'var(--dark)', fontWeight: 500 }}>NT$ {o.total.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        </>
      )}
    </div>
  );
}
