export const INIT_PRODUCTS = [
  { id: 1, name: 'Deep Cleansing Foam', nameZh: '深層清潔泡沫洗面乳', category: '清潔', size: '200ml', price: 1280, proPrice: 960, stock: 48, minStock: 3, isProOnly: false,
    desc: '輕柔起泡配方，能溶解彩妝與皮脂污垢，同時維持肌膚柔軟與水潤度。富含天然植萃成分，洗後清爽不刺激，不緊繃。', skinType: '全膚質、敏感肌', ingredients: '椰油兩性醋酸鈉、胺基酸系界面活性劑、綠茶萃取、甜菜鹼' },
  { id: 2, name: 'Peptide Repair Serum', nameZh: '胜肽修護精華液', category: '精華液', size: '30ml', price: 3980, proPrice: 2980, stock: 2, minStock: 3, isProOnly: false,
    desc: '結合多重胜肽與保濕修護成分，於肌膚表層形成持久保濕層，質地細緻清爽，協助改善因乾燥引起的細紋，長期使用可提升肌膚彈潤感。', skinType: '乾燥肌、熟齡肌、缺乏彈性肌', ingredients: '乙醯六胜肽-8、玻尿酸鈉、腺苷、積雪草萃取、水解膠原蛋白' },
  { id: 3, name: 'SOS Ampoule Set', nameZh: '急救修護安瓶組', category: '急救安瓶', size: '5ml×6', price: 4800, proPrice: 3600, stock: 15, minStock: 3, isProOnly: false,
    desc: '專為膚況不穩定肌膚設計的集中護理方案，抑制造成肌膚不穩定的外在因素，幫助迅速恢復肌膚平衡，適合於專業護理中搭配使用。', skinType: '敏弱肌、膚況不穩定、易泛紅肌膚', ingredients: '積雪草萃取、玻尿酸鈉、穀胱甘肽、胺基酸複合成分、尿囊素' },
  { id: 4, name: 'Intensive Hydra Mask', nameZh: '密集保濕面膜', category: '面膜', size: '35ml×10', price: 2200, proPrice: 1650, stock: 1, minStock: 3, isProOnly: false,
    desc: '採用ECLADO獨家紗布技術，帶來不同層次的彈力貼合感。源源不絕的水分供應，立即舒緩及帶來清涼感，獨家提拉技術即時呈現緊緻效果。', skinType: '全膚質、乾燥缺水肌', ingredients: '聚谷氨酸、β-葡聚糖、海藻糖、玻尿酸鈉、積雪草萃取' },
  { id: 5, name: 'Eye Contour Complex', nameZh: '眼周緊緻精華', category: '眼霜', size: '30ml', price: 2800, proPrice: 2100, stock: 22, minStock: 3, isProOnly: false,
    desc: '專為乾燥、粗糙的眼周與唇周肌膚設計的高保濕修護精華。質地滋潤但不厚重，協助改善因乾燥引起的細紋，使眼周肌膚維持柔嫩平滑觸感。', skinType: '眼周細紋初期保養、乾燥眼周肌膚', ingredients: '杏桃仁油、澳洲胡桃籽油、玻尿酸鈉、胜肽5、寡胜肽-1、植物性角鯊烷' },
  { id: 6, name: 'Cell Recovery Cream', nameZh: '細胞修護乳霜', category: '面霜', size: '50g', price: 3600, proPrice: 2700, stock: 8, minStock: 3, isProOnly: false,
    desc: '添加植物來源培養萃取成分，協助強化肌膚保水力與自我防禦力，卓越效果特別適合受損肌膚修護。質地滋潤不厚重，使肌膚呈現柔嫩平滑的健康光澤。', skinType: '熟齡肌、乾燥肌、需加強保養者', ingredients: '綠豆分生組織培養萃取、Sodium DNA、sh-Oligopeptide-1、蘆薈葉萃取、維他命E、腺苷' },
  { id: 7, name: 'NK Cell Activator', nameZh: 'NK細胞活化安瓶', category: '急救安瓶', size: '3.5ml×10', price: 8800, proPrice: 6600, stock: 0, minStock: 3, isProOnly: true,
    desc: '結合多種植物來源培養萃取成分，為肌膚提供集中彈潤調理。質地細緻好吸收，適合用於彈性不足與膚況疲憊的專業護理，長期使用幫助肌膚維持柔嫩光澤。', skinType: '彈性不足肌、疲憊老化肌膚', ingredients: '綠豆分生組織培養萃取、Peption 5、sh-Oligopeptide-1、雪絨花癒傷組織培養萃取、番茄癒傷組織培養萃取' },
  { id: 8, name: 'AHA/BHA Peeling Gel', nameZh: 'AHA·BHA·PHA 煥膚凝膠', category: '清潔', size: '120ml', price: 1980, proPrice: 1485, stock: 31, minStock: 3, isProOnly: false,
    desc: 'AHA、BHA、PHA三效合一，即時去除多餘角質，正常化肌膚更新週期。6種草本植萃成分，在溫和代謝老廢角質的同時，最小化酸類引起的肌膚刺激感。', skinType: '混合肌、毛孔堵塞肌、暗沉代謝慢膚況', ingredients: '乳酸、甘醇酸、葡萄糖酸內酯、馬齒莧萃取、積雪草萃取、蘆薈葉萃取' },
];

