import React, { useCallback, useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowLeft, ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, LayoutDashboard, LogOut, MapPin, Menu, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Users, X } from 'lucide-react';
import './admin.css';

const NYC = 'America/New_York';
const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value || 0);
const todayNYC = () => new Intl.DateTimeFormat('en-CA', { timeZone: NYC, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dateLabel = (date, options = { month: 'short', day: 'numeric' }) => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', options);
const addDays = (date, days) => { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + days); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; };
const timeLabel = (time) => { const [h, m] = time.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const statuses = ['pending', 'confirmed', 'completed', 'cancelled'];
const statusLabel = (status) => status === 'pending' ? 'Awaiting review' : status.charAt(0).toUpperCase() + status.slice(1);
const active = (booking) => ['pending', 'confirmed'].includes(booking.status);

function Status({ status }) { return <span className={`ad-status ad-status-${status}`}><span />{statusLabel(status)}</span>; }

export default function Admin() {
  const [session, setSession] = useState(null);
  const [bootError, setBootError] = useState('');
  const [bookings, setBookings] = useState([]);
  const [catalog, setCatalog] = useState(null);
  const [page, setPage] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [selected, setSelected] = useState(null);
  const [mobileMenu, setMobileMenu] = useState(false);

  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(session?.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {}), ...options.headers } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && path !== '/api/admin/login') setSession({ authenticated: false, configured: true });
      throw new Error(data.error || 'Something went wrong. Please try again.');
    }
    return data;
  }, [session?.csrfToken]);

  const checkSession = useCallback(async () => {
    setBootError('');
    try { const response = await fetch('/api/admin/session'); if (!response.ok) throw new Error('Unable to connect to CWASH. Please try again.'); setSession(await response.json()); }
    catch (err) { setBootError(err.message); }
  }, []);
  useEffect(() => { checkSession(); }, [checkSession]);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { const [reservationData, catalogData] = await Promise.all([request('/api/admin/bookings'), request('/api/catalog')]); setBookings(reservationData.bookings); setCatalog(catalogData); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [request]);
  useEffect(() => { if (session?.authenticated) refresh(); }, [session?.authenticated, refresh]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 5500); return () => window.clearTimeout(timer); }, [toast]);

  async function logout() {
    setError('');
    try { await request('/api/admin/logout', { method: 'POST' }); setSession({ authenticated: false, configured: true }); setBookings([]); setSelected(null); }
    catch (err) { setError(err.message); }
  }

  async function updateBooking(id, changes) {
    await request(`/api/admin/bookings/${id}`, { method: 'PATCH', body: JSON.stringify(changes) });
    setSelected(null); setToast('Reservation updated.'); await refresh();
  }

  if (!session) return <div className="admin-login"><div className="ad-login-card"><Brand /><p role="status">{bootError || 'Opening your workspace…'}</p>{bootError && <button className="ad-primary" onClick={checkSession}>Try again</button>}</div></div>;
  if (!session.authenticated) return <Login configured={session.configured} request={request} onLogin={(data) => setSession({ ...data, authenticated: true, configured: true })} />;

  const today = todayNYC();
  const pending = bookings.filter(b => b.status === 'pending');
  const todayJobs = bookings.filter(b => b.date === today && active(b));
  const upcoming = bookings.filter(b => b.date >= today && active(b)).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const navigation = [['overview', LayoutDashboard, 'Overview'], ['bookings', Users, 'Reservations'], ['calendar', CalendarDays, 'Calendar'], ['settings', Settings2, 'Business settings']];
  const titles = { overview: 'A fresh start, every day.', bookings: 'Your reservations.', calendar: 'Make room for a great detail.', settings: 'Your business, your way.' };

  return <div className="admin-shell">
    <aside className={`ad-sidebar ${mobileMenu ? 'ad-sidebar-open' : ''}`}>
      <Brand />
      <span className="ad-workspace-label">OWNER WORKSPACE</span>
      <nav aria-label="Admin navigation">{navigation.map(([id, Icon, label]) => <button key={id} onClick={() => { setPage(id); setMobileMenu(false); }} className={`ad-nav-item ${page === id ? 'active' : ''}`} aria-current={page === id ? 'page' : undefined}><Icon size={18} />{label}{id === 'bookings' && pending.length > 0 && <span className="ad-count">{pending.length}</span>}</button>)}</nav>
      <div className="ad-sidebar-bottom"><a href="/"><ArrowDownLeft size={17} /> View customer website</a><div className="ad-user"><span className="ad-avatar">{session.admin?.email?.[0]?.toUpperCase() || 'C'}</span><div><strong>Business owner</strong><span>{session.admin?.email || 'Administrator'}</span></div></div><button onClick={logout}><LogOut size={16} /> Sign out</button></div>
    </aside>
    {mobileMenu && <button className="ad-sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileMenu(false)} />}
    <main className="ad-main">
      <div className="ad-topbar"><button className="ad-menu-button" onClick={() => setMobileMenu(true)} aria-label="Open navigation"><Menu size={22} /></button><span>YOUR BUSINESS, IN FOCUS</span><div><span className="ad-live-dot" /> New York, NY <span className="ad-topbar-divider">/</span> Eastern time</div></div>
      <header className="ad-page-heading"><div><div className="ad-eyebrow">{dateLabel(today, { weekday: 'long', month: 'long', day: 'numeric' })}</div><h1>{titles[page]}</h1><p>{page === 'overview' ? 'A little organization. A lot of shine.' : page === 'bookings' ? 'Review requests and keep every customer in the loop.' : page === 'calendar' ? 'Your appointments at a glance. All times are New York time.' : 'Manage your services, coverage, and appointment availability.'}</p></div><button className="ad-secondary ad-refresh" onClick={refresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh data'}</button></header>
      {error && <div className="ad-alert" role="alert">{error}</div>}
      {toast && <div className="ad-toast" role="status"><Check size={18} />{toast}</div>}
      {loading && !catalog ? <div className="ad-loading" role="status">Loading your workspace…</div> : <>
        {page === 'overview' && <>
          <section className="ad-stat-grid" aria-label="Booking statistics">
            <Stat label="Awaiting your review" value={pending.length} description="New booking requests" Icon={Clock3} accent />
            <Stat label="On today's schedule" value={todayJobs.length} description="Pending & confirmed" Icon={CalendarDays} />
            <Stat label="Upcoming appointments" value={upcoming.length} description="Including today" Icon={Users} />
            <Stat label="Completed details" value={bookings.filter(b => b.status === 'completed').length} description="All time" Icon={Sparkles} />
          </section>
          <section className="ad-panel"><div className="ad-panel-heading"><div><div className="ad-eyebrow">NEXT UP</div><h2>Requests to review</h2></div><button className="ad-text-button" onClick={() => setPage('bookings')}>All reservations <ArrowRight size={17} /></button></div><BookingTable bookings={pending.slice(0, 6)} onSelect={setSelected} emptyTitle="You're all caught up." emptyText="New booking requests will appear here, ready for your review." /></section>
          <div className="ad-overview-bottom"><section className="ad-panel"><div className="ad-panel-heading"><div className="ad-heading-inline"><CalendarDays size={19} /><h2>Today's appointments</h2></div></div>{todayJobs.length ? <div className="ad-today-list">{todayJobs.sort((a, b) => a.time.localeCompare(b.time)).map(b => <button key={b.id} onClick={() => setSelected(b)}><span className="ad-today-time">{timeLabel(b.time)}</span><div><strong>{b.firstName} {b.lastName}</strong><span>{b.serviceName} · {b.vehicleName}</span></div><Status status={b.status} /><ChevronRight size={18} /></button>)}</div> : <Empty title="A little breathing room." text="No active appointments are scheduled for today." small />}</section><aside className="ad-note"><ShieldCheck size={28} /><h2>You're in the driver's seat.</h2><p>Requests stay pending until you confirm them. Check travel time and parking access before accepting a job.</p><p className="ad-note-foot">Contact customers directly about changes. Automated notifications are not connected yet.</p></aside></div>
        </>}
        {page === 'bookings' && <Reservations bookings={bookings} onSelect={setSelected} />}
        {page === 'calendar' && <Calendar bookings={bookings} onSelect={setSelected} today={today} />}
        {page === 'settings' && catalog && <BusinessSettings catalog={catalog} request={request} onSaved={async () => { setToast('Business settings saved.'); await refresh(); }} />}
      </>}
      <footer className="ad-footer"><span>CWASH · A better clean, wherever you are.</span><span>Owner workspace</span></footer>
    </main>
    {selected && <BookingDetail booking={selected} onClose={() => setSelected(null)} onUpdate={updateBooking} />}
  </div>;
}

function Brand() { return <a className="ad-brand" href="/" aria-label="CWASH home"><span className="ad-brand-icon"><Sparkles size={21} strokeWidth={2.5} /></span>CWASH<span className="ad-brand-period">.</span></a>; }

function Login({ configured, request, onLogin }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); try { onLogin(await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ email, password }) })); } catch (err) { setError(err.message); } finally { setBusy(false); } }
  return <div className="admin-login"><div className="ad-login-story"><Brand /><div><span className="ad-eyebrow">THE BUSINESS BEHIND THE SHINE</span><h1>Good service.<br />Great details.</h1><p>Your schedule, your customers, and your next great detail. All in one place.</p></div><span>Made for New York. Managed by you.</span></div><main className="ad-login-main"><a href="/" className="ad-back-link"><ArrowLeft size={16} /> Back to CWASH</a><div className="ad-login-card"><div className="ad-login-icon"><ShieldCheck size={28} /></div><span className="ad-eyebrow">OWNER WORKSPACE</span><h2>Welcome back.</h2><p>Sign in to keep your day running smoothly.</p>{configured === false ? <div className="ad-setup-message"><strong>Your admin account is not set up yet.</strong><p>Follow the account setup steps in the project README.</p><code>npm run admin:create</code><p>Once your account is created, refresh this page to sign in.</p></div> : <form onSubmit={submit}><label>Email address<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@yourbusiness.com" required disabled={busy} /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required disabled={busy} /></label>{error && <div className="ad-alert" role="alert">{error}</div>}<button className="ad-primary" disabled={busy}>{busy ? 'Signing in…' : <>Sign in <ArrowRight size={18} /></>}</button></form>}<div className="ad-login-foot"><ShieldCheck size={14} /> A private workspace for your business.</div></div></main></div>;
}

