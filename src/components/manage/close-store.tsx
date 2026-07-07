'use client';

import { closeStoreAction } from '@/actions/close-store';
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
import { Input } from '@/components/ui/input';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

/**
 * Store closure (requirements §7): strongly steer to export first, require the
 * owner to type the store name, then a second confirmation. Deletion is
 * immediate and irreversible.
 */
export function CloseStore({ storeName }: { storeName: string }) {
  const t = useTranslations('Manage.close');
  const [typed, setTyped] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  const nameMatches = typed.trim() === storeName;

  async function close() {
    setClosing(true);
    try {
      const res = await closeStoreAction({ confirmName: typed.trim() });
      if (res?.data?.success) {
        // Store is gone — send the owner somewhere neutral.
        window.location.href = '/';
      } else {
        setClosing(false);
        setConfirmOpen(false);
      }
    } catch {
      setClosing(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-destructive/40 p-5">
      <p className="font-medium text-destructive">{t('warning')}</p>

      <div className="flex flex-col gap-2">
        <label htmlFor="confirm-name" className="text-sm">
          {t('confirmType')}
        </label>
        <Input
          id="confirm-name"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={t('namePlaceholder')}
          className="h-11 max-w-sm"
          autoComplete="off"
        />
      </div>

      <Button
        variant="destructive"
        className="w-fit"
        disabled={!nameMatches || closing}
        onClick={() => setConfirmOpen(true)}
      >
        {t('closeButton')}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              {t('confirmBody', { name: storeName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closing}>
              {t('confirmCancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                close();
              }}
              disabled={closing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {closing ? t('closing') : t('confirmDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
