#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const FIELD_HEADINGS = [
  '產品名稱：',
  '功效副標：',
  '產品介紹：',
  '產品特色：',
  '主要成分：',
  '適用膚況：',
  '產品規格：',
];

function parseArgs(argv) {
  const args = { apply: false, verify: false, parseOnly: false, envFile: 'payment-api/.env', outputDir: 'tmp/product-txt-sync' };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--verify') args.verify = true;
    else if (arg === '--parse-only') args.parseOnly = true;
    else if (arg === '--env') args.envFile = argv[++index];
    else if (arg === '--output-dir') args.outputDir = argv[++index];
    else positional.push(arg);
  }
  if (!positional[0]) {
    throw new Error('Usage: node scripts/sync-products-from-txt.mjs <txt-root> [--parse-only] [--verify] [--apply]');
  }
  args.root = positional[0];
  return args;
}

function trimBlankLines(lines) {
  const result = [...lines];
  while (result[0]?.trim() === '') result.shift();
  while (result.at(-1)?.trim() === '') result.pop();
  return result;
}

function valueAfter(line, label) {
  return line.startsWith(label) ? line.slice(label.length).trim() : '';
}

function normalizeSize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[＊*xｘ]/g, '×')
    .replace(/pcs?/g, '支')
    .replace(/一盒/g, '／盒')
    .replace(/\s+/g, '');
}

function parseMoney(value, { allowNone = false } = {}) {
  const text = String(value || '').trim();
  if (allowNone && text === '無') return 0;
  if (!/^\d+$/.test(text)) throw new Error(`Invalid price: ${value}`);
  return Number(text);
}

function parseProductText(text, sourcePath) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (const heading of FIELD_HEADINGS) {
    if (!lines.some(line => line.startsWith(heading))) {
      throw new Error(`${sourcePath}: missing ${heading}`);
    }
  }

  const indexOf = label => lines.findIndex(line => line.startsWith(label));
  const nameIndex = indexOf('產品名稱：');
  const subtitleIndex = indexOf('功效副標：');
  const descriptionIndex = indexOf('產品介紹：');
  const featuresIndex = indexOf('產品特色：');
  const ingredientsIndex = indexOf('主要成分：');
  const skinTypeIndex = indexOf('適用膚況：');
  const specsIndex = indexOf('產品規格：');
  const indices = [nameIndex, subtitleIndex, descriptionIndex, featuresIndex, ingredientsIndex, skinTypeIndex, specsIndex];
  if (!indices.every((value, index) => index === 0 || value > indices[index - 1])) {
    throw new Error(`${sourcePath}: fields are out of order`);
  }

  const name = valueAfter(lines[nameIndex], '產品名稱：');
  const subtitleValue = valueAfter(lines[subtitleIndex], '功效副標：');
  const description = trimBlankLines(lines.slice(descriptionIndex + 1, featuresIndex)).join('\n');
  const featureLines = trimBlankLines(lines.slice(featuresIndex + 1, ingredientsIndex));
  const ingredientLines = trimBlankLines(lines.slice(ingredientsIndex + 1, skinTypeIndex));
  const skinType = trimBlankLines(lines.slice(skinTypeIndex + 1, specsIndex)).join('\n');

  const features = featureLines.length === 1 && featureLines[0].trim() === '無'
    ? []
    : featureLines.filter(line => line.trim()).map(line => line.replace(/^\s*•\s*/, '').trim());
  const ingredients = ingredientLines
    .filter(line => line.trim() && line.trim() !== '無')
    .map(line => line.replace(/^\s*•\s*/, '').replace(/｜無\s*$/, '').trim())
    .join('\n');

  const specs = [];
  let activeSpec = null;
  let ignoringBundleItem = false;
  for (const rawLine of lines.slice(specsIndex + 1)) {
    const line = rawLine.trim();
    const specMatch = line.match(/^\[規格(\d+)\]$/);
    const itemMatch = line.match(/^\[規格\d+-品項\d+\]$/);
    if (specMatch) {
      activeSpec = { index: Number(specMatch[1]), size: '', price: null, proPrice: null };
      specs.push(activeSpec);
      ignoringBundleItem = false;
      continue;
    }
    if (itemMatch) {
      ignoringBundleItem = true;
      activeSpec = null;
      continue;
    }
    if (!line || ignoringBundleItem || !activeSpec) continue;
    if (line.startsWith('規格名稱：')) activeSpec.size = valueAfter(line, '規格名稱：');
    else if (line.startsWith('專業價：')) activeSpec.proPrice = parseMoney(valueAfter(line, '專業價：'));
    else if (line.startsWith('市場價：')) activeSpec.price = parseMoney(valueAfter(line, '市場價：'), { allowNone: true });
  }

  if (!name) throw new Error(`${sourcePath}: product name is blank`);
  if (!description) throw new Error(`${sourcePath}: description is blank`);
  if (!skinType) throw new Error(`${sourcePath}: skin type is blank`);
  if (!specs.length) throw new Error(`${sourcePath}: at least one specification is required`);
  specs.forEach((spec, index) => {
    if (spec.index !== index + 1) throw new Error(`${sourcePath}: specification numbers must be consecutive`);
    if (!spec.size || spec.price == null || spec.proPrice == null) {
      throw new Error(`${sourcePath}: specification ${spec.index} is incomplete`);
    }
  });

  return {
    sourcePath,
    name,
    subtitle: subtitleValue === '無' ? null : subtitleValue,
    description,
    features,
    ingredients,
    skinType,
    specs,
    isProOnly: specs.every(spec => spec.price === 0),
  };
}