function Stat({ label, value, description, Icon, accent }) { return <div className={`ad-stat ${accent ? 'ad-stat-accent' : ''}`}><div><span>{label}</span><Icon size={19} /></div><strong>{value}</strong><small>{description}</small></div>; }
function Empty({ title, text, small }) { return <div className={`ad-empty ${small ? 'ad-empty-small' : ''}`}><span><CalendarDays size={25} /></span><h3>{title}</h3><p>{text}</p></div>; }

function BookingTable({ bookings, onSelect, emptyTitle = 'No reservations found.', emptyText = 'Try a different search or status filter.' }) {
  if (!bookings.length) return <Empty title={emptyTitle} text={emptyText} />;
  return <div className="ad-table-scroll"><table className="ad-table"><thead><tr><th>Customer</th><th>Service</th><th>Appointment</th><th>Status</th><th>Estimate</th><th><span className="ad-sr-only">Details</span></th></tr></thead><tbody>{bookings.map(b => <tr key={b.id}><td><div className="ad-customer-cell"><span className="ad-table-avatar">{b.firstName?.[0]}{b.lastName?.[0]}</span><div><strong>{b.firstName} {b.lastName}</strong><small>{b.reference}</small></div></div></td><td><strong>{b.serviceName}</strong><small>{b.vehicleName}</small></td><td><strong>{dateLabel(b.date)}</strong><small>{timeLabel(b.time)}</small></td><td><Status status={b.status} /></td><td className="ad-price">{money(b.total)}</td><td><button className="ad-row-open" onClick={() => onSelect(b)} aria-label={`View reservation ${b.reference}`}><ArrowRight size={17} /></button></td></tr>)}</tbody></table></div>;
}

