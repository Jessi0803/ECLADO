#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function usage() {
  console.error('Usage: node scripts/drive-product-import.mjs <drive-folder> [output-dir]');
  process.exit(1);
}

function sqlString(value) {
  if (value == null || value === '') return 'null';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizeSpaces(text) {
  return text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function pickSection(text, label, stopLabels) {
  const start = text.indexOf(label);
  if (start < 0) return '';
  const from = start + label.length;
  const stops = stopLabels
    .map(stop => text.indexOf(stop, from))
    .filter(index => index >= 0);
  const end = stops.length ? Math.min(...stops) : text.length;
  return normalizeSpaces(text.slice(from, end).replace(/^[:：]/, ''));
}

function parsePrices(text) {
  const variants = [];
  const priceBlock = pickSection(text, '價格', []);
  const source = priceBlock || text;
  const pattern = /([0-9]+(?:\.[0-9]+)?\s*(?:ml|g|片|入|pcs|支|瓶|包|組)?)?\s*專業價\s*([0-9,]+)(?:\s*市場價\s*([0-9,]+))?/gi;
  let match;
  while ((match = pattern.exec(source))) {
    const size = normalizeSpaces(match[1] || '');
    const proPrice = Number(String(match[2]).replace(/,/g, '')) || 0;
    const price = match[3] ? Number(String(match[3]).replace(/,/g, '')) || 0 : 0;
    variants.push({
      id: size || `variant-${variants.length + 1}`,
      size,
      price,
      proPrice,
      stock: null,
      isDefault: variants.length === 0,
    });
  }

  return variants;
}

function inferCategory(name) {
  if (/面膜|膜/.test(name)) return '面膜';
  if (/眼/.test(name)) return '眼霜';
  if (/霜/.test(name)) return '面霜';
  if (/安瓶|精華/.test(name)) return '精華液';
  if (/潔|卸妝|泡泡|粉/.test(name)) return '清潔';
  return '精華液';
}

function productFromText(folderName, text, images, id) {
  const clean = normalizeSpaces(text);
  const description = pickSection(clean, '介紹', ['成分', '容量', '適合膚況', '價格']);
  const ingredients = pickSection(clean, '成分', ['容量', '適合膚況', '價格']);
  const skinType = pickSection(clean, '適合膚況', ['價格']);
  const variants = parsePrices(clean);
  const first = variants[0] || { size: pickSection(clean, '容量', ['適合膚況', '價格']), price: 0, proPrice: 0 };
  const hasMarketPrice = variants.some(variant => Number(variant.price) > 0);

  return {
    id,
    name: folderName,
    nameZh: folderName,
    category: inferCategory(folderName),
    size: first.size || pickSection(clean, '容量', ['適合膚況', '價格']),
    price: hasMarketPrice ? Number(first.price) || 0 : 0,
    proPrice: Number(first.proPrice) || 0,
    stock: 0,
    minStock: 3,
    isProOnly: !hasMarketPrice && variants.some(variant => Number(variant.proPrice) > 0),
    img: images[0] || '',
    imageUrls: images,
    desc: description,
    skinType,
    ingredients,
    features: description ? [description.split(/[。.\n]/).find(Boolean) || folderName] : [],
    variants,
    sourceFolderName: folderName,
    importedFromDrive: true,
    active: true,
  };
}

function productValues(product) {
  return [
    product.id,
    sqlString(product.name),
    sqlString(product.nameZh),
    sqlString(product.category),
    sqlString(product.size),
    product.price,
    product.proPrice,
    product.stock,
    product.minStock,
    product.isProOnly ? 'true' : 'false',
    sqlString(product.img),
    sqlString(JSON.stringify(product.imageUrls)),
    sqlString(product.desc),
    sqlString(product.skinType),
    sqlString(product.ingredients),
    sqlString(JSON.stringify(product.features)),
    sqlString(JSON.stringify(product.variants)),
    sqlString(product.sourceFolderName),
    product.importedFromDrive ? 'true' : 'false',
    product.active ? 'true' : 'false',
  ].join(', ');
}

function variantValues(product, variant, index) {
  return [
    product.id,
    sqlString(variant.id || variant.size || null),
    sqlString(variant.size || product.size || ''),
    Number(variant.price) || 0,
    Number(variant.proPrice) || 0,
    variant.stock == null ? 'null' : Number(variant.stock) || 0,
    index === 0 ? 'true' : 'false',
    index,
    'true',
  ].join(', ');
}

async function main() {
  const root = process.argv[2];
  if (!root) usage();
  const outputDir = process.argv[3] || path.join(process.cwd(), 'tmp', 'drive-product-import');
  await fs.mkdir(outputDir, { recursive: true });

  const entries = await fs.readdir(root, { withFileTypes: true });
  const folders = entries.filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  const products = [];

  for (const [index, folder] of folders.entries()) {
    const folderPath = path.join(root, folder.name);
    const files = await fs.readdir(folderPath, { withFileTypes: true });
    const txt = files.find(file => file.isFile() && path.extname(file.name).toLowerCase() === '.txt');
    if (!txt) continue;

    const text = await fs.readFile(path.join(folderPath, txt.name), 'utf8');
    const images = files
      .filter(file => file.isFile() && IMAGE_EXTENSIONS.has(path.extname(file.name).toLowerCase()))
      .map(file => path.join(folderPath, file.name));
    products.push(productFromText(folder.name, text, images, index + 100));
  }

  const jsonPath = path.join(outputDir, 'products-import.json');
  await fs.writeFile(jsonPath, JSON.stringify(products, null, 2));

  const productRows = products.map(product => `  (${productValues(product)})`).join(',\n');
  const variantRows = products.flatMap(product => product.variants.map((variant, index) => `  (${variantValues(product, variant, index)})`)).join(',\n');
  const sql = `insert into public.products
  (id, name, name_zh, category, size, price, pro_price, stock, min_stock, is_pro_only, image_url, image_urls, description, skin_type, ingredients, features, variants, source_folder_name, imported_from_drive, active)
values
${productRows}
on conflict (id) do update set
  name = excluded.name,
  name_zh = excluded.name_zh,
  category = excluded.category,
  size = excluded.size,
  price = excluded.price,
  pro_price = excluded.pro_price,
  stock = excluded.stock,
  min_stock = excluded.min_stock,
  is_pro_only = excluded.is_pro_only,
  image_url = excluded.image_url,
  image_urls = excluded.image_urls,
  description = excluded.description,
  skin_type = excluded.skin_type,
  ingredients = excluded.ingredients,
  features = excluded.features,
  variants = excluded.variants,
  source_folder_name = excluded.source_folder_name,
  imported_from_drive = excluded.imported_from_drive,
  active = excluded.active,
  updated_at = now();

delete from public.product_variants
where product_id in (${products.map(product => product.id).join(', ')});

${variantRows ? `insert into public.product_variants
  (product_id, sku, size, price, pro_price, stock, is_default, sort_order, active)
values
${variantRows};` : '-- No variants found.'}
`;
  const sqlPath = path.join(outputDir, 'products-import.sql');
  await fs.writeFile(sqlPath, sql);

  console.log(`Wrote ${products.length} products`);
  console.log(jsonPath);
  console.log(sqlPath);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
