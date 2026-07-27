import React from 'react';
import { createRoot } from 'react-dom/client';
import AdminApp from './admin/AdminApp.jsx';
import AdminGate from './admin/components/AdminGate.jsx';
import './admin.css';

createRoot(document.getElementById('root')).render(
  <AdminGate><AdminApp /></AdminGate>
);
