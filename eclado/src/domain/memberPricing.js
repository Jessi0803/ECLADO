export const PRICING_ROLES = ['instructor', 'distributor', 'staff'];
export const PRICING_LABELS = { instructor:'師資', distributor:'經銷商', staff:'內部人員' };
export const LEGACY_PRICING_DEFAULTS = { instructor:0.7, distributor:0.65, staff:0.5 };

export function parseFold(value, optional = false) {
  if (String(value ?? '').trim() === '') {
    if (optional) return null;
    throw new Error('請填寫折數');
  }
  const text = String(value).trim();
  const fold = Number(text);
  if (!/^\d+(\.\d{1,2})?$/.test(text) || fold <= 0 || fold > 10) {
    throw new Error('折數須大於 0 且不超過 10，最多兩位小數');
  }
  return Math.round(fold * 100) / 1000;
}

export function formatFold(multiplier) {
  return Number((Number(multiplier) * 10).toFixed(2));
}

export function pricingFieldsFromRow(row) {
  const migrated = Object.prototype.hasOwnProperty.call(row, 'instructor_price_multiplier');
  return {
    pricingOverrides: Object.fromEntries(PRICING_ROLES.map(role => [role,
      migrated ? (row[`${role}_price_multiplier`] == null ? null : Number(row[`${role}_price_multiplier`]))
        : (row.apply_tier_multiplier === false ? 1 : null),
    ])),
    pricingDefaults: row.pricing_defaults || LEGACY_PRICING_DEFAULTS,
    memberPricingReady: migrated && Boolean(row.pricing_defaults),
  };
}

export function getProductMultiplier(product, role) {
  if (PRICING_ROLES.includes(role)) {
    if (product.pricingOverrides) {
      return product.pricingOverrides[role] ?? product.pricingDefaults?.[role] ?? LEGACY_PRICING_DEFAULTS[role];
    }
    return product.applyTierMultiplier === false ? 1 : LEGACY_PRICING_DEFAULTS[role];
  }
  return role === 'pro' ? 1 : null;
}

export function usesFixedProfessionalPrice(product, role) {
  if (!product.pricingOverrides) return product.applyTierMultiplier === false;
  return product.pricingOverrides[role] === 1
    || (role === 'pro' && PRICING_ROLES.every(key => product.pricingOverrides[key] === 1));
}
