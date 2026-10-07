import { expect, test } from '@playwright/test';
import { mockEcladoApis } from './support/eclado-mocks';

test('新獎狀上傳 WebP 並以新增模式呼叫 RPC', async ({ page }) => {
  await mockEcladoApis(page);
  let uploadPath = '';
  let payload: Record<string, unknown> = {};
  await page.route('**/storage/v1/object/professional-renewal-evidence/**', async route => {
    uploadPath = new URL(route.request().url()).pathname;
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ Key:uploadPath }) });
  });
  await page.route('**/rest/v1/rpc/save_professional_award_evidence', async route => {
    payload = route.request().postDataJSON();
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ id:'saved-award' }) });
  });
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100; canvas.height = 100;
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
    const file = new File([blob], 'award.png', { type:'image/png' });
    const { uploadProfessionalAwardEvidence } = await import('/src/services/professionalRenewals.js');
    return uploadProfessionalAwardEvidence('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      studentName:'測試學員', completedOn:'2026-10-01', awardNumber:'TEST-001', consentAcknowledged:true,
    }, file);
  });
  expect(result.error).toBeNull();
  expect(payload.p_evidence_id).toBeNull();
  expect(payload.p_mime_type).toBe('image/webp');
  expect(payload.p_original_name).toBe('award.png');
  expect(payload.p_storage_path).toMatch(/^aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/[0-9a-f-]{36}\/award\.webp$/);
  expect(uploadPath).toContain(String(payload.p_storage_path));
});
