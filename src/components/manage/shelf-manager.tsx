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
import { Input } from '@/components/ui/input';
import { useLocaleRouter } from '@/i18n/navigation';
import { PackageOpenIcon, PlusIcon, Trash2Icon } from 'lucide-react';
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
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(15,53,44,0.04)]"
        onSubmit={(e) => {
          e.preventDefault();
          addShelf();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="new-code"
            className="font-semibold text-foreground text-sm"
          >
            {t('shelfCode')}
          </label>
          <Input
            id="new-code"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            className="h-11 w-24 rounded-xl text-center font-bold text-lg"
            placeholder="B4"
          />
        </div>
        <div className="flex min-w-[10rem] flex-1 flex-col gap-1.5">
          <label
            htmlFor="new-label"
            className="font-semibold text-foreground text-sm"
          >
            {t('shelfLabel')}
          </label>
          <Input
            id="new-label"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="h-11 rounded-xl"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !newCode.trim()}
          className="inline-flex h-11 items-center gap-1.5 rounded-full bg-[var(--brand-green)] px-5 font-bold text-[var(--brand-lime)] transition-transform active:scale-[0.97] disabled:opacity-50"
        >
          <PlusIcon className="size-[18px]" aria-hidden />
          {t('add')}
        </button>
      </form>

      {shelves.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-[#CBD9C6] border-dashed bg-card p-10 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-[#F1F7E8]">
            <PackageOpenIcon
              className="size-8 text-[var(--brand-green)]"
              aria-hidden
            />
          </div>
          <p className="max-w-sm text-muted-foreground leading-relaxed">
            {t('noShelves')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {shelves.map((shelf) => (
            <div
              key={shelf.id}
              className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(15,53,44,0.04)]"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center justify-center rounded-xl border border-[#D8EBB4] bg-[#F1F7E8] px-3 py-1.5 font-bold text-[var(--brand-green)] text-lg leading-none">
                    {shelf.code}
                  </span>
                  <div className="min-w-0">
                    {shelf.label ? (
                      <p className="truncate font-semibold text-foreground">
                        {shelf.label}
                      </p>
                    ) : null}
                    <p className="text-muted-foreground text-sm">
                      {t('products', { count: shelf.products.length })}
                    </p>
                  </div>
                </div>
                {shelf.products.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setClearTarget(shelf)}
                    className="shrink-0 font-semibold text-destructive text-sm hover:underline"
                  >
                    {t('clearShelf')}
                  </button>
                ) : null}
              </div>

              {shelf.products.length === 0 ? (
                <p className="mt-3 text-muted-foreground text-sm">
                  {t('empty')}
                </p>
              ) : (
                <ul className="mt-4 flex flex-col gap-1">
                  {shelf.products.map((p) => (
                    <li
                      key={p.id}
                      className="group flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-[#F7FBEF]"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-medium text-foreground">
                          {p.name}
                        </span>
                        {p.nameZh ? (
                          <span className="ml-2 text-muted-foreground text-sm">
                            {p.nameZh}
                          </span>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteProduct(p.id)}
                        aria-label={t('delete')}
                        className="flex size-8 shrink-0 items-center justify-center rounded-full text-[#7B8479] transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2Icon className="size-4" />
                      </button>
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
        <AlertDialogContent className="rounded-[20px]">
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
            <AlertDialogCancel disabled={busy} className="rounded-xl">
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                clearShelf();
              }}
              disabled={busy}
              className="rounded-xl bg-destructive font-bold text-destructive-foreground hover:bg-destructive/90"
            >
              {t('clear')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
