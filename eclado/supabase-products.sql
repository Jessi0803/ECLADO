-- ECLADO products / inventory table
-- Run once in Supabase SQL Editor.

create table if not exists public.products (
  id integer primary key,
  name text not null,
  name_zh text not null,
  category text not null,
  size text,
  price numeric not null default 0,
  pro_price numeric not null default 0,
  stock integer not null default 0 check (stock >= 0),
  min_stock integer not null default 3 check (min_stock >= 0),
  is_pro_only boolean not null default false,
  image_url text,
  image_urls jsonb not null default '[]'::jsonb,
  description text,
  skin_type text,
  ingredients text,
  features jsonb not null default '[]'::jsonb,
  variants jsonb not null default '[]'::jsonb,
  product_list_image_scale numeric,
  source_folder_name text,
  imported_from_drive boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products add column if not exists image_urls jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists variants jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists product_list_image_scale numeric;
alter table public.products add column if not exists source_folder_name text;
alter table public.products add column if not exists imported_from_drive boolean not null default false;

create table if not exists public.product_variants (
  id bigserial primary key,
  product_id integer not null references public.products(id) on delete cascade,
  sku text,
  size text not null,
  price numeric not null default 0,
  pro_price numeric not null default 0,
  stock integer check (stock is null or stock >= 0),
  is_default boolean not null default false,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_product_variants_product_id
  on public.product_variants(product_id);

drop trigger if exists trg_product_variants_updated_at on public.product_variants;
create trigger trg_product_variants_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();

alter table public.product_variants enable row level security;

drop policy if exists "product_variants_select_all" on public.product_variants;
drop policy if exists "product_variants_insert_all" on public.product_variants;
drop policy if exists "product_variants_update_all" on public.product_variants;
drop policy if exists "product_variants_delete_all" on public.product_variants;
drop policy if exists "product_variants_select_active" on public.product_variants;
create policy "product_variants_select_active"
  on public.product_variants for select to anon, authenticated
  using (
    active is true
    and exists (
      select 1
      from public.products product
      where product.id = product_variants.product_id
        and product.active is true
    )
  );

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

alter table public.products enable row level security;

drop policy if exists "products_select_all" on public.products;
drop policy if exists "products_insert_all" on public.products;
drop policy if exists "products_update_all" on public.products;
drop policy if exists "products_delete_all" on public.products;
drop policy if exists "products_select_active" on public.products;
create policy "products_select_active"
  on public.products for select to anon, authenticated
  using (active is true);

insert into public.products
  (id, name, name_zh, category, size, price, pro_price, stock, min_stock, is_pro_only, image_url, description, skin_type, ingredients, features)
values
  (1, 'Deep Cleansing Foam', '深層清潔泡沫洗面乳', '清潔', '200ml', 1280, 960, 48, 3, false, 'https://images.unsplash.com/photo-1556228578-dd539282b964?w=600&q=80&fit=crop', '輕柔起泡配方，能溶解彩妝與皮脂污垢，同時維持肌膚柔軟與水潤度。富含天然植萃成分，洗後清爽不刺激，不緊繃。', '全膚質、敏感肌', '椰油兩性醋酸鈉、胺基酸系界面活性劑、綠茶萃取、甜菜鹼', '["溫和低刺激配方","洗後保濕不緊繃","維持肌膚天然皮脂"]'::jsonb),
  (2, 'Peptide Repair Serum', '胜肽修護精華液', '精華液', '30ml', 3980, 2980, 2, 3, false, 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=600&q=80&fit=crop', '結合多重胜肽與保濕修護成分，於肌膚表層形成持久保濕層，質地細緻清爽，協助改善因乾燥引起的細紋，長期使用可提升肌膚彈潤感。', '乾燥肌、熟齡肌、缺乏彈性肌', '乙醯六胜肽-8、玻尿酸鈉、腺苷、積雪草萃取、水解膠原蛋白', '["多重胜肽複合修護","深層長效補水","改善細紋外觀"]'::jsonb),
  (3, 'SOS Ampoule Set', '急救修護安瓶組', '急救安瓶', '5ml×6', 4800, 3600, 15, 3, false, 'https://images.unsplash.com/photo-1617897903246-719242758050?w=600&q=80&fit=crop', '專為膚況不穩定肌膚設計的集中護理方案，抑制造成肌膚不穩定的外在因素，幫助迅速恢復肌膚平衡，適合於專業護理中搭配使用。', '敏弱肌、膚況不穩定、易泛紅肌膚', '積雪草萃取、玻尿酸鈉、穀胱甘肽、胺基酸複合成分、尿囊素', '["即時鎮靜舒緩","修護肌膚屏障","集中密集護理"]'::jsonb),
  (4, 'Intensive Hydra Mask', '密集保濕面膜', '面膜', '35ml×10', 2200, 1650, 1, 3, false, 'https://images.unsplash.com/photo-1629198688000-71f23e745b6e?w=600&q=80&fit=crop', '採用ECLADO獨家紗布技術，帶來不同層次的彈力貼合感。源源不絕的水分供應，立即舒緩及帶來清涼感，獨家提拉技術即時呈現緊緻效果。', '全膚質、乾燥缺水肌', '聚谷氨酸、β-葡聚糖、海藻糖、玻尿酸鈉、積雪草萃取', '["長效肌膚保濕","立即舒緩清涼","獨家提拉緊緻技術"]'::jsonb),
  (5, 'Eye Contour Complex', '眼周緊緻精華', '眼霜', '30ml', 2800, 2100, 22, 3, false, 'https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=600&q=80&fit=crop', '專為乾燥、粗糙的眼周與唇周肌膚設計的高保濕修護精華。質地滋潤但不厚重，協助改善因乾燥引起的細紋，使眼周肌膚維持柔嫩平滑觸感。', '眼周細紋初期保養、乾燥眼周肌膚', '杏桃仁油、澳洲胡桃籽油、玻尿酸鈉、胜肽5、寡胜肽-1、植物性角鯊烷', '["眼周深層滋養","改善細紋外觀","提升眼周彈潤"]'::jsonb),
  (6, 'Cell Recovery Cream', '細胞修護乳霜', '面霜', '50g', 3600, 2700, 8, 3, false, 'https://images.unsplash.com/photo-1612817288484-6f916006741a?w=600&q=80&fit=crop', '添加植物來源培養萃取成分，協助強化肌膚保水力與自我防禦力，卓越效果特別適合受損肌膚修護。質地滋潤不厚重，使肌膚呈現柔嫩平滑的健康光澤。', '熟齡肌、乾燥肌、需加強保養者', '綠豆分生組織培養萃取、Sodium DNA、sh-Oligopeptide-1、蘆薈葉萃取、維他命E、腺苷', '["植物培養萃取活化","強化肌膚保水屏障","修護受損肌膚"]'::jsonb),
  (7, 'NK Cell Activator', 'NK細胞活化安瓶', '急救安瓶', '3.5ml×10', 8800, 6600, 0, 3, true, 'https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?w=600&q=80&fit=crop', '結合多種植物來源培養萃取成分，為肌膚提供集中彈潤調理。質地細緻好吸收，適合用於彈性不足與膚況疲憊的專業護理，長期使用幫助肌膚維持柔嫩光澤。', '彈性不足肌、疲憊老化肌膚', '綠豆分生組織培養萃取、Peption 5、sh-Oligopeptide-1、雪絨花癒傷組織培養萃取、番茄癒傷組織培養萃取', '["院線專業集中護理","多重培養萃取技術","提升肌膚彈潤光澤"]'::jsonb),
  (8, 'AHA/BHA Peeling Gel', 'AHA·BHA·PHA 煥膚凝膠', '清潔', '120ml', 1980, 1485, 31, 3, false, 'https://images.unsplash.com/photo-1631390737500-0d64c52c7aa4?w=600&q=80&fit=crop', 'AHA、BHA、PHA三效合一，即時去除多餘角質，正常化肌膚更新週期。6種草本植萃成分，在溫和代謝老廢角質的同時，最小化酸類引起的肌膚刺激感。', '混合肌、毛孔堵塞肌、暗沉代謝慢膚況', '乳酸、甘醇酸、葡萄糖酸內酯、馬齒莧萃取、積雪草萃取、蘆薈葉萃取', '["三酸溫和煥膚","6種草本舒緩刺激","改善暗沉毛孔"]'::jsonb),
  (9, 'Payment Test Product', '金流測試商品', '清潔', '測試用', 5, 5, 999, 3, false, 'https://images.unsplash.com/photo-1556228453-efd6c1ff04f6?w=600&q=80&fit=crop', '僅供金流測試使用的低金額商品，用於確認信用卡、Apple Pay、Google Pay 與付款通知流程。', '測試用途', '金流測試品項', '["低金額測試","一般會員可購買","不影響正式商品價格"]'::jsonb)
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
  description = excluded.description,
  skin_type = excluded.skin_type,
  ingredients = excluded.ingredients,
  features = excluded.features,
  updated_at = now();

do $$
begin
  begin
    alter publication supabase_realtime add table public.products;
  exception when duplicate_object then
    null;
  end;
  begin
    alter publication supabase_realtime add table public.product_variants;
  exception when duplicate_object then
    null;
  end;
end;
$$;