async function loadProducts(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const products = [];
  for (const entry of entries.filter(item => item.isDirectory())) {
    const folder = path.join(root, entry.name);
    const files = await fs.readdir(folder, { withFileTypes: true });
    const txtFiles = files.filter(file => file.isFile() && path.extname(file.name).toLowerCase() === '.txt');
    if (txtFiles.length !== 1) {
      if (txtFiles.length === 0) continue;
      throw new Error(`${folder}: expected one txt file, found ${txtFiles.length}`);
    }
    const sourcePath = path.join(folder, txtFiles[0].name);
    products.push({
      ...parseProductText(await fs.readFile(sourcePath, 'utf8'), sourcePath),
      sourceFolderName: entry.name,
    });
  }
  return products.sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant'));
}

async function readEnv(file) {
  const text = await fs.readFile(file, 'utf8');
  return Object.fromEntries(text.split(/\r?\n/).filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    }));
}

function chooseProductRow(parsed, rows) {
  const acceptedNames = new Set([parsed.name, parsed.sourceFolderName].filter(Boolean));
  const matches = rows.filter(row => acceptedNames.has(row.name) || acceptedNames.has(row.name_zh));
  if (matches.length > 1) throw new Error(`${parsed.name}: matched more than one database product`);
  return matches[0] || null;
}

function inferCategory(name) {
  if (/刮痧板|爆水按摩霜/.test(name)) return '其他';
  if (/潔顏|清潔|卸妝/.test(name)) return '清潔卸妝';
  if (/化妝水|爽膚水/.test(name)) return '化妝水';
  if (/安瓶|精華液|精華/.test(name)) return '安瓶精華';
  if (/雪霜|乳霜|面霜|眼霜/.test(name)) return '乳霜';
  throw new Error(`${name}: cannot infer category for a new product`);
}

function buildVariantPlan(parsed, productRow, existingRows) {
  const activeRows = existingRows.filter(row => row.active !== false);
  const unused = new Set(activeRows.map(row => row.id));
  const planned = parsed.specs.map((spec, index) => {
    let match = activeRows.find(row => unused.has(row.id) && normalizeSize(row.size) === normalizeSize(spec.size));
    if (!match && index === 0) {
      match = activeRows.find(row => unused.has(row.id) && row.is_default)
        || (activeRows.length === 1 ? activeRows[0] : null);
    }
    if (match) unused.delete(match.id);
    return {
      id: match?.id || null,
      product_id: productRow.id || null,
      sku: match?.sku || (productRow.id ? `P${productRow.id}-TXT-${index + 1}` : null),
      size: spec.size,
      price: spec.price,
      pro_price: spec.proPrice,
      stock: Number(match?.stock) || 0,
      is_default: index === 0,
      sort_order: index,
      active: true,
      previous: match || null,
    };
  });
  const preserved = activeRows
    .filter(row => unused.has(row.id))
    .map(row => ({
      id: row.id,
      product_id: productRow.id,
      sku: row.sku,
      size: row.size,
      price: Number(row.price) || 0,
      pro_price: Number(row.pro_price) || 0,
      stock: Number(row.stock) || 0,
      is_default: false,
      sort_order: Number(row.sort_order) || planned.length,
      active: true,
      previous: row,
      preserve: true,
    }));
  return [...planned, ...preserved];
}

