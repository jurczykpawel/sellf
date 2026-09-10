/**
 * SECURITY TEST: check_application_rate_limit window alignment
 *
 * Windows longer than 60 minutes must not collapse to a fixed 1-hour bucket.
 *
 * REQUIRES: Supabase running locally (npx supabase start)
 *
 * @see supabase/migrations/20260910000000_auth_hardening.sql
 */

import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

describe('check_application_rate_limit — window alignment', () => {
  it('stores a midnight-aligned window_start for a 1440-minute (daily) window and blocks the 6th call', async () => {
    const identifier = `probe-${Date.now()}-${Math.random()}`;

    for (let i = 0; i < 5; i++) {
      const { data, error } = await supabaseAdmin.rpc('check_application_rate_limit', {
        identifier_param: identifier,
        action_type_param: 'window_probe_daily',
        max_requests: 5,
        window_minutes: 1440,
      });
      expect(error).toBeNull();
      expect(data).toBe(true);
    }

    const { data: blocked, error: blockedError } = await supabaseAdmin.rpc(
      'check_application_rate_limit',
      {
        identifier_param: identifier,
        action_type_param: 'window_probe_daily',
        max_requests: 5,
        window_minutes: 1440,
      },
    );
    expect(blockedError).toBeNull();
    expect(blocked).toBe(false);

    const { data: rows, error: rowsError } = await supabaseAdmin
      .from('application_rate_limits')
      .select('window_start')
      .eq('identifier', identifier)
      .eq('action_type', 'window_probe_daily');
    expect(rowsError).toBeNull();
    expect(rows).toHaveLength(1);

    const windowStartMs = new Date(rows![0].window_start).getTime();
    const dayMs = 1440 * 60 * 1000;
    expect(windowStartMs % dayMs).toBe(0);
  });

  it('keeps a short window (15 minutes) working as before', async () => {
    const identifier = `probe-short-${Date.now()}-${Math.random()}`;

    for (let i = 0; i < 5; i++) {
      const { data, error } = await supabaseAdmin.rpc('check_application_rate_limit', {
        identifier_param: identifier,
        action_type_param: 'window_probe_short',
        max_requests: 5,
        window_minutes: 15,
      });
      expect(error).toBeNull();
      expect(data).toBe(true);
    }

    const { data: blocked, error: blockedError } = await supabaseAdmin.rpc(
      'check_application_rate_limit',
      {
        identifier_param: identifier,
        action_type_param: 'window_probe_short',
        max_requests: 5,
        window_minutes: 15,
      },
    );
    expect(blockedError).toBeNull();
    expect(blocked).toBe(false);
  });
});
