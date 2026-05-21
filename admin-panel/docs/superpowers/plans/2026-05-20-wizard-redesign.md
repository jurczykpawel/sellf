# Wizard Redesign Implementation Plan

> **2026-05-21 amendment:** the `installments` UX type was dropped before
> merge — nobody asked for it; the proposal placeholder slipped through.
> All references below (registry, radio, i18n, tests) are historical and
> have been removed from the codebase.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `ProductCreationWizard` per `vault/personal/_db-tasks/sellf-wizard-redesign-proposal.md`: type-radio at top of Step 1, description moved to Step 2, `lib/product-defaults.ts` registry, "⚡ Publikuj" footer w/ checklist, Step 3 reorganized into 6 accordions, conversion badges + dynamic tax helper, all backed by updated tests.

**Architecture:**
1. Extract checkout-template side-effects into pure `lib/product-defaults.ts` registry keyed by **UX product type** (`standard | subscription | installments | tip-jar | lead-magnet`). The registry maps a UX type → mutation patch over `ProductFormData`.
2. Replace `CheckoutTemplateSection` (select dropdown) with `ProductTypeRadio` (5-card segmented control) at the very top of Step 1. Custom-fields editor moves to Step 3 accordion B.
3. `BasicInfoSection` shrinks: description / long_description move to Step 2 (new `DescriptionSection`).
4. `WizardFooter` gets a live-checklist row above the buttons + tooltip on disabled "Publikuj" + relabel.
5. `StepSalesSettings` becomes a 6-accordion layout, reusing existing section components but regrouping them.
6. New tiny conversion-badge component + new TaxHelper text component (DRY pulled from existing `PriceVatInline` calculations).
7. Out of scope (carved into separate task files): gallery, prebuilt fields library, extended custom-field types, internal_name webhook compat, markdown editor, per-product notifications, quantity/stock/invoice-note.

**Tech Stack:** Next.js 16 (App Router) + React 19 + TypeScript strict + Tailwind v4 + next-intl + Vitest + Playwright + Bun.

---

## Scope (carved-out items)

The proposal references these as separate task files — **NOT** in this plan:

- `[[sellf-form-fields-prebuilt-library]]` — NIP/phone/consent prebuilt fields (separate task, requires DB schema)
- `[[sellf-form-fields-extended-types]]` — checkbox/number/select/date custom-field types (separate task, DB schema)
- `[[sellf-form-fields-internal-name]]` — webhook payload alias migration (separate task, requires migration)
- `[[sellf-product-rich-description]]` — markdown editor toolbar (separate task)
- `[[sellf-product-gallery]]` — multi-image gallery + Supabase Storage RLS (separate task, requires storage)
- `[[sellf-product-notifications]]` — per-product notifications (separate task, requires pg_cron)
- `[[sellf-quantity-selector]]`, `[[sellf-stock-limit]]`, `[[sellf-invoice-note-per-product]]` — separate small tasks

If any of these come up while doing this plan, **do not implement them inline**.

---

## File Structure

### New files

| Path | Responsibility |
|------|---------------|
| `src/lib/product-defaults.ts` | Pure registry `applyProductTypeDefaults(formData, uxType)` + `inferProductTypeFromForm(formData)`. No React, no I/O. |
| `src/components/ProductFormModal/sections/ProductTypeRadio.tsx` | 5-card segmented control. Reads from `formData` via `inferProductTypeFromForm`, calls `setFormData(applyProductTypeDefaults(...))` on change. Installments disabled. Hidden in edit mode (badge in header already). |
| `src/components/ProductFormModal/sections/DescriptionSection.tsx` | Short description (required) + long_description (collapsible). Pulled from `BasicInfoSection`. |
| `src/components/ProductFormModal/sections/TaxHelper.tsx` | Live "Klient płaci dokładnie X" line, rendered under price input in `PriceVatInline`. |
| `src/components/ProductFormModal/sections/ConversionBadge.tsx` | "+N% do konwersji" pill, used by SalePriceSection + PostPurchaseSection OTO toggle. |
| `src/components/ProductFormModal/wizard/PublishChecklist.tsx` | Live checklist row above WizardFooter buttons (name ✓ / price ✓ / hint). |
| `tests/unit/product-defaults.test.ts` | Unit tests for registry + inference. |
| `tests/unit/product-type-radio.test.ts` | Unit tests for radio mapping bidirectional. |

### Modified files

| Path | Change |
|------|--------|
| `src/components/ProductFormModal/types.ts` | No schema fields added. Maybe a `UxProductType` type alias. |
| `src/components/ProductFormModal/sections/BasicInfoSection.tsx` | Drop description + long_description fields (moved to Step 2). |
| `src/components/ProductFormModal/sections/CheckoutTemplateSection.tsx` | **Split**: keep only custom-fields editor (renamed `CustomCheckoutFieldsSection.tsx`), drop template-select dropdown + side-effect logic. |
| `src/components/ProductFormModal/sections/index.ts` | Export new sections, remove `CheckoutTemplateSection`. |
| `src/components/ProductFormModal/sections/AdvancedSection.tsx` | Drop `is_featured` checkbox (moves to Konwersja accordion). Keep is_active/is_listed/omnibus_exempt. |
| `src/components/ProductFormModal/sections/EmbedSection.tsx` | Drop the "Embed enabled" toggle wrapper (just expose the toggle inline). Or keep as-is — section becomes nested in accordion D. |
| `src/components/ProductFormModal/sections/SalePriceSection.tsx` | Add ConversionBadge "+6%" beside toggle label. |
| `src/components/ProductFormModal/sections/PostPurchaseSection.tsx` | Add ConversionBadge "+4%" beside OTO toggle label. |
| `src/components/ProductFormModal/sections/PriceVatInline.tsx` | Render `<TaxHelper />` under price input when price>0 + vat_rate set. |
| `src/components/ProductFormModal/wizard/steps/StepEssentials.tsx` | Replace `CheckoutTemplateSection` with `ProductTypeRadio` at top. Drop `BasicInfoSection.description` from layout (handled inside that section now). |
| `src/components/ProductFormModal/wizard/steps/StepContentDetails.tsx` | Add `DescriptionSection` first. Existing ContentDelivery/Pricing/Categories follow. |
| `src/components/ProductFormModal/wizard/steps/StepSalesSettings.tsx` | Replace flat layout with 6 `<ModalSection>` accordions: Konwersja (A) / Pola (B) / Dostępność (C) / Po zakupie (D) / Zwroty (E) / Zaawansowane (F). Each wraps existing section components. |
| `src/components/ProductFormModal/wizard/WizardFooter.tsx` | New labels ("⚡ Publikuj" / "Zapisz" in edit mode). Disabled state when `!canPublish`. Tooltip via `title` attr. |
| `src/components/ProductFormModal/wizard/ProductCreationWizard.tsx` | Pass `canPublish` to footer. Move description-validation step-jump to Step 2. |
| `src/components/ProductFormModal/hooks/required-fields.ts` | No change (it already covers name/slug/description/price). |
| `src/components/ProductFormModal/hooks/useProductForm.ts` | Update navigate-to-error logic: if `errors.description` → step 2 (not step 1). |
| `src/messages/pl.json` | New keys under `admin.products.form.wizard.*` and `productForm.productType.*`. |
| `src/messages/en.json` | Mirror. |
| `tests/unit/product-creation-wizard.test.ts` | Update step1/2/3 field assertions (description no longer step1). |
| `tests/product-wizard-e2e.spec.ts` | Update locators ("Publikuj" not "Utwórz produkt"), description in step 2, type radio interactions. |
| `tests/checkout-template-dispatch.spec.ts` | If wizard interactions exist — update to use type radio. |
| `tests/tip-jar-template.spec.ts` | Update wizard interactions for tip-jar selection. |
| `tests/pwyw-admin.spec.ts` | Update if it uses wizard. |

