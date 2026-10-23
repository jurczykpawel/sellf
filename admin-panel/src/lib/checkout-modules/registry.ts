/** Validation registry; UI forms may be attached by the checkout renderer. @see ./profile.ts */
import { z } from 'zod';
import * as buyer from '@/lib/checkout-modules/buyer';
import * as recipient from '@/lib/checkout-modules/recipient';
import * as phone from '@/lib/checkout-modules/phone';
import * as quantity from '@/lib/checkout-modules/quantity';
import * as participants from '@/lib/checkout-modules/participants';
import type { ComponentType } from 'react';
import type { CheckoutProfile } from '@/lib/checkout-modules/profile';
import type { Json } from '@/types/database';
export interface CheckoutCtx { locale: string; quantity: number; buyerType?: 'person' | 'organization'; currency: string }
export interface FieldError { field: string; code: string }
export interface CheckoutModule<C, V> {
  id: string; version: number; entitlement: 'free' | 'pro'; configSchema: z.ZodType<C>;
  valueSchema(config: C, ctx: CheckoutCtx): z.ZodType<V>;
  Form?: ComponentType<{ config: C; value: V; errors: FieldError[]; onChange(value: V): void; ctx: CheckoutCtx }>;
  toOrder(value: V): Record<string, Json>;
  toInvoice?(value: V): Record<string, Json>;
}
function define<C, V>(id: string, module: Omit<CheckoutModule<C, V>, 'id' | 'version' | 'entitlement'>): CheckoutModule<C, V> {
  return { id, version: 1, entitlement: 'free', ...module };
}
export const checkoutModules = { buyer: define('buyer', buyer), recipient: define('recipient', recipient), phone: define('phone', phone), quantity: define('quantity', quantity), participants: define('participants', participants) };
function parseModule<C, V>(module: CheckoutModule<C, V>, config: unknown, value: unknown, ctx: CheckoutCtx) {
  const result = module.valueSchema(module.configSchema.parse(config), ctx).safeParse(value);
  return result.success ? { success: true as const, details: module.toOrder(result.data) } : { success: false as const, errors: result.error.issues.map(i => ({ field: [module.id, ...i.path].join('.'), code: i.code === 'custom' || ['invalid_nip', 'invalid_text', 'required'].includes(i.message) ? i.message : i.code })) };
}
export function validateModuleValues(profile: CheckoutProfile, input: unknown, ctx: CheckoutCtx) {
  const values = z.record(z.string(), z.unknown()).safeParse(input);
  const errors: FieldError[] = [];
  const details: Record<string, Json> = {};
  if (!values.success) return { success: false as const, errors: [{ field: 'moduleValues', code: 'required' }] };
  for (const key of Object.keys(values.data)) if (!profile.modules.some(m => m.id === key)) errors.push({ field: key, code: 'unknown_module' });
  const type = z.object({ type: z.enum(['person', 'organization']) }).safeParse(values.data.buyer);
  const context = { ...ctx, buyerType: type.success ? type.data.type : undefined };
  for (const config of profile.modules) {
    // Dispatch narrows each module's distinct configuration and value contract.
    const run = <C, V>(module: CheckoutModule<C, V>) => parseModule(module, config, values.data[config.id], context);
    const result = config.id === 'buyer' ? run(checkoutModules.buyer) : config.id === 'recipient' ? run(checkoutModules.recipient) : config.id === 'phone' ? run(checkoutModules.phone) : config.id === 'quantity' ? run(checkoutModules.quantity) : run(checkoutModules.participants);
    if (result.success) Object.assign(details, result.details); else errors.push(...result.errors);
  }
  return errors.length ? { success: false as const, errors } : { success: true as const, details };
}
