const DEFAULT_SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';

// 歷史補登訂單是已完成的舊交易，任何顧客通知都是多餘的。
// 查不到或查詢失敗時回傳 false：寧可讓正常訂單照常通知，也不要整批靜默。
async function isHistoricalOrder(orderId) {
  const id = String(orderId || '').trim();
  if (!id) return false;

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) return false;

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(id)}&select=order_source`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      },
    );
    if (!response.ok) {
      console.warn('[historical-order] lookup failed', response.status, id);
      return false;
    }
    const rows = await response.json().catch(() => []);
    return Array.isArray(rows) && rows[0]?.order_source === 'historical_manual';
  } catch (error) {
    console.warn('[historical-order] lookup error', error?.message || error);
    return false;
  }
}

module.exports = { isHistoricalOrder };
