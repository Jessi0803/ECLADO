import React from 'react';
import { getPromotionLabelColor, getPromotionLabelTextColor } from '../../domain/promotions.js';

export default function PromotionLabel({ text, color }) {
  return <span data-testid="promotion-label" style={{ display:'inline-block', maxWidth:'100%', overflowWrap:'anywhere', background:getPromotionLabelColor(color), color:getPromotionLabelTextColor(color), borderRadius:4, padding:'4px 8px', fontSize:12, fontWeight:600, lineHeight:1.4 }}>{text}</span>;
}
