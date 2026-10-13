const crypto=require('node:crypto');
function keys(){
 let ring;try{ring=JSON.parse(process.env.REWARD_BANK_ENCRYPTION_KEYS||'{}');}catch{throw new Error('銀行資料加密設定不可用');}
 const id=process.env.REWARD_BANK_ACTIVE_KEY_ID;
 if(!id||!ring[id])throw new Error('銀行資料加密設定不可用');
 const key=Buffer.from(ring[id],'base64');if(key.length!==32)throw new Error('銀行資料加密設定不可用');
 return {ring,id,key};
}
function normalizeBank(value){
 const b={};for(const key of ['bank_code','bank_name','branch','holder','account'])b[key]=String(value?.[key]||'').trim();
 if(!/^\d{3}$/.test(b.bank_code)||!/^\d{6,20}$/.test(b.account)||['bank_name','branch','holder'].some(k=>!b[k]||b[k].length>80||/[\r\n\x00-\x1f]/.test(b[k])))throw new Error('請填寫完整且格式正確的銀行資料');
 return b;
}
function encryptBank(userId,bank){
 const {id,key}=keys(),iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);
 c.setAAD(Buffer.from(`eclado-reward-bank:v1:${userId}`));
 const data=Buffer.concat([c.update(JSON.stringify(bank),'utf8'),c.final()]);
 return {kid:id,iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:data.toString('base64')};
}
function decryptBank(userId,value){
 const {ring}=keys(),key=Buffer.from(ring[value?.kid]||'','base64');if(key.length!==32)throw new Error('銀行資料加密設定不可用');
 const c=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'base64'));c.setAAD(Buffer.from(`eclado-reward-bank:v1:${userId}`));c.setAuthTag(Buffer.from(value.tag,'base64'));
 return normalizeBank(JSON.parse(Buffer.concat([c.update(Buffer.from(value.data,'base64')),c.final()]).toString('utf8')));
}
function maskBank(b){return {...b,account:'*'.repeat(b.account.length-4)+b.account.slice(-4),holder:b.holder.slice(0,1)+'*'.repeat(Math.max(1,b.holder.length-1))};}
module.exports={normalizeBank,encryptBank,decryptBank,maskBank};
