import { createMDX } from 'fumadocs-mdx/next';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

/**
 * https://nextjs.org/docs/app/api-reference/config/next-config-js
 */
const nextConfig: NextConfig = {
  ...(process.env.NEXT_DIST_DIR && { distDir: process.env.NEXT_DIST_DIR }),

  // Docker standalone output
  ...(process.env.DOCKER_BUILD === 'true' && { output: 'standalone' }),

  /* config options here */
  devIndicators: false,

  // heic-convert lazy-loads a wasm-backed libheif build; bundling it through
  // the server compiler breaks it, so keep it external (sharp is external by
  // Next's defaults).
  serverExternalPackages: ['heic-convert'],

  // sharp ≥0.33 links libvips natively (@rpath into @img/sharp-libvips-*, no
  // JS require), so output file tracing can't see it and the standalone build
  // ships a sharp that dies with ERR_DLOPEN_FAILED on first use. Force the
  // platform libvips package (pnpm layout) into every route's trace.
  outputFileTracingIncludes: {
    '/**': ['./node_modules/.pnpm/@img*/**/*'],
  },

  // https://nextjs.org/docs/architecture/nextjs-compiler#remove-console
  // Remove all console.* calls in production only
  compiler: {
    // removeConsole: process.env.NODE_ENV === 'production',
  },

  // https://nextjs.org/docs/app/api-reference/config/next-config-js/htmlLimitedBots
  // This config allows you to specify a list of user agents that should receive
  // blocking metadata instead of streaming metadata
  // Only target actual bots/crawlers, not all user agents (which would disable streaming SSR for everyone)
  htmlLimitedBots:
    /Googlebot|Bingbot|Slurp|DuckDuckBot|Baiduspider|YandexBot|Sogou|facebookexternalhit|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Applebot/,

  images: {
    // https://vercel.com/docs/image-optimization/managing-image-optimization-costs#minimizing-image-optimization-costs
    // https://nextjs.org/docs/app/api-reference/components/image#unoptimized
    // vercel has limits on image optimization, 1000 images per month
    unoptimized: process.env.DISABLE_IMAGE_OPTIMIZATION === 'true',
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.mksaas.com',
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'randomuser.me',
      },
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
      },
      {
        protocol: 'https',
        hostname: 'ik.imagekit.io',
      },
      {
        protocol: 'https',
        hostname: 'html.tailus.io',
      },
      {
        protocol: 'https',
        hostname: 'service.firecrawl.dev',
      },
    ],
  },
  async rewrites() {
    return [
      // Rewrite markdown requests to llms.mdx route
      // All markdownUrl includes locale prefix (e.g., /en/docs/xxx.mdx)
      {
        source: '/:locale/docs/:path*.mdx',
        destination: '/:locale/docs/llms.mdx/:path*',
      },
    ];
  },
};

/**
 * You can specify the path to the request config file or use the default one (@/i18n/request.ts)
 *
 * https://next-intl.dev/docs/getting-started/app-router/with-i18n-routing#next-config
 */
const withNextIntl = createNextIntlPlugin();

/**
 * https://fumadocs.dev/docs/ui/manual-installation
 * https://fumadocs.dev/docs/mdx/plugin
 */
const withMDX = createMDX();

export default withMDX(withNextIntl(nextConfig));
