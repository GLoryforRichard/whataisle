import { websiteConfig } from '@/config/website';
import { getBaseUrl } from '@/lib/urls';
import type { BaseEmailProps } from '@/mail/types';
import {
  Container,
  Font,
  Head,
  Hr,
  Html,
  Img,
  Row,
  Section,
  Tailwind,
  Text,
} from '@react-email/components';
import { createTranslator } from 'use-intl/core';

interface EmailLayoutProps extends BaseEmailProps {
  children: React.ReactNode;
}

/**
 * Email Layout — bear sticker treatment in hardcoded hex.
 *
 * The <Tailwind> here has NO config, so the app's CSS tokens never resolve in
 * email — every brand color must be written as a literal (cream #fdf7e3, ink
 * #111111, muted #6a6359; keep in sync with src/styles/globals.css). Font
 * stays Inter/Arial: webfont support in mail clients is too patchy for Space
 * Grotesk (accepted degrade).
 *
 * https://react.email/docs/components/tailwind
 */
export default function EmailLayout({
  locale,
  messages,
  children,
}: EmailLayoutProps) {
  const t = createTranslator({
    locale,
    messages,
  });
  const lang = websiteConfig.i18n.locales[locale]?.hreflang ?? locale;
  // Absolute URL — email clients can't resolve relative asset paths.
  const logoUrl = `${getBaseUrl()}${websiteConfig.metadata.images?.logoLight ?? '/logo.png'}`;

  return (
    <Html lang={lang}>
      <Head>
        <Font
          fontFamily="Inter"
          fallbackFontFamily="Arial"
          fontWeight={400}
          fontStyle="normal"
        />
      </Head>
      <Tailwind>
        <Section className="bg-[#fdf7e3] p-6">
          <Container
            className="rounded-[18px] bg-white p-7 text-[#111111]"
            style={{ border: '1px solid #111111' }}
          >
            <Row>
              <Img
                src={logoUrl}
                width="44"
                height="44"
                alt={t('Metadata.name')}
              />
            </Row>
            <Text className="mt-2 mb-4 font-bold text-[#111111] text-xl">
              {t('Metadata.name')}
            </Text>

            {children}

            <Hr className="my-8" style={{ borderColor: '#111111' }} />
            <Text className="mt-4 text-[#6a6359]">
              {t('Mail.common.team', { name: t('Metadata.name') })}
            </Text>
            <Text className="text-[#6a6359]">
              {t('Mail.common.copyright', { year: new Date().getFullYear() })}
            </Text>
          </Container>
        </Section>
      </Tailwind>
    </Html>
  );
}