### Files to remove

| Path | Why |
|------|-----|
| `src/components/ProductFormModal/sections/CheckoutTemplateSection.tsx` | Split into ProductTypeRadio (type selector) + CustomCheckoutFieldsSection (fields editor). Old file deleted; section index updated. |

---

## Bidirectional UX type ↔ schema mapping

Schema fields involved: `checkout_template`, `product_type`, `allow_custom_price`, `price`, `recurring_price`.

| UX type | `checkout_template` | `product_type` | `allow_custom_price` | `price` | `recurring_price` |
|---|---|---|---|---|---|
| `standard` | `default` | `one_time` | `false` | user-set (>0) | `null` |
| `subscription` | `default` | `subscription` | `false` | `0` (forced at submit) | user-set (>0) |
| `installments` | DISABLED ("wkrótce") | | | | |
| `tip-jar` | `tip-jar` | `one_time` | `true` | `0` (custom_price_presets used) | `null` |
| `lead-magnet` | `default` | `one_time` | `false` | `0` | `null` |

**Inference (edit mode + initial render)** in `inferProductTypeFromForm(formData)`:

```ts
if (formData.checkout_template === 'tip-jar') return 'tip-jar';
if (formData.product_type === 'subscription') return 'subscription';
if (formData.price === 0 && !formData.allow_custom_price) return 'lead-magnet';
return 'standard';
```

Note: `checkout_template === 'oto'` is a hidden template variant used for upsell sub-products — `inferProductTypeFromForm` falls through to `standard` for those (the wizard never shows 'OTO' as a top-level type — OTO is configured inside the Konwersja accordion as a toggle, separate from product type).

**`applyProductTypeDefaults(prev, type)`**: returns a new `ProductFormData` with only the relevant fields patched. Preserves user-entered name/slug/description/icon/etc.

For `tip-jar`, also seeds `custom_checkout_fields` from `getTipJarDefaultCustomFields()` when the array is empty — mirrors existing `CheckoutTemplateSection.handleTemplateChange`.

---

## Task 1: Verify clean baseline

- [ ] **Step 1:** Run unit tests
```bash
bun run test:unit 2>&1 | tail -30
```
Expected: **all green**. If anything fails before we touch code, fix it first (Zero Tolerance).

- [ ] **Step 2:** Run lint + typecheck in parallel
```bash
bun run lint && bun run typecheck
```
Expected: both clean. Fix anything pre-existing.

- [ ] **Step 3:** Commit baseline verification (no code change — just confirmed-clean state)
No commit needed; proceed if green.

---

## Task 2: Implement `lib/product-defaults.ts` (TDD)

**Files:**
- Create: `src/lib/product-defaults.ts`
- Test: `tests/unit/product-defaults.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/product-defaults.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  applyProductTypeDefaults,
  inferProductTypeFromForm,
  type UxProductType,
} from '@/lib/product-defaults';
import { initialFormData } from '@/components/ProductFormModal/types';
import { getTipJarDefaultCustomFields } from '@/lib/checkout-templates/tip-jar';

describe('product-defaults registry', () => {
  describe('applyProductTypeDefaults', () => {
    it('standard: checkout_template=default, product_type=one_time, allow_custom_price=false', () => {
      const result = applyProductTypeDefaults(initialFormData, 'standard');
      expect(result.checkout_template).toBe('default');
      expect(result.product_type).toBe('one_time');
      expect(result.allow_custom_price).toBe(false);
    });

    it('subscription: product_type=subscription, billing_interval=month default', () => {
      const result = applyProductTypeDefaults(initialFormData, 'subscription');
      expect(result.checkout_template).toBe('default');
      expect(result.product_type).toBe('subscription');
      expect(result.billing_interval).toBe('month');
      expect(result.billing_interval_count).toBe(1);
    });

    it('tip-jar: checkout_template=tip-jar, allow_custom_price=true, seeds default custom fields when empty', () => {
      const result = applyProductTypeDefaults(initialFormData, 'tip-jar');
      expect(result.checkout_template).toBe('tip-jar');
      expect(result.allow_custom_price).toBe(true);
      expect(result.custom_checkout_fields).toEqual(getTipJarDefaultCustomFields());
    });

    it('tip-jar: preserves user-defined custom fields when array non-empty', () => {
      const customFields = [
        { id: 'note', type: 'text' as const, label: 'Note', required: false, max_length: 200 },
      ];
      const result = applyProductTypeDefaults(
        { ...initialFormData, custom_checkout_fields: customFields },
        'tip-jar',
      );
      expect(result.custom_checkout_fields).toEqual(customFields);
    });

    it('lead-magnet: price=0, allow_custom_price=false, checkout_template=default', () => {
      const result = applyProductTypeDefaults(
        { ...initialFormData, price: 49 },
        'lead-magnet',
      );
      expect(result.price).toBe(0);
      expect(result.allow_custom_price).toBe(false);
      expect(result.checkout_template).toBe('default');
    });

    it('preserves unrelated fields (name, slug, icon)', () => {
      const input = { ...initialFormData, name: 'My Product', slug: 'my-product', icon: '🎯' };
      const result = applyProductTypeDefaults(input, 'subscription');
      expect(result.name).toBe('My Product');
      expect(result.slug).toBe('my-product');
      expect(result.icon).toBe('🎯');
    });
  });

  describe('inferProductTypeFromForm', () => {
    it('returns tip-jar when checkout_template is tip-jar', () => {
      expect(
        inferProductTypeFromForm({ ...initialFormData, checkout_template: 'tip-jar' }),
      ).toBe<UxProductType>('tip-jar');
    });

    it('returns subscription when product_type is subscription', () => {
      expect(
        inferProductTypeFromForm({ ...initialFormData, product_type: 'subscription' }),
      ).toBe<UxProductType>('subscription');
    });

    it('returns lead-magnet for free standard product (price=0, no PWYW)', () => {
      expect(inferProductTypeFromForm(initialFormData)).toBe<UxProductType>('lead-magnet');
    });

    it('returns standard for paid one-time product', () => {
      expect(
        inferProductTypeFromForm({ ...initialFormData, price: 49 }),
      ).toBe<UxProductType>('standard');
    });

    it('checkout_template=oto falls through to standard (oto is hidden in UX)', () => {
      expect(
        inferProductTypeFromForm({ ...initialFormData, checkout_template: 'oto', price: 19 }),
      ).toBe<UxProductType>('standard');
    });
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**
```bash
bunx vitest run tests/unit/product-defaults.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the minimum**

