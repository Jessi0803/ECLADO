import React from 'react';

/** 首頁／商店頂部：載入中與載入失敗時的提示 */
export default function PromoDiagnosticBar({ status, errorText }) {
  if (status === 'loading') {
    return (
      <div role="status" style={{ marginTop:68, background:'#f4f3f1', borderBottom:'1px solid var(--light)', padding:'10px 20px', textAlign:'center', fontSize:12, color:'var(--dark)', letterSpacing:'0.04em' }}>
        正在載入優惠活動…
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div role="alert" style={{ marginTop:68, background:'#fef2f2', borderBottom:'1px solid #fecaca', padding:'12px 20px', fontSize:13, color:'#991b1b', lineHeight:1.65, textAlign:'center' }}>
        <strong>優惠活動無法載入</strong>（網站其餘功能仍可使用）。<br />
        <span style={{ fontSize:12, opacity:0.95 }}>{errorText || '未知錯誤'}</span><br />
        <span style={{ fontSize:11, color:'#7f1d1d', marginTop:6, display:'inline-block' }}>
          請到 Supabase 確認已執行 <code style={{ background:'#fee2e2', padding:'1px 6px' }}>eclado/supabase-promotions.sql</code>，且 <strong>public.promotions</strong> 的 RLS 允許 <strong>anon 讀取（SELECT）</strong>。
        </span>
      </div>
    );
  }
  return null;
}

// ─── LINE CALLBACK PAGE ───────────────────────────────────────────────────────
