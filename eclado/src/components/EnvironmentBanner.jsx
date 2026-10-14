import React from 'react';
import { ENVIRONMENT_LABEL, IS_NON_PRODUCTION, PAYMENT_ENABLED } from '../config/runtime.js';

export default function EnvironmentBanner() {
  if (!IS_NON_PRODUCTION) return null;
  return (
    <div role="status" style={{ position:'sticky', zIndex:10000, left:0, right:0, top:0, padding:'6px 12px', background:'#8a4c2d', color:'#fff', textAlign:'center', fontSize:11, fontWeight:600, letterSpacing:'0.08em', lineHeight:1.4 }}>
      {ENVIRONMENT_LABEL} 環境｜資料不會進入正式系統{PAYMENT_ENABLED ? '' : '｜銀行付款已停用'}
    </div>
  );
}