`src/lib/product-defaults.ts`:
```ts
import type { ProductFormData } from '@/components/ProductFormModal/types';
import { getTipJarDefaultCustomFields } from '@/lib/checkout-templates/tip-jar';

export type UxProductType =
  | 'standard'
  | 'subscription'
  | 'installments'
  | 'tip-jar'
  | 'lead-magnet';

export const UX_PRODUCT_TYPES_AVAILABLE: ReadonlyArray<UxProductType> = [
  'standard',
  'subscription',
  'tip-jar',
  'lead-magnet',
];

export const UX_PRODUCT_TYPES_DISABLED: ReadonlyArray<UxProductType> = ['installments'];

export function applyProductTypeDefaults(
  prev: ProductFormData,
  type: UxProductType,
): ProductFormData {
  switch (type) {
    case 'standard':
      return {
        ...prev,
        checkout_template: 'default',
        product_type: 'one_time',
        allow_custom_price: false,
        billing_interval: null,
        billing_interval_count: null,
        recurring_price: null,
        trial_days: null,
      };
    case 'subscription':
      return {
        ...prev,
        checkout_template: 'default',
        product_type: 'subscription',
        allow_custom_price: false,
        billing_interval: prev.billing_interval ?? 'month',
        billing_interval_count: prev.billing_interval_count ?? 1,
        recurring_price: prev.recurring_price,
        trial_days: prev.trial_days ?? null,
      };
    case 'tip-jar':
      return {
        ...prev,
        checkout_template: 'tip-jar',
        product_type: 'one_time',
        allow_custom_price: true,
        billing_interval: null,
        billing_interval_count: null,
        recurring_price: null,
        custom_checkout_fields:
          prev.custom_checkout_fields.length === 0
            ? getTipJarDefaultCustomFields()
            : prev.custom_checkout_fields,
      };
    case 'lead-magnet':
      return {
        ...prev,
        checkout_template: 'default',
        product_type: 'one_time',
        allow_custom_price: false,
        price: 0,
        recurring_price: null,
        billing_interval: null,
        billing_interval_count: null,
      };
    case 'installments':
      return prev;
  }
}

export function inferProductTypeFromForm(
  formData: Pick<
    ProductFormData,
    'checkout_template' | 'product_type' | 'allow_custom_price' | 'price'
  >,
): UxProductType {
  if (formData.checkout_template === 'tip-jar') return 'tip-jar';
  if (formData.product_type === 'subscription') return 'subscription';
  if (formData.price === 0 && !formData.allow_custom_price) return 'lead-magnet';
  return 'standard';
}
```

- [ ] **Step 4: Run tests — verify all pass**
```bash
bunx vitest run tests/unit/product-defaults.test.ts
```
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**
```bash
git add src/lib/product-defaults.ts tests/unit/product-defaults.test.ts
git commit -m "feat: add product type defaults registry"
```

---

## Task 3: Add `ProductTypeRadio` and wire into Step 1

**Files:**
- Create: `src/components/ProductFormModal/sections/ProductTypeRadio.tsx`
- Modify: `src/components/ProductFormModal/sections/index.ts`
- Modify: `src/components/ProductFormModal/wizard/steps/StepEssentials.tsx`
- Modify: `src/messages/pl.json`, `src/messages/en.json`
- Test: extend `tests/unit/product-creation-wizard.test.ts`

- [ ] **Step 1: Add a failing unit assertion**

In `tests/unit/product-creation-wizard.test.ts`, add (after existing `describe`):

```ts
import { inferProductTypeFromForm, applyProductTypeDefaults } from '@/lib/product-defaults';

describe('ProductCreationWizard - type radio integration', () => {
  it('changing type clears mutually-exclusive billing fields', () => {
    const fromSub = applyProductTypeDefaults(
      { ...initialFormData, product_type: 'subscription', billing_interval: 'month', recurring_price: 19 },
      'standard',
    );
    expect(fromSub.product_type).toBe('one_time');
    expect(fromSub.billing_interval).toBeNull();
    expect(fromSub.recurring_price).toBeNull();
  });

  it('inference matches initialFormData → lead-magnet', () => {
    expect(inferProductTypeFromForm(initialFormData)).toBe('lead-magnet');
  });
});
```

