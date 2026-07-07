'use client';

import { acceptTermsAction } from '@/actions/accept-terms';
import { Button } from '@/components/ui/button';
import { LocaleLink } from '@/i18n/navigation';
import { Routes } from '@/routes';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

export function AcceptTermsForm() {
  const t = useTranslations('TermsReconfirm');
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try {
      const res = await acceptTermsAction({});
      if (res?.data?.success) {
        window.location.href = Routes.Dashboard;
      } else {
        setBusy(false);
      }
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <LocaleLink
        href={Routes.TermsOfService}
        target="_blank"
        className="text-primary underline underline-offset-4"
      >
        {t('review')}
      </LocaleLink>
      <Button size="lg" onClick={accept} disabled={busy}>
        {busy ? t('accepting') : t('accept')}
      </Button>
    </div>
  );
}
