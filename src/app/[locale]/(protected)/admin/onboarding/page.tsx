import { listCommercialOnboarding } from '@/actions/commercial-onboarding';
import { StoreInviteForm } from '@/components/admin/store-invite-form';
import type { Locale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

export default async function CommercialOnboardingPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { leads, invites } = await listCommercialOnboarding();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 lg:px-6">
      <div>
        <h1 className="font-bold text-2xl">Commercial onboarding</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Review Canadian demo requests and issue single-use owner invitations.
        </p>
      </div>

      <section className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 font-semibold">Invite a store owner</h2>
        <StoreInviteForm />
      </section>

      <section>
        <h2 className="mb-3 font-semibold text-lg">Demo requests</h2>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left">
              <tr>
                <th className="p-3">Store</th>
                <th className="p-3">Contact</th>
                <th className="p-3">Location</th>
                <th className="p-3">Consent</th>
                <th className="p-3">Received</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="border-t align-top">
                  <td className="p-3 font-medium">
                    {lead.storeName}
                    <div className="font-normal text-muted-foreground">
                      {lead.storeCount} store(s) · {lead.preferredLanguage}
                    </div>
                  </td>
                  <td className="p-3">
                    {lead.contactName}
                    <div>
                      <a className="underline" href={`mailto:${lead.email}`}>
                        {lead.email}
                      </a>
                    </div>
                  </td>
                  <td className="p-3">
                    {lead.city}, {lead.province}
                  </td>
                  <td className="p-3">
                    {lead.marketingConsent ? 'Yes' : 'Transactional only'}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {lead.createdAt.toLocaleDateString('en-CA')}
                  </td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr>
                  <td
                    className="p-6 text-center text-muted-foreground"
                    colSpan={5}
                  >
                    No demo requests yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold text-lg">Owner invitations</h2>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left">
              <tr>
                <th className="p-3">Email</th>
                <th className="p-3">Status</th>
                <th className="p-3">Expires</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id} className="border-t">
                  <td className="p-3">{invite.email}</td>
                  <td className="p-3">{invite.status}</td>
                  <td className="p-3 text-muted-foreground">
                    {invite.expiresAt.toLocaleString('en-CA')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
