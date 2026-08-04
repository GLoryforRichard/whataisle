'use client';

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { usePaymentCompletion } from '@/hooks/use-payment-completion';
import { LocaleLink } from '@/i18n/navigation';
import { PAYMENT_MAX_POLL_TIME, PAYMENT_POLL_INTERVAL } from '@/lib/constants';
import { Routes } from '@/routes';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  RefreshCwIcon,
  XCircleIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type PaymentStatus = 'processing' | 'success' | 'failed' | 'timeout';

/**
 * Payment card component to display the payment status and redirect to the callback url
 */
export function PaymentCard() {
  const t = useTranslations('Dashboard.settings.payment');
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<PaymentStatus>('processing');
  const pollStartTime = useRef<number | undefined>(undefined);
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Get URL parameters
  const callback = searchParams.get('callback');
  const sessionId = searchParams.get('session_id');

  // Check payment completion using the existing hook
  const { data: paymentCheck } = usePaymentCompletion(
    sessionId,
    status === 'processing' && !!sessionId
  );

  // Handle payment completion polling and timeout
  useEffect(() => {
    if (sessionId && status === 'processing') {
      pollStartTime.current = Date.now();

      const checkTimeout = () => {
        if (pollStartTime.current) {
          const elapsed = Date.now() - pollStartTime.current;
          if (elapsed > PAYMENT_MAX_POLL_TIME) {
            setStatus('timeout');
            return;
          }
        }
        // Continue checking if still processing
        if (status === 'processing') {
          timeoutRef.current = setTimeout(checkTimeout, PAYMENT_POLL_INTERVAL);
        }
      };

      checkTimeout();
    }

    // Cleanup function, clear timeout
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [sessionId, status]);

  // Handle payment completion, if payment is paid, change status to success
  useEffect(() => {
    if (paymentCheck?.isPaid && status === 'processing') {
      setStatus('success');
    }
  }, [paymentCheck, status]);

  // On success, refresh the cached payment/subscription state but do NOT
  // auto-redirect: the store deployment is installed manually by the founder,
  // so the success copy ("we'll be in touch") is the important part of this
  // page. The user continues to billing via the button below when ready.
  useEffect(() => {
    if (status === 'success') {
      const refreshCaches = async () => {
        const queryKey =
          callback === Routes.SettingsCredits ? ['credits'] : ['payment'];
        await queryClient.invalidateQueries({ queryKey });
        await queryClient.refetchQueries({ queryKey });
      };
      refreshCaches();
    }
  }, [status, callback, queryClient]);

  // Cleanup on unmount, clear timeout
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const getStatusIcon = () => {
    switch (status) {
      case 'processing':
        return (
          <RefreshCwIcon className="h-12 w-12 animate-spin text-[var(--brand-dark)]" />
        );
      case 'success':
        return <CheckCircleIcon className="h-12 w-12 text-green-600" />;
      case 'failed':
        return <XCircleIcon className="h-12 w-12 text-red-600" />;
      case 'timeout':
        return <AlertCircleIcon className="h-12 w-12 text-yellow-600" />;
      default:
        return <RefreshCwIcon className="h-12 w-12 text-gray-600" />;
    }
  };

  const getStatusMessage = () => {
    switch (status) {
      case 'processing':
        return {
          title: t('processing.title'),
          description: t('processing.description'),
        };
      case 'success':
        return {
          title: t('success.title'),
          description: t('success.description'),
        };
      case 'failed':
        return {
          title: t('failed.title'),
          description: t('failed.description'),
        };
      case 'timeout':
        return {
          title: t('timeout.title'),
          description: t('timeout.description'),
        };
      default:
        return { title: '', description: '' };
    }
  };

  const { title, description } = getStatusMessage();

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center py-4">
          <div className="flex justify-center mb-8">{getStatusIcon()}</div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
          {status === 'success' && (
            <div className="mt-6 flex justify-center">
              <LocaleLink
                href={callback ?? Routes.SettingsBilling}
                className="inline-flex items-center rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90"
              >
                {t('success.action')}
              </LocaleLink>
            </div>
          )}
        </CardHeader>
      </Card>
    </div>
  );
}
