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
        window.location.assign(Routes.Dashboard);
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
        <Label htmlFor="store-name" className="text-base">
          {t('nameLabel')}
        </Label>
        <Input
          id="store-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={t('namePlaceholder')}
          maxLength={100}
          className="h-12 text-lg"
          autoFocus
        />
        <p className="text-muted-foreground text-sm">{t('nameHint')}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="store-handle" className="text-base">
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
            className="h-12 text-lg"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <span className="whitespace-nowrap text-muted-foreground">
            .{ROOT_DOMAIN}
          </span>
        </div>
        <p className="text-muted-foreground text-sm">{t('handleHint')}</p>

        <div className="min-h-6 text-sm" aria-live="polite">
          {check.status === 'checking' && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" aria-hidden />
              {t('checking')}
            </span>
          )}
          {check.status === 'available' && (
            <span className="inline-flex items-center gap-1 text-green-600">
              <CheckCircle2Icon className="size-4" aria-hidden />
              {t('available')} · {previewUrl}
            </span>
          )}
          {check.status === 'unavailable' && (
            <span className="inline-flex items-center gap-1 text-destructive">
              <XCircleIcon className="size-4" aria-hidden />
              {t(`errors.${check.reason}`)}
            </span>
          )}
        </div>

        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-sm dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {t('permanenceWarning')}
        </p>
      </div>

      <div className="flex items-start gap-3">
        <Checkbox
          id="terms"
          checked={termsAccepted}
          onCheckedChange={(v) => setTermsAccepted(v === true)}
          className="mt-0.5"
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="terms" className="font-normal text-base">
            {t('termsLabel')}
          </Label>
          <LocaleLink
            href={Routes.TermsOfService}
            target="_blank"
            className="text-primary text-sm underline underline-offset-4"
          >
            {t('termsLink')}
          </LocaleLink>
        </div>
      </div>

      {submitError ? (
        <p role="alert" className="text-destructive">
          {submitError}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        className="h-12 text-lg"
        disabled={!canSubmit}
      >
        {creating ? t('creating') : t('submit')}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirm.title')}</AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              {t('confirm.description', { url: previewUrl })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={creating}>
              {t('confirm.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                create();
              }}
              disabled={creating}
            >
              {creating ? t('creating') : t('confirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
