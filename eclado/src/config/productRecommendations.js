// Use stable catalog slugs, not display names or environment-specific IDs.
// Prices, variants, availability and permissions always come from the live catalog.
export const CLEANSING_PRODUCTS = [
  'perfect-cleansing-smoothie-balm',
  'enhancer-mild-cleanser',
  'enzyme-deep-cleanser-pure-powder',
  'rebalancing-toner',
];

const item = (slug, label) => ({ key: slug, label, products: [slug] });

export const PROFESSIONAL_RECOMMENDATIONS = {
  // VONO manual p.8. The two VONO formulas are already in the main kit.
  'vono-prime-peel': [
    { key: 'vono-ampoule', label: '導入安瓶・擇一搭配', products: [
      'rescuer-filagen-ampoule', 'rescuer-cica-pore-ampoule', 'a-c-control-ampoule-f',
    ] },
    item('soothing-mask', '舒緩護理'),
    item('ultra-pearl-velvet-mask', '面膜護理'),
    item('cell-phyto-anti-wrinkle-serum', '精華保養'),
    item('cell-memory-cream', '乳霜保養'),
    item('exo-clinica-uv-suncream', '防曬保養'),
  ],
  // Gold facial manual p.7. Gold Patch is the main product.
  'gold-patch': [
    item('respiration-snow-cream', '按摩護理'),
    { key: 'gold-ampoule', label: '導入安瓶・擇一搭配', products: [
      'c-p-50-ampoule', 'rescuer-hydra-complex-ampoule',
    ] },
    item('oxygen-bubble-pack', '面膜護理'),
    item('ultra-gold-velvet-mask', '面膜護理'),
  ],
  // Rejuven manual p.8. Excludes the two formulas already in the kit,
  // cleansing products and the separate cream introduction on p.9.
  'rejuven-fiber-ampoule-system': [
    item('shining-moisturizing-massage-cream', '按摩護理'),
    item('pha-soft-peel-15', '調理護理'),
    item('c-p-50-ampoule', '導入安瓶'),
    item('soothing-mask', '舒緩護理'),
    item('ultra-pearl-velvet-mask', '面膜護理'),
  ],
};
