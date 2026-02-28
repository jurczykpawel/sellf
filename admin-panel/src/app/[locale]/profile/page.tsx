import { getProfile } from '@/lib/actions/profile'
import ProfileForm from '@/components/ProfileForm'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import DashboardLayout from '@/components/DashboardLayout'

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const t = await getTranslations('profile')

  if (!user) {
    redirect('/login')
  }

  const profile = await getProfile()

  return (
    <DashboardLayout user={{ id: user.id, email: user.email! }}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gf-heading">
            {t('title')}
          </h1>
          <p className="mt-1 text-sm text-gf-muted">
            {t('subtitle')}
          </p>
        </div>

        <ProfileForm 
          initialData={profile || {}} 
          userEmail={user.email || ''} 
        />
      </div>
    </DashboardLayout>
  )
}