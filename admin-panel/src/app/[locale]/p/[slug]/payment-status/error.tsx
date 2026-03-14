'use client';

import { useEffect } from 'react';

export default function PaymentStatusError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[payment-status] Error boundary caught:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-sf-deep flex items-center justify-center">
      <div className="max-w-md mx-auto bg-sf-raised/80 border border-sf-border rounded-2xl p-8 text-center">
        <div className="w-16 h-16 bg-sf-warning/20 border border-sf-warning/30 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-sf-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.232 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-sf-heading mb-2">
          Payment Verification Error
        </h1>
        <p className="text-sf-muted mb-6">
          We encountered an error while verifying your payment. Your payment may have been processed successfully.
          Please check your email for confirmation or contact support.
        </p>
        <button
          onClick={reset}
          className="px-6 py-2 bg-sf-primary text-white rounded-lg hover:bg-sf-primary/90 transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
