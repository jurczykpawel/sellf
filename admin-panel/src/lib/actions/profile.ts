'use server'

import { createClient } from '@/lib/supabase/server'
import { validateProfile, type ProfileInput } from '@/lib/validations/profile'
import { isDemoMode, DEMO_MODE_ERROR } from '@/lib/demo-guard'

export async function getProfile() {
  const supabase = await createClient()
  
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (error) {
    console.error('Failed to fetch profile:', error.message)
    return null
  }

  return data
}

export async function updateProfile(values: ProfileInput) {
  if (isDemoMode()) return { error: DEMO_MODE_ERROR }
  const supabase = await createClient()
  
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { error: 'Not authenticated' }
  }

  // Validate input
  const validation = validateProfile(values)
  if (!validation.isValid) {
    return { error: 'Invalid fields', details: validation.errors }
  }

  // Computed full name if not provided
  const fullName = values.full_name || 
    (values.first_name && values.last_name ? `${values.first_name} ${values.last_name}` : null)

  const { error } = await supabase
    .from('profiles')
    .update({
      ...values,
      full_name: fullName,
      updated_at: new Date().toISOString()
    })
    .eq('id', user.id)

  if (error) {
    return { error: error.message }
  }

  return { success: true }
}
