import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase-professional-application-certificates.sql'),
  'utf8',
);

test('美容師證照使用私人 bucket 並限制圖片格式、大小與數量', () => {
  expect(sql).toContain("'professional-certificates'");
  expect(sql).toContain('false,');
  expect(sql).toContain('5242880');
  expect(sql).toContain("array['image/jpeg', 'image/png', 'image/webp']");
  expect(sql).toContain('if certificate_count > 3 then');
});

test('證照圖片只允許本人上傳與讀取，會員管理權限可讀', () => {
  expect(sql).toContain("(storage.foldername(name))[1] = auth.uid()::text");
  expect(sql).toContain("has_backoffice_permission('members.read')");
  expect(sql).toContain('application.user_id = auth.uid()');
  expect(sql).toContain('professional_certificate_objects_delete_unlinked_own');
});

test('不同 Storage bucket 的讀取不會被商品資料表權限連帶阻擋', () => {
  expect(sql).toContain('is_public_product_image_storage_path');
  expect(sql).toContain('security definer');
  expect(sql).toContain('drop policy if exists "product_images_storage_select_linked"');
  expect(sql).toContain('public.is_public_product_image_storage_path(storage.objects.name)');
});

test('申請 RPC 驗證 Storage 物件並以同一交易綁定圖片', () => {
  expect(sql).toContain('submit_professional_application_with_certificates');
  expect(sql).toContain('select 1 from storage.objects object');
  expect(sql).toContain('insert into public.professional_applications');
  expect(sql).toContain('insert into public.professional_application_certificates');
  expect(sql).toContain("grant execute on function public.submit_professional_application_with_certificates");
});
