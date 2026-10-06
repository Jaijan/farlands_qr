import { test, expect } from '@playwright/test';
test('registration form verifies email before showing a downloadable pass (mocked provider API)', async ({
  page,
}) => {
  await page.route('**/api/registration/status', (route) =>
    route.fulfill({ json: { registration_open: true } }),
  );
  await page.route('**/api/registration/send', (route) => {
    expect(route.request().postDataJSON().phone).toBe('+919876543210');
    return route.fulfill({ json: { challenge_id: 'd0e5b594-0b0c-41d4-bb83-d05510a5ac88' } });
  });
  await page.route('**/api/registration/verify', (route) =>
    route.request().postDataJSON().code === '123456'
      ? route.fulfill({
          json: {
            participant_code: 'FARL-0001',
            name: 'Test Participant',
            team_name: 'Alpha',
            college_name: 'Example College',
            token: 'a'.repeat(43),
          },
        })
      : route.fulfill({ status: 400, json: { error: 'Invalid or expired verification code.' } }),
  );
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Test Participant');
  await page.getByLabel('Phone number').fill('+919876543210');
  await page.getByLabel('Email address').fill('test@example.com');
  await page.getByLabel('Team name').fill('Alpha');
  await page.getByLabel('College name').fill('Example College');
  await page.getByLabel('Alternate contact').fill('+919876543211');
  await page.getByRole('button', { name: 'Send email code' }).click();
  await page.getByLabel('Verification code').fill('000000');
  await page.getByRole('button', { name: 'Verify & create my pass' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Invalid or expired');
  await page.getByLabel('Verification code').fill('123456');
  await page.getByRole('button', { name: 'Verify & create my pass' }).click();
  await expect(page.getByRole('heading', { name: 'Registration successful' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download QR' })).toHaveAttribute(
    'download',
    'FARL-0001.png',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('public navigation and mobile registration', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(11, 16, 21)');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your next adventure');
  await page.getByRole('link', { name: 'Participant registration', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make it official.' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('System setup required');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('protected pages redirect before rendering participant data', async ({ page }) => {
  await page.goto('/admin/dashboard');
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByRole('heading', { name: 'Mission control.' })).toBeVisible();
  await page.goto('/volunteer/scanner');
  await expect(page).toHaveURL(/\/volunteer\/login/);
});
test('unconfigured login and QR routes show explicit errors', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByLabel('Staff email').fill('admin@example.com');
  await page.getByLabel('Password').fill('invalid-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('System setup required');
  await page.goto('/participant/invalid');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('System setup required');
});
test('registration projector produces downloadable QR', async ({ page }) => {
  await page.goto('/registration-screen');
  await expect(page.getByRole('img', { name: 'QR code for Farlands-registration' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download QR' })).toHaveAttribute(
    'download',
    'Farlands-registration.png',
  );
});
