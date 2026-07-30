import React from 'react';
import useIsMobile from '../hooks/useIsMobile.js';

// ─── PRIVACY PAGE ────────────────────────────────────────────────────────────
export default function PrivacyPage() {
  const isMobile = useIsMobile();
  const sections = [
    {
      title: '一、蒐集主體',
      content: `本隱私權政策適用於 ECLADO Taiwan（以下稱「本公司」）。本公司依據中華民國《個人資料保護法》及相關法令規定，訂定本政策以保障您的個人資料權益。`,
    },
    {
      title: '二、蒐集目的與資料種類',
      content: `本公司基於下列目的蒐集您的個人資料：

• 會員帳號建立與身分識別：姓名、電子郵件、手機號碼、LINE 使用者 ID
• 訂單處理與物流配送：收件人姓名、收件地址、聯絡電話
• 金流付款處理：由永豐銀行豐收款代為處理，本公司不儲存完整信用卡資料
• 行銷推廣及服務通知：電子郵件、LINE 推播通知
• 美容師專業會員審核：執照影本或相關資格證明（僅用於資格審查，審核後刪除）`,
    },
    {
      title: '三、資料使用方式',
      content: `所蒐集之個人資料，將用於：

• 處理訂單、安排出貨及退換貨事宜
• 發送訂單狀態通知（LINE 訊息、電子郵件）
• 提供會員登入驗證及帳號管理
• 改善網站服務品質與使用者體驗
• 依法律規定或主管機關要求提供

本公司不會將您的個人資料出售予第三方，亦不會用於與上述目的無關之用途。`,
    },
    {
      title: '四、第三方資料分享',
      content: `為提供完整服務，本公司與以下第三方業者共享必要資料：

• LINE Taiwan：用於 LINE 帳號登入驗證、Email 取得及訊息推播，適用 LINE 隱私權政策
• 永豐商業銀行（豐收款）：用於處理線上付款，適用永豐銀行隱私權政策
• Supabase Inc.：本公司使用之雲端資料庫服務，資料儲存於其安全環境中
• 順豐物流：提供配送服務，需提供收件人姓名、地址、電話

上述業者均受本公司契約約束，僅得在提供服務所必要範圍內使用您的資料。`,
    },
    {
      title: '五、資料保護措施',
      content: `本公司採取以下安全措施保護您的個人資料：

• 資料庫存取採行列層級安全（Row Level Security）控制
• 傳輸過程使用 HTTPS 加密
• 後台管理系統設有身分驗證機制，限制授權人員存取
• 定期檢視存取紀錄及安全設定
• 密碼以加密方式儲存，本公司人員無法讀取您的明文密碼`,
    },
    {
      title: '六、資料保存期限',
      content: `• 會員資料：帳號存續期間，帳號刪除後保留 30 天備份後清除
• 訂單紀錄：依《商業會計法》規定保存 5 年
• 美容師審核文件：審核完成後 30 日內刪除
• 未完成之訂單：超過付款期限後自動取消，相關暫存資料 7 日後清除`,
    },
    {
      title: '七、您的權利',
      content: `依據《個人資料保護法》第 3 條，您對本公司持有之個人資料享有以下權利：

• 查詢或請求閱覽
• 請求製給複製本
• 請求補充或更正
• 請求停止蒐集、處理或利用
• 請求刪除

如欲行使上述權利，請透過 LINE 官方帳號（@ecladotw）或電子郵件提出申請，本公司將於 15 個工作日內回覆。`,
    },
    {
      title: '八、Cookie 政策',
      content: `本網站主要使用瀏覽器本機儲存空間（localStorage、sessionStorage）維持登入狀態、購物車及必要流程資訊；基礎設施服務亦可能使用必要性 Cookie 提供安全與流量管理。上述資料不用於跨網站追蹤或廣告投放。您可透過瀏覽器設定清除網站資料，但清除後可能需要重新登入，購物車內容也會被移除。`,
    },
    {
      title: '九、政策修訂',
      content: `本公司得視業務需要或法令修訂而更新本隱私權政策，修訂後版本將於本頁面公告，重大變更將另行以 LINE 或電子郵件通知。繼續使用本網站服務，視為同意修訂後之政策內容。`,
    },
    {
      title: '十、聯絡我們',
      content: `如對本隱私權政策有任何疑問，請透過以下方式與我們聯繫：

• LINE 官方帳號：@ecladotw
• 電子郵件：service@ecladotaiwan.com
• 本政策最後更新日期：2026 年 5 月`,
    },
  ];

  return (
    <div style={{ paddingTop: 68 }}>
      <div style={{ background: 'var(--off-white)', padding: isMobile ? '48px 20px 32px' : '64px 32px 40px', borderBottom: '1px solid var(--light)' }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <p style={{ fontSize: 11, letterSpacing: '0.28em', color: 'var(--gold)', textTransform: 'uppercase', marginBottom: 10 }}>Legal</p>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: isMobile ? 30 : 44, fontWeight: 300, color: 'var(--black)', marginBottom: 12 }}>隱私權政策</h1>
          <p style={{ fontSize: 13, color: 'var(--dark)', lineHeight: 1.8 }}>Privacy Policy — 依《個人資料保護法》及國際通用規範訂定</p>
        </div>
      </div>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: isMobile ? '40px 20px 64px' : '60px 32px 80px' }}>
        {sections.map((s, i) => (
          <div key={i} style={{ marginBottom: 40, paddingBottom: 40, borderBottom: i < sections.length - 1 ? '1px solid var(--light)' : 'none' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: isMobile ? 17 : 20, fontWeight: 400, color: 'var(--black)', marginBottom: 16 }}>{s.title}</h2>
            <p style={{ fontSize: 14, color: '#555', lineHeight: 2, whiteSpace: 'pre-line' }}>{s.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
