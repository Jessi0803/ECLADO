const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizeBank,encryptBank,decryptBank,maskBank}=require('../../api/_reward-bank-crypto.js');
const handler=require('../../api/reward-bank.js');
const bank={bank_code:'807',bank_name:'隔離銀行',branch:'測試分行',holder:'測試老師',account:'12345678901234'};
const key=Buffer.alloc(32,7).toString('base64');
test('bank normalization rejects malformed and incomplete sensitive data',()=>{
 for(const b of [{...bank,bank_code:'1'},{...bank,account:'123'},{...bank,holder:''},{...bank,branch:'bad\nvalue'}])assert.throws(()=>normalizeBank(b));
 assert.deepEqual(normalizeBank(bank),bank);assert.ok(!maskBank(bank).account.includes(bank.account));
});
test('AES-GCM ciphertext binds owner, authenticates content and preserves historical key IDs',()=>{
 const old={...process.env};try{
 process.env.REWARD_BANK_ACTIVE_KEY_ID='v1';process.env.REWARD_BANK_ENCRYPTION_KEYS=JSON.stringify({v1:key});
 const cipher=encryptBank('owner',bank);assert.deepEqual(decryptBank('owner',cipher),bank);assert.ok(!JSON.stringify(cipher).includes(bank.account));
 assert.notDeepEqual(encryptBank('owner',bank),cipher);assert.throws(()=>decryptBank('other',cipher));assert.throws(()=>decryptBank('owner',{...cipher,data:Buffer.alloc(15).toString('base64')}));
 process.env.REWARD_BANK_ACTIVE_KEY_ID='v2';process.env.REWARD_BANK_ENCRYPTION_KEYS=JSON.stringify({v1:key,v2:Buffer.alloc(32,9).toString('base64')});assert.deepEqual(decryptBank('owner',cipher),bank);
 }finally{restore(old);}
});
test('bank encryption fails closed without valid key, never using payment credentials',()=>{const old={...process.env};try{delete process.env.REWARD_BANK_ACTIVE_KEY_ID;assert.throws(()=>encryptBank('owner',bank));}finally{restore(old);}});
function restore(env){for(const k of ['REWARD_BANK_ACTIVE_KEY_ID','REWARD_BANK_ENCRYPTION_KEYS','SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_KEY']){if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];}}
async function scenario(body,{valid=true,reject=false}={}){
 const old={...process.env},original=global.fetch,calls=[];process.env.SUPABASE_URL='https://isolated.test';process.env.SUPABASE_ANON_KEY='isolated-anon';process.env.SUPABASE_SERVICE_KEY='isolated-service';process.env.REWARD_BANK_ACTIVE_KEY_ID='v1';process.env.REWARD_BANK_ENCRYPTION_KEYS=JSON.stringify({v1:key});
 global.fetch=async(url,options)=>{calls.push({url,body:options.body?JSON.parse(options.body):null});if(url.endsWith('/auth/v1/user'))return new Response(JSON.stringify(valid?{id:'actual-owner'}:{error:'invalid'}),{status:valid?200:401});return new Response(JSON.stringify(reject?{code:'42501'}:{version:1,bank:maskBank(bank)}),{status:reject?403:200});};
 const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.code=v;return this;},json(v){this.body=v;return this;}};
 try{await handler({method:'POST',headers:{authorization:'Bearer isolated-auth'},body},res);}finally{global.fetch=original;restore(old);}return {res,calls};
}
test('bank endpoint derives actor from verified Auth, ignores forged caller owner and returns only masked data',async()=>{
 const {res,calls}=await scenario({action:'save',bank,expectedVersion:0,userId:'victim'});assert.equal(res.code,200);assert.equal(res.headers['Cache-Control'],'no-store');
 assert.equal(calls[1].body.p_actor,'actual-owner');assert.equal(calls[1].body.p_expected_version,0);assert.ok(!JSON.stringify(calls[1].body).includes(bank.account));assert.ok(!JSON.stringify(res.body).includes(bank.account));
});
test('unauthorized callers never reach bank storage',async()=>{const {res,calls}=await scenario({action:'save',bank},{valid:false});assert.equal(res.code,401);assert.equal(calls.length,1);});
test('service RPC permission failures are generic, no crypto payload or account leakage',async()=>{const {res}=await scenario({action:'save',bank},{reject:true});assert.equal(res.code,403);assert.ok(!JSON.stringify(res.body).includes(bank.account));});
test('bank endpoint validates before encrypting or storage',async()=>{const {res,calls}=await scenario({action:'save',bank:{...bank,branch:''}});assert.equal(res.code,400);assert.equal(calls.length,1);});
