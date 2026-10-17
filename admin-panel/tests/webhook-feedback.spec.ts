import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';

let script: string;
test.beforeAll(() => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sellf-webhook-feedback-'));
  try {
    execFileSync('bun', ['build', 'tests/fixtures/webhook-feedback-browser.tsx', '--target=browser', '--outdir', directory]);
    script = readFileSync(path.join(directory, 'webhook-feedback-browser.js'), 'utf8');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const locale of ['en', 'pl']) {
  test(`${locale}: webhook test status and persisted delivery history are visible`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://webhooks.test/**', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.endsWith('/test')) {
        expect(request.postDataJSON()).toEqual({ event_type: 'purchase.completed' });
        return route.fulfill({ json: { data: { success: true, http_status: 202 } } });
      }
      if (url.pathname.endsWith('/logs')) {
        expect(url.searchParams.get('endpoint_id')).toBe('endpoint');
        expect(url.searchParams.get('status')).toBe('all');
        return route.fulfill({ json: { data: ['test', 'purchase'].map(id => ({ id, event_type: 'purchase.completed', http_status: 200, status: 'success', created_at: '2026-10-17T15:32:00Z', duration_ms: 20 })), pagination: { has_more: false } } });
      }
      return route.fulfill(url.pathname === '/fixture.js'
        ? { contentType: 'application/javascript', body: script }
        : { contentType: 'text/html', body: '<!doctype html><div id="root"></div><script src="/fixture.js"></script>' });
    });
    await page.goto(`https://webhooks.test/?locale=${locale}`);
    await page.getByRole('button', { name: 'Test', exact: true }).click();
    await expect(page.getByText(/HTTP 202/)).toBeVisible();
    await page.getByRole('button', { name: 'Logs', exact: true }).click();
    await expect(page.getByRole('combobox')).toHaveValue('all');
    await expect(page.getByRole('row').filter({ hasText: 'HTTP 200' })).toHaveCount(2);
    expect(errors).toEqual([]);
  });
}
