import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/open-sans/latin-300.css';
import '@fontsource/open-sans/latin-400.css';
import '@fontsource/open-sans/latin-500.css';
import '@fontsource/open-sans/latin-600.css';
import AdminApp from './admin/AdminApp.jsx';
import AdminGate from './admin/components/AdminGate.jsx';
import './admin.css';

createRoot(document.getElementById('root')).render(
  <AdminGate><AdminApp /></AdminGate>
);
