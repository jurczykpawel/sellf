/**
 * GUS REGON API Client (using bir1 library)
 *
 * Polish GUS (Główny Urząd Statystyczny) provides company data via REGON SOAP API.
 * Uses the bir1 library for reliable SOAP communication.
 *
 * API Documentation: https://api.stat.gov.pl/Home/RegonApi
 * Library: https://github.com/pawel-id/bir1
 */

import BIR from 'bir1';

export interface GUSCompanyData {
  regon: string;
  nip: string;
  nazwa: string;              // Company name
  ulica: string;              // Street
  nrNieruchomosci: string;    // Building number
  nrLokalu: string;           // Apartment number
  miejscowosc: string;        // City
  kodPocztowy: string;        // Postal code
  wojewodztwo: string;        // Province
  powiat?: string;            // County
  gmina?: string;             // Municipality
  typ?: string;               // Entity type (P=legal, F=natural person)
}

const GUS_REQUEST_TIMEOUT_MS = 5_000;

class GusRequestTimeoutError extends Error {
  constructor() {
    super(`GUS request exceeded ${GUS_REQUEST_TIMEOUT_MS}ms`);
    this.name = 'GusRequestTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new GusRequestTimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class GUSAPIClient {
  private bir: any; // BIR client instance
  private isTestMode: boolean;

  constructor(apiKey: string) {
    // Detect test mode (test keys or explicit test mode)
    this.isTestMode = process.env.GUS_API_TEST_MODE === 'true' ||
                      apiKey.toLowerCase().startsWith('abcde') ||
                      !apiKey ||
                      apiKey.trim() === '';

    // Initialize BIR client
    // If no key or test key - use built-in test key (non-production database)
    // If valid production key - use it
    this.bir = new BIR(
      this.isTestMode ? {} : { key: apiKey }
    );
  }

  /**
   * Search for company by NIP
   */
  async searchByNIP(nip: string): Promise<GUSCompanyData | null> {
    try {
      // bir1 has no built-in timeout; race against a deadline so a stalled
      // SOAP endpoint cannot pin a request handler indefinitely.
      const results = await withTimeout(this.bir.search({ nip }), GUS_REQUEST_TIMEOUT_MS);

      if (!results) {
        return null;
      }

      // Check if results is an array or a single object
      const company = Array.isArray(results) ? results[0] : results;

      if (!company) {
        return null;
      }

      // Map bir1 response to our interface
      return {
        regon: company.Regon || '',
        nip: company.Nip || nip,
        nazwa: company.Nazwa || '',
        ulica: company.Ulica || '',
        nrNieruchomosci: company.NrNieruchomosci || '',
        nrLokalu: company.NrLokalu || '',
        miejscowosc: company.Miejscowosc || '',
        kodPocztowy: company.KodPocztowy || '',
        wojewodztwo: company.Wojewodztwo || '',
        powiat: company.Powiat || undefined,
        gmina: company.Gmina || undefined,
        typ: company.Typ || undefined,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      // bir1 throws "Empty response" when the NIP has no record — that's a 404, not 500.
      if (msg === 'Empty response') return null;

      console.error('GUS API error:', error);
      throw new Error(
        error instanceof Error
          ? `GUS API error: ${error.message}`
          : 'Failed to search company in GUS database'
      );
    }
  }
}
