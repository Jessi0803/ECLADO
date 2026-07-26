import React from 'react';

export default function CheckoutSteps({ steps, currentStep }) {
  return (
    <div style={{ display:'flex', alignItems:'center', marginBottom:40 }}>
      {steps.map((label, index) => (
        <React.Fragment key={label}>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
            <div style={{ width:28, height:28, borderRadius:'50%', background: currentStep >= index + 1 ? 'var(--black)' : 'var(--light)', color: currentStep >= index + 1 ? 'var(--white)' : 'var(--mid)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:500 }}>
              {currentStep > index + 1 ? '✓' : index + 1}
            </div>
            <span style={{ fontSize:10, letterSpacing:'0.08em', color: currentStep === index + 1 ? 'var(--black)' : 'var(--mid)', whiteSpace:'nowrap' }}>{label}</span>
          </div>
          {index < steps.length - 1 && <div style={{ flex:1, height:1, background: currentStep > index + 1 ? 'var(--black)' : 'var(--light)', margin:'0 8px', marginBottom:18 }} />}
        </React.Fragment>
      ))}
    </div>
  );
}
