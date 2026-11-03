'use client';

/** Product checkout profile editor. @see @/lib/checkout-modules/profile */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getGUSConfig } from '@/lib/actions/gus-config';
import { parseCheckoutProfile } from '@/lib/checkout-modules/profile';
import TutorialHelpButton from '@/components/tutorials/TutorialHelpButton';
import TutorialTrigger from '@/components/tutorials/TutorialTrigger';
import type { Dispatch, SetStateAction } from 'react';
import type { CheckoutProfile } from '@/lib/checkout-modules/profile';
import type { ProductFormData } from '@/components/ProductFormModal/types';

type Module = CheckoutProfile['modules'][number];
const DEFAULTS: Module[] = [{ id: 'buyer', types: ['person', 'organization'], gus: false }, { id: 'recipient', for: ['organization'] }, { id: 'phone', required: false }, { id: 'quantity', min: 1, max: 100, mode: 'checkout' }, { id: 'participants', required: true, prefill_from_buyer: true }];
const MODULE_TOUR: Partial<Record<Module['id'], string>> = { buyer: 'profile-buyer', recipient: 'profile-recipient', quantity: 'profile-quantity', participants: 'profile-participants' };
export function CheckoutProfileSection({ formData, setFormData }: { formData: ProductFormData; setFormData: Dispatch<SetStateAction<ProductFormData>> }) {
  const t = useTranslations('checkoutProfile');
  const bt = useTranslations('bankTransfer');
  const [gusEnabled, setGusEnabled] = useState(false);
  useEffect(() => { let active = true; void getGUSConfig().then(r => { if (active) setGusEnabled(r.success && !!r.data?.enabled && !!r.data?.hasKey); }); return () => { active = false; }; }, []);
  const profile = formData.checkout_profile;
  const update = (modules: Module[]) => setFormData(prev => ({ ...prev, checkout_profile: { v: 1, modules } }));
  const change = (entry: Module, patch: Record<string, unknown>) => update((profile?.modules ?? []).map(m => m.id === entry.id ? { ...m, ...patch } as Module : m));
  const toggle = (entry: Module, enabled: boolean) => update(DEFAULTS.flatMap(m => m.id === entry.id ? (enabled ? [m] : []) : profile?.modules.filter(v => v.id === m.id) ?? []));
  const result = profile ? parseCheckoutProfile(profile, { ...formData, is_bundle: formData.is_bundle }, gusEnabled) : null;
  const checkbox = (label: string, checked: boolean, onChange: (value: boolean) => void, disabled = false, tour?: string) => <label data-tour={tour} className="flex items-center gap-2"><input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />{label}</label>;
  return <section className="space-y-3" aria-label={t('title')}>
    <TutorialTrigger id="b2b-checkout-profile" auto={!!profile} />
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-medium text-sf-heading">{t('title')}</h4><TutorialHelpButton id="b2b-checkout-profile" /></div>
    {checkbox(t('enabled'), !!profile, enabled => setFormData(prev => ({ ...prev, checkout_profile: enabled ? { v: 1, modules: [DEFAULTS[0]] } : null })), false, 'profile-enable')}
    {profile && DEFAULTS.map(defaultModule => {
      const entry = profile.modules.find(m => m.id === defaultModule.id);
      return <fieldset key={defaultModule.id} data-tour={MODULE_TOUR[defaultModule.id]} className="space-y-2 border border-sf-border rounded-lg p-3">
        <legend>{t(defaultModule.id)}</legend>
        {checkbox(t(defaultModule.id), !!entry, enabled => toggle(defaultModule, enabled))}
        {entry?.id === 'buyer' && <>
          {(['person', 'organization'] as const).map(type => <div key={type}>{checkbox(t(type), entry.types.includes(type), enabled => change(entry, { types: enabled ? [...entry.types, type] : entry.types.filter(v => v !== type) }))}</div>)}
          {(['person', 'organization'] as const).map(type => <div key={`transfer-${type}`}>{checkbox(`${bt('title')}: ${t(type)}`, entry.bank_transfer_for?.includes(type) ?? false, enabled => change(entry, { bank_transfer_for: enabled ? [...(entry.bank_transfer_for ?? []), type] : (entry.bank_transfer_for ?? []).filter(v => v !== type) }), !entry.types.includes(type))}</div>)}
          {checkbox(t('gus'), entry.gus, enabled => change(entry, { gus: enabled }), !gusEnabled && !entry.gus)}
        </>}
        {entry?.id === 'recipient' && <p className="text-sm text-sf-muted">{t('recipientHelp')}</p>}
        {(entry?.id === 'phone' || entry?.id === 'participants') && checkbox(`${t(entry.id)}: ${t('required')}`, entry.required, enabled => change(entry, { required: enabled }))}
        {entry?.id === 'phone' && <p className="text-sm text-sf-muted">{t('phoneHelp')}</p>}
        {entry?.id === 'participants' && entry.required && checkbox(t('allowLater'), !!entry.allow_later, enabled => change(entry, { allow_later: enabled }))}
        {entry?.id === 'participants' && checkbox(t('prefill'), entry.prefill_from_buyer, enabled => change(entry, { prefill_from_buyer: enabled }))}
        {entry?.id === 'quantity' && <div className="flex flex-wrap gap-3">
          {(['min', 'max'] as const).map(key => <label key={key}>{t(key)}<input className="block border border-sf-border rounded p-2 w-24" type="number" min={1} max={100} value={entry[key]} onChange={e => change(entry, { [key]: Number(e.target.value) })} /></label>)}
          <label>{t('mode')}<select className="block border border-sf-border rounded p-2" value={entry.mode} onChange={e => change(entry, { mode: e.target.value })}>{(['hidden', 'checkout', 'product_page'] as const).map(mode => <option key={mode} value={mode}>{t(mode)}</option>)}</select></label>
        </div>}
      </fieldset>;
    })}
    {result && !result.success && <ul role="alert" className="text-sm text-sf-danger">{result.error.issues.map((issue, i) => <li key={i}>{t.has(`errors.${issue.message}`) ? t(`errors.${issue.message}`) : t('errors.invalid')}</li>)}</ul>}
  </section>;
}
