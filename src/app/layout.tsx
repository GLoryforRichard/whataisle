import type { Viewport } from 'next';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

/**
 * Brand color for the mobile browser chrome (Android address bar, iOS
 * status area). Applies to every route because this is the root layout.
 * Keep in sync with --brand in src/styles/globals.css.
 */
export const viewport: Viewport = {
  themeColor: '#2765a8',
};

/**
 * Since we have a `not-found.tsx` page on the root, a layout file
 * is required, even if it's just passing children through.
 *
 * https://next-intl.dev/docs/environments/error-files#catching-non-localized-requests
 */
export default function RootLayout({ children }: Props) {
  return children;
}
