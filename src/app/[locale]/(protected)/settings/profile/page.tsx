import { UpdateAvatarCard } from '@/components/settings/profile/update-avatar-card';
import { UpdateNameCard } from '@/components/settings/profile/update-name-card';
import { getSession } from '@/lib/server';

export default async function ProfilePage() {
  const session = await getSession();
  // The protected layout handles redirects for missing or invalid sessions.
  if (!session?.user) return null;

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <UpdateNameCard initialName={session.user.name} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <UpdateAvatarCard
          initialName={session.user.name}
          initialImage={session.user.image ?? null}
        />
      </div>
    </div>
  );
}
