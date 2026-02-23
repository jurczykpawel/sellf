import { getTranslations } from 'next-intl/server';
import { Github } from 'lucide-react';
import Link from 'next/link';

export async function LandingFooter() {
  const t = await getTranslations('landing');

  return (
    <footer className="bg-gray-950 text-gray-400 py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          {/* Brand */}
          <div>
            <p className="text-lg font-bold text-white mb-4">GateFlow</p>
            <p className="text-sm text-gray-400 mb-4">
              {t('footer.description')}
            </p>
            <a
              href="https://github.com/jurczykpawel/gateflow"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-gray-400 hover:text-white transition-colors"
            >
              <Github className="h-5 w-5" />
            </a>
          </div>

          {/* Product */}
          <div>
            <p className="text-sm font-semibold text-white mb-4 uppercase tracking-wider">
              {t('footer.product')}
            </p>
            <nav className="space-y-1">
              <a
                href="#features"
                className="block text-sm text-gray-400 hover:text-white transition-colors py-1"
              >
                {t('footer.features')}
              </a>
              <a
                href="https://github.com/jurczykpawel/gateflow#readme"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-gray-400 hover:text-white transition-colors py-1"
              >
                {t('footer.documentation')}
              </a>
              <Link
                href="/store"
                className="block text-sm text-gray-400 hover:text-white transition-colors py-1"
              >
                {t('footer.products')}
              </Link>
            </nav>
          </div>

          {/* Resources */}
          <div>
            <p className="text-sm font-semibold text-white mb-4 uppercase tracking-wider">
              {t('footer.resources')}
            </p>
            <nav className="space-y-1">
              <a
                href="https://github.com/jurczykpawel/gateflow"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-gray-400 hover:text-white transition-colors py-1"
              >
                {t('footer.github')}
              </a>
              <a
                href="https://github.com/jurczykpawel/gateflow#deployment"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-gray-400 hover:text-white transition-colors py-1"
              >
                {t('footer.deployGuide')}
              </a>
              <a
                href="https://github.com/jurczykpawel/gateflow/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-gray-400 hover:text-white transition-colors py-1"
              >
                {t('footer.support')}
              </a>
            </nav>
          </div>

          {/* Legal */}
          <div>
            <p className="text-sm font-semibold text-white mb-4 uppercase tracking-wider">
              {t('footer.legal')}
            </p>
            <nav className="space-y-1">
              <a
                href="https://github.com/jurczykpawel/gateflow/blob/main/LICENSE"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-gray-400 hover:text-white transition-colors py-1"
              >
                {t('footer.licenseMIT')}
              </a>
              <Link
                href="/privacy"
                className="block text-sm text-gray-400 hover:text-white transition-colors py-1"
              >
                {t('footer.privacy')}
              </Link>
              <Link
                href="/terms"
                className="block text-sm text-gray-400 hover:text-white transition-colors py-1"
              >
                {t('footer.terms')}
              </Link>
            </nav>
          </div>
        </div>

        <div className="border-t border-gray-800 pt-8">
          <p className="text-center text-sm text-gray-500">
            {t('footer.copyright', { year: new Date().getFullYear() })}
          </p>
        </div>
      </div>
    </footer>
  );
}
