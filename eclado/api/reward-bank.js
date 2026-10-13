const {normalizeBank,encryptBank,decryptBank,maskBank}=require('./_reward-bank-crypto.js');
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const authorization=req.headers.authorization||req.headers.Authorization||'';
 if(!authorization.startsWith('Bearer '))return res.status(401).json({error:'Unauthorized'});
 const url=process.env.SUPABASE_URL,anon=process.env.SUPABASE_ANON_KEY,service=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_KEY;
 if(!url||!anon||!service)return res.status(503).json({error:'銀行資料服務尚未設定'});
 async function request(path,headers,body){
 const r=await fetch(`${url}${path}`,{method:body?'POST':'GET',headers:{...headers,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json();if(!r.ok){const e=new Error('request rejected');e.code=data.code;throw e;}return data;}
 let user;try{user=await request('/auth/v1/user',{apikey:anon,Authorization:authorization});if(!user?.id)throw new Error();}catch{return res.status(401).json({error:'Unauthorized'});}
 try{
 const headers={apikey:service,Authorization:`Bearer ${service}`};
 if(req.body?.action==='save'){
 let bank;try{bank=normalizeBank(req.body.bank);}catch{return res.status(400).json({error:'請填寫完整且格式正確的銀行資料'});}
 const result=await request('/rest/v1/rpc/save_reward_bank_profile',headers,{p_actor:user.id,p_cipher:encryptBank(user.id,bank),p_masked:maskBank(bank),p_expected_version:req.body.expectedVersion});
 return res.status(200).json(result);
 }
 if(req.body?.action==='read'||req.body?.action==='snapshot'){
 const snapshot=req.body.action==='snapshot';if(snapshot&&!/^[0-9a-f-]{36}$/i.test(req.body.withdrawalId||''))return res.status(400).json({error:'Invalid withdrawal'});
 const row=await request('/rest/v1/rpc/read_reward_bank_cipher',headers,{p_actor:user.id,p_withdrawal_id:snapshot?req.body.withdrawalId:null});
 return res.status(200).json(row?{bank:decryptBank(row.user_id,row.cipher),version:row.version}:null);
 }
 return res.status(400).json({error:'Invalid bank action'});
 }catch(error){
 // Never return upstream payloads, crypto errors, account numbers or log bodies.
 const status=error.code==='42501'?403:error.code==='40001'?409:error.code==='P0002'?404:503;
 return res.status(status).json({error:status===403?'銀行資料存取權限不足':status===409?'銀行資料已更新，請重新整理':'銀行資料服務暫時無法使用'});
 }
};
