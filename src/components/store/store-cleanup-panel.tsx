'use client';

import {
  activateStoreSearchAction,
  getStoreCleanupAction,
  requestStoreCleanupAction,
  retryStoreProvisioningAction,
} from '@/actions/owner-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { useState } from 'react';

export function StoreCleanupPanel() {
  const zh = useLocale() === 'zh';
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { data, isPending, isError } = useQuery({
    queryKey: ['store-cleanup'],
    refetchInterval: 5000,
    queryFn: async () => {
      const result = await getStoreCleanupAction({});
      if (!result?.data?.success) throw new Error('Store list unavailable');
      return result.data.stores;
    },
  });
  return (
    <section className="space-y-4">
      <h2 className="font-semibold text-xl">
        {zh ? '自助开通门店' : 'Self-service stores'}
      </h2>
      {isPending && <p aria-live="polite">{zh ? '正在读取…' : 'Loading…'}</p>}
      {(isError || error) && (
        <p role="alert">
          {zh
            ? '操作未完成，请刷新后重试。'
            : 'Could not complete. Refresh and retry.'}
        </p>
      )}
      {data?.map((tenant) => {
        const due =
          tenant.retentionUntil &&
          new Date(tenant.retentionUntil).getTime() <= Date.now();
        return (
          <div
            key={tenant.id}
            className="space-y-3 rounded-xl border bg-card p-5"
          >
            <h3 className="font-medium">
              {tenant.displayName} · {tenant.handle}
            </h3>
            <p>
              {tenant.cleanupRequestedAt
                ? zh
                  ? '人工清理已排队'
                  : 'Approved cleanup queued'
                : due
                  ? zh
                    ? '数据保留期已满 · 待清理'
                    : 'Retention ended · pending cleanup'
                  : tenant.readyAt
                    ? zh
                      ? tenant.runtimeKind === 'activate' &&
                        tenant.runtimeStatus === 'ready'
                        ? '地图、搜索和照片上传已开放'
                        : '地图可保存，照片上传准备中'
                      : tenant.runtimeKind === 'activate' &&
                          tenant.runtimeStatus === 'ready'
                        ? 'Map, search and photo uploads available'
                        : 'Map available; photo uploads are being prepared'
                    : zh
                      ? '门店正在准备或需要处理'
                      : 'Store preparing or needs attention'}
            </p>
            {tenant.readyAt &&
              tenant.accessAllowed &&
              !tenant.cleanupRequestedAt &&
              !['closing', 'closed'].includes(tenant.status) &&
              tenant.runtimeKind === 'provision' &&
              tenant.runtimeStatus === 'ready' && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {zh
                      ? '确认平面图后手动开启。此操作只准备搜索和照片上传，不会自动升级套餐或付款。'
                      : 'Enable after confirming the map. This prepares search and photo uploads without upgrading a plan or making a payment.'}
                  </p>
                  <Button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        const result = await activateStoreSearchAction({
                          storeId: tenant.id,
                        });
                        if (!result?.data?.success)
                          throw new Error('Activation failed');
                        await client.invalidateQueries({
                          queryKey: ['store-cleanup'],
                        });
                      } catch {
                        setError('failed');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {zh
                      ? '开放搜索和照片上传'
                      : 'Enable search and photo uploads'}
                  </Button>
                </div>
              )}
            {tenant.retentionUntil && (
              <p>
                {zh ? '保留至：' : 'Retain until: '}
                {new Date(tenant.retentionUntil).toLocaleDateString(
                  zh ? 'zh-CN' : 'en-CA'
                )}
              </p>
            )}
            {tenant.runtimeStatus === 'failed' &&
              (tenant.runtimeKind !== 'activate' || tenant.accessAllowed) && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      const result = await retryStoreProvisioningAction({
                        storeId: tenant.id,
                      });
                      if (!result?.data?.success)
                        throw new Error('Retry failed');
                      await client.invalidateQueries({
                        queryKey: ['store-cleanup'],
                      });
                    } catch {
                      setError('failed');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {zh ? '重试门店任务' : 'Retry store job'}
                </Button>
              )}
            {due &&
              !tenant.cleanupRequestedAt &&
              tenant.readyAt &&
              tenant.runtimeKind !== 'archive' &&
              tenant.runtimeStatus !== 'provisioning' && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelected(tenant.id);
                    setConfirmation('');
                  }}
                >
                  {zh ? '审阅清理' : 'Review cleanup'}
                </Button>
              )}
            {selected === tenant.id && (
              <form
                className="space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError('');
                  try {
                    const result = await requestStoreCleanupAction({
                      storeId: tenant.id,
                      confirmation,
                    });
                    if (!result?.data?.success) throw new Error('Failed');
                    setSelected(null);
                    await client.invalidateQueries({
                      queryKey: ['store-cleanup'],
                    });
                  } catch {
                    setError('failed');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <p>
                  {zh
                    ? '这会停止门店并清理商品数据库，照片和运行文件移入平台私有归档。客户不再能自助恢复。不会发送邮件。'
                    : 'This stops the store and clears its product database. Photos and runtime files move into private platform archives. Self-service recovery ends. No email is sent.'}
                </p>
                <Label htmlFor={`cleanup-${tenant.id}`}>
                  {zh
                    ? `输入 ${tenant.handle} 确认清理`
                    : `Type ${tenant.handle} to confirm cleanup`}
                </Label>
                <Input
                  id={`cleanup-${tenant.id}`}
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
                <Button
                  variant="destructive"
                  disabled={busy || confirmation !== tenant.handle}
                >
                  {zh ? '确认清理这家门店' : 'Confirm store cleanup'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSelected(null)}
                >
                  {zh ? '取消' : 'Cancel'}
                </Button>
              </form>
            )}
          </div>
        );
      })}
    </section>
  );
}
