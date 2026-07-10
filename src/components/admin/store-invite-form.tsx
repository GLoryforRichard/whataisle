'use client';

import { createStoreInviteAction } from '@/actions/commercial-onboarding';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

export function StoreInviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await createStoreInviteAction({ email });
          if (result?.data?.success) {
            toast.success('Invitation sent');
            setEmail('');
            router.refresh();
            return;
          }
          toast.error('Unable to send invitation');
        });
      }}
    >
      <Input
        aria-label="Owner email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="owner@example.com"
        required
      />
      <Button type="submit" disabled={pending || !email}>
        {pending ? 'Sending…' : 'Send 7-day invitation'}
      </Button>
    </form>
  );
}
