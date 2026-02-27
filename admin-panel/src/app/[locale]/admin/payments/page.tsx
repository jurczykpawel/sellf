// app/[locale]/admin/payments/page.tsx
// Admin payments management page

import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import PaymentsDashboard from '@/components/admin/PaymentsDashboard';

export default async function AdminPaymentsPage() {
  const t = await getTranslations('admin.payments');
  const supabase = await createClient();
  
  // Check if user is authenticated
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  if (authError || !user) {
    redirect('/login');
  }
  
  // Check if user is admin (you should implement your admin check logic)
  const { data: adminUser, error: adminError } = await supabase
    .from('admin_users')
    .select('id')
    .eq('user_id', user.id)
    .single();
  
  if (adminError || !adminUser) {
    redirect('/access-denied');
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            {t('title')}
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            {t('subtitle')}
          </p>
        </div>
        
        <Suspense fallback={
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-500 dark:text-gray-400">{t('loading')}</div>
          </div>
        }>
          <PaymentsDashboard />
        </Suspense>
      </div>
    </div>
  );
}
