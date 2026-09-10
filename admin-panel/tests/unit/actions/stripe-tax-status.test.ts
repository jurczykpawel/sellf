import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settingsRetrieve: vi.fn(),
  registrationsList: vi.fn(),
}));

vi.mock('@/lib/stripe/server', () => ({
  getStripeServer: vi.fn(async () => ({
    tax: {
      settings: { retrieve: mocks.settingsRetrieve },
      registrations: { list: mocks.registrationsList },
    },
  })),
}));

import { getStripeTaxStatus } from '@/lib/actions/stripe-tax';

function taxSettings(status: string) {
  return { status, status_details: {}, head_office: null };
}

describe('getStripeTaxStatus — status normalisation', () => {
  beforeEach(() => {
    mocks.registrationsList.mockResolvedValue({ data: [] });
  });

  it('keeps active when Stripe reports active', async () => {
    mocks.settingsRetrieve.mockResolvedValue(taxSettings('active'));
    const result = await getStripeTaxStatus();
    expect(result.data?.status).toBe('active');
  });

  it('keeps pending when Stripe reports pending', async () => {
    mocks.settingsRetrieve.mockResolvedValue(taxSettings('pending'));
    const result = await getStripeTaxStatus();
    expect(result.data?.status).toBe('pending');
  });

  it('never reports an unknown future Stripe status as active', async () => {
    mocks.settingsRetrieve.mockResolvedValue(taxSettings('suspended_new_value'));
    const result = await getStripeTaxStatus();
    expect(result.data?.status).toBe('pending');
  });
});
