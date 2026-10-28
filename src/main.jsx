import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Admin from './Admin.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>{window.location.pathname.startsWith('/admin') ? <Admin /> : <App />}</React.StrictMode>,
);
