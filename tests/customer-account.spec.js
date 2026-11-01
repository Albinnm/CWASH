import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const password = 'Browser-customer-original-42!';
const newPassword = 'Browser-customer-updated-84!';
const email = 'account-browser@example.test';

async function register(page, accountEmail, firstName) {
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByLabel('First name', { exact: true }).fill(firstName);
  await page.getByLabel('Last name', { exact: true }).fill('Customer');
  await page.getByLabel('Email address', { exact: true }).fill(accountEmail);
  await page.getByLabel('Phone number (optional)', { exact: true }).fill('2125550100');
  await page.getByLabel(/^Password/).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create my account', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Good to see you, ${firstName}.`, exact: true })).toBeVisible();
}

async function login(page, accountPassword) {
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(accountPassword);
  await page.getByRole('button', { name: 'Sign in to my account', exact: true }).click();
}

async function nextAvailable(request) {
  for (let offset = 3; offset < 12; offset++) {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offset * 86400000));
    const response = await request.get(`/api/availability?date=${date}&serviceId=full&vehicleId=sedan`);
    expect(response.ok()).toBe(true);
    const { slots } = await response.json();
    if (slots.length) return { date, time: slots[0] };
  }
  throw new Error('Expected an available appointment for the account browser test.');
}

test('customers register, book, return to their account, update security, and keep accounts separate', async ({ page, context }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/account');
  await register(page, email, 'Account');
  await expect(page.getByText('You haven’t booked a detail with this account yet.', { exact: true })).toBeVisible();

  const slot = await nextAvailable(context.request);
  await page.getByRole('link', { name: 'Book a detail', exact: true }).click();
  await expect(page.getByRole('link', { name: 'My account', exact: true })).toBeVisible();
  await page.locator('input[name="serviceId"][value="full"]').check();
  await page.locator('input[name="vehicleId"][value="sedan"]').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('NYC ZIP code', { exact: true }).fill('11201');
  await page.getByLabel('Street address', { exact: true }).fill('123 Account Avenue');
  await page.getByLabel('Where will your car be parked?').selectOption('driveway');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Preferred date').fill(slot.date);
  await page.locator(`input[name="time"][value="${slot.time}"]`).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue('Account');
  await expect(page.getByLabel('Last name', { exact: true })).toHaveValue('Customer');
  await expect(page.getByLabel('Phone number', { exact: true })).toHaveValue('2125550100');
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue(email);
  await expect(page.getByLabel('Email address', { exact: true })).toHaveAttribute('readonly', '');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Request appointment', exact: true }).click();
  await expect(page.getByText('awaiting confirmation', { exact: true })).toBeVisible();
  const reference = await page.locator('.confirmation-reference strong').innerText();
  expect(reference).toMatch(/^CW-/);
  await expect(page.getByRole('link', { name: 'View my bookings', exact: true })).toBeVisible();

  // Keep the receipt open in a second tab to check that sign-out removes personal data there too.
  const accountPage = await context.newPage();
  accountPage.on('pageerror', error => errors.push(error.message));
  await accountPage.goto('/account');
  await expect(accountPage.getByText(reference, { exact: true })).toBeVisible();
  await expect(accountPage.getByText('123 Account Avenue')).toBeVisible();
  mkdirSync('test-results/screenshots', { recursive: true });
  await accountPage.screenshot({ path: 'test-results/screenshots/account-desktop.png', fullPage: true });
  await accountPage.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(accountPage.getByRole('button', { name: 'Sign in to my account', exact: true })).toBeVisible();
  await expect(page.locator('.confirmation-reference')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();

  await login(accountPage, password);
  await expect(accountPage.getByText(reference, { exact: true })).toBeVisible();
  await accountPage.getByRole('button', { name: 'Profile & security', exact: true }).click();
  await accountPage.getByLabel('First name', { exact: true }).fill('Updated');
  await accountPage.getByLabel('Phone number', { exact: true }).fill('2125550199');
  await accountPage.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(accountPage.getByRole('status')).toContainText('Your profile has been saved.');
  await expect(accountPage.getByRole('heading', { name: 'Good to see you, Updated.', exact: true })).toBeVisible();
  await accountPage.reload();
  await accountPage.getByRole('button', { name: 'Profile & security', exact: true }).click();
  await expect(accountPage.getByLabel('First name', { exact: true })).toHaveValue('Updated');
  await expect(accountPage.getByLabel('Phone number', { exact: true })).toHaveValue('2125550199');
  await accountPage.getByLabel('Current password', { exact: true }).fill(password);
  await accountPage.getByLabel(/^New password/).fill(newPassword);
  await accountPage.getByLabel('Confirm new password', { exact: true }).fill(newPassword);
  await accountPage.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(accountPage.getByRole('status')).toContainText('Your password has been changed.');
  await expect(accountPage.getByRole('button', { name: 'Sign in to my account', exact: true })).toBeVisible();
  await login(accountPage, password);
  await expect(accountPage.getByRole('alert')).toBeVisible();
  await login(accountPage, newPassword);
  await expect(accountPage.getByText(reference, { exact: true })).toBeVisible();
  await accountPage.setViewportSize({ width: 390, height: 844 });
  expect(await accountPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await accountPage.screenshot({ path: 'test-results/screenshots/account-mobile.png', fullPage: true });

  await accountPage.getByRole('button', { name: 'Sign out', exact: true }).click();
  await register(accountPage, 'other-account-browser@example.test', 'Separate');
  await expect(accountPage.getByText('You haven’t booked a detail with this account yet.', { exact: true })).toBeVisible();
  await expect(accountPage.getByText(reference, { exact: true })).toHaveCount(0);
  await expect(accountPage.getByText('123 Account Avenue')).toHaveCount(0);
  expect(await accountPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
