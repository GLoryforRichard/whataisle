'use client';

import {
  addShelfAction,
  clearShelfAction,
  deleteProductAction,
} from '@/actions/shelf-actions';
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
import { useLocaleRouter } from '@/i18n/navigation';
import { Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

interface Product {
  id: string;
  name: string;
  nameZh: string | null;
}
interface Shelf {
  id: string;
  code: string;
  label: string | null;
  products: Product[];
}

export function ShelfManager({ shelves }: { shelves: Shelf[] }) {
  const t = useTranslations('Manage.shelves');
  const router = useLocaleRouter();
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [clearTarget, setClearTarget] = useState<Shelf | null>(null);
  const [busy, setBusy] = useState(false);

  async function addShelf() {
    if (!newCode.trim()) return;
    setBusy(true);
    try {
      const res = await addShelfAction({
        code: newCode.trim(),
        label: newLabel.trim() || undefined,
      });
      if (res?.data?.success) {
        setNewCode('');
        setNewLabel('');
        router.refresh();
      } else {
        toast.error(t('shelfCode'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function deleteProduct(id: string) {
    await deleteProductAction({ productId: id });
    toast.success(t('deleted'));
    router.refresh();
  }

  async function clearShelf() {
    if (!clearTarget) return;
    setBusy(true);
    try {
      const res = await clearShelfAction({ shelfId: clearTarget.id });
      if (res?.data?.success) {
        toast.success(t('deleted'));
        setClearTarget(null);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Add shelf */}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          addShelf();
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="new-code" className="text-sm">
            {t('shelfCode')}
          </label>
          <Input
            id="new-code"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            className="h-10 w-28"
            placeholder="B4"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="new-label" className="text-sm">
            {t('shelfLabel')}
          </label>
          <Input
            id="new-label"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="h-10 w-48"
          />
        </div>
        <Button type="submit" disabled={busy || !newCode.trim()}>
          {t('add')}
        </Button>
      </form>

      {shelves.length === 0 ? (
        <p className="text-muted-foreground">{t('noShelves')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {shelves.map((shelf) => (
            <div key={shelf.id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-lg">{shelf.code}</span>
                  {shelf.label ? (
                    <span className="ml-2 text-muted-foreground">
                      {shelf.label}
                    </span>
                  ) : null}
                  <span className="ml-2 text-muted-foreground text-sm">
                    · {t('products', { count: shelf.products.length })}
                  </span>
                </div>
                {shelf.products.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => setClearTarget(shelf)}
                  >
                    {t('clearShelf')}
                  </Button>
                ) : null}
              </div>

              {shelf.products.length === 0 ? (
                <p className="mt-2 text-muted-foreground text-sm">
                  {t('empty')}
                </p>
              ) : (
                <ul className="mt-3 flex flex-col gap-1">
                  {shelf.products.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between border-b py-1.5 last:border-0"
                    >
                      <span>
                        {p.name}
                        {p.nameZh ? (
                          <span className="ml-2 text-muted-foreground text-sm">
                            {p.nameZh}
                          </span>
                        ) : null}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground"
                        onClick={() => deleteProduct(p.id)}
                        aria-label={t('delete')}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <AlertDialog
        open={!!clearTarget}
        onOpenChange={(o) => !o && setClearTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('clearShelf')}</AlertDialogTitle>
            <AlertDialogDescription>
              {clearTarget
                ? t('clearConfirm', {
                    count: clearTarget.products.length,
                    code: clearTarget.code,
                  })
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                clearShelf();
              }}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('clear')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
