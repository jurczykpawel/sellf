import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GUSAPIClient } from '@/lib/services/gus-api-client';

describe('GUSAPIClient.searchByNIP', () => {
  let client: GUSAPIClient;

  beforeEach(() => {
    client = new GUSAPIClient('deadbeef0123456789ab');
  });

  it('returns null when bir1 throws "Empty response" (NIP not in REGON)', async () => {
    // bir1 throws BirError('Empty response') for unknown NIPs.
    (client as unknown as { bir: { search: () => Promise<unknown> } }).bir = {
      search: () => Promise.reject(new Error('Empty response')),
    };
    await expect(client.searchByNIP('5260250995')).resolves.toBeNull();
  });

  it('returns null when bir1 returns falsy', async () => {
    (client as unknown as { bir: { search: () => Promise<unknown> } }).bir = {
      search: () => Promise.resolve(null),
    };
    await expect(client.searchByNIP('5260250995')).resolves.toBeNull();
  });

  it('maps bir1 response shape to GUSCompanyData', async () => {
    (client as unknown as { bir: { search: () => Promise<unknown> } }).bir = {
      search: () =>
        Promise.resolve({
          Regon: '012100784',
          Nip: '5260250995',
          Nazwa: 'ORANGE POLSKA SPÓŁKA AKCYJNA',
          Ulica: 'Aleje Jerozolimskie',
          NrNieruchomosci: '160',
          NrLokalu: '',
          Miejscowosc: 'Warszawa',
          KodPocztowy: '02-326',
          Wojewodztwo: 'MAZOWIECKIE',
          Powiat: 'Warszawa',
          Gmina: 'Ochota',
          Typ: 'P',
        }),
    };
    const result = await client.searchByNIP('5260250995');
    expect(result).toMatchObject({
      regon: '012100784',
      nip: '5260250995',
      nazwa: 'ORANGE POLSKA SPÓŁKA AKCYJNA',
      miejscowosc: 'Warszawa',
      kodPocztowy: '02-326',
    });
  });

  it('re-throws non-Empty errors so the API layer can map them (auth, network)', async () => {
    (client as unknown as { bir: { search: () => Promise<unknown> } }).bir = {
      search: () => Promise.reject(new Error('Unauthorized')),
    };
    await expect(client.searchByNIP('5260250995')).rejects.toThrow(
      /Unauthorized/,
    );
  });
});
