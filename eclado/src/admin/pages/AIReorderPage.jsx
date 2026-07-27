import React, { useState } from 'react';
import { PRODUCT_MONTHLY } from '../data/mockData.js';

export default function AIReorder({ products }) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [expanded, setExpanded] = useState(null);

  async function runAI() {
    setLoading(true);
    setSuggestions(null);

    const productData = products.map(p => {
      const monthly = PRODUCT_MONTHLY[p.id] || [3,4,3,2,5,4];
      const avg = (monthly.reduce((a,b) => a+b, 0) / monthly.length).toFixed(1);
      const trend = monthly[monthly.length-1] > monthly[monthly.length-2] ? '上升' : '持平或下降';
      return `- ${p.nameZh}（${p.size}）：庫存 ${p.stock} 件，近6月平均銷量 ${avg} 件/月，趨勢${trend}`;
    }).join('\n');

    const prompt = `你是一個台灣保養品電商的庫存分析顧問。以下是 ECLADO 韓國醫美院線保養品的庫存與銷售數據：

${productData}

請針對每一件商品，分析並給出：
1. 補貨建議數量（考慮安全庫存與銷售趨勢）
2. 補貨緊急程度（緊急/一般/暫不需要）
3. 簡短理由（1-2句話）

請以 JSON 格式回應，格式如下：
[{"name":"商品名稱","qty":建議數量,"urgency":"緊急/一般/暫不需要","reason":"理由"}]

只回應 JSON，不要其他文字。`;

    try {
      const text = await window.claude.complete(prompt);
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        setSuggestions(data);
      }
    } catch (e) {
      setSuggestions([{ name: '分析失敗', qty: 0, urgency: '錯誤', reason: '請稍後再試' }]);
    }
    setLoading(false);
  }

  const urgencyColor = { '緊急': 'var(--red)', '一般': 'var(--yellow)', '暫不需要': 'var(--green)' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-d)', fontSize: 28, fontWeight: 400, marginBottom: 4 }}>AI 補貨建議</h1>
          <p style={{ fontSize: 13, color: 'var(--mid)' }}>根據銷售趨勢與庫存數量，自動分析補貨需求</p>
        </div>
        <button onClick={runAI} disabled={loading} style={{
          padding: '12px 28px', background: loading ? 'var(--mid)' : 'var(--dark)', color: '#fff', border: 'none',
          fontSize: 13, letterSpacing: '0.1em', cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', gap: 10, transition: 'background 0.2s',
        }}>
          {loading ? (
            <>
              <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              AI 分析中...
            </>
          ) : (
            <><span>✦</span> 開始 AI 分析</>
          )}
        </button>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Current stock overview */}
      <div className="product-grid-4" style={{ marginBottom: 28 }}>
        {products.map(p => {
          const monthly = PRODUCT_MONTHLY[p.id] || [3,4,3,2,5,4];
          const avg = (monthly.reduce((a,b) => a+b, 0) / monthly.length).toFixed(1);
          const daysLeft = avg > 0 ? Math.round((p.stock / avg) * 30) : 999;
          return (
            <div key={p.id} style={{ background: 'var(--white)', border: `1px solid ${p.stock <= p.minStock ? 'oklch(0.60 0.18 25 / 0.3)' : 'var(--border)'}`, padding: '16px' }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--dark)', marginBottom: 4, lineHeight: 1.4 }}>{p.nameZh}</div>
              <div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 10 }}>{p.size}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                  <div style={{ fontSize: 22, fontFamily: 'var(--font-d)', fontWeight: 400, color: p.stock === 0 ? 'var(--red)' : p.stock <= p.minStock ? 'var(--yellow)' : 'var(--dark)' }}>{p.stock}</div>
                  <div style={{ fontSize: 10, color: 'var(--mid)' }}>件庫存</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: 'var(--dark)' }}>{avg}</div>
                  <div style={{ fontSize: 10, color: 'var(--mid)' }}>件/月均</div>
                </div>
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: daysLeft < 30 ? 'var(--red)' : 'var(--mid)' }}>
                {daysLeft >= 999 ? '庫存充足' : `約剩 ${daysLeft} 天`}
              </div>
              {/* Mini sparkline */}
              <div style={{ display: 'flex', gap: 2, marginTop: 8, alignItems: 'flex-end', height: 24 }}>
                {monthly.map((v, i) => (
                  <div key={i} style={{ flex: 1, background: i === monthly.length-1 ? 'var(--dark)' : 'var(--light)', height: Math.max(3, (v / Math.max(...monthly)) * 24), borderRadius: 1 }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* AI suggestions */}
      {!suggestions && !loading && (
        <div style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '60px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.3 }}>✦</div>
          <p style={{ fontFamily: 'var(--font-d)', fontSize: 22, fontWeight: 300, color: 'var(--dark)', marginBottom: 8 }}>AI 補貨分析</p>
          <p style={{ fontSize: 13, color: 'var(--mid)', marginBottom: 28, lineHeight: 1.7 }}>點擊「開始 AI 分析」，系統將根據您的銷售趨勢<br />與庫存數量，自動生成補貨建議報告</p>
          <button onClick={runAI} style={{ padding: '12px 36px', background: 'var(--dark)', color: '#fff', border: 'none', fontSize: 12, letterSpacing: '0.12em', cursor: 'pointer' }}>✦ 開始分析</button>
        </div>
      )}

      {loading && (
        <div style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '60px', textAlign: 'center' }}>
          <div style={{ width: 32, height: 32, border: '2px solid var(--light)', borderTopColor: 'var(--dark)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 20px' }} />
          <p style={{ fontSize: 13, color: 'var(--mid)' }}>AI 正在分析銷售數據與庫存狀態...</p>
        </div>
      )}

      {suggestions && (
        <div style={{ background: 'var(--white)', border: '1px solid var(--border)', padding: '28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <h3 style={{ fontSize: 15, fontWeight: 500 }}>AI 分析結果</h3>
            <button onClick={runAI} style={{ padding: '7px 18px', background: 'none', border: '1px solid var(--border)', fontSize: 12, color: 'var(--mid)', cursor: 'pointer', letterSpacing: '0.06em' }}>重新分析</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {suggestions.map((s, i) => (
              <div key={i} style={{ border: '1px solid var(--border)', padding: '16px 20px', display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 20, alignItems: 'center', cursor: 'pointer', transition: 'background 0.1s', background: expanded === i ? 'var(--off)' : 'transparent' }}
              onClick={() => setExpanded(expanded === i ? null : i)}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{s.name}</div>
                  {expanded === i && <div style={{ fontSize: 12, color: 'var(--mid)', lineHeight: 1.7, marginTop: 8 }}>{s.reason}</div>}
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--font-d)', fontSize: 24, fontWeight: 400, color: 'var(--dark)' }}>{s.qty}</div>
                  <div style={{ fontSize: 10, color: 'var(--mid)' }}>建議補貨件數</div>
                </div>
                <div>
                  <span style={{ display: 'inline-block', padding: '4px 12px', fontSize: 11, fontWeight: 500, background: (urgencyColor[s.urgency] || 'var(--mid)') + '18', color: urgencyColor[s.urgency] || 'var(--mid)', borderRadius: 2, whiteSpace: 'nowrap' }}>{s.urgency}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
