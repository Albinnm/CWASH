import { useCallback, useEffect, useRef, useState } from 'react';
import { CreditCard, RefreshCw, ShieldCheck } from 'lucide-react';

const paymentLabels = { pending: 'Payment awaiting completion', paid: 'Paid', refunded: 'Refunded', partially_refunded: 'Partially refunded' };
const membershipLabels = { active: 'Active', trialing: 'Trial', past_due: 'Payment overdue', unpaid: 'Payment required', incomplete: 'Payment incomplete', incomplete_expired: 'Expired', canceled: 'Canceled', paused: 'Paused' };
const money = (amount, currency = 'usd') => new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100);
const renewalDate = seconds => new Date(seconds * 1000).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' });

export function useCustomerBilling(request) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const [busy, setBusy] = useState(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const action = useRef(false);
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    setState(previous => ({ ...previous, loading: true, error: '' }));
    try {
      const data = await request('/api/customer/billing');
      if (alive.current && version === generation.current) setState({ data, loading: false, error: '' });
    } catch (error) {
      if (alive.current && version === generation.current) setState(previous => ({ ...previous, loading: false, error: error.message }));
    }
  }, [request]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive.current = false; generation.current++; window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh]);
  async function open(path, portal = false) {
    if (action.current) return;
    action.current = true; setBusy(true);
    setState(previous => ({ ...previous, error: '' }));
    try {
      const result = await request(path, { method: 'POST', body: '{}' });
      const url = new URL(result.url);
      if (url.protocol !== 'https:' || url.hostname !== (portal ? 'billing.stripe.com' : 'checkout.stripe.com') || url.username || url.password || url.port) throw new Error('The payment link could not be verified. Please try again.');
      if (alive.current) window.location.assign(url.href);
    } catch (error) {
      if (alive.current) setState(previous => ({ ...previous, error: error.message }));
    } finally { action.current = false; if (alive.current) setBusy(false); }
  }
  return { ...state, busy, refresh, open };
}

export function BookingPayment({ booking, billing }) {
  const payment = billing.data?.payments?.find(item => item.reference === booking.reference);
  const included = booking.coverage === 'membership' || booking.membershipIncluded === true;
  const canPay = !included && booking.total > 0 && billing.data?.enabled && booking.status === 'confirmed' && (!payment || payment.status === 'pending');
  if (included) return <div className="ca-booking-payment"><span className="ca-payment-status ca-payment-paid"><ShieldCheck size={15} />Included in membership</span></div>;
  if (!payment && !canPay) return null;
  return <div className="ca-booking-payment">
    {payment && <span className={`ca-payment-status ca-payment-${payment.status}`}><CreditCard size={15} />{paymentLabels[payment.status] || 'Payment status unavailable'}</span>}
    {canPay && <button className="ca-primary" disabled={billing.busy || billing.loading || !!billing.error} onClick={() => billing.open(`/api/customer/bookings/${encodeURIComponent(booking.reference)}/checkout`)}>{billing.busy ? 'Opening checkout…' : payment ? 'Continue payment' : `Pay now · ${money(Math.round(booking.total * 100))}`}</button>}
  </div>;
}

