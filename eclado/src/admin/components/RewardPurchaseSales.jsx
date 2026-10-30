import React,{useEffect,useState} from 'react';
import {getAdminRewardPurchaseSales} from '../../services/instructorRewards.js';
const money=value=>`NT$ ${Number(value).toLocaleString('zh-TW')}`;
export const taipeiPurchasePeriod=()=>{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'numeric'}).formatToParts(new Date());
  const year=Number(parts.find(p=>p.type==='year').value),month=Number(parts.find(p=>p.type==='month').value);
  return {year,month,quarter:Math.ceil(month/3)};
};
export const purchaseSalesError=error=>error.code==='PGRST202'?'叫貨統計尚未安裝。':error.message||'叫貨統計暫時無法載入。';
export function PurchaseSalesSummary({data,error}){
  if(error)return <div className="reward-meta">{error}</div>;
  if(!data)return <div className="reward-meta">叫貨額載入中…</div>;
  const {month,quarter}=taipeiPurchasePeriod();
  const monthly=data.months.find(row=>row.month===month),quarterly=data.quarters.find(row=>row.quarter===quarter);
  return <div className="reward-purchase-card-summary">本月網站叫貨 {money(monthly?.amount??0)} · 本季叫貨合計 {money(quarterly?.amount??0)}<span className="reward-meta">本季含線下補登</span></div>;
}
export default function RewardPurchaseSales({instructorId,revision=0}){
  const current=taipeiPurchasePeriod();
  const [year,setYear]=useState(current.year),[data,setData]=useState(null),[error,setError]=useState('');
  useEffect(()=>{
    let alive=true;setData(null);setError('');
    getAdminRewardPurchaseSales([instructorId],year).then(result=>{
      if(alive){const row=result.accounts.find(a=>a.id===instructorId);if(!row)throw new Error('找不到師資叫貨統計。');setData(row);}
    }).catch(e=>{if(alive)setError(purchaseSalesError(e));});
    return()=>{alive=false;};
  },[instructorId,year,revision]);
  return <section className="reward-purchase-sales" aria-label="師資本人叫貨額">
    <div className="reward-heading"><div className="reward-purchase-intro"><h3>師資本人叫貨額</h3>
      <p className="reward-note">統計師資本人已付款的商品叫貨額，不含運費、取消／退貨及學生訂單。</p>
    </div><label>統計年度 <select aria-label="叫貨統計年度" value={year} onChange={e=>setYear(Number(e.target.value))}>
      {Array.from({length:Math.max(1,current.year-2019)},(_,i)=><option key={current.year-i} value={current.year-i}>{current.year-i} 年</option>)}
    </select></label></div>
    {error&&<p role="alert" className="reward-message">{error}</p>}
    {!data&&!error&&<p role="status">正在載入叫貨統計…</p>}
    {data&&<>
      <h4>每季叫貨額</h4><p className="reward-note">季度合計包含線下補登；線下只有季度總額，不拆入每月。</p>
      {!data.quarters.length?<p>此年度沒有有效資格季度。</p>:<div className="table-scroll"><table className="reward-purchase-table"><thead><tr><th>季度</th><th>網站叫貨</th><th>線下補登</th><th>合計</th></tr></thead><tbody>
        {data.quarters.map(row=><tr key={row.quarter}><th>{year} Q{row.quarter}</th><td>{money(row.online_amount)}</td><td>{money(row.offline_amount)}</td><td>{money(row.amount)}</td></tr>)}
      </tbody></table></div>}
      <details className="reward-details"><summary>每月網站叫貨額</summary><div className="reward-purchase-months">
        {data.months.map(row=><div key={row.month}><span>{year}／{String(row.month).padStart(2,'0')}</span><strong>{money(row.amount)}</strong><span className="reward-meta">{row.order_count} 筆</span></div>)}
      </div></details>
    </>}
  </section>;
}
