import React,{useEffect,useState} from 'react';
import {getAdminRewardAccounts} from '../../services/instructorRewards.js';
import InstructorRewardsPanel from '../../components/account/InstructorRewardsPanel.jsx';
export default function InstructorRewardsPage({adminUserId,embedded=false}){
  const Heading=embedded?'h2':'h1';
  const [data,setData]=useState(null),[error,setError]=useState(''),[offset,setOffset]=useState(0),[selected,setSelected]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{
    let alive=true;setData(null);setError('');setSelected('');
    getAdminRewardAccounts(offset).then(value=>{if(alive)setData(value);}).catch(e=>{if(alive)setError(e.code==='PGRST202'?'返饋查詢尚未安裝。':e.message||'返饋帳戶暫時無法載入。');});
    return()=>{alive=false;};
  },[adminUserId,offset,revision]);
  useEffect(()=>{const focus=()=>setRevision(r=>r+1);window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[]);
  return <div className="reward-view"><div className="procurement-header reward-admin-header"><div><Heading>師資返饋帳務</Heading><p>查看師資帳戶、歷史學生訂單及返饋異動。</p></div><button className="admin-secondary-btn" type="button" onClick={()=>setRevision(r=>r+1)}>重新整理帳戶</button></div>
    {error&&<p role="alert" className="reward-message">{error}</p>}
    {!data&&!error&&<p>正在載入返饋帳戶…</p>}
    {data&&<>
      {!data.accounts.length&&<p>目前沒有師資帳戶。</p>}
      <div className="reward-account-list">{data.accounts.map(account=><button type="button" key={account.id} onClick={()=>setSelected(account.id)} aria-pressed={selected===account.id} className="reward-account-card">
        <strong>{account.name||'已刪除會員'}</strong><div className="reward-meta">{account.id}</div>
        <div>餘額 NT$ {Number(account.balance).toLocaleString('zh-TW')} · 待入帳 NT$ {Number(account.pending_balance).toLocaleString('zh-TW')}</div>
        <div>有效綁定學生 {account.student_count} 位{account.account_status==='closed'?' · 帳戶已關閉':''}{account.inconsistent?' · 帳務需查核':''}{Number(account.exception_count)>0?` · 付款異常 ${account.exception_count} 筆`:''}</div>
      </button>)}</div>
      <div className="reward-pager"><button className="reward-button" type="button" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>上一頁帳戶</button>
      <button className="reward-button" type="button" disabled={offset+20>=data.total} onClick={()=>setOffset(offset+20)}>下一頁帳戶</button></div>
      {selected&&<InstructorRewardsPanel key={selected} userId={adminUserId} instructorId={selected} admin/>}
    </>}
  </div>;
}
