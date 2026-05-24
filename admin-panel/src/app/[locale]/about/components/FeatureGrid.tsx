import { getTranslations, getLocale } from 'next-intl/server';
import {
  BarChart3, CreditCard, Repeat, Layers, Code, LayoutTemplate,
  Tag, Zap, Gift, Bell, Package, ShieldCheck, Clock, TrendingUp,
  RotateCcw, FileText, Lock, HandCoins, Banknote, Wand2, Undo2,
  Mail, BotMessageSquare,
} from 'lucide-react';
import { Reveal } from '@/components/motion/Reveal';
import { RevealGroup } from '@/components/motion/RevealGroup';
import { SnippetFlipCard } from '@/components/landing-fx';
import { FEATURE_KEYS, type FeatureKey } from '@/lib/landing/feature-keys';

import type { LucideIcon } from 'lucide-react';

interface FeatureConfig {
  icon: LucideIcon;
  snippet?: string;
  snippetLabel?: string;
  localeOnly?: string;
}

const FEATURE_DETAILS: Record<FeatureKey, FeatureConfig> = {
  dashboard: { icon: BarChart3 },
  payments: {
    icon: CreditCard,
    snippet: '26 currencies · Stripe Embedded Checkout · Magic-link guest',
    snippetLabel: 'capabilities',
  },
  subscriptions: { icon: Repeat },
  orderBumps: { icon: Layers },
  oto: { icon: Wand2 },
  embed: {
    icon: Code,
    snippet:
      '<script src="https://demo.sellf.app/embed/v1/checkout.js"\n        data-product="my-product-slug"></script>',
    snippetLabel: 'html',
  },
  checkoutTemplates: { icon: LayoutTemplate },
  coupons: { icon: Tag },
  webhooks: {
    icon: Zap,
    snippet:
      'POST https://you.example.com/webhook/sellf\nX-Sellf-Signature: SHA256=...\n{ event: "purchase.completed", ... }',
    snippetLabel: 'sample delivery',
  },
  webhookRetry: { icon: Undo2 },
  leads: { icon: Gift },
  waitlist: { icon: Bell },
  pwyw: { icon: HandCoins },
  tipJar: { icon: Banknote },
  loginWall: {
    icon: Lock,
    snippet:
      '<!-- on your own page -->\n<script>(function(){\n  var p="<product-uuid>";\n  if(window["_SF_LW_"+p])return;\n  location.replace("/loginwall/protect?id="+p+\n    "&redirect="+encodeURIComponent(location.href));\n})();</script>',
    snippetLabel: 'html',
  },
  delivery: { icon: Package },
  omnibus: { icon: ShieldCheck },
  saleLimits: { icon: Clock },
  funnels: { icon: TrendingUp },
  refunds: { icon: RotateCcw },
  security: { icon: ShieldCheck },
  gus: {
    icon: FileText,
    localeOnly: 'pl',
    snippet: 'NIP 1234567890 → firma, ulica, miasto, kod (GUS REGON)',
    snippetLabel: 'auto-fill',
  },
  magicLink: { icon: Mail },
  mcp: {
    icon: BotMessageSquare,
    snippet:
      'claude mcp add sellf -- npx -y @sellf/mcp-server\n# 45 tools · 4 resources · 6 prompts',
    snippetLabel: 'claude',
  },
};

function HeroCardBody({
  icon: Icon,
  title,
  desc,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
}) {
  return (
    <div className="group p-8 rounded-2xl bg-sf-raised/80 border-2 border-sf-border-accent hover:shadow-[var(--sf-shadow-accent)] transition-[box-shadow] duration-300 h-full">
      <div className="w-14 h-14 bg-sf-accent-med rounded-xl flex items-center justify-center mb-5 group-hover:bg-sf-accent/30 transition-colors duration-300">
        <Icon className="w-7 h-7 text-sf-accent" />
      </div>
      <h3 className="text-xl font-bold text-sf-heading mb-3">{title}</h3>
      <p className="text-sf-body leading-relaxed">{desc}</p>
    </div>
  );
}

function StandardCardBody({
  icon: Icon,
  title,
  desc,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
}) {
  return (
    <div className="p-6 rounded-2xl bg-sf-raised/80 border border-sf-border hover:border-sf-border-accent transition-[border-color,box-shadow] duration-300 hover:shadow-[var(--sf-shadow-accent)] h-full">
      <div className="w-12 h-12 bg-sf-accent-soft rounded-xl flex items-center justify-center mb-4 transition-colors duration-300">
        <Icon className="w-6 h-6 text-sf-accent" />
      </div>
      <h3 className="text-lg font-bold text-sf-heading mb-2">{title}</h3>
      <p className="text-sm text-sf-body leading-relaxed">{desc}</p>
    </div>
  );
}

export async function FeatureGrid() {
  const t = await getTranslations('landing');
  const locale = await getLocale();

  const visibleFeatures = FEATURE_KEYS.filter(
    (key) => !FEATURE_DETAILS[key].localeOnly || FEATURE_DETAILS[key].localeOnly === locale,
  );
  const heroKeys = visibleFeatures.slice(0, 2);
  const restKeys = visibleFeatures.slice(2);

  return (
    <section className="py-24 md:py-32 bg-sf-deep" data-landing-section="features">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="text-center mb-16">
          <p className="text-sm font-medium text-sf-muted tracking-[0.08em] uppercase mb-3">
            {t('features.categoryLabel')}
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-sf-heading mb-4">
            {t('features.title')}
          </h2>
          <p className="text-xl text-sf-body max-w-3xl mx-auto">
            {t('features.subtitle')}
          </p>
        </Reveal>

        {/* Hero cards — 2 large spanning cards, no flip */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {heroKeys.map((key, i) => {
            const { icon } = FEATURE_DETAILS[key];
            return (
              <Reveal
                key={key}
                animation={i === 0 ? 'fade-left' : 'fade-right'}
                delay={i * 100}
              >
                <HeroCardBody
                  icon={icon}
                  title={t(`features.${key}.title`)}
                  desc={t(`features.${key}.desc`)}
                />
              </Reveal>
            );
          })}
        </div>

        {/* Standard cards — Sellf-fx #3 snippet flip on cards with a snippet */}
        <RevealGroup
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
          stagger={60}
        >
          {restKeys.map((key) => {
            const { icon, snippet, snippetLabel } = FEATURE_DETAILS[key];
            const body = (
              <StandardCardBody
                icon={icon}
                title={t(`features.${key}.title`)}
                desc={t(`features.${key}.desc`)}
              />
            );
            if (snippet) {
              return (
                <SnippetFlipCard
                  key={key}
                  front={body}
                  snippet={snippet}
                  snippetLabel={snippetLabel ?? 'snippet'}
                />
              );
            }
            return <div key={key}>{body}</div>;
          })}
        </RevealGroup>
      </div>
    </section>
  );
}
