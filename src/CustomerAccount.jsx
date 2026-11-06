import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, CreditCard, Clock3, Droplets, LogOut, MapPin, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { useCustomerAuth } from './customer-auth.jsx';
import './customer-account.css';
import CustomerBilling, { BookingPayment, useCustomerBilling } from './CustomerBilling.jsx';

const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 }).format(value || 0);
const dateLabel = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
const timeLabel = time => { const [h, m] = time.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const statusLabel = status => status === 'pending' ? 'Awaiting confirmation' : status.charAt(0).toUpperCase() + status.slice(1);

function Brand() { return <a className="ca-brand" href="/" aria-label="CWASH home"><Droplets size={25} />CWASH<span>.</span></a>; }
function ErrorMessage({ message }) { return message ? <div className="ca-error" role="alert">{message}</div> : null; }

export default function CustomerAccount() {
  const auth = useCustomerAuth();
  const [notice, setNotice] = useState('');
  if (auth.loading) return <div className="ca-shell"><header className="ca-header"><Brand /></header><main className="ca-loading" role="status">Opening your account…</main></div>;
  return <div className="ca-shell">
    <header className="ca-header"><Brand /><a className="ca-back" href="/"><ArrowLeft size={16} />Back to the website</a></header>
    {auth.user ? <AccountDashboard key={auth.user.id} onPasswordChanged={() => setNotice('Your password has been changed. Sign in again with your new password.')} /> : <Authentication notice={notice} />}
    <footer className="ca-footer">CWASH · A little care goes a long way.<span>New York City</span></footer>
  </div>;
}

function Authentication({ notice }) {
  const { authenticate, error: sessionError, refreshSession } = useCustomerAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  async function submit(event) {
    event.preventDefault(); setError('');
    if (mode === 'register' && form.password !== form.confirmPassword) return setError('Your passwords do not match.');
    setBusy(true);
    try {
      await authenticate(mode, mode === 'register' ? { firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim(), phone: form.phone.trim(), password: form.password } : { email: form.email.trim(), password: form.password });
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <main className="ca-auth-layout">
    <section className="ca-welcome"><span className="ca-eyebrow">YOUR CAR CARE, ALL TOGETHER</span><h1>A fresh detail.<br />A familiar place.</h1><p>Create your own space for better car care. Book a detail and check your reservations from the website or mobile app.</p><ul><li><CalendarDays size={20} />Your bookings, in one place.</li><li><UserRound size={20} />Less typing next time.</li><li><Sparkles size={20} />The same account on every device.</li></ul><a href="/#book">Continue as a guest <ArrowRight size={16} /></a></section>
    <section className="ca-auth-card"><div className="ca-auth-icon"><ShieldCheck size={26} /></div><span className="ca-eyebrow">YOUR CWASH ACCOUNT</span><h2>{mode === 'login' ? 'Welcome back.' : 'Make yourself at home.'}</h2><p>{mode === 'login' ? 'Sign in to see your bookings and plan your next detail.' : 'A few details now. Easier bookings from here.'}</p>
      <div className="ca-tabs" aria-label="Account access"><button type="button" aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setError(''); setForm(f => ({ ...f, password: '', confirmPassword: '' })); }} disabled={busy}>Sign in</button><button type="button" aria-pressed={mode === 'register'} onClick={() => { setMode('register'); setError(''); setForm(f => ({ ...f, password: '', confirmPassword: '' })); }} disabled={busy}>Create account</button></div>
      {notice && <div className="ca-notice" role="status">{notice}</div>}
      {sessionError && <div className="ca-error" role="alert">{sessionError} <button type="button" onClick={refreshSession}>Retry connection</button></div>}
      <form onSubmit={submit}><fieldset disabled={busy}><legend className="ca-sr-only">{mode === 'login' ? 'Sign in to your account' : 'Create a customer account'}</legend>
        {mode === 'register' && <><div className="ca-field-row"><label>First name<input autoComplete="given-name" value={form.firstName} onChange={e => change('firstName', e.target.value)} maxLength={80} required /></label><label>Last name<input autoComplete="family-name" value={form.lastName} onChange={e => change('lastName', e.target.value)} maxLength={80} required /></label></div></>}
        <label>Email address<input type="email" autoComplete="email" autoCapitalize="none" value={form.email} onChange={e => change('email', e.target.value)} maxLength={200} required /></label>
        {mode === 'register' && <label>Phone number (optional)<input type="tel" autoComplete="tel" value={form.phone} onChange={e => change('phone', e.target.value)} maxLength={30} /></label>}
        <label>Password<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={e => change('password', e.target.value)} minLength={mode === 'register' ? 12 : undefined} maxLength={200} required />{mode === 'register' && <small>Use at least 12 characters.</small>}</label>
        {mode === 'register' && <label>Confirm password<input type="password" autoComplete="new-password" value={form.confirmPassword} onChange={e => change('confirmPassword', e.target.value)} minLength={12} maxLength={200} required /></label>}
        <ErrorMessage message={error} /><button className="ca-primary" type="submit">{busy ? 'Please wait…' : mode === 'login' ? 'Sign in to my account' : 'Create my account'}{!busy && <ArrowRight size={17} />}</button>
      </fieldset></form>
      <p className="ca-fine-print">Keep your password somewhere safe. Email verification and email password recovery are not available yet.</p>
    </section>
  </main>;
}

function AccountDashboard({ onPasswordChanged }) {
  const { user, request, logout, updateProfile, changePassword } = useCustomerAuth();
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).has('billing') ? 'billing' : 'bookings');
  const billing = useCustomerBilling(request);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    request('/api/customer/bookings').then(data => { if (active) setBookings(data.bookings); }).catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request, refreshKey]);
  async function signOut() { setBusy(true); setError(''); try { await logout(); } catch (err) { setError(err.message); } finally { setBusy(false); } }
  return <main className="ca-dashboard">
    <section className="ca-dashboard-heading"><div><span className="ca-eyebrow">YOUR CWASH ACCOUNT</span><h1>Good to see you, {user.firstName}.</h1><p>Your next fresh start is never far away.</p></div><button className="ca-secondary" disabled={busy} onClick={signOut}><LogOut size={16} />{busy ? 'Signing out…' : 'Sign out'}</button></section>
    <div className="ca-dashboard-grid"><aside className="ca-account-sidebar"><div className="ca-avatar"><UserRound size={24} /></div><strong>{user.firstName} {user.lastName}</strong><span>{user.email}</span><nav aria-label="Customer account navigation"><button aria-current={tab === 'bookings' ? 'page' : undefined} onClick={() => { setTab('bookings'); setNotice(''); }}><CalendarDays size={18} />My bookings</button><button aria-current={tab === 'profile' ? 'page' : undefined} onClick={() => { setTab('profile'); setNotice(''); }}><UserRound size={18} />Profile & security</button><button aria-current={tab === 'billing' ? 'page' : undefined} onClick={() => { setTab('billing'); setNotice(''); }}><CreditCard size={18} />Membership & billing</button></nav><a className="ca-primary" href="/#book">Book a detail <ArrowRight size={16} /></a></aside>
      <section className="ca-account-content"><ErrorMessage message={error} />{billing.error && <div className="ca-error" role="alert">{billing.error} <button type="button" disabled={billing.loading || billing.busy} onClick={billing.refresh}>Retry billing</button></div>}{notice && <div className="ca-notice" role="status"><Check size={17} />{notice}</div>}
        {tab === 'bookings' ? <><div className="ca-section-heading"><div><span className="ca-eyebrow">YOUR CAR CARE CALENDAR</span><h2>My bookings</h2></div><button className="ca-secondary" disabled={loading} onClick={() => { setRefreshKey(key => key + 1); void billing.refresh(); }}>{loading ? 'Refreshing…' : 'Refresh bookings'}</button></div><p className="ca-description">Appointments booked while signed in appear here across your devices. Times are shown in New York time.</p>
          {loading && !bookings.length ? <p role="status" className="ca-empty">Loading your bookings…</p> : !bookings.length ? <div className="ca-empty"><CalendarDays size={34} /><h3>Your next detail starts here.</h3><p>You haven’t booked a detail with this account yet.</p><a className="ca-primary" href="/#book">Find your detail <ArrowRight size={16} /></a></div> : <div className="ca-booking-list">{[...bookings].sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)).map(booking => <article className="ca-booking-card" key={booking.id || booking.reference}><div className="ca-booking-top"><span className={`ca-status ca-status-${booking.status}`}>{statusLabel(booking.status)}</span><span className="ca-reference">{booking.reference}</span></div><div className="ca-booking-title"><div><h3>{booking.serviceName}</h3><p>{booking.vehicleName}</p></div><strong>{money(booking.total)}</strong></div><div className="ca-booking-details"><p><CalendarDays size={17} /><span>{dateLabel(booking.date)}<small>{timeLabel(booking.time)} · New York time</small></span></p><p><MapPin size={17} /><span>{booking.address}{booking.unit ? `, ${booking.unit}` : ''}<small>NY {booking.zip}</small></span></p><p><Clock3 size={17} /><span>About {booking.duration} minutes</span></p></div>{booking.status === 'pending' && <p className="ca-booking-help">Your requested time and workspace are being reviewed before confirmation.</p>}<BookingPayment booking={booking} billing={billing} /></article>)}</div>}
          <p className="ca-fine-print">Earlier guest bookings are not automatically linked by email. No email or text notifications are sent yet; refresh here to check for updates.</p>
        </> : tab === 'billing' ? <CustomerBilling billing={billing} /> : <><div className="ca-section-heading"><div><span className="ca-eyebrow">MAKE NEXT TIME EASIER</span><h2>Profile & security</h2></div></div><ProfileForm user={user} onSave={async fields => { await updateProfile(fields); setNotice('Your profile has been saved.'); }} /><PasswordForm onSave={async fields => { await changePassword(fields); onPasswordChanged(); }} /></>}
      </section>
    </div>
  </main>;
}

