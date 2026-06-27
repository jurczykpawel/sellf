// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://docs.sellf.app',
	integrations: [
		starlight({
			title: 'Sellf Docs',
			description:
				'Documentation for Sellf — the source-available, self-hostable monetization platform built on Next.js, Supabase, and Stripe.',
			expressiveCode: {
				shiki: {
					// Alias code-fence languages Shiki doesn't ship a grammar for.
					langAlias: { env: 'ini', cron: 'txt' },
				},
			},
			logo: { src: './src/assets/logo.svg', replacesTitle: false },
			favicon: '/favicon.svg',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/jurczykpawel/sellf' },
			],
			editLink: {
				baseUrl: 'https://github.com/jurczykpawel/sellf/edit/main/docs-site/',
			},
			defaultLocale: 'root',
			locales: {
				root: { label: 'English', lang: 'en' },
				pl: { label: 'Polski', lang: 'pl' },
			},
			sidebar: [
				{
					label: 'Getting Started',
					translations: { pl: 'Pierwsze kroki' },
					items: [{ slug: 'quick-start' }],
				},
				{
					label: 'Deployment',
					translations: { pl: 'Wdrożenie' },
					items: [
						{ slug: 'deployment' },
						{ slug: 'full-stack' },
						{ slug: 'deployment-mikrus' },
						{ slug: 'pm2-vps' },
						{ slug: 'deployment-vercel-netlify' },
						{ slug: 'deployment-coolify' },
						{ slug: 'docker-simple' },
					],
				},
				{
					label: 'Configuration',
					translations: { pl: 'Konfiguracja' },
					items: [
						{ slug: 'supabase-setup' },
						{ slug: 'upstash-redis' },
						{ slug: 'cookie-consent' },
						{ slug: 'webhooks' },
					],
				},
				{
					label: 'API',
					items: [{ slug: 'api' }],
				},
				{
					label: 'Security & Reference',
					translations: { pl: 'Bezpieczeństwo i referencje' },
					items: [
						{ slug: 'telemetry' },
						{ slug: 'security-rfc-checkout-binding' },
						{ slug: 'stripe-testing-guide' },
					],
				},
			],
		}),
	],
});
