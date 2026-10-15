# 提領名目批次與假日人工順延

2026-10-14 使用者確認取消年度銀行休假資料依賴。提領申請仍以 `Asia/Taipei` 每月 10 日 00:00 為唯一批次切點：切點前歸當月 10 日，切點起歸下月 10 日。`batch_date` 與 `scheduled_date` 都保存該批次名目 10 日；遇假日由管理員在銀行端人工順延實際匯款，順延不得改變該月預計匯款人員。

階段5尚未上正式，使用者並確認測試資料不需保留，因此正式預備 Schema 直接移除 `instructor_reward_bank_calendar_versions`、`calendar_versions` 及發布 RPC，不保留相容層。測試專案若已有提領資料，其 `batch_date` 與 `scheduled_date` 可保留；只有不再使用的日曆快照欄位被移除。後台同步移除年度日曆維護入口。

已裝階段5的測試環境使用 `supabase-instructor-reward-nominal-batch-schedule.sql` 清除舊結構；安裝後用同名 `-verify.sql` 在唯讀交易驗證 10 日邊界、週末名目日期及日曆結構已不存在。正式環境尚未安裝階段5，不應執行清理檔，而應直接使用更新後的階段5完整 Migration。尚未操作正式資料庫或部署。

2026-10-15 提交前檢查補正：10/14 的清理已移除 test 日曆結構，但沒有替換已安裝的舊 `request_my_reward_withdrawal`，其 INSERT 仍可能引用已移除欄位。現已在清理腳本中一併替換申請 RPC，verify 新增無舊欄位引用斷言；隔離 PG 重建舊 RPC 後清理、ACL／owner 保留、二次重跑及完整申請／Ledger／併發通過。**此補正版尚未重新套到 test**；Git push 不會執行 SQL，test 真實提領驗收前仍須套用補正版及 verify。正式 DB 未操作。