function ProfileForm({ user, onSave }) {
  const [fields, setFields] = useState({ firstName: user.firstName, lastName: user.lastName, phone: user.phone || '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); try { await onSave(fields); } catch (err) { setError(err.message); } finally { setBusy(false); } }
  return <form className="ca-profile-form" onSubmit={submit}><h3>Your details</h3><fieldset disabled={busy}><legend className="ca-sr-only">Edit customer profile</legend><div className="ca-field-row">{['firstName', 'lastName'].map(key => <label key={key}>{key === 'firstName' ? 'First name' : 'Last name'}<input value={fields[key]} onChange={e => setFields(f => ({ ...f, [key]: e.target.value }))} maxLength={80} autoComplete={key === 'firstName' ? 'given-name' : 'family-name'} required /></label>)}</div><label>Phone number<input type="tel" value={fields.phone} onChange={e => setFields(f => ({ ...f, phone: e.target.value }))} maxLength={30} autoComplete="tel" /></label><label>Email address<input type="email" value={user.email} readOnly /><small>Your sign-in email cannot be changed here.</small></label><ErrorMessage message={error} /><button className="ca-primary" type="submit">{busy ? 'Saving…' : 'Save profile'}<Check size={16} /></button></fieldset></form>;
}

function PasswordForm({ onSave }) {
  const [fields, setFields] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event) { event.preventDefault(); setError(''); if (fields.newPassword !== fields.confirm) return setError('Your new passwords do not match.'); setBusy(true); try { await onSave({ currentPassword: fields.currentPassword, newPassword: fields.newPassword }); } catch (err) { setError(err.message); } finally { setBusy(false); } }
  return <form className="ca-profile-form" onSubmit={submit}><h3>Change password</h3><p>Changing your password signs you out on all devices.</p><fieldset disabled={busy}><legend className="ca-sr-only">Change customer password</legend><label>Current password<input type="password" autoComplete="current-password" value={fields.currentPassword} onChange={e => setFields(f => ({ ...f, currentPassword: e.target.value }))} maxLength={200} required /></label><label>New password<input type="password" autoComplete="new-password" value={fields.newPassword} onChange={e => setFields(f => ({ ...f, newPassword: e.target.value }))} minLength={12} maxLength={200} required /><small>Use at least 12 characters.</small></label><label>Confirm new password<input type="password" autoComplete="new-password" value={fields.confirm} onChange={e => setFields(f => ({ ...f, confirm: e.target.value }))} minLength={12} maxLength={200} required /></label><ErrorMessage message={error} /><button className="ca-primary" type="submit">{busy ? 'Updating…' : 'Change password'}<ShieldCheck size={16} /></button></fieldset></form>;
}
