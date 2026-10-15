import './InstructorRewards.css';
import React,{useEffect,useRef,useState} from 'react';
import {getMyWithdrawals,quoteMyWithdrawal,requestMyWithdrawal,bankRequest} from '../../services/rewardWithdrawals.js';
const labels={pending:'待匯款',processing:'處理中',paid:'已匯款',failed:'明確失敗',unknown:'待查帳'};
export const withdrawalStatus=value=>labels[value]||value;
const emptyBank={bank_code:'',bank_name:'',branch:'',holder:'',account:''};
const fields={bank_code:'銀行代碼',bank_name:'銀行名稱',branch:'分行名稱',holder:'收款戶名',account:'收款帳號'};
export default function RewardWithdrawalsPanel({userId}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[offset,setOffset]=useState(0),[bank,setBank]=useState(emptyBank),[busy,setBusy]=useState(false);
 const lock=useRef(false),retry=useRef(null);
 const [editingBank,setEditingBank]=useState(false);
 useEffect(()=>{let alive=true;setData(null);getMyWithdrawals(offset).then(d=>{if(alive)setData(d);}).catch(e=>{if(alive)setError(e.code==='PGRST202'?'提領功能尚未安裝。':e.message||'提領資料讀取失敗');});return()=>{alive=false;};},[userId,offset,revision]);
 useEffect(()=>{setBank(emptyBank);setEditingBank(false);retry.current=null;},[userId]);
 useEffect(()=>{const focus=()=>{setBank(emptyBank);setRevision(r=>r+1);};window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[]);
 async function operation(fn){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();setRevision(r=>r+1);}catch(e){setError(e.message||'操作失敗，請重新確認');if(/^(22|23|40|42|55|P0002)/.test(e.code||''))retry.current=null;setRevision(r=>r+1);}finally{lock.current=false;setBusy(false);}}
 return <section aria-label="返饋金提領" className="reward-view reward-subsection">
 <div className="reward-heading"><h3>銀行資料與返饋金提領</h3><button className="reward-button" type="button" onClick={()=>setRevision(r=>r+1)}>重新整理提領</button></div>
 {error&&<p role="alert" className="reward-message">{error}</p>}
 {data&&<>
 <div className="reward-metrics">
 {[['帳戶餘額',data.balance],['可用餘額',data.available_balance],['購物保留',data.shopping_reserved_balance],['提領保留',data.withdrawal_reserved_balance]].map(([label,value])=><div className="reward-metric" key={label}><span>{label}</span><strong>NT$ {Number(value).toLocaleString('zh-TW')}</strong></div>)}
 </div>
 <h4>收款銀行</h4><p className="reward-note">銀行資料僅用於返饋金提領。</p>
 <div className="reward-bank-info reward-bank-current"><div><span>目前收款資料</span><strong>{data.bank?`${data.bank.masked.bank_name} ${data.bank.masked.branch} ${data.bank.masked.holder} ${data.bank.masked.account}`:'尚未設定收款銀行'}</strong></div><button className="reward-button" type="button" disabled={busy} aria-expanded={editingBank} aria-controls="reward-bank-edit-form" onClick={()=>{setBank(emptyBank);setEditingBank(value=>!value);}}>{editingBank?'取消編輯':'編輯'}</button></div>
 {editingBank&&<form id="reward-bank-edit-form" onSubmit={e=>{e.preventDefault();operation(async()=>{await bankRequest('save',{bank,expectedVersion:data.bank?.version||0});setBank(emptyBank);setEditingBank(false);});}} autoComplete="off">
 <div className="reward-form-grid">{Object.entries(fields).map(([key,label])=><label className={`reward-field ${key==='account'?'reward-field--wide':''}`} key={key}><span>{label}</span><input required aria-label={label} autoComplete="off" inputMode={['bank_code','account'].includes(key)?'numeric':undefined} value={bank[key]} maxLength={key==='bank_code'?3:key==='account'?20:80} onChange={e=>setBank({...bank,[key]:e.target.value})}/></label>)}</div>
 <button className="reward-button reward-button--primary" disabled={busy} type="submit">儲存收款銀行</button></form>}
 <div className="reward-subsection"><h4>申請提領</h4>
 <div className="reward-withdrawal-summary">{[['本次可提領',data.available_balance],['手續費',15],['預計實際匯款',Math.max(0,data.available_balance-15)]].map(([label,value])=><div key={label}><span>{label}</span><strong>NT$ {Number(value).toLocaleString('zh-TW')}</strong></div>)}</div>
 <p className="reward-note">每次全額提領，成立後不可自行取消。</p>
 <button className="reward-button reward-button--primary" type="button" disabled={busy||(!retry.current&&(!data.bank||data.available_balance<=15))} onClick={()=>operation(async()=>{
 if(!retry.current){const quote=await quoteMyWithdrawal();if(!window.confirm(`全額提領 NT$${quote.amount}，手續費 NT$15，實匯 NT$${quote.net_amount}，預計 ${quote.scheduled_date}。收款帳號 ${quote.bank.account}。成立後不可取消，請確認。`))return;retry.current={key:crypto.randomUUID(),quote};}
 const pending=retry.current;await requestMyWithdrawal(pending.key,pending.quote);retry.current=null;
 })}>{retry.current?'重查提領申請結果':'申請全額提領'}</button>
 <p className="reward-note">每月10日00:00（台北時間）起申請列入下月。預計匯款日固定顯示該批次10日；遇假日由管理員人工順延，批次名單不變。</p></div>
 <div className="reward-subsection"><h4>歷史提領</h4>{!data.withdrawals.length&&<p className="reward-empty">尚無提領紀錄。</p>}
 {data.withdrawals.map(w=><article key={w.id} className="reward-entry">
 <div className="reward-heading"><div className="reward-meta">{w.id}</div><span className="reward-status">{withdrawalStatus(w.status)}</span></div>
 <p className="reward-meta">預計匯款 {w.scheduled_date}</p><p>申請 NT$ {w.amount} · 手續費 NT$ {w.fee} · 預計實匯 NT$ {w.net_amount} · 已收手續費 NT$ {w.fee_charged}</p><p>{w.bank.bank_name} {w.bank.branch} {w.bank.holder} {w.bank.account}</p>{w.transfer_date&&<p>實際匯款 {w.transfer_date} · {w.reference}</p>}{w.failure_reason&&<p>{w.failure_reason}</p>}
 </article>)}<div className="reward-pager"><button className="reward-button" type="button" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>提領上一頁</button><button className="reward-button" type="button" disabled={offset+20>=data.total} onClick={()=>setOffset(offset+20)}>提領下一頁</button></div></div>
 </>}
 </section>;
}
