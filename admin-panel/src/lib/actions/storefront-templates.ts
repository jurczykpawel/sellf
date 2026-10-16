'use server';

/** Admin session entrypoint; Next Server Actions supply origin protection. @see storefront-templates/lifecycle.ts */
import { offerLifecycle } from '@/lib/storefront-templates/offer-lifecycle';
import { storefrontLifecycle } from '@/lib/storefront-templates/lifecycle';
import { verifyTemplateSession } from '@/lib/storefront-templates/mutations';
import type { OfferLifecycleResult } from '@/lib/storefront-templates/offer-lifecycle';
import type { LifecycleResult } from '@/lib/storefront-templates/lifecycle';

export async function storefrontTemplateAction(input: unknown): Promise<LifecycleResult> {
  return storefrontLifecycle(await verifyTemplateSession(), input);
}

export async function productOfferAction(input: unknown): Promise<OfferLifecycleResult> {
  return offerLifecycle(await verifyTemplateSession(), input);
}
