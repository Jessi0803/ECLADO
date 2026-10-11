import React,{useEffect,useRef,useState} from 'react';
import { getMemberPrice,MEMBER_TIERS } from '../../domain/catalog.jsx';
import { calculateShipping,areAllCustomOrderItems } from '../../domain/shipping.js';
import { PAYMENT_METHODS } from '../../domain/payments.js';
import { createAssistedOrder,quoteAssistedOrder,getAssistedRequest,assistedApi,assistedLink } from '../../services/assistedOrders.js';
import { getMemberShoppingCredit } from '../../services/shoppingCredit.js';
import SearchableOrderProduct from './SearchableOrderProduct.jsx';

const REQUEST_KEY='eclado.assisted-order.request';
const emptyItem=()=>({productId:'',variantId:'',qty:1,unitPrice:''});
const style={width:'100%',padding:'10px 11px',border:'1px solid var(--border)',background:'var(--white)',color:'var(--dark)',fontSize:12,fontFamily:'inherit'};
const secondaryButton={padding:'9px 12px',border:'1px solid var(--dark)',background:'var(--white)',color:'var(--dark)',fontSize:11,cursor:'pointer'};
function readKey(){ try{return sessionStorage.getItem(REQUEST_KEY)||'';}catch{return '';} }
function saveKey(key){try{sessionStorage.setItem(REQUEST_KEY,key);}catch{/* Same open dialog still retains its key. */}}
function clearKey(){try{sessionStorage.removeItem(REQUEST_KEY);}catch{/* no-op */}}

