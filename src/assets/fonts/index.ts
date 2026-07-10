import {
  Bricolage_Grotesque,
  Noto_Sans,
  Noto_Sans_Mono,
  Noto_Sans_SC,
  Noto_Serif,
  Quicksand,
} from 'next/font/google';

/**
 * 1. Fonts Documentation
 * https://mksaas.com/docs/fonts
 *
 * 2. This file shows how to customize the font by using local font or google font
 *
 * [1] use local font
 *
 * - Get font file from https://gwfh.mranftl.com/fonts
 * - Add font file to the assets/fonts folder
 * - Add font variable to the font object
 */
// https://gwfh.mranftl.com/fonts/bricolage-grotesque?subsets=latin
// export const fontBricolageGrotesque = localFont({
//   src: './Bricolage Grotesque-grotesque-v7-latin-regular.woff2',
//   variable: '--font-bricolage-grotesque',
// });

/**
 * [2] use google font
 *
 * - You can browser fonts at Google Fonts
 * https://fonts.google.com
 *
 * - CSS and font files are downloaded at build time and self-hosted with the rest of your static assets.
 * https://nextjs.org/docs/app/building-your-application/optimizing/fonts#google-fonts
 */
// https://fonts.google.com/noto/specimen/Noto+Sans
export const fontNotoSans = Noto_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-noto-sans',
  weight: ['500', '600', '700'],
});

// https://fonts.google.com/noto/specimen/Noto+Serif
export const fontNotoSerif = Noto_Serif({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-noto-serif',
  weight: ['400'],
});

// https://fonts.google.com/noto/specimen/Noto+Sans+Mono
export const fontNotoSansMono = Noto_Sans_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-noto-sans-mono',
  weight: ['400'],
});

// https://fonts.google.com/specimen/Bricolage+Grotesque
export const fontBricolageGrotesque = Bricolage_Grotesque({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-bricolage-grotesque',
  weight: ['400', '500', '600', '700'],
});

// Fresh Green (5a) rebrand — rounded geometric display/UI font.
// https://fonts.google.com/specimen/Quicksand
export const fontQuicksand = Quicksand({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-quicksand',
  weight: ['500', '600', '700'],
});

// CJK fallback for Quicksand (which has no Chinese glyphs). Not preloaded — the
// SC font files are large and only needed for Chinese runs.
// https://fonts.google.com/noto/specimen/Noto+Sans+SC
export const fontNotoSansSC = Noto_Sans_SC({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-noto-sans-sc',
  weight: ['400', '500', '700'],
  preload: false,
});
