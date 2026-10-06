#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'product-images';
const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_QUALITY = 80;

function usage(message = '') {
  if (message) console.error(message);
  console.error(`
Usage:
  node scripts/migrate-storage-product-images-to-webp.mjs [options]

Options:
  --env-file <path>       Environment file (default: .env.staging)
  --product-id <id>       Only process one product
  --apply                 Upload WebP files and switch active metadata (default is dry run)
  --max-dimension <px>    Longest output edge (default: 1600)
  --quality <1-100>       WebP quality (default: 80)
  --concurrency <n>       Concurrent conversions (default: 3, max: 6)
  --output <path>         Manifest path

Original Storage objects are intentionally retained for historical order snapshots and rollback.
`);
  process.exit(message ? 1 : 0);
}

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    envFile: '.env.staging',
    productId: null,
    apply: false,
    maxDimension: DEFAULT_MAX_DIMENSION,
    quality: DEFAULT_QUALITY,
    concurrency: 3,
    output: '',
  };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--apply') options.apply = true;
    else if (flag === '--env-file') options.envFile = args.shift() || usage('Missing --env-file value');
    else if (flag === '--product-id') options.productId = Number(args.shift());
    else if (flag === '--max-dimension') options.maxDimension = Number(args.shift());
    else if (flag === '--quality') options.quality = Number(args.shift());
    else if (flag === '--concurrency') options.concurrency = Number(args.shift());
    else if (flag === '--output') options.output = args.shift() || usage('Missing --output value');
    else if (flag === '--help') usage();
    else usage(`Unknown option: ${flag}`);
  }
  if (options.productId != null && (!Number.isInteger(options.productId) || options.productId <= 0)) usage('--product-id must be a positive integer');
  if (!Number.isInteger(options.maxDimension) || options.maxDimension < 400 || options.maxDimension > 3000) usage('--max-dimension must be from 400 to 3000');
  if (!Number.isInteger(options.quality) || options.quality < 40 || options.quality > 95) usage('--quality must be from 40 to 95');
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 6) usage('--concurrency must be from 1 to 6');
  if (!options.output) {
    const mode = options.apply ? 'apply' : 'dry-run';
    options.output = path.resolve('tmp', 'product-image-webp', `manifest-${mode}.json`);
  }
  return options;
}

async function readEnv(filePath) {
  const content = await fs.readFile(path.resolve(filePath), 'utf8');
  return Object.fromEntries(content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }));
}

