import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, ChevronDown, Clock3, Droplets, MapPin, Menu, ShieldCheck, Sparkles, X } from 'lucide-react';
import './customer.css';

const currency = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(value || 0) ? 0 : 2, maximumFractionDigits: 2 }).format(value || 0);
const nyDate = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}`;
};
const prettyDate = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', weekday: 'short' }) : 'Choose a date';
const prettyTime = value => {
  if (!value) return 'Choose a time';
  const [hour, minute] = value.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
};
const initialForm = { serviceId: '', vehicleId: '', date: nyDate(new Date(Date.now() + 86400000)), time: '', firstName: '', lastName: '', email: '', phone: '', address: '', unit: '', zip: '', parking: '', notes: '', consent: false };

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function CarArtwork() {
  return <svg className="car-artwork" viewBox="0 0 800 560" role="img" aria-label="Illustration of a freshly detailed silver sports car">
    <defs>
      <linearGradient id="car-body" x1="0" y1="0" x2=".5" y2="1"><stop offset="0" stopColor="#fbfcf7"/><stop offset=".35" stopColor="#bdc9ca"/><stop offset=".72" stopColor="#82999d"/><stop offset="1" stopColor="#dae1dc"/></linearGradient>
      <linearGradient id="car-hood" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#e9ede4"/><stop offset="1" stopColor="#91a5a6"/></linearGradient>
      <linearGradient id="car-glass" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#284349"/><stop offset="1" stopColor="#071d28"/></linearGradient>
      <radialGradient id="wheel-metal"><stop stopColor="#73898c"/><stop offset=".25" stopColor="#dde7e4"/><stop offset=".35" stopColor="#314951"/><stop offset=".85" stopColor="#acb9b7"/><stop offset="1" stopColor="#20363d"/></radialGradient>
      <filter id="car-shadow"><feGaussianBlur stdDeviation="16"/></filter>
    </defs>
    <ellipse cx="408" cy="442" rx="323" ry="32" fill="#061820" opacity=".5" filter="url(#car-shadow)"/>
    <g transform="translate(8 8) rotate(-8 400 320)">
      <path d="M105 340 170 297 263 224Q284 206 333 205L462 213Q498 218 541 266L659 302Q697 310 713 348L706 397Q690 423 654 426L139 418Q100 410 91 379Z" fill="url(#car-body)" stroke="#092630" strokeWidth="3"/>
      <path d="M173 298 272 232Q291 219 328 219L383 222 365 294Z" fill="url(#car-glass)" stroke="#aebfc0" strokeWidth="4"/>
      <path d="M393 224 450 228Q489 233 520 272L381 292Z" fill="url(#car-glass)" stroke="#b5c4c3" strokeWidth="4"/>
      <path d="m405 230 36 4 62 33-89 12Z" fill="#88a1a1" opacity=".25"/>
      <path d="m193 287 87-55 26-6-81 59Z" fill="#aac2bb" opacity=".3"/>
      <path d="m381 296 141-20 128 36-121 48-218-7Z" fill="url(#car-hood)"/>
      <path d="m539 288 93 30-95 33-135-10" fill="none" stroke="#e8ede4" strokeWidth="2" opacity=".7"/>
      <path d="m104 346 237-44 187 62 183-22" fill="none" stroke="#ebeee5" strokeWidth="3"/>
      <path d="m365 302-19 72-7 39M170 310l-21 52" fill="none" stroke="#6b8589" strokeWidth="2"/>
      <path d="m374 311 22-3" stroke="#435b61" strokeWidth="5" strokeLinecap="round"/>
      <path d="m471 311 22-3" stroke="#435b61" strokeWidth="5" strokeLinecap="round"/>
      <path d="m212 410 304 7" stroke="#314c52" strokeWidth="9"/>
      <path d="m611 344 71-14 12 16-59 18Z" fill="#effbdc" stroke="#31474b" strokeWidth="3"/>
      <path d="m533 374 165-19-9 34-150 18Z" fill="#122d35"/>
      <path d="m545 381 142-17m-142 25 137-16m-134 23 131-16" stroke="#41585c" strokeWidth="2"/>
      <path d="m102 352 27-11-4 17-25 10" fill="#ec7c51"/>
      <path d="m478 300 14-13 30-1 11 15-25 3Z" fill="#142e37"/>
      <ellipse cx="208" cy="387" rx="48" ry="60" fill="#0a2029"/>
      <ellipse cx="208" cy="387" rx="32" ry="43" fill="url(#wheel-metal)"/>
      <ellipse cx="208" cy="387" rx="24" ry="34" fill="#1c343d"/>
      <path d="m208 354 0 65m-23-52 47 41m-46 0 45-42" stroke="#aabbb9" strokeWidth="6"/>
      <ellipse cx="208" cy="387" rx="8" ry="11" fill="#d2dcd5"/>
      <ellipse cx="540" cy="405" rx="51" ry="62" fill="#0a2029"/>
      <ellipse cx="540" cy="405" rx="35" ry="45" fill="url(#wheel-metal)"/>
      <ellipse cx="540" cy="405" rx="27" ry="36" fill="#1c343d"/>
      <path d="m540 370 0 70m-25-55 50 45m-49 0 48-45" stroke="#aabbb9" strokeWidth="6"/>
      <ellipse cx="540" cy="405" rx="9" ry="11" fill="#d2dcd5"/>
      <path d="m134 368 21-5M265 348l70-12" stroke="#edf3e6" strokeWidth="2"/>
    </g>
    <g stroke="#dbf7a5" strokeLinecap="round"><path d="M606 164v36m-18-18h36" strokeWidth="3"/><path d="M156 212v24m-12-12h24" strokeWidth="2"/><path d="M680 260v16m-8-8h16" strokeWidth="2"/></g>
  </svg>;
}

function Header({ onBook }) {
  const [open, setOpen] = useState(false);
  return <header className="site-header"><div className="page-width header-inner">
    <a href="#" className="wordmark" aria-label="CWASH home"><Droplets size={26} strokeWidth={2.6}/>CWASH<span className="wordmark-dot">.</span></a>
    <button className="mobile-menu" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X/> : <Menu/>}</button>
    <nav className={open ? 'site-nav is-open' : 'site-nav'} aria-label="Main navigation">
      <a href="#services" onClick={() => setOpen(false)}>Our services</a><a href="#how-it-works" onClick={() => setOpen(false)}>How it works</a><a href="#coverage" onClick={() => setOpen(false)}>Where we go</a>
      <button className="button button-dark nav-book" onClick={() => { setOpen(false); onBook(); }}>Book a detail <ArrowRight size={16}/></button>
    </nav>
  </div></header>;
}

function Booking({ catalog, form, setForm, step, setStep, loadingCatalog, catalogError }) {
  const [error, setError] = useState('');
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotError, setSlotError] = useState('');
  const [sending, setSending] = useState(false);
  const [booking, setBooking] = useState(null);
  const formRef = useRef(null);
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current !== step) {
      const heading = formRef.current?.querySelector('h3');
      heading?.setAttribute('tabindex', '-1');
      heading?.focus({ preventScroll: false });
      previousStep.current = step;
    }
  }, [step]);
  const service = catalog?.services.find(item => item.id === form.serviceId);
  const vehicle = catalog?.vehicles.find(item => item.id === form.vehicleId);
  const total = (service?.price || 0) + (vehicle?.surcharge || 0);
  const duration = (service?.duration || 0) + (vehicle?.durationExtra || 0);
  const update = (key, value) => { setForm(previous => ({ ...previous, [key]: value, ...(['serviceId', 'vehicleId', 'date'].includes(key) ? { time: '' } : {}) })); setError(''); };
  useEffect(() => {
    if (step !== 2 || !form.date || !form.serviceId || !form.vehicleId) return;
    const controller = new AbortController();
    setLoadingSlots(true); setSlotError(''); setSlots([]);
    const query = new URLSearchParams({ date: form.date, serviceId: form.serviceId, vehicleId: form.vehicleId });
    request(`/api/availability?${query}`, { signal: controller.signal }).then(data => setSlots(data.slots)).catch(err => { if (err.name !== 'AbortError') setSlotError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoadingSlots(false); });
    return () => controller.abort();
  }, [form.date, form.serviceId, form.vehicleId, step]);

  const next = event => {
    event.preventDefault(); setError('');
    if (step === 0 && (!service || !vehicle)) return setError('Choose a service and vehicle size to continue.');
    if (step === 1) {
      if (!/^\d{5}$/.test(form.zip)) return setError('Enter a five-digit ZIP code.');
      if (!catalog.settings.zipPrefixes.some(prefix => form.zip.startsWith(prefix))) return setError('That ZIP code is outside our current service area. Please choose a location in a supported NYC ZIP code.');
      if (!form.address.trim() || !form.parking) return setError('Add the address and tell us where the car will be parked.');
    }
    if (step === 2 && (!form.time || !slots.includes(form.time))) return setError('Choose an available time to continue.');
    if (step < 3) { setStep(step + 1); return; }
    submit();
  };

  async function submit() {
    if (!form.consent) return setError('Please confirm that you understand this is an appointment request.');
    setSending(true);
    try {
      const data = await request('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      setBooking(data.booking);
    } catch (err) { setError(err.message); }
    finally { setSending(false); }
  }

  const input = (name, label, attributes = {}) => <label className="field" key={name}><span>{label}</span><input name={name} value={form[name]} onChange={event => update(name, event.target.value)} {...attributes}/></label>;

  return <section id="book" className="booking-section section-pad"><div className="page-width">
    <div className="section-heading"><div><span className="eyebrow"><span/> YOUR NEXT FRESH START</span><h2>A little care.<br/>A whole new feeling.</h2></div><p>Pick your detail. Find your moment.<br/>We’ll take it from there.</p></div>
    {loadingCatalog ? <div className="booking-loading" role="status">Getting your booking options ready…</div> : catalogError ? <div className="error-banner" role="alert">{catalogError} <button onClick={() => window.location.reload()}>Try again</button></div> : catalog && <div className="booking-layout">
      <div className="booking-panel">
        {booking ? <div className="booking-success" role="status" tabIndex={-1}>
          <span className="success-icon"><CheckCircle2 size={36}/></span><span className="eyebrow">REQUEST RECEIVED</span><h3>You’re on our list.</h3><p>Your detail is <strong>awaiting confirmation</strong>. Our team will review your location and preferred time before accepting your appointment.</p>
          <div className="confirmation-reference"><span>YOUR BOOKING REFERENCE</span><strong>{booking.reference}</strong></div>
          <dl className="confirmation-details"><div><dt>Service</dt><dd>{booking.serviceName}</dd></div><div><dt>Requested date</dt><dd>{prettyDate(booking.date)}</dd></div><div><dt>Requested time</dt><dd>{prettyTime(booking.time)} · New York time</dd></div><div><dt>Estimated total</dt><dd>{currency(booking.total)}</dd></div></dl>
          <p className="small-muted">Save this reference for your records. No payment has been taken. This page is your request receipt; email and text notifications are not enabled yet.</p>
          <button className="button button-dark" onClick={() => { setBooking(null); setStep(0); setForm({ ...initialForm }); }}>Request another detail <ArrowRight size={16}/></button>
        </div> : <>
          <ol className="booking-steps" aria-label="Booking progress">{['Your detail', 'Location', 'Date & time', 'Your details'].map((label, index) => <li key={label} className={index === step ? 'active' : index < step ? 'complete' : ''} aria-current={index === step ? 'step' : undefined}><span>{index < step ? <Check size={14}/> : String(index + 1).padStart(2, '0')}</span><span>{label}</span></li>)}</ol>
          <form ref={formRef} onSubmit={next} className="booking-form">
            {step === 0 && <><div className="form-heading"><span>STEP 01 / 04</span><h3>What does your car need?</h3><p>Good care starts with the right detail.</p></div><fieldset className="selection-fieldset"><legend>Choose your service</legend><div className="service-options">{catalog.services.map(item => <label className={`service-option ${form.serviceId === item.id ? 'selected' : ''}`} key={item.id}><input type="radio" name="serviceId" value={item.id} checked={form.serviceId === item.id} onChange={() => update('serviceId', item.id)}/><span className="choice-dot"/><span className="option-main"><strong>{item.name}</strong><span><Clock3 size={13}/>{item.duration} min</span></span><strong className="option-price">{currency(item.price)}</strong></label>)}</div></fieldset>
              <fieldset className="selection-fieldset"><legend>Your vehicle size</legend><div className="vehicle-options">{catalog.vehicles.map(item => <label className={`vehicle-option ${form.vehicleId === item.id ? 'selected' : ''}`} key={item.id}><input type="radio" name="vehicleId" value={item.id} checked={form.vehicleId === item.id} onChange={() => update('vehicleId', item.id)}/><CarSize large={item.surcharge > 0}/><strong>{item.name}</strong><span>{item.surcharge ? `+${currency(item.surcharge)}` : 'Base price'}</span></label>)}</div></fieldset></>}
            {step === 1 && <><div className="form-heading"><span>STEP 02 / 04</span><h3>Where should we meet you?</h3><p>Your home, your workplace, your convenience.</p></div><div className="field-row">{input('zip', 'NYC ZIP code', { required: true, inputMode: 'numeric', pattern: '[0-9]{5}', maxLength: 5, autoComplete: 'postal-code', placeholder: '11201' })}{input('unit', 'Apt / unit (optional)', { maxLength: 40, autoComplete: 'address-line2', placeholder: 'Apt 4B' })}</div>{input('address', 'Street address', { required: true, maxLength: 200, autoComplete: 'street-address', placeholder: '123 Atlantic Avenue' })}<label className="field"><span>Where will your car be parked?</span><select name="parking" value={form.parking} onChange={event => update('parking', event.target.value)} required><option value="">Choose parking type</option><option value="driveway">Private driveway</option><option value="private-lot">Private parking lot</option><option value="garage">Garage</option><option value="street">Street parking</option></select></label><div className="info-note"><MapPin size={19}/><p>We’ll review workspace, garage permission, and water or power access before confirming. Street parking is subject to an access check.</p></div><label className="field"><span>Access notes (optional)</span><textarea name="notes" rows={3} maxLength={1000} placeholder="Garage entry, vehicle condition, or anything we should know…" value={form.notes} onChange={event => update('notes', event.target.value)}/></label></>}
            {step === 2 && <><div className="form-heading"><span>STEP 03 / 04</span><h3>Make time for a fresh start.</h3><p>All appointments use New York time.</p></div>{input('date', 'Preferred date', { type: 'date', required: true, min: nyDate(), max: nyDate(new Date(Date.now() + 90 * 86400000)) })}<fieldset className="selection-fieldset time-fieldset"><legend>Available arrival times</legend>{loadingSlots ? <p className="small-muted" role="status">Checking available times…</p> : slotError ? <p className="error-banner" role="alert">{slotError}</p> : slots.length ? <div className="time-options">{slots.map(time => <label className={`time-option ${form.time === time ? 'selected' : ''}`} key={time}><input type="radio" name="time" value={time} checked={form.time === time} onChange={() => update('time', time)}/>{prettyTime(time)}</label>)}</div> : <div className="empty-slots"><CalendarDays size={28}/><p>No times available on this date.</p><span>Try another day to find your spot.</span></div>}</fieldset><div className="info-note"><Clock3 size={19}/><p>This is your requested arrival time. Your appointment becomes confirmed once our team accepts it.</p></div></>}
            {step === 3 && <><div className="form-heading"><span>STEP 04 / 04</span><h3>Let’s make it yours.</h3><p>Just a few details and your request is on its way.</p></div><div className="field-row">{input('firstName', 'First name', { required: true, maxLength: 80, autoComplete: 'given-name', placeholder: 'First name' })}{input('lastName', 'Last name', { required: true, maxLength: 80, autoComplete: 'family-name', placeholder: 'Last name' })}</div>{input('email', 'Email address', { required: true, type: 'email', maxLength: 200, autoComplete: 'email', placeholder: 'you@example.com' })}{input('phone', 'Phone number', { required: true, type: 'tel', maxLength: 30, autoComplete: 'tel', placeholder: '(212) 555-0123' })}<div className="contact-note">Your contact details are only used to manage your reservation.</div><label className="consent-check"><input type="checkbox" checked={form.consent} onChange={event => update('consent', event.target.checked)} required/><span>I understand this is a booking request. My appointment and final service details will be confirmed by CWASH. No payment is due now.</span></label></>}
            {error && <div className="error-banner" role="alert">{error}</div>}
            <div className="form-navigation">{step > 0 ? <button type="button" className="back-button" disabled={sending} onClick={() => { setStep(step - 1); setError(''); }}><ArrowLeft size={17}/>Back</button> : <span className="form-safe"><ShieldCheck size={15}/>No payment required</span>}<button type="submit" className="button button-dark" disabled={sending || (step === 2 && loadingSlots)}>{sending ? 'Sending request…' : step === 3 ? 'Request appointment' : 'Continue'}{!sending && <ArrowRight size={17}/>}</button></div>
          </form>
        </>}
      </div>
      <aside className="booking-summary"><div className="summary-top"><Droplets size={25}/><span>A BETTER KIND OF CAR CARE</span></div><h3>Your detail,<br/>at your doorstep.</h3><div className="summary-line"><span>Service</span><strong>{service?.name || 'Choose your detail'}</strong></div><div className="summary-line"><span>Vehicle</span><strong>{vehicle?.name || 'Choose vehicle size'}</strong></div><div className="summary-divider"/><div className="summary-item"><CalendarDays size={18}/><span>{form.date ? prettyDate(form.date) : 'Choose a date'}<small>{form.time ? `${prettyTime(form.time)} · New York time` : 'Time to be selected'}</small></span></div><div className="summary-item"><MapPin size={18}/><span>{form.address || 'Your NYC location'}<small>{form.zip || 'We come to you'}</small></span></div>{service && <div className="summary-item"><Clock3 size={18}/><span>About {duration} minutes<small>A little time, a lot of care</small></span></div>}<div className="summary-total"><div><span>Estimated total</span><small>No payment today</small></div><strong>{service ? currency(total) : '—'}</strong></div><p>Requests are reviewed before confirmation. Extra work or changes are always discussed first.</p></aside>
    </div>}
  </div></section>;
}

function CarSize({ large }) { return <svg viewBox="0 0 80 38" aria-hidden="true"><path d={large ? 'M8 24v-9h12l8-8h29l9 10 8 3v10H8Z' : 'M7 23l13-4 12-10h22l10 11 10 4v7H7Z'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M30 11v9h24l-4-9M24 20h-8M39 11v9" fill="none" stroke="currentColor" strokeWidth="1.7"/><circle cx="23" cy="29" r="6" fill="var(--cw-cream)" stroke="currentColor" strokeWidth="2"/><circle cx="61" cy="29" r="6" fill="var(--cw-cream)" stroke="currentColor" strokeWidth="2"/></svg>; }

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(initialForm);
  const [step, setStep] = useState(0);
  useEffect(() => { const controller = new AbortController(); request('/api/catalog', { signal: controller.signal }).then(setCatalog).catch(err => { if (err.name !== 'AbortError') setError('We couldn’t load the booking options. Please try again in a moment.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, []);
  const book = serviceId => { if (serviceId) { setForm(previous => ({ ...previous, serviceId, time: '' })); setStep(0); } document.getElementById('book')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const services = catalog?.services || [];
  return <div className="customer-app">
    <a className="skip-link" href="#main">Skip to content</a>
    {(catalog?.settings?.preview ?? true) && <div className="preview-ribbon">CWASH preview <span>·</span> Sample services and pricing. Booking requests are for testing.</div>}
    <Header onBook={() => book()}/>
    <main id="main">
      <section className="hero"><div className="page-width hero-grid"><div className="hero-copy"><div className="hero-eyebrow"><span className="status-dot"/> MOBILE DETAILING. NEW YORK CITY.</div><h1>Your car.<br/>Our care.<br/><span>Your doorstep.</span></h1><p>A proper detail without the detour. We bring thoughtful car care to your corner of the city.</p><button className="button button-lime hero-cta" onClick={() => book()}>Find your fresh start <ArrowRight size={19}/></button><div className="hero-reassurance"><span><Check size={14}/>Book in minutes</span><span><Check size={14}/>We come to you</span></div></div>
        <div className="hero-visual"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="hero-art-label"><span>LESS HASSLE.</span><span>MORE SHINE.</span></div><CarArtwork/><div className="floating-location"><span><MapPin size={18}/></span><div>Next stop: your doorstep.<small>At home. At work. Across NYC.</small></div><span className="location-dot"/></div><span className="hero-art-caption">CAR CARE, ON YOUR TERMS. / EST. NYC</span></div>
      </div><div className="page-width hero-bottom"><span>MADE FOR THE CITY. BUILT AROUND YOUR DAY.</span><a href="#services">Explore the details <ArrowDown size={16}/></a></div></section>
      <div className="benefit-bar"><div className="page-width benefit-inner"><span><MapPin/>Your place, our workspace</span><span><Sparkles/>Every detail considered</span><span><CalendarDays/>Your schedule comes first</span></div></div>
      <section className="services-section section-pad" id="services"><div className="page-width"><div className="section-heading"><div><span className="eyebrow"><span/> A DETAIL FOR EVERY DAY</span><h2>More than clean.<br/>Cared for.</h2></div><p>From the daily commute to the weekend escape,<br className="desktop-br"/> give your ride the care it deserves.</p></div><div className="service-cards">{loading ? <div className="service-placeholder" role="status">Loading our services…</div> : error ? <p className="error-banner">{error}</p> : services.map((service, index) => <article className={`service-card ${index === 2 ? 'service-card-featured' : ''}`} key={service.id}><div className="service-card-top"><span className="service-number">0{index + 1}</span>{index === 2 ? <span className="service-tag">THE COMPLETE RESET</span> : <span className="service-symbol">{index === 0 ? <Sparkles/> : <Droplets/>}</span>}</div><h3>{service.name}</h3><p>{service.description}</p><div className="service-price"><span>From</span><strong>{currency(service.price)}</strong><span className="duration"><Clock3 size={14}/>{service.duration} min</span></div><ul>{(service.features || []).map(feature => <li key={feature}><Check size={16}/>{feature}</li>)}</ul><button className="service-card-cta" onClick={() => book(service.id)}>Choose this detail <ArrowRight size={19}/></button></article>)}</div><p className="services-footnote">Prices shown are for a standard vehicle. Larger vehicles and additional work may change your estimate.</p></div></section>
      <section id="how-it-works" className="how-section section-pad"><div className="page-width how-grid"><div><span className="eyebrow"><span/> YOUR DAY, UNINTERRUPTED</span><h2>Goodbye, car wash line.<br/>Hello, free time.</h2><p className="how-intro">Three small steps.<br/>One very good-looking car.</p><a href="#book" className="text-link">Let’s make it happen <ArrowRight size={18}/></a></div><div className="how-steps">{[{ title: 'Pick your perfect detail.', text: 'Choose the service and vehicle size that fit your ride.', icon: Sparkles }, { title: 'Tell us where and when.', text: 'Share your NYC location and request a time that works for you.', icon: CalendarDays }, { title: 'Carry on with your day.', text: 'Once your appointment is confirmed, we come to you and handle the details.', icon: Droplets }].map((item, index) => <div className="how-step" key={item.title}><span className="how-step-icon"><item.icon size={23}/></span><div><span className="how-step-number">0{index + 1}</span><h3>{item.title}</h3><p>{item.text}</p></div></div>)}</div></div></section>
      <section id="coverage" className="coverage-section"><div className="page-width coverage-grid"><div className="coverage-graphic" aria-hidden="true"><span className="map-label label-one">MANHATTAN</span><span className="map-label label-two">QUEENS</span><span className="map-label label-three">BROOKLYN</span><span className="map-label label-four">THE BRONX</span><span className="map-label label-five">STATEN ISLAND</span><div className="map-grid"/><div className="map-river river-one"/><div className="map-river river-two"/><div className="map-pin"><MapPin size={32}/></div><div className="map-road road-one"/><div className="map-road road-two"/></div><div className="coverage-copy"><span className="eyebrow"><span/> NEW YORK, WE’RE COMING TO YOU</span><h2>Big city.<br/>Personal service.</h2><p>Home in Brooklyn. Office in Manhattan. Your car deserves a little care wherever the day takes you.</p><div className="boroughs">{['Manhattan', 'Brooklyn', 'Queens', 'The Bronx', 'Staten Island'].map(borough => <span key={borough}>{borough}</span>)}</div><p className="coverage-small">Enter your ZIP code when booking to check our current service area. Suitable workspace and access are confirmed before your appointment.</p><button className="text-link" onClick={() => book()}>Check your location <ArrowRight size={18}/></button></div></div></section>
      <Booking catalog={catalog} form={form} setForm={setForm} step={step} setStep={setStep} loadingCatalog={loading} catalogError={error}/>
      <section className="faq-section section-pad"><div className="page-width faq-grid"><div><span className="eyebrow"><span/> THE FINER DETAILS</span><h2>A few good<br/>questions.</h2></div><div className="faq-list">{[{ q: 'Do I need to be home for the detail?', a: 'We’ll need access to the vehicle and an agreed place to work. Include any access instructions with your request so we can arrange the details before confirming.' }, { q: 'Can you detail a car parked on the street?', a: 'Street locations need an access review. A driveway, private lot, or garage with permission is preferable. We’ll confirm whether your location is suitable before accepting the appointment.' }, { q: 'Is my appointment confirmed as soon as I book?', a: 'Your booking starts as a request. We review the time, location, and workspace, then confirm the appointment. Your request receipt includes a booking reference.' }, { q: 'What happens if the weather changes?', a: 'If weather makes the work impractical, the team can reschedule your appointment. Covered locations may offer more flexibility, subject to garage permission and access.' }, { q: 'Do I need to supply water or power?', a: 'Tell us about any access restrictions in your booking notes. We’ll agree on water, power, and workspace requirements with you before confirming your detail.' }].map(item => <details key={item.q}><summary>{item.q}<ChevronDown size={19}/></summary><p>{item.a}</p></details>)}</div></div></section>
    </main>
    <footer className="site-footer"><div className="page-width footer-top"><a href="#" className="wordmark"><Droplets size={27}/>CWASH<span className="wordmark-dot">.</span></a><p>A little care goes a long way.<br/>Mobile car detailing, made for NYC.</p><a href="#book">Let’s get your car looking good. <ArrowRight size={18}/></a></div><div className="page-width footer-bottom"><span>© {new Date().getFullYear()} CWASH. All rights reserved.</span><span>New York City, NY</span><a href="/admin">Team login <ArrowRight size={13}/></a></div></footer>
  </div>;
}
