'use client';

/**
 * Purchase attribution settings: click-id retention and channel rules.
 * Default rules can be switched off; own rules are added on top (lower priority number wins).
 * @see src/lib/actions/attribution.ts
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { getAttributionConfig, saveAttributionConfig } from '@/lib/actions/attribution';
import type { AttributionConfig, AttributionRuleInput } from '@/lib/actions/attribution';

const FIELDS: AttributionRuleInput['field'][] = ['source', 'medium', 'campaign', 'referrer_host', 'click_id_type'];
const OPERATORS: AttributionRuleInput['operator'][] = ['in', 'equals', 'contains', 'host_in', 'exists'];
const input = 'border border-sf-border-medium bg-sf-input px-2 py-1 text-sm text-sf-heading';

export default function AttributionSettings() {
  const t = useTranslations('settings.attribution');
  const [config, setConfig] = useState<AttributionConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    getAttributionConfig().then(result => { if (active && result.data) setConfig(result.data); });
    return () => { active = false; };
  }, []);

  if (!config) return null;
  const update = (index: number, patch: Partial<AttributionRuleInput>) =>
    setConfig({ ...config, rules: config.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)) });

  const save = async () => {
    setSaving(true);
    const result = await saveAttributionConfig(config);
    setSaving(false);
    if (result.success) toast.success(t('saved'));
    else toast.error(result.error ?? t('saveError'));
  };

  return (
    <div className="bg-sf-base border-2 border-sf-border-medium p-6">
      <h2 className="text-xl font-semibold text-sf-heading mb-2">{t('title')}</h2>
      <p className="text-sm text-sf-body mb-4">{t('description')}</p>

      <label className="flex items-center gap-3 text-sm text-sf-heading mb-6">
        {t('retention')}
        <input type="number" min={1} max={365} className={`${input} w-24`} value={config.click_id_retention_days}
          onChange={e => setConfig({ ...config, click_id_retention_days: Number(e.target.value) })} />
        <span className="text-sf-muted">{t('days')}</span>
      </label>

      <h3 className="text-sm font-medium text-sf-heading mb-2">{t('rules')}</h3>
      <p className="text-xs text-sf-muted mb-3">{t('rulesHelp')}</p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-sf-muted">
              <th className="pr-2 py-1">{t('active')}</th><th className="pr-2">{t('priority')}</th><th className="pr-2">{t('channel')}</th>
              <th className="pr-2">{t('field')}</th><th className="pr-2">{t('operator')}</th><th className="pr-2">{t('value')}</th><th />
            </tr>
          </thead>
          <tbody>
            {config.rules.map((rule, index) => (
              <tr key={rule.id ?? `new-${index}`} className="border-t border-sf-border-subtle">
                <td className="pr-2 py-1">
                  <input type="checkbox" checked={rule.is_active} aria-label={t('active')} onChange={e => update(index, { is_active: e.target.checked })} />
                </td>
                {rule.is_default ? (
                  <>
                    <td className="pr-2 text-sf-muted">{rule.priority}</td>
                    <td className="pr-2">{rule.channel}</td>
                    <td className="pr-2 text-sf-muted">{rule.field}</td>
                    <td className="pr-2 text-sf-muted">{rule.operator}</td>
                    <td className="pr-2 text-sf-muted break-all">{rule.value ?? '—'}</td>
                    <td className="text-xs text-sf-muted">{t('default')}</td>
                  </>
                ) : (
                  <>
                    <td className="pr-2"><input type="number" className={`${input} w-20`} value={rule.priority} onChange={e => update(index, { priority: Number(e.target.value) })} /></td>
                    <td className="pr-2"><input className={`${input} w-32`} value={rule.channel} onChange={e => update(index, { channel: e.target.value })} /></td>
                    <td className="pr-2">
                      <select className={input} value={rule.field} onChange={e => update(index, { field: e.target.value as AttributionRuleInput['field'] })}>
                        {FIELDS.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </td>
                    <td className="pr-2">
                      <select className={input} value={rule.operator} onChange={e => update(index, { operator: e.target.value as AttributionRuleInput['operator'] })}>
                        {OPERATORS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                    <td className="pr-2"><input className={`${input} w-48`} value={rule.value ?? ''} disabled={rule.operator === 'exists'} onChange={e => update(index, { value: e.target.value })} /></td>
                    <td>
                      <button type="button" className="text-xs text-sf-danger" onClick={() => setConfig({ ...config, rules: config.rules.filter((_, i) => i !== index) })}>
                        {t('remove')}
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex gap-3">
        <button type="button" className="border border-sf-border-medium px-3 py-1.5 text-sm text-sf-heading"
          onClick={() => setConfig({ ...config, rules: [...config.rules, { priority: 10, channel: '', field: 'source', operator: 'in', value: '', is_active: true }] })}>
          {t('addRule')}
        </button>
        <button type="button" disabled={saving} className="bg-sf-accent-bg px-4 py-1.5 text-sm text-white disabled:opacity-50" onClick={save}>
          {saving ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  );
}
