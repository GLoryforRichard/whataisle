'use client';

import {
  checkStoreHandleAction,
  createOwnerStoreAction,
  getOwnerStoreAction,
  openOwnerMapAction,
  updateOwnerStoreAction,
} from '@/actions/owner-store';
import { getStoreBillingAction } from '@/actions/store-billing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { useState } from 'react';

export function OwnerStorePanel() {
  const zh = useLocale() === 'zh';
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [handle, setHandle] = useState('');
  const [checkedHandle, setCheckedHandle] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const {
    data: response,
    isPending,
    isError,
  } = useQuery({
    queryKey: ['owner-store'],
    queryFn: async () => {
      const result = await getOwnerStoreAction({});
      if (!result?.data?.success) throw new Error('Store could not be loaded');
      return result.data;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.store?.runtimeStatus;
      return status && ['queued', 'retry', 'provisioning'].includes(status)
        ? 5000
        : false;
    },
  });
  const { data: billingResult } = useQuery({
    queryKey: ['store-billing'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const result = await getStoreBillingAction({});
      if (!result?.data?.success)
        throw new Error('Billing could not be loaded');
      return result.data;
    },
  });
  const tenant = response?.store;
  const hasAccess = billingResult?.access.setupAllowed ?? false;
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'whataisle.com';

  async function run(action: () => Promise<boolean>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!(await action())) throw new Error('action failed');
      await queryClient.invalidateQueries({ queryKey: ['owner-store'] });
    } catch {
      setError(
        zh
          ? '操作未完成，请检查输入后重试；不会重复建店。'
          : 'Could not finish. Check your input and retry; your store will not be duplicated.'
      );
    } finally {
      setBusy(false);
    }
  }

  if (isPending)
    return (
      <p aria-live="polite">{zh ? '正在读取门店…' : 'Loading your store…'}</p>
    );
  if (isError)
    return (
      <Button
        variant="outline"
        onClick={() =>
          queryClient.invalidateQueries({ queryKey: ['owner-store'] })
        }
      >
        {zh ? '重新读取门店' : 'Reload store'}
      </Button>
    );
  if (!tenant && !hasAccess)
    return (
      <p className="text-muted-foreground">
        {zh
          ? '付款成功后，在这里设置店名、永久网址和店铺密码。'
          : 'After payment, set your store name, permanent address and workspace password here.'}
      </p>
    );

  return (
    <section
      className="space-y-5 rounded-xl border bg-card p-6"
      aria-label={zh ? '我的门店' : 'My store'}
    >
      <h2 className="font-semibold text-xl">
        {tenant
          ? tenant.displayName
          : zh
            ? '设置你的超市'
            : 'Set up your supermarket'}
      </h2>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p aria-live="polite">{notice}</p>}
      {!tenant ? (
        <form
          className="max-w-lg space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!confirmed || checkedHandle !== handle || pin !== confirmPin)
              return;
            void run(async () => {
              const result = await createOwnerStoreAction({
                displayName,
                handle,
                pin,
                confirmPin,
                domainConfirmed: true,
              });
              if (!result?.data?.success) return false;
              setPin('');
              setConfirmPin('');
              return true;
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="store-name">{zh ? '超市名称' : 'Store name'}</Label>
            <Input
              id="store-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              maxLength={100}
              autoComplete="organization"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="store-handle">
              {zh ? '永久网址' : 'Permanent address'}
            </Label>
            <div className="flex gap-2">
              <Input
                id="store-handle"
                value={handle}
                pattern="[a-z0-9](?:[a-z0-9]|-){1,28}[a-z0-9]"
                onChange={(e) => {
                  setHandle(e.target.value.toLowerCase());
                  setCheckedHandle('');
                  setConfirmed(false);
                }}
                required
                minLength={3}
                maxLength={30}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="teststore1"
              />
              <Button
                type="button"
                variant="outline"
                disabled={busy || handle.length < 3}
                onClick={() =>
                  run(async () => {
                    const result = await checkStoreHandleAction({ handle });
                    if (result?.data?.available) {
                      setCheckedHandle(handle);
                      setNotice(
                        zh ? '这个网址可以使用。' : 'This address is available.'
                      );
                      return true;
                    }
                    setNotice(
                      zh
                        ? '这个网址不可用，请换一个。'
                        : 'This address is unavailable. Choose another.'
                    );
                    return true;
                  })
                }
              >
                {zh ? '检查' : 'Check'}
              </Button>
            </div>
            <p className="break-all text-sm">
              {handle || 'teststore1'}.{rootDomain}
            </p>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={checkedHandle !== handle || !handle}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-1 size-4"
            />
            <span>
              {zh
                ? '我确认这个永久网址，建店后不能修改。超市名称以后可以改。'
                : 'I confirm this permanent address. It cannot be changed after setup; the store name can change.'}
            </span>
          </label>
          <div className="space-y-2">
            <Label htmlFor="store-pin">
              {zh ? '6 位店铺密码' : '6-digit workspace password'}
            </Label>
            <Input
              id="store-pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              minLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-store-pin">
              {zh ? '再输入一次店铺密码' : 'Confirm workspace password'}
            </Label>
            <Input
              id="confirm-store-pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              minLength={6}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <p className="text-muted-foreground text-sm">
            {zh
              ? '店员用这个密码进入工作台，它与老板账号的登录密码不同。'
              : 'Staff use this password to open the workspace. It is separate from your account login password.'}
          </p>
          <Button
            disabled={
              busy || !confirmed || pin !== confirmPin || pin.length !== 6
            }
          >
            {busy
              ? zh
                ? '正在建店…'
                : 'Creating…'
              : zh
                ? '确认并建立门店'
                : 'Confirm and create store'}
          </Button>
        </form>
      ) : (
        <>
          <p className="break-all">{tenant.url}</p>
          {tenant.status === 'closed' || tenant.status === 'closing' ? (
            <p>
              {zh
                ? '门店已进入清理流程。需要帮助请联系平台。'
                : 'This store is in the cleanup process. Contact support for assistance.'}
            </p>
          ) : (
            <>
              {tenant.runtimeStatus !== 'ready' ? (
                <p aria-live="polite">
                  {tenant.runtimeStatus === 'failed'
                    ? zh
                      ? '门店开通需要处理，我们已在后台记录。你的付款和设置已保存。'
                      : 'Setup needs attention. Your payment and settings are saved.'
                    : zh
                      ? '正在准备门店网址，你可以离开本页，稍后回来继续。'
                      : 'Preparing your store address. You can leave and return to continue.'}
                </p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  <Button asChild>
                    <a href={tenant.url}>{zh ? '打开门店' : 'Open store'}</a>
                  </Button>
                  <Button asChild variant="outline">
                    <a href={`${tenant.url}/admin`}>
                      {zh ? '店员工作台' : 'Staff workspace'}
                    </a>
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || !hasAccess}
                    onClick={() =>
                      run(async () => {
                        const result = await openOwnerMapAction({});
                        if (!result?.data?.success || !result.data.url)
                          return false;
                        window.location.assign(result.data.url);
                        return true;
                      })
                    }
                  >
                    {zh ? '编辑平面图' : 'Edit floor map'}
                  </Button>
                </div>
              )}
              <form
                className="max-w-lg space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const result = await updateOwnerStoreAction({
                      displayName,
                    });
                    if (result?.data?.success) {
                      setNotice(zh ? '店名已保存。' : 'Store name saved.');
                      return true;
                    }
                    return false;
                  });
                }}
              >
                <Label htmlFor="edit-store-name">
                  {zh ? '修改超市名称' : 'Change store name'}
                </Label>
                <Input
                  id="edit-store-name"
                  value={displayName}
                  placeholder={tenant.displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  maxLength={100}
                />
                <Button
                  variant="outline"
                  disabled={busy || !displayName.trim()}
                >
                  {zh ? '保存店名' : 'Save name'}
                </Button>
              </form>
              <form
                className="max-w-lg space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (pin !== confirmPin) return;
                  void run(async () => {
                    const result = await updateOwnerStoreAction({ pin });
                    if (!result?.data?.success) return false;
                    setPin('');
                    setConfirmPin('');
                    setNotice(
                      zh
                        ? '密码已更新，所有店员设备需要重新输入。'
                        : 'Password updated. All staff devices must sign in again.'
                    );
                    return true;
                  });
                }}
              >
                <Label htmlFor="new-store-pin">
                  {zh
                    ? '更换 6 位店铺密码'
                    : 'Change 6-digit workspace password'}
                </Label>
                <Input
                  id="new-store-pin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  autoComplete="new-password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  required
                />
                <Label htmlFor="repeat-store-pin">
                  {zh ? '确认新密码' : 'Confirm new password'}
                </Label>
                <Input
                  id="repeat-store-pin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  autoComplete="new-password"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value)}
                  required
                />
                <p className="text-muted-foreground text-sm">
                  {zh
                    ? '保存后，所有之前登录的店员设备都会退出。'
                    : 'Saving signs out every previously authenticated staff device.'}
                </p>
                <Button
                  variant="outline"
                  disabled={busy || pin.length !== 6 || pin !== confirmPin}
                >
                  {zh
                    ? '更新密码并退出旧设备'
                    : 'Update password and sign out devices'}
                </Button>
              </form>
            </>
          )}
        </>
      )}
    </section>
  );
}
