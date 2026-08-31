import React, { useEffect, useState } from 'react';

function readBrowserSnapshot(lastEvent, eventCount) {
  const viewport = window.visualViewport;
  const hero = document.querySelector('.home-hero');
  return {
    lastEvent,
    eventCount,
    lineUa: /Line\//i.test(window.navigator.userAgent),
    lineClass: document.documentElement.classList.contains('is-line-browser'),
    inner: `${window.innerWidth} × ${window.innerHeight}`,
    client: `${document.documentElement.clientWidth} × ${document.documentElement.clientHeight}`,
    visual: viewport
      ? `${viewport.width.toFixed(1)} × ${viewport.height.toFixed(1)}`
      : '不支援',
    visualOffset: viewport
      ? `top ${viewport.offsetTop.toFixed(1)} / pageTop ${viewport.pageTop.toFixed(1)}`
      : '不支援',
    visualScale: viewport ? viewport.scale.toFixed(3) : '不支援',
    scrollY: window.scrollY.toFixed(1),
    screen: `${window.screen.width} × ${window.screen.height} / avail ${window.screen.availHeight}`,
    orientation: window.screen.orientation?.type || '不支援',
    heroHeight: hero ? window.getComputedStyle(hero).height : '目前頁面無 Hero',
    stableHeroHeight: window.getComputedStyle(document.documentElement).getPropertyValue('--line-home-hero-height').trim() || '未設定',
    userAgent: window.navigator.userAgent,
  };
}

export default function BrowserDebugPanel() {
  const enabled = new URLSearchParams(window.location.search).get('browser-debug') === '1';
  const [snapshot, setSnapshot] = useState(() => readBrowserSnapshot('初始載入', 0));

  useEffect(() => {
    if (!enabled) return undefined;

    let eventCount = 0;
    let frame = 0;
    const update = event => {
      const eventName = event?.type || '更新';
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        eventCount += 1;
        setSnapshot(readBrowserSnapshot(eventName, eventCount));
      });
    };

    const viewport = window.visualViewport;
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.addEventListener('scroll', update, { passive:true });
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);

    update({ type:'監測開始' });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.removeEventListener('scroll', update);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <aside
      data-testid="browser-debug-panel"
      aria-label="瀏覽器診斷資訊"
      style={{
        position:'fixed', left:8, right:8, bottom:'calc(8px + env(safe-area-inset-bottom, 0px))',
        zIndex:10000, maxHeight:'46svh', overflow:'auto', padding:'12px 14px',
        background:'rgba(10,10,10,.92)', color:'#fff', border:'1px solid rgba(255,255,255,.25)',
        boxShadow:'0 8px 30px rgba(0,0,0,.35)', fontSize:11, lineHeight:1.55,
        fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace', WebkitOverflowScrolling:'touch',
      }}
    >
      <strong style={{ display:'block', color:'#e9cf95', fontSize:12, marginBottom:6 }}>Browser Debug（請截圖此區）</strong>
      <div>LINE UA：{String(snapshot.lineUa)}</div>
      <div>LINE class：{String(snapshot.lineClass)}</div>
      <div>最後事件：{snapshot.lastEvent}（{snapshot.eventCount}）</div>
      <div>inner：{snapshot.inner}</div>
      <div>client：{snapshot.client}</div>
      <div>visualViewport：{snapshot.visual}</div>
      <div>visual offset：{snapshot.visualOffset}</div>
      <div>visual scale：{snapshot.visualScale}</div>
      <div>scrollY：{snapshot.scrollY}</div>
      <div>screen：{snapshot.screen}</div>
      <div>orientation：{snapshot.orientation}</div>
      <div>Hero 實際高度：{snapshot.heroHeight}</div>
      <div>LINE 固定 Hero：{snapshot.stableHeroHeight}</div>
      <div style={{ marginTop:6, overflowWrap:'anywhere' }}>UA：{snapshot.userAgent}</div>
    </aside>
  );
}
