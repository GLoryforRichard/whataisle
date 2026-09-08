'use client';

import { createPortalAction } from '@/actions/create-customer-portal-session';
import {
  cancelStoreRenewalAction,
  createStoreBillingPortalAction,
  createStoreCheckoutAction,
  getStoreBillingAction,
  previewStoreOfferAction,
  resumeStoreRenewalAction,
  scheduleStorePlanAction,
} from '@/actions/store-billing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMounted } from '@/hooks/use-mounted';
import { LocaleLink } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import type {
  StoreOfferPreview,
  StorePlan,
} from '@/payment/store-billing/model';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { useRef, useState } from 'react';

export function StoreSubscriptionCard({
  publicOffer = false,
}: {
  publicOffer?: boolean;
}) {
  const locale = useLocale() === 'zh' ? 'zh' : 'en';
  const zh = locale === 'zh';
  // SSR renders controls before their click handlers exist. Keep plan/payment
  // input disabled until hydration so an early tap cannot silently disappear.
  const mounted = useMounted();
  const { data: session } = authClient.useSession();
  const signedIn = mounted && !!session?.user;
  const userId = session?.user?.id ?? null;
  const client = useQueryClient();
  const [plan, setPlan] = useState<StorePlan>('month');
  const [promoCode, setPromoCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkingPromotion, setCheckingPromotion] = useState(false);
  const [preview, setPreview] = useState<{
    userId: string;
    plan: StorePlan;
    promoCode: string;
    offer: StoreOfferPreview;
  } | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<'cancel' | 'switch' | null>(null);
  const requestId = useRef<string | null>(null);
  const previewRevision = useRef(0);
  const { data, isPending, isError } = useQuery({
    queryKey: ['store-billing', userId],
    enabled: signedIn,
    refetchInterval: 30_000,
    queryFn: async () => {
      const result = await getStoreBillingAction({});
      if (!result?.data?.success) throw new Error('Billing unavailable');
      return result.data;
    },
  });
  const billing = signedIn ? data?.billing : undefined;
  const committedBilling = billing?.status === 'pending' ? null : billing;
  const active = signedIn && billing && data?.access.accessAllowed;
  // No client interpretation of codes: prices and bonus terms come only from
  // this signed-in owner's successful server preview of the current inputs.
  const validatedOffer =
    signedIn &&
    !committedBilling &&
    preview?.userId === userId &&
    preview?.plan === plan &&
    preview?.promoCode === promoCode
      ? preview.offer
      : null;
  const test = committedBilling?.isTest ?? validatedOffer?.isTest ?? false;
  const currency =
    committedBilling?.currency ?? validatedOffer?.currency ?? 'usd';
  const prefix = currency === 'cad' ? 'CA$' : 'US$';
  const selectedPlan = validatedOffer?.plan ?? (test ? 'month' : plan);
  const amount = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
  }).format(
    (validatedOffer?.amount ??
      (test ? 100 : selectedPlan === 'month' ? 19900 : 199900)) / 100
  );
  const checkoutPromoCode = committedBilling ? '' : promoCode;
  const promotionNeedsValidation =
    !!checkoutPromoCode.trim() && !validatedOffer;
  const date = (value: string | Date | null | undefined) =>
    value
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(
          new Date(value)
        )
      : '—';

  function clearOfferPreview() {
    // Invalidate an in-flight response as well as a previously rendered offer.
    // Editing inputs must never restore an older price when that request ends.
    previewRevision.current += 1;
    setPreview(null);
    setCheckingPromotion(false);
    setError('');
    requestId.current = null;
  }

  async function applyPromotion() {
    if (!signedIn || !userId || !promoCode.trim() || busy) return;
    const revision = ++previewRevision.current;
    setCheckingPromotion(true);
    setPreview(null);
    setError('');
    requestId.current = null;
    try {
      const result = await previewStoreOfferAction({ plan, promoCode });
      if (revision !== previewRevision.current) return;
      if (!result?.data?.success || !result.data.offer) {
        setError(
          result?.data && 'error' in result.data && result.data.error
            ? result.data.error
            : zh
              ? '优惠码未能验证，请检查后重新应用。'
              : 'The promotion code could not be verified. Check it and apply again.'
        );
        return;
      }
      setPreview({ userId, plan, promoCode, offer: result.data.offer });
    } catch {
      if (revision !== previewRevision.current) return;
      setError(
        zh
          ? '优惠码未能验证，请稍后重新应用。'
          : 'The promotion code could not be verified. Apply it again later.'
      );
    } finally {
      if (revision === previewRevision.current) setCheckingPromotion(false);
    }
  }

  async function mutate(action: () => Promise<boolean>) {
    setBusy(true);
    setError('');
    try {
      if (!(await action())) throw new Error('Action not completed');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['store-billing'] }),
        client.invalidateQueries({ queryKey: ['owner-store'] }),
      ]);
    } catch {
      requestId.current = null;
      setError(
        zh
          ? '未能完成，请检查优惠码或稍后重试。付款结果以账单为准。'
          : 'Could not complete. Check the promotion code or try again. Your billing page shows confirmed payments.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="space-y-5 rounded-xl border bg-card p-6"
      aria-label={zh ? '门店订阅' : 'Store subscription'}
    >
      <h2 className="font-semibold text-xl">
        {zh ? '门店订阅' : 'Store subscription'}
      </h2>
      {error && (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      )}
      {isError && (
        <p role="alert">
          {zh
            ? '订阅暂时无法读取，请刷新重试。'
            : 'Subscription could not be loaded. Refresh to retry.'}
        </p>
      )}
      {signedIn && isPending && !publicOffer ? (
        <p aria-live="polite">
          {zh ? '正在读取订阅…' : 'Loading subscription…'}
        </p>
      ) : signedIn && data?.legacySubscription ? (
        <>
          <p>
            {zh
              ? '这个账号已有订阅。请管理现有账单，避免重复购买。'
              : 'This account already has a subscription. Manage the existing billing to avoid a duplicate purchase.'}
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              mutate(async () => {
                if (!session?.user) return false;
                const result = await createPortalAction({
                  userId: session.user.id,
                });
                if (!result?.data?.success || !result.data.data?.url)
                  return false;
                window.location.assign(result.data.data.url);
                return true;
              })
            }
          >
            {zh ? '管理现有订阅' : 'Manage existing subscription'}
          </Button>
        </>
      ) : active ? (
        <>
          <p className="font-semibold text-2xl">
            {prefix}
            {billing.isTest ? '1' : billing.plan === 'month' ? '199' : '1,999'}{' '}
            /{' '}
            {billing.plan === 'month'
              ? zh
                ? '月'
                : 'month'
              : zh
                ? '年'
                : 'year'}
          </p>
          <p>
            {billing.cancelAtEnd
              ? zh
                ? '已取消自动续费，服务保留至 '
                : 'Renewal canceled. Access remains until '
              : zh
                ? '下次续费日期：'
                : 'Next renewal: '}
            {date(billing.entitlementEnd)}
          </p>
          {billing.status === 'grace' && (
            <p role="alert">
              {zh
                ? '续费未成功。请更新付款方式，完整服务保留至 '
                : 'Renewal failed. Update your payment method. Full access remains until '}
              {date(billing.graceEndsAt)}
            </p>
          )}
          {billing.status === 'active' &&
            !billing.cancelAtEnd &&
            billing.entitlementEnd &&
            new Date(billing.entitlementEnd).getTime() <= Date.now() && (
              <p aria-live="polite">
                {zh
                  ? '正在确认本次续费，期间门店照常使用。'
                  : 'Confirming this renewal. Your store remains available while payment is processed.'}
              </p>
            )}
          {billing.pendingPlan && (
            <p aria-live="polite">
              {zh ? '已预约到期转为' : 'Scheduled at term end: '}
              {billing.pendingPlan === 'year'
                ? zh
                  ? '年付'
                  : 'annual billing'
                : zh
                  ? '月付'
                  : 'monthly billing'}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            {session?.user && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  mutate(async () => {
                    const result = await createStoreBillingPortalAction({});
                    if (!result?.data?.success || !result.data.url)
                      return false;
                    window.location.assign(result.data.url);
                    return true;
                  })
                }
              >
                {zh ? '付款方式和收据' : 'Payment method and receipts'}
              </Button>
            )}
            {!billing.isTest &&
              !billing.cancelAtEnd &&
              billing.entitlementEnd &&
              new Date(billing.entitlementEnd).getTime() > Date.now() && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirm('switch')}
                >
                  {billing.plan === 'month'
                    ? zh
                      ? '预约到期转年付'
                      : 'Switch to annual at term end'
                    : zh
                      ? '预约到期转月付'
                      : 'Switch to monthly at term end'}
                </Button>
              )}
            {billing.cancelAtEnd ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  mutate(
                    async () =>
                      !!(await resumeStoreRenewalAction({}))?.data?.success
                  )
                }
              >
                {zh ? '恢复自动续费' : 'Resume renewal'}
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setConfirm('cancel')}
              >
                {zh ? '取消自动续费' : 'Cancel renewal'}
              </Button>
            )}
          </div>
          {confirm && (
            <div className="space-y-3 border-t pt-4">
              <p>
                {confirm === 'cancel' ? (
                  <>
                    {zh
                      ? '取消后不会再续费扣款，服务保留至 '
                      : 'No more renewal charges. Access remains until '}
                    {date(billing.entitlementEnd)}
                    {zh
                      ? '。预约切换也会取消，已付费用不自动退款。'
                      : '. Any scheduled switch is canceled. Payments are not automatically refunded.'}
                  </>
                ) : (
                  <>
                    {zh
                      ? '当前使用期用完后，再扣'
                      : 'After your current service period ends, charge '}
                    {prefix}
                    {billing.plan === 'month' ? '1,999' : '199'} /{' '}
                    {billing.plan === 'month'
                      ? zh
                        ? '12 个月'
                        : '12 months'
                      : zh
                        ? '月'
                        : 'month'}
                    {zh ? '。现在不扣款。' : '. No charge today.'}
                  </>
                )}
              </p>
              <div className="flex gap-3">
                <Button
                  variant={confirm === 'cancel' ? 'destructive' : 'default'}
                  disabled={busy}
                  onClick={() =>
                    mutate(async () => {
                      const result =
                        confirm === 'cancel'
                          ? await cancelStoreRenewalAction({})
                          : await scheduleStorePlanAction({
                              plan: billing.plan === 'month' ? 'year' : 'month',
                            });
                      if (result?.data?.success) {
                        setConfirm(null);
                        return true;
                      }
                      return false;
                    })
                  }
                >
                  {confirm === 'cancel'
                    ? zh
                      ? '确认取消续费'
                      : 'Confirm cancel renewal'
                    : zh
                      ? '确认到期切换'
                      : 'Confirm scheduled switch'}
                </Button>
                <Button variant="ghost" onClick={() => setConfirm(null)}>
                  {zh ? '返回' : 'Back'}
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {billing?.status === 'suspended' && (
            <p>
              {zh
                ? '门店已暂停。保留期内付款可恢复原有数据，停用期间不补收费用。数据保留至 '
                : 'Service is paused. Pay during retention to restore existing data, without charges for suspended time. Data retained until '}
              {date(billing.retentionUntil)}
            </p>
          )}
          {!test && (
            <div className="flex gap-2">
              {(['month', 'year'] as const).map((value) => (
                <Button
                  type="button"
                  key={value}
                  aria-pressed={selectedPlan === value}
                  disabled={!mounted || busy}
                  variant={selectedPlan === value ? 'default' : 'outline'}
                  onClick={() => {
                    setPlan(value);
                    clearOfferPreview();
                  }}
                >
                  {value === 'month'
                    ? zh
                      ? '月付'
                      : 'Monthly'
                    : zh
                      ? '年付'
                      : 'Annual'}
                </Button>
              ))}
            </div>
          )}
          <p className="font-semibold text-3xl">
            {prefix}
            {amount}
            <span className="ml-2 font-normal text-base">
              /{' '}
              {selectedPlan === 'month'
                ? zh
                  ? '月'
                  : 'month'
                : zh
                  ? '年'
                  : 'year'}
            </span>
          </p>
          <p aria-live="polite" data-testid="store-offer-term">
            {test
              ? zh
                ? '指定测试账号专用，每月 CA$1，直到取消。'
                : 'Designated test accounts only. CA$1/month until canceled.'
              : validatedOffer?.bonusMonths
                ? zh
                  ? `优惠包含 ${validatedOffer.bonusMonths} 个月赠送时间，首次共用 ${validatedOffer.serviceMonths} 个月；之后按${selectedPlan === 'month' ? '月' : '年'}续费。`
                  : `Includes ${validatedOffer.bonusMonths} bonus months: ${validatedOffer.serviceMonths} months total. Renews ${selectedPlan === 'month' ? 'monthly' : 'annually'} after the first term.`
                : selectedPlan === 'month'
                  ? zh
                    ? '本次付款包含 1 个月服务，之后按月自动续费，直到取消。'
                    : 'Payment covers 1 month. Renews monthly until canceled.'
                  : zh
                    ? '本次付款包含 12 个月服务，之后按年自动续费，直到取消。'
                    : 'Payment covers 12 months. Renews annually until canceled.'}
          </p>
          {signedIn && !committedBilling && (
            <div className="max-w-sm space-y-2">
              <Label htmlFor="store-promo">
                {zh ? '优惠码（可选）' : 'Promotion code (optional)'}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="store-promo"
                  disabled={!mounted || busy}
                  value={promoCode}
                  onChange={(e) => {
                    setPromoCode(e.target.value);
                    clearOfferPreview();
                  }}
                  maxLength={96}
                  autoComplete="off"
                  autoCapitalize="characters"
                  placeholder={zh ? '输入优惠码' : 'Enter promotion code'}
                  aria-describedby="store-promo-status"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    !mounted || busy || checkingPromotion || !promoCode.trim()
                  }
                  onClick={applyPromotion}
                >
                  {checkingPromotion
                    ? zh
                      ? '验证中…'
                      : 'Checking…'
                    : zh
                      ? '应用'
                      : 'Apply'}
                </Button>
              </div>
              <p
                id="store-promo-status"
                className="text-muted-foreground text-sm"
                aria-live="polite"
              >
                {validatedOffer
                  ? zh
                    ? '优惠码已应用。'
                    : 'Promotion applied.'
                  : promotionNeedsValidation
                    ? zh
                      ? '请先应用并验证优惠码，再继续付款。'
                      : 'Apply your promotion code before continuing to payment.'
                    : zh
                      ? '多个优惠码用空格或逗号分隔。'
                      : 'Separate multiple codes with spaces or commas.'}
              </p>
            </div>
          )}
          <p className="text-muted-foreground text-sm">
            {zh
              ? '正式套餐为税前价格，适用税费和最终金额会在付款前显示。服务从付款当天开始。'
              : 'Formal prices exclude applicable tax, shown with the final total before payment. Service begins on payment.'}
          </p>
          {signedIn ? (
            <Button
              disabled={
                !mounted ||
                busy ||
                isPending ||
                isError ||
                checkingPromotion ||
                promotionNeedsValidation
              }
              onClick={() =>
                mutate(async () => {
                  requestId.current ??= crypto.randomUUID();
                  const result = await createStoreCheckoutAction({
                    plan: selectedPlan,
                    promoCode: checkoutPromoCode,
                    requestId: requestId.current,
                    locale,
                  });
                  if (!result?.data?.success || !result.data.url) return false;
                  window.location.assign(result.data.url);
                  return true;
                })
              }
            >
              {busy
                ? zh
                  ? '正在打开付款…'
                  : 'Opening checkout…'
                : billing?.status === 'suspended'
                  ? zh
                    ? '付款恢复服务'
                    : 'Pay to restore service'
                  : zh
                    ? '继续付款开通'
                    : 'Continue to payment'}
            </Button>
          ) : (
            <Button asChild>
              <LocaleLink href="/auth/register">
                {zh ? '注册并开通门店' : 'Register and open your store'}
              </LocaleLink>
            </Button>
          )}
        </>
      )}
      <p className="text-muted-foreground text-sm">
        {zh
          ? '取消续费不影响当前剩余使用期。需要退款请联系 '
          : 'Canceling renewal preserves your remaining service period. For refund requests, contact '}
        <a href="mailto:support@whataisle.com" className="underline">
          support@whataisle.com
        </a>
      </p>
    </section>
  );
}
