import Container from '@/components/layout/container';
import { buttonVariants } from '@/components/ui/button';
import { websiteConfig } from '@/config/website';
import { constructMetadata } from '@/lib/metadata';
import { cn } from '@/lib/utils';
import { MailIcon } from 'lucide-react';
import type { Metadata } from 'next';
import type { Locale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata | undefined> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Metadata' });
  const pt = await getTranslations({ locale, namespace: 'AboutPage' });

  return constructMetadata({
    title: pt('title') + ' | ' + t('title'),
    description: pt('description'),
    locale,
    pathname: '/about',
  });
}

/**
 * Plain product story. The mksaas template shipped a personal-blog "about
 * the author" layout here; store owners expect to read what the product is
 * and who it is for, so that's all this page does. The support address is
 * shown as visible text — this audience often copies it into their own
 * mail app instead of tapping a mailto button.
 */
export default async function AboutPage() {
  const t = await getTranslations('AboutPage');
  const supportEmail = websiteConfig.mail.supportEmail;

  return (
    <Container className="px-4 py-16">
      <div className="mx-auto flex max-w-3xl flex-col gap-10">
        <h1 className="font-bold text-4xl text-foreground">{t('title')}</h1>

        <div className="flex flex-col gap-5">
          <p className="text-lg text-muted-foreground leading-relaxed">
            {t('p1')}
          </p>
          <p className="text-lg text-muted-foreground leading-relaxed">
            {t('p2')}
          </p>
          <p className="text-lg text-muted-foreground leading-relaxed">
            {t('p3')}
          </p>
        </div>

        {supportEmail && (
          <div className="flex flex-col items-start gap-3 rounded-[20px] border border-[#EAE3D2] bg-white p-6">
            <h2 className="font-bold text-foreground text-xl">
              {t('contactTitle')}
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {t('contactBody')}
            </p>
            <a
              href={`mailto:${supportEmail}`}
              className={cn(buttonVariants(), 'rounded-full text-base')}
            >
              <MailIcon className="mr-1 size-4" aria-hidden />
              {supportEmail}
            </a>
          </div>
        )}
      </div>
    </Container>
  );
}
