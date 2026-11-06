import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const user = { id: 'billing-browser', firstName: 'Billing', lastName: 'Customer', email: 'billing@example.test', phone: '2125550100' };
const booking = { id: 'booking-one', reference: 'CW-PAY123', status: 'confirmed', serviceName: 'The full detail', vehicleName: 'Sedan', date: '2026-12-15', time: '09:00', address: '123 Test Street', zip: '11201', total: 199, duration: 180 };
const plan = { name: 'CWASH care membership', description: 'Member service details are confirmed with CWASH.', amount: 14900, currency: 'usd', interval: 'month' };
const enabled = { enabled: true, mode: 'test', plan, membership: null, canManage: true, payments: [] };

async function fixtures(page, billing) {
  await page.route('**/api/customer/session', route => route.fulfill({ json: { authenticated: true, user, csrfToken: 'test-csrf-token' } }));
  await page.route('**/api/customer/bookings', route => route.fulfill({ json: { bookings: [booking, { ...booking, id: 'pending-one', reference: 'CW-PENDING', status: 'pending' }] } }));
  await page.route('**/api/customer/billing', route => route.fulfill({ json: typeof billing === 'function' ? billing() : billing }));
}

test('unconfigured billing is clear and never offers a live purchase', async ({ page }) => {
  await fixtures(page, { enabled: false, mode: null, plan: null, membership: null, canManage: false, payments: [] });
  await page.goto('/account');
  await expect(page.getByRole('button', { name: /Pay now/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Membership & billing', exact: true }).click();
  await expect(page.getByText('Online payments are coming soon.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to membership checkout' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manage billing', exact: true })).toHaveCount(0);
});

test('membership checkout requires renewal consent and uses the authenticated checkout endpoint', async ({ page }) => {
  await fixtures(page, enabled);
  let checkoutCalls = 0;
  await page.route('**/api/customer/membership/checkout', async route => {
    checkoutCalls++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-csrf-token']).toBe('test-csrf-token');
    expect(route.request().postDataJSON()).toEqual({});
    await route.fulfill({ json: { url: 'https://checkout.stripe.com/c/pay/test_membership' } });
  });
  await page.route('https://checkout.stripe.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Stripe checkout test destination</h1>' }));
  await page.goto('/account?billing=returned');
  await expect(page.getByText(/You’re back from Stripe/)).toBeVisible();
  await expect(page.getByText('TEST MODE · No real money is charged.', { exact: true })).toBeVisible();
  await expect(page.getByText('$149.00', { exact: false })).toBeVisible();
  const checkout = page.getByRole('button', { name: 'Continue to membership checkout', exact: true });
  await expect(checkout).toBeDisabled();
  await page.getByRole('checkbox', { name: /I understand this membership renews monthly/ }).check();
  await expect(checkout).toBeEnabled();
  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/billing-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/screenshots/billing-mobile.png', fullPage: true });
  await checkout.click();
  await expect(page).toHaveURL('https://checkout.stripe.com/c/pay/test_membership');
  expect(checkoutCalls).toBe(1);
});

test('checkout return does not mark a booking paid and verified refresh removes the payment button', async ({ page }) => {
  let paid = false;
  await fixtures(page, () => ({ ...enabled, payments: [{ reference: booking.reference, status: paid ? 'paid' : 'pending', amount: 19900, currency: 'usd' }] }));
  await page.goto('/account?billing=returned');
  await expect(page.getByText('Payment awaiting completion', { exact: true })).toBeVisible();
  await expect(page.getByText('Paid', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'My bookings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue payment', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Pay now/ })).toHaveCount(0);
  paid = true;
  await page.getByRole('button', { name: 'Refresh bookings', exact: true }).click();
  await expect(page.getByText('Paid', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue payment', exact: true })).toHaveCount(0);
});

test('booking checkout rejects untrusted redirects and billing portal uses its own safe host', async ({ page }) => {
  await fixtures(page, { ...enabled, membership: { status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: 1800000000 } });
  await page.route('**/api/customer/bookings/CW-PAY123/checkout', route => route.fulfill({ json: { url: 'https://checkout.stripe.com.evil.example/payment' } }));
  await page.route('**/api/customer/billing/portal', route => route.fulfill({ json: { url: 'https://billing.stripe.com/p/session/test_portal' } }));
  await page.route('https://billing.stripe.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Billing portal test destination</h1>' }));
  await page.goto('/account');
  await page.getByRole('button', { name: 'Pay now · $199.00', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The payment link could not be verified.');
  await expect(page).toHaveURL(/\/account$/);
  await page.getByRole('button', { name: 'Retry billing', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Membership & billing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Active', exact: true })).toBeVisible();
  await expect(page.getByText(/Scheduled to end/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to membership checkout', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Manage billing', exact: true }).click();
  await expect(page).toHaveURL('https://billing.stripe.com/p/session/test_portal');
});

test('included maintenance submits explicit coverage and cannot offer another card payment', async ({ page }) => {
  const state = { ...enabled, membership: { status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: 1800000000 }, benefits: { active: true, fullDetailAvailable: false, periodEnd: 1800000000 } };
  await fixtures(page, state);
  await page.route('**/api/catalog', route => route.fulfill({ json: { services: [{ id: 'full', name: 'The full detail', price: 199, duration: 180, features: [] }], membershipService: { id: 'maintenance', name: 'Weekly maintenance', price: 0, duration: 60, features: [] }, vehicles: [{ id: 'sedan', name: 'Sedan', surcharge: 0, durationExtra: 0 }], settings: { preview: true, zipPrefixes: ['112'] } } }));
  await page.route('**/api/availability?**', route => {
    expect(new URL(route.request().url()).searchParams.get('coverage')).toBe('membership');
    expect(route.request().headers()['x-csrf-token']).toBe('test-csrf-token');
    return route.fulfill({ json: { slots: ['09:00'] } });
  });
  let body;
  await page.route('**/api/bookings', route => {
    body = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: { booking: { ...booking, serviceName: 'Weekly maintenance', total: 0, coverage: 'membership' } } });
  });
  await page.goto('/account?billing=returned');
  await page.getByRole('link', { name: 'Book weekly maintenance', exact: true }).click();
  await expect(page.locator('input[name="serviceId"]')).toHaveCount(1);
  await expect(page.locator('input[name="serviceId"][value="maintenance"]')).toBeChecked();
  await page.locator('input[name="vehicleId"][value="sedan"]').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('NYC ZIP code', { exact: true }).fill('11201');
  await page.getByLabel('Street address', { exact: true }).fill('123 Test Street');
  await page.getByLabel('Where will your car be parked?').selectOption('driveway');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.locator('input[name="time"][value="09:00"]').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Request appointment', exact: true }).click();
  await expect(page.getByText('Included in membership', { exact: true })).toBeVisible();
  expect(body).toMatchObject({ coverage: 'membership', serviceId: 'maintenance', vehicleId: 'sedan' });
  await page.unroute('**/api/customer/bookings');
  await page.route('**/api/customer/bookings', route => route.fulfill({ json: { bookings: [{ ...booking, coverage: 'membership', total: 0 }] } }));
  await page.goto('/account');
  await expect(page.getByText('Included in membership', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pay now|Continue payment/ })).toHaveCount(0);
});

test('a changed membership price requires renewed consent', async ({ page }) => {
  let price = plan.amount;
  await fixtures(page, () => ({ ...enabled, plan: { ...plan, amount: price } }));
  await page.goto('/account?billing=returned');
  const consent = page.getByRole('checkbox', { name: /I understand this membership renews monthly/ });
  const checkout = page.getByRole('button', { name: 'Continue to membership checkout', exact: true });
  await consent.check();
  await expect(checkout).toBeEnabled();
  price = 19900;
  await page.getByRole('button', { name: 'Refresh billing', exact: true }).click();
  await expect(page.locator('.ca-membership-price')).toContainText('$199.00');
  await expect(consent).not.toBeChecked();
  await expect(checkout).toBeDisabled();
});

test('signing out while checkout is opening prevents an old-account redirect', async ({ page }) => {
  await fixtures(page, enabled);
  let pendingCheckout;
  await page.route('**/api/customer/bookings/CW-PAY123/checkout', route => { pendingCheckout = route; });
  await page.route('**/api/customer/logout', route => route.fulfill({ json: { ok: true } }));
  await page.goto('/account');
  await page.getByRole('button', { name: 'Pay now · $199.00', exact: true }).click();
  await expect.poll(() => !!pendingCheckout).toBe(true);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in to my account', exact: true })).toBeVisible();
  await pendingCheckout.fulfill({ json: { url: 'https://checkout.stripe.com/c/pay/old_account' } });
  await expect(page.getByRole('button', { name: 'Sign in to my account', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);
});

test('owner billing distinguishes disabled configuration, test payments, and memberships', async ({ page }) => {
  let configured = false;
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated: true, configured: true, admin: { email: 'owner@example.test' }, csrfToken: 'admin-test-csrf' } }));
  await page.route('**/api/admin/bookings', route => route.fulfill({ json: { bookings: [] } }));
  await page.route('**/api/admin/billing', route => route.fulfill({ json: configured ? {
    enabled: true, mode: 'test',
    payments: [{ reference: 'CW-PAID', customerEmail: 'paid@example.test', status: 'paid', amount: 19900, currency: 'usd' }, { reference: 'CW-REFUND', customerEmail: 'refund@example.test', status: 'refunded', amount: 9900, currency: 'usd' }],
    memberships: [{ customerEmail: 'member@example.test', status: 'active', currentPeriodEnd: 1800000000, cancelAtPeriodEnd: true }],
  } : { enabled: false, mode: null, payments: [], memberships: [] } }));
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Payments & memberships', exact: true }).click();
  await expect(page.getByText(/Online payments are not enabled/)).toBeVisible();
  configured = true;
  await page.getByRole('button', { name: 'Refresh billing', exact: true }).click();
  await expect(page.getByText('Test mode — these transactions do not move real money.', { exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /CW-PAID paid@example.test/ })).toContainText('$199.00');
  await expect(page.getByRole('row', { name: /CW-REFUND refund@example.test/ })).toContainText('refunded');
  await expect(page.getByRole('row', { name: /member@example.test/ })).toContainText('Cancellation scheduled');
  await page.getByLabel('Search billing records', { exact: true }).fill('refund');
  await expect(page.getByText('CW-PAID', { exact: true })).toHaveCount(0);
  await expect(page.getByText('CW-REFUND', { exact: true })).toBeVisible();
  await expect(page.getByText('member@example.test', { exact: true })).toHaveCount(0);
  await page.getByLabel('Search billing records', { exact: true }).fill('');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/admin-billing-mobile.png', fullPage: true, animations: 'disabled' });
});
