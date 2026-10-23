/** Server-side documented Fakturownia fixture for browser acceptance only. */
import { readFileSync } from 'node:fs';
const original = globalThis.fetch;
const issued = JSON.parse(readFileSync(new URL('../fixtures/invoicing/issued.json', import.meta.url), 'utf8'));
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? input);
  if (url.hostname !== 'fixture.fakturownia.pl') return original(input, options);
  if (url.pathname === '/invoices.json' && (!options?.method || options.method === 'GET')) return Response.json([]);
  if (url.pathname === '/invoices.json' && options?.method === 'POST') return Response.json(issued);
  throw new Error('Unexpected invoice fixture request');
};
