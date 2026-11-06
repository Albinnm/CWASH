import { useCallback, useEffect, useState } from 'react';

const label = value => String(value || 'unknown').replaceAll('_', ' ');
const amount = (cents, currency = 'usd') => new Intl.NumberFormat('en-US', {style:'currency',currency:currency.toUpperCase()}).format(cents / 100);

export default function AdminBilling({request}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{setData(await request('/api/admin/billing'));}catch(e){setError(e.message);}finally{setLoading(false);}
  },[request]);
  useEffect(()=>{void load();},[load]);
  const matches = item => `${item.customerEmail || ''} ${item.reference || ''} ${item.status || ''}`.toLowerCase().includes(search.trim().toLowerCase());
  return <div className="ad-billing">
    <section className="ad-panel"><div className="ad-panel-heading"><div><div className="ad-eyebrow">PAYMENTS & MEMBERSHIPS</div><h2>Know where every payment stands.</h2></div><button className="ad-secondary" disabled={loading} onClick={load}>{loading?'Refreshing…':'Refresh billing'}</button></div>
      <div className="ad-settings-content">
        {error&&<p className="ad-alert" role="alert">{error}</p>}
        {loading&&!data&&<p role="status">Loading billing…</p>}
        {data&&!data.enabled&&<p>Online payments are not enabled. Follow the Stripe setup guide in the project documentation to connect your account.</p>}
        {data?.enabled&&<p>{data.mode==='test'?'Test mode — these transactions do not move real money.':'Live payments are enabled.'}</p>}
        <p>Payment and appointment statuses are separate. Confirm a reservation before requesting payment. Membership-covered visits do not need an extra payment.</p>
        <p>Manage refunds and subscription changes in your <a href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer">Stripe Dashboard</a>. Cancelling a reservation does not issue a refund. Refresh here after Stripe sends the update.</p>
        <label className="ad-search"><span className="ad-sr-only">Search billing records</span><input placeholder="Search email, reference, or status" value={search} onChange={e=>setSearch(e.target.value)}/></label>
      </div>
    </section>
    {data&&<><section className="ad-panel"><div className="ad-panel-heading"><h2>Booking payments</h2></div><div className="ad-table-scroll"><table className="ad-table"><thead><tr><th>Reference</th><th>Customer</th><th>Amount</th><th>Payment status</th></tr></thead><tbody>{data.payments.filter(matches).map((p,i)=><tr key={`${p.reference}-${i}`}><td>{p.reference}</td><td>{p.customerEmail}</td><td>{amount(p.amount,p.currency)}</td><td>{label(p.status)}</td></tr>)}</tbody></table></div>{!data.payments.filter(matches).length&&<p className="ad-settings-content">No matching payments.</p>}</section>
      <section className="ad-panel"><div className="ad-panel-heading"><h2>Memberships</h2></div><div className="ad-table-scroll"><table className="ad-table"><thead><tr><th>Customer</th><th>Status</th><th>Current period ends</th><th>Renewal</th></tr></thead><tbody>{data.memberships.filter(matches).map((m,i)=><tr key={`${m.customerEmail}-${i}`}><td>{m.customerEmail}</td><td>{label(m.status)}</td><td>{m.currentPeriodEnd?new Date(m.currentPeriodEnd*1000).toLocaleDateString('en-US',{timeZone:'America/New_York'}):'—'}</td><td>{m.cancelAtPeriodEnd?'Cancellation scheduled':['canceled','incomplete_expired'].includes(m.status)?'Ended':'See Stripe billing details'}</td></tr>)}</tbody></table></div>{!data.memberships.filter(matches).length&&<p className="ad-settings-content">No matching memberships.</p>}</section></>}
  </div>;
}
