#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const IMAGE_TYPES = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);
const BUCKET = 'product-images';
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const TARGET_UPLOAD_BYTES = 4.5 * 1024 * 1024;
const execFileAsync = promisify(execFile);

function usage(message = '') {
  if (message) console.error(message);
  console.error(`
Usage:
  node scripts/migrate-product-images-to-storage.mjs <drive-folder> [options]

Options:
  --env-file <path>   Environment file (default: .env.staging)
  --product <name>    Only process one exact source folder / Chinese product name
  --apply             Upload and save metadata (default is dry run)
  --replace           Replace existing active product_images metadata
  --concurrency <n>   Concurrent uploads per product (default: 4, max: 8)
  --output <path>     Manifest path
`);
  process.exit(message ? 1 : 0);
}

function parseArgs(argv) {
  const args = [...argv];
  const root = args.shift();
  if (!root || root === '--help') usage();
  const options = {
    root: path.resolve(root),
    envFile: '.env.staging',
    product: '',
    apply: false,
    replace: false,
    concurrency: 4,
    output: '',
  };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--apply') options.apply = true;
    else if (flag === '--replace') options.replace = true;
    else if (flag === '--env-file') options.envFile = args.shift() || usage('Missing --env-file value');
    else if (flag === '--product') options.product = args.shift() || usage('Missing --product value');
    else if (flag === '--output') options.output = args.shift() || usage('Missing --output value');
    else if (flag === '--concurrency') {
      options.concurrency = Number(args.shift());
      if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 8) {
        usage('--concurrency must be an integer from 1 to 8');
      }
    } else usage(`Unknown option: ${flag}`);
  }
  if (!options.output) {
    const mode = options.apply ? 'apply' : 'dry-run';
    options.output = path.resolve('tmp', 'product-image-migration', `manifest-${mode}.json`);
  }
  return options;
}

