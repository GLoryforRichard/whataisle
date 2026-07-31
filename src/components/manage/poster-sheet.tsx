'use client';

import { BearFace } from '@/components/layout/bear-face';
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
    {
      id: 'poster',
      label: t('poster'),
      scale: 'text-5xl',
      qr: 'w-64',
      bear: 96,
    },
    {
      id: 'counter',
      label: t('counter'),
      scale: 'text-3xl',
      qr: 'w-40',
      bear: 64,
    },
    {
      id: 'stickers',
      label: t('stickers'),
      scale: 'text-xl',
      qr: 'w-28',
      bear: 40,
    },
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
            {/* White paper (toner-friendly), hard ink frame, bear + yellow
                marker underline + yellow scan pill. print-color-adjust keeps
                the orange/yellow in print; the QR stays pure black for scan
                reliability. */}
            <div
              data-piece={piece.id}
              className="flex flex-col items-center gap-4 rounded-[18px] border-2 border-[#111111] bg-white p-8 text-center [print-color-adjust:exact]"
            >
              <BearFace size={piece.bear} />
              <span className="relative inline-block">
                <p className={`wa-display font-bold ${piece.scale}`}>
                  {storeName}
                </p>
                <svg
                  viewBox="0 0 100 12"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                  className="pointer-events-none absolute right-0 -bottom-2 left-0 h-2.5 w-full"
                >
                  <path
                    d="M4 8 C 28 3, 64 3, 96 6"
                    fill="none"
                    stroke="#ffc900"
                    strokeWidth="6"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt="QR code"
                className={`${piece.qr} h-auto`}
              />
              <p className="inline-block rounded-full border-2 border-[#111111] bg-[#ffc900] px-4 py-1.5 font-bold text-[#111111] text-xl [print-color-adjust:exact]">
                {t('scanToFind')}
              </p>
              <p className="text-lg">{t('scanToFindZh')}</p>
              <p className="text-muted-foreground">
                {t('orVisit')}{' '}
                <span className="font-mono font-medium">{plainUrl}</span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
