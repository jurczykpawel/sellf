import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

/**
 * Parse .stripe file content
 */
function parseStripeFile(content: string): Record<string, string> {
  const config: Record<string, string> = {};
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    const equalIndex = trimmed.indexOf('=');
    if (equalIndex === -1) continue;
    
    const key = trimmed.slice(0, equalIndex).trim();
    let value = trimmed.slice(equalIndex + 1).trim();
    
    // Remove quotes
    if ((value.startsWith('"') && value.endsWith('"')) || 
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    
    config[key] = value;
  }
  
  return config;
}

/**
 * Load Stripe configuration at build time
 */
function loadStripeEnvConfig(): Record<string, string> {
  let fileConfig: Record<string, string> = {};
  
  // Load .stripe file if exists
  const stripeFilePath = join(process.cwd(), '.stripe');
  if (existsSync(stripeFilePath)) {
    try {
      const content = readFileSync(stripeFilePath, 'utf-8');
      fileConfig = parseStripeFile(content);
    } catch {
    }
  }
  
  // Helper function with env override
  const getConfig = (envKey: string, fileKey: string, defaultValue: string) => {
    return process.env[envKey] || fileConfig[fileKey] || defaultValue;
  };
  
  return {
    NEXT_PUBLIC_STRIPE_THEME: getConfig('STRIPE_THEME', 'STRIPE_THEME', 'night'),
    NEXT_PUBLIC_STRIPE_LABELS: getConfig('STRIPE_LABELS', 'STRIPE_LABELS', 'floating'),
    NEXT_PUBLIC_STRIPE_PAYMENT_METHODS: getConfig('STRIPE_PAYMENT_METHODS', 'STRIPE_PAYMENT_METHODS', 'blik,p24,card'),
    NEXT_PUBLIC_STRIPE_BLIK_SETUP_FUTURE_USAGE: getConfig('STRIPE_BLIK_SETUP_FUTURE_USAGE', 'STRIPE_BLIK_SETUP_FUTURE_USAGE', 'off_session'),
    NEXT_PUBLIC_STRIPE_SESSION_EXPIRES_HOURS: getConfig('STRIPE_SESSION_EXPIRES_HOURS', 'STRIPE_SESSION_EXPIRES_HOURS', '24'),
    NEXT_PUBLIC_STRIPE_SESSION_BILLING_ADDRESS_COLLECTION: getConfig('STRIPE_SESSION_BILLING_ADDRESS_COLLECTION', 'STRIPE_SESSION_BILLING_ADDRESS_COLLECTION', 'auto'),
    NEXT_PUBLIC_STRIPE_SESSION_AUTOMATIC_TAX_ENABLED: getConfig('STRIPE_SESSION_AUTOMATIC_TAX_ENABLED', 'STRIPE_SESSION_AUTOMATIC_TAX_ENABLED', 'true'),
    NEXT_PUBLIC_STRIPE_SESSION_TAX_ID_COLLECTION_ENABLED: getConfig('STRIPE_SESSION_TAX_ID_COLLECTION_ENABLED', 'STRIPE_SESSION_TAX_ID_COLLECTION_ENABLED', 'true'),
    NEXT_PUBLIC_STRIPE_RATE_LIMIT_MAX_REQUESTS: getConfig('STRIPE_RATE_LIMIT_MAX_REQUESTS', 'STRIPE_RATE_LIMIT_MAX_REQUESTS', '10'),
    NEXT_PUBLIC_STRIPE_RATE_LIMIT_WINDOW_MINUTES: getConfig('STRIPE_RATE_LIMIT_WINDOW_MINUTES', 'STRIPE_RATE_LIMIT_WINDOW_MINUTES', '1'),
    NEXT_PUBLIC_STRIPE_RATE_LIMIT_ACTION_TYPE: getConfig('STRIPE_RATE_LIMIT_ACTION_TYPE', 'STRIPE_RATE_LIMIT_ACTION_TYPE', 'checkout_creation'),
    NEXT_PUBLIC_STRIPE_VALIDATION_MIN_PRICE: getConfig('STRIPE_VALIDATION_MIN_PRICE', 'STRIPE_VALIDATION_MIN_PRICE', '0.01'),
    NEXT_PUBLIC_STRIPE_ERROR_PRODUCT_ID_REQUIRED: getConfig('STRIPE_ERROR_PRODUCT_ID_REQUIRED', 'STRIPE_ERROR_PRODUCT_ID_REQUIRED', 'Product ID is required'),
    NEXT_PUBLIC_STRIPE_ERROR_INVALID_EMAIL: getConfig('STRIPE_ERROR_INVALID_EMAIL', 'STRIPE_ERROR_INVALID_EMAIL', 'Invalid email format'),
    NEXT_PUBLIC_STRIPE_ERROR_PRODUCT_NOT_FOUND: getConfig('STRIPE_ERROR_PRODUCT_NOT_FOUND', 'STRIPE_ERROR_PRODUCT_NOT_FOUND', 'Product not found or inactive'),
    NEXT_PUBLIC_STRIPE_ERROR_PRODUCT_UNAVAILABLE: getConfig('STRIPE_ERROR_PRODUCT_UNAVAILABLE', 'STRIPE_ERROR_PRODUCT_UNAVAILABLE', 'Product not available for purchase'),
    NEXT_PUBLIC_STRIPE_ERROR_DUPLICATE_ACCESS: getConfig('STRIPE_ERROR_DUPLICATE_ACCESS', 'STRIPE_ERROR_DUPLICATE_ACCESS', 'You already have access to this product'),
    NEXT_PUBLIC_STRIPE_ERROR_RATE_LIMIT_EXCEEDED: getConfig('STRIPE_ERROR_RATE_LIMIT_EXCEEDED', 'STRIPE_ERROR_RATE_LIMIT_EXCEEDED', 'Too many checkout attempts. Please try again later.'),
    NEXT_PUBLIC_STRIPE_ERROR_STRIPE_SESSION_FAILED: getConfig('STRIPE_ERROR_STRIPE_SESSION_FAILED', 'STRIPE_ERROR_STRIPE_SESSION_FAILED', 'Failed to create checkout session'),
    NEXT_PUBLIC_STRIPE_ERROR_INVALID_PRICE: getConfig('STRIPE_ERROR_INVALID_PRICE', 'STRIPE_ERROR_INVALID_PRICE', 'Invalid product price'),
  };
}

