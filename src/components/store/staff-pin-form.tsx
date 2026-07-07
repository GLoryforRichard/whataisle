'use client';

import { Button } from '@/components/ui/button';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Big-buttoned PIN entry for store staff — must pass the fifty-year-old-clerk
 * test: one field, one button, plain-language errors.
 */
export function StaffPinForm() {
  const t = useTranslations('Store.staff');
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(value: string) {
    if (value.length < 4 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/store/staff/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: value }),
      });
      if (res.ok) {
        router.push('/staff/scan');
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => ({}));
      const code = body?.error;
      setError(
        code === 'wrong_pin'
          ? t('errors.wrong_pin')
          : code === 'too_many_attempts'
            ? t('errors.too_many_attempts')
            : t('errors.generic')
      );
      setPin('');
    } catch {
      setError(t('errors.generic'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="flex flex-col items-center gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit(pin);
      }}
    >
      <InputOTP
        maxLength={6}
        value={pin}
        onChange={setPin}
        inputMode="numeric"
        pattern="\d*"
        autoFocus
      >
        <InputOTPGroup>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <InputOTPSlot key={i} index={i} className="size-12 text-xl" />
          ))}
        </InputOTPGroup>
      </InputOTP>

      {error ? (
        <p role="alert" className="text-center text-destructive">
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        className="h-12 w-full text-lg"
        disabled={pin.length < 4 || submitting}
      >
        {submitting ? t('checking') : t('submit')}
      </Button>
    </form>
  );
}
