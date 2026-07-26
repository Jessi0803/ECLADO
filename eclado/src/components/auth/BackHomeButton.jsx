import React from 'react';

export default function BackHomeButton({ setPage }) {
  return (
    <button
      type="button"
      onClick={() => setPage('home')}
      style={{ alignSelf:'flex-start', background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--dark)', fontFamily:'var(--font-body)', letterSpacing:'0.06em', padding:0, marginBottom:24 }}
    >
      ← 返回首頁
    </button>
  );
}
