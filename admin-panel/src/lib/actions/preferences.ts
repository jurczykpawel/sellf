'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { isDemoMode, DEMO_MODE_ERROR } from '@/lib/demo-guard';

export async function updateUserPreferences(preferences: {
  hideValues?: boolean;
  displayCurrency?: string | null;
  currencyViewMode?: 'grouped' | 'converted';
}) {
  if (isDemoMode()) return { success: true }
  const supabase = await createClient();

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return { success: false, error: 'Unauthorized' };
  }

  // Merge with existing metadata
  const currentMeta = user.user_metadata || {};
  const newMeta = {
    ...currentMeta,
    preferences: {
      ...(currentMeta.preferences || {}),
      ...preferences
    }
  };

  const { error } = await supabase.auth.updateUser({
    data: newMeta
  });

  if (error) {
    console.error('[updateUserPreferences] Error:', error);
    return { success: false, error: 'Failed to update preferences' };
  }

  revalidatePath('/dashboard');
  return { success: true };
}
