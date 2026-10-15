const {decryptBank}=require('./_reward-bank-crypto.js');
// Quote all cells; neutralize spreadsheet formulas and preserve numeric identifiers.
function cell(value,text=false){let s=String(value??'');if(text||/^[\s]*[=+@\-\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
function withdrawalCsv(result){
 const header=['申請編號','老師','銀行代碼','銀行名稱','分行名稱','收款戶名','完整帳號','實匯金額','批次日期'];
 const rows=result.rows.map(row=>{
  const bank=decryptBank(row.user_id,row.cipher);
  if(!/^\d+$/.test(String(row.net_amount)))throw new Error('Invalid export amount');
  return [cell(row.id),cell(row.name||'已刪除會員'),cell(bank.bank_code,true),cell(bank.bank_name),cell(bank.branch),cell(bank.holder),cell(bank.account,true),cell(row.net_amount),cell(row.batch_date)].join(',');
 });
 return '\uFEFF'+[header.map(v=>cell(v)).join(','),...rows].join('\r\n')+'\r\n';
}
module.exports={withdrawalCsv};
