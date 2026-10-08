import React,{useEffect,useRef,useState} from 'react';
import { assistedApi } from '../services/assistedOrders.js';
import { retrySinopacPayment } from '../services/paymentApi.js';
import { PAYMENT_METHODS } from '../domain/payments.js';
import './AssistedPaymentPage.css';

function readAccess(){const parameters=new URLSearchParams(window.location.hash.slice(1));return {orderNo:parameters.get('order')||'',linkToken:parameters.get('token')||''};}
export default function AssistedPaymentPage(){
  const [access]=useState(readAccess); const [details,setDetails]=useState(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState(''); const operation=useRef(false);
  useEffect(()=>{
    const meta=document.createElement('meta');meta.name='referrer';meta.content='no-referrer';document.head.appendChild(meta);
    let active=true;
    assistedApi('details',access).then(data=>{if(active)setDetails(data);}).catch(err=>{if(active)setError(err.message);});
    return()=>{active=false;meta.remove();};
  },[access]);
  async function refresh(){if(operation.current)return;operation.current=true;setBusy(true);setError('');try{setDetails(await assistedApi('details',access));}catch(err){setError(err.message);}finally{operation.current=false;setBusy(false);}}
  async function pay(){
    if(operation.current)return;operation.current=true;setBusy(true);setError('');
    try{
      if(details?.instruction?.provider_status && details.instruction?.payment_state==='failed'){
        const retry=await retrySinopacPayment({orderNo:access.orderNo,resultAccessToken:details.resultAccessToken});
        const target=new URL(retry.paymentLink);
        if(target.protocol!=='https:')throw new Error('付款連結格式錯誤');
        window.location.assign(target.href);return;
      }
      const result=await assistedApi('payment',access);
      if(['card','apple','google'].includes(details?.paymentMethod)){
        const target=new URL(result.instruction?.payment_url || '');
        if(target.protocol!=='https:')throw new Error('付款連結暫時無法取得');
        window.location.assign(target.href);
      }else{setDetails(await assistedApi('details',access));}
    }catch(err){setError(err.message);}finally{operation.current=false;setBusy(false);}
  }
  const order=details?.order;const instruction=details?.instruction;
  const payable=order&&['unpaid','awaiting_confirm'].includes(order.status);
  const onlinePayment=['card','apple','google'].includes(details?.paymentMethod);
  const paymentLabel=PAYMENT_METHODS[details?.paymentMethod]?.label||'付款';
  const money=value=>`NT$ ${Number(value||0).toLocaleString()}`;
  return <main className="assisted-payment-page"><div className="assisted-payment-container">
    <header className="assisted-payment-card assisted-payment-header">
      <h1>訂單確認與付款</h1>
      <p>此訂單由管理員代為建立。請確認以下明細；如需修改，請先聯繫客服，不要另外下單。</p>
    </header>
    {!order&&!error&&<div className="assisted-payment-card" role="status">正在讀取訂單…</div>}
    {order&&<>
      <section className="assisted-payment-card assisted-payment-contact">
        <h2>收件與發票資訊</h2>
        <p>訂單編號：{order.id}</p><p>收件人：{order.member}</p><p>手機：{order.phone}</p><p>Email：{order.email}</p>
        <p>{order.fulfillment_method==='onsite_pickup'?'現場自取':`收件地址：${order.address}`}</p>
        <p>發票：{order.invoice_type==='company'?'公司':'個人'}</p>
        {order.invoice_type==='company'&&<><p>公司抬頭：{order.invoice_company_name}</p><p>統一編號：{order.invoice_tax_id}</p></>}
      </section>
      <section className="assisted-payment-card">
      <h2>商品與金額</h2>
      <div className="assisted-payment-table-scroll"><table><thead><tr>{['商品／規格','數量','單價','小計'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{order.items.map((item,index)=><tr key={index}><td>{item.name} {item.size}{item.fulfillment_type==='preorder'&&'（含預購）'}</td><td>{item.qty}</td><td>{money(item.unit_price)}</td><td>{money(item.line_total)}</td></tr>)}</tbody></table></div>
      <div className="assisted-payment-totals"><p><span>商品小計</span><span>{money(order.subtotal)}</span></p><p><span>運費</span><span>{money(order.shipping)}</span></p><p className="assisted-payment-total"><span>應付總額</span><span>{money(order.total)}</span></p></div>
      </section>
      <section className="assisted-payment-card assisted-payment-instructions">
      <h2>付款資訊</h2>
      <p>付款方式：{paymentLabel}</p>
      <p>付款期限：{new Date(order.payment_due_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}</p>
      {!payable&&<p role="status" style={{marginTop:16}}>此訂單目前狀態：{({paid:'已付款',preparing:'備貨中',shipped:'已出貨',delivered:'已完成',cancelled:'已取消',returned:'已退貨',ready_for_pickup:'可取貨',picked_up:'已取貨'})[order.status]||order.status}，無需再次付款。</p>}
      {payable&&instruction?.atm_account&&<div className="assisted-payment-atm"><p>銀行：{instruction.atm_bank_code} 永豐銀行</p><p className="assisted-payment-account">虛擬帳號：{instruction.atm_account}</p><p>匯款金額：{money(order.total)}</p></div>}
      <div className="assisted-payment-actions">
      {payable&&(onlinePayment||!instruction?.atm_account)&&<button className="assisted-payment-button primary" disabled={busy} type="button" onClick={pay}>{busy?'處理中…':onlinePayment?`確認明細，前往${paymentLabel}付款`:'讀取／建立虛擬帳號'}</button>}
      <button className="assisted-payment-button" disabled={busy} type="button" onClick={refresh}>重新讀取付款狀態</button>
      </div>
      <p className="assisted-payment-hint">此為私人連結，請勿公開分享。連結到期不會刪除訂單。</p>
      {!order.is_member&&<p>訪客查詢碼：{order.public_lookup_code}；日後請搭配結帳手機號碼查詢。</p>}
      </section>
    </>}
    {error&&<div className="assisted-payment-error" role="alert"><p>{error}</p>{!order&&<button className="assisted-payment-button" disabled={busy} type="button" onClick={refresh}>{busy?'讀取中…':'重新讀取訂單'}</button>}</div>}
    <nav className="assisted-payment-actions" aria-label="訂單查詢入口"><a className="assisted-payment-button" href="/account">會員中心</a><a className="assisted-payment-button" href={order?.public_lookup_code?`/order-lookup?lookup=${encodeURIComponent(order.public_lookup_code)}`:'/order-lookup'}>訪客訂單查詢</a></nav>
    </div>
  </main>;
}
