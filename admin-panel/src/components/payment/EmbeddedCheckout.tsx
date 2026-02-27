'use client';

import { useTranslations } from 'next-intl';
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { fetchClientSecret } from '@/lib/actions/checkout';
import { useAuth } from '@/contexts/AuthContext';
import { Product } from '@/types';
import { embeddedCheckoutOptions } from '@/lib/stripe/config';
import { useConfig } from '@/components/providers/config-provider';

interface EmbeddedCheckoutComponentProps {
  product: Product;
  email?: string;
}

export default function EmbeddedCheckoutComponent({ product, email }: EmbeddedCheckoutComponentProps) {
  const t = useTranslations('checkout');
  const { user } = useAuth();
  const config = useConfig();
  
  const stripePromise = loadStripe(config.stripePublishableKey);
  
  // Create fetchClientSecret function that Stripe will call
  const fetchClientSecretForProduct = async () => {
    return fetchClientSecret({
      productId: product.id,
      email: email || user?.email,
    });
  };

  return (
    <div className="bg-white/10 backdrop-blur-md rounded-lg p-6 border border-white/20">
      <h2 className="text-xl font-semibold text-white mb-4">{t('completeYourPurchase')}</h2>
      <EmbeddedCheckoutProvider
        stripe={stripePromise}
        options={embeddedCheckoutOptions(fetchClientSecretForProduct)}
      >
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
