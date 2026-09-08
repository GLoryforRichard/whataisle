'use client';

import { createPortalAction } from '@/actions/create-customer-portal-session';
import {
  cancelStoreRenewalAction,
  createStoreBillingPortalAction,
  createStoreCheckoutAction,
  getStoreBillingAction,
  resumeStoreRenewalAction,
  scheduleStorePlanAction,
} from '@/actions/store-billing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMounted } from '@/hooks/use-mounted';
import { LocaleLink } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import type { StorePlan } from '@/payment/store-billing/model';
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
  const client = useQueryClient();
  const [plan, setPlan] = useState<StorePlan>('month');
  const [promoCode, setPromoCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<'cancel' | 'switch' | null>(null);
  const requestId = useRef<string | null>(null);
  const { data, isPending, isError } = useQuery({
    queryKey: ['store-billing'],
    enabled: !!session?.user,
    refetchInterval: 30_000,
    queryFn: async () => {
      const result = await getStoreBillingAction({});
      if (!result?.data?.success) throw new Error('Billing unavailable');
      return result.data;
    },
  });
  const billing = data?.billing;
  const committedBilling = billing?.status === 'pending' ? null : billing;
  const active = billing && data?.access.accessAllowed;
  const test =
    committedBilling?.isTest ?? promoCode.trim().toUpperCase() === '1CADTEST';
  const currency =
    committedBilling?.currency ??
    (['INCAD', '1CADTEST'].includes(promoCode.trim().toUpperCase())
      ? 'cad'
      : 'usd');
  const prefix = currency === 'cad' ? 'CA$' : 'US$';
  const selectedPlan = test ? 'month' : plan;
  const amount = test ? '1' : selectedPlan === 'month' ? '199' : '1,999';
  const date = (value: string | Date | null | undefined) =>
    value
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(
          new Date(value)
        )
      : '—';

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
      {session?.user && isPending && !publicOffer ? (
        <p aria-live="polite">
          {zh ? '正在读取订阅…' : 'Loading subscription…'}
        </p>
      ) : data?.legacySubscription ? (
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
                  zh ? (
                    '取消后不会再续费扣款，已付费和赠送时间继续有效。预约切换也会取消，已付费用不自动退款。'
                  ) : (
                    'No more renewal charges. Paid and bonus time remain. Any scheduled switch is canceled. Payments are not automatically refunded.'
                  )
                ) : (
                  <>
                    {zh
                      ? '当前使用期用完后，再扣'
                      : 'After your current paid and bonus time ends, charge '}
                    {prefix}
                    {billing.plan === 'month' ? '1,999' : '199'} /{' '}
                    {billing.plan === 'month'
                      ? zh
                        ? '12 个月'
                        : '12 months'
                      : zh
                        ? '月'
                        : 'month'}
                    {zh
                      ? '。现在不扣款，不重复赠送。'
                      : '. No charge today and no repeat bonus.'}
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
                    requestId.current = null;
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
          <p>
            {test
              ? zh
                ? '指定测试账号专用，不送月份；每月 CA$1，直到取消。'
                : 'Designated test accounts only. CA$1/month until canceled, without bonus months.'
              : billing?.giftUsedAt
                ? zh
                  ? '恢复服务从本次付款当天起算，不重复赠送月份。'
                  : 'Restored service starts on this payment date, without another bonus.'
                : selectedPlan === 'month'
                  ? zh
                    ? '新店首次付一个月，送两个月，共用 3 个月；第 4 个月开始每月续费。'
                    : 'New stores pay for one month and receive two bonus months: 3 months total. Monthly renewals start in month 4.'
                  : zh
                    ? '新店首次年付送两个月，共用 14 个月；以后每 12 个月续费。'
                    : 'New annual stores receive 2 bonus months: 14 months total. Renew every 12 months thereafter.'}
          </p>
          {!committedBilling && (
            <div className="max-w-sm space-y-2">
              <Label htmlFor="store-promo">
                {zh ? '优惠码（可选）' : 'Promotion code (optional)'}
              </Label>
              <Input
                id="store-promo"
                disabled={!mounted || busy}
                value={promoCode}
                onChange={(e) => {
                  setPromoCode(e.target.value.toUpperCase());
                  requestId.current = null;
                }}
                maxLength={32}
                autoComplete="off"
                placeholder="INCAD"
              />
            </div>
          )}
          <p className="text-muted-foreground text-sm">
            {zh
              ? '正式套餐为税前价格，适用税费和最终金额会在付款前显示。服务从付款当天开始，赠送每家店仅一次。'
              : 'Formal prices exclude applicable tax, shown with the final total before payment. Service begins on payment. Each store receives the bonus once.'}
          </p>
          {session?.user ? (
            <Button
              disabled={!mounted || busy || isPending || isError}
              onClick={() =>
                mutate(async () => {
                  requestId.current ??= crypto.randomUUID();
                  const result = await createStoreCheckoutAction({
                    plan: selectedPlan,
                    promoCode,
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
          ? '取消续费不影响已购买和赠送的使用期。需要退款请联系 '
          : 'Canceling renewal preserves paid and bonus time. For refund requests, contact '}
        <a href="mailto:support@whataisle.com" className="underline">
          support@whataisle.com
        </a>
      </p>
    </section>
  );
}
