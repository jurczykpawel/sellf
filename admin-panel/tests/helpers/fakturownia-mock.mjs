/** Server-side documented Fakturownia fixture for browser acceptance only. */
import { appendFileSync, readFileSync } from 'node:fs';
const original = globalThis.fetch;
const issued = JSON.parse(readFileSync(new URL('../fixtures/invoicing/issued.json', import.meta.url), 'utf8'));
const invoices = new Map();
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? input);
  if (url.hostname !== 'fixture.fakturownia.pl') return original(input, options);
  if (url.pathname === '/invoices.json' && (!options?.method || options.method === 'GET')) return Response.json([...invoices.values()].filter(i => i.oid === url.searchParams.get('oid')));
  const invoice = options?.body ? JSON.parse(options.body).invoice : null;
  if (url.pathname === '/invoices.json' && options?.method === 'POST') {
    const result = { ...issued, ...invoice, id: 987 + invoices.size };
    invoices.set(invoice.oid, result);
    if (process.env.INVOICE_FIXTURE_LOG) appendFileSync(process.env.INVOICE_FIXTURE_LOG, JSON.stringify({ action: 'issue', oid: invoice.oid, status: invoice.status, payment_to: invoice.payment_to }) + '\n');
    return Response.json(result);
  }
  if (/^\/invoices\/\d+\.json$/.test(url.pathname) && options?.method === 'PUT') {
    const ref = Number(url.pathname.match(/\d+/)[0]);
    const previous = [...invoices.values()].find(i => i.id === ref);
    if (!previous) return Response.json({}, { status: 404 });
    const result = { ...previous, ...invoice }; invoices.set(previous.oid, result);
    if (process.env.INVOICE_FIXTURE_LOG) appendFileSync(process.env.INVOICE_FIXTURE_LOG, JSON.stringify({ action: 'paid', oid: previous.oid, paid_date: invoice.paid_date }) + '\n');
    return Response.json(result);
  }
  throw new Error('Unexpected invoice fixture request');
};
