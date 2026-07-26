import React from 'react';

export default function CheckoutField({ label, name, type, required, placeholder, value, onChange }) {
  return (
    <div>
      <label style={{ fontSize:11, letterSpacing:'0.12em', color:'var(--dark)', textTransform:'uppercase', display:'block', marginBottom:7, fontFamily:'var(--font-body)' }}>
        {label}{required !== false && <span style={{ color:'var(--gold)', marginLeft:3 }}>*</span>}
      </label>
      <input type={type||'text'} name={name} value={value} onChange={onChange} required={required !== false} placeholder={placeholder||''}
        style={{ width:'100%', border:'none', borderBottom:'1px solid var(--light)', padding:'10px 0', fontSize:14, fontFamily:'var(--font-body)', fontVariantNumeric:'tabular-nums', outline:'none', background:'none', color:'var(--black)', boxSizing:'border-box' }}
        onFocus={e=>e.target.style.borderBottomColor='var(--black)'}
        onBlur={e=>e.target.style.borderBottomColor='var(--light)'}
      />
    </div>
  );
}