export default function AssistedOrderDialog({members=[],products=[],initialMember=null,onClose,onCreated}) {
  const [customerType,setCustomerType]=useState(initialMember?'member':'guest');
  const [memberId,setMemberId]=useState(initialMember?.id||'');
  const [search,setSearch]=useState('');
  const [form,setForm]=useState({member:initialMember?.name||'',phone:initialMember?.phone||'',email:initialMember?.email||'',
    address:initialMember?.studioAddress||'',note:'',payment_method:'atm',fulfillment_method:'delivery',invoice_type:initialMember?.defaultInvoiceTaxId?'company':'personal',
    invoice_company_name:initialMember?.defaultInvoiceCompanyName||'',invoice_tax_id:initialMember?.defaultInvoiceTaxId||'',
    shipping_mode:'default',shipping_amount:'',shipping_reason:'',minimum_reason:'',coupon_code:'',apply_automatic:true,shopping_credit_amount:0});
  const [items,setItems]=useState([emptyItem()]);
  const [result,setResult]=useState(null);
  const [busy,setBusy]=useState(false);
  const [recovering,setRecovering]=useState(Boolean(readKey()));
  const [locked,setLocked]=useState(false);
  const [error,setError]=useState(''); const [notice,setNotice]=useState('');
  const [quote,setQuote]=useState(null);const [balance,setBalance]=useState(null);const [creditError,setCreditError]=useState('');
  const request=useRef({key:readKey()||crypto.randomUUID(),payload:null});
  const submitting=useRef(false);
  const member=members.find(entry=>String(entry.id)===String(memberId));
  const role=customerType==='member' ? member?.type||'consumer' : 'consumer';
  const availableProducts=products.filter(product=>product.active!==false && (product.publicationStatus||'active')==='active'
    && (!product.isProOnly || ['pro','instructor','distributor','staff'].includes(role)));
  const user={role};
  const chosen=items.map(item=>{
    const product=products.find(product=>String(product.id)===item.productId);
    const variant=product?.variants?.find(variant=>String(variant.id)===item.variantId);
    return {...product,...variant,id:product?.id};
  });
  const subtotal=items.reduce((sum,item)=>sum+Number(item.qty||0)*Number(item.unitPrice||0),0);
  const payload={...form,customer_type:customerType,member_id:customerType==='member'?memberId:null,
    shopping_credit_amount:Number(form.shopping_credit_amount),
    shipping_amount:form.shipping_mode==='custom'?Number(form.shipping_amount):null,
    items:items.map(item=>({product_id:Number(item.productId),variant_id:Number(item.variantId),qty:Number(item.qty),unit_price:Number(item.unitPrice)}))};
  // Explanations are submitted and audited, but do not change pricing. Keeping
  // them out of the quote key prevents the discounted-minimum field disappearing
  // as soon as the administrator starts entering its required explanation.
  const {minimum_reason,shipping_reason,note,...quoteInputs}=payload;
  const payloadKey=JSON.stringify(quoteInputs);
  const currentQuote=quote?.key===payloadKey?quote.data:null;
  const defaultShipping=currentQuote?.default_shipping??calculateShipping(chosen,user,subtotal,form.fulfillment_method);
  const shipping=form.shipping_mode==='default'?defaultShipping:form.shipping_mode==='free'?0:Number(form.shipping_amount||0);
  const needsMinimum=['pro','instructor','distributor','staff'].includes(role) && subtotal-Number(currentQuote?.discount||0)<5000;
  useEffect(()=>{
    let active=true;setBalance(null);setCreditError('');
    if(customerType==='member'&&memberId)getMemberShoppingCredit(memberId).then(({data,error})=>{
      if(!active)return;if(error)setCreditError('無法讀取購物金餘額，請確認管理權限。');else setBalance(Number(data?.available_balance||0));
    }).catch(()=>{if(active)setCreditError('無法讀取購物金餘額。');});
    return()=>{active=false;};
  },[customerType,memberId]);
  function fillMember(value){
    const selected=members.find(entry=>String(entry.id)===String(value));
    setMemberId(value); setItems([emptyItem()]);
    setForm(current=>({...current,shopping_credit_amount:0,coupon_code:'',member:selected?.name||'',phone:selected?.phone||'',email:selected?.email||'',address:selected?.studioAddress||'',
      invoice_type:selected?.defaultInvoiceTaxId?'company':'personal',invoice_company_name:selected?.defaultInvoiceCompanyName||'',invoice_tax_id:selected?.defaultInvoiceTaxId||''}));
  }
  useEffect(()=>{
    if (!readKey()) return;
    let active=true;
    getAssistedRequest(request.current.key).then(saved=>{
      if (!active) return;
      if (saved?.order_id){setResult(saved);setLocked(true);setNotice('已找回先前建立的訂單，請勿重新開單。');}
      else {clearKey();request.current={key:crypto.randomUUID(),payload:null};}
    }).catch(err=>{if(active){setLocked(true);setError(`無法確認先前開單結果：${err.message}。請重開此視窗重試，勿另開新單。`);}})
      .finally(()=>{if(active)setRecovering(false);});
    return()=>{active=false;};
  },[]);
  function updateItem(index,patch){setItems(current=>current.map((item,i)=>i===index?{...item,...patch}:item));}
  function selectProduct(index,value){
    const product=availableProducts.find(product=>String(product.id)===value);
    const variant=product?.variants?.find(variant=>variant.active!==false && variant.isDefault)||product?.variants?.find(variant=>variant.active!==false);
    updateItem(index,{productId:value,variantId:variant?String(variant.id):'',unitPrice:variant?getMemberPrice({...product,...variant},user):''});
  }
  function selectVariant(index,value){
    const product=availableProducts.find(product=>String(product.id)===items[index].productId);
    const variant=product?.variants?.find(variant=>String(variant.id)===value);
    updateItem(index,{variantId:value,unitPrice:variant?getMemberPrice({...product,...variant},user):''});
  }
  async function preview(){
    if(submitting.current)return;submitting.current=true;setBusy(true);setError('');
    try{const data=await quoteAssistedOrder(payload);setQuote({key:payloadKey,data});}
    catch(err){setError(err.message);}finally{submitting.current=false;setBusy(false);}
  }
  async function submit(event){
    event?.preventDefault(); if(submitting.current)return;
    if(locked&&!request.current.payload&&!result){setError('請重開此視窗找回先前開單結果，勿另開新單。');return;}
    if (!request.current.payload) {
      if (customerType==='member'&&!member){setError('請選擇會員。');return;}
      if(items.some(item=>!item.variantId||!/^\d+$/.test(String(item.qty))||Number(item.qty)<1||!/^\d+$/.test(String(item.unitPrice)))){setError('請確認商品規格、數量及整數成交單價。');return;}
      // Always quote again at submission; creation atomically revalidates stock,
      // coupon limits and wallet balance, rather than trusting this preview.
      submitting.current=true;setBusy(true);setError('');
      let finalQuote;
      try{finalQuote=await quoteAssistedOrder(payload);setQuote({key:payloadKey,data:finalQuote});}
      catch(err){setError(err.message);return;}finally{submitting.current=false;setBusy(false);}
      if(!window.confirm(`建立後資料鎖定、立即保留庫存與購物金，付款期限 48 小時。\n折抵 NT$${Number(finalQuote.discount).toLocaleString()}、購物金 NT$${Number(finalQuote.shopping_credit_amount).toLocaleString()}，銀行付款 NT$${Number(finalQuote.payment_amount).toLocaleString()}，確定建立？`))return;
      request.current.payload={...payload,expected_quote:finalQuote.confirmation};
    }
    saveKey(request.current.key);setLocked(true);submitting.current=true;setBusy(true);setError('');
    try{
      const created=result||await createAssistedOrder(request.current.key,request.current.payload);
      setResult(created); await onCreated?.();
      if(Number(created.shopping_credit_amount)>0){setNotice('訂單已成立並保留購物金，請交付連結；客戶同意使用購物金後才建立銀行付款單。');}
      else{await assistedApi('payment',{orderNo:created.order_id,linkToken:created.link_token});setNotice('訂單及付款單已建立，請複製連結交給客戶。');}
    }catch(err){
      setError(err.name==='AbortError'?'連線逾時，原操作識別碼已保留，請用下方重試找回原單。':err.message);
      if(!result){
        try{
          const saved=await getAssistedRequest(request.current.key);
          if(saved?.order_id){setResult(saved);await onCreated?.();}
          else {setLocked(false);request.current={key:crypto.randomUUID(),payload:null};clearKey();}
        }catch{/* Unknown result stays locked, next submit reuses exact payload. */}
      }
    }finally{submitting.current=false;setBusy(false);}
  }
  async function retryPayment(){
    if(!result)return submit();
    if(submitting.current)return; submitting.current=true;setBusy(true);setError('');
    try{
      if(Number(result.shopping_credit_amount)>0){await assistedApi('details',{orderNo:result.order_id,linkToken:result.link_token});setNotice('訂單已保留，請由客戶開啟連結確認購物金及付款資訊。');}
      else{await assistedApi('payment',{orderNo:result.order_id,linkToken:result.link_token});setNotice('付款資訊已取得，可提供客戶連結。');}
    }
    catch(err){setError(err.message);}finally{submitting.current=false;setBusy(false);}
  }
  const field=(name,label,type='text',required=false)=><label style={{display:'block',marginBottom:12}}>{label}<input aria-label={label} type={type} required={required} value={form[name]} onChange={event=>setForm(current=>({...current,[name]:event.target.value}))} style={style}/></label>;
  return <div className="assignment-modal" role="dialog" aria-modal="true" aria-label="新增代客訂單">
    <button type="button" className="assignment-modal-backdrop" aria-label="關閉代客訂單視窗" disabled={busy} onClick={onClose}/>
    <section className="assignment-modal-card historical-order-modal-card assisted-order-modal-card">
      <div className="assignment-modal-header"><div><h3>新增代客訂單</h3><p>{customerType==='member'&&member?`會員 ${member.name||member.email}`:'由管理員建立線上付款訂單'}</p></div><button type="button" disabled={busy} onClick={onClose} aria-label="關閉代客開單">×</button></div>
      <p style={{fontSize:11,lineHeight:1.7,color:'var(--mid)',marginBottom:16}}>獨立線上訂單，不加入合併出貨。優惠依成交價計算；使用購物金需由客戶確認同意後付款。</p>
      <div className="assisted-order-form">
      {recovering?<p>正在確認先前開單結果…</p>:result?<>
        <p style={{fontSize:13,marginBottom:8,overflowWrap:'anywhere'}}>訂單已成立：{result.order_id}</p><p style={{fontSize:11,color:'var(--mid)',marginBottom:14}}>商品、金額及收件資料已鎖定。修改需取消原單後重建。</p>
        <label>客戶付款連結<input aria-label="客戶付款連結" readOnly value={assistedLink(result)} style={style}/></label>
        <div className="assignment-actions" style={{flexWrap:'wrap'}}><button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(assistedLink(result));setNotice('付款連結已複製。');}catch{setError('無法自動複製，請選取上方連結手動複製。');}}}>複製付款連結</button>
        <button type="button" disabled={busy} onClick={retryPayment}>重新取得付款資訊</button>
        <button type="button" className="primary" disabled={busy} onClick={()=>{clearKey();onClose();}}>完成</button></div>
      </>:<form onSubmit={submit}>
        <fieldset disabled={locked||busy} style={{border:0,padding:0,minWidth:0}}>
          <label>客戶類型<select aria-label="客戶類型" value={customerType} onChange={event=>{setCustomerType(event.target.value);fillMember('');}} style={style}><option value="guest">訪客</option><option value="member">現有會員</option></select></label>
          {customerType==='member'&&<div style={{display:'grid',gap:10,marginBottom:14}}><input aria-label="搜尋會員" placeholder="搜尋姓名／Email／手機" value={search} onChange={event=>setSearch(event.target.value)} style={style}/><select aria-label="選擇會員" required value={memberId} onChange={event=>fillMember(event.target.value)} style={style}><option value="">請選擇會員</option>{members.filter(member=>!String(member.id).startsWith('app:')&&`${member.name} ${member.email} ${member.phone}`.toLowerCase().includes(search.toLowerCase())).map(member=><option key={member.id} value={member.id}>{member.name} · {MEMBER_TIERS[member.type]?.label||'一般會員'} · {member.email}</option>)}</select></div>}
          <h3 style={{margin:'20px 0 12px'}}>商品明細</h3>
          {items.map((item,index)=>{const product=availableProducts.find(product=>String(product.id)===item.productId);return <div key={index} className="assisted-order-product" style={{border:'1px solid var(--border)',background:'var(--off)',padding:12,marginBottom:10}}>
            <SearchableOrderProduct products={availableProducts} value={item.productId} onChange={value=>selectProduct(index,value)} label={`商品 ${index+1}`} style={style} required>{selector=><div className="historical-order-product-grid">
            <label>商品{selector}</label>
            <label>規格／SKU<select aria-label={`規格 ${index+1}`} required value={item.variantId} onChange={event=>selectVariant(index,event.target.value)} style={style}><option value="">請選擇規格</option>{product?.variants?.filter(variant=>variant.active!==false).map(variant=><option key={variant.id} value={variant.id}>{variant.size} · {variant.sku} · 現貨 {variant.stock}{variant.isCustomOrder?'（可預購）':''}</option>)}</select></label>
            </div>}</SearchableOrderProduct>
            <div className="historical-order-price-grid"><label>數量<input aria-label={`數量 ${index+1}`} type="number" min="1" max="9999" step="1" required value={item.qty} onChange={event=>updateItem(index,{qty:event.target.value})} style={style}/></label><label>成交單價<input aria-label={`成交單價 ${index+1}`} type="number" min="0" max="9999999" step="1" required value={item.unitPrice} onChange={event=>updateItem(index,{unitPrice:event.target.value})} style={style}/></label><div style={{paddingBottom:10}}><div style={{fontSize:10,color:'var(--mid)',marginBottom:5}}>小計</div><div style={{fontSize:13}}>NT$ {(Number(item.qty)*Number(item.unitPrice)).toLocaleString()}</div></div><button type="button" disabled={items.length===1} style={{padding:'10px 12px',border:'1px solid var(--border)',background:'var(--white)',color:'var(--red)',fontSize:11,cursor:'pointer'}} onClick={()=>setItems(items.filter((_,i)=>i!==index))}>移除</button></div>
          </div>;})}
          <button type="button" style={secondaryButton} disabled={items.length>=100} onClick={()=>setItems([...items,emptyItem()])}>＋新增商品</button>
          <h3 style={{margin:'20px 0 12px'}}>促銷、優惠券與購物金</h3>
          <label style={{display:'flex',gap:8,alignItems:'center',marginBottom:12}}><input type="checkbox" checked={form.apply_automatic} onChange={event=>setForm({...form,apply_automatic:event.target.checked})}/>套用自動促銷與贈品</label>
          {field('coupon_code','優惠券代碼')}
          {customerType==='member'&&<>
            <p style={{fontSize:12}}>可用購物金：{balance===null?'讀取中…':`NT$ ${balance.toLocaleString()}`}</p>
            {creditError&&<p style={{fontSize:12,color:'var(--red)'}}>{creditError}</p>}
            <label style={{display:'block',marginBottom:12}}>使用購物金金額<input aria-label="使用購物金金額" type="number" min="0" step="1" value={form.shopping_credit_amount} onChange={event=>{
              const value=event.target.value;
              setForm(current=>({...current,shopping_credit_amount:value!==''&&Number(value)<0?0:value}));
            }} style={style}/></label>
          </>}
          <p style={{fontSize:11,color:'var(--mid)',lineHeight:1.7}}>購物金不可支付運費，銀行付款至少 NT$1。成立時立即保留，取消或到期會自動退回；訪客不可使用。</p>
          <h3 style={{margin:'20px 0 12px'}}>收件與發票資訊</h3>
          {field('member','收件姓名','text',true)}{field('phone','收件手機','tel',true)}{field('email','收件 Email','email',true)}
          <label>取貨方式<select aria-label="取貨方式" value={form.fulfillment_method} onChange={event=>setForm({...form,fulfillment_method:event.target.value})} style={style}><option value="delivery">宅配到府</option><option value="onsite_pickup" disabled={!areAllCustomOrderItems(chosen)}>現場自取（限客訂商品）</option></select></label>
          {form.fulfillment_method==='delivery'&&field('address','收件地址','text',true)}
          <label>發票類型<select aria-label="發票類型" value={form.invoice_type} onChange={event=>setForm({...form,invoice_type:event.target.value})} style={style}><option value="personal">個人</option><option value="company">公司</option></select></label>
          {form.invoice_type==='company'&&<>{field('invoice_company_name','公司抬頭','text',true)}{field('invoice_tax_id','統一編號','text',true)}</>}
          {field('note','客戶訂單備註（客戶可見）')}
          <label>付款方式<select aria-label="付款方式" value={form.payment_method} onChange={event=>setForm({...form,payment_method:event.target.value})} style={style}>{Object.entries(PAYMENT_METHODS).map(([value,method])=><option key={value} value={value}>{method.label}</option>)}</select></label>
          <h3 style={{margin:'20px 0 12px'}}>運費與例外</h3>
          <label>運費設定<select aria-label="運費設定" value={form.shipping_mode} onChange={event=>setForm({...form,shipping_mode:event.target.value})} style={style}><option value="default">依原規則（NT${defaultShipping}）</option><option value="free">免運</option><option value="custom">自訂運費</option></select></label>
          {form.shipping_mode==='custom'&&field('shipping_amount','自訂運費','number',true)}
          {shipping!==defaultShipping&&field('shipping_reason','運費調整原因（僅後台）','text',true)}
          {needsMinimum&&field('minimum_reason','低於最低訂購額原因（僅後台）','text',true)}
          <button type="button" style={secondaryButton} disabled={busy} onClick={preview}>重新計算優惠與金額</button>
          {currentQuote?<div style={{fontSize:12,lineHeight:1.8,marginTop:12}}>
            <p>商品小計 NT$ {Number(currentQuote.subtotal).toLocaleString()}</p>
            {currentQuote.adjustments?.map((adjustment,index)=><p key={index}>{adjustment.name}：{Number(adjustment.amount)>0?`−NT$ ${Number(adjustment.amount).toLocaleString()}`:`贈品 ${adjustment.gift_quantity||0} 件`}</p>)}
            <p>運費 NT$ {Number(currentQuote.shipping).toLocaleString()} · 購物金 −NT$ {Number(currentQuote.shopping_credit_amount).toLocaleString()}</p>
            {currentQuote.items?.filter(item=>item.line_type==='gift').map((item,index)=><p key={index}>贈品：{item.name||item.nameZh} {item.size} × {item.qty}</p>)}
            <strong style={{fontSize:15}}>銀行付款 NT$ {Number(currentQuote.payment_amount).toLocaleString()}</strong>
          </div>:<p style={{fontSize:12,color:'var(--mid)',marginTop:12}}>商品 NT$ {subtotal.toLocaleString()} ＋ 運費 NT$ {shipping.toLocaleString()}（尚未計算優惠；建立前會重新計算）</p>}
        </fieldset>
        <div className="assignment-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" disabled={busy} className="primary">{locked?'找回／重試同一次開單':busy?'建立中…':'建立付款單'}</button></div>
      </form>}
      {error&&<div role="alert" className="assignment-error">{error}</div>}
      {notice&&<p role="status" style={{fontSize:12,lineHeight:1.7,color:'var(--green)',marginTop:16}}>{notice}</p>}
      </div>
    </section>
  </div>;
}
