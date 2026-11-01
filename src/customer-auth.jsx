import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const CustomerAuth = createContext(null);

export function CustomerAuthProvider({ children }) {
  const [session, setSession] = useState({ user: null, csrfToken: null, loading: true, error: '' });
  const current = useRef(session);
  const generation = useRef(0);
  const channel = useRef(null);
  const commit = useCallback(value => { current.current = value; setSession(value); }, []);
  const clearSession = useCallback(() => {
    generation.current += 1;
    commit({ user: null, csrfToken: null, loading: false, error: '' });
  }, [commit]);

  const refreshSession = useCallback(async () => {
    const requestGeneration = ++generation.current;
    try {
      const response = await fetch('/api/customer/session', { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not check your account.');
      if (requestGeneration === generation.current) commit({ user: data.authenticated ? data.user : null, csrfToken: data.csrfToken || null, loading: false, error: '' });
    } catch (error) {
      if (requestGeneration === generation.current) commit({ ...current.current, loading: false, error: error.message });
    }
  }, [commit]);

  useEffect(() => {
    void refreshSession();
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshSession(); };
    window.addEventListener('focus', refreshSession);
    document.addEventListener('visibilitychange', onVisible);
    if ('BroadcastChannel' in window) {
      channel.current = new BroadcastChannel('cwash-customer-session');
      channel.current.onmessage = () => { clearSession(); void refreshSession(); };
    }
    return () => {
      generation.current += 1;
      window.removeEventListener('focus', refreshSession);
      document.removeEventListener('visibilitychange', onVisible);
      channel.current?.close(); channel.current = null;
    };
  }, [refreshSession, clearSession]);

  const request = useCallback(async (path, options = {}) => {
    const requestGeneration = generation.current;
    const response = await fetch(path, {
      ...options, credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(current.current.csrfToken ? { 'X-CSRF-Token': current.current.csrfToken } : {}), ...options.headers },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && requestGeneration === generation.current && !['/api/customer/login', '/api/customer/register'].includes(path)) clearSession();
      throw new Error(data.error || 'Something went wrong. Please try again.');
    }
    return data;
  }, [clearSession]);

  const authenticate = async (mode, fields) => {
    const data = await request(`/api/customer/${mode}`, { method: 'POST', body: JSON.stringify(fields) });
    generation.current += 1;
    commit({ user: data.user, csrfToken: data.csrfToken, loading: false, error: '' });
    channel.current?.postMessage('changed');
  };
  const logout = async () => {
    await request('/api/customer/logout', { method: 'POST', body: '{}' });
    clearSession(); channel.current?.postMessage('changed');
  };
  const updateProfile = async fields => {
    const expectedUser = current.current.user?.id;
    const data = await request('/api/customer/profile', { method: 'PATCH', body: JSON.stringify(fields) });
    if (current.current.user?.id === expectedUser) commit({ ...current.current, user: data.user });
    channel.current?.postMessage('changed');
  };
  const changePassword = async fields => {
    await request('/api/customer/password', { method: 'POST', body: JSON.stringify(fields) });
    clearSession(); channel.current?.postMessage('changed');
  };
  return <CustomerAuth.Provider value={{ ...session, request, authenticate, logout, updateProfile, changePassword, refreshSession }}>{children}</CustomerAuth.Provider>;
}

export function useCustomerAuth() {
  const value = useContext(CustomerAuth);
  if (!value) throw new Error('Customer account provider is required.');
  return value;
}
