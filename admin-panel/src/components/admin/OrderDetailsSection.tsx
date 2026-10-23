'use client';

/** Checkout data inside the existing admin transaction details view. @see ./PaymentTransactionsTable.tsx */
import { useTranslations } from 'next-intl';
import { readOrderDetails } from '@/lib/checkout-modules/order-details';
import type { DisplayCustomField } from '@/lib/format-custom-fields';

interface OrderDetailsSectionProps {
  details: unknown;
  customFields: DisplayCustomField[];
}
export default function OrderDetailsSection({ details, customFields }: OrderDetailsSectionProps) {
  const t = useTranslations('admin.payments.orderDetails');
  const d = readOrderDetails(details);
  const hasModules = d.buyer?.type || d.recipient || d.phone || d.quantity || d.participants || d.details_missing;
  if (!hasModules && customFields.length === 0) return null;
  const party = (value: NonNullable<typeof d.buyer>, isBuyer = false) => (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {isBuyer && value.type && <><dt>{t('type')}</dt><dd>{t(value.type)}</dd></>}
      {isBuyer && (value.first_name || value.last_name) && <><dt>{t('name')}</dt><dd>{[value.first_name, value.last_name].filter(Boolean).join(' ')}</dd></>}
      {isBuyer && value.email && <><dt>{t('email')}</dt><dd>{value.email}</dd></>}
      {value.company_name && <><dt>{t('company')}</dt><dd>{value.company_name}</dd></>}
      {value.nip && <><dt>{t('nip')}</dt><dd>{value.nip}</dd></>}
      {value.address && <><dt>{t('address')}</dt><dd>{value.address}</dd></>}
      {(value.postal_code || value.city || value.country) && <><dt>{t('city')}</dt><dd>{[value.postal_code, value.city, value.country].filter(Boolean).join(' ')}</dd></>}
    </dl>
  );
  return (
    <section className="mt-5 border border-sf-border bg-sf-base/60 rounded-xl overflow-hidden" aria-label={t('title')}>
      <h3 className="px-4 py-3 bg-sf-float/60 text-sm font-semibold text-sf-heading">{t('title')}</h3>
      <div className="p-4 space-y-4 text-sf-heading break-words">
        {d.details_missing && <p role="alert" className="text-sf-warning">{t('missing')}</p>}
        {hasModules && d.buyer && <div><h4 className="font-semibold mb-2">{t('buyer')}</h4>{party(d.buyer, true)}</div>}
        {d.recipient?.differs && <div><h4 className="font-semibold mb-2">{t('recipient')}</h4>{party(d.recipient)}</div>}
        {d.phone?.value && <p>{t('phone')}: {d.phone.value}</p>}
        {d.quantity && <p>{t('quantity')}: {d.quantity.value}</p>}
        {d.participants && d.participants.people.length > 0 && <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-left">
            <caption className="text-left font-semibold mb-2">{t('participants')}</caption>
            <thead><tr>{['firstName', 'lastName', 'email'].map(key => <th key={key} scope="col" className="p-2">{t(key)}</th>)}</tr></thead>
            <tbody>{d.participants.people.map((p, i) => <tr key={i} className="border-t border-sf-border"><td className="p-2">{p.first_name}</td><td className="p-2">{p.last_name}</td><td className="p-2">{p.email}</td></tr>)}</tbody>
          </table>
        </div>}
        {customFields.length > 0 && <dl data-testid="custom-field-values" className="space-y-2">
          {customFields.map(field => <div key={field.id}><dt className="text-sf-muted">{field.label}</dt><dd className="whitespace-pre-wrap">{field.value}</dd></div>)}
        </dl>}
      </div>
    </section>
  );
}
