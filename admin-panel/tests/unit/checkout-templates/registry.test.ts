import { describe, it, expect } from 'vitest';
import {
  CHECKOUT_TEMPLATE_SLUGS,
  type CheckoutTemplateSlug,
} from '@/lib/checkout-templates/types';
import { getTemplate, getAllTemplates } from '@/lib/checkout-templates/registry';

// Registry contract:
//  - CHECKOUT_TEMPLATE_SLUGS is the canonical list mirrored in DB CHECK +
//    zod schemas + admin UI dropdown. Adding a template = update this list +
//    the migration's CHECK constraint together.
//  - getTemplate(slug) always returns a usable template — unknown / null /
//    empty / typo all fall back to 'default'. We deliberately do NOT throw,
//    because a bad value in the DB should not 500 the buyer's checkout page.
//  - getAllTemplates() returns the registry in admin-display order (default
//    first so it stays the obvious choice).

describe('checkout templates registry', () => {
  it('exposes default and tip-jar slugs', () => {
    expect(CHECKOUT_TEMPLATE_SLUGS).toContain('default');
    expect(CHECKOUT_TEMPLATE_SLUGS).toContain('tip-jar');
  });

  it("getTemplate returns the matching entry for a known slug", () => {
    const tipJar = getTemplate('tip-jar');
    expect(tipJar.slug).toBe('tip-jar');
    expect(typeof tipJar.Component).toBe('function');
    expect(tipJar.displayName.length).toBeGreaterThan(0);
  });

  it("getTemplate falls back to 'default' for unknown / falsy slugs", () => {
    const garbage = getTemplate('not-a-real-template' as CheckoutTemplateSlug);
    expect(garbage.slug).toBe('default');
    const empty = getTemplate('' as CheckoutTemplateSlug);
    expect(empty.slug).toBe('default');
    const nullish = getTemplate(null as unknown as CheckoutTemplateSlug);
    expect(nullish.slug).toBe('default');
  });

  it('lists templates with default first', () => {
    const all = getAllTemplates();
    expect(all.length).toBe(CHECKOUT_TEMPLATE_SLUGS.length);
    expect(all[0].slug).toBe('default');
    for (const tpl of all) {
      expect(typeof tpl.Component).toBe('function');
      expect(typeof tpl.displayName).toBe('string');
      expect(typeof tpl.descriptionKey).toBe('string');
    }
  });
});
