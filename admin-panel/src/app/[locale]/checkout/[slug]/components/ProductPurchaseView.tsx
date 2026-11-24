'use client';

import { usesFreeProductForm } from '@/lib/checkout-modules/profile';
import WaitlistForm from '@/components/WaitlistForm';
import FloatingToolbar from '@/components/FloatingToolbar';
import { DemoResetCountdown } from '@/components/DemoCheckoutNotice';
import SellfBranding from '@/components/SellfBranding';
import SkipToContent from '@/components/ui/SkipToContent';
import type { Product } from '@/types';
import type { ExpressCheckoutConfig } from '@/types/payment-config';
import type { TaxMode } from '@/lib/actions/shop-config';
import type { BundleComponentSummary } from './BundleContentsPreview';
import FreeProductForm from './FreeProductForm';
import PaidProductForm from './PaidProductForm';

interface ProductPurchaseViewProps {
  product: Product;
  paymentMethodOrder?: string[];
  expressCheckoutConfig?: ExpressCheckoutConfig;
  licenseValid?: boolean;
  taxMode?: TaxMode;
  collectTermsOfService: boolean;
  collectInvoiceRecipient?: boolean;
  bundleComponents?: BundleComponentSummary[];
  layoutMode?: 'standalone' | 'embedded';
  afterCheckoutSlot?: React.ReactNode;
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

export default function ProductPurchaseView({ product, paymentMethodOrder, expressCheckoutConfig, licenseValid, taxMode, collectTermsOfService, collectInvoiceRecipient = false, bundleComponents, layoutMode = 'standalone', afterCheckoutSlot }: ProductPurchaseViewProps) {
  const unavailableReason = getProductUnavailableReason(product);

  // Show waitlist form if product is unavailable AND waitlist is enabled
  const showWaitlist = unavailableReason !== null && product.enable_waitlist;

  return (
    <div className="pt-20 sm:pt-0">
      <SkipToContent />
      {/* Unified Floating Toolbar */}
      <FloatingToolbar position="top-right" />
      <DemoResetCountdown />

      <div id="main-content" tabIndex={-1}>
      {showWaitlist ? (
        <WaitlistForm product={product} unavailableReason={unavailableReason} />
      ) : usesFreeProductForm(product) ? (
        <FreeProductForm product={product} collectTermsOfService={collectTermsOfService} bundleComponents={bundleComponents} />
      ) : (
        <PaidProductForm product={product} paymentMethodOrder={paymentMethodOrder} expressCheckoutConfig={expressCheckoutConfig} taxMode={taxMode} layoutMode={layoutMode} afterCheckoutSlot={afterCheckoutSlot} collectTermsOfService={collectTermsOfService} collectInvoiceRecipient={collectInvoiceRecipient} bundleComponents={bundleComponents} />
      )}

      </div>
      {/* Sellf branding — hidden when a valid license is active. In embedded
          mode the host template (e.g. tip-jar) takes responsibility for branding. */}
      {!licenseValid && layoutMode === 'standalone' && <SellfBranding />}
    </div>
  );
}
