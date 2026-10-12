import React,{useEffect,useState} from 'react';
import {getMyInstructorRewards,getAdminInstructorRewards} from '../../services/instructorRewards.js';
const buttonStyle={padding:'9px 14px',border:'1px solid var(--light)',background:'var(--white)',color:'var(--dark)',fontFamily:'inherit',cursor:'pointer'};
const money=value=>`NT$ ${Number(value||0).toLocaleString('zh-TW')}`;
const labels={pending:'待入帳',credited:'已入帳',cancelled:'已作廢',reversed:'已扣回',credit:'正式入帳',cancel:'待入帳作廢',reverse:'扣回',spend_reserve:'購物保留',spend_consume:'購物扣用',spend_release:'購物釋放',spend_refund:'購物返還'};
const time=value=>new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'});
export default function InstructorRewardsPanel({userId,instructorId,admin=false}){
  const [report,setReport]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const [offset,setOffset]=useState(0),[ledgerOffset,setLedgerOffset]=useState(0),[revision,setRevision]=useState(0);
  useEffect(()=>{setOffset(0);setLedgerOffset(0);},[userId,instructorId,admin]);
  useEffect(()=>{
    let alive=true;setReport(null);setError('');setLoading(true);
    const load=admin?getAdminInstructorRewards(instructorId,offset,ledgerOffset):getMyInstructorRewards(offset,ledgerOffset);
    load.then(data=>{if(alive)setReport(data);}).catch(e=>{if(alive)setError(e.code==='PGRST202'?'返饋查詢尚未安裝。':e.message||'返饋資料暫時無法載入。');})
      .finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[userId,instructorId,admin,offset,ledgerOffset,revision]);
  useEffect(()=>{const focus=()=>setRevision(r=>r+1);window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[]);
  const pager=(value,setter,total,label)=><div style={{display:'flex',gap:12,margin:'16px 0'}}>
    <button style={buttonStyle} type="button" disabled={loading||value===0} onClick={()=>setter(Math.max(0,value-20))} aria-label={`${label}上一頁`}>上一頁</button>
    <span>{Math.floor(value/20)+1} / {Math.max(1,Math.ceil(total/20))}</span>
    <button style={buttonStyle} type="button" disabled={loading||value+20>=total} onClick={()=>setter(value+20)} aria-label={`${label}下一頁`}>下一頁</button>
  </div>;
  return <section aria-label="師資返饋金" style={{border:'1px solid var(--light)',padding:20,marginBottom:24,overflowWrap:'anywhere'}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12}}><h2>師資返饋金</h2><button style={buttonStyle} type="button" disabled={loading} onClick={()=>setRevision(r=>r+1)}>重新整理</button></div>
    {loading&&<p role="status">正在載入返饋資料…</p>}
    {error&&<p role="alert">{error}</p>}
    {report&&<>
      <div style={{display:'flex',flexWrap:'wrap',gap:20,margin:'20px 0'}}>
        {[['購物保留',report.summary.reserved_balance||0],['待入帳',report.summary.pending_balance],['累計已入帳',report.summary.credited_total],['累計扣回',report.summary.reversed_total],['帳戶餘額',report.summary.balance],['可用餘額',report.summary.available_balance]].map(([label,value])=><div key={label}><div>{label}</div><strong>{money(value)}</strong></div>)}
      </div>
      {Number(report.summary.balance)<0&&<p>帳戶為負餘額，後續入帳將抵銷負餘額。</p>}
      {(report.payment_exceptions||[]).map(entry=><p role="alert" key={entry.order_id}>{entry.order_id}：已收款但返饋金帳務異常，請聯繫管理員處理。</p>)}
      <h3>歷史學生訂單</h3>
      {!report.orders.length&&<p>目前沒有返饋訂單紀錄。</p>}
      {report.orders.map(order=><article key={order.order_id} style={{borderTop:'1px solid var(--light)',padding:'16px 0'}}>
        <div><strong>{order.order_id}</strong> · {order.student_name|| (order.student_deleted?'已刪除會員':'未提供姓名')}</div>
        <div>{time(order.created_at)} · {order.order_source==='admin_assisted'?'代客訂單':'一般訂單'} · {labels[order.reward_status]||'待查核'} · 返饋 {money(order.total_reward)}</div>
        {order.order_missing&&<p>原訂單已刪除，返饋歷史仍保留。</p>}
        <ul>{order.items.map((item,index)=><li key={index}>{item.name||`商品 #${item.product_id}`} {item.size||''} × {item.qty} · 商品單價 {money(item.unit_price)} · 返饋 {money(item.reward)}</li>)}</ul>
      </article>)}
      {pager(offset,setOffset,report.order_count,'訂單')}
      <h3>返饋帳務紀錄</h3>
      {!report.entries.length&&<p>目前沒有帳務紀錄。</p>}
      {report.entries.map(entry=><div key={entry.id} style={{borderTop:'1px solid var(--light)',padding:'12px 0'}}>
        <div>{entry.order_id} · {labels[entry.event_type]||entry.event_type} · {money(entry.amount)}</div>
        <div>{time(entry.created_at)} · 餘額 {money(entry.balance_after)} · 待入帳 {money(entry.pending_after)} · 購物保留 {money(entry.reserved_after||0)}</div>
      </div>)}
      {pager(ledgerOffset,setLedgerOffset,report.ledger_count,'帳務')}
    </>}
  </section>;
}
