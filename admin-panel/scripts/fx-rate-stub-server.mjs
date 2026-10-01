#!/usr/bin/env node
/**
 * Deterministic exchange-rate stub server for the E2E suite.
 *
 * The `ECBProvider` in src/lib/services/currencyService.ts talks to
 * https://api.frankfurter.dev/v1 by default. Playwright's E2E dev server
 * (see playwright.config.ts) points `CURRENCY_ECB_BASE_URL` at this stub
 * instead, so currency-conversion tests never depend on a third-party
 * service being reachable, fast, or returning stable rates.
 *
 * Responses mirror Frankfurter's real shape (`{ amount, base, date, rates }`)
 * so `ECBProvider.fetchRates` exercises its normal fetch + JSON-parsing path
 * unchanged — only the transport target differs.
 *
 * Not imported by any production code path; started only by
 * playwright.config.ts's `webServer` list during test runs.
 */
import http from 'node:http';

const PORT = Number(process.env.FX_STUB_PORT) || 3779;

// Fixed rates relative to each base currency. Numbers are arbitrary but
// internally consistent (each currency's own rate is 1.0); they exist only so
// conversion math has *something* deterministic to operate on, not to reflect
// real-world FX rates.
const FIXED_RATES = {
  USD: { USD: 1.0, EUR: 0.9, GBP: 0.8, PLN: 4.0, JPY: 150.0, CAD: 1.35, AUD: 1.5 },
  EUR: { EUR: 1.0, USD: 1.1111, GBP: 0.8889, PLN: 4.4444, JPY: 166.6667, CAD: 1.5, AUD: 1.6667 },
  GBP: { GBP: 1.0, USD: 1.25, EUR: 1.125, PLN: 5.0, JPY: 187.5, CAD: 1.6875, AUD: 1.875 },
  PLN: { PLN: 1.0, USD: 0.25, EUR: 0.225, GBP: 0.2, JPY: 37.5, CAD: 0.3375, AUD: 0.375 },
  JPY: { JPY: 1.0, USD: 0.0067, EUR: 0.006, GBP: 0.0053, PLN: 0.0267, CAD: 0.009, AUD: 0.01 },
  CAD: { CAD: 1.0, USD: 0.7407, EUR: 0.6667, GBP: 0.5926, PLN: 2.9630, JPY: 111.1111, AUD: 1.1111 },
  AUD: { AUD: 1.0, USD: 0.6667, EUR: 0.6, GBP: 0.5333, PLN: 2.6667, JPY: 100.0, CAD: 0.9 },
};

let requestCount = 0;
const seenPaths = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (url.pathname === '/__stats') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ requestCount, seenPaths }));
    return;
  }

  if (url.pathname === '/v1/latest') {
    requestCount += 1;
    seenPaths.push(url.pathname + url.search);
    const base = (url.searchParams.get('from') || 'USD').toUpperCase();
    const rates = FIXED_RATES[base];

    console.log(`[fx-stub] GET ${url.pathname}${url.search} -> base=${base} (request #${requestCount})`);

    if (!rates) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `fx-stub: no fixed rates for base "${base}"` }));
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      amount: 1,
      base,
      date: '2026-01-01',
      rates,
    }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: `fx-stub: unknown path ${url.pathname}` }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[fx-stub] listening on http://127.0.0.1:${PORT} (serving /v1/latest with fixed rates)`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
