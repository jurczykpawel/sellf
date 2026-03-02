'use client';

import { Product } from '@/types';
import { ExpressCheckoutConfig } from '@/types/payment-config';
import type { TaxMode } from '@/lib/actions/shop-config';
import FreeProductForm from './FreeProductForm';
import PaidProductForm from './PaidProductForm';
import WaitlistForm from '@/components/WaitlistForm';
import FloatingToolbar from '@/components/FloatingToolbar';
import { DemoResetCountdown } from '@/components/DemoCheckoutNotice';
import SellfBranding from '@/components/SellfBranding';

interface ProductPurchaseViewProps {
  product: Product;
  paymentMethodOrder?: string[];
  expressCheckoutConfig?: ExpressCheckoutConfig;
  licenseValid?: boolean;
  taxMode?: TaxMode;
}

type UnavailableReason = 'not_started' | 'expired' | 'inactive' | null;

function getProductUnavailableReason(product: Product): UnavailableReason {
  const now = new Date();

  // Check temporal availability first
  if (product.available_from) {
    const availableFrom = new Date(product.available_from);
    if (now < availableFrom) {
      return 'not_started';
    }
  }

  if (product.available_until) {
    const availableUntil = new Date(product.available_until);
    if (now > availableUntil) {
      return 'expired';
    }
  }

  // Check is_active flag
  if (!product.is_active) {
    return 'inactive';
  }

  return null; // Product is available
}

export default function ProductPurchaseView({ product, paymentMethodOrder, expressCheckoutConfig, licenseValid, taxMode }: ProductPurchaseViewProps) {
  const unavailableReason = getProductUnavailableReason(product);

  // Show waitlist form if product is unavailable AND waitlist is enabled
  const showWaitlist = unavailableReason !== null && product.enable_waitlist;

  return (
    <div>
      {/* Unified Floating Toolbar */}
      <FloatingToolbar position="top-right" />
      <DemoResetCountdown />

      {showWaitlist ? (
        <WaitlistForm product={product} unavailableReason={unavailableReason} />
      ) : product.price === 0 && !product.allow_custom_price ? (
        <FreeProductForm product={product} />
      ) : (
        <PaidProductForm product={product} paymentMethodOrder={paymentMethodOrder} expressCheckoutConfig={expressCheckoutConfig} taxMode={taxMode} />
      )}

      {/* Sellf branding — hidden when a valid license is active */}
      {!licenseValid && <SellfBranding />}
    </div>
  );
}
