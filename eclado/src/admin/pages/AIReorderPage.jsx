import React, { useMemo, useState } from 'react';
import { buildProductMonthlySales } from '../domain/analytics.js';

export default function AIReorder({ products, orders }) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const monthlySales = useMemo(
    () => buildProductMonthlySales(products, orders),
    [products, orders],
  );

  async function runAI() {
    setLoading(true);
    setSuggestions(null);

    const productData = products.map(product => {
      const monthly = monthlySales[product.id] || Array(6).fill(0);
      const total = monthly.reduce((sum, qty) => sum + qty, 0);
      const average = (total / monthly.length).toFixed(1);
      const trend = total === 0
        ? '尚無銷售紀錄'
        : monthly[monthly.length - 1] > monthly[monthly.length - 2] ? '上升' : '持平或下降';
      return `- ${product.nameZh}（${product.size}）：庫存 ${product.stock} 件，近6月平均銷量 ${average} 件/月，趨勢${trend}`;
    }).join('\n');

    const prompt = `你是一個台灣保養品電商的庫存分析顧問。以下是 ECLADO 韓國醫美院線保養品的真實庫存與近六個月已付款訂單銷售數據：

${productData}

請針對每一件商品，分析並給出：
1. 補貨建議數量（考慮安全庫存與銷售趨勢）
2. 補貨緊急程度（緊急/一般/暫不需要）
3. 簡短理由（1-2句話）

請以 JSON 格式回應，格式如下：
[{"name":"商品名稱","qty":建議數量,"urgency":"緊急/一般/暫不需要","reason":"理由"}]

只回應 JSON，不要其他文字。`;

    try {
      if (typeof window.claude?.complete !== 'function') {
        throw new Error('AI 服務尚未連接');
      }
      const text = await window.claude.complete(prompt);
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('AI 回應格式不正確');
      setSuggestions(JSON.parse(jsonMatch[0]));
    } catch (error) {
      setSuggestions([{
        name: '分析失敗',
        qty: 0,
        urgency: '錯誤',
        reason: error.message || '請稍後再試',
      }]);
    } finally {
      setLoading(false);
    }
  }

  const urgencyColor = { 緊急: 'var(--red)', 一般: 'var(--yellow)', 暫不需要: 'var(--green)' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-d)', fontSize: 28, fontWeight: 400, marginBottom: 4 }}>AI 補貨建議</h1>
          <p style={{ fontSize: 13, color: 'var(--mid)' }}>根據真實銷售趨勢與庫存數量，自動分析補貨需求</p>
        </div>
        <button onClick={runAI} disabled={loading} style={{ padding: '12px 28px', background: loading ? 'var(--mid)' : 'var(--dark)', color: '#fff', border: 'none', fontSize: 13, letterSpacing: '0.1em', cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
          {loading ? 'AI 分析中...' : '✦ 開始 AI 分析'}
        </button>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div className="product-grid-4" style={{ marginBottom: 28 }}>
        {products.map(product => {
          const monthly = monthlySales[product.id] || Array(6).fill(0);
          const total = monthly.reduce((sum, qty) => sum + qty, 0);
          const average = total / monthly.length;
          const daysLeft = average > 0 ? Math.round((product.stock / average) * 30) : null;
          const maxMonthly = Math.max(0, ...monthly);
          return (
            <div key={product.id} data-testid={`ai-product-${product.id}`} style={{ background: 'var(--white)', border: `1px solid ${product.stock <= product.minStock ? 'oklch(0.60 0.18 25 / 0.3)' : 'var(--border)'}`, padding: '16px' }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--dark)', marginBottom: 4, lineHeight: 1.4 }}>{product.nameZh}</div>
              <div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 10 }}>{product.size}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div><div style={{ fontSize: 22, fontFamily: 'var(--font-d)', color: product.stock === 0 ? 'var(--red)' : 'var(--dark)' }}>{product.stock}</div><div style={{ fontSize: 10, color: 'var(--mid)' }}>件庫存</div></div>
                <div style={{ textAlign: 'right' }}><div style={{ fontSize: 12, color: 'var(--dark)' }}>{average.toFixed(1)}</div><div style={{ fontSize: 10, color: 'var(--mid)' }}>件/月均</div></div>
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: daysLeft != null && daysLeft < 30 ? 'var(--red)' : 'var(--mid)' }}>
                {daysLeft == null ? '近六個月尚無銷售紀錄' : `約剩 ${daysLeft} 天`}
              </div>
              <div style={{ display: 'flex', gap: 2, marginTop: 8, alignItems: 'flex-end', height: 24 }}>
                {monthly.map((qty, index) => <div key={index} style={{ flex: 1, background: index === monthly.length - 1 ? 'var(--dark)' : 'var(--light)', height: maxMonthly > 0 ? Math.max(3, (qty / maxMonthly) * 24) : 3, borderRadius: 1 }} />)}
              </div>
            </div>
          );
        })}
      </div>

      {!suggestions && !loading && (
        <div style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '60px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.3 }}>✦</div>
          <p style={{ fontFamily: 'var(--font-d)', fontSize: 22, fontWeight: 300, color: 'var(--dark)', marginBottom: 8 }}>AI 補貨分析</p>
          <p style={{ fontSize: 13, color: 'var(--mid)', marginBottom: 28, lineHeight: 1.7 }}>點擊「開始 AI 分析」，系統將根據真實銷售趨勢<br />與庫存數量，自動生成補貨建議報告</p>
          <button onClick={runAI} style={{ padding: '12px 36px', background: 'var(--dark)', color: '#fff', border: 'none', fontSize: 12, letterSpacing: '0.12em', cursor: 'pointer' }}>✦ 開始分析</button>
        </div>
      )}

      {loading && <div style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '60px', textAlign: 'center', color: 'var(--mid)', fontSize: 13 }}>AI 正在分析真實銷售數據與庫存狀態...</div>}

      {suggestions && (
        <div style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}><h3 style={{ fontSize: 15, fontWeight: 500 }}>AI 分析結果</h3><button onClick={runAI} style={{ padding: '7px 18px', background: 'none', border: '1px solid var(--border)', fontSize: 12, color: 'var(--mid)', cursor: 'pointer' }}>重新分析</button></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {suggestions.map((suggestion, index) => (
              <div key={`${suggestion.name}-${index}`} onClick={() => setExpanded(expanded === index ? null : index)} style={{ border: '1px solid var(--border)', padding: '16px 20px', display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 20, alignItems: 'center', cursor: 'pointer', background: expanded === index ? 'var(--off)' : 'transparent' }}>
                <div><div style={{ fontSize: 13, fontWeight: 500 }}>{suggestion.name}</div>{expanded === index && <div style={{ fontSize: 12, color: 'var(--mid)', lineHeight: 1.7, marginTop: 8 }}>{suggestion.reason}</div>}</div>
                <div style={{ textAlign: 'center' }}><div style={{ fontFamily: 'var(--font-d)', fontSize: 24 }}>{suggestion.qty}</div><div style={{ fontSize: 10, color: 'var(--mid)' }}>建議補貨件數</div></div>
                <span style={{ padding: '4px 12px', fontSize: 11, background: (urgencyColor[suggestion.urgency] || 'var(--mid)') + '18', color: urgencyColor[suggestion.urgency] || 'var(--mid)', whiteSpace: 'nowrap' }}>{suggestion.urgency}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
