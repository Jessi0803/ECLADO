import '../../components/account/InstructorRewards.css';
import React,{useEffect,useRef,useState} from 'react';
import {getAdminWithdrawalQueue,manageWithdrawal,bankRequest,exportWithdrawalBatch} from '../../services/rewardWithdrawals.js';
import {withdrawalStatus} from '../../components/account/RewardWithdrawalsPanel.jsx';
import WithdrawalPaidDialog from '../components/WithdrawalPaidDialog.jsx';
export default function RewardWithdrawalsPage({adminUserId,canManage,embedded=false,refreshVersion=0}){
 const Heading=embedded?'h2':'h1';
 const [data,setData]=useState(null),[error,setError]=useState(''),[offset,setOffset]=useState(0),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[revealed,setRevealed]=useState(null);
 const lock=useRef(false),pending=useRef(null);
 const [filters,setFilters]=useState({batch:'',status:'',search:''}),[search,setSearch]=useState(''),[draft,setDraft]=useState(null),[paidOpen,setPaidOpen]=useState(false);
 const paidTrigger=useRef(null);
 useEffect(()=>{let alive=true;setData(null);setRevealed(null);setError('');getAdminWithdrawalQueue(offset,filters).then(v=>{if(alive)setData(v);}).catch(e=>{if(alive)setError(e.code==='PGRST202'?'提領管理查詢更新尚未安裝。':e.message);});return()=>{alive=false;};},[adminUserId,offset,revision,refreshVersion,filters]);
 useEffect(()=>{pending.current=null;setDraft(null);setPaidOpen(false);},[adminUserId]);
 useEffect(()=>{const focus=()=>{setRevealed(null);setRevision(r=>r+1);};window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[]);
 async function run(fn,refresh=true){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();if(refresh)setRevision(r=>r+1);}catch(e){setRevealed(null);setError(e.message||'提領操作失敗');}finally{lock.current=false;setBusy(false);}}
 async function action(w,type,details={}){
 if(pending.current){setError('尚有結果未確認的操作，請先重送原結果或查帳，勿重新匯款。');return;}
 if(['failed','unknown','correction'].includes(type)){
 const reason=window.prompt(type==='correction'?'更正／異常原因（不覆寫原憑證、不自動重匯）':'原因（勿輸入完整帳號等個資）');if(!reason)return;
 details={reason};if(type==='failed'){if(!window.confirm('已查明銀行未付款，失敗後全額退回且原申請不可重匯？'))return;details.confirmed_unpaid=true;}
 }
 pending.current={id:w.id,key:crypto.randomUUID(),type,version:w.version,details};await resend();
 }
 async function resend(){await run(async()=>{const p=pending.current;if(!p)return;try{await manageWithdrawal(p.id,p.key,p.type,p.version,p.details);pending.current=null;}catch(e){if(/^(22|23|40|42|55|P0002)/.test(e.code||''))pending.current=null;throw e;}});}
 function changeFilter(key,value){setOffset(0);setFilters(f=>({...f,[key]:value}));}
 async function download(){if(!filters.batch)return;await run(async()=>{const blob=await exportWithdrawalBatch(filters.batch),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`reward-withdrawals-${filters.batch}.csv`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);},false);}
 return <div className="reward-view"><div className="procurement-header reward-admin-header"><div><Heading>師資提領管理</Heading><p>處理提領申請並記錄人工匯款結果。每月 10 日為匯款批次，遇假日順延，名單不變；結果不明時請先查帳，勿重複匯款。</p></div></div>
 {!embedded&&<button className="reward-button" type="button" onClick={()=>setRevision(r=>r+1)}>重新整理提領管理</button>}{pending.current&&<button className="reward-button" type="button" disabled={busy} onClick={resend}>重送原處理結果</button>}{error&&<p role="alert" className="reward-message">{error}</p>}
 <form className="reward-withdrawal-filters" onSubmit={e=>{e.preventDefault();changeFilter('search',search.trim());}}>
 <label className="reward-field">匯款批次<select aria-label="匯款批次" value={filters.batch} onChange={e=>changeFilter('batch',e.target.value)}><option value="">全部批次</option>{(data?.batches||[filters.batch].filter(Boolean)).map(batch=><option key={batch} value={batch}>{batch}</option>)}</select></label>
 <label className="reward-field">申請狀態<select aria-label="申請狀態" value={filters.status} onChange={e=>changeFilter('status',e.target.value)}><option value="">全部狀態</option>{['pending','processing','paid','failed','unknown'].map(status=><option key={status} value={status}>{withdrawalStatus(status)}</option>)}</select></label>
 <label className="reward-field">老師姓名／申請編號<input value={search} maxLength={100} onChange={e=>setSearch(e.target.value)}/></label><button className="reward-button" type="submit">搜尋</button>
 </form>
 {(data?.batch_summary||canManage)&&<section className="reward-batch-summary" aria-label="匯款批次合計">
 {data?.batch_summary&&<><h3>{data.batch_summary.batch_date} 批次待處理合計</h3><div className="reward-withdrawal-summary">{[['筆數',data.batch_summary.count],['申請總額',data.batch_summary.amount],['手續費合計',data.batch_summary.fee],['預扣所得稅合計',data.batch_summary.income_tax??0],['二代健保合計',data.batch_summary.supplementary_premium??0],['實匯總額',data.batch_summary.net_amount]].map(([label,value])=><div key={label}><span>{label}</span><strong>{label==='筆數'?`${value} 筆`:`NT$ ${Number(value).toLocaleString('zh-TW')}`}</strong></div>)}</div><p className="reward-note">涵蓋本批次全部待匯款與處理中申請，不受列表姓名／狀態篩選影響；排除已匯款、失敗與待查帳。</p></>}
 {canManage&&<div className="reward-batch-export"><button className="reward-button" type="button" disabled={busy||!filters.batch||!data?.batch_summary?.count} onClick={download}>匯出本批次匯款 CSV</button><p className="reward-note">請先選擇批次。CSV 含完整銀行資料，僅供授權人員核對，不是銀行上傳檔；匯出不代表已領取或已匯款。帳號欄以文字保留前導 0，請妥善保管。</p></div>}
 </section>}
 {data&&<p className="reward-meta">符合篩選：{data.total} 筆</p>}
 {data&&!data.withdrawals.length&&<p className="reward-empty">沒有符合條件的提領申請。</p>}
 {data&&<>{data.withdrawals.map(w=><article key={w.id} className="reward-card">
 <div className="reward-heading"><h3>{w.name||'已刪除會員'}</h3><span className="reward-status">{withdrawalStatus(w.status)}</span></div><p className="reward-meta">{w.id} · 申請 {w.created_at} · 預計 {w.scheduled_date}</p><p>申請 NT$ {w.amount} · 手續費 NT$ {w.fee} · 預扣所得稅 NT$ {w.income_tax??0} · 二代健保 NT$ {w.supplementary_premium??0} · 實匯 NT$ {w.net_amount}</p><p>{w.bank.bank_code} {w.bank.bank_name} · {w.bank.branch} · {w.bank.holder} · {w.bank.account}</p>
 {canManage&&<div className="reward-actions"><button className="reward-button" type="button" disabled={busy} onClick={()=>run(async()=>{const v=await bankRequest('snapshot',{withdrawalId:w.id});setRevealed({id:w.id,bank:v.bank});},false)}>查看匯款銀行快照</button>
 {w.status==='pending'&&<button className="reward-button" type="button" disabled={busy} onClick={()=>action(w,'claim')}>領取處理</button>}
 {['processing','unknown'].includes(w.status)&&w.processor_id===adminUserId&&<>{['paid','failed','unknown'].map(type=><button className="reward-button" type="button" disabled={busy} key={type} onClick={event=>{if(type==='paid'){if(pending.current){setError('請先重送原處理結果，勿再次匯款。');return;}paidTrigger.current=event.currentTarget;setDraft(previous=>previous?.w.id===w.id?{...previous,w}:{w,date:'',reference:'',amount:String(w.net_amount)});setPaidOpen(true);}else action(w,type);}}>{type==='paid'?'記錄已匯款':type==='failed'?'確認未付款並退回':'標記待查帳'}</button>)}</>}
 {['paid','failed'].includes(w.status)&&<button className="reward-button" type="button" disabled={busy} onClick={()=>action(w,'correction')}>追加更正紀錄</button>}
 </div>}
 {canManage&&revealed?.id===w.id&&<section className="reward-bank-snapshot" aria-label="匯款銀行快照">
 <div className="reward-heading"><h4>申請時收款銀行</h4><button className="reward-button" type="button" onClick={()=>setRevealed(null)}>隱藏銀行資料</button></div>
 <dl className="reward-bank-snapshot-fields">{[['銀行代碼','bank_code'],['銀行名稱','bank_name'],['分行名稱','branch'],['收款戶名','holder'],['收款帳號','account']].map(([label,key])=><div key={key} className={key==='account'?'reward-field--wide':undefined}><dt>{label}</dt><dd>{revealed.bank[key]||'—'}</dd></div>)}</dl>
 </section>}
 {w.transfer_date&&<p>實際匯款 {w.transfer_date} · {w.reference} · NT$ {w.transferred_amount}</p>}{w.failure_reason&&<p>{w.failure_reason}</p>}
 {w.events.map((e,i)=><p className="reward-meta" key={i}>{e.at} · {e.type}{e.details?.reason?` · ${e.details.reason}`:''}</p>)}
 </article>)}<div className="reward-pager"><button className="reward-button" disabled={offset===0} type="button" onClick={()=>setOffset(Math.max(0,offset-20))}>管理提領上一頁</button><button className="reward-button" disabled={offset+20>=data.total} type="button" onClick={()=>setOffset(offset+20)}>管理提領下一頁</button></div>
 </>}
 {canManage&&paidOpen&&draft&&<WithdrawalPaidDialog draft={draft} setDraft={setDraft} returnFocus={paidTrigger.current} onClose={()=>setPaidOpen(false)} onSubmit={details=>{setPaidOpen(false);action(draft.w,'paid',details);}}/>}
 </div>;
}
