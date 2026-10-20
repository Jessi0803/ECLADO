import React,{useRef,useState} from 'react';
import {exportRewardRedemptions} from '../../services/instructorRewards.js';
import {rewardRedemptionCsv,REDEMPTION_STATUS_LABELS} from '../../domain/rewardRedemptionCsv.js';

export default function RewardRedemptionExport(){
  const [filters,setFilters]=useState({start:'',end:'',search:'',status:''});
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const lock=useRef(false);
  const field=(key,value)=>setFilters(current=>({...current,[key]:value}));
  async function download(event){
    event.preventDefault();if(lock.current)return;
    if(filters.start&&filters.end&&filters.start>filters.end){setError('開始日期不得晚於結束日期。');return;}
    lock.current=true;setBusy(true);setError('');setMessage('');
    try{
      const result=await exportRewardRedemptions(filters);
      const csv=rewardRedemptionCsv(result.rows),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
      try{
        const link=document.createElement('a');link.href=url;link.download=`reward-redemptions-${filters.start||'all'}-${filters.end||'all'}.csv`;
        document.body.appendChild(link);link.click();link.remove();
      }finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
      setMessage(`已匯出 ${result.count} 筆訂單${result.count===0?'（目前無符合條件的紀錄，CSV 僅含欄位標題）':''}。`);
    }catch(e){setError(e.code==='PGRST202'?'返饋金折抵匯出功能尚未安裝。':e.message||'匯出失敗，請重新確認。');}
    finally{lock.current=false;setBusy(false);}
  }
  return <section aria-label="返饋金折抵紀錄匯出" className="reward-card reward-redemption-export">
    <h3>返饋金購物折抵紀錄</h3>
    <p className="reward-note">一張訂單一列，包含原折抵金額與實際扣用、釋放或返還狀態。匯出全部符合條件的紀錄，不受下方帳戶分頁影響。</p>
    <form onSubmit={download}>
      <fieldset disabled={busy} className="reward-redemption-fields">
        <label className="reward-field"><span>建單起日（台北）</span><input aria-label="折抵匯出建單起日" type="date" value={filters.start} onChange={e=>field('start',e.target.value)}/></label>
        <label className="reward-field"><span>建單迄日（台北）</span><input aria-label="折抵匯出建單迄日" type="date" value={filters.end} onChange={e=>field('end',e.target.value)}/></label>
        <label className="reward-field"><span>師資姓名／訂單編號</span><input aria-label="折抵匯出搜尋" maxLength={100} value={filters.search} onChange={e=>field('search',e.target.value)}/></label>
        <label className="reward-field"><span>折抵狀態</span><select aria-label="折抵匯出狀態" value={filters.status} onChange={e=>field('status',e.target.value)}><option value="">全部狀態</option>{Object.entries(REDEMPTION_STATUS_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <button className="reward-button" type="submit">{busy?'匯出中…':'匯出折抵紀錄 CSV'}</button>
      </fieldset>
    </form>
    <p className="reward-note">日期依建單時間篩選。金額為匯出當下狀態，含已取消與退貨訂單；不含銀行資料，不會變更帳務。單次最多 10,000 筆。</p>
    {error&&<p role="alert" className="reward-message">{error}</p>}{message&&<p role="status">{message}</p>}
  </section>;
}