function Reservations({ bookings, onSelect }) {
  const [filter, setFilter] = useState('all'); const [search, setSearch] = useState('');
  const filtered = bookings.filter(b => (filter === 'all' || b.status === filter) && `${b.firstName} ${b.lastName} ${b.reference} ${b.email} ${b.zip}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  return <section className="ad-panel"><div className="ad-reservation-toolbar"><div className="ad-tabs" aria-label="Filter reservations by status">{['all', ...statuses].map(s => <button key={s} onClick={() => setFilter(s)} className={filter === s ? 'active' : ''} aria-pressed={filter === s}>{s === 'all' ? 'All reservations' : s === 'pending' ? 'Pending' : statusLabel(s)}<span>{s === 'all' ? bookings.length : bookings.filter(b => b.status === s).length}</span></button>)}</div><label className="ad-search"><Search size={17} /><span className="ad-sr-only">Search reservations</span><input placeholder="Search name, reference, or ZIP" value={search} onChange={e => setSearch(e.target.value)} /></label></div><BookingTable bookings={filtered} onSelect={onSelect} /></section>;
}

function Calendar({ bookings, onSelect, today }) {
  const [anchor, setAnchor] = useState(today); const [mode, setMode] = useState('week');
  const offset = (new Date(`${anchor}T12:00:00`).getDay() + 6) % 7;
  const start = mode === 'day' ? anchor : addDays(anchor, -offset);
  const dates = Array.from({ length: mode === 'day' ? 1 : 7 }, (_, i) => addDays(start, i));
  return <section className="ad-panel"><div className="ad-calendar-toolbar"><div><h2>{dateLabel(start, { month: 'long', year: 'numeric' })}</h2><span>{mode === 'week' ? `${dateLabel(start)} – ${dateLabel(addDays(start, 6))}` : dateLabel(anchor, { weekday: 'long', month: 'long', day: 'numeric' })}</span></div><div className="ad-calendar-controls"><button className="ad-secondary" onClick={() => setAnchor(today)}>Today</button><div className="ad-mode-switch"><button className={mode === 'day' ? 'active' : ''} aria-pressed={mode === 'day'} onClick={() => setMode('day')}>Day</button><button className={mode === 'week' ? 'active' : ''} aria-pressed={mode === 'week'} onClick={() => setMode('week')}>Week</button></div><button className="ad-icon-button" aria-label="Previous period" onClick={() => setAnchor(addDays(anchor, mode === 'day' ? -1 : -7))}><ChevronLeft size={18} /></button><button className="ad-icon-button" aria-label="Next period" onClick={() => setAnchor(addDays(anchor, mode === 'day' ? 1 : 7))}><ChevronRight size={18} /></button></div></div><div className={`ad-calendar-grid ${mode === 'day' ? 'ad-calendar-day-view' : ''}`}>{dates.map(date => <div className={`ad-calendar-column ${date === today ? 'is-today' : ''}`} key={date}><div className="ad-calendar-date"><span>{dateLabel(date, { weekday: 'short' })}</span><strong>{dateLabel(date, { day: 'numeric' })}</strong>{date === today && <small>Today</small>}</div><div className="ad-calendar-events">{bookings.filter(b => b.date === date && b.status !== 'cancelled').sort((a, b) => a.time.localeCompare(b.time)).map(b => <button key={b.id} className={`ad-calendar-event ad-event-${b.status}`} onClick={() => onSelect(b)}><span>{timeLabel(b.time)}</span><strong>{b.firstName} {b.lastName}</strong><small>{b.serviceName}</small><small>{b.duration} min · {statusLabel(b.status)}</small></button>)}{!bookings.some(b => b.date === date && b.status !== 'cancelled') && <span className="ad-calendar-free">No appointments</span>}</div></div>)}</div><p className="ad-calendar-note"><Clock3 size={14} /> Times are shown in America/New_York. Cancelled reservations are hidden.</p></section>;
}

function BookingDetail({ booking: b, onClose, onUpdate }) {
  const [date, setDate] = useState(b.date); const [time, setTime] = useState(b.time); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [cancelConfirm, setCancelConfirm] = useState(false);
  const dialogRef = React.useRef(null);
  useEffect(() => { const previous = document.activeElement; dialogRef.current?.focus(); const oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = oldOverflow; previous?.focus?.(); }; }, []);
  function handleKeys(e) { if (e.key === 'Escape' && !busy) onClose(); if (e.key === 'Tab') { const elements = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href]')]; const first = elements[0], last = elements.at(-1); if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } } }
  async function update(changes) { setBusy(true); setError(''); try { await onUpdate(b.id, changes); } catch (err) { setError(err.message); setBusy(false); } }
  return <div className="ad-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}><section ref={dialogRef} className="ad-detail-modal" role="dialog" aria-modal="true" aria-labelledby="ad-detail-title" tabIndex={-1} onKeyDown={handleKeys}><div className="ad-detail-header"><div><span className="ad-eyebrow">{b.reference}</span><h2 id="ad-detail-title">Reservation details</h2></div><button className="ad-icon-button" onClick={onClose} disabled={busy} aria-label="Close reservation"><X size={20} /></button></div><div className="ad-detail-body"><div className="ad-detail-customer"><div><h3>{b.firstName} {b.lastName}</h3><a href={`mailto:${b.email}`}>{b.email}</a><a href={`tel:${b.phone}`}>{b.phone}</a></div><Status status={b.status} /></div><div className="ad-detail-service"><Sparkles size={21} /><div><strong>{b.serviceName}</strong><span>{b.vehicleName} · {b.duration} minutes</span></div><strong>{money(b.total)}</strong></div><div className="ad-detail-section"><h3><MapPin size={17} /> Service location</h3><p>{b.address}{b.unit ? `, ${b.unit}` : ''}<br />NY {b.zip}</p><span className="ad-parking-tag">{String(b.parking).replaceAll(/[_-]/g, ' ')}</span>{b.notes && <div className="ad-customer-notes"><strong>Customer notes</strong><p>{b.notes}</p></div>}</div><div className="ad-detail-section"><h3><CalendarDays size={17} /> Appointment · Eastern time</h3><div className="ad-field-row"><label>Date<input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={busy || !active(b)} required /></label><label>Time<input type="time" value={time} onChange={e => setTime(e.target.value)} disabled={busy || !active(b)} required /></label></div>{active(b) && <button className="ad-secondary" disabled={busy || !date || !time || (date === b.date && time === b.time)} onClick={() => update({ date, time })}>Save new appointment time</button>}</div><div className="ad-detail-advice">Check parking access and travel time before confirming. Contact the customer directly about confirmation or schedule changes.</div>{error && <div role="alert" className="ad-alert">{error}</div>}{cancelConfirm && <div className="ad-cancel-confirm"><p>Cancel this reservation? The customer will need to be notified directly.</p><button className="ad-danger" disabled={busy} onClick={() => update({ status: 'cancelled' })}>Yes, cancel reservation</button><button className="ad-secondary" disabled={busy} onClick={() => setCancelConfirm(false)}>Keep reservation</button></div>}</div><div className="ad-detail-actions">{active(b) && <button className="ad-danger-text" disabled={busy} onClick={() => setCancelConfirm(true)}>Cancel reservation</button>}{b.status === 'pending' && <button className="ad-primary" disabled={busy} onClick={() => update({ status: 'confirmed' })}>{busy ? 'Saving…' : <><Check size={17} /> Confirm request</>}</button>}{b.status === 'confirmed' && <button className="ad-primary" disabled={busy} onClick={() => update({ status: 'completed' })}>{busy ? 'Saving…' : <><Check size={17} /> Mark completed</>}</button>}{!active(b) && <button className="ad-secondary" onClick={onClose}>Close details</button>}</div></section></div>;
}

function BusinessSettings({ catalog, request, onSaved }) {
  const [settings, setSettings] = useState(catalog.settings);
  const [zipText, setZipText] = useState(catalog.settings.zipPrefixes.join(', '));
  const [blockedText, setBlockedText] = useState(catalog.settings.blockedDates.join(', '));
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { setSettings(catalog.settings); setZipText(catalog.settings.zipPrefixes.join(', ')); setBlockedText(catalog.settings.blockedDates.join(', ')); }, [catalog.settings]);
  const changeNumber = (key, value) => setSettings(s => ({ ...s, [key]: Number(value) }));
  async function save(event) { event.preventDefault(); setBusy(true); setError(''); try { const split = (text) => [...new Set(text.split(/[\s,]+/).map(v => v.trim()).filter(Boolean))]; await request('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ zipPrefixes: split(zipText), workingDays: settings.workingDays, startHour: settings.startHour, endHour: settings.endHour, slotInterval: settings.slotInterval, travelBuffer: settings.travelBuffer, blockedDates: split(blockedText), noticeHours: settings.noticeHours, preview: settings.preview }) }); await onSaved(); } catch (err) { setError(err.message); } finally { setBusy(false); } }
  return <div className="ad-settings-grid"><section className="ad-panel"><div className="ad-panel-heading"><div><div className="ad-eyebrow">THE MENU</div><h2>Services & pricing</h2></div><Sparkles size={22} /></div><div className="ad-settings-content"><p className="ad-setting-intro">Update base prices and appointment lengths. Vehicle surcharges are added at checkout. Existing reservations keep their original estimates.</p>{catalog.services.map(service => <ServiceEditor key={service.id} service={service} request={request} onSaved={onSaved} />)}<div className="ad-setting-help">Sample prices are a starting point. Review your pricing and service requirements before taking real customer bookings.</div></div></section><form className="ad-panel" onSubmit={save}><div className="ad-panel-heading"><div><div className="ad-eyebrow">YOUR SCHEDULE</div><h2>Availability & coverage</h2></div><SlidersHorizontal size={22} /></div><fieldset className="ad-settings-content" disabled={busy}><legend className="ad-sr-only">Availability settings</legend><label className="ad-checkbox-label"><input type="checkbox" checked={settings.preview !== false} onChange={e => setSettings(s => ({ ...s, preview: e.target.checked }))} /><span>Show preview pricing notice<small>Keep this enabled until your prices and coverage are ready for customers.</small></span></label><div className="ad-label">Working days</div><div className="ad-day-options">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => <button key={day} type="button" className={settings.workingDays.includes(index) ? 'active' : ''} aria-pressed={settings.workingDays.includes(index)} onClick={() => setSettings(s => ({ ...s, workingDays: s.workingDays.includes(index) ? s.workingDays.filter(d => d !== index) : [...s.workingDays, index].sort() }))}>{day}</button>)}</div><div className="ad-field-row"><label>Opening hour<input type="number" min="6" max="20" value={settings.startHour} onChange={e => changeNumber('startHour', e.target.value)} required /><small>24-hour format, Eastern time</small></label><label>Closing hour<input type="number" min="7" max="22" value={settings.endHour} onChange={e => changeNumber('endHour', e.target.value)} required /></label></div><div className="ad-field-row"><label>Start time interval (min)<select value={settings.slotInterval} onChange={e => changeNumber('slotInterval', e.target.value)}><option value="15">Every 15 minutes</option><option value="30">Every 30 minutes</option><option value="60">Every 60 minutes</option></select></label><label>Travel buffer (min)<input type="number" min="0" max="180" step="1" value={settings.travelBuffer} onChange={e => changeNumber('travelBuffer', e.target.value)} required /></label></div><label>Advance notice (hours)<input type="number" min="0" max="168" value={settings.noticeHours} onChange={e => changeNumber('noticeHours', e.target.value)} required /><small>Minimum time before a customer can request an appointment.</small></label><label>Service ZIP prefixes<textarea rows="2" value={zipText} onChange={e => setZipText(e.target.value)} required /><small>Comma-separated ZIP prefixes, e.g. 100, 112. These define the coverage check.</small></label><label>Days off<textarea rows="2" placeholder="2026-12-25, 2027-01-01" value={blockedText} onChange={e => setBlockedText(e.target.value)} /><small>Use YYYY-MM-DD dates, separated by commas. Existing bookings are not cancelled automatically.</small></label>{error && <div className="ad-alert" role="alert">{error}</div>}<button className="ad-primary" disabled={busy}>{busy ? 'Saving…' : <>Save availability <Check size={17} /></>}</button></fieldset></form></div>;
}

function ServiceEditor({ service, request, onSaved }) {
  const [price, setPrice] = useState(service.price); const [duration, setDuration] = useState(service.duration); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { setPrice(service.price); setDuration(service.duration); }, [service.price, service.duration]);
  async function save(e) { e.preventDefault(); setBusy(true); setError(''); try { await request(`/api/admin/services/${service.id}`, { method: 'PUT', body: JSON.stringify({ price: Number(price), duration: Number(duration) }) }); await onSaved(); } catch (err) { setError(err.message); } finally { setBusy(false); } }
  return <form className="ad-service-editor" onSubmit={save}><h3>{service.name}</h3><p>{service.description}</p><div className="ad-field-row"><label>Base price ($)<input type="number" min="1" max="10000" step="0.01" value={price} onChange={e => setPrice(e.target.value)} disabled={busy} required /></label><label>Duration (minutes)<input type="number" min="30" max="600" step="1" value={duration} onChange={e => setDuration(e.target.value)} disabled={busy} required /></label></div>{error && <p className="ad-inline-error" role="alert">{error}</p>}<button className="ad-secondary" disabled={busy || (Number(price) === service.price && Number(duration) === service.duration)}>{busy ? 'Saving…' : 'Save service'}</button></form>;
}
