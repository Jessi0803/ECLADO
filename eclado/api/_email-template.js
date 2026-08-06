const SITE_URL = 'https://ecladotaiwan.com';
const LOGO_URL = `${SITE_URL}/assets/images/ECLADO%20LOGO%20with%20CI_WHITE.png`;

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function textToHtml(text = '') {
  return String(text)
    .split('\n')
    .map(line => line ? escapeHtml(line) : '&nbsp;')
    .join('<br>');
}

function buildBrandedEmailHtml(text) {
  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ECLADO Taiwan</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f4f1;color:#282725;font-family:'Open Sans',Arial,'Noto Sans TC',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5f4f1;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-collapse:collapse;">
            <tr>
              <td align="center" style="background:#181817;padding:28px 24px 24px;">
                <img src="${LOGO_URL}" width="168" alt="ECLADO Laboratory" style="display:block;width:168px;max-width:100%;height:auto;border:0;margin:0 auto;">
              </td>
            </tr>
            <tr>
              <td style="padding:38px 36px;font-size:14px;line-height:1.9;color:#4b4945;word-break:break-word;">
                ${textToHtml(text)}
              </td>
            </tr>
            <tr>
              <td align="center" style="border-top:1px solid #ece9e3;padding:22px 24px;font-size:11px;line-height:1.8;color:#99958d;">
                昭澄國際貿易有限公司<br>
                Zhao Cheng International Trading Co., Ltd.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

module.exports = { buildBrandedEmailHtml };