async function readEnv(filePath) {
  const content = await fs.readFile(path.resolve(filePath), 'utf8');
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

function sortImages(left, right) {
  const leftPrimary = left.name.includes('首圖');
  const rightPrimary = right.name.includes('首圖');
  if (leftPrimary !== rightPrimary) return leftPrimary ? -1 : 1;
  return left.name.localeCompare(right.name, 'zh-Hant', {
    numeric: true,
    sensitivity: 'base',
  });
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

async function optimizeOversizedImage(filePath, bytes) {
  if (bytes.length <= TARGET_UPLOAD_BYTES) {
    return { bytes, extension: path.extname(filePath).toLowerCase(), optimized: false };
  }
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'eclado-product-image-'));
  const outputPath = path.join(temporaryDirectory, 'optimized.jpg');
  try {
    for (const maxDimension of [2400, 2000, 1600]) {
      await execFileAsync('/usr/bin/sips', [
        '--resampleHeightWidthMax', String(maxDimension),
        '--setProperty', 'format', 'jpeg',
        '--setProperty', 'formatOptions', '82',
        filePath,
        '--out', outputPath,
      ]);
      const optimizedBytes = await fs.readFile(outputPath);
      if (optimizedBytes.length <= TARGET_UPLOAD_BYTES) {
        return { bytes: optimizedBytes, extension: '.jpg', optimized: true };
      }
    }
    throw new Error(`Unable to optimize image below ${MAX_UPLOAD_BYTES} bytes: ${filePath}`);
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function imageDescriptor(folderPath, file, product, index) {
  const filePath = path.join(folderPath, file.name);
  const sourceBytes = await fs.readFile(filePath);
  const optimizedImage = await optimizeOversizedImage(filePath, sourceBytes);
  const bytes = optimizedImage.bytes;
  const extension = optimizedImage.extension;
  const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const normalizedExtension = extension === '.jpeg' ? '.jpg' : extension;
  const storagePath = `products/${product.asset_key}/${String(index + 1).padStart(2, '0')}-${hash}${normalizedExtension}`;
  return {
    filePath,
    bytes,
    storagePath,
    originalName: file.name,
    mimeType: IMAGE_TYPES.get(extension),
    fileSize: bytes.length,
    sourceFileSize: sourceBytes.length,
    optimized: optimizedImage.optimized,
    altText: `${product.name_zh}${index === 0 ? '首圖' : `附圖 ${index + 1}`}`,
    sortOrder: index,
    isPrimary: index === 0,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = await readEnv(options.envFile);
  const supabaseUrl = env.STAGING_SUPABASE_URL || env.SUPABASE_URL;
  const serviceRoleKey = env.STAGING_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    usage('Environment file must provide Supabase URL and service role key');
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const entries = await fs.readdir(options.root, { withFileTypes: true });
  const folders = entries
    .filter(entry => entry.isDirectory())
    .filter(entry => !options.product || entry.name === options.product)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  if (!folders.length) throw new Error('No matching product folders found');

  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id,name_zh,source_folder_name,asset_key,active');
  if (productsError) throw productsError;

  const manifest = {
    mode: options.apply ? 'apply' : 'dry-run',
    generatedAt: new Date().toISOString(),
    bucket: BUCKET,
    root: options.root,
    products: [],
  };

  for (const folder of folders) {
    const productMatches = products.filter(product => (
      product.source_folder_name === folder.name || product.name_zh === folder.name
    ));
    if (productMatches.length !== 1) {
      manifest.products.push({
        folder: folder.name,
        status: productMatches.length ? 'ambiguous-product' : 'product-not-found',
      });
      continue;
    }
    const product = productMatches[0];
    const folderPath = path.join(options.root, folder.name);
    const files = (await fs.readdir(folderPath, { withFileTypes: true }))
      .filter(file => file.isFile() && IMAGE_TYPES.has(path.extname(file.name).toLowerCase()))
      .sort(sortImages);
    if (!files.length) {
      manifest.products.push({ folder: folder.name, productId: product.id, status: 'no-images' });
      continue;
    }

    const { data: existingImages, error: existingError } = await supabase
      .from('product_images')
      .select('id,storage_path,active,is_primary,sort_order')
      .eq('product_id', product.id);
    if (existingError) throw existingError;
    if (existingImages.some(image => image.active) && !options.replace) {
      manifest.products.push({
        folder: folder.name,
        productId: product.id,
        status: 'skipped-existing-images',
        existingImages,
      });
      continue;
    }

    const descriptors = await Promise.all(
      files.map((file, index) => imageDescriptor(folderPath, file, product, index)),
    );
    const hasNamedPrimary = files.some(file => file.name.includes('首圖'));
    const item = {
      folder: folder.name,
      productId: product.id,
      assetKey: product.asset_key,
      status: options.apply ? 'pending' : 'ready',
      primarySelection: {
        originalName: descriptors[0].originalName,
        reason: hasNamedPrimary ? 'filename-contains-primary-marker' : 'first-image-fallback',
      },
      images: descriptors.map(({ bytes, filePath, ...image }) => ({ ...image, filePath })),
    };
    manifest.products.push(item);
    if (!options.apply) continue;

    const uploadedPaths = [];
    try {
      await mapLimit(descriptors, options.concurrency, async descriptor => {
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(descriptor.storagePath, descriptor.bytes, {
            contentType: descriptor.mimeType,
            cacheControl: '31536000',
            upsert: false,
          });
        if (error && String(error.statusCode || '') !== '409') throw error;
        if (!error) uploadedPaths.push(descriptor.storagePath);
      });

      const { error: saveError } = await supabase.rpc('save_product_images', {
        p_product_id: product.id,
        p_images: descriptors.map(descriptor => ({
          storage_path: descriptor.storagePath,
          original_name: descriptor.originalName,
          alt_text: descriptor.altText,
          sort_order: descriptor.sortOrder,
          is_primary: descriptor.isPrimary,
          active: true,
          mime_type: descriptor.mimeType,
          file_size: descriptor.fileSize,
        })),
      });
      if (saveError) throw saveError;
      item.status = 'migrated';
    } catch (error) {
      if (uploadedPaths.length) await supabase.storage.from(BUCKET).remove(uploadedPaths);
      item.status = 'failed';
      item.error = error.message || String(error);
    }
  }

  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await fs.writeFile(options.output, JSON.stringify(manifest, null, 2));
  const summary = manifest.products.reduce((counts, product) => {
    counts[product.status] = (counts[product.status] || 0) + 1;
    return counts;
  }, {});
  console.log(JSON.stringify({ mode: manifest.mode, output: options.output, summary }, null, 2));
  if (manifest.products.some(product => product.status === 'failed')) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
