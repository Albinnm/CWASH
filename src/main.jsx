import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Admin from './Admin.jsx';
import CustomerAccount from './CustomerAccount.jsx';
import { CustomerAuthProvider, useCustomerAuth } from './customer-auth.jsx';
import './index.css';

function CustomerSite() {
  const { user, loading } = useCustomerAuth();
  return window.location.pathname.startsWith('/account') ? <CustomerAccount /> : <App key={loading ? 'checking-session' : user?.id || 'guest'} />;
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>{window.location.pathname.startsWith('/admin') ? <Admin /> : <CustomerAuthProvider><CustomerSite /></CustomerAuthProvider>}</React.StrictMode>,
);