async function mapLimit(values, limit, task) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await task(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

function isWebp(image) {
  return image.mime_type === 'image/webp' || String(image.storage_path).toLowerCase().endsWith('.webp');
}

function webpPath(storagePath, bytes) {
  const parsed = path.posix.parse(storagePath);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  return path.posix.join(parsed.dir, `${parsed.name}-web-${hash}.webp`);
}

async function convertImage(supabase, image, options) {
  if (isWebp(image)) return { id: image.id, productId: image.product_id, sourcePath: image.storage_path, status: 'skipped-webp' };
  const { data: sourceBlob, error: downloadError } = await supabase.storage.from(BUCKET).download(image.storage_path);
  if (downloadError) throw new Error(`Download failed: ${downloadError.message}`);
  const sourceBytes = Buffer.from(await sourceBlob.arrayBuffer());
  const { data: webpBytes, info } = await sharp(sourceBytes)
    .rotate()
    .resize({ width: options.maxDimension, height: options.maxDimension, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: options.quality, effort: 5 })
    .toBuffer({ resolveWithObject: true });
  const targetPath = webpPath(image.storage_path, webpBytes);
  return {
    id: image.id,
    productId: image.product_id,
    sourcePath: image.storage_path,
    targetPath,
    sourceBytes: sourceBytes.length,
    targetBytes: webpBytes.length,
    savedBytes: sourceBytes.length - webpBytes.length,
    width: info.width,
    height: info.height,
    bytes: webpBytes,
    status: options.apply ? 'ready-to-apply' : 'ready',
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = await readEnv(options.envFile);
  const supabaseUrl = env.STAGING_SUPABASE_URL || env.SUPABASE_URL;
  const serviceRoleKey = env.STAGING_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) usage('Environment file must provide Supabase URL and service role key');
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let query = supabase
    .from('product_images')
    .select('id,product_id,storage_path,original_name,alt_text,sort_order,is_primary,active,mime_type,file_size,width,height')
    .eq('active', true)
    .order('product_id')
    .order('sort_order');
  if (options.productId != null) query = query.eq('product_id', options.productId);
  const { data: images, error: imageError } = await query;
  if (imageError) throw imageError;

  const converted = await mapLimit(images || [], options.concurrency, async image => {
    try {
      return await convertImage(supabase, image, options);
    } catch (error) {
      return { id: image.id, productId: image.product_id, sourcePath: image.storage_path, status: 'failed', error: error.message || String(error) };
    }
  });

  if (options.apply) {
    const productIds = [...new Set((images || []).map(image => image.product_id))];
    for (const productId of productIds) {
      const sourceRows = images.filter(image => image.product_id === productId);
      const convertedById = new Map(converted.filter(item => item.productId === productId).map(item => [item.id, item]));
      const ready = converted.filter(item => item.productId === productId && item.status === 'ready-to-apply');
      if (!ready.length) continue;
      if (converted.some(item => item.productId === productId && item.status === 'failed')) {
        ready.forEach(item => { item.status = 'skipped-product-failure'; delete item.bytes; });
        continue;
      }

      const uploadedPaths = [];
      try {
        for (const item of ready) {
          const { error: uploadError } = await supabase.storage.from(BUCKET).upload(item.targetPath, item.bytes, {
            contentType: 'image/webp',
            cacheControl: '31536000',
            upsert: false,
          });
          if (uploadError && String(uploadError.statusCode || '') !== '409') throw uploadError;
          if (!uploadError) uploadedPaths.push(item.targetPath);
        }
        const payload = sourceRows.map(row => {
          const replacement = convertedById.get(row.id);
          return {
            id: row.id,
            storage_path: replacement?.targetPath || row.storage_path,
            original_name: row.original_name,
            alt_text: row.alt_text,
            sort_order: row.sort_order,
            is_primary: row.is_primary,
            active: row.active,
            mime_type: replacement?.targetPath ? 'image/webp' : row.mime_type,
            file_size: replacement?.targetBytes || row.file_size,
            width: replacement?.width || row.width,
            height: replacement?.height || row.height,
          };
        });
        const { error: saveError } = await supabase.rpc('save_product_images', { p_product_id: productId, p_images: payload });
        if (saveError) throw saveError;
        ready.forEach(item => { item.status = 'migrated'; delete item.bytes; });
      } catch (error) {
        if (uploadedPaths.length) await supabase.storage.from(BUCKET).remove(uploadedPaths);
        ready.forEach(item => { item.status = 'failed'; item.error = error.message || String(error); delete item.bytes; });
      }
    }
  }

  converted.forEach(item => { delete item.bytes; });
  const summary = converted.reduce((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, {});
  const totals = converted.reduce((result, item) => ({
    sourceBytes: result.sourceBytes + (item.sourceBytes || 0),
    targetBytes: result.targetBytes + (item.targetBytes || 0),
    savedBytes: result.savedBytes + (item.savedBytes || 0),
  }), { sourceBytes: 0, targetBytes: 0, savedBytes: 0 });
  const manifest = { mode: options.apply ? 'apply' : 'dry-run', generatedAt: new Date().toISOString(), options: { ...options, envFile: path.basename(options.envFile) }, summary, totals, images: converted };
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await fs.writeFile(options.output, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ mode: manifest.mode, output: options.output, summary, totals }, null, 2));
  if (converted.some(item => item.status === 'failed')) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
