import React,{useEffect,useState} from 'react';
import {getAdminRewardAccounts} from '../../services/instructorRewards.js';
import InstructorRewardsPanel from '../../components/account/InstructorRewardsPanel.jsx';
const buttonStyle={padding:'9px 14px',border:'1px solid var(--border)',background:'var(--white)',color:'var(--dark)',fontFamily:'inherit',cursor:'pointer'};
export default function InstructorRewardsPage({adminUserId}){
  const [data,setData]=useState(null),[error,setError]=useState(''),[offset,setOffset]=useState(0),[selected,setSelected]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{
    let alive=true;setData(null);setError('');setSelected('');
    getAdminRewardAccounts(offset).then(value=>{if(alive)setData(value);}).catch(e=>{if(alive)setError(e.code==='PGRST202'?'返饋查詢尚未安裝。':e.message||'返饋帳戶暫時無法載入。');});
    return()=>{alive=false;};
  },[adminUserId,offset,revision]);
  useEffect(()=>{const focus=()=>setRevision(r=>r+1);window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[]);
  return <div><h1>師資返饋帳務</h1>
    <button style={buttonStyle} type="button" onClick={()=>setRevision(r=>r+1)}>重新整理帳戶</button>
    {error&&<p role="alert">{error}</p>}
    {!data&&!error&&<p>正在載入返饋帳戶…</p>}
    {data&&<>
      {!data.accounts.length&&<p>目前沒有師資帳戶。</p>}
      <div style={{display:'flex',flexWrap:'wrap',gap:12,margin:'20px 0'}}>{data.accounts.map(account=><button type="button" key={account.id} onClick={()=>setSelected(account.id)} aria-pressed={selected===account.id} style={{...buttonStyle,padding:16,maxWidth:'100%',overflowWrap:'anywhere',textAlign:'left'}}>
        <strong>{account.name||'已刪除會員'}</strong><div>{account.id}</div>
        <div>餘額 NT$ {Number(account.balance).toLocaleString('zh-TW')} · 待入帳 NT$ {Number(account.pending_balance).toLocaleString('zh-TW')}</div>
        <div>有效綁定學生 {account.student_count} 位{account.account_status==='closed'?' · 帳戶已關閉':''}{account.inconsistent?' · 帳務需查核':''}{Number(account.exception_count)>0?` · 付款異常 ${account.exception_count} 筆`:''}</div>
      </button>)}</div>
      <button style={buttonStyle} type="button" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>上一頁帳戶</button>
      <button style={buttonStyle} type="button" disabled={offset+20>=data.total} onClick={()=>setOffset(offset+20)}>下一頁帳戶</button>
      {selected&&<InstructorRewardsPanel key={selected} userId={adminUserId} instructorId={selected} admin/>}
    </>}
  </div>;
}
