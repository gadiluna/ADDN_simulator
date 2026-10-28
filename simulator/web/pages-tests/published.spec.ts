import { expect, test } from '@playwright/test';

test('the production site loads its engine and completes a run under the Pages prefix', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await expect(page.locator('.engine-status')).toHaveText('Ready');
  for (let round = 1; round <= 10; round++) {
    await page.getByRole('button', { name: 'Advance one round', exact: true }).click();
    await expect(page.getByTestId('round-number')).toHaveText(String(round).padStart(2, '0'));
  }
  await expect(page.locator('.completion-tag')).toHaveText('COMPLETE');
  await page.getByRole('img', { name: 'Directed communication network', exact: true }).press('Enter');
  await expect(page.locator('.output-value')).toHaveText('6');
  await expect(page.getByRole('separator', { name: 'Resize network and agent panels' })).toBeVisible();
  await page.getByText('Mathematical details', { exact: true }).click();
  await expect(page.locator('.math-step[data-status="passed"]')).toHaveCount(5);
  const notices = await page.request.get('licenses/index.html');
  expect(notices.ok()).toBe(true);
  expect(await notices.text()).toContain('GMP');
  expect(errors).toEqual([]);
});
