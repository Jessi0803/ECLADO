const assert=require('node:assert/strict');
const {test}=require('node:test');
const {mountCoursePaymentRoutes}=require('./course-payments.cjs');
for(const method of ['card','apple','google','atm'])test(`course ${method}: verify bank before renewal, block ambiguous state, reconcile captured payment`,async()=>{
 const id='10000000-0000-4000-8000-000000000001', old='CRS'+'1'.repeat(32),next='CRS'+'2'.repeat(32);
 const bankType=method==='atm'?'A':method==='card'?'C':'M';const terminal=`1${bankType}250`;
 let status=`1${bankType}200`,created=0,renewed=0,paid=0,absent=false,attemptState='pending',eligible=true;
 const routes=new Map();const calls=[];
 mountCoursePaymentRoutes({post:(p,h)=>routes.set(p,h),get:()=>{}},{
  rpc:async(name,args)=>{calls.push([name,args]);
   if(name==='claim_course_payment')return{summary:{status:'pending',total_twd:1200},provider_order_no:old,
    eligible,attempt_state:attemptState,payment_method:method,create_attempt:false};
   if(name==='get_course_payment_target')return{course_id:id,total:1200,payment_method:method};
   if(name==='renew_course_payment'){renewed++;assert.equal(args.p_previous_provider,old);
    assert.ok([terminal,'NOT_CREATED'].includes(args.p_bank_status));
    return{summary:{total_twd:1200},create_attempt:true,provider_order_no:next,payment_method:method,minutes:10,link_expires_at:'2035-01-01T00:00:00Z'};}
   if(name==='confirm_course_payment'){paid++;return{status:'paid'};}
  },
  authenticate:async()=>({id:'payer'}),rateLimit:async()=>true,
  coursePaymentAbsent:async()=>absent,
  resolvePayment:async()=>({orderNo:old,tsNo:'OLD',payType:bankType,payStatus:status,raw:{orderQuery:{OrderList:[{Amount:'120000'}]}}}),
  requireBankPaymentAmount:(payment)=>assert.equal(payment.raw.orderQuery.OrderList[0].Amount,'120000'),
  buildCreateBody:x=>{assert.equal(x.orderNo,next);return{OrderNo:x.orderNo,Amount:x.amount*100};},
  formatSinopacDeadline:()=>({expireDate:'20350101',expireTime:'0800'}),
  callOrderApi:async(op,body)=>{created++;assert.equal(op,'OrderCreate');assert.equal(body.Amount,120000);
   return{data:{Status:'S',TSNo:'NEXT',CardParam:{CardPayURL:'https://bank.test/new'},MobileParam:{MobilePayURL:'https://bank.test/new'},ATMParam:{WebAtmURL:'https://bank.test/new',AtmPayNo:'12345678901234'}}};},
  requireCreatedPayment:()=>{},requirePaymentOrderHints:()=>{},
 });
 const request=async()=>{const out={};const res={set(){},status(x){out.code=x;return this;},json(x){out.body=x;return this;}};
  await routes.get('/api/courses/payment/start')({body:{orderId:id,paymentMethod:method}},res);return out;};
 assert.equal((await request()).code,409);assert.equal(renewed,0);assert.equal(created,0);
 status=terminal;const result=await request();assert.equal(result.body.paymentMethod,method);assert.equal(created,1);assert.equal(renewed,1);
 if(method==='atm')assert.equal(result.body.atmAccount,'12345678901234');
 status=`1${bankType}400`;assert.equal((await request()).body.order.status,'paid');assert.equal(paid,1);assert.equal(created,1);
 attemptState='failed';absent=true;await request();assert.equal(renewed,2);assert.equal(created,2);
 eligible=false;assert.equal((await request()).code,409);assert.equal(created,2);
});
