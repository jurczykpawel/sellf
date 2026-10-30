'use client';
/** Offline submission shares the checkout module and custom-field contracts. @see api/orders/bank-transfer */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import AltchaWidget from '@/components/captcha/AltchaWidget';
import CustomCheckoutFieldsForm from '@/components/checkout/CustomCheckoutFieldsForm';
import { shouldShowTosCheckbox } from '@/lib/checkout/tos-display';
import { useCaptcha } from '@/hooks/useCaptcha';
import { validateCheckoutModules } from '@/lib/checkout-modules/validate';
import { validateCustomFieldValues } from '@/lib/validations/custom-checkout-fields';
import type { FieldError } from '@/lib/checkout-modules/registry';
import type { Product } from '@/types';
import type { CustomFieldDefinition, CustomFieldValues } from '@/lib/validations/custom-checkout-fields';
export default function BankTransferForm({ collectTermsOfService, isGuest = true, disabled, onModuleErrors, product, email, lockedEmail, onEmailChange, moduleValues, sessionId, bumpIds, couponCode, fields, values, onValuesChange }: {
  collectTermsOfService: boolean; isGuest?: boolean;
  disabled: boolean; onModuleErrors(errors: FieldError[]): void;
  product: Product; email: string; lockedEmail?: boolean; onEmailChange(value: string): void; moduleValues: Record<string, unknown>; sessionId: string | null;
  bumpIds: string[]; couponCode?: string; fields: CustomFieldDefinition[]; values: CustomFieldValues; onValuesChange(value: CustomFieldValues): void;
}) {
  const t = useTranslations('bankTransfer'), ct = useTranslations('checkout'), locale = useLocale(), captcha = useCaptcha();
  const router = useRouter();
  const showTos = shouldShowTosCheckbox(collectTermsOfService, isGuest);
  const [busy, setBusy] = useState(false), [accepted, setAccepted] = useState(false), [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (disabled || !captcha.token || busy || (showTos && !accepted)) return;
    const modules = validateCheckoutModules(product.checkout_profile, moduleValues, { locale, currency: product.currency, termsAccepted: accepted });
    onModuleErrors(modules.success ? [] : modules.errors);
    if (!modules.success || !validateCustomFieldValues(fields, values, { requireAll: true }).ok) { setError(ct('profile.fixFields')); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/orders/bank-transfer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        productId: product.id, email, moduleValues, sessionId: sessionId ?? undefined, bumpProductIds: bumpIds, couponCode,
        customFieldValues: values, termsAccepted: accepted, captchaToken: captcha.token, locale,
      }) });
      const result = await response.json();
      if (!response.ok) { setError(t(response.status === 429 ? 'limit' : 'orderError')); captcha.reset(); setBusy(false); return; }
      router.push(`${locale === 'pl' ? '/pl' : ''}/order/${encodeURIComponent(result.orderId)}/transfer?token=${encodeURIComponent(result.token)}`);
    } catch { setError(t('orderError')); captcha.reset(); setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-4 mt-4">
    <label className="block">Email<input type="email" required readOnly={lockedEmail} value={email} onChange={e => onEmailChange(e.target.value)} className="block w-full rounded-lg border border-sf-border bg-sf-input p-3" /></label>
    <CustomCheckoutFieldsForm fields={fields} values={values} onChange={onValuesChange} disabled={busy} />
    {showTos && <label className="flex gap-2"><input type="checkbox" required checked={accepted} onChange={e => setAccepted(e.target.checked)} /><span>{ct('iAgree')} <a className="underline" href={`${locale === 'pl' ? '/pl' : ''}/terms`} target="_blank" rel="noreferrer">{ct('termsOfService')}</a> {ct('and')} <a className="underline" href={`${locale === 'pl' ? '/pl' : ''}/privacy`} target="_blank" rel="noreferrer">{ct('privacyPolicy')}</a></span></label>}
    <AltchaWidget onVerify={captcha.onVerify} onError={captcha.onError} onTimeout={captcha.onTimeout} resetTrigger={captcha.resetTrigger} />
    {error && <p role="alert" className="text-sf-danger">{error}</p>}
    <button disabled={disabled || busy || !captcha.token || (showTos && !accepted)} className="w-full rounded-xl bg-sf-accent-bg text-sf-inverse p-4 font-semibold disabled:opacity-50">{busy ? ct('processing') : t('placeOrder')}</button>
  </form>;
}