export const INIT_MEMBERS = [
  { id: 1, name: '林小美', email: 'mei@gmail.com', type: 'consumer', joined: '2026-01-15', orders: 3, total: 8640, phone: '0912-345-678' },
  { id: 2, name: '陳美容師', email: 'chen@beauty.com', type: 'pro', joined: '2026-01-20', orders: 12, total: 68400, phone: '0923-456-789', cert: '美容乙級 #20240312' },
  { id: 3, name: '王大明', email: 'wang@email.com', type: 'consumer', joined: '2026-02-03', orders: 1, total: 2200, phone: '0934-567-890' },
  { id: 4, name: '張美師傅', email: 'chang@salon.com', type: 'pro', joined: '2026-02-10', orders: 8, total: 42000, phone: '0945-678-901', cert: '美容丙級 #20230118' },
  { id: 5, name: '劉芳芳', email: 'liu@gmail.com', type: 'consumer', joined: '2026-02-18', orders: 2, total: 5980, phone: '0956-789-012' },
  { id: 6, name: '黃小玲', email: 'huang@beauty.tw', type: 'pending', joined: '2026-03-01', orders: 0, total: 0, phone: '0967-890-123', cert: '申請審核中' },
  { id: 7, name: '吳雅婷', email: 'wu@spa.com', type: 'pro', joined: '2026-03-05', orders: 5, total: 28500, phone: '0978-901-234', cert: '美容乙級 #20250607' },
  { id: 8, name: '鄭淑惠', email: 'cheng@gmail.com', type: 'consumer', joined: '2026-03-12', orders: 4, total: 11200, phone: '0989-012-345' },
  { id: 9, name: '許講師', email: 'instructor@beauty.tw', type: 'instructor', joined: '2026-04-02', orders: 6, total: 33600, phone: '0900-111-222', cert: '品牌教育師' },
  { id: 10, name: '台中經銷', email: 'dealer@beauty.tw', type: 'distributor', joined: '2026-04-12', orders: 9, total: 92000, phone: '0900-333-444', cert: '中區經銷商' },
];

export const INIT_ORDERS = [
  { id: 'ECL-20260504-0044', member: '黃美玲', type: 'consumer', items: [{ name: '胜肽修護精華液', qty: 1, price: 3980 }], total: 4130, status: 'awaiting_confirm', date: '2026-05-04', address: '台北市中山區南京東路二段80號', phone: '0922-111-333', transferLast5: '38201' },
  { id: 'ECL-20260503-0043', member: '蘇佳琪', type: 'pro', items: [{ name: '急救修護安瓶組', qty: 2, price: 3600 }], total: 7350, status: 'awaiting_confirm', date: '2026-05-03', address: '新北市新莊區中正路100號', phone: '0933-222-444', transferLast5: '76549' },
  { id: 'ECL-20260501-0042', member: '林小美', type: 'consumer', items: [{ name: '深層清潔泡沫洗面乳', qty: 2, price: 1280 }, { name: '密集保濕面膜', qty: 1, price: 2200 }], total: 4910, status: 'paid', date: '2026-05-01', address: '台北市信義區信義路五段7號' },
  { id: 'ECL-20260430-0041', member: '陳美容師', type: 'pro', items: [{ name: 'NK細胞活化安瓶', qty: 3, price: 6600 }, { name: '胜肽修護精華液', qty: 2, price: 2980 }], total: 25760, status: 'shipped', date: '2026-04-30', address: '台北市大安區忠孝東路四段1號', tracking: 'BN123456789TW' },
  { id: 'ECL-20260429-0040', member: '張美師傅', type: 'pro', items: [{ name: '急救修護安瓶組', qty: 4, price: 3600 }], total: 14550, status: 'delivered', date: '2026-04-29', address: '新北市板橋區文化路一段100號' },
  { id: 'ECL-20260428-0039', member: '王大明', type: 'consumer', items: [{ name: '密集保濕面膜', qty: 1, price: 2200 }], total: 2350, status: 'preparing', date: '2026-04-28', address: '台中市西屯區台灣大道三段99號', phone: '0911-555-666', transferLast5: '12345' },
  { id: 'ECL-20260427-0038', member: '劉芳芳', type: 'consumer', items: [{ name: '眼周緊緻精華', qty: 1, price: 2800 }, { name: 'AHA·BHA·PHA 煥膚凝膠', qty: 1, price: 1485 }], total: 4435, status: 'shipped', date: '2026-04-27', address: '高雄市前金區中正四路211號', tracking: 'BN987654321TW' },
  { id: 'ECL-20260426-0037', member: '吳雅婷', type: 'pro', items: [{ name: '細胞修護乳霜', qty: 3, price: 2700 }, { name: '胜肽修護精華液', qty: 2, price: 2980 }], total: 14110, status: 'delivered', date: '2026-04-26', address: '台南市東區東門路一段3號' },
  { id: 'ECL-20260425-0036', member: '鄭淑惠', type: 'consumer', items: [{ name: '深層清潔泡沫洗面乳', qty: 1, price: 1280 }], total: 1430, status: 'cancelled', date: '2026-04-25', address: '桃園市桃園區中正路123號' },
];

export const MONTHLY_REVENUE = [
  { month: '11月', revenue: 68400, orders: 18, proRevenue: 42000 },
  { month: '12月', revenue: 95200, orders: 26, proRevenue: 61000 },
  { month: '1月', revenue: 72600, orders: 20, proRevenue: 48000 },
  { month: '2月', revenue: 58300, orders: 15, proRevenue: 36000 },
  { month: '3月', revenue: 112400, orders: 31, proRevenue: 78000 },
  { month: '4月', revenue: 98700, orders: 27, proRevenue: 65000 },
];

export const PRODUCT_MONTHLY = {
  1: [12, 18, 14, 9, 22, 19],
  2: [5, 8, 6, 4, 11, 9],
  3: [8, 12, 10, 7, 15, 13],
  7: [3, 5, 4, 2, 6, 5],
};
