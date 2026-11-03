'use server';

/** Which guided tutorials the signed-in user has already been shown. @see supabase/migrations/20261103193000_tutorial_progress.sql */
import { createClient } from '@/lib/supabase/server';
import { isTutorialId } from '@/lib/tutorials/registry';
import type { TutorialId } from '@/lib/tutorials/registry';

export type TutorialActionResult = { success: true } | { success: false; error: string };

export async function getSeenTutorials(): Promise<TutorialId[]> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase.from('tutorial_progress').select('tutorial_id');
    if (error || !data) return [];
    return data.map(row => row.tutorial_id).filter(isTutorialId);
  } catch (error) {
    console.error('[getSeenTutorials] Error:', error instanceof Error ? error.message : 'Unknown error');
    return [];
  }
}

export async function markTutorialSeen(tutorialId: string): Promise<TutorialActionResult> {
  if (!isTutorialId(tutorialId)) return { success: false, error: 'Unknown tutorial' };
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };
    const { error } = await supabase.from('tutorial_progress')
      .upsert({ user_id: user.id, tutorial_id: tutorialId }, { onConflict: 'user_id,tutorial_id', ignoreDuplicates: true });
    if (error) {
      console.error('[markTutorialSeen] Error:', error.message);
      return { success: false, error: 'Could not save tutorial progress' };
    }
    return { success: true };
  } catch (error) {
    console.error('[markTutorialSeen] Error:', error instanceof Error ? error.message : 'Unknown error');
    return { success: false, error: 'Could not save tutorial progress' };
  }
}
