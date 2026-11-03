import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { createTestAdmin, loginAsAdmin, supabaseAdmin } from './admin-auth';

type Steps = Record<string, { title: string; body: string; bodyAct?: string }>;
type Texts = Record<string, { name: string; steps: Steps }> & { mustAct: string };
const texts = JSON.parse(readFileSync(path.resolve(__dirname, '../../src/messages/pl.json'), 'utf8')).tutorials as Texts;
const BASE = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${process.env.PW_PORT || 3777}`;

export const stepText = (tutorial: string, key: string) => texts[tutorial].steps[key];
export const mustAct = texts.mustAct;
export const menuName = (tutorial: string) => texts[tutorial].name;
export const popover = (page: Page): Locator => page.locator('.driver-popover.sellf-tour');
export const popoverTitle = (page: Page): Locator => popover(page).locator('.driver-popover-title');

/** A fresh administrator who has seen no tutorial; `autostart` opts the test server in to first-visit tutorials. */
export async function tutorialAdmin(page: Page, prefix: string, autostart = true) {
  const admin = await createTestAdmin(prefix);
  if (autostart) await page.context().addCookies([{ name: 'sellf_tutorial_autostart', value: 'on', url: BASE }]);
  await loginAsAdmin(page, admin.email, admin.password);
  const { data } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  const userId = data.users.find(user => user.email === admin.email)!.id;
  return { ...admin, userId };
}

export async function seenTutorials(userId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin.from('tutorial_progress').select('tutorial_id').eq('user_id', userId);
  if (error) throw error;
  return (data ?? []).map(row => row.tutorial_id).sort();
}

/** Clicks Next through the given steps in order; the highlighted element of every step except the first must be on screen. */
export async function walk(page: Page, tutorial: string, keys: string[]): Promise<void> {
  for (const [index, key] of keys.entries()) {
    await expect(popoverTitle(page)).toHaveText(stepText(tutorial, key).title);
    await expect(popover(page).locator('.driver-popover-description')).toHaveText(stepText(tutorial, key).body);
    if (index > 0) await expect(page.locator('.driver-active-element').first()).toBeInViewport();
    await popover(page).locator('.driver-popover-next-btn').click();
  }
  await expect(popover(page)).toHaveCount(0);
}
