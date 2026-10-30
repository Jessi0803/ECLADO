import React,{useEffect,useRef,useState} from 'react';
import {getAdminRewardAccounts,getAdminRewardPurchaseSales} from '../../services/instructorRewards.js';
import {PurchaseSalesSummary,purchaseSalesError,taipeiPurchasePeriod} from '../components/RewardPurchaseSales.jsx';
import InstructorRewardsPanel from '../../components/account/InstructorRewardsPanel.jsx';
import usePanelHistory from '../hooks/usePanelHistory.js';
import RewardRedemptionExport from '../components/RewardRedemptionExport.jsx';
export default function InstructorRewardsPage({adminUserId,embedded=false,refreshVersion=0}){
  const Heading=embedded?'h2':'h1';
  const [data,setData]=useState(null),[error,setError]=useState(''),[offset,setOffset]=useState(0),[selected,setSelected]=useState(''),[revision,setRevision]=useState(0);
  const dialogRef=useRef(null),triggerRef=useRef(null);
  const [purchases,setPurchases]=useState(null),[purchaseError,setPurchaseError]=useState('');
  const closeDetails=usePanelHistory(!!selected,()=>setSelected(''));
  useEffect(()=>{
    if(!selected)return;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    dialogRef.current?.focus({preventScroll:true});
    const keydown=event=>{
      if(event.key==='Escape'){event.preventDefault();closeDetails();}
      if(event.key!=='Tab')return;
      const panel=dialogRef.current;
      const controls=[...(panel?.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')||[])].filter(el=>el.getClientRects().length);
      const first=controls[0],last=controls.at(-1);
      if(!first){event.preventDefault();panel?.focus();return;}
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel)){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===panel)){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',keydown);
    return()=>{document.body.style.overflow=previousOverflow;document.removeEventListener('keydown',keydown);if(triggerRef.current?.isConnected)triggerRef.current.focus({preventScroll:true});};
  },[selected,closeDetails]);
  useEffect(()=>{
    let alive=true;setData(null);setError('');setSelected('');setPurchases(null);setPurchaseError('');
    getAdminRewardAccounts(offset).then(async value=>{
      if(!alive)return;setData(value);
      if(!value.accounts.length){setPurchases([]);return;}
      try{const result=await getAdminRewardPurchaseSales(value.accounts.map(a=>a.id),taipeiPurchasePeriod().year);if(alive)setPurchases(result.accounts);}
      catch(e){if(alive)setPurchaseError(purchaseSalesError(e));}
    }).catch(e=>{if(alive)setError(e.code==='PGRST202'?'返饋查詢尚未安裝。':e.message||'返饋帳戶暫時無法載入。');});
    return()=>{alive=false;};
  },[adminUserId,offset,revision,refreshVersion]);
  useEffect(()=>{const focus=()=>setRevision(r=>r+1);window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[]);
  return <div className="reward-view"><div className="procurement-header reward-admin-header"><div><Heading>師資返饋帳務</Heading><p>查看老師的返饋餘額、學生訂單與帳務紀錄。</p></div>{!embedded&&<button className="admin-secondary-btn" type="button" onClick={()=>setRevision(r=>r+1)}>重新整理帳戶</button>}</div>
    {error&&<p role="alert" className="reward-message">{error}</p>}
    <RewardRedemptionExport key={adminUserId}/>
    {!data&&!error&&<p>正在載入返饋帳戶…</p>}
    {data&&<>
      {!data.accounts.length&&<p>目前沒有師資帳戶。</p>}
      <div className="reward-account-list">{data.accounts.map(account=><button type="button" key={account.id} onClick={event=>{triggerRef.current=event.currentTarget;setSelected(account.id);}} aria-haspopup="dialog" aria-expanded={selected===account.id} className="reward-account-card">
        <strong>{account.name||'已刪除會員'}</strong><div className="reward-meta">{account.id}</div>
        <div>餘額 NT$ {Number(account.balance).toLocaleString('zh-TW')} · 待入帳 NT$ {Number(account.pending_balance).toLocaleString('zh-TW')}</div>
        <div>有效綁定學生 {account.student_count} 位{account.account_status==='closed'?' · 帳戶已關閉':''}{account.inconsistent?' · 帳務需查核':''}{Number(account.exception_count)>0?` · 付款異常 ${account.exception_count} 筆`:''}</div>
        <PurchaseSalesSummary data={purchases?.find(row=>row.id===account.id)} error={purchaseError||(purchases&&!purchases.some(row=>row.id===account.id)?'找不到師資叫貨統計。':'')}/>
      </button>)}</div>
      <div className="reward-pager"><button className="reward-button" type="button" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>上一頁帳戶</button>
      <button className="reward-button" type="button" disabled={offset+20>=data.total} onClick={()=>setOffset(offset+20)}>下一頁帳戶</button></div>
      {selected&&<>
        <button type="button" className="detail-panel-backdrop" aria-label="關閉師資帳務遮罩" tabIndex={-1} onClick={closeDetails}/>
        <div ref={dialogRef} className="detail-panel detail-panel-wide reward-account-drawer" role="dialog" aria-modal="true" aria-label="師資返饋帳務明細" tabIndex={-1}>
          <div className="reward-heading"><div><button type="button" className="detail-panel-mobile-back" onClick={closeDetails}>← 返回</button><h3>{data.accounts.find(account=>account.id===selected)?.name||'已刪除會員'} · 返饋帳務</h3></div><button type="button" className="reward-button" aria-label="關閉師資帳務明細" onClick={closeDetails}>×</button></div>
          <InstructorRewardsPanel key={selected} userId={adminUserId} instructorId={selected} hideRefresh={embedded} admin/>
        </div>
      </>}
    </>}
  </div>;
}
