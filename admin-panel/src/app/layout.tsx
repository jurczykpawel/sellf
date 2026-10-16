import type { Metadata } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import "./globals.css";
import { getPublicBaseUrl } from '@/lib/utils/canonical-url';
import { ConfigProvider } from "@/components/providers/config-provider";
import { ThemeProvider, ThemeScript } from "@/components/providers/theme-provider";
import { TrackingConfigProvider } from "@/components/providers/tracking-config-provider";
import { getPublicIntegrationsConfig } from "@/lib/actions/integrations";
import { getShopConfig } from "@/lib/actions/shop-config";
import { buildRuntimeConfig } from "@/lib/runtime-config";
import TrackingProvider from "@/components/TrackingProvider";
import { CSP_NONCE_HEADER } from "@/proxy";
import { Suspense } from "react";

const geistSans = localFont({
  src: "./fonts/geist-variable.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  style: "normal",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/geist-mono-variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  style: "normal",
  display: "swap",
});

const dmSans = localFont({
  src: "./fonts/dm-sans-variable.woff2",
  variable: "--font-dm-sans",
  weight: "300 800",
  style: "normal",
  display: "swap",
});

const dmMono = localFont({
  src: [
    { path: "./fonts/dm-mono-regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/dm-mono-medium.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-dm-mono",
  display: "swap",
});

// Prebuilt releases are relocatable: tenant data and metadata are runtime-only.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  await headers();
  return {
    title: {
      default: 'Sellf',
      template: '%s | Sellf',
    },
    description: 'Self-hosted platform for selling digital products. Courses, ebooks, content access control — with no per-sale commission.',
    metadataBase: new URL(getPublicBaseUrl()),
    openGraph: {
      type: 'website',
      siteName: 'Sellf',
      title: 'Sellf – Sell digital products. Keep 100% of revenue.',
      description: 'Self-hosted platform for selling digital products. Courses, ebooks, content access control — with no per-sale commission.',
      url: '/',
      images: [{ url: '/api/og', width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Sellf – Sell digital products. Keep 100% of revenue.',
      description: 'Self-hosted platform for selling digital products. Courses, ebooks, content access control — with no per-sale commission.',
      images: ['/api/og'],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [config, shopConfig, hdrs] = await Promise.all([
    getPublicIntegrationsConfig().catch(() => null),
    getShopConfig().catch(() => null),
    headers(),
  ]);
  const adminTheme = shopConfig?.checkout_theme || undefined;
  const cspNonce = hdrs.get(CSP_NONCE_HEADER) ?? undefined;
  // Build runtime config on the server so ConfigProvider doesn't have to render
  // a "Loading configuration…" spinner while the client fetches /api/runtime-config.
  const runtimeConfig = (() => {
    try {
      return buildRuntimeConfig();
    } catch {
      return null;
    }
  })();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript adminTheme={adminTheme} nonce={cspNonce} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${dmSans.variable} ${dmMono.variable} antialiased`}
      >
        {/* Tracking Scripts (GTM, Pixel, cookieconsent, Custom Scripts) */}
        <Suspense fallback={null}>
          <TrackingProvider config={config} nonce={cspNonce} />
        </Suspense>

        <ThemeProvider adminTheme={adminTheme}>
          <TrackingConfigProvider config={config}>
            <ConfigProvider initialConfig={runtimeConfig}>
              {children}
            </ConfigProvider>
          </TrackingConfigProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
