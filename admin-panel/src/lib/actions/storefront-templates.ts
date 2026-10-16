'use server';

/** Admin session entrypoint; Next Server Actions supply origin protection. @see storefront-templates/lifecycle.ts */
import { storefrontLifecycle } from '@/lib/storefront-templates/lifecycle';
import { verifyTemplateSession } from '@/lib/storefront-templates/mutations';
import type { LifecycleResult } from '@/lib/storefront-templates/lifecycle';

export async function storefrontTemplateAction(input: unknown): Promise<LifecycleResult> {
  return storefrontLifecycle(await verifyTemplateSession(), input);
}
