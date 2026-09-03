import React, { useEffect, useMemo, useState } from 'react';
import { getOrderStatusLabel } from '../../domain/payments.js';

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function contactMismatch(order, member) {
  if (!order || !member) return [];
  const warnings = [];
  const orderEmail = normalize(order.email);
  const memberEmail = normalize(member.email);
  const orderPhone = normalizePhone(order.phone);
  const memberPhone = normalizePhone(member.phone);
  if (orderEmail && memberEmail && orderEmail !== memberEmail) warnings.push('Email 不同');
  if (orderPhone && memberPhone && orderPhone !== memberPhone) warnings.push('電話不同');
  return warnings;
}

function memberSearchText(member) {
  return normalize([member.name, member.email, member.phone, member.id].join(' '));
}

function orderSearchText(order) {
  return normalize([order.id, order.member, order.email, order.phone, getOrderStatusLabel(order.status)].join(' '));
}

export default function OrderMemberAssignmentDialog({
  members = [], orders = [], presetOrder = null, presetMember = null, onAssign, onClose,
}) {
  const chooseMember = Boolean(presetOrder);
  const candidates = useMemo(() => {
    if (chooseMember) {
      return members.filter(member => !String(member.id || '').startsWith('app:'));
    }
    return orders.filter(order => !order.user_id);
  }, [chooseMember, members, orders]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  const visibleCandidates = useMemo(() => {
    const keyword = normalize(search);
    const filtered = keyword
      ? candidates.filter(candidate => (chooseMember ? memberSearchText(candidate) : orderSearchText(candidate)).includes(keyword))
      : candidates;
    return [...filtered].sort((a, b) => {
      const aMatch = chooseMember
        ? contactMismatch(presetOrder, a).length === 0
        : contactMismatch(a, presetMember).length === 0;
      const bMatch = chooseMember
        ? contactMismatch(presetOrder, b).length === 0
        : contactMismatch(b, presetMember).length === 0;
      if (aMatch !== bMatch) return aMatch ? -1 : 1;
      return chooseMember
        ? normalize(a.name || a.email).localeCompare(normalize(b.name || b.email), 'zh-TW')
        : new Date(b.createdAt || b.created_at || 0) - new Date(a.createdAt || a.created_at || 0);
    });
  }, [candidates, chooseMember, presetMember, presetOrder, search]);

  const selectedCandidate = candidates.find(candidate => String(candidate.id) === selectedId) || null;
  const order = chooseMember ? presetOrder : selectedCandidate;
  const member = chooseMember ? selectedCandidate : presetMember;
  const mismatches = contactMismatch(order, member);

  async function submit() {
    if (!order || !member || !onAssign) return;
    const warning = mismatches.length > 0 ? `\n\n注意：訂單與會員的${mismatches.join('、')}。` : '';
    if (!window.confirm(
      `確定將訪客訂單「${order.id}」歸戶至「${member.name || member.email}」嗎？\n\n歸戶後，該會員可在前台查看此訂單。${warning}`,
    )) return;
    setSubmitting(true);
    setError('');
    const result = await onAssign(order.id, member.id);
    setSubmitting(false);
    if (!result?.ok) {
      setError(result?.message || '訂單歸戶失敗，請稍後再試。');
      return;
    }
    onClose(result);
  }

  return (
    <div className="assignment-modal" role="dialog" aria-modal="true" aria-label={chooseMember ? '歸戶至會員' : '匯入訪客訂單'}>
      <button type="button" className="assignment-modal-backdrop" aria-label="關閉歸戶視窗" onClick={() => !submitting && onClose()} />
      <div className="assignment-modal-card">
        <div className="assignment-modal-header">
          <div>
            <h3>{chooseMember ? '歸戶至會員' : '匯入訪客訂單'}</h3>
            <p>{chooseMember ? `訂單 ${presetOrder?.id}` : `會員 ${presetMember?.name || presetMember?.email}`}</p>
          </div>
          <button type="button" aria-label="關閉歸戶視窗" onClick={() => onClose()} disabled={submitting}>×</button>
        </div>

        <label className="assignment-search">
          <span>{chooseMember ? '搜尋會員' : '搜尋訪客訂單'}</span>
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder={chooseMember ? '姓名、Email、電話' : '訂單編號、姓名、Email、電話'}
            autoFocus
          />
        </label>

        <div className="assignment-candidates">
          {visibleCandidates.length === 0 ? (
            <div className="assignment-empty">{chooseMember ? '找不到符合的會員' : '目前沒有符合的訪客訂單'}</div>
          ) : visibleCandidates.map(candidate => {
            const isSelected = String(candidate.id) === selectedId;
            const candidateOrder = chooseMember ? presetOrder : candidate;
            const candidateMember = chooseMember ? candidate : presetMember;
            const warnings = contactMismatch(candidateOrder, candidateMember);
            return (
              <button
                type="button"
                className={`assignment-candidate${isSelected ? ' selected' : ''}`}
                key={candidate.id}
                onClick={() => setSelectedId(String(candidate.id))}
              >
                <strong>{chooseMember ? (candidate.name || '未命名會員') : candidate.id}</strong>
                <span>{chooseMember
                  ? `${candidate.email || '無 Email'} · ${candidate.phone || '無電話'}`
                  : `${candidate.member || '未填姓名'} · ${getOrderStatusLabel(candidate.status)} · NT$ ${Number(candidate.total || 0).toLocaleString()}`}</span>
                {!chooseMember && <span>{candidate.email || '無 Email'} · {candidate.phone || '無電話'}</span>}
                {warnings.length > 0 && <em>{warnings.join('、')}</em>}
              </button>
            );
          })}
        </div>

        {mismatches.length > 0 && (
          <div className="assignment-warning">請再次核對：訂單與會員的{mismatches.join('、')}，系統不會覆寫訂單原始聯絡資料。</div>
        )}
        {error && <div className="assignment-error">{error}</div>}

        <div className="assignment-actions">
          <button type="button" onClick={() => onClose()} disabled={submitting}>取消</button>
          <button type="button" className="primary" onClick={submit} disabled={!selectedCandidate || submitting}>
            {submitting ? '歸戶中…' : '確認歸戶'}
          </button>
        </div>
      </div>
    </div>
  );
}
