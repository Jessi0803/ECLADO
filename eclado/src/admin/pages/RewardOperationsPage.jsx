import React, { useEffect, useRef, useState } from 'react';
import '../../components/account/InstructorRewards.css';
import { getRewardNotifications, getRewardReconciliation, runRewardReconciliation, retryRewardNotification, sendRewardCorrection } from '../../services/rewardOperations.js';
import {reconciliationRules,reconciliationFields} from '../domain/rewardReconciliation.js';

const statuses = { pending: '待發送', sending: '處理中', retry: '等待重試', sent: '服務商已接受', failed: '發送失敗', unknown: '結果待查核', blocked: '待設定／無可用管道' };
const events = { requested: '提領申請成立', paid: '已匯款', failed: '未匯款並返還', unknown: '匯款待查核', correction: '更正說明' };
const noticeTime=value=>{if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?'—':date.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});};
export default function RewardOperationsPage({ mode, adminUserId, canManage, embedded=false, refreshVersion=0 }) {
  const Heading=embedded?'h2':'h1';
  const [data, setData] = useState(null), [error, setError] = useState(''), [offset, setOffset] = useState(0), [revision, setRevision] = useState(0), [busy, setBusy] = useState(false);
  const lock = useRef(false), pending = useRef(null);
  const notices = mode === 'notifications';
  useEffect(() => {
    let alive = true; setData(null); setError('');
    (notices ? getRewardNotifications(offset) : getRewardReconciliation(offset)).then(value => { if (alive) setData(value); }).catch(e => {
      if (alive) setError(e.code === 'PGRST202' ? '通知與對帳功能尚未安裝。' : '查詢失敗，請重新整理或確認權限。');
    });
    return () => { alive = false; };
  }, [mode, adminUserId, notices, offset, revision, refreshVersion]);
  useEffect(() => { pending.current = null; setOffset(0); }, [mode, adminUserId]);
  useEffect(() => { const focus = () => setRevision(v => v + 1); window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus); }, []);
  async function execute() {
    if (lock.current || !pending.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const p = pending.current;
      if (p.type === 'run') await runRewardReconciliation(p.key);
      else if (p.type === 'correction') await sendRewardCorrection(p.id, p.key);
      else await retryRewardNotification(p.id, p.key, p.newVersion, p.reason);
      pending.current = null; setRevision(v => v + 1);
    } catch (e) {
      if (/^(22|23|40|42|54|55)/.test(e.code || '')) pending.current = null;
      setError('操作未完成。結果不明時請重送原操作，不要另建重複請求。');
    } finally { lock.current = false; setBusy(false); }
  }
  function request(p) {
    if (lock.current || pending.current) return;
    pending.current = { ...p, key: crypto.randomUUID() }; execute();
  }
  function supplement(n, newVersion) {
    if (!window.confirm(newVersion ? '確認另寄一份通知？可能已送達，另寄會建立新版本及稽核，不修改帳務。' : '確認重試原通知？沿用原防重鍵，不修改帳務。')) return;
    const reason = window.prompt('補發理由（勿輸入銀行帳號或聯絡個資，最多120字）');
    if (reason?.trim()) request({ type: 'retry', id: n.id, newVersion, reason: reason.trim() });
  }
  return <div className="reward-view">
    <div className="procurement-header reward-admin-header"><div><Heading>{notices ? '返饋金通知紀錄' : '返饋金財務對帳'}</Heading><p>{notices ? '查看提領通知的發送狀態，必要時可重試或補發通知。' : '檢查返饋帳務是否有異常，供人工查核，不會自動更改金額。'}</p></div>
      {!notices && canManage && <button type="button" className="reward-button reward-button--primary reward-reconciliation-run" disabled={busy} onClick={() => { if (window.confirm('執行全範圍返饋對帳？只寫入對帳及異常紀錄，不改帳。')) request({ type: 'run' }); }}>執行財務對帳</button>}
    </div>
    <div className="reward-actions">{!embedded&&<button className="reward-button" onClick={() => setRevision(v => v + 1)}>重新整理</button>}
      {pending.current && <button className="reward-button" disabled={busy} onClick={execute}>重送原操作</button>}
    </div>
    {error && <p className="reward-message" role="alert">{error}</p>}
    {data && notices && <>
      {data.summary && <p className="reward-meta">待發／重試 {(data.summary.counts?.pending || 0) + (data.summary.counts?.retry || 0)} · 待查核／設定 {(data.summary.counts?.unknown || 0) + (data.summary.counts?.blocked || 0)} · 最近派送嘗試 {data.summary.last_dispatch_attempt || '—'}</p>}
      {(data.notifications || []).map(n => <article className="reward-card reward-notice" key={n.id}>
        <div className="reward-notice-summary">
          <div className="reward-notice-event"><h3>{events[n.event_type] || n.event_type}</h3><span className="reward-status">{statuses[n.status] || n.status}</span></div>
          <div className="reward-notice-recipient">{n.audience === 'admin' ? '管理員' : '老師'} · {n.recipient_mask || '待確認收件方式'} · {n.channel?.toUpperCase() || '尚未選擇管道'}</div>
          <div className="reward-meta">最後嘗試 {noticeTime(n.last_attempt_at)}</div>
        </div>
        <details className="reward-details reward-notice-details"><summary>詳細資料與重試紀錄</summary>
          <p className="reward-meta">提領 {n.withdrawal_id} · 版本 {n.version}</p>
          <p>LINE 嘗試 {n.line_attempts} 次 · Email 嘗試 {n.email_attempts} 次</p>
          <p className="reward-meta">下次重試 {noticeTime(n.next_retry_at)} · 錯誤分類 {n.last_error || '—'}</p>
          {(data.attempts || []).filter(a => a.notification_id === n.id).map((a, i) => <p className="reward-meta" key={i}>{noticeTime(a.created_at)} · {a.action.startsWith('manual:') ? '人工補發' : a.action} · {a.result || '處理中'}</p>)}
        </details>
        {canManage && ['sent','failed','blocked','retry','unknown'].includes(n.status) && <div className="reward-actions reward-notice-actions">
          {['failed', 'blocked', 'retry'].includes(n.status) && <button className="reward-button" disabled={busy} onClick={() => supplement(n, false)}>重試原通知</button>}
          {['sent', 'failed', 'blocked', 'unknown'].includes(n.status) && <button className="reward-button" disabled={busy} onClick={() => supplement(n, true)}>確認另寄新版本</button>}
        </div>}
      </article>)}
      {canManage && (data.corrections || []).map(e => <article className="reward-card" key={e.id}><h3>更正通知待選擇</h3><p>提領 {e.withdrawal_id} · {e.created_at}</p><button className="reward-button" disabled={busy} onClick={() => { if (window.confirm('另發更正說明？不轉述內部備註、不變更原匯款結果。')) request({ type: 'correction', id: e.id }); }}>確認發送更正說明</button></article>)}
    </>}
    {data && !notices && <>
      {(data.runs || []).map(r => <article className="reward-card" key={r.id}><h3>對帳 {noticeTime(r.snapshot_at)}</h3><p>範圍：{r.scope==='all_reward_finances'?'全部師資返饋帳務':r.scope} · {r.status === 'failed' ? `執行失敗（${r.error_code}），未解除既有異常` : `檢查 ${r.checked_count} 筆 · 異常／待查核 ${r.finding_count} 筆`}</p></article>)}
      {(data.findings || []).map(f => <article className="reward-card" key={f.id}>
        <div className="reward-heading"><h3>{reconciliationRules[f.rule]?.[0]||'其他帳務異常'}</h3><span className="reward-status">{f.present ? '待人工查核' : '本次已未再發現'}</span></div>
        <p>{reconciliationRules[f.rule]?.[1]||'請查看技術明細並交由管理員查核。'}</p>
        <p className="reward-meta">來源識別碼 {f.source}</p>
        <div className="reward-reconciliation-values">{[['預期應有資料',f.expected],['目前實際資料',f.actual]].map(([title,fields])=><section key={title} aria-label={title}><h4>{title}</h4><dl>{reconciliationFields(f.rule,fields).map(field=><div key={field.key}><dt>{field.label}</dt><dd>{field.text}</dd></div>)}</dl></section>)}</div>
        <p className="reward-meta">首次發現 {noticeTime(f.first_seen_at)} · 最後發現 {noticeTime(f.last_seen_at)}</p>
        <details className="reward-details"><summary>技術明細</summary><p className="reward-meta">異常代碼：{f.rule}</p><p className="reward-meta">預期原始資料：{JSON.stringify(f.expected)}<br/>實際原始資料：{JSON.stringify(f.actual)}</p></details>
      </article>)}
      <p className="reward-meta">無法確認付款或匯款結果時，先查帳，不透過此頁退款或再次匯款。</p>
    </>}
    {data && <div className="reward-pager"><button className="reward-button" disabled={offset === 0 || busy} onClick={() => setOffset(Math.max(0, offset - 20))}>上一頁</button><button className="reward-button" disabled={offset + 20 >= data.total || busy} onClick={() => setOffset(offset + 20)}>下一頁</button></div>}
  </div>;
}
