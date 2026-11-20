'use client';
/** Keep the open buyer receipt current at its deadline and after seller updates. */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function TransferStatusRefresh({ status, releaseAt }: { status: string; releaseAt: string | null }) {
  const router = useRouter();
  useEffect(() => {
    if (status !== 'awaiting_payment') return;
    const refresh = () => router.refresh();
    const interval = window.setInterval(refresh, 15000);
    const remaining = releaseAt ? Date.parse(releaseAt) - Date.now() : NaN;
    const deadline = remaining > 0 ? window.setTimeout(refresh, Math.min(remaining, 2147483647)) : undefined;
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(deadline);
      window.removeEventListener('focus', refresh);
    };
  }, [router, status, releaseAt]);
  return null;
}
