export const NAV_LINKS = ['清潔卸妝', '化妝水凝膠', '安瓶精華', '乳霜修護', '面膜護理', '防曬底妝', '院線課程儀器'];
export const PRODUCT_NAV_LINKS = ['所有產品', ...NAV_LINKS];
export const NAV_ITEMS = [
  { label: '所有產品', children: PRODUCT_NAV_LINKS },
  { label: '會員登錄', children: ['會員登入', '美容師申請'] },
  { label: '品牌故事', children: null },
  { label: '購物說明', children: ['退換貨說明', '運送方式', '付款說明', '常見問題'] },
];