- [ ] **Step 2: Run — verify fails for the right reason** (module wiring; if Task 2 already committed, these should pass — they're integration sanity checks)
```bash
bunx vitest run tests/unit/product-creation-wizard.test.ts
```

- [ ] **Step 3: Implement `ProductTypeRadio`**

`src/components/ProductFormModal/sections/ProductTypeRadio.tsx`:
```tsx
'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import type { ProductFormData } from '../types';
import {
  applyProductTypeDefaults,
  inferProductTypeFromForm,
  UX_PRODUCT_TYPES_AVAILABLE,
  UX_PRODUCT_TYPES_DISABLED,
  type UxProductType,
} from '@/lib/product-defaults';

interface ProductTypeRadioProps {
  formData: ProductFormData;
  setFormData: React.Dispatch<React.SetStateAction<ProductFormData>>;
  isEditing?: boolean;
}

const TYPE_ICONS: Record<UxProductType, string> = {
  standard: '📦',
  subscription: '🔄',
  installments: '💳',
  'tip-jar': '💰',
  'lead-magnet': '🎁',
};

const ALL_TYPES: ReadonlyArray<UxProductType> = [
  'standard',
  'subscription',
  'installments',
  'tip-jar',
  'lead-magnet',
];

export function ProductTypeRadio({ formData, setFormData, isEditing }: ProductTypeRadioProps) {
  const t = useTranslations('productForm.productType');
  const current = inferProductTypeFromForm(formData);

  const handleSelect = (type: UxProductType) => {
    if (UX_PRODUCT_TYPES_DISABLED.includes(type)) return;
    if (type === current) return;
    setFormData((prev) => applyProductTypeDefaults(prev, type));
  };

  if (isEditing) {
    return (
      <div className="text-xs text-sf-muted">
        {t('lockedInEdit', { type: t(`options.${current}.name`) })}
      </div>
    );
  }

  return (
    <fieldset className="space-y-2" aria-label={t('legend')}>
      <legend className="text-sm font-medium text-sf-body mb-2">{t('legend')}</legend>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {ALL_TYPES.map((type) => {
          const disabled = UX_PRODUCT_TYPES_DISABLED.includes(type);
          const selected = !disabled && current === type;
          return (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={disabled || undefined}
              disabled={disabled}
              data-product-type={type}
              onClick={() => handleSelect(type)}
              className={`flex flex-col items-center gap-1 p-3 border-2 rounded-lg text-left text-xs transition ${
                selected
                  ? 'border-sf-accent bg-sf-accent-soft text-sf-accent'
                  : disabled
                    ? 'border-sf-border bg-sf-base/50 text-sf-muted cursor-not-allowed opacity-60'
                    : 'border-sf-border hover:border-sf-accent/50 text-sf-body'
              }`}
            >
              <span className="text-2xl" aria-hidden>
                {TYPE_ICONS[type]}
              </span>
              <span className="font-medium text-sf-heading">{t(`options.${type}.name`)}</span>
              <span className="text-[10px] text-sf-muted text-center leading-tight">
                {disabled ? t('comingSoon') : t(`options.${type}.tagline`)}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-sf-muted">{t(`options.${current}.help`)}</p>
    </fieldset>
  );
}
```

- [ ] **Step 4: Update `sections/index.ts`**

Replace
```ts
export { default as CheckoutTemplateSection } from './CheckoutTemplateSection';
```
with
```ts
export { ProductTypeRadio } from './ProductTypeRadio';
export { CustomCheckoutFieldsSection } from './CustomCheckoutFieldsSection';
```

(`CustomCheckoutFieldsSection` is split out in Task 5.)

- [ ] **Step 5: Wire ProductTypeRadio into `StepEssentials`**

Replace the `<CheckoutTemplateSection ...>` with `<ProductTypeRadio formData={formData} setFormData={setFormData} isEditing={isEditing} />`. Keep the rest of StepEssentials structure for now (BasicInfoSection, SubscriptionSection, PriceVatInline). The next task removes description from BasicInfoSection.

- [ ] **Step 6: Add i18n keys**

In `src/messages/pl.json` under `"productForm"`, add:
```json
"productType": {
  "legend": "Typ produktu",
  "lockedInEdit": "Typ produktu zablokowany w trybie edycji: {type}",
  "comingSoon": "wkrótce",
  "options": {
    "standard": {
      "name": "Standardowy",
      "tagline": "jednorazowa płatność",
      "help": "Stała cena, zakup jednorazowy. Np. ebook, szablon, lifetime."
    },
    "subscription": {
      "name": "Subskrypcja",
      "tagline": "płatność cykliczna",
      "help": "Powtarzająca się opłata (mies./rok). Np. członkostwo, kurs ze społecznością."
    },
    "installments": {
      "name": "Raty",
      "tagline": "N rat co miesiąc",
      "help": "Płatność rozbita na N rat (wkrótce)."
    },
    "tip-jar": {
      "name": "Tip jar",
      "tagline": "płać ile chcesz",
      "help": "Klient sam wybiera kwotę. Np. donate, napiwek, wsparcie."
    },
    "lead-magnet": {
      "name": "Lead magnet",
      "tagline": "darmowy w zamian za email",
      "help": "Bezpłatny produkt (PDF, checklist) za email klienta."
    }
  }
}
```

Mirror in `en.json` with English translations:
```json
"productType": {
  "legend": "Product type",
  "lockedInEdit": "Product type locked in edit mode: {type}",
  "comingSoon": "soon",
  "options": {
    "standard": { "name": "Standard", "tagline": "one-time payment", "help": "Fixed price, one-time purchase. E.g. ebook, template, lifetime." },
    "subscription": { "name": "Subscription", "tagline": "recurring payment", "help": "Repeating charge (monthly/yearly). E.g. membership, course with community." },
    "installments": { "name": "Installments", "tagline": "N monthly payments", "help": "Split payment into N installments (coming soon)." },
    "tip-jar": { "name": "Tip jar", "tagline": "pay what you want", "help": "Customer picks the amount. E.g. donate, tip, support." },
    "lead-magnet": { "name": "Lead magnet", "tagline": "free for email", "help": "Free product (PDF, checklist) in exchange for email." }
  }
}
```

- [ ] **Step 7: Run unit tests**
```bash
bun run test:unit -- product-creation-wizard product-defaults
```
Expected: PASS.

- [ ] **Step 8: Commit**
```bash
git add src/lib/product-defaults.ts src/components/ProductFormModal/sections/ProductTypeRadio.tsx src/components/ProductFormModal/wizard/steps/StepEssentials.tsx src/messages/pl.json src/messages/en.json tests/unit/product-creation-wizard.test.ts
git commit -m "feat: product type radio at top of step 1"
```

---

## Task 4: Move description fields to Step 2

**Files:**
- Modify: `src/components/ProductFormModal/sections/BasicInfoSection.tsx`
- Create: `src/components/ProductFormModal/sections/DescriptionSection.tsx`
- Modify: `src/components/ProductFormModal/sections/index.ts`
- Modify: `src/components/ProductFormModal/wizard/steps/StepContentDetails.tsx`
- Modify: `src/components/ProductFormModal/hooks/useProductForm.ts` (jump target)
- Modify: `src/components/ProductFormModal/wizard/ProductCreationWizard.tsx` (error-step routing)
- Update: `tests/unit/product-creation-wizard.test.ts`

- [ ] **Step 1: Update unit test (RED)**

In `tests/unit/product-creation-wizard.test.ts` step-flow describe block, change the assertion so step 1 no longer covers description:

```ts
it('step 1 fields (Essentials) exist in initialFormData with correct defaults', () => {
  expect(initialFormData.name).toBe('');
  expect(initialFormData.slug).toBe('');
  expect(initialFormData.price).toBe(0);
  expect(initialFormData.currency).toBe('USD');
  expect(initialFormData.icon).toBe('🚀');
});

it('step 2 covers description + long_description (moved from step 1)', () => {
  expect(initialFormData.description).toBe('');
  expect(initialFormData.long_description).toBe('');
});
```

Run — should still pass (initialFormData values unchanged) — but documents the new ownership.

- [ ] **Step 2: Extract `DescriptionSection`**

`src/components/ProductFormModal/sections/DescriptionSection.tsx`:

```tsx
'use client';

import React, { useState } from 'react';
import { ModalSection } from '@/components/ui/Modal';
import type { SectionProps } from '../types';

interface DescriptionSectionProps extends SectionProps {
  fieldErrors?: Record<string, string>;
}

export function DescriptionSection({ formData, setFormData, t, fieldErrors = {} }: DescriptionSectionProps) {
  const [expanded, setExpanded] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const errorBorder = 'border-red-500 focus:ring-red-500';
  const normalBorder = 'border-sf-border focus:ring-sf-accent';

  return (
    <ModalSection title={t('descriptionSection.title')}>
      <div className="space-y-4">
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-sf-body mb-2">
            {t('description')}
          </label>
          <textarea
            id="description"
            name="description"
            value={formData.description || ''}
            onChange={handleChange}
            rows={3}
            className={`w-full px-3 py-2.5 border ${fieldErrors.description ? errorBorder : normalBorder} focus:outline-none focus:ring-2 focus:border-transparent bg-sf-input text-sf-heading`}
            placeholder={t('descriptionPlaceholder')}
            required
          />
          {fieldErrors.description && (
            <p className="mt-1 text-xs text-red-500">{t('descriptionRequired')}</p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="long_description" className="block text-sm font-medium text-sf-body">
              {t('longDescription')}
              <span className="text-xs text-sf-muted ml-1">({t('optional')})</span>
            </label>
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="text-xs text-sf-accent hover:text-sf-accent flex items-center gap-1"
            >
              {expanded ? t('collapse') : t('expand')}
              <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
          <textarea
            id="long_description"
            name="long_description"
            value={formData.long_description || ''}
            onChange={handleChange}
            rows={expanded ? 10 : 2}
            className="w-full px-3 py-2 border-2 border-sf-border-medium focus:outline-none focus:ring-2 focus:ring-sf-accent focus:border-transparent bg-sf-input text-sf-heading font-mono text-sm resize-none transition-all duration-200"
            placeholder={t('longDescriptionPlaceholder')}
          />
          {expanded && (
            <p className="mt-1.5 text-xs text-sf-muted flex items-start gap-1">
              <span>💡</span>
              <span>{t('markdownTip')}</span>
            </p>
          )}
        </div>
      </div>
    </ModalSection>
  );
}
```

- [ ] **Step 3: Strip description/long_description from `BasicInfoSection`**

Remove the description textarea + the entire `LongDescriptionField` helper from `BasicInfoSection.tsx`. Drop the `handleInputChange` branches that aren't needed. Keep name + slug.

- [ ] **Step 4: Export new section + wire to Step 2**

`src/components/ProductFormModal/sections/index.ts`:
```ts
export { DescriptionSection } from './DescriptionSection';
```

`src/components/ProductFormModal/wizard/steps/StepContentDetails.tsx`:
```tsx
'use client';
import React from 'react';
import { ContentDeliverySection, PricingSection, CategoriesSection, DescriptionSection } from '../../sections';
// ... existing imports
// Add to props: fieldErrors?: Record<string, string>;

export const StepContentDetails: React.FC<StepContentDetailsProps> = ({
  formData, setFormData, t, onIconSelect,
  urlValidation, setUrlValidation, validateContentItemUrl,
  allCategories, loadingCategories, fieldErrors,
}) => {
  const isTipJar = formData.checkout_template === 'tip-jar';
  return (
    <div className="space-y-6">
      <DescriptionSection formData={formData} setFormData={setFormData} t={t} fieldErrors={fieldErrors} />
      {!isTipJar && (
        <ContentDeliverySection /* unchanged */ />
      )}
      <PricingSection /* unchanged */ />
      <CategoriesSection /* unchanged */ />
    </div>
  );
};
```

- [ ] **Step 5: Update error-step routing**

In `ProductCreationWizard.tsx`, the existing effect:
```ts
React.useEffect(() => {
  if (Object.keys(fieldErrors).length > 0 && currentStep !== 1) {
    setCurrentStep(1);
  }
}, [fieldErrors, currentStep]);
```

Change to jump to step 2 if the only errors are description; step 1 otherwise:
```ts
React.useEffect(() => {
  const keys = Object.keys(fieldErrors);
  if (keys.length === 0) return;
  const step1Keys = ['name', 'slug', 'price', 'recurring_price', 'vat_rate'];
  const hasStep1Error = keys.some((k) => step1Keys.includes(k));
  if (hasStep1Error && currentStep !== 1) setCurrentStep(1);
  else if (!hasStep1Error && keys.includes('description') && currentStep !== 2) setCurrentStep(2);
}, [fieldErrors, currentStep]);
```

Pass `fieldErrors` to `StepContentDetails` from `ProductCreationWizard.tsx`.

- [ ] **Step 6: Run lint + typecheck + unit**
```bash
bun run lint && bun run typecheck && bun run test:unit
```

- [ ] **Step 7: Commit**
```bash
git add src/components/ProductFormModal/sections/{BasicInfoSection,DescriptionSection,index}.tsx src/components/ProductFormModal/sections/index.ts src/components/ProductFormModal/wizard/steps/StepContentDetails.tsx src/components/ProductFormModal/wizard/ProductCreationWizard.tsx tests/unit/product-creation-wizard.test.ts
git commit -m "feat: move description fields to step 2"
```

---

## Task 5: Split `CheckoutTemplateSection` → `CustomCheckoutFieldsSection`

**Files:**
- Create: `src/components/ProductFormModal/sections/CustomCheckoutFieldsSection.tsx`
- Delete: `src/components/ProductFormModal/sections/CheckoutTemplateSection.tsx`
- Modify: `src/components/ProductFormModal/sections/index.ts`

- [ ] **Step 1: Copy custom-fields-editor block from old `CheckoutTemplateSection` into a new file**

`src/components/ProductFormModal/sections/CustomCheckoutFieldsSection.tsx`:

```tsx
'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { ModalSection } from '@/components/ui/Modal';
import type { ProductFormData } from '../types';
import { getTipJarDefaultCustomFields } from '@/lib/checkout-templates/tip-jar';
import {
  validateCustomFieldDefinitions,
  CUSTOM_FIELD_MAX_PER_PRODUCT,
  CUSTOM_FIELD_MAX_VALUE_LENGTH,
  type CustomFieldDefinition,
  type CustomFieldType,
} from '@/lib/validations/custom-checkout-fields';

interface Props {
  formData: ProductFormData;
  setFormData: React.Dispatch<React.SetStateAction<ProductFormData>>;
}

function asLabelString(label: CustomFieldDefinition['label'], locale: string): string {
  if (typeof label === 'string') return label;
  return locale.startsWith('pl') ? label.pl : label.en;
}

export function CustomCheckoutFieldsSection({ formData, setFormData }: Props) {
  const t = useTranslations('productForm.customFields');

  const validation = validateCustomFieldDefinitions(formData.custom_checkout_fields);
  const fieldErrors = validation.ok ? {} : validation.errors;

  const addField = () => {
    if (formData.custom_checkout_fields.length >= CUSTOM_FIELD_MAX_PER_PRODUCT) return;
    setFormData((prev) => ({
      ...prev,
      custom_checkout_fields: [
        ...prev.custom_checkout_fields,
        {
          id: `field_${prev.custom_checkout_fields.length + 1}`,
          type: 'text',
          label: '',
          required: false,
          max_length: 200,
        },
      ],
    }));
  };

  const updateField = (index: number, patch: Partial<CustomFieldDefinition>) => {
    setFormData((prev) => ({
      ...prev,
      custom_checkout_fields: prev.custom_checkout_fields.map((f, i) =>
        i === index ? { ...f, ...patch } : f,
      ),
    }));
  };

  const removeField = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      custom_checkout_fields: prev.custom_checkout_fields.filter((_, i) => i !== index),
    }));
  };

  const resetToDefaults = () => {
    setFormData((prev) => ({
      ...prev,
      custom_checkout_fields:
        prev.checkout_template === 'tip-jar' ? getTipJarDefaultCustomFields() : [],
    }));
  };

  return (
    <ModalSection title={t('label')} collapsible defaultExpanded={formData.custom_checkout_fields.length > 0}>
      <header className="flex items-center justify-between mb-3">
        <p className="text-xs text-sf-muted">{t('helpText')}</p>
        <div className="flex items-center gap-2">
          {formData.checkout_template === 'tip-jar' && (
            <button
              type="button"
              onClick={resetToDefaults}
              className="text-xs text-sf-muted hover:text-sf-accent underline"
            >
              {t('resetDefaults')}
            </button>
          )}
          <button
            type="button"
            onClick={addField}
            disabled={formData.custom_checkout_fields.length >= CUSTOM_FIELD_MAX_PER_PRODUCT}
            className="px-3 py-1.5 text-sm font-medium bg-sf-accent-bg hover:bg-sf-accent-hover text-white rounded-full disabled:bg-sf-muted/30 disabled:cursor-not-allowed"
          >
            {t('addButton')}
          </button>
        </div>
      </header>

      {formData.custom_checkout_fields.length === 0 ? (
        <p className="text-sm text-sf-muted py-4 text-center">{t('emptyState')}</p>
      ) : (
        <ul className="space-y-3">
          {formData.custom_checkout_fields.map((field, idx) => {
            const labelString = asLabelString(field.label, 'pl');
            const error = fieldErrors[String(idx)];
            return (
              <li key={idx} className="bg-sf-base border border-sf-border rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
                  <input
                    aria-label={t('fieldId')}
                    placeholder={t('fieldId')}
                    value={field.id}
                    onChange={(e) => updateField(idx, { id: e.target.value })}
                    className="lg:col-span-3 p-2 text-sm border border-sf-border rounded bg-sf-input text-sf-heading"
                  />
                  <select
                    aria-label={t('fieldType.label')}
                    value={field.type}
                    onChange={(e) => updateField(idx, { type: e.target.value as CustomFieldType })}
                    className="lg:col-span-2 p-2 text-sm border border-sf-border rounded bg-sf-input text-sf-heading"
                  >
                    <option value="text">{t('fieldType.text')}</option>
                    <option value="textarea">{t('fieldType.textarea')}</option>
                    <option value="email">{t('fieldType.email')}</option>
                  </select>
                  <input
                    aria-label={t('fieldLabel')}
                    placeholder={t('fieldLabel')}
                    value={labelString}
                    onChange={(e) => updateField(idx, { label: e.target.value })}
                    className="lg:col-span-4 p-2 text-sm border border-sf-border rounded bg-sf-input text-sf-heading"
                  />
                  <input
                    aria-label={t('maxLength')}
                    type="number"
                    min={1}
                    max={CUSTOM_FIELD_MAX_VALUE_LENGTH}
                    value={field.max_length}
                    onChange={(e) => updateField(idx, { max_length: Math.max(1, Number(e.target.value) || 1) })}
                    className="lg:col-span-2 p-2 text-sm border border-sf-border rounded bg-sf-input text-sf-heading"
                  />
                  <label className="lg:col-span-1 flex items-center gap-1 text-xs text-sf-body">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => updateField(idx, { required: e.target.checked })}
                    />
                    {t('required')}
                  </label>
                </div>
                {error && <p className="text-xs text-sf-danger">{error}</p>}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => removeField(idx)}
                    className="text-xs text-sf-danger hover:underline"
                  >
                    {t('removeButton')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ModalSection>
  );
}
```

- [ ] **Step 2: Delete `CheckoutTemplateSection.tsx`**
```bash
rm src/components/ProductFormModal/sections/CheckoutTemplateSection.tsx
```

- [ ] **Step 3: Update `sections/index.ts`** — remove `CheckoutTemplateSection` export, add `CustomCheckoutFieldsSection`.

- [ ] **Step 4: Run typecheck**
```bash
bun run typecheck
```
Should pass — `StepEssentials.tsx` already swapped the section ref in Task 3, no other file should import `CheckoutTemplateSection`.

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "refactor: split checkout template section into product type radio and fields editor"
```

---

## Task 6: Reorganize Step 3 into 6 accordions

**Files:**
- Modify: `src/components/ProductFormModal/wizard/steps/StepSalesSettings.tsx`
- Modify: `src/components/ProductFormModal/sections/AdvancedSection.tsx` (remove `is_featured`)
- Create: `src/components/ProductFormModal/sections/FeaturedToggle.tsx` (tiny, just the is_featured checkbox)
- Update: `src/messages/pl.json`, `src/messages/en.json` (accordion titles)

- [ ] **Step 1: Create `FeaturedToggle.tsx`**

```tsx
'use client';

import React from 'react';
import type { SectionProps } from '../types';

export function FeaturedToggle({ formData, setFormData, t }: SectionProps) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={formData.is_featured}
        onChange={(e) => setFormData((prev) => ({ ...prev, is_featured: e.target.checked }))}
        className="h-4 w-4 text-sf-accent focus:ring-sf-accent border-sf-border rounded"
      />
      <span className="text-sm font-medium text-sf-heading">{t('featuredProduct')}</span>
      <span className="text-xs text-sf-muted">{t('featuredProductHelp')}</span>
    </label>
  );
}
```

- [ ] **Step 2: Remove `is_featured` checkbox from `AdvancedSection`** (the rest stays).

Diff the section so the only checkboxes left are: `is_active`, `is_listed`, `omnibus_exempt`.

- [ ] **Step 3: Rewrite `StepSalesSettings.tsx`** with 6 accordions:

```tsx
'use client';

