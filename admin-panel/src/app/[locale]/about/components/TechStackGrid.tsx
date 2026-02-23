import { getTranslations } from 'next-intl/server';

const techs = ['nextjs', 'react', 'supabase', 'stripe', 'tailwind', 'typescript', 'docker', 'postgresql', 'bunny'] as const;

export async function TechStackGrid() {
  const t = await getTranslations('landing');

  return (
    <section className="py-24 md:py-32 bg-white dark:bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4">
            {t('techStack.title')}
          </h2>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
            {t('techStack.subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {techs.map((tech) => (
            <div
              key={tech}
              className="p-6 rounded-2xl bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 text-center hover:border-[#00AAFF]/50 hover:shadow-lg transition-all duration-300"
            >
              <p className="text-base font-bold text-gray-900 dark:text-white mb-1">
                {t(`techStack.${tech}.name`)}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t(`techStack.${tech}.desc`)}
              </p>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <a
            href="https://github.com/jurczykpawel/gateflow"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-[#00AAFF] hover:text-sky-600 dark:hover:text-sky-300 transition-colors"
          >
            {t('techStack.viewStack')}
          </a>
        </div>
      </div>
    </section>
  );
}
