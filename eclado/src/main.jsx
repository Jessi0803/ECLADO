import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/open-sans/latin-300.css';
import App from './app/App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);
