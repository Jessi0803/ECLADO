const { buildBrandedEmailHtml } = require('./_email-template.js');

const DEFAULT_SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';
const DEFAULT_FROM = 'ECLADO <service@ecladotaiwan.com>';

function requireCron(req, res) {
  if (!process.env.CRON_SECRET) { res.status(500).json({ error:'CRON_SECRET not set' }); return false; }
  if ((req.headers.authorization || req.headers.Authorization) === `Bearer ${process.env.CRON_SECRET}`) return true;
  res.status(401).json({ error:'Unauthorized' }); return false;
}
async function request(path, options = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_KEY not set');
  const response = await fetch(`${process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers:{ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json', ...(options.headers || {}) },
  });
  const text = await response.text(); const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(body?.message || body?.error || text || `HTTP ${response.status}`);
  return body;
}
function taipeiDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(now);
  const value = name => Number(parts.find(part => part.type === name)?.value);
  return { year:value('year'), month:value('month'), day:value('day') };
}
function quarterStartToPrepare(parts) {
  if (parts.month <= 3) return `${parts.year - 1}-10-01`;
  if (parts.month <= 6) return `${parts.year}-01-01`;
  if (parts.month <= 9) return `${parts.year}-04-01`;
  return `${parts.year}-07-01`;
}
function money(value) { return `NT$ ${Math.round(Number(value) || 0).toLocaleString('zh-TW')}`; }
function noticeText(profile, notice) {
  const snapshot = notice.snapshot || {}; const quarter = snapshot.notice_quarter || {};
  const title = `${snapshot.assessment_year} 年第 ${quarter.calendar_quarter || ''} 季季度結算通知`;
  return {
    subject:`ECLADO ${title}`,
    text:[`${profile.name || '您好'}，`, '', title,
      `本季營業額：${money(quarter.sales_amount)}`,
      `本年度累計營業額：${money(snapshot.annual_sales_amount)}`,
      `本年度暫估門檻：${money(snapshot.annual_threshold)}`,
      `距年度門檻尚差：${money(snapshot.annual_remaining_amount)}`,
      `本季是否為零進貨：${quarter.has_zero_sales ? '是' : '否'}`,
      `品牌專班學員暫估：${Number(snapshot.student_provisional_count) || 0} 位`, '',
      '以上為目前資料暫估，年度續約仍以年度結算與管理員審核結果為準。', '', 'ECLADO Taiwan'].join('\n'),
  };
}
async function send(profile, message, deliveryKey) {
  if (profile.line_user_id && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    const response = await fetch('https://api.line.me/v2/bot/message/push', { method:'POST', headers:{ Authorization:`Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`, 'Content-Type':'application/json', 'X-Line-Retry-Key':deliveryKey }, body:JSON.stringify({ to:profile.line_user_id, messages:[{ type:'text', text:message.text }] }) });
    if (response.ok) return { channel:'line' };
  }
  if (!profile.email || !process.env.RESEND_API_KEY) throw new Error('No available notification channel');
  const response = await fetch('https://api.resend.com/emails', { method:'POST', headers:{ Authorization:`Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type':'application/json', 'Idempotency-Key':`professional-quarter-${deliveryKey}` }, body:JSON.stringify({ from:process.env.ORDER_EMAIL_FROM || DEFAULT_FROM, to:[profile.email], subject:message.subject, text:message.text, html:buildBrandedEmailHtml(message.text) }) });
  if (!response.ok) throw new Error((await response.text()) || `Resend HTTP ${response.status}`);
  return { channel:'email' };
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error:'Method not allowed' });
  if (!requireCron(req, res)) return;
  const today = taipeiDateParts(); const quarterStart = quarterStartToPrepare(today);
  try {
    let prepared = null;
    prepared = await request('rpc/prepare_professional_quarterly_notices', { method:'POST', body:JSON.stringify({ p_quarter_start:quarterStart }) });
    const notices = await request('rpc/claim_professional_quarterly_notices', { method:'POST', body:JSON.stringify({ p_limit:100 }) });
    let sent = 0; let failed = 0;
    for (const notice of notices) {
      try {
        const profiles = await request(`profiles?id=eq.${encodeURIComponent(notice.user_id)}&select=name,email,line_user_id&limit=1`);
        const delivery = await send(profiles?.[0] || {}, noticeText(profiles?.[0] || {}, notice), notice.id);
        await request(`professional_quarterly_notices?id=eq.${encodeURIComponent(notice.id)}&status=eq.sending`, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ status:'sent', channel:delivery.channel, sent_at:new Date().toISOString(), last_error:null }) });
        sent += 1;
      } catch (error) {
        await request(`professional_quarterly_notices?id=eq.${encodeURIComponent(notice.id)}&status=eq.sending`, { method:'PATCH', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ status:'failed', last_error:String(error.message || error).slice(0, 1000) }) });
        failed += 1;
      }
    }
    return res.status(200).json({ ok:true, quarterStart, prepared, sent, failed });
  } catch (error) {
    console.error('[professional-quarterly-notices]', error);
    return res.status(500).json({ ok:false, error:error.message || String(error) });
  }
};

module.exports._private = { quarterStartToPrepare, taipeiDateParts, noticeText };
