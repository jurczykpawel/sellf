import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { GithubIcon } from '@/components/ui/GithubIcon';
import { SELLF_GITHUB_URL } from '@/lib/constants';

export async function LandingFooter() {
  const t = await getTranslations('landing');

  return (
    <footer className="bg-sf-deep text-sf-muted py-16 border-t border-sf-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          {/* Brand */}
          <div>
            <p className="text-lg font-bold text-sf-heading mb-4">Sellf</p>
            <p className="text-sm text-sf-muted mb-4">
              {t('footer.description')}
            </p>
            <a
              href={SELLF_GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-sf-muted hover:text-sf-heading transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded"
            >
              <GithubIcon className="h-5 w-5" />
            </a>
          </div>

          {/* Product */}
          <div>
            <p className="text-sm font-semibold text-sf-heading mb-4 uppercase tracking-wider">
              {t('footer.product')}
            </p>
            <nav className="space-y-1">
              <a
                href="#features"
                className="block text-sm text-sf-muted hover:text-sf-heading transition-colors duration-200 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded"
              >
                {t('footer.features')}
              </a>
              <a
                href={`${SELLF_GITHUB_URL}#readme`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-sf-muted hover:text-sf-heading transition-colors duration-200 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded"
              >
                {t('footer.documentation')}
              </a>
              <Link
                href="/store"
                className="block text-sm text-sf-muted hover:text-sf-heading transition-colors duration-200 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded"
              >
                {t('footer.products')}
              </Link>
              <a
                href="https://sellf.techskills.academy/v/sellf-white-label-license"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-sf-muted hover:text-sf-heading transition-colors duration-200 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded"
              >
                {t('footer.whiteLabelLicense')}
              </a>
            </nav>
          </div>

          {/* Resources */}
          <div>
            <p className="text-sm font-semibold text-sf-heading mb-4 uppercase tracking-wider">
              {t('footer.resources')}
            </p>
            <nav className="space-y-1">
              <a
                href={SELLF_GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-sf-muted hover:text-sf-heading transition-colors duration-200 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded"
              >
                {t('footer.github')}
              </a>
              <a
                href={`${SELLF_GITHUB_URL}#deployment`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-sf-muted hover:text-sf-heading transition-colors duration-200 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded"
              >
                {t('footer.deployGuide')}
              </a>
              <a
                href={`${SELLF_GITHUB_URL}/issues`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-sf-muted hover:text-sf-heading transition-colors duration-200 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded"
              >
                {t('footer.support')}
              </a>
              <a
                href="/llms.txt"
                type="text/markdown"
                className="block text-sm text-sf-muted hover:text-sf-heading transition-colors duration-200 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded"
              >
                {t('footer.llmsTxt')}
              </a>
            </nav>
          </div>

          {/* Legal */}
          <div>
            <p className="text-sm font-semibold text-sf-heading mb-4 uppercase tracking-wider">
              {t('footer.legal')}
            </p>
            <nav className="space-y-1">
              <a
                href={`${SELLF_GITHUB_URL}/blob/main/LICENSE`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-sf-muted hover:text-sf-heading transition-colors duration-200 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded"
              >
                {t('footer.licenseAGPL')}
              </a>
              <Link
                href="/privacy"
                className="block text-sm text-sf-muted hover:text-sf-heading transition-colors duration-200 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded"
              >
                {t('footer.privacy')}
              </Link>
              <Link
                href="/terms"
                className="block text-sm text-sf-muted hover:text-sf-heading transition-colors duration-200 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded"
              >
                {t('footer.terms')}
              </Link>
              {/*
                GDPR Art. 7(3): the user must be able to withdraw consent as
                easily as it was given. `data-cc="show-preferencesModal"`
                re-opens the cookieconsent preferences modal from anywhere.
              */}
              <button
                type="button"
                data-cc="show-preferencesModal"
                className="block text-left text-sm text-sf-muted hover:text-sf-heading transition-colors duration-200 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded"
              >
                {t('footer.cookiePreferences')}
              </button>
            </nav>
          </div>
        </div>

        <div className="border-t border-sf-border pt-8">
          <p className="text-center text-sm text-sf-muted">
            {t('footer.copyright', { year: new Date().getFullYear() })}
          </p>
        </div>
      </div>
    </footer>
  );
}
