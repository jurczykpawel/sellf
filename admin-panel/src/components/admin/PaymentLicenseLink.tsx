'use client';
/** License action for the product and customer of this transaction. */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getPaymentLicenseDetails } from '@/lib/actions/payment-details';
import type { PaymentLicenseDetail } from '@/lib/actions/payment-details';

export default function PaymentLicenseLink({ transactionId }: { transactionId: string }) {
  const t = useTranslations('admin.payments.transactions');
  const [state, setState] = useState<{ id: string; data: PaymentLicenseDetail | null; error: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    getPaymentLicenseDetails(transactionId).then(r => { if (active) setState({ id: transactionId, data: r.data ?? null, error: !r.success }); })
      .catch(() => { if (active) setState({ id: transactionId, data: null, error: true }); });
    return () => { active = false; };
  }, [transactionId]);
  if (!state || state.id !== transactionId) return null;
  if (state.error) return <p role="status">{t('licenseError')}</p>;
  const d = state.data;
  if (!d) return null;
  const query = d.licenseId ? new URLSearchParams({ license: d.licenseId }) : new URLSearchParams({ email: d.email, product: d.productId });
  return <a href={`/dashboard/licenses?${query}`} className="text-sm font-medium text-sf-accent hover:text-sf-accent-hover underline">{t(d.licenseId ? 'licenseIssued' : 'issueLicense')}</a>;
}
