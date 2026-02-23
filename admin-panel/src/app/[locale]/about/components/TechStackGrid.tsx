import { getTranslations } from 'next-intl/server';
import { Reveal } from './motion/Reveal';
import { RevealGroup } from './motion/RevealGroup';

const techs = ['nextjs', 'supabase', 'stripe', 'tailwind', 'typescript', 'docker', 'postgresql', 'bunny'] as const;

export async function TechStackGrid() {
  const t = await getTranslations('landing');

  return (
    <section className="py-20 md:py-24 bg-gf-deep">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="text-center mb-12">
          <h3 className="text-3xl md:text-4xl font-bold text-gf-heading mb-3">
            {t('techStack.title')}
          </h3>
          <p className="text-lg text-gf-body max-w-2xl mx-auto">
            {t('techStack.subtitle')}
          </p>
        </Reveal>

        <RevealGroup className="flex flex-wrap justify-center gap-3" animation="scale" stagger={40}>
          {techs.map((tech) => (
            <div
              key={tech}
              className="group relative inline-flex flex-col items-center px-5 py-3 rounded-full bg-gf-raised/80 border border-gf-border hover:border-gf-border-accent hover:shadow-[var(--gf-shadow-accent)] transition-[border-color,box-shadow] duration-300"
            >
              <span className="text-sm font-bold text-gf-heading">
                {t(`techStack.${tech}.name`)}
              </span>
              <span className="text-[11px] text-gf-muted leading-tight">
                {t(`techStack.${tech}.desc`)}
              </span>
            </div>
          ))}
        </RevealGroup>

        <div className="text-center mt-8">
          <a
            href="https://github.com/jurczykpawel/gateflow"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-gf-accent hover:text-gf-accent-hover transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gf-accent rounded"
          >
            {t('techStack.viewStack')}
          </a>
        </div>
      </div>
    </section>
  );
}
