import React,{useEffect,useRef,useState} from 'react';
export default function WithdrawalPaidDialog({draft,setDraft,onClose,onSubmit,returnFocus}){
 const ref=useRef(null),[error,setError]=useState('');
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});
 useEffect(()=>{const node=ref.current,overflow=document.body.style.overflow;node.showModal();document.body.style.overflow='hidden';return()=>{node.close();document.body.style.overflow=overflow;returnFocus?.focus();};},[]);
 function submit(event){event.preventDefault();const {date,reference,amount,w}=draft;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>today||!reference.trim()||reference.trim().length>120||!/^\d+$/.test(amount)||Number(amount)!==Number(w.net_amount)){setError('請確認匯款日期、交易序號與實匯金額；金額須與本筆預計實匯一致。');return;}
 onSubmit({transfer_date:date,reference:reference.trim(),amount:Number(amount)});
 }
 return <dialog ref={ref} className="reward-withdrawal-dialog reward-view" aria-labelledby="reward-paid-title" onCancel={e=>{e.preventDefault();onClose();}}>
 <h3 id="reward-paid-title">記錄匯款結果</h3><p>{draft.w.name||'已刪除會員'} · {draft.w.id}</p>
 <p>請於銀行實際匯款完成後填寫。這個操作只記錄結果，不會執行銀行匯款。</p>
 <form onSubmit={submit}>
 <label className="reward-field">實際匯款日期<input autoFocus type="date" required max={today} value={draft.date} onChange={e=>setDraft({...draft,date:e.target.value})}/></label>
 <label className="reward-field">銀行交易序號<input required maxLength={120} value={draft.reference} onChange={e=>setDraft({...draft,reference:e.target.value})}/></label>
 <label className="reward-field">實際匯款金額<input required type="number" min="1" step="1" value={draft.amount} onChange={e=>setDraft({...draft,amount:e.target.value})}/></label>
 <p className="reward-note">本筆預計實匯 NT$ {Number(draft.w.net_amount).toLocaleString('zh-TW')}。若銀行結果不明，請先查帳，勿再次匯款。</p>
 {error&&<p role="alert" className="reward-message">{error}</p>}
 <div className="reward-actions"><button type="button" className="reward-button" onClick={onClose}>返回（保留填寫內容）</button><button type="submit" className="reward-button reward-button--primary">確認記錄已匯款</button></div>
 </form></dialog>;
}
