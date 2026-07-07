'use client';

import {
  setStaffPinAction,
  updateStoreProfileAction,
} from '@/actions/store-settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useLocaleRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

interface Props {
  handle: string;
  rootDomain: string;
  displayName: string;
  displayNameZh: string | null;
  announcement: string | null;
  announcementZh: string | null;
}

export function StoreProfileForm(props: Props) {
  const t = useTranslations('Manage.profile');
  const router = useLocaleRouter();
  const [displayName, setDisplayName] = useState(props.displayName);
  const [displayNameZh, setDisplayNameZh] = useState(props.displayNameZh ?? '');
  const [announcement, setAnnouncement] = useState(props.announcement ?? '');
  const [announcementZh, setAnnouncementZh] = useState(
    props.announcementZh ?? ''
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await updateStoreProfileAction({
        displayName: displayName.trim(),
        displayNameZh: displayNameZh.trim() || null,
        announcement: announcement.trim() || null,
        announcementZh: announcementZh.trim() || null,
      });
      if (res?.data?.success) {
        toast.success(t('saved'));
        router.refresh();
      } else {
        toast.error(t('saveError'));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex flex-col gap-1">
        <Label>{t('handle')}</Label>
        <p className="rounded-md border bg-muted/50 px-3 py-2 text-muted-foreground">
          {props.handle}.{props.rootDomain}
        </p>
        <p className="text-muted-foreground text-xs">{t('handleFixed')}</p>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="name">{t('name')}</Label>
        <Input
          id="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={100}
          className="h-11"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="nameZh">{t('nameZh')}</Label>
        <Input
          id="nameZh"
          value={displayNameZh}
          onChange={(e) => setDisplayNameZh(e.target.value)}
          maxLength={100}
          className="h-11"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="ann">{t('announcement')}</Label>
        <Textarea
          id="ann"
          value={announcement}
          onChange={(e) => setAnnouncement(e.target.value)}
          maxLength={500}
          rows={2}
        />
        <p className="text-muted-foreground text-xs">{t('announcementHint')}</p>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="annZh">{t('announcementZh')}</Label>
        <Textarea
          id="annZh"
          value={announcementZh}
          onChange={(e) => setAnnouncementZh(e.target.value)}
          maxLength={500}
          rows={2}
        />
      </div>

      <Button type="submit" disabled={saving || !displayName.trim()}>
        {t('save')}
      </Button>
    </form>
  );
}

export function StaffPinForm() {
  const t = useTranslations('Manage.pin');
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await setStaffPinAction({ pin });
      if (res?.data?.success) {
        toast.success(t('saved'));
        setPin('');
      } else {
        toast.error(t('formatError'));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <p className="text-muted-foreground text-sm">{t('hint')}</p>
      <div className="flex flex-col gap-1">
        <Label htmlFor="pin">{t('newPin')}</Label>
        <Input
          id="pin"
          value={pin}
          onChange={(e) =>
            setPin(e.target.value.replace(/\D/g, '').slice(0, 6))
          }
          inputMode="numeric"
          placeholder="1234"
          className="h-11 w-40 text-lg tracking-widest"
        />
      </div>
      <Button
        type="submit"
        variant="outline"
        className="w-fit"
        disabled={saving || pin.length < 4}
      >
        {t('save')}
      </Button>
    </form>
  );
}
