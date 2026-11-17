/**
 * `shop_config.supabase_buyer_emails` is one row shared by every Playwright worker. Each worker runs a spec's
 * beforeAll/afterAll on its own (fullyParallel), so a plain save-and-restore lets the first worker to finish put
 * the seeded `false` back while another worker still needs `true` (J233 then got "Potwierdź swój email").
 *
 * A cross-process lease fixes that: the setting is saved when the first holder arrives and restored when the last
 * one leaves. Specs that need the setting on hold it `shared`; a spec that flips it itself holds it `exclusive`
 * and waits until nobody else holds it. Holders of a dead process (an interrupted run) are dropped.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { test, expect } from '@playwright/test';
import { supabaseAdmin as db } from './admin-auth';

type LeaseMode = 'shared' | 'exclusive';
interface LeaseState { original: boolean; holders: Array<{ pid: number; id: string; mode: LeaseMode }> }

const STACK = createHash('sha256').update(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'default').digest('hex').slice(0, 12);
const DIR = join(tmpdir(), `sellf-pw-buyer-emails-${STACK}`);
const STATE = join(DIR, 'state.json');
const MUTEX = join(DIR, 'mutex');
const WAIT_MS = 120_000;

const isAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  mkdirSync(DIR, { recursive: true });
  for (;;) {
    try { mkdirSync(MUTEX); break; } catch {
      try { if (Date.now() - statSync(MUTEX).mtimeMs > 30_000) rmSync(MUTEX, { recursive: true, force: true }); } catch { /* gone */ }
      await sleep(25);
    }
  }
  try { return await fn(); } finally { rmSync(MUTEX, { recursive: true, force: true }); }
}

function readState(): LeaseState | null {
  try {
    const state = JSON.parse(readFileSync(STATE, 'utf8')) as LeaseState;
    state.holders = state.holders.filter(holder => isAlive(holder.pid));
    return state;
  } catch { return null; }
}

async function setBuyerEmails(value: boolean): Promise<void> {
  expect((await db.from('shop_config').update({ supabase_buyer_emails: value }).not('id', 'is', null)).error).toBeNull();
}

async function acquire(id: string, mode: LeaseMode): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const granted = await withMutex(async () => {
      let state = readState();
      if (!state || state.holders.length === 0) {
        // Nobody holds it: the current value is the one to put back. An interrupted run's stale state is discarded.
        const saved = await db.from('shop_config').select('supabase_buyer_emails').single();
        expect(saved.error).toBeNull();
        state = { original: saved.data!.supabase_buyer_emails, holders: [] };
      }
      const busy = mode === 'exclusive' ? state.holders.length > 0 : state.holders.some(holder => holder.mode === 'exclusive');
      if (busy) { writeFileSync(STATE, JSON.stringify(state)); return false; }
      state.holders.push({ pid: process.pid, id, mode });
      writeFileSync(STATE, JSON.stringify(state));
      if (mode === 'shared') await setBuyerEmails(true);
      return true;
    });
    if (granted) return;
    if (Date.now() > deadline) throw new Error(`supabase_buyer_emails lease (${mode}) not granted within ${WAIT_MS} ms`);
    await sleep(200);
  }
}

async function release(id: string): Promise<void> {
  await withMutex(async () => {
    const state = readState();
    if (!state) return;
    state.holders = state.holders.filter(holder => holder.id !== id);
    if (state.holders.length > 0) { writeFileSync(STATE, JSON.stringify(state)); return; }
    await setBuyerEmails(state.original);
    rmSync(STATE, { force: true });
  });
}

function registerBuyerEmailLease(mode: LeaseMode): void {
  const id = crypto.randomUUID();
  let held = false;
  test.beforeAll(async () => { test.setTimeout(WAIT_MS + 30_000); await acquire(id, mode); held = true; });
  test.afterAll(async () => { if (held) await release(id); });
}

/** Opt in when a spec verifies the optional Supabase transactional templates (setting on for the whole spec). */
export function useSupabaseBuyerEmails(): void { registerBuyerEmailLease('shared'); }

/** For a spec that switches the setting itself: no other spec holds it meanwhile; the saved value comes back after. */
export function holdBuyerEmailSettingExclusively(): void { registerBuyerEmailLease('exclusive'); }
