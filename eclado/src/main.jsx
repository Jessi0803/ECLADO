import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/open-sans/latin-300.css';
import '@fontsource/open-sans/latin-400.css';
import '@fontsource/open-sans/latin-500.css';
import '@fontsource/open-sans/latin-600.css';
import App from './app/App.jsx';
import './styles.css';

// LINE 的 iOS 內建瀏覽器在工具列收合時會直接改變 WKWebView 高度。
// 首次載入時固定 Hero 高度；一般 resize 不更新，僅在裝置轉向後重新擷取。
// 此判斷只供顯示相容性使用，不可用於任何權限或安全邏輯。
const isLineBrowser = /Line\//i.test(window.navigator.userAgent);
const captureLineHeroHeight = () => {
  if (!isLineBrowser) return;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--line-home-hero-height', `${Math.round(viewportHeight)}px`);
};

document.documentElement.classList.toggle('is-line-browser', isLineBrowser);
captureLineHeroHeight();

if (isLineBrowser) {
  window.addEventListener('orientationchange', () => {
    window.setTimeout(captureLineHeroHeight, 350);
  }, { passive:true });
}

createRoot(document.getElementById('root')).render(<App />);
