import express from 'express';
import Stripe from 'stripe';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';

const terminal = new Set(['canceled', 'incomplete_expired']);
const id = value => typeof value === 'string' ? value : value?.id;
const failure = (status, message) => Object.assign(new Error(message), { billingStatus: status });

export function billingSettings(env = process.env) {
  const key = env.STRIPE_SECRET_KEY || '';
  const mode = key.startsWith('sk_test_') ? 'test' : key.startsWith('sk_live_') ? 'live' : null;
  let origin = null;
  try {
    const parsed = new URL(env.CWASH_PUBLIC_ORIGIN);
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search && !parsed.hash) origin = parsed.origin;
    // HTTP is useful only for local test-mode Stripe CLI development.
    if (mode === 'test' && parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname) && !parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search && !parsed.hash) origin = parsed.origin;
  } catch { /* Missing or invalid configuration disables billing. */ }
  const enabled = !!(mode && origin && env.STRIPE_WEBHOOK_SECRET && (mode === 'test' || env.CWASH_ENABLE_LIVE_PAYMENTS === 'true'));
  return { enabled, mode: enabled ? mode : null, key, origin, webhookSecret: env.STRIPE_WEBHOOK_SECRET, priceId: env.STRIPE_MEMBERSHIP_PRICE_ID || null };
}

