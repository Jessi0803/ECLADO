export const NAV_LINKS = ['清潔卸妝', '化妝水', '安瓶精華', '乳霜', '面膜', '防曬底妝', '其他', '院線課程儀器（含試用包）'];
export const PRODUCT_NAV_LINKS = ['所有產品', ...NAV_LINKS];
export const SERIES_LINKS = ['清潔', '微囊精萃', '院線組合', 'Air jet', '急救安瓶', '面膜', 'Deep', 'Extra', 'Cell', 'AC', '呼吸', '試用包', 'Special'];
export const PRODUCT_SERIES_LINKS = ['所有系列', ...SERIES_LINKS];
export const NAV_ITEMS = [
  {
    label: '所有產品',
    children: [
      { label: '依功效分類', view: 'category', items: PRODUCT_NAV_LINKS },
      { label: '依系列分類', view: 'series', items: PRODUCT_SERIES_LINKS },
    ],
  },
  { label: '會員登錄', children: ['會員登入', '美容師申請'] },
  { label: '品牌故事', children: null },
  { label: '購物說明', children: ['退換貨說明', '運送方式', '付款說明', '常見問題'] },
];
