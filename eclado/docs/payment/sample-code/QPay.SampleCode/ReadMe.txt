==QPay.Sample ReadMe==

##此專案提供QPay Web API 版本1.0.0之串接參考

1.本專案使用.NET Framework 4.5.2建置
2.本專案需參考dll如下:
	Newtonsoft.Json,
	System.Net.Http.Formatting,
	System.ComponentModel.DataAnnotations, 
	System.Configuration,
	System.Runtime.Serialization
  前兩項已附於專案中的Dll資料夾內，其餘項目可在.NET Framework4.5.2內找到
  (若不會移動Sample Code至新專案可以忽略此點)
3.QPayToolkit.cs會參考站台appSettings.config中的資料，參考如下，可再自行調整資料來源
	line 24	: 取得商業收付API 網址
	<add key="QPayWebAPIUrl" value="https://api.sinopac.com/funBIZ/QPay.WebAPI/api/"/>
	line 25	: 取得商業收付API 授權認證金鑰
	<add key="QPayApimAuth" value="b5e6986d-8636-4aa0-8c93-441ad14b2098" />
	line 168: 依商店編號取得商店雜湊值(依A1, A2, B1, B2排序, 商業收付提供)
	<add key="AA0001_001" value="A1A1A1A1A1A1A1A1,A2A2A2A2A2A2A2A2,B1B1B1B1B1B1B1B1,B2B2B2B2B2B2B2B2"/>
4.QPayToolkit.cs並未實作QPayCommon.InfoLog及QPayCommon.ExceptionLog
  可自行判斷移除相關Log記錄或是自行實作
5.串接方式可直接使用QPayToolkit提供之公開方法 (第 27 至 175 行)
	訂單建立:					public static CreOrder OrderCreate(CreOrderReq req)
	訂單查詢:					public static QryOrder OrderQuery(QryOrderReq req)
	待請款訂單查詢:				public static QryOrderUnCaptured OrderUnCapturedQuery(QryOrderUnCapturedReq req)
	信用卡訂單維護:				public static MaintainOrder OrderMaintain(MaintainOrderReq req)
	付款結果查詢服務:			public static QryOrderPay OrderPayQuery(QryOrderPayReq req)
	每日收(退)款查詢服務:		public static QryBill BillQuery(QryBillReq req)
	撥款檔查詢服務:				public static QryAllot AllotQuery(QryAllotReq req)
	定期定額訂單查詢服務:		public static QryRegular RegularQuery(RegularQueryReq req)
	LINE Pay 訂單查詢服務:		public static QryLineOrder LinePayOrderQuery(QryLineOrderReq req)
	信用卡價金 撥款檔查詢服務:	public static QryAllotTrust AllotTrustQuery(QryAllotTrustReq req)
	信用卡綁卡授權交易:			public static CardBindCreate CardBindCreate(CardBindCreateReq req)
6.Request各欄位填寫限制請以API串接手冊為主，程式註解為輔
	
	

