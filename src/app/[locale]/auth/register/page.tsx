import { RegisterForm } from '@/components/auth/register-form';
import { LocaleLink } from '@/i18n/navigation';
import { constructMetadata } from '@/lib/metadata';
import {
  getValidStoreInvite,
  isPublicSignupEnabled,
} from '@/lib/store-invites';
import { Routes } from '@/routes';
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
  const pt = await getTranslations({ locale, namespace: 'AuthPage.register' });

  return constructMetadata({
    title: pt('title') + ' | ' + t('title'),
    description: t('description'),
    locale,
    pathname: '/auth/register',
  });
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; callbackUrl?: string }>;
}) {
  const { invite: inviteToken, callbackUrl } = await searchParams;
  const invite = await getValidStoreInvite(inviteToken);
  const signupEnabled = isPublicSignupEnabled();
  const t = await getTranslations('AuthPage.common');
  const rt = await getTranslations('AuthPage.register');

  if (!signupEnabled && !invite) {
    return (
      <div className="mx-auto max-w-md space-y-5 text-center">
        <h1 className="text-2xl font-semibold">{rt('inviteOnlyTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {rt('inviteOnlyDescription')}
        </p>
        <LocaleLink
          href={Routes.Contact}
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          {rt('requestAccess')}
        </LocaleLink>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <RegisterForm
        callbackUrl={callbackUrl}
        inviteToken={inviteToken}
        invitedEmail={invite?.email}
      />
      <div className="text-balance text-center text-xs text-muted-foreground">
        {t('byClickingContinue')}
        <LocaleLink
          href={Routes.TermsOfService}
          className="underline underline-offset-4 hover:text-primary"
        >
          {t('termsOfService')}
        </LocaleLink>{' '}
        {t('and')}{' '}
        <LocaleLink
          href={Routes.PrivacyPolicy}
          className="underline underline-offset-4 hover:text-primary"
        >
          {t('privacyPolicy')}
        </LocaleLink>
      </div>
    </div>
  );
}
