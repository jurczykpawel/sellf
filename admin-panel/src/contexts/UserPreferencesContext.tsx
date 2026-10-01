'use client';

import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { updateUserPreferences } from '@/lib/actions/preferences';

export type CurrencyViewMode = 'grouped' | 'converted';

interface UserPreferencesContextProps {
  hideValues: boolean;
  toggleHideValues: () => Promise<void>;
  displayCurrency: string | null;
  currencyViewMode: CurrencyViewMode;
  /**
   * Sets the view mode and display currency together in a single optimistic
   * update and a single `updateUserPreferences` call. These two fields are
   * always changed together from the currency selector (mode + currency are
   * one logical choice — "grouped" or "convert to X") — saving them as two
   * sequential awaited calls left the UI (and the dropdown's open/closed
   * state) in an inconsistent, flickering in-between state while the first
   * save was still in flight. See CurrencySelector.tsx `handleSelect`.
   */
  setCurrencyPreferences: (mode: CurrencyViewMode, currency: string | null) => Promise<void>;
}

const UserPreferencesContext = createContext<UserPreferencesContextProps | undefined>(undefined);

export const useUserPreferences = () => {
  const context = useContext(UserPreferencesContext);
  if (!context) {
    throw new Error('useUserPreferences must be used within a UserPreferencesProvider');
  }
  return context;
};

export const UserPreferencesProvider = ({
  children,
  initialHideValues = false,
  initialDisplayCurrency = null,
  initialCurrencyViewMode = 'grouped' as CurrencyViewMode
}: {
  children: ReactNode;
  initialHideValues?: boolean;
  initialDisplayCurrency?: string | null;
  initialCurrencyViewMode?: CurrencyViewMode;
}) => {
  const [hideValues, setHideValues] = useState(initialHideValues);
  const [displayCurrency, setDisplayCurrencyState] = useState<string | null>(initialDisplayCurrency);
  const [currencyViewMode, setCurrencyViewModeState] = useState<CurrencyViewMode>(initialCurrencyViewMode);

  const toggleHideValues = useCallback(async () => {
    const newValue = !hideValues;
    setHideValues(newValue); // Optimistic update

    try {
      await updateUserPreferences({ hideValues: newValue });
    } catch (error) {
      console.error('Failed to save preference:', error);
      setHideValues(!newValue); // Revert on error
    }
  }, [hideValues]);

  const setCurrencyPreferences = useCallback(async (mode: CurrencyViewMode, currency: string | null) => {
    const previousMode = currencyViewMode;
    const previousCurrency = displayCurrency;

    // Optimistic update — apply both fields together so there is no render in
    // between where the mode has changed but the currency hasn't (or vice versa).
    setCurrencyViewModeState(mode);
    setDisplayCurrencyState(currency);

    try {
      await updateUserPreferences({ currencyViewMode: mode, displayCurrency: currency });
    } catch (error) {
      console.error('Failed to save currency preferences:', error);
      setCurrencyViewModeState(previousMode); // Revert on error
      setDisplayCurrencyState(previousCurrency);
    }
  }, [currencyViewMode, displayCurrency]);

  return (
    <UserPreferencesContext.Provider value={{
      hideValues,
      toggleHideValues,
      displayCurrency,
      currencyViewMode,
      setCurrencyPreferences
    }}>
      {children}
    </UserPreferencesContext.Provider>
  );
};