function summarizeChange(parsed, row, variants) {
  const defaultVariant = variants[0];
  return {
    id: row.id,
    name: parsed.name,
    action: row.isNew ? 'insert-draft' : 'update',
    category: row.category,
    productChanges: {
      subtitle: { from: row.subtitle ?? null, to: parsed.subtitle },
      size: { from: row.size || '', to: defaultVariant.size },
      price: { from: Number(row.price) || 0, to: defaultVariant.price },
      pro_price: { from: Number(row.pro_price) || 0, to: defaultVariant.pro_price },
      is_pro_only: { from: !!row.is_pro_only, to: parsed.isProOnly },
      descriptionChanged: (row.description || '') !== parsed.description,
      skinTypeChanged: (row.skin_type || '') !== parsed.skinType,
      ingredientsChanged: (row.ingredients || '') !== parsed.ingredients,
      featuresChanged: JSON.stringify(row.features || []) !== JSON.stringify(parsed.features),
    },
    variants: variants.map(variant => ({
      id: variant.id,
      sku: variant.sku,
      size: variant.size,
      price: variant.price,
      pro_price: variant.pro_price,
      stock: variant.stock,
      is_default: variant.is_default,
      action: variant.preserve ? 'preserve' : (variant.id ? 'update' : 'insert'),
    })),
  };
}

async function applyPlan(supabase, plans) {
  for (const plan of plans) {
    if (plan.row.isNew) {
      const firstSpec = plan.parsed.specs[0];
      const insertResult = await supabase.from('products').insert({
        name: plan.parsed.name,
        name_zh: plan.parsed.name,
        subtitle: plan.parsed.subtitle,
        category: plan.row.category,
        size: firstSpec.size,
        price: firstSpec.price,
        pro_price: firstSpec.proPrice,
        stock: 0,
        min_stock: 3,
        is_pro_only: plan.parsed.isProOnly,
        description: plan.parsed.description,
        skin_type: plan.parsed.skinType,
        ingredients: plan.parsed.ingredients,
        features: plan.parsed.features,
        variants: [],
        source_folder_name: plan.parsed.sourceFolderName,
        imported_from_drive: false,
        publication_status: 'draft',
        active: false,
      }).select('*').single();
      if (insertResult.error) throw new Error(`${plan.parsed.name}: product insert failed: ${insertResult.error.message}`);
      plan.row = { ...insertResult.data, isNew: true };
      plan.variants = buildVariantPlan(plan.parsed, plan.row, []);
    }
    for (const variant of plan.variants) {
      if (variant.preserve) continue;
      const payload = {
        product_id: variant.product_id,
        sku: variant.sku,
        size: variant.size,
        price: variant.price,
        pro_price: variant.pro_price,
        stock: variant.stock,
        is_default: variant.is_default,
        sort_order: variant.sort_order,
        active: true,
        updated_at: new Date().toISOString(),
      };
      const query = variant.id
        ? supabase.from('product_variants').update(payload).eq('id', variant.id).eq('product_id', plan.row.id)
        : supabase.from('product_variants').insert(payload);
      const result = await query;
      if (result.error) throw new Error(`${plan.parsed.name}: variant write failed: ${result.error.message}`);
    }

    const variantResult = await supabase.from('product_variants').select('*')
      .eq('product_id', plan.row.id).eq('active', true).order('sort_order', { ascending: true });
    if (variantResult.error) throw new Error(`${plan.parsed.name}: variant readback failed: ${variantResult.error.message}`);
    const defaultVariant = variantResult.data.find(variant => variant.is_default);
    if (!defaultVariant) throw new Error(`${plan.parsed.name}: default variant is missing after write`);
    const variantsJson = variantResult.data.map(variant => ({
      id: String(variant.id), sku: variant.sku, size: variant.size,
      price: Number(variant.price), proPrice: Number(variant.pro_price), stock: variant.stock,
      isDefault: variant.is_default, sortOrder: variant.sort_order, active: variant.active,
    }));
    const productPayload = {
      subtitle: plan.parsed.subtitle,
      size: defaultVariant.size,
      price: Number(defaultVariant.price),
      pro_price: Number(defaultVariant.pro_price),
      stock: defaultVariant.stock,
      is_pro_only: plan.variants.every(variant => variant.price === 0),
      description: plan.parsed.description,
      skin_type: plan.parsed.skinType,
      ingredients: plan.parsed.ingredients,
      features: plan.parsed.features,
      variants: variantsJson,
      updated_at: new Date().toISOString(),
    };
    const result = await supabase.from('products').update(productPayload).eq('id', plan.row.id);
    if (result.error) throw new Error(`${plan.parsed.name}: product write failed: ${result.error.message}`);
  }
}

