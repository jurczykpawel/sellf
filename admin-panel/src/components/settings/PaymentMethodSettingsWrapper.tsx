'use client';

import { Component, ReactNode, Suspense } from 'react';
import { useTranslations } from 'next-intl';
import PaymentMethodSettings from './PaymentMethodSettings';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

function ErrorFallback({ error }: { error: Error | null }) {
  const tCommon = useTranslations('common');
  return (
    <div className="bg-gf-danger-soft border border-gf-danger/30 rounded-lg p-6">
      <h3 className="text-xl font-semibold text-gf-danger mb-2">
        Error Loading Payment Method Settings
      </h3>
      <p className="text-gf-danger">
        {error?.message || tCommon('unexpectedError')}
      </p>
      <pre className="mt-4 p-2 bg-gf-danger-soft rounded text-xs overflow-auto">
        {error?.stack}
      </pre>
    </div>
  );
}

class PaymentMethodErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('PaymentMethodSettings Error:', error);
    console.error('Error Info:', errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}

export default function PaymentMethodSettingsWrapper() {
  return (
    <PaymentMethodErrorBoundary>
      <Suspense fallback={<div className="p-6 bg-gf-base rounded-lg">Loading Payment Method Settings...</div>}>
        <PaymentMethodSettings />
      </Suspense>
    </PaymentMethodErrorBoundary>
  );
}