const nextConfig: NextConfig = {
  /* config options here */
  output: 'standalone',
  experimental: {
    // Enable if you need server actions
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'i.ibb.co',
        port: '',
        pathname: '/**',
      },
      // YouTube video thumbnails (used by VideoPlayer / PlayerThumbnail)
      {
        protocol: 'https',
        hostname: 'img.youtube.com',
        port: '',
        pathname: '/vi/**',
      },
      // Vimeo video thumbnails
      {
        protocol: 'https',
        hostname: 'vumbnail.com',
        port: '',
        pathname: '/**',
      },
      // Wistia video thumbnails
      {
        protocol: 'https',
        hostname: 'embed-ssl.wistia.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'fast.wistia.com',
        port: '',
        pathname: '/**',
      },
      // Placeholder images for development/testing
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
    ],
  },
  env: {
    ...loadStripeEnvConfig(),
    NEXT_PUBLIC_APP_VERSION: JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')).version,
  },

  // Security headers
  async headers() {
    return [
      {
        // Apply to all routes
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          // HSTS is handled by proxy.ts with DISABLE_HSTS env var support
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' js.stripe.com challenges.cloudflare.com cdn.kiprotect.com www.youtube.com s.ytimg.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https: i.ibb.co *.stripe.com img.youtube.com vumbnail.com embed-ssl.wistia.com fast.wistia.com placehold.co",
              "font-src 'self' data:",
              "frame-src js.stripe.com challenges.cloudflare.com *.youtube.com player.vimeo.com iframe.mediadelivery.net *.loom.com fast.wistia.net *.dailymotion.com player.twitch.tv",
              "connect-src 'self' *.supabase.co *.stripe.com challenges.cloudflare.com www.youtube.com s.ytimg.com http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*",
              "object-src 'none'",
              "base-uri 'self'",
            ].join('; '),
          },
        ],
      },
      {
        // API routes - more restrictive
        source: '/api/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate',
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
