'use client';

import { closeTicketAction } from '@/actions/support-actions';
import { Button } from '@/components/ui/button';
import { useLocaleRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

interface Ticket {
  id: string;
  subject: string;
  body: string | null;
  store: string;
  via: string;
  createdAt: string;
}

export function TicketList({ tickets }: { tickets: Ticket[] }) {
  const t = useTranslations('Admin.tickets');
  const router = useLocaleRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function close(id: string) {
    setBusy(id);
    try {
      await closeTicketAction({ ticketId: id });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (tickets.length === 0) {
    return <p className="text-muted-foreground">{t('empty')}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {tickets.map((ticket) => (
        <li key={ticket.id} className="rounded-lg border p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{ticket.subject}</p>
              <p className="text-muted-foreground text-sm">
                {ticket.store} · {ticket.via} ·{' '}
                {new Date(ticket.createdAt).toLocaleDateString()}
              </p>
              {ticket.body ? (
                <p className="mt-2 whitespace-pre-wrap text-sm">
                  {ticket.body}
                </p>
              ) : null}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => close(ticket.id)}
              disabled={busy === ticket.id}
            >
              {t('close')}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