export default function CustomerBilling({ billing }) {
  const [acceptedPlan, setAcceptedPlan] = useState(null);
  const { data, loading, busy } = billing;
  const membership = data?.membership;
  const plan = data?.plan;
  const planIdentity = plan ? JSON.stringify([plan.name, plan.description, plan.amount, plan.currency, plan.interval]) : null;
  const consent = !!planIdentity && acceptedPlan === planIdentity;
  const hasMembership = membership && !['canceled', 'incomplete_expired'].includes(membership.status);
  const returned = new URLSearchParams(window.location.search).get('billing') === 'returned';
  return <>
    <div className="ca-section-heading"><div><span className="ca-eyebrow">CARE THAT FITS YOUR ROUTINE</span><h2>Membership & billing</h2></div><button className="ca-secondary" disabled={loading || busy} onClick={billing.refresh}><RefreshCw size={14} />{loading ? 'Refreshing…' : 'Refresh billing'}</button></div>
    <p className="ca-description">Manage your membership and payments securely with Stripe.</p>
    {returned && <div className="ca-notice" role="status">You’re back from Stripe. Payment and membership changes appear after confirmation. Refresh billing if an update is still pending.</div>}
    {loading && !data && <p role="status">Loading billing details…</p>}
    {data?.mode === 'test' && <div className="ca-billing-test">TEST MODE · No real money is charged.</div>}
    {data && !data.enabled && <div className="ca-empty"><CreditCard size={32} /><h3>Online payments are coming soon.</h3><p>You can still request appointments. Membership checkout will appear here when it is available.</p></div>}
    {membership && <section className="ca-membership-card"><span className="ca-eyebrow">YOUR MEMBERSHIP</span><h3>{membershipLabels[membership.status] || 'Membership update pending'}</h3>{membership.currentPeriodEnd && <p>{membership.cancelAtPeriodEnd ? 'Scheduled to end' : 'Current billing period ends'} {renewalDate(membership.currentPeriodEnd)} · New York time</p>}{membership.cancelAtPeriodEnd && <p>Renewal is canceled. Review your remaining membership access in billing.</p>}<p>Your membership includes one full detail when joining, followed by maintenance visits at least seven days apart. Maintenance visits start at least seven days after your introductory full detail. Included appointments must fit within your current paid period and require CWASH approval. Additional services are booked and paid separately.</p>{data.benefits?.active && <div className="ca-member-booking-links">{data.benefits.fullDetailAvailable ? <a className="ca-primary" href="/?coverage=membership&amp;service=full#book">Book included full detail</a> : data.benefits.maintenanceAvailable !== false ? <a className="ca-primary" href="/?coverage=membership&amp;service=maintenance#book">Book weekly maintenance</a> : null}<a className="ca-secondary" href="/#book">Book an extra service</a></div>}{['past_due', 'unpaid', 'incomplete'].includes(membership.status) && <p>Please review your payment method in billing to resolve this membership payment.</p>}</section>}
    {data?.enabled && plan && !hasMembership && <section className="ca-membership-card"><span className="ca-eyebrow">MONTHLY MEMBERSHIP</span><h3>{plan.name}</h3><p className="ca-membership-price">{money(plan.amount, plan.currency)}<span> / month</span></p>{plan.description && <p className="ca-membership-description">{plan.description}</p>}<p>Renews automatically every month until canceled. Review the full terms and total in Stripe before subscribing.</p><label className="ca-billing-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setAcceptedPlan(event.target.checked ? planIdentity : null)} /><span>I understand this membership renews monthly and can be managed or canceled through billing.</span></label><button className="ca-primary" disabled={!consent || busy || loading || !!billing.error} onClick={() => billing.open('/api/customer/membership/checkout')}>{busy ? 'Opening checkout…' : 'Continue to membership checkout'}</button><p className="ca-fine-print">Appointments are booked separately and remain subject to availability and confirmation.</p></section>}
    {data?.enabled && !plan && !hasMembership && <p className="ca-billing-muted">Membership plans are not available yet. Confirmed appointments can still be paid from My bookings.</p>}
    {data?.canManage && <div className="ca-billing-manage"><button className="ca-secondary" disabled={busy || loading || !data.enabled || !!billing.error} onClick={() => billing.open('/api/customer/billing/portal', true)}><CreditCard size={16} />{busy ? 'Opening billing…' : 'Manage billing'}</button><p>Update payment details, view invoices, and manage or cancel your subscription in Stripe.</p></div>}
    {!!data?.payments?.length && <section className="ca-payment-history"><h3>Appointment payments</h3>{data.payments.map(payment => <div className="ca-payment-row" key={payment.reference}><div><strong>{payment.reference}</strong><span className={`ca-payment-status ca-payment-${payment.status}`}>{paymentLabels[payment.status] || 'Payment status unavailable'}</span></div><strong>{money(payment.amount, payment.currency)}</strong></div>)}</section>}
    <p className="ca-fine-print ca-billing-security"><ShieldCheck size={16} />Card details are handled by Stripe. CWASH shows payment status only after server confirmation. Refunds are reviewed by CWASH.</p>
  </>;
}
