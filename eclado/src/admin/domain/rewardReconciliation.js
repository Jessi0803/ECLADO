// Presentation only: keep the database's findings and financial rules intact.
export const reconciliationRules={
 account_ledger:['帳戶與帳務明細不一致','帳戶金額應與帳務明細累計一致。'],
 ledger_running:['帳務逐筆結餘不一致','每筆異動後金額應與截至該筆的累計一致。'],
 snapshot_state:['訂單返饋快照與帳務不一致','訂單快照、逐項返饋合計與帳務歸屬應一致。'],
 income_events:['返饋入帳事件不一致','待入帳、入帳、作廢及扣回紀錄應符合目前返饋狀態。'],
 income_line:['返饋異動金額或師資不一致','入帳與扣回應沿用訂單返饋金額及師資歸屬。'],
 duplicate_credit:['返饋重複入帳','同一筆訂單最多正式入帳一次。'],
 duplicate_reverse:['返饋重複扣回','同一筆訂單最多扣回一次。'],
 income_lifecycle:['返饋與訂單或收款狀態不一致','返饋狀態應符合有效收款、到貨／取貨及取消／退貨結果。'],
 account_projections:['待入帳或保留金額不一致','帳戶待入帳與保留金額應與對應訂單、購物及提領紀錄合計一致。'],
 spend_events:['購物折抵事件不一致','每輪購物保留、扣用、釋放與返還應符合處理順序，且不可重複。'],
 missing_shopping_reservation:['訂單缺少返饋金折抵紀錄','使用返饋金的訂單應有對應折抵紀錄。'],
 orphan_spend:['購物異動缺少對應折抵紀錄','購物帳務異動應有對應的返饋金折抵紀錄。'],
 shopping_reservation:['購物折抵金額或狀態不一致','訂單折抵金額、保留狀態與該輪帳務事件應一致。'],
 spend_payment:['購物折抵與付款資料不一致','折抵狀態應符合有效收款、訂單狀態與雙錢包付款金額。'],
 withdrawal_events:['提領狀態與帳務事件不一致','提領保留、完成或退回紀錄應符合申請狀態，且不可重複。'],
 withdrawal_amount:['提領金額或匯款憑證異常','申請額、15元手續費、實匯額及完成憑證應符合既定規則。'],
 withdrawal_line:['提領異動金額或師資不一致','提領帳務異動應與原申請金額及師資一致。'],
 payment_unknown:['訂單收款需人工查核','已記錄付款異常，需查明收款及訂單結果。'],
 withdrawal_unknown:['提領匯款結果待查帳','尚未確認是否已匯款，保留金額維持不變，請先查帳。'],
};
const fields={balance:'帳戶餘額',pending:'待入帳金額',shopping_hold:'購物保留',withdrawal_hold:'提領保留',instructor:'師資識別碼',amount:'金額',status:'處理狀態',state:'返饋狀態',order_status:'訂單狀態',receipt:'已保存收款證據',maximum:'允許最多次數',count:'實際次數',reserve:'保留次數',consume:'扣用次數',release:'釋放／退回次數',refund:'購物返還次數',complete:'提領完成次數',credit:'入帳次數',cancel:'作廢次數',reverse:'扣回次數',terminal_max:'扣用或釋放合計最多次數',requires:'核對要求',action:'處理要求',reason:'異常原因',cycle:'保留輪次',gross:'申請總額',quoted_fee:'申請手續費',net:'預計實匯金額',charged_fee:'已收手續費',transferred:'實際匯款金額',reward_credit_amount:'訂單返饋金折抵'};
const amounts=new Set(['balance','pending','shopping_hold','withdrawal_hold','amount','gross','quoted_fee','net','charged_fee','transferred','reward_credit_amount']);
const values={manual_review:'需人工查核',manual_bank_review_hold_unchanged:'需人工查帳，維持提領保留',reservation:'應有對應返饋金折抵紀錄',receipt_and_completion_or_termination:'核對收款證據與訂單完成／取消／退貨狀態',valid_receipt_and_matching_tender:'應有有效收款證據，且付款與折抵金額一致',payment_after_release:'返饋金保留已釋放後收到付款成功',payment_after_termination:'訂單取消或退貨後收到付款成功',credited:'已入帳',reversed:'已扣回',cancelled:'已取消／作廢',returned:'已退貨',delivered:'已到貨',picked_up:'已取貨',reserved:'已保留',consumed:'已扣用',released:'已釋放',refunded:'已返還',processing:'處理中',paid:'已付款／已匯款',failed:'明確失敗',unknown:'結果待查核',unpaid:'未付款',shipped:'已出貨'};
export function reconciliationFields(rule,data){
 return Object.entries(data||{}).map(([key,value])=>{
  const pendingCount=key==='pending'&&rule==='income_events';
  let label=pendingCount?'待入帳紀錄次數':fields[key]||key;
  let text;
  if(value===null)text='缺少資料';
  else if(typeof value==='boolean')text=value?'是':'否';
  else if(amounts.has(key)&&!pendingCount&&typeof value==='number')text=`NT$ ${value.toLocaleString('zh-TW')}`;
  else if(value==='pending')text=rule.startsWith('withdrawal')?'待匯款':key==='order_status'?'待處理':'待入帳';
  else if(typeof value==='object')text=JSON.stringify(value);
  else text=values[value]||String(value);
  return {key,label,text};
 });
}
