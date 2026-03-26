import { getTranslations } from 'next-intl/server';
import { Github } from 'lucide-react';
import Link from 'next/link';

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
              href="https://github.com/jurczykpawel/sellf"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-sf-muted hover:text-sf-heading transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded"
            >
              <Github className="h-5 w-5" />
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
                href="https://github.com/jurczykpawel/sellf#readme"
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
                href="https://github.com/jurczykpawel/sellf"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-sf-muted hover:text-sf-heading transition-colors duration-200 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded"
              >
                {t('footer.github')}
              </a>
              <a
                href="https://github.com/jurczykpawel/sellf#deployment"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-sf-muted hover:text-sf-heading transition-colors duration-200 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded"
              >
                {t('footer.deployGuide')}
              </a>
              <a
                href="https://github.com/jurczykpawel/sellf/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-sf-muted hover:text-sf-heading transition-colors duration-200 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded"
              >
                {t('footer.support')}
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
                href="https://github.com/jurczykpawel/sellf/blob/main/LICENSE"
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
