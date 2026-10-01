'use server';

import { createClient } from '@/lib/supabase/server';

export async function signOutAndRedirectToCheckout() {
  const supabase = await createClient();

  // Sign out the user
  await supabase.auth.signOut();

  // Note: We can't redirect from server action, so we'll return success
  // and let the client handle the redirect
  return { success: true };
}