import React from 'react';
import { ModalSection } from '@/components/ui/Modal';
import {
  SalePriceSection,
  AvailabilitySection,
  AccessSection,
  EmbedSection,
  PostPurchaseSection,
  RefundSection,
  AdvancedSection,
  BadgeGeneratorSection,
  CustomCheckoutFieldsSection,
  FeaturedToggle,
} from '../../sections';
import type { ProductFormData, TranslationFunction, OtoState } from '../../types';
import type { Product } from '@/types';

interface StepSalesSettingsProps {
  formData: ProductFormData;
  setFormData: React.Dispatch<React.SetStateAction<ProductFormData>>;
  t: TranslationFunction;
  salePriceDisplayValue: string;
  setSalePriceDisplayValue: (value: string) => void;
  omnibusEnabled: boolean;
  hasWaitlistWebhook: boolean | null;
  products: Product[];
  loadingProducts: boolean;
  currentProductId?: string;
  oto: OtoState;
  setOto: React.Dispatch<React.SetStateAction<OtoState>>;
}

export const StepSalesSettings: React.FC<StepSalesSettingsProps> = ({
  formData, setFormData, t,
  salePriceDisplayValue, setSalePriceDisplayValue,
  omnibusEnabled, hasWaitlistWebhook,
  products, loadingProducts, currentProductId, oto, setOto,
}) => {
  return (
    <div className="space-y-4">
      {/* A. Konwersja */}
      <ModalSection title={t('step3.conversion')} collapsible defaultExpanded>
        <div className="space-y-6">
          <SalePriceSection
            formData={formData}
            setFormData={setFormData}
            t={t}
            salePriceDisplayValue={salePriceDisplayValue}
            setSalePriceDisplayValue={setSalePriceDisplayValue}
            omnibusEnabled={omnibusEnabled}
          />
          <PostPurchaseSection
            formData={formData}
            setFormData={setFormData}
            t={t}
            products={products}
            loadingProducts={loadingProducts}
            currentProductId={currentProductId}
            oto={oto}
            setOto={setOto}
          />
          <FeaturedToggle formData={formData} setFormData={setFormData} t={t} />
          {formData.checkout_template === 'tip-jar' && (
            <BadgeGeneratorSection formData={formData} />
          )}
        </div>
      </ModalSection>

      {/* B. Pola formularza */}
      <ModalSection title={t('step3.formFields')} collapsible>
        <CustomCheckoutFieldsSection formData={formData} setFormData={setFormData} />
      </ModalSection>

      {/* C. Dostępność */}
      <ModalSection title={t('step3.availability')} collapsible>
        <div className="space-y-6">
          <AvailabilitySection formData={formData} setFormData={setFormData} t={t} hasWaitlistWebhook={hasWaitlistWebhook} />
          <AccessSection formData={formData} setFormData={setFormData} t={t} />
        </div>
      </ModalSection>

      {/* D. Po zakupie */}
      <ModalSection title={t('step3.postPurchase')} collapsible>
        <EmbedSection formData={formData} setFormData={setFormData} t={t} />
      </ModalSection>

      {/* E. Zwroty */}
      <ModalSection title={t('step3.refunds')} collapsible>
        <RefundSection formData={formData} setFormData={setFormData} t={t} />
      </ModalSection>

      {/* F. Zaawansowane */}
      <ModalSection title={t('step3.advanced')} collapsible>
        <AdvancedSection formData={formData} setFormData={setFormData} t={t} omnibusEnabled={omnibusEnabled} />
      </ModalSection>
    </div>
  );
};
```

> Note: `PostPurchaseSection` currently lives in 3.A (Konwersja) — it primarily handles OTO upsell + redirect. The proposal places redirect URL in 3.D and OTO in 3.A — but `PostPurchaseSection` couples them. Keep them together in 3.A for now (refactoring `PostPurchaseSection` apart is YAGNI; the OTO toggle is the conversion driver and the redirect URL ride along). `EmbedSection` is the only thing left for 3.D.

- [ ] **Step 4: Add i18n keys**

`pl.json`:
```json
"step3": {
  "conversion": "A. Konwersja",
  "formFields": "B. Pola formularza",
  "availability": "C. Dostępność i dostęp",
  "postPurchase": "D. Po zakupie",
  "refunds": "E. Zwroty",
  "advanced": "F. Zaawansowane"
}
```

Plus `featuredProductHelp`: `"Wyróżniony w katalogu produktów"` (and English).

`en.json` mirror.

- [ ] **Step 5: Update `sections/index.ts`** with `FeaturedToggle` export.

- [ ] **Step 6: Typecheck + unit**
```bash
bun run typecheck && bun run test:unit
```

- [ ] **Step 7: Commit**
```bash
git add -A
git commit -m "feat: reorganize step 3 into 6 accordions"
```

---

## Task 7: Conversion booster badges + dynamic tax helper

**Files:**
- Create: `src/components/ProductFormModal/sections/ConversionBadge.tsx`
- Create: `src/components/ProductFormModal/sections/TaxHelper.tsx`
- Modify: `src/components/ProductFormModal/sections/SalePriceSection.tsx`
- Modify: `src/components/ProductFormModal/sections/PostPurchaseSection.tsx`
- Modify: `src/components/ProductFormModal/sections/PriceVatInline.tsx`
- Update: i18n

- [ ] **Step 1: `ConversionBadge` component**

```tsx
import React from 'react';

