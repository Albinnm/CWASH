import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

async function available(request) {
  for (let offset = 3; offset < 12; offset++) {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offset * 86400000));
    const result = await request.get(`/api/availability?date=${date}&serviceId=full&vehicleId=sedan`);
    const { slots } = await result.json();
    if (slots.length) return { date, time: slots[0] };
  }
  throw new Error('Expected an available appointment.');
}
async function makeBooking(page, request, name) {
  const slot = await available(request);
  await page.goto('/');
  await page.getByRole('button', { name: 'Find your fresh start' }).click();
  await page.locator('input[name="serviceId"][value="full"]').check();
  await page.locator('input[name="vehicleId"][value="sedan"]').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('NYC ZIP code').fill('11201');
  await page.getByLabel('Street address', { exact: true }).fill('123 Test Avenue');
  await page.getByLabel('Where will your car be parked?').selectOption('driveway');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Preferred date').fill(slot.date);
  await page.locator(`input[name="time"][value="${slot.time}"]`).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('First name', { exact: true }).fill(name);
  await page.getByLabel('Last name', { exact: true }).fill('Customer');
  await page.getByLabel('Email address', { exact: true }).fill('customer@example.test');
  await page.getByLabel('Phone number', { exact: true }).fill('2125550100');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Request appointment', exact: true }).click();
  await expect(page.getByText('awaiting confirmation', { exact: true })).toBeVisible();
  const reference = await page.locator('.confirmation-reference strong').innerText();
  expect(reference).toMatch(/^CW-/);
  return reference;
}

test('desktop customer request reaches admin, can be confirmed, and settings persist', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Your car/ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  mkdirSync('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/customer-desktop.png', fullPage: true });
  const reference = await makeBooking(page, request, 'Desktop');
  await page.goto('/admin');
  await page.getByLabel('Email address').fill('browser@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Browser-fixture-only-42!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A fresh start, every day.' })).toBeVisible();
  await page.getByRole('button', { name: `View reservation ${reference}` }).first().click();
  await page.getByRole('button', { name: 'Confirm request', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reservations', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: reference });
  await expect(row.getByText('Confirmed', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/screenshots/admin-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Business settings', exact: true }).click();
  await page.getByLabel('Travel buffer (min)').fill('60');
  await page.getByRole('button', { name: 'Save availability', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('saved');
  await page.reload();
  await page.getByRole('button', { name: 'Business settings', exact: true }).click();
  await expect(page.getByLabel('Travel buffer (min)')).toHaveValue('60');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile booking is usable and layouts stay inside the viewport', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Your car/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/screenshots/customer-mobile.png', fullPage: true });
  await makeBooking(page, request, 'Mobile');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/admin');
  await page.getByLabel('Email address').fill('browser@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Browser-fixture-only-42!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A fresh start, every day.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: /Reservations/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Your reservations.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/screenshots/admin-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
