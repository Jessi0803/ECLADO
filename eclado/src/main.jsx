import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/open-sans/latin-300.css';
import '@fontsource/open-sans/latin-400.css';
import '@fontsource/open-sans/latin-500.css';
import '@fontsource/open-sans/latin-600.css';
import App from './app/App.jsx';
import './styles.css';

// LINE 的 iOS 內建瀏覽器在工具列收合時會重新合成 fixed 圖層。
// 只將這個 class 作為顯示相容性判斷，不可用於任何權限或安全邏輯。
document.documentElement.classList.toggle('is-line-browser', /Line\//i.test(window.navigator.userAgent));

createRoot(document.getElementById('root')).render(<App />);