interface Props {
  label: string;
}

export function ConversionBadge({ label }: Props) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-sf-success-soft text-sf-success rounded-full">
      🎯 {label}
    </span>
  );
}
```

- [ ] **Step 2: `TaxHelper` component**

```tsx
'use client';

import React from 'react';
import type { ProductFormData } from '../types';
import type { TaxMode } from '@/lib/actions/shop-config';

interface Props {
  formData: ProductFormData;
  priceDisplayValue: string;
  taxMode?: TaxMode;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function TaxHelper({ formData, priceDisplayValue, taxMode, t }: Props) {
  if (taxMode !== 'local') return null;
  if (formData.price <= 0) return null;
  if (formData.vat_rate == null) return null;
  const symbol = formData.currency ?? 'PLN';
  // Both inclusive and exclusive: communicate effective gross/net the buyer pays.
  const isIncl = formData.price_includes_vat;
  if (isIncl) {
    return (
      <p className="mt-1 text-xs text-sf-muted">
        💡 {t('taxHelper.gross', { amount: formData.price.toFixed(2), symbol })}
      </p>
    );
  }
  const gross = formData.price * (1 + (formData.vat_rate ?? 0) / 100);
  return (
    <p className="mt-1 text-xs text-sf-muted">
      💡 {t('taxHelper.netToGross', { net: formData.price.toFixed(2), gross: gross.toFixed(2), symbol })}
    </p>
  );
}
```

- [ ] **Step 3: Wire `ConversionBadge` into SalePriceSection + PostPurchaseSection**

Add `<ConversionBadge label={t('conversionBadge.salePrice')} />` next to the SalePrice toggle label, and `<ConversionBadge label={t('conversionBadge.oto')} />` next to the OTO toggle label.

- [ ] **Step 4: Wire `TaxHelper` into PriceVatInline**

Inside `PriceVatInline.tsx`, after the price input, render `<TaxHelper formData={formData} priceDisplayValue={priceDisplayValue} taxMode={taxMode} t={t} />`.

- [ ] **Step 5: i18n**

```json
"conversionBadge": {
  "salePrice": "+6% do konwersji",
  "oto": "+4% do konwersji"
},
"taxHelper": {
  "gross": "Klient płaci dokładnie {amount} {symbol} (VAT wliczony)",
  "netToGross": "Cena netto {net} {symbol} → klient płaci {gross} {symbol} brutto"
}
```

English mirror.

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat: conversion badges and dynamic tax helper"
```

---

## Task 8: Publish footer (label + checklist + tooltip)

**Files:**
- Modify: `src/components/ProductFormModal/wizard/WizardFooter.tsx`
- Create: `src/components/ProductFormModal/wizard/PublishChecklist.tsx`
- Modify: `src/components/ProductFormModal/wizard/ProductCreationWizard.tsx`

- [ ] **Step 1: `PublishChecklist` component**

```tsx
'use client';

import React from 'react';
import type { ProductFormData } from '../types';
import type { TranslationFunction } from '../types';
import { inferProductTypeFromForm } from '@/lib/product-defaults';

interface PublishChecklistProps {
  formData: ProductFormData;
  priceDisplayValue: string;
  t: TranslationFunction;
}

interface ChecklistItem {
  key: string;
  label: string;
  ok: boolean;
}

export function getPublishChecklist(formData: ProductFormData, priceDisplayValue: string, t: TranslationFunction): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  items.push({ key: 'name', label: t('publish.name'), ok: !!formData.name.trim() });
  const isSub = formData.product_type === 'subscription';
  const isLeadMagnet = inferProductTypeFromForm(formData) === 'lead-magnet';
  if (isSub) {
    items.push({ key: 'recurring_price', label: t('publish.recurringPrice'), ok: (formData.recurring_price ?? 0) > 0 });
  } else if (isLeadMagnet) {
    const hasContent = (formData.content_config?.content_items?.length ?? 0) > 0;
    items.push({ key: 'content', label: t('publish.leadMagnetFile'), ok: hasContent });
  } else {
    items.push({ key: 'price', label: t('publish.price'), ok: priceDisplayValue !== '' && formData.price > 0 });
  }
  return items;
}

export function PublishChecklist({ formData, priceDisplayValue, t }: PublishChecklistProps) {
  const items = getPublishChecklist(formData, priceDisplayValue, t);
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-sf-muted">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span className={item.ok ? 'text-sf-success' : 'text-sf-muted'}>{item.ok ? '✓' : '○'}</span>
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Update `WizardFooter`**

```tsx
'use client';

import React from 'react';
import { Button } from '@/components/ui/Modal';
import type { TranslationFunction } from '../types';
import type { ProductFormData } from '../types';
import { PublishChecklist, getPublishChecklist } from './PublishChecklist';

interface WizardFooterProps {
  currentStep: number;
  totalSteps: number;
  isSubmitting: boolean;
  isEditMode: boolean;
  formData: ProductFormData;
  priceDisplayValue: string;
  onBack: () => void;
  onContinue: () => void;
  onSubmit: () => void;
  onCancel: () => void;
  t: TranslationFunction;
}

export const WizardFooter: React.FC<WizardFooterProps> = ({
  currentStep, totalSteps, isSubmitting, isEditMode, formData, priceDisplayValue,
  onBack, onContinue, onSubmit, onCancel, t,
}) => {
  const isFirstStep = currentStep === 1;
  const isLastStep = currentStep === totalSteps;
  const checklist = getPublishChecklist(formData, priceDisplayValue, t);
  const canPublish = isEditMode || checklist.every((c) => c.ok);
  const submitLabel = isEditMode ? t('updateProduct') : t('publish.cta');
  const tooltip = canPublish ? undefined : t('publish.disabledTooltip', { missing: checklist.filter((c) => !c.ok).map((c) => c.label).join(', ') });

  return (
    <div className="px-6 py-3 border-t border-sf-border bg-sf-raised space-y-2">
      {!isEditMode && (
        <PublishChecklist formData={formData} priceDisplayValue={priceDisplayValue} t={t} />
      )}
      <div className="flex items-center justify-between">
        <div>
          {isFirstStep ? (
            <Button onClick={onCancel} variant="ghost">{t('wizard.cancel')}</Button>
          ) : (
            <Button onClick={onBack} variant="ghost">
              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              {t('wizard.back')}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3" title={tooltip}>
          <Button
            onClick={onSubmit}
            variant="primary"
            disabled={isSubmitting || !canPublish}
            loading={isSubmitting}
          >
            {submitLabel}
          </Button>
          {!isLastStep && (
            <Button onClick={onContinue} variant="ghost">
              {t('wizard.continueSetup')}
              <svg className="w-4 h-4 ml-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Pass new props from `ProductCreationWizard.tsx`**

Pass `formData={formData}` and `priceDisplayValue={priceDisplayValue}` to `WizardFooter`.

- [ ] **Step 4: i18n**

```json
"publish": {
  "cta": "⚡ Publikuj",
  "disabledTooltip": "Wypełnij: {missing}",
  "name": "Nazwa",
  "price": "Cena",
  "recurringPrice": "Cena cykliczna",
  "leadMagnetFile": "Plik (krok 2)"
}
```

English mirror.

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "feat: publish footer with live checklist"
```

---

## Task 9: Update existing E2E tests

**Files:**
- Modify: `tests/product-wizard-e2e.spec.ts`
- Modify (as needed): `tests/tip-jar-template.spec.ts`, `tests/checkout-template-dispatch.spec.ts`, `tests/pwyw-admin.spec.ts`

- [ ] **Step 1: Update `product-wizard-e2e.spec.ts`** key changes:

| Locator change | From | To |
|---|---|---|
| Submit label | `Utwórz produkt` | `Publikuj` |
| Description location | step 1 `textarea#description` | step 2 (after navigation `Dalej`) |
| Fast path (step 1) | fill name + description + price | fill name + price; description optional or filled in step 2 |
| `should not advance from step 1 without required fields` | description was required for step 1 | now name + price required for step 1; description required for step 2 (or for submit) |

Walk through the file and rewrite each test:

- Edit `should open wizard when clicking Add Product`: replace `/Utwórz produkt/i` with `/Publikuj/i`.
- Edit `should create product from step 1 (fast path)`: remove `page.fill('textarea#description', ...)` from step 1; the test should fill name + price, click "Publikuj" button (validates the new fast path). Description can stay empty (newer behavior). If `description` is still required, the publish click should jump to step 2 — adjust the test accordingly:
  - Click Publikuj; if modal stays open due to description required, fill description on step 2 and click Publikuj again.
- Edit `should navigate through all 3 steps`: drop description from step 1 fill; add fill description in step 2 if required.
- Edit `should create product after going through all steps`: fill description in step 2 (not step 1), then continue to step 3, click "Publikuj".
- Edit `should not advance from step 1 without required fields`: instead of just clicking Dalej, attempt to click Publikuj — verify still on step 1 due to missing fields (name empty).
- Edit `should show exit confirmation when form is dirty`: leave as-is, only uses name.
- Edit edit-mode tests: replace `/Aktualizuj produkt/i` with `/Aktualizuj|Zapisz/i` if changed; otherwise keep — the proposal says edit mode keeps "Zapisz" but only for already-active products. **Decision: keep edit-mode label as `Aktualizuj produkt` for now** (no proposal-mandated rename in edit). Update only create-mode locators.

- [ ] **Step 2: Update tip-jar-template spec** — switch from `select#checkout-template-select` value `'tip-jar'` to clicking the radio card `button[data-product-type="tip-jar"]`.

- [ ] **Step 3: Update checkout-template-dispatch spec similarly** if it interacts with the wizard.

- [ ] **Step 4: Run E2E in headed mode for sanity (single spec)**

```bash
bunx playwright test tests/product-wizard-e2e.spec.ts --reporter=line
```

Fix anything that's red.

- [ ] **Step 5: Commit**
```bash
git add tests/
git commit -m "test: update e2e for redesigned wizard"
```

---

## Task 10: Final verification + cleanup

- [ ] **Step 1: Lint + typecheck**
```bash
bun run lint && bun run typecheck
```

- [ ] **Step 2: Full unit run**
```bash
bun run test:unit
```

- [ ] **Step 3: Targeted Playwright suite (wizard + tip-jar + pwyw + checkout-template)**
```bash
bunx playwright test \
  tests/product-wizard-e2e.spec.ts \
  tests/tip-jar-template.spec.ts \
  tests/checkout-template-dispatch.spec.ts \
  tests/pwyw-admin.spec.ts \
  --reporter=line
```

- [ ] **Step 4: Dead-code/unused-import sweep**
- Search for `CheckoutTemplateSection` references — should be zero.
- Check `LongDescriptionField` no longer imported anywhere — it was inline in BasicInfoSection.
- Verify no orphaned i18n keys referencing the old `checkoutTemplate.selectLabel` etc. — drop unused.

- [ ] **Step 5: Final commit**
```bash
git add -A
git commit -m "chore: drop dead refs after wizard redesign"
```

- [ ] **Step 6: Stage push/tag deferred to user**

Do not push or open a PR automatically — user controls release flow.