async function verifyAppliedPlans(supabase, plans) {
  const [productsResult, variantsResult] = await Promise.all([
    supabase.from('products').select('*').in('id', plans.map(plan => plan.row.id)),
    supabase.from('product_variants').select('*').in('product_id', plans.map(plan => plan.row.id)),
  ]);
  if (productsResult.error) throw productsResult.error;
  if (variantsResult.error) throw variantsResult.error;

  const failures = [];
  for (const plan of plans) {
    const row = productsResult.data.find(product => Number(product.id) === Number(plan.row.id));
    const rows = variantsResult.data.filter(variant => Number(variant.product_id) === Number(plan.row.id) && variant.active !== false);
    const expectedProOnly = plan.variants.every(variant => variant.price === 0);
    const expectedProduct = {
      subtitle: plan.parsed.subtitle,
      description: plan.parsed.description,
      skin_type: plan.parsed.skinType,
      ingredients: plan.parsed.ingredients,
      features: plan.parsed.features,
      size: plan.variants[0].size,
      price: plan.variants[0].price,
      pro_price: plan.variants[0].pro_price,
      is_pro_only: expectedProOnly,
    };
    if (!row) {
      failures.push(`${plan.parsed.name}: product readback missing`);
      continue;
    }
    for (const [field, expected] of Object.entries(expectedProduct)) {
      const actual = ['price', 'pro_price'].includes(field) ? Number(row[field]) : row[field];
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures.push(`${plan.parsed.name}: ${field} readback mismatch`);
      }
    }
    if (plan.row.isNew && (row.publication_status !== 'draft' || row.active !== false)) {
      failures.push(`${plan.parsed.name}: new product is not draft`);
    }
    for (const expected of plan.variants) {
      const actual = rows.find(variant => Number(variant.id) === Number(expected.id))
        || rows.find(variant => normalizeSize(variant.size) === normalizeSize(expected.size));
      if (!actual) {
        failures.push(`${plan.parsed.name}: variant ${expected.size} readback missing`);
        continue;
      }
      for (const field of ['sku', 'size', 'price', 'pro_price', 'stock', 'is_default', 'active']) {
        const expectedValue = ['price', 'pro_price', 'stock'].includes(field) ? Number(expected[field]) : expected[field];
        const actualValue = ['price', 'pro_price', 'stock'].includes(field) ? Number(actual[field]) : actual[field];
        if (actualValue !== expectedValue) failures.push(`${plan.parsed.name}: variant ${expected.size} ${field} readback mismatch`);
      }
    }
  }
  if (failures.length) throw new Error(`Readback verification failed:\n- ${failures.join('\n- ')}`);
  return { products: plans.length, variants: plans.reduce((sum, plan) => sum + plan.variants.length, 0) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const parsedProducts = await loadProducts(args.root);
  await fs.mkdir(args.outputDir, { recursive: true });
  await fs.writeFile(path.join(args.outputDir, 'parsed-products.json'), JSON.stringify(parsedProducts, null, 2));
  if (args.parseOnly) {
    console.log(JSON.stringify({ mode: 'parse-only', products: parsedProducts.length }));
    return;
  }

  const env = await readEnv(args.envFile);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase admin environment is incomplete');
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [productsResult, variantsResult] = await Promise.all([
    supabase.from('products').select('*'),
    supabase.from('product_variants').select('*').order('sort_order', { ascending: true }),
  ]);
  if (productsResult.error) throw productsResult.error;
  if (variantsResult.error) throw variantsResult.error;

  const plans = [];
  const blockers = [];
  for (const parsed of parsedProducts) {
    try {
      const matchedRow = chooseProductRow(parsed, productsResult.data);
      const row = matchedRow || {
        id: null,
        name: parsed.name,
        name_zh: parsed.name,
        category: inferCategory(parsed.name),
        publication_status: 'draft',
        active: false,
        isNew: true,
      };
      const existingVariants = row.id
        ? variantsResult.data.filter(variant => Number(variant.product_id) === Number(row.id))
        : [];
      const variants = buildVariantPlan(parsed, row, existingVariants);
      plans.push({ parsed, row, variants });
    } catch (error) {
      blockers.push(error.message || String(error));
    }
  }
  if (blockers.length) {
    await fs.writeFile(path.join(args.outputDir, 'preflight-blockers.json'), JSON.stringify(blockers, null, 2));
    throw new Error(`Preflight blocked:\n- ${blockers.join('\n- ')}`);
  }
  const report = plans.map(plan => summarizeChange(plan.parsed, plan.row, plan.variants));
  await fs.writeFile(path.join(args.outputDir, 'preflight-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode: args.apply ? 'apply' : (args.verify ? 'verify' : 'dry-run'), products: plans.length, report: path.join(args.outputDir, 'preflight-report.json') }));
  if (args.apply) {
    await applyPlan(supabase, plans);
    const verification = await verifyAppliedPlans(supabase, plans);
    console.log(JSON.stringify({ mode: 'verified', ...verification }));
  } else if (args.verify) {
    const verification = await verifyAppliedPlans(supabase, plans);
    console.log(JSON.stringify({ mode: 'verified', ...verification }));
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
