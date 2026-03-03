import type { Metadata } from "next";
import { Geist, Geist_Mono, DM_Sans, DM_Mono } from "next/font/google";
import "./globals.css";
import { ConfigProvider } from "@/components/providers/config-provider";
import { ThemeProvider, ThemeScript } from "@/components/providers/theme-provider";
import { TrackingConfigProvider } from "@/components/providers/tracking-config-provider";
import { getPublicIntegrationsConfig } from "@/lib/actions/integrations";
import { getShopConfig } from "@/lib/actions/shop-config";
import TrackingProvider from "@/components/TrackingProvider";
import { Suspense } from "react";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: 'Sellf',
    template: '%s | Sellf',
  },
  description: 'Self-hosted platform for selling digital products. Courses, ebooks, content access control — with no per-sale commission.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://sellf.app'),
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [config, shopConfig] = await Promise.all([
    getPublicIntegrationsConfig().catch(() => null),
    getShopConfig().catch(() => null),
  ]);
  const adminTheme = shopConfig?.checkout_theme || undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript adminTheme={adminTheme} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${dmSans.variable} ${dmMono.variable} antialiased`}
      >
        {/* Tracking Scripts (GTM, Pixel, Klaro, Custom Scripts) */}
        <Suspense fallback={null}>
          <TrackingProvider config={config} />
        </Suspense>

        <ThemeProvider adminTheme={adminTheme}>
          <TrackingConfigProvider config={config}>
            <ConfigProvider>
              {children}
            </ConfigProvider>
          </TrackingConfigProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}