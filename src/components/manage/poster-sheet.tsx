'use client';

import { Button } from '@/components/ui/button';
import { PrinterIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Print-ready poster / counter stand / shelf stickers. Uses print CSS + the
 * browser's print-to-PDF (no PDF dependency). Printing a piece sets a body
 * attribute so only that piece is visible in the print output.
 */
export function PosterSheet({
  storeName,
  url,
  qrDataUrl,
}: {
  storeName: string;
  url: string;
  qrDataUrl: string;
}) {
  const t = useTranslations('Manage.posters');
  const plainUrl = url.replace(/^https?:\/\//, '');

  function printPiece(id: string) {
    document.body.setAttribute('data-print', id);
    window.addEventListener(
      'afterprint',
      () => document.body.removeAttribute('data-print'),
      { once: true }
    );
    window.print();
  }

  const pieces = [
    { id: 'poster', label: t('poster'), scale: 'text-5xl', qr: 'w-64' },
    { id: 'counter', label: t('counter'), scale: 'text-3xl', qr: 'w-40' },
    { id: 'stickers', label: t('stickers'), scale: 'text-xl', qr: 'w-28' },
  ];

  return (
    <div className="flex flex-col gap-8">
      <style>{`
        @media print {
          body[data-print] #print-root [data-piece] { display: none !important; }
          body[data-print="poster"] #print-root [data-piece="poster"],
          body[data-print="counter"] #print-root [data-piece="counter"],
          body[data-print="stickers"] #print-root [data-piece="stickers"] {
            display: flex !important;
          }
          body[data-print] .no-print { display: none !important; }
        }
      `}</style>

      <div id="print-root" className="flex flex-col gap-8">
        {pieces.map((piece) => (
          <div key={piece.id} className="flex flex-col gap-3">
            <div className="no-print flex items-center justify-between">
              <h2 className="font-semibold text-lg">{piece.label}</h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => printPiece(piece.id)}
              >
                <PrinterIcon className="mr-2 size-4" />
                {t('printType', { type: piece.label })}
              </Button>
            </div>
            <div
              data-piece={piece.id}
              className="flex flex-col items-center gap-4 rounded-xl border p-8 text-center"
            >
              <p className={`font-bold ${piece.scale}`}>{storeName}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt="QR code"
                className={`${piece.qr} h-auto`}
              />
              <p className="font-semibold text-xl">{t('scanToFind')}</p>
              <p className="text-lg">{t('scanToFindZh')}</p>
              <p className="text-muted-foreground">
                {t('orVisit')} <span className="font-medium">{plainUrl}</span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
