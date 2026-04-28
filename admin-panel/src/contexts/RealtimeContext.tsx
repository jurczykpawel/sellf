'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import NewOrderNotification from '@/components/dashboard/NewOrderNotification';

interface NewOrder {
  amount: string;
  currency: string;
  id: string;
}

interface RealtimeContextProps {
  addRefreshListener: (listener: () => void) => void;
  removeRefreshListener: (listener: () => void) => void;
}

const RealtimeContext = createContext<RealtimeContextProps | undefined>(undefined);

export const useRealtime = () => {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error('useRealtime must be used within a RealtimeProvider');
  }
  return context;
};

export const RealtimeProvider = ({ children }: { children: ReactNode }) => {
  const [newOrder, setNewOrder] = useState<NewOrder | null>(null);
  const listenersRef = React.useRef<(() => void)[]>([]);

  const addRefreshListener = useCallback((listener: () => void) => {
    listenersRef.current.push(listener);
  }, []);

  const removeRefreshListener = useCallback((listener: () => void) => {
    listenersRef.current = listenersRef.current.filter(l => l !== listener);
  }, []);

  // Stable context value
  const contextValue = React.useMemo(() => ({
    addRefreshListener,
    removeRefreshListener
  }), [addRefreshListener, removeRefreshListener]);

  useEffect(() => {
    // Unique channel name avoids collisions when React 19 Strict Mode double-invokes the effect
    // (or HMR remounts) — supabase-js 2.105 rejects re-binding `.on()` to an already-subscribed channel.
    const channelName = `global-admin-realtime-${Math.random().toString(36).slice(2)}`;
    let cancelled = false;
    let channel: ReturnType<Awaited<ReturnType<typeof createClient>>['channel']> | null = null;

    const setupSubscription = async () => {
      const client = await createClient();
      if (cancelled) return;

      channel = client
        .channel(channelName)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'payment_transactions' },
          (payload: { new?: { status?: string; amount?: number; currency?: string; id?: string } }) => {
            if (payload.new?.status === 'completed') {
              listenersRef.current.forEach(listener => listener());

              const amount = ((payload.new.amount ?? 0) / 100).toLocaleString('en-US', {
                style: 'currency',
                currency: payload.new.currency || 'USD',
              });
              setNewOrder({
                amount,
                currency: payload.new.currency || 'USD',
                id: payload.new.id || Date.now().toString(),
              });
            }
          }
        )
        .subscribe();
    };

    setupSubscription();

    return () => {
      cancelled = true;
      channel?.unsubscribe();
    };
  }, []);

  return (
    <RealtimeContext.Provider value={contextValue}>
      {children}
      {newOrder && (
        <NewOrderNotification
          key={newOrder.id}
          amount={newOrder.amount}
          currency={newOrder.currency}
          onClose={() => setNewOrder(null)}
        />
      )}
    </RealtimeContext.Provider>
  );
};
