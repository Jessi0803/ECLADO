import '../../components/account/InstructorRewards.css';
import React,{useEffect,useRef,useState} from 'react';
import {getAdminWithdrawals,manageWithdrawal,bankRequest} from '../../services/rewardWithdrawals.js';
import {withdrawalStatus} from '../../components/account/RewardWithdrawalsPanel.jsx';
export default function RewardWithdrawalsPage({adminUserId,canManage,embedded=false}){
 const Heading=embedded?'h2':'h1';
 const [data,setData]=useState(null),[error,setError]=useState(''),[offset,setOffset]=useState(0),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[revealed,setRevealed]=useState(null);
 const lock=useRef(false),pending=useRef(null);
 useEffect(()=>{let alive=true;setData(null);setRevealed(null);getAdminWithdrawals(offset).then(v=>{if(alive)setData(v);}).catch(e=>{if(alive)setError(e.code==='PGRST202'?'提領管理尚未安裝。':e.message);});return()=>{alive=false;};},[adminUserId,offset,revision]);
 useEffect(()=>{pending.current=null;},[adminUserId]);
 useEffect(()=>{const focus=()=>{setRevealed(null);setRevision(r=>r+1);};window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[]);
 async function run(fn,refresh=true){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();if(refresh)setRevision(r=>r+1);}catch(e){setRevealed(null);setError(e.message||'提領操作失敗');}finally{lock.current=false;setBusy(false);}}
 async function action(w,type){
 if(pending.current){setError('尚有結果未確認的操作，請先重送原結果或查帳，勿重新匯款。');return;}
 let details={};if(type==='paid'){
 const date=window.prompt('實際匯款日期（YYYY-MM-DD）');if(!date)return;
 const reference=window.prompt('銀行交易序號');if(!reference)return;
 const amount=window.prompt('銀行實際匯款金額',String(w.net_amount));if(amount===null)return;
 details={transfer_date:date,reference,amount:Number(amount)};
 }else if(['failed','unknown','correction'].includes(type)){
 const reason=window.prompt(type==='correction'?'更正／異常原因（不覆寫原憑證、不自動重匯）':'原因（勿輸入完整帳號等個資）');if(!reason)return;
 details={reason};if(type==='failed'){if(!window.confirm('已查明銀行未付款，失敗後全額退回且原申請不可重匯？'))return;details.confirmed_unpaid=true;}
 }
 pending.current={id:w.id,key:crypto.randomUUID(),type,version:w.version,details};await resend();
 }
 async function resend(){await run(async()=>{const p=pending.current;if(!p)return;try{await manageWithdrawal(p.id,p.key,p.type,p.version,p.details);pending.current=null;}catch(e){if(/^(22|23|40|42|55|P0002)/.test(e.code||''))pending.current=null;throw e;}});}
 return <div className="reward-view"><div className="procurement-header reward-admin-header"><div><Heading>師資提領管理</Heading><p>實際匯款於銀行端人工執行。預計日期固定為名目批次的每月 10 日；遇假日由管理員人工順延，原批次名單不變。結果不明請查帳，勿再次匯款。</p></div></div>
 <button className="reward-button" type="button" onClick={()=>setRevision(r=>r+1)}>重新整理提領管理</button>{pending.current&&<button className="reward-button" type="button" disabled={busy} onClick={resend}>重送原處理結果</button>}{error&&<p role="alert" className="reward-message">{error}</p>}
 {data&&<>{data.withdrawals.map(w=><article key={w.id} className="reward-card">
 <div className="reward-heading"><h3>{w.name||'已刪除會員'}</h3><span className="reward-status">{withdrawalStatus(w.status)}</span></div><p className="reward-meta">{w.id} · 申請 {w.created_at} · 預計 {w.scheduled_date}</p><p>申請 NT$ {w.amount} · 手續費 NT$ {w.fee} · 實匯 NT$ {w.net_amount}</p><p>{w.bank.bank_name} {w.bank.branch} {w.bank.holder} {w.bank.account}</p>
 {canManage&&<div className="reward-actions"><button className="reward-button" type="button" disabled={busy} onClick={()=>run(async()=>{const v=await bankRequest('snapshot',{withdrawalId:w.id});setRevealed({id:w.id,bank:v.bank});},false)}>查看匯款銀行快照</button>
 {revealed?.id===w.id&&<div className="reward-bank-info reward-field--wide"><p>{revealed.bank.bank_name} {revealed.bank.branch} {revealed.bank.holder} {revealed.bank.account}</p><button className="reward-button" type="button" onClick={()=>setRevealed(null)}>隱藏銀行資料</button></div>}
 {w.status==='pending'&&<button className="reward-button" type="button" disabled={busy} onClick={()=>action(w,'claim')}>領取處理</button>}
 {['processing','unknown'].includes(w.status)&&w.processor_id===adminUserId&&<>{['paid','failed','unknown'].map(type=><button className="reward-button" type="button" disabled={busy} key={type} onClick={()=>action(w,type)}>{type==='paid'?'記錄已匯款':type==='failed'?'確認未付款並退回':'標記待查帳'}</button>)}</>}
 {['paid','failed'].includes(w.status)&&<button className="reward-button" type="button" disabled={busy} onClick={()=>action(w,'correction')}>追加更正紀錄</button>}
 </div>}{w.transfer_date&&<p>實際匯款 {w.transfer_date} · {w.reference} · NT$ {w.transferred_amount}</p>}{w.failure_reason&&<p>{w.failure_reason}</p>}
 {w.events.map((e,i)=><p className="reward-meta" key={i}>{e.at} · {e.type}{e.details?.reason?` · ${e.details.reason}`:''}</p>)}
 </article>)}<div className="reward-pager"><button className="reward-button" disabled={offset===0} type="button" onClick={()=>setOffset(Math.max(0,offset-20))}>管理提領上一頁</button><button className="reward-button" disabled={offset+20>=data.total} type="button" onClick={()=>setOffset(offset+20)}>管理提領下一頁</button></div>
 </>}
 </div>;
}
