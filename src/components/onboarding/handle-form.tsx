'use client';

import {
  type HandleCheckResult,
  checkStoreHandleAction,
} from '@/actions/check-store-handle';
import { createStoreAction } from '@/actions/create-store';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LocaleLink } from '@/i18n/navigation';
import { Routes } from '@/routes';
import { CheckCircle2Icon, Loader2Icon, XCircleIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'whataisle.com';

type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available' }
  | { status: 'unavailable'; reason: 'format' | 'reserved' | 'taken' };

export function HandleForm() {
  const t = useTranslations('Onboarding');

  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [check, setCheck] = useState<CheckState>({ status: 'idle' });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const checkSeq = useRef(0);

  const previewUrl = `${handle || 'yourstore'}.${ROOT_DOMAIN}`;

  useEffect(() => {
    if (!handle) {
      setCheck({ status: 'idle' });
      return;
    }
    setCheck({ status: 'checking' });
    const seq = ++checkSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await checkStoreHandleAction({ handle });
        if (seq !== checkSeq.current) return; // stale response
        const data = res?.data as HandleCheckResult | undefined;
        if (!data) {
          setCheck({ status: 'idle' });
        } else if (data.available) {
          setCheck({ status: 'available' });
        } else {
          setCheck({ status: 'unavailable', reason: data.reason });
        }
      } catch {
        if (seq === checkSeq.current) setCheck({ status: 'idle' });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [handle]);

  const canSubmit =
    displayName.trim().length > 0 &&
    check.status === 'available' &&
    termsAccepted &&
    !creating;

  async function create() {
    setCreating(true);
    setSubmitError(null);
    try {
      const res = await createStoreAction({
        handle,
        displayName: displayName.trim(),
        termsAccepted: true,
      });
      const data = res?.data;
      if (data?.success) {
        // Hard navigation: this is a one-time completion, and it guarantees
        // the protected layout re-runs server-side and sees the new store.
        window.location.assign(Routes.OnboardingPayment);
        return;
      }
      const code = data && 'error' in data ? data.error : undefined;
      setSubmitError(
        code === 'format' ||
          code === 'reserved' ||
          code === 'taken' ||
          code === 'already_has_store'
          ? t(`errors.${code}`)
          : t('errors.generic')
      );
      setConfirmOpen(false);
    } catch {
      setSubmitError(t('errors.generic'));
      setConfirmOpen(false);
    } finally {
      setCreating(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) setConfirmOpen(true);
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="store-name" className="font-semibold text-base">
          {t('nameLabel')}
        </Label>
        <Input
          id="store-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={t('namePlaceholder')}
          maxLength={100}
          className="h-13 rounded-xl text-lg text-[var(--brand-ink)] placeholder:text-[#7B8479]"
          autoFocus
        />
        <p className="text-[#566058] text-sm">{t('nameHint')}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="store-handle" className="font-semibold text-base">
          {t('handleLabel')}
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="store-handle"
            value={handle}
            onChange={(e) =>
              setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
            }
            placeholder="yourstore"
            maxLength={30}
            className="h-13 rounded-xl text-lg text-[var(--brand-ink)] placeholder:text-[#7B8479]"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <span className="whitespace-nowrap text-[#566058]">
            .{ROOT_DOMAIN}
          </span>
        </div>

        {/* live preview URL + availability pill */}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[#D8EBB4] bg-[#F1F7E8] px-3.5 py-3">
          <span className="break-all font-mono font-bold text-[15px] text-[var(--brand-green)]">
            {previewUrl}
          </span>
          <div className="shrink-0 text-sm" aria-live="polite">
            {check.status === 'checking' && (
              <span className="inline-flex items-center gap-1 text-[#566058]">
                <Loader2Icon className="size-4 animate-spin" aria-hidden />
                {t('checking')}
              </span>
            )}
            {check.status === 'available' && (
              <span className="wa-pop inline-flex items-center gap-1 font-bold text-[var(--brand-green)]">
                <CheckCircle2Icon className="size-4" aria-hidden />
                {t('available')}
              </span>
            )}
            {check.status === 'unavailable' && (
              <span className="inline-flex items-center gap-1 font-medium text-[#c1272d]">
                <XCircleIcon className="size-4" aria-hidden />
                {t(`errors.${check.reason}`)}
              </span>
            )}
          </div>
        </div>
        <p className="text-[#566058] text-sm">{t('handleHint')}</p>

        <p className="rounded-xl border border-[#E7C86F] bg-[#FDF6E3] p-3 text-[#7A5B18] text-sm leading-relaxed">
          {t('permanenceWarning')}
        </p>
      </div>

      <div className="flex items-start gap-3">
        <Checkbox
          id="terms"
          checked={termsAccepted}
          onCheckedChange={(v) => setTermsAccepted(v === true)}
          className="mt-0.5 size-5"
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="terms" className="font-normal text-base">
            {t('termsLabel')}
          </Label>
          <LocaleLink
            href={Routes.TermsOfService}
            target="_blank"
            className="text-[var(--brand-green)] text-sm underline underline-offset-4"
          >
            {t('termsLink')}
          </LocaleLink>
        </div>
      </div>

      {submitError ? (
        <p role="alert" className="text-[#c1272d]">
          {submitError}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        className="h-13 rounded-xl font-bold text-lg"
        disabled={!canSubmit}
      >
        {creating ? t('creating') : t('submit')}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="rounded-[20px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-center text-xl">
              {t('confirm.title')}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <div className="rounded-xl border border-[#D8EBB4] bg-[#F1F7E8] p-3.5 text-center font-mono font-bold text-lg text-[var(--brand-green)] break-all">
            {previewUrl}
          </div>
          <AlertDialogDescription className="text-center text-muted-foreground text-base">
            {t('confirm.description', { url: previewUrl })}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={creating} className="rounded-xl">
              {t('confirm.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                create();
              }}
              disabled={creating}
              className="rounded-xl font-bold"
            >
              {creating ? t('creating') : t('confirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
