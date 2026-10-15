import './InstructorRewards.css';
import React,{useEffect,useRef,useState} from 'react';
import {getMyWithdrawals,quoteMyWithdrawal,requestMyWithdrawal,bankRequest} from '../../services/rewardWithdrawals.js';
const labels={pending:'待匯款',processing:'處理中',paid:'已匯款',failed:'明確失敗',unknown:'待查帳'};
const teacherLabels={...labels,failed:'匯款失敗（已全額退回）',unknown:'匯款結果確認中'};
export const withdrawalStatus=(value,teacher=false)=>(teacher?teacherLabels:labels)[value]||value;
const money=value=>`NT$ ${Number(value).toLocaleString('zh-TW')}`;
function WithdrawalConfirmation({quote,busy,onClose,onConfirm,returnFocus}){
 const dialog=useRef(null);
 useEffect(()=>{const node=dialog.current;const overflow=document.body.style.overflow;node.showModal();document.body.style.overflow='hidden';return()=>{node.close();document.body.style.overflow=overflow;returnFocus.current?.focus();};},[]);
 return <dialog ref={dialog} className="reward-withdrawal-dialog reward-view" aria-labelledby="reward-withdrawal-confirm-title" aria-describedby="reward-withdrawal-confirm-note" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
 <h3 id="reward-withdrawal-confirm-title">確認全額提領</h3>
 <p id="reward-withdrawal-confirm-note">請核對金額與收款資料，申請成立後無法自行取消。</p>
 <dl className="reward-confirm-fields">{[['申請金額',money(quote.amount)],['手續費',money(quote.fee)],['實際匯款金額',money(quote.net_amount)],['預計匯款日期',quote.scheduled_date],['銀行代碼',quote.bank.bank_code],['銀行名稱',quote.bank.bank_name],['分行名稱',quote.bank.branch],['收款戶名',quote.bank.holder],['收款帳號（末四碼）',quote.bank.account]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
 <p className="reward-note">帳號與戶名已遮蔽。遇假日由管理員順延匯款；申請後修改銀行資料，不會變更這筆申請的收款帳戶。</p>
 <div className="reward-actions"><button autoFocus className="reward-button" type="button" disabled={busy} onClick={onClose}>返回修改</button><button className="reward-button reward-button--primary" type="button" disabled={busy} onClick={onConfirm}>確認申請提領</button></div>
 </dialog>;
}
const emptyBank={bank_code:'',bank_name:'',branch:'',holder:'',account:''};
const fields={bank_code:'銀行代碼',bank_name:'銀行名稱',branch:'分行名稱',holder:'收款戶名',account:'收款帳號'};
export default function RewardWithdrawalsPanel({userId}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[offset,setOffset]=useState(0),[bank,setBank]=useState(emptyBank),[busy,setBusy]=useState(false);
 const lock=useRef(false),retry=useRef(null),withdrawButton=useRef(null);
 const [editingBank,setEditingBank]=useState(false),[confirmation,setConfirmation]=useState(null);
 useEffect(()=>{let alive=true;setData(null);getMyWithdrawals(offset).then(d=>{if(alive)setData(d);}).catch(e=>{if(alive)setError(e.code==='PGRST202'?'提領功能尚未安裝。':e.message||'提領資料讀取失敗');});return()=>{alive=false;};},[userId,offset,revision]);
 useEffect(()=>{setBank(emptyBank);setEditingBank(false);setConfirmation(null);retry.current=null;},[userId]);
 useEffect(()=>{const focus=()=>{setConfirmation(null);setBank(emptyBank);setRevision(r=>r+1);};window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[]);
 async function operation(fn,refresh=true){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();if(refresh)setRevision(r=>r+1);}catch(e){setError(e.message||'操作失敗，請重新確認');if(/^(22|23|40|42|55|P0002)/.test(e.code||''))retry.current=null;setRevision(r=>r+1);}finally{lock.current=false;setBusy(false);}}
 async function submitWithdrawal(){await operation(async()=>{const pending=retry.current;if(!pending)return;await requestMyWithdrawal(pending.key,pending.quote);retry.current=null;});}
 const disabledReasons=data&&!retry.current?[...(!data.bank?['請先設定收款銀行，才能申請提領。']:[]),...(data.available_balance<=15?['可用返饋金須超過 NT$15，才能申請提領（每次手續費 NT$15）。']:[])]:[];
 return <section aria-label="返饋金提領" className="reward-view reward-subsection">
 <div className="reward-heading"><h3>銀行資料與返饋金提領</h3><button className="reward-button" type="button" onClick={()=>setRevision(r=>r+1)}>重新整理提領</button></div>
 {error&&<p role="alert" className="reward-message">{error}</p>}
 {data&&<>
 <div className="reward-metrics">
 {[['帳戶餘額',data.balance],['可用餘額',data.available_balance],['購物付款處理中',data.shopping_reserved_balance],['提領處理中',data.withdrawal_reserved_balance]].map(([label,value])=><div className="reward-metric" key={label}><span>{label}</span><strong>NT$ {Number(value).toLocaleString('zh-TW')}</strong></div>)}
 </div>
 <h4>收款銀行</h4><p className="reward-note">銀行資料僅用於返饋金提領。修改後僅適用於新申請，不影響已送出的提領申請。</p>
 <div className="reward-bank-info reward-bank-current"><div><span>目前收款資料</span><strong>{data.bank?`${data.bank.masked.bank_name} ${data.bank.masked.branch} ${data.bank.masked.holder} ${data.bank.masked.account}`:'尚未設定收款銀行'}</strong></div><button className="reward-button" type="button" disabled={busy} aria-expanded={editingBank} aria-controls="reward-bank-edit-form" onClick={()=>{setBank(emptyBank);setEditingBank(value=>!value);}}>{editingBank?'取消編輯':'編輯'}</button></div>
 {editingBank&&<form id="reward-bank-edit-form" onSubmit={e=>{e.preventDefault();operation(async()=>{await bankRequest('save',{bank,expectedVersion:data.bank?.version||0});setBank(emptyBank);setEditingBank(false);});}} autoComplete="off">
 <div className="reward-form-grid">{Object.entries(fields).map(([key,label])=><label className={`reward-field ${key==='account'?'reward-field--wide':''}`} key={key}><span>{label}</span><input required aria-label={label} autoComplete="off" inputMode={['bank_code','account'].includes(key)?'numeric':undefined} value={bank[key]} maxLength={key==='bank_code'?3:key==='account'?20:80} onChange={e=>setBank({...bank,[key]:e.target.value})}/></label>)}</div>
 <button className="reward-button reward-button--primary" disabled={busy} type="submit">儲存收款銀行</button></form>}
 <div className="reward-subsection"><h4>申請提領</h4>
 <div className="reward-withdrawal-summary">{[['本次可提領',data.available_balance],['手續費',15],['預計實際匯款',Math.max(0,data.available_balance-15)]].map(([label,value])=><div key={label}><span>{label}</span><strong>NT$ {Number(value).toLocaleString('zh-TW')}</strong></div>)}</div>
 <p className="reward-note">每次全額提領，成立後不可自行取消。</p>
 <button className="reward-button reward-button--primary" type="button" ref={withdrawButton} aria-describedby={disabledReasons.length?'reward-withdrawal-disabled':undefined} disabled={busy||disabledReasons.length>0} onClick={()=>{if(retry.current){submitWithdrawal();}else{operation(async()=>setConfirmation(await quoteMyWithdrawal()),false);}}}>{busy?'處理中…':retry.current?'重查提領申請結果':'申請全額提領'}</button>
 {disabledReasons.length>0&&<div id="reward-withdrawal-disabled" className="reward-note">{disabledReasons.map(reason=><p key={reason}>{reason}</p>)}</div>}
 <p className="reward-note">每月10日00:00（台北時間）起申請列入下月。預計匯款日固定顯示該批次10日；遇假日由管理員人工順延，批次名單不變。</p></div>
 <div className="reward-subsection"><h4>歷史提領</h4>{!data.withdrawals.length&&<p className="reward-empty">尚無提領紀錄。</p>}
 {data.withdrawals.map(w=><article key={w.id} className="reward-entry">
 <div className="reward-heading"><div className="reward-meta">{w.id}</div><span className="reward-status">{withdrawalStatus(w.status,true)}</span></div>
 <p className="reward-meta">預計匯款 {w.scheduled_date}</p><p>申請 NT$ {w.amount} · 手續費 NT$ {w.fee} · 預計實匯 NT$ {w.net_amount} · 已收手續費 NT$ {w.fee_charged}</p><p>{w.bank.bank_name} {w.bank.branch} {w.bank.holder} {w.bank.account}</p>{w.transfer_date&&<p>實際匯款 {w.transfer_date} · {w.reference}</p>}{w.failure_reason&&<p>{w.failure_reason}</p>}
 </article>)}<div className="reward-pager"><button className="reward-button" type="button" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>提領上一頁</button><button className="reward-button" type="button" disabled={offset+20>=data.total} onClick={()=>setOffset(offset+20)}>提領下一頁</button></div></div>
 </>}
 {confirmation&&<WithdrawalConfirmation returnFocus={withdrawButton} quote={confirmation} busy={busy} onClose={()=>setConfirmation(null)} onConfirm={()=>{if(lock.current||retry.current)return;retry.current={key:crypto.randomUUID(),quote:confirmation};setConfirmation(null);submitWithdrawal();}}/>}
 </section>;
}
