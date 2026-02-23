import { useTranslations } from 'next-intl';
import FloatingToolbar from '@/components/FloatingToolbar';

export default function ProductLoadingState() {
  const t = useTranslations('productView');

  return (
    <div className="flex justify-center items-center min-h-screen bg-gf-deep">
      {/* Unified Floating Toolbar */}
      <FloatingToolbar position="top-right" />

      <div className="max-w-4xl mx-auto p-8 bg-gf-raised/80 border border-gf-border rounded-xl shadow-2xl">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-gf-accent border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gf-heading">{t('loading')}</p>
        </div>
      </div>
    </div>
  );
}
