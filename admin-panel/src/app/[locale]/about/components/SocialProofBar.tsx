import { getTranslations } from 'next-intl/server';
import { ExternalLink, ShieldCheck, User, CreditCard, Code2 } from 'lucide-react';
import { Reveal } from '@/components/motion/Reveal';
import { SELLF_GITHUB_URL } from '@/lib/constants';

export async function SocialProofBar() {
  const t = await getTranslations('landing');

  const proof = [
    { Icon: Code2, text: t('socialProof.githubLine'), href: SELLF_GITHUB_URL },
    { Icon: ShieldCheck, text: t('socialProof.testsLine') },
    { Icon: User, text: t('socialProof.founderLine') },
    { Icon: CreditCard, text: t('socialProof.stripeLine') },
  ];

  return (
    <section
      className="relative py-12 overflow-hidden"
      data-landing-section="social-proof"
    >
      <div
        className="absolute inset-0"
        style={{
          background: [
            'radial-gradient(ellipse at 30% 50%, var(--sf-accent-glow) 0%, transparent 70%)',
            'radial-gradient(ellipse at 70% 50%, rgba(0,170,255,0.08) 0%, transparent 60%)',
            'var(--sf-bg-base)',
          ].join(', '),
        }}
      />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <Reveal className="text-center mb-6">
          <p className="text-sm font-medium text-sf-muted tracking-[0.08em] uppercase">
            {t('socialProof.headline')}
          </p>
        </Reveal>

        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          {proof.map(({ Icon, text, href }, i) => {
            const inner = (
              <span className="flex items-start gap-3 rounded-xl border border-sf-border bg-sf-raised/40 px-4 py-3 hover:border-sf-border-accent transition-colors">
                <Icon
                  className="h-4 w-4 mt-0.5 text-sf-accent flex-shrink-0"
                  aria-hidden="true"
                />
                <span className="text-sf-body leading-relaxed">{text}</span>
              </span>
            );
            if (href) {
              return (
                <li key={i}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded-xl"
                  >
                    {inner}
                  </a>
                </li>
              );
            }
            return <li key={i}>{inner}</li>;
          })}
        </ul>

        <Reveal className="text-center mt-8" animation="fade-up" delay={200}>
          <a
            href="https://demo.sellf.app/login"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-sf-accent-soft border border-sf-border-accent hover:bg-sf-accent-med text-sf-heading rounded-full px-6 py-3 text-sm font-bold transition-[background-color,border-color] duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
          >
            {t('demo.cta')}
            <ExternalLink className="h-4 w-4" />
          </a>
          <p className="text-xs text-sf-muted mt-2">{t('demo.stripeTestMode')}</p>
        </Reveal>
      </div>
    </section>
  );
}