export function createBilling({ store, env = process.env, client, rateLimits = true }) {
  const config = billingSettings(env);
  const stripe = config.enabled ? client || new Stripe(config.key, { maxNetworkRetries: 2, timeout: 20000 }) : null;
  const db = store.db;
  const mode = config.mode;
  const returnUrl = `${config.origin}/account?billing=returned`;
  // SQLite deployment supports one server instance. Serialize remote money operations
  // without holding a database transaction open across network requests.
  let tail = Promise.resolve();
  function locked(fn) {
    const result = tail.then(fn);
    tail = result.catch(() => {});
    return result;
  }
  function requireEnabled() { if (!stripe) throw failure(503, 'Online payments are not available yet.'); }
  function assertMode(object) { if (object.livemode !== (mode === 'live')) throw failure(409, 'Payment environment does not match this server.'); }
  function emptyBody(req) {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) throw failure(400, 'This action does not accept payment amounts or redirect addresses.');
  }
  function handler(fn) {
    return async (req, res) => {
      try { await locked(() => {
        if (req.customer && !db.prepare('SELECT token FROM customer_sessions WHERE token=? AND expires>?').get(req.customer.session.token,Date.now())) throw failure(401, 'Please sign in to your customer account.');
        return fn(req,res);
      }); }
      catch (error) {
        res.status(error.billingStatus || 502).json({ error: error.billingStatus ? error.message : 'The payment service could not complete this request. Please try again.' });
      }
    };
  }
  function mapping(userId) { return db.prepare('SELECT * FROM billing_customers WHERE user_id=? AND mode=?').get(userId, mode); }
  async function customer(user) {
    const existing = mapping(user.id);
    if (existing) return existing.stripe_customer_id;
    const created = await stripe.customers.create({ email: user.email, name: `${user.firstName} ${user.lastName}`, metadata: { cwash_user_id: user.id } }, { idempotencyKey: `cwash-customer-${mode}-${user.id}` });
    assertMode(created);
    db.prepare('INSERT INTO billing_customers(user_id,mode,stripe_customer_id) VALUES (?,?,?)').run(user.id, mode, created.id);
    return created.id;
  }
  async function plan() {
    if (!stripe || !config.priceId) return null;
    const price = await stripe.prices.retrieve(config.priceId, { expand: ['product'] });
    assertMode(price);
    if (!price.active || price.type !== 'recurring' || price.currency !== 'usd' || !Number.isSafeInteger(price.unit_amount) || price.unit_amount <= 0 || price.recurring?.interval !== 'month' || price.recurring.interval_count !== 1 || price.recurring.usage_type !== 'licensed' || price.billing_scheme !== 'per_unit' || price.transform_quantity || price.product?.deleted || !price.product?.active) throw failure(503, 'The membership plan is not configured for a fixed monthly USD price.');
    return { name: price.product.name, description: 'One full detail when you first join, followed by weekly maintenance while your membership is active. Extra services are charged separately.', amount: price.unit_amount, currency: 'usd', interval: 'month' };
  }
  function getMembership(userId) {
    const rows = db.prepare('SELECT * FROM billing_memberships WHERE user_id=? AND mode=? ORDER BY created DESC,subscription_id DESC').all(userId, mode);
    const row = rows.find(r => !terminal.has(r.status)) || rows[0];
    const entitlement = row && db.prepare('SELECT paid_period_end FROM billing_membership_entitlements WHERE subscription_id=?').get(row.subscription_id);
    return row ? {subscriptionId:row.subscription_id,status:row.status,currentPeriodEnd:row.current_period_end,mode,entitlementPaid:!!(row.current_period_end && entitlement?.paid_period_end >= row.current_period_end)} : null;
  }
  function membershipActive(userId) {const value=getMembership(userId);return !!(value?.status==='active' && value.entitlementPaid && value.currentPeriodEnd > Date.now()/1000);}
  function membership(userId) {
    const rows = db.prepare('SELECT * FROM billing_memberships WHERE user_id=? AND mode=? ORDER BY created DESC,subscription_id DESC').all(userId, mode);
    const row = rows.find(r => !terminal.has(r.status)) || rows[0];
    return row ? { status: row.status, cancelAtPeriodEnd: !!row.cancel_at_period_end, currentPeriodEnd: row.current_period_end } : null;
  }
  function payments(userId) {
    return db.prepare('SELECT b.reference,p.status,p.amount,p.currency FROM billing_payments p JOIN bookings b ON b.id=p.booking_id WHERE p.user_id=? AND p.mode=? ORDER BY b.date DESC,b.time DESC').all(userId, mode);
  }
  function activeAttempt(userId, kind, bookingId) {
    return bookingId
      ? db.prepare("SELECT * FROM billing_checkouts WHERE mode=? AND booking_id=? AND state!='expired' ORDER BY created DESC LIMIT 1").get(mode, bookingId)
      : db.prepare("SELECT * FROM billing_checkouts WHERE mode=? AND user_id=? AND kind=? AND state IN ('creating','open') ORDER BY created DESC LIMIT 1").get(mode, userId, kind);
  }
  async function resolveAttempt(attempt) {
    if (attempt.session_id) return stripe.checkout.sessions.retrieve(attempt.session_id);
    // Stripe idempotency keys expire after at least 24 hours. An ambiguous older
    // attempt must be reconciled manually instead of risking a duplicate charge.
    if (Date.now() - attempt.created > 23 * 3600000) throw failure(409, 'A previous checkout needs review before another can start. Please contact CWASH.');
    const session = await stripe.checkout.sessions.create(JSON.parse(attempt.request_json), { idempotencyKey: attempt.id });
    assertMode(session);
    db.prepare('UPDATE billing_checkouts SET session_id=?,state=? WHERE id=?').run(session.id, session.status, attempt.id);
    return session;
  }
  function safeCheckoutUrl(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'checkout.stripe.com' || parsed.username || parsed.password || parsed.port) throw failure(502, 'Stripe did not return a valid checkout address.');
    return url;
  }
  async function checkout(user, kind, booking) {
    const previous = activeAttempt(user.id, kind, booking?.id);
    if (previous) {
      const session = await resolveAttempt(previous);
      assertMode(session);
      if (session.status === 'open') return { url: safeCheckoutUrl(session.url) };
      db.prepare('UPDATE billing_checkouts SET state=? WHERE id=?').run(session.status, previous.id);
      if (session.status !== 'expired') throw failure(409, 'Your checkout is being processed. Refresh your billing status before trying again.');
    }
    const customerId = await customer(user);
    if (kind === 'membership') {
      await plan();
      // Check Stripe as well as local records: a checkout can finish before its webhook.
      const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
      if (subscriptions.has_more || subscriptions.data.some(s => !terminal.has(s.status))) throw failure(409, 'You already have a membership or a payment awaiting completion. Use Manage billing.');
    }
    const attemptId = randomUUID();
    const metadata = { cwash_attempt_id: attemptId, cwash_user_id: user.id, cwash_kind: kind, ...(booking ? { cwash_booking_id: booking.id } : {}) };
    const request = {
      mode: kind === 'booking' ? 'payment' : 'subscription', customer: customerId, client_reference_id: user.id,
      payment_method_types: ['card'], success_url: returnUrl, cancel_url: returnUrl, metadata,
      line_items: [{ quantity: 1, ...(booking ? { price_data: { currency: 'usd', unit_amount: Math.round(booking.total * 100), product_data: { name: `${booking.serviceName} · ${booking.reference}` } } } : { price: config.priceId }) }],
      ...(booking ? { payment_intent_data: { metadata } } : { subscription_data: { metadata } }),
    };
    db.prepare("INSERT INTO billing_checkouts(id,user_id,mode,kind,booking_id,state,request_json,created) VALUES (?,?,?,?,?,'creating',?,?)").run(attemptId, user.id, mode, kind, booking?.id || null, JSON.stringify(request), Date.now());
    if (booking) db.prepare("INSERT INTO billing_payments(booking_id,user_id,mode,status,amount,currency) VALUES (?,?,?,'pending',?,'usd') ON CONFLICT(booking_id,mode) DO NOTHING").run(booking.id, user.id, mode, Math.round(booking.total * 100));
    const attempt = db.prepare('SELECT * FROM billing_checkouts WHERE id=?').get(attemptId);
    const session = await resolveAttempt(attempt);
    return { url: safeCheckoutUrl(session.url) };
  }
  async function verifiedPaidPeriod(subscription, customerId, priceId, periodEnd) {
    // A Stripe subscription can remain active while its latest invoice is unpaid.
    // Entitlements require the matching recurring line and an actual unrefunded
    // payment for the current period, not just the subscription's status.
    const invoice = subscription.latest_invoice;
    const item = subscription.items.data[0];
    const expected = item.price?.unit_amount;
    if (subscription.status !== 'active' || !invoice || typeof invoice === 'string' || !Number.isSafeInteger(periodEnd) || !Number.isSafeInteger(expected) || expected <= 0) return 0;
    assertMode(invoice);
    const invoiceSubscription = id(invoice.parent?.subscription_details?.subscription) || id(invoice.subscription);
    const lines = invoice.lines?.data || [];
    const line = lines[0];
    if (invoiceSubscription !== subscription.id || id(invoice.customer) !== customerId || invoice.status !== 'paid' || invoice.currency !== 'usd' || invoice.amount_remaining !== 0 || invoice.amount_paid < expected || item.price.currency !== 'usd' || invoice.lines?.has_more || lines.length !== 1 || line.currency !== 'usd' || line.amount !== expected || (id(line.pricing?.price_details?.price) || id(line.price)) !== priceId || line.period?.end !== periodEnd || line.period?.start !== (item.current_period_start ?? subscription.current_period_start)) return 0;
    const invoicePayments = await stripe.invoicePayments.list({invoice:invoice.id,status:'paid',limit:100});
    if (invoicePayments.has_more || !invoicePayments.data.length) return 0;
    let received = 0;
    for (const payment of invoicePayments.data) {
      assertMode(payment);
      if (id(payment.invoice) !== invoice.id || payment.currency !== 'usd' || payment.status !== 'paid' || payment.payment?.type !== 'payment_intent' || !Number.isSafeInteger(payment.amount_paid) || payment.amount_paid <= 0) return 0;
      const intent = await stripe.paymentIntents.retrieve(id(payment.payment.payment_intent), {expand:['latest_charge']});
      assertMode(intent);
      const charge = intent.latest_charge;
      if (intent.status !== 'succeeded' || id(intent.customer) !== customerId || intent.currency !== 'usd' || intent.amount_received < payment.amount_paid || !charge || typeof charge === 'string' || charge.amount_refunded > 0) return 0;
      received += payment.amount_paid;
    }
    return received >= expected ? periodEnd : 0;
  }
  async function syncSubscription(subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] });
    assertMode(subscription);
    const attempt = db.prepare("SELECT * FROM billing_checkouts WHERE id=? AND mode=? AND kind='membership'").get(subscription.metadata?.cwash_attempt_id || '', mode);
    if (!attempt) return;
    const owner = mapping(attempt.user_id);
    const request = JSON.parse(attempt.request_json);
    if (!owner || id(subscription.customer) !== owner.stripe_customer_id || subscription.metadata?.cwash_user_id !== attempt.user_id || subscription.items.data.length !== 1 || id(subscription.items.data[0].price) !== request.line_items[0].price || subscription.items.data[0].quantity !== 1) {
      db.prepare('DELETE FROM billing_membership_entitlements WHERE subscription_id=?').run(subscription.id);
      throw failure(409, 'Subscription association could not be verified.');
    }
    const period = subscription.current_period_end ?? subscription.items.data[0].current_period_end ?? null;
    db.prepare('INSERT INTO billing_memberships(subscription_id,user_id,mode,status,cancel_at_period_end,current_period_end,created) VALUES (?,?,?,?,?,?,?) ON CONFLICT(subscription_id) DO UPDATE SET status=excluded.status,cancel_at_period_end=excluded.cancel_at_period_end,current_period_end=excluded.current_period_end').run(subscription.id, attempt.user_id, mode, subscription.status, subscription.cancel_at_period_end ? 1 : 0, period, subscription.created);
    // Fail closed while rechecking a changed/refunded billing period. A transient
    // Stripe failure must not leave previously granted coverage usable.
    db.prepare('INSERT INTO billing_membership_entitlements(subscription_id,paid_period_end) VALUES (?,0) ON CONFLICT(subscription_id) DO UPDATE SET paid_period_end=0').run(subscription.id);
    const paidPeriod = await verifiedPaidPeriod(subscription, owner.stripe_customer_id, request.line_items[0].price, period);
    db.prepare('INSERT INTO billing_membership_entitlements(subscription_id,paid_period_end) VALUES (?,?) ON CONFLICT(subscription_id) DO UPDATE SET paid_period_end=excluded.paid_period_end').run(subscription.id,paidPeriod);
  }
  async function syncCheckout(sessionId) {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    assertMode(session);
    let attempt = db.prepare('SELECT * FROM billing_checkouts WHERE session_id=? AND mode=?').get(session.id, mode);
    // Recover a Stripe success even if the create response was lost before its
    // session ID could be persisted locally. The durable metadata identifies the
    // original attempt; all ownership checks still run before recording payment.
    if (!attempt) attempt = db.prepare('SELECT * FROM billing_checkouts WHERE id=? AND mode=? AND session_id IS NULL').get(session.metadata?.cwash_attempt_id || '', mode);
    if (!attempt) return;
    const owner = mapping(attempt.user_id);
    const request = JSON.parse(attempt.request_json);
    if (!owner || id(session.customer) !== owner.stripe_customer_id || session.metadata?.cwash_attempt_id !== attempt.id || session.metadata?.cwash_user_id !== attempt.user_id || session.mode !== request.mode) throw failure(409, 'Checkout association could not be verified.');
    if (!attempt.session_id) db.prepare('UPDATE billing_checkouts SET session_id=? WHERE id=?').run(session.id, attempt.id);
    if (attempt.kind === 'membership') {
      if (session.subscription) await syncSubscription(id(session.subscription));
    } else if (session.payment_status === 'paid' && session.status === 'complete') {
      const amount = request.line_items[0].price_data.unit_amount;
      const intent = await stripe.paymentIntents.retrieve(id(session.payment_intent), { expand: ['latest_charge'] });
      assertMode(intent);
      if (session.amount_total !== amount || session.currency !== 'usd' || id(intent.customer) !== owner.stripe_customer_id || intent.status !== 'succeeded' || intent.amount_received !== amount || intent.currency !== 'usd' || intent.metadata?.cwash_attempt_id !== attempt.id || intent.metadata?.cwash_booking_id !== attempt.booking_id) throw failure(409, 'Payment amount or ownership could not be verified.');
      const charge = intent.latest_charge;
      const refunded = charge && typeof charge !== 'string' ? charge.amount_refunded || 0 : 0;
      const status = refunded >= amount ? 'refunded' : refunded > 0 ? 'partially_refunded' : 'paid';
      db.prepare('UPDATE billing_payments SET status=?,payment_intent_id=? WHERE booking_id=? AND mode=? AND user_id=?').run(status, intent.id, attempt.booking_id, mode, attempt.user_id);
    }
    db.prepare('UPDATE billing_checkouts SET state=? WHERE id=?').run(session.status, attempt.id);
  }
  const webhook = async (req, res) => {
    if (!stripe) return res.status(503).json({ error: 'Payments are not configured.' });
    let event;
    try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.webhookSecret); }
    catch { return res.status(400).json({ error: 'Invalid payment signature.' }); }
    if (event.livemode !== (mode === 'live')) return res.status(400).json({ error: 'Payment environment mismatch.' });
    try {
      await locked(async () => {
        if (db.prepare('SELECT id FROM billing_events WHERE id=? AND mode=?').get(event.id, mode)) return;
        const object = event.data.object;
        if (['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'].includes(event.type)) await syncCheckout(object.id);
        else if (event.type.startsWith('customer.subscription.')) await syncSubscription(object.id);
        else if (event.type.startsWith('invoice.')) {
          const subscription = id(object.subscription) || id(object.parent?.subscription_details?.subscription);
          if (subscription) await syncSubscription(subscription);
        } else if (event.type === 'charge.refunded') {
          const intent = await stripe.paymentIntents.retrieve(id(object.payment_intent));
          assertMode(intent);
          const attempt = db.prepare('SELECT * FROM billing_checkouts WHERE id=? AND mode=?').get(intent.metadata?.cwash_attempt_id || '', mode);
          if (attempt?.session_id) await syncCheckout(attempt.session_id);
          else {
            // Subscription PaymentIntents do not inherit checkout metadata.
            // Resolve their invoice payments, then refresh the current subscription.
            const payments = await stripe.invoicePayments.list({payment:{type:'payment_intent',payment_intent:intent.id},limit:100});
            if (payments.has_more) throw failure(409, 'Refund reconciliation requires a complete invoice payment list.');
            for (const payment of payments.data) {
              assertMode(payment);
              const invoice = await stripe.invoices.retrieve(id(payment.invoice));
              assertMode(invoice);
              const subscription = id(invoice.parent?.subscription_details?.subscription) || id(invoice.subscription);
              if (subscription) await syncSubscription(subscription);
            }
          }
        }
        db.prepare('INSERT INTO billing_events(id,mode,processed_at) VALUES (?,?,?)').run(event.id, mode, Date.now());
      });
      res.json({ received: true });
    } catch { res.status(500).json({ error: 'Payment event could not be processed. Please retry.' }); }
  };
  function customerRouter(authorize, benefits = () => ({active:false,fullDetailAvailable:false,maintenanceAvailable:false,periodEnd:null})) {
    const router = express.Router();
    router.use(['/billing', '/billing/portal', '/membership/checkout', '/bookings/:reference/checkout'], authorize);
    const writes = rateLimit({windowMs:15*60000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,skip:()=>!rateLimits,message:{error:'Too many billing attempts. Please try again later.'}});
    router.use(['/billing', '/billing/portal', '/membership/checkout', '/bookings/:reference/checkout'], (req,res,next)=>req.method==='POST'?writes(req,res,next):next());
    router.get('/billing', handler(async (req, res) => {
      const userId = req.customer.user.id;
      let offer=null,planError='';
      try { offer=await plan(); } catch { planError='Membership signup is temporarily unavailable. Existing billing records are still shown.'; }
      res.json({ enabled: config.enabled, mode, plan:offer, planError, membership: membership(userId), canManage: !!mapping(userId), payments: payments(userId), benefits:benefits(userId) });
    }));
    router.post('/bookings/:reference/checkout', handler(async (req, res) => {
      requireEnabled(); emptyBody(req);
      const row = db.prepare('SELECT b.value FROM bookings b JOIN booking_customers c ON b.id=c.booking_id WHERE b.reference=? AND c.user_id=?').get(req.params.reference, req.customer.user.id);
      if (!row) throw failure(404, 'Booking not found.');
      const booking = JSON.parse(row.value);
      if (booking.coverage === 'membership' || booking.membershipIncluded) throw failure(409, 'This visit is included in your membership and does not need a separate payment.');
      if (booking.status !== 'confirmed') throw failure(409, 'Payment is available after CWASH confirms this booking.');
      const paid = db.prepare("SELECT status FROM billing_payments WHERE booking_id=? AND mode=? AND status!='pending'").get(booking.id, mode);
      if (paid) throw failure(409, 'This booking has already been paid.');
      if (!Number.isSafeInteger(Math.round(booking.total * 100)) || booking.total <= 0) throw failure(409, 'This booking does not have a valid payment amount.');
      res.json(await checkout(req.customer.user, 'booking', booking));
    }));
    router.post('/membership/checkout', handler(async (req, res) => {
      requireEnabled(); emptyBody(req);
      if (!config.priceId) throw failure(503, 'A membership plan has not been configured yet.');
      res.json(await checkout(req.customer.user, 'membership'));
    }));
    router.post('/billing/portal', handler(async (req, res) => {
      requireEnabled(); emptyBody(req);
      const owner = mapping(req.customer.user.id);
      if (!owner) throw failure(409, 'There is no billing account to manage yet.');
      const portal = await stripe.billingPortal.sessions.create({ customer: owner.stripe_customer_id, return_url: returnUrl });
      const parsed = new URL(portal.url);
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'billing.stripe.com' || parsed.username || parsed.password || parsed.port) throw failure(502, 'Stripe did not return a valid billing address.');
      res.json({ url: portal.url });
    }));
    return router;
  }
  const adminSummary = handler(async (_req, res) => {
    res.json({ enabled: config.enabled, mode,
      payments: db.prepare('SELECT b.reference,p.status,p.amount,p.currency,c.email AS customerEmail FROM billing_payments p JOIN bookings b ON b.id=p.booking_id JOIN customers c ON c.id=p.user_id WHERE p.mode=? ORDER BY b.date DESC').all(mode),
      memberships: db.prepare('SELECT c.email AS customerEmail,m.status,m.cancel_at_period_end AS cancelAtPeriodEnd,m.current_period_end AS currentPeriodEnd FROM billing_memberships m JOIN customers c ON c.id=m.user_id WHERE m.mode=? ORDER BY m.created DESC').all(mode).map(m => ({ ...m, cancelAtPeriodEnd: !!m.cancelAtPeriodEnd })),
    });
  });
  async function bookingChange(bookingId, cancelling, update) {
    return locked(async () => {
      if (cancelling) {
        const attempts = db.prepare("SELECT * FROM billing_checkouts WHERE booking_id=? AND state IN ('creating','open','complete')").all(bookingId);
        for (const attempt of attempts) {
          const paid = db.prepare("SELECT status FROM billing_payments WHERE booking_id=? AND mode=? AND status!='pending'").get(bookingId, attempt.mode);
          if (paid) continue; // Cancellation never silently refunds a captured payment.
          requireEnabled();
          if (attempt.mode !== mode) throw failure(409, 'Switch to the matching payment environment before cancelling this checkout.');
          let session = await resolveAttempt(attempt);
          if (session.status === 'open') session = await stripe.checkout.sessions.expire(session.id);
          if (session.status !== 'expired') throw failure(409, 'Payment is processing. Refresh billing status before cancelling this appointment.');
          db.prepare("UPDATE billing_checkouts SET state='expired' WHERE id=?").run(attempt.id);
        }
      }
      return update();
    });
  }
  return { webhook, customerRouter, adminSummary, bookingChange, getMembership, membershipActive };
}
