import { expect, it } from 'vitest';
import { invalidRedirectPage } from '@/lib/loginwall/error-page';
it.each([
  ['/pl/loginwall/protect', 'Nieprawidłowy adres powrotu', 'pl'],
  ['/en/loginwall/gate', 'Invalid return address', 'en'],
])('renders a localized navigation error for %s', async (path, title, locale) => {
  const response = invalidRedirectPage(path);
  expect(response.status).toBe(400);
  expect(response.headers.get('content-type')).toContain('text/html');
  const html = await response.text();
  expect(html).toContain(`<html lang="${locale}">`);
  expect(html).toContain(title);
  expect(html).toContain('<p>');
});
