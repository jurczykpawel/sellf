import { getTranslations } from 'next-intl/server';

export async function SocialProofBar() {
  const t = await getTranslations('landing');

  const stats = [
    { value: '100%', label: t('socialProof.openSource') },
    { value: '$0', label: t('socialProof.monthlyFees') },
    { value: '∞', label: t('socialProof.products') },
    { value: 'MIT', label: t('socialProof.license') },
  ];

  return (
    <section className="py-12 bg-gradient-to-r from-[#00AAFF] via-sky-500 to-blue-600 relative overflow-hidden">
      <div className="absolute inset-0 bg-black/10" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {stats.map((stat) => (
            <div key={stat.value}>
              <div className="text-4xl md:text-5xl font-black text-white mb-2">
                {stat.value}
              </div>
              <div className="text-sm md:text-base font-medium text-sky-100">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
