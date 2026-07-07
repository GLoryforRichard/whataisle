'use client';

import { createAnnouncementAction } from '@/actions/support-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useLocaleRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

interface Announcement {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
}

export function AnnouncementManager({
  announcements,
}: {
  announcements: Announcement[];
}) {
  const t = useTranslations('Admin.announcements');
  const router = useLocaleRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function publish() {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    try {
      const res = await createAnnouncementAction({
        title: title.trim(),
        body: body.trim(),
      });
      if (res?.data?.success) {
        toast.success(t('published'));
        setTitle('');
        setBody('');
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-3 rounded-lg border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          publish();
        }}
      >
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('newTitle')}
          maxLength={200}
        />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('newBody')}
          rows={3}
          maxLength={2000}
        />
        <Button
          type="submit"
          className="w-fit"
          disabled={busy || !title.trim() || !body.trim()}
        >
          {t('publish')}
        </Button>
      </form>

      {announcements.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {announcements.map((a) => (
            <li key={a.id} className="rounded-lg border p-4">
              <p className="font-medium">{a.title}</p>
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground text-sm">
                {a.body}
              </p>
              <p className="mt-2 text-muted-foreground text-xs">
                {new Date(a.publishedAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
