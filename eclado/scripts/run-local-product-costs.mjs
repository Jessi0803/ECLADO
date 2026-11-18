// Local-only worker. Set PRODUCT_COST_LOCAL_URL and PRODUCT_COST_LOCAL_SERVICE_KEY.
import { createClient } from '@supabase/supabase-js';
import { setTimeout as sleep } from 'node:timers/promises';

const url = new URL(process.env.PRODUCT_COST_LOCAL_URL || 'http://127.0.0.1:54321');
if (!['127.0.0.1', '[::1]'].includes(url.hostname) || url.protocol !== 'http:'
  || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  throw new Error('Product cost worker accepts a local loopback Supabase URL only.');
}
const key = process.env.PRODUCT_COST_LOCAL_SERVICE_KEY;
if (!key) throw new Error('Set PRODUCT_COST_LOCAL_SERVICE_KEY for the local database.');
const client = createClient(url.origin, key, { auth: { persistSession: false, autoRefreshToken: false } });
const once = process.argv.includes('--once');

do {
  try {
    let count;
    do {
      const { data, error } = await client.rpc('run_product_costs', { p_limit: 250 });
      if (error) throw error;
      count = data;
      if (count) console.log(`Processed ${count} product cost events.`);
    } while (count === 250);
  } catch (failure) {
    console.error(failure.message || 'Product cost worker failed.');
    if (once) process.exitCode = 1;
  }
  if (!once) await sleep(30_000);
} while (!once);
