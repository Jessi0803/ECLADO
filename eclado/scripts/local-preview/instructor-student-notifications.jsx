import React, {useState, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/styles.css';
import InstructorStudentSection from '../../src/admin/components/InstructorStudentSection.jsx';
const eventNames={bind:'首次綁定',rebind:'更換老師',unbind:'解除綁定'};
const audienceNames={student:'學生',teacher:'新綁定老師',former_teacher:'原老師'};
const statusNames={pending:'等待發送',retry:'等待重試／備援',sending:'發送中',sent:'已模擬送出',blocked:'暫時無法發送',failed:'失敗',unknown:'結果待確認'};
function App(){
 const [data,setData]=useState(null),[scenario,setScenario]=useState('accepted'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 async function load(){const r=await fetch('/__binding/state');if(!r.ok)throw Error('無法載入本機示範');setData(await r.json());}
 useEffect(()=>{load().catch(e=>setError(e.message));const listener=()=>load().catch(e=>setError(e.message));window.addEventListener('binding-change',listener);return()=>window.removeEventListener('binding-change',listener);},[]);
 async function reset(){setBusy(true);setError('');try{const r=await fetch('/__binding/reset',{method:'POST'});if(!r.ok)throw Error('無法重置本機示範');await load();setRevision(n=>n+1);}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function dispatch(){setBusy(true);setError('');try{const r=await fetch('/__binding/dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario})});if(!r.ok)throw Error('本機模擬未完成');await load();setRevision(n=>n+1);}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <main className="reward-view" style={{maxWidth:1320,margin:'0 auto',padding:24}}>
  <p style={{background:'#fff4d6',padding:16}}>本機通知驗收｜假會員、隔離資料庫、模擬 LINE／Email，所有訊息均不會實際寄出。</p>
  <h1 style={{fontSize:28,margin:'24px 0 10px'}}>師生綁定通知</h1>
  <p>已建立首次綁定、更換老師與解除綁定的七封示範通知。下方也可自行操作師生設定，產生新的通知。</p>
  {error&&<p role="alert">{error}</p>}
  {data&&<div style={{display:'grid',gap:24,gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,380px),1fr))',alignItems:'start'}}>
   <section style={{border:'1px solid #ddd',padding:24,minWidth:0}}><h2 style={{fontSize:20}}>操作師生設定</h2>
    <InstructorStudentSection key={revision} member={data.student} members={data.members} canManage={true}/>
   </section>
   <section style={{border:'1px solid #ddd',padding:24,minWidth:0}}><h2 style={{fontSize:20,marginBottom:16}}>通知內容與發送結果</h2>
    <label style={{display:'block'}}>模擬 LINE 結果<select aria-label="模擬 LINE 結果" value={scenario} onChange={e=>setScenario(e.target.value)} style={{display:'block',width:'100%',padding:12,margin:'8px 0 12px'}}><option value="accepted">LINE 成功</option><option value="line_rejected">LINE 無法發送，改寄 Email</option><option value="line_server_error">LINE 服務異常，改寄 Email</option></select></label>
    <div className="reward-actions"><button type="button" className="reward-button reward-button--primary" disabled={busy} onClick={dispatch}>模擬發送一批</button><button type="button" className="reward-button" disabled={busy} onClick={reset}>重置示範資料</button></div>
    <p style={{fontSize:13,margin:'12px 0 20px'}}>每批最多5封。LINE 失敗後，下一批改寄 Email；李老師未綁定 LINE，會直接使用 Email。</p>
    {data.notices.map(n=><article key={n.id} style={{borderTop:'1px solid #ddd',padding:'20px 0'}}>
     <h3 style={{fontSize:16,marginBottom:8}}>{eventNames[n.event_type]} → {audienceNames[n.audience]}</h3>
     <p style={{fontSize:13,color:'#666'}}>{statusNames[n.status]}{n.channel&&` · ${n.channel==='line'?'LINE':'Email'}`} · LINE {n.line_attempts} 次／Email {n.email_attempts} 次</p>
     <p style={{fontWeight:600,marginTop:12}}>{n.message.subject}</p><div style={{whiteSpace:'pre-wrap',lineHeight:1.9,fontSize:14}}>{n.message.text}</div>
    </article>)}
   </section>
  </div>}
 </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
